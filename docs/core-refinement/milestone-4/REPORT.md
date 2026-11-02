# Milestone4 corrective subset — commands, settings, independent clips and recovery

This is a further G1 corrective subset, **not G1 completion or release certification**. Report snapshot: local verification before publishing; exact final SHA, CI run, measured browser results and artifacts are recorded in the associated draft PR after execution. The report-containing Git commit identifies the source revision; no invented final SHA is embedded in its own contents.

## Authoritative baseline and ancestry

Current verified GitHub main `f331b709bf17fb68f0b9ae343bfa8c433f43dde0`, tree `cb0388d86cdb8ba5df9a3e5cef9fe112bc59cbea`, merges PR6 head `fed12cf315c0abc7bbb27adcb02470495a635355`. PR6 CI41375367579 and current-main CI41399089710 passed. Previous M2 baseline main was `12140c94e06c016329c69fc6fdfc6f5f6cd344ce`, tree `7df81aa44d491261a70f6e39ab939ef836c6642e`. PR5 is merged; M2 head `a3413a02af8ba2e028fbb8373f1324e9058cb6c8`. PR6 is now merged. Its history/ALS evidence correction and ADR-003 remain intact. The recovered working changes were checkpointed locally, then cherry-picked onto current main; one command-bus conflict was resolved by retaining both PR6 isolation and recovered single-extent normalization. Main contains M1 `33bc0b62ef0e1c90775df6021cfafc7932aab285` through M1 merge `e77105c4decbb49cbc6d7d86873d50358ed140fe`; The prior M1-to-M2 compare reported ahead3/behind0. The new branch descends directly from the current main, retaining the subsequent PR6 merge. Local M2 tree matched authoritative main before edits. Original ADR-002/ADR-003, command bus, timeline coordinates, state contracts and ALS preservation tests retained.

