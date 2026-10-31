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
  endTime?: number; // Optional end beat
  length: number; // In beats (64 = 16 bars, up to 512 = 128 bars)
  contentOffsetBeats?: number; // Slip-mode internal clip offset in beats
  loopEndBeats?: number; // Poly-metered <Loop><LoopEnd> cycle in beats (e.g., 1.75 for 7/16)
  isPolymeter?: boolean; // True when clip uses non-4/4 Euclidean loop markers
  notes: MidiNoteEvent[];
  sceneVariationName?: string;
  revision?: number;
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
  type?: string; // Alias for xmlTag
  name?: string; // Alias for displayName
  displayName: string;
  category: 'instrument' | 'audio_effect' | 'midi_effect' | 'max_modulator' | 'rack';
  parameters: AbletonDeviceParam[];
  bypassed?: boolean;
  isUserCreated?: boolean; // True if imported from user's original .als and protected from destructive overwrite
  browserDspSupported?: boolean; // True when Web Audio channel strip renders this device's DSP
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
  editMode?: TimelineEditMode; // 'grid' | 'slip' | 'shuffle' | 'spot'
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

export interface AbletonProjectState {
  fileName: string;
  schemaVersion: string;
  creator: string;
  tempo: number;
  rootKey: string;
  scale: string;
  polyrhythmicGrid: string;
  energyDensity: number; // Notes per bar
  arrangementLengthBars?: 4 | 8 | 16 | 32 | 64 | 128;
  revision?: number;
  projectRevision?: number;
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
