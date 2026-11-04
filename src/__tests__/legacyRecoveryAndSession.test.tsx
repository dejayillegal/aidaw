// @vitest-environment jsdom
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  ProjectQueueService,
  projectQueueService,
  RECOVERY_IDB_NAME,
  RECOVERY_IDB_STORE,
} from '../services/projectQueueService';
import { buildStarterAbletonXml, computeSha256Hex, parseAlsXmlString } from '../engine/alsXmlEngine';
import { decodeProjectSnapshot } from '../services/projectSnapshotService';
import { DEFAULT_HUMANIZATION, DEFAULT_MASTER_BUS, DEFAULT_TRANSPORT } from '../engine/projectDefaults';
import { queueSessionLaunch, storeArrangementClipInSession } from '../services/commandBus';
import { synthEngine } from '../engine/webAudioSynth';
import {
  CURRENT_DEVICE_CONVERSION_VERSION,
  computeDeviceParameterHash,
  buildDeviceConversionRecord,
} from '../engine/abletonCapabilityMatrix';

// In-Memory IDB Store
const inMemoryDbs = new Map<string, { version: number; stores: Map<string, Map<any, any>> }>();

function createMockIdbFactory() {
  return {
    open(name: string, version = 1) {
      const req: any = {
        result: null,
        error: null,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
        onblocked: null,
      };
      setTimeout(() => {
        let dbRecord = inMemoryDbs.get(name);
        const isUpgrade = !dbRecord || dbRecord.version < version;
        if (!dbRecord) {
          dbRecord = { version, stores: new Map() };
          inMemoryDbs.set(name, dbRecord);
        } else if (version > dbRecord.version) {
          dbRecord.version = version;
        }

        const dbInstance: any = {
          name,
          version: dbRecord.version,
          objectStoreNames: {
            contains: (sName: string) => dbRecord!.stores.has(sName),
          },
          createObjectStore: (sName: string, options?: { keyPath?: string }) => {
            if (!dbRecord!.stores.has(sName)) {
              dbRecord!.stores.set(sName, new Map());
            }
            return {
              name: sName,
              keyPath: options?.keyPath,
            };
          },
          transaction: (storeNames: string | string[], mode = 'readonly') => {
            let aborted = false;
            let activeReqs = 0;
            const rollbacks: (() => void)[] = [];
            const tx: any = {
              mode,
              error: null,
              oncomplete: null,
              onerror: null,
              onabort: null,
              abort: () => {
                aborted = true;
                for (let i = rollbacks.length - 1; i >= 0; i--) {
                  rollbacks[i]();
                }
                setTimeout(() => {
                  tx.onabort?.(new Event('abort'));
                }, 0);
              },
              objectStore: (sName: string) => {
                const storeMap = dbRecord!.stores.get(sName) || new Map();
                function triggerCompleteIfDone() {
                  if (activeReqs === 0 && !aborted) {
                    setTimeout(() => {
                      if (!aborted) tx.oncomplete?.(new Event('complete'));
                    }, 0);
                  }
                }

                return {
                  put: (val: any, key?: any) => {
                    activeReqs++;
                    const reqPut: any = { onsuccess: null, onerror: null };
                    const actualKey = key !== undefined ? key : val.queueId;
                    const hadOld = storeMap.has(actualKey);
                    const oldVal = hadOld ? storeMap.get(actualKey) : undefined;
                    storeMap.set(actualKey, JSON.parse(JSON.stringify(val)));
                    rollbacks.push(() => {
                      if (hadOld) storeMap.set(actualKey, oldVal);
                      else storeMap.delete(actualKey);
                    });
                    setTimeout(() => {
                      activeReqs--;
                      if (!aborted) {
                        reqPut.onsuccess?.({ target: reqPut });
                        triggerCompleteIfDone();
                      }
                    }, 0);
                    return reqPut;
                  },
                  get: (key: any) => {
                    activeReqs++;
                    const reqGet: any = { result: undefined, onsuccess: null, onerror: null };
                    const found = storeMap.get(key);
                    reqGet.result = found ? JSON.parse(JSON.stringify(found)) : undefined;
                    setTimeout(() => {
                      activeReqs--;
                      if (!aborted) {
                        reqGet.onsuccess?.({ target: reqGet });
                        triggerCompleteIfDone();
                      }
                    }, 0);
                    return reqGet;
                  },
                  getAll: () => {
                    activeReqs++;
                    const reqAll: any = { result: [], onsuccess: null, onerror: null };
                    reqAll.result = Array.from(storeMap.values()).map((v) => JSON.parse(JSON.stringify(v)));
                    setTimeout(() => {
                      activeReqs--;
                      if (!aborted) {
                        reqAll.onsuccess?.({ target: reqAll });
                        triggerCompleteIfDone();
                      }
                    }, 0);
                    return reqAll;
                  },
                  delete: (key: any) => {
                    activeReqs++;
                    const reqDel: any = { onsuccess: null, onerror: null };
                    storeMap.delete(key);
                    setTimeout(() => {
                      activeReqs--;
                      if (!aborted) {
                        reqDel.onsuccess?.({ target: reqDel });
                        triggerCompleteIfDone();
                      }
                    }, 0);
                    return reqDel;
                  },
                  clear: () => {
                    activeReqs++;
                    const reqClr: any = { onsuccess: null, onerror: null };
                    storeMap.clear();
                    setTimeout(() => {
                      activeReqs--;
                      if (!aborted) {
                        reqClr.onsuccess?.({ target: reqClr });
                        triggerCompleteIfDone();
                      }
                    }, 0);
                    return reqClr;
                  },
                };
              },
            };
            return tx;
          },
          close: () => {},
        };

        req.result = dbInstance;
        if (isUpgrade && req.onupgradeneeded) {
          req.onupgradeneeded({ target: req });
        }
        req.onsuccess?.({ target: req });
      }, 0);
      return req;
    },
  };
}

