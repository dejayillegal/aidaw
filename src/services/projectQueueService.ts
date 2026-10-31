import {
  AbletonProjectState,
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

export class ProjectQueueService {
  private items = new Map<string, QueuedProjectRecord>();
  private activeQueueId: string | null = null;
  private abortControllers = new Map<string, AbortController>();
  private listeners = new Set<() => void>();

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

  private async persistRecordToIdb(record: QueuedProjectRecord): Promise<void> {
    if (typeof indexedDB === 'undefined') return;
    try {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
          const d = req.result;
          if (!d.objectStoreNames.contains(IDB_STORE)) {
            d.createObjectStore(IDB_STORE, { keyPath: 'queueId' });
          }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        store.put(JSON.parse(JSON.stringify(record)));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      db.close();
    } catch {
      // Fallback to in-memory map if IndexedDB is restricted in iframe
    }
  }

  public getAllItems(): QueuedProjectRecord[] {
    return Array.from(this.items.values()).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    );
  }

  public getItem(queueId: string): QueuedProjectRecord | undefined {
    const rec = this.items.get(queueId);
    return rec ? (JSON.parse(JSON.stringify(rec)) as QueuedProjectRecord) : undefined;
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
    rec.workingProjectState.projectRevision = rec.workingProjectRevision;
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
        humanization,
        masterBus
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
  }> {
    const rec = this.items.get(queueId);
    if (!rec) {
      throw new Error(`Queue item ${queueId} not found`);
    }

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
          humanization,
          masterBus
        );
        rec.workingProjectState = cloneProjectState(stageEResult.updatedProject);
        rec.workingProjectRevision = stageEResult.updatedProject.projectRevision || 2;
        rec.verificationReport = stageEResult.verificationReport;
      }

      if (controller.signal.aborted || rec.cancelRequested) {
        this.transitionState(rec, 'cancelled');
        this.notify();
        return { record: this.getItem(queueId)! };
      }

      this.transitionState(rec, 'validating');
      this.notify();

      const compiledXml = compileRehumanizedAlsXml(rec.workingProjectState, humanization);
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
        humanization,
        masterBus,
        exportPreset
      );

      rec.exportVerification = exportResult.verification;
      const baseName = rec.originalFilename.replace(/\.(als|xml)$/i, '');
      rec.exportedAlsFilename = `${baseName}_Calibrated_Master.als`;
      rec.exportedWavFilename = `${baseName}_${exportPreset.sampleRate / 1000}k_${
        exportPreset.bitDepth
      }b.wav`;

      this.transitionState(rec, 'exported');
      await this.persistRecordToIdb(rec);
      this.notify();

      return {
        record: this.getItem(queueId)!,
        alsGzipBytes,
        wavArrayBuffer: exportResult.wavArrayBuffer,
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

  public removeQueueItem(queueId: string): void {
    this.cancelQueueItem(queueId);
    this.items.delete(queueId);
    if (this.activeQueueId === queueId) {
      const remaining = this.getAllItems();
      this.activeQueueId = remaining.length > 0 ? remaining[0].queueId : null;
    }
    this.notify();
  }

  public clearQueue(): void {
    for (const id of this.items.keys()) {
      this.cancelQueueItem(id);
    }
    this.items.clear();
    this.activeQueueId = null;
    this.notify();
  }
}

export const projectQueueService = new ProjectQueueService();
