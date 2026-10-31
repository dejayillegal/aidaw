export type TechnoArchetype =
  | 'kick'
  | 'rumble'
  | 'percussion'
  | 'synth'
  | 'hats'
  | 'acid'
  | 'ride'
  | 'pad'
  | 'existing';

export type NoteGridDivision = '1/4' | '1/8' | '1/16' | '1/32';

export type VoicingSpreadStyle = 'narrow' | 'close' | 'wide' | 'octave';

export type CompositionStrategyId =
  | 'hypnotic_evolving'
  | 'asymmetric_industrial'
  | 'minimal_groove'
  | 'dub_space'
  | 'detroit_funk'
  | 'raw_warehouse'
  | 'acid_modulation'
  | 'peak_rolling';

export type MacroArrangementFormId =
  | 'hypnotic_longform'
  | 'industrial_assault'
  | 'deep_dub_evolution'
  | 'detroit_mechanical'
  | 'asymmetric_experimental';

export type MidiToolTransformationId =
  | 'euclidean'
  | 'rotate'
  | 'invert'
  | 'retrograde'
  | 'ornament'
  | 'recombine'
  | 'span'
  | 'quantize';

export interface MidiNoteEvent {
  id: string;
  time: number; // In beats (e.g., 1.012 with micro-timing shift)
  quantizedTime: number; // Original grid beat (e.g., 1.000)
  duration: number; // In beats (e.g., 0.25)
  pitch: number; // MIDI note 0-127 (e.g., 29 = F1)
  velocity: number; // 1-127
  isGhost: boolean; // True if velocity 20-45 syncopated ghost note
  probability?: number; // 0.0 to 1.0 (Ableton Live 12 note probability)
  motifRole?: 'anchor' | 'call' | 'response' | 'tension' | 'fill';
  isSlide?: boolean; // 303 Acid portamento slide articulation
  isAccent?: boolean; // 303 Acid resonant accent articulation
}

export interface AbletonMidiClip {
  id: string;
  name: string;
  startTime: number; // In beats (0 = Bar 1)
  length: number; // In beats (64 = 16 bars, up to 512 = 128 bars)
  loopEndBeats?: number; // Poly-metered <Loop><LoopEnd> cycle in beats (e.g., 1.75 for 7/16)
  isPolymeter?: boolean; // True when clip uses non-4/4 Euclidean loop markers
  notes: MidiNoteEvent[];
  sceneVariationName?: string;
}

export interface AbletonDeviceParam {
  name: string;
  value: string | number;
  unit?: string;
  automationTarget?: boolean;
}

export interface AbletonDevice {
  id: string;
  xmlTag: string; // e.g., 'Operator', 'Reverb', 'AutoFilter', 'DrumBuss', 'Lfo', 'EQEight', 'Limiter'
  displayName: string;
  category: 'instrument' | 'audio_effect' | 'midi_effect' | 'max_modulator' | 'rack';
  parameters: AbletonDeviceParam[];
  selectionReasoning?: string;
}

export interface AbletonLibraryDeviceTemplate {
  id: string;
  xmlTag: string;
  displayName: string;
  category: 'instrument' | 'audio_effect' | 'midi_effect' | 'max_modulator' | 'rack';
  packName: string;
  description: string;
  defaultParameters: AbletonDeviceParam[];
  xmlSnippet: string;
}

export interface LfoConfig {
  enabled: boolean;
  rateHz: number; // e.g. 0.10 Hz unsynced
  depth: number; // 0.0 to 1.0
  waveform: 'Sine' | 'Triangle' | 'Random';
  targetDevice: string; // e.g. 'AutoFilter'
  targetParam: string; // e.g. 'Cutoff'
  targetParamId: string; // XML Id reference
}

export interface AutomationPoint {
  beat: number; // 0 to arrangementTotalBeats
  value: number; // Normalized 0.0 to 1.0
}

export interface TrackMixerParams {
  volumeDb: number; // -24 to +6 dB (default 0)
  pan: number; // -1.0 (50L) to +1.0 (50R)
  transposeSemitones: number; // -12 to +12 st
  fineTuneCents: number; // -50 to +50 ct
  sidechainDepth: number; // 0.0 to 1.0 (ducking from Kick)
  reverbSend: number; // 0.0 to 1.0 (Return A: Warehouse Reverb)
  delaySend: number; // 0.0 to 1.0 (Return B: 3/16 Dub Echo)
  filterCutoffHz: number; // Track filter cutoff Hz
  filterResonance: number; // 0.1 to 0.9
}

