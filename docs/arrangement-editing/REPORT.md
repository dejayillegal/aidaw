# Arrangement and layer-editing implementation — 4 November 2026

Implemented a defined core editing workflow. Complete Ableton feature parity, every visible control and release readiness are not certified.

## Identity

Fetched main: `1ff8a718f9dd4d11343503a9311d70ae9b46ee42` (PR12 merged). Implementation commit published through the Git data API: `1a42ffb60626a4d24f21973df6f843dd61437312`. Its tree exactly matches local authored commit `be5f7b5270b25dacaaf7dff8461bdcfb4c05dc46`: `8f670ec37317940699f0b583c4dd83a874c4bcc0`.

PR13 was subsequently merged as `35ed9c86a042966087ddd013f8797de614349bde`; its CI Android build and verification passed. The final chained-edit correction is `b659c770518c6924f8116c391c27277aca76ef80` (local authored commit `1f323c5`, tree `153f77c1679b1d07068ba29b511d33739c1bd138`). It consumes pending consolidation templates after XML projection and clears them in subsequent split/duplicate helpers, preventing stale references from blocking later Arrangement or Session copies. The frozen full rerun passes 261 tests, and the native UI now consolidates, duplicates, splits and undoes all three operations. Earlier CI artifacts must not be confused with this final source.

No deployed preview was changed or identified as this candidate. Executed UI evidence comes from the candidate's local Vite origin in native Chromium 153.0.8010.0. Production bundle and exported file SHA-256 identities are recorded in `evidence.json`; they are not an APK or deployment identity.

## Integrated behavior

- Select a later clip or individual chord tone rather than editing/exporting the first clip/note. The piano roll displays the complete effective pitch range with register scrolling.
- Move/trim clips and move/pitch/resize notes by direct pointer gestures. Each completed drag is one command. Escape cancels without a command. Numeric controls edit clip start/length/split and note time/duration/pitch/velocity/probability/accent/slide.
- Split, duplicate, consolidate and range-delete without the former forced beat/bar rounding or whole-clip range deletion. Exact short/fractional bounds survive; source identities are collision-free even with a frozen clock. Trimming retains hidden notes; a split sustained note has an explicit continuation.
- Protect locked content at the command boundary, including deletion. Mixer/mute changes remain available. Failed edits create no history entry.
- Persist manual clip protection through native snapshots and supported ALS XML. Scoped phrase generation preserves those spans and other layers. The editor exposes an undoable protection checkbox so replacement can be intentional. Full Compose is a broader operation; use track locks for stronger protection.
- Preserve source note metadata during consolidation even with repeated native note IDs. Reject incompatible opaque source clip metadata before changing the project. This is a supported semantic safeguard, not certification of arbitrary native clip envelopes/loop states.
- Invalidate exact live schedule content and retire stale voices only on the edited layer. Preserve unaffected sustaining layers, clock anchors and shared return graphs. Remove hidden live master makeup and retain the current automation trim when installing edits.
- Keep phone dock controls visible with touch-sized targets. Track selection dismisses an overlay drawer; closed drawers can be reopened. Responsive verification now performs actual edits, in addition to measuring bounds.

See [ADR-009](ADR-009.md) for the editing, continuation, protection and live-note policies.

## Executed evidence

- Full Vitest suite: **261/261, 28 files**. TypeScript and production build pass. Python APK-verifier tests: **12/12**. Existing timeouts and PCM thresholds are unchanged. The build's existing large-bundle warning remains.
- New regressions first reproduced exact-timing loss, whole-range deletion, lost sustained continuations, identity collisions, lock bypasses, stale event signatures, hidden live master gain, stale edited voices, overwritten manual edits and incompatible opaque consolidation. The passing tests exercise command history/XML and runtime reconciliation, not only note arrays.
- Visible browser journey: native file open; select/edit a later clip; exact fractional placement; duplicate; range deletion with retained prefix/suffix and continuation; pointer note move/pitch/resize; Escape cancellation; pointer clip move/trim; undo/redo; save/reopen; protected phrase regeneration and undo; consolidate → duplicate → split with three undos; selected-clip MIDI export; gzipped ALS export/semantic reimport; complete WAV export; actual edit clicks at 360×640, 900×720 and 1440×1000; live independent-layer edit.
- Native live fixture: both pad layers sustain; changing layer A retires its voice while layer B remains audible, transport keeps advancing and fixed master gain stays 1. This verifies the correction's audible routing behavior; it is not a producer listening score or full-song capture parity.
- Existing native suite passes: 20 repeated short full-effects renders at unchanged max/RMS difference limits `0.001/0.0001` (observed errors 0), 64-bar continuous WAV with audible final musical quarter, 48-kHz mastering, probability eligibility, real IndexedDB recovery, visible Full Track creation/save/reopen, track tools, Session launch/stop/capture/return and responsive settings.
- The edited sparse two-layer fixture exports a stereo 44.1-kHz/24-bit WAV of 24 seconds: 16 seconds of requested score plus an 8-second tail. FFmpeg independently decodes it and measures loudness/true peak. Its level is a functional fixture result, not a release target or composition-quality score.

