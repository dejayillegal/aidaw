# Runtime timing correction — evidence and incomplete work

Baseline: `ac0a140802446993119df92cde8ae1eabd8198a7`, current main after the owner merged PR19. Previous PR19 checks passed: [PR41993320932](https://github.com/dejayillegal/aidaw/actions/runs/41993320932) and [push41993261447](https://github.com/dejayillegal/aidaw/actions/runs/41993261447). No PR was auto-merged by the agent. ADR-011 explains the incremental design and rollback. Immutable final commit/tree/CI artifact identities are recorded on the new PR.

## Reproduction and root causes

| Requirement / defect | Reproduce and expected behavior | Confirmed cause / correction | Regression / status |
|---|---|---|---|
| Execute valid timing maps | Install a3/4 project with60→120 BPM step/ramp; clock at5s should reach beat6 in step case | assertRuntimeTimingMapSupport blanket-rejected nonconstant/non4/4 maps despite existing converters. Validate and use the existing time service. Baseline four of seven new tests failed due rejected installation; no baseline audible drift is claimed. | baseline-failures.json; actual engine clock tests: scoped correction PASS |
| Clock edits, loops and voice lengths | Change only a tempo map during playback; advance across several loop cycles and sustain across an interior change | Scalar beats/seconds and map-insensitive reanchor conditions. Capture old audio clock, retire queued voices, reanchor; integrate loop debt and sustaining durations in seconds. | runtimeTiming.test.ts; complete live/output capture parity PARTIAL |
| Meter clicks and transport cleanup | Change3/4 to7/8; pause/seek after click scheduled | Integer quarter clicks/bar modulo4 and unregistered click sources. Derive pulses/downbeats from meter map and register click source retirement. | Meter/accent and existing voice-registry regression PASS |
| Offline master timing / return tails | Render changing tempo/meter with known extent | Master points used beat*60/scalarBPM; delay-tail estimate ignored mapped slow tempo. Map point times/return parameters and use minimum mapped BPM for tail preflight. | Native dry ramp onset/frame-count test; full wet/curve parity PARTIAL |
| Truthful beat-aligned preview | Analyze a project then change only timing maps | Scalar beat count, uniform-second waveform bins, timing missing from cache key; approximate renderer advertised measured output. Use mapped extent/bins/cache and approximate label/type. | Preview invalidation and workstation analysis tests PASS; measured waveform/strip equivalence PARTIAL |
| Short-loop safety | Choose a mapped loop shorter than120ms | Existing indexed query cannot represent several upcoming wraps inside one scheduling horizon. Explicit preflight rejection protects event integrity. | Rejection test PASS; tiny-loop capability remains unsupported |

## Changed source and responsibility

- `runtimeTiming.ts`: stateless adapter over canonical converters; no new clock/state.
- `webAudioSynth.ts`: existing live anchors/scheduler/voices/metronome, continuous renderer/master timing and approximate preview.
- `timelineCoordinates.ts`: validate supported maps; retain existing960PPQ conversion authority.
- `wavExportPolicy.ts`: mapped minimum-BPM tail estimate; memory policy retained.
- `runtimeTiming.test.ts`, g1ToG8Strengthening/studioWorkstation tests: actual clock integration, unsupported input rejection, cleanup and preview fidelity contracts.
- `tests/p0-audio-browser.html`, `scripts/verify-p0-audio.mjs`: native mapped fixture, independent equations, WAV decode and unchanged repeat tolerances; original six plugin cases retained.

## Executed checks

| Command / evidence | Actual result / scope |
|---|---|
| Baseline focused7 tests |3 PASS /4 FAIL; retained raw JSON |
| `npm test -- --maxWorkers=2` |325/325 PASS, exit0; unit-summary.json |
| Focused timing + workstation |22/22 PASS, exit0 |
| `npm run lint` / `npm run build` | Final TypeScript and production build PASS, exit0. TypeScript initially caught the stale waveform label union and it was corrected; no check disabled. Existing bundle-size warning remains. The lint script is TypeScript, not a complete ESLint gate. |
| `CHROMIUM_EXECUTABLE_PATH=/tmp/chromium RECOVERY_BROWSER_OUTPUT=/tmp/timing-browser node scripts/recovery-browser-check.mjs` | Exit0;22 native WAV cases including20 repeats (max/RMS0),64-bar render and48kHz mastering; existing probability, visible creation/download/FFmpeg, track, Session, responsive settings checks. native-regression.json. Ran before final preview label/type/test-only strengthening; final CI rechecks exact source. |
| `CHROMIUM_EXECUTABLE_PATH=/tmp/chromium P0_AUDIO_OUTPUT=/tmp/aidaw-timing-repeat node scripts/verify-p0-audio.mjs` | PASS, exit0; seven synthetic cases plus same-project mapped repeat. native-plugin-and-map.json: seven onsets max placement error7.11e-15s; mapped repeat max/RMS0; decoded629422 stereo frames. WAV SHA25606e00ce0e4c603f48a9fb1e37b18bd90ae042648d082ae316a58088bae768fe3. Final exact-source CI still required. |

Native environment: Chromium153.0.8010.0, Node24.22.1, FFmpeg independent stereo f32le decoding. Native executable supplied through isolated package; no renderer fallback. CI uses declared Node22/browser runtime. Local reports identify baseline HEAD because the candidate was uncommitted; source-files.json records implementation/test file hashes. Final PR tree and CI commit are the immutable source identity.

The dry dynamic fixture integrates BPM60→120 linearly in beats0..4, then120 BPM;3/4 changes to5/8 at beat6; four bars end at beat11. Independent expected musical duration is4*ln(2)+3.5=6.272588722239782s, plus documented8s tail. Decode must contain629422 stereo frames at44100Hz (within1 frame). Native oscillator-start observations check seven onsets against the independent logarithmic equation; clock read is bracketed by AudioContext elapsed-time reads. This proves scheduled source placement, not output-device phase/sample alignment. Live analyser proves finite nonzero signal, not expert listening approval.

The initial test observer was installed after start and missed the first native source; its failed NATIVE_SOURCE_PLACEMENT_DRIFT result was a test instrumentation race (observer-race-failure.json retained). The final test installs the observer before playback. Production DSP factories were not substituted or weakened. Repeated PCM bounds remain max<0.001 and RMS<0.0001, with nonfinite/length checks.

## Remaining work / ownership

G0–G7 remain PARTIAL; G8 and release remain BLOCKED. Engineering: continuous master automation curve semantics, wet return behavior at loop boundary, output capture phase/parity, variable-tempo Session UI launch prediction/capture, every supported control/history/persistence path, tiny-loop extension,200 complete-project/audio evaluation and8/16/32-track measured performance. QA/owner prerequisites: exact original user recovery envelopes/assets, licensed/versioned Ableton Live fixtures/runtime, independent producer listening, physical Android devices/operators and trusted production signing/upgrade acceptance. No release-ready/no-lag/complete-Ableton claim follows from these scoped passes.
