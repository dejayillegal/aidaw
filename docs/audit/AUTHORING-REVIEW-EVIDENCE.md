# Inspect, Compare and reviewed authoring

Baseline: owner-merged PR24, main eb9b94e. This correction addresses the reported Inspect/Compare/editor/layer/instrument flows; it does not promote all release gates.

## Reproduced and corrected

- Selecting an instrument appended a second active instrument. The failing integration fixture observed two instead of one. Device choice now replaces the instrument through canonical chain editing, retains MIDI processors/effects and clips, rejects missing/locked/unsupported targets, and requires explicit review. Undo retains the original chain. Unknown template identifiers no longer silently become Operator.
- Adding a role omitted from an existing compact song plan generated no notes. The failing fixture observed zero notes for a requested acid layer. The planner now includes the actual role set, respects the chosen style/seed, preserves protected clip spans and unrelated tracks, and rejects a requested nonempty generation when the chosen style/duration omits that role. Unsupported generation meters fail explicitly rather than produce misplaced material.
- The right-side Inspector was an additional AI panel; Compare had no implemented flow. Inspector now reads the selected canonical layer/clip/note, supports actual note/clip edits and displays registry device support. Compare shows the most recent command's before-state against the current project, with note-record changes even when note counts are unchanged. Exact values remain available on demand. Comparison history is session history, not a claim of persisted version history.
- Clip selection lived only inside Timeline and was lost when it unmounted. App now owns the editor selection; Timeline, Inspector and AI phrase tools use the same selected clip. View → Inspect/Compare/Clip editor routes to a visible working view from other workspaces. Missing selections after undo resolve to an existing layer.
- New empty clips had no direct form-based note creation. Add clip creates canonical MIDI content, Add C4 note adds a unique real note in a free position, and the existing editor changes its properties. These are undoable and survive native reopen.
- Chord/MIDI phrase tools used the first clip regardless of editor selection; chord changes also rewrote the project key. They now preview the chosen clip in clip-local time, retain hidden trimmed notes and other clips/layers, and keep project key/scale unchanged. Track-wide quantize/velocity actions retain their explicitly track-wide scope.

## Preview, audition and apply contract

`prepareProjectChange` uses an isolated command bus to validate and project a detached candidate; it does not write the real history, queue or score. Source and candidate snapshots are immutable. Apply checks both queue identity and the exact baseline, then commits one existing command transaction. Stale proposals cannot overwrite later edits or another project even when revision numbers match.

The native dialog presents the actual structural comparison, Cancel and Apply. Audition current/proposal uses real Web Audio, restarts from the beginning and leaves the editable project unchanged. Stop/cancel/apply restore the current runtime state. A proposal becoming stale stops its audition and disables Apply. This is not a claim of seamless, phase-aligned hardware A/B switching or complete live/offline DSP parity.

Composition, role generation, instrument choice, polymeter, chord/MIDI phrase changes and AI-panel velocity/quantize actions use review. Direct manual note/clip/mixer operations remain immediate and undoable. Discarding a proposal adds no history entry.

The composer exposes the actual uint32 seed and strategy. The disconnected macroform selector and text prompt are removed. No cloud model is called from these actions; the unreachable remote call/silent-fallback path was removed. Structural similarity and MIDI overlap labels no longer imply measured audio compatibility or phase quality. The registered orchestration palette and device approximations retain their existing disclosed limits.

## Executed verification

`authoring-review-check.mjs` is a required Android CI step. It uses native Chromium/Web Audio/IndexedDB and actual controls, including:

1. Add a previously absent role, review/cancel without mutation, apply a nonempty layer, undo/redo while preserving every other layer.
2. Audition an instrument proposal through the native engine, measure actual audio, stop without changing score, apply exactly one instrument while retaining notes.
3. Compare the most recent edit; create an empty clip, add/edit a real note, and verify Inspector/editor share its identity.
4. Select a later clip for a phrase tool, preserve earlier material and key, and prevent stale approval after an intervening edit.
5. Reach Inspect controls at phone, short landscape and desktop sizes, then save/reopen the actual edited tracks.

Reports in evidence/authoring-review contain scoped results. The native fixture uses original synthetic project data, not private user project bytes. Existing arrangement editing, track tools, mixed-meter editing, Session, recovery and export regressions remain required.

The initial concurrent local run exhausted the default five-second test watchdog in unchanged XML/migration fixtures on this host. Final local validation runs serially with a 20-second watchdog; repository CI retains its normal defaults. The expanded multi-project App case retains its existing 45-second integration watchdog while traversing preview and approval as well as round-trip/undo behavior. Watchdog settings are recorded explicitly, not treated as a UI/audio performance budget. Native geometry and Web Audio evidence do not qualify physical Android installation, audio focus, fold hardware, native latency, licensed Live reopening or producer listening.
