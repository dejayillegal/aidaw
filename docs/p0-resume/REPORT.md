# P0 repair — release remains blocked

Repair source: `565dad387af959e36f89003d489098c580e3bbbc`; exact source tree is recorded in [provenance.json](evidence/provenance.json).

Latest fetched and independently rechecked GitHub main: `9522b6baaf000fef53f77c4d761ed8d38e6f728f`. It is identical to the requested comparison commit: zero ahead/behind and no file differences. The available older checkout at `91b9b26fe43548c0068cf7b2c25488a705b6d562` and its two unfinished, untracked journey-test files were preserved. Repairs use an isolated worktree based on fetched main; no original recovery records were overwritten. The reported interrupted uncommitted patch was not present in that older checkout; the defects were present in main itself.

[Source diff](source.patch) · [Provenance](evidence/provenance.json) · [Exact commands and exit codes](evidence/commands.json)

## Buildability

Main failed both `npm run lint` (`tsc --noEmit`) and `npm run build` (`vite build`). `App.tsx:2571–2588` contained duplicate declarations inside returned JSX. The component already owned the state at line 251 and calculation in its body. Removed only the duplicate JSX declarations and retained the component-owned state. Corrected malformed synthetic test fixtures and the missing type dependency without weakening domain types.

Final command results are recorded in `evidence/commands.json`; logs include the original failures. `GOMAXPROCS=2` bounds TypeScript's native compiler concurrency; it does not replace the repository's TypeScript command. Dependencies were reused from the preserved checkout; the installed Vite, TypeScript, Vitest and React versions match the lockfile. A fresh lockfile installation was not qualified in this run. The build retains a bundle-size warning.

## Validation results

| Command | Result |
|---|---|
| `GOMAXPROCS=2 npm run lint` | PASS, exit 0 (`tsc --noEmit`) |
| `npm run build` | PASS, exit 0; bundle-size warning retained |
| `npm test -- --maxWorkers=1` | PASS, 299 tests / 32 files |
| Focused P0/recovery/conversion/snapshot command in `commands.json` | PASS, 37 tests / 5 files |
| Isolated reference commands in `commands.json` | PASS, 4/4 structural import/export checks; 4096 MiB V8 heap per fresh process |
| Combined default-heap reference command | FAIL, V8 heap exhaustion / exit -6; retained as a resource limitation |
| `node scripts/verify-p0-audio.mjs` | BLOCKED, exit 1; no Chromium executable and failed browser download; no WAV artifact |
| `npm run build:apk` | BLOCKED at JDK prerequisite after Capacitor sync; no new APK or hash |
| `python3 scripts/test_verify_apk.py` | PASS, 12 verifier unit tests; no hardware qualification |
| `python3 scripts/test_als_references.py` | PASS, 4 analyzer unit tests |
| `node scripts/inventory-ui-controls.mjs ...` | PASS as static inventory; 389 controls remain NOT TESTED at runtime |
| `git apply --check --reverse docs/p0-resume/source.patch` | PASS; source patch matches the committed repair |

See command-specific logs and source attribution in [commands.json](evidence/commands.json). Earlier interrupted/parallel attempts and pre-fix failures are retained separately; they are not substituted for the final serial regression run.

## Repair behavior and evidence boundaries

### Executable plugin resolution

Replacements now carry the registered DSP tag (`Analog → UltraAnalog`, `Wavetable → InstrumentVector`, and native Operator/effect tags). Live instrument dispatch and the shared live/offline insert factory consume that tag and registry, never `substitutedActiveType` or a support boolean. Unknown AU/VST container tags establish no instrument/effect role. Explicit user role selection is required unless imported evidence establishes the role. Incompatible roles, registered instrument counts and device-chain ordering reject before the replacement is committed. Sampler replacement rejects until its sample dependencies can be resolved and validated.

