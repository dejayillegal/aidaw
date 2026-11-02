// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildStarterAbletonXml, parseAlsXmlString } from '../engine/alsXmlEngine';
import { StudioCommandBus, applyNoteEditWithMode } from '../services/commandBus';

function fixture() {
  const { xml } = buildStarterAbletonXml('berghain-134', 777, 4);
  return parseAlsXmlString(xml);
}

describe('G1 command state → serialization → reload', () => {
  it('serializes a note move performed only in canonical typed state', () => {
    const project = fixture();
    const track = project.tracks[0];
    const bus = new StudioCommandBus();
    const next = bus.executeMutation('p', 'move', 'edit_mode', project,
      draft => applyNoteEditWithMode(draft, track.id, 0, track.clips[0].notes[0].id, 0.5, 'spot'));
    const reloaded = parseAlsXmlString(next.rawXmlModified);
    expect(reloaded.tracks[0].clips[0].notes.find(n => n.id === track.clips[0].notes[0].id)?.time).toBe(0.5);
    expect(bus.undo('p')?.tracks).toEqual(project.tracks);
    expect(bus.redo('p')?.tracks).toEqual(next.tracks);
  });
  it('persists all mixer parameters, track state, automation, tempo and chosen empty extent', () => {
    const project = fixture();
    const next = new StudioCommandBus().executeMutation('p', 'edit', 'mixer', project, draft => {
      draft.tempo = 151.25; draft.arrangementLengthBars = 192;
      draft.tracks[0].muted = true; draft.tracks[0].soloed = true; draft.tracks[0].locked = true;
      draft.tracks[0].mixer = { ...draft.tracks[0].mixer, pan: -0.123456, volumeDb: -8.123456, reverbSend: 0.123456, delaySend: 0.234567 };
      draft.tracks[0].automationPoints = [{ beat: 0, value: 0.1 }, { beat: 767.875, value: 0.9 }];
      return draft;
    });
    const actual = parseAlsXmlString(next.rawXmlModified);
    expect(actual.tempo).toBe(next.tempo);
    expect(actual.arrangementLengthBars).toBe(192);
    for (const key of ['muted', 'soloed', 'locked', 'mixer', 'automationPoints'] as const) {
      expect(actual.tracks[0][key]).toEqual(next.tracks[0][key]);
    }
  });
  it('clears the final locator and preserves unrelated XML on a mixer-only edit', () => {
    const project = fixture();
    const doc = new DOMParser().parseFromString(project.rawXmlModified, 'application/xml');
    const clip = doc.querySelector('MidiClip')!;
    const expression = doc.createElement('FutureExpressionContainer'); expression.setAttribute('Value', 'retain'); clip.append(expression);
    project.rawXmlModified = new XMLSerializer().serializeToString(doc);
    const bus = new StudioCommandBus();
    const withMarker = bus.executeMutation('p', 'marker', 'locator', project, d => ({ ...d, memoryLocations: [{ id: '9', number: 1, name: 'Only', bar: 1, beat: 0, color: '#fff' }] }));
    const without = bus.executeMutation('p', 'clear', 'locator', withMarker, d => ({ ...d, memoryLocations: [] }));
    const dom = new DOMParser().parseFromString(without.rawXmlModified, 'application/xml');
    expect(dom.querySelectorAll('Locator')).toHaveLength(0);
    expect(dom.querySelector('FutureExpressionContainer')?.getAttribute('Value')).toBe('retain');
  });
  it('rejects an invalid edit atomically without replacing the current state or undo history', () => {
    const project = fixture(); const before = JSON.stringify(project); const bus = new StudioCommandBus();
    expect(() => bus.executeMutation('p', 'bad', 'mixer', project, draft => {
      draft.tracks[0].mixer.pan = NaN; return draft;
    })).toThrow();
    expect(JSON.stringify(project)).toBe(before);
    expect(bus.canUndo('p')).toBe(false);
  });
});

it('keeps distinct native automation targets opaque instead of mixing their units into one browser curve', () => {
  const project = fixture();
  const doc = new DOMParser().parseFromString(project.rawXmlModified, 'application/xml');
  const envelope = doc.createElement('AutomationEnvelopes');
  envelope.innerHTML = '<AutomationEnvelope Id="99"><EnvelopeTarget><PointeeId Value="123" /></EnvelopeTarget><Automation><Events><FloatEvent Time="0" Value="20000" /></Events></Automation></AutomationEnvelope>';
  doc.querySelector('MidiTrack')!.append(envelope);
  const parsed = parseAlsXmlString(new XMLSerializer().serializeToString(doc));
  expect(parsed.tracks[0].automationPoints.every(p => p.value >= 0 && p.value <= 1)).toBe(true);
  expect(parsed.compatibilityWarnings?.some(w => w.includes('native automation'))).toBe(true);
  const next = new StudioCommandBus().executeMutation('p', 'pan', 'mixer', parsed, p => {
    p.tracks[0].mixer.pan = 0.2; return p;
  });
  expect(new DOMParser().parseFromString(next.rawXmlModified, 'application/xml').querySelector('FloatEvent')?.getAttribute('Value')).toBe('20000');
});
