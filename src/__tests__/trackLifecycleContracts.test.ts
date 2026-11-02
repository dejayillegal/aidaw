// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildStarterAbletonXml, parseAlsXmlString } from '../engine/alsXmlEngine';
import { StudioCommandBus } from '../services/commandBus';

const fixture = () => parseAlsXmlString(buildStarterAbletonXml('berghain-134', 777, 4).xml);

describe('canonical track lifecycle and transaction ownership', () => {
  it('deletes only represented tracks, retains opaque returns, and restores deletion through undo', () => {
    const p = fixture();
    const doc = new DOMParser().parseFromString(p.rawXmlModified, 'application/xml');
    const opaque = doc.createElement('ReturnTrack'); opaque.setAttribute('Id', '99001');
    opaque.innerHTML = '<FutureRouting Value="preserve" />';
    doc.querySelector('LiveSet > Tracks')!.appendChild(opaque);
    p.rawXmlModified = new XMLSerializer().serializeToString(doc);
    const bus = new StudioCommandBus(); const deleted = p.tracks[1].id;
    const result = bus.executeMutation('p', 'delete', 'clip_edit', p, d => ({ ...d, tracks: d.tracks.filter(t => t.id !== deleted) }));
    expect(parseAlsXmlString(result.rawXmlModified).tracks.map(t => t.id)).toEqual(result.tracks.map(t => t.id));
    expect(new DOMParser().parseFromString(result.rawXmlModified, 'application/xml').querySelector('ReturnTrack > FutureRouting')?.getAttribute('Value')).toBe('preserve');
    expect(parseAlsXmlString(bus.undo('p')!.rawXmlModified).tracks.map(t => t.id)).toContain(deleted);
    expect(parseAlsXmlString(bus.redo('p')!.rawXmlModified).tracks.map(t => t.id)).not.toContain(deleted);
  });
  it('round trips track order and name without replacing native device/clip subtrees', () => {
    const p = fixture(); const bus = new StudioCommandBus();
    const result = bus.executeMutation('p', 'reorder/rename', 'clip_edit', p, d => {
      d.tracks.reverse(); d.tracks[0].name = 'Lead & Echo'; return d;
    });
    const restored = parseAlsXmlString(result.rawXmlModified);
    expect(restored.tracks.map(t => [t.id,t.name])).toEqual(result.tracks.map(t => [t.id,t.name]));
    expect(restored.tracks[0].devices).toEqual(p.tracks.at(-1)!.devices);
    expect(restored.tracks[0].clips).toEqual(p.tracks.at(-1)!.clips);
  });
  it('detaches a caller-owned mutation result before exposing it as the committed state', () => {
    const p = fixture(); const external = fixture(); const before = external.tracks[0].clips.length;
    const result = new StudioCommandBus().executeMutation('p', 'result', 'clip_edit', p, () => external);
    result.tracks[0].clips.length = 0;
    expect(external.tracks[0].clips.length).toBe(before);
  });
  it('rejects duplicate note identities within a clip before changing history', () => {
    const p = fixture(); const bus = new StudioCommandBus(); const original = JSON.stringify(p);
    expect(() => bus.executeMutation('p', 'bad identity', 'clip_edit', p, d => {
      d.tracks[0].clips[0].notes[1].id = d.tracks[0].clips[0].notes[0].id; return d;
    })).toThrow();
    expect(bus.canUndo('p')).toBe(false); expect(JSON.stringify(p)).toBe(original);
  });
});
