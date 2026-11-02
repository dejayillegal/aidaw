# ADR-007 — Independent MIDI Session performance on the existing DAW clock

Status: implemented engineering candidate; owner/release acceptance pending.
Date: 2 November 2026 (IST).

## Context and constraints

The attached review identified destructive Scene launch, four-decimal coordinate rounding and silently truncated insert chains. Scene launch replaced Arrangement clips in `App.tsx`; it had no independent playback state. The user requires one project authority, atomic commands, persistence, shared supported DSP and explicit Arrangement capture. Physical Android playback/export remains a prerequisite for composition expansion.

## Alternatives considered

1. Retain Scene→Arrangement replacement. Smallest implementation, but changes the score merely to audition/launch clips and fails the Session contract.
2. Introduce a runtime-only Session controller with its own clock/score. Simplifies immediate launch, but duplicates authority, loses decisions on reopen and breaks command history.
3. Store Session slots and launch decisions in the existing project; project them into the existing AudioContext scheduler. Requires serialization/migration and scheduling invalidation, but preserves Arrangement, commands/history and DSP ownership.

## Implemented decision

Engineering selected option3 for the tested MIDI subset. `AbletonTrack.sessionClips` owns slot content; `AbletonProjectState.session` stores a quantization setting and bounded ordered launch/stop decisions. Existing `audioSettings.transport.arrangementMode` owns playback precedence. There is no second clock or render engine.

`queueSessionLaunch` validates targets and creates quantized decisions. Explicit stop is permitted for locked tracks; locking still protects slot content, launch/regeneration and capture edits. Empty scene slots stop their track. The App reserves the existing lookahead interval when requesting a launch during playback. Stopped launch starts transport at its current position. Clip length defines repetition; same-coordinate decisions resolve in recorded order.

`sessionEventsInWindow` is a pure projection of canonical decisions/slots into an existing scheduling window. Source-event probability uses the unchanged shared eligibility rule, so repeated cycles retain stable decisions. The existing voice graph processes those projected notes. Track-scoped retirement schedules the established fade at a new launch/stop boundary. Removing decisions or clearing a performance invalidates affected scheduled voices/deduplication keys. Scheduling-key ownership maps describe native resources, not another score.

`captureSessionPerformance` appends realized MIDI performance events as editable Arrangement clips within an explicit range/destination, using one undoable transaction. Existing clips remain. Captured probability becomes1 for events that actually qualify. The UI warns that overlapping destinations mix with existing material. Offline rendering requires capture and return to Arrangement; it does not silently render a different score while Session owns transport.

## Persistence and compatibility

- Existing native v1/v2 documents remain readable.
- A project containing Session performance saves as native v3. Session-free documents retain v2. Older readers already reject unknown native versions rather than substitute Arrangement playback.
- Session recovery uses journal envelope2; legacy/envelope1 remains readable. An older implementation's existing future-envelope guard preserves envelope2 without downgrade. The current reader checks checksums, canonical state and the same atomic previous-revision journal.
- App XML contains `ParametricSessionState Version=1` and Session slots in existing track metadata. These are app projections. A warning explicitly states that native Ableton Session slots/launch execution are not exported. Actual Live interoperability remains unqualified.
- XML comparison uses the prior complete projection rather than a half-built document where new Session references precede slot metadata.

Rollback: retain original files/journals and a v3-capable reader. A source revert cannot make an older reader understand v3/envelope2. Do not remove version guards, delete recovery data or label an ALS export a full Session backup.

## Bounds, risks and ownership

The candidate supports four MIDI slots per track, clip-length repetition, quantized launch/retrigger/stop, pause/resume of the musical clock, explicit return and append capture. Limits are4096 launch decisions,4096 beats per capture and100000 clip/note visits per projection window; errors are explicit. Scheduling keys are retired as windows advance.

General native loop/slip/warp semantics, tempo/meter maps, integer PPQ migration, audio-track Session playback, follow actions, continuous audio recording, sustaining-note phase reconstruction after seek/resume, full expression/device execution and live/offline captured PCM qualification remain open. Quantized retirement uses the existing smoothing/voice-stop path; native meter activity does not establish click-free production listening or hardware behavior.

DAW maintainers own model/command/timing integration; audio maintainers own DSP/resource qualification; Android/interop/producer reviewers remain external qualification dependencies. These are responsibility areas, not invented personnel assignments.

Revisit when adding audio clips, follow actions, tempo/meter maps, a streaming renderer, a versioned native Live fixture corpus, or higher performance-history/capture limits. Any such change needs migration and executable preservation/scheduling evidence.

## Validation

Behavioral regressions cover tuplet/fine-grid precision, note resize/XML/reload/history, insert limits before playback/offline allocation, capability reporting and preview rejection; Session copy/launch/stop/retrigger/capture, locked/invalid targets, native v3 round trip and corrupt state/mode rejection.

Real Chromium UI exercises slot copy, Scene launch, playback beyond a one-bar Arrangement, native meter activity on two tracks, independent stop, capture, return/undo/redo, native download/reopen, real IndexedDB recovery, clearing sustaining voices, four viewport sizes and visible insert-limit rejection. The existing20-repeat/64bar/mastering/probability/recovery suite remains intact with unchanged PCM tolerances. The current execution record supplies exact results and commit provenance. These tested subsets do not certify a complete gate.
