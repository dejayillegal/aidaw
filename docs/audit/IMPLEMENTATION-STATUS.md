# Implemented, pending and strengthening register

Signal-measurement follow-up: [SIGNAL-MEASUREMENT-EVIDENCE.md](SIGNAL-MEASUREMENT-EVIDENCE.md) records shared gated loudness/FIR peaks, measured reference audio, unavailable/legacy labeling, cooperative analysis and independent FFmpeg/native-browser checks. Full conformance, LRA and complete gates remain open.

Application follow-up: [STARTUP-EXPORT-INTEGRITY.md](STARTUP-EXPORT-INTEGRITY.md) records delayed startup protection, active-score remounting, cancellable Blob saves and Float32 headroom repair, with executed and still-pending verification kept separate. The broader pending table below remains open.

## Latest-main blocker follow-up — November 5, 2026

Inspected main: `9275da64ca2753d3fee554cfdf7b0a388b65315b` (merged PR25). No open PRs existed when this follow-up began. Main workflow [42048172578](https://github.com/dejayillegal/aidaw/actions/runs/42048172578), job127316743304, failed three required browser flows. Its lint, 41 test files/356 tests, web build, APK build and signature checks passed. These are baseline CI results, not results for this follow-up.

| Confirmed failure | Root cause and proposed correction | Verification required |
|---|---|---|
| Arrangement check line471 fills a hidden range input after WAV export | The timeline remounts; clip actions return to their collapsed default. Reopen through the visible summary before consolidation. Keep consolidation/duplicate/split/undo and live-audio assertions. | Required arrangement browser check on the follow-up SHA |
| Authoring reload dereferences an undefined active item | The canvas exists before asynchronous IndexedDB recovery finishes. Await recovery of the same saved queue identity before checking exact persisted tracks. | Required authoring check, including exact-state comparison |
| Workspace reload dereferences an undefined active item | Same startup/recovery race in the browser harness. Await the same saved queue identity, retaining all persisted device/track and tempo/undo assertions. | Required workspace check on the follow-up SHA |

This follow-up changes browser harness synchronization, not application features. No forced clicks, fixed sleeps, skipped assertions or continue-on-error are introduced. A missing or different recovered queue item must still fail. No local shell, browser or physical device runtime is attached to this session; GitHub Actions supplies execution evidence. Follow-up CI results are tracked on the remediation PR; pending is not PASS.

### Remaining work and acceptance boundaries

| Priority / area | Pending implementation or strengthening | Required completion evidence |
|---|---|---|
| P0 integration | Resolve any further failures exposed after the three browser blockers; keep every required check failing the job when unsuccessful | Successful full workflow on exact final source, plus review of browser reports |
| P1 project integrity | Asset packaging/relink, quota failures, cross-version writers, service-worker/schema transitions and interruption recovery | Original-data preservation and save/reopen/failure-matrix evidence |
| P1 arrangement | Complete audio clips/warp, tools, multiselect, touch gestures and lock/range behavior | Visible canonical edit/undo/save/reopen/export journeys for supported cases |
| P1 instruments/routing | Sampler/multisampler, racks/macros/modulation, pre/post sends, sidechain and latency fidelity | Audible parameter/routing fixtures and shared live/export comparisons |
| P1 audio/export | Standardized integrated loudness/true peak, wet capture parity, resource limits and complete cancellation paths | Independent decoded-audio measurements and bounded-resource runs |
| P1 composition | 200 complete MIDI/audio projects, broader role/style/form coverage and independent listening | Reproducible corpus plus structured producer assessments |
| P1 responsiveness | 8/16/32-track interaction/audio/heap/RSS and long-session budgets; complete keyboard/focus/error paths | Measured interaction and sustained-load evidence, not screenshots alone |
| External qualification | Original Tresor recovery input, licensed Live interoperability, physical Android install/upgrade/SAF/audio-focus/fold/lifecycle/load and trusted signing | Exact inputs and qualified operator/device results |

Engineering work remains open where implementation is incomplete. Hardware, missing original input, licensed-host and listening requirements cannot be closed by changing tests or status labels. Current G0–G8 definitions in G0-G8-TRACEABILITY.md remain authoritative. Release remains BLOCKED.

Current timing milestone baseline: ac0a140802446993119df92cde8ae1eabd8198a7 (owner merged PR19 after both CI runs passed). PR18/main CI41989553354 and PR19 PR CI41993320932/push CI41993261447 are historical completed evidence. This is a living source-backed register, not release approval.

| Area | Implemented and evidenced | Pending / incomplete / strengthening required | Status |
|---|---|---|---|
| New Project | Configured Full Track, isolated queue/history, native save/reopen, visible playback/WAV decode; PR18/main CI41989553354 | Key/complexity coverage, all styles/form diversity, full user journey | PARTIAL |
| Clear Arrangement | Canonical command, confirmation/options, lock protection, device/opaque XML preservation, cancel/undo/redo/native reopen; desktop/phone browser check | Broader audio/group/Session scenarios, device touch testing | PARTIAL |
| Timing | Existing 960 PPQ/time converters now drive live clock, step/linear map onsets, note durations, seek/reanchor, skipped-loop debt, meter clicks, offline master point times and tempo-synced returns; synthetic/native tests | Wet DSP and complete captured-output parity, variable-tempo Session load/capture, loop-boundary return automation, tiny loops below120ms | PARTIAL |
| Editing | Independent clips, scoped MIDI transforms, timeline commands/history | Every pointer/tool action, multiselect, gestures, all lock/range cases | PARTIAL |
| Audio/devices | Shared native rendering, registered plugin tests, explicit resolution, probability and repeated PCM checks | Complete audible parameter/routing/articulation parity; independent production listening | PARTIAL |
| Composition | Existing song planner, independent role phrases, editable final sections | 200 complete MIDI/audio projects, structural diversity, harmonic review and producer listening | PARTIAL |
| Persistence | Atomic journal, provenance checks, corruption/future handling and synthetic recovery tests | Original Berghain envelope restored with score/archive/reopen/audio subset evidence; Tresor_Vault_138.5BPM_577.als, full audio, assets/relink/multiple-tab recovery remain outstanding | PARTIAL; Tresor BLOCKED |
| ALS | Scoped XML preservation and app metadata/native event round trips | Licensed Live versions, real device/routing/asset/expression playback comparison | PARTIAL |
| Session | Visible slots/launch/capture/stop/return/history/reopen tests | Variable-tempo/load/follow-action and full capture parity | PARTIAL |
| UI | Current workstation retained; New Project and Clear repaired; beat-aligned preview cache follows timing maps and is honestly labeled approximate | All visible controls, focus/error/keyboard paths, accessibility, PWA update/lifecycle | PARTIAL |
| Performance | Clear-dialog pointer-to-frame measurement; initial full-App rerender missed100ms | 8/16/32-track interaction/audio/heap/RSS budgets, long-session and thermal testing | PARTIAL |
| Android | CI Gradle debug APK/structure/checksum evidence | Physical device install/upgrade, SAF, lifecycle, audio focus, folded/unfolded touch and sustained memory | BLOCKED |
| Release | Dependency audit/SBOM and fail-closed CI | Remaining advisories, strict lint/static coverage, trusted signing lineage, owner release acceptance and all mandatory gates | BLOCKED |

Engineering owns core/timing/control and performance implementation. QA needs exact recovery envelopes and device/operator access; licensed Live and producer review require external resources. Continue independent software work while those remain blocked. Never infer a gate PASS from a passing subset.

Latest correction removes the active UI dependency on the legacy clear XML reconstruction helper. That helper remains exported for compatibility; this does not certify other callers. Clear preserves original source/takes and audio media. Session slots referenced by performance decisions reject removal atomically.

Verification commands: npm run lint; npm test -- --maxWorkers=2; CHROMIUM_EXECUTABLE_PATH=<native-browser> node scripts/clear-arrangement-check.mjs; npm run build. Exact run evidence is retained under evidence/clear-arrangement and on the repair PR. G0–G7 remain PARTIAL, G8 and release remain BLOCKED.

Runtime-timing milestone: see RUNTIME-TIMING-EVIDENCE.md, ADR-011 and evidence/runtime-timing/. No new project store, renderer, clock authority or schema is introduced. Source2169093 was reviewed and only its timing subset was ported; unrelated preserved work remains untouched. The baseline guard rejected dynamic maps; it did not demonstrate audible drift because playback was blocked. The native probe observes scheduled source onsets and decodes a dry mapped WAV; it is not an output-device phase comparison or listening approval.

CI follow-up: both initial candidate CI runs passed application checks but failed Gradle distribution download (HTTP504 /10000ms timeout), before Android compilation. BUILD-DOWNLOAD-EVIDENCE.md records the minimal same-version binary-distribution,60000ms timeout and official SHA256 pin correction. Final clean Android CI remains required; no local/hardware qualification inferred.

Session/recovery follow-up (baseline25da349): shared master gain envelopes, mapped launch prediction, meter-aware capture and sustained-note overlap are implemented. The original Berghain envelope now restores after narrowly scoped historical LFO-target and duplicate native XML-ID repairs. Exact-score, archive, idempotent/edit/snapshot and four-bar audio evidence is in SESSION-RECOVERY-EVIDENCE.md. Tresor, full recovered-project audio, hardware and complete gates remain outstanding.

Mapped-editing follow-up (base ede4920, PR21): strict compiler/default-negative probe, required correctness lint, mixed-meter note/clip/Spot/viewport/transport paths, Session pre-MIDI probability parity and ahead-of-loop return scheduling are implemented and tested. See MAPPED-EDITING-EVIDENCE.md. Prior PR21 commit passed both Android CI runs42007286825 and42007329475; follow-up CI and complete gates remain separate.
