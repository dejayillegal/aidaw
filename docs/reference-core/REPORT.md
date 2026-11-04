# Reference-grounded export and integrity implementation

This implements the core/export and reference-analysis slice of the attached directive. **The complete directive is not fulfilled.** The original gate matrix remains FAIL/BLOCKED as recorded in REQUIREMENTS.md. The long examples use the existing SongPlan v2; they are technical export examples, not producer-approved tracks or a new reference-conditioned composition engine.

## Baseline and source identity

- Requirement source: `DAW_Reference_Grounded_Implementation_Prompt.md`, SHA-256 `f3eed233c8559b626bb18ee24fb3b7c5a39ad8d9160e33c7b0d8a005a4454dfb`.
- Fetched main: `984b87cdc6ffaee5bc15c8ca05d05ed59203dfe2`; tree `ae6f12b46307ac5f3007415b6718561ac6dc3d82`. Working tree initially clean. No repository AGENTS.md found.
- Baseline: clean `npm ci`, lint/build, 261 tests, 12 Python verifier tests, detached-main native-browser workflows including 20 repeats and 64-bar export passed. No existing timeout or numeric tolerance was raised.
- The earlier 228-pass/retirement-timeout finding is historical: the existing song-plan report records 7,490 ms spent serializing XML roughly 80 times in that stress fixture, corrected previously using the XML-free domain path while preserving separate XML coverage and the 5,000 ms timeout. It did not recur in this fresh latest-main baseline. This change does not claim that earlier repair as new work.
- Tested core source: `ba79d3773c97898697b21be3112fd7dd41c6334b`, tree `dc74d8f4cb3eb31aaf77e6a046d918a1271ce05a`. The following reference/evidence commit does not alter that app code.
- Tested runtime: Node 24.22.1, Playwright 1.62.1, native headless Chromium 153.0.8010.0. CI uses its isolated pinned browser runtime. Existing bundle-size warnings and jsdom navigation warnings remain visible.
- No accessible deployed preview was identified and matched to this source: deployed preview identity remains **UNVERIFIED**. GitHub commit/tree, resulting CI APK, bundled JavaScript digest and delivery file checksums identify the candidate separately. See the delivery identity artifact; do not infer deployment or physical installation from a build.

## Implemented changes and causes

1. Existing Blob/mastering allocations rejected five/ten-minute 48 kHz/24-bit output at the 256 MiB preflight. The new direct-file path retains one continuous native graph/output buffer, then copies bounded channel windows through the shared PCM encoder and awaits each destination write. Whole encoded WAV/whole-file base64 copies are absent from that path. The 256 MiB working-buffer cap remains; unsupported configurations fail explicitly. Legacy mastered Blob export retains its stricter budget.
2. Android's normal WAV action now uses the existing SAF begin/append/finish/read-back bridge directly. Browsers with File System Access have an explicit **Save WAV to File (48 kHz /24-bit)** action. Normal browser downloads remain available. Native success requires the existing size/SHA read-back; browser file success says size checked.
3. Cancellation discards partial destinations, drains a native context before retry, and retains busy protection if it stalls. Final verification is visibly non-cancellable. Writers reject callbacks after completion/failure so they cannot append to a subsequent save.
4. The file menu was behind the phone's track drawer. Correct stacking, scrollable menu bounds and 48px phone controls restore reachability. Export footer height accommodates the Cancel button at 360×640.
5. A fixed eight-second tail could truncate high-feedback effects. Shared export planning now retains at least eight seconds and extends for supported serial reverb/delay and active return settings. The modeled relative −80 dB policy is conservative, not an acoustic guarantee for arbitrary devices or future automation.
6. The existing mastering header inspector rounded duration to four decimals, which can exceed one sample at 48 kHz. The native regression caught this after the longer tail changed frame counts. Duration telemetry now uses the exact encoded frames/rate; the existing one-sample acceptance tolerance remains unchanged. A focused failing regression demonstrates the rounding defect.
7. New read-only ALS tooling preserves original bytes and separates Arrangement clips from Session and takes. Profiles retain exact fractional bounds, loops/offsets, notes/probability/disabled flags, envelope target candidates/preroll, device containers/opaque hashes, routing metadata, media ownership and missing dependencies. Native meter enums, arbitrary units/routing, tempo-curve integration, actual audible activity, native DSP and Live reopen remain explicitly unverified. Detailed private profiles contain authored notes/paths and are not committed publicly. Only aggregate identities/counts are in reference-corpus.json.

No project schema migration, IndexedDB clear, descriptor rebuild, alternate synthesis engine, sample substitution or licensing assumption was added. Existing commands/history, editable notes, user locks, recovery envelopes and shared live/offline processors remain in place.

## Measured evidence

