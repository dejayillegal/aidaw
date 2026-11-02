// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildStarterAbletonXml, parseAlsXmlString, syncTrackClipsToXml } from '../engine/alsXmlEngine';
import { decomposeNotesIntoSectionClips } from '../engine/compositionIntelligenceEngine';
import type { AbletonMidiClip, MidiNoteEvent } from '../types/ableton';

const note: MidiNoteEvent = { id: '11', time: 0, quantizedTime: 0, duration: 0.125, pitch: 36, velocity: 100, isGhost: false, probability: 0.6 };
function fixture() {
  const { xml } = buildStarterAbletonXml('berghain-134', 777, 4);
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const clip = doc.querySelector('MidiClip')!;
  clip.setAttribute('Data-External-Attribute', 'retain');
  const unknown = doc.createElement('FutureClipMetadata');
  unknown.innerHTML = '<Opaque Value="preserve-me" />';
  clip.append(unknown);
  const session = clip.cloneNode(true) as Element;
  session.setAttribute('Id', '99001');
  session.querySelector('CurrentEnd')!.setAttribute('Value', '8000');
  const slots = doc.createElement('ClipSlotList');
  slots.append(session);
  doc.querySelector('Tracks > MidiTrack')!.append(slots);
  const original = new XMLSerializer().serializeToString(doc);
  return { original, project: parseAlsXmlString(original) };
}

describe('Core refinement: arrangement serialization', () => {
  it('does not import Session clips as Arrangement clips or extend arrangement from them', () => {
    const { project } = fixture();
    expect(project.tracks[0].clips).toHaveLength(1);
    expect(project.arrangementLengthBars).toBe(4);
  });
  it('preserves sub-bar clip extents and short project duration', () => {
    const { xml } = buildStarterAbletonXml('berghain-134', 777, 4);
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    [...doc.querySelectorAll('Tracks > MidiTrack')].slice(1).forEach(t => t.remove());
    const singleTrackXml = new XMLSerializer().serializeToString(doc);
    const project = parseAlsXmlString(singleTrackXml);
    const clip: AbletonMidiClip = { ...project.tracks[0].clips[0], startTime: 0, endTime: 0.5, length: 0.5, notes: [note] };
    const parsed = parseAlsXmlString(syncTrackClipsToXml(singleTrackXml, project.tracks[0].id, [clip]));
    expect(parsed.tracks[0].clips[0].length).toBe(0.5);
    expect(parsed.arrangementLengthBars).toBe(1);
  });
  it('preserves edited clip identity, probability and unknown clip subtree through repeated sync', () => {
    const { original, project } = fixture();
    const track = project.tracks[0];
    const clip = { ...track.clips[0], name: 'Renamed', notes: [note] };
    const first = syncTrackClipsToXml(original, track.id, [clip]);
    const parsed = parseAlsXmlString(first);
    expect(parsed.tracks[0].clips[0].id).toBe(clip.id);
    expect(parsed.tracks[0].clips[0].notes[0].id).toBe(note.id);
    expect(parsed.tracks[0].clips[0].notes[0].probability).toBe(note.probability);
    const second = syncTrackClipsToXml(first, track.id, parsed.tracks[0].clips);
    const doc = new DOMParser().parseFromString(second, 'application/xml');
    const result = doc.querySelector('MainSequencer MidiClip')!;
    expect(result.getAttribute('Data-External-Attribute')).toBe('retain');
    expect(result.querySelector('FutureClipMetadata > Opaque')?.getAttribute('Value')).toBe('preserve-me');
    expect(doc.querySelector('ClipSlotList > MidiClip')?.getAttribute('Id')).toBe('99001');
  });
  it('allocates distinct persistent XML ids across tracks for generated clip identities', () => {
    const { xml } = buildStarterAbletonXml('tresor-138', 777, 4);
    const project = parseAlsXmlString(xml);
    let updated = xml;
    for (const track of project.tracks) updated = syncTrackClipsToXml(updated, track.id, [{ id: `new_${track.id}`, name: 'Generated', startTime: 0, length: 16, notes: [note] }]);
    const dom = new DOMParser().parseFromString(updated, 'application/xml');
    const ids = [...dom.querySelectorAll('MainSequencer MidiClip')].map(c => c.getAttribute('Id'));
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^\d+$/);
    const reparsed = parseAlsXmlString(updated);
    for (const track of reparsed.tracks) expect(track.clips[0].id).toBe(`new_${track.id}`);
  });
  it('reports failed synchronization instead of returning stale XML as success', () => {
    expect(() => syncTrackClipsToXml('<bad', 'missing', [])).toThrow(/XML/);
    const { xml } = buildStarterAbletonXml('berghain-134', 777, 4);
    expect(() => syncTrackClipsToXml(xml, 'missing', [])).toThrow(/TRACK/);
  });
  it('respects 1-bar section extent instead of extending decomposition to four bars', () => {
    const clips = decomposeNotesIntoSectionClips('Kick', 'kick', [note], 1, [{ id: 'one', name: 'One', role: 'Intro', startBar: 1, endBar: 1, activeArchetypes: ['kick'], targetEnergy: 0.3, sectionEvent: 'Start' }]);
    expect(clips[0].length).toBe(4);
    expect(clips[0].endTime).toBe(4);
  });
});