Original device state, parameters, enabled-state evidence and opaque XML are stored independently in `originalPlugin`. Import no longer automatically bypasses enabled plugins. Old automatic bypass flags without evidence or an explicit resolution action also block execution. Dependency resolution is reachable from the workspace, supports explicit bypass and restore-original, and uses command history. Tests cover registered factory dispatch, forged support flags, compatibility, undo/redo and native save/reopen. The mocked insert bridge assertion is a factory-dispatch check, **not audible playback evidence**.

ALS export behavior is explicit: native plugin XML/binary state stays original for Ableton; AIDAW metadata retains the browser replacement. It does not install browser DSP into Ableton or promise identical sound. Native `.aidaw.json` files retain replacement and original state independently. Synthetic XML tests verify the original node survives serialization. Licensed Ableton reopen remains blocked.

A real Web Audio runner exists at `scripts/verify-p0-audio.mjs`, with captured live signal and independent FFmpeg WAV decoding assertions. It currently reports BLOCKED: Chromium is absent, and installation repeatedly downloaded an invalid archive. No WAV or audible-playback qualification is claimed. Human listening is separate even when PCM capture succeeds.

### Reachable identity migration

After envelope version/identity/checksum checks, recovery validates shape and musical fields on a detached preflight projection with temporary IDs. It then attempts only the supported legacy identity migration, followed by the unchanged strict structural and project validators. New envelopes carry `identitySchemaVersion: 1`; damaged current/unsupported schemas and legacy Session identity repairs reject.

Identity scope is track / arrangement-or-Session / clip. Valid IDs are reserved before assigning missing IDs. Existing valid IDs in separate clip scopes remain unchanged. Duplicate IDs within a clip reject as ambiguous. A missing arrangement ID requires a uniquely identified native source clip and note template; explicit source references preserve manual edits. Native `sourceNoteId`/`sourceNoteClipId` references remain distinct from edited event identities. Unsupported or ambiguous source correspondence rejects rather than discarding musical or opaque note fields.

The actual recovery entry-point tests cover migration reachability, manual velocity preservation, source references, repeat recovery, native save/reopen, undo/redo, XML export and transaction abort/rollback. Recovery candidates install only after the atomic archive/primary commit succeeds. Provenance includes SHA-256 of the original serialized envelope and source XML. Hashed archive records retain original `rawEnvelopeJson`; backup and primary update atomically. Transaction-level comparison rejects stale recovery if another writer committed a newer envelope. A lone valid backup can recover without inventing a prior primary.

### Historical conversion integrity

Only exact supported v1 records are upgraded: source device ID/tag, parameter hash, conversion kind, complete generated descriptor, semantics, limitations, units and automation provenance must validate. `status: valid` alone has no authority. Unknown versions, changed hashes/descriptors/identity, unknown units and unresolved automation references remain unchanged and fail strict qualification. Recovery and native-file decoding explicitly enforce integrity diagnoses even when a converted device is bypassed; bypass cannot exempt a tampered historical record from rejection. Migration preserves original parameters; it does not fabricate a valid history. Synthetic tests cover reproducible Reverb v1 records, tampering, repeat migration, interrupted commit and rollback.

### Isolated storage recovery

Blocked recovery diagnoses remain independent of unrelated persistence writes. `flushPersistence(queueId)` and per-record status isolate write failures. Tests exercise unrelated concurrent saves, restart, retry after a write failure, original-envelope export, quarantine, migration rollback and concurrent-edit rejection through the real service entry points. Quarantine stores a copy and diagnosis; the original remains available for retry/export.

These persistence tests use a transaction-aware **in-memory IndexedDB test implementation**. They do not establish physical Android storage or real-browser IndexedDB qualification. The browser dependency blocker remains material.

### Reference-driven GroupTrack integration correction

The first actual repository-reference pass found that three of four files crashed on export: the importer included `GroupTrack`, while serialization still selected only MIDI/audio track nodes. A new synthetic regression reproduced the exact undefined-node dereference before the fix. Serialization now includes domain-represented imported groups and writes their metadata; groups absent from older domain snapshots remain opaque. Structural track counts include groups. The four raw references passed isolated structural checks after the fix; pre-fix results are retained in `evidence/reference-before-group.json`. This closes an import/export integration defect, not general group-routing audio qualification.

