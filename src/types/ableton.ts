import type { SongPlan } from '../engine/songPlanEngine';
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

export type TimelineEditMode = 'grid' | 'slip' | 'shuffle' | 'spot';

export type SpectrumOverlayMode = 'off' | 'compact_lane' | 'expanded_strip';

export type VcaGroupId =
  | 'drums_vca'
  | 'low_end_vca'
  | 'synths_vca'
  | 'atmos_vca'
  | 'drums'
  | 'bass'
  | 'low_end'
  | 'synths'
  | 'atmos'
  | 'returns'
  | 'unassigned';

export type AbletonDeviceType = string;

export interface VcaGroupState {
  id: VcaGroupId;
  name: string;
  color: string;
  gainDb: number; // -24 to +6 dB non-destructive VCA offset
  muted: boolean;
  soloed: boolean;
}

export interface MemoryLocationMarker {
  id: string;
  number: number; // 1-9 primary slots + extensible
  name: string;
  bar?: number; // 1-indexed bar coordinate
  beat: number; // exact beat coordinate (0-indexed)
  zoomBars?: number;
  color: string;
  comment?: string;
}

export type PlaybackEngineState =
  | 'idle'
  | 'initializing'
  | 'ready'
  | 'playing'
  | 'paused'
  | 'interrupted'
  | 'recovering'
  | 'error';

export type InstrumentGroupCode = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

export type TechnoSubgenreId =
  | 'raw_warehouse'
  | 'hypnotic_deep'
  | 'berlin_industrial'
  | 'detroit_informed'
  | 'dub_techno'
  | 'hardgroove'
  | 'tribal_percussive'
  | 'acid_techno'
  | 'minimal_micro'
  | 'broken_offgrid'
  | 'dark_atmospheric'
  | 'driving_rolling'
  | 'ebm_industrial'
  | 'dub_industrial_hybrid'
  | 'percussive_polyrhythmic'
  | 'experimental_modular';

export interface InstrumentRoleTemplate {
  roleCode: string; // e.g. 'A1', 'B1', 'E2'
  groupCode: InstrumentGroupCode;
  groupName: string;
  name: string;
  archetype: TechnoArchetype;
  defaultTrackName: string;
  defaultColorHex: string;
  frequencyBandHz: [number, number];
  defaultCutoffHz: number;
  defaultResonance: number;
  defaultVolumeDb: number;
  defaultSidechainDepth: number;
  defaultReverbSend: number;
  defaultDelaySend: number;
  vcaGroupId: VcaGroupId;
  description: string;
}

export interface TimelineBarRangeSelection {
  startBar: number; // 1-indexed inclusive
  endBar: number; // 1-indexed exclusive (e.g. startBar=33, endBar=41 is an 8-bar span [33..40])
  startBeat: number; // 0-indexed beat
  endBeat: number; // 0-indexed end beat
  trackId?: string;
}

export type CompositionStrategyId =
  | 'hypnotic_evolving'
  | 'asymmetric_industrial'
  | 'minimal_groove'
  | 'dub_space'
  | 'detroit_funk'
  | 'raw_warehouse'
  | 'acid_modulation'
  | 'peak_rolling'
  | TechnoSubgenreId;

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
  harmonicOwner?: 'voiced-midi'; // Explicit chord ownership: MIDI pitches bypass further Chord expansion.
  id: string;
  sourceNoteClipId?: string; // Exact native source clip for split/consolidated note templates.
  sourceNoteId?: string; // Native note template for preservation during duplication.
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

export interface TrackVelocityRandomizerConfig {
  minVelocity: number;
  maxVelocity: number;
  blendPct: number;
  accentLock: boolean;
  downbeatLock: boolean;
  seed: number;
}

export interface AbletonMidiClip {
  id: string;
  userEdited?: boolean; // Protects manually edited material from scoped composition.
  sourceClipIds?: string[]; // Pending consolidation templates; consumed by the command/XML boundary.
  sourceClipId?: string; // Native clip template for preservation during split/duplicate.
  name: string;
  startTime: number; // In beats (0 = Bar 1)
  endTime?: number; // Optional end beat
  length: number; // In beats (e.g. 16 = 4 bars, 32 = 8 bars, 64 = 16 bars)
  contentOffsetBeats?: number; // Slip-mode internal clip offset in beats
  loopEndBeats?: number; // Poly-metered <Loop><LoopEnd> cycle in beats (e.g., 1.75 for 7/16)
  isPolymeter?: boolean; // True when clip uses non-4/4 Euclidean loop markers
  notes: MidiNoteEvent[];
  sceneVariationName?: string;
  sectionRole?: string;
  color?: string;
  revision?: number;
}

