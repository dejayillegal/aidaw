# Baseline Functionality & Zero-Regression Audit

## 1. Repository Inspection Summary
- **Runtime Stack**: React 19.0.1, TypeScript, Vite 8.3.0, Tailwind CSS 4.3.3, Express 4.21.2 (`server.ts`), `@google/genai`, `vite-plugin-pwa`.
- **Core Modules Audited**:
  - `src/types/ableton.ts`: Core types (`TechnoArchetype`, `MidiNoteEvent`, `AbletonMidiClip`, `AbletonDevice`, `AbletonTrack`, `TrackMixerParams`, `MasterBusConfig`, `TransportConfig`, `HumanizationConfig`, `AbletonProjectState`, `StarterTemplateMeta`).
  - `src/engine/alsXmlEngine.ts`: Gzip decompression (`DecompressionStream` + `/api/als/decompress` fallback), XML DOM parser (`parseAbletonXmlDom`), procedural starter generator (`buildStarterAbletonXml`), `TechnoHeuristicEngine` (`generateHumanizedMidiArray`, `getDeviceChainXmlTemplate`, `injectTechnoLayerIntoXml`, `rehumanizeAllProjectTracks`), and `.als` binary compressor (`compressXmlToAlsBlob`).
  - `src/engine/webAudioSynth.ts`: `ParametricWebAudioEngine` with 20ms interval / 120ms Web Audio clock lookahead scheduler, synthesized 909 Kick, Operator Rumble Sub, Collision 3/16 Percussion, Wavetable Hypnotic Stab, 909 Offbeat Hat, kick-ducked sidechain gain envelope, Warehouse Convolver Reverb, 3/16 Ping-Pong Dub Delay, Master Glue Compressor, and `renderArrangementToWavBlob`.
  - `src/components/TimelineCanvas.tsx`: 16-bar Arrangement timeline with loop brace, automation curve editor, track mute/solo/mixer headers, and interactive 16-step MIDI Piano Roll.
  - `src/components/DeviceRackPanel.tsx`: Per-track tuning, sidechain depth, sends, native Ableton device chain inspector, Anti-Slop micro-timing & velocity ghosting controls, LFO drift visualizer, and Master Bus DSP controls.
  - `src/components/MasterSpectrumAnalyzer.tsx`: 20Hz–20kHz logarithmic FFT analyzer with peak-hold trace and frequency hover cursor.
  - `src/components/TouchJamPads.tsx`: Velocity-sensitive multi-touch performance pads for mobile/tablet/desktop.
  - `src/components/XmlInspectorView.tsx` & `src/components/PythonFastApiView.tsx`: XML DOM inspector and FastAPI + `lxml` reference script viewer.

## 2. Verified Baseline Workflows (Preserved 100%)
1. **Starter Template Selection**: `Berghain_Raw_Foundation`, `Tresor_Vault_Industrial`, `Ostgut_Hypnotic_Dub` + `Roll Fresh`.
2. **`.als` File Upload**: Gzipped `.als` and uncompressed `.xml` ingestion via browser `DecompressionStream` and fallback API.
3. **`02. TECHNO LAYER GENERATOR`**: Single-layer XML injection (`rumble`, `percussion`, `synth`, `hats`), `Inject All 4`, and `AI Pattern`.
4. **Transport & Playback**: Play/Stop, `Play Full 16-Bar (No Loop)`, Loop Brace toggle (`4B`, `8B`, `16B`), Metronome click, BPM stepper/input.
5. **Anti-Slop Humanization**: Micro-timing shift, velocity variance, ghost velocity range, LFO rate/depth, cutoff Hz, macro transition, and `Re-Seed Jitter`.
6. **Exports**: `Export Lossless .WAV` (upgraded to support 24-bit PCM studio lossless) and `Export Native .als`.
7. **PWA & Mobile**: Manifest, Service Worker, `PWAInstallButton`, and responsive mobile bottom navigation.
