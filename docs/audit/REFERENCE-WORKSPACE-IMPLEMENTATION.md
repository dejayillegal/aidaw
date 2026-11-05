# Reference projects and integrated workspace correction

Baseline: owner-merged PR #23, main `0703a63`. Requirement authority: standalone master directive, November 5, 2026. This milestone implements the reference-guided workspace correction within the existing DAW. It does not replace the canonical project or audio engine with any of the references.

## Reference inventory and assessment

All three ZIPs were enumerated and every file was decoded, hashed and indexed. [reference-inventory.json](evidence/reference-workspace/reference-inventory.json) records all 73 non-directory entries, including package/lock files, source modules, configuration and declared domain types/functions. Source review followed each entry point through composition, state/history/storage, playback, export and UI workspaces. Screenshots were captured and inspected at 1440×1000 and 390×844.

| Archive | Contents / useful workflow patterns | Limits observed in source and captures |
|---|---|---|
| ai-audio-workstation-specification.zip (23 files) | React/Vite; composition panel, arrangement, pattern editor, mixer, inspector; audio engine/render/voices separated; compact file/transport actions and clear section map. | `src/lib/project.ts` suppresses storage quota errors; shallow validation and localStorage do not replace transactional recovery. `src/audio/render.ts` uses stage-weighted progress and kick-trigger gain envelopes, not a complete sidechain detector/graph. Fixed beat/step assumptions need mapped-time review. |
| ai-powered-daw-specification.zip (20 files) | React/Vite; Arrange/Session/Mix/Devices/Browser with dedicated mobile destinations; search/category browser, contextual bottom editors and prominent export. | `src/daw/store.tsx` stores whole-project before/after strings and suppresses library-write errors. Audio/export noise uses independent `Math.random()` calls, requiring explicit reproducibility/parity work. Types/SMF export use scalar BPM and four-beat bars. Browser rendering was checked; no Android runtime qualification was inferred. |
| ai-daw-architecture-specification.zip (30 files) | Next.js; typed commands/model, section planner, device/mixer editors, preset browser, explicit export stages. | `src/core/releaseQualification.ts` derives G6 PASS from BPM bounds and six automation points; G8 follows prior booleans and hardcodes platform assertions. G7 verifies a manufactured sine WAV rather than the active project's rendered audio. `compositionEngine.ts` sets harmonicScore to 93. `wavExporter.ts` estimates LUFS from RMS, calls sample peak dBTP and renders through a separate PCM implementation. The default phone capture retains desktop panels and clips the editor. These are not acceptance evidence. |

The first two references ran through their Vite entries. The third's Next dev launcher hit its server-lock path in this environment; its unmodified React page/components were captured with a temporary Vite harness and the original CSS. Next API/PostgreSQL, original Next startup and backend persistence were not qualified by that harness. None of these archives contains an Android/Gradle project or a CI/device regression suite. No reference source, factory samples or graphic assets were copied into the repository.

## Findings tied to the captured flow

1. Open the existing main workspace at phone width: the left track drawer opens over the arrangement. Mixer and later destinations require horizontal navigation. Fix: no auxiliary docks open on startup; five persistent phone destinations fit the viewport.
2. Open main at desktop width: edit modes appear in transport, edit toolbar and timeline; layout presets and workspace tabs repeat each other. Fix: one primary mode selector; detailed timeline controls use a disclosure. Disconnected toolbar tools and the fixed insert-count badge are removed from the rendered workspace.
3. Read the transport: duplicate install actions and fixed DSP-rate/limiter/LUFS claims compete with playback. Fix: installation remains in File, transport focuses on playback/time/tempo and measured peak; no idle LUFS reading or hardcoded sample-rate assertion is shown there. Approximate loudness is labelled as an estimate.
4. Navigate to sounds: device insertion was buried inside a rack labelled XML. Fix: a searchable Browser exposes devices by category and support status, target track selection and role-based track creation. Actions call the same existing canonical commands used elsewhere.
5. Open settings with a keyboard: the previous container lacked dialog semantics/focus containment. Fix: labelled modal dialog, initial focus, Tab/Shift+Tab containment, Escape and focus restoration. All are exercised in the native workflow runner.

