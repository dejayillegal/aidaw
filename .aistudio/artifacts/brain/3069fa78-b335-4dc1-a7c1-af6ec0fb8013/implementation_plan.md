# Studio Workstation & SoundCraft Architecture Implementation Plan

## 1. Architectural Vision & Core Pillars

This upgrade aligns the Ableton Live `.als` AI Studio Workstation with the clean-room studio architecture of **SoundCraft** (`storytold/soundcraft` / ArtCraft Suite), **Ableton Live 12**, and **Logic Pro**, while integrating your three requested production innovations and cross-platform touch/desktop ergonomics:

1. **Multi-File `.als` Bulk Smart Leveling Queue & Batch Export**: Import multiple `.als` project files simultaneously into a persistent project queue, inspect per-project crest factor and LUFS diagnostics, run **Bulk Process Smart Leveling** across all queued `.als` projects in one click, switch between queued projects instantaneously, and batch-export calibrated `.als` files.
2. **Selected-Track Mini-Waveform & 16th-Note Density Heatmap Strip**: Positioned directly below the Arrangement Timeline and synchronized with horizontal zoom/scroll and the live playhead, rendering a dual-layer synthesized audio waveform envelope plus a 16th-note rhythmic density and velocity heatmap for the active track.
3. **Persistent `localStorage` Master Export Presets Manager**: Create, select, and delete custom Master Export presets persisted in browser `localStorage`, governing **Bit Depth** (`16-bit PCM`, `24-bit PCM`, `32-bit IEEE Float`), **Sample Rate** (`44.1 kHz`, `48 kHz`, `96 kHz`), **Integrated LUFS Target** (`-14.0 LUFS` streaming, `-9.0 LUFS` club master, `-6.0 LUFS` peak techno, or bypass), and **True Peak Ceiling** (`-0.1 dBFS` to `-2.0 dBFS`), wired directly into the offline Web Audio DSP renderer (`renderArrangementToWavBlob`).
4. **SoundCraft + Ableton Live 12 + Logic Pro Studio Workflows**:
   - **Timeline Edit Modes (`Shuffle`, `Slip`, `Spot`, `Grid`) & Memory Location Markers**: Non-overlapping ripple edits in `Shuffle`, sub-grid micro-timing in `Slip`, exact bar/beat dialog placement in `Spot`, quantized snapping in `Grid`, plus interactive locator markers in the timeline ruler (`1–9` memory locations).
   - **Full Mix Console View (`Mix` Window)**: Dedicated console view alongside `Arrangement` and `Session` featuring channel strips with up to **10 Insert FX slots**, **Return A/B Send knobs**, **VCA Group assignment** (`Drums VCA`, `Low-End VCA`, `Synths VCA`, `Atmosphere VCA`), stereo peak/RMS metering, and Master Bus calibration.
   - **Track Comping Playlists & Strip Silence Transient Tool**: Switchable take playlists (`Take A: Main Groove`, `Take B: Sparse Dub`, `Take C: Peak Drive`) per track and a `Strip Silence / Gate Transients` processor that prunes low-energy ghost notes or isolates transient peaks based on a dB/velocity threshold.
   - **Studio Command Palette (`Cmd/Ctrl + K`)**: Scriptable studio action bar executing every DAW command, batch calibration, preset render, edit mode switch, and track operation from a single keyboard/touch launcher.
5. **Cross-Platform Responsive Mobile, Tablet & Desktop Ergonomics**: Dynamic viewport adaptation supporting mobile phones (`375px–430px`), Android/iPad tablets (`768px–1024px`), and widescreen studio monitors (`1440px+`) with $\ge 44\times 44\text{px}$ touch hitboxes, pinch/wheel timeline zoom, and a compact mobile thumb-zone navigation dock.

---

## 2. Key Technical Modules & File Changes

### A. Type System Extensions (`/src/types/ableton.ts`)
- **`TimelineEditMode`**: `'grid' | 'slip' | 'shuffle' | 'spot'` added to `TransportConfig`.
- **`MemoryLocationMarker`**: `{ id: string; number: number; name: string; bar: number; color: string; comment?: string }` stored on `AbletonProjectState`.
- **`VcaGroupId` & `VcaGroupConfig`**: `'drums_vca' | 'low_end_vca' | 'synths_vca' | 'atmos_vca' | 'unassigned'` with group gain dB (-24 to +6 dB) and mute/solo coupling.
- **`TrackPlaylistComp`**: `{ id: string; name: string; createdAt: string; notes: MidiNoteEvent[] }` stored on `AbletonTrack` (`playlists?: TrackPlaylistComp[]`, `activePlaylistId?: string`).
- **`MasterExportPreset`**:
  ```ts
  export interface MasterExportPreset {
    id: string;
    name: string;
    bitDepth: 16 | 24 | 32;
    sampleRate: 44100 | 48000 | 96000;
    targetLufs: number | null; // e.g., -14, -9, -6, or null (unnormalized)
    peakCeilingDb: number; // e.g., -0.1, -0.3, -1.0
    isBuiltIn?: boolean;
  }
  ```
- **`BulkQueuedProjectItem`**:
  ```ts
  export interface BulkQueuedProjectItem {
    id: string;
    fileName: string;
    project: AbletonProjectState;
    calibrated: boolean;
    calibratedAt?: string;
    peakDeltaDb?: number;
    status: 'queued' | 'calibrating' | 'calibrated' | 'error';
    summaryLog?: string;
  }
  ```