it('retains fine timing, independent mixed clip lengths and more than 50 notes per pitch', () => {
  const { xml } = buildStarterAbletonXml('berghain-134', 777, 4);
  const project = parseAlsXmlString(xml);
  const notes = Array.from({ length: 180 }, (_, i) => ({ ...note, id: `n_${i}`, pitch: 36 + i % 3,
    time: 700 + i / 32 + 0.000012345, quantizedTime: 700 + i / 32, duration: 0.062512345 }));
  const clips = [{ id: 'fine', name: 'Fine', startTime: 700, length: 8.000012345, notes },
    { id: 'short', name: 'Short', startTime: 900.125, length: 0.125, notes: [] }];
  const updated = syncTrackClipsToXml(xml, project.tracks[0].id, clips);
  const parsed = parseAlsXmlString(updated).tracks[0].clips;
  expect(parsed.map(c => [c.id, c.startTime])).toEqual(clips.map(c => [c.id, c.startTime]));
  parsed.forEach((c, i) => expect(c.length).toBeCloseTo(clips[i].length, 10));
  expect(parsed[0].notes.map(n => [n.id, n.time, n.quantizedTime, n.duration])).toEqual(notes.map(n => [n.id, n.time, n.quantizedTime, n.duration]));
  const doc = new DOMParser().parseFromString(updated, 'application/xml');
  const ids = [...doc.querySelectorAll('MidiClip[Data-Parametric-ClipId="fine"] MidiNoteEvent')].map(n => n.getAttribute('NoteId'));
  expect(new Set(ids).size).toBe(ids.length);
});

it('rejects invalid note data and duplicate clip identities before replacing XML', () => {
  const { xml } = buildStarterAbletonXml('berghain-134', 777, 4);
  const project = parseAlsXmlString(xml);
  const clip = project.tracks[0].clips[0];
  expect(() => syncTrackClipsToXml(xml, project.tracks[0].id, [clip, clip])).toThrow(/ID/);
  for (const invalid of [{ time: NaN }, { pitch: 128 }, { duration: -1 }, { probability: 2 }]) {
    expect(() => syncTrackClipsToXml(xml, project.tracks[0].id, [{ ...clip, notes: [{ ...note, ...invalid }] }])).toThrow(/NOTE/);
  }
});

it('persists the starter seed for deterministic replay and uses memory preflight beyond 256 bars', async () => {
  const { xml } = buildStarterAbletonXml('berghain-134', 777, 4);
  const project = parseAlsXmlString(xml);
  expect(project.generationSeed).toBe(777);
  expect(buildStarterAbletonXml('berghain-134', 777, 4).xml).toBe(xml);
  const { synthesizeProjectToStereoFloatBuffers } = await import('../engine/webAudioSynth');
  await expect(synthesizeProjectToStereoFloatBuffers(project, {} as any, { reverbDecaySec: 3.2 } as any, 44100, 1024)).rejects.toThrow(/RENDER_MEMORY/);
});
