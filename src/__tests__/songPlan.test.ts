import { evaluateTrackMidiDeviceChain } from "../engine/abletonCapabilityMatrix";
// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  buildStarterAbletonXml,
  parseAbletonXmlDom,
  synchronizeProjectStateToXml,
} from "../engine/alsXmlEngine";
import {
  createSongPlan,
  composeSongPlan,
  materializeSongPlanTrack,
} from "../engine/songPlanEngine";
import { assertProjectState } from "../engine/projectStateContracts";
const fixture = () => {
  const { xml } = buildStarterAbletonXml("berghain-134", 777, 4, "sketch");
  return { ...parseAbletonXmlDom(xml, "song", xml), arrangementLengthBars: 64 };
};
describe("Persisted complete composition", () => {
  it("writes new material through the final phrase, unequal occupancy, transitions and shared harmony", () => {
    const p = fixture();
    const plan = createSongPlan(p, 777, "hypnotic_evolving");
    const composed = composeSongPlan(p, plan);
    assertProjectState(composed);
    expect(
      Math.max(
        ...composed.tracks.flatMap((t) =>
          t.clips.flatMap((c) => c.notes.map((n) => n.time)),
        ),
      ),
    ).toBeGreaterThan(248);
    const spans = composed.tracks.map((t) =>
      t.clips.reduce((n, c) => n + c.length, 0),
    );
    expect(new Set(spans).size).toBeGreaterThan(3);
    expect(plan.transitions.length).toBeGreaterThan(2);
    expect(
      composed.tracks
        .flatMap((t) => t.clips.flatMap((c) => c.notes))
        .some((n) => n.motifRole === "fill"),
    ).toBe(true);
    expect(composeSongPlan(p, plan).tracks).toEqual(composed.tracks);
    const xml = synchronizeProjectStateToXml(composed, p);
    expect(parseAbletonXmlDom(xml, "roundtrip", xml).songPlan).toEqual(plan);
  });
  it("preserves locked tracks and every out-of-range note, including intersecting manual clips", () => {
    const p = fixture();
    p.tracks[0].locked = true;
    const plan = createSongPlan(p, 55, "detroit_funk");
    const q = composeSongPlan(p, plan, { fromBeat: 64, toBeat: 80 });
    expect(q.tracks[0]).toEqual(p.tracks[0]);
    for (let i = 1; i < p.tracks.length; i++)
      expect(
        q.tracks[i].clips
          .flatMap((c) => c.notes)
          .filter((n) => n.time < 64 || n.time >= 80),
      ).toEqual(
        p.tracks[i].clips
          .flatMap((c) => c.notes)
          .filter((n) => n.time < 64 || n.time >= 80),
      );
  });
  it("keeps chord tones and bass on shared harmonic events with deliberate upper register spacing", () => {
    const p = fixture();
    const plan = createSongPlan(p, 12, "detroit_funk");
    expect(new Set(plan.harmony.map((h) => h.rootMidi)).size).toBeGreaterThan(
      1,
    );
    for (const h of plan.harmony) {
      expect(h.voicing.every((n) => n >= 48 && n <= 84)).toBe(true);
      expect(h.voicing.every((n, i) => !i || n - h.voicing[i - 1] >= 3)).toBe(
        true,
      );
    }
    const track = p.tracks.find((t) => t.archetype === "synth")!;
    const clips = materializeSongPlanTrack(plan, track);
    for (const n of clips.flatMap((c) => c.notes)) {
      const h = plan.harmony.find(
        (h) => n.time >= h.fromBeat && n.time < h.toBeat,
      )!;
      expect(h.voicing).toContain(n.pitch);
    }
  });
  it("rejects unknown plan versions and invalid ranges without mutating project", () => {
    const p = fixture();
    const plan = createSongPlan(p, 9, "dub_space");
    expect(() => composeSongPlan(p, { ...plan, version: 99 })).toThrow(
      "SONG_PLAN_VERSION",
    );
    expect(() =>
      composeSongPlan(p, plan, { fromBeat: 80, toBeat: 64 }),
    ).toThrow("SONG_PLAN_RANGE");
  });
  it("allows repeated scoped regeneration and preserves explicit slide articulation through XML", () => {
    const p = fixture(),
      plan = createSongPlan(p, 18, "acid_modulation");
    const a = composeSongPlan(p, plan);
    const b = composeSongPlan(a, plan, { fromBeat: 128, toBeat: 144 });
    const c = composeSongPlan(b, plan, { fromBeat: 128, toBeat: 144 });
    assertProjectState(c);
    const xml = synchronizeProjectStateToXml(c);
    const reloaded = parseAbletonXmlDom(xml, "articulation", xml);
    const expected = c.tracks
      .find((t) => t.archetype === "acid")!
      .clips.flatMap((c) => c.notes)
      .filter((n) => n.isSlide)
      .map((n) => n.id)
      .sort();
    expect(expected.length).toBeGreaterThan(0);
    expect(
      reloaded.tracks
        .find((t) => t.archetype === "acid")!
        .clips.flatMap((c) => c.notes)
        .filter((n) => n.isSlide)
        .map((n) => n.id)
        .sort(),
    ).toEqual(expected);
  });
  it("produces distinct style ensembles at an identical seed rather than renaming one score", () => {
    const p = fixture();
    const styles = [
      "hypnotic_evolving",
      "asymmetric_industrial",
      "minimal_groove",
      "dub_space",
      "detroit_funk",
      "raw_warehouse",
      "acid_modulation",
      "peak_rolling",
    ] as const;
    const fingerprints = styles.map((style) => {
      const q = composeSongPlan(p, createSongPlan(p, 777, style));
      return JSON.stringify(
        q.tracks.map((t) =>
          t.clips.flatMap((c) =>
            c.notes.map((n) => [n.time, n.pitch, n.velocity]),
          ),
        ),
      );
    });
    expect(new Set(fingerprints).size).toBeGreaterThanOrEqual(7);
  });
  it("gives voiced MIDI explicit ownership so the starter Chord device cannot harmonize it twice", () => {
    const p = fixture();
    const q = composeSongPlan(p, createSongPlan(p, 777, "hypnotic_evolving"));
    const pad = q.tracks.find((t) => t.archetype === "pad")!;
    const notes = pad.clips.flatMap((c) => c.notes);
    expect(notes.length).toBeGreaterThan(0);
    expect(
      evaluateTrackMidiDeviceChain(pad, notes).map((n) => n.pitch),
    ).toEqual(notes.map((n) => n.pitch));
    expect(
      evaluateTrackMidiDeviceChain(
        pad,
        notes.map((n) => ({ ...n, harmonicOwner: undefined })),
      ).length,
    ).toBeGreaterThan(notes.length);
  });
});
