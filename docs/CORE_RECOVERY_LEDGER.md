# Core recovery evidence ledger

**Current integrated baseline & G1–G8 strengthening (2 November 2026):**
- Integrated the 5-message attachment (`c6f0edfb` PR10 transport boundaries, `a1840cdd` track lifecycle/note transforms/responsive UI, `7943450f` capability & acceptance ledger, `00b012a8` non-destructive Session matrix, rational/fine grid edits & 10-insert guard, `d1094236` attachment evidence) cleanly against `b871b0de366e677d2f6ae5b2c1ab16df682edb88`.
- Strengthened **G1** (`src/engine/timelineCoordinates.ts` canonical `960 PPQ` integer ticks, tuplets, `1/128` grid snapping, changing meter maps & piecewise tempo maps), **G3** (`src/components/StudioMenuBar.tsx`, `src/App.tsx`, `src/engine/alsXmlEngine.ts` explicit 16-bar Sketch vs 64/128-bar Full Track creation and persisted `creationMode` / `requestedDurationBars`), **G5** (`src/engine/abletonCapabilityMatrix.ts` declared `executable` / `preserved-only` / `converted` / `unsupported` matrix & preflight auditor), **G7** (unqualified `public/apk-metadata.json` preserved fail-closed with visible UI status alert on blocked APK download), and **G8** (authoritative G1–G8 matrix & historical G8 reconciliation in [recovery-contract/ACCEPTANCE.md](recovery-contract/ACCEPTANCE.md)).
- See [Session, precision and insert corrections](recovery-contract/ATTACHMENT_IMPLEMENTATION.md) and [G1–G8 Acceptance & Gate Matrix](recovery-contract/ACCEPTANCE.md). Full gates remain open (`FAIL` / `BLOCKED`).

**Earlier status (2 November 2026):** see [the current contract ledger](recovery-contract/ACCEPTANCE.md). Implementation commit `a1840cdd065962a7644c8d11778590464c518dbc` advances track lifecycle, independent clip tools, UI wiring/layout and project switching. All G1–G8 gates remain FAIL/BLOCKED; G0 full runtime audit remains NOT TESTED. Entries below are historical and must not be read as current release certification.

Contract: Core DAW Recovery and Complete-Track Implementation Contract, supplied 2026-11-02 (Asia/Kolkata).

## Baseline and scope

Refreshed `main`: `31d0974e18ac0038db8a895fcac94e3fca8bfacf`. The supplied review baseline remains current. No AGENTS.md exists in this tree. Read `RECOVERY_IMPLEMENTATION.md` and `docs/audit/*` before changes. Branch: `recovery/core-track-contract`.

This is an incremental project-integrity slice, **not completion of the contract or release qualification**. No renderer, project format, application, or DAW core was replaced. Signing configuration, release metadata, existing binaries and device installation are unchanged. Later slices must not be declared complete on the strength of these tests.

## Existing paths and remaining defects

