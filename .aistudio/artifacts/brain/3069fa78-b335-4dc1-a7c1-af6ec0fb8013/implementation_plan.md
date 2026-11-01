# PARAMETRIC ALS DAW — ARCHITECTURE RECOVERY AND COMMERCIAL RELEASE CONTRACT

**Repository**: `dejayillegal/aidaw`  
**Status**: Authoritative Architecture Contract & Implementation Guide  

---

## 1. Product Charter
Deliver a reliable, editable, offline-capable Android/web music-production application that preserves Ableton ALS fidelity, composes complete evolving tracks, plays without recurring audio faults, and exports valid WAV files. The app is a workstation, not a loop demonstrator. Existing functionality is an asset to preserve, not an excuse to build competing engines.

---

## 2. Observed Evidence versus Open Questions

### Inspected Repository Baseline
- `src/App.tsx` imports and orchestrates `compositionIntelligenceEngine.ts`, `alsXmlEngine.ts`, and `webAudioSynth.ts`.
- Audio engine evaluated automation envelopes via `evaluateAutomationAtBeat(..., maxBeats=512)`. Now updated to `maxBeats=2048` (up to 256 bars).
- Gradle build orchestrator and metadata versioning synced to `versionCode 2`, `versionName "7.2.0"`, package `com.parametricals.technodaw`.
- Build verification suite at `scripts/verify-apk.py` validates APK zip structure, binary XML manifest, compiled `classes.dex`, `resources.arsc`, offline web assets, and v1/v2 signature blocks.

### Reported Symptoms & Technical Targets
- **Android WAV Export**: Eliminate any potential stall during offline rendering of long tracks (>32 bars or >120 seconds of audio) by combining chunked PCM synthesis (`synthesizeDeterministicStereoPcm`) with real frame-based progress tracking (`renderedFrames / totalFrames`) and watchdog timeouts on Web Audio rendering.
- **Audio Playback**: Crackle-free Web Audio voice allocation, exponential decay envelopes on voice eviction, and smooth `.setTargetAtTime()` parameter de-zippering.
- **Composition Intelligence**: Dynamically generated, evolving multi-section arrangements across variable track lengths (16, 32, 64, 96, 128, 192, 256 bars) using Bjorklund Euclidean distribution and musical profile analysis, avoiding hardcoded static song structures.
- **Responsive UI**: Adaptive layout supporting compact mobile viewports (<768px), portrait/landscape orientations, and unfolded dual-screen devices with reachable transport and master dock controls.

---

## 3. Architectural Invariants

1. **Single Canonical Project State**:
   Tracks, clips, MIDI, automation, routing, devices, markers, and generation identity share one typed model (`AbletonProjectState`). No silent conversions or shadow states.
2. **Single Composition Authority**:
   Extend `compositionIntelligenceEngine.ts` after audit; never add a second unrelated arrangement engine.
3. **Shared Playback/Export Semantics**:
   Both live playback and offline rendering consume the same timeline, synthesis configuration, and automation contract.
4. **ALS Losslessness**:
   Preserve unknown XML subtrees and unsupported data; validate round-trip semantic invariants and ensure invalid exports cannot replace originals.
5. **Deterministic Creative Variation**:
   Seeded generation is reproducible; different seeds are evaluated for structural and harmonic diversity, not mere random parameter changes.
6. **No Fake Progress**:
   Every reported export stage corresponds to measurable completed work.
7. **Release Provenance**:
   APKs originate only from Gradle, with a known signing lineage, reproducible version identity, verified checksums, and no stale fallback.
8. **No Silent Success**:
   Failed builds, exports, verification, or writes propagate typed errors and leave observable diagnostics.

---

## 4. P0 — Baseline, Root Cause, and Recovery

### Gate A — Establish a Baseline
- Record commit ID, toolchain, Android devices/OS, sample rate, song duration, project fixture, memory footprint, and observed reproduction steps.
- Inventory all relevant modules and call paths: generation → project state → transport/audio graph → offline render → encoder → Android storage; separately ALS import/edit/export and Android signing/build.
- Preserve known-good behavior as regression fixtures.

### Gate B — Repair Android Export End-to-End
- Eliminate unbounded memory allocation, deadlocks, and stalled promises during offline WAV export.
- Report real completed frames/segments and encode 16-bit PCM, 24-bit PCM, and 32-bit Float WAV files with valid RIFF headers.
- Utilize Capacitor Filesystem / Android Storage Access Framework with user-selected destinations, write/close/read-back verification, and actionable error reporting.

### Gate C — Fix Playback Integrity
- Instrument buffer underruns, scheduler lateness, dropped events, graph allocations, garbage collection, clipping, and sample-rate behavior.
- Keep audio scheduling independent from React rendering. Smooth automation and avoid clicks at voice eviction, clip boundaries, and seek/play transitions.

---

## 5. P1 — Complete Musical Composition & UI Reachability

### Dynamic Composition Intelligence
- Generate musical form plans from genre, target duration, tempo, key/mode, energy profile, musical constraints, and seed.
- Support variable intro, groove, development, build, drop, breakdown, second build, climax, and outro sections across variable bar lengths.
- Derive chords, bass movement, motifs, rhythmic variation, and orchestration from shared harmonic/phrase context.
- Create section-aware automation and transition assets: risers, fills, noise, sweeps, impacts, silence, re-entry, reverb tails, and filter movement.
- Maintain user editability: generated sections become ordinary tracks/clips/automation, not opaque audio blobs.

### UI & Android Release Engineering
- Test compact portrait, landscape, folded/unfolded, keyboard visible, and system gesture insets.
- Keep transport, settings, save, and export reachable with responsive workspace layouts and touch-friendly 44px targets.
- Verify Gradle version against `public/apk-metadata.json` and approved release ledger.
- Preserve separate debug and production signing policies, pinning certificate fingerprints against trusted baseline (`debug.keystore`).

---

## 6. Release Gates & Verification Matrix

- **G0 Baseline**: Reproduction, logs, test suite validation (`npm test`), module inventory.
- **G1 Export**: Valid full-length WAV export on physical Android / Web; verified RIFF headers, non-silence, finite samples, real frame progress.
- **G2 Audio**: Continuous playback and transitions with 0 buffer underruns, click-free voice eviction, and smooth `.setTargetAtTime` automation.
- **G3 Composition**: Full editable arrangements, reproducible seeds, demonstrated diverse openings and section plans, transitions, and chord development.
- **G4 Compatibility**: ALS round-trip regression fixtures; no destructive edits or missing unknown subtrees.
- **G5 UX**: Folded/unfolded/settings/export reachability verified on device with responsive split-dock controls.
- **G6 Release**: Clean Gradle build, pinned signing certificate (`com.parametricals.technodaw`, `versionCode 2`), metadata agreement, and passing `verify-apk.py`.

---

## 7. Delivery Order & Change Discipline

1. Fix Android export and playback defects with regression coverage.
2. Stabilize canonical project/audio/ALS contracts.
3. Extend existing composition intelligence to full arrangements across dynamic bar lengths.
4. Repair foldable UI and branding without changing core semantics.
5. Verify signing, release metadata, install/upgrade, and publish only proven artifacts.

Every change follows:  
`requirement → existing code → observed defect → root cause → minimal change → automated regression → real-device validation → release evidence.`
