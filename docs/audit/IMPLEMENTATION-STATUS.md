# Implemented, pending and strengthening register

Baseline: da38f86a3f65e518b3f90b7125a88e7c32fc0400. This is a living source-backed register, not release approval.

| Area | Implemented and evidenced | Pending / incomplete / strengthening required | Status |
|---|---|---|---|
| New Project | Configured Full Track, isolated queue/history, native save/reopen, visible playback/WAV decode; PR18/main CI41989553354 | Key/complexity coverage, all styles/form diversity, full user journey | PARTIAL |
| Clear Arrangement | Canonical command, confirmation/options, lock protection, device/opaque XML preservation, cancel/undo/redo/native reopen; desktop/phone browser check | Broader audio/group/Session scenarios, device touch testing | PARTIAL |
| Timing | 960 PPQ helpers, tempo/meter representation, scalar transport regression | Central live/offline/Session tempo-map parity; remove remaining scalar scheduling paths | PARTIAL |
| Editing | Independent clips, scoped MIDI transforms, timeline commands/history | Every pointer/tool action, multiselect, gestures, all lock/range cases | PARTIAL |
| Audio/devices | Shared native rendering, registered plugin tests, explicit resolution, probability and repeated PCM checks | Complete audible parameter/routing/articulation parity; independent production listening | PARTIAL |
| Composition | Existing song planner, independent role phrases, editable final sections | 200 complete MIDI/audio projects, structural diversity, harmonic review and producer listening | PARTIAL |
| Persistence | Atomic journal, provenance checks, corruption/future handling and synthetic recovery tests | Original envelopes for Berghain_Core_133.5BPM_541.als and Tresor_Vault_138.5BPM_577.als; assets/relink/multiple-tab recovery | BLOCKED for exact-user recovery |
| ALS | Scoped XML preservation and app metadata/native event round trips | Licensed Live versions, real device/routing/asset/expression playback comparison | PARTIAL |
| Session | Visible slots/launch/capture/stop/return/history/reopen tests | Variable-tempo/load/follow-action and full capture parity | PARTIAL |
| UI | Current workstation retained; New Project and Clear repaired | All visible controls, focus/error/keyboard paths, accessibility, PWA update/lifecycle | PARTIAL |
| Performance | Clear-dialog pointer-to-frame measurement; initial full-App rerender missed100ms | 8/16/32-track interaction/audio/heap/RSS budgets, long-session and thermal testing | PARTIAL |
| Android | CI Gradle debug APK/structure/checksum evidence | Physical device install/upgrade, SAF, lifecycle, audio focus, folded/unfolded touch and sustained memory | BLOCKED |
| Release | Dependency audit/SBOM and fail-closed CI | Remaining advisories, strict lint/static coverage, trusted signing lineage, owner release acceptance and all mandatory gates | BLOCKED |

Engineering owns core/timing/control and performance implementation. QA needs exact recovery envelopes and device/operator access; licensed Live and producer review require external resources. Continue independent software work while those remain blocked. Never infer a gate PASS from a passing subset.

Latest correction removes the active UI dependency on the legacy clear XML reconstruction helper. That helper remains exported for compatibility; this does not certify other callers. Clear preserves original source/takes and audio media. Session slots referenced by performance decisions reject removal atomically.

Verification commands: npm run lint; npm test -- --maxWorkers=2; CHROMIUM_EXECUTABLE_PATH=<native-browser> node scripts/clear-arrangement-check.mjs; npm run build. Exact run evidence is retained under evidence/clear-arrangement and on the repair PR. G0–G7 remain PARTIAL, G8 and release remain BLOCKED.
