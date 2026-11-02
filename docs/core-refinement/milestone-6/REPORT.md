# M6 — Audio-clock transport boundaries

Candidate correction, not DAW-core completion or release approval.

Authoritative dependency: PR9 head `6c1dac00802316fa1df38d78b3d76dabe383c70a`, tree `8b63c031e79e1584605d32680acb9c7a4c20db8d`. Main remains `b9c86691269debdbab3ba6164da0e7082cea123b` and does not include PR9. The restored local checkpoint `109bb7e407500d060b3abc5479740c61e2ccd028` has exactly the PR9 source tree. This correction is stacked on PR9; it must not be applied directly to the broken main without that dependency. Final remote SHA, CI run and artifact identities belong in the PR evidence after publication, so documentation does not invalidate the exact head being tested.

## Confirmed defects and traceability

All nine cases in `src/__tests__/transportBoundaries.test.ts` failed before the source correction. `before-correction.json` retains actual Vitest failures. Reproduce on PR9 by copying that test file to its head and running `npx vitest run src/__tests__/transportBoundaries.test.ts`. Tests inject clock readings and isolate DSP initialization; they are not native audio measurements.

| Requirement / defect | Reproduction and actual behavior | Root cause / correction | Regression |
|---|---|---|---|
| G1 pause/stop independent of UI cadence | At 120 BPM advance audio clock to 2.625s without visual callbacks; pause/stop retains beat0 instead of5.25 | `ParametricWebAudioEngine.stop` disabled playback before reading the clock. Capture `getCurrentBeat()` first. Pause continues through the existing stop path. | pause + stop + delayed-loop pause tests; native transport case suspends visual callback while real clock/scheduler run |
| G1 exact boundary / fractional final slice | Seek16 reaches15.99; start at15.999875 restarts at0 | `seek` subtracted0.01; `start` used a0.05-beat early-end tolerance. Clamp to exact endpoint; restart only at or after actual end. Resolve restart position through existing valid-loop contract. | exact endpoint/final-slice test; native seek/start/end case |
| G1 atomic invalid coordinate rejection | SeekNaN/infinities retires voices, clears keys and accepts/clamps invalid input | `seek` did not validate before side effects. Reject non-finite input before touching resources or transport coordinates. | three parameterized invalid-seek cases verify no retirement, identity/key/anchor changes |
| G1 tempo edit continuity | At old120 BPM beat5.25, change to60 BPM without visual update; position jumps | `setState` overwrote project first and re-anchored from stale `currentBeat`, only when a bus existed; prepaid events retained old timing. Read old clock first, retire voices through existing fade, clear queued keys, advance generation, then re-anchor and install new state. | old-tempo/new-tempo clock test; native voice/key invalidation and clock progression |
| G1 terminal cursor | Late non-loop scheduler tick at beat18 of16 resets cursor to0 | Scheduler explicitly reset and published0. Existing clamped clock now holds/publishes16 on stop; subsequent start still restarts normally. | scheduler endpoint/callback test + native natural-end case |

No issue above was inferred solely from compilation. Targeted before/after results are0/9 and9/9 respectively.

## Ownership and changed functions

- `src/engine/webAudioSynth.ts`: existing `setState`, `start`, `stop`, `seek`, `runLookaheadScheduler`. Existing `AbletonProjectState`, `AudioContext` clock, musical-beat conversion, loop generation and resource retirement remain authoritative. No new engine, renderer or time-state store.
- `src/__tests__/transportBoundaries.test.ts`: nine clock/boundary regression cases.
- `tests/recovery-browser.html`: `runTransportCase` exercises a real native AudioContext with seed777, a controlled single-track pulse fixture,120→90 BPM, visual callback suspended, pause/resume, queued-voice retirement and exact final slice/end.
- `scripts/recovery-browser-check.mjs`: runs and records that native case before all existing rendering/recovery/UI checks. No old checks or PCM tolerances removed.
- This report and machine-readable evidence retain scope and reproduce failures. This is an incremental correction under ADR002/005/006, with no architectural replacement or file migration requiring a new ADR.

## Validation

Actual local unit/integration run:161/161 PASS. TypeScript PASS. Production build PASS (existing bundle-size warning). Python SDK verifier suite12/12 PASS. Native browser results are retained in `local-evidence.json` after completion; final exact-head CI and artifacts are recorded on the PR. Native transport checks do not record loopback audio and do not establish live/export PCM parity or click-free tempo editing.

An initial native assertion incorrectly expected synchronous removal from `activeVoices`. Source inspection confirms existing retirement fades with4ms target smoothing, stops sources at+25ms, and releases resources on asynchronous `onended`. The native test now waits90ms and verifies old leases disappear, while requiring immediate old-key invalidation. This corrects the test's lifecycle expectation; the retirement implementation and offline DSP were not changed. The native test explicitly requires active old voices so retirement coverage is not vacuous.

Reproduction commands (repository root):

```sh
npm ci
npm run lint
npm test
python3 -m unittest discover -s scripts -p 'test_*.py'
npm run build
# Same isolated browser runtime used by existing CI:
npm install --no-save --package-lock=false playwright
npx playwright install --with-deps chromium
RECOVERY_BROWSER_OUTPUT=recovery-browser-evidence node scripts/recovery-browser-check.mjs
```

Local native execution used Chromium153.0.8010.0 via `CHROMIUM_EXECUTABLE_PATH=/tmp/chromium`; isolated @sparticuz/chromium153.0.0 installation outside the application supplied the executable. Its font-directory chown reportedEINVAL, but extraction produced a working native binary; the browser checks, not installation success, determine the result. No package/lockfile change or mock renderer was introduced.

## Limits, rollback and acceptance ledger

Tempo edits terminate old voices using the established fade and do not reconstruct a sustaining note at its elapsed phase. No recording/listening claim covers that transition. Tempo/meter maps, integer tick migration, live/export capture parity, loop-aware metronome qualification, project-extent mutation while playing and complete Session transitions remain outstanding. Existing render budget/long-export limitations remain. Unit tests do not establish performance or peak memory; browser wall time is not Android CPU/RSS evidence.

Rollback: revert this correction on top of PR9; no native project schema migration, new assets, signing/version changes or release operation. Keep the red tests/evidence when investigating a rollback; reverting restores the listed failures. PR9 remains a prerequisite and is not merged by this work.

| Gate | Status | Remaining requirement |
|---|---|---|
| G0 | PASS | PR9 executable baseline evidence retained; this candidate requires its own exact-head CI. Broken main is still FAIL. |
| G1 | FAIL | targeted transport corrections only; integer ticks/PPQ, tempo/meter maps, complete editing/routing/automation/assets/persistence/Session qualification outstanding |
| G2 | NOT TESTED |200 full projects across styles/durations plus expert listening |
| G3 | FAIL | complete variable-duration editable Full Track workflow and musical development/endings |
| G4 | FAIL | repeatability regression protected; captured live/export parity, complete measurements, long export and listening incomplete |
| G5 | FAIL | real Live-version/device/routing/assets/workflow qualification absent |
| G6 | BLOCKED | physical Android access and recorded device workflow/performance/lifecycle evidence |
| G7 | BLOCKED | preceding gates, final release identity/signing/install/upgrade/security/licensing and owner acceptance |

Engineering owns remaining G1/G3/G4/G5 implementation and executable regressions. QA/producer reviewers must supply independent listening; Android QA requires physical hardware; owner acceptance remains a release prerequisite. None of those unavailable external evaluations is marked PASS.
