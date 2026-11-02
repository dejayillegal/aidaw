// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { AlsPatchEngine } from '../engine/alsPatchEngine';
import { syncTrackClipsToXml, parseAlsXmlString } from '../engine/alsXmlEngine';
import { StudioCommandBus, applyClipPositionWithEditMode } from '../services/commandBus';
import { duplicateTrackClip, moveOrResizeTrackClip, splitTrackClipAtBeat, consolidateTrackClipsInRange } from '../engine/compositionIntelligenceEngine';

// A structural regression fixture, not a claim of validation in licensed Live.
const clip = (id: number, velocity = 90) => `<MidiClip Id="${id}" Time="8" Vendor="retain"><Name Value="Phrase"/><CurrentStart Value="8"/><CurrentEnd Value="24"/><Loop><LoopStart Value="2"/><LoopEnd Value="10"/><StartRelative Value="1"/><LoopOn Value="true"/></Loop><Notes><KeyTracks><KeyTrack Id="0"><MidiKey Value="60"/><Notes><MidiNoteEvent NoteId="7" Time="9" Duration="2" Velocity="${velocity}" OffVelocity="41" Probability="0.75"><UnknownExpression Value="keep"/></MidiNoteEvent></Notes></KeyTrack></KeyTracks><NoteIdGenerator NextId="8"/></Notes><Envelopes><Envelope Id="3"><FloatEvent Time="1" Value="0.4"/></Envelope></Envelopes><UnknownClipData Value="retain"/></MidiClip>`;
const track = (id: number, content: string) => `<MidiTrack Id="${id}"><Name><EffectiveName Value="Pad ${id}"/></Name><DeviceChain><Mixer><Volume><Manual Value="0.5"/></Volume><Pan><Manual Value="0"/></Pan><Speaker><Manual Value="true"/></Speaker><Solo><Manual Value="false"/></Solo></Mixer><Devices><UnknownDevice Id="888"><State Opaque="retain"/><Events><FloatEvent Time="0" Value="1"/></Events></UnknownDevice></Devices><MainSequencer><ClipTimeable><ArrangerAutomation><Events>${content}</Events></ArrangerAutomation></ClipTimeable></MainSequencer></DeviceChain><Routing Target="Master"/></MidiTrack>`;
export const nativeFixture = `<Ableton MajorVersion="5" MinorVersion="12.0_12049" Creator="Ableton Live 12"><LiveSet><Tracks>${track(11, clip(100) + clip(101))}${track(22, clip(100, 60))}</Tracks><UnknownSetMetadata Value="retain"/></LiveSet></Ableton>`;
const dom = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');
const engine = new AlsPatchEngine();