M1 CI: [41367001458](https://github.com/dejayillegal/aidaw/actions/runs/41367001458). M2 CI: [41369383752](https://github.com/dejayillegal/aidaw/actions/runs/41369383752), job125036370188 SUCCESS. Retrieved logs confirm S13 actually ran: probability oracle eligible IDs p1,p2; 44.1kHz430056frames peak0.729062915 and48kHz468088frames peak0.700393677, both max/RMS error0 against explicit eligible-event renders. This is an offline probability oracle, **not captured live playback parity or listening approval**. Machine-readable baseline is `baseline-evidence.json`.

S01–S12 source and regression inventory from M2 REPORT.md was checked against the working tree: command validation/XML projection, metadata/scalar timing persistence, empty locators, invalid state atomicity, StrictMode command entry, versioned save/open, centralized loop bounds/skipped cycles, half-open fractional clips, clip-length-preserving edits, clip-aware note callback and native automation preservation remain present. This milestone runs those suites again rather than assuming merge implies correctness. S13 remains in the same browser harness and must run again in CI.

## Ownership and architectural assessment

App presents `AbletonProjectState`, command bus validates/commits history, ALS engine projects supported state and preserves opaque source, queue stores isolated records, native format validates/migrates, existing Web Audio engine interprets events for playback/render. `projectDefaults` and `audioSettingsContracts` are stateless helpers, not additional state stores or engines. `audioSettings` now belongs to project; root arrangement extent remains sole extent owner. ADR-004 describes migration and rollback, including the fact that M2 cannot reopen v2 files without an upgraded reader.

## Requirements → code → reproduction → regression traceability

PASS below means the stated automated corrective contract, never the entire gate. Current-main reproduction ran three selected g1Recovery tests in a detached worktree: malformed controls, destructive humanization and missing generated-track XML all FAIL (see reproduction-evidence.json). History/caller isolation and false ALS claims were already corrected by merged PR6; those rows are retained regressions, not newly fixed here. Other corrections are source-confirmed with executable regressions. Browser rows remain NOT TESTED in this pre-CI snapshot.

| ID / requirement | Confirmed root cause and reproduction | Correction / changed file and function | Regression and status |
|---|---|---|---|
| R01 G1 history | Mutate a state returned by getHistory; redo loses original clips because history exposes internal objects | commandBus.getHistory returns deep snapshots | g1Recovery history test PASS |
| R02 G1 native schema | Reopen wrong-typed required master/humanization controls or string loop flag; old validation accepts | audioSettingsContracts.assertAudioSettings; projectStateContracts; projectSnapshotService validation | malformed native controls reject PASS |
| R03 G1 clip independence | Humanize a two-clip track; old rehumanizeAllProjectTracks regenerates clip0 and drops independent schedule | alsXmlEngine existing rehumanizer transforms existing notes/clip XML, retains identities/probability/pitch/devices | two-clip identity and idempotence PASS; listening NOT TESTED |
| R04 G1 canonical settings/undo | Change master/transport/humanization; formerly separate React stores bypass project snapshots | types/ableton; projectDefaults; App.updateAudioSettings and all existing edit callbacks transact outside React updaters | atomic settings undo/redo + metadata reparse PASS; exhaustive UI gesture coverage NOT TESTED |
| R05 G1 ownership/save | Native file duplicates root settings; queue/native open can reparse away canonical settings/empty tracks | projectSnapshotService v2 migration + single owner; ProjectQueueService.enqueueProjectState; App native open | v1 migration, v2 ownership, empty project reopen PASS |
| R06 G1 queue integrity | Modify getAllItems results; formerly changes canonical queue state; queue counter also overwrote domain revision | cloneQueueRecord/getAllItems/getItem/updateWorkingProjectState | isolated snapshots, Blob identity, retained domain revision PASS |
| R07 G1 stale transaction | Async response or prior callback can target a newly selected project | commandBus optional target/revision context; App projectRef/activeQueueRef and stale-response checks | stale target/revision rejects before history PASS; async whole-UI race stress NOT TESTED |
| R08 G1 XML projection | App-created MIDI track has no XML element; serialization silently lacks new musical lane | alsXmlEngine materializes MIDI shell with stable app identity and explicit browser-only device warning; device reparse merges existing app-only devices | added lane identity/metadata reparse PASS; native device execution NOT TESTED |
| R09 G1 recovery | No validated boot recovery or serialized atomic backup; stale XML and partial failures not governed | existing ProjectQueueService recovery journal/flush/restore/remove; App startup recovery + visible write failures | native IndexedDB 1024bar/4096note/20cycle, abort, corrupt checksum, future version, removal test added; NOT TESTED locally, CI required |
| R10 G1 composition ownership | Unrelated analysis can replace existing section decisions with pending UI form defaults | App.enrichProjectWithAnalysis preserves canonical sections | exact sections retained despite different pending form PASS |
| R11 G1 nonmutating commands | Mutator returns existing object; commit bookkeeping changes its nested transport extent | commandBus copies result/settings before normalization | caller object unchanged PASS |
| R12 G0/G7 artifact evidence | SHA helper returns non-SHA fallback; MIDI uses timestamp placeholders | alsXmlEngine.computeSha256Hex explicit unavailable error; queue actual Blob SHA + awaitArtifactChecksum; node webcrypto test setup | known SHA256 abc, real MIDI bytes and unavailable crypto tests PASS |
| R13 G5 honest compatibility (retained PR6) | Former validateAlsProjectCadence asserted Native Verified/roundTrip/preservation from syntax alone; pointee flag copied track check | compositionIntelligenceEngine validator reports only inspected structure, actual explicit Pointee IDs/simple source refs; unsupported checks explicitly NOT TESTED | valid XML cannot certify Live/roundtrip/preservation PASS |
| R15 G1 queued settings | Batch/calibration/export accept the active project controls for every queued project | ProjectQueueService.calibrateQueueItem/applyAndExportQueueItem prefer each canonical project settings; legacy callers remain fallback | queueAudioSettings boundary test PASS; it stops before DSP and is not audio fidelity evidence |
| R16 G1 recovery startup | A rejected future journal can be obscured by default-project enqueue | App startup blocks initialization on recovery errors; future records remain unchanged | Actual App + IndexedDB future-version browser regression added; NOT TESTED until exact-head CI |
| R14 G1 Session semantics | Existing Scene operation replaces Arrangement clips rather than operating a live Session state machine | App.handleLaunchSessionScene now undoable Apply Scene To Arrangement; explicit labels in AiComposerIntelligencePanel | build/contracts PASS; true Session launch/record/return remains FAIL |

Additional App inventory: library insertion, spectral duck, smart calibration, polymeter, chord/grid, MIDI tools, clear, velocity curves, humanization, layer/section generation and queued-project application now enter the same command bus. Lifecycle installation, selection, recovery and undo/redo remain installation boundaries. Queued calibration/export now consume project-owned audio settings. Future-version recovery blocks default project enqueue rather than masking the error. No project mutation inside React updater callbacks. Device parser retains project identity/audio settings. This closes known bypasses, not an assertion that every theoretical editing capability is implemented.

## Executed verification / evidence

Commands: `npm ci --no-audit --no-fund`; `npm test -- --reporter=json --outputFile=/tmp/aidaw-m3-final-tests.json`; `npm run lint` (TypeScript, no separate ESLint configuration); `npm run build`; `python3 -m unittest discover -s scripts -p 'test_*.py'`; `git diff --check`. Dependency install PASS676packages; automated final counts/timestamps are in evidence.json. Build has an existing >500kB chunk warning (current bundle about914kB minified); this is not sustained-memory qualification. jsdom reports unimplemented document navigation during download tests, not a physical file-destination check.

Browser/SDK CI command is `node scripts/recovery-browser-check.mjs`, followed by existing Capacitor/Gradle debug build, APK verification, SHA256 and artifact upload. Pre-CI status NOT TESTED on this correction; exact run/artifacts/results must be read from associated PR. The browser harness uses real Chromium Web Audio and IndexedDB, independent browser WAV decoding and numerical probability oracle; no fake audio fallback was added.

Local `adb devices -l`: command not found; ANDROID_HOME empty; Java17.0.20. CI uses Java21/Android36. No physical Android device, installed Ableton Live runtime, real Live-authored .als fixtures or producer listening panel is available here. No signing identity/release policy change, native Android exporter change, release build or deployment occurred.

## Acceptance ledger — full gates

| Gate | Status | Evidence boundary / remaining owner and action |
|---|---|---|
| G0 | PASS | Verified M1/M2 ancestry, retained architecture/contracts/tests, reproducible install/TypeScript/build/unit suites; exact new CI pending in PR. Baseline SDK/browser evidence linked above. Engineering/QA retain logs. |
| G1 | FAIL | Commands/settings/recovery corrective subset advanced. DAW engineering still owes integer ticks/PPQ, tempo/meter maps with UI/playback/render/ALS integration, complete routing/automation commands, audio assets/recovery, true Session transitions, exhaustive editing/history and full workflow qualification. |
| G2 | NOT TESTED | Composition remains frozen while G1 fails. Music engineering/producer must implement/qualify 200 complete projects and independent listening; no section-signature substitute. |
| G3 | FAIL | Confirmed New Project still a16-bar starter; explicit Sketch/Full Track workflows and complete variable-duration arrangements not delivered. Composition/UI engineering after G1. |
| G4 | NOT TESTED | M2 offline probability/64bar WAV subset evidence only; new CI must revalidate. DSP/QA owe live captured PCM parity, full true-peak/DC/stereo/spectral/dynamic/long-duration tests and listening. 256MiB budget remains. |
| G5 | FAIL | Targeted synthetic preservation tests, app metadata and browser-only device shell do not prove native Live compatibility. Interop engineering needs real versioned Live fixtures, nested groups/audio/assets/expressions/tempo/parameter/routing fidelity and executable workflows. |
| G6 | BLOCKED | Android QA needs physical hardware/install/upgrade/edit/play/save/open/long-export/external-player/lifecycle/memory/foldable evidence. SDK CI cannot replace it. |
| G7 | BLOCKED | Release owner/security need G0–G6, dependency/licensing review, trusted signing lineage, exact artifact install/upgrade, owner acceptance. No release authorized by these results. |

## Compatibility and risk register

| Capability | Classification |
|---|---|
| Browser procedural voices/supported inserts | Supported existing browser subset; production listening NOT TESTED |
| Native .aidaw v1→v2 project/settings migration | Supported tested subset; assets/undo stack not embedded |
| ALS Arrangement MIDI / app settings / stable app-track identity | Partially Supported synthetic fixtures |
| Unknown XML and arbitrary native automation | Preserved but Not Executable where untouched; broader preservation NOT TESTED |
| Browser-only generated devices serialized as app metadata | Preserved but Not Executable in Live; warning emitted |
| Groups/audio assets/native tempo-meter/routing/device modulation | Partially Supported / Not Tested; no broad guarantee |
| Scene application | Supported Arrangement replacement subset; true Session Unsupported/unimplemented |
| VST3/AU/Max for Live/proprietary Packs hosting | Unsupported |
| Ableton Live version qualification | Not Tested |
| Physical Android product qualification | Not Tested; hardware access BLOCKED |

Risks: deliberate humanization change stops destructive regeneration, but audible changes need listening; v2 rollback requires original files/upgraded reader; journaling duplicates one previous serialized record and may hit browser quota; storage eviction/power-loss/device behavior and stress CPU/RSS not measured. Longer timelines are exercised for persistence, not proof that1024bars can render under the existing256MiB budget. Recovery metrics must not be presented as Android lifecycle coverage. Main remains unchanged until review/merge. The next engineering prerequisite remains the missing G1 timing/routing/assets/Session contracts; full-song feature work is not declared complete.

## Reproduction command

Create a detached worktree at `f331b709bf17fb68f0b9ae343bfa8c433f43dde0`, install baseline dependencies, copy this branch’s `src/__tests__/g1Recovery.test.ts`, then run `node node_modules/vitest/vitest.mjs run src/__tests__/g1Recovery.test.ts --testNamePattern "rejects wrong-typed|humanization preserves every|keeps new user tracks" --reporter=json --outputFile=reproduction.json`. All3 selected tests fail before these corrections;12 others are skipped deliberately. Run the complete suite on the proposed branch for post-correction evidence.