## Implemented integration

- Desktop keeps workspace navigation above the editor. Phones place Arrange, Session, Mixer, Devices and Browser below it; transport remains mounted while switching views. Safe-area padding and viewport sizing remain in the shell.
- Track tree/device editor/inspector toggles remain accessible through View on phones and Panels on desktop. Compose remains in View on every layout and next to desktop workspaces. Batch actions remain in File/Tools; no dead queue landing page in primary navigation.
- Timeline zoom/Fit/mode stay visible. Loop/markers/automation details and range/clip generation tools remain available through labelled disclosures. The range operations still execute the original canonical commands.
- Browser categories come from the existing library, with capabilities/limitations from the existing registry. No samples, cloud model, native plugin fidelity or preview sound is simulated. Track creation, device insertion, undo, redo and persistence are verified together.
- No DSP scheduling, recovery schema, synthesis graph or export implementation is replaced for this UI milestone. Existing regressions are retained and use real disclosure/menu actions when navigation has changed.

## Qualification evidence

`workspace-flow-check.mjs` is a required Android CI step and produces six grouped cases: navigation/settings/project preservation at four sizes, plus Browser insertion/undo/redo/save/reopen and mapped-tempo editing/undo. It checks all five primary targets are at least 44×44 and inside the viewport. Settings checks include focus wrap, Escape and return to the opener. Geometry checks are not physical touchscreen evidence.

See the JSON reports in [evidence/reference-workspace](evidence/reference-workspace). Whole gates follow the new definitions in [G0-G8-TRACEABILITY.md](G0-G8-TRACEABILITY.md); earlier definitions are archived without relabelling historical tests as new passes.

External qualification constraints: no connected adb device, licensed Ableton Live runtime or independent producer listening panel is available. Missing implementation coverage is separately recorded as FAIL or NOT TESTED; hardware absence does not turn unfinished code into a pass.

## BPM correction discovered during integration

The visible BPM handler changed `project.tempo` and `songPlan.tempo` but left existing `tempoMap` points unchanged. A native full-track fixture reproduced the mismatch: input 143.25 BPM, canonical map still 128 BPM. The before-fix report is retained explicitly as a negative regression, not current acceptance.

`editProjectBaseTempo` now updates/creates the initial map point and song-plan tempo as one existing command transaction. Later tempo points, their curves, meter map and musical score remain unchanged. Unit tests exercise mapped timing through the production converter, scalar projects, 40/240 BPM boundaries, invalid values, non-mutation and undo/redo. The numeric field commits once on blur/Enter, restores invalid input and does not generate a history entry for each partially typed number. Tap/step controls share the supported range. Mobile metronome state is checked against canonical transport settings.

## Executed checks for this milestone

- Native workspace runner: four viewport cases, Browser track/device command lifecycle, mapped BPM/undo and invalid-input rejection; no page errors.
- Native mixed-meter Spot editing: desktop and phone.
- Native arrangement editing: clip/note edit, drag/resize/cancel, protected-layer/range operations, consolidate/split, undo/redo, save/reopen, MIDI/ALS/WAV export and a live sustained-layer edit.
- Native track tools and Session workflows: visible controls, real audio clock/meters, launch/capture/stop/return, undo/redo and native reopen.
- Native clear workflow: cancel, undo/redo, reopen and measured dialog response within the existing 100ms budget.
- Native continuous export UI: cancellation removes the partial destination; retry produces independently verified 48k WAV without score/history changes.
- Native audio scheduling suite: eight cases including map/gain/seek/loop/return seam and exact 12-event Session capture PCM parity.
- Native journal suite: seven current-format conflict cases.
- Full test/compiler/lint/build counts and final source/CI identities are recorded in verification.json and the PR after execution.

The controlled before/after UI comparison imports the same seed-777, 128-bar canonical snapshot in both main and this branch. It counts rendered button rectangles intersecting the viewport (not complete accessibility or hit-occlusion coverage). Desktop visible buttons: 177→107. Phone: 107→80. Both document widths match their viewports; the initially open drawer is removed. Screenshots were visually inspected. This is a clutter/reachability measurement, not evidence of missing DSP implementation being completed.