export type VelocityCurvePreset =
  | 'linear'
  | 'exponential'
  | 'inverse'
  | 's_curve'
  | 'accent_4x4'
  | 'random'
  | 'custom';

export type VelocityCurveScope = 'bar_16th' | 'arrangement_16bar';

export interface VelocityCurveConfig {
  preset: VelocityCurvePreset;
  points: number[]; // 16 normalized values (0.0 to 1.0) across the 16 steps or arrangement
  intensity: number; // 0.0 to 1.0 blend between archetype base velocity and curve-mapped velocity
  minVelocity: number; // 1 to 127
  maxVelocity: number; // 1 to 127
  scopeMode: VelocityCurveScope; // 'bar_16th' (1-bar 16th grid) | 'arrangement_16bar' (macro)
}

export interface SpectralDuckingConfig {
  enabled: boolean;
  notchFreqHz: number; // Kick fundamental frequency (e.g., 45 Hz - 65 Hz)
  notchGainDb: number; // -14.0 dB to 0.0 dB dynamic attenuation
  notchQ: number; // 0.7 to 6.0 surgical Q factor
  dynamicThresholdDb: number; // -36 dB to -6 dB
  sidechainThresholdDb?: number; // Alias for sidechain threshold dB
  sidechainRatio: number; // 2.0 to 10.0
  releaseMs: number; // 30 ms to 250 ms
  subCrossoverHz: number; // 80 Hz to 180 Hz
  collisionIndexPct?: number; // Computed overlap percentage before/after ducking
  collisionIndex?: number; // Normalized 0.0 to 1.0 collision ratio
}

export interface PolyrhythmConfig {
  enabled?: boolean;
  steps: number; // 3 to 32 (e.g., 7 for 7/16, 13 for 13/16)
  pulses: number; // 1 to 32
  rotation: number; // 0 to 31
  stepDivision: NoteGridDivision; // '1/4' | '1/8' | '1/16' | '1/32'
  voicingSpread: VoicingSpreadStyle; // 'narrow' | 'close' | 'wide' | 'octave'
  pitchIntervalSemitones?: number; // Optional semitone interval
  accentProbability?: number; // 0.0 to 1.0
  truePolymeterLoop?: boolean; // True = writes <Loop><LoopEnd Value="..." /></Loop>
}

export interface ClearArrangementOptions {
  scope: 'selected_track' | 'unlocked_tracks' | 'all_tracks';
  wipeNotes: boolean;
  wipeAutomation: boolean;
  wipeSessionClips: boolean;
  resetMixerToNeutral: boolean;
  clearNotes?: boolean;
  clearAutomation?: boolean;
  clearSessionClips?: boolean;
  resetMixerLevels?: boolean;
}

export interface AbletonTrack {
  id: string;
  name: string;
  type: 'midi' | 'audio';
  archetype: TechnoArchetype;
  isGenerated: boolean;
  locked?: boolean; // Protects track from bulk regeneration or clearing
  colorIndex: number;
  hexColor: string;
  muted: boolean;
  soloed: boolean;
  devices: AbletonDevice[];
  clips: AbletonMidiClip[];
  sessionClips?: AbletonMidiClip[]; // 4 evolving Session View clip variations (Scene A-D)
  activeSessionSlot?: number; // 0-3
  lfoDrift?: LfoConfig;
  mixer: TrackMixerParams;
  automationPoints: AutomationPoint[]; // Filter/energy automation envelope
  velocityCurve?: VelocityCurveConfig; // Per-track custom or preset velocity curve injected during rehumanization
  spectralDucking?: SpectralDuckingConfig; // Dynamic EQ8 + Compressor2 sidechain spectral ducking config
  polyrhythm?: PolyrhythmConfig; // Per-track Euclidean poly-meter & chord voicing config
  injectedXmlSnippet?: string;
  generationId?: string;
  compositionStrategy?: CompositionStrategyId;
}

export interface MasterBusConfig {
  masterVolumeDb: number; // -12 to +6 dB
  glueCompressionDrive: number; // 0.0 to 1.0
  reverbDecaySec: number; // 1.0 to 6.0 s
  reverbReturnLevel: number; // 0.0 to 1.0
  delayFeedback: number; // 0.1 to 0.85
  delayReturnLevel: number; // 0.0 to 1.0
  subBassMonoCutoffHz: number; // 120 Hz
}

