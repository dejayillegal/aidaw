import { assertProjectState } from '../engine/projectStateContracts';
import {
  AbletonProjectState,
  BatchWavExportItemResult,
  BatchWavExportProgress,
  HumanizationConfig,
  MasterBusConfig,
  MasterExportPreset,
  QueuedProjectRecord,
  QueueItemState,
} from '../types/ableton';
import {
  compileRehumanizedAlsXml,
  compressXmlToAlsBlob,
  computeSha256Hex,
  decompressAlsFile,
  parseAlsXmlString,
  synchronizeProjectStateToXml,
  validateAlsStructuralIntegrity,
} from '../engine/alsXmlEngine';
import {
  applyAndVerifyStageECalibration,
  buildStageCCalibrationProposal,
  evaluateProjectRenderCapabilities,
  executeMasterExport20,
  runStageAStaticAnalysis,
  runStageBAudioMeasurement,
} from '../engine/masteringEngine';
import {
  auditProjectCapabilities,
  ensureProjectDeviceConversions,
} from '../engine/abletonCapabilityMatrix';

const ALLOWED_STATE_TRANSITIONS: Record<QueueItemState, QueueItemState[]> = {
  queued: ['importing', 'cancelled', 'failed', 'unsupported'],
  importing: ['analyzing', 'ready', 'cancelled', 'failed', 'unsupported'],
  analyzing: ['ready', 'calibrating', 'cancelled', 'failed', 'unsupported'],
  ready: ['analyzing', 'calibrating', 'preview_ready', 'approved', 'compiling', 'cancelled', 'failed'],
  calibrating: ['preview_ready', 'cancelled', 'failed'],
  preview_ready: ['approved', 'calibrating', 'ready', 'cancelled', 'failed'],
  approved: ['compiling', 'preview_ready', 'cancelled', 'failed'],
  compiling: ['validating', 'cancelled', 'failed'],
  validating: ['exported', 'ready', 'cancelled', 'failed'],
  exported: ['analyzing', 'calibrating', 'approved', 'compiling', 'ready'],
  cancelled: ['queued', 'importing', 'analyzing', 'ready'],
  failed: ['queued', 'importing', 'analyzing', 'ready'],
  unsupported: ['queued', 'ready'],
};

export function isLegalQueueStateTransition(
  fromState: QueueItemState,
  toState: QueueItemState
): boolean {
  if (fromState === toState) return true;
  const allowed = ALLOWED_STATE_TRANSITIONS[fromState] || [];
  return allowed.includes(toState);
}

export function cloneProjectState(project: AbletonProjectState): AbletonProjectState {
  return JSON.parse(JSON.stringify(project)) as AbletonProjectState;
}

const IDB_NAME = 'aidaw_project_queue_db_v1';
const IDB_STORE = 'queued_projects';
function cloneQueueRecord(record: QueuedProjectRecord): QueuedProjectRecord {
  return { ...JSON.parse(JSON.stringify(record)), exportedWavBlob: record.exportedWavBlob, exportedMidiBlob: record.exportedMidiBlob };
}

export class ProjectQueueService {
  private items = new Map<string, QueuedProjectRecord>();
  private activeQueueId: string | null = null;
  private abortControllers = new Map<string, AbortController>();
  private listeners = new Set<() => void>();
  private persistenceTail: Promise<void> = Promise.resolve();
  private persistenceStatus: 'saved' | 'pending' | 'unavailable' | 'error' = 'saved';
  private persistenceError: string | undefined;
  private pendingRecoveryWrites = 0;
  private persistenceFailures = new Map<string, string>();
  private artifactMeasurements = new Map<string, Promise<void>>();
  private removedQueueIds = new Set<string>();
  private recoveryPromise: Promise<AbletonProjectState | null> | null = null;

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  private transitionState(record: QueuedProjectRecord, nextState: QueueItemState): void {
    if (!isLegalQueueStateTransition(record.state, nextState)) {
      throw new Error(
        `Illegal queue state transition for ${record.originalFilename}: ${record.state} -> ${nextState}`
      );
    }
    record.state = nextState;
    record.updatedAt = new Date().toISOString();
  }

