// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildStarterAbletonXml, parseAlsXmlString } from '../engine/alsXmlEngine';
import { transformTrackArrangementNotes, randomizeTrackNoteVelocities, applyMidiQuantizeStrength } from '../engine/compositionIntelligenceEngine';
import { StudioCommandBus } from '../services/commandBus';

function fixture() {
  const p = parseAlsXmlString(buildStarterAbletonXml('berghain-134',777,4).xml);
  const t = p.tracks[0];
  t.clips = [
    { ...t.clips[0], id: 'first', startTime: 0, length: 1, endTime: 1,
      notes: [{ ...t.clips[0].notes[0], id: 'a', time: 0.13, quantizedTime: 0.13, velocity: 80, isAccent: false }] },
    { ...t.clips[0], id: 'later', startTime: 8, length: 0.5, endTime: 8.5,
      notes: [{ ...t.clips[0].notes[0], id: 'b', time: 8.13, quantizedTime: 8.13, velocity: 80, isAccent: false, probability: 0.4 }] },
  ];
  t.sessionClips = [{ ...t.clips[0], id:'session' }];
  return p;
}
const config = { minVelocity: 45, maxVelocity: 65, blendPct:100, accentLock:false, downbeatLock:false, seed:777 };

describe('non-destructive track-level note transformations', () => {
  it('randomizes every arrangement clip without losing identities, extents, probability or Session clips', () => {
    const p = fixture(); const original = structuredClone(p); const bus = new StudioCommandBus();
    const result = bus.executeMutation('p','velocity','clip_edit',p,d => transformTrackArrangementNotes(d,d.tracks[0].id,
      notes => randomizeTrackNoteVelocities(notes,config)));
    expect(p).toEqual(original);
    expect(result.tracks[0].clips.map(c => [c.id,c.startTime,c.length,c.notes[0].id,c.notes[0].probability])).toEqual(
      original.tracks[0].clips.map(c => [c.id,c.startTime,c.length,c.notes[0].id,c.notes[0].probability]));
    expect(result.tracks[0].clips.every(c => c.notes[0].velocity >= 45 && c.notes[0].velocity <= 65)).toBe(true);
    expect(result.tracks[0].sessionClips).toEqual(original.tracks[0].sessionClips);
    expect(result.tracks.slice(1)).toEqual(original.tracks.slice(1));
    const reopened = parseAlsXmlString(result.rawXmlModified);
    expect(reopened.tracks[0].clips.map(c=>c.notes[0].velocity)).toEqual(result.tracks[0].clips.map(c=>c.notes[0].velocity));
    expect(bus.undo('p')!.tracks).toEqual(original.tracks);
    expect(bus.redo('p')!.tracks).toEqual(result.tracks);
  });
  it('quantizes each independent clip and protects locked tracks', () => {
    const p = fixture();
    const result = transformTrackArrangementNotes(p,p.tracks[0].id, notes=>applyMidiQuantizeStrength(notes,'1/16',100).notes);
    expect(result.tracks[0].clips.map(c=>c.notes[0].time)).toEqual([0.25,8.25]);
    p.tracks[0].locked = true;
    expect(()=>transformTrackArrangementNotes(p,p.tracks[0].id,()=>[])).toThrow(/locked/);
    expect(()=>transformTrackArrangementNotes(p,'missing',()=>[])).toThrow(/not found/);
  });
  it('uses seed and note identity rather than array order, and respects accent/downbeat exclusions', () => {
    const notes = fixture().tracks[0].clips.flatMap(c=>c.notes);
    const a = randomizeTrackNoteVelocities(notes,config);
    const b = randomizeTrackNoteVelocities([...notes].reverse(),config).reverse();
    expect(b).toEqual(a);
    expect(randomizeTrackNoteVelocities(notes,config)).toEqual(a);
    notes[0].isAccent = true; notes[1].time = 8;
    expect(randomizeTrackNoteVelocities(notes,{...config,accentLock:true,downbeatLock:true})).toEqual(notes);
    expect(()=>randomizeTrackNoteVelocities(notes,{...config,minVelocity:NaN})).toThrow();
  });
});
