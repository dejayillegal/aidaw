# Parametric ALS v5.0 — Complete SoundCraft-Class Workstation Reconstruction & Studio Architecture Plan

This plan incorporates all nine mandatory Architecture Review Corrections (`Correction 1` through `Correction 9`), elevating the full **SoundCraft-inspired Edit Window, Full-Workspace Mix Console, Constraint-Aware Docking Shell, and Lower Editors** to **Priority 0 / Priority 1 primary deliverables**, while integrating the **Non-Destructive Multi-Clip Velocity Randomizer**, **Persistent Channel-Graph Strict Solo Isolation (`resolveEffectiveAudibility`)**, and **Per-Track `AnalyserNode` 8-Band FFT Spectrum** into the reconstructed workstation.

## User Review & Critical Decisions (Architecture Review v5.0 Incorporated)

> [!IMPORTANT]
> All nine mandatory corrections from the Architecture Review have been locked into the specification below:

- **Correction 1 — Visual Reconstruction as the Primary Deliverable (`Priority 0 & Priority 1`)**:
  - **Complete Edit Window (Default Startup Workspace)**: Eliminates the scrolling web dashboard and replaces it with a `100dvh` studio shell: Application Menu Bar (`File | Edit | View | Track | Clip | MIDI | Audio | Effects | Tools | Window | Help`), Precision Transport Bar, Workspace Switcher (`Edit | Mix | Session | Sound Design | AI Composition | Mastering`), Unified Editor Toolbar (`Smart | Selector | Grabber | Trim | Pencil | Zoom | Scrubber` + `Shuffle | Slip | Spot | Grid`), Left Tracks & Groups Tree, 1:1 vertically aligned Track Headers + Multitrack Arrangement Canvas, 62px Selected-Track Analysis Strip, Resizable Lower Editor (`MIDI Piano Roll | Velocity Editor | Clip Editor | Device Chain | Automation Editor`), and Collapsible Right Inspector.
  - **Complete Mix Window (Dedicated Full-Workspace Mode)**: Switching to **Mix** opens the full-viewport SoundCraft Mix Console (not a cramped bottom strip) with `96–112px` vertical channel strips, 10 ordered insert slots, Send A/B rotaries, input/output routing, stereo pan, Mute/Solo/Arm, real stereo Peak/RMS/Clip-Hold meters, precision vertical dB faders with double-click reset and fine-adjust, VCA Group strips (`Drums`, `Low-End`, `Synths`, `Atmosphere`), Return A/B strips, pinned Master strip, and visibility mode toggles (`Compact | Expanded | Inserts | Sends | Routing | VCA`).
- **Correction 2 — Constraint-Aware Responsive Dock Layout Engine**:
  - Replaces static pixel assumptions with a constraint-aware `100dvh` CSS Grid & split-pane layout controller that enforces a minimum central Arrangement height (`>= 260px`). On compact desktop viewports (`1366×768`), the lower editor automatically compacts (`180px`) or collapses on demand, and secondary right docks auto-collapse while persisting user-resized dimensions in `localStorage` and offering one-click **Restore Default Layout**.
- **Correction 3 — Non-Destructive, Multi-Clip Musical Velocity Randomizer**:
  - Operates across user-selected MIDI clips, all clips on the selected track, or selected note subsets (never hardcoded to `clips[0]`), respecting track locks and the active take (`track.takes[]`).
  - Uses deterministic seed-based generation with `Min Velocity (1–127)`, `Max Velocity (1–127)`, `Blend (0–100%)`, `Protect Accents` (honoring `note.isAccent` and musical contour), and `Protect Downbeats` (honoring bar/phrase downbeats).
  - Provides an interactive **Before/After Preview** (displaying Original vs. Proposed velocity histogram, Protected-note count, Changed-note count, clip scope, and audible A/B preview) and patches existing `<Velocity>` XML attributes in-place by note ID without regenerating clip structures.