| Area | Existing path | Status / next dependency |
| --- | --- | --- |
| Startup / New Project / templates | `App.tsx` state initializer, menu `onNewProject`, `handleLoadStarterTemplate` → `buildStarterAbletonXml` | Still defaults to 16 bars; shared persisted seed/version/style/duration song identity is not implemented by this slice. |
| Composition | `compositionIntelligenceEngine.ts`: conditioned layers, form plan, section proposal, range tools | Existing shared form retained. Full-track harmonic development, asynchronous layer development, audible transition qualification and 100-seed actual UI gate remain open. |
| Ordinary editing | `StudioCommandBus.executeMutation`, timeline note/clip commands; `syncTrackClipsToXml` | Changed clip state is synchronized before history publication; targeted native reconciliation replaces reconstruction here. Other App setters and the legacy name/archetype-based `syncTrackNotesToXml` still bypass this boundary. The entire integrity gate is therefore OPEN. |
| Playback / WAV | `webAudioSynth.ts`: live scheduler, shared `scheduleTrackVoiceAtTime`, continuous offline graph | Existing renderer retained. Browser regressions passed; long-song memory, routed sidechain, independent loudness/true-peak measurement and physical-device behavior remain open. |
| Mastering | `masteringEngine.ts` stage A–E, shared offline rendering | Existing short mastering browser check passed; not independent loudness certification. |
| Native ALS save | `compressXmlToAlsBlob`, retained `rawXmlModified`; queue `compileRehumanizedAlsXml` | Import now retains exact input XML text. Queue compilation still performs explicit rehumanization and requires separate preservation review. |
| Project persistence | `ProjectQueueService` → IndexedDB and working state | Existing mechanism retained. Failed clip mutations do not publish to history/queue. Full persistence/reload and all legacy setters remain to be qualified. |
| Session | `App.tsx.handleLaunchSessionScene` | Still rewrites arrangement content: OPEN defect. No Session safety claim. |
| Media | ALS parser, audio analysis/preview and shared renderer | Audio media resolution, decoding, warp and export fidelity remain unqualified. |
| Devices / racks | library definitions, `channelStripEngine.ts`, `webAudioSynth.ts` inserts | Boolean support inventory remains; `slice(0, 10)` still silently truncates inserts. Explicit capability states and rack routing/macros are OPEN. |
| Android / release | Capacitor → `FileExportPlugin.java`; Gradle; `verify-apk.py`; release policy | Java prerequisite probe now fails within 2 seconds. Exact candidate build, signing lineage, upgrade and device matrix remain OPEN. No release published. |

## Requirement → failure → correction → evidence

| Requirement | Reproduced baseline failure / root cause | Changed files | Regression and result | Remaining limitation |
| --- | --- | --- | --- | --- |
| Exact target IDs | Missing clip fell back to first clip; synthetic track IDs selected by position; duplicate clip identities accepted | `alsPatchEngine.ts` | Missing/ambiguous track and clip tests; passing | Patch addressing applies to represented tracks/clips; broad Live-version fixture qualification remains open. |
| Scoped note IDs | Velocity lookup searched the whole document, modifying a different track when note IDs repeated | `alsPatchEngine.ts` | Fixture reuses clip and note IDs across tracks; only addressed note changes; passing | Automation ownership needs its own model and fixtures. |
| Atomic invalid edits | NaN/Infinity/bad bounds accepted; missing mixer nodes silently ignored; command state could diverge from XML | patch engine, command bus, App command error display | Invalid inputs fail without XML result; command failure leaves input/history unchanged; passing | Not all older App setters are routed through the bus. |
| Native preservation | Ordinary sync deleted/recreated all clips, IDs, envelopes and opaque metadata | `alsXmlEngine.ts` | Existing clip/note/device/other-track metadata preserved; split and duplicate clone their source node; idempotent resync/reimport; passing | Structural fixture is synthetic, not a licensed Live-produced compatibility corpus. Consolidation of heterogeneous native clip envelopes is not certified. |
| Non-destructive trim | Resize discarded notes outside the new bounds; parser inflated short clips to four beats | composition and XML engines | Trim → save/reimport → extend restores notes and exact one-beat length; passing | Current model uses arrangement-absolute note times. Source-relative native loops, slip offsets, repeated loops and note tails still require consistent modeling. |
| No resurrection during consolidation | Consolidator copied hidden notes outside each source clip's audible bounds | composition engine | Trimmed hidden content stays silent when consolidated; passing | Mixed loop/slip/automation consolidation remains unqualified. |
| Predictable short duplication | Duplicate forced a minimum four-beat length | composition engine | One-beat clip duplicates at its exact end; passing | Native complex-clip routing/ID-reference remapping needs real fixtures. |
| Untouched native round-trip | Import stripped namespace declarations (unbound extensions) and pretty-printed whitespace-sensitive content | XML engine | Exact source XML retained with namespaced `xml:space` content; passing | Some older XML helpers still strip namespaces or rebuild subtrees. |
| Real mixer destination | Generated starter tracks had no Mixer destinations; old patch falsely returned success | XML starter builder | Existing TC-ALS-003 passes with real generated destinations; missing requested imported destination fails | Full mixer persistence and audible sends/groups validation remain open. |
| Bounded prerequisite check | This machine's `javac -version` hung; unbounded synchronous check stalled the complete test suite | build script, release tests | Minimal process timed out after 5,024 ms; added 2-second probe deadline; mocked timeout regression and full suite pass | Probe availability does not prove JDK compatibility or APK validity. |

