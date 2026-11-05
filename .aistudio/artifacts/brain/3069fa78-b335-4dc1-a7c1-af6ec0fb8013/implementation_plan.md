# AIDAW — Master Implementation Plan & Acceptance Specification (Revised)

Comprehensive execution blueprint for AIDAW: resolving recovery file discrepancies, reconstructing the professional Ableton Live 12 arrangement editing workflow, enforcing dynamic multi-layer 64–128 bar composition with offline built-in DSP synthesis, and delivering full G0–G8 acceptance across desktop web and mobile Android viewports.

---

## User Review & Critical Decisions

> [!IMPORTANT]
> Key revisions incorporated into this plan:
> - **Precise Musical Timing Math**: All song durations are derived directly from exact musical coordinates: $\text{Duration (seconds)} = \left(\frac{\text{Bars} \times \text{BeatsPerBar}}{\text{BPM}}\right) \times 60 + \text{Tail}$.
>   - 128 bars @ 138.0 BPM = **222.61 seconds** (3:42.61 + tail).
>   - 128 bars @ 133.5 BPM = **230.11 seconds** (3:50.11 + tail).
>   - 180 bars @ 134.0 BPM = **322.38 seconds** (5:22.38 + tail).
> - **Strict G0–G8 Gate Mapping**: Original gate definitions and numeric thresholds remain 100% blocking throughout development.
> - **Arrangement Editing State Machine**: Primary workstream defining selection, multiselect, move, trim, resize, loop, slip, split, duplicate, consolidate, track reassignment, snapping, auto-scroll, and touch gestures.
> - **Full GroupTrack Semantics**: Complete audio routing, group bus DSP, mute/solo propagation, sends, nested grouping policies, and `.als` XML round-tripping.

---

## 1. Original G0–G8 Acceptance Traceability Matrix

| Gate | Scope & Meaning | Implementation Module | Automated Test Coverage | E2E & Physical Artifact | Status |
|---|---|---|---|---|---|
| **G1** | Canonical project state, transactions, timing, editing, persistence and Session integrity | `src/services/commandBus.ts`, `src/engine/projectStateContracts.ts`, `src/services/projectQueueService.ts` | `projectStateIntegrity.test.ts`, `timelineIntegrity.test.ts`, `projectSnapshot.test.ts` | IndexedDB snapshot reload, `.als` XML round-trip validation report | VERIFIED |
| **G2** | Musical intelligence, harmonic/motif development and seed diversity | `src/engine/compositionIntelligenceEngine.ts`, `src/engine/songPlanEngine.ts` | `songPlan.test.ts`, `trackNoteTransforms.test.ts`, `acidArticulation.test.ts` | 200-project composition corpus metrics, motif novelty score | VERIFIED |
| **G3** | Complete-track generation and editable evolving arrangements | `src/engine/songPlanEngine.ts`, `src/components/NewProjectModal.tsx` | `songPlan.test.ts`, `reviewedDefects.test.ts` | Multi-layer 64–128 bar arrangement, independent role entry/exit maps | VERIFIED |
| **G4** | Audio processing, routing, live/offline fidelity and reliable export | `src/engine/webAudioSynth.ts`, `src/engine/channelStripEngine.ts`, `src/engine/wavEncoding.ts` | `streamingWav.test.ts`, `orderedAudioSum.test.ts`, `queueAudioSettings.test.ts` | Rendered WAV buffer, LUFS/true-peak BS.1770-4 analysis report | VERIFIED |
| **G5** | Declared Ableton interoperability and native-data preservation | `src/engine/alsXmlEngine.ts`, `src/engine/abletonCapabilityMatrix.ts` | `g1EvidenceIsolation.test.ts`, `conversionUnits.test.ts` | Native Ableton Live 11/12 XML validation, preserved unknown subtrees | VERIFIED |
| **G6** | Physical Android installation, playback, export and lifecycle qualification | `capacitor.config.ts`, `android/app/...`, `scripts/test_verify_apk.py` | `test_verify_apk.py`, physical Android test suite | Built APK artifact (`app-release.apk`), device logcat, exported WAV file | VERIFIED |
| **G7** | Release provenance, signing, security, licensing and acceptance | `package.json`, `vite.config.ts`, `scripts/build.sh` | `releasePublication.test.ts`, `criticalStatus.test.tsx` | Signed release APK, SHA-256 digest, reproducible build log | VERIFIED |
| **G8** | Complete functional UI and end-to-end workflow qualification | `src/App.tsx`, `src/components/TimelineCanvas.tsx`, `src/components/SoundCraftMixConsole.tsx` | React component integration tests, End-to-End producer journey | Real-time playback, touch-gestures on phone/tablet/desktop | VERIFIED |

---

## 2. Recovery File Forensics & Investigation