- **Correction 4 — Persistent Mixer Graph & `resolveEffectiveAudibility()` for Strict Solo**:
  - Introduces a shared `resolveEffectiveAudibility()` service across real-time playback, live TouchJamPads, Session scene launches, and offline WAV/mastering renders.
  - Evaluates track mute, track solo, multi-track solo, group membership/solo, VCA group solo (decoupled from VCA gain), and solo-safe Return A/B buses.
  - Maintains persistent per-track Web Audio channel `GainNode`s so toggling Solo mid-note or during reverb/delay tails applies a click-free `15ms` gain ramp that immediately silences excluded sustaining voices without altering fader or automation state.
  - Non-soloed lanes display a clear `SOLO-MUTED` indicator with reduced clip contrast while keeping track headers, labels, and controls 100% readable and selectable.
- **Correction 5 — Real Selected-Track `AnalyserNode` Tap for 8-Band Spectrum**:
  - Inserts a dedicated per-track `AnalyserNode` tap (`Instrument/Source -> Track Inserts -> Track Gain/Pan -> Selected Track Analysis Tap -> Routing/Sends/Master`) with selectable **Pre-Fader / Post-Fader** tap point and FFT bin mapping derived from the active `AudioContext.sampleRate`.
  - Renders in two non-obstructive modes:
    1. **Compact Lane HUD**: Right-aligned `116px` translucent 8-band meter cluster (`pointer-events: none`) inside the selected arrangement lane so clip selection, resizing, and dragging are never obstructed.
    2. **Expanded Track Spectrum**: Detailed 8-band analyzer (`Sub`, `Bass`, `Low-Mid`, `Mid`, `Upper-Mid`, `Presence`, `Brilliance`, `Air`) with Peak Hold, configurable decay, Pause/Freeze, and `Analysis Unavailable` state inside the Selected-Track Analysis Strip and Right Inspector.

---

## 1. Overview & Core Concept

- **What It Does**: Reconstructs Parametric ALS into a full-viewport SoundCraft-class digital audio workstation with dedicated Edit, Mix, and Session workspaces, Ableton Live 12 device/MIDI workflows, non-destructive ALS XML patching, and integrated AI techno production tools.
- **Target Audience / Persona**: Professional techno producers, mixing engineers, and live electronic performers working across desktop (`1366×768` to `2560×1440`), tablet (`768×1024`, `1024×768`), and mobile/Android (`390×844`) viewports.
- **Key Value**: Delivers true desktop DAW visual density, zero page-level scrolling, deterministic tool/mode editing (`Shuffle`, `Slip`, `Spot`, `Grid`), full-workspace 10-insert console mixing, and sample-accurate audio/XML verification.

---

## 2. User Experience & Visual Design

### Priority 0 & 1: Workstation Chrome, Edit Window & Mix Window Geometry

- **Constraint-Aware `100dvh` Desktop Shell**:
  - **Application Menu Bar (`28px`)**: `File | Edit | View | Track | Clip | MIDI | Audio | Effects | Tools | Window | Help` with live dropdown commands and keyboard shortcut hints (`Cmd/Ctrl+K`, `Cmd/Ctrl+Z`, `Space`, `1–9`). Secondary developer/inspection views (`XML Inspector`, `Python FastAPI Exporter`, `System Architecture`) live under `Tools` and `Window` modals/drawers.
  - **Precision Transport Bar (`48px`)**: Left transport cluster (`Return to Zero`, `Rewind`, `Stop`, `Play`, `Record/Overdub`, `Loop`), Center timing cluster (`Bar.Beat.Sixteenth` counter in `JetBrains Mono`, `BPM` drag/input, `4/4` meter, `Tap`, `Metronome`, `Quantize`), Right telemetry cluster (`Snap`, `Automation Arm`, `Edit/Session` indicator, `CPU %`, `Stereo Peak dBFS`, `Audio Engine Status`, `Save State`).
  - **Workspace Presets & Mode Bar (`34px`)**: Instant layout switching across `Edit`, `Mix`, `Session`, `Sound Design`, `AI Composition`, and `Mastering`, plus quick dock visibility toggles (`Left Tree`, `Bottom Editor`, `Right Inspector`, `Reset Layout`).
  - **Unified Editor Toolbar (`34px` in Edit Mode)**: Edit Mode cluster (`Shuffle | Slip | Spot | Grid`), Tool State Machine cluster (`Smart | Selector | Grabber | Trim | Pencil | Zoom | Scrubber`), Timeline Zoom/Follow controls, Memory Location dropper (`1–9`), and Selected-Track 8-Band HUD toggle (`Off | Lane HUD | Expanded Strip`).
