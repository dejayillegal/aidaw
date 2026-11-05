# Session, automation and original recovery correction

Baseline: `25da349706d019bc963a75a7a112cdb1a98ddcbd`, owner-merged PR20. Its main Android CI [42001766197](https://github.com/dejayillegal/aidaw/actions/runs/42001766197) passed. Results below qualify this follow-up working tree; final source SHA and new CI/artifacts must be recorded when publication is authorized. No complete G0–G8 gate or release is approved.

## Implemented behavior

- Live playback and continuous offline rendering use one beat-domain master gain envelope. Gain ramps sample the dB envelope at at most 10 ms intervals and include envelope/tempo knots. Live edits cancel stale events; seeks and loop restarts evaluate the corresponding beat. This is a bounded approximation, not sample-exact complete wet-DSP equivalence.
- Session launch prediction advances 150 ms through the installed tempo map instead of multiplying the base BPM. Capture extends the destination arrangement using its meter map and retains notes sustaining across Session loop cycles.
- The original exported Berghain envelope failed first on a valid historical LFO `Target=AutoFilter.Cutoff` flag. The v1 migration now accepts only that known symbolic route after the existing full descriptor/hash checks. Unknown numeric/cross-track targets, altered records and native automation references remain rejected.
- After that correction, recovery reproduced duplicate native NoteIds in legacy generated XML although the canonical journal score had unique identities. A recovery-only projection migration restores logical identities by unique exact musical-content matching. It preserves native clip IDs, opaque clip state, original score and original envelope archive. Mismatched notes (including microtiming/probability), ambiguous music, per-note references, current/future envelopes and unsupported expression data reject. No positional matching or source-project replacement is used.

## Original envelope evidence

Input: `Berghain_Core_133.5BPM_541.queue_1793491259896_znem2.recovery.json`, 7,557,366 bytes, SHA256 `2da30cdc0bdf8b9d2120f3262535b077c6a5f0c01916fd51f7467b19c638f15d`. The raw file stays outside the repository. Summary: [berghain-recovery.json](evidence/session-recovery/berghain-recovery.json).

Native Chromium 153 restored 8 tracks / 128 bars. Assertions passed for unchanged clip/note score, exact original JSON archive, idempotent second restore, edit/save/reopen, complete native snapshot round-trip, and a finite/non-silent four-bar audio render (1105403 frames, peak0.87323135). Full 128-bar audio, original binary ALS equivalence, physical-device recovery and Tresor recovery remain unqualified.

Reproduce with a preserved envelope in an isolated test profile:

```sh
RECOVERY_ENVELOPE_INPUT=/absolute/path/original.recovery.json node scripts/recovery-envelope-check.mjs
```

The script creates its own browser profile and never writes to the source file or a real user's browser database. A blocked restore exits nonzero and retains diagnostics. It needs the repository's external Playwright runtime convention.

## Executed verification

- 335 tests passed across 37 files, including failure-first reproduction for mapped launches, capture extent/sustains, symbolic LFO migration and XML identity recovery. TypeScript, production build and 16 Python tests passed. Final rerun receipts are attached to the PR; build retains the existing large-bundle warning.
- Native gain checks passed: maximum error below 0.000004 for step/ramp/loop constant-source renders; actual live master seek error below 0.000006. [master-automation.json](evidence/session-recovery/master-automation.json). This runner is an independently failing Android CI step.
- Existing visible recovery/new-project/Session workflows passed, including 20 repeat renders, 64-bar render, responsive dialog controls, audible native meters, save/reopen and downloaded WAV decode. These are scoped browser checks, not physical Android evidence.
- Registered native plugin audio passed 7 cases with independent FFmpeg decode on local source commit70fec91. [registered-plugin-audio.json](evidence/session-recovery/registered-plugin-audio.json). Continuous export passed 5 cases (Blob/stream byte equality, cancellation, retry, extended feedback tail), and the visible phone export/cancel workflow passed. [continuous-export.json](evidence/session-recovery/continuous-export.json), [visible-export.json](evidence/session-recovery/visible-export.json).
- Arrangement editing and Clear Arrangement regressions passed. Clear dialog p95 was 31.5 ms on desktop and phone viewports in this run. [arrangement-editing.json](evidence/session-recovery/arrangement-editing.json), [clear-arrangement.json](evidence/session-recovery/clear-arrangement.json).

The system Chromium launcher could not create its process singleton socket in this environment. Local native checks used an isolated headless Chromium 153 executable supplied by `@sparticuz/chromium`; application dependencies and CI's pinned Playwright runtime were unchanged. Running independent Vite browser scripts concurrently invalidated their shared optimizer cache; the affected Clear check was rerun alone and passed. External Qodo review was unavailable (no connected tools or authenticated CLI); no external clean-review claim is made.

## Remaining acceptance

G0–G7 remain PARTIAL and G8 remains BLOCKED. Outstanding work includes complete control/command/gesture coverage, 200 complete-project/audio and producer assessment, full device/rack/expression/routing fidelity, wet/captured-output parity, standardized loudness/true peak, sustained performance/memory budgets, multi-tab/PWA lifecycle, physical Android install/upgrade/SAF/audio-focus/fold testing, licensed Live reopening and owner release acceptance. Passing these named regressions does not certify those requirements.