export interface AbletonDeviceParam {
  name: string;
  value: string | number;
  unit?: string;
  automationTarget?: boolean;
}

export interface DeviceConversionRecord {
  sourceDeviceId: string;
  xmlTag: string;
  sourceParameterHash: string;
  conversionVersion: number;
  conversionKind: 'midi_note_transformer' | 'audio_insert_dsp' | 'voice_modulation_lfo';
  generatedDescriptor: Record<string, string | number | boolean>;
  supportedSemantics: string[];
  limitations: string[];
  status: 'valid' | 'invalidated' | 'unconverted';
}

export interface AbletonDevice {
  id: string;
  xmlTag: string; // e.g., 'Operator', 'Reverb', 'AutoFilter', 'DrumBuss', 'Lfo', 'EQEight', 'Limiter'
  type?: string; // Alias for xmlTag
  name?: string; // Alias for displayName
  displayName: string;
  category: 'instrument' | 'audio_effect' | 'midi_effect' | 'max_modulator' | 'rack';
  parameters: AbletonDeviceParam[];
  bypassed?: boolean;
  isUserCreated?: boolean; // True if imported from user's original .als and protected from destructive overwrite
  browserDspSupported?: boolean; // True when Web Audio channel strip renders this device's DSP
  selectionReasoning?: string;
  conversionRecord?: DeviceConversionRecord;
  approximationApproved?: boolean;
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
  volumeDb: number; // -24 to +6 dB (Base Fader level, never overwritten by VCA movements)
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
  sourceTrackId?: string;
  notchFreqHz: number; // Kick fundamental frequency (e.g., 45 Hz - 65 Hz)
  notchGainDb: number; // -14.0 dB to 0.0 dB dynamic attenuation
  notchQ: number; // 0.7 to 6.0 surgical Q factor
  dynamicThresholdDb?: number; // -36 dB to -6 dB
  sidechainThresholdDb?: number; // Alias for sidechain threshold dB
  sidechainRatio: number; // 2.0 to 10.0
  sidechainAttackMs?: number;
  sidechainReleaseMs?: number;
  releaseMs?: number; // 30 ms to 250 ms
  subCrossoverHz?: number; // 80 Hz to 180 Hz
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

export interface CompRangeSegment {
  id: string;
  takeId: string;
  startBeat: number;
  endBeat: number;
  sourceOffsetBeats?: number;
}

export interface AudioActiveRegion {
  id: string;
  startBeat: number;
  endBeat: number;
  peakDb: number;
  rmsDb?: number;
  mutedByStripSilence?: boolean;
}

export interface TrackTakeRecord {
  id: string;
  name: string;
  mediaType?: 'midi' | 'audio';
  createdAt: string;
  sourceClipId?: string;
  mediaRef?: string; // Audio sample reference or synth descriptor
  startBeat?: number;
  endBeat?: number;
  sourceOffsetBeats?: number;
  activeCompRanges?: CompRangeSegment[];
  compSegments?: CompRangeSegment[];
  notes?: MidiNoteEvent[]; // Populated for MIDI takes
  notesSnapshot?: MidiNoteEvent[]; // Alias for MIDI take snapshot
  audioRegions?: AudioActiveRegion[]; // Populated for Audio takes / Strip Silence regions
  activeAudioRegions?: AudioActiveRegion[];
  editHistory?: string[];
}

export interface AudioStripSilenceConfig {
  thresholdDb?: number; // e.g., -38 dB
  thresholdOpenDb?: number;
  thresholdCloseDb?: number;
  hysteresisDb?: number; // e.g., 3.0 dB
  minRegionDurationMs?: number; // e.g., 60 ms
  minActiveDurationMs?: number;
  preRollAttackMs?: number; // e.g., 8 ms
  preAttackPadMs?: number;
  postRollReleaseMs?: number; // e.g., 25 ms
  postReleasePadMs?: number;
}

export interface MidiGhostPruningConfig {
  velocityThreshold: number; // 1 to 127 (prune notes below this velocity)
  minProbability?: number; // 0.0 to 1.0
  probabilityThreshold?: number;
  minDurationBeats: number; // e.g., 0.05 beats
  preserveAnchorMotifs?: boolean; // Protect motifRole === 'anchor'
  onlyPruneFlaggedGhosts?: boolean;
  protectDownbeats?: boolean;
  protectChordTones?: boolean;
  protectAccents?: boolean;
}

export interface AbletonTrack {
  id: string;
  name: string;
  type: 'midi' | 'audio';
  archetype: TechnoArchetype;
  groupId?: string;
  isGroupTrack?: boolean;
  isFolded?: boolean;
  roleCode?: string;
  groupCode?: InstrumentGroupCode;
  isGenerated: boolean;
  locked?: boolean; // Protects track from bulk regeneration or clearing
  colorIndex: number;
  hexColor: string;
  color?: string;
  muted: boolean;
  soloed: boolean;
  vcaGroupId?: VcaGroupId; // Non-destructive VCA group assignment
  automationGainOffsetDb?: number; // Separate automation gain offset in dB
  devices: AbletonDevice[];
  clips: AbletonMidiClip[];
  sessionClips?: AbletonMidiClip[]; // 4 evolving Session View clip variations (Scene A-D)
  activeSessionSlot?: number; // 0-3
  takes?: TrackTakeRecord[]; // Extensible MIDI & Audio comping takes
  activeTakeId?: string;
  audioRegions?: AudioActiveRegion[]; // Non-destructive Audio Strip Silence regions
  lfoDrift?: LfoConfig;
  mixer: TrackMixerParams;
  automationPoints: AutomationPoint[]; // Filter/energy automation envelope
  velocityCurve?: VelocityCurveConfig; // Per-track custom or preset velocity curve injected during rehumanization
  spectralDucking?: SpectralDuckingConfig; // Dynamic EQ8 + Compressor2 sidechain spectral ducking config
  polyrhythm?: PolyrhythmConfig; // Per-track Euclidean poly-meter & chord voicing config
  injectedXmlSnippet?: string;
  generationId?: string;
  compositionStrategy?: CompositionStrategyId;
  dspConfigRevision?: number;
  instrumentDeleted?: boolean;
}

export interface MasterBusConfig {
  masterVolumeDb: number; // -12 to +6 dB
  glueCompressionDrive: number; // 0.0 to 1.0
  reverbDecaySec: number; // 1.0 to 6.0 s
  reverbReturnLevel: number; // 0.0 to 1.0
  delayFeedback: number; // 0.1 to 0.85
  delayReturnLevel: number; // 0.0 to 1.0
  subBassMonoCutoffHz: number; // 120 Hz
  globalGroovePct?: number; // 50 to 75 (Default 50 = straight 16ths, 75 = heavy swing)
  // Limiter-based Gain Staging & ITU-R BS.1770 Workflow
  limiterCeilingDbtp?: number; // Default -1.0 dBTP transparent ceiling
  limiterReleaseMs?: number; // Default 85 ms
  limiterLookaheadMs?: number; // Default 4 ms
  targetIntegratedLufs?: number; // Default -14.0 LUFS (streaming / club calibrated)
  measuredLufs?: number; // Real-time ITU-R BS.1770-4 integrated LUFS
  measuredTruePeakDbtp?: number; // Real-time 4x oversampled True Peak dBTP
  masterAutomationPoints?: AutomationPoint[]; // Automation curve for master volume / filter drops
}

export interface TransportConfig {
  loopEnabled: boolean; // True = Loop region, False = Play full sequence to end
  loopStartBar: number; // 1-indexed
  loopLengthBars: 4 | 8 | 16 | 32 | 64 | 128 | 256 | 512 | 1024 | number; // Loop span in bars
  arrangementLengthBars?: 4 | 8 | 16 | 32 | 64 | 128 | 256 | 512 | 1024 | number; // Total arrangement duration in bars
  timelineZoom?: number; // Continuous horizontal zoom multiplier
  timelineScrollBar?: number; // 0-indexed leftmost visible bar when zoomed in
  gridResolution?: NoteGridDivision; // '1/4' | '1/8' | '1/16' | '1/32'
  editMode?: TimelineEditMode; // 'grid' | 'slip' | 'shuffle' | 'spot'
  showReturnTracks?: boolean; // Show Return A, Return B, and Master lanes in Arrangement View
  metronomeEnabled: boolean;
  followPlayhead: boolean;
  showAutomationLanes: boolean;
  arrangementMode?: 'arrangement' | 'session';
}

export interface HumanizationConfig {
  microTimingMaxShiftBeats: number; // Default 0.012 beats
  swingStrength?: number; // 0 to 100 percentage-based 16th-note swing strength (default 0)
  shuffleSwing?: number; // -100 to 100 adjustable 'Dilla-style' push/pull to the 16th-note grid based on BPM (default 0)
  velocityVariancePct: number; // Default 0.08 (+/- 8%)
  ghostVelocityMin: number; // Default 20
  ghostVelocityMax: number; // Default 45
  lfoRateHz: number; // Default 0.10 Hz
  lfoDepth: number; // Default 0.42
  cutoffHz: number; // AutoFilter LPF cutoff in Hz (e.g., 145 Hz)
  macroTransition: number; // 0-127 Macro knob value
  // Visual MIDI Mapping Tool: Bar-specific micro-timing variance intensity (0.0 = robot, 1.0 = normal, 2.0 = heavy)
  barVarianceIntensity?: Record<number, number>;
}

export interface ReferenceTrackSpectralBands {
  subRatio: number; // 20 - 80 Hz normalized ratio
  lowRatio: number; // 80 - 250 Hz normalized ratio
  midRatio: number; // 250 - 2500 Hz normalized ratio
  highRatio: number; // 2500 - 8000 Hz normalized ratio
  airRatio: number; // 8000 - 20000 Hz normalized ratio
  subBassDb?: number; // 20 - 60 Hz
  lowMidDb?: number; // 60 - 300 Hz
  midDb?: number; // 300 - 2000 Hz
  presenceDb?: number; // 2000 - 6000 Hz
  airDb?: number; // 6000 - 20000 Hz
}

export interface ReferenceTrackLayerProfile {
  archetype: TechnoArchetype;
  detectedName: string;
  energyLevel: number; // 0.0 to 1.0
  frequencyRange: string;
  timbralCharacteristics: string;
  recommendedInstrument: string;
  creativeVariationPrompt: string;
}

export interface ReferenceTrackStructuralSection {
  role: string;
  startBar: number;
  endBar: number;
  targetEnergy: number;
  characteristics: string;
}

export interface ReferenceTrackAnalysisReport {
  id: string;
  fileName: string;
  durationSeconds: number;
  detectedTempo: number;
  detectedRootKey: string;
  detectedScale: string;
  integratedLufs: number;
  truePeakDbtp: number;
  crestFactorDb: number;
  dynamicRangeDb: number;
  spectralBands: ReferenceTrackSpectralBands;
  structuralSections: ReferenceTrackStructuralSection[];
  detectedLayers: ReferenceTrackLayerProfile[];
  grooveProfile: {
    swingPct: number;
    syncopationIndex: number;
    polyrhythmicFeel: string;
  };
  creativeRecommendations: string[];
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

export interface MasterExportPreset {
  id: string;
  version?: number;
  name: string;
  bitDepth: 16 | 24 | 32;
  sampleFormat: 'pcm_int' | 'ieee_float';
  sampleRate: 44100 | 48000 | 96000;
  targetIntegratedLufs: number | null;
  truePeakCeilingDbtp: number;
  normalize: boolean;
  dither: 'none' | 'tpdf';
  isBuiltIn?: boolean;
  aggressiveWarning?: string;
  createdAt?: string;
}

export interface MasterExportVerificationReport {
  presetId: string;
  presetName: string;
  sampleRate?: number;
  bitDepth?: number;
  sampleFormat?: 'pcm_int' | 'ieee_float';
  pass1IntegratedLufs: number;
  preMasterLufs?: number;
  pass1TruePeakDbtp: number;
  preMasterTruePeakDbtp?: number;
  pass1SamplePeakDbfs: number;
  pass1CrestFactorDb: number;
  appliedGainDb: number;
  appliedMakeupGainDb?: number;
  limiterGainReductionDb: number;
  achievedIntegratedLufs: number;
  postMasterLufs?: number;
  achievedTruePeakDbtp: number;
  postMasterTruePeakDbtp?: number;
  achievedSamplePeakDbfs: number;
  achievedCrestFactorDb: number;
  targetCompliant: boolean;
  conflictWarning: string | null;
  targetConflictWarning?: string | null;
  segmentedRenderUsed: boolean;
  segmentCount: number;
  memorySegmentedRenderCount?: number;
  wavHeaderValid: boolean;
  formatTag: number; // 1 = PCM, 3 = IEEE Float
  durationSeconds: number;
  byteSize: number;
}

export type QueueItemState =
  | 'queued'
  | 'importing'
  | 'analyzing'
  | 'ready'
  | 'calibrating'
  | 'preview_ready'
  | 'approved'
  | 'compiling'
  | 'validating'
  | 'exported'
  | 'cancelled'
  | 'failed'
  | 'unsupported';

export interface SmartCalibrationStageAStatic {
  isEstimatedMetadataOnly: true;
  trackCount: number;
  activeMidiTrackCount: number;
  totalMidiNotes: number;
  totalNoteEvents?: number;
  averageNotesPerBar: number;
  averageNoteDensityPerBar?: number;
  existingCompressionCount: number;
  existingSidechainCount: number;
  userProtectedDeviceCount: number;
  inferredFrequencyConflicts: string[];
  lowEndOverlapTrackIds?: string[];
  trackSummaries: {
    trackId: string;
    trackName: string;
    archetype: TechnoArchetype;
    currentVolumeDb: number;
    noteDensityPerBar: number;
    hasExistingEqEight: boolean;
    hasExistingCompressor: boolean;
    hasAutomation: boolean;
  }[];
}

export interface SmartCalibrationStageBMeasured {
  available: boolean;
  status?: 'measured' | 'unavailable';
  unavailableReason?: string;
  integratedLufs: number | null;
  samplePeakDbfs: number | null;
  truePeakDbtp: number | null;
  crestFactorDb: number | null;
  headroomDb: number | null;
  clippingSampleCount: number;
  renderDurationSeconds: number;
}

export interface TrackCalibrationProposalItem {
  trackId: string;
  trackName: string;
  archetype: TechnoArchetype;
  currentVolumeDb: number;
  previousVolumeDb?: number;
  proposedVolumeDb: number;
  deltaDb: number;
  currentPan: number;
  proposedPan: number;
  currentSidechainDepth: number;
  proposedSidechainDepth: number;
  eqSuggestion: string;
  sidechainSuggestion: string;
  rationale?: string;
  reason?: string;
  preservesUserDevices: boolean;
  preservedUserDeviceIds?: string[];
  accepted: boolean;
  approved?: boolean;
}

export interface SmartCalibrationProposal {
  proposalId: string;
  createdAt: string;
  projectRevision: number;
  stageAStatic: SmartCalibrationStageAStatic;
  stageBMeasured: SmartCalibrationStageBMeasured;
  trackProposals: TrackCalibrationProposalItem[];
  trackDeltas: TrackCalibrationProposalItem[];
  masterGainDeltaDb: number;
  proposedMasterVolumeDb: number;
  limitingCeilingDbtp: number;
  targetIntegratedLufs: number;
  predictedIntegratedLufs: number | null;
  projectedLufs?: number | null;
  predictedTruePeakDbtp: number | null;
  projectedTruePeakDbtp?: number | null;
  risks: string[];
  nativeAlsCompatibility: 'Verified Non-Destructive' | 'Metadata-Only Trim' | 'Manual Review Required';
}

export interface SmartCalibrationVerificationReport {
  verifiedAt: string;
  preCalibrationLufs: number | null;
  postCalibrationLufs: number | null;
  preCalibration: SmartCalibrationStageBMeasured;
  postCalibration: SmartCalibrationStageBMeasured;
  requestedTargetLufs: number;
  achievedTruePeakDbtp: number | null;
  achievedHeadroomDb: number | null;
  targetCompliant: boolean;
  userDevicesPreserved: boolean;
  userDevicesIntact?: boolean;
  alsRoundTripValid: boolean;
  alsStructuralValid?: boolean;
  summary: string;
}

export interface QueuedProjectRecord {
  queueId: string;
  originalFileName?: string;
  originalFilename: string;
  binaryChecksumSha256: string;
  sourceSnapshotRef?: string;
  sourceXmlSnapshot?: string;
  workingRevision?: number;
  workingProjectRevision: number;
  importedLiveVersion: string;
  state: QueueItemState;
  analysisCapabilities?: {
    canRenderAudio: boolean;
    hasUnsupportedNativeDevices: boolean;
    missingSampleCount: number;
    unsupportedDeviceNames: string[];
  };
  renderCapabilities?: {
    canRenderAudio?: boolean;
    canSynthesizeOffline?: boolean;
    hasUnsupportedNativeDevices?: boolean;
    hasExternalUnrenderableAudio?: boolean;
    missingSampleCount?: number;
    missingAudioSampleCount?: number;
    unsupportedDeviceNames?: string[];
    unsupportedDeviceTypes?: string[];
    renderAvailability?: 'full_synth' | 'partial_hybrid' | 'metadata_only';
    unavailableReason?: string;
  };
  renderAvailability?: 'full_synth' | 'partial_hybrid' | 'metadata_only';
  project?: AbletonProjectState;
  workingProjectState: AbletonProjectState;
  stageAStatic?: SmartCalibrationStageAStatic;
  stageBMeasured?: SmartCalibrationStageBMeasured;
  calibrationProposal?: SmartCalibrationProposal | null;
  verificationReport?: SmartCalibrationVerificationReport | null;
  validationReport?: AlsValidationReport;
  exportVerification?: MasterExportVerificationReport;
  exportedAlsFilename?: string;
  exportedWavFilename?: string;
  exportedWavBlob?: Blob;
  isMidiExport?: boolean;
  midiIncludeHumanization?: boolean;
  exportedMidiFilename?: string;
  exportedMidiBlob?: Blob;
  exportArtifactRef?: {
    fileName: string;
    byteSize: number;
    checksumSha256: string;
    exportedAt: string;
  } | null;
  errorDetails?: string | null;
  cancelRequested?: boolean;
  cancellationStatus?: 'none' | 'cancelling' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  timestamps?: {
    queuedAt: string;
    startedAt?: string;
    completedAt?: string;
    updatedAt: string;
  };
}

export interface BatchWavExportProgress {
  currentIndex: number;
  totalSelected: number;
  currentQueueId: string;
  currentFilename: string;
  completedCount: number;
  percentage: number;
}

export interface BatchWavExportItemResult {
  queueId: string;
  originalFilename: string;
  exportedWavFilename: string;
  wavBlob: Blob;
  wavArrayBuffer: ArrayBuffer;
  verification?: MasterExportVerificationReport;
  record: QueuedProjectRecord;
}

export interface ProjectAudioSettings {
  humanization: HumanizationConfig;
  masterBus: MasterBusConfig;
  transport: TransportConfig;
}

export interface SessionLaunchEvent {
  id: string;
  trackId: string;
  clipId: string | null; // null is a quantized stop for this track
  atBeat: number; // Same AudioContext-derived musical coordinate as Arrangement
}

export interface SessionPerformanceState {
  quantizationBeats: number;
  events: SessionLaunchEvent[]; // Ordered performance decisions, not a second score
}

export interface TempoAutomationPoint {
  beat: number;
  bpm: number;
  curve?: 'step' | 'linear';
}

export interface MeterChangeEvent {
  bar: number; // 1-indexed bar number where meter change starts
  beat: number; // 0-indexed beat coordinate where meter change starts
  numerator: number; // e.g., 4, 3, 5, 7
  denominator: number; // e.g., 4, 8, 16
}

export type ProjectCreationMode = 'sketch' | 'full-track';

export interface AbletonProjectState {
  songPlan?: SongPlan;
  session?: SessionPerformanceState;
  audioSettings?: ProjectAudioSettings;
  compatibilityWarnings?: string[];
  humanizationSeed?: number;
  generationSeed?: number; // Seed persisted with generated starter XML
  creationMode?: ProjectCreationMode;
  requestedDurationBars?: number;
  ppq?: number; // Canonical integer ticks per quarter note (default 960)
  tempoMap?: TempoAutomationPoint[];
  meterMap?: MeterChangeEvent[];
  fileName: string;
  schemaVersion: string;
  creator: string;
  tempo: number;
  rootKey: string;
  scale: string;
  polyrhythmicGrid: string;
  energyDensity: number; // Notes per bar
  arrangementLengthBars?: 4 | 8 | 16 | 32 | 64 | 128 | 256 | 512 | 1024 | number;
  subgenreId?: TechnoSubgenreId;
  revision?: number;
  projectRevision?: number;
  conversionSchemaVersion?: number;
  tracks: AbletonTrack[];
  memoryLocations?: MemoryLocationMarker[];
  vcaGroups?: VcaGroupState[];
  rawXmlOriginal: string;
  rawXmlModified: string;
  rawXml?: string;
  rawByteSize: number;
  estimatedGzipByteSize: number;
  lastActionLog: string;
  musicalProfile?: MusicalProjectProfile;
  arrangementSections?: ArrangementSectionNode[];
  lastGenerationIdentity?: GenerationIdentityRecord;
  alsValidation?: AlsValidationReport;
  compositionPlan?: {
    generatorVersion: string;
    styleId: string;
    formId: string;
    tonalPlan: string[];
    motifSignatures: string[];
  };
}

export interface StarterTemplateMeta {
  id: string;
  name: string;
  subtitle: string;
  tempo: number;
  rootKey: string;
  scale: string;
  description: string;
  creationMode?: ProjectCreationMode;
  requestedDurationBars?: number;
}

