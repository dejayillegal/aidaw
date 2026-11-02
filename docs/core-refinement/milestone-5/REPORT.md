# Milestone5 — merge integrity and native render repeatability

This delivers a corrected integration baseline and the measured repeatability fix. It is not completion of G1, G4 or the DAW/release mandate. Exact remote commit IDs, final CI conclusions and artifacts are recorded on the associated draft PR; the report-containing commit identifies source without inventing its own SHA.

## Authoritative baseline and ancestry

Main inspected: `b9c86691269debdbab3ba6164da0e7082cea123b`, tree `9a1b14e267834b28dff7ab042622604fb409edff`. No open PRs at inspection. PR7 is merged as `d526ee3a004eda53471a17958042c127564db946`, head `2bf8d12f098947d112aeb34613f933310bd05426`. PR8 is merged as main b9c8669, head `821f249a8dabc3959b79ead30c78e9b5f1e84c7b`; this differs from the previously tested a0fa241. A prior green head is not evidence for the combined merge.

[Main CI41427445049](https://github.com/dejayillegal/aidaw/actions/runs/41427445049), job125217370720 FAIL: `commandBus.ts(92,30) TS1005`. Local npm ci installed676 packages; npm run lint reproduced the syntax failure. `baseline-lint.txt` retains it. Source inspection confirmed duplicated mutator declarations/calls, a stray y/missing if, duplicate imports/serializer paths, duplicate parser properties/length declarations, and an additional command side effect inside a React updater. The latter republishes transactions under StrictMode. ADR-001..004 remain intact.

## Root causes and requirement-to-code-to-test traceability

| ID / requirement | Reproduction / root cause | Correction / file functions | Regression evidence |
|---|---|---|---|
| M01 G0/G1 integration | Baseline lint cannot parse merged command code; App contains both updater and explicit dispatch | commandBus.executeMutation and App.handleExecuteProjectCommand retain one existing validated path and one mutator call; remove duplicate declarations/imports | TypeScript; existing actual StrictMode UI plus mergedIdentityContracts once/history/immutability case |
| M02 G1/G5 identities | PR7 Data-AIDAW clip/note aliases are overwritten by duplicated parser properties; PR8 generated track aliases are not accepted by new reconciler | alsIdentity.readAlsIdentity/matchesAlsIdentity reused in parser, reconciler, patch engine and metadata paths; conflicts reject | Both alias formats edit/reload/patch; cloned clips/notes; conflicting aliases; existing branch suites |
| M03 G1 XML allocation | Parent-scoped new clip IDs repeat across tracks | syncTrackClipsToXml reserves document ID space for newly allocated clips, retaining existing native IDs | Existing coreRefinement distinct-ID contract unchanged |
| M04 G1 precision/extent | Fixed3-decimal serialization and4-decimal moves lose fine coordinates; old extent clamps intended move28 to23.9375 | Preserve exact requested values/grid metadata; applyClipPositionWithEditMode moves/extends explicit extent rather than truncating | Fine0.000125beat coordinates; sparse6144.000125beat move/save/reload; old fractional/long timeline tests |
| M05 G1 atomicity | Clip-only command on partial native fixture falsely requires tempo target | synchronizeProjectStateToXml writes existing target; changed tempo without target throws before history; device Tempo parameters are never project-owned targets | Existing PR7 move/undo fixture plus explicit failed tempo edit/input/history check |
| M06 G1/G5 opaque safety | Unrelated mute strips namespace binding and produces parsererror; formatting can alter xml:space text | syncLocatorsAndMixerToXml parses intact XML, validates source and serializes without global pretty-print; humanization likewise retains text | Namespaced vendor/whitespace command regression: initially FAIL, corrected PASS |
| A01 G4 repeatability | Unordered native sums cause repeat PCM variation; master compression magnifies it | orderedAudioSum plus shared webAudioSynth graph uses ordered binary sums for voices/tracks/sends/static oscillator/master-return junctions, retaining DSP settings and scheduling | Native controls, original failing frames,20 stereo raw repeats,20 stereo WAV repeats; orderedAudioSum numerical/resource tests |

The minimally syntax-reconciled suite had129 PASS /9 FAIL. New identity contracts initially had1 PASS /5 FAIL; namespace case initially FAIL. Reproduction JSON retains actual messages. These failures were fixed without weakening existing assertions. Final local suite152 PASS (including both merged branches), TypeScript/build PASS,12 Python checks PASS. MockAudioNode now exposes its owning context like a native AudioNode; no mixer/immutability assertions were removed.

## Architecture / changed inventory

Project authority remains AbletonProjectState. App → existing command bus → existing validated incremental XML projection → history/queue/persistence. There is one command publication path. alsIdentity is a stateless compatibility reader, not another identity store. Existing clip preservation reconciles native nodes instead of reconstructing unrelated content. Both alias conventions remain readable; contradictory data rejects.

The audio engine retains buildAudioBusGraph, getOrCreateTrackChannelRuntime, scheduleTrackVoiceAtTime, the same native instruments/inserts/compressor and existing clock/suspend/render pipeline. OrderedAudioSum is a DSP resource helper, not a renderer or timeline. Static sums and existing retirement callbacks are adapted to it. ADR-005 covers integration; ADR-006 covers the audio connection decision, migration/rollback and resource risks.

Additional changed files: mergedIdentityContracts.test.ts, orderedAudioSum.test.ts, parametricAlsV7.test.tsx (native context ownership in mock), recovery-browser.html, recovery-browser-check.mjs (20 repeats/both channels/runtime identity), probe-render-repeatability.mjs and these evidence files. Project schema, Android exporter, Gradle/signing/version policy and composition planning are unchanged.

## Audio root-cause evidence

All tests below use seed777 and the existing4bar project; they do not constitute a multi-project/genre corpus or listening evaluation. Native Chromium153.0.8010.0 was obtained as isolated @sparticuz/chromium153.0.0 outside application dependencies. The package extractor encountered a font-directory chown error, but its native executable extracted successfully; direct --version and Playwright execution succeeded. No mock/lower-fidelity product renderer was substituted. CI uses its separately recorded browser/runtime versions.

| Controlled experiment | Renders | Result |
|---|---:|---|
| Existing full native effects |20|6 violations; max0.00225263834, including frame104031 |
| Muted master returns |20|16 violations; not a master-delay-only explanation |
| Removed insert delays |20|2 violations; not resolved by removing delays |
| Fixed identical PCM through native compressor |20|max/RMS0 |
| Original full graph with binary-sum diagnostic intervention |20|max/RMS0 |
| Production shared ordered-sum correction |20|max/RMS0 |

Additional valid isolation cases (compression, oversampling, channel count, retirement and inserts) are retained in native-dsp-experiments.json. Unity/bypass controls were diagnostics only and are not the fix. Two exploratory scoped-compressor comparisons with an incorrect cross-context counter were discarded and are not used as evidence. The corrected scoped controls confirm master compression amplifies the discrepancy. Primary native implementation references and the boundary of the confirmed application-level diagnosis are in ADR-006.

Reproducer: install an isolated supported Playwright/Chromium; set CHROMIUM_EXECUTABLE_PATH when needed, then `DSP_REPEATS=20 DSP_OUTPUT=/tmp/dsp.json node scripts/probe-render-repeatability.mjs`. Default full mode fails on the unchanged0.001 max /0.0001 RMS bounds. On the first, pre-audio integration correction, copy the probe from this branch and run `DSP_PROFILES=full,orderedFanIn,fixedPcmCompressor` to reproduce the counterfactuals. Diagnostic profiles are explicitly separate from product fidelity acceptance. No sum-order intervention hook is installed in the product.

## Executed verification and limits

Commands: npm ci --no-audit --no-fund; npm run lint; npm run build; Vitest JSON run; python3 -m unittest discover -s scripts -p 'test_*.py'; git diff --check; real browser harness and the diagnostic probe. Runtime Node24.22.1 / Python3.12.14; CI retains Node22 / Java21 / Android36. npm run lint is TypeScript, not a separately configured ESLint suite. Build retains a >500kB chunk warning (about920.79kB minified JS).

Local native browser harness PASS:20 repeated stereo WAVs with identical hashes,64bar WAV independently decoded,48kHz mastering,44.1/48kHz probability oracle, future-version visible alert and unchanged journal, real IndexedDB1024bar/4096note/20cycle/fault recovery, three responsive layouts and stalled-render guard. local-evidence.json contains actual measurements. This browser capture followed the DSP correction; the final namespace-only source correction is covered by152 unit tests and must be re-executed in exact-head CI. Final-head CI/artifacts are attached to the PR rather than inferred from local output.

Local64bar render measured42309ms; raw20-render correction55660ms. Earlier timings are not controlled CPU/RSS benchmarks. Additional native GainNodes have a cost;10000 source release tests establish tree pruning, not Android native memory qualification. The256MiB buffer preflight remains; long export streaming and full tail/loudness behavior are not certified. The current waveshaper is not a qualified true-peak/lookahead limiter. Existing scalar tempo import still normalizes outside40–240 BPM; full tempo/meter-map and conversion consistency is not claimed. No listening panel, physical Android device, native Live application/version test, sustained CPU/RSS or final security/licensing review was performed.

## Acceptance ledger

| Gate | Status | Remaining work / owner |
|---|---|---|
| G0 baseline main | FAIL | Supplied merged main does not compile. Corrective candidate install/build/tests/browser pass locally; exact-head CI is recorded on PR. Engineering must qualify/merge the actual corrected tree. |
| G1 | FAIL | DAW engineering: ticks/PPQ and tempo/meter maps across UI/playback/render/ALS; full routing/automation/assets/Session operations and end-to-end editing/history/persistence qualification. Merge/identity fixes are targeted contracts. |
| G2 | NOT TESTED | Composition/producer:200 complete projects across styles/durations, harmonic/motif/occupancy measures and independent listening after core prerequisites. |
| G3 | FAIL | Full Track/Sketch workflow, variable-duration complete songs, independent layer development and intentional transitions/endings not delivered. |
| G4 | FAIL | Repeatability defect corrected in the measured subset; full technical quality, live captured parity, true peak/DC/stereo/low-end/dynamics/long export and listening still unqualified. |
| G5 | FAIL | Targeted native fixtures/metadata preservation only. Interop needs real Live versions, audio/groups/assets/native tempo/routing/devices/expressions and declared workflow evidence. |
| G6 | BLOCKED | Android QA/device owner: physical install/upgrade/edit/play/save/open/export/external player/lifecycle/memory/layout qualification. |
| G7 | BLOCKED | Release/security/owner: preceding gates, signing lineage, exact artifact install/upgrade, licensing/security and owner acceptance. |

Browser native voices/inserts remain the existing supported subset. ALS Arrangement MIDI is partially supported; retained unknown devices/XML/native automation are preserved where tested, not universally executable. True Session launching and VST3/AU/Max for Live/proprietary Pack hosting are not implemented here. No release, signing identity change or physical-device approval is claimed. Main is unchanged by this draft until explicit review/merge.

## Exact pre-correction replay

A detached worktree at baseline b9c8669 plus `git apply <this-branch>/docs/core-refinement/milestone-5/syntax-only-reproduction.patch` removes only the merge syntax blockers. Install baseline dependencies and run the baseline full suite: the replay reproduces129 PASS /9 FAIL. This patch is forensic evidence, not a proposed production solution. Copy mergedIdentityContracts.test.ts into that worktree and use Vitest testNamePattern selectors to reproduce alias/precision and namespace failures before the corresponding fixes.