The short Blob/stream/cancel-retry fixtures have identical PCM and SHA-256. A real baseline build rendered the high-feedback comparison: baseline 14.6667 seconds versus candidate 49.6986 seconds, with **identical common PCM**. The candidate has peak 0.06066215 after the old eight-second tail cutoff. This demonstrates retained rendered signal; it is not a blind listening score.

| Native continuous export | Music + declared tail | Frames | WAV bytes | SHA-256 |
|---|---|---:|---:|---|
| 180 bars, 144 BPM, 48k/24 | 300 + 20.660651 s | 15,391,712 | 92,350,316 | `3f3e69b4377a33a87ddeb60e3dfa467e06ba9301ce354016cefbacdc52024fa9` |
| 360 bars, 144 BPM, 48k/24 | 600 + 20.660651 s | 29,791,712 | 178,750,316 | `84c4a948702ada78d34bb443a22e03a0b71c6241aa060a7e1230004807f2b3a3` |

Both use seed 777, eight existing generated tracks and the actual shared graph. Maximum encoded/bridge input block is 196,608 bytes. Old Blob preflight rejects both without silently changing settings. Independent Python/NumPy WAV decode verified identities, stereo PCM24/48k, exact frames, finite/nonzero audio and audible final musical quarters. FFmpeg EBU R128 reports −16.4 LUFS integrated for both, true peaks −6.9/−6.8 dBFS and LRA 0.4 LU. These measurements do **not** establish musical evolution or producer acceptance. LRA alone does not judge a techno arrangement; the composition/listening requirements remain open.

The modeled working-buffer totals are 150,461,185 and 265,661,185 bytes. Sampled summed browser-process RSS peaks were approximately 589 MB and 718 MB. Summed RSS may count shared pages repeatedly; it also includes browser/app/GC costs excluded from the working-buffer budget. It is not an Android peak measurement. Do not describe this as a total-memory-under-256-MiB or constant-memory implementation.

The phone test opens the actual App, exports real file bytes through a simulated destination picker, cancels/removes a partial file, compares the entire score, retries in the same page, verifies the disabled final-commit cancel control and checks the completed size. This qualifies web interaction and file bytes; it does not qualify real SAF, physical touch, foldable lifecycle or installed APK behavior.

Final checks: 276/276 tests, 16/16 Python tests, lint/build, 20-repeat native regression, arrangement editing, phone export and five/ten-minute frozen-source exports passed. Verification results and raw reports are copied into evidence.json and the private delivery archive. Existing tolerances stay at native repeat maximum <0.001 and RMS <0.0001. Captured live-vs-offline parity is a separate open requirement. No producer listening ratings or 200-project completion figures are invented.

## Reproduction

```sh
npm ci
npm run lint
npm test
python3 -m unittest discover -s scripts -p 'test_*.py'
npm run build

# Isolated browser runtime, matching CI; keep it outside root app dependencies.
npm install --prefix /tmp/aidaw-browser --no-save --package-lock=false playwright@1.62.1
node /tmp/aidaw-browser/node_modules/playwright/cli.js install --with-deps chromium
export CODEX_PRIMARY_RUNTIME_NODE_MODULES=/tmp/aidaw-browser/node_modules
node scripts/recovery-browser-check.mjs
node scripts/arrangement-editing-check.mjs
LONG_EXPORT=1 node scripts/reference-export-check.mjs
node scripts/reference-export-ui-check.mjs
# Optional comparison against a detached baseline checkout with dependencies installed:
REFERENCE_BASELINE_DIR=/path/to/984b87c-checkout node scripts/reference-tail-baseline-check.mjs

# Original .als files are private inputs, not redistributed source fixtures.
python3 scripts/analyze-als-references.py /path/to/six-references --output /tmp/reference-profiles
# Optional independent PCM measurement requires NumPy.
python3 scripts/measure-export-wavs.py .evidence/reference-core/stream-browser/report.json --output /tmp/decode.json
ffmpeg -i .evidence/reference-core/stream-browser/ten-min-48k.wav -af ebur128=peak=true -f null -

# Android: repository's established Gradle/signing and verification route.
npm run build:apk
```

If a runtime supplies a native Chromium executable, set CHROMIUM_EXECUTABLE_PATH and its required library path. No offline-JS approximation qualifies these tests. APK build still requires the repository-pinned Java/Android toolchain; production signing and physical qualification are separate prerequisites.

## Remaining requirements

See REQUIREMENTS.md for every attachment section, owner, expected result, evidence and dependency. This milestone does not implement new macro-form families, the complete stock sampler/content/rack suite, comprehensive audio asset editing/relink/warp, every automation/control workflow, 200 saved/reopened/rendered projects, producer blind listening, licensed Live reopen or physical Android install/upgrade/30-minute playback/fold/focus tests. A successful debug build cannot close those gates.
