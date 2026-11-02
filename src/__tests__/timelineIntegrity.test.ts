// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { playbackRegion, positionAtBeat, noteIsInsideClip } from '../engine/timelineCoordinates';
import { ParametricWebAudioEngine, evaluateAutomationAtBeat } from '../engine/webAudioSynth';
import { applyClipPositionWithEditMode, resolveBeatForEditMode, StudioCommandBus } from '../services/commandBus';
import { buildStarterAbletonXml, parseAlsXmlString } from '../engine/alsXmlEngine';
import type { TransportConfig } from '../types/ableton';

const loop: TransportConfig = { loopEnabled: true, loopStartBar: 4, loopLengthBars: 16, metronomeEnabled: false, followPlayhead: true, showAutomationLanes: false };
describe('G1 shared timeline boundaries', () => {
  it('wraps a loop clipped by the song end by its actual span, across many repeats', () => {
    const region = playbackRegion(20, loop);
    expect(region).toEqual({ start: 12, end: 20, span: 8, enabled: true });
    for (let cycle = 1; cycle < 1000; cycle++) expect(positionAtBeat(12 + cycle * 8 + 1.25, 20, region)).toBe(13.25);
    expect(positionAtBeat(100, 20, playbackRegion(20, { ...loop, loopEnabled: false }))).toBe(20);
  });
  it('the existing engine getter does not wrap a completed non-loop song to zero', () => {
    const p = parseAlsXmlString(buildStarterAbletonXml('berghain-134', 777, 4).xml);
    const engine = new ParametricWebAudioEngine();
    engine.setState(p, { cutoffHz: 145 } as any, { ...loop, loopEnabled: false });
    // Inject only clock readings, not synthesis, to exercise the production transport getter.
    Object.assign(engine, { ctx: { currentTime: 1000 }, isPlaying: true, anchorBeat: 0, anchorAudioTime: 0 });
    expect(engine.getCurrentBeat()).toBe(16);
  });
  it('retains prepaid next-cycle deduplication keys when the scheduler crosses a loop boundary', () => {
    const p = parseAlsXmlString(buildStarterAbletonXml('berghain-134', 777, 4).xml);
    p.tracks = [];
    const engine = new ParametricWebAudioEngine();
    engine.setState(p, { cutoffHz: 145 } as any, { ...loop, loopStartBar: 2, loopLengthBars: 16 });
    Object.assign(engine, { ctx: { currentTime: 16 * 60 / p.tempo }, isPlaying: true,
      anchorBeat: 0, anchorAudioTime: 0, bus: {}, noiseBuffer: {}, loopGeneration: 0,
      scheduledNoteKeys: new Set(['0_old', '1_next', 'metro_1_4']) });
    (engine as any).runLookaheadScheduler();
    expect((engine as any).scheduledNoteKeys).toEqual(new Set(['1_next', 'metro_1_4']));
  });
  it('uses exact half-open sub-quarter-beat clip bounds for note eligibility', () => {
    const clip = { id: 'short', name: 'Short', startTime: 10, length: 0.125, notes: [] };
    for (const [time, expected] of [[9.999, false], [10, true], [10.1249, true], [10.125, false], [10.2, false]] as const) {
      expect(noteIsInsideClip({ time } as any, clip)).toBe(expected);
    }
  });
  it('does not silently clamp long automation and edit coordinates to previous default song lengths', () => {
    expect(evaluateAutomationAtBeat([{ beat: 0, value: 0 }, { beat: 8192, value: 1 }], 6144)).toBe(0.75);
    expect(resolveBeatForEditMode(6144, 'spot')).toBe(6144);
  });
  it('moves a clip with no endTime using its explicit short length and preserves fine note grid displacement', () => {
    const p = parseAlsXmlString(buildStarterAbletonXml('berghain-134', 777, 4).xml);
    const track = p.tracks[0];
    track.clips = [{ id: 'short', name: 'Short', startTime: 0, length: 0.125,
      notes: [{ ...track.clips[0].notes[0], time: 0.03125, quantizedTime: 0.03125, duration: 0.03125 }] }];
    const next = new StudioCommandBus().executeMutation('p', 'move', 'clip_edit', p,
      draft => applyClipPositionWithEditMode(draft, track.id, 0, 4, 'spot'));
    expect(next.tracks[0].clips[0].endTime).toBe(4.125);
    expect(next.tracks[0].clips[0].length).toBe(0.125);
    expect(next.tracks[0].clips[0].notes[0].quantizedTime).toBe(4.03125);
    expect(parseAlsXmlString(next.rawXmlModified).tracks[0].clips[0].length).toBe(0.125);
  });
});

it('advances every skipped loop generation after a late scheduler tick instead of retaining expired next-cycle keys', () => {
  const p = parseAlsXmlString(buildStarterAbletonXml('berghain-134', 777, 4).xml); p.tracks = [];
  const engine = new ParametricWebAudioEngine();
  engine.setState(p, { cutoffHz: 145 } as any, { ...loop, loopStartBar: 2, loopLengthBars: 16 });
  Object.assign(engine, { ctx: { currentTime: 52.25 * 60 / p.tempo }, isPlaying: true,
    anchorBeat: 0, anchorAudioTime: 0, bus: {}, noiseBuffer: {}, loopGeneration: 0,
    scheduledNoteKeys: new Set(['1_expired', '4_current']) });
  (engine as any).runLookaheadScheduler();
  expect((engine as any).loopGeneration).toBe(4);
  expect((engine as any).scheduledNoteKeys).toEqual(new Set(['4_current']));
});