describe('strict native patch addressing', () => {
  it.each(['missing', 'track_0_missing'])('rejects missing track %s instead of selecting by position', (trackId) => {
    const r = engine.patchClipBounds(nativeFixture, { trackId, clipId: '100', newStartBeat: 4, newLengthBeats: 8 });
    expect(r.success).toBe(false); expect(r.updatedXml).toBeUndefined();
  });
  it('rejects missing clips and ambiguous clip identities', () => {
    for (const xml of [nativeFixture, nativeFixture.replace(clip(101), clip(100))]) {
      const r = engine.patchClipBounds(xml, { trackId: '11', clipId: xml === nativeFixture ? 'missing' : '100', newStartBeat: 0, newLengthBeats: 8 });
      expect(r.success).toBe(false); expect(r.updatedXml).toBeUndefined();
    }
  });
  it('scopes note IDs to the exact track and clip', () => {
    const r = engine.patchNoteVelocity(nativeFixture, { trackId: '22', clipId: '100', noteId: '7', newVelocity: 105 });
    expect(r.success).toBe(true);
    const d = dom(r.updatedXml!);
    expect(d.querySelector('MidiTrack[Id="11"] MidiNoteEvent')!.getAttribute('Velocity')).toBe('90');
    expect(d.querySelector('MidiTrack[Id="22"] MidiNoteEvent')!.getAttribute('Velocity')).toBe('105');
    for (const params of [{ trackId: 'missing', clipId: '100' }, { trackId: '22', clipId: 'missing' }]) {
      expect(engine.patchNoteVelocity(nativeFixture, { ...params, noteId: '7', newVelocity: 105 }).success).toBe(false);
    }
  });
  it.each([NaN, Infinity, -1])('rejects invalid bounds %s without returning modified XML', (newLengthBeats) => {
    const r = engine.patchClipBounds(nativeFixture, { trackId: '11', clipId: '100', newStartBeat: 8, newLengthBeats });
    expect(r.success).toBe(false); expect(r.updatedXml).toBeUndefined();
  });
  it('moving or trimming arrangement bounds preserves source loop, notes and envelopes', () => {
    const r = engine.patchClipBounds(nativeFixture, { trackId: '11', clipId: '100', newStartBeat: 12, newLengthBeats: 4 });
    expect(r.success).toBe(true);
    const before = dom(nativeFixture), after = dom(r.updatedXml!);
    for (const selector of ['Loop', 'Notes', 'Envelopes', 'UnknownClipData']) {
      expect(after.querySelector(`MidiTrack[Id="11"] MidiClip[Id="100"] > ${selector}`)!.outerHTML)
        .toBe(before.querySelector(`MidiTrack[Id="11"] MidiClip[Id="100"] > ${selector}`)!.outerHTML);
    }
  });
  it('allocates distinct note IDs within the newly inserted clip and advances its generator', () => {
    const r = engine.patchInsertClip(nativeFixture, { trackId: '11', clip: { id: 'new', name: 'Fill', startTime: 32, length: 4,
      notes: [60, 62, 60].map((pitch, i) => ({ time: 32 + i, duration: 0.5, pitch, velocity: 90 })) } });
    expect(r.success).toBe(true);
    const inserted = dom(r.updatedXml!).querySelector(`MidiClip[Id="${r.changedNodeIds[0]}"]`)!;
    const ids = [...inserted.querySelectorAll('MidiNoteEvent')].map(n => Number(n.getAttribute('NoteId')));
    expect(new Set(ids).size).toBe(3);
    expect(Number(inserted.querySelector('NoteIdGenerator')!.getAttribute('NextId'))).toBeGreaterThan(Math.max(...ids));
  });
  it('never appends clips to a device automation Events container', () => {
    const xml = nativeFixture.replace('<MainSequencer>', '<UnusedSequencer>').replace('</MainSequencer>', '</UnusedSequencer>');
    const r = engine.patchInsertClip(xml, { trackId: '11', clip: { id: 'new', name: 'Fill', startTime: 0, length: 4, notes: [] } });
    expect(r.success).toBe(true);
    expect(dom(r.updatedXml!).querySelector('UnknownDevice MidiClip')).toBeNull();
  });
  it('rejects nonfinite note and mixer values and missing requested mixer nodes', () => {
    expect(engine.patchNoteVelocity(nativeFixture, { trackId: '11', clipId: '100', noteId: '7', newVelocity: NaN }).success).toBe(false);
    expect(engine.patchTrackMixer(nativeFixture, { trackId: '11', volumeDb: Infinity }).success).toBe(false);
    expect(engine.patchTrackMixer(nativeFixture.replace('<Volume><Manual Value="0.5"/></Volume>', ''), { trackId: '11', volumeDb: -6 }).success).toBe(false);
  });
});

