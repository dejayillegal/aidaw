// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { ParametricWebAudioEngine } from "../engine/webAudioSynth";
import {
  buildStarterAbletonXml,
  parseAlsXmlString,
} from "../engine/alsXmlEngine";
import { DEFAULT_MASTER_BUS } from "../engine/projectDefaults";
import type { HumanizationConfig, TransportConfig } from "../types/ableton";

const humanization = { cutoffHz: 145 } as HumanizationConfig;
const transport: TransportConfig = {
  loopEnabled: false,
  loopStartBar: 2,
  loopLengthBars: 2,
  metronomeEnabled: false,
  followPlayhead: true,
  showAutomationLanes: false,
};

function fixture(loopEnabled = false) {
  const project = parseAlsXmlString(
    buildStarterAbletonXml("berghain-134", 777, 4).xml,
  );
  project.tempo = 120;
  const engine = new ParametricWebAudioEngine();
  engine.setState(project, humanization, { ...transport, loopEnabled });
  const clock = { currentTime: 0 };
  Object.assign(engine, {
    ctx: clock,
    isPlaying: true,
    anchorBeat: 0,
    anchorAudioTime: 0,
  });
  vi.spyOn(engine as any, "ensureContext").mockImplementation(() => {});
  vi.spyOn(engine as any, "syncLiveTrackChannels").mockImplementation(() => {});
  vi.stubGlobal("requestAnimationFrame", () => 1);
  vi.stubGlobal("cancelAnimationFrame", () => {});
  return { engine, project, clock };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("audio-clock transport boundaries", () => {
  it.each(["pause", "stop"] as const)(
    "%s captures the clock without waiting for a visual frame, then resumes there",
    (method) => {
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
    },
  );

  it("captures the wrapped position after skipped loop cycles on pause", () => {
    const { engine, clock } = fixture(true);
    clock.currentTime = 42.625 / 2;
    engine.pause();
    expect(engine.getCurrentBeat()).toBe(10.625);
  });

  it("seeks to the exact endpoint and resumes a fractional final slice without an early restart", () => {
    const { engine } = fixture();
    engine.pause();
    engine.seek(16);
    expect(engine.getCurrentBeat()).toBe(16);
    engine.seek(15.999875);
    engine.start();
    expect(engine.getCurrentBeat()).toBe(15.999875);
    engine.stop();
  });

  it.each([NaN, Infinity, -Infinity])(
    "rejects invalid seek %s before retiring voices or changing deduplication/history",
    (target) => {
      const { engine } = fixture();
      const retire = vi.fn();
      const keys = new Set(["0_retained"]);
      Object.assign(engine, {
        bus: { activeVoices: new Set([retire]) },
        scheduledNoteKeys: keys,
      });
      expect(() => engine.seek(target)).toThrow(/TIMELINE_INPUT/);
      expect(retire).not.toHaveBeenCalled();
      expect((engine as any).scheduledNoteKeys).toBe(keys);
      expect((engine as any).anchorBeat).toBe(0);
    },
  );

  it("keeps the audio-clock position at a tempo edit and invalidates prepaid old-tempo events", () => {
    const { engine, project, clock } = fixture();
    Object.assign(engine, { scheduledNoteKeys: new Set(["0_old_tempo"]) });
    clock.currentTime = 2.625;
    engine.setState({ ...project, tempo: 60 }, humanization);
    expect(engine.getCurrentBeat()).toBe(5.25);
    expect((engine as any).scheduledNoteKeys.size).toBe(0);
    clock.currentTime += 0.75;
    expect(engine.getCurrentBeat()).toBe(6);
    engine.stop();
  });

  it("holds the exact arrangement end when the scheduler stops playback", () => {
    const { engine, project, clock } = fixture();
    project.tracks = [];
    const stopped = vi.fn();
    const playhead = vi.fn();
    Object.assign(engine, {
      bus: { activeVoices: new Set() },
      noiseBuffer: {},
      onPlaybackStopped: stopped,
      onPlayheadUpdate: playhead,
    });
    clock.currentTime = 9;
    (engine as any).runLookaheadScheduler();
    expect(engine.getIsPlaying()).toBe(false);
    expect(engine.getCurrentBeat()).toBe(16);
    expect(playhead).toHaveBeenCalledWith(16, 145, -60);
    expect(stopped).toHaveBeenCalledOnce();
  });
});

function liveBus() {
  const param = () => ({ setTargetAtTime: vi.fn() });
  return {
    activeVoices: new Set(),
    trackVoices: new Map(),
    masterGain: { gain: param() },
    reverbReturnGain: { gain: param() },
    delayReturnGain: { gain: param() },
    delayFeedbackGain: { gain: param() },
    delayLeftTapGain: { gain: param() },
    compressor: { threshold: param() },
    delayNodeL: { delayTime: param() },
    delayNodeR: { delayTime: param() },
  };
}
describe("live score reconciliation", () => {
  it("updates the master without adding hidden glue makeup gain and keeps declared return levels", () => {
    const { engine, project } = fixture();
    const bus = liveBus();
    Object.assign(engine, { bus });
    const master = {
      ...DEFAULT_MASTER_BUS,
      masterVolumeDb: -6,
      glueCompressionDrive: 0.8,
    };
    engine.setState(project, humanization, undefined, master);
    expect(bus.masterGain.gain.setTargetAtTime.mock.calls[0][0]).toBeCloseTo(
      10 ** (-6 / 20),
      12,
    );
    expect(bus.reverbReturnGain.gain.setTargetAtTime.mock.calls[0][0]).toBe(
      master.reverbReturnLevel * 0.85,
    );
    expect(bus.delayReturnGain.gain.setTargetAtTime.mock.calls[0][0]).toBe(
      master.delayReturnLevel * 0.75,
    );
  });
  it("retires only edited arrangement voices and pending keys while preserving the other layer and clock", () => {
    const { engine, project, clock } = fixture();
    const bus = liveBus();
    const edited = vi.fn(),
      other = vi.fn();
    const a = project.tracks[0].id,
      b = project.tracks[1].id;
    bus.trackVoices.set(a, new Set([edited]));
    bus.trackVoices.set(b, new Set([other]));
    Object.assign(engine, {
      bus,
      scheduledNoteKeys: new Set(["a-key", "b-key"]),
      arrangementScheduledKeys: new Map([
        ["a-key", a],
        ["b-key", b],
      ]),
    });
    clock.currentTime = 2.625;
    const candidate = structuredClone(project);
    candidate.tracks[0].clips[0].notes[0].pitch++;
    engine.setState(candidate, humanization);
    expect(edited).toHaveBeenCalledOnce();
    expect(other).not.toHaveBeenCalled();
    expect([...(engine as any).scheduledNoteKeys]).toEqual(["b-key"]);
    expect([...(engine as any).arrangementScheduledKeys.keys()]).toEqual([
      "b-key",
    ]);
    expect(engine.getCurrentBeat()).toBe(5.25);
    clock.currentTime += 0.25;
    expect(engine.getCurrentBeat()).toBe(5.75);
  });
});

it("retains the current master automation value when installing an unrelated edit", () => {
  const { engine, project, clock } = fixture();
  const bus = liveBus();
  Object.assign(engine, { bus });
  clock.currentTime = 2;
  engine.setState(project, humanization, undefined, {
    ...DEFAULT_MASTER_BUS,
    masterVolumeDb: -6,
    masterAutomationPoints: [
      { beat: 0, value: 0.3 },
      { beat: 16, value: 0.3 },
    ],
  });
  expect(bus.masterGain.gain.setTargetAtTime.mock.calls[0][0]).toBeCloseTo(
    10 ** (-8 / 20),
    12,
  );
});