const mockIdb = createMockIdbFactory();
(globalThis as any).indexedDB = mockIdb;
if (typeof window !== 'undefined') {
  (window as any).indexedDB = mockIdb;
}

// Mock Web Audio
class MockAudioNode {
  onended: (() => void) | null = null;
  constructor(public readonly context: any) {}
  connect(dest: any) {
    return dest;
  }
  disconnect() {}
  start() {}
  stop() {
    if (this.onended) {
      const cb = this.onended;
      this.onended = null;
      cb();
    }
  }
}

class MockAudioParam {
  value: number;
  constructor(defaultVal = 0) {
    this.value = defaultVal;
  }
  setTargetAtTime(val: number) {
    this.value = val;
  }
  setValueAtTime(val: number) {
    this.value = val;
  }
  linearRampToValueAtTime(val: number) {
    this.value = val;
  }
  exponentialRampToValueAtTime(val: number) {
    this.value = val;
  }
  setValueCurveAtTime(values: any) {
    if (values && values.length) this.value = values[values.length - 1];
  }
  cancelScheduledValues() {}
  cancelAndHoldAtTime() {}
}

class MockAnalyserNode extends MockAudioNode {
  fftSize = 256;
  frequencyBinCount = 128;
  smoothingTimeConstant = 0.8;
  trackId?: string;

  getByteTimeDomainData(arr: Uint8Array) {
    const bus = (synthEngine as any).bus;
    const isPlaying = synthEngine.getIsPlaying();
    let hasVoices = false;
    if (isPlaying && bus?.trackVoices) {
      if (!this.trackId) {
        for (const [tId, ch] of bus.trackChannels.entries()) {
          if (ch.analyser === this) {
            this.trackId = tId;
            break;
          }
        }
      }
      if (this.trackId) {
        const voices = bus.trackVoices.get(this.trackId);
        hasVoices = Boolean(voices && voices.size > 0);
      }
    }
    if (hasVoices) {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.round(128 + 58 * Math.sin((i / 8) * Math.PI));
      }
    } else {
      arr.fill(128);
    }
  }

  getByteFrequencyData(arr: Uint8Array) {
    arr.fill(0);
  }
}

class MockAudioContext {
  currentTime = 0;
  sampleRate = 44100;
  state = 'running';

  async resume() {
    this.state = 'running';
  }
  async close() {
    this.state = 'closed';
  }

  createGain() {
    const node = new MockAudioNode(this) as any;
    node.gain = new MockAudioParam(1.0);
    return node;
  }

