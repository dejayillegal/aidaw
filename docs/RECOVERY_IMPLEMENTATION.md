# DAW recovery implementation and evidence

Baseline: `dejayillegal/aidaw` main `70fdc7cc4545f4e6a2aaa462a00feaebb0ade522`, inspected 2026-11-01. This implements the attached Architecture Recovery contract as a recovery change, not a commercial release certification.

## Decisions

Extend the existing composition and Web Audio modules. Do not introduce another renderer or composition engine. Offline export schedules the same voices and inserts as playback into one continuous context, suspending at two-second audio-clock boundaries to replenish notes. The output remains one PCM buffer: this is bounded scheduling, **not** streaming PCM or stitched independent segments. Reverb, delay and compressor state persist. A conservative working-set preflight rejects oversized jobs; a native/streaming renderer remains future work for exports exceeding this budget.

Long tracks previously silently switched to a different synchronous synthesizer. That fallback is removed from production export/mastering. The existing deterministic synthesizer remains for waveform previews and explicit unit fixtures. jsdom tests exercise service behavior with a named fixture; actual rendering is verified in Chromium. Missing renderer capability is an explicit export failure and an explicit unavailable measurement status.

Progress now measures completed audio windows and encoded frames. The native saving phase is separate. Android SAF writes bounded chunks, closes the stream, reopens the selected document, and verifies size and SHA-256. Browser download initiation does not claim file-system verification. A timed-out context cannot resume scheduling or allow a second PCM allocation; because OfflineAudioContext has no cancellation/close API, a permanently stalled context requires an app restart.

## Traceability

| Contract | Existing path and implemented correction | Verification |
|---|---|---|
| Export | `webAudioSynth.ts`: shared continuous graph, finite/non-silent WAV validation, yielding chunk encoder, resource rejection, stall guard | encoder unit tests; real 4/64-bar Chromium render and independent WAV decode; stalled-render retry test |
| Android save | `fileExportService.ts` → registered `FileExportPlugin.java` → SAF create/write/close/reopen/hash | bridge chunk/error/cancellation/concurrency tests; physical Android pending |
| Playback | voice retirement/seek fade, deterministic offline cleanup boundaries, full-length automation range; master automation moved out of visual loop | existing engine tests; listening, crackle/underrun measurements on device pending |
| Musical form | `compositionIntelligenceEngine.ts`: exact duration partition, seeded opening/order/duration, no forced intro/fallback notes, one shared form across bulk layers/automation, unlocked kick withdrawal | 100 seeds: 100 distinct plans, 51 distinct openings; reproducibility, inactive-intro and stale-plan regressions |
| ALS | parser preserves exact clip-derived duration instead of rounding into 16/32/64/128; long imports remain representable independently of export budget | 24/192/512/1024-bar sparse import fixtures; existing preservation tests |
| Responsive workspace | safe-area shell, dynamic-height settings, scrollable transport/tabs, overlay side docks below available-width thresholds, bounded lower editor | Chromium settings at 360×640, 900×720, 800×360, screenshots |
| Release | Gradle-only build, delete previous build output, no nested stale APK, verify staging artifact before distribution, fail closed on official SDK verification, certificate pin for publication, candidate ledger, no dynamic server certification | publication failure tests; verifier rejection; fresh Gradle artifact/install pending |
| Build | repaired lockfile/platform entries, aligned esbuild peer requirement, CI Java21, real browser gate | clean `npm ci`, TypeScript and production build |

## Evidence and commands