### B. Offline Audio Renderer & Master Export Engine (`/src/engine/webAudioSynth.ts`)
- Upgrade `renderArrangementToWavBlob(project, humanization, masterBus, options)` to accept `MasterExportPreset` parameters:
  - Configurable `OfflineAudioContext` sample rate (`44100`, `48000`, or `96000`).
  - Integrated RMS/LUFS loudness measurement across rendered stereo buffers with automatic gain scaling to match `targetLufs` and brickwall peak limiting at `peakCeilingDb`.
  - Support `16-bit PCM`, `24-bit PCM`, and `32-bit IEEE Float` (`format = 3`) RIFF WAV encoding.
- Add `computeSelectedTrackWaveformAndDensity(track, arrangementLengthBars, resolutionBins)` helper that synthesizes a fast deterministic amplitude envelope and 16th-note velocity/density array for the selected-track mini-waveform strip.

### C. Selected-Track Mini-Waveform & Density Visualizer (`/src/components/TimelineCanvas.tsx`)
- Add a dedicated **Selected-Track Mini-Waveform & 16th-Note Density Strip** (`height: 62px`) positioned directly below the Upper Arrangement Canvas and above the Lower Piano Roll:
  - Synchronized with `timelineZoom`, `timelineScrollBar`, and the live `currentBeat` playhead cursor.
  - **Dual Overlay Rendering**:
    1. **16th-Note Density & Velocity Heatmap**: Background vertical bars colored by track hex and velocity intensity showing rhythmic concentration per 16th step / bar.
    2. **Synthesized Audio Waveform Contour**: High-contrast bipolar waveform envelope reflecting transient attacks, decay tails, filter cutoff, and sidechain pumping of the selected track.
  - Interactive click/drag scrubbing and transient threshold preview line when using the **Strip Silence / Transient Gate** tool.
- Integrate **Edit Modes (`Shuffle`, `Slip`, `Spot`, `Grid`)** and **Memory Location Markers** directly into the Timeline header and ruler:
  - Clicking the ruler marker lane adds or jumps to numbered **Memory Locations** (`Marker 1: Intro`, `Marker 2: Sub Entry`, `Marker 3: Acid Peak`, etc.).
  - Toggling notes in `Grid` snaps to grid division; `Slip` places notes at exact unquantized fractional beats; `Shuffle` ripples subsequent notes when inserting/deleting; `Spot` opens an inline Bar/Beat/Tick precision coordinate popover.

### D. SoundCraft Full Mix Console & Comping/Strip Silence (`/src/components/SoundCraftMixConsole.tsx`)
- Create a dedicated **SoundCraft Mix Console** component (`Mix` workspace mode) featuring:
  - **Per-Track Console Strips**: Up to **10 Insert FX Slots** (with one-click add from the Ableton Device Library, bypass toggle, and XML device sync), **Return A (Reverb) & Return B (Delay) Send Rotaries**, **VCA Group Selector**, Pan pot, Precision dB Fader, Stereo Peak/RMS LED meter bar, and Track Comp Playlist switcher.
  - **VCA Master Faders & Return/Master Bus Strips**: Dedicated VCA Group faders (`Drums VCA`, `Low-End VCA`, `Synths VCA`, `Atmosphere VCA`) that proportionally scale member track volumes in real time and write calibrated gains into `.als` XML.

### E. Bulk `.als` Smart Leveling Modal, Master Export Preset Manager & Command Palette (`/src/App.tsx`)
- **Multi-File `.als` Upload & Bulk Process Toolbar Button**:
  - Enable `multiple` on the `.als` file input and add a **Bulk Process (`N` Projects)** button next to `Smart Level` in the header/sidebar.
  - Clicking **Bulk Process** applies `computeAiSmartMixCalibration` + XML mixer/EQ8/sidechain injection across every queued `.als` file in batch, displays before/after LUFS & headroom telemetry for each file, and provides **Export All Calibrated `.als`** or one-click switching into any queued project.
- **Master Export Presets Bar (`localStorage` key: `ableton_studio_master_export_presets_v1`)**:
  - Pre-seeded with studio defaults (`Club Master 24-bit / 48kHz / -9 LUFS`, `Streaming Master 24-bit / 44.1kHz / -14 LUFS`, `Archive 32-bit Float / 96kHz / Raw`) plus a modal/popover to save custom presets with custom name, bit depth (`16`/`24`/`32`), sample rate (`44.1k`/`48k`/`96k`), LUFS target, and peak ceiling dB.
- **Studio Command Palette (`Cmd/Ctrl + K`)**:
  - Instant searchable command palette for executing studio macros (`Bulk Process All .ALS with Smart Leveling`, `Render Master WAV with Active Preset`, `Switch Edit Mode: Slip/Grid/Shuffle/Spot`, `Apply Strip Silence to Selected Track`, `Open Mix Console`, `Add Memory Location Marker`).
- **Responsive Mobile / Tablet / Desktop Layout**:
  - Desktop (`lg:`): Full studio split with Left Track/Queue Sidebar, Center Arrangement + Mini-Waveform + Piano Roll / Mix Console, and Right AI Composer / Device Rack inspector.
  - Mobile & Tablet (`< lg`): Ergonomic bottom workspace switcher (`Timeline`, `Mix Console`, `Device Rack`, `AI & Bulk Queue`) with $\ge 44\text{px}$ touch targets and horizontal touch scrolling.

---

## 3. Verification & Quality Assurance Plan
1. **Unit & Engine Validation**: Verify multi-file `.als` decompression, batch `computeAiSmartMixCalibration` XML round-trip integrity, 16/24/32-bit WAV encoding at 44.1/48/96kHz with LUFS normalization, and `localStorage` preset persistence.
2. **Interactive Canvas & Touch Verification**: Ensure the Mini-Waveform & 16th-Note Density Strip updates immediately on track selection, note edits, and zoom/scroll changes without blocking timeline interactions.
3. **Build & Type Safety**: Run `lint_applet` and `compile_applet` to confirm zero TypeScript or bundle errors.
