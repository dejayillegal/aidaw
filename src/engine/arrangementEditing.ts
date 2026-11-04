import type {
  AbletonMidiClip,
  AbletonProjectState,
  AbletonTrack,
  MidiNoteEvent,
  TimelineEditMode,
} from "../types/ableton";
import {
  duplicateTrackClip,
  moveOrResizeTrackClip,
  nextArrangementIdentity,
  splitTrackClipAtBeat,
} from "./compositionIntelligenceEngine";
import {
  MAX_SUPPORTED_TIMELINE_BARS,
  MusicalTimeService,
} from "./timelineCoordinates";

export type ArrangementClipEdit =
  | {
      kind: "place";
      startBeat: number;
      lengthBeats: number;
      mode?: TimelineEditMode;
    }
  | { kind: "split"; atBeat: number }
  | { kind: "duplicate" }
  | { kind: "delete" }
  | { kind: "protect"; enabled: boolean };
export type ArrangementNoteEdit = Partial<
  Pick<
    MidiNoteEvent,
    | "time"
    | "quantizedTime"
    | "duration"
    | "pitch"
    | "velocity"
    | "probability"
    | "isSlide"
    | "isAccent"
    | "harmonicOwner"
  >
> & { delete?: boolean; mode?: TimelineEditMode };

