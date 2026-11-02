// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildStarterAbletonXml, parseAlsXmlString, syncTrackClipsToXml, TechnoHeuristicEngine } from '../engine/alsXmlEngine';
import { StudioCommandBus } from '../services/commandBus';
import { decodeProjectSnapshot, encodeProjectSnapshot } from '../services/projectSnapshotService';
const humanization = { cutoffHz: 145, microTimingMaxShiftBeats: 0.01, velocityVariancePct: 0.08, ghostVelocityMin: 20, ghostVelocityMax: 45, lfoRateHz: 0.1, lfoDepth: 0.4, macroTransition: 42 };
const master = { masterVolumeDb: -2, glueCompressionDrive: 0.3, reverbDecaySec: 3, reverbReturnLevel: 0.3, delayFeedback: 0.4, delayReturnLevel: 0.2, subBassMonoCutoffHz: 120 };
const transport = { loopEnabled: false, loopStartBar: 1, loopLengthBars: 4, metronomeEnabled: false, followPlayhead: true, showAutomationLanes: true };
const fixture = () => parseAlsXmlString(buildStarterAbletonXml('berghain-134', 777, 4).xml);

describe('G1 reproduced command and recovery defects', () => {
  it('history inspection cannot mutate future undo/redo snapshots', () => {
    const p = fixture(); const bus = new StudioCommandBus();
    bus.executeMutation('p', 'mute', 'mixer', p, d => { d.tracks[0].muted = true; return d; });
    bus.getHistory('p')[0].afterState.tracks[0].clips = [];
    bus.undo('p');
    expect(bus.redo('p')!.tracks[0].clips).toEqual(p.tracks[0].clips);
  });
  it('rejects wrong-typed required audio controls and non-boolean transport flags on reopen', () => {
    const input = JSON.parse(encodeProjectSnapshot(fixture(), humanization, master, transport));
    for (const corrupt of [
      (v: any) => { (v.project.audioSettings || v.audioSettings).humanization.velocityVariancePct = 'bad'; },
      (v: any) => { (v.project.audioSettings || v.audioSettings).masterBus.delayFeedback = 'bad'; },
      (v: any) => { (v.project.audioSettings || v.audioSettings).transport.loopEnabled = 'false'; },
    ]) {
      const copy = structuredClone(input); corrupt(copy);
      expect(() => decodeProjectSnapshot(JSON.stringify(copy))).toThrow();
    }
  });
  it('humanization preserves every independent clip, note identity, pitch and probability', () => {
    const p = fixture(); const track = p.tracks.find(t => t.archetype === 'synth')!;
    const note = { ...track.clips[0].notes[0], id: 'kept', time: 1.25, quantizedTime: 1.25, pitch: 61, probability: 0.5 };
    const clips = [{ ...track.clips[0], id: 'a', startTime: 0, endTime: 4, length: 4, notes: [note] },
      { ...track.clips[0], id: 'b', startTime: 8, endTime: 9, length: 1, notes: [{ ...note, id: 'later', time: 8.5, quantizedTime: 8.5 }] }];
    const xml = syncTrackClipsToXml(p.rawXmlModified, track.id, clips);
    const result = parseAlsXmlString(TechnoHeuristicEngine.rehumanizeAllProjectTracks(xml, p.rootKey, humanization, 123, undefined, 4));
    const actual = result.tracks.find(t => t.id === track.id)!.clips;
    expect(actual.map(c => [c.id, c.startTime, c.length])).toEqual(clips.map(c => [c.id, c.startTime, c.length]));
    expect(actual.flatMap(c => c.notes.map(n => [n.id, n.pitch, n.probability]))).toEqual([['kept',61,0.5],['later',61,0.5]]);
  });
});

it('migrates v1 project audio settings into a single v2 project-owned representation', () => {
  const p = fixture();
  const legacy = { format: 'parametric-als-daw', version: 1, project: p, audioSettings: { humanization, masterBus: master, transport } };
  const restored = decodeProjectSnapshot(JSON.stringify(legacy));
  expect(restored.version).toBe(2);
  expect(restored.audioSettings).toBe(restored.project.audioSettings);
  const encoded = JSON.parse(encodeProjectSnapshot(restored.project, humanization, master, transport));
  expect(encoded.version).toBe(2); expect(encoded.audioSettings).toBeUndefined();
  expect(encoded.project.audioSettings.masterBus).toEqual(master);
});

