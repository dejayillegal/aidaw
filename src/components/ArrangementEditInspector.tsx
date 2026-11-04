import { nextArrangementIdentity } from "../engine/compositionIntelligenceEngine";
import React from "react";
import type { AbletonTrack } from "../types/ableton";
import type {
  ArrangementClipEdit,
  ArrangementNoteEdit,
} from "../engine/arrangementEditing";

interface Props {
  track?: AbletonTrack;
  clipId?: string;
  noteId?: string;
  playheadBeat: number;
  onSelect: (clipId: string, noteId?: string) => void;
  onEditClip?: (
    trackId: string,
    clipId: string,
    edit: ArrangementClipEdit,
  ) => void;
  onEditNote?: (
    trackId: string,
    clipId: string,
    noteId: string,
    edit: ArrangementNoteEdit,
  ) => void;
}
const control =
  "min-h-11 w-full min-w-0 rounded border border-slate-700 bg-[#101722] px-2 text-xs text-slate-100";
export function ArrangementEditInspector({
  track,
  clipId,
  noteId,
  playheadBeat,
  onSelect,
  onEditClip,
  onEditNote,
}: Props) {
  if (!track || track.type !== "midi") return null;
  const clip = track.clips.find((c) => c.id === clipId) ?? track.clips[0];
  const note = clip?.notes.find((n) => n.id === noteId) ?? clip?.notes[0];
  return (
    <details
      className="shrink-0 border-y border-slate-700 bg-[#111722] text-slate-200"
      data-testid="arrangement-edit-inspector"
    >
      <summary className="min-h-11 px-3 py-2 cursor-pointer text-xs">
        Clip &amp; Note Editor · {clip?.name ?? "Select a MIDI clip"}
        {track.locked ? " · Locked" : ""}
      </summary>
      <div className="max-h-64 overflow-auto px-3 pb-3 space-y-3">
        <label className="block text-xs">
          Selected clip
          <select
            aria-label="Selected arrangement clip"
            className={control}
            value={clip?.id ?? ""}
            onChange={(e) => onSelect(e.target.value)}
          >
            <option value="" disabled>
              No clips
            </option>
            {track.clips.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {c.startTime}–{c.startTime + c.length} beats
              </option>
            ))}
          </select>
        </label>
        {clip && (
          <>
            <form
              key={`${clip.id}:${clip.startTime}:${clip.length}`}
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                onEditClip?.(track.id, clip.id, {
                  kind: "place",
                  startBeat: Number(f.get("start")),
                  lengthBeats: Number(f.get("length")),
                });
              }}
            >
              <fieldset
                disabled={track.locked || !onEditClip}
                className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end"
              >
                <label className="text-xs col-span-2 sm:col-span-4 flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    aria-label="Protect clip during phrase regeneration"
                    checked={Boolean(clip.userEdited)}
                    onChange={(e) =>
                      onEditClip?.(track.id, clip.id, {
                        kind: "protect",
                        enabled: e.target.checked,
                      })
                    }
                  />
                  Protect clip during phrase regeneration
                </label>
                <label className="text-xs">
                  Start (beats)
                  <input
                    aria-label="Clip start beat"
                    name="start"
                    type="number"
                    min="0"
                    step="any"
                    required
                    defaultValue={clip.startTime}
                    className={control}
                  />
                </label>
                <label className="text-xs">
                  Length (beats)
                  <input
                    aria-label="Clip length beats"
                    name="length"
                    type="number"
                    min="0.000001"
                    step="any"
                    required
                    defaultValue={clip.length}
                    className={control}
                  />
                </label>
                <label className="text-xs">
                  Split (beat)
                  <input
                    aria-label="Split clip beat"
                    name="split"
                    type="number"
                    min={clip.startTime}
                    max={clip.startTime + clip.length}
                    step="any"
                    defaultValue={
                      playheadBeat > clip.startTime &&
                      playheadBeat < clip.startTime + clip.length
                        ? playheadBeat
                        : clip.startTime + clip.length / 2
                    }
                    className={control}
                  />
                </label>
                <button className={control} type="submit">
                  Apply clip edit
                </button>
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    className={control}
                    onClick={() => {
                      const id = nextArrangementIdentity(
                        `${clip.id}_copy`,
                        track.clips.map((c) => c.id),
                      );
                      onEditClip?.(track.id, clip.id, { kind: "duplicate" });
                      onSelect(id);
                    }}
                  >
                    Duplicate selected clip
                  </button>
                  <button
                    type="button"
                    className={control}
                    onClick={(e) =>
                      onEditClip?.(track.id, clip.id, {
                        kind: "split",
                        atBeat: Number(
                          (
                            e.currentTarget.form?.elements.namedItem(
                              "split",
                            ) as HTMLInputElement
                          )?.value,
                        ),
                      })
                    }
                  >
                    Split selected clip
                  </button>
                  <button
                    type="button"
                    className={control}
                    onClick={() =>
                      onEditClip?.(track.id, clip.id, { kind: "delete" })
                    }
                  >
                    Delete selected clip
                  </button>
                </div>
              </fieldset>
            </form>
            <label className="block text-xs">
              Selected note
              <select
                aria-label="Selected MIDI note"
                className={control}
                value={note?.id ?? ""}
                onChange={(e) => onSelect(clip.id, e.target.value)}
              >
                <option value="" disabled>
                  No notes
                </option>
                {clip.notes.map((n) => (
                  <option key={n.id} value={n.id}>
                    Pitch {n.pitch} · beat {n.time} · {n.id}
                  </option>
                ))}
              </select>
            </label>
            {note && (
              <form
                key={`${clip.id}:${note.id}:${JSON.stringify(note)}`}
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  onEditNote?.(track.id, clip.id, note.id, {
                    time: Number(f.get("time")),
                    duration: Number(f.get("duration")),
                    pitch: Number(f.get("pitch")),
                    velocity: Number(f.get("velocity")),
                    probability: Number(f.get("probability")),
                    isSlide: f.has("slide"),
                    isAccent: f.has("accent"),
                  });
                }}
              >
                <fieldset
                  disabled={track.locked || !onEditNote}
                  className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 items-end"
                >
                  {[
                    ["time", "Note start beat", note.time, 0, undefined],
                    [
                      "duration",
                      "Note duration beats",
                      note.duration,
                      0.000001,
                      undefined,
                    ],
                    ["pitch", "Note MIDI pitch", note.pitch, 0, 127],
                    ["velocity", "Note velocity", note.velocity, 1, 127],
                    [
                      "probability",
                      "Note probability",
                      note.probability ?? 1,
                      0,
                      1,
                    ],
                  ].map(([name, label, value, min, max]) => (
                    <label key={String(name)} className="text-xs">
                      {label}
                      <input
                        aria-label={String(label)}
                        name={String(name)}
                        type="number"
                        min={Number(min)}
                        max={max === undefined ? undefined : Number(max)}
                        step={
                          name === "pitch" || name === "velocity" ? 1 : "any"
                        }
                        required
                        defaultValue={Number(value)}
                        className={control}
                      />
                    </label>
                  ))}
                  <div className="text-xs">
                    <label className="flex min-h-11 items-center gap-2">
                      <input
                        name="slide"
                        type="checkbox"
                        defaultChecked={note.isSlide}
                      />
                      Slide
                    </label>
                    <label className="flex min-h-11 items-center gap-2">
                      <input
                        name="accent"
                        type="checkbox"
                        defaultChecked={note.isAccent}
                      />
                      Accent
                    </label>
                  </div>
                  <div>
                    <button type="submit" className={control}>
                      Apply note edit
                    </button>
                    <button
                      type="button"
                      className={control}
                      onClick={() =>
                        onEditNote?.(track.id, clip.id, note.id, {
                          delete: true,
                        })
                      }
                    >
                      Delete selected note
                    </button>
                  </div>
                </fieldset>
              </form>
            )}
          </>
        )}
        <p className="text-[11px] text-slate-400">
          Drag a clip body to move it or its right edge to trim. Drag a note to
          move time/pitch or its right edge to resize. Alt-click a note to
          delete. Each drag is one undoable edit; trimming preserves hidden clip
          notes.
        </p>
      </div>
    </details>
  );
}