Raw browser downloads/screenshots/logs are generated under ignored `.evidence/editing-core/`. The CI workflow runs the editing harness and uploads its evidence alongside the existing browser suite. Failed development runs are retained locally and excluded from the final PASS records. One concurrent run loaded an earlier helper while the Shuffle isolation assertion was being added; the frozen rerun is the 261-test result recorded here. Qodo tools/CLI are unavailable; review consisted of direct source inspection and executed regressions.

## Current original G1–G8 matrix

| Gate | Status | Remaining qualification |
|---|---|---|
| G1 Canonical state, timing, transport and Session | FAIL | Complete variable-tempo/meter consumer and editing matrix; this change qualifies the specified editing subset |
| G2 Musical intelligence and novelty | FAIL | Original 200-project style/seed/duration render/reopen matrix, quantitative musical evaluation and blinded producer listening |
| G3 Complete-track workflow | FAIL | Full requested-duration/style and audible transition/ending matrix, complete original journey |
| G4 Shared audio/export | FAIL | Full-song captured live/offline parity and bounded-memory large exports |
| G5 ALS preservation/interoperability | BLOCKED | Licensed Live 10/11/12 authored fixtures and actual application reopen |
| G6 Android native/physical qualification | BLOCKED | Exact APK, physical install/upgrade and sustained playback/export/lifecycle evidence |
| G7 Release governance | BLOCKED | Upstream gates, signing lineage, physical release qualification and release approval |
| G8 Complete functional UI | FAIL | Every visible control/accessibility/device workflow; selected Arrangement editing is now exercised |

The [authoritative acceptance contract](../recovery-contract/ACCEPTANCE.md) retains its original meanings and thresholds. Existing [composition/audio evidence and open work](../song-plan/REPORT.md) remain applicable. General VST/AU/Max for Live/Pack hosting, arbitrary native routing/device fidelity, broad audio-region editing and complete Ableton parity remain unsupported or unqualified. No listening approval, physical-device result or artist-level output claim is inferred from passing tests.

## Reproduction

```sh
npm ci
npm run lint
npm test -- --maxWorkers=2
python3 -m unittest discover -s scripts -p 'test_*.py'
npm run build
# Install Playwright/Chromium separately, as CI does; no app dependency is added.
RECOVERY_BROWSER_OUTPUT=.evidence/native node scripts/recovery-browser-check.mjs
ARRANGEMENT_EDITING_OUTPUT=.evidence/editing node scripts/arrangement-editing-check.mjs
ffprobe -v error -show_streams -show_format .evidence/editing/edited.wav
ffmpeg -i .evidence/editing/edited.wav -af ebur128=peak=true -f null -
```

`CHROMIUM_EXECUTABLE_PATH` optionally selects an installed native Chromium executable. `evidence.json` binds results to the source tree, production bundle and exported file hashes.

## Android build dependency isolation

The earlier CI browser setup ran `npm install --no-save --package-lock=false playwright` in the app root after `npm ci`; its log reported 661 changed packages before packaging. Browser tooling now installs pinned Playwright 1.62.1 into a separate runner-temporary directory, and both browser harnesses resolve it through their existing runtime fallback. This keeps the APK build on the lockfile dependencies exercised by the unit suite. No application dependency or lockfile is changed by this correction. Earlier APKs remain engineering candidates; the final merged-main artifact must be identified separately.