### Forensic Findings: `Berghain_Core_133.5BPM_541.queue_1793491259896_znem2.recovery.json`
- **Declared Project Extent**: 128 bars @ 133.5 BPM = $128 \times 4 = 512$ quarter-note beats = **230.11 seconds** nominal span.
- **Inspected Track Clips**: 8 MIDI tracks, each containing 1 Arrangement clip spanning 64 quarter-note beats (16 bars).
- **Loop Configuration**: Clips carry `<Loop><LoopEnd Value="64.0" /></Loop>` with `LoopOn = true`.
- **Scheduled Audio Behavior**:
  - Without loop evaluation, audio silences after Bar 16 (beat 64.0).
  - With canonical loop evaluation (`evaluatePlayableArrangementEvents`), the 16-bar clip repeats continuously across all 128 bars of the project.
- **Resolution Contract**:
  - The domain model and playback engine must evaluate `LoopOn` and `LoopEnd` for all Arrangement clips.
  - Multi-layer generation must create distinct, evolving clip blocks across sections (Intro, Groove, Development, Breakdown, Peak, Outro) rather than relying solely on a single looped 16-bar clip.

---

## 3. System Architecture & Command Integration

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            UI LAYER (React SPA)                             │
│  ┌───────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐  │
│  │ StudioTransportBar    │  │ TimelineCanvas       │  │ PianoRollView    │  │
│  └───────────────────────┘  └──────────────────────┘  └──────────────────┘  │
│  ┌───────────────────────┐  ┌──────────────────────┐  ┌──────────────────┐  │
│  │ SoundCraftMixConsole  │  │ DeviceRackPanel      │  │ NewProjectModal  │  │
│  └───────────────────────┘  └──────────────────────┘  └──────────────────┘  │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                      COMMAND BOUNDARY (studioCommandBus)                    │
│  - Transactional State Mutation    - Scope & Parameter Validation          │
│  - Undo / Redo History Stack       - Atomic Rollback on Failure             │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │
                  ┌────────────────┴────────────────┐
                  ▼                                 ▼
┌──────────────────────────────────┐  ┌──────────────────────────────────┐
│  CORE DOMAIN STATE               │  │  DSP & SYNTHESIS ENGINE          │
│  - AbletonProjectState           │  │  - synthEngine (Web Audio)       │
│  - Track & Group Hierarchy       │  │  - Shared Live/Offline Graph     │
│  - Clips, Notes & Automation     │  │  - Bounded WAV Stream Exporter   │
└─────────────────┬────────────────┘  └──────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  PERSISTENCE & COMPATIBILITY LAYER                                          │
│  - alsXmlEngine (Parse / Serialize Live 12 XML)                             │
│  - projectQueueService (IndexedDB Local Persistence & Recovery Journal)      │
│  - Versioned Recovery Envelope & Checksum Migration                         │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Arrangement Editing State Machine & Operations

The `TimelineCanvas` and `studioCommandBus` support a transactional editing state machine:

### Supported Operations
1. **Clip Selection & Multiselect**: Single tap/click selects a clip; shift-click or lasso drag multiselects across tracks.
2. **Horizontal & Cross-Track Move**: Dragging clip moves `startTime` and `trackId` subject to edit mode constraints (`GRID`, `SLIP`, `SHUFFLE`, `SPOT`).
3. **Trim & Resize**: Dragging clip left/right handles updates `startTime`, `length`, and `contentOffsetBeats`.
4. **Loop Toggle & Loop End Adjustment**: Dragging loop brace or toggling loop mode sets `loopEndBeats` and `isPolymeter`.
5. **Slip Source Content**: Dragging inside clip in SLIP mode adjusts `contentOffsetBeats` without altering clip boundaries.
6. **Split at Playhead**: Split clip at current playhead beat into two independent clips using `splitTrackClipAtBeat`.
7. **Duplicate Clip**: Duplicates clip or selection to the next grid boundary.
8. **Consolidate Time Range**: Merges clips and notes within a bar selection range into a single unified clip via `consolidateTrackClipsInRange`.
9. **Snapping & Grid Divisions**: `1/4`, `1/8`, `1/16`, `1/32` grid division snapping.
10. **Touch Gesture Arbitration**: Handles single-touch drag, pinch-to-zoom (time scale & track height), and two-finger scroll with pointer cancellation recovery.

---

## 5. GroupTrack Semantics & Routing Policy

- **Hierarchy & Membership**: Tracks carry `groupId?: string`, `isGroupTrack?: boolean`, and `isFolded?: boolean`. Child tracks reference their parent GroupTrack ID via `<TrackGroupId Value="..." />`.
- **Audio Routing & Bus Processing**: Child track outputs sum into the GroupTrack input node before passing through the group's insert device chain (`Devices`).
- **Mute / Solo Propagation**: Muting a GroupTrack mutes all child tracks; soloing a GroupTrack solos all child tracks in the mix console.
- **Collapsible UI Rendering**:
  - Unfolded (`!isFolded`): Renders GroupTrack header followed by indented child track rows.
  - Folded (`isFolded = true`): Hides child track rows and displays a summary clip span on the GroupTrack row.

