// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_PPQ,
  barBeatTickToBeat,
  beatToBarBeatTick,
  beatToSecondsWithTempoMap,
  beatsToTicks,
  secondsToBeatWithTempoMap,
  snapBeatsToGridTicks,
  ticksToBeats,
} from '../engine/timelineCoordinates';
import {
  buildStarterAbletonXml,
  parseAbletonXmlDom,
  synchronizeProjectStateToXml,
  syncTrackClipsToXml,
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
  HumanizationConfig,
  MasterBusConfig,
  TransportConfig,
} from '../types/ableton';
import {
  ABLETON_CAPABILITY_MATRIX,
  MAX_EXECUTABLE_INSERT_DEVICES,
  auditProjectCapabilities,
} from '../engine/abletonCapabilityMatrix';
import { assertProjectState } from '../engine/projectStateContracts';

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

describe('G1–G8 Strengthening Contracts', () => {
  describe('G1: Canonical Ticks/PPQ (960), Tuplets, Fine Grids, Meter Map & Tempo Map', () => {
    it('converts beats and ticks losslessly for binary, triplet, and 1/128 fine grids', () => {
      expect(CANONICAL_PPQ).toBe(960);
      expect(beatsToTicks(1)).toBe(960);
      expect(beatsToTicks(0.25)).toBe(240); // 1/16 note
      expect(beatsToTicks(1 / 3)).toBe(320); // quarter-note triplet
      expect(beatsToTicks(1 / 6)).toBe(160); // 8th-note triplet
      expect(beatsToTicks(1 / 12)).toBe(80); // 16th-note triplet
      expect(beatsToTicks(4 / 128)).toBe(30); // 1/128 note (0.03125 beats = 30 ticks)

      expect(ticksToBeats(320)).toBeCloseTo(1 / 3, 10);
      expect(ticksToBeats(30)).toBe(0.03125);

      const snappedTriplet = snapBeatsToGridTicks(0.34, 1 / 3);
      expect(snappedTriplet.ticks).toBe(320);
      expect(snappedTriplet.beats).toBeCloseTo(1 / 3, 10);

      const snapped128th = snapBeatsToGridTicks(0.031, 4 / 128);
      expect(snapped128th.ticks).toBe(30);
      expect(snapped128th.beats).toBe(0.03125);
    });

    it('resolves bar/beat/tick coordinates across changing meters and long 1024-bar projects', () => {
      const meterMap = [
        { bar: 1, beat: 0, numerator: 4, denominator: 4 }, // Bars 1..4 = 16 beats (0..16)
        { bar: 5, beat: 16, numerator: 3, denominator: 4 }, // Bars 5..8 = 12 beats (16..28)
        { bar: 9, beat: 28, numerator: 7, denominator: 8 }, // Bar 9+ = 3.5 quarter-beats per bar
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

      // Long sparse project coordinate at Bar 1024 in 4/4
      const beatAtBar1024 = barBeatTickToBeat(1024, 4, 720);
      expect(beatAtBar1024).toBe(1023 * 4 + 3 + 0.75);
      const parsed1024 = beatToBarBeatTick(beatAtBar1024);
      expect(parsed1024.bar).toBe(1024);
      expect(parsed1024.beatInBar).toBe(4);
      expect(parsed1024.tickInBeat).toBe(720);

      // Discontinuous meter map boundary must be rejected atomically
      const discontinuousMeterMap = [
        { bar: 1, beat: 0, numerator: 4, denominator: 4 },
        { bar: 5, beat: 8, numerator: 3, denominator: 4 }, // 4 bars of 4/4 is 16 beats, not 8
      ];
      expect(() => beatToBarBeatTick(8, discontinuousMeterMap)).toThrow(/discontinuous meter map anchor/);
      expect(() => barBeatTickToBeat(3, 1, 0, discontinuousMeterMap)).toThrow(/discontinuous meter map anchor/);
    });

    it('integrates beat-linear tempo ramps via 60/BPM calculus (4*ln(2)) and inverts interior beats losslessly', () => {
      // Analytic reference oracle: 60 -> 120 BPM over 4 beats
      // BPM(b) = 60 + 15*b => dt = integral_0^4 (60 / (60 + 15*b)) db = 4 * ln(2) = 2.772588722239781s
      const ramp60To120 = [
        { beat: 0, bpm: 60, curve: 'linear' as const },
        { beat: 4, bpm: 120, curve: 'step' as const },
      ];
      const exactFourLn2 = 4 * Math.LN2;
      const secAtBeat4 = beatToSecondsWithTempoMap(4, 60, ramp60To120);
      expect(secAtBeat4).toBeCloseTo(exactFourLn2, 10);

      // Interior midpoint beat = 2 (BPM = 90): dt = 4 * ln(90/60) = 4 * ln(1.5)
      const secAtBeat2 = beatToSecondsWithTempoMap(2, 60, ramp60To120);
      expect(secAtBeat2).toBeCloseTo(4 * Math.log(1.5), 10);
      expect(secondsToBeatWithTempoMap(secAtBeat2, 60, ramp60To120)).toBeCloseTo(2.0, 10);
      expect(secondsToBeatWithTempoMap(secAtBeat4, 60, ramp60To120)).toBeCloseTo(4.0, 10);

      // Multi-segment stepped + linear tempo map
      const multiMap = [
        { beat: 0, bpm: 120, curve: 'step' as const }, // 0..4 beats @ 120 BPM = 2.0s
        { beat: 4, bpm: 120, curve: 'linear' as const }, // 4..8 beats linear ramp 120 -> 140 BPM (k = 5 BPM/beat)
        { beat: 8, bpm: 140, curve: 'step' as const }, // 8+ beats @ 140 BPM
      ];
      const expectedRampSec = (60 / 5) * Math.log(140 / 120);
      const multiSecAt8 = beatToSecondsWithTempoMap(8, 120, multiMap);
      expect(multiSecAt8).toBeCloseTo(2.0 + expectedRampSec, 10);
      expect(secondsToBeatWithTempoMap(multiSecAt8, 120, multiMap)).toBeCloseTo(8.0, 10);

      const multiSecAt6 = beatToSecondsWithTempoMap(6, 120, multiMap);
      expect(secondsToBeatWithTempoMap(multiSecAt6, 120, multiMap)).toBeCloseTo(6.0, 10);

      expect(() => beatToSecondsWithTempoMap(-1, 120)).toThrow(/TIMELINE_INPUT/);
      expect(() =>
        beatToSecondsWithTempoMap(4, 120, [
          { beat: 4, bpm: 128 },
          { beat: 2, bpm: 132 },
        ])
      ).toThrow(/TIMELINE_INPUT/);
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
    it('enforces capability matrix at runtime for unsupported, preserved-only, and over-limit device chains', async () => {
      const { assertExecutableInsertLimits } = await import('../engine/channelStripEngine');
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

      // Preserved-only device (e.g. MidiScale or InstrumentGroupDevice) sets canExecuteFullDsp=false and blocks un-bypassed execution
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

      // Non-constant tempo map is rejected at runtime preflight until variable-tempo DSP scheduling is enabled
      const dynamicTempoProject = {
        ...project,
        tempoMap: [
          { beat: 0, bpm: 120, curve: 'linear' as const },
          { beat: 16, bpm: 140, curve: 'step' as const },
        ],
      };
      expect(() => assertExecutableInsertLimits(dynamicTempoProject)).toThrow(/TIMING_MAP_UNSUPPORTED/);
    });
  });
});
