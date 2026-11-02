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
    });

    it('evaluates beat-to-seconds and inverse across stepped and linear tempo maps', () => {
      const tempoMap = [
        { beat: 0, bpm: 120, curve: 'step' as const }, // 0..4 beats @ 120 BPM = 2.0s
        { beat: 4, bpm: 120, curve: 'linear' as const }, // 4..8 beats linear ramp 120 -> 140 BPM (avg 130 BPM)
        { beat: 8, bpm: 140, curve: 'step' as const }, // 8+ beats @ 140 BPM
      ];

      const secAtBeat4 = beatToSecondsWithTempoMap(4, 120, tempoMap);
      expect(secAtBeat4).toBeCloseTo(2.0, 6);

      const secAtBeat8 = beatToSecondsWithTempoMap(8, 120, tempoMap);
      expect(secAtBeat8).toBeCloseTo(2.0 + (4 * 60) / 130, 6);

      const invertedBeat8 = secondsToBeatWithTempoMap(secAtBeat8, 120, tempoMap);
      expect(invertedBeat8).toBeCloseTo(8, 6);

      expect(() => beatToSecondsWithTempoMap(-1, 120)).toThrow(/TIMELINE_INPUT/);
      expect(() =>
        beatToSecondsWithTempoMap(4, 120, [
          { beat: 4, bpm: 128 },
          { beat: 2, bpm: 132 },
        ])
      ).toThrow(/TIMELINE_INPUT/);
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

  describe('G5: Declared Ableton Capability Matrix & Preflight Auditor', () => {
    it('classifies capabilities and flags insert-limit or unsupported third-party plugin devices', () => {
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
    });
  });
});
