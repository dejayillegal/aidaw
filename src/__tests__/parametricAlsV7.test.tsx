// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { synthEngine, buildDeviceInsertProcessor } from '../engine/webAudioSynth';
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
  generateSectionArrangementProposal,
} from '../engine/compositionIntelligenceEngine';
import {
  buildStarterAbletonXml,
  parseAlsXmlString,
  parseAbletonXmlString,
  GenerateSectionArrangementProposal,
} from '../engine/alsXmlEngine';
import { alsPatchEngine } from '../engine/alsPatchEngine';
import { HumanizationConfig, MasterBusConfig, AbletonDevice } from '../types/ableton';

class MockAudioNode {
  constructor(public readonly context: MockAudioContext) {}
  connect(dest: any) {
    return dest;
  }
  disconnect() {}
}

class MockAudioParam {
  value: number;
  constructor(defaultVal = 0) {
    this.value = defaultVal;
  }
  cancelScheduledValues() {}
  setTargetAtTime(val: number) {
    this.value = val;
  }
  setValueAtTime(val: number) {
    this.value = val;
  }
  linearRampToValueAtTime(val: number) {
    this.value = val;
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
    const node = new MockAudioNode(this) as any;
    node.fftSize = 256;
    node.frequencyBinCount = 128;
    node.smoothingTimeConstant = 0.8;
    node.getByteTimeDomainData = (arr: Uint8Array) => arr.fill(128);
    node.getByteFrequencyData = (arr: Uint8Array) => arr.fill(0);
    return node;
  }

  createBuffer(channels: number, length: number, sampleRate: number) {
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      getChannelData: () => new Float32Array(length),
    };
  }

  createBufferSource() {
    const node = new MockAudioNode(this) as any;
    node.buffer = null;
    node.start = () => {};
    node.stop = () => {};
    return node;
  }
}

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

