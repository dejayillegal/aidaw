// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { buildStarterAbletonXml, parseAlsXmlString, syncTrackClipsToXml } from '../engine/alsXmlEngine';
import { AlsPatchEngine } from '../engine/alsPatchEngine';
import { StudioCommandBus, applyClipPositionWithEditMode } from '../services/commandBus';
import { duplicateTrackClip } from '../engine/compositionIntelligenceEngine';
const serialize = (doc: Document) => new XMLSerializer().serializeToString(doc);
function xmlFixture(alias = 'Data-Parametric') {
  const doc = new DOMParser().parseFromString(buildStarterAbletonXml('berghain-134', 777, 4).xml, 'application/xml');
  [...doc.querySelectorAll('Tracks > MidiTrack')].slice(1).forEach(node => node.remove());
  const track = doc.querySelector('MidiTrack')!, clip = track.querySelector('MidiClip')!, note = clip.querySelector('MidiNoteEvent')!;
  track.setAttribute('Data-Parametric-TrackId', 'public-track');
  clip.setAttribute(alias === 'Data-Parametric' ? 'Data-Parametric-ClipId' : 'Data-AIDAW-LogicalId', 'public-clip');
  note.setAttribute(alias === 'Data-Parametric' ? 'Data-Parametric-NoteId' : 'Data-AIDAW-LogicalId', 'public-note');
  const opaque = doc.createElement('OpaqueExpression'); opaque.setAttribute('Value', 'preserve'); note.appendChild(opaque);
  return serialize(doc);
}

it('executes a project mutator once and publishes one matching history transaction', () => {
  const p = parseAlsXmlString(buildStarterAbletonXml('berghain-134', 777, 4).xml), before = JSON.stringify(p);
  const mutate = vi.fn((draft: typeof p) => { draft.tracks[0].muted = true; return draft; });
  const bus = new StudioCommandBus(); const after = bus.executeMutation('p', 'mute', 'mixer', p, mutate);
  expect(mutate).toHaveBeenCalledOnce(); expect(bus.getHistory('p')).toHaveLength(1);
  expect(JSON.stringify(p)).toBe(before); expect(bus.undo('p')).toEqual(p); expect(bus.redo('p')).toEqual(after);
});

it.each(['Data-Parametric', 'Data-AIDAW'])('reads and edits %s identities across both serializers', alias => {
  const xml = xmlFixture(alias), p = parseAlsXmlString(xml), track = p.tracks[0];
  expect(track.id).toBe('public-track'); expect(track.clips[0].id).toBe('public-clip');
  expect(track.clips[0].notes[0].id).toBe('public-note');
  track.clips[0].notes[0].velocity = 77;
  const updated = syncTrackClipsToXml(xml, track.id, track.clips);
  const patch = new AlsPatchEngine().patchNoteVelocity(updated, { trackId: track.id, clipId: 'public-clip', noteId: 'public-note', newVelocity: 88 });
  expect(patch.success).toBe(true);
  const reload = parseAlsXmlString(patch.updatedXml!);
  expect(reload.tracks[0].clips[0].notes[0].velocity).toBe(88);
  expect(patch.updatedXml).toContain('OpaqueExpression');
});

it('preserves fine clip/note coordinates and grid time without rounding to milliseconds of beats', () => {
  const xml = buildStarterAbletonXml('berghain-134', 777, 4).xml, p = parseAlsXmlString(xml), t = p.tracks[0];
  t.clips = [{ ...t.clips[0], startTime: 0.000125, length: 0.0005, endTime: 0.000625,
    notes: [{ ...t.clips[0].notes[0], time: 0.00025, quantizedTime: 0.000375, duration: 0.000125 }] }];
  const c = parseAlsXmlString(syncTrackClipsToXml(xml, t.id, t.clips)).tracks[0].clips[0];
  expect(c.startTime).toBe(0.000125); expect(c.length).toBe(0.0005);
  expect([c.notes[0].time,c.notes[0].quantizedTime,c.notes[0].duration]).toEqual([0.00025,0.000375,0.000125]);
});

it('cloned clips and notes acquire new identities without inheriting stale aliases', () => {
  const xml = xmlFixture(), p = parseAlsXmlString(xml), t = p.tracks[0];
  const duplicated = duplicateTrackClip(t.clips, 'public-clip');
  const next = parseAlsXmlString(syncTrackClipsToXml(xml, t.id, duplicated.clips)).tracks[0];
  expect(next.clips.map(c => c.id)).toEqual(duplicated.clips.map(c => c.id));
  expect(next.clips[1].notes.map(n => n.id)).toEqual(duplicated.clips[1].notes.map(n => n.id));
});

it('rejects contradictory aliases rather than silently selecting one identity', () => {
  const doc = new DOMParser().parseFromString(xmlFixture(), 'application/xml');
  doc.querySelector('MidiClip')!.setAttribute('Data-AIDAW-LogicalId', 'different');
  expect(() => parseAlsXmlString(serialize(doc))).toThrow(/identity|identities/i);
});

it('preserves an absent tempo destination on unrelated edits and rejects a tempo change atomically', () => {
  const doc = new DOMParser().parseFromString(buildStarterAbletonXml('berghain-134',777,4).xml, 'application/xml');
  doc.querySelector('MasterTrack')!.remove();
  const p = parseAlsXmlString(serialize(doc)), bus = new StudioCommandBus();
  const moved = bus.executeMutation('p','move','clip_edit',p,d => applyClipPositionWithEditMode(d,d.tracks[0].id,0,28,'spot'));
  expect(new DOMParser().parseFromString(moved.rawXmlModified,'application/xml').querySelector('MasterTrack')).toBeNull();
  expect(moved.tracks[0].clips[0].startTime).toBe(28);
  const before = JSON.stringify(moved);
  expect(() => bus.executeMutation('p','tempo','transport',moved,d => ({...d,tempo:d.tempo+1}))).toThrow(/tempo target/);
  expect(bus.getHistory('p')).toHaveLength(1); expect(JSON.stringify(moved)).toBe(before);
});

it('moves fractional clips beyond previous extent without clamping the destination or note coordinates', () => {
  const p = parseAlsXmlString(buildStarterAbletonXml('berghain-134',777,4).xml), t = p.tracks[0];
  const destination = 6144.000125;
  const next = new StudioCommandBus().executeMutation('p','long move','clip_edit',p,d => applyClipPositionWithEditMode(d,t.id,0,destination,'spot'));
  const reimported = parseAlsXmlString(next.rawXmlModified);
  expect(next.arrangementLengthBars).toBe(Math.ceil((destination+t.clips[0].length)/4));
  expect(reimported.arrangementLengthBars).toBe(next.arrangementLengthBars);
  expect(reimported.tracks[0].clips[0].startTime).toBe(destination);
  expect(reimported.tracks[0].clips[0].notes[0].time).toBe(t.clips[0].notes[0].time+destination);
});