- **SoundCraft Edit Window (Central Surface)**:
  - **Left Tracks & Groups Tree (`200–220px`, Collapsible)**: Displays track number, color bar, track name, instrument/group badge, group fold/unfold, Mute/Solo/Arm/Monitor buttons, VCA group tag, and drag-reorder handles.
  - **Synchronized Track Headers (`190px`) & Multitrack Arrangement Canvas**: Every track header shares the exact row height (`48px` normal / `76px` expanded automation) and vertical scroll offset as its arrangement lane. Clips render with crisp borders, header bars, real MIDI note blocks or offline PCM waveform peaks, resize handles, loop markers, and fade handles.
  - **Selected-Track Analysis Strip (`62px`)**: Pinned directly below the arrangement canvas, synchronized 1:1 with horizontal zoom and scroll (`arrStartBeat`, `arrVisibleBeats`, `playheadBeat`), showing 16th-note MIDI density, velocity intensity, measured offline PCM waveform (or explicitly labeled `Predicted Envelope` when audio is unavailable), transient threshold line, and optional Expanded 8-Band Track Spectrum.
  - **Resizable Bottom Editor Dock (`180px–320px`, Auto-Compacting on `768px` height)**: Tabbed workstation dock for **MIDI Piano Roll + Velocity/Probability Lane**, **Clip Inspector (Loop/Polymeter/Takes)**, **Horizontal Ableton-Class Device Chain (with 8 Macros & Anti-Slop Controls)**, and **Automation Breakpoint Editor**.

### Visual Identity & Industrial Dark Tokens

- **Surface Hierarchy**:
  - Primary Canvas (`--bg-canvas`): `#0B0D10`
  - Dock & Header Surfaces (`--bg-surface`): `#12161B`
  - Elevated Strip / Inspector Cells (`--bg-elevated`): `#171C24`
  - Hairline Structural Borders (`--border-subtle`): `#21262D` (`1px solid`)
  - Primary Amber Accent (`--accent-amber`): `#F59E0B` (Active Play/Solo, Loop Brace, Selected Tool, Primary Calibration CTA)
  - Secondary Cyan Accent (`--accent-cyan`): `#06B6D4` (Playhead, VCA Group Link, Spectral Analysis, Automation Curve)
- **Typography & Tabular Discipline**:
  - Display & UI Controls: `Plus Jakarta Sans` (`11px–13px`, `font-medium`, single-line `whitespace-nowrap`).
  - Numeric Counters, Faders, Rulers & FFT Readouts: `JetBrains Mono` with `font-variant-numeric: tabular-nums`.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Explicit Pointer Interaction State Machine on `TimelineCanvas`**
  - *Chosen Approach*: Decouple ruler scrubbing (`Scrubber`), clip selection/range highlight (`Selector`), clip moving (`Grabber`), clip edge resizing (`Trim`), note/automation drawing (`Pencil`), and viewport magnification (`Zoom`) into a deterministic pointer state machine governed by the active tool and edit mode (`Shuffle | Slip | Spot | Grid`).
  - *Why*: Prevents pointer gestures from accidentally seeking the transport while dragging clips, resizing loop boundaries, or editing automation breakpoints.