## Exact-project recovery provenance

All generated repair fixtures are explicitly SYNTHETIC. Their source is `buildStarterAbletonXml` plus deliberately constructed historical records; none is an exact user recovery envelope.

- `Berghain_Core_133.5BPM_541.als`: exact recovery BLOCKED, original recovery envelope unavailable.
- `Tresor_Vault_138.5BPM_577.als`: exact recovery BLOCKED, original recovery envelope unavailable. This is the exact second filename requested.

Raw ALS files cannot reconstruct missing manual edits, revision history or journal envelopes. Four repository ALS references are checked separately by the read-only [reference runner](reference-validation.mjs); see its [results](evidence/reference-validation.json). They are not the two recovery projects, nor evidence of the previously claimed six-file qualification. All four pass structural import/export in isolated processes with a 4096 MiB V8 heap allowance. The combined default-heap Node/JSDOM run exhausted its approximately 2 GiB heap; that failure is retained in `evidence/reference-default-heap-failure.log`. Browser/Android memory behavior is unqualified, and the larger heap/process isolation does not establish the application’s bounded-memory acceptance.

In 4/4, `seconds = bars × 240 / BPM`. At 133–138 BPM, 64–128 bars span approximately **1:51–3:51 before tails**. They do not guarantee 4–6 minutes.

## Original G0–G8 acceptance

Definitions and numeric thresholds remain those in [the canonical contract](../recovery-contract/ACCEPTANCE.md). No acceptance definitions or historical gate documents were changed. Passing repair subsets does not qualify the full gates.

| Gate | Status | Current evidence and remaining requirement |
|---|---|---|
| G0 | NOT RUN | Corrected TypeScript/build and static inventory recorded; fresh install and complete runtime capability audit not qualified. |
| G1 | FAIL | Identity/recovery/transactions and existing timing/editing tests run; original variable-tempo/meter DSP scheduling and audio-clip Session requirements remain open. Exact-project journals unavailable. |
| G2 | FAIL | Composition/seed regressions run; 200 rendered projects and blind producer listening remain unqualified. |
| G3 | FAIL | Arrangement/editing/full-track state regressions run; complete audible transition qualification remains open. |
| G4 | FAIL | Factory dispatch and WAV/engine regressions run; captured live/offline parity, replacement WAV decode and bounded-memory acceptance remain open. Chromium blocked. |
| G5 | BLOCKED | Synthetic preservation/conversion regressions and available raw references checked; licensed Live 10/11/12 corpus reopen unavailable. |
| G6 | BLOCKED | APK build stopped after web build/Capacitor sync: JDK 21 unavailable. No device, adb, physical installation, SAF export or lifecycle evidence. |
| G7 | BLOCKED | No new APK/hash/signing qualification; upstream gates remain open. Existing distributed APK metadata is not promoted. |
| G8 | FAIL | Static inventory contains 389 controls, all marked NOT TESTED by the inventory. Full producer journey and per-control responsive/touch qualification remain open. |

APK verifier unit tests pass (12), but verify packaging rules only. They do not establish hardware qualification. No APK was built, so there is no new APK hash. Generated Capacitor outputs from the failed attempt were reverted; original tracked Android assets were preserved.

## Remaining blockers

Original recovery envelopes for both named projects; a working Chromium runtime for real IndexedDB/live PCM/offline WAV evidence; licensed Ableton reopen; full rendered-song/listening acceptance; unresolved original G1/G4 requirements; JDK/Android toolchain, physical Android devices and signing provenance. Release remains blocked.

## Publication

The repair is committed locally. Automatic approval review rejected the attempt to push `repair/p0-resume`, citing external source-code disclosure and remote mutation without explicit publication approval. No alternate publication route was attempted. The source diff and evidence remain available locally for review; GitHub main is unchanged.