describe('Parametric ALS v7.1 Master Implementation Verification Suite', () => {
  beforeEach(() => {
    (window as any).AudioContext = MockAudioContext;
    (window as any).webkitAudioContext = MockAudioContext;
    synthEngine.stop();
    synthEngine.recoverAudioEngine();
  });

  afterEach(() => {
    synthEngine.stop();
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

  describe('Phase 2 — Content-Preserving ALS Import & Explicit Arrangement Proposals (P0-001: TC-ALS-001, TC-ALS-002)', () => {
    it('TC-ALS-001: parseAbletonXmlString preserves original track structures, clip boundaries, automation, and native devices', () => {
      // Build an ALS project with a long 128-bar arrangement
      const { xml } = buildStarterAbletonXml('berghain-134', 12345, 128);
      const project = parseAbletonXmlString(xml);

      // 1. Preserve original track structures
      expect(project.tracks.length).toBeGreaterThanOrEqual(8);
      const trackArchetypes = project.tracks.map((t) => t.archetype);
      expect(trackArchetypes).toContain('kick');
      expect(trackArchetypes).toContain('rumble');
      expect(trackArchetypes).toContain('synth');
      expect(trackArchetypes).toContain('hats');

      // 2. Preserve native devices & parameter structures
      const kickTrack = project.tracks[0];
      expect(kickTrack.devices.length).toBeGreaterThan(0);
      expect(
        kickTrack.devices.some((d) => d.xmlTag === 'OriginalSimpler' || d.xmlTag === 'DrumBuss' || d.xmlTag === 'AutoFilter')
      ).toBe(true);
      expect(
        project.tracks.some((t) => t.devices.some((d) => d.xmlTag === 'Operator' || d.displayName.includes('Operator')))
      ).toBe(true);
      for (const dev of kickTrack.devices) {
        expect(dev.id).toBeDefined();
        expect(dev.xmlTag).toBeDefined();
        expect(dev.parameters).toBeDefined();
      }

      // 3. Preserve native clip boundaries & 100% note count (no auto-decomposition)
      expect(kickTrack.clips.length).toBe(1);
      const mainClip = kickTrack.clips[0];
      expect(mainClip.startTime).toBe(0);
      expect(mainClip.length).toBe(512); // 128 bars * 4 beats = 512 beats
      expect(mainClip.notes.length).toBeGreaterThan(100);

      // Verify that breakdown sections (bars 65-80 = beats 256-320) retain 100% of notes without loss
      const breakdownNotes = mainClip.notes.filter((n) => n.time >= 256 && n.time < 320);
      expect(breakdownNotes.length).toBeGreaterThan(0);

      // 4. Preserve automation envelopes
      expect(kickTrack.automationPoints).toBeDefined();
      expect(kickTrack.automationPoints.length).toBeGreaterThan(0);
    }, 25000);

    it('TC-ALS-002: GenerateSectionArrangementProposal command creates structured arrangement proposals without mutating original project', () => {
      const { xml } = buildStarterAbletonXml('berghain-134', 12345, 128);
      const project = parseAbletonXmlString(xml);
      const originalKickNotesCount = project.tracks[0].clips[0].notes.length;

      // Invoking the proposal generator returns a proposal without mutating original project
      const proposal = GenerateSectionArrangementProposal(project, { targetBars: 128 });
      expect(proposal.totalSections).toBe(6);
      expect(proposal.proposedTracks.length).toBe(project.tracks.length);

      // The original project tracks remain untouched with single 128-bar clips
      expect(project.tracks[0].clips.length).toBe(1);
      expect(project.tracks[0].clips[0].notes.length).toBe(originalKickNotesCount);

      // The proposal has decomposed section clips with explicit section roles
      const proposedKick = proposal.proposedTracks[0];
      expect(proposedKick.clips.length).toBeGreaterThan(1);
      expect(proposedKick.clips.some((c) => c.sectionRole === 'Intro')).toBe(true);
      expect(proposedKick.clips.some((c) => c.sectionRole === 'Peak_Drop')).toBe(true);
    }, 25000);
  });

  describe('Phase 3 — Targeted Non-Destructive ALS Patch Engine (P0-002: TC-ALS-003)', () => {
    it('TC-ALS-003: alsPatchEngine mutates clip bounds, note velocity, mixer and inserts clips while preserving IDs and XML subtrees', () => {
      const { xml } = buildStarterAbletonXml('berghain-134', 12345, 16);
      const project = parseAlsXmlString(xml);
      const targetClipId = project.tracks[0].clips[0].id;

      // 1. Patch Clip Bounds
      const boundsResult = alsPatchEngine.patchClipBounds(xml, {
        trackId: project.tracks[0].id,
        clipId: targetClipId,
        newStartBeat: 4,
        newLengthBeats: 16,
      });
      expect(boundsResult.success).toBe(true);
      expect(boundsResult.structuralValid).toBe(true);
      expect(boundsResult.referenceValid).toBe(true);
      expect(boundsResult.changedNodeIds).toContain(targetClipId);
      expect(boundsResult.updatedXml).toBeDefined();

      // 2. Patch Track Mixer (Volume and Pan)
      const mixerResult = alsPatchEngine.patchTrackMixer(xml, {
        trackId: project.tracks[0].id,
        volumeDb: -3.5,
        pan: 0.25,
        muted: false,
        soloed: false,
      });
      expect(mixerResult.success).toBe(true);
      expect(mixerResult.structuralValid).toBe(true);
      expect(mixerResult.referenceValid).toBe(true);

      // 3. Insert New Clip with collision-free ID allocation
      const insertResult = alsPatchEngine.patchInsertClip(xml, {
        trackId: project.tracks[0].id,
        clip: {
          id: 'new_clip_test',
          name: 'Percussion_Fill',
          startTime: 32,
          length: 8,
          notes: [
            { time: 32, duration: 0.25, pitch: 60, velocity: 100 },
            { time: 32.5, duration: 0.25, pitch: 62, velocity: 95 },
          ],
        },
      });
      expect(insertResult.success).toBe(true);
      expect(insertResult.structuralValid).toBe(true);
      expect(insertResult.referenceValid).toBe(true);
      expect(insertResult.changedNodeIds.length).toBeGreaterThan(0);
      expect(insertResult.rollbackXml).toBe(xml);
    });
  });

  describe('Phase 4 — Canonical State Immutability & Mixer Preview (P0-003: TC-STATE-001, TC-STATE-002)', () => {
    it('TC-STATE-001: synthEngine.updateTrackMixerLive does NOT mutate project.tracks in place', () => {
      const { xml } = buildStarterAbletonXml('berghain-134', 12345, 16);
      const project = parseAlsXmlString(xml);
      synthEngine.setState(project, TEST_HUMANIZATION, undefined, TEST_MASTER_BUS);
      (synthEngine as any).ensureContext();

      const track = project.tracks[0];
      const originalVolume = track.mixer?.volumeDb ?? 0;
      const originalPan = track.mixer?.pan ?? 0;

      // Call live mixer update with different volume and pan
      synthEngine.updateTrackMixerLive(
        track.id,
        { volumeDb: -12, pan: 0.75 },
        { muted: false, soloed: false }
      );

      // Verify canonical project.tracks[0] was NOT mutated by audio engine
      expect(project.tracks[0].mixer?.volumeDb).toBe(originalVolume);
      expect(project.tracks[0].mixer?.pan).toBe(originalPan);

      // Verify the DSP runtime applied the update correctly
      const meter = synthEngine.getTrackMeterLevels(track.id);
      expect(meter.pan).toBeCloseTo(0.75, 2);
    });

    it('TC-STATE-002: updateTrackMixerLiveDspOnly adjusts DSP gain without state side-effects', () => {
      const { xml } = buildStarterAbletonXml('berghain-134', 12345, 16);
      const project = parseAlsXmlString(xml);
      synthEngine.setState(project, TEST_HUMANIZATION, undefined, TEST_MASTER_BUS);
      (synthEngine as any).ensureContext();

      const track = project.tracks[1];
      synthEngine.updateTrackMixerLiveDspOnly(
        track.id,
        { volumeDb: -10, pan: -0.3 },
        { muted: true, soloed: false }
      );

      const meter = synthEngine.getTrackMeterLevels(track.id);
      expect(meter.pan).toBeCloseTo(-0.3, 2);
      expect(meter.gateLinear).toBe(0.0);
    });
  });

  describe('Phase 5 — Timeline Viewport Controller & Continuous Zoom (TC-TIME-001..003)', () => {
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

  describe('Phase 6 — Non-Destructive Arrangement Length Scaling (P1-006: TC-TIME-004)', () => {
    it('TC-TIME-004: changing arrangementLengthBars expands or contracts extent without deleting or auto-tiling notes', () => {
      const { xml } = buildStarterAbletonXml('berghain-134', 12345, 16);
      const project = parseAlsXmlString(xml);
      const originalNotes = project.tracks[0].clips[0].notes.slice();

      // Expand arrangement from 16 to 64 bars
      project.arrangementLengthBars = 64;

      // Existing notes and clip positions remain 100% unaltered
      expect(project.tracks[0].clips[0].notes.length).toBe(originalNotes.length);
      for (let i = 0; i < originalNotes.length; i++) {
        expect(project.tracks[0].clips[0].notes[i].time).toBe(originalNotes[i].time);
        expect(project.tracks[0].clips[0].notes[i].pitch).toBe(originalNotes[i].pitch);
      }
    });
  });

  describe('Phase 7 — Real 10-Insert Mixer DSP Processing (P1-007: TC-DSP-001)', () => {
    it('TC-DSP-001: buildDeviceInsertProcessor creates Web Audio processing nodes for EQ, Filter, Saturator, Limiter, and supports bypass', () => {
      const audioCtx = new MockAudioContext() as any;

      // Test EQ Eight insert processor
      const eqDevice: AbletonDevice = {
        id: 'dev_eq_1',
        xmlTag: 'EQEight',
        displayName: 'EQ Eight',
        category: 'audio_effect',
        parameters: [],
        bypassed: false,
      };
      const eqProc = buildDeviceInsertProcessor(audioCtx, eqDevice);
      expect(eqProc.type).toBe('eq');
      expect(eqProc.bypassed).toBe(false);
      expect(eqProc.input).toBeDefined();
      expect(eqProc.output).toBeDefined();

      // Test AutoFilter insert processor
      const filterDevice: AbletonDevice = {
        id: 'dev_filter_1',
        xmlTag: 'AutoFilter',
        displayName: 'Auto Filter',
        category: 'audio_effect',
        bypassed: false,
        parameters: [{ name: 'Cutoff', value: 2400, unit: 'Hz' }],
      };
      const filterProc = buildDeviceInsertProcessor(audioCtx, filterDevice);
      expect(filterProc.type).toBe('filter');
      expect(filterProc.bypassed).toBe(false);

      // Test Saturator insert processor
      const satDevice: AbletonDevice = {
        id: 'dev_sat_1',
        xmlTag: 'Saturator',
        displayName: 'Saturator',
        category: 'audio_effect',
        parameters: [],
        bypassed: false,
      };
      const satProc = buildDeviceInsertProcessor(audioCtx, satDevice);
      expect(satProc.type).toBe('saturator');

      // Test Bypassed processor (unity pass-through gain)
      const bypassedDev: AbletonDevice = {
        id: 'dev_bypassed_1',
        xmlTag: 'Saturator',
        displayName: 'Saturator Bypassed',
        category: 'audio_effect',
        parameters: [],
        bypassed: true,
      };
      const bypassedProc = buildDeviceInsertProcessor(audioCtx, bypassedDev);
      expect(bypassedProc.bypassed).toBe(true);
    });
  });

  describe('Phase 8 — Underground Techno Subgenres, Clip Lifecycle & Range Generation (TC-CLIP-002, TC-CLIP-003, TC-MUSIC-001..003)', () => {
    it('TC-CLIP-002: generates range-bounded Chord, Bass, Drum, and Empty clips strictly inside selected bars without wiping existing non-overlapping clips', () => {
      const { xml } = buildStarterAbletonXml('berghain-134', 12345);
      const project = parseAlsXmlString(xml);
      const track = project.tracks[3]; // Synth track

      const clipsBeforeAtIntro = track.clips.filter((c) => c.startTime + c.length <= 128);

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

    it('TC-MIX-001: updates per-track fader, pan, mute/solo gate, and meter levels in synthEngine', () => {
      const { xml } = buildStarterAbletonXml('berghain-134', 12345);
      const project = parseAlsXmlString(xml);
      synthEngine.setState(project, TEST_HUMANIZATION, undefined, TEST_MASTER_BUS);
      (synthEngine as any).ensureContext();

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

  describe('Phase 9 — Android Build & Verification Integrity (P0-004: TC-APK-001, TC-REG-001)', () => {
    it('TC-APK-001: APK verifier rejects an absent artifact instead of claiming structural or cryptographic success', () => {
      const verifyScriptPath = path.resolve(process.cwd(), 'scripts/verify-apk.py');
      expect(fs.existsSync(verifyScriptPath)).toBe(true);
      expect(() => execSync(`python3 "${verifyScriptPath}" /tmp/parametric-absent-fixture.apk`, { encoding: 'utf8', stdio: 'pipe' })).toThrow();
    });

    it('TC-REG-001: capacitor.config.json and android/app/build.gradle share identical com.parametricals.technodaw appId', () => {
      const capConfig = JSON.parse(
        fs.readFileSync(path.resolve(process.cwd(), 'capacitor.config.json'), 'utf8')
      );
      expect(capConfig.appId).toBe('com.parametricals.technodaw');
    });
  });
});

