# Startup recovery and WAV destination integrity

Baseline main: `9275da64ca2753d3fee554cfdf7b0a388b65315b`. Reviewed follow-up: `b16ef078656a84261435f3cc098a8d128ca41e19` (PR26). Its three browser synchronization corrections are retained. This follow-up adds application fixes rather than treating harness changes as complete product qualification.

## Reproductions and corrections

- During asynchronous recovery, the temporary starter workstation was interactive before its saved queue/project had settled. A user edit could cause the restore callback to retain the placeholder while the command target moved to the recovered queue. Startup now presents an accessible busy status and withholds project controls and keyboard shortcuts until recovery and initial registration settle. A recovery rejection releases this boundary and exposes the error. A React remount initializes from the actual active score rather than constructing an unrelated starter. Tests explicitly hold recovery pending, check the absence of mutation controls, release it, verify the score, remount, and check failure recovery.
- Blob destination saves ignored the WAV cancellation signal. Three new regressions failed before the fix: an already cancelled operation still opened a destination; cancellation during native picker completion continued writing; cancellation after a chunk still committed. The existing Blob API now accepts an optional signal and phase callback. It checks cancellation before selection, after selection, after Blob reads, between chunks, and before committing. Partial native output aborts through the existing plugin cleanup. The UI disables cancellation at the irreversible commit/verification phase, matching streaming exports. No native Android hardware result is inferred from mocked bridge tests.
- Float32 WAV encoding saturated over-unity samples despite writing IEEE float format. A failing fixture expected +1.5/-2.0 and received +1/-1. Float output now retains raw finite samples; PCM16/24 retain bounded integer saturation. Stream and Blob encoders still share one implementation. This does not establish standards-based integrated LUFS or true-peak qualification.
- Authoring/workspace recovery checks now observe the app's actual recovered queue identity without invoking recovery themselves. Existing exact score comparisons remain. The retained post-export editing check opens collapsed actions using the visible summary.

## Executed checks

Environment: Node24.22.1, npm11.9.0; native headless Chrome151.0.7922.34, Linux container. Browser reports are synthetic fixtures; no private project data is committed.

| Check | Result |
|---|---|
| Targeted export destination/WAV tests, maxWorkers=1 | PASS: 3 files, 24 tests |
| Delayed startup/recovery failure/remount tests | PASS: 1 file, 2 tests |
| npm run lint (strict compiler and correctness ESLint) | PASS |
| npm run build (web/PWA) | PASS; existing bundle-size warning remains |
| Python APK/ALS checks | PASS: 16 tests |
| Native workspace navigation/device/tempo/undo/reopen and four responsive sizes | PASS |
| Native reviewed authoring/Inspect/Compare, audition/undo/reopen | PASS; measured audition peak -9.5dB |
| Native arrangement editing, export, consolidation/split/undo and live isolation | PASS |
| Full local serial regression and visible continuous export | Running at this checkpoint; no pass inferred |
| Exact follow-up Android CI | Required after publishing the source; historical APK success is not this source's verification |

Reports: [evidence/startup-export](evidence/startup-export/). Initial local broad execution exceeded test watchdogs in XML-heavy cases; the serial rerun uses an explicitly recorded20-second watchdog. That is an execution deadline, not a UI/audio performance budget. Repository CI deadlines are unchanged.

## Pending implementation and qualification

Release stays BLOCKED under G0-G8-TRACEABILITY.md. These repairs close named startup/export defects, not the complete feature gates. Complete audio clips/warp, sampler/multisampler/racks/modulation, arbitrary routing/sidechains/latency, portable asset/relink and cross-version recovery, measured integrated loudness/true peak/wet capture parity, sustained32-track resource/interaction qualification, and the200-project composition corpus/listening remain open. The original Tresor recovery input, licensed Ableton Live and physical Android phone/tablet/fold lifecycle/SAF/audio focus/signing qualification also remain unavailable.

Dependency audit remains7 findings (2 low,5 moderate;0 high/critical). No major dependency downgrade or unqualified transitive override is used to hide advisories. Existing original recovery records and acceptance evidence are preserved.
