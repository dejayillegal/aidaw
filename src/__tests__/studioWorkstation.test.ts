// @vitest-environment jsdom
import { describe, expect, it, beforeEach } from 'vitest';
import {
  applySpectralAutoDuckToTrackXml,
  buildStarterAbletonXml,
  compileRehumanizedAlsXml,
  parseAlsXmlString,
  validateAlsStructuralIntegrity,
} from '../engine/alsXmlEngine';
import {
  commitVcaGainsToTrackFaders,
  composeEffectiveTrackGain,
  insertDeviceIntoChannelStrip,
  reorderChannelInsertDevice,
  toggleChannelInsertBypass,
} from '../engine/channelStripEngine';
import {
  applyAndVerifyStageECalibration,
  buildStageCCalibrationProposal,
  encodeVerifiedWavArrayBuffer,
  executeMasterExport20,
  inspectWavBinaryHeader,
  loadMasterExportPresetsFromStorage,
  measureAudioSignalMetrics,
  runStageAStaticAnalysis,
  runStageBAudioMeasurement,
  saveCustomMasterExportPreset,
} from '../engine/masteringEngine';
import {
  computeSelectedTrackAnalysisData,
  synthesizeDeterministicStereoPcm,
  waveformCacheService,
} from '../engine/webAudioSynth';
import { ProjectQueueService } from '../services/projectQueueService';
import {
  applyAudioStripSilenceToTrack,
  applyMidiGhostNotePruning,
  applyNoteEditWithMode,
  createTrackTakeSnapshot,
  deleteNoteWithEditMode,
  spotPositionToBeat,
  StudioCommandBus,
  STUDIO_COMMAND_DEFINITIONS,
  switchActiveTrackTake,
  upsertMemoryLocationMarker,
} from '../services/commandBus';
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

