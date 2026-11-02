# Milestone3 — evidence isolation corrective subset

This draft advances two G1 history contracts and corrects false G5 verification claims. **G1 is still FAIL. No full-core or release completion is claimed.**

## Baseline and change control

Authoritative main: `12140c94e06c016329c69fc6fdfc6f5f6cd344ce`, tree `7df81aa44d491261a70f6e39ab939ef836c6642e`. M1 `33bc0b62ef0e1c90775df6021cfafc7932aab285` merged by `e77105c4decbb49cbc6d7d86873d50358ed140fe`. PR5/M2 head `a3413a02af8ba2e028fbb8373f1324e9058cb6c8` is merged into main. M1-to-main compare: ahead3/behind0. No open PRs at initial baseline inspection. ADR-002, state contracts, timeline helpers, command bus, preservation tests and audio engines retained.

M1 CI [41367001458](https://github.com/dejayillegal/aidaw/actions/runs/41367001458). Verified M2 CI [41369383752](https://github.com/dejayillegal/aidaw/actions/runs/41369383752), job125036370188 SUCCESS. Its logs confirm S13 native OfflineAudioContext probability oracle: eligible IDs p1,p2; 44.1kHz430056frames peak0.729062915;48kHz468088frames peak0.700393677; both max/RMS error0. This verifies that oracle ran, not live-capture parity or listening.

S01–S12 implementation/test contracts remain in merged M2: command validation/XML sync, mixer/scalar timing metadata, empty locators, invalid-edit atomicity, StrictMode entry, native versioned files, loop/skipped-cycle math, fractional half-open clips, accurate clip movement, clip-aware note callback and opaque native automation. They are retained and reexecuted in PR6 CI. M2's existing report and ADR-002 retain the detailed architecture/source inventory.

## Execution-environment failure and delivered scope

The local environment became unavailable immediately before publishing a larger command/settings/recovery patch. That uncommitted patch is **not included or delivered** here. A local108-test run completed before disconnect, but it does not certify this smaller reconstructed commit. Local unpublished code must be recovered and reviewed separately; do not infer it exists on this branch.

The GitHub connector remained available. This small patch was reconstructed directly from exact remote main, with a tests-only reproduction commit `fc01864dda5305677766e54133f6e559fb762d5a`, then a corrective commit. Final SHA, exact CI run, logs and artifacts are recorded on [PR6](https://github.com/dejayillegal/aidaw/pull/6). The report-containing commit identifies final source without inventing a self-referential SHA.

## Requirement-to-code-to-test matrix

| ID / requirement | File/function / reproduced root cause | Correction | Regression |
|---|---|---|---|
| H01 G1 history integrity | commandBus.getHistory shallow-copies transactions; mutating returned afterState corrupts redo | deep-copy exposed transactions | history inspection cannot change later redo |
| H02 G1 caller-state isolation | commandBus.executeMutation writes revision/XML fields on an existing object returned by a mutator | copy root before bookkeeping | returned caller state stays byte-for-byte unchanged |
| C01 G5 truthful compatibility | validateAlsProjectCadence certifies Live11/12, roundTripVerified and unknownNodesPreserved from a single parsed XML | false for unverified checks, explicit NOT TESTED diagnostics; no Native Verified claim | valid XML cannot certify Live, round trip or preservation |
| C02 G5 identity checks | uniquePointeeIds is computed from track IDs instead of Pointee IDs | inspect explicit Pointee IDs independently | duplicate Pointee IDs detected with distinct track IDs |
| C03 G5 routing checks | any nonempty SourceTrack Value is called valid without resolving the target | resolve simple IDs against parsed MIDI/audio track IDs; warn on unresolved IDs | dangling nonempty source is unverified |

All five cases are in `src/__tests__/g1EvidenceIsolation.test.ts`. Expected behavior is specified by each assertion; tests-only CI reproduces baseline failures before the correction. This branch does not weaken existing tests.

Structural isValid now means XML/hierarchy/track/Pointee checks only; routing has its separate field and diagnostic. This is not full schema validation, complete native routing interpretation, a semantic round-trip comparator or a Live runtime test. Group/return/native-routing forms beyond this subset remain unverified.

## Files, rationale and rollback

Changed production functions only: getHistory/executeMutation in existing commandBus; validateAlsProjectCadence in existing compositionIntelligenceEngine. No composition algorithms, devices, project schema, persistence format, transport, renderers, Android export or signing policy replaced. Added regression file, this report, ADR-003 and baseline evidence. The new ADR records limits and a normal corrective-commit revert; no data migration is necessary.

## Executable evidence and commands

Tests-only reproduction: **five new tests FAIL, existing93 PASS**, job125053555868. [CI41375118131](https://github.com/dejayillegal/aidaw/actions/runs/41375118131), exact head above. Final correction must run the existing pipeline on its exact head; PR6 records actual conclusion and measurements after completion.

Existing pipeline executes `npm ci`, `npm run lint` (tsc --noEmit, not a separate ESLint configuration), `npm test`, `python3 -m unittest discover -s scripts -p 'test_*.py'`, isolated Playwright Chromium install, `node scripts/recovery-browser-check.mjs`, `npm run build`, Capacitor sync, Gradle `assembleDebug`, APK signature/structure verification and SHA256/artifact upload.

No new recovery-browser stress fixture from the unavailable local patch is in this PR. The actual final pipeline is the retained M2 harness, including64bar WAV decode, short repeated renders, responsive settings and44.1/48kHz probability oracle. No listening panel, true-peak/stereo/DC qualification, CPU/RSS benchmark or physical Android result was fabricated.

Local runtime before loss: Java17.0.20, ANDROID_HOME empty, `adb devices -l` unavailable. CI supplies Java21/Android36. Physical-device qualification remains BLOCKED. Real Ableton Live runtime/authored version fixtures are unavailable here. Independent listening, security/dependency/licensing and physical tests remain mandatory before release.

## Full acceptance ledger

| Gate | Status | Remaining owner/action |
|---|---|---|
| G0 | PASS | M1/M2 baseline architecture, ancestry and CI evidence verified; PR6 final exact-head CI is separately recorded |
| G1 | FAIL | DAW engineering: canonical settings/complete command coverage, ticks/PPQ, tempo/meter maps across UI/playback/render/ALS, routing/automation, native recovery/assets, true Session state transitions and full editing/persistence workflow |
| G2 | NOT TESTED | Composition/producer:200 complete projects, measured structure/harmony/occupancy/motif diversity, deterministic replay and independent listening; prerequisite G1 incomplete |
| G3 | FAIL | New Project remains16bar starter; composition/UI must deliver Sketch/Full Track modes and variable-duration complete arrangements/independent layer development/endings |
| G4 | NOT TESTED | Existing automated offline fixtures only; DSP/QA owe live capture parity, complete production-quality measurements, long-duration/resource solution and listening |
| G5 | FAIL | Interop: real versioned Live fixtures/native device/routing/tempo/group/audio/expressions round trips and declared workflow qualification |
| G6 | BLOCKED | Android QA/hardware owner: physical install/upgrade/edit/play/save/reopen/export/external player/lifecycle/memory/layout evidence |
| G7 | BLOCKED | Release/security/owner: upstream gates, exact artifact qualification, signing lineage, install/upgrade, security/licensing and acceptance |

## Compatibility findings and release risks

| Capability | Classification |
|---|---|
| Existing browser procedural voices/supported inserts | Supported browser subset; full production fidelity Not Tested |
| ALS Arrangement MIDI/app metadata | Partially Supported |
| Unknown device/track XML, native automation | Preserved but Not Executable where retained; broader semantic coverage Not Tested |
| Audio assets/groups/native tempo-meter/routing/modulation | Partially Supported / Not Tested |
| True Session launch/record/return workflow | Not Tested / incomplete implementation |
| Ableton Live version qualification | Not Tested |
| VST3/AU/Max for Live/proprietary Pack hosting | Unsupported |
| Physical Android qualification | Not Tested; hardware access Blocked |

The256MiB offline budget and full-duration limitations remain; no silent shorter/fallback render was introduced. Test/build completion cannot establish release quality. Main is unchanged until an explicit merge; this remains draft. The larger unpublished G1 work is at risk while its workspace is unavailable, and must not be treated as merged progress.
