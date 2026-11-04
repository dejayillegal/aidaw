import { createSongPlan, composeSongPlan } from "../engine/songPlanEngine";
import { deleteClipsInBeatRange } from "../engine/compositionIntelligenceEngine";
import {
  editArrangementClip,
  editArrangementNote,
  toggleArrangementNote,
  pianoPitchRows,
} from "../engine/arrangementEditing";
import { synchronizeProjectStateToXml } from "../engine/alsXmlEngine";
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import {
  buildStarterAbletonXml,
  parseAbletonXmlDom,
} from "../engine/alsXmlEngine";
import {
  duplicateTrackClip,
  moveOrResizeTrackClip,
  splitTrackClipAtBeat,
  consolidateTrackClipsInRange,
} from "../engine/compositionIntelligenceEngine";
import { StudioCommandBus } from "../services/commandBus";
import { compileOrUpdateArrangementSchedule } from "../engine/webAudioSynth";
import type { AbletonMidiClip } from "../types/ableton";
const clip = (id = "a", start = 0, length = 1): AbletonMidiClip => ({
  id,
  name: id,
  startTime: start,
  length,
  endTime: start + length,
  notes: [
    {
      id: "n",
      time: start + 1 / 7,
      quantizedTime: start + 1 / 7,
      duration: 1 / 3,
      pitch: 60,
      velocity: 85,
      isGhost: false,
      probability: 0.625,
      harmonicOwner: "voiced-midi",
      isSlide: true,
    },
  ],
});
const fixture = () => {
  const { xml } = buildStarterAbletonXml("berghain-134", 777, 1);
  const p = parseAbletonXmlDom(xml, "editing", xml);
  p.tracks = p.tracks.slice(0, 2);
  p.tracks[0].clips = [clip()];
  p.tracks[1].clips = [clip("other")];
  return p;
};
describe("Arrangement editing integrity", () => {
  it("retains sub-grid timing and short lengths when duplicating, moving and resizing clips", () => {
    const original = clip();
    const dup = duplicateTrackClip([original], "a").duplicatedClip!;
    expect(dup.notes[0].time).toBe(original.notes[0].time + 1);
    const moved = moveOrResizeTrackClip([original], "a", 2 / 7, 1 / 128)[0];
    expect(moved.length).toBe(1 / 128);
    expect(moved.notes[0].time).toBe(original.notes[0].time + 2 / 7);
  });
  it("splits at a single canonical tick and retains the sounding continuation of a crossing note", () => {
    const original = {
      ...clip(),
      notes: [{ ...clip().notes[0], time: 0, quantizedTime: 0, duration: 0.5 }],
    };
    const result = splitTrackClipAtBeat([original], 1 / 960);
    expect(result.splitOccurred).toBe(true);
    expect(result.clips[0].length).toBe(1 / 960);
    const right = result.clips[1].notes[0];
    expect(right.time).toBe(1 / 960);
    expect(right.duration).toBeCloseTo(0.5 - 1 / 960, 12);
    expect(right.harmonicOwner).toBe("voiced-midi");
  });
  it("consolidates the exact selected range without manufacturing four beats", () => {
    const merged = consolidateTrackClipsInRange([clip()], 0, 0.5);
    expect(merged.find((c) => c.startTime === 0)?.length).toBe(0.5);
  });
  it("allocates distinct clone identities even when the wall clock is frozen", () => {
    vi.spyOn(Date, "now").mockReturnValue(123);
    try {
      const first = duplicateTrackClip([clip()], "a");
      const second = duplicateTrackClip(first.clips, "a");
      expect(second.duplicatedClip!.id).not.toBe(first.duplicatedClip!.id);
    } finally {
      vi.restoreAllMocks();
    }
  });
  it("rejects invalid clip coordinates instead of clamping corrupt input", () => {
    for (const start of [NaN, Infinity, -1])
      expect(() => moveOrResizeTrackClip([clip()], "a", start, 1)).toThrow();
    expect(() => moveOrResizeTrackClip([clip()], "a", 0, 0)).toThrow();
  });
  it("prevents locked content changes and deletion at the transaction boundary while allowing mixer edits", () => {
    const p = fixture();
    p.tracks[0].locked = true;
    const bus = new StudioCommandBus();
    expect(() =>
      bus.executeMutation("lock", "note", "clip_edit", p, (d) => {
        d.tracks[0].clips[0].notes[0].pitch++;
        return d;
      }),
    ).toThrow(/LOCKED/);
    expect(() =>
      bus.executeMutation("lock", "delete", "clip_edit", p, (d) => ({
        ...d,
        tracks: d.tracks.slice(1),
      })),
    ).toThrow(/LOCKED/);
    expect(bus.getHistory("lock")).toHaveLength(0);
    expect(() =>
      bus.executeMutation("lock", "mute", "mixer", p, (d) => {
        d.tracks[0].muted = true;
        return d;
      }),
    ).not.toThrow();
  });
  it("recompiles exact fine timing, event identity and probability changes for live playback", () => {
    const p = fixture();
    const before = compileOrUpdateArrangementSchedule(p, 4, null);
    const changed = structuredClone(p);
    changed.tracks[0].clips[0].notes[0].time += 1 / 100000;
    changed.tracks[0].clips[0].notes[0].id = "renamed";
    changed.tracks[0].clips[0].notes[0].probability = 0.62501;
    const after = compileOrUpdateArrangementSchedule(
      changed,
      4,
      before.schedule,
    );
    expect(after.rebuiltTracksCount).toBe(1);
    expect(after.schedule.events.some((e) => e.note.id === "renamed")).toBe(
      true,
    );
  });
  it("deletes only a middle range, preserving outside notes and a sustained suffix", () => {
    const c = {
      ...clip(),
      length: 4,
      endTime: 4,
      notes: [
        {
          ...clip().notes[0],
          id: "long",
          time: 0.5,
          quantizedTime: 0.5,
          duration: 3,
        },
        {
          ...clip().notes[0],
          id: "end",
          time: 3.75,
          quantizedTime: 3.75,
          duration: 0.1,
        },
      ],
    };
    const parts = deleteClipsInBeatRange([c], 1, 3);
    expect(parts.map((c) => [c.startTime, c.length])).toEqual([
      [0, 1],
      [3, 1],
    ]);
    expect(parts[0].notes[0].duration).toBe(0.5);
    expect(parts[1].notes.find((n) => n.id === "end")?.time).toBe(3.75);
    expect(parts[1].notes[0].time).toBe(3);
    expect(parts[1].notes[0].duration).toBe(0.5);
  });
  it("keeps typed note/clip editing isolated and undoable through XML/reopen", () => {
    let p = fixture();
    p.rawXmlModified = synchronizeProjectStateToXml(p);
    const bus = new StudioCommandBus();
    const other = structuredClone(p.tracks[1]);
    const moved = bus.executeMutation("editing", "place", "clip_edit", p, (d) =>
      editArrangementClip(d, d.tracks[0].id, "a", {
        kind: "place",
        startBeat: 2 / 7,
        lengthBeats: 2,
      }),
    );
    const edited = bus.executeMutation(
      "editing",
      "note",
      "clip_edit",
      moved,
      (d) =>
        editArrangementNote(d, d.tracks[0].id, "a", "n", {
          pitch: 64,
          velocity: 77,
          probability: 0.375,
          duration: 0.25,
        }),
    );
    expect(edited.tracks[1]).toEqual(other);
    expect(
      parseAbletonXmlDom(edited.rawXmlModified, "reopen").tracks[0].clips[0]
        .notes[0].pitch,
    ).toBe(64);
    expect(bus.undo("editing")!.tracks).toEqual(moved.tracks);
    expect(bus.redo("editing")!.tracks).toEqual(edited.tracks);
    const depth = bus.getHistory("editing").length;
    expect(() =>
      bus.executeMutation("editing", "bad", "clip_edit", edited, (d) =>
        editArrangementNote(d, d.tracks[0].id, "a", "n", { time: 99 }),
      ),
    ).toThrow(/EDIT_RANGE/);
    expect(bus.getHistory("editing")).toHaveLength(depth);
  });
  it("draws on the half-open destination and preserves every chord register in the piano map", () => {
    const p = fixture();
    const t = p.tracks[0];
    t.clips = [
      { ...clip("left"), notes: [{ ...clip().notes[0], pitch: 48 }] },
      {
        ...clip("right", 1),
        notes: [
          { ...clip().notes[0], pitch: 72, time: 1.5, quantizedTime: 1.5 },
        ],
      },
    ];
    const q = toggleArrangementNote(p, t.id, 1, 60, 1 / 128);
    expect(q.tracks[0].clips[0]).toEqual(t.clips[0]);
    expect(
      q.tracks[0].clips[1].notes.some(
        (n) => n.pitch === 60 && n.time === 1 && n.duration === 1 / 128,
      ),
    ).toBe(true);
    const rows = pianoPitchRows(t);
    expect(rows).toContain(48);
    expect(rows).toContain(72);
    expect(new Set(rows).size).toBe(rows.length);
  });
  it("preserves native note metadata from every source during consolidation, including reused note IDs", () => {
    let p = fixture();
    p.tracks[0].clips = [clip("one", 0, 1), clip("two", 1, 1)];
    p.rawXmlModified = synchronizeProjectStateToXml(p);
    const doc = new DOMParser().parseFromString(
      p.rawXmlModified,
      "application/xml",
    );
    const sourceClips = Array.from(
      doc.querySelectorAll("MidiTrack"),
    )[0].querySelectorAll("MidiClip");
    sourceClips[0]
      .querySelector("MidiNoteEvent")!
      .setAttribute("NativeExpression", "first");
    sourceClips[1]
      .querySelector("MidiNoteEvent")!
      .setAttribute("NativeExpression", "second");
    p.rawXmlModified = new XMLSerializer().serializeToString(doc);
    const merged = new StudioCommandBus().executeMutation(
      "merge",
      "consolidate",
      "clip_edit",
      p,
      (d) => ({
        ...d,
        tracks: d.tracks.map((t, i) =>
          i ? t : { ...t, clips: consolidateTrackClipsInRange(t.clips, 0, 2) },
        ),
      }),
    );
    const output = new DOMParser().parseFromString(
      merged.rawXmlModified,
      "application/xml",
    );
    const notes = Array.from(
      output.querySelectorAll("MidiTrack"),
    )[0].querySelectorAll("MidiNoteEvent");
    expect(
      Array.from(notes)
        .map((n) => n.getAttribute("NativeExpression"))
        .sort(),
    ).toEqual(["first", "second"]);
    expect(new Set(merged.tracks[0].clips[0].notes.map((n) => n.id)).size).toBe(
      2,
    );
  });
  it("ripples the selected layer in Shuffle mode without changing other layers or Session", () => {
    const p = fixture();
    p.tracks[0].clips = [clip("first", 0, 1), clip("second", 2, 1)];
    const other = structuredClone(p.tracks[1]);
    const laterOnly = editArrangementClip(p, p.tracks[0].id, "second", {
      kind: "place",
      startBeat: 3,
      lengthBeats: 1,
      mode: "shuffle",
    });
    expect(laterOnly.tracks[0].clips[0]).toEqual(p.tracks[0].clips[0]);
    const moved = editArrangementClip(p, p.tracks[0].id, "first", {
      kind: "place",
      startBeat: 1,
      lengthBeats: 2,
      mode: "shuffle",
    });
    expect(moved.tracks[0].clips.map((c) => c.startTime)).toEqual([1, 4]);
    expect(moved.tracks[1]).toEqual(other);
    const noteClip = {
      ...clip("notes", 0, 4),
      notes: [
        {
          ...clip().notes[0],
          id: "first",
          time: 1,
          quantizedTime: 1,
          duration: 0.5,
        },
        {
          ...clip().notes[0],
          id: "second",
          time: 2,
          quantizedTime: 2,
          duration: 0.5,
        },
      ],
    };
    p.tracks[0].clips = [noteClip];
    const edited = editArrangementNote(p, p.tracks[0].id, "notes", "first", {
      time: 1.5,
      mode: "shuffle",
    });
    expect(edited.tracks[0].clips[0].notes[1].time).toBe(2.5);
    expect(edited.tracks[0].clips[0].length).toBe(4.5);
    expect(edited.tracks[1]).toEqual(other);
  });
});