it('master/transport/humanization edits are atomic history operations and survive native-file/metadata round trips', () => {
  const p = fixture(); p.audioSettings = { humanization, masterBus: master, transport };
  const before = JSON.stringify(p); const bus = new StudioCommandBus();
  const edited = bus.executeMutation('settings', 'master', 'mixer', p, draft => {
    draft.audioSettings!.masterBus.masterVolumeDb = -7;
    draft.audioSettings!.humanization.swingStrength = 31;
    draft.audioSettings!.transport.loopEnabled = true;
    return draft;
  });
  expect(JSON.stringify(p)).toBe(before);
  expect(parseAlsXmlString(edited.rawXmlModified).audioSettings).toEqual(edited.audioSettings);
  expect(bus.undo('settings')!.audioSettings).toEqual(p.audioSettings);
  expect(bus.redo('settings')!.audioSettings!.masterBus.masterVolumeDb).toBe(-7);
  const oldHistory = bus.getHistory('settings').length;
  expect(() => bus.executeMutation('settings', 'bad', 'mixer', edited, d => {
    d.audioSettings!.masterBus.delayFeedback = NaN; return d;
  })).toThrow();
  expect(bus.getHistory('settings')).toHaveLength(oldHistory);
});

it('keeps new user tracks and their independent clips editable and reloadable with explicit native-device limits', async () => {
  const { createUserTrackFromRole } = await import('../engine/compositionIntelligenceEngine');
  const p = fixture(); const track = createUserTrackFromRole('E2', p.tracks.length);
  track.clips = [{ id: 'user-clip', name: 'User', startTime: 3, length: 0.5,
    notes: [{ ...p.tracks[0].clips[0].notes[0], id: 'user-note', time: 3.125, quantizedTime: 3.125 }] }];
  const edited = new StudioCommandBus().executeMutation('track', 'add', 'clip_edit', p, d => ({ ...d, tracks: [...d.tracks, track] }));
  const restored = parseAlsXmlString(edited.rawXmlModified);
  const actual = restored.tracks.find(t => t.id === track.id)!;
  expect(actual.devices).toEqual(track.devices);
  expect(actual.clips.map(c => [c.id,c.startTime,c.length])).toEqual([['user-clip',3,0.5]]);
  expect(restored.compatibilityWarnings!.some(w => w.includes(track.id) && w.includes('browser device'))).toBe(true);
  const reopened = decodeProjectSnapshot(encodeProjectSnapshot(edited, humanization, master, transport));
  expect(reopened.project.tracks.find(t => t.id === track.id)).toEqual(edited.tracks.find(t => t.id === track.id));
});

it('humanization is repeatable without accumulating timing or velocity changes', () => {
  const p = fixture(); const first = TechnoHeuristicEngine.rehumanizeAllProjectTracks(p.rawXmlModified, p.rootKey, humanization, 99, undefined, 4);
  const second = TechnoHeuristicEngine.rehumanizeAllProjectTracks(first, p.rootKey, humanization, 99, undefined, 4);
  expect(second).toBe(first);
});

it('rejects stale cross-project and revision commands before mutating state or history', () => {
  const p = fixture(); const before = JSON.stringify(p); const bus = new StudioCommandBus();
  for (const context of [{ activeProjectQueueId: 'new' }, { activeProjectQueueId: 'old', expectedRevision: 999 }]) {
    expect(() => bus.executeMutation('old', 'stale async callback', 'clip_edit', p, d => {
      d.tracks = []; return d;
    }, context)).toThrow(/COMMAND_STALE/);
  }
  expect(JSON.stringify(p)).toBe(before); expect(bus.canUndo('old')).toBe(false);
});

it('queue snapshots are isolated while preserving immutable export blobs and domain revision', async () => {
  const { ProjectQueueService } = await import('../services/projectQueueService');
  const queue = new ProjectQueueService(); const p = fixture(); p.projectRevision = 27;
  const record = await queue.enqueueProjectFromXml(p.fileName, p.rawXmlModified);
  queue.updateWorkingProjectState(record.queueId, p);
  queue.getAllItems()[0].workingProjectState.tracks = [];
  expect(queue.getItem(record.queueId)!.workingProjectState.tracks).toEqual(p.tracks);
  expect(queue.getItem(record.queueId)!.workingProjectState.projectRevision).toBe(27);
  const blob = new Blob(['midi'], { type: 'audio/midi' });
  const midi = queue.enqueueMidiClip('clip','track','clip.mid',blob,blob.size,p);
  expect(queue.getItem(midi.queueId)!.exportedMidiBlob).toBe(blob);
});

