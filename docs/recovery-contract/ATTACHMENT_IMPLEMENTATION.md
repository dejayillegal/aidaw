# Attached review — implementation and evidence

Date: 2 November 2026 (IST). This is executable corrective work against `aidaw_G1_G7_Review_and_Completion_Prompt.md`, not a declaration that the full contract has passed.

## Source and scope

The attached review's main baseline remains `7072a44351b018a67bec7e9dcc571145afe0b0e3` after fetch; no open PRs were returned. Work continues from the preserved local corrective commit `7943450f34eaa18076bfcdaef624c92e1c9422ab`, including the reviewed PR10 transport correction. New implementation commit: `00b012a8b857d245bd35e9495f41f343cd1876fa`. Evidence-only commits do not alter implementation.

The attachment explicitly conditions composition expansion on Android playback/export reliability. Physical-device qualification is unavailable, so this change advances independent G1/G4 corrections and Session integration while preserving that prerequisite. It does not introduce another composition engine or claim Full Track completion. Publication remains unperformed; no new GitHub CI or Android artifact is claimed.

## Verified review defects

| Attached requirement | Correction | Evidence | Remaining scope |
|---|---|---|---|
| Rational/fine Grid/Shuffle coordinates | Removed decimal rounding and minimum grid from the edit resolver; validated input/grid/extent; preserved resize, grid base and ripple displacement | `reviewedDefects.test.ts`:1/3 and1/128 grids, resize/XML/reload/undo, invalid grids; existing timeline tests retained | Existing double-beat representation remains. This is not canonical ticks/PPQ or tempo/meter-map migration |
| Destructive Session launch | Independent MIDI slots and quantized launch/stop log in the canonical project; shared scheduler and DSP; Arrangement remains unchanged | `sessionPerformance.test.ts` and actual Session workspace controls in Chromium | Audio clips, native loops/warp, follow actions, tempo/meter maps, native expressions and complete resume/seek behavior unqualified |
| Explicit Arrangement recording/transfer | Append realized Session MIDI events into new editable clips at an explicit range/destination, one transaction and undo | Browser captures4cycles per track while retaining original clips; native save/reopen preserves result | Append MIDI performance capture is the supported operation; continuous audio recording and replacement recording are not implemented |
| Silently ignored inserts after10 | Shared explicit10-slot execution limit before playback/offline allocation; renderer processes the declared chain without slicing; queue analysis reports unavailable; preview paths reject through visible callback | Allocation guards, capability and pad/mixer-preview regressions; actual imported11-device project shows `Playback blocked: INSERT_LIMIT` | Broader device parameter/chain execution remains incomplete; imported chains can be retained for preservation |
|16bar New Project default / Full Track | Unchanged pending prerequisite | No Full Track PASS claimed | Complete generator/workflow/200project evaluation remains implementation work after the prescribed reliability gate |

## Session state and UI flow

`storeArrangementClipInSession`, `queueSessionLaunch` and `captureSessionPerformance` are commands over existing `AbletonProjectState`, through the existing transaction bus. `sessionEventsInWindow` only projects a requested window. Existing `audioSettings.transport.arrangementMode` owns precedence; the AudioContext clock remains authoritative. See [ADR-007](ADR-007-session-performance.md) for alternatives, bounds, migration, rollback and limitations.

The active Session workspace now exposes reachable slot-copy, Scene/clip launch, launch quantization, per-track/global stop, capture range/destination, clear and return controls. All composer placements invoke the same launch command. Scene launch starts transport, with pending changes quantized; empty scene slots stop their track. Locked tracks protect content/launch changes while stop remains available. Arrangement looping is visibly inactive under Session ownership. Return stops playback and resets the cursor; its mode change is undoable.

Session export requires explicit capture and return to Arrangement. This prevents exporting an unintended score. Session-native files use v3, and recovery envelopes use v2. Existing v1/v2 files and legacy/v1 journals remain readable. Older readers reject new versions; versions/checksums are not bypassed. The native browser test verifies a new reader restoring actual IndexedDB Session state. ALS projection warns that app Session metadata is not native Ableton Session slot execution.

## Before/after evidence and corrections during verification