it("protects manually edited clips during scoped composition and persists their ownership through ALS", () => {
  let p = fixture();
  p.arrangementLengthBars = 64;
  const plan = createSongPlan(p, 777, "hypnotic_evolving");
  p = composeSongPlan(p, plan);
  const t = p.tracks[0],
    c = t.clips.find((c) => c.notes.length)!;
  p = editArrangementNote(p, t.id, c.id, c.notes[0].id, { velocity: 73 });
  const edited = p.tracks[0].clips.find((x) => x.id === c.id)!;
  const regenerated = composeSongPlan(p, plan, {
    fromBeat: c.startTime,
    toBeat: c.startTime + c.length,
    trackId: t.id,
  });
  expect(regenerated.tracks[0].clips.find((x) => x.id === c.id)).toEqual(
    edited,
  );
  expect(
    regenerated.tracks[0].clips
      .filter((x) => x.id !== c.id)
      .every(
        (x) =>
          x.startTime + x.length <= c.startTime ||
          x.startTime >= c.startTime + c.length,
      ),
  ).toBe(true);
  const reopened = parseAbletonXmlDom(
    synchronizeProjectStateToXml({
      ...regenerated,
      rawXmlModified: synchronizeProjectStateToXml(p),
    }),
    "owned",
  );
  expect(reopened.tracks[0].clips.find((x) => x.id === c.id)?.userEdited).toBe(
    true,
  );
  const released = editArrangementClip(p, t.id, c.id, {
    kind: "protect",
    enabled: false,
  });
  expect(
    released.tracks[0].clips.find((x) => x.id === c.id)?.userEdited,
  ).toBeUndefined();
  const replay = composeSongPlan(released, plan, {
    fromBeat: c.startTime,
    toBeat: c.startTime + c.length,
    trackId: t.id,
  });
  expect(
    replay.tracks[0].clips
      .flatMap((c) => c.notes)
      .find((n) => n.id === c.notes[0].id)?.velocity,
  ).not.toBe(73);
});

