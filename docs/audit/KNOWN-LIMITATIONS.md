# Outstanding limitations

- The original exported Berghain recovery envelope is now available and was reproduced, repaired and checked in an isolated native-browser IndexedDB profile: 8 tracks/128 bars, exact original archive, unchanged score, idempotent reopen, edit/save/reopen, native snapshot and a four-bar audio render. Full128-bar audio and the original binary ALS remain unqualified. The Tresor_Vault_138.5BPM_577.als envelope is still unavailable. See SESSION-RECOVERY-EVIDENCE.md; raw user data is not committed.
- No physical Android, licensed Ableton Live runtime or independent producer listening panel is available. Procedures are in ANDROID-QUALIFICATION.md and ALS-COMPATIBILITY-MATRIX.md.
- Full-track form/harmony/orchestration still needs the200-complete-project MIDI/audio corpus and structured listening. Eight generator roles are the implemented ceiling of the current orchestration palette, not a claim of production quality. Some styles intentionally omit roles in sections.
- Step/linear tempo maps and valid meter maps now execute through existing time converters. Full tempo/meter parity remains incomplete: master gain now shares beat-domain scheduling across live/export with native step/ramp/loop/seek evidence; full wet tempo-return loop-boundary/captured-output parity and Session load qualification remain incomplete. Arrangement loops shorter than the120ms scheduler horizon reject explicitly (LOOP_WINDOW_UNSUPPORTED); do not call arbitrary tiny loops supported. Reviewed timing work was selectively ported from preserved2169093, not blindly merged.
- The waveform/strip analysis renderer is an approximate procedural preview, now labeled accordingly (isMeasuredAudio=false). Beat-bin alignment and map-only cache invalidation are fixed; waveform equivalence to actual device processing and scalar-tempo strip-silence behavior remain unqualified.
- Universal native plugins, complete racks/macros/sidechains/audio-asset/warp fidelity and every expression container are not implemented or qualified.
- Full control/command/undo/persistence coverage is incomplete. File → Clear Arrangement was repaired in owner-merged PR19 with visible cancel/history/reopen checks; partial pointer/edit tools and other legacy navigation remain inventoried.
- Imported/generated take snapshots can carry import wall-clock metadata; same-seed musical determinism excludes those timestamps. Initial comping snapshots and all long-arrangement take semantics require separate qualification.
- Standardized integrated LUFS/true peak, audible boundary quality, low-end/stereo assessment, capture parity, long-session CPU/RSS and complete cancellation/resource-limit qualification remain incomplete.
- TypeScript checking passes in the repository's current configuration; strict-mode rollout and a complete ESLint/static-analysis gate are outstanding.
- PWA multiple-tab races, service-worker update/storage schema combinations and physical interruption/recovery remain unqualified.
- Seven dependency advisories remain (2 low,5 moderate). No complete security/licensing review or production signing-lineage approval is claimed.

These are real acceptance gaps, not approvals to drop features or erase original projects. Engineering/QA must attach measured evidence before promoting a gate.

- The owner-merged runtime-timing/Gradle correction passed main CI42001766197. New follow-up commit CI and physical qualification remain separate requirements. See BUILD-DOWNLOAD-EVIDENCE.md and the PR for exact artifact status.