export interface TransportConfig {
  loopEnabled: boolean; // True = Loop region, False = Play full sequence to end
  loopStartBar: number; // 1-indexed
  loopLengthBars: 4 | 8 | 16 | 32 | 64 | 128; // Loop span in bars
  arrangementLengthBars?: 16 | 32 | 64 | 128; // Total arrangement duration in bars
  timelineZoom?: number; // 1.0 to 8.0 horizontal zoom multiplier
  timelineScrollBar?: number; // 0-indexed leftmost visible bar when zoomed in
  gridResolution?: NoteGridDivision; // '1/4' | '1/8' | '1/16' | '1/32'
  showReturnTracks?: boolean; // Show Return A, Return B, and Master lanes in Arrangement View
  metronomeEnabled: boolean;
  followPlayhead: boolean;
  showAutomationLanes: boolean;
  arrangementMode?: 'arrangement' | 'session';
}

export interface HumanizationConfig {
  microTimingMaxShiftBeats: number; // Default 0.012 beats
  velocityVariancePct: number; // Default 0.08 (+/- 8%)
  ghostVelocityMin: number; // Default 20
  ghostVelocityMax: number; // Default 45
  lfoRateHz: number; // Default 0.10 Hz
  lfoDepth: number; // Default 0.42
  cutoffHz: number; // AutoFilter LPF cutoff in Hz (e.g., 145 Hz)
  macroTransition: number; // 0-127 Macro knob value
}

export interface MusicalProjectProfile {
  projectFingerprint: string;
  confirmedTempo: number;
  detectedRootKey: string;
  detectedScale: string;
  harmonicConfidence: number; // 0.0 to 1.0
  kickOnsetSteps: number[]; // 16th-note steps (0-15) occupied by kicks
  hasExistingSubBass: boolean;
  lowEndOccupancyRatio: number; // 0.0 to 1.0
  syncopationIndex: number; // 0.0 to 1.0
  polyrhythmicRatio: string;
  barDensityContour: number[]; // Notes per bar across arrangement
  pitchClassHistogram: number[]; // 12 pitch classes (0=C .. 11=B)
  missingArchetypes: TechnoArchetype[];
  conflictWarnings: string[];
  complementRecommendations: string[];
}

export interface NoveltyValidationMetrics {
  rhythmicNovelty: number; // 0.0 to 1.0
  harmonicNovelty: number; // 0.0 to 1.0
  motifNovelty: number; // 0.0 to 1.0
  arrangementNovelty: number; // 0.0 to 1.0
  sourceCompatibility: number; // 0.0 to 1.0
  kickCollisionFree: boolean;
  candidatesEvaluated: number;
  summaryReason: string;
}

export interface ArrangementSectionNode {
  id: string;
  name: string;
  role:
    | 'Intro'
    | 'Groove_Establish'
    | 'Hypnotic_Lock'
    | 'Tension_Riser'
    | 'Breakdown'
    | 'Peak_Drop'
    | 'Outro';
  startBar: number; // 1-indexed
  endBar: number; // 1-indexed inclusive
  targetEnergy: number; // 0.0 to 1.0
  activeArchetypes: TechnoArchetype[];
  sectionEvent: string;
}

export interface GenerationIdentityRecord {
  generationId: string;
  timestampIso: string;
  projectFingerprint: string;
  compositionSeed: number;
  humanizationSeed: number;
  strategyId: CompositionStrategyId;
  macroFormId: MacroArrangementFormId;
  targetArchetype: TechnoArchetype | 'all';
  noveltyMetrics: NoveltyValidationMetrics;
  musicalReasoning: string;
}

export interface AlsValidationReport {
  isValid: boolean;
  validXmlDom: boolean;
  uniquePointeeIds: boolean;
  validTrackHierarchy: boolean;
  validSidechainRouting: boolean;
  unknownNodesPreserved: boolean;
  roundTripVerified: boolean;
  compatibilityStatus:
    | 'Ableton Live 11/12 Native Verified'
    | 'Inspect & Edit Supported'
    | 'Schema Warning';
  diagnostics: string[];
}

export interface AbletonProjectState {
  fileName: string;
  schemaVersion: string;
  creator: string;
  tempo: number;
  rootKey: string;
  scale: string;
  polyrhythmicGrid: string;
  energyDensity: number; // Notes per bar
  arrangementLengthBars?: 16 | 32 | 64 | 128;
  tracks: AbletonTrack[];
  rawXmlOriginal: string;
  rawXmlModified: string;
  rawByteSize: number;
  estimatedGzipByteSize: number;
  lastActionLog: string;
  musicalProfile?: MusicalProjectProfile;
  arrangementSections?: ArrangementSectionNode[];
  lastGenerationIdentity?: GenerationIdentityRecord;
  alsValidation?: AlsValidationReport;
}

export interface StarterTemplateMeta {
  id: string;
  name: string;
  subtitle: string;
  tempo: number;
  rootKey: string;
  scale: string;
  description: string;
}
