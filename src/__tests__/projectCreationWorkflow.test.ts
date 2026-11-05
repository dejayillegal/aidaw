// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createEditableFullTrack, type NewProjectOptions } from '../services/projectCreationService';
import { parseAlsXmlString } from '../engine/alsXmlEngine';
import { decodeProjectSnapshot, encodeProjectSnapshot } from '../services/projectSnapshotService';
import { ProjectQueueService } from '../services/projectQueueService';
import { StudioCommandBus } from '../services/commandBus';
const options: NewProjectOptions = { title: 'Creation regression', subgenreId: 'raw_warehouse',
  bpm: 133.5, durationBars: 32, layerDensity: 'full_reference', seed: 778 };
describe('Canonical full-track project creation', () => {
  it('persists the actual seed, tempo map, creation identity and final phrase without metadata-only generation', () => {
    const p = createEditableFullTrack(options);
    expect(p.creationMode).toBe('full-track'); expect(p.generationSeed).toBe(778);
    expect(p.tempo).toBe(133.5); expect(p.tempoMap?.[0].bpm).toBe(133.5);
    expect(p.songPlan?.tempo).toBe(133.5); expect(p.requestedDurationBars).toBe(32);
    expect(p.tracks.some(t => t.clips.some(c => c.notes.some(n => n.time > 120)))).toBe(true);
    expect(p.audioSettings?.transport.loopEnabled).toBe(false);
    const settings = p.audioSettings!;
    const saved = decodeProjectSnapshot(encodeProjectSnapshot(p, settings.humanization, settings.masterBus, settings.transport)).project;
    expect(saved.tracks).toEqual(p.tracks); expect(saved.songPlan).toEqual(p.songPlan);
    const reimport = parseAlsXmlString(p.rawXmlModified);
    expect(reimport.creationMode).toBe('full-track'); expect(reimport.requestedDurationBars).toBe(32);
    expect(reimport.tracks.map(t => t.clips.map(c => c.notes))).toEqual(p.tracks.map(t => t.clips.map(c => c.notes)));
    // Import audit timestamps are wall-clock metadata, not canonical musical events.
    const score = (project: typeof p) => project.tracks.map(t => ({ ...t,
      takes: t.takes?.map(({ createdAt, ...take }) => take) }));
    expect(score(createEditableFullTrack(options))).toEqual(score(p));
  }, 30000);
  it.each([['compact', 6], ['standard', 7], ['full_reference', 8]] as const)('makes %s density executable in state and XML (%i tracks)', (layerDensity, count) => {
    const p = createEditableFullTrack({ ...options, layerDensity });
    expect(p.tracks).toHaveLength(count);
    expect(parseAlsXmlString(p.rawXmlModified).tracks).toHaveLength(count);
    expect(p.songPlan?.roles).toHaveLength(count);
  });
  it.each([{ bpm: NaN }, { seed: Infinity }, { durationBars: -1 }, { title: ' ' }, { subgenreId: 'invented' }, { layerDensity: 'invented' }])('rejects invalid creation options %j before queue installation', invalid => {
    expect(() => createEditableFullTrack({ ...options, ...invalid } as NewProjectOptions)).toThrow(/PROJECT_CREATION/);
  });
  it('allocates independent project/history state and preserves edited outgoing work', async () => {
    const queue = new ProjectQueueService(); const bus = new StudioCommandBus();
    const first = await queue.enqueueProjectState(createEditableFullTrack(options));
    const edited = bus.executeMutation(first.queueId, 'Mute', 'mixer', first.workingProjectState, p => ({ ...p, tracks: p.tracks.map((t, i) => i ? t : { ...t, muted: true }) }));
    const second = await queue.enqueueProjectState(createEditableFullTrack({ ...options, seed: 779 }));
    queue.switchActiveProject(second.queueId, edited);
    expect(queue.getItem(first.queueId)?.workingProjectState).toEqual(edited);
    expect(second.queueId).not.toBe(first.queueId); expect(bus.canUndo(second.queueId)).toBe(false);
    expect(bus.undo(first.queueId)?.tracks[0].muted).toBe(false);
  });
});
