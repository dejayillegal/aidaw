# Implemented, pending and strengthening register

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
