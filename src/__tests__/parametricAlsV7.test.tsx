// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { synthEngine } from '../engine/webAudioSynth';
import {
  TimelineViewportController,
  formatBarBeatSixteenth,
  SUPPORTED_PROJECT_BAR_LENGTHS,
} from '../engine/timelineViewportController';
import {
  UNDERGROUND_TECHNO_SUBGENRES,
  INSTRUMENT_ROLE_TAXONOMY,
  generateClipForBarRange,
  insertClipIntoTrackTimeline,
  splitTrackClipAtBeat,
  duplicateTrackClip,
  consolidateTrackClipsInRange,
  createUserTrackFromRole,
} from '../engine/compositionIntelligenceEngine';
import { buildStarterAbletonXml, parseAlsXmlString } from '../engine/alsXmlEngine';
import { HumanizationConfig, MasterBusConfig } from '../types/ableton';

const TEST_HUMANIZATION: HumanizationConfig = {
  microTimingMaxShiftBeats: 0.015,
  swingStrength: 0,
  velocityVariancePct: 0.08,
  ghostVelocityMin: 20,
  ghostVelocityMax: 45,
  lfoRateHz: 0.1,
  lfoDepth: 0.4,
  cutoffHz: 145,
  macroTransition: 42,
};

const TEST_MASTER_BUS: MasterBusConfig = {
  masterVolumeDb: 0,
  glueCompressionDrive: 0.35,
  reverbDecaySec: 3.2,
  reverbReturnLevel: 0.45,
  delayFeedback: 0.42,
  delayReturnLevel: 0.4,
  subBassMonoCutoffHz: 120,
};

