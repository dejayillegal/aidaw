# G0–G8 acceptance — standalone master directive

Authority: the November 5, 2026 Next-Generation AI-Powered Digital Audio Workstation master directive supplied by the owner. These definitions supersede the earlier architecture/Session-numbered gates. Historical evidence is retained in [HISTORICAL-G0-G8-TRACEABILITY.md](HISTORICAL-G0-G8-TRACEABILITY.md); gate numbers from that document must not be interpreted as current acceptance.

Status vocabulary: PASS, FAIL, BLOCKED, NOT TESTED. PASS requires all applicable acceptance criteria, not just compilation, a UI label, a checksum or a self-generated score. Named subchecks can pass while a whole gate remains open.

| Gate | Current status | Executed evidence and remaining acceptance |
|---|---|---|
| G0 Build and Startup | BLOCKED | Strict TypeScript, required correctness lint and web/PWA production build pass. Prior Android CI builds are historical evidence; this source revision needs its own APK build/signature result. Physical install/startup on supported phone/tablet/fold targets is unavailable here; no adb target is connected. |
| G1 Project Integrity | NOT TESTED | Native save/reopen, exact user Berghain recovery, migration archive/idempotence, seven cross-tab conflict scenarios and edit/undo persistence have passed scoped checks. Cross-version/PWA updates, physical process interruption, quota exhaustion and comprehensive asset recovery still require qualification. |
| G2 Arrangement Editing | FAIL | Canonical MIDI/clip drag/resize/split/duplicate/range deletion/consolidation/undo/reopen and mixed-meter Spot editing pass native checks. Full audio-clip/warp fidelity, every tool/gesture and the directive's complete editing coverage are not implemented or qualified. Removing disconnected tool buttons does not count as implementing their behavior. |
| G3 Composition Intelligence | NOT TESTED | Hierarchical song plans, independent role phrases, seeded generation, visible full-track creation and scoped regeneration exist. The 200-complete-project MIDI/audio corpus, genre coverage and independent structured listening remain outstanding. Structural metrics cannot certify release quality. |
| G4 Instruments and DSP | FAIL | Shared synthesis, registered device PCM fixtures and executable/converted capability contracts are retained. Universal sampler/multisampler/rack/modulation/expression and every required instrument/effect parameter are not implemented or qualified. Browser entries show the registry support status before insertion. |
| G5 Mixer and Routing | FAIL | Current channel/insert/send/group controls operate on the existing project; Session isolation and insertion-limit checks pass. Complete rack/macros/pre/post-send/latency and arbitrary shared sidechain/routing fidelity remain incomplete. UI meters are not proof of detector/compressor correctness. |
| G6 Playback Reliability | BLOCKED | Native mapped timing, probability, gain ramps/loop/seek, return seam and Session launch/capture cases pass scoped checks. Tiny loops below scheduler horizon explicitly reject. Android focus/interruption/load, long-session CPU/RSS and full wet/capture parity are unqualified; physical device access is absent. |
| G7 Export and Interoperability | FAIL | Native WAV decoding/repeatability, continuous file export, selected MIDI, native snapshots and supported ALS round trips have scoped evidence. Full audio-asset/warp/native-expression interoperability, standardized integrated loudness/true peak and all cancellation/resource boundaries remain incomplete. |
| G8 End-to-End Product Qualification | BLOCKED | Reference-guided workspace navigation, real Browser track/device commands, undo/redo/native reopen, responsive settings and editing/Session workflows have named browser evidence. Full required create→edit→route→automate→play→save→reopen→export journeys across actual Android phone/tablet/foldable hardware and licensed Live reopening are not qualified. Earlier gate failures also prevent release. |

## Current workspace milestone

[REFERENCE-WORKSPACE-IMPLEMENTATION.md](REFERENCE-WORKSPACE-IMPLEMENTATION.md) records archive identities, source findings, implemented behavior and exact executed checks. Browser runs use native Chromium/Web Audio/IndexedDB. Responsive geometry is not Android installation, touch latency, fold hardware, audio focus or native low-latency qualification.

Release remains blocked. No reference project's QA dashboard or internal heuristic may promote these gates. Preserve original user data, canonical commands and shared live/export semantics while completing the remaining criteria.


Authoring follow-up: AUTHORING-REVIEW-EVIDENCE.md records real Inspect/Compare/editor selection, canonical instrument replacement and role generation, reviewed AI actions, stale protection and native audition. These are named subchecks; complete audio editing/DSP/routing/platform gates remain open.

Signal-measurement follow-up: SIGNAL-MEASUREMENT-EVIDENCE.md records scoped mono/stereo metering, independent decoded-PCM comparison and cooperative reference analysis. G7 remains FAIL and G8 remains BLOCKED pending their complete criteria; named subchecks do not certify interoperability, full audio standards or hardware.

Reference-layer programme: [REFERENCE-LAYER-SLICES.md](REFERENCE-LAYER-SLICES.md) records the first integrated increment of the owner-approved six-slice plan: independent layers, typed command adapters, channel automation, true signal-key worklet compression, procedural atoms, persistent Editor panels and selected-layer stems. All six full slices and whole release gates remain open; this is scoped implementation and evidence, not completion of the full DAW directive.