- Initial ten reviewed precision/insert regressions failed, then passed. Additional capability, preview, extent and corruption cases extend the final coverage.
- Initial five Session command tests failed because the capabilities were absent; the implemented commands pass.
- Native cancellation regression caught a sustaining rumble at−28.2dBFS after Clear Performance. Track-scoped retirement/invalidation fixed it; final native checks require cleared tracks to be silent at the tested threshold.
- Native v3 round-trip tests exposed an intermediate XML projection whose Session references preceded its slot metadata. Comparing the prior complete projection corrected that serializer ordering defect.
- An intermediate browser run was invalidated by source hot reload during implementation. Its failure is retained; it is not the final evidence.
- One concurrent final attempt had a wrong new extent-test fixture (looping was unintentionally enabled) and an existing queue-isolation5000ms timeout while native rendering competed for CPU. The fixture now explicitly tests non-loop behavior. The full unchanged-timeout suite passed without competing render work. No assertions, timeouts or PCM tolerances were weakened.

## Final local qualification

| Check | Result / scope |
|---|---|
| Vitest |192/192 PASS across22files |
| TypeScript | PASS after final test fixture correction |
| Production web build | PASS; existing large-chunk warning retained |
| Python APK verifier tests |12/12 PASS; parser tests do not certify an APK |
| Native Chromium153.0.8010.0 | Full browser harness PASS; no uncaught page or console errors |
| Repeatability |20 short stereo full-effects renders, max/RMS PCM error0; original max<0.001 and RMS<0.0001 unchanged |
| Long existing fixture |64bars,5,297,151frames,31,782,950bytes,44.1kHz24bit,120.116802721s including tails; sample peak0.88032186; SHA256`7be7aadb401e615e30a8c61ff466eed2c23d4e72d706d7d67a55ddd3fea7886b` |
| Mastering / probability |48kHz24bit short master and44.1/48kHz probability oracle PASS |
| Session UI/native audio | Two tracks audible; continues beyond one-bar Arrangement; quantized stop leaves stopped peak−60dBFS and other track peak−18.6dBFS in final sample;4cycles captured per track; clear sustaining voices, mode undo/redo, v3 save/reopen and real recovery PASS |
| Responsive subset | Session ownership control, previous clip-tool workflow and settings checked across phone/unfolded/landscape/desktop sizes; screenshots retained |
| Static UI inventory |341 native controls,25 callback boundaries; static items remain NOT TESTED until individually qualified |
| Android / Live / listening | No new candidate build or physical-device result; no licensed Live-authored corpus/reopen or producer listening assessment |

Machine results/logs are in `attachment-evidence/`. Runtime screenshots, generated native files and UI inventory are in `.recovery-evidence/attachment-qualified/`; the existing CI artifact step produces/retains them when this source is published and CI runs. Local Node24.22.1/npm11.9.0 was used; the existing CI configuration retains Node22/Java21.

Reproduce the complete browser suite with the existing Playwright CI setup:

```sh
npm ci
npm run lint
npm test -- --maxWorkers=2 --reporter=dot
python3 -m unittest discover -s scripts -p 'test_*.py'
npm run build
node scripts/inventory-ui-controls.mjs recovery-browser-evidence/ui-controls.json
RECOVERY_BROWSER_OUTPUT=recovery-browser-evidence node scripts/recovery-browser-check.mjs
```

The Session-only UI/native regression is available through `SESSION_WORKFLOW_ONLY=1 node scripts/track-workflows-check.mjs`. `CHROMIUM_EXECUTABLE_PATH` can select the locally provisioned native browser. Independent CPU-heavy checks should run without competing render/build workloads; this does not change their assertions/timeouts.

## Full gate status

| Gate | Status | Still required |
|---|---|---|
| G1 | FAIL | Canonical ticks/PPQ and tempo/meter maps across all consumers; complete edit/device/routing/automation/asset and lifecycle qualification; broader Session semantics |
| G2 | FAIL | Hierarchical musical pipeline and200complete-project render/diversity/coherence/listening qualification; expansion held by Android prerequisite |
| G3 | FAIL | Explicit Full Track workflow, variable requested duration and complete evolving independent arrangements |
| G4 | FAIL | Captured live/offline parity, complete production DSP/listening measurements, bounded-memory long export and device resource evidence |
| G5 | FAIL | Complete declared executable matrix and actual versioned Live10/11/12 fixture/reopen evidence |
| G6 | BLOCKED | Exact APK/toolchain/certificate and physical install/upgrade/export/lifecycle/foldable/performance qualification |
| G7 | BLOCKED | Upstream gates, trusted signing, migrations, security/licensing/accessibility and owner release acceptance |

No complete-gate PASS or production-ready APK is declared. The earlier [full capability inventory and external test procedures](ACCEPTANCE.md) remain applicable except that the scoped Session/precision/insert corrections above supersede their earlier defects. The final full-song acceptance journey remains unfinished.
