# Mixed-meter editing, static gates and Session parity

Baseline: `ede4920e0a606e57d5c67380c68dc5631a0b5a74`, published in PR #21. Both its [push CI](https://github.com/dejayillegal/aidaw/actions/runs/42007286825) and [PR CI](https://github.com/dejayillegal/aidaw/actions/runs/42007329475) passed, including Android debug assembly/verification. Results below qualify the follow-up working tree; the PR records its final remote commit and CI.

| Executed requirement | Result |
|---|---|
| Strict TypeScript as the default compiler configuration | PASS; deliberate implicit-any probe rejects with TS7006 |
| Required ESLint correctness gate | PASS; deliberate unreachable-code probe rejects; source TS/TSX, JS runners and root configs covered |
| Clean npm ci, production/PWA build, Python APK verifier tests | PASS; 16 Python tests; existing large-bundle warning retained |
| Full regression | 342 tests passed across 38 files |
| 5/4 note placement, 7/8 moved-clip extent, mixed-meter Spot and pixel/follow windows | PASS; source immutability, command undo/redo and XML reopening included |
| Visible mixed-meter Spot placement and matching transport counter | PASS at 1440×1000 and 390×844; actual beat 9.25 maps to 003.7.2 in 7/8 |
| Probability before MIDI devices in Session and Arrangement | PASS; failed source notes no longer truncate an earlier arpeggiator group |
| Native captured-probability/arpeggiator PCM against explicit performed MIDI | PASS; 12 events, maximum and RMS PCM difference 0 in the dry fixture |
| Native delay restart with JS scheduler stopped before the seam | PASS; queued AudioParam event resets delay time to 0.375 s at the loop restart |
| Native tempo-map removal | PASS; a new 90 BPM base cancels old delay events and holds 0.5 s |
| Existing visible arrangement edits, native ALS/MIDI/WAV, history and layer isolation | PASS |

Reports: [ui.json](evidence/mapped-editing/ui.json), [audio.json](evidence/mapped-editing/audio.json), [arrangement.json](evidence/mapped-editing/arrangement.json), [static-gates.json](evidence/mapped-editing/static-gates.json). Raw screenshots and transient audio remain local/CI evidence rather than user project assets committed to source.

## Implementation boundaries

All timing changes use the existing musical-time converters and audio clock. A shared bar viewport replaces fixed 4/4 arithmetic in Arrangement/Piano Roll windowing, pointer mapping, rulers, ranges and locators. Spot controls follow the active numerator/denominator; the transport counter and newly dropped marker names use that same meter map. Clip duration labels use quarter-note beats instead of assuming four beats per bar. Note/clip commands and comp-take extents use the canonical meter-aware project extent.

Master rendering is retained. Tempo-synced return automation can now be bounded to a lookahead window and appended after a loop seam. Live start/edit/scheduler paths cancel obsolete map events, including when a map is removed; offline rendering keeps its full-map path. No new project store, clock, renderer, schema or plugin substitution is introduced.

The compiler now enables strict mode. ESLint correctness rules reject hazardous control flow and JavaScript semantics without wholesale formatting or explicit-any churn. Plain JS runners use the JS parser; TS/TSX use Babel syntax parsing. Generated/native artifacts are outside this JS/TS lint scope. The filename sanitizer has one narrowly explained control-regex exception because removing ASCII control bytes is intentional. Promise executor wrappers and MIDI VLQ loop syntax were clarified without changing behavior.

The initial Babel 8 lint integration broke Workbox's Babel 7 service-worker generation and was rejected before publication. The committed toolchain pins compatible ESLint 9/Babel 7 packages and preserves the application engine requirement. ESLint 9 currently reports upstream deprecation; a separately isolated supported lint runtime remains maintenance work. No force/peer-dependency override was used. Dependency audit still reports 2 low / 5 moderate and no high/critical findings. External Qodo review is unavailable in this environment; no independent clean-review claim is made.

## Remaining gate requirements

This closes named software defects, not the complete G0–G7 contract. Full control/command inventory and multi-tab races, all gestures/ranges, 200 complete-project/audio corpus plus producer assessment, all device/rack/expression/routing behavior, arbitrary Session capture-range/device parity, complete wet PCM/standard loudness/true-peak and sustained resource budgets remain open. Licensed Live, original Tresor recovery data and physical Android evidence are still unavailable. G0–G7 remain PARTIAL and G8 remains BLOCKED; no release approval follows from this subset.
