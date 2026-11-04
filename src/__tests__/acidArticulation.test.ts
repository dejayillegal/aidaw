// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  resolveAcidSlideStart,
  routedKickBeats,
} from "../engine/webAudioSynth";
import {
  buildStarterAbletonXml,
  parseAbletonXmlDom,
} from "../engine/alsXmlEngine";
describe("Acid articulation and routed ducking", () => {
  it("glides only on explicit articulation from the previous sounding pitch, never from a fabricated interval", () => {
    const previous = {
      start: 1,
      end: 2,
      startHz: 220,
      targetHz: 440,
      glideEnd: 1.062,
    };
    expect(resolveAcidSlideStart(false, 1.5, 330, previous)).toBe(330);
    expect(resolveAcidSlideStart(true, 1.5, 330, previous)).toBe(440);
    expect(resolveAcidSlideStart(true, 3, 330, previous)).toBe(330);
    expect(resolveAcidSlideStart(true, 1.031, 330, previous)).toBeCloseTo(
      Math.sqrt(220 * 440),
    );
  });
  it("uses irregular audible kick events and follows effective mute/solo", () => {
    const { xml } = buildStarterAbletonXml("berghain-134", 77, 1);
    const p = parseAbletonXmlDom(xml, "k", xml);
    const kick = p.tracks.find((t) => t.archetype === "kick")!,
      acid = p.tracks.find((t) => t.archetype === "acid")!;
    const n = kick.clips[0].notes[0];
    kick.clips = [
      {
        ...kick.clips[0],
        notes: [{ ...n, time: 0.375, quantizedTime: 0.375 }],
      },
    ];
    expect(routedKickBeats(p, acid, 0, 2)).toEqual([0.375]);
    kick.muted = true;
    expect(routedKickBeats(p, acid, 0, 2)).toEqual([]);
    kick.muted = false;
    acid.soloed = true;
    expect(routedKickBeats(p, acid, 0, 2)).toEqual([]);
  });
});
