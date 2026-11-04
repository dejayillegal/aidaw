# AIDAW Implementation Plan — Reference-Grounded Core, Arrangement & G0–G8 Completion

## 1. Root-Cause Repair for Real-World Ableton `.als` Import (`PROJECT_STATE: invalid device on <id>`)
- **Top-Level vs. Nested Rack Device Resolution (`src/engine/alsXmlEngine.ts`)**:
  - Replace the recursive `querySelectorAll('DeviceChain > ... > Devices > *')` selector in `parseAbletonXmlDom` with a direct top-level device chain extractor scoped strictly to the track's own `<DeviceChain>`.
  - Prevent inner devices nested inside `<AudioEffectGroupDevice>`, `<InstrumentGroupDevice>`, and `<DrumGroupDevice>` branch chains from colliding with top-level device IDs (`Id="0"`, `Id="1"`, etc.) or falsely inflating the track's top-level insert slot count.
  - Extract and preserve nested rack macro controls and branch metadata while maintaining unique device identities.
- **Broad Native & Third-Party Device Compatibility (`src/engine/abletonCapabilityMatrix.ts`, `src/engine/alsXmlEngine.ts`)**:
  - Register Live 12 tags found across the reference corpus (`DrumCell`, `Eq8`, `StereoGain`, `AudioEffectGroupDevice`, `InstrumentGroupDevice`, `PluginDevice`, `AuPluginDevice`, `MxDeviceAudioEffect`, `MxDeviceInstrument`, `MxDeviceMidiEffect`) with truthful 4-dimension capability classification (state preservation, executable DSP/approximation, sonic equivalence, export/reopen fidelity) and valid conversion records so imported sets play and edit cleanly without blocking playback.
- **Reference Corpus Analyzer (`src/engine/alsReferenceAnalyzer.ts`)**:
  - Provide a deterministic read-only analyzer for the reference `.als` corpus (`yanamste.als`, `chlar 3.als`, `raw 3.als`, `hypno 1.als`, `hard techno 1.als`, `hypno 2.als`) that extracts BPM, meter maps, track/group topologies, arrangement clip spans, fractional offsets, loop states, and automation targets without mutating raw XML.

## 2. Ableton Live 12 Group Tracks & Collapsible Arrangement Hierarchy
- **GroupTrack Parsing & Domain Model (`src/types/ableton.ts`, `src/engine/alsXmlEngine.ts`)**:
  - Parse `<GroupTrack>` elements and `<TrackGroupId Value="..." />` routing references from `.als` projects and generated templates.
  - Represent group tracks and child track membership (`groupId`, `isGroupTrack`, `isFolded`) in `AbletonTrack` while keeping full backward compatibility with existing contracts.
- **Collapsible Group Headers & Timeline Editing (`src/components/TimelineCanvas.tsx`, `src/App.tsx`)**:
  - Render collapsible group track headers with fold/unfold chevron toggles, group color coding, summary clip spans when folded, and indented child tracks when unfolded.
  - Add accessible toolbar and lane controls for **Zoom In / Zoom Out** (horizontal time scale & vertical track height), **Insert Clip** at playhead/selection, **Duplicate / Split / Delete Clip**, and layer editing across desktop and mobile viewports.

## 3. Reference-Conditioned Dynamic Project Templates & Multi-Layer Generator
- **Interactive New Project Template Modal (`src/components/NewProjectModal.tsx`, `src/App.tsx`)**:
  - Prompt the producer when creating a new project or full track to choose:
    - **Form Family**: *Full Underground Techno (Dynamic Plateaus & Drops — Default)*, *Subtractive Raw Groove (Staggered Dropouts)*, *Hypnotic Rolling Foundation*, *Dub-Space Evolution*, or *Acid Modular Development*.
    - **Target Duration**: *64 Bars (~3:00)*, *128 Bars (~5:30 Full Track — Default)*, *180 Bars (~5:10 Reference Span)*, or *16–32 Bars Performance Sketch*.
    - **Layer Density & Role Pack**: Multi-layer configuration (~12–19 layers modeled on the reference sets: Dual 909 Kick layers, Sub/Rumble, 3x Synth/Lead Stabs, Tom/Conga/Bongo percussion windows, Clap, Shaker, Granular/Texture layers, Open/Closed Hats, Ride windows, and Return buses).
- **Dynamic Macro Forms & Staggered Layer Windows (`src/engine/songPlanEngine.ts`, `src/engine/alsXmlEngine.ts`)**:
  - Replace the single fixed 6-section weight array with form-family macro profiles featuring staggered kick/bass withdrawals, independent percussion/conga/ride entry windows, unequal/polymetric lead clip phrases, and executable transitions (drum substitutions, filter/drive movement, reverb/delay throws).

## 4. Reference-Length Offline Audio Render & Export (`src/engine/webAudioSynth.ts`)
- **Chunked / Bounded-Memory Long-Track Synthesis**:
  - Support rendering and exporting 5-to-10-minute arrangements (128–180+ bars at 44.1/48 kHz) without hitting the single-buffer 256 MiB `OfflineAudioContext` allocation rejection, preserving stateful tail continuity across render windows and verifying sample finiteness and frame counts.

## 5. End-to-End Verification (G0–G8)
- Verify all reference `.als` files import, validate via `assertProjectState`, play back, edit, and round-trip export without error.
- Run the full unit and integration suite (`npx vitest run`), Python APK verifier (`python3 scripts/test_verify_apk.py`), TypeScript compiler (`tsc --noEmit`), and production build (`npm run build`).