describe('production clip edits and transactional history', () => {
  it('retains exact source XML on untouched import including whitespace-sensitive extensions', () => {
    const xml = nativeFixture.replace('<LiveSet>', '<LiveSet xmlns:vendor="urn:fixture"><vendor:State xml:space="preserve">  keep\n  this  </vendor:State>');
    const p = parseAlsXmlString(xml);
    expect(p.rawXmlOriginal).toBe(xml); expect(p.rawXmlModified).toBe(xml);
  });
  it('syncs an ordinary edit without rebuilding native clip metadata or note IDs', () => {
    const p = parseAlsXmlString(nativeFixture), t = p.tracks[0];
    t.clips[0].notes[0].velocity = 110;
    const updated = syncTrackClipsToXml(nativeFixture, t.id, t.clips);
    const d = dom(updated), target = d.querySelector('MidiTrack[Id="11"] MidiClip[Id="100"]')!;
    expect(target).not.toBeNull(); expect(target.getAttribute('Vendor')).toBe('retain');
    expect(target.querySelector('UnknownClipData')).not.toBeNull();
    expect(target.querySelector('MidiNoteEvent[NoteId="7"]')!.getAttribute('Velocity')).toBe('110');
    expect(target.querySelector('UnknownExpression')).not.toBeNull();
    expect(d.querySelector('MidiTrack[Id="22"]')!.outerHTML).toBe(dom(nativeFixture).querySelector('MidiTrack[Id="22"]')!.outerHTML);
  });
  it('fails explicitly on malformed XML or missing track during production sync', () => {
    expect(() => syncTrackClipsToXml(nativeFixture, 'missing', [])).toThrow(/track/i);
    expect(() => syncTrackClipsToXml('<broken>', '11', [])).toThrow(/XML/i);
  });
  it('command bus synchronizes moved clips, then undo/redo restores matching state and XML', () => {
    const p = parseAlsXmlString(nativeFixture), bus = new StudioCommandBus();
    const moved = bus.executeMutation('p', 'Move', 'clip_edit', p,
      draft => applyClipPositionWithEditMode(draft, '11', 0, 28, 'spot'));
    expect(dom(moved.rawXmlModified).querySelector('MidiTrack[Id="11"] MidiClip[Id="100"] > CurrentStart')!.getAttribute('Value')).toBe('28.000');
    expect(bus.undo('p')).toEqual(p); expect(bus.redo('p')).toEqual(moved);
  });
  it('failed synchronization leaves input and history unchanged', () => {
    const p = parseAlsXmlString(nativeFixture), bus = new StudioCommandBus(), before = JSON.stringify(p);
    expect(() => bus.executeMutation('p', 'Invalid', 'clip_edit', p, draft => {
      draft.tracks[0].clips[0].length = NaN; return draft;
    })).toThrow();
    expect(JSON.stringify(p)).toBe(before); expect(bus.canUndo('p')).toBe(false);
  });
  it('trim then extend recovers all original notes and missing duplicate IDs fail', () => {
    const clips = parseAlsXmlString(nativeFixture).tracks[0].clips.slice(0, 1);
    const trimmed = moveOrResizeTrackClip(clips, '100', 8, 1);
    expect(moveOrResizeTrackClip(trimmed, '100', 8, 16)[0].notes).toEqual(clips[0].notes);
    expect(() => duplicateTrackClip(clips, 'missing')).toThrow(/clip/i);
  });
  it('split and duplicate preserve opaque clip and note content through serialization and reimport', () => {
    const original = parseAlsXmlString(nativeFixture).tracks[0].clips.slice(0, 1);
    for (const next of [splitTrackClipAtBeat(original, 16).clips, duplicateTrackClip(original, '100').clips]) {
      const xml = syncTrackClipsToXml(nativeFixture, '11', next), d = dom(xml);
      for (const c of d.querySelectorAll('MidiTrack[Id="11"] MidiClip')) {
        expect(c.getAttribute('Vendor')).toBe('retain'); expect(c.querySelector('UnknownClipData')).not.toBeNull();
        expect(c.querySelector('Envelopes')).not.toBeNull();
        for (const n of c.querySelectorAll('MidiNoteEvent')) expect(n.querySelector('UnknownExpression')).not.toBeNull();
      }
      expect(parseAlsXmlString(xml).tracks[0].clips.map(c => c.id)).toEqual(next.map(c => c.id));
      expect(syncTrackClipsToXml(xml, '11', next)).toBe(xml);
    }
  });
  it('short non-destructive trim survives save/reimport with its hidden source notes', () => {
    const original = parseAlsXmlString(nativeFixture).tracks[0].clips.slice(0, 1);
    const trimmed = moveOrResizeTrackClip(original, '100', 8, 1);
    const reimported = parseAlsXmlString(syncTrackClipsToXml(nativeFixture, '11', trimmed)).tracks[0].clips;
    expect(reimported[0].length).toBe(1);
    expect(moveOrResizeTrackClip(reimported, '100', 8, 16)[0].notes).toEqual(original[0].notes);
  });
  it('consolidation includes only audible clip windows, without resurrecting trimmed notes', () => {
    const original = parseAlsXmlString(nativeFixture).tracks[0].clips.slice(0, 1);
    const trimmed = moveOrResizeTrackClip(original, '100', 8, 1);
    expect(consolidateTrackClipsInRange(trimmed, 8, 24)[0].notes).toEqual([]);
  });
  it('short clips duplicate immediately after their exact length', () => {
    const original = parseAlsXmlString(nativeFixture).tracks[0].clips.slice(0, 1);
    const short = moveOrResizeTrackClip(original, '100', 8, 1);
    const duplicate = duplicateTrackClip(short, '100').duplicatedClip!;
    expect(duplicate.startTime).toBe(9); expect(duplicate.length).toBe(1);
  });
  it('targeted patches can address persisted public identities of new clips and notes', () => {
    const p = parseAlsXmlString(nativeFixture), original = p.tracks[0].clips.slice(0, 1);
    const next = duplicateTrackClip(original, '100'), duplicate = next.duplicatedClip!;
    const xml = syncTrackClipsToXml(nativeFixture, '11', next.clips);
    expect(engine.patchClipBounds(xml, { trackId: '11', clipId: duplicate.id, newStartBeat: 40, newLengthBeats: 16 }).success).toBe(true);
    expect(engine.patchNoteVelocity(xml, { trackId: '11', clipId: duplicate.id, noteId: duplicate.notes[0].id, newVelocity: 120 }).success).toBe(true);
  });
});