- Node 24.22.1, npm11.9.0, Chromium153.0.8010.0 (isolated headless browser).
- `npm ci --no-audit --no-fund`: passed after lockfile repair. Original clean installation failed due missing platform entries; the original esbuild range also conflicted with Vite's peer range.
- `npm run lint`: passed.
- `npm test`: regression suite includes native bridge and publication failure coverage. Full actual audio rendering is deliberately outside jsdom.
- `npm run build`: passed; existing large-bundle warning remains (~893kB minified JS).
- `CHROMIUM_EXECUTABLE_PATH=... node scripts/recovery-browser-check.mjs`: PASS. Runner emits JSON evidence and screenshots; CI retains these as artifacts.
- 64 bars, seed777, tempo137: 120.1168s including tail; stereo44.1kHz/24-bit; 31,782,950 bytes; independent decoding, finite samples, non-silence and final musical quarter audibility passed; 144 progress events.
- 4-bar mastering: stereo48kHz/24-bit; 4,322,150 bytes, 15.0073s including tail; independently decoded.
- Native Web Audio output has small numerical differences between identical renders: observed repeat max error ~0.00011, RMS ~0.000015. Project generation is deterministic; PCM is checked with explicit max0.001/RMS0.0001 tolerance, not falsely claimed bit-identical across native DSP execution.
- Browser report: no page errors, console errors or warnings. Settings controls reachable in all three viewport checks.
- Simulated stalled native context: timeout observed, retry blocked, exactly one allocation.
- Independent review found timeout overlap, stale section-plan reuse, long-import rejection and CI qualification ambiguity; these were corrected. Qodo CLI/tool unavailable, so no Qodo review is claimed.

## Release restrictions and remaining work

**G1–G6 are not certified.** No physical Android device or Android SDK is available in the execution workspace (only Java17). SAF Java compilation, write/reopen on device, external-player playback, install/upgrade, certificate lineage, foldable behavior with keyboard/insets, real playback crackle metrics and launcher verification must run on the exact built APK. CI uses Java21 and uploads any debug output explicitly as **unqualified**, including its verification JSON; unpinned CI keys must never become a stable distributed release.

`android/release-policy.json` records the existing candidate identity, not an invented production approval. Production remains blocked until approved version history and signing inputs are established. `public/apk-metadata.json` is marked unqualified; server and downloader refuse to advertise it as a verified update. Distribution requires `ANDROID_DEBUG_CERT_SHA256` plus the corresponding persistent keystore configured through Gradle. No new production key is generated.

The composition changes repair form/orchestration defects. A complete progression/voice-leading system, authored transition assets, expert listening evaluation, broad seed coherence evaluation, and broad Ableton10/11/12 unknown-subtree round-trip certification remain work under the contract. This PR must not be described as full Ableton parity or a commercially qualified DAW.

## CI follow-up

The first PR run failed before dependency installation because setup-android's default requested the retired `tools` package. The workflow now selects platform-tools, Android36 and build-tools36 explicitly, uses Ubuntu24.04, and removes a checked-in machine-specific `local.properties` before Gradle. This addresses the observed setup failure; subsequent CI status must still be checked.

## Repeat-render feedback correction

A subsequent CI repeatability check found a larger intermittent waveform difference (local stress reproduction: max~0.138, RMS~0.0116). Isolated project comparisons confirmed identical audible inputs. Independent native controls reproduced variability with a biquad filter inside a DelayNode feedback cycle; removing that filter from the cycle restored deterministic control output. The global ping-pong and per-track echo now filter incoming audio before recirculation. One full-period feedback delay supplies alternating half-period left/right taps, including recirculated left taps. Live tempo updates use the corresponding full/half-period delay times. The filter therefore colors input once rather than every repeat; playback and export share this deliberate effect change.

The browser regression now repeats the full-effects short export eight times before the64-bar and mastering checks; its tolerances were not relaxed. Saturator/limiter curves also use odd, exactly centered lookup tables so zero input maps to zero output. Corrective repeat and full-track validation must pass before the draft is considered build-qualified.

Final local corrective validation: all eight full-effects short repeats,64-bar render/decode,48kHz mastering,three responsive settings sizes and stalled-render guard passed together. Procedural impulse/noise resources now use integer seeded state rather than floating sine/fraction hashes. The ping-pong left tap uses a separate gain; sharing the gain inside the feedback loop with the tap was rejected by independent32-render controls. APK CI must still pass on this final source revision.
