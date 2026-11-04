# Complete composition engineering candidate — 4 November 2026

This implements a substantial composition and signal-path correction. **The full user contract is not complete, and no G1–G8 gate is certified.** Audible files are review candidates, not producer-approved releases.

## Provenance and baseline

Reviewed/fetched main: `1b889a524427a6eadc80d683d4507c68311f614e`. Local implementation commits: `07c27ee` (signal path/plan/recovery), `74bb8f2` (distinct persisted style grooves), `fe7b328` (explicit harmonic ownership), `aa696cb` (native qualification fixture), `8164a4e` (cache invalidation and frozen native qualification). The connected GitHub publication uses equivalent verified trees; its commit identities differ from the local authoring commits and are recorded in `evidence.json`.

The embedded Cloud Run URL in `server.ts` returned HTTP 404. No deployed preview identity or deployed-source equivalence is established. The candidate is a local Vite build and the reviewed branch. No candidate APK was built locally or physically qualified. Exact-runtime GitHub CI is running at https://github.com/dejayillegal/aidaw/actions/runs/41873242608; a successful package build still does not establish installation/playback/export qualification. The existing APK metadata remains historical/unqualified.

Baseline reproduction: 228 tests passed; the retirement lifecycle test failed its unchanged 5,000 ms timeout at 7,490 ms. That resource test unnecessarily serialized the entire XML score through roughly 80 insert/remove operations. The stress loop now uses the existing XML-free domain path while retaining its exact retirement/disposal bounds; independent XML insert/remove tests remain. Focused execution completed in 730 ms. No timeout or acceptance tolerance was increased.

Baseline native Chromium also failed the 4,096-note recovery assertion: canonical notes survived while stale XML remained. Recovery passed the candidate as its own previous state, suppressing reconciliation. Recovery now compares against the serialized projection. Original checksums are verified first; future/corrupt policy and atomic backups remain.

`npm ci` initially rejected the lockfile because optional platform dependencies were missing. The repaired lockfile completes a clean install (676 packages). Package declarations and Android signing policy are unchanged.

## Integrated behavior

- Full Track composes all requested bars from a persisted SongPlan; it no longer treats slicing starter notes as composition. Compose, added layers and selected ranges use the plan through canonical commands/history. Extent edits explicitly retain the existing composed duration.
- Plans contain style, seed/version, tempo/meter, sections/phrases, modal or evolving harmony, voice-led registers/voicings, motifs, independent activity/density/focus, mix hierarchy and typed transitions. Version 2 persists distinct groove profiles for the eight composition strategies; version 1 remains readable with its earlier replay semantics.
- Fills, bass/kick withdrawal, chord anticipation and filter-energy gestures produce actual editable events. Role phrases enter/exit independently; peak activity is selective and the outro provides a drum mix-out. The complete requested transition vocabulary and general send automation remain unfinished.
- Utility and compressor makeup execute once in their actual insert nodes. Channel/VCA gain no longer re-applies insert estimates, native voices no longer add estimated insert saturation, and the limiter ceiling is not applied as another output trim. Analysis-only approximate PCM remains separate from production WAV processing.
- Declared units normalize before clamping/descriptors/DSP. `3600 ms` becomes `3.6 s`. Conversion version 2 accepts a v1 migration only when the entire old record exactly reproduces from its raw parameters/hash. Future, corrupt, altered and ambiguous records remain preserved/blocked.
- `scripts/repair-device-conversion.ts` inspects raw/expected/actual records and requires exact track/device/source hash to write a separate repaired snapshot. Its executed test preserved original file bytes and editable MIDI. This is a targeted file action, not a new recovery-banner repair UI.
- Stab oscillators render supplied pitches without an implicit minor third. Generated voiced chords/pads explicitly own their harmony, so the starter's existing Chord MIDI device cannot expand them again. Range controls allow MIDI or an enabled Chord device to own harmony, through history and XML persistence. Imported unmarked MIDI retains explicit device behavior.
- Acid uses explicit articulation and preceding sounding-pitch state, monophonic retirement, coordinated register/density/focus and resonance compensation. Actual routed kick events and effective mute/solo state drive ducking. These are shared native graph changes; authentic hardware-303 equivalence is not claimed.

The original saved Reverb `202` record was not supplied. The `202` regression is synthetic. Its actual raw parameters, converter provenance and mismatch cannot be claimed investigated from that fixture. No storage was cleared and no ambiguous record was automatically repaired.

## Executed validation

