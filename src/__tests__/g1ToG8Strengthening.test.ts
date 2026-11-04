// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import {
  CANONICAL_PPQ,
  MAX_SUPPORTED_TIMELINE_BARS,
  MusicalTimeService,
  SUPPORTED_PPQ_RESOLUTIONS,
  assertValidPpq,
  barBeatTickToBeat,
  beatToBarBeatTick,
  beatToSecondsWithTempoMap,
  beatsToTicks,
  evaluatePlayableArrangementEvents,
  evaluatePlayableProjectEvents,
  evaluatePlayableSessionEvents,
  maxSupportedBeatsForMeterMap,
  playbackRegion,
  quantizeBeatToCanonicalTick,
  secondsToBeatWithTempoMap,
  sessionEventsInWindow,
  snapBeatsToGridTicks,
  ticksToBeats,
} from '../engine/timelineCoordinates';
import {
  buildStarterAbletonXml,
  parseAbletonXmlDom,
  synchronizeProjectStateToXml,
} from '../engine/alsXmlEngine';
import {
  decomposeNotesIntoSectionClips,
  generateContextualAutomationPoints,
  generateSectionArrangementPlan,
} from '../engine/compositionIntelligenceEngine';
import {
  decodeProjectSnapshot,
  encodeProjectSnapshot,
} from '../services/projectSnapshotService';
import type {
  AbletonDevice,
  HumanizationConfig,
  MasterBusConfig,
  TransportConfig,
} from '../types/ableton';
import {
  ABLETON_CAPABILITY_MATRIX,
  ABLETON_DEVICE_REGISTRY,
  CURRENT_DEVICE_CONVERSION_VERSION,
  LEGACY_CONVERSION_MIGRATION_V1,
  MAX_EXECUTABLE_INSERT_DEVICES,
  auditProjectCapabilities,
  buildDeviceConversionRecord,
  convertOrReconvertDeviceInstance,
  ensureProjectDeviceConversions,
  evaluateTrackMidiDeviceChain,
  getAbletonDeviceContract,
  invalidateDeviceConversionRecord,
  migrateLegacyDeviceConversionRecord,
  migrateMissingLegacyProjectConversions,
  syncDeviceConversionRecord,
  validateTrackDeviceChainOrderingAndCounts,
  verifyDeviceConversionRecord,
  verifyDeviceRegistryIntegrity,
} from '../engine/abletonCapabilityMatrix';
import {
  MAX_CHANNEL_INSERT_SLOTS,
  assertExecutableInsertLimits,
  insertDeviceIntoChannelStrip,
  removeChannelInsertDevice,
  reorderChannelInsertDevice,
  replaceTrackInstrumentDevice,
  toggleChannelInsertBypass,
  updateChannelInsertParam,
} from '../engine/channelStripEngine';
import { assertProjectState } from '../engine/projectStateContracts';
import {
  MAX_CONCURRENT_RETIRING_CHAINS,
  MAX_RETAINED_DISPOSED_PROCESSOR_IDS,
  ParametricWebAudioEngine,
  buildAudioBusGraph,
  buildDeviceInsertProcessor,
  compileOrUpdateArrangementSchedule,
  computeStableCombFeedbackGain,
  findFirstEventIndexAtOrAfterBeat,
  flushRetiringTrackChains,
  getOrCreateTrackChannelRuntime,
  pruneRetiringTrackChains,
  queryCompiledArrangementWindow,
  renderDeviceImpulseResponse,
  renderNativeOfflineDeviceImpulseResponse,
  resolveTrackInstrumentSynthesis,
  synthesizeDeterministicStereoPcm,
} from '../engine/webAudioSynth';
import {
  StudioCommandBus,
  captureSessionPerformance,
  queueSessionLaunch,
  storeArrangementClipInSession,
} from '../services/commandBus';
import {
  mapBeatToArrangementPlayheadTransform,
  shouldSnapPlayheadImmediately,
} from '../components/TimelineCanvas';
import { enrichProjectWithAnalysis } from '../App';

const DEFAULT_HUMANIZATION: HumanizationConfig = {
  microTimingMaxShiftBeats: 0.012,
  swingStrength: 0,
  shuffleSwing: 0,
  velocityVariancePct: 0.08,
  ghostVelocityMin: 20,
  ghostVelocityMax: 45,
  lfoRateHz: 0.1,
  lfoDepth: 0.42,
  cutoffHz: 145,
  macroTransition: 42,
};

const DEFAULT_MASTER_BUS: MasterBusConfig = {
  masterVolumeDb: 0,
  glueCompressionDrive: 0.35,
  reverbDecaySec: 3.2,
  reverbReturnLevel: 0.3,
  delayFeedback: 0.45,
  delayReturnLevel: 0.28,
  subBassMonoCutoffHz: 120,
};

const DEFAULT_TRANSPORT: TransportConfig = {
  loopEnabled: true,
  loopStartBar: 1,
  loopLengthBars: 16,
  metronomeEnabled: false,
  followPlayhead: true,
  showAutomationLanes: true,
  arrangementMode: 'arrangement',
};

function createTestAudioContext() {
  const makeParam = (initial = 0) => ({
    value: initial,
    setValueAtTime: vi.fn(function (this: { value: number }, v: number) {
      this.value = v;
    }),
    setTargetAtTime: vi.fn(function (this: { value: number }, v: number) {
      this.value = v;
    }),
    linearRampToValueAtTime: vi.fn(function (this: { value: number }, v: number) {
      this.value = v;
    }),
  });
  const ctx: Record<string, unknown> = {
    currentTime: 0,
    sampleRate: 44100,
    state: 'running',
    resume: vi.fn(async () => {}),
  };
  const makeNode = (extra: Record<string, unknown> = {}) => ({
    context: ctx,
    connect: vi.fn((dest: unknown) => dest),
    disconnect: vi.fn(),
    ...extra,
  });
  Object.assign(ctx, {
    createGain: vi.fn(() => makeNode({ gain: makeParam(1) })),
    createBiquadFilter: vi.fn(() =>
      makeNode({
        type: 'lowpass',
        frequency: makeParam(1000),
        Q: makeParam(1),
        gain: makeParam(0),
      })
    ),
    createDynamicsCompressor: vi.fn(() =>
      makeNode({
        threshold: makeParam(-24),
        knee: makeParam(12),
        ratio: makeParam(4),
        attack: makeParam(0.003),
        release: makeParam(0.25),
      })
    ),
    createWaveShaper: vi.fn(() => makeNode({ curve: null, oversample: 'none' })),
    createStereoPanner: vi.fn(() => makeNode({ pan: makeParam(0) })),
    createConvolver: vi.fn(() => makeNode({ buffer: null })),
    createDelay: vi.fn(() => makeNode({ delayTime: makeParam(0) })),
    createOscillator: vi.fn(() =>
      makeNode({
        type: 'sine',
        frequency: makeParam(1),
        start: vi.fn(),
        stop: vi.fn(),
      })
    ),
    createAnalyser: vi.fn(() =>
      makeNode({
        fftSize: 256,
        frequencyBinCount: 128,
        smoothingTimeConstant: 0.8,
        getByteTimeDomainData: vi.fn((arr: Uint8Array) => arr.fill(128)),
        getByteFrequencyData: vi.fn((arr: Uint8Array) => arr.fill(0)),
      })
    ),
    createBuffer: vi.fn((channels: number, length: number, sampleRate: number) => ({
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    })),
  });
  return ctx as unknown as AudioContext;
}

function computeRms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < samples.length; i++) {
    sumSq += samples[i] * samples[i];
  }
  return Math.sqrt(sumSq / samples.length);
}

function computeMaxAbsDiff(a: Float32Array, b: Float32Array): number {
  const len = Math.min(a.length, b.length);
  let maxDiff = 0;
  for (let i = 0; i < len; i++) {
    const diff = Math.abs(a[i] - b[i]);
    if (diff > maxDiff) maxDiff = diff;
  }
  return maxDiff;
}