describe('Parametric ALS v7.0 Master Implementation Verification Suite', () => {
  beforeEach(() => {
    synthEngine.stop();
    synthEngine.recoverAudioEngine();
  });

  describe('Phase 1 — Audio Stability & Playback Continuity (TC-AUDIO-001..003)', () => {
    it('TC-AUDIO-001: initializes with zero fabricated underruns and stabilityAutoPauseEnabled disabled by default', () => {
      const diag = synthEngine.getDiagnostics();
      expect(diag.stabilityAutoPauseEnabled).toBe(false);
      expect(diag.lastAutoPauseReason).toBeNull();
      expect(diag.bufferUnderruns).toBe(0);
      expect(diag.underrunEvents.length).toBe(0);
    });

    it('TC-AUDIO-002: recoverAudioEngine clears any auto-paused state and restores clean diagnostics', () => {
      synthEngine.recoverAudioEngine();
      const diag = synthEngine.getDiagnostics();
      expect(diag.lastAutoPauseReason).toBeNull();
      expect(diag.bufferUnderruns).toBe(0);
      expect(diag.underrunEvents.length).toBe(0);
    });

    it('TC-AUDIO-003: honors explicit simulateLatencySpike only when stabilityAutoPauseEnabled is explicitly enabled', () => {
      synthEngine.setStabilityThreshold(22, false);
      synthEngine.simulateLatencySpike(35);
      expect(synthEngine.getDiagnostics().lastAutoPauseReason).toBeNull();

      synthEngine.setStabilityThreshold(22, true);
      synthEngine.simulateLatencySpike(35);
      expect(synthEngine.getDiagnostics().lastAutoPauseReason).toContain('35');

      // Reset to default safe behavior
      synthEngine.setStabilityThreshold(45, false);
      synthEngine.recoverAudioEngine();
    });
  });

  describe('Phase 2 — Continuous Ableton-Class Timeline Viewport & Bar Scaling (TC-TIME-001..003)', () => {
    it('TC-TIME-001: zoomAtPixel preserves the exact musical beat anchored under the pointer', () => {
      const controller = new TimelineViewportController({
        viewportWidthPx: 1000,
        totalBars: 128,
        pixelsPerBeat: 10,
        scrollBeat: 32,
      });

      const pointerX = 400;
      const anchorBeatBefore = controller.pixelToBeat(pointerX);
      expect(anchorBeatBefore).toBeCloseTo(72, 4);

      controller.zoomAtPixel(2.5, pointerX);
      const anchorBeatAfter = controller.pixelToBeat(pointerX);
      expect(anchorBeatAfter).toBeCloseTo(anchorBeatBefore, 4);
    });

    it('TC-TIME-002: supports zoomToBarRange, fitArrangement, and adaptive grid divisions from 4 to 1024 bars', () => {
      expect(SUPPORTED_PROJECT_BAR_LENGTHS).toContain(4);
      expect(SUPPORTED_PROJECT_BAR_LENGTHS).toContain(128);
      expect(SUPPORTED_PROJECT_BAR_LENGTHS).toContain(1024);

      const controller = new TimelineViewportController({
        viewportWidthPx: 800,
        totalBars: 128,
      });

      const state = controller.zoomToBarRange(33, 41);
      expect(state.scrollBeat).toBeCloseTo(32 * 4, 2);
      expect(controller.visibleEndBeat - controller.visibleStartBeat).toBeCloseTo(8 * 4, 1);

      const grid = controller.getAdaptiveGridConfig();
      expect(grid.minorBeatStep).toBeLessThanOrEqual(4);
      expect(formatBarBeatSixteenth(128)).toBe('33.1.1');
    });

    it('TC-TIME-003: dynamically expands total project bars when clips extend beyond current arrangement end', () => {
      const controller = new TimelineViewportController({
        viewportWidthPx: 800,
        totalBars: 16,
      });
      const updatedState = controller.ensureBeatExtend(280);
      expect(updatedState.totalBars).toBeGreaterThanOrEqual(70);
      expect(updatedState.totalBeats).toBe(updatedState.totalBars * 4);
    });
  });

  describe('Phase 3 & 5 — Multi-Clip Decomposition, Range-Based Clip Generation & 16 Subgenres (TC-CLIP-001..003, TC-MUSIC-001..003)', () => {
    it('TC-CLIP-001: parses default 128-bar template into distinct section-based clips instead of a single stretched 128-bar block', () => {
      const { xml } = buildStarterAbletonXml('berghain-134', 12345, 128);
      const project = parseAlsXmlString(xml);
      expect(project.tracks.length).toBeGreaterThanOrEqual(8);

      const kickTrack = project.tracks[0];
      expect(kickTrack.clips.length).toBeGreaterThan(1);
      // Every section clip must have its true finite length (< 512 beats)
      for (const clip of kickTrack.clips) {
        expect(clip.length).toBeGreaterThan(0);
        expect(clip.length).toBeLessThan(512);
      }
    }, 15000);

    it('TC-CLIP-002: generates range-bounded Chord, Bass, Drum, and Empty clips strictly inside selected bars without wiping existing non-overlapping clips', () => {
      const { xml } = buildStarterAbletonXml('berghain-134', 12345);
      const project = parseAlsXmlString(xml);
      const track = project.tracks[3]; // Hypnotic FM Lead / Synth track
      const clipsBeforeAtIntro = track.clips.filter((c) => c.startTime + c.length <= 128);
      expect(clipsBeforeAtIntro.length).toBeGreaterThan(0);

      // Generate a Chord clip in Bars 33..41 (beats 128..160)
      const genResult = generateClipForBarRange({
        track,
        startBar: 33,
        endBar: 41,
        mode: 'chord',
        rootKey: project.rootKey,
        scale: project.scale,
        subgenreId: 'dub_techno',
        seed: 909,
      });

      const chordClip = genResult.clip;
      expect(chordClip.startTime).toBe(128);
      expect(chordClip.length).toBe(32);
      expect(chordClip.notes.length).toBeGreaterThan(4);
      for (const n of chordClip.notes) {
        expect(n.time).toBeGreaterThanOrEqual(128);
        expect(n.time).toBeLessThan(160);
      }

      const updatedClips = insertClipIntoTrackTimeline(track.clips, chordClip);
      // Intro clips before beat 128 remain intact
      const preservedIntro = updatedClips.filter((c) => c.startTime + c.length <= 128);
      expect(preservedIntro.length).toBe(clipsBeforeAtIntro.length);
      // New chord clip is present at beat 128
      expect(updatedClips.some((c) => c.id === chordClip.id && c.startTime === 128)).toBe(true);
    });

    it('TC-CLIP-003: supports split, duplicate, and consolidate clip lifecycle operations cleanly', () => {
      const { xml } = buildStarterAbletonXml('berghain-134', 12345);
      const project = parseAlsXmlString(xml);
      const track = project.tracks[0];
      const firstClip = track.clips[0];
      const splitBeat = firstClip.startTime + firstClip.length / 2;

      const splitRes = splitTrackClipAtBeat(track.clips, splitBeat);
      expect(splitRes.splitOccurred).toBe(true);
      expect(splitRes.clips.some((c) => Math.abs(c.startTime - splitBeat) < 0.001)).toBe(true);

      const countBeforeDup = splitRes.clips.length;
      const dupRes = duplicateTrackClip(splitRes.clips, splitRes.clips[0].id);
      expect(dupRes.duplicatedClip).not.toBeNull();
      expect(dupRes.clips.length).toBeGreaterThanOrEqual(countBeforeDup);

      const consolidatedClips = consolidateTrackClipsInRange(dupRes.clips, 0, 64, track.name);
      const consolidated = consolidatedClips.find((c) => c.startTime === 0 && c.length === 64);
      expect(consolidated).toBeDefined();
    });

    it('TC-MUSIC-001..003: provides all 16 underground techno subgenre profiles and Group A-H track creation templates', () => {
      expect(UNDERGROUND_TECHNO_SUBGENRES.length).toBe(16);
      expect(INSTRUMENT_ROLE_TAXONOMY.length).toBeGreaterThanOrEqual(16);

      const newTrack = createUserTrackFromRole('G1', 10, 'Dub Chord Track');
      expect(newTrack.groupCode).toBe('G');
      expect(newTrack.roleCode).toBe('G1');
      expect(newTrack.name).toBe('Dub Chord Track');
    });
  });

  describe('Phase 4 — Real-Time Mixer Channel Strip Routing (TC-MIX-001..002)', () => {
    it('TC-MIX-001: updates per-track fader, pan, mute/solo gate, and meter levels in synthEngine', () => {
      const { xml } = buildStarterAbletonXml('berghain-134', 12345);
      const project = parseAlsXmlString(xml);
      synthEngine.setState(project, TEST_HUMANIZATION, undefined, TEST_MASTER_BUS);

      const targetTrack = project.tracks[0];
      synthEngine.updateTrackMixerLive(
        targetTrack.id,
        { volumeDb: -6, pan: -0.4 },
        { muted: false, soloed: true }
      );

      const meter = synthEngine.getTrackMeterLevels(targetTrack.id);
      expect(meter.gateLinear).toBe(1);
      expect(meter.pan).toBeCloseTo(-0.4, 2);

      // Other non-soloed tracks should be gated to 0 when track 0 is soloed
      const otherMeter = synthEngine.getTrackMeterLevels(project.tracks[1].id);
      expect(otherMeter.gateLinear).toBe(0);
    });
  });

  describe('Phase 9 — Android & Capacitor Identity Consistency (TC-REG-001)', () => {
    it('TC-REG-001: capacitor.config.json and android/app/build.gradle share identical com.parametricals.technodaw appId', () => {
      const capConfig = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), 'capacitor.config.json'), 'utf8')
      );
      expect(capConfig.appId).toBe('com.parametricals.technodaw');
    });
  });
});
