# Executable evidence — CI/New Project correction

Baseline main: `e6de7f320b6f6005a58be519dcfc1ee4bf74ab17`. Source truth includes the downloaded failure for run41971030807/commit1844666. Final commit, source tree, CI URLs, artifact hashes and APK checksum are attached to the repair PR after publication, avoiding a new source commit solely to insert its own evidence.

| Check | Actual local result |
|---|---|
| Original clean npm ci | FAIL EUSAGE: optional platform entries absent |
| Repaired clean npm ci --no-audit --no-fund | PASS;94 platform entries restored,0 existing version changes |
| Baseline regression |302/302 PASS; shows that isolated tests missed the UI integration failure |
| Corrected full regression |313/313 PASS |
| New creation integration suite |11 PASS; complete musical events/metadata round trip,6/7/8 native/XML track counts, invalid inputs, seed replay, isolated queue/history |
| TypeScript / production build | PASS; existing large bundle warning retained |
| Python APK verifier suite |16/16 PASS |
| Original native visible creation check | FAIL undefined creationMode on stale/unsubmitted flow |
| Corrected visible creation check | See retained local/CI report: real dialog submission, fresh queue identity, outgoing preservation, save/reopen; extended check adds live master signal, responsive cancellation and downloaded WAV/FFmpeg decode |
| Existing native renderer |20 repeats,64-bar render,48kHz mastering and probability checks remain unchanged; final exact-commit CI required |
| Dependency audit / SBOM |2 low,5 moderate;0 high/critical;661 installed components locally |
| Physical Android / exact user recovery / Live / producer listening | BLOCKED pending external fixtures/runtime/hardware/operators |

Commands:

```sh
npm ci
npm run lint
npm test -- --maxWorkers=2
python3 -m unittest discover -s scripts -p 'test_*.py'
npm run build
npm audit --audit-level=high --json
npm sbom --sbom-format cyclonedx
# Browser runtime isolated outside app dependencies, as in CI:
npm install --prefix /tmp/aidaw-browser-runtime --no-save --package-lock=false playwright@1.62.1
node /tmp/aidaw-browser-runtime/node_modules/playwright/cli.js install --with-deps chromium
CODEX_PRIMARY_RUNTIME_NODE_MODULES=/tmp/aidaw-browser-runtime/node_modules node scripts/run-full-track-check.mjs
CODEX_PRIMARY_RUNTIME_NODE_MODULES=/tmp/aidaw-browser-runtime/node_modules RECOVERY_BROWSER_OUTPUT=recovery-browser-evidence node scripts/recovery-browser-check.mjs
```

Install FFmpeg/ffprobe for independent visible WAV decode. Local browser used native Chromium153.0.8010.0 from an isolated package; CI records its own browser version. A font-directory extraction chown limitation was handled by extracting the supplied native executable, not by substituting a renderer. Browser waveform values/hashes are qualified only for their recorded runtime.

Required additional CI steps remain registered-plugin audio, arrangement editing, continuous file rendering and its visible UI workflow. Each runs independently after browser-runtime setup, fails normally, and preserves artifacts. Failure screenshots/body diagnostics are captured by the focused runner. Do not infer complete journeys A–F, physical sound quality or release readiness from the subset in this report.