it('measures real SHA-256 rather than inventing artifact hashes', async () => {
  const { computeSha256Hex } = await import('../engine/alsXmlEngine');
  expect(await computeSha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  const { ProjectQueueService } = await import('../services/projectQueueService');
  const queue = new ProjectQueueService();
  const record = queue.enqueueMidiClip('clip','track','clip.mid',new Blob(['abc']),3,fixture());
  expect(record.binaryChecksumSha256).toBe('');
  await queue.awaitArtifactChecksum(record.queueId);
  expect(queue.getItem(record.queueId)!.binaryChecksumSha256).toBe(await computeSha256Hex('abc'));
});

it('reports unavailable cryptography instead of returning a non-SHA fingerprint', async () => {
  const { computeSha256Hex } = await import('../engine/alsXmlEngine');
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')!;
  try {
    Object.defineProperty(globalThis, 'crypto', { configurable: true, value: {} });
    await expect(computeSha256Hex('abc')).rejects.toThrow(/SHA256_UNAVAILABLE/);
  } finally { Object.defineProperty(globalThis, 'crypto', descriptor); }
});

it('an unrelated analysis/edit does not replace canonical section decisions with pending UI form defaults', async () => {
  const { enrichProjectWithAnalysis } = await import('../App');
  const { generateSectionArrangementPlan } = await import('../engine/compositionIntelligenceEngine');
  const p = fixture(); p.arrangementSections = generateSectionArrangementPlan('deep_dub_evolution', 4, 123);
  const original = JSON.stringify(p.arrangementSections);
  const next = enrichProjectWithAnalysis(p, 'industrial_assault');
  expect(JSON.stringify(next.arrangementSections)).toBe(original);
});

it('a command returning an existing state object cannot mutate that object through commit bookkeeping', () => {
  const p = fixture(); p.audioSettings = { humanization, masterBus: master, transport: { ...transport, arrangementLengthBars: 4 } };
  const before = JSON.stringify(p); const bus = new StudioCommandBus();
  const next = bus.executeMutation('p', 'external result', 'mixer', p, () => p);
  expect(JSON.stringify(p)).toBe(before);
  expect(next.audioSettings!.transport.arrangementLengthBars).toBeUndefined();
  expect(next.arrangementLengthBars).toBe(4);
});

it('loads an empty native project directly from validated canonical state without an ALS reparse rejection', async () => {
  const { ProjectQueueService } = await import('../services/projectQueueService');
  const p = fixture(); p.tracks = []; p.audioSettings = { humanization, masterBus: master, transport };
  const loaded = decodeProjectSnapshot(encodeProjectSnapshot(p, humanization, master, transport));
  const queue = new ProjectQueueService();
  const record = await queue.enqueueProjectState(loaded.project, 'Empty.aidaw.json');
  expect(record.state).toBe('ready'); expect(record.workingProjectState.tracks).toEqual([]);
  expect(record.workingProjectState.audioSettings).toEqual(loaded.project.audioSettings);
});

 it('does not certify native Live compatibility or preservation from XML syntax alone', async () => {
  const { validateAlsProjectCadence } = await import('../engine/compositionIntelligenceEngine');
  const report = validateAlsProjectCadence(fixture().rawXmlModified);
  expect(report.roundTripVerified).toBe(false);
  expect(report.unknownNodesPreserved).toBe(false);
  expect(report.compatibilityStatus).not.toContain('Native Verified');
  expect(report.diagnostics.join(' ')).toContain('NOT TESTED');
});

it('rejects invalid project audio settings from ALS metadata before installing them', () => {
  const doc = new DOMParser().parseFromString(fixture().rawXmlModified, 'application/xml');
  const node = doc.createElement('ParametricAudioSettings'); node.setAttribute('Version', '1');
  doc.querySelector('LiveSet')!.appendChild(node);
  for (const settings of [null, { humanization, masterBus: { ...master, delayFeedback: 'bad' }, transport }]) {
    node.textContent = JSON.stringify(settings);
    expect(() => parseAlsXmlString(new XMLSerializer().serializeToString(doc))).toThrow(/PROJECT_SETTINGS/);
  }
});
