# Existing API Contracts & Feature Parity Matrix

## 1. Public Engine Contracts Preserved
- `src/types/ableton.ts`:
  - `TechnoArchetype`, `MidiNoteEvent`, `AbletonMidiClip`, `AbletonDeviceParam`, `AbletonDevice`, `LfoConfig`, `AutomationPoint`, `TrackMixerParams`, `AbletonTrack`, `MasterBusConfig`, `TransportConfig`, `HumanizationConfig`, `AbletonProjectState`, `StarterTemplateMeta`
- `src/engine/alsXmlEngine.ts`:
  - `STARTER_TEMPLATES`
  - `rootKeyToMidiBase(rootKey, octave)`
  - `midiNoteToName(midi)`
  - `seededRandom(seed)`
  - `gaussianRandom(mean, stdev, seed)`
  - `decompressAlsFile(file)`
  - `compressXmlToAlsBlob(xmlString)`
  - `formatXmlString(xml)`
  - `buildStarterAbletonXml(templateId, seed)`
  - `parseAbletonXmlDom(xmlString, fileName, rawXmlBaseline)`
  - `injectMidiClipXmlNode(xmlDoc, trackNode, clipName, startTime, length, midiNotesArray)`
  - `injectAnalogDriftXmlNode(xmlDoc, deviceChainNode, lfoRateHz, lfoDepth)`
  - `TechnoHeuristicEngine` (`generateHumanizedMidiArray`, `getDeviceChainXmlTemplate`, `injectTechnoLayerIntoXml`, `rehumanizeAllProjectTracks`)
- `src/engine/webAudioSynth.ts`:
  - `evaluateAutomationAtBeat(points, beat)`
  - `synthEngine` (`setState`, `start`, `stop`, `seek`, `getIsPlaying`, `getAnalyser`, `getAudioContext`, `getByteFrequencyData`, `getFrequencyBinCount`, `triggerLivePad`)
  - `renderArrangementToWavBlob(project, humanization, masterBus, totalBars)`

## 2. v3.0 Additive Extensions
- `src/engine/compositionIntelligenceEngine.ts`:
  - `analyzeProjectMusicalProfile(project)`
  - `composeIntelligentLayer(project, archetype, strategyId, formId, humanization, seed)`
  - `evaluateGenerationNovelty(candidateNotes, project, archetype, history)`
  - `applyLive12MidiTool(notes, toolId, rootKey, scale, seed)`
  - `validateAlsProjectCadence(xmlString)`
  - `generateSectionArrangementPlan(formId, totalBars, tempo)`
- `capacitor.config.ts`:
  - Native Android packaging configuration with WebView low-latency audio & Storage Access Framework settings.