  private openRecoveryDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(IDB_NAME, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(IDB_STORE)) request.result.createObjectStore(IDB_STORE, { keyPath: 'queueId' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('RECOVERY_BLOCKED: database upgrade blocked'));
    });
  }

  private persistRecordToIdb(record: QueuedProjectRecord): Promise<void> {
    if (this.removedQueueIds.has(record.queueId)) return Promise.resolve();
    if (typeof indexedDB === 'undefined') { this.persistenceStatus = 'unavailable'; return Promise.resolve(); }
    // Capture NOW, not after an asynchronous open; newer edits cannot overwrite this queued revision.
    const snapshot = JSON.parse(JSON.stringify(record)) as QueuedProjectRecord;
    const active = this.activeQueueId === record.queueId;
    this.persistenceStatus = 'pending';
    this.pendingRecoveryWrites++;
    this.persistenceTail = this.persistenceTail.then(async () => {
      let db: IDBDatabase | undefined;
      try {
        if (!snapshot.workingProjectState) throw new Error('RECOVERY_NO_PROJECT: no validated project state to journal');
        assertProjectState(snapshot.workingProjectState);
        const checksum = await computeSha256Hex(JSON.stringify(snapshot));
        db = await this.openRecoveryDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db!.transaction(IDB_STORE, 'readwrite');
          tx.oncomplete = () => resolve();
          // Settle failed writes only after the atomic transaction has actually aborted.
          tx.onerror = () => {};
          tx.onabort = () => reject(tx.error || new Error('RECOVERY_ABORT: transaction aborted'));
          const store = tx.objectStore(IDB_STORE);
          const prior = store.get(snapshot.queueId);
          prior.onsuccess = () => {
            try {
              if (prior.result) store.put({ ...prior.result, queueId: `backup:${snapshot.queueId}`, originalQueueId: snapshot.queueId });
              const recoveryVersion=snapshot.workingProjectState.session || snapshot.workingProjectState.audioSettings?.transport.arrangementMode==='session' ? 2 : 1;
              store.put({ queueId: snapshot.queueId, recoveryVersion, record: snapshot, checksum, active });
            } catch { tx.abort(); }
          };
        });
        this.persistenceStatus = 'saved'; this.persistenceError = undefined; this.persistenceFailures.delete(snapshot.queueId);
      } catch (error) {
        this.persistenceStatus = 'error';
        this.persistenceError = error instanceof Error ? error.message : String(error);
        this.persistenceFailures.set(snapshot.queueId, this.persistenceError);
        this.notify();
      } finally { this.pendingRecoveryWrites--; db?.close(); }
    });
    return this.persistenceTail;
  }

  public getPersistenceStatus(): { status: string; error?: string } {
    return { status: this.persistenceFailures.size ? 'error' : this.pendingRecoveryWrites ? 'pending' : this.persistenceStatus, error: this.persistenceFailures.values().next().value || this.persistenceError };
  }

  public async flushPersistence(): Promise<void> {
    await this.persistenceTail;
    if (this.getPersistenceStatus().status === 'error') throw new Error(this.getPersistenceStatus().error || 'RECOVERY_WRITE');
    if (this.persistenceStatus === 'unavailable') throw new Error('RECOVERY_UNAVAILABLE: IndexedDB is unavailable');
  }

  public restorePersistedProjects(): Promise<AbletonProjectState | null> {
    if (this.recoveryPromise) return this.recoveryPromise;
    this.recoveryPromise = this.restoreRecoveryRecords();
    return this.recoveryPromise;
  }

  private async restoreRecoveryRecords(): Promise<AbletonProjectState | null> {
    if (typeof indexedDB === 'undefined') { this.persistenceStatus = 'unavailable'; return null; }
    const db = await this.openRecoveryDb();
    let rows: any[];
    try {
      rows = await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly'); const request = tx.objectStore(IDB_STORE).getAll();
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
    } finally { db.close(); }
    const ids = new Set(rows.map(row => row.originalQueueId || row.queueId).filter(id => typeof id === 'string' && !id.startsWith('backup:')));
    const restored: { record: QueuedProjectRecord; active: boolean }[] = [];
    for (const id of ids) {
      const candidates = [rows.find(row => row.queueId === id), rows.find(row => row.queueId === `backup:${id}`)];
      if (candidates[0]?.recoveryVersion !== undefined && ![1,2].includes(candidates[0].recoveryVersion)) {
        this.persistenceStatus = 'error'; this.persistenceError = 'RECOVERY_VERSION: unsupported journal; preserved without downgrade'; continue;
      }
      let recovered = false;
      for (const row of candidates) {
        if (!row) continue;
        try {
          if (row.recoveryVersion !== undefined && ![1,2].includes(row.recoveryVersion)) throw new Error('RECOVERY_VERSION: unsupported journal');
          const record: QueuedProjectRecord = row.recoveryVersion !== undefined ? row.record : { ...row, queueId: row.originalQueueId || row.queueId };
          if (row.recoveryVersion !== undefined && row.checksum !== await computeSha256Hex(JSON.stringify(record))) throw new Error('RECOVERY_CHECKSUM: damaged record');
          assertProjectState(record.workingProjectState);
          if (record.queueId !== id) throw new Error('RECOVERY_ID: wrong project identity');
          const copy = JSON.parse(JSON.stringify(record)) as QueuedProjectRecord;
          copy.workingProjectState.rawXmlModified = synchronizeProjectStateToXml(copy.workingProjectState);
          copy.workingProjectState.rawXml = copy.workingProjectState.rawXmlModified;
          delete copy.exportedWavBlob; delete copy.exportedMidiBlob;
          if (['importing', 'analyzing', 'calibrating', 'compiling', 'validating', 'exported'].includes(copy.state)) {
            copy.state = 'ready'; copy.errorDetails = 'Recovered interrupted operation; run it again explicitly.';
          }
          if (row === candidates[1]) copy.errorDetails = 'Recovered previous valid revision after journal corruption.';
          if (!this.items.has(id)) this.items.set(id, copy);
          restored.push({ record: copy, active: !!row.active }); recovered = true; break;
        } catch (error) { this.persistenceError = error instanceof Error ? error.message : String(error); }
      }
      if (!recovered) this.persistenceStatus = 'error';
    }
    restored.sort((a,b) => Number(b.active) - Number(a.active) || b.record.updatedAt.localeCompare(a.record.updatedAt));
    if (!this.activeQueueId && restored[0]) this.activeQueueId = restored[0].record.queueId;
    this.notify();
    return this.getActiveItem()?.workingProjectState || null;
  }

  public getAllItems(): QueuedProjectRecord[] {
    return Array.from(this.items.values()).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    ).map(cloneQueueRecord);
  }

  public getItem(queueId: string): QueuedProjectRecord | undefined {
    const rec = this.items.get(queueId);
    return rec ? cloneQueueRecord(rec) : undefined;
  }

  public getActiveQueueId(): string | null {
    return this.activeQueueId;
  }

  public getActiveItem(): QueuedProjectRecord | undefined {
    if (!this.activeQueueId) return undefined;
    return this.getItem(this.activeQueueId);
  }

  /**
   * Enqueues a project from raw XML or parsed state with SHA-256 checksum and snapshot isolation.
   */
  public async enqueueProjectFromXml(
    filename: string,
    rawXml: string,
    binaryBytes?: Uint8Array
  ): Promise<QueuedProjectRecord> {
    const queueId = `queue_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const checksum = await computeSha256Hex(binaryBytes || rawXml);

    const record: QueuedProjectRecord = {
      queueId,
      originalFilename: filename,
      binaryChecksumSha256: checksum,
      sourceXmlSnapshot: rawXml,
      workingProjectState: null as unknown as AbletonProjectState,
      workingProjectRevision: 1,
      importedLiveVersion: 'Ableton Live 11/12',
      state: 'queued',
      renderCapabilities: {
        canSynthesizeOffline: false,
        hasExternalUnrenderableAudio: false,
        hasUnsupportedNativeDevices: false,
        unsupportedDeviceTypes: [],
      },
      cancelRequested: false,
      createdAt: now,
      updatedAt: now,
    };

    this.items.set(queueId, record);
    this.notify();

    try {
      this.transitionState(record, 'importing');
      this.notify();

      const parsed = parseAlsXmlString(rawXml);
      if (!parsed.tracks || parsed.tracks.length === 0) {
        this.transitionState(record, 'unsupported');
        record.errorDetails = 'ALS XML contains no supported MIDI or Audio tracks.';
        await this.persistRecordToIdb(record);
        this.notify();
        return this.getItem(queueId)!;
      }

      const capAudit = auditProjectCapabilities(parsed);
      if (capAudit.warnings.length > 0) {
        parsed.compatibilityWarnings = Array.from(
          new Set([...(parsed.compatibilityWarnings || []), ...capAudit.warnings])
        );
      }
      record.workingProjectState = cloneProjectState(parsed);
      record.workingProjectRevision = parsed.projectRevision || 1;
      record.importedLiveVersion = parsed.creator || 'Ableton Live 12.0';
      record.renderCapabilities = evaluateProjectRenderCapabilities(parsed);

      this.transitionState(record, 'analyzing');
      record.stageAStatic = runStageAStaticAnalysis(record.workingProjectState);
      this.transitionState(record, 'ready');

      if (!this.activeQueueId) {
        this.activeQueueId = queueId;
      }

      await this.persistRecordToIdb(record);
      this.notify();
      return this.getItem(queueId)!;
    } catch (err) {
      record.state = 'failed';
      record.errorDetails =
        err instanceof Error ? err.message : 'Failed to parse .als XML structure.';
      record.updatedAt = new Date().toISOString();
      await this.persistRecordToIdb(record);
      this.notify();
      return this.getItem(queueId)!;
    }
  }

  /**
   * Enqueues a browser File (.als gzip or .xml) into the Multi-Project Queue.
   */
  public async enqueueProjectState(project: AbletonProjectState, filename = project.fileName, bytes?: Uint8Array): Promise<QueuedProjectRecord> {
    assertProjectState(project);
    const state = ensureProjectDeviceConversions(cloneProjectState(project));
    const now = new Date().toISOString();
    const queueId = `project_${crypto.randomUUID()}`;
    const record: QueuedProjectRecord = {
      queueId, originalFilename: filename, binaryChecksumSha256: await computeSha256Hex(bytes || JSON.stringify(state)),
      sourceXmlSnapshot: state.rawXmlOriginal, workingProjectState: state,
      workingProjectRevision: state.projectRevision || state.revision || 1,
      importedLiveVersion: state.creator, state: 'ready',
      renderCapabilities: evaluateProjectRenderCapabilities(state), stageAStatic: runStageAStaticAnalysis(state),
      cancelRequested: false, createdAt: now, updatedAt: now,
    };
    this.items.set(queueId, record);
    if (!this.activeQueueId) this.activeQueueId = queueId;
    await this.persistRecordToIdb(record); this.notify();
    return this.getItem(queueId)!;
  }

  public async enqueueBrowserFile(file: File): Promise<QueuedProjectRecord> {
    const arrayBuffer = await file.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    const { xml } = await decompressAlsFile(file);
    return this.enqueueProjectFromXml(file.name, xml, uint8);
  }

  /**
   * Switches the active workstation project while preserving uncommitted working changes
   * on the outgoing project item (`ProjectSwitchCoordinator`).
   */
  public switchActiveProject(
    targetQueueId: string,
    currentWorkingState?: AbletonProjectState
  ): AbletonProjectState | null {
    if (this.activeQueueId && currentWorkingState) {
      const currentRecord = this.items.get(this.activeQueueId);
      if (currentRecord) {
        currentRecord.workingProjectState = cloneProjectState(currentWorkingState);
        currentRecord.workingProjectRevision = (currentRecord.workingProjectRevision || 1) + 1;
        currentRecord.updatedAt = new Date().toISOString();
        void this.persistRecordToIdb(currentRecord);
      }
    }

    const targetRecord = this.items.get(targetQueueId);
    if (!targetRecord || !targetRecord.workingProjectState) {
      return null;
    }

    this.activeQueueId = targetQueueId;
    void this.persistRecordToIdb(targetRecord);
    this.notify();
    return cloneProjectState(targetRecord.workingProjectState);
  }

  /**
   * Updates the working state of a specific queued project in isolation.
   */
  public updateWorkingProjectState(queueId: string, updatedProject: AbletonProjectState): void {
    const rec = this.items.get(queueId);
    if (!rec) return;
    rec.workingProjectState = cloneProjectState(updatedProject);
    rec.workingProjectRevision = (rec.workingProjectRevision || 1) + 1;
    rec.updatedAt = new Date().toISOString();
    void this.persistRecordToIdb(rec);
    this.notify();
  }

  /**
   * Runs Stage A (Static Analysis), Stage B (Audio Measurement), and Stage C (Calibration Proposal)
   * on a single queued project with AbortSignal support.
   */
  public async calibrateQueueItem(
    queueId: string,
    humanization: HumanizationConfig,
    masterBus: MasterBusConfig,
    targetLufs = -8.5,
    truePeakCeilingDbtp = -1.0
  ): Promise<QueuedProjectRecord> {
    const rec = this.items.get(queueId);
    if (!rec) {
      throw new Error(`Queue item ${queueId} not found`);
    }

    // A queued project owns its mix. Caller controls are only for legacy projects without settings.
    const projectHumanization = rec.workingProjectState.audioSettings?.humanization || humanization;
    const projectMasterBus = rec.workingProjectState.audioSettings?.masterBus || masterBus;

    const controller = new AbortController();
    this.abortControllers.set(queueId, controller);
    rec.cancelRequested = false;
    rec.errorDetails = undefined;

    try {
      this.transitionState(rec, 'analyzing');
      this.notify();

      if (controller.signal.aborted || rec.cancelRequested) {
        this.transitionState(rec, 'cancelled');
        this.notify();
        return this.getItem(queueId)!;
      }

      const stageA = runStageAStaticAnalysis(rec.workingProjectState);
      rec.stageAStatic = stageA;

      const stageB = await runStageBAudioMeasurement(
        rec.workingProjectState,
        projectHumanization,
        projectMasterBus
      );
      rec.stageBMeasured = stageB;

      if (controller.signal.aborted || rec.cancelRequested) {
        this.transitionState(rec, 'cancelled');
        this.notify();
        return this.getItem(queueId)!;
      }

      this.transitionState(rec, 'calibrating');
      this.notify();

      const proposal = buildStageCCalibrationProposal(
        rec.workingProjectState,
        stageA,
        stageB,
        targetLufs,
        truePeakCeilingDbtp
      );
      rec.calibrationProposal = proposal;

      this.transitionState(rec, 'preview_ready');
      await this.persistRecordToIdb(rec);
      this.notify();
      return this.getItem(queueId)!;
    } catch (err) {
      if (rec.cancelRequested || controller.signal.aborted) {
        rec.state = 'cancelled';
      } else {
        rec.state = 'failed';
        rec.errorDetails = err instanceof Error ? err.message : 'Calibration failed.';
      }
      rec.updatedAt = new Date().toISOString();
      await this.persistRecordToIdb(rec);
      this.notify();
      return this.getItem(queueId)!;
    } finally {
      this.abortControllers.delete(queueId);
    }
  }

  /**
   * Stage D: Toggles per-track approval in a project's calibration proposal.
   */
  public setProposalTrackApproval(queueId: string, trackId: string, approved: boolean): void {
    const rec = this.items.get(queueId);
    if (!rec || !rec.calibrationProposal) return;
    rec.calibrationProposal.trackDeltas = rec.calibrationProposal.trackDeltas.map((td) =>
      td.trackId === trackId ? { ...td, approved } : td
    );
    rec.updatedAt = new Date().toISOString();
    this.notify();
  }

  /**
   * Stage D -> Approved: Marks a project's calibration proposal as approved.
   */
  public approveQueueItemProposal(queueId: string): QueuedProjectRecord | undefined {
    const rec = this.items.get(queueId);
    if (!rec || !rec.calibrationProposal) return undefined;
    if (rec.state === 'preview_ready' || rec.state === 'ready') {
      this.transitionState(rec, 'approved');
      void this.persistRecordToIdb(rec);
      this.notify();
    }
    return this.getItem(queueId);
  }

  /**
   * Stage E: Transactional Apply, Re-Measure, XML Compile & Validate for an approved queue item.
   */
  public async applyAndExportQueueItem(
    queueId: string,
    humanization: HumanizationConfig,
    masterBus: MasterBusConfig,
    exportPreset: MasterExportPreset
  ): Promise<{
    record: QueuedProjectRecord;
    alsGzipBytes?: Uint8Array;
    wavArrayBuffer?: ArrayBuffer;
    wavBlob?: Blob;
  }> {
    const rec = this.items.get(queueId);
    if (!rec) {
      throw new Error(`Queue item ${queueId} not found`);
    }

    // A queued project owns its mix. Caller controls are only for legacy projects without settings.
    const projectHumanization = rec.workingProjectState.audioSettings?.humanization || humanization;
    const projectMasterBus = rec.workingProjectState.audioSettings?.masterBus || masterBus;

    const controller = new AbortController();
    this.abortControllers.set(queueId, controller);

    try {
      if (rec.state === 'preview_ready') {
        this.transitionState(rec, 'approved');
      }
      this.transitionState(rec, 'compiling');
      this.notify();

      if (rec.calibrationProposal) {
        const stageEResult = await applyAndVerifyStageECalibration(
          rec.workingProjectState,
          rec.calibrationProposal,
          projectHumanization,
          projectMasterBus
        );
        const nextProject = stageEResult.updatedProject || stageEResult.calibratedProject;
        rec.workingProjectState = cloneProjectState(nextProject);
        rec.workingProjectRevision = nextProject.projectRevision || 2;
        rec.verificationReport = stageEResult.verificationReport;
      }

      if (controller.signal.aborted || rec.cancelRequested) {
        this.transitionState(rec, 'cancelled');
        this.notify();
        return { record: this.getItem(queueId)! };
      }

      this.transitionState(rec, 'validating');
      this.notify();

      const compiledXml = compileRehumanizedAlsXml(rec.workingProjectState, projectHumanization);
      const xmlValidation = validateAlsStructuralIntegrity(
        compiledXml,
        rec.workingProjectState.tracks.length,
        rec.workingProjectState.arrangementLengthBars
      );

      if (!xmlValidation.valid) {
        throw new Error(`ALS XML Structural Validation failed: ${xmlValidation.details}`);
      }

      const { blob: alsBlob } = await compressXmlToAlsBlob(compiledXml);
      const alsGzipBytes = new Uint8Array(await alsBlob.arrayBuffer());
      const exportResult = await executeMasterExport20(
        rec.workingProjectState,
        projectHumanization,
        projectMasterBus,
        exportPreset
      );

      rec.exportVerification = exportResult.verification;
      const baseName = rec.originalFilename.replace(/\.(als|xml)$/i, '');
      rec.exportedAlsFilename = `${baseName}_Calibrated_Master.als`;
      rec.exportedWavFilename = `${baseName}_${exportPreset.sampleRate / 1000}k_${
        exportPreset.bitDepth
      }b.wav`;
      rec.exportedWavBlob = exportResult.blob;

      this.transitionState(rec, 'exported');
      await this.persistRecordToIdb(rec);
      this.notify();

      return {
        record: this.getItem(queueId)!,
        alsGzipBytes,
        wavArrayBuffer: exportResult.wavArrayBuffer,
        wavBlob: exportResult.blob,
      };
    } catch (err) {
      if (rec.cancelRequested || controller.signal.aborted) {
        rec.state = 'cancelled';
      } else {
        rec.state = 'failed';
        rec.errorDetails = err instanceof Error ? err.message : 'Export compilation failed.';
      }
      rec.updatedAt = new Date().toISOString();
      await this.persistRecordToIdb(rec);
      this.notify();
      return { record: this.getItem(queueId)! };
    } finally {
      this.abortControllers.delete(queueId);
    }
  }

  /**
   * Sequentially exports WAV files for all selected project files in the queue.
   * Iterates one by one through the selected queueIds, rendering & verifying each project's
   * WAV output while emitting progress callbacks.
   */
  public async batchExportSelectedProjectsToWav(
    selectedQueueIds: string[],
    humanization: HumanizationConfig,
    masterBus: MasterBusConfig,
    exportPreset: MasterExportPreset,
    onProgress?: (progress: BatchWavExportProgress) => void
  ): Promise<BatchWavExportItemResult[]> {
    const validRecords = selectedQueueIds
      .map((id) => this.items.get(id))
      .filter(
        (rec): rec is QueuedProjectRecord =>
          Boolean(rec && !rec.isMidiExport && rec.workingProjectState && !rec.cancelRequested)
      );

    const results: BatchWavExportItemResult[] = [];
    const totalSelected = validRecords.length;
    if (totalSelected === 0) return results;

    for (let i = 0; i < totalSelected; i++) {
      const target = validRecords[i];
      if (target.cancelRequested) continue;

      onProgress?.({
        currentIndex: i + 1,
        totalSelected,
        currentQueueId: target.queueId,
        currentFilename: target.originalFilename,
        completedCount: i,
        percentage: Math.round((i / totalSelected) * 100),
      });

      if (target.state === 'cancelled' || target.state === 'failed') {
        this.retryQueueItem(target.queueId);
      }

      const exportRes = await this.applyAndExportQueueItem(
        target.queueId,
        humanization,
        masterBus,
        exportPreset
      );

      if (exportRes.wavArrayBuffer && exportRes.record.exportedWavFilename) {
        const wavBlob =
          exportRes.wavBlob ||
          new Blob([exportRes.wavArrayBuffer], { type: 'audio/wav' });
        results.push({
          queueId: target.queueId,
          originalFilename: target.originalFilename,
          exportedWavFilename: exportRes.record.exportedWavFilename,
          wavBlob,
          wavArrayBuffer: exportRes.wavArrayBuffer,
          verification: exportRes.record.exportVerification,
          record: exportRes.record,
        });
      }

      onProgress?.({
        currentIndex: i + 1,
        totalSelected,
        currentQueueId: target.queueId,
        currentFilename: target.originalFilename,
        completedCount: i + 1,
        percentage: Math.round(((i + 1) / totalSelected) * 100),
      });
    }

    return results;
  }

  /**
   * Batch processes all ready/queued projects through Stages A, B, and C sequentially
   * with immediate cancellation support.
   */
  public async calibrateAllReadyItems(
    humanization: HumanizationConfig,
    masterBus: MasterBusConfig,
    targetLufs = -8.5,
    truePeakCeilingDbtp = -1.0
  ): Promise<QueuedProjectRecord[]> {
    const items = this.getAllItems();
    for (const item of items) {
      const current = this.items.get(item.queueId);
      if (!current || current.cancelRequested) continue;
      if (
        current.state === 'ready' ||
        current.state === 'preview_ready' ||
        current.state === 'exported'
      ) {
        await this.calibrateQueueItem(
          current.queueId,
          humanization,
          masterBus,
          targetLufs,
          truePeakCeilingDbtp
        );
      }
    }
    return this.getAllItems();
  }

  /**
   * Cancels an in-flight queue item without corrupting any already-completed project items.
   */
  public cancelQueueItem(queueId: string): void {
    const rec = this.items.get(queueId);
    if (!rec) return;
    rec.cancelRequested = true;
    const ctrl = this.abortControllers.get(queueId);
    if (ctrl) {
      ctrl.abort();
    }
    if (rec.state !== 'exported') {
      rec.state = 'cancelled';
      rec.cancellationStatus = 'cancelled';
      rec.updatedAt = new Date().toISOString();
    }
    this.notify();
  }

  /**
   * Retries a cancelled or failed queue item, restoring it to 'ready' from its working snapshot.
   */
  public retryQueueItem(queueId: string): QueuedProjectRecord | undefined {
    const rec = this.items.get(queueId);
    if (!rec) return undefined;
    rec.cancelRequested = false;
    rec.errorDetails = undefined;
    if (rec.workingProjectState) {
      rec.state = 'ready';
    } else if (rec.sourceXmlSnapshot) {
      rec.workingProjectState = parseAlsXmlString(rec.sourceXmlSnapshot);
      rec.state = 'ready';
    }
    rec.updatedAt = new Date().toISOString();
    this.notify();
    return this.getItem(queueId);
  }

  private removeRecoveryRecord(queueId: string): void {
    this.removedQueueIds.add(queueId);
    if (typeof indexedDB === 'undefined') return;
    this.persistenceTail = this.persistenceTail.then(async () => {
      let db: IDBDatabase | undefined;
      try {
        db = await this.openRecoveryDb();
        await new Promise<void>((resolve, reject) => {
          const tx = db!.transaction(IDB_STORE, 'readwrite');
          tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error || new Error('RECOVERY_DELETE_ABORT'));
          tx.onerror = () => {};
          const store = tx.objectStore(IDB_STORE); store.delete(queueId); store.delete(`backup:${queueId}`);
        });
        this.persistenceFailures.delete(queueId);
      } catch (error) {
        this.persistenceStatus = 'error'; this.persistenceError = String(error); this.persistenceFailures.set(queueId, this.persistenceError); this.notify();
      } finally { db?.close(); }
    });
  }

  public removeQueueItem(queueId: string): void {
    this.cancelQueueItem(queueId);
    this.items.delete(queueId);
    this.removeRecoveryRecord(queueId);
    if (this.activeQueueId === queueId) {
      const remaining = this.getAllItems();
      this.activeQueueId = remaining.length > 0 ? remaining[0].queueId : null;
    }
    this.notify();
  }

  private async measureMidiArtifact(queueId: string, blob: Blob): Promise<void> {
    try {
      const buffer = typeof blob.arrayBuffer === 'function' ? await blob.arrayBuffer() : await new Promise<ArrayBuffer>((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(blob);
      });
      const checksum = await computeSha256Hex(new Uint8Array(buffer));
      const record = this.items.get(queueId);
      if (!record) return;
      record.binaryChecksumSha256 = checksum;
      if (record.exportArtifactRef) record.exportArtifactRef.checksumSha256 = checksum;
      await this.persistRecordToIdb(record); this.notify();
    } catch (error) {
      const record = this.items.get(queueId);
      if (record) { record.errorDetails = `Artifact checksum unavailable: ${String(error)}`; this.notify(); }
    }
  }

  public async awaitArtifactChecksum(queueId: string): Promise<void> {
    await this.artifactMeasurements.get(queueId);
  }

  public enqueueMidiClip(
    clipName: string,
    trackName: string,
    midiFileName: string,
    blob: Blob,
    byteSize: number,
    projectState: AbletonProjectState,
    includeHumanization = true
  ): QueuedProjectRecord {
    const queueId = `midi_export_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const now = new Date().toISOString();
    const record: QueuedProjectRecord = {
      queueId,
      originalFilename: `${trackName} - ${clipName} (${includeHumanization ? 'Humanized' : 'Quantized'} .mid)`,
      binaryChecksumSha256: '',
      workingProjectRevision: projectState.projectRevision || 1,
      importedLiveVersion: 'Ableton Live 12.0 MIDI Standard',
      state: 'exported',
      isMidiExport: true,
      midiIncludeHumanization: includeHumanization,
      exportedMidiFilename: midiFileName,
      exportedMidiBlob: blob,
      exportArtifactRef: {
        fileName: midiFileName,
        byteSize,
        checksumSha256: '',
        exportedAt: now,
      },
      workingProjectState: cloneProjectState(projectState),
      createdAt: now,
      updatedAt: now,
      timestamps: {
        queuedAt: now,
        completedAt: now,
        updatedAt: now,
      },
    };

    this.items.set(queueId, record);
    this.activeQueueId = queueId;
    this.notify();
    const measured = this.measureMidiArtifact(queueId, blob);
    this.artifactMeasurements.set(queueId, measured);
    return this.getItem(queueId)!;
  }

  public clearQueue(): void {
    for (const id of this.items.keys()) {
      this.cancelQueueItem(id);
      this.removeRecoveryRecord(id);
    }
    this.items.clear();
    this.activeQueueId = null;
    this.notify();
  }
}

export const projectQueueService = new ProjectQueueService();
