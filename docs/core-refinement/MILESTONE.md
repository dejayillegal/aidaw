# Milestone 1 — Baseline and incremental project/clip safety

Baseline: `31d0974e18ac0038db8a895fcac94e3fca8bfacf`. Corrective commit: the commit containing this report. This is not full core completion or release approval.

## Root causes, reproduction and traceability

| ID / requirement | File and function | Reproduction; expected vs baseline actual | Correction / regression | Result |
|---|---|---|---|---|
| C01 / §2.2,3.3 | alsXmlEngine.ts: parseAbletonXmlDom | Add Session clip ending beat8000 beside4-bar Arrangement clip. Expect one Arrangement clip/4 bars; parser included both/extended song | Scope Arrangement selectors; synthetic Session fixture retains raw slot | PASS |
| C02 / §3.4 | same parser | Round-trip0.5-beat clip in one-track project. Expect0.5 beats/1 bar; baseline4 beats/16 bars | Remove clip/project floors; short-project fixture | PASS |
| C03 / §6 | injectMultipleMidiClipsXmlNodes | Rename/sync retained clip with opaque XML. Expect stable identity/probability/metadata; baseline assigns5000 and drops metadata/probability | Match retained clips/notes, clone opaque state, retain IDs/probability; repeated-sync fixture | PASS subset |
| C04 / §4.7,6 | both clip injectors | Generate clips across tracks and replay starter seed777. Expect unique/stable XML IDs; baseline duplicates5000 or uses Math.random | Single injector delegates to existing serializer; document-aware numeric allocation; deterministic replay fixture | PASS |
| C05 / §2.2 | syncTrackClipsToXml | Sync malformed XML/missing track. Expect explicit error; baseline returns stale XML as success | Reject malformed source, missing target, duplicate identity, invalid MIDI/extent before mutation | PASS |
| C06 / §3.4,6 | parser, multi-clip serializer | Round-trip fine timing and180 notes across3 pitches. Expect grid/onset/duration fidelity and unique NoteIds; baseline rounds3 decimals/collides after50 notes | Exact float strings, persisted grids, unique per-clip IDs; mixed-length test uses1e-10-beat extent tolerance | PASS |
| C07 / §2.2,7 | App.tsx: initial state, handleLoadStarterTemplate, New callback, enrichProjectWithAnalysis; ableton.ts; starter builder | Mute outgoing project, File→New. Expect fresh history/control state; baseline replaces only project under previous queue/seed/transport | Reuse starter handler, preserve outgoing state, activate new queue identity, reset transport/master/selection, persist seed; actual App integration | PASS jsdom |
| C08 / §3.2 | App.tsx: handleInjectAllMissingLayers | Compose suite. Expect section clips in editor/XML; baseline flattens layers into one clip | Existing decomposition/serializer and undo command; App→XML→parse→undo/redo integration | PASS jsdom |
| C09 / §3.4,5.4 | webAudioSynth.ts: synthesizeProjectToStereoFloatBuffers | Request1024 bars. Expect resource rejection rather than hidden256-bar validity limit | Remove256-bar check; retain256MiB preflight; fixture expects RENDER_MEMORY before allocation | PASS preflight |
| C10 / §5.3,11 | App.tsx: ALS export status; StudioMenuBar.tsx | Export claimed100% Live compatibility without Live verification | Explicit compatibility caveat and generic New Project menu label | PASS inspection |
| C11 / §2.2,3.2 | App.tsx: handleFileUpload, handleInjectAllMissingLayers | Import mixed audio/MIDI project then compose. Expect outgoing snapshot and identical active editor/queue state, preserved audio tracks; import passed incoming state as outgoing snapshot and composition re-parsed/rewrote unrelated tracks | Save correct outgoing project, update active queue with enriched editor state, restrict MIDI serialization and preserve audio/locked track state; actual mixed-project UI fixture checks exact audio state and undo | PASS jsdom |

Tests: `coreRefinement.test.ts` adds9 targeted contracts. Existing real-App jsdom integration in `apkAndUiAutomation.test.tsx` now verifies mute retention across New Project, isolated history, section clips, mixed audio/MIDI import preservation, serialized identity/boundaries/note counts and undo/redo. Initial targeted run reproduced5 failures/1 pass; later fine-timing and replay tests exposed precision loss and unseeded identity before correction. Existing tests remain intact. Extended UI sequence has a20-second timeout because it now runs two generations and XML/history checks, rather than the former mount-only workflow.

## Compatibility matrix

| Capability | Classification | Limits |
|---|---|---|
| Browser procedural voices/supported inserts | Native browser implementation | Shared live/offline graph; not identical Ableton DSP |
| ALS Arrangement MIDI subset | Partial interpretation | Synthetic IDs/timing/grid/probability/boundary tests |
| Unknown track/device XML | Imported state preservation | Raw XML retained; no universal playback claim |
| Retained clip attributes/direct children and matched note structures | Partial state preservation | Opaque clip fixture; unrelated Notes/KeyTracks expression containers still need coverage |
| Session storage | State preservation | Excluded from Arrangement scheduling; launch/record/return behavior unverified |
| Audio assets, nested groups, arbitrary automation, routing, tempo/meter changes | Partial/unverified | Representative Live fixtures and canonical map semantics required |
| VST3/AU/Max for Live/proprietary Packs | Unsupported hosting | Separate hosting/licensing/platform work required |
| Streaming native renderer/full device fidelity | Planned | No implementation or delivery date asserted |

## Gates and required evidence

| Gate | Status | Evidence / missing work |
|---|---|---|
| G0 | PASS | BASELINE.md: inventory, diagrams, current canonical contract/state owners, executable baseline and reproducible defects |
| G1 | FAIL | Corrected subset passes; integer ticks/tempo/meter maps, full undo coverage, routing/automation/persistence consistency remain incomplete |
| G2 | NOT TESTED | No200-project corpus, occupancy/motif diversity study or listening approval |
| G3 | NOT TESTED | Full-song form/endings/contrast/duration qualification remains |
| G4 | BLOCKED | Chromium unavailable; download returned invalid archive. Existing real Web Audio CI check retained; no fresh local PCM/parity/listening evidence |
| G5 | FAIL | Synthetic subset passes; broad Live device/routing/tempo/unknown-expression fixture gate unqualified |
| G6 | BLOCKED | No physical Android device/SDK qualification; jsdom is not device evidence |
| G7 | BLOCKED | Core defects, install/upgrade/signing lineage and owner acceptance outstanding |

Required deliverables: architecture/current model in BASELINE.md; root cause, changed file/function inventory and requirement traceability above; decision/migration/rollback in ADR-001.md; automated results in evidence.json. Audio measurements and listening are BLOCKED/NOT TESTED. ALS subset is PASS; general gate FAIL. Android physical qualification is BLOCKED. Performance/memory qualification is NOT TESTED except pre-allocation resource rejection; test wall time is not an audio performance benchmark. Baseline commit is above; PR head identifies correction commit. Limitations and release risks are explicit in the gate/compatibility tables.

New Project still creates a16-bar starter, not a complete variable-duration composition. Fixed form vocabulary, limited harmony, inconsistent domain/XML/persistence ownership and incomplete editing remain critical. These prerequisite defects must be resolved before Phase2 expansion. Parsing preserved note probability can intentionally change playback compared with the former probability-dropping parser; native audio regression is required before qualification. No DSP replacement, Android signing change or release artifact is included.
