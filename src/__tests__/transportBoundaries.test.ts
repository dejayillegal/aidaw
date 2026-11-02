// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ParametricWebAudioEngine } from '../engine/webAudioSynth';
import { buildStarterAbletonXml, parseAlsXmlString } from '../engine/alsXmlEngine';
import type { HumanizationConfig, TransportConfig } from '../types/ableton';

const humanization = { cutoffHz: 145 } as HumanizationConfig;
const transport: TransportConfig = { loopEnabled: false, loopStartBar: 2, loopLengthBars: 2,
  metronomeEnabled: false, followPlayhead: true, showAutomationLanes: false };

function fixture(loopEnabled = false) {
  const project = parseAlsXmlString(buildStarterAbletonXml('berghain-134', 777, 4).xml);
  project.tempo = 120;
  const engine = new ParametricWebAudioEngine();
  engine.setState(project, humanization, { ...transport, loopEnabled });
  const clock = { currentTime: 0 };
  // Only the clock/lifecycle is substituted. These tests do not claim native PCM evidence.
  Object.assign(engine, { ctx: clock, isPlaying: true, anchorBeat: 0, anchorAudioTime: 0 });
  vi.spyOn(engine as any, 'ensureContext').mockImplementation(() => {});
  vi.spyOn(engine as any, 'syncLiveTrackChannels').mockImplementation(() => {});
  vi.stubGlobal('requestAnimationFrame', () => 1);
  vi.stubGlobal('cancelAnimationFrame', () => {});
  return { engine, project, clock };
}

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('audio-clock transport boundaries', () => {
  it.each(['pause', 'stop'] as const)('%s captures the clock without waiting for a visual frame, then resumes there', method => {
    const { engine, clock } = fixture();
    clock.currentTime = 2.625;
    engine[method]();
    expect(engine.getCurrentBeat()).toBe(5.25);
    clock.currentTime = 30;
    expect(engine.getCurrentBeat()).toBe(5.25);
    engine.start();
    clock.currentTime = 30.02 + 0.5;
    expect(engine.getCurrentBeat()).toBeCloseTo(6.25, 10);
    engine.stop();
  });

  it('captures the wrapped position after skipped loop cycles on pause', () => {
    const { engine, clock } = fixture(true);
    clock.currentTime = 42.625 / 2;
    engine.pause();
    expect(engine.getCurrentBeat()).toBe(10.625);
  });

  it('seeks to the exact endpoint and resumes a fractional final slice without an early restart', () => {
    const { engine } = fixture();
    engine.pause();
    engine.seek(16);
    expect(engine.getCurrentBeat()).toBe(16);
    engine.seek(15.999875);
    engine.start();
    expect(engine.getCurrentBeat()).toBe(15.999875);
    engine.stop();
  });

  it.each([NaN, Infinity, -Infinity])('rejects invalid seek %s before retiring voices or changing deduplication/history', target => {
    const { engine } = fixture();
    const retire = vi.fn();
    const keys = new Set(['0_retained']);
    Object.assign(engine, { bus: { activeVoices: new Set([retire]) }, scheduledNoteKeys: keys });
    expect(() => engine.seek(target)).toThrow(/TIMELINE_INPUT/);
    expect(retire).not.toHaveBeenCalled();
    expect((engine as any).scheduledNoteKeys).toBe(keys);
    expect((engine as any).anchorBeat).toBe(0);
  });

  it('keeps the audio-clock position at a tempo edit and invalidates prepaid old-tempo events', () => {
    const { engine, project, clock } = fixture();
    // Isolate timing from channel-strip DSP; setState still executes the real anchoring path.
    Object.assign(engine, { scheduledNoteKeys: new Set(['0_old_tempo']) });
    clock.currentTime = 2.625;
    engine.setState({ ...project, tempo: 60 }, humanization);
    expect(engine.getCurrentBeat()).toBe(5.25);
    expect((engine as any).scheduledNoteKeys.size).toBe(0);
    clock.currentTime += 0.75;
    expect(engine.getCurrentBeat()).toBe(6);
    engine.stop();
  });

  it('holds the exact arrangement end when the scheduler stops playback', () => {
    const { engine, project, clock } = fixture();
    project.tracks = [];
    const stopped = vi.fn();
    const playhead = vi.fn();
    Object.assign(engine, { bus: { activeVoices: new Set() }, noiseBuffer: {}, onPlaybackStopped: stopped, onPlayheadUpdate: playhead });
    clock.currentTime = 9;
    (engine as any).runLookaheadScheduler();
    expect(engine.getIsPlaying()).toBe(false);
    expect(engine.getCurrentBeat()).toBe(16);
    expect(playhead).toHaveBeenCalledWith(16, 145, -60);
    expect(stopped).toHaveBeenCalledOnce();
  });
});