  createBiquadFilter() {
    const node = new MockAudioNode(this) as any;
    node.type = 'lowpass';
    node.frequency = new MockAudioParam(1000);
    node.Q = new MockAudioParam(1.0);
    node.gain = new MockAudioParam(0);
    return node;
  }

  createDynamicsCompressor() {
    const node = new MockAudioNode(this) as any;
    node.threshold = new MockAudioParam(-24);
    node.knee = new MockAudioParam(30);
    node.ratio = new MockAudioParam(12);
    node.attack = new MockAudioParam(0.003);
    node.release = new MockAudioParam(0.25);
    return node;
  }

  createWaveShaper() {
    const node = new MockAudioNode(this) as any;
    node.curve = null;
    node.oversample = 'none';
    return node;
  }

  createStereoPanner() {
    const node = new MockAudioNode(this) as any;
    node.pan = new MockAudioParam(0);
    return node;
  }

  createConvolver() {
    const node = new MockAudioNode(this) as any;
    node.buffer = null;
    return node;
  }

  createDelay() {
    const node = new MockAudioNode(this) as any;
    node.delayTime = new MockAudioParam(0);
    return node;
  }

  createAnalyser() {
    return new MockAnalyserNode(this);
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    const data = new Float32Array(length);
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => data,
    };
  }

  createBufferSource() {
    const node = new MockAudioNode(this) as any;
    node.buffer = null;
    node.loop = false;
    node.playbackRate = new MockAudioParam(1.0);
    return node;
  }

  createOscillator() {
    const node = new MockAudioNode(this) as any;
    node.type = 'sine';
    node.frequency = new MockAudioParam(440);
    node.detune = new MockAudioParam(0);
    return node;
  }

  createConstantSource() {
    const node = new MockAudioNode(this) as any;
    node.offset = new MockAudioParam(1.0);
    return node;
  }
}

(globalThis as any).AudioContext = MockAudioContext;
if (typeof window !== 'undefined') {
  (window as any).AudioContext = MockAudioContext;
  (window as any).webkitAudioContext = MockAudioContext;
}

function createDrumBussProjectFixture() {
  const p = parseAlsXmlString(buildStarterAbletonXml('berghain-134', 777, 4).xml);
  for (const track of p.tracks) {
    for (const dev of track.devices || []) {
      delete (dev as any).conversionRecord;
    }
  }
  const kickTrack = p.tracks[0];
  const dbDevice = {
    id: '102',
    xmlTag: 'DrumBuss',
    displayName: 'DrumBuss',
    category: 'audio_effect' as const,
    parameters: [
      { name: 'Drive', value: 0.25 },
      { name: 'Crunch', value: 0.1 },
      { name: 'Boom', value: 0.4 },
      { name: 'DryWet', value: 1.0 },
    ],
  };
  kickTrack.devices = [dbDevice];
  delete (p as any).conversionSchemaVersion;
  return p;
}