- Full suite: **243/243 passing, 27 files**, unchanged existing timeout values. TypeScript and production build pass; the existing bundle-size warning remains. APK verifier Python tests: **12/12**.
- Native production-channel calibration: Utility **+5.9999998 dB**, compressor makeup **+5.9999998 dB**; bypass/reference and opposing gains agree. Nonlinear insert order produces different measured output as declared. Captured live-channel gain agrees with offline calibration within the stated fixture tolerance.
- Native rendered pitch-content fixtures cover a single note, triad, seventh, extension and intentional parallel planing with an active Chord processor and instrument. Explicit MIDI ownership prevents additional chord expansion. This supplements MIDI-array tests.
- Native browser regression includes 20-repeat PCM comparison at unchanged max/RMS limits `0.001/0.0001`, 64-bar continuous export, 48-kHz mastering, probability eligibility, real IndexedDB recovery/abort/fallback/future refusal, visible Full Track creation/save/reopen, edit/history, Session launch/capture/return and four viewport sizes. See final executed results in `evidence.json`; interrupted development runs are excluded.
- The audio runner creates, saves/reopens, projects supported ALS XML, compresses/reimports and independently decodes full WAVs. FFmpeg independently measures EBU R128 loudness/true peak and creates lossless FLAC and blind, level-matched listening copies.

The audio bundle contains four complete 64-bar arrangements (previous section-slicing workflow, new hypnotic plan, dub plan and Detroit plan) and two isolated acid/bass renders. Both previous/new arrangements use the corrected DSP to isolate composition/mix decisions from the removed double processing. Isolation mutes other sources, so kick-triggered ducking and master compression differ; these are not additive stems captured from the full mix. Full-mix captured live/offline PCM parity remains open.

No producer listening ratings were fabricated. `producer-rubric.csv` is deliberately blank; blind A/B copies and the mapping are included. Rate groove, harmony, layering, transitions, balance and ending (1–5), release suitability and timestamped defects. Retain all failed seeds. There is no 200-project rendered/listened corpus here; four examples and fixtures do not satisfy it.

## Current gates — original meanings and thresholds retained

| Gate | Status | Remaining acceptance evidence |
|---|---|---|
| G1 Canonical state, timing, transport and Session | FAIL | Full timing-consumer/variable-tempo/meter and all editing workflows; original PPQ/timing thresholds retained |
| G2 Musical intelligence and novelty | FAIL | 200 complete rendered/reopened projects across the original matrix, quantitative musical evaluation and blind producer review |
| G3 Complete-track workflow | FAIL | Broader requested-duration/style matrix, full audible transition/end qualification and complete visible journey |
| G4 Shared audio/export | FAIL | Full-song captured live/offline parity and bounded-memory export above the existing limit |
| G5 ALS preservation/interoperability | BLOCKED | Licensed Live 10/11/12 authored corpus and actual reopen; synthetic import/export is insufficient |
| G6 Android native/physical qualification | BLOCKED | No adb/physical target, compatible local SDK/JDK build or sustained on-device playback/export evidence |
| G7 Release governance | BLOCKED | Upstream gates, signing lineage, exact APK installation/upgrade and release approval |
| G8 Complete functional UI | FAIL | Every visible control and the complete end-to-end journey, including new harmonic-owner controls |

See [the unchanged authoritative acceptance contract](../recovery-contract/ACCEPTANCE.md) for all original thresholds and historical G8 mappings. General VST/AU/Max/Pack execution, arbitrary device/routing fidelity, complete transition vocabulary and commercial release readiness remain unsupported/unqualified as previously recorded.

## Reproduction

```sh
npm ci
npm run lint
npm test -- --maxWorkers=2
python3 -m unittest discover -s scripts -p 'test_*.py'
npm run build
# Use Playwright plus a working native Chromium executable, as CI does.
RECOVERY_BROWSER_OUTPUT=.evidence/native node scripts/recovery-browser-check.mjs
SONG_QUALITY_OUTPUT=.evidence/audio node scripts/song-quality-check.mjs
python3 scripts/analyze-song-audio.py .evidence/audio
# Inspect; then explicitly repair one selected descriptor into a NEW output file:
node --import tsx scripts/repair-device-conversion.ts INPUT.aidaw.json
node --import tsx scripts/repair-device-conversion.ts INPUT.aidaw.json TRACK DEVICE SOURCE_HASH NEW.aidaw.json
```

`CHROMIUM_EXECUTABLE_PATH` selects a local native executable; the local isolated runtime was Chromium 153.0.8010.0. `SONG_QUALITY_CASES` accepts explicit case JSON for supplied matrix entries. It is not a substitute for the missing original corpus/listening execution. Qodo CLI/managed review tools were unavailable; no Qodo review or notes are claimed. The available evidence is direct source review and executed regressions.