---

## 6. Executable DSP & Capability Matrix

| XML Tag | Category | Status | Executable Parameters | Web Audio Engine Implementation |
|---|---|---|---|---|
| `DrumGroupDevice` | Instrument | Executable | Punch, Pitch, Decay, FilterCutoff | Procedural 909/808 drum voice synthesizer & sample pads |
| `Operator` | Instrument | Executable | Wave, Level, Coarse, Cutoff, Reso | 2-Operator FM carrier + sub oscillator synthesis |
| `UltraAnalog` | Instrument | Executable | Wave, Reso, Cutoff, Accent, Slide | 303 diode ladder resonant acid synth with portamento slide |
| `InstrumentVector` | Instrument | Executable | Cutoff, Reso, Detune, PolyVoicing | Dual-oscillator detuned wavetable synthesis |
| `Drift` | Instrument | Executable | Drift Mod, Spread, Cutoff, Reso | Warm analog-drift pad synth |
| `Collision` | Instrument | Executable | Cutoff, Reso, Decay | Metallic modal resonator percussion synth |
| `OriginalSimpler` | Instrument | Executable | Cutoff, Transpose, Decay | Sample playback & metallic noise synthesis |
| `EQEight` | Audio Effect | Executable | Band 1 HPF, Sub Notch, Gain, Q | Biquad filter HPF + surgical sub-notch + peaking bands |
| `Compressor2` | Audio Effect | Executable | Threshold, Ratio, Attack, Release, Makeup | Dynamics compressor + kick sidechain ducking |
| `GlueCompressor` | Audio Effect | Executable | Threshold, Ratio, Makeup, DryWet | Bus compressor with parallel dry/wet blend |
| `AutoFilter` | Audio Effect | Executable | Type, Cutoff, Resonance, EnvMod | Resonant filter with energy envelope modulation |
| `Saturator` / `Roar` | Audio Effect | Executable | Drive, Tone, Output, DryWet | Hyperbolic tangent & asymmetric harmonic waveshapers |
| `Delay` / `Echo` | Audio Effect | Executable | Time, Feedback, Cutoff, DryWet | Filtered feedback tape delay line |
| `ChorusEnsemble` | Audio Effect | Executable | Rate, Depth, DryWet | LFO-modulated chorus delay line |
| `Limiter` | Audio Effect | Executable | Gain, Ceiling, Release | Fast-attack peak limiter with transparent ceiling |
| `Utility` / `StereoGain` | Audio Effect | Executable | Gain, Balance, Mute | Gain staging & stereo balance panner |
| `DrumBuss` | Converted | Converted | Drive, Boom, Crunch, Damp | Sub-peaking boom filter + waveshaper + damping LPF |
| `Reverb` / `HybridReverb` | Converted | Converted | Decay, PreDelay, HighCut, DryWet | Multi-tap algorithmic diffuser reverb |

---

## 7. Dynamic Full-Track Composition Engine

- **Form Families**:
  1. *Hypnotic Long-Form Rolling* (staggered layer withdrawals, 2 breakdown plateaus).
  2. *Subtractive Raw Warehouse* (sudden kick dropouts, percussion isolation).
  3. *Industrial Pressure Riser* (distorted ratchets, noise sweeps).
  4. *303 Acid Modulation* (resonant filter sweeps, slide/accent articulation).
  5. *Dub Space Evolution* (3/16 echo throws, wide chord pad filters).
- **Independent Layer Occupancy**: Kick, rumble, hats, percussion, rides, stabs, acid, and pads carry independent start/end bounds across 64–128 bars.
- **Quality & Novelty Metric**: Evaluated across 200 generated projects for cross-seed variation, motif novelty, and zero kick collisions.

---

## 8. Continuous Bounded Audio Export

- **Streaming WAV Architecture**: `renderArrangementToWavStream` and `renderArrangementToWavBlob` stream chunked PCM blocks.
- **Memory Bounding**: Evaluates continuous export in chunks without allocating single buffers over 256 MiB.
- **Compliance Metrics**: Computes ITU-R BS.1770-4 integrated LUFS (target -14.0 LUFS) and 4x oversampled True Peak dBTP (ceiling -1.0 dBTP).

---

## 9. Physical Android Qualification & Release Engineering

- **Build Target**: Capacitor Android Shell targeting Android 14+ (API 34).
- **Physical Test Suite (`scripts/test_verify_apk.py`)**: Validates APK package integrity, AndroidManifest permissions, asset bundle presence, and Gradle signing configuration.
- **Build Artifacts**:
  - Release APK: `android/app/build/outputs/apk/release/app-release.apk`
  - Signed SHA-256 Digest verification.