export function editableMidiTrack(
  project: AbletonProjectState,
  trackId: string,
): AbletonTrack {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track || track.type !== "midi")
    throw new Error("EDIT_TARGET: select an existing MIDI track");
  if (track.locked)
    throw new Error(`TRACK_LOCKED: unlock ${track.name} before editing`);
  return track;
}
function extendExtent(
  project: AbletonProjectState,
  tracks: AbletonTrack[],
): AbletonProjectState {
  const end = Math.max(
    0,
    ...tracks.flatMap((t) => t.clips.map((c) => c.startTime + c.length)),
  );
  let low = 1,
    high = MAX_SUPPORTED_TIMELINE_BARS;
  if (
    MusicalTimeService.arrangementTotalBeats(
      { ...project, arrangementLengthBars: high },
      1,
    ) < end
  )
    throw new Error("EDIT_EXTENT: move exceeds the supported timeline");
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (
      MusicalTimeService.arrangementTotalBeats(
        { ...project, arrangementLengthBars: mid },
        1,
      ) < end
    )
      low = mid + 1;
    else high = mid;
  }
  return {
    ...project,
    tracks,
    arrangementLengthBars: Math.max(project.arrangementLengthBars || 1, low),
  };
}
export function editArrangementClip(
  project: AbletonProjectState,
  trackId: string,
  clipId: string,
  edit: ArrangementClipEdit,
): AbletonProjectState {
  const track = editableMidiTrack(project, trackId);
  const target = track.clips.find((c) => c.id === clipId);
  if (!target) throw new Error("EDIT_TARGET: clip is missing");
  let clips: AbletonMidiClip[];
  switch (edit.kind) {
    case "place": {
      if (edit.mode === "shuffle") {
        if (
          !Number.isFinite(edit.startBeat) ||
          edit.startBeat < 0 ||
          !Number.isFinite(edit.lengthBeats) ||
          edit.lengthBeats <= 0
        )
          throw new Error("EDIT_RANGE: invalid shuffle placement");
        const move = edit.startBeat - target.startTime,
          ripple =
            edit.startBeat +
            edit.lengthBeats -
            target.startTime -
            target.length;
        clips = track.clips
          .map((c) => {
            const delta =
              c.id === clipId
                ? move
                : c.startTime >= target.startTime + target.length
                  ? ripple
                  : 0;
            const length = c.id === clipId ? edit.lengthBeats : c.length;
            if (c.id !== clipId && delta === 0) return c;
            return {
              ...c,
              startTime: c.startTime + delta,
              endTime: c.startTime + delta + length,
              length,
              notes: c.notes.map((n) => ({
                ...n,
                time: n.time + delta,
                quantizedTime: n.quantizedTime + delta,
              })),
            };
          })
          .sort((a, b) => a.startTime - b.startTime);
      } else
        clips = moveOrResizeTrackClip(
          track.clips,
          clipId,
          edit.startBeat,
          edit.lengthBeats,
        );
      break;
    }
    case "split": {
      if (
        !Number.isFinite(edit.atBeat) ||
        edit.atBeat <= target.startTime ||
        edit.atBeat >= target.startTime + target.length
      )
        throw new Error("EDIT_RANGE: split must be inside the selected clip");
      clips = splitTrackClipAtBeat(track.clips, edit.atBeat, clipId).clips;
      break;
    }
    case "duplicate":
      clips = duplicateTrackClip(track.clips, clipId).clips;
      break;
    case "protect":
      clips = track.clips.map((c) =>
        c.id === clipId
          ? { ...c, userEdited: edit.enabled ? true : undefined }
          : c,
      );
      break;
    case "delete":
      clips = track.clips.filter((c) => c.id !== clipId);
      break;
    default:
      throw new Error("EDIT_ACTION: unsupported clip edit");
  }
  return extendExtent(
    project,
    project.tracks.map((t) =>
      t.id === trackId
        ? {
            ...t,
            clips: clips.map((c) =>
              track.clips.includes(c) || edit.kind === "protect"
                ? c
                : { ...c, userEdited: true },
            ),
          }
        : t,
    ),
  );
}
/** Clip and note identity are both mandatory: native note IDs can repeat in other clips. */
export function editArrangementNote(
  project: AbletonProjectState,
  trackId: string,
  clipId: string,
  noteId: string,
  edit: ArrangementNoteEdit,
): AbletonProjectState {
  const track = editableMidiTrack(project, trackId),
    clip = track.clips.find((c) => c.id === clipId),
    note = clip?.notes.find((n) => n.id === noteId);
  if (!clip || !note) throw new Error("EDIT_TARGET: clip/note is missing");
  let notes: MidiNoteEvent[];
  if (edit.delete) notes = clip.notes.filter((n) => n.id !== noteId);
  else {
    const { delete: ignored, mode, ...patch } = edit;
    const next = { ...note, ...patch };
    if (
      ![
        next.time,
        next.quantizedTime,
        next.duration,
        next.pitch,
        next.velocity,
        next.probability ?? 1,
      ].every(Number.isFinite) ||
      next.time < 0 ||
      next.duration <= 0 ||
      !Number.isInteger(next.pitch) ||
      next.pitch < 0 ||
      next.pitch > 127 ||
      !Number.isInteger(next.velocity) ||
      next.velocity < 1 ||
      next.velocity > 127 ||
      (next.probability ?? 1) < 0 ||
      (next.probability ?? 1) > 1
    )
      throw new Error(
        "EDIT_NOTE: invalid pitch, timing, velocity or probability",
      );
    if (
      edit.time !== undefined &&
      next.time !== note.time &&
      (next.time < clip.startTime || next.time >= clip.startTime + clip.length)
    )
      throw new Error(
        "EDIT_RANGE: move the note inside this clip or extend the clip first",
      );
    if (
      edit.duration !== undefined &&
      next.duration !== note.duration &&
      next.time + next.duration > clip.startTime + clip.length
    )
      throw new Error(
        "EDIT_RANGE: extend the clip before extending the note beyond its end",
      );
    if (edit.time !== undefined && edit.quantizedTime === undefined)
      next.quantizedTime = note.quantizedTime + next.time - note.time;
    const ripple =
      mode === "shuffle"
        ? next.time + next.duration - note.time - note.duration
        : 0;
    notes = clip.notes
      .map((n) =>
        n.id === noteId
          ? next
          : mode === "shuffle" && n.time > note.time
            ? {
                ...n,
                time: n.time + ripple,
                quantizedTime: n.quantizedTime + ripple,
              }
            : n,
      )
      .sort((a, b) => a.time - b.time || a.pitch - b.pitch);
    if (mode === "shuffle") {
      if (notes.some((n) => n.time < 0))
        throw new Error("EDIT_RANGE: shuffle would move a note before zero");
      const length = Math.max(1 / 960, clip.length + ripple);
      const tracks = project.tracks.map((t) =>
        t.id === trackId
          ? {
              ...t,
              clips: t.clips.map((c) =>
                c.id === clipId
                  ? {
                      ...c,
                      notes,
                      length,
                      endTime: c.startTime + length,
                      userEdited: true,
                    }
                  : c,
              ),
            }
          : t,
      );
      return extendExtent(project, tracks);
    }
  }
  return {
    ...project,
    tracks: project.tracks.map((t) =>
      t.id === trackId
        ? {
            ...t,
            clips: t.clips.map((c) =>
              c.id === clipId ? { ...c, notes, userEdited: true } : c,
            ),
          }
        : t,
    ),
  };
}
export function toggleArrangementNote(
  project: AbletonProjectState,
  trackId: string,
  beat: number,
  pitch: number,
  duration = 0.25,
  clipId?: string,
): AbletonProjectState {
  const track = editableMidiTrack(project, trackId);
  if (
    ![beat, pitch, duration].every(Number.isFinite) ||
    beat < 0 ||
    !Number.isInteger(pitch) ||
    pitch < 0 ||
    pitch > 127 ||
    duration <= 0
  )
    throw new Error("EDIT_NOTE: invalid draw coordinates");
  const matches = track.clips.filter(
    (c) =>
      (!clipId || c.id === clipId) &&
      beat >= c.startTime &&
      beat < c.startTime + c.length,
  );
  if (matches.length > 1)
    throw new Error(
      "EDIT_TARGET: overlapping clips; select the destination clip first",
    );
  let target = matches[0];
  const clips = [...track.clips];
  if (!target) {
    if (clipId)
      throw new Error("EDIT_RANGE: drawing outside the selected clip");
    const previousEnd = Math.max(
      0,
      ...track.clips
        .filter((c) => c.startTime + c.length <= beat)
        .map((c) => c.startTime + c.length),
    );
    const start = Math.max(previousEnd, Math.floor(beat / 4) * 4);
    const nextClip = track.clips
      .filter((c) => c.startTime > beat)
      .sort((a, b) => a.startTime - b.startTime)[0];
    const end = Math.min(start + 4, nextClip?.startTime ?? Infinity);
    target = {
      id: nextArrangementIdentity(
        `manual_${track.id}`,
        clips.map((c) => c.id),
      ),
      name: `${track.name} MIDI`,
      startTime: start,
      endTime: end,
      length: end - start,
      notes: [],
    };
    clips.push(target);
  }
  const existing = target.notes.find(
    (n) =>
      n.pitch === pitch &&
      Math.abs(n.quantizedTime - beat) < Math.min(duration * 0.4, 1 / 960),
  );
  const notes = existing
    ? target.notes.filter((n) => n.id !== existing.id)
    : [
        ...target.notes,
        {
          id: nextArrangementIdentity(
            "manual_note",
            target.notes.map((n) => n.id),
          ),
          time: beat,
          quantizedTime: beat,
          duration: Math.min(duration, target.startTime + target.length - beat),
          pitch,
          velocity: 98,
          isGhost: false,
          ...(target.notes.some((n) => n.harmonicOwner === "voiced-midi")
            ? { harmonicOwner: "voiced-midi" as const }
            : {}),
        },
      ].sort((a, b) => a.time - b.time || a.pitch - b.pitch);
  return extendExtent(
    project,
    project.tracks.map((t) =>
      t.id === trackId
        ? {
            ...t,
            clips: clips
              .map((c) =>
                c.id === target.id ? { ...c, notes, userEdited: true } : c,
              )
              .sort((a, b) => a.startTime - b.startTime),
          }
        : t,
    ),
  );
}
/** One pitch mapping for drawing, hit-testing and editing; low chord voices never fold onto another row. */
export function pianoPitchRows(track: AbletonTrack): number[] {
  const pitches = track.clips.flatMap((c) =>
    c.notes
      .filter((n) => n.time >= c.startTime && n.time < c.startTime + c.length)
      .map((n) => n.pitch),
  );
  const low = Math.max(0, Math.min(...(pitches.length ? pitches : [36])) - 2),
    high = Math.min(127, Math.max(...(pitches.length ? pitches : [36])) + 2);
  return Array.from({ length: high - low + 1 }, (_, i) => high - i);
}