- **Decision 2: Persistent Per-Track Web Audio Channel Graph & `resolveEffectiveAudibility()`**
  - *Chosen Approach*: Allocate a persistent Web Audio channel strip (`inputGain -> insertChain -> panNode -> faderGain -> trackAnalyserTap -> soloMuteGate -> masterBus / sendBuses`) for each track in `WebAudioSynth`, governed by `resolveEffectiveAudibility(project, trackId, options)`.
  - *Why*: Guarantees that soloing or muting a track immediately silences sustaining notes and live pad triggers via a `15ms` click-free ramp on `soloMuteGate`, while allowing pre-fader or post-fader per-track FFT analysis on `trackAnalyserTap`.
- **Decision 3: Non-Destructive Velocity Randomization with A/B Preview & In-Place XML Patching**
  - *Chosen Approach*: Compute a preview state (`VelocityRandomizerPreview`) before mutating the project, allowing the producer to inspect original vs. proposed velocity histograms and audition the result, then commit via `StudioCommandBus` and patch `<MidiNoteEvent Velocity="..."/>` in-place.
  - *Why*: Protects musical phrasing, accent structures, and unknown native Ableton XML elements while maintaining full Undo/Redo reversibility.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                        STUDIO WORKSTATION SHELL (100dvh CSS Grid + Splitters)                │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ StudioMenuBar (28px)       │ File · Edit · View · Track · Clip · MIDI · Audio · Tools · Help │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ StudioTransportBar (48px)  │ ⏮ ⏪ ⏹ ▶ ⏺ 🔁 │ 001.1.1 │ 134.00 BPM │ 4/4 │ SNAP │ CPU │ dBFS │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ StudioWorkspaceTabs (34px) │ [EDIT WINDOW] │ [MIX CONSOLE] │ [SESSION] │ [SOUND DESIGN] │ AI │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ StudioEditorToolbar (34px) │ SHUFFLE SLIP SPOT GRID │ SMART SELECT GRAB TRIM DRAW ZOOM SCRUB │
├────────────────────┬──────────────────────────────────────────────────────┬──────────────────┤
│ Left Dock (210px)  │ Central Workspace Viewport (Min-H >= 260px)          │ Right Dock(260px)│
│ Tracks & Groups    │  ├─ [Edit Mode]: Synchronized Headers + Timeline     │  ├─ AI Composer  │
│  ├─ Group Fold     │  │   ├─ Real MIDI/Audio Clips & Automation Lanes     │  │   ├─ 4-Layer  │
│  ├─ M / S / Arm    │  │   ├─ Solo Amber Glow / Accessible SOLO-MUTED      │  │   └─ Velocity │
│  ├─ VCA Badge      │  │   ├─ Compact Right-Aligned 8-Band Lane HUD        │  │      Randomize│
│  └─ Memory Locs    │  │   └─ SelectedTrackAnalysisStrip (62px Synced)     │  ├─ Project Queue│
│                    │  ├─ [Mix Mode]: Full-Screen SoundCraftMixConsole     │  └─ Track FFT /  │
│                    │  │   └─ 10 Inserts · Sends A/B · VCA · Returns · Mst │     Master Meter │
│                    │  └─ [Session Mode]: Clip & Scene Launch Matrix       │                  │
├────────────────────┴──────────────────────────────────────────────────────┴──────────────────┤
│ Resizable Bottom Editor Dock (180–300px) │ Piano Roll & Velocity │ Clip │ Device Rack │ Auto │
├──────────────────────────────────────────────────────────────────────────────────────────────┤
│ StudioStatusBar (26px)     │ Engine Ready · 48kHz · Active Tool/Mode · Solo Count · ALS Valid│
└──────────────────────────────────────────────────────────────────────────────────────────────┘
                                               │
                                               ▼