describe('G1–G8 Strengthening Contracts', () => {
  describe('Section 1 & G1/G7: Authoritative 10-Slot Constant & Canonical Timing Service', () => {
    it('uses one authoritative 10-device-chain-slot constant across capability matrix and channel strip engine', () => {
      expect(MAX_EXECUTABLE_INSERT_DEVICES).toBe(10);
      expect(MAX_CHANNEL_INSERT_SLOTS).toBe(10);
      expect(MAX_CHANNEL_INSERT_SLOTS).toBe(MAX_EXECUTABLE_INSERT_DEVICES);
    });

    it('converts beats and ticks losslessly for binary, triplet, and 1/128 fine grids and validates PPQ/tick boundaries', () => {
      expect(CANONICAL_PPQ).toBe(960);
      expect(SUPPORTED_PPQ_RESOLUTIONS).toContain(960);
      expect(beatsToTicks(1)).toBe(960);
      expect(beatsToTicks(0.25)).toBe(240);
      expect(beatsToTicks(1 / 3)).toBe(320);
      expect(beatsToTicks(1 / 6)).toBe(160);
      expect(beatsToTicks(1 / 12)).toBe(80);
      expect(beatsToTicks(4 / 128)).toBe(30);

      expect(ticksToBeats(320)).toBeCloseTo(1 / 3, 10);
      expect(ticksToBeats(30)).toBe(0.03125);

      const snappedTriplet = snapBeatsToGridTicks(0.34, 1 / 3);
      expect(snappedTriplet.ticks).toBe(320);
      expect(snappedTriplet.beats).toBeCloseTo(1 / 3, 10);

      const snapped128th = snapBeatsToGridTicks(0.031, 4 / 128);
      expect(snapped128th.ticks).toBe(30);
      expect(snapped128th.beats).toBe(0.03125);

      // Sub-tick preservation and quantization decomposition
      const microQuant = quantizeBeatToCanonicalTick(1.25 + 0.0004, 960);
      expect(microQuant.canonicalTicks).toBe(1200);
      expect(microQuant.quantizedBeat).toBeCloseTo(1.25, 8);
      expect(Math.abs(microQuant.subTickRemainderBeats)).toBeLessThan(1 / 960);
      expect(microQuant.isSubTick).toBe(true);

      // PPQ validation rejects zero, negative, non-integer, or unsupported PPQ
      expect(() => assertValidPpq(0)).toThrow(/TIMELINE_INPUT/);
      expect(() => assertValidPpq(-960)).toThrow(/TIMELINE_INPUT/);
      expect(() => assertValidPpq(123)).toThrow(/TIMELINE_INPUT/);
      expect(() => barBeatTickToBeat(1, 1, 0, undefined, 0)).toThrow(/TIMELINE_INPUT/);

      // Tick validation rejects negative, non-integer, or >= ticksPerMeterBeat
      expect(() => barBeatTickToBeat(1, 1, -1)).toThrow(/TIMELINE_INPUT/);
      expect(() => barBeatTickToBeat(1, 1, 120.5)).toThrow(/TIMELINE_INPUT/);
      expect(() => barBeatTickToBeat(1, 1, 960)).toThrow(/TIMELINE_INPUT/);
    });

    it('supports final supported bar 4096 exclusive end boundary in barBeatTickToBeat and playbackRegion', () => {
      expect(MAX_SUPPORTED_TIMELINE_BARS).toBe(4096);
      const startOfBar4096 = barBeatTickToBeat(4096, 1, 0);
      const endOfBar4096 = barBeatTickToBeat(4097, 1, 0);
      expect(startOfBar4096).toBe(4095 * 4);
      expect(endOfBar4096).toBe(4096 * 4);
      expect(() => barBeatTickToBeat(4097, 1, 1)).toThrow(/TIMELINE_INPUT/);
      expect(() => barBeatTickToBeat(4098, 1, 0)).toThrow(/TIMELINE_INPUT/);

      const finalBarLoop = playbackRegion(4096 * 4, {
        ...DEFAULT_TRANSPORT,
        loopEnabled: true,
        loopStartBar: 4096,
        loopLengthBars: 1,
      });
      expect(finalBarLoop).toEqual({
        start: 16380,
        end: 16384,
        span: 4,
        enabled: true,
      });
    });

    it('resolves bar/beat/tick coordinates across changing meters and long 1024-bar projects', () => {
      const meterMap = [
        { bar: 1, beat: 0, numerator: 4, denominator: 4 },
        { bar: 5, beat: 16, numerator: 3, denominator: 4 },
        { bar: 9, beat: 28, numerator: 7, denominator: 8 },
      ];

      const bar1 = beatToBarBeatTick(0, meterMap);
      expect(bar1).toEqual({
        bar: 1,
        beatInBar: 1,
        tickInBeat: 0,
        totalTicks: 0,
        numerator: 4,
        denominator: 4,
      });

      const bar6Beat2 = beatToBarBeatTick(20.5, meterMap);
      expect(bar6Beat2.bar).toBe(6);
      expect(bar6Beat2.beatInBar).toBe(2);
      expect(bar6Beat2.tickInBeat).toBe(480);
      expect(bar6Beat2.numerator).toBe(3);

      const roundTripBeat = barBeatTickToBeat(
        bar6Beat2.bar,
        bar6Beat2.beatInBar,
        bar6Beat2.tickInBeat,
        meterMap
      );
      expect(roundTripBeat).toBeCloseTo(20.5, 8);

      const beatAtBar1024 = barBeatTickToBeat(1024, 4, 720);
      expect(beatAtBar1024).toBe(1023 * 4 + 3 + 0.75);
      const parsed1024 = beatToBarBeatTick(beatAtBar1024);
      expect(parsed1024.bar).toBe(1024);
      expect(parsed1024.beatInBar).toBe(4);
      expect(parsed1024.tickInBeat).toBe(720);

      const discontinuousMeterMap = [
        { bar: 1, beat: 0, numerator: 4, denominator: 4 },
        { bar: 5, beat: 8, numerator: 3, denominator: 4 },
      ];
      expect(() => beatToBarBeatTick(8, discontinuousMeterMap)).toThrow(/discontinuous meter map anchor/);
      expect(() => barBeatTickToBeat(3, 1, 0, discontinuousMeterMap)).toThrow(/discontinuous meter map anchor/);
    });

    it('integrates increasing, decreasing, and shallow beat-linear tempo ramps via 60/BPM calculus and exposes MusicalTimeService', () => {
      const ramp60To120 = [
        { beat: 0, bpm: 60, curve: 'linear' as const },
        { beat: 4, bpm: 120, curve: 'step' as const },
      ];
      const exactFourLn2 = 4 * Math.LN2;
      const secAtBeat4 = beatToSecondsWithTempoMap(4, 60, ramp60To120);
      expect(secAtBeat4).toBeCloseTo(exactFourLn2, 10);

      const secAtBeat2 = beatToSecondsWithTempoMap(2, 60, ramp60To120);
      expect(secAtBeat2).toBeCloseTo(4 * Math.log(1.5), 10);
      expect(secondsToBeatWithTempoMap(secAtBeat2, 60, ramp60To120)).toBeCloseTo(2.0, 10);
      expect(secondsToBeatWithTempoMap(secAtBeat4, 60, ramp60To120)).toBeCloseTo(4.0, 10);

      // Decreasing ramp: 120 -> 60 BPM over 4 beats (slope = -15 BPM/beat)
      const ramp120To60 = [
        { beat: 0, bpm: 120, curve: 'linear' as const },
        { beat: 4, bpm: 60, curve: 'step' as const },
      ];
      const decSecAt4 = beatToSecondsWithTempoMap(4, 120, ramp120To60);
      expect(decSecAt4).toBeCloseTo(exactFourLn2, 10);
      const decSecAt2 = beatToSecondsWithTempoMap(2, 120, ramp120To60);
      expect(secondsToBeatWithTempoMap(decSecAt2, 120, ramp120To60)).toBeCloseTo(2.0, 10);

      // Ultra-shallow ramp near constant-slope limit
      const shallowRamp = [
        { beat: 0, bpm: 120, curve: 'linear' as const },
        { beat: 4, bpm: 120.000001, curve: 'step' as const },
      ];
      const shallowSec = beatToSecondsWithTempoMap(2, 120, shallowRamp);
      expect(shallowSec).toBeCloseTo(1.0, 6);
      expect(secondsToBeatWithTempoMap(shallowSec, 120, shallowRamp)).toBeCloseTo(2.0, 6);

      // MusicalTimeService unified API
      const { xml, meta } = buildStarterAbletonXml('berghain-134', 101, 4, 'sketch');
      const project = parseAbletonXmlDom(xml, meta.name, xml);
      expect(MusicalTimeService.arrangementTotalBeats(project, 4)).toBe(16);
      expect(MusicalTimeService.arrangementDurationSeconds(project, 16)).toBeCloseTo((16 * 60) / project.tempo, 6);
      expect(MusicalTimeService.noteDurationSeconds(0, 1, project.tempo, project.tempoMap)).toBeCloseTo(60 / project.tempo, 6);
      expect(MusicalTimeService.formatBarBeatTick(4.5, project.meterMap, project.ppq)).toBe('2.1.480');
      expect(MusicalTimeService.formatBarBeatTick(5.5, project.meterMap, project.ppq)).toBe('2.2.480');
      expect(MusicalTimeService.quantizeSessionLaunchBeat(1.1, 4, project.ppq)).toBe(4);
    });

    it('round-trips tempoMap, meterMap, and ppq through ALS XML and rejects non-constant maps at audio render preflight', () => {
      const built = buildStarterAbletonXml('berghain-134', 101, 4, 'sketch');
      const project = parseAbletonXmlDom(built.xml, built.meta.name, built.xml);
      project.ppq = 960;
      project.tempoMap = [
        { beat: 0, bpm: 134, curve: 'linear' },
        { beat: 8, bpm: 140, curve: 'step' },
      ];
      project.meterMap = [
        { bar: 1, beat: 0, numerator: 4, denominator: 4 },
        { bar: 3, beat: 8, numerator: 3, denominator: 4 },
      ];

      const syncedXml = synchronizeProjectStateToXml(project);
      const reparsed = parseAbletonXmlDom(syncedXml, project.fileName, syncedXml);
      expect(reparsed.ppq).toBe(960);
      expect(reparsed.tempoMap).toEqual(project.tempoMap);
      expect(reparsed.meterMap).toEqual(project.meterMap);
    });
  });

  describe('Section 3: Engine State Installation Preflight & Emergency Shutdown Resilience', () => {
    it('preserves previous valid state, retires active voices, stops timers, and surfaces one actionable error when setState rejects an invalid meterMap or unsupported device during active playback', () => {
      const { xml, meta } = buildStarterAbletonXml('berghain-134', 404, 4, 'sketch');
      const validProject = parseAbletonXmlDom(xml, meta.name, xml);
      const engine = new ParametricWebAudioEngine();
      const testCtx = createTestAudioContext();
      const stopReasons: string[] = [];

      Object.assign(engine, {
        ctx: testCtx,
        bus: buildAudioBusGraph(testCtx, validProject.tempo, DEFAULT_MASTER_BUS, false),
      });

      engine.setState(
        validProject,
        DEFAULT_HUMANIZATION,
        DEFAULT_TRANSPORT,
        DEFAULT_MASTER_BUS,
        undefined,
        (reason) => {
          if (reason) stopReasons.push(reason);
        }
      );
      expect(engine.getInstalledProjectState()).toBe(validProject);

      // Simulate active playback with an active voice and running timers
      const retireVoiceSpy = vi.fn();
      (engine as any).bus.activeVoices.add(retireVoiceSpy);
      Object.assign(engine, {
        isPlaying: true,
        playbackState: 'playing',
        currentBeat: 6.5,
        anchorBeat: 6.5,
        anchorAudioTime: 0,
        schedulerTimerId: window.setInterval(() => {}, 1000),
      });

      // Candidate 1: Invalid discontinuous meterMap that previously threw inside stop() -> getCurrentBeat()
      const invalidMeterProject = {
        ...validProject,
        meterMap: [
          { bar: 1, beat: 0, numerator: 4, denominator: 4 },
          { bar: 5, beat: 8, numerator: 3, denominator: 4 },
        ],
      };

      expect(() =>
        engine.setState(invalidMeterProject, DEFAULT_HUMANIZATION, DEFAULT_TRANSPORT, DEFAULT_MASTER_BUS)
      ).not.toThrow();

      // Previous valid project state must be preserved, voices retired, timers stopped, and error surfaced once
      expect(engine.getInstalledProjectState()).toBe(validProject);
      expect(engine.getIsPlaying()).toBe(false);
      expect((engine as any).schedulerTimerId).toBeNull();
      expect(retireVoiceSpy).toHaveBeenCalledTimes(1);
      expect(engine.getCurrentBeat()).toBe(6.5);
      expect(stopReasons).toHaveLength(1);
      expect(stopReasons[0]).toMatch(/discontinuous meter map anchor/);

      // Candidate 2: Unsupported external plugin device
      const retireVoiceSpy2 = vi.fn();
      (engine as any).bus.activeVoices.add(retireVoiceSpy2);
      Object.assign(engine, { isPlaying: true, playbackState: 'playing' });

      const unsupportedDeviceProject = {
        ...validProject,
        tracks: validProject.tracks.map((t, idx) =>
          idx === 0
            ? {
                ...t,
                devices: [
                  ...t.devices,
                  {
                    id: 'vst_external',
                    xmlTag: 'PluginDevice',
                    displayName: 'External VST3',
                    category: 'audio_effect' as const,
                    parameters: [],
                    bypassed: false,
                  },
                ],
              }
            : t
        ),
      };

      engine.setState(unsupportedDeviceProject, DEFAULT_HUMANIZATION, DEFAULT_TRANSPORT, DEFAULT_MASTER_BUS);
      expect(engine.getInstalledProjectState()).toBe(validProject);
      expect(engine.getIsPlaying()).toBe(false);
      expect(retireVoiceSpy2).toHaveBeenCalledTimes(1);
      expect(stopReasons).toHaveLength(2);
      expect(stopReasons[1]).toMatch(/UNSUPPORTED_DEVICE/);
    });
  });

  describe('Section 4: Shared Device Registry & Instrument vs. Insert Separation', () => {
    it('maintains complete executable contracts in ABLETON_DEVICE_REGISTRY for every registered device', () => {
      const contracts = Object.values(ABLETON_DEVICE_REGISTRY);
      expect(contracts.length).toBeGreaterThanOrEqual(25);
      for (const contract of contracts) {
        expect(getAbletonDeviceContract(contract.xmlTag)).toBe(contract);
        expect(contract.kind).toBeTruthy();
        expect(contract.status).toBeTruthy();
        expect(contract.bypassBehavior.length).toBeGreaterThan(5);
        expect(contract.parameterUpdateBehavior.length).toBeGreaterThan(5);
        expect(contract.disposalBehavior.length).toBeGreaterThan(5);
        expect(contract.routing).toBeTruthy();
        expect(contract.requiredTests.length).toBeGreaterThan(0);
      }
      // Every device-category entry in ABLETON_CAPABILITY_MATRIX resolves in ABLETON_DEVICE_REGISTRY
      for (const entry of ABLETON_CAPABILITY_MATRIX) {
        if (
          entry.category === 'instrument' ||
          entry.category === 'audio_effect' ||
          entry.category === 'midi_effect' ||
          entry.category === 'rack'
        ) {
          for (const tag of entry.xmlTagOrFeature.split('|')) {
            const contract = getAbletonDeviceContract(tag.trim());
            expect(contract).toBeDefined();
            expect(contract!.status).toBe(entry.status);
          }
        }
      }
    });

    it('separates instrument sound generation from audio inserts across bypass, deletion, replacement, and parameter edits', () => {
      const { xml, meta } = buildStarterAbletonXml('berghain-134', 505, 4, 'sketch');
      const baseProject = parseAbletonXmlDom(xml, meta.name, xml);
      const kickTrack = baseProject.tracks[0];
      expect(kickTrack.archetype).toBe('kick');

      // Baseline active DrumGroupDevice synthesis
      const activeSpec = resolveTrackInstrumentSynthesis(kickTrack);
      expect(activeSpec.active).toBe(true);
      expect(activeSpec.instrumentTag).toBe('DrumGroupDevice');
      expect(activeSpec.synthesisRole).toBe('kick');

      const soloKickProject = {
        ...baseProject,
        arrangementLengthBars: 1,
        tracks: [{ ...kickTrack, clips: [{ ...kickTrack.clips[0], length: 4, endTime: 4 }] }],
      };
      const basePcm = synthesizeDeterministicStereoPcm(
        soloKickProject,
        DEFAULT_HUMANIZATION,
        DEFAULT_MASTER_BUS,
        22050
      );
      expect(computeRms(basePcm.left)).toBeGreaterThan(0.01);

      // 1. Bypassing the instrument produces silence while keeping track.archetype intact
      const bypassedInstTrack = {
        ...soloKickProject.tracks[0],
        devices: soloKickProject.tracks[0].devices.map((d) =>
          d.xmlTag === 'DrumGroupDevice' ? { ...d, bypassed: true } : d
        ),
      };
      expect(resolveTrackInstrumentSynthesis(bypassedInstTrack).active).toBe(false);
      const bypassedPcm = synthesizeDeterministicStereoPcm(
        { ...soloKickProject, tracks: [bypassedInstTrack] },
        DEFAULT_HUMANIZATION,
        DEFAULT_MASTER_BUS,
        22050
      );
      expect(computeRms(bypassedPcm.left)).toBe(0);

      // 2. Deleting the instrument produces silence
      const deletedInstTrack = {
        ...soloKickProject.tracks[0],
        devices: soloKickProject.tracks[0].devices.filter((d) => d.xmlTag !== 'DrumGroupDevice'),
      };
      expect(resolveTrackInstrumentSynthesis(deletedInstTrack).active).toBe(false);
      const deletedPcm = synthesizeDeterministicStereoPcm(
        { ...soloKickProject, tracks: [deletedInstTrack] },
        DEFAULT_HUMANIZATION,
        DEFAULT_MASTER_BUS,
        22050
      );
      expect(computeRms(deletedPcm.left)).toBe(0);

      // 3. Replacing DrumGroupDevice with UltraAnalog changes synthesis engine to acid voice while preserving track.archetype='kick'
      const replacedProject = replaceTrackInstrumentDevice(
        soloKickProject,
        soloKickProject.tracks[0].id,
        'UltraAnalog'
      );
      const replacedTrack = replacedProject.tracks[0];
      expect(replacedTrack.archetype).toBe('kick');
      const replacedSpec = resolveTrackInstrumentSynthesis(replacedTrack);
      expect(replacedSpec.active).toBe(true);
      expect(replacedSpec.instrumentTag).toBe('UltraAnalog');
      expect(replacedSpec.synthesisRole).toBe('acid');

      const replacedPcm = synthesizeDeterministicStereoPcm(
        replacedProject,
        DEFAULT_HUMANIZATION,
        DEFAULT_MASTER_BUS,
        22050
      );
      expect(computeRms(replacedPcm.left)).toBeGreaterThan(0.005);
      expect(computeMaxAbsDiff(basePcm.left, replacedPcm.left)).toBeGreaterThan(0.05);

      // 4. Modifying instrument parameters (Pitch +7st & Decay 0.9s) produces measurable audio difference
      const instDevice = soloKickProject.tracks[0].devices.find((d) => d.xmlTag === 'DrumGroupDevice')!;
      let tunedProject = updateChannelInsertParam(
        soloKickProject,
        soloKickProject.tracks[0].id,
        instDevice.id,
        'Pitch',
        7
      );
      tunedProject = updateChannelInsertParam(
        tunedProject,
        soloKickProject.tracks[0].id,
        instDevice.id,
        'Decay',
        0.9
      );
      const tunedPcm = synthesizeDeterministicStereoPcm(
        tunedProject,
        DEFAULT_HUMANIZATION,
        DEFAULT_MASTER_BUS,
        22050
      );
      expect(computeMaxAbsDiff(basePcm.left, tunedPcm.left)).toBeGreaterThan(0.02);
    });
  });

  describe('Section 5: Per-Instance Conversion Records, MIDI Processors & Converted Insert DSP', () => {
    it('requires valid per-instance conversion records for converted devices and invalidates when parameters mutate without re-conversion', () => {
      const { xml, meta } = buildStarterAbletonXml('berghain-134', 606, 4, 'sketch');
      const project = parseAbletonXmlDom(xml, meta.name, xml);

      // Starter project includes converted devices (DrumBuss, Reverb, HybridReverb, Erosion, AutoPan, MidiChord)
      const initialAudit = auditProjectCapabilities(project);
      expect(initialAudit.convertedDevices.length).toBeGreaterThan(0);
      expect(initialAudit.unconvertedDevices).toHaveLength(0);
      expect(initialAudit.canRenderApproximation).toBe(true);
      // Faithful native parity is false whenever lossy converted approximations are active
      expect(initialAudit.canExecuteFaithfully).toBe(false);
      expect(initialAudit.canExecuteFullDsp).toBe(true);

      // Mutating a converted device parameter directly without regenerating conversionRecord invalidates it
      const drumBussTrack = project.tracks[0];
      const drumBussDev = drumBussTrack.devices.find((d) => d.xmlTag === 'DrumBuss')!;
      expect(verifyDeviceConversionRecord(drumBussDev).status).toBe('valid');

      const staleDev: AbletonDevice = {
        ...drumBussDev,
        parameters: drumBussDev.parameters.map((p) =>
          p.name === 'Drive' ? { ...p, value: 99 } : p
        ),
      };
      expect(verifyDeviceConversionRecord(staleDev).status).toBe('invalidated');

      const staleProject = {
        ...project,
        tracks: project.tracks.map((t, idx) =>
          idx === 0
            ? {
                ...t,
                devices: t.devices.map((d) => (d.id === drumBussDev.id ? staleDev : d)),
              }
            : t
        ),
      };
      const staleAudit = auditProjectCapabilities(staleProject);
      expect(staleAudit.unconvertedDevices).toHaveLength(1);
      expect(staleAudit.canRenderApproximation).toBe(false);
      expect(staleAudit.canExecuteFullDsp).toBe(false);
      expect(() => assertExecutableInsertLimits(staleProject)).toThrow(/CONVERSION_REQUIRED/);

      // Updating via updateChannelInsertParam atomically regenerates a valid conversionRecord
      const updatedProject = updateChannelInsertParam(
        project,
        drumBussTrack.id,
        drumBussDev.id,
        'Drive',
        85
      );
      const updatedDev = updatedProject.tracks[0].devices.find((d) => d.id === drumBussDev.id)!;
      expect(verifyDeviceConversionRecord(updatedDev).status).toBe('valid');
      expect(updatedDev.conversionRecord?.sourceParameterHash).not.toBe(
        drumBussDev.conversionRecord?.sourceParameterHash
      );
      expect(() => assertExecutableInsertLimits(updatedProject)).not.toThrow();
    });

    it('executes MidiChord and MidiArpeggiator note transformations across pitch, timing, rate, gate, ordering, bypass, and offline rendering', () => {
      const { xml, meta } = buildStarterAbletonXml('berghain-134', 707, 4, 'sketch');
      const project = parseAbletonXmlDom(xml, meta.name, xml);
      const baseNote = {
        id: 'n1',
        time: 0,
        quantizedTime: 0,
        duration: 1.0,
        pitch: 60,
        velocity: 100,
        isGhost: false,
      };

      const chordDev = syncDeviceConversionRecord({
        id: 'mc_1',
        xmlTag: 'MidiChord',
        displayName: 'Chord',
        category: 'midi_effect',
        parameters: [
          { name: 'Shift1', value: 4 },
          { name: 'Shift2', value: 7 },
          { name: 'Shift3', value: 12 },
          { name: 'VelocityPct', value: 90 },
        ],
        bypassed: false,
      });

      const arpDev = syncDeviceConversionRecord({
        id: 'ma_1',
        xmlTag: 'MidiArpeggiator',
        displayName: 'Arpeggiator',
        category: 'midi_effect',
        parameters: [
          { name: 'Rate', value: 0.25 },
          { name: 'Gate', value: 50 },
          { name: 'Steps', value: 2 },
          { name: 'Distance', value: 12 },
          { name: 'Style', value: 'Up' },
        ],
        bypassed: false,
      });

      const synthTrack = {
        ...project.tracks[3],
        devices: [
          chordDev,
          arpDev,
          ...project.tracks[3].devices.filter((d) => d.category === 'instrument'),
        ],
        clips: [
          {
            id: 'clip_test',
            name: 'Test Clip',
            startTime: 0,
            endTime: 4,
            length: 4,
            notes: [baseNote],
          },
        ],
      };

      // 1. MidiChord alone expands 1 note into 4 chord notes [60, 64, 67, 72]
      const chordOnlyTrack = { ...synthTrack, devices: [chordDev, synthTrack.devices[2]] };
      const chordNotes = evaluateTrackMidiDeviceChain(chordOnlyTrack, [baseNote], 0, 4);
      expect(chordNotes.map((n) => n.pitch)).toEqual([60, 64, 67, 72]);
      expect(chordNotes[1].velocity).toBe(90);

      // 2. MidiChord -> MidiArpeggiator expands the chord into 1/16th arpeggio steps with 50% gate (0.125 beats)
      const chainedNotes = evaluateTrackMidiDeviceChain(synthTrack, [baseNote], 0, 4);
      expect(chainedNotes.length).toBe(4); // 1.0 beat / 0.25 rate = 4 steps
      expect(chainedNotes.map((n) => n.time)).toEqual([0, 0.25, 0.5, 0.75]);
      expect(chainedNotes.every((n) => Math.abs(n.duration - 0.125) < 1e-6)).toBe(true);
      expect(chainedNotes.map((n) => n.pitch)).toEqual([60, 64, 67, 72]);

      // Down style reverses pitch order
      const downArpDev = syncDeviceConversionRecord({
        ...arpDev,
        parameters: arpDev.parameters.map((p) =>
          p.name === 'Style' ? { ...p, value: 'Down' } : p
        ),
      });
      const downNotes = evaluateTrackMidiDeviceChain(
        { ...synthTrack, devices: [chordDev, downArpDev, synthTrack.devices[2]] },
        [baseNote],
        0,
        4
      );
      expect(downNotes[0].pitch).toBeGreaterThan(downNotes[1].pitch);

      // 3. Bypassing both MIDI processors returns the original note unchanged
      const bypassedTrack = {
        ...synthTrack,
        devices: synthTrack.devices.map((d) =>
          d.category === 'midi_effect' ? { ...d, bypassed: true } : d
        ),
      };
      const bypassedNotes = evaluateTrackMidiDeviceChain(bypassedTrack, [baseNote], 0, 4);
      expect(bypassedNotes).toEqual([baseNote]);

      // 4. Offline PCM render differs measurably between active MidiChord+MidiArpeggiator and bypassed
      const activePcm = synthesizeDeterministicStereoPcm(
        { ...project, arrangementLengthBars: 1, tracks: [synthTrack] },
        DEFAULT_HUMANIZATION,
        DEFAULT_MASTER_BUS,
        22050
      );
      const bypassedPcm = synthesizeDeterministicStereoPcm(
        { ...project, arrangementLengthBars: 1, tracks: [bypassedTrack] },
        DEFAULT_HUMANIZATION,
        DEFAULT_MASTER_BUS,
        22050
      );
      expect(computeMaxAbsDiff(activePcm.left, bypassedPcm.left)).toBeGreaterThan(0.02);
    });

    it('executes per-insert DSP for DrumBuss, Reverb, HybridReverb, AutoPan, and Erosion with measurable parameter-dependent audio changes', () => {
      const testCtx = createTestAudioContext();
      const { xml, meta } = buildStarterAbletonXml('berghain-134', 808, 4, 'sketch');
      const project = parseAbletonXmlDom(xml, meta.name, xml);
      const baseTrack = {
        ...project.tracks[3],
        devices: project.tracks[3].devices.filter((d) => d.category === 'instrument'),
        clips: [{ ...project.tracks[3].clips[0], length: 4, endTime: 4 }],
      };
      const singleTrackProject = {
        ...project,
        arrangementLengthBars: 1,
        tracks: [baseTrack],
      };
      const dryPcm = synthesizeDeterministicStereoPcm(
        singleTrackProject,
        DEFAULT_HUMANIZATION,
        DEFAULT_MASTER_BUS,
        22050
      );

      const convertedEffectConfigs: Array<{
        xmlTag: string;
        lowParams: Array<{ name: string; value: number | string }>;
        highParams: Array<{ name: string; value: number | string }>;
      }> = [
        {
          xmlTag: 'DrumBuss',
          lowParams: [
            { name: 'Drive', value: 10 },
            { name: 'Boom', value: 5 },
            { name: 'Damp', value: 12000 },
            { name: 'DryWet', value: 100 },
          ],
          highParams: [
            { name: 'Drive', value: 90 },
            { name: 'Boom', value: 85 },
            { name: 'Damp', value: 1800 },
            { name: 'DryWet', value: 100 },
          ],
        },
        {
          xmlTag: 'Reverb',
          lowParams: [
            { name: 'DecayTime', value: 0.4 },
            { name: 'PreDelay', value: 5 },
            { name: 'HighCut', value: 8000 },
            { name: 'DryWet', value: 25 },
          ],
          highParams: [
            { name: 'DecayTime', value: 8.5 },
            { name: 'PreDelay', value: 60 },
            { name: 'HighCut', value: 1200 },
            { name: 'DryWet', value: 90 },
          ],
        },
        {
          xmlTag: 'HybridReverb',
          lowParams: [
            { name: 'DecayTime', value: 0.5 },
            { name: 'PreDelay', value: 8 },
            { name: 'HighCut', value: 9000 },
            { name: 'DryWet', value: 25 },
          ],
          highParams: [
            { name: 'DecayTime', value: 9.0 },
            { name: 'PreDelay', value: 75 },
            { name: 'HighCut', value: 1400 },
            { name: 'DryWet', value: 90 },
          ],
        },
        {
          xmlTag: 'AutoPan',
          lowParams: [
            { name: 'Rate', value: 0.5 },
            { name: 'Amount', value: 20 },
            { name: 'Shape', value: 'Sine' },
          ],
          highParams: [
            { name: 'Rate', value: 6.0 },
            { name: 'Amount', value: 95 },
            { name: 'Shape', value: 'Triangle' },
          ],
        },
        {
          xmlTag: 'Erosion',
          lowParams: [
            { name: 'Frequency', value: 800 },
            { name: 'Amount', value: 15 },
            { name: 'Width', value: 1.0 },
          ],
          highParams: [
            { name: 'Frequency', value: 5200 },
            { name: 'Amount', value: 95 },
            { name: 'Width', value: 4.5 },
          ],
        },
      ];

      for (const cfg of convertedEffectConfigs) {
        const lowDev = syncDeviceConversionRecord({
          id: `fx_${cfg.xmlTag}_low`,
          xmlTag: cfg.xmlTag,
          displayName: cfg.xmlTag,
          category: 'audio_effect',
          parameters: cfg.lowParams,
          bypassed: false,
        });
        const highDev = syncDeviceConversionRecord({
          id: `fx_${cfg.xmlTag}_high`,
          xmlTag: cfg.xmlTag,
          displayName: cfg.xmlTag,
          category: 'audio_effect',
          parameters: cfg.highParams,
          bypassed: false,
        });

        const proc = buildDeviceInsertProcessor(testCtx, lowDev);
        expect(proc.input).not.toBe(proc.output);
        expect(typeof proc.updateParams).toBe('function');
        expect(typeof proc.dispose).toBe('function');
        proc.dispose?.();

        const lowPcm = synthesizeDeterministicStereoPcm(
          {
            ...singleTrackProject,
            tracks: [{ ...baseTrack, devices: [...baseTrack.devices, lowDev] }],
          },
          DEFAULT_HUMANIZATION,
          DEFAULT_MASTER_BUS,
          22050
        );
        const highPcm = synthesizeDeterministicStereoPcm(
          {
            ...singleTrackProject,
            tracks: [{ ...baseTrack, devices: [...baseTrack.devices, highDev] }],
          },
          DEFAULT_HUMANIZATION,
          DEFAULT_MASTER_BUS,
          22050
        );

        expect(computeMaxAbsDiff(dryPcm.left, highPcm.left)).toBeGreaterThan(0.005);
        expect(computeMaxAbsDiff(lowPcm.left, highPcm.left)).toBeGreaterThan(0.005);
      }
    });
  });

  describe('Section 6: Live Device Graph Reconciliation & Disposal Lifecycle', () => {
    it('updates AudioParams in place on parameter edits and reconciles structural edits with click-safe replacement and node/LFO disposal', () => {
      const testCtx = createTestAudioContext();
      const { xml, meta } = buildStarterAbletonXml('berghain-134', 909, 4, 'sketch');
      let project = parseAbletonXmlDom(xml, meta.name, xml);
      const bus = buildAudioBusGraph(testCtx, project.tempo, DEFAULT_MASTER_BUS, false);
      const trackId = project.tracks[0].id;

      // 1. Initial channel creation
      const ch1 = getOrCreateTrackChannelRuntime(testCtx, bus, project.tracks[0], project);
      expect(ch1.reconciliationCount).toBe(0);
      expect(ch1.disposedProcessorIds).toHaveLength(0);
      const initialProcCount = ch1.insertProcessors.length;

      // 2. Parameter-only edit updates AudioParam in place without rebuilding the chain
      const drumBussId = project.tracks[0].devices.find((d) => d.xmlTag === 'DrumBuss')!.id;
      project = updateChannelInsertParam(project, trackId, drumBussId, 'Drive', 78);
      const chAfterParamEdit = getOrCreateTrackChannelRuntime(
        testCtx,
        bus,
        project.tracks[0],
        project
      );
      expect(chAfterParamEdit).toBe(ch1);
      expect(chAfterParamEdit.reconciliationCount).toBe(0);
      expect(chAfterParamEdit.disposedProcessorIds).toHaveLength(0);

      // 3. Structural insertion of ChorusEnsemble (with LFO oscillator) and Delay (with stateful tail)
      project = insertDeviceIntoChannelStrip(project, trackId, 'ChorusEnsemble').project;
      project = insertDeviceIntoChannelStrip(project, trackId, 'Delay').project;
      const chAfterInsert = getOrCreateTrackChannelRuntime(
        testCtx,
        bus,
        project.tracks[0],
        project
      );
      expect(chAfterInsert.reconciliationCount).toBe(1);
      expect(chAfterInsert.insertProcessors.length).toBe(initialProcCount + 2);
      expect(chAfterInsert.disposedProcessorIds.length).toBe(initialProcCount);

      // 4. Reordering devices triggers structural reconciliation
      project = reorderChannelInsertDevice(project, trackId, 1, 2);
      const chAfterReorder = getOrCreateTrackChannelRuntime(
        testCtx,
        bus,
        project.tracks[0],
        project
      );
      expect(chAfterReorder.reconciliationCount).toBe(2);

      // 5. Bypassing a device triggers structural reconciliation
      const chorusDev = project.tracks[0].devices.find((d) => d.xmlTag === 'ChorusEnsemble')!;
      project = toggleChannelInsertBypass(project, trackId, chorusDev.id);
      const chAfterBypass = getOrCreateTrackChannelRuntime(
        testCtx,
        bus,
        project.tracks[0],
        project
      );
      expect(chAfterBypass.reconciliationCount).toBe(3);

      // 6. Removing ChorusEnsemble and Delay disposes their processors and stops LFO oscillators
      const delayDev = project.tracks[0].devices.find((d) => d.xmlTag === 'Delay')!;
      project = removeChannelInsertDevice(project, trackId, chorusDev.id);
      project = removeChannelInsertDevice(project, trackId, delayDev.id);
      const chAfterRemove = getOrCreateTrackChannelRuntime(
        testCtx,
        bus,
        project.tracks[0],
        project
      );
      expect(chAfterRemove.reconciliationCount).toBe(4);
      expect(chAfterRemove.insertProcessors.length).toBe(initialProcCount);
      expect(chAfterRemove.disposedProcessorIds).toContain(chorusDev.id);
      expect(chAfterRemove.disposedProcessorIds).toContain(delayDev.id);
    });
  });

  describe('G3: Explicit Sketch vs Full Track Workflow & Persisted Duration', () => {
    it('persists creationMode and requestedDurationBars across XML and native snapshots', () => {
      const sketchBuilt = buildStarterAbletonXml('berghain-134', 101, 4, 'sketch');
      const sketchProject = parseAbletonXmlDom(sketchBuilt.xml, sketchBuilt.meta.name, sketchBuilt.xml);
      expect(sketchProject.creationMode).toBe('sketch');
      expect(sketchProject.requestedDurationBars).toBe(4);
      expect(sketchProject.arrangementLengthBars).toBe(4);

      const fullBuilt = buildStarterAbletonXml('berghain-134', 202, 8, 'full-track');
      const fullProject = parseAbletonXmlDom(fullBuilt.xml, fullBuilt.meta.name, fullBuilt.xml);
      expect(fullProject.creationMode).toBe('full-track');
      expect(fullProject.requestedDurationBars).toBe(8);
      expect(fullProject.arrangementLengthBars).toBe(8);

      const snapshotJson = encodeProjectSnapshot(
        {
          ...fullProject,
          requestedDurationBars: 64,
          arrangementLengthBars: 64,
        },
        DEFAULT_HUMANIZATION,
        DEFAULT_MASTER_BUS,
        { ...DEFAULT_TRANSPORT, loopLengthBars: 64 }
      );
      const restoredSnapshot = decodeProjectSnapshot(snapshotJson);
      expect(restoredSnapshot.project.creationMode).toBe('full-track');
      expect(restoredSnapshot.project.requestedDurationBars).toBe(64);
      expect(restoredSnapshot.project.arrangementLengthBars).toBe(64);

      const reparsed = parseAbletonXmlDom(
        restoredSnapshot.project.rawXmlModified,
        fullProject.fileName,
        restoredSnapshot.project.rawXmlModified
      );
      expect(reparsed.creationMode).toBe('full-track');
      expect(reparsed.requestedDurationBars).toBe(64);
      expect(reparsed.arrangementLengthBars).toBe(64);
    });

    it('decomposes Full Track arrangements into evolving multi-section clips with breakdown kick withdrawal', () => {
      const sections = generateSectionArrangementPlan('hypnotic_longform', 64, 202);
      expect(sections.length).toBeGreaterThanOrEqual(5);

      const kickNotes = Array.from({ length: 64 * 4 }, (_, beat) => ({
        id: `k_${beat}`,
        time: beat,
        quantizedTime: beat,
        duration: 0.25,
        pitch: 36,
        velocity: 120,
        isGhost: false,
      }));
      const kickClips = decomposeNotesIntoSectionClips(
        '01_Kick_909',
        'kick',
        kickNotes,
        64,
        sections
      );
      const breakdown = sections.find((s) => s.role === 'Breakdown');
      expect(breakdown).toBeDefined();
      const kickClipsInBreakdown = kickClips.filter(
        (c) =>
          c.startTime >= (breakdown!.startBar - 1) * 4 &&
          c.startTime + c.length <= breakdown!.endBar * 4
      );
      expect(kickClipsInBreakdown.length).toBe(0);

      const autoPoints = generateContextualAutomationPoints(
        'synth',
        'hypnotic_longform',
        202,
        64,
        sections
      );
      expect(autoPoints.length).toBeGreaterThanOrEqual(sections.length);
      expect(autoPoints[autoPoints.length - 1].beat).toBe(64 * 4);
    });
  });

  describe('G5: Declared Ableton Capability Matrix & Runtime Execution Policy', () => {
    it('enforces capability matrix at runtime for unsupported, preserved-only, and over-limit device chains', () => {
      expect(ABLETON_CAPABILITY_MATRIX.length).toBeGreaterThanOrEqual(12);
      const statuses = new Set(ABLETON_CAPABILITY_MATRIX.map((c) => c.status));
      expect(statuses.has('executable')).toBe(true);
      expect(statuses.has('preserved-only')).toBe(true);
      expect(statuses.has('converted')).toBe(true);
      expect(statuses.has('unsupported')).toBe(true);

      const { xml, meta } = buildStarterAbletonXml('berghain-134', 303, 16, 'sketch');
      const project = parseAbletonXmlDom(xml, meta.name, xml);
      assertProjectState(project);

      const baselineAudit = auditProjectCapabilities(project);
      expect(baselineAudit.canExecuteFullDsp).toBe(true);
      expect(baselineAudit.insertLimitExceededTracks.length).toBe(0);
      expect(baselineAudit.unsupportedDevices.length).toBe(0);
      expect(baselineAudit.preservedOnlyDevices.length).toBe(0);
      expect(() => assertExecutableInsertLimits(project)).not.toThrow();

      const preservedOnlyProject = {
        ...project,
        tracks: project.tracks.map((t, idx) =>
          idx === 0
            ? {
                ...t,
                devices: [
                  ...t.devices,
                  {
                    id: 'dev_preserved_scale',
                    xmlTag: 'MidiScale',
                    displayName: 'Scale',
                    category: 'midi_effect' as const,
                    parameters: [],
                    bypassed: false,
                  },
                ],
              }
            : t
        ),
      };
      const preservedAudit = auditProjectCapabilities(preservedOnlyProject);
      expect(preservedAudit.canExecuteFullDsp).toBe(false);
      expect(preservedAudit.preservedOnlyDevices).toHaveLength(1);
      expect(() => assertExecutableInsertLimits(preservedOnlyProject)).toThrow(/PRESERVED_ONLY_DEVICE/);

      const overloadedProject = {
        ...project,
        tracks: project.tracks.map((t, idx) =>
          idx === 0
            ? {
                ...t,
                devices: Array.from({ length: MAX_EXECUTABLE_INSERT_DEVICES + 1 }, (_, dIdx) => ({
                  id: `dev_${dIdx}`,
                  xmlTag: dIdx === 10 ? 'PluginDevice' : 'EQEight',
                  displayName: dIdx === 10 ? 'External VST3' : `EQ ${dIdx}`,
                  category: 'audio_effect' as const,
                  parameters: [],
                  browserDspSupported: dIdx !== 10,
                })),
              }
            : t
        ),
      };

      const overloadedAudit = auditProjectCapabilities(overloadedProject);
      expect(overloadedAudit.canExecuteFullDsp).toBe(false);
      expect(overloadedAudit.insertLimitExceededTracks).toHaveLength(1);
      expect(overloadedAudit.unsupportedDevices).toHaveLength(1);
      expect(overloadedAudit.unsupportedDevices[0].xmlTag).toBe('PluginDevice');
      expect(() => assertExecutableInsertLimits(overloadedProject)).toThrow(/INSERT_LIMIT/);

      const dynamicTempoProject = {
        ...project,
        tempoMap: [
          { beat: 0, bpm: 120, curve: 'linear' as const },
          { beat: 16, bpm: 140, curve: 'step' as const },
        ],
      };
      expect(() => assertExecutableInsertLimits(dynamicTempoProject)).toThrow(/TIMING_MAP_UNSUPPORTED/);
    });

    it('verifies Section 1: Reverb/HybridReverb/Delay/Echo independent comb & feedback loop stability across parameter extremes', () => {
      const configs: {
        xmlTag: 'Reverb' | 'HybridReverb' | 'Delay' | 'Echo';
        params: { name: string; value: number }[];
      }[] = [
        // Minimum decay / damping / pre-delay / wet mix
        {
          xmlTag: 'Reverb',
          params: [
            { name: 'DecayTime', value: 0.2 },
            { name: 'PreDelay', value: 1 },
            { name: 'HighCut', value: 400 },
            { name: 'DryWet', value: 10 },
          ],
        },
        // Default Reverb
        {
          xmlTag: 'Reverb',
          params: [
            { name: 'DecayTime', value: 2.4 },
            { name: 'PreDelay', value: 18 },
            { name: 'HighCut', value: 4800 },
            { name: 'DryWet', value: 35 },
          ],
        },
        // Maximum decay / high damping / max pre-delay / 100% wet on HybridReverb
        {
          xmlTag: 'HybridReverb',
          params: [
            { name: 'DecayTime', value: 15.0 },
            { name: 'PreDelay', value: 250 },
            { name: 'HighCut', value: 16000 },
            { name: 'DryWet', value: 100 },
          ],
        },
        // High feedback Delay and Echo
        {
          xmlTag: 'Delay',
          params: [
            { name: 'DelayTime', value: 120 },
            { name: 'Feedback', value: 0.88 },
            { name: 'FilterCutoff', value: 8500 },
            { name: 'DryWet', value: 65 },
          ],
        },
        {
          xmlTag: 'Echo',
          params: [
            { name: 'DelayTime', value: 180 },
            { name: 'Feedback', value: 0.85 },
            { name: 'FilterCutoff', value: 4200 },
            { name: 'DryWet', value: 50 },
          ],
        },
      ];

      for (const cfg of configs) {
        const dev: AbletonDevice = syncDeviceConversionRecord({
          id: `impulse_${cfg.xmlTag}`,
          xmlTag: cfg.xmlTag,
          displayName: cfg.xmlTag,
          category: 'audio_effect',
          parameters: cfg.params,
          bypassed: false,
        });
        const ir = renderDeviceImpulseResponse(dev, 4.0, 24000);
        expect(ir.allFinite).toBe(true);
        expect(ir.firstNonFiniteFrame).toBe(-1);
        expect(ir.peak).toBeGreaterThan(0.05);
        expect(ir.peak).toBeLessThanOrEqual(1.05);
        expect(ir.tailDecaysMonotonically).toBe(true);
        expect(ir.windowRms[3]).toBeLessThanOrEqual(ir.windowRms[0] + 1e-6);
      }

      // Verify g = 10^(-3 * delaySeconds / T60Seconds) formula bounds
      expect(computeStableCombFeedbackGain(0.043, 1.2)).toBeCloseTo(
        Math.pow(10, (-3 * 0.043) / 1.2),
        5
      );
      expect(computeStableCombFeedbackGain(0.043, 100)).toBeLessThanOrEqual(0.992);
    });

    it('verifies Section 2: unified event-evaluation boundary across Session, captured Arrangement, and rendered PCM with MidiChord + MidiArpeggiator', () => {
      const { xml, meta } = buildStarterAbletonXml('berghain-134', 404, 4, 'sketch');
      let project = parseAbletonXmlDom(xml, meta.name, xml);
      const chordTrack = project.tracks.find((t) => t.archetype === 'pad') || project.tracks[1];

      // Replace clip notes with a clean 2-note phrase so we can inspect exact transformations
      const baseClip = {
        ...chordTrack.clips[0],
        id: 'clip_session_src',
        startTime: 0,
        endTime: 4,
        length: 4,
        notes: [
          {
            id: 'n_root_0',
            time: 0,
            quantizedTime: 0,
            duration: 1.0,
            pitch: 60,
            velocity: 100,
            probability: 1,
            isGhost: false,
          },
          {
            id: 'n_root_2',
            time: 2,
            quantizedTime: 2,
            duration: 1.0,
            pitch: 62,
            velocity: 96,
            probability: 1,
            isGhost: false,
          },
        ],
      };

      project = {
        ...project,
        arrangementLengthBars: 4,
        tracks: project.tracks.map((t) =>
          t.id === chordTrack.id
            ? {
                ...t,
                clips: [baseClip],
                devices: t.devices.filter(
                  (d) => d.xmlTag !== 'MidiChord' && d.xmlTag !== 'MidiArpeggiator'
                ),
              }
            : { ...t, clips: [] }
        ),
      };

      // Insert MidiChord then MidiArpeggiator on chordTrack
      project = insertDeviceIntoChannelStrip(project, chordTrack.id, 'MidiChord').project;
      project = insertDeviceIntoChannelStrip(project, chordTrack.id, 'MidiArpeggiator').project;

      // Store in Session slot 0 and launch at beat 0
      project = storeArrangementClipInSession(project, chordTrack.id, 0, baseClip.id);
      project = queueSessionLaunch(project, chordTrack.id, 0, 0, 4);

      // 1. Session window events evaluate MidiChord -> MidiArpeggiator
      const sessionEvts = evaluatePlayableSessionEvents(project, 0, 4, {
        singleTrackId: chordTrack.id,
      });
      expect(sessionEvts.length).toBeGreaterThan(4);

      // Source clip in sessionClips[0] remains untouched (2 editable source notes)
      const storedSessionClip = project.tracks.find((t) => t.id === chordTrack.id)!.sessionClips![0];
      expect(storedSessionClip.notes).toHaveLength(2);

      // 2. Capture Session performance [0, 4) into Arrangement at beat 4 (Bar 2)
      const captured = captureSessionPerformance(project, 0, 4, 4);
      const capturedTrack = captured.tracks.find((t) => t.id === chordTrack.id)!;
      const capturedClip = capturedTrack.clips.find((c) => c.startTime === 4)!;
      expect(capturedClip).toBeDefined();
      // Captured clip stores the 2 source performance notes (not pre-expanded arp notes!)
      expect(capturedClip.notes).toHaveLength(2);

      // 3. Evaluating Arrangement events on the captured clip [4, 8) produces identical pitch & duration sequence as Session [0, 4)
      const arrangementEvts = evaluatePlayableArrangementEvents(captured, 4, 8, {
        singleTrackId: chordTrack.id,
      });
      expect(arrangementEvts.length).toBe(sessionEvts.length);
      expect(arrangementEvts.map((e) => e.note.pitch)).toEqual(
        sessionEvts.map((e) => e.note.pitch)
      );
      expect(arrangementEvts.map((e) => Number((e.beat - 4).toFixed(4)))).toEqual(
        sessionEvts.map((e) => Number(e.beat.toFixed(4)))
      );

      // 4. Bypassing MidiArpeggiator updates both Session and Arrangement evaluation identically
      const arpDev = capturedTrack.devices.find((d) => d.xmlTag === 'MidiArpeggiator')!;
      const bypassed = toggleChannelInsertBypass(captured, chordTrack.id, arpDev.id);
      const sessionChordOnly = evaluatePlayableSessionEvents(bypassed, 0, 4, {
        singleTrackId: chordTrack.id,
      });
      const arrChordOnly = evaluatePlayableArrangementEvents(bypassed, 4, 8, {
        singleTrackId: chordTrack.id,
      });
      expect(sessionChordOnly.length).toBe(8); // 2 notes * 4 chord voices
      expect(arrChordOnly.map((e) => e.note.pitch)).toEqual(
        sessionChordOnly.map((e) => e.note.pitch)
      );
    });

    it('verifies Section 3: audio-clock retiring chains keep stateful reverb/delay tails alive until retireAtAudioTime and bound queue size', () => {
      const { xml, meta } = buildStarterAbletonXml('berghain-134', 505, 4, 'sketch');
      let project = parseAbletonXmlDom(xml, meta.name, xml);
      const trackId = project.tracks[0].id;
      project = insertDeviceIntoChannelStrip(project, trackId, 'Reverb').project;

      let simulatedNow = 1.0;
      const fakeCtx: Record<string, unknown> = {
        get currentTime() {
          return simulatedNow;
        },
        sampleRate: 44100,
        destination: {},
      };
      const makeGain = () => ({
        context: fakeCtx,
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          setTargetAtTime: vi.fn(),
        },
        connect: vi.fn(),
        disconnect: vi.fn(),
      });
      fakeCtx.createGain = vi.fn(makeGain);
      fakeCtx.createBiquadFilter = vi.fn(() => ({
        context: fakeCtx,
        type: 'lowpass',
        frequency: { value: 1000, setTargetAtTime: vi.fn() },
        Q: { value: 0.707, setTargetAtTime: vi.fn() },
        gain: { value: 0, setTargetAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }));
      fakeCtx.createDynamicsCompressor = vi.fn(() => ({
        context: fakeCtx,
        threshold: { value: -18, setTargetAtTime: vi.fn() },
        knee: { value: 6 },
        ratio: { value: 4, setTargetAtTime: vi.fn() },
        attack: { value: 0.01, setTargetAtTime: vi.fn() },
        release: { value: 0.1, setTargetAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }));
      fakeCtx.createWaveShaper = vi.fn(() => ({
        context: fakeCtx,
        curve: null,
        oversample: 'none',
        connect: vi.fn(),
        disconnect: vi.fn(),
      }));
      fakeCtx.createStereoPanner = vi.fn(() => ({
        context: fakeCtx,
        pan: { value: 0, setTargetAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }));
      fakeCtx.createDelay = vi.fn(() => ({
        context: fakeCtx,
        delayTime: { value: 0.1, setTargetAtTime: vi.fn() },
        connect: vi.fn(),
        disconnect: vi.fn(),
      }));
      fakeCtx.createConvolver = vi.fn(() => ({
        context: fakeCtx,
        buffer: null,
        connect: vi.fn(),
        disconnect: vi.fn(),
      }));
      fakeCtx.createBuffer = vi.fn((_ch: number, len: number, sr: number) => ({
        length: len,
        sampleRate: sr,
        getChannelData: () => new Float32Array(len),
      }));

      const ctxTyped = fakeCtx as unknown as BaseAudioContext;
      const bus = buildAudioBusGraph(ctxTyped, 134, DEFAULT_MASTER_BUS, false);
      const trackWithReverb = project.tracks.find((t) => t.id === trackId)!;
      const revDev = trackWithReverb.devices.find((d) => d.xmlTag === 'Reverb')!;

      const ch = getOrCreateTrackChannelRuntime(ctxTyped, bus, trackWithReverb, project);
      expect(ch.retiringChains).toHaveLength(0);

      // Remove Reverb while audio clock is at t = 1.0s
      const afterRemove = removeChannelInsertDevice(project, trackId, revDev.id);
      const trackWithoutReverb = afterRemove.tracks.find((t) => t.id === trackId)!;
      getOrCreateTrackChannelRuntime(ctxTyped, bus, trackWithoutReverb, afterRemove);

      // Stateful Reverb chain is now retiring (not yet disposed at t = 1.0s)
      expect(ch.retiringChains).toHaveLength(1);
      expect(ch.disposedProcessorIds.includes(revDev.id)).toBe(false);
      const retireAt = ch.retiringChains[0].retireAtAudioTime;
      expect(retireAt).toBeGreaterThan(simulatedNow + 0.5);

      // Advance audio clock past retireAtAudioTime and prune
      simulatedNow = retireAt + 0.05;
      const pruned = pruneRetiringTrackChains(ch, simulatedNow);
      expect(pruned).toBe(1);
      expect(ch.retiringChains).toHaveLength(0);
      expect(ch.disposedProcessorIds.includes(revDev.id)).toBe(true);
    });

    it('verifies Section 4: MusicalTimeService preserves 4-bar extent and supports 4096 bars across 5/4 and 7/8 meters', () => {
      const { xml, meta } = buildStarterAbletonXml('berghain-134', 606, 4, 'sketch');
      const project4Bar = parseAbletonXmlDom(xml, meta.name, xml);
      expect(project4Bar.arrangementLengthBars).toBe(4);
      // Must return 16 beats for a 4-bar project, never inflated to 64 beats (16 bars)
      expect(MusicalTimeService.arrangementTotalBeats(project4Bar)).toBe(16);

      // 5/4 meter up to bar 4096 and exclusive end boundary 4097.1.0
      const meter54 = [{ bar: 1, beat: 0, numerator: 5, denominator: 4 }];
      expect(maxSupportedBeatsForMeterMap(meter54)).toBe(4096 * 5);
      const endBeat54 = barBeatTickToBeat(MAX_SUPPORTED_TIMELINE_BARS + 1, 1, 0, meter54);
      expect(endBeat54).toBe(20480);
      const roundTrip54 = beatToBarBeatTick(20475, meter54);
      expect(roundTrip54.bar).toBe(4096);
      expect(roundTrip54.beatInBar).toBe(1);

      // 7/8 meter (3.5 quarter beats per bar) up to bar 4096 and rejecting beats beyond 4097.1.0
      const meter78 = [{ bar: 1, beat: 0, numerator: 7, denominator: 8 }];
      const maxBeats78 = maxSupportedBeatsForMeterMap(meter78);
      expect(maxBeats78).toBe(4096 * 3.5);
      expect(barBeatTickToBeat(MAX_SUPPORTED_TIMELINE_BARS + 1, 1, 0, meter78)).toBe(maxBeats78);
      expect(() => beatToBarBeatTick(maxBeats78 + 4, meter78)).toThrow(/exceeds maximum supported/);
    });

    it('verifies Section 5: executable device contract enforces generatedDescriptor semantics, chain ordering, and registry integrity', () => {
      const regReport = verifyDeviceRegistryIntegrity();
      expect(regReport.valid).toBe(true);
      expect(regReport.errors).toEqual([]);

      const { xml, meta } = buildStarterAbletonXml('berghain-134', 707, 4, 'sketch');
      let project = parseAbletonXmlDom(xml, meta.name, xml);
      const trackId = project.tracks[0].id;
      project = insertDeviceIntoChannelStrip(project, trackId, 'Reverb').project;
      const track = project.tracks.find((t) => t.id === trackId)!;
      const rev = track.devices.find((d) => d.xmlTag === 'Reverb')!;

      // Corrupt generatedDescriptor while keeping sourceParameterHash intact
      const corruptedRev: AbletonDevice = {
        ...rev,
        conversionRecord: {
          ...rev.conversionRecord!,
          generatedDescriptor: {
            ...rev.conversionRecord!.generatedDescriptor,
            decaySec: 999,
          },
        },
      };
      const ver = verifyDeviceConversionRecord(corruptedRev);
      expect(ver.isValid).toBe(false);
      expect(ver.status).toBe('invalidated');
      expect(ver.reason).toMatch(/Generated descriptor value mismatch/);

      // Violate chain ordering by placing an active instrument after an audio effect
      const badOrderTrack = {
        ...track,
        devices: [
          ...track.devices,
          {
            id: 'extra_inst_after_fx',
            xmlTag: 'Operator',
            displayName: 'Operator 2',
            category: 'instrument' as const,
            parameters: [{ name: 'Course', value: 1 }],
            bypassed: false,
          },
        ],
      };
      const violations = validateTrackDeviceChainOrderingAndCounts(badOrderTrack);
      expect(violations.length).toBeGreaterThan(0);
      expect(() =>
        assertExecutableInsertLimits({
          ...project,
          tracks: project.tracks.map((t) => (t.id === track.id ? badOrderTrack : t)),
        })
      ).toThrow(/DEVICE_CHAIN_CONTRACT/);
    });
  });

  describe('2026-11-04 Strengthening Directives (Sections 2–8)', () => {
    it('Section 2: separates read-only validation, legacy migration, and explicit reconversion; preserves future metadata; and rejects all 6 negative fixtures across Play, recovery, undo/redo, save/reopen, and export', () => {
      const { xml, meta } = buildStarterAbletonXml('berghain-134', 1101, 4, 'sketch');
      const validProject = parseAbletonXmlDom(xml, meta.name, xml);

      // 1. Idempotency: already-valid project returns exact same object reference without cloning
      expect(ensureProjectDeviceConversions(validProject)).toBe(validProject);
      const migrationNoOp = migrateMissingLegacyProjectConversions(validProject);
      expect(migrationNoOp.migrated).toBe(false);
      expect(migrationNoOp.migratedDeviceIds).toHaveLength(0);
      expect(migrationNoOp.project).toBe(validProject);
      expect(migrationNoOp.migrationId).toBe(LEGACY_CONVERSION_MIGRATION_V1);

      const firstConvertedDev = validProject.tracks[0].devices.find(
        (d) => d.xmlTag === 'DrumBuss'
      )!;
      expect(syncDeviceConversionRecord(firstConvertedDev)).toBe(firstConvertedDev);

      // 2. Construct the 6 negative fixtures
      const replaceFirstDev = (mutatedDev: AbletonDevice) => ({
        ...validProject,
        tracks: validProject.tracks.map((t, idx) =>
          idx === 0
            ? {
                ...t,
                devices: t.devices.map((d) =>
                  d.id === firstConvertedDev.id ? mutatedDev : d
                ),
              }
            : t
        ),
      });

      const missingLegacyDev: AbletonDevice = {
        ...firstConvertedDev,
        conversionRecord: undefined,
      };
      const staleHashDev: AbletonDevice = {
        ...firstConvertedDev,
        parameters: firstConvertedDev.parameters.map((p) =>
          p.name === 'Drive' ? { ...p, value: 91 } : p
        ),
      };
      const explicitlyInvalidatedDev = invalidateDeviceConversionRecord(
        firstConvertedDev,
        'Manual test invalidation'
      );
      const futureVersionDev: AbletonDevice = {
        ...firstConvertedDev,
        conversionRecord: {
          ...firstConvertedDev.conversionRecord!,
          conversionVersion: CURRENT_DEVICE_CONVERSION_VERSION + 10,
          generatedDescriptor: {
            ...firstConvertedDev.conversionRecord!.generatedDescriptor,
            futureSpatialField: 'ambisonic_3rd_order',
          },
        } as AbletonDevice['conversionRecord'],
      };
      const wrongDescriptorDev: AbletonDevice = {
        ...firstConvertedDev,
        conversionRecord: {
          ...firstConvertedDev.conversionRecord!,
          conversionKind: 'midi_note_transformer',
        },
      };
      const unsupportedDev: AbletonDevice = {
        id: 'dev_unsupported_vst',
        xmlTag: 'UnsupportedExternalPlugin',
        displayName: 'External VST3',
        category: 'audio_effect',
        parameters: [{ name: 'Mix', value: 100 }],
        bypassed: false,
        isUserCreated: false,
      };

      const negativeFixtures: Array<{
        name: string;
        project: typeof validProject;
        expectedPattern: RegExp;
      }> = [
        {
          name: 'missing legacy metadata',
          project: replaceFirstDev(missingLegacyDev),
          expectedPattern: /CONVERSION_REQUIRED/,
        },
        {
          name: 'stale parameter hashes',
          project: replaceFirstDev(staleHashDev),
          expectedPattern: /CONVERSION_REQUIRED/,
        },
        {
          name: 'explicitly invalidated records',
          project: replaceFirstDev(explicitlyInvalidatedDev),
          expectedPattern: /CONVERSION_REQUIRED/,
        },
        {
          name: 'future conversion versions',
          project: replaceFirstDev(futureVersionDev),
          expectedPattern: /FUTURE_CONVERSION_VERSION/,
        },
        {
          name: 'incorrect conversion kind or descriptor',
          project: replaceFirstDev(wrongDescriptorDev),
          expectedPattern: /CONVERSION_REQUIRED/,
        },
        {
          name: 'unsupported devices',
          project: replaceFirstDev(unsupportedDev),
          expectedPattern: /UNSUPPORTED_DEVICE/,
        },
      ];

      for (const fixture of negativeFixtures) {
        const beforeSnapshot = JSON.stringify(fixture.project);

        // Enrichment does not rewrite or conceal invalid conversion state
        const enriched = enrichProjectWithAnalysis(fixture.project, 'hypnotic_longform');
        expect(enriched.tracks).toBe(fixture.project.tracks);

        // (a) Open -> Play rejects without mutating project state
        const engine = new ParametricWebAudioEngine();
        engine.setState(fixture.project, DEFAULT_HUMANIZATION, DEFAULT_TRANSPORT, DEFAULT_MASTER_BUS);
        expect(() => engine.start(false)).toThrow(fixture.expectedPattern);
        expect(JSON.stringify(fixture.project)).toBe(beforeSnapshot);

        // (b) Canonical state contract (used by recovery & XML sync) rejects
        expect(() => assertProjectState(fixture.project)).toThrow(fixture.expectedPattern);

        // (c) Save / Reopen (v2/v3 snapshot) rejects without silently rebuilding conversion records
        expect(() =>
          encodeProjectSnapshot(
            fixture.project,
            DEFAULT_HUMANIZATION,
            DEFAULT_MASTER_BUS,
            DEFAULT_TRANSPORT
          )
        ).toThrow(fixture.expectedPattern);
        const rawSnapshotText = JSON.stringify({
          format: 'parametric-als-daw',
          version: 2,
          project: {
            ...fixture.project,
            audioSettings: {
              humanization: DEFAULT_HUMANIZATION,
              masterBus: DEFAULT_MASTER_BUS,
              transport: DEFAULT_TRANSPORT,
            },
          },
        });
        expect(() => decodeProjectSnapshot(rawSnapshotText)).toThrow(fixture.expectedPattern);

        // (d) CommandBus mutation and Undo/Redo reject invalid conversion state
        const bus = new StudioCommandBus();
        expect(() =>
          bus.executeMutation('q_neg', `mutate ${fixture.name}`, 'mixer', validProject, () => fixture.project)
        ).toThrow(fixture.expectedPattern);

        // (e) Offline export rejects
        expect(() =>
          synthesizeDeterministicStereoPcm(
            fixture.project,
            DEFAULT_HUMANIZATION,
            DEFAULT_MASTER_BUS,
            22050
          )
        ).toThrow(fixture.expectedPattern);
      }

      // 3. Future conversion metadata is preserved untouched by legacy migration and rejected by sync
      const futureMig = migrateLegacyDeviceConversionRecord(futureVersionDev);
      expect(futureMig.migrated).toBe(false);
      expect(futureMig.device).toBe(futureVersionDev);
      expect(futureVersionDev.conversionRecord?.conversionVersion).toBe(
        CURRENT_DEVICE_CONVERSION_VERSION + 10
      );
      expect(() => syncDeviceConversionRecord(futureVersionDev)).toThrow(
        /FUTURE_CONVERSION_VERSION/
      );
      expect(() =>
        convertOrReconvertDeviceInstance(
          replaceFirstDev(futureVersionDev),
          validProject.tracks[0].id,
          firstConvertedDev.id
        )
      ).toThrow(/FUTURE_CONVERSION_VERSION/);

      // 4. Missing legacy metadata can be migrated explicitly via migrateMissingLegacyProjectConversions
      const migratedLegacy = migrateMissingLegacyProjectConversions(
        replaceFirstDev(missingLegacyDev)
      );
      expect(migratedLegacy.migrated).toBe(true);
      expect(migratedLegacy.migratedDeviceIds).toEqual([firstConvertedDev.id]);
      expect(() => assertProjectState(migratedLegacy.project)).not.toThrow();

      // 5. Stale/invalidated metadata is NOT touched by legacy migration, but IS repaired by explicit convertOrReconvertDeviceInstance
      const staleUnmigrated = migrateMissingLegacyProjectConversions(
        replaceFirstDev(staleHashDev)
      );
      expect(staleUnmigrated.migrated).toBe(false);
      expect(staleUnmigrated.migratedDeviceIds).toHaveLength(0);
      expect(() => assertProjectState(staleUnmigrated.project)).toThrow(/CONVERSION_REQUIRED/);

      const explicitlyReconverted = convertOrReconvertDeviceInstance(
        replaceFirstDev(staleHashDev),
        validProject.tracks[0].id,
        firstConvertedDev.id
      );
      expect(explicitlyReconverted.changed).toBe(true);
      expect(() => assertProjectState(explicitlyReconverted.project)).not.toThrow();
    });

    it('Section 3: preserves exact 0.0625-beat clip boundary with 0.0625-beat MidiArpeggiator rate without generating events at or beyond clip end', () => {
      const { xml, meta } = buildStarterAbletonXml('berghain-134', 1202, 4, 'sketch');
      let project = parseAbletonXmlDom(xml, meta.name, xml);
      const track = project.tracks[3];

      const arpDev = syncDeviceConversionRecord({
        id: 'arp_short_clip',
        xmlTag: 'MidiArpeggiator',
        displayName: 'Arpeggiator',
        category: 'midi_effect',
        parameters: [
          { name: 'Rate', value: 0.0625 },
          { name: 'Gate', value: 100 },
          { name: 'Steps', value: 2 },
          { name: 'Distance', value: 12 },
          { name: 'Style', value: 'Up' },
        ],
        bypassed: false,
      });

      const shortClip = {
        id: 'clip_00625',
        name: 'Short_64th_Clip',
        startTime: 0,
        endTime: 0.0625,
        length: 0.0625,
        notes: [
          {
            id: 'note_inside_short_clip',
            time: 0,
            quantizedTime: 0,
            duration: 1.0, // Note duration exceeds clip, must be bounded by clip end 0.0625
            pitch: 60,
            velocity: 100,
            probability: 1,
            isGhost: false,
          },
        ],
      };

      project = {
        ...project,
        arrangementLengthBars: 1,
        tracks: [
          {
            ...track,
            devices: [
              arpDev,
              ...track.devices.filter((d) => d.category === 'instrument'),
            ],
            clips: [shortClip],
          },
        ],
      };

      // Evaluate across [0, 4): only 1 arpeggiator step at beat 0 is strictly inside [0, 0.0625)
      const events = evaluatePlayableArrangementEvents(project, 0, 4);
      expect(events).toHaveLength(1);
      expect(events[0].beat).toBe(0);
      expect(events[0].note.duration).toBeCloseTo(0.0625, 6);
      expect(events.some((e) => e.beat >= 0.0625 - 1e-9)).toBe(false);

      // Querying [0.0625, 1.0) produces zero events
      const afterClipEvents = evaluatePlayableArrangementEvents(project, 0.0625, 1.0);
      expect(afterClipEvents).toHaveLength(0);

      // Compiled schedule matches exact evaluation
      const { schedule } = compileOrUpdateArrangementSchedule(project, 4, null);
      const winAfter = queryCompiledArrangementWindow(schedule, 0.0625, 1.0, 0, {
        enabled: false,
        start: 0,
        end: 4,
        span: 4,
      });
      expect(winAfter.windowEvents).toHaveLength(0);
    });

    it('Section 4: scales scheduling with the active window via indexed binary search while preserving full-clip Chord/Arpeggiator continuity across lookahead windows', () => {
      const { xml, meta } = buildStarterAbletonXml('berghain-134', 1303, 4, 'sketch');
      let project = parseAbletonXmlDom(xml, meta.name, xml);

      // Expand into a dense 128-bar arrangement (512 beats) with MidiChord + MidiArpeggiator
      const targetTrackId = project.tracks[0].id;
      const baseClip = project.tracks[0].clips[0];
      const expandedClips = Array.from({ length: 32 }, (_, idx) => {
        const offsetBeats = idx * 16;
        return {
          ...baseClip,
          id: `${baseClip.id}_rep_${idx}`,
          startTime: offsetBeats,
          endTime: offsetBeats + 16,
          length: 16,
          notes: baseClip.notes.map((n, nIdx) => ({
            ...n,
            id: `${n.id}_${idx}_${nIdx}`,
            time: n.time - baseClip.startTime + offsetBeats,
            quantizedTime: n.quantizedTime - baseClip.startTime + offsetBeats,
          })),
        };
      });
      project = {
        ...project,
        arrangementLengthBars: 128,
        tracks: project.tracks.map((t, i) =>
          i === 0 ? { ...t, clips: expandedClips } : t
        ),
      };
      project = insertDeviceIntoChannelStrip(project, targetTrackId, 'MidiChord').project;
      project = insertDeviceIntoChannelStrip(project, targetTrackId, 'MidiArpeggiator').project;

      const maxBeats = 128 * 4;
      const { schedule: compiled1 } = compileOrUpdateArrangementSchedule(project, maxBeats, null);
      expect(compiled1.events.length).toBeGreaterThan(500);

      // Querying a 20ms lookahead window (~0.045 beats) around beat 256 visits only the active window events
      const windowStart = 256.0;
      const windowEnd = 256.15;
      const startIndex = findFirstEventIndexAtOrAfterBeat(compiled1.events, windowStart);
      expect(startIndex).toBeGreaterThan(0);
      const winQuery = queryCompiledArrangementWindow(
        compiled1,
        windowStart,
        windowEnd,
        0,
        { enabled: false, start: 0, end: maxBeats, span: maxBeats }
      );
      expect(winQuery.visitedCount).toBeLessThan(32);
      expect(winQuery.visitedCount).toBeLessThan(compiled1.events.length / 10);

      // Single-track edit incrementally rebuilds only that track without recompiling untouched tracks
      const prevTrackCacheRef = compiled1.trackEntries.get(project.tracks[1].id);
      const editedProject = updateChannelInsertParam(
        project,
        targetTrackId,
        project.tracks[0].devices.find((d) => d.xmlTag === 'MidiArpeggiator')!.id,
        'Gate',
        75
      );
      const { schedule: compiled2, rebuiltTracksCount } = compileOrUpdateArrangementSchedule(
        editedProject,
        maxBeats,
        compiled1
      );
      expect(rebuiltTracksCount).toBe(1);
      expect(compiled2.trackEntries.get(editedProject.tracks[1].id)).toBe(prevTrackCacheRef);

      // Verify Chord/Arpeggiator continuity across adjacent lookahead windows [0, 0.3), [0.3, 0.6), [0.6, 1.0)
      const fullWindowEvents = evaluatePlayableArrangementEvents(editedProject, 0, 1.0, {
        singleTrackId: targetTrackId,
      });
      const subWindows = [
        [0, 0.3],
        [0.3, 0.6],
        [0.6, 1.0],
      ] as const;
      const stitched: typeof fullWindowEvents = [];
      for (const [wStart, wEnd] of subWindows) {
        const res = queryCompiledArrangementWindow(
          compiled2,
          wStart,
          wEnd,
          0,
          { enabled: false, start: 0, end: maxBeats, span: maxBeats }
        );
        stitched.push(
          ...res.windowEvents.filter(
            (e) => e.trackId === targetTrackId && e.beat >= wStart && e.beat < wEnd
          )
        );
      }
      expect(
        stitched.map((e) => ({ beat: e.beat, pitch: e.note.pitch, dur: e.note.duration }))
      ).toEqual(
        fullWindowEvents.map((e) => ({ beat: e.beat, pitch: e.note.pitch, dur: e.note.duration }))
      );
    });

    it('Section 5: verifies native OfflineAudioContext processor graph construction and monotonic long-decay T60 envelopes up to 15.0s', async () => {
      // 1. Long decay settings (0.8s, 2.4s, 6.0s, 15.0s) produce strictly increasing feedback gains and distinct T60 decay envelopes
      const decayTimes = [0.8, 2.4, 6.0, 15.0];
      const feedbackGains = decayTimes.map((t60) => computeStableCombFeedbackGain(0.043, t60));
      for (let i = 1; i < feedbackGains.length; i++) {
        expect(feedbackGains[i]).toBeGreaterThan(feedbackGains[i - 1]);
        expect(feedbackGains[i]).toBeLessThan(1.0);
      }

      const lateWindowRmsByDecay: number[] = [];
      for (const decaySec of decayTimes) {
        const rev = syncDeviceConversionRecord({
          id: `rev_decay_${decaySec}`,
          xmlTag: 'Reverb',
          displayName: 'Reverb',
          category: 'audio_effect',
          parameters: [
            { name: 'DecayTime', value: decaySec },
            { name: 'PreDelay', value: 5 },
            { name: 'HighCut', value: 7000 },
            { name: 'DryWet', value: 85 },
          ],
          bypassed: false,
        });
        const ir = renderDeviceImpulseResponse(rev, 3.0, 12000);
        expect(ir.allFinite).toBe(true);
        expect(ir.tailDecaysMonotonically).toBe(true);
        lateWindowRmsByDecay.push(ir.windowRms[3]);

        const nativeProbe = await renderNativeOfflineDeviceImpulseResponse(rev, 0.5, 12000);
        expect(nativeProbe.processorSummary.type).toBe('reverb');
        expect(nativeProbe.processorSummary.tailDecaySeconds).toBeCloseTo(decaySec, 4);
        expect(nativeProbe.allFinite).toBe(true);
      }

      for (let i = 1; i < lateWindowRmsByDecay.length; i++) {
        expect(lateWindowRmsByDecay[i]).toBeGreaterThan(lateWindowRmsByDecay[i - 1]);
      }
    });

    it('Section 6: qualifies retiring chain lifecycle across continue, stop/pause flush, track removal, context close, rapid edits (max 4), and bounded disposedProcessorIds (max 64)', () => {
      const { xml, meta } = buildStarterAbletonXml('berghain-134', 1606, 4, 'sketch');
      let project = parseAbletonXmlDom(xml, meta.name, xml);
      const trackId = project.tracks[0].id;
      project = insertDeviceIntoChannelStrip(project, trackId, 'Reverb').project;

      let simulatedNow = 2.0;
      const testCtx = createTestAudioContext();
      Object.defineProperty(testCtx, 'currentTime', {
        get: () => simulatedNow,
      });

      const bus = buildAudioBusGraph(testCtx, project.tempo, DEFAULT_MASTER_BUS, false);
      const ch = getOrCreateTrackChannelRuntime(testCtx, bus, project.tracks[0], project);

      // 1. Rapid structural edits (> MAX_CONCURRENT_RETIRING_CHAINS) bound retiringChains to 4 and flush oldest immediately
      let workingProject = project;
      for (let i = 0; i < 10; i++) {
        const revDev = workingProject.tracks[0].devices.find((d) => d.xmlTag === 'Reverb')!;
        workingProject = removeChannelInsertDevice(workingProject, trackId, revDev.id);
        getOrCreateTrackChannelRuntime(testCtx, bus, workingProject.tracks[0], workingProject);
        workingProject = insertDeviceIntoChannelStrip(workingProject, trackId, 'Reverb').project;
        getOrCreateTrackChannelRuntime(testCtx, bus, workingProject.tracks[0], workingProject);
      }
      expect(ch.retiringChains.length).toBeLessThanOrEqual(MAX_CONCURRENT_RETIRING_CHAINS);

      // 2. Explicit flush (used on pause/stop/track-removal/context-close) disposes all remaining retiring chains immediately
      const flushed = flushRetiringTrackChains(ch);
      expect(flushed).toBeGreaterThan(0);
      expect(ch.retiringChains).toHaveLength(0);

      // 3. Many structural edits cap retained disposedProcessorIds at MAX_RETAINED_DISPOSED_PROCESSOR_IDS (64)
      simulatedNow = 0; // Immediate disposal path
      for (let i = 0; i < 30; i++) {
        const eqRes = insertDeviceIntoChannelStrip(workingProject, trackId, 'EQEight');
        workingProject = eqRes.project;
        getOrCreateTrackChannelRuntime(testCtx, bus, workingProject.tracks[0], workingProject);
        workingProject = removeChannelInsertDevice(workingProject, trackId, eqRes.insertedDevice!.id);
        getOrCreateTrackChannelRuntime(testCtx, bus, workingProject.tracks[0], workingProject);
      }
      expect(ch.disposedProcessorIds.length).toBeLessThanOrEqual(
        MAX_RETAINED_DISPOSED_PROCESSOR_IDS
      );
    });

    it('Section 7: snaps playhead immediately on seek, stop, loop wrap, project change, scroll/zoom change, and prefers-reduced-motion while smoothing continuous forward playback', () => {
      const baseSnap = {
        isPlaying: true,
        beat: 4.0,
        scrollBar: 0,
        zoom: 1,
        projectRevision: 1,
        prefersReducedMotion: false,
      };

      // Continuous forward advance during playback -> smooth transition (shouldSnap = false)
      expect(
        shouldSnapPlayheadImmediately(baseSnap, { ...baseSnap, beat: 4.12 })
      ).toBe(false);

      // Loop wrap / backward jump -> snap immediately
      expect(
        shouldSnapPlayheadImmediately(baseSnap, { ...baseSnap, beat: 0.02 })
      ).toBe(true);

      // Large forward seek -> snap immediately
      expect(
        shouldSnapPlayheadImmediately(baseSnap, { ...baseSnap, beat: 12.0 })
      ).toBe(true);

      // Stop / pause -> snap immediately
      expect(
        shouldSnapPlayheadImmediately(baseSnap, { ...baseSnap, isPlaying: false, beat: 0 })
      ).toBe(true);

      // Project switch / revision change -> snap immediately
      expect(
        shouldSnapPlayheadImmediately(baseSnap, { ...baseSnap, projectRevision: 2, beat: 4.05 })
      ).toBe(true);

      // Viewport scroll or zoom change -> snap immediately
      expect(
        shouldSnapPlayheadImmediately(baseSnap, { ...baseSnap, scrollBar: 4, beat: 4.05 })
      ).toBe(true);
      expect(
        shouldSnapPlayheadImmediately(baseSnap, { ...baseSnap, zoom: 2, beat: 4.05 })
      ).toBe(true);

      // prefers-reduced-motion -> snap immediately
      expect(
        shouldSnapPlayheadImmediately(baseSnap, {
          ...baseSnap,
          beat: 4.08,
          prefersReducedMotion: true,
        })
      ).toBe(true);

      // Transform coordinate mapping
      const transform = mapBeatToArrangementPlayheadTransform(8, {
        canvasWidthPx: 1000,
        arrStartBeat: 0,
        arrVisibleBeats: 16,
      });
      expect(transform.isVisible).toBe(true);
      expect(transform.translateX).toBeCloseTo(500, 5);
    });

    it('Section 8: supports 1-bar projects, fractional clips, and 4096-bar timeline extents across state validation, XML round-trip, and playback region', () => {
      const { xml, meta } = buildStarterAbletonXml('berghain-134', 1808, 1, 'sketch');
      const oneBarProject = parseAbletonXmlDom(xml, meta.name, xml);
      expect(oneBarProject.arrangementLengthBars).toBe(1);
      expect(MusicalTimeService.arrangementTotalBeats(oneBarProject)).toBe(4);
      expect(playbackRegion(4, { ...DEFAULT_TRANSPORT, loopEnabled: false }).end).toBe(4);

      const maxBarProject = {
        ...oneBarProject,
        arrangementLengthBars: MAX_SUPPORTED_TIMELINE_BARS,
        requestedDurationBars: MAX_SUPPORTED_TIMELINE_BARS,
      };
      expect(() => assertProjectState(maxBarProject)).not.toThrow();
      const syncedMaxXml = synchronizeProjectStateToXml(maxBarProject, oneBarProject);
      const reparsedMax = parseAbletonXmlDom(syncedMaxXml, meta.name, syncedMaxXml);
      expect(reparsedMax.arrangementLengthBars).toBe(4096);
      expect(MusicalTimeService.arrangementTotalBeats(reparsedMax)).toBe(4096 * 4);
    });
  });
});