describe('Parametric ALS Studio Workstation & SoundCraft Architecture v1.1 Gates & Scenarios', () => {
  beforeEach(() => {
    waveformCacheService.clear();
  });

  it('Scenario 1: Single-Project Regression — starter 8-track suite parses, compiles, and validates .als & .wav', () => {
    const { xml } = buildStarterAbletonXml('berghain-134', 12345);
    const project = parseAlsXmlString(xml);
    expect(project.tracks.length).toBeGreaterThanOrEqual(8);

    const compiledXml = compileRehumanizedAlsXml(project, TEST_HUMANIZATION);
    const validation = validateAlsStructuralIntegrity(
      compiledXml,
      project.tracks.length,
      project.arrangementLengthBars
    );
    expect(validation.valid).toBe(true);

    const pcm = synthesizeDeterministicStereoPcm(
      project,
      TEST_HUMANIZATION,
      TEST_MASTER_BUS,
      44100,
      4
    );
    expect(pcm.left.length).toBeGreaterThan(44100);
  });

  it('Scenario 2 (Gate 1): User Device Preservation — Smart Calibration & Spectral Auto-Duck never overwrite user-created EQEight or Compressor2', async () => {
    const { xml } = buildStarterAbletonXml('berghain-134', 22222);
    const rumbleTrack = parseAlsXmlString(xml).tracks.find((t) => t.archetype === 'rumble')!;

    // Apply Spectral Auto-Duck twice and verify user-created EQEight/Compressor2 nodes are preserved
    const duckedXml = applySpectralAutoDuckToTrackXml(
      xml,
      rumbleTrack.id,
      rumbleTrack.name,
      {
        enabled: true,
        sourceTrackId: '1',
        notchFreqHz: 55,
        notchGainDb: -9.5,
        notchQ: 3.0,
        sidechainRatio: 4.8,
        sidechainThresholdDb: -22,
        sidechainAttackMs: 1.5,
        sidechainReleaseMs: 115,
      },
      '1'
    );

    const afterDuckProject = parseAlsXmlString(duckedXml);
    const updatedRumble = afterDuckProject.tracks.find((t) => t.archetype === 'rumble')!;
    const userDevicesAfterDuck = updatedRumble.devices.filter((d) => d.isUserCreated);
    expect(userDevicesAfterDuck.length).toBeGreaterThan(0);

    // Run Stage A -> B -> C -> E Smart Calibration and verify user devices remain 100% intact
    const stageA = runStageAStaticAnalysis(afterDuckProject);
    const stageB = await runStageBAudioMeasurement(
      afterDuckProject,
      TEST_HUMANIZATION,
      TEST_MASTER_BUS
    );
    const proposal = buildStageCCalibrationProposal(afterDuckProject, stageA, stageB);
    const stageE = await applyAndVerifyStageECalibration(
      afterDuckProject,
      proposal,
      TEST_HUMANIZATION,
      TEST_MASTER_BUS
    );

    expect(stageE.verificationReport.userDevicesIntact).toBe(true);
    expect(stageE.verificationReport.alsStructuralValid).toBe(true);
  });

  it('Scenario 3 (Gate 3): Multi-File Isolation — importing A, B, C and mutating B leaves A and C untouched', async () => {
    const queue = new ProjectQueueService();
    const xmlA = buildStarterAbletonXml('berghain-134', 101).xml;
    const xmlB = buildStarterAbletonXml('tresor-138', 202).xml;
    const xmlC = buildStarterAbletonXml('ostgut-128', 303).xml;

    const itemA = await queue.enqueueProjectFromXml('Project_A.als', xmlA);
    const itemB = await queue.enqueueProjectFromXml('Project_B.als', xmlB);
    const itemC = await queue.enqueueProjectFromXml('Project_C.als', xmlC);

    const originalATempo = itemA.workingProjectState.tempo;
    const originalCTempo = itemC.workingProjectState.tempo;

    // Switch to B and mutate B's tempo and track fader
    const stateB = queue.switchActiveProject(itemB.queueId)!;
    stateB.tempo = 152;
    stateB.tracks[0].mixer.volumeDb = -9.5;
    queue.updateWorkingProjectState(itemB.queueId, stateB);

    const reloadedA = queue.getItem(itemA.queueId)!;
    const reloadedB = queue.getItem(itemB.queueId)!;
    const reloadedC = queue.getItem(itemC.queueId)!;

    expect(reloadedA.workingProjectState.tempo).toBe(originalATempo);
    expect(reloadedC.workingProjectState.tempo).toBe(originalCTempo);
    expect(reloadedB.workingProjectState.tempo).toBe(152);
    expect(reloadedB.workingProjectState.tracks[0].mixer.volumeDb).toBe(-9.5);
    expect(reloadedA.workingProjectState.tracks[0].mixer.volumeDb).not.toBe(-9.5);
  });

  it('Scenario 4 (Gate 3): Queue Cancellation & Recovery — cancelling item 3 preserves 1-2 and allows retry', async () => {
    const queue = new ProjectQueueService();
    const items = [];
    for (let i = 1; i <= 5; i++) {
      const { xml } = buildStarterAbletonXml('berghain-134', 1000 + i);
      items.push(await queue.enqueueProjectFromXml(`Batch_${i}.als`, xml));
    }

    // Calibrate 1 and 2
    await queue.calibrateQueueItem(items[0].queueId, TEST_HUMANIZATION, TEST_MASTER_BUS);
    await queue.calibrateQueueItem(items[1].queueId, TEST_HUMANIZATION, TEST_MASTER_BUS);

    // Cancel item 3
    queue.cancelQueueItem(items[2].queueId);

    expect(queue.getItem(items[0].queueId)?.state).toBe('preview_ready');
    expect(queue.getItem(items[1].queueId)?.state).toBe('preview_ready');
    expect(queue.getItem(items[2].queueId)?.state).toBe('cancelled');
    expect(queue.getItem(items[3].queueId)?.state).toBe('ready');
    expect(queue.getItem(items[4].queueId)?.state).toBe('ready');

    // Retry item 3
    const retried = queue.retryQueueItem(items[2].queueId);
    expect(retried?.state).toBe('ready');
  }, 20000);

  it('Scenario 5 (Gate 2): Honest Audio Measurement — BS.1770-4 LUFS & 4x True Peak on renderable projects, and explicit Audio Measurement Unavailable on empty/unrenderable projects', async () => {
    const { xml } = buildStarterAbletonXml('berghain-134', 555);
    const project = parseAlsXmlString(xml);

    const measured = await runStageBAudioMeasurement(
      project,
      TEST_HUMANIZATION,
      TEST_MASTER_BUS
    );
    expect(measured.status).toBe('measured');
    expect(measured.integratedLufs).not.toBeNull();
    expect(measured.truePeakDbtp).not.toBeNull();
    expect(measured.truePeakDbtp!).toBeGreaterThanOrEqual(measured.samplePeakDbfs! - 0.05);

    // Now test an unrenderable project (0 MIDI notes across all tracks)
    const emptyProject = JSON.parse(JSON.stringify(project));
    emptyProject.tracks.forEach((t: any) => {
      t.clips = [];
    });
    const unrenderableResult = await runStageBAudioMeasurement(
      emptyProject,
      TEST_HUMANIZATION,
      TEST_MASTER_BUS
    );
    expect(unrenderableResult.status).toBe('unavailable');
    expect(unrenderableResult.integratedLufs).toBeNull();
    expect(unrenderableResult.unavailableReason).toContain('Audio Measurement Unavailable');
  });

  it('Scenario 6: Selected-Track Strip Synchronization & Caching — cache hits on identical revision and separates Layer A MIDI heatmap from Layer B waveform', () => {
    const { xml } = buildStarterAbletonXml('berghain-134', 666);
    const project = parseAlsXmlString(xml);
    const acidTrack = project.tracks.find((t) => t.archetype === 'acid') || project.tracks[0];

    const firstPass = computeSelectedTrackAnalysisData(
      project,
      acidTrack,
      TEST_HUMANIZATION,
      TEST_MASTER_BUS,
      16,
      256
    );
    const secondPass = computeSelectedTrackAnalysisData(
      project,
      acidTrack,
      TEST_HUMANIZATION,
      TEST_MASTER_BUS,
      16,
      256
    );

    // Must return the exact cached instance without recomputing PCM
    expect(secondPass).toBe(firstPass);
    expect(firstPass.midiHeatmapBins.length).toBe(16 * 16);
    expect(firstPass.waveformPeaksMax.length).toBe(256);
    expect(firstPass.isMeasuredAudio).toBe(true);
  });

  it('Scenario 7 (Gate 2): Master Export Presets & Binary Verification — 16-bit, 24-bit, and 32-bit IEEE Float WAV headers at 44.1, 48, and 96 kHz', async () => {
    // Verify preset persistence
    const saved = saveCustomMasterExportPreset({
      name: 'Test 96k Float Preset',
      sampleRate: 96000,
      bitDepth: 32,
      sampleFormat: 'ieee_float',
      targetIntegratedLufs: -9.0,
      truePeakCeilingDbtp: -1.0,
      normalize: true,
      dither: 'none',
    });
    expect(saved.some((p) => p.name === 'Test 96k Float Preset')).toBe(true);
    expect(
      loadMasterExportPresetsFromStorage().some((p) => p.name === 'Test 96k Float Preset')
    ).toBe(true);

    // Verify binary RIFF headers across 16-bit, 24-bit, and 32-bit float at 44.1k, 48k, 96k
    const testFrames = 2048;
    const left = new Float32Array(testFrames);
    const right = new Float32Array(testFrames);
    for (let i = 0; i < testFrames; i++) {
      left[i] = Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.5;
      right[i] = Math.cos((2 * Math.PI * 440 * i) / 48000) * 0.5;
    }

    const configs: {
      sr: 44100 | 48000 | 96000;
      bd: 16 | 24 | 32;
      fmt: 'pcm_int' | 'ieee_float';
      expectedTag: 1 | 3;
    }[] = [
      { sr: 44100, bd: 16, fmt: 'pcm_int', expectedTag: 1 },
      { sr: 48000, bd: 24, fmt: 'pcm_int', expectedTag: 1 },
      { sr: 96000, bd: 32, fmt: 'ieee_float', expectedTag: 3 },
    ];

    for (const cfg of configs) {
      const buf = encodeVerifiedWavArrayBuffer(left, right, cfg.sr, cfg.bd, cfg.fmt, 'tpdf');
      const header = inspectWavBinaryHeader(buf);
      expect(header.validRiffWave).toBe(true);
      expect(header.audioFormatTag).toBe(cfg.expectedTag);
      expect(header.numChannels).toBe(2);
      expect(header.sampleRate).toBe(cfg.sr);
      expect(header.bitsPerSample).toBe(cfg.bd);
      expect(header.blockAlign).toBe(2 * (cfg.bd / 8));
      expect(header.byteRate).toBe(cfg.sr * 2 * (cfg.bd / 8));
      expect(header.totalByteLength).toBe(44 + testFrames * 2 * (cfg.bd / 8));
    }

    // Verify Two-Pass Master Export 2.0 respects truePeakCeilingDbtp
    const { xml } = buildStarterAbletonXml('berghain-134', 777);
    const project = parseAlsXmlString(xml);
    project.arrangementLengthBars = 4;
    const exportRes = await executeMasterExport20(project, TEST_HUMANIZATION, TEST_MASTER_BUS, {
      id: 'test_preset',
      version: 2,
      name: 'Club Master',
      sampleRate: 48000,
      bitDepth: 24,
      sampleFormat: 'pcm_int',
      targetIntegratedLufs: -8.5,
      truePeakCeilingDbtp: -1.0,
      normalize: true,
      dither: 'tpdf',
      createdAt: new Date().toISOString(),
    });
    expect(exportRes.verification.wavHeaderValid).toBe(true);
    expect(exportRes.verification.postMasterTruePeakDbtp).toBeLessThanOrEqual(-0.9);
  });

  it('Scenario 8 (Gate 4): VCA Non-Destructive Behavior — moving VCA group fader scales effective gain without overwriting track base fader', () => {
    const { xml } = buildStarterAbletonXml('berghain-134', 888);
    const project = parseAlsXmlString(xml);
    const kickTrack = project.tracks[0];
    const originalBaseDb = kickTrack.mixer.volumeDb;

    // Set Drums VCA to -6.0 dB
    project.vcaGroups = project.vcaGroups!.map((g) =>
      g.id === 'drums' || g.id === 'drums_vca' ? { ...g, gainDb: -6.0 } : g
    );

    const composed = composeEffectiveTrackGain(kickTrack, project.tracks, project.vcaGroups);
    expect(kickTrack.mixer.volumeDb).toBe(originalBaseDb); // Base fader untouched!
    expect(composed.baseVolumeDb).toBe(originalBaseDb);
    expect(composed.vcaGainDb).toBe(-6.0);
    expect(composed.effectiveVolumeDb).toBeCloseTo(originalBaseDb - 6.0, 2);

    // Explicit Commit VCA Gains to Track Faders
    const committed = commitVcaGainsToTrackFaders(project.tracks, project.vcaGroups);
    expect(committed.tracks[0].mixer.volumeDb).toBeCloseTo(originalBaseDb - 6.0, 1);
    expect(
      committed.vcaGroups.find((g) => g.id === 'drums' || g.id === 'drums_vca')?.gainDb
    ).toBe(0);
  });

  it('Scenario 9 (Gate 4): 10-Slot Channel Strip — inserting, bypassing, and reordering devices changes rendered audio and enforces 10-slot limit', () => {
    const { xml } = buildStarterAbletonXml('berghain-134', 999);
    const project = parseAlsXmlString(xml);
    const track = project.tracks[0];

    const beforePcm = synthesizeDeterministicStereoPcm(
      project,
      TEST_HUMANIZATION,
      TEST_MASTER_BUS,
      24000,
      4,
      track.id
    );
    const beforeMetrics = measureAudioSignalMetrics(beforePcm.left, beforePcm.right, 24000);

    // Insert a Saturator into Slot 0
    const inserted = insertDeviceIntoChannelStrip(track, 'Saturator', 0);
    expect(inserted.error).toBeUndefined();
    project.tracks[0] = inserted.updatedTrack;

    const afterInsertPcm = synthesizeDeterministicStereoPcm(
      project,
      TEST_HUMANIZATION,
      TEST_MASTER_BUS,
      24000,
      4,
      track.id
    );
    const afterInsertMetrics = measureAudioSignalMetrics(
      afterInsertPcm.left,
      afterInsertPcm.right,
      24000
    );
    expect(afterInsertMetrics.integratedLufs).not.toBe(beforeMetrics.integratedLufs);

    // Bypass the inserted Saturator and verify audio returns to original level
    const newDevId = project.tracks[0].devices[0].id;
    project.tracks[0] = toggleChannelInsertBypass(project.tracks[0], newDevId);
    const bypassedPcm = synthesizeDeterministicStereoPcm(
      project,
      TEST_HUMANIZATION,
      TEST_MASTER_BUS,
      24000,
      4,
      track.id
    );
    const bypassedMetrics = measureAudioSignalMetrics(
      bypassedPcm.left,
      bypassedPcm.right,
      24000
    );
    expect(bypassedMetrics.integratedLufs).toBeCloseTo(beforeMetrics.integratedLufs, 2);

    // Reorder devices
    const firstId = project.tracks[0].devices[0].id;
    project.tracks[0] = reorderChannelInsertDevice(project.tracks[0], 0, 1);
    expect(project.tracks[0].devices[1].id).toBe(firstId);
  });

  it('Scenario 10 (Gate 5): Edit Modes (Grid, Slip, Shuffle, Spot) & Undo/Redo determinism', () => {
    const { xml } = buildStarterAbletonXml('berghain-134', 1010);
    let project = parseAlsXmlString(xml);
    const bus = new StudioCommandBus();
    const trackId = project.tracks[0].id;
    const firstNote = project.tracks[0].clips[0].notes[0];
    const secondNote = project.tracks[0].clips[0].notes[1];

    // 1. Slip mode: sub-grid unquantized placement
    project = bus.executeMutation('q1', 'Slip Note', 'edit_mode', project, (draft) =>
      applyNoteEditWithMode(draft, trackId, 0, firstNote.id, 0.137, 'slip', 0.25)
    );
    expect(
      project.tracks[0].clips[0].notes.find((n) => n.id === firstNote.id)?.time
    ).toBeCloseTo(0.137, 3);

    // Undo Slip edit and verify exact restoration
    project = bus.undo('q1')!;
    expect(
      project.tracks[0].clips[0].notes.find((n) => n.id === firstNote.id)?.time
    ).toBeCloseTo(firstNote.time, 3);

    // 2. Shuffle mode: deleting firstNote shifts subsequent notes left by firstNote.duration
    const secondNoteBefore = secondNote.time;
    project = bus.executeMutation('q1', 'Shuffle Delete', 'edit_mode', project, (draft) =>
      deleteNoteWithEditMode(draft, trackId, 0, firstNote.id, 'shuffle')
    );
    const secondNoteAfter = project.tracks[0].clips[0].notes.find(
      (n) => n.id === secondNote.id
    )!.time;
    expect(secondNoteAfter).toBeCloseTo(secondNoteBefore - firstNote.duration, 3);

    // 3. Spot mode: Bar 3, Beat 2, 16th 3 => (3-1)*4 + (2-1) + (3-1)*0.25 = 9.5 beats
    const spotBeat = spotPositionToBeat(3, 2, 3);
    expect(spotBeat).toBe(9.5);
  });

  it('Scenario 11 (Gate 6): Extensible Track Comping (4+ takes) & Separate Audio Strip Silence vs MIDI Ghost-Note Pruning', () => {
    const { xml } = buildStarterAbletonXml('berghain-134', 1111);
    let project = parseAlsXmlString(xml);
    const hatsTrack = project.tracks.find((t) => t.archetype === 'hats')!;

    // Create 4 takes (Take A initial + Take B, C, D)
    project = createTrackTakeSnapshot(project, hatsTrack.id, 'Take B — Sparse');
    project = createTrackTakeSnapshot(project, hatsTrack.id, 'Take C — Dense');
    project = createTrackTakeSnapshot(project, hatsTrack.id, 'Take D — Peak');

    const updatedHats = project.tracks.find((t) => t.id === hatsTrack.id)!;
    expect(updatedHats.takes!.length).toBeGreaterThanOrEqual(4);

    // Apply MIDI Ghost-Note Pruning on Take D
    const notesBeforePrune = updatedHats.clips[0].notes.length;
    project = applyMidiGhostNotePruning(project, hatsTrack.id, {
      velocityThreshold: 75,
      probabilityThreshold: 0.8,
      minDurationBeats: 0.125,
      protectDownbeats: true,
      protectChordTones: true,
      protectAccents: true,
    });
    const afterPruneTrack = project.tracks.find((t) => t.id === hatsTrack.id)!;
    expect(afterPruneTrack.clips[0].notes.length).toBeLessThan(notesBeforePrune);

    // Switch back to Take A and verify original notes are preserved in Take A
    const takeAId = afterPruneTrack.takes![0].id;
    project = switchActiveTrackTake(project, hatsTrack.id, takeAId);
    expect(
      project.tracks.find((t) => t.id === hatsTrack.id)!.clips[0].notes.length
    ).toBe(notesBeforePrune);

    // Apply Audio Strip Silence independently
    project = applyAudioStripSilenceToTrack(
      project,
      hatsTrack.id,
      TEST_HUMANIZATION,
      TEST_MASTER_BUS,
      {
        thresholdOpenDb: -28,
        thresholdCloseDb: -32,
        minActiveDurationMs: 50,
        preAttackPadMs: 10,
        postReleasePadMs: 25,
      }
    );
    const activeTakeAfterGate = project.tracks
      .find((t) => t.id === hatsTrack.id)!
      .takes!.find((tk) => tk.id === takeAId)!;
    expect(activeTakeAfterGate.activeAudioRegions).toBeDefined();
  });

  it('Scenario 12: Command Palette Registry & Memory Location XML Persistence', () => {
    expect(STUDIO_COMMAND_DEFINITIONS.length).toBeGreaterThanOrEqual(12);
    const { xml } = buildStarterAbletonXml('berghain-134', 1212);
    let project = parseAlsXmlString(xml);

    project = upsertMemoryLocationMarker(project, 4, 'Breakdown Drop', 32);
    expect(project.memoryLocations?.some((l) => l.number === 4 && l.beat === 32)).toBe(true);
    expect(project.rawXml).toContain('Breakdown Drop');
  });
});
