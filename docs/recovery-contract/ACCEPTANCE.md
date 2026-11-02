# G1–G7 execution record — 2 November 2026

**Latest implementation:** [attached-review corrections and current evidence](ATTACHMENT_IMPLEMENTATION.md) supersede the Session/precision/insert defects recorded below. This earlier milestone remains historical; the full gates remain open.

**The complete contract is unfinished. No gate is certified by this change.** This record supersedes earlier broad functionality/compatibility claims; prior milestone reports remain historical evidence. Implemented corrections and unimplemented requirements are separated below.

## Source provenance

- Fetched main: `7072a44351b018a67bec7e9dcc571145afe0b0e3`. No open PRs and no tags were returned/fetched at intake.
- PRs 4–9 are ancestors of main. PR10 was merged into `remediation/merge-render-integrity`, not main. Its transport commit `91b9b26fe43548c0068cf7b2c25488a705b6d562` is incorporated here as `c6f0edfb47dcbd521277d3a0fcad22e075035ee1` after reviewing its dependency on PR9.
- New implementation: `a1840cdd065962a7644c8d11778590464c518dbc`, branch `remediation/g1-g7-contract`. Subsequent evidence-only commits do not change implementation.
- Main CI at intake: [41449948775](https://github.com/dejayillegal/aidaw/actions/runs/41449948775), success. PR10 branch CI: [41450002794](https://github.com/dejayillegal/aidaw/actions/runs/41450002794), success. Neither run tests this new implementation.
- No AGENTS.md found. Reviewed `docs/RECOVERY_IMPLEMENTATION.md`, audit documents, M1–M6 reports, ADR001–006, existing regression suites and browser runner. Qodo executable/managed tools are unavailable; no Qodo review or published notes are claimed.

## Implemented requirements and root causes

| Contract | Reproduction / actual defect | Correction / owner | Verification |
|---|---|---|---|
| G1 track lifecycle | Deleted typed track returned on XML reload; reversed track order and changed names were ignored | `alsXmlEngine.synchronizeProjectStateToXml` reconciles represented MIDI/audio tracks, order and names while retaining opaque return/group nodes | `trackLifecycleContracts.test.ts`; deletion, undo/redo, retained return subtree, name/order/device/clip preservation |
| G1 transaction isolation | A mutator returning external state left nested arrays shared with committed output | `commandBus.executeMutation` detaches its complete returned domain before synchronization/publication | New caller-result regression; existing history-isolation tests retained |
| G1 independent clips | Velocity randomizer and quantize rewrote the whole track as its first clip through a legacy name/archetype XML helper | Existing composition module now transforms every Arrangement clip; App commits typed changes through the existing bus | `trackNoteTransforms.test.ts`; two separated short clips, probability, identity, XML reload, undo/redo and other-track/Session isolation |
| G1 deterministic note tools | Velocity randomization depended on note array position | Seed + event identity sampling; validated velocity/blend limits | Reordered note arrays give the same per-note velocities; accent/downbeat exclusions and invalid input tests |
| G1 velocity curve | Only first clip transformed; Arrangement control also modified Session content | Curve applies to all Arrangement clips through the same state transform; Session remains independent | Shared transform tests; dedicated curve UI gesture qualification remains NOT TESTED |
| G1 polymeter edit | Typed replacement was preceded by destructive name-based XML rewriting | Removed redundant XML rewrite from polymeter handler; command projection serializes its typed clips | Existing polymeter/command regressions; dedicated UI qualification NOT TESTED |
| UI command wiring | Quantize button existed in dedicated AI workspace and right dock without its callback | `SoundCraftWorkstation` forwards callback in all three composer placements | Real Chromium failed before wiring with unchanged note times, then passed through the visible dedicated workspace |
| Responsive UI | 360px shell had a 682px implicit grid column; action width574px and x−214 after scrolling | Explicit `minmax(0,1fr)` shell column; composer wrapping and narrow/coarse-pointer touch controls | Real browser action bounding boxes and screenshots at360×640,900×720,800×360,1440×900 |
| Errors/progress | Project save/open, ALS export and WAV-render failures were hidden in desktop-only status text | Visible alerts for these errors; compact ordinary status announcements | Four red alert regressions then five passing cases; actual mobile screenshots retained |
| G1 project switching | Reopen stopped playback and set UI cursor0 but audio clock retained beat0.6436 in reproduction | Native/open/new/queue installation resets engine ownership and cursor; ALS installs only after validated enqueue; shared request revision rejects older load completions | Native browser visible Play→clock advancement→Open→engine stopped at exactly0; concurrent import races remain NOT TESTED |
| G1 transport integration | PR10 absent from main | Incorporated reviewed pause/seek/tempo/end correction rather than reimplementing it | Nine transport tests plus native transport case; full regression |

Legacy migration here removes the first-clip/name-based path from velocity randomization, quantize and polymeter. It does **not** remove every legacy generator/XML helper or reconstruct the entire interface.

## Real UI journey evidence

`scripts/track-workflows-check.mjs` creates a reproducible two-track/two-clip native fixture, opens it through the actual file input, selects the visible AI Composer workspace, randomizes velocity, quantizes both clips, checks one command per action, uses keyboard undo/redo, downloads a native file through File→Save, starts playback through the visible Play button, reopens the file, reloads the application and reopens again. Canonical queue/engine state is inspected read-only as the assertion oracle; edits are made through UI controls. It checks action reachability across four sizes and takes screenshots.

The runner is integrated into the existing CI browser suite. This journey passed locally in native Chromium153.0.8010.0. It does not verify note pointer gestures, every control, real Android touch, recording, Session launch, or all device workflows.

`node scripts/inventory-ui-controls.mjs OUTPUT.json` inventories332 native JSX controls and25 component callback boundaries. The generated artifact contains owner module, line, entry label, handlers/dependency candidates, expected/actual behavior, evidence, coverage and status. Every statically discovered item is **NOT TESTED** until separately qualified; conditional/dead controls are deliberately not assumed reachable. The inventory is uploaded with CI browser evidence. Complete command/audio/persistence traceability is still open.

## UI authority and obsolete-flow audit

No reviewed/approved design specification was identified in the repository. Current component structure and the captured runtime screens form an **observed implementation baseline**, not an approved replacement design. A complete redesign must establish/review that baseline before deleting supported entry points.

| Item | Disposition | Remaining work |
|---|---|---|
| StudioMenuBar / Transport / WorkspaceTabs / Workstation | ACTIVE | Complete keyboard, accessibility, lifecycle and per-control traceability |
| Composer callback placements | MIGRATE — corrected three placements | Dedicated workspace runtime tested; other placements need visible-control qualification |
| Velocity/randomizer/quantize legacy XML edits | REMOVE — removed from those handlers | All-clip typed transformations now canonical |
| `App.syncTrackNotesToXml` | MIGRATE | Still used by generation; strips namespace declarations and selects by name/archetype. No overall legacy-elimination claim |
| Scene→Arrangement replacement | RETAIN FOR COMPATIBILITY | Explicitly labelled replacement; must remain separate from future actual Session launch |
| Session workspace / TouchJamPads | ACTIVE, incomplete | Current surface is pads; independent Session transport/recording is missing |
| XML and Python reference views | RETAIN FOR COMPATIBILITY pending reachability audit | Do not remove engine/import functionality on the basis of reference-view styling |
| Header/status/docks | MIGRATE — partial | Shell width and error visibility corrected; duplicate/obsolete handler audit and focus/dialog audit remain open |
| Old `docs/audit/*` “100% compatible” claims | RETAIN AS HISTORICAL, superseded | They are not current support or acceptance evidence |

## Capability inventory and remaining implementation

“Owner” denotes source responsibility, not an assigned human reviewer. Unless a row explicitly names executed evidence, actual end-to-end behavior is unqualified. `ui-controls.json` is the per-control source index.

| Capability / owner and entry point | Dependency / expected behavior | Actual evidence and coverage | Status |
|---|---|---|---|
| Canonical history — App→commandBus→XML | Every edit validates once, one history entry, exact persistence | Corrected edit subset covered; all commands/locks/routing not qualified | FAIL |
| Notes/expression — TimelineCanvas→App→composition/XML | Correct clip/note IDs, velocity/probability/expression and edit undo | Existing identity/probability tests plus new all-clip transforms; expression/gesture matrix missing | NOT TESTED |
| Track create/delete/reorder/name — command bus→XML | Represented state survives serialization and undo | Synthetic integration fixtures pass; full visible track-management flow absent | NOT TESTED |
| Mixer/master/VCA — MixConsole/DeviceRack→bus→audio | Audible controls, routing, undo and reopen | Existing unit/integration coverage; full live audio/persistence journey missing | NOT TESTED |
| Timing — timelineCoordinates/webAudioSynth/ALS | Integer PPQ, tempo/meter maps, bar conversion everywhere | Absolute beats and scalar tempo remain; transport boundaries corrected | FAIL |
| Extent/loops/seek — toolbar/transport→engine | Exact fractional boundaries and validated resource limits | Boundary/loop tests; App still clamps extent4–1024 and live engine minimum16beats | FAIL |
| Session — workspace/scene controls→App | Independent slots, quantized launch/stop/retrigger, record to Arrangement | Existing handler replaces Arrangement; not true Session | FAIL |
| Native save/open — menu→snapshot service→queue/SAF | Versioned exact supported-state restore | v1/v2 migration and actual browser download/reopen pass; assets not embedded | NOT TESTED |
| Atomic recovery — queue→IndexedDB journal | Failed writes preserve old revision; corrupt/future handling | Native Chromium20cycle4096note/1024bar stress, corrupt fallback/future refusal pass; device interruptions missing | NOT TESTED |
| Media manifest/recovery — import/snapshot | Asset integrity, missing-file relink and large media recovery | Referenced assets remain external; manifest/relink lifecycle incomplete | FAIL |
| Queue operations — BulkQueue→queue→bus | Isolated settings/history and safe project switching | Existing isolation tests; new switch boundary correction; concurrent/bulk full UI matrix incomplete | NOT TESTED |
| Playback/offline — transport/export→shared graph | Same events/DSP/timing; long stable operation |20repeat PCM and probability oracle pass; captured live/offline comparison absent | NOT TESTED |
| Long export — export→OfflineAudioContext→encoder | Bounded memory without shortening/degradation |256MiB preflight remains;64bars pass; no bounded-memory long-export solution | FAIL |
| DSP measurements/listening — renderer/mastering | True/sample peak, DC, correlation, dynamics, spectrum and producer acceptance | Sample peak/finite/non-silent/duration/repeat checks only; broad measurements/listening absent | NOT TESTED |
| Android SAF — export service→FileExportPlugin | Chunked write/cancel/cleanup/read-back/external playback | Existing tests and native implementation retained; no hardware access | BLOCKED |
| Music intelligence — AI composer→compositionIntelligenceEngine | Hierarchical harmony/motifs/role development, seeded replay | Existing generator retained; full pipeline/200 actual rendered projects missing | FAIL |
| Full Track — File→New Project→generator | Separate Sketch/Full Track, configurable duration and evolving layers | New Project remains16bar sketch; full-track UI/pipeline incomplete | FAIL |
| Instruments/samplers — DeviceRack→shared graph | Executable supported synthesis and loaded media | Procedural archetypes exist; general sampler/instrument parity absent | FAIL |
| Effects — library/mix inserts→webAudioSynth | All advertised parameters/reorder/bypass affect live/offline processing | Existing browser approximations; live insert rebuild/parameter coverage incomplete; `.slice(0,10)` remains | FAIL |
| Sends/returns/groups/sidechains — mixer/ducking→engine/XML | Correct signal graph and serialized routing | Existing app subset, no full native routing/audio qualification | NOT TESTED |
| Racks/macros/packs — library→engine/XML | Reversible controls tied to actual executable devices | General rack/proprietary execution not implemented; arbitrary native XML preservation does not execute it | FAIL |
| Audio tracks/editing — import→track model→render | Resolve/decode/edit/mix imported audio correctly | End-to-end media engine/workflow not qualified | NOT TESTED |
| Automation/modulation — timeline/devices→bus→shared graph | Parameter-typed timing, record/edit/play/export/reopen | Normalized app energy lane exists; native automation retained opaque, general execution missing | FAIL |
| MIDI files — clip export→midiFileExporter | Supported import/export with event identity/timing | Export tests exist; full MIDI import workflow not qualified | NOT TESTED |
| ALS — menu/import→XML patch engine | Real versioned fixtures and supported semantic round trips | Synthetic preservation/identity tests only; Live runtime/authored corpus missing | BLOCKED |
| Templates/shortcuts/tools — menus/keyboard→App | Reachable, correct, undoable where applicable | Existing tests plus new undo/redo journey; whole control matrix unqualified | NOT TESTED |
| Stem/batch export — queue/mixer→renderer | Isolated full-length stems, cancellation, file integrity | Existing queue services; complete actual UI/output matrix unqualified | NOT TESTED |
| Comping/strip silence/markers — command palette→bus | Correct editable selections, playback and save | Existing unit tests; audio/media/pointer and full workflow evidence incomplete | NOT TESTED |
| AI director/arrangement/harmony/groove — composer→engine | Structured previewable scoped validated commands | Partial deterministic tools and external request exist; unified plan/preview contract missing | FAIL |
| AI sound design/mix/master/NL — assistant→commands→audio | Supported devices only, reproducible reversible plans, measured analysis | No complete qualified command-plan workflow for requested capabilities | FAIL |
| Responsive/accessibility — all workspaces | Phone/tablet/landscape/foldable,44px touch, focus/dialogs | Tested action/settings sizes only; full interaction/accessibility/hardware matrix absent | NOT TESTED |
| Android install/upgrade/lifecycle/performance — native shell | Exact APK, trusted lineage, physical sustained tests | No adb/physical hardware, no newly built/qualified candidate | BLOCKED |
| Commercial release — policy/CI/owner | All gates, signing, security, licensing, owner acceptance | Upstream engineering gates incomplete; no release published | BLOCKED |

VST3/AU/Max for Live hosting and arbitrary proprietary Pack execution are **unsupported**. Browser procedural approximations and XML preservation are not native-device compatibility. No real Live10/11/12 interoperability certification is claimed.

## Local evidence and reproduction

Runtime: Node24.22.1/npm11.9.0; CI retains Node22/Java21. Standard Playwright download failed (truncated archive). Isolated @sparticuz/chromium153.0.0 supplied native Chromium153.0.8010.0; Brotli resources were extracted locally after the package extractor's chown failure. No browser runtime dependency or lockfile was added to the app.

- Baseline main:152/152 tests and TypeScript PASS.
- Final implementation:173/173 tests across20files; TypeScript PASS; Vite production build PASS with existing large-chunk warning; Python APK-verifier12/12 PASS.
- Final native browser suite PASS:20 identical short full-effects WAVs (max/RMS PCM difference0 at unchanged0.001/0.0001 thresholds);64bar continuous export;48kHz mastering; probability oracle44.1/48kHz; native transport; real IndexedDB recovery; new visible-control workflow; settings sizes; timeout guard. No page/console errors recorded.
-64bars:5,297,151frames,31,782,950bytes,stereo44.1kHz24bit,120.116802721s including8s tail; sample peak0.88032186; last musical quarter peak0.87529016; SHA256`7be7aadb401e615e30a8c61ff466eed2c23d4e72d706d7d67a55ddd3fea7886b`.
- Four-bar mastering:48kHz24bit,720,351frames,15.0073125s; sample peak0.87788212; SHA256`2dc9f42cdcf0d429b0954891cf15251e77552b8996e32fb6e40ed51613459637`.
- `npm audit --omit=dev`:4moderate,0high/critical findings, in the Capacitor CLI→rimraf→glob/minimatch chain. No forced major downgrade was applied. Complete build/runtime dependency and license approval remains open.
- This environment exposes Java but no adb/javac/Android SDK. No physical-device build/install/upgrade/listening or release signing result is fabricated.

Exact local logs, machine measurements and audit response are in `evidence/`. Screenshots, generated native project and full static UI inventory are in ignored `.recovery-evidence/` and produced in CI artifacts. These are browser checks, not hardware qualification.

```sh
npm ci
npm run lint
npm test -- --maxWorkers=2 --reporter=dot
python3 -m unittest discover -s scripts -p 'test_*.py'
npm run build
node scripts/inventory-ui-controls.mjs recovery-browser-evidence/ui-controls.json
# Install Playwright and its browser as the existing CI workflow does.
RECOVERY_BROWSER_OUTPUT=recovery-browser-evidence node scripts/recovery-browser-check.mjs
```

## Outstanding external qualification procedures

Physical Android owner: use the exact CI artifact with verifier JSON and SHA256. Record device serial privately, model, OS/build, APK SHA256, certificate digest, install/upgrade path, project seeds/settings and test durations. On a designated test device, perform fresh installation and upgrade without replacing the trusted key; retain installed-app data during upgrade. Run all required create/edit/play/save/reopen/export/cancel/SAF permission/interruption/rotation/foldable/background/memory-pressure scenarios through touch controls. Exercise at least short, medium and maximum-supported projects and a sustained session. Capture screen recordings, logcat/audio capture, timing, `dumpsys meminfo`/CPU samples, exported file size/hash and independent external-player decode/playback. Verify cancelled writes leave no accepted final file and previous projects survive. Report failures; an emulator is supplementary evidence only.

Interop owner: create licensed Live10/11/12 fixtures with exact application versions, tempo/meter changes, fractional/looped clips, native expression, unknown devices, automation, groups, returns, sidechains and referenced audio. Hash originals; import/export/reimport via visible UI; compare declared supported state/opaque preservation; open exported files in the corresponding Live version; listen/render and compare within declared boundaries. Keep native diagnostics. Do not call a synthetic XML fixture Live-authored evidence.

Music/producer owner: after G1/G4 prerequisites, generate200 complete editable projects covering recorded seeds/styles/keys/tempos/durations, save and reopen all, render all, calculate defined harmony/voice-leading/occupancy/motif/arrangement/audio diversity and failure metrics. Randomize listening order for independent producer assessment; retain rubric, reviewers, actual ratings and defects. Section plans or unrendered MIDI do not satisfy this evaluation.

Release owner: qualify the final production APK separately from debug CI; verify signing lineage, migrations and upgrades, security/license decisions, every mandatory gate and explicit owner acceptance. Current debug build success must not promote release metadata.

## Authoritative G1–G8 Gate Matrix & Historical G8 Reconciliation

### Reconciliation of Historical G8 Meanings

Historical recovery prompts and pasted review assets assigned incompatible meanings to `G8`. To ensure zero requirements are dropped, every historical `G8` meaning is explicitly preserved and mapped to its authoritative gate owner below:

| Historical G8 Meaning | Authoritative Gate Owner | Code Owner & Entry Point | Verification & Current Status |
|---|---|---|---|
| Novelty, seed diversity & anti-clone validation | **G2** (Musical Intelligence & Novelty) | `src/engine/compositionIntelligenceEngine.ts` (`composeProjectConditionedLayerNotes`, `NoveltyValidationMetrics`) | Unit/seed novelty checks pass; 200-project rendered corpus + independent producer listening remains `FAIL` (pending external listening review) |
| AI Composer & intelligent transformation tools | **G2** & **G8** (AI Composer Studio & UI Workflows) | `src/components/AiComposerIntelligencePanel.tsx`, `src/App.tsx` | All-clip velocity randomizer, quantize strength (50/75/100%), polymeter, and chord/grid transforms wired & tested (`trackNoteTransforms.test.ts`); full AI command-preview pipeline remains `FAIL` |
| Non-destructive length & 16/64/128-bar Full Track | **G1** & **G3** (Timeline Extent & Full-Track Arrangement) | `src/engine/alsXmlEngine.ts`, `src/App.tsx` (`handleLoadStarterTemplate`, `handleChangeArrangementLength`) | Non-destructive extent resize (`reviewedDefects.test.ts`) + explicit Sketch (16B) vs Full Track (64B/128B) with persisted `creationMode` & `requestedDurationBars` (`g1ToG8Strengthening.test.ts`); full multi-genre song qualification remains `FAIL` |
| Stable responsive UI, unfolded/mobile layouts & visible alerts | **G8** (Functional UI & Workflow Qualification) | `src/App.tsx`, `src/components/StudioStatusBar.tsx`, `src/components/StudioMenuBar.tsx`, `src/components/DiagnosticsPanel.tsx` | `minmax(0,1fr)` shell, `role="alert"` error visibility (`criticalStatus.test.tsx`), APK download error reporting, and static UI control inventory (`scripts/inventory-ui-controls.mjs`); per-control runtime matrix remains `FAIL` |
| Timeline editing, Grid/Slip/Shuffle/Spot & clip identity | **G1** (Canonical State, Timing & Editing) | `src/services/commandBus.ts`, `src/engine/timelineCoordinates.ts`, `src/engine/alsPatchEngine.ts` | Exact rational/fine grid (`1/3`, `1/128`), canonical `960 PPQ` tick/meter/tempo map helpers (`g1ToG8Strengthening.test.ts`), and non-destructive trim/split/duplicate/consolidate (`coreRecoverySafety.test.ts`) pass; full consumer migration remains `FAIL` |
| Audio playback, transport boundaries & offline WAV parity | **G1** & **G4** (Transport & Shared Audio/Export Engine) | `src/engine/webAudioSynth.ts`, `src/engine/masteringEngine.ts` | PR10 transport boundary fixes (`transportBoundaries.test.ts` 9/9 PASS), 10-insert guard (`INSERT_LIMIT`), and 20-repeat PCM determinism pass; bounded-memory >256MiB export remains `FAIL` |

### Authoritative Current G1–G7 (and G8 UI Qualification) Gate Ledger

> **Note:** The table below is the **single authoritative current status matrix** for the repository. Earlier tables in this file (`Implemented requirements and root causes` and `Capability inventory` from commit `a1840cdd`) are retained strictly as historical milestone provenance and are superseded wherever they refer to pre-`00b012a8` / pre-`a2005192` Session, `.slice(0, 10)`, or 16-bar-only starter defaults.

| Gate | Requirement Scope | Primary Code Owners | Automated & Browser Verification | Threshold / Acceptance Criteria | Dependencies | Status |
|---|---|---|---|---|---|---|
| **G0** | Baseline Repository, Lockfile Reproducibility & Capability Audit | `package.json`, `package-lock.json`, `docs/recovery-contract/*`, `scripts/inventory-ui-controls.mjs` | Real clean `npm ci` in isolated directory (`added 671 packages, audited 672 packages`), `npm run lint`, Vitest suite (23 files, 209 tests), static control inventory JSON | Reproducible `npm ci` lockfile parity (`esbuild@^0.28.2` + all 24 `@esbuild/*` platform entries, Node `>=22.12.0` / npm `>=10.0.0`), authoritative 10-slot constant (`MAX_CHANNEL_INSERT_SLOTS = MAX_EXECUTABLE_INSERT_DEVICES = 10`), and static UI control inventory generated without silent exclusions | None | **NOT TESTED** (Clean `npm ci` lockfile installation and static inventory pass; full runtime per-control qualification open) |
| **G1** | Canonical Project State, Transactions, Ticks/PPQ (`960`), Tempo/Meter Maps, `MusicalTimeService`, Transport & Session | `src/types/ableton.ts`, `src/engine/timelineCoordinates.ts`, `src/engine/projectStateContracts.ts`, `src/services/commandBus.ts`, `src/engine/webAudioSynth.ts`, `src/components/SessionMatrix.tsx` | `src/__tests__/transportBoundaries.test.ts` (9/9), `src/__tests__/sessionPerformance.test.ts`, `src/__tests__/reviewedDefects.test.ts`, `src/__tests__/trackLifecycleContracts.test.ts`, `src/__tests__/g1ToG8Strengthening.test.ts` (16/16) | Zero transport drift, atomic command history, non-destructive Session launch/capture, validated PPQ (`SUPPORTED_PPQ_RESOLUTIONS`), final-bar `4096` exclusive end boundary (`16380..16384`), logarithmic `60/BPM` tempo-ramp integration ($4\ln 2$) with `Math.log1p`/`Math.expm1`, continuous meter-map validation, unified `MusicalTimeService`, and ALS XML map round-trip | G0 | **FAIL** (Core transport, Session, rational grids, `MusicalTimeService`, logarithmic tempo integration, meter continuity, and XML map persistence pass; variable-tempo/meter live/offline DSP scheduling and audio-clip Session remain open) |
| **G2** | Musical Intelligence, Harmonic/Motif Development & Seed Diversity | `src/engine/compositionIntelligenceEngine.ts` | `src/__tests__/recoveryContracts.test.ts`, `src/__tests__/trackNoteTransforms.test.ts`, `src/__tests__/parametricAlsV7.test.tsx` | Deterministic seed replay, cross-seed structural/harmonic diversity, 200 rendered projects + blind producer listening | G1, G4 | **FAIL** (Deterministic transforms & novelty metrics pass; 200 rendered projects + human producer listening review not yet executed) |
| **G3** | Complete-Track Workflow (Explicit Sketch vs Full Track & Persisted Duration) | `src/components/StudioMenuBar.tsx`, `src/App.tsx`, `src/engine/alsXmlEngine.ts` | `src/__tests__/g1ToG8Strengthening.test.ts`, `src/__tests__/trackNoteTransforms.test.ts` | Explicit Sketch (16B) vs Full Track (64B/128B) creation, persisted `creationMode` & `requestedDurationBars`, section-differentiated clips & locked-track protection | G1, G2 | **FAIL** (Sketch vs Full Track creation, persisted duration, and section clip decomposition pass; full 200-song audible transition qualification open) |
| **G4** | Shared Live/Offline Audio Engine, Preflight State Isolation, Emergency Shutdown, Instrument/Insert Separation, Live Reconciliation & Master WAV Export | `src/engine/webAudioSynth.ts`, `src/engine/masteringEngine.ts`, `src/engine/channelStripEngine.ts`, `src/engine/abletonCapabilityMatrix.ts` | `src/__tests__/orderedAudioSum.test.ts`, `src/__tests__/reviewedDefects.test.ts`, `src/__tests__/studioWorkstation.test.ts`, `src/__tests__/g1ToG8Strengthening.test.ts`, `scripts/recovery-browser-check.mjs` | Preflight validation before replacing `this.project`, coordinate-independent `emergencyShutdown`, instrument-vs-insert separation (`resolveTrackInstrumentSynthesis`), executable `MidiChord`/`MidiArpeggiator` + converted insert DSP (`DrumBuss`, `Reverb`, `HybridReverb`, `AutoPan`, `Erosion`), live parameter/structural channel reconciliation, explicit 10-slot `INSERT_LIMIT`, bit-accurate 20x repeat renders, 64-bar continuous WAV export | G1 | **FAIL** (Preflight state isolation, emergency shutdown, instrument/insert separation, live graph reconciliation, 10-insert guard, repeatability, and 64-bar export pass; bounded-memory >256MiB segmented offline render and captured live-vs-offline parity open) |
| **G5** | Ableton Live (.ALS) Lossless Preservation, `ABLETON_DEVICE_REGISTRY` & Per-Instance `DeviceConversionRecord` | `src/engine/alsXmlEngine.ts`, `src/engine/alsPatchEngine.ts`, `src/engine/abletonCapabilityMatrix.ts` | `src/__tests__/projectMutationSafety.test.ts`, `src/__tests__/trackLifecycleContracts.test.ts`, `src/__tests__/g1ToG8Strengthening.test.ts` | Shared `ABLETON_DEVICE_REGISTRY`, per-instance `DeviceConversionRecord` with hash invalidation (`CONVERSION_REQUIRED`), separate `canExecuteFaithfully` vs `canRenderApproximation`, untouched XML namespace/subtree preservation, licensed Live 10/11/12 reopen | G1 | **BLOCKED** (Enforced `ABLETON_DEVICE_REGISTRY`, `DeviceConversionRecord` validation, and synthetic XML preservation pass; licensed Ableton Live 10/11/12 application corpus & reopen unavailable in container) |
| **G6** | Android Native Shell, SAF Chunked Export, Foldable/Mobile Lifecycle | `android/app/src/main/java/com/parametricals/technodaw/FileExportPlugin.java`, `src/services/fileExportService.ts` | `src/__tests__/fileExportService.test.ts`, `scripts/test_verify_apk.py` (12/12) | Real-progress SAF chunked export, cancellation cleanup, physical Android install/upgrade/rotation/foldable stability | G4 | **BLOCKED** (SAF export service & verifier tests pass; physical Android hardware and Android SDK/adb unavailable in this environment) |
| **G7** | Commercial Release Provenance, Signing Lineage & Build Qualification | `scripts/verify-apk.py`, `public/apk-metadata.json`, `src/utils/apkDownloader.ts` | `src/__tests__/releasePublication.test.ts`, `src/__tests__/apkAndUiAutomation.test.tsx`, `scripts/test_verify_apk.py` | Unqualified APK metadata remains `"unqualified"` until verified by a certificate-pinned Gradle build; visible UI alert on blocked download | G1–G6 | **BLOCKED** (G7 fail-closed metadata and UI alert verification pass; production signing key & upstream gates G1–G6 remain open) |
| **G8** | Complete Functional UI, Control Inventory & End-to-End Workflow Qualification | `src/components/*`, `scripts/inventory-ui-controls.mjs`, `scripts/track-workflows-check.mjs` | `src/__tests__/criticalStatus.test.tsx`, `src/__tests__/sessionPerformance.test.ts`, `scripts/inventory-ui-controls.mjs` | Every visible control inventoried and bound to canonical commands or explicitly gated; responsive 360×640 / 900×720 / 800×360 / 1440×900 layouts | G1–G7 | **FAIL** (Responsive shell, visible `role="alert"` error banners, Session UI, and static control inventory pass; per-control runtime qualification of all 343 controls remains open) |

The required final full-song→edit→mix→save→reopen→play→WAV→ALS→reimport journey has **not** passed in full. No production-ready APK or complete Ableton parity is delivered by this milestone.