it("rejects consolidation of incompatible opaque clip metadata without committing partial state", () => {
  let p = fixture();
  p.tracks[0].clips = [clip("one", 0, 1), clip("two", 1, 1)];
  p.rawXmlModified = synchronizeProjectStateToXml(p);
  const doc = new DOMParser().parseFromString(
    p.rawXmlModified,
    "application/xml",
  );
  const clips = doc
    .querySelectorAll("MidiTrack")[0]
    .querySelectorAll("MidiClip");
  const envelope = doc.createElement("NativeEnvelope");
  envelope.setAttribute("OpaqueValue", "must-survive");
  clips[1].appendChild(envelope);
  p.rawXmlModified = new XMLSerializer().serializeToString(doc);
  const bus = new StudioCommandBus();
  const original = p.rawXmlModified;
  expect(() =>
    bus.executeMutation("opaque", "merge", "clip_edit", p, (d) => ({
      ...d,
      tracks: d.tracks.map((t, i) =>
        i ? t : { ...t, clips: consolidateTrackClipsInRange(t.clips, 0, 2) },
      ),
    })),
  ).toThrow(/CLIP_CONSOLIDATION_UNSUPPORTED/);
  expect(bus.getHistory("opaque")).toHaveLength(0);
  expect(p.rawXmlModified).toBe(original);
});
it("can duplicate and split a previously consolidated clip without stale source references", () => {
  let p = fixture();
  p.tracks[0].clips = [clip("one", 0, 1), clip("two", 1, 1)];
  p.rawXmlModified = synchronizeProjectStateToXml(p);
  const bus = new StudioCommandBus(),
    id = p.tracks[0].id;
  p = bus.executeMutation("sequence", "consolidate", "clip_edit", p, (d) => ({
    ...d,
    tracks: d.tracks.map((t, i) =>
      i ? t : { ...t, clips: consolidateTrackClipsInRange(t.clips, 0, 2) },
    ),
  }));
  const merged = p.tracks[0].clips[0].id;
  expect(p.tracks[0].clips[0].sourceClipIds).toBeUndefined();
  p = bus.executeMutation("sequence", "duplicate", "clip_edit", p, (d) =>
    editArrangementClip(d, id, merged, { kind: "duplicate" }),
  );
  expect(p.tracks[0].clips).toHaveLength(2);
  p = bus.executeMutation("sequence", "split", "clip_edit", p, (d) =>
    editArrangementClip(d, id, merged, { kind: "split", atBeat: 0.5 }),
  );
  expect(p.tracks[0].clips).toHaveLength(3);
  expect(bus.getHistory("sequence")).toHaveLength(3);
  expect(
    parseAbletonXmlDom(p.rawXmlModified, "sequence").tracks[0].clips,
  ).toHaveLength(3);
});