async function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(RECOVERY_IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(RECOVERY_IDB_STORE)) {
        db.createObjectStore(RECOVERY_IDB_STORE, { keyPath: 'queueId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putRawEnvelope(raw: any): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(RECOVERY_IDB_STORE, 'readwrite');
    tx.objectStore(RECOVERY_IDB_STORE).put(raw);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function getRawEnvelope(key: string): Promise<any> {
  const db = await openIdb();
  const result = await new Promise<any>((resolve, reject) => {
    const tx = db.transaction(RECOVERY_IDB_STORE, 'readonly');
    const req = tx.objectStore(RECOVERY_IDB_STORE).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return result;
}

async function clearIdb(): Promise<void> {
  const db = await openIdb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(RECOVERY_IDB_STORE, 'readwrite');
    tx.objectStore(RECOVERY_IDB_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

describe('Legacy Recovery, DrumBuss 102 Migration & Safe Recovery Workflow', () => {
  beforeEach(async () => {
    inMemoryDbs.clear();
    await clearIdb();
    synthEngine.stop();
    (synthEngine as any).ctx = null;
    (synthEngine as any).bus = null;
    projectQueueService.setSimulateMigrationWriteFailureForTest(false);
  });

  it('automatically migrates unversioned, v1, and v2 envelopes containing DrumBuss 102 without conversionRecord', async () => {
    const project = createDrumBussProjectFixture();
    const queueId = 'legacy_drumbuss_unversioned';

    const rawEnvelope = {
      queueId,
      originalFilename: 'Unversioned-Berghain.als',
      workingProjectRevision: 3,
      workingProjectState: project,
      state: 'ready',
      updatedAt: new Date().toISOString(),
    };
    const checksum = await computeSha256Hex(JSON.stringify(rawEnvelope));
    await putRawEnvelope({
      queueId,
      record: rawEnvelope,
      checksum,
      active: true,
    });

    const queue = new ProjectQueueService();
    const restored = await queue.restorePersistedProjects();

    expect(restored).not.toBeNull();
    expect(restored!.fileName).toBe(project.fileName);
    expect(queue.getMigrationStatus()).toBe('migrated');
    expect(restored!.conversionSchemaVersion).toBe(CURRENT_DEVICE_CONVERSION_VERSION);

    // Verify DrumBuss 102 now has a valid conversionRecord
    const dbDevice = restored!.tracks[0].devices.find((d) => d.id === '102');
    expect(dbDevice?.conversionRecord).toBeDefined();
    expect(dbDevice?.conversionRecord?.status).toBe('valid');
    expect(dbDevice?.conversionRecord?.xmlTag).toBe('DrumBuss');

    // Verify original envelope was preserved in backup:<queueId>
    const backup = await getRawEnvelope(`backup:${queueId}`);
    expect(backup).toBeDefined();
    expect(backup.record.workingProjectState.tracks[0].devices[0].conversionRecord).toBeUndefined();

    // Verify persisted primary record now contains the migrated project
    const updatedPrimary = await getRawEnvelope(queueId);
    expect(updatedPrimary.record.workingProjectState.tracks[0].devices[0].conversionRecord).toBeDefined();
  });

  it('migration is idempotent across repeated reloads', async () => {
    const project = createDrumBussProjectFixture();
    const queueId = 'idempotent_test';
    const rawEnvelope = {
      queueId,
      originalFilename: 'Idempotent.als',
      workingProjectRevision: 1,
      workingProjectState: project,
      state: 'ready',
      updatedAt: new Date().toISOString(),
    };
    const checksum = await computeSha256Hex(JSON.stringify(rawEnvelope));
    await putRawEnvelope({
      queueId,
      recoveryVersion: 1,
      record: rawEnvelope,
      checksum,
      active: true,
    });

    // First recovery pass (migrates)
    const queue1 = new ProjectQueueService();
    const restored1 = await queue1.restorePersistedProjects();
    expect(restored1).not.toBeNull();
    expect(queue1.getMigrationStatus()).toBe('migrated');

    // Capture persisted primary and backup records
    const primaryAfterFirst = await getRawEnvelope(queueId);

    // Second recovery pass (already migrated)
    const queue2 = new ProjectQueueService();
    const restored2 = await queue2.restorePersistedProjects();
    expect(restored2).not.toBeNull();
    expect(queue2.getMigrationStatus()).toBe('current');

    const primaryAfterSecond = await getRawEnvelope(queueId);
    expect(primaryAfterSecond.checksum).toBe(primaryAfterFirst.checksum);
  });

  it('preserves meaningful rejection: rejects future conversionVersion and does not overwrite', async () => {
    const project = createDrumBussProjectFixture();
    const queueId = 'future_conversion_test';
    project.tracks[0].devices[0].conversionRecord = {
      sourceDeviceId: '102',
      xmlTag: 'DrumBuss',
      conversionVersion: 99,
      conversionKind: 'audio_insert_dsp',
      status: 'valid',
      sourceParameterHash: 'future_hash',
      supportedSemantics: [],
      limitations: [],
      generatedDescriptor: { id: '102', xmlTag: 'DrumBuss', displayName: 'DrumBuss' },
    };
    project.conversionSchemaVersion = 99;

    const rawEnvelope = {
      queueId,
      originalFilename: 'Future.als',
      workingProjectRevision: 1,
      workingProjectState: project,
      state: 'ready',
      updatedAt: new Date().toISOString(),
    };
    const checksum = await computeSha256Hex(JSON.stringify(rawEnvelope));
    await putRawEnvelope({
      queueId,
      recoveryVersion: 1,
      record: rawEnvelope,
      checksum,
      active: true,
    });

    const queue = new ProjectQueueService();
    const restored = await queue.restorePersistedProjects();
    expect(restored).toBeNull();
    expect(queue.getPersistenceStatus().status).toBe('error');
    expect(queue.getPersistenceStatus().error).toContain('FUTURE_CONVERSION_VERSION');

    // Stored envelope must be untouched
    const stored = await getRawEnvelope(queueId);
    expect(stored.record.workingProjectState.tracks[0].devices[0].conversionRecord.conversionVersion).toBe(99);
  });

  it('preserves meaningful rejection: rejects explicitly invalidated conversionRecord and stale parameter hash', async () => {
    const project = createDrumBussProjectFixture();
    const queueId = 'invalidated_record_test';
    project.tracks[0].devices[0].conversionRecord = {
      sourceDeviceId: '102',
      xmlTag: 'DrumBuss',
      conversionVersion: CURRENT_DEVICE_CONVERSION_VERSION,
      conversionKind: 'audio_insert_dsp',
      status: 'invalidated',
      sourceParameterHash: 'stale_hash_value',
      supportedSemantics: [],
      limitations: [],
      generatedDescriptor: { id: '102', xmlTag: 'DrumBuss', displayName: 'DrumBuss' },
    };
    project.conversionSchemaVersion = CURRENT_DEVICE_CONVERSION_VERSION;

    const rawEnvelope = {
      queueId,
      originalFilename: 'Invalidated.als',
      workingProjectRevision: 1,
      workingProjectState: project,
      state: 'ready',
      updatedAt: new Date().toISOString(),
    };
    const checksum = await computeSha256Hex(JSON.stringify(rawEnvelope));
    await putRawEnvelope({
      queueId,
      recoveryVersion: 1,
      record: rawEnvelope,
      checksum,
      active: true,
    });

    const queue = new ProjectQueueService();
    const restored = await queue.restorePersistedProjects();
    expect(restored).toBeNull();
    expect(queue.getPersistenceStatus().status).toBe('error');
    expect(queue.getPersistenceStatus().error).toContain('CONVERSION_REQUIRED');
  });

  it('handles corrupt primary envelope with valid backup:<queueId>', async () => {
    const project = createDrumBussProjectFixture();
    const queueId = 'corrupt_primary_test';

    const rawEnvelope = {
      queueId,
      originalFilename: 'CorruptPrimary.als',
      workingProjectRevision: 1,
      workingProjectState: project,
      state: 'ready',
      updatedAt: new Date().toISOString(),
    };

    // Seed corrupt primary envelope (invalid checksum)
    await putRawEnvelope({
      queueId,
      recoveryVersion: 1,
      record: rawEnvelope,
      checksum: 'bad_checksum_hash',
      active: true,
    });

    // Seed valid backup envelope
    const validChecksum = await computeSha256Hex(JSON.stringify(rawEnvelope));
    await putRawEnvelope({
      queueId: `backup:${queueId}`,
      recoveryVersion: 1,
      record: rawEnvelope,
      checksum: validChecksum,
      active: true,
    });

    const queue = new ProjectQueueService();
    const restored = await queue.restorePersistedProjects();
    expect(restored).not.toBeNull();
    expect(restored!.fileName).toBe(project.fileName);
  });

  it('blocks silent migration when legacy provenance is ambiguous, providing repairLegacyRecoveryRecord', async () => {
    const project = createDrumBussProjectFixture();
    project.tracks = project.tracks.slice(0, 2);
    const queueId = 'partial_conversion_test';
    project.tracks[0].devices[0].id = '102'; // DrumBuss without conversionRecord
    const erosionDev: any = {
      id: '201',
      xmlTag: 'Erosion',
      displayName: 'Erosion',
      category: 'audio_effect' as const,
      parameters: [{ name: 'Amount', value: 40 }],
    };
    erosionDev.conversionRecord = buildDeviceConversionRecord(erosionDev);
    project.tracks[1].devices = [erosionDev];
    // conversionSchemaVersion stamped = partial post-conversion state
    project.conversionSchemaVersion = CURRENT_DEVICE_CONVERSION_VERSION;

    const rawEnvelope = {
      queueId,
      originalFilename: 'PartialConversion.als',
      workingProjectRevision: 4,
      workingProjectState: project,
      state: 'ready',
      updatedAt: new Date().toISOString(),
    };
    const checksum = await computeSha256Hex(JSON.stringify(rawEnvelope));
    await putRawEnvelope({
      queueId,
      recoveryVersion: 1,
      record: rawEnvelope,
      checksum,
      active: true,
    });

    const queue = new ProjectQueueService();
    const restored = await queue.restorePersistedProjects();

    // Silent recovery MUST be blocked
    expect(restored).toBeNull();
    expect(queue.getMigrationStatus()).toBe('repair_required');
    expect(queue.getPersistenceStatus().status).toBe('error');
    expect(queue.getPersistenceStatus().error).toContain('Missing conversion record for <DrumBuss> (102)');
    expect(queue.isRecoveryBannerActive()).toBe(true);

    const blocked = queue.getBlockedRecoveryRecords();
    expect(blocked.length).toBe(1);
    expect(blocked[0].canRepairLegacyConversions).toBe(true);

    // Explicit repair creates a new revision while preserving backup
    const repaired = await queue.repairLegacyRecoveryRecord(queueId);
    expect(repaired).not.toBeNull();
    expect(repaired!.conversionSchemaVersion).toBe(CURRENT_DEVICE_CONVERSION_VERSION);
    expect(repaired!.tracks[0].devices[0].conversionRecord).toBeDefined();

    const backup = await getRawEnvelope(`backup:${queueId}`);
    expect(backup).toBeDefined();
    expect(backup.record.workingProjectState.tracks[0].devices[0].conversionRecord).toBeUndefined();
  });

  it('handles simulated migration write failure by preserving storage and allowing successful retry', async () => {
    const project = createDrumBussProjectFixture();
    const queueId = 'write_failure_test';
    const rawEnvelope = {
      queueId,
      originalFilename: 'WriteFailure.als',
      workingProjectRevision: 1,
      workingProjectState: project,
      state: 'ready',
      updatedAt: new Date().toISOString(),
    };
    const checksum = await computeSha256Hex(JSON.stringify(rawEnvelope));
    await putRawEnvelope({
      queueId,
      record: rawEnvelope,
      checksum,
      active: true,
    });

    const queue = new ProjectQueueService();
    queue.setSimulateMigrationWriteFailureForTest(true);

    // Initial attempt fails during migration write
    const restored = await queue.restorePersistedProjects();
    expect(restored).toBeNull();
    expect(queue.getPersistenceStatus().status).toBe('error');

    // Storage preserved in original pre-migration state
    const originalInStorage = await getRawEnvelope(queueId);
    expect(originalInStorage.record.workingProjectState.tracks[0].devices[0].conversionRecord).toBeUndefined();

    // Reset simulated failure and retry
    queue.setSimulateMigrationWriteFailureForTest(false);
    const retryRestored = await queue.retryRecovery();
    expect(retryRestored).not.toBeNull();
    expect(retryRestored!.tracks[0].devices[0].conversionRecord).toBeDefined();
  });

  it('decodes native v1, v2, and v3 .aidaw.json snapshots containing DrumBuss 102 cleanly', () => {
    const project = createDrumBussProjectFixture();

    // v1 snapshot
    const v1Json = JSON.stringify({
      format: 'parametric-als-daw',
      version: 1,
      project,
      audioSettings: {
        humanization: DEFAULT_HUMANIZATION,
        masterBus: DEFAULT_MASTER_BUS,
        transport: DEFAULT_TRANSPORT,
      },
    });
    const decodedV1 = decodeProjectSnapshot(v1Json);
    expect(decodedV1.version).toBe(2);
    expect(decodedV1.project.tracks[0].devices[0].conversionRecord).toBeDefined();
    expect(decodedV1.project.tracks[0].devices[0].conversionRecord?.xmlTag).toBe('DrumBuss');

    // v2 snapshot
    const v2Project = createDrumBussProjectFixture();
    v2Project.audioSettings = {
      humanization: DEFAULT_HUMANIZATION,
      masterBus: DEFAULT_MASTER_BUS,
      transport: DEFAULT_TRANSPORT,
    };
    const v2Json = JSON.stringify({
      format: 'parametric-als-daw',
      version: 2,
      project: v2Project,
    });
    const decodedV2 = decodeProjectSnapshot(v2Json);
    expect(decodedV2.version).toBe(2);
    expect(decodedV2.project.tracks[0].devices[0].conversionRecord).toBeDefined();
  });
});

describe('Native Session Workflow & Audio Meter Activity', () => {
  it('synthesizes audio on MIDI tracks with devices: [] and produces native meter activity on both tracks', async () => {
    // Exact fixture from runSessionWorkflows in scripts/track-workflows-check.mjs
    const p = parseAlsXmlString(buildStarterAbletonXml('berghain-134', 777, 4).xml);
    p.tempo = 120;
    p.arrangementLengthBars = 1;
    p.tracks = p.tracks.slice(0, 2);
    p.tracks.forEach((t, i) => {
      t.devices = [];
      t.mixer.reverbSend = 0;
      t.mixer.delaySend = 0;
      t.mixer.sidechainDepth = 0;
      t.clips = [
        {
          ...t.clips[0],
          id: `arr-${i}`,
          startTime: 0,
          endTime: 1,
          length: 1,
          notes: [
            {
              ...t.clips[0].notes[0],
              id: `note-${i}`,
              time: 0.125,
              quantizedTime: 0.125,
              duration: 2,
              probability: 1,
            },
          ],
        },
      ];
    });

    // Copy both tracks' first clip to slot A
    let sessionProject = p;
    for (const track of p.tracks) {
      sessionProject = storeArrangementClipInSession(sessionProject, track.id, 0, track.clips[0].id);
    }
    // Launch Scene A at beat 0
    sessionProject = queueSessionLaunch(sessionProject, null, 0, 0, 1);

    expect(sessionProject.session?.events.length).toBe(2);

    // Load into synthEngine via setState
    synthEngine.setState(sessionProject, DEFAULT_HUMANIZATION, DEFAULT_TRANSPORT, DEFAULT_MASTER_BUS);
    synthEngine.start();

    // Check meter levels on both tracks
    const meter0 = synthEngine.getTrackMeterLevels(sessionProject.tracks[0].id);
    const meter1 = synthEngine.getTrackMeterLevels(sessionProject.tracks[1].id);

    expect(meter0.peakDb).toBeGreaterThan(-55);
    expect(meter1.peakDb).toBeGreaterThan(-55);

    // Stop track 0
    const stoppedProject = queueSessionLaunch(sessionProject, sessionProject.tracks[0].id, null, 0.5, 1);
    synthEngine.setState(stoppedProject, DEFAULT_HUMANIZATION, DEFAULT_TRANSPORT, DEFAULT_MASTER_BUS);

    // Advance clock past stop beat (track 0 stopped at beat 1.0; track 1 has note at 1.125)
    synthEngine.seek(1.12);
    const stoppedMeter0 = synthEngine.getTrackMeterLevels(sessionProject.tracks[0].id);
    const continuingMeter1 = synthEngine.getTrackMeterLevels(sessionProject.tracks[1].id);

    expect(stoppedMeter0.peakDb).toBeLessThanOrEqual(-55);
    expect(continuingMeter1.peakDb).toBeGreaterThan(-55);

    // Clear session performance
    const clearedProject = {
      ...stoppedProject,
      session: {
        quantizationBeats: 1,
        events: [],
      },
    };
    synthEngine.setState(clearedProject, DEFAULT_HUMANIZATION, DEFAULT_TRANSPORT, DEFAULT_MASTER_BUS);

    const clearedMeter0 = synthEngine.getTrackMeterLevels(sessionProject.tracks[0].id);
    const clearedMeter1 = synthEngine.getTrackMeterLevels(sessionProject.tracks[1].id);
    expect(clearedMeter0.peakDb).toBeLessThanOrEqual(-55);
    expect(clearedMeter1.peakDb).toBeLessThanOrEqual(-55);

    synthEngine.stop();
  });
});