New native clip/note nodes receive numeric IDs while existing public generator identities are retained in optional `Data-AIDAW-LogicalId` attributes. Import reads the logical identity, so state and retained XML remain addressable across save/reimport. Existing native IDs and unknown data are preserved. These extension attributes have **not** been validated by reopening in Ableton.

## Runtime and automated evidence

- Windows, Node `25.4.0`, npm `11.7.0`. Several dependencies warn that Node 25 is outside their declared engine range; CI uses the repository's supported Node 22 path. No engine declarations or lockfile were changed.
- Initial new safety suite: **15 failures / 1 pass**, preserved as regression assertions. Further red tests exposed namespaced import, hidden-note consolidation and short duplication.
- Current focused safety suite: **22 tests**, including persisted public clip/note identity addressing. APK verifier Python suite: **12 passing** (Python `3.13.14`).
- Full suite after final code edits and final production build: see final validation entry below.
- Real isolated Chrome `156.0.8078.76`, existing `scripts/recovery-browser-check.mjs`: **PASS**. Eight 4-bar full-effects renders; repeat maximum absolute error ≤ `0.000120879`, RMS ≤ `0.000016382`, under unchanged `0.001` / `0.0001` tolerances.
- 64 bars, seed 777: stereo 44.1 kHz, 24-bit; **5,297,151 frames**, **31,782,950 bytes**, **120.116802721 s** including tails; independently decoded; finite/non-silent audio and final musical quarter audibility passed; **44,487 ms** wall time. SHA-256 `4cf6411c6d27dd0fe4c6240ea290a3de0120691bedfc0f52ebb56e0e6131ce53`.
- Mastering case: 4 bars, stereo 48 kHz / 24-bit, 720,351 frames, 15.0073125 s, independently decoded. Responsive settings passed at 360×640, 900×720, 800×360; stalled-render guard passed.
- Local runtime report/screenshots: `.recovery-evidence/browser/` (ignored; contains actual measurements, not release metadata). Renderer source was unchanged by this slice. Later XML source-retention and clip-lifecycle corrections were unit tested separately; the browser report is not a test of the final commit's every UI handler.
- Qodo executable, managed tools and authenticated notes connection are unavailable. No Qodo review or published Qodo notes are claimed. Manual diff review and automatic regressions are the available review evidence.

## Android qualification

No candidate APK was built, installed or upgraded by this slice. Device identifiers and installed-application discovery details are retained only in ignored local evidence, excluded from this public ledger. No app data was cleared.

The repository wrapper is Gradle 8.14.3 and CI selects Java 21. Exact candidate qualification remains pending a compatible build environment, certificate-lineage verification and the declared on-device matrix. No toolchain migration or replacement signing key was introduced.

## Acceptance status

**Implemented / automatically tested:** the scoped corrections above. **Browser tested:** existing renderer, short mastering and settings checks described above. **Device tested:** discovery only. **Listening reviewed:** none. **Ableton reopening:** none.

No acceptance thresholds were weakened, tests disabled, native DSP tolerances relaxed, or new support/compatibility claims added. Do not infer full-track musical coherence, full project safety, rack fidelity, Android release readiness or Ableton compatibility from this slice. Dependent work remains in the contract's stated order.

## Final local validation

2026-11-02, Asia/Kolkata: `npm test -- --maxWorkers=2 --reporter=dot` **92/92 passing**, 7 files; `npm run lint` **PASS**; final `npm run build` **PASS**. This is the code committed as `38c72e7` (subsequent evidence-only commits do not change implementation). The existing large-bundle warning remains. No existing assertions or test timeouts were relaxed. jsdom emits its existing unsupported-document-navigation notices during download UI tests; those tests are not filesystem-save verification.

The initial baseline suite did not complete until its stalled javac probes were terminated; it then reported the prerequisite test timeout. An intermediate suite also exposed the missing starter Mixer destinations. Those failures were corrected and the final full suite above includes their unchanged assertions.
