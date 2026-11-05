# Outstanding limitations

- Exact IndexedDB envelopes for `Berghain_Core_133.5BPM_541.als` and `Tresor_Vault_138.5BPM_577.als` are unavailable. Final recovery reproduction is BLOCKED. Export raw original primary/backup/index/schema records from the affected app without clearing storage; retain checksums and original ALS. Reproduce in an isolated profile, verify backup/provenance, healthy-record isolation, deterministic/idempotent migration, edit/save/reopen/render. Synthetic fixtures are not those records.
- No physical Android, licensed Ableton Live runtime or independent producer listening panel is available. Procedures are in ANDROID-QUALIFICATION.md and ALS-COMPATIBILITY-MATRIX.md.
- Full-track form/harmony/orchestration still needs the200-complete-project MIDI/audio corpus and structured listening. Eight generator roles are the implemented ceiling of the current orchestration palette, not a claim of production quality. Some styles intentionally omit roles in sections.
- Full tempo/meter live/offline parity is incomplete; current shared engine still contains scalar-tempo scheduling paths. Existing unmerged timing work was preserved, not blindly applied.
- Universal native plugins, complete racks/macros/sidechains/audio-asset/warp fidelity and every expression container are not implemented or qualified.
- Full control/command/undo/persistence coverage is incomplete. File → Clear Arrangement still routes to queue; partial pointer/edit tools and legacy navigation remain inventoried.
- Imported/generated take snapshots can carry import wall-clock metadata; same-seed musical determinism excludes those timestamps. Initial comping snapshots and all long-arrangement take semantics require separate qualification.
- Standardized integrated LUFS/true peak, audible boundary quality, low-end/stereo assessment, capture parity, long-session CPU/RSS and complete cancellation/resource-limit qualification remain incomplete.
- TypeScript checking passes in the repository's current configuration; strict-mode rollout and a complete ESLint/static-analysis gate are outstanding.
- PWA multiple-tab races, service-worker update/storage schema combinations and physical interruption/recovery remain unqualified.
- Seven dependency advisories remain (2 low,5 moderate). No complete security/licensing review or production signing-lineage approval is claimed.

These are real acceptance gaps, not approvals to drop features or erase original projects. Engineering/QA must attach measured evidence before promoting a gate.