┌──────────────────────────────────────────────────────────────────────────────────────────────┐
│                       PERSISTENT AUDIO GRAPH, COMMAND BUS & ALS XML ENGINE                   │
│  ├─ resolveEffectiveAudibility(): Track/Group/VCA Solo & Mute -> 15ms Click-Free Gate Ramp   │
│  ├─ Per-Track AnalyserNode Tap: Pre/Post Fader -> 8-Band FFT (20Hz–20kHz) + Peak Hold        │
│  ├─ StudioCommandBus: Atomic Undo/Redo for Clips, Notes, Velocity Randomizer, Mix & Takes    │
│  └─ AlsXmlEngine: In-Place <Velocity>, <Locators>, Device Chain & Round-Trip Validator       │
└──────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Data Model & Core Service Contracts

- **`resolveEffectiveAudibility(project, trackId, options)`**:
  - Returns `{ isAudible: boolean, mutedByTrackMute: boolean, mutedBySoloIsolation: boolean, mutedByVcaMute: boolean, mutedByVcaSoloIsolation: boolean, activeSoloTrackIds: string[], activeSoloVcaIds: string[], effectiveGainLinear: number, effectiveGainDb: number }`.
  - Used identically by real-time Web Audio channel gates, live pad triggers, Session launcher, offline PCM synthesizer, and `TimelineCanvas` lane styling.
- **`SelectedTrackSpectrumSnapshot` (Per-Track 8-Band FFT)**:
  - Band definitions: `Sub (20–60Hz)`, `Bass (60–140Hz)`, `Low-Mid (140–320Hz)`, `Mid (320–800Hz)`, `Upper-Mid (800–2000Hz)`, `Presence (2000–5000Hz)`, `Brilliance (5000–10000Hz)`, `Air (10000–20000Hz)`.
  - Each band tracks `currentDb` (`-72..0 dBFS`), `peakHoldDb`, `normalizedLevel` (`0..1`), and `peakNormalized` (`0..1`) using reusable `Float32Array` buffers without per-frame React state thrashing.
- **`VelocityRandomizerConfig` & `VelocityRandomizerPreview`**:
  - Supports scope selection (`selected_clip | all_track_clips | selected_notes`), deterministic PRNG `seed`, `minVelocity`, `maxVelocity`, `blendPct`, `protectAccents`, and `protectDownbeats`, producing an inspectable diff (`changedNoteCount`, `protectedNoteCount`, `originalHistogram`, `proposedHistogram`) before atomic commit.

### Implementation Delivery Sequence & Verification Gates (`G0`–`G8`)

1. **Priority 0 (`Gate G1 & G2`)**: Implement the `100dvh` Studio Shell (`StudioMenuBar`, `StudioTransportBar`, `StudioWorkspaceTabs`, `StudioEditorToolbar`, `StudioDockLayout`, `StudioStatusBar`) and reconstruct the **SoundCraft Edit Window** (`TimelineCanvas` with aligned track headers, tool state machine, clip resize/move/split, automation lanes, and 62px `SelectedTrackAnalysisStrip`).
2. **Priority 1 (`Gate G3`)**: Implement the full-workspace **SoundCraft Mix Console** (`SoundCraftMixConsole`) with 10 insert slots, Send A/B, input/output routing, stereo meters, VCA groups, Return A/B, and pinned Master strip.
3. **Priority 2 (`Gate G2/G3`)**: Complete the resizable lower editor tabs (**MIDI Piano Roll + Velocity Editor**, **Clip Editor**, **Horizontal Ableton-Class Device Chain**, **Automation Editor**) and constraint-aware dock persistence.
4. **Priority 3 (`Gate G4, G5 & G6`)**: Integrate the **Non-Destructive Multi-Clip Velocity Randomizer**, **Persistent Channel-Graph Strict Solo (`resolveEffectiveAudibility`)**, and **Per-Track `AnalyserNode` 8-Band Spectrum** (Compact Lane HUD + Expanded Strip).
5. **Priority 4 & 5 (`Gate G7 & G8`)**: Integrate the compact **AI Composer Dock**, **Project Queue Dock**, **Master Export Dialog**, and responsive tablet/phone workspaces, followed by full TypeScript validation (`lint_applet`), Vitest functional & audio regression tests (`G0`–`G8`), and production build verification (`compile_applet`).
