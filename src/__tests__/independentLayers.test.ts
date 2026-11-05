// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildStarterAbletonXml, parseAlsXmlString, synchronizeProjectStateToXml } from '../engine/alsXmlEngine';
import { createSongPlan, composeSongPlan } from '../engine/songPlanEngine';
import { createUserTrackFromRole } from '../engine/compositionIntelligenceEngine';
import { createEditableFullTrack } from '../services/projectCreationService';
import { StudioCommandBus } from '../services/commandBus';
import { decodeProjectSnapshot, encodeProjectSnapshot } from '../services/projectSnapshotService';
import { projectAudioSettings } from '../engine/projectDefaults';
import { assertProjectState } from '../engine/projectStateContracts';
import { assertSidechainRouting, defaultSidechain } from '../engine/sidechainGraph';

const score = (track: ReturnType<typeof createUserTrackFromRole>) => track.clips.map(c => ({
  start: c.startTime, length: c.length, notes: c.notes.map(n => [n.time, n.pitch, n.duration, n.velocity]),
}));
describe('independent reference-style musical layers', () => {
  it('respects explicit key, mode and form and preserves them through the application XML projection', () => {
    const p = createEditableFullTrack({title:'Intent',subgenreId:'acid_techno',bpm:140,durationBars:64,layerDensity:'compact',seed:8,
      rootKey:'D',mode:'Octatonic',formFamily:'dual-drop'});
    expect(p.rootKey).toBe('D');expect(p.songPlan?.scale).toHaveLength(8);
    expect(p.songPlan?.sections.map(s=>s.name)).toContain('First Drop');
    expect(p.songPlan?.sections.map(s=>s.name)).toContain('Peak');
    const q=parseAlsXmlString(p.rawXmlModified);
    expect(q.rootKey).toBe('D');expect(q.scale).toBe('Octatonic');expect(q.songPlan?.formFamily).toBe('dual-drop');
    expect(q.tracks.flatMap(t=>t.clips.flatMap(c=>c.notes)).every(n=>Number.isInteger(n.pitch)&&n.pitch>=0&&n.pitch<=127)).toBe(true);
  });
  it('rejects future layer versions, duplicate layer ownership and sidechain cycles while preserving original score', () => {
    const p = parseAlsXmlString(buildStarterAbletonXml('berghain-134', 77, 1, 'sketch').xml);
    const before=JSON.stringify(p);
    const descriptor={version:1 as const,id:'layer-1',family:p.tracks[0].archetype,variant:'kick',seed:7,phraseBeats:16,registerHz:[20,160] as [number,number],provenance:'legacy-score' as const};
    const future=structuredClone(p);future.tracks[0].layer={...descriptor,version:99} as unknown as typeof descriptor;
    expect(()=>assertProjectState(future)).toThrow('layer');
    const duplicate=structuredClone(p);duplicate.tracks[0].layer=descriptor;duplicate.tracks[1].layer={...descriptor,family:duplicate.tracks[1].archetype};
    expect(()=>assertProjectState(duplicate)).toThrow('layer');
    const cycle=structuredClone(p);cycle.tracks[0].sidechainCompressor=defaultSidechain(p.tracks[1].id);cycle.tracks[1].sidechainCompressor=defaultSidechain(p.tracks[0].id);
    expect(()=>assertSidechainRouting(cycle)).toThrow('CYCLE');
    expect(JSON.stringify(p)).toBe(before);
  });
  it('generates independent phrases for two percussion tracks sharing one legacy family', () => {
    const p = parseAlsXmlString(buildStarterAbletonXml('berghain-134', 77, 1, 'sketch').xml);
    p.arrangementLengthBars = 64;
    const a = createUserTrackFromRole('C4', 8), b = createUserTrackFromRole('C4', 9);
    p.tracks.push(a, b);
    const q = composeSongPlan(p, createSongPlan(p, 77, 'raw_warehouse'));
    expect(score(q.tracks.at(-1)!)).not.toEqual(score(q.tracks.at(-2)!));
    const inserted = structuredClone(p); inserted.tracks.unshift(createUserTrackFromRole('D1', 20));
    const r = composeSongPlan(inserted, createSongPlan(inserted, 77, 'raw_warehouse'));
    expect(score(r.tracks.find(t => t.id === a.id)!)).toEqual(score(q.tracks.find(t => t.id === a.id)!));
  });
  it('creates a style-dependent full ensemble beyond eight actual editable tracks', () => {
    const options = { title: 'Layer programme', subgenreId: 'hardgroove' as const, bpm: 142,
      durationBars: 64, layerDensity: 'full_reference' as const, seed: 778 };
    const p = createEditableFullTrack(options);
    expect(p.tracks.length).toBeGreaterThan(8);
    expect(p.tracks.every(t => t.clips.some(c => c.notes.length))).toBe(true);
    expect(new Set(p.tracks.map(t => t.layer?.id)).size).toBe(p.tracks.length);
    expect(p.tracks.every(t => t.layer?.version === 1)).toBe(true);
    const settings = projectAudioSettings(p);
    const saved = decodeProjectSnapshot(encodeProjectSnapshot(p, settings.humanization, settings.masterBus, settings.transport)).project;
    expect(saved.tracks).toEqual(p.tracks);
    const reopened = parseAlsXmlString(p.rawXmlModified);
    expect(reopened.tracks.map(t => t.layer)).toEqual(p.tracks.map(t => t.layer));
    expect(reopened.tracks.map(t => t.spectralDucking)).toEqual(p.tracks.map(t => t.spectralDucking));
    expect(reopened.tracks.map(t => t.polyrhythm)).toEqual(p.tracks.map(t => t.polyrhythm));
    expect(reopened.tracks.map(t => t.velocityCurve)).toEqual(p.tracks.map(t => t.velocityCurve));
    expect(reopened.songPlan).toEqual(p.songPlan);
    const bus = new StudioCommandBus();
    const next = bus.executeMutation('layers', 'Mute one layer', 'mixer', p, d => ({ ...d, tracks: d.tracks.map((t, i) => i ? t : { ...t, muted: true }) }));
    expect(next.tracks.slice(1)).toEqual(p.tracks.slice(1));
    expect(bus.undo('layers')?.tracks).toEqual(p.tracks);
    expect(bus.redo('layers')?.tracks).toEqual(next.tracks);
    expect(parseAlsXmlString(synchronizeProjectStateToXml(next, p)).tracks.map(t => t.layer)).toEqual(p.tracks.map(t => t.layer));
  }, 30000);
});
