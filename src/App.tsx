import { ABLETON_BUILTIN_LIBRARY } from './engine/alsXmlEngine';
import { chooseTrackDevice, generateTrackLayer, appendEmptyArrangementClip, appendArrangementNote, ensureAuthoringSongPlan, transformSelectedPhrase } from './engine/authoringActions';
import { prepareProjectChange, applyReviewedProjectChange, type ProjectChangeProposal, type ChangeCategory } from './services/projectChangeReview';
import { ProjectChangeReviewDialog } from './components/ProjectChangeReviewDialog';
import { ProjectInspector, type EditorSelection, type InspectorTab } from './components/ProjectInspector';
import { editProjectBaseTempo } from './engine/projectTempoEditing';
import { clearArrangementContent } from './engine/clearArrangement';
import { ClearArrangementDialog, type ClearArrangementDialogHandle } from './components/ClearArrangementDialog';
import { isPluginDependency } from './engine/pluginDependencies';
import {editArrangementClip,editArrangementNote,toggleArrangementNote} from './engine/arrangementEditing';
import type {ArrangementClipEdit,ArrangementNoteEdit} from './engine/arrangementEditing';
import {createSongPlan,composeSongPlan,materializeSongPlanTrack,songPlanAutomation} from './engine/songPlanEngine';
import { DEFAULT_HUMANIZATION, DEFAULT_MASTER_BUS, DEFAULT_TRANSPORT, projectAudioSettings } from './engine/projectDefaults';
import { beatToBarBeatTick, CANONICAL_PPQ, MAX_SUPPORTED_TIMELINE_BARS } from './engine/timelineCoordinates';
import { decodeProjectSnapshot, encodeProjectSnapshot } from './services/projectSnapshotService';
import { saveExportBlob, saveExportStream, supportsStreamingFileExport, usesNativeStreamingFileExport } from './services/fileExportService';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AbletonProjectState,
  AutomationPoint,
  ClearArrangementOptions,
  CompositionStrategyId,
  GenerationIdentityRecord,
  HumanizationConfig,
  MacroArrangementFormId,
  MasterBusConfig,
  MidiToolTransformationId,
   NoteGridDivision,
  PolyrhythmConfig,
  ProjectAudioSettings,
  QueuedProjectRecord,
  SpectralDuckingConfig,
  TechnoArchetype,
  TimelineBarRangeSelection,
  TimelineEditMode,
  TrackMixerParams,
  TransportConfig,
  VelocityCurveConfig,
  VoicingSpreadStyle,
} from './types/ableton';
import {
  applySpectralAutoDuckToTrackXml,
  applyTrackVelocityCurveToNotes,
  buildStarterAbletonXml,
  clearProjectArrangementXml,
  compressXmlToAlsBlob,
  computeAiSmartMixCalibration,
  decompressAlsFile,
  formatXmlString,
  generatePolymeterEuclideanClipNotes,
  generateSectionArrangementProposal,
  injectLibraryDeviceIntoTrackXml,
  injectMidiClipXmlNode,
  parseAbletonXmlDom,
  parseNativeDeviceEdit,
  STARTER_TEMPLATES,
  syncTrackClipsToXml,
  synchronizeProjectStateToXml,
  TechnoHeuristicEngine,
} from './engine/alsXmlEngine';
import {
  analyzeProjectMusicalProfile,
  applyChordAndGridTransformToNotes,
  applyLive12MidiTool,
  applyMidiQuantizeStrength,
  composeProjectConditionedLayerNotes,
  COMPOSITION_STRATEGIES,
  consolidateTrackClipsInRange,
  createUserTrackFromRole,
  INSTRUMENT_ROLE_TAXONOMY,
  decomposeNotesIntoSectionClips,
  duplicateTrackClip,
  deleteClipsInBeatRange,
  generateClipForBarRange,
  generateContextualAutomationPoints,
  generateSectionArrangementPlan,
  MACRO_ARRANGEMENT_FORMS,
  RangeClipGeneratorMode,
  splitTrackClipAtBeat,
  validateAlsProjectCadence,
  transformTrackArrangementNotes,
  randomizeTrackNoteVelocities,
} from './engine/compositionIntelligenceEngine';
import { renderArrangementToWavBlob, renderArrangementToWavStream, planArrangementWavExport, synthEngine } from './engine/webAudioSynth';
import { TimelineCanvas } from './components/TimelineCanvas';
import { DeviceRackPanel } from './components/DeviceRackPanel';
import { MasterSpectrumAnalyzer } from './components/MasterSpectrumAnalyzer';
import { TouchJamPads } from './components/TouchJamPads';
import { AiComposerIntelligencePanel } from './components/AiComposerIntelligencePanel';
import { PWAInstallButton } from './components/PWAInstallButton';
import { XmlInspectorView } from './components/XmlInspectorView';
import { PythonFastApiView } from './components/PythonFastApiView';
import { SoundCraftMixConsole } from './components/SoundCraftMixConsole';
import { SoundCraftWorkstation } from './components/SoundCraftWorkstation';
import { BulkQueueAndExportModal } from './components/BulkQueueAndExportModal';
import { StudioSettingsModal } from './components/StudioSettingsModal';
import { ReferenceTrackModal } from './components/ReferenceTrackModal';
import { MidiHumanizationHeatmapModal } from './components/MidiHumanizationHeatmapModal';
import {
  TouchInteractionSettingsModal,
  TouchInteractionConfig,
  DEFAULT_TOUCH_CONFIG,
} from './components/TouchInteractionSettingsModal';
import { DiagnosticsPanel } from './components/DiagnosticsPanel';
import { exportClipToMidiFile, downloadMidiFile } from './engine/midiFileExporter';
import {
  CompingAndTransientModal,
  StudioCommandPalette,
} from './components/StudioCommandPalette';
import { StudioMenuBar } from './components/StudioMenuBar';
import { StudioTransportBar } from './components/StudioTransportBar';
import { StudioWorkspaceTabs, WorkspaceTabId } from './components/StudioWorkspaceTabs';
import {
  StudioEditorToolbar,
  StudioEditingTool,
  SpectrumOverlayMode,
} from './components/StudioEditorToolbar';
import { StudioStatusBar } from './components/StudioStatusBar';
import { SelectedTrackAnalysisStrip } from './components/SelectedTrackAnalysisStrip';
import { NewProjectModal } from './components/NewProjectModal';
import { createEditableFullTrack, type NewProjectOptions } from './services/projectCreationService';
import { UnsupportedPluginModal } from './components/UnsupportedPluginModal';
import { TrackVelocityRandomizerConfig } from './components/AiComposerIntelligencePanel';
import {
  projectQueueService,
  StorageStatus,
  RecoveryMigrationStatus,
  BlockedRecoveryRecordInfo,
} from './services/projectQueueService';
import {
  applyNoteEditWithMode,
  createTrackTakeSnapshot,
  queueSessionLaunch,
  storeArrangementClipInSession,
  captureSessionPerformance,
  studioCommandBus,
  upsertMemoryLocationMarker,
} from './services/commandBus';
import {
  Activity,
  Command,
  Cpu,
  Dices,
  Disc,
  Download,
  Eraser,
  FolderUp,
  Grid,
  Layers,
  Lock,
  Music,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  Repeat,
  SkipBack,
  Sliders,
  Sparkles,
  Square,
  Undo2,
  Unlock,
  Wand2,
} from 'lucide-react';

type ActiveWorkspaceTab = 'workbench' | 'xml' | 'python' | 'architecture';
type MobileDawSection =
  | 'arrange'
  | 'pianoroll'
  | 'composer'
  | 'mix_console'
  | 'pads'
  | 'devices'
  | 'spectrum'
  | 'project';
type DesktopBottomTab = 'composer' | 'devices' | 'mix_console' | 'pads' | 'spectrum';

const ARCHETYPE_CATALOG: {
  archetype: TechnoArchetype;
  title: string;
  patternSpec: string;
  deviceChainSpec: string;
  automationSpec: string;
}[] = [
  {
    archetype: 'rumble',
    title: 'Rumble Sub-Bass',
    patternSpec: 'Kick-aware rolling sub + evolving 4-bar Phrygian turnaround',
    deviceChainSpec: 'Operator (Sine) → Reverb → AutoFilter (LPF) → Compressor2',
    automationSpec: '<Lfo> 0.10 Hz Free → AutoFilter.Cutoff',
  },
  {
    archetype: 'acid',
    title: '303 Acid Bassline',
    patternSpec: 'Accented 16th resonant bassline with octave jumps & portamento slides',
    deviceChainSpec: 'Analog (303 Diode) → Overdrive → Roar → Compressor2',
    automationSpec: 'Diode resonance + accent filter envelope sweep',
  },
  {
    archetype: 'percussion',
    title: 'Industrial Percussion',
    patternSpec: 'Euclidean 3/16 & 5/16 call-and-response + turnaround ratchets',
    deviceChainSpec: 'Collision → DrumBuss → Erosion → Saturator',
    automationSpec: 'Transient drive & bandpass cutoff drift',
  },
  {
    archetype: 'synth',
    title: 'Hypnotic Synth Stab',
    patternSpec: 'Scale-conditioned motifs with inversion & displacement',
    deviceChainSpec: 'Wavetable → Echo (3/16) → AutoPan (3/16)',
    automationSpec: 'Echo feedback macro ramp',
  },
  {
    archetype: 'pad',
    title: 'Dub Chord Pad',
    patternSpec: 'Dorian / Phrygian minor 9th dub chord voicings with wide spread',
    deviceChainSpec: 'Drift → ChorusEnsemble → HybridReverb → Compressor2',
    automationSpec: 'Slow lowpass filter breath & stereo shimmer',
  },
  {
    archetype: 'hats',
    title: 'Offbeat 909 Hats',
    patternSpec: '8th offbeat open hat + swung 16th ghost groove & DJ dropouts',
    deviceChainSpec: 'Simpler (909) → Overdrive → AutoFilter (HPF)',
    automationSpec: 'Velocity mapped strictly to envelope decay',
  },
  {
    archetype: 'ride',
    title: '909 Warehouse Ride',
    patternSpec: 'Relentless peak-time 909 metallic cymbal drive with bell accents',
    deviceChainSpec: 'Simpler (909 Ride) → EQEight (HPF 650Hz) → Saturator → Compressor2',
    automationSpec: 'High-shelf shimmer & kick sidechain pump',
  },
];

export function enrichProjectWithAnalysis(
  rawState: AbletonProjectState,
  formId: MacroArrangementFormId
): AbletonProjectState {
  const totalBars = rawState.arrangementLengthBars || 16;
  const musicalProfile = analyzeProjectMusicalProfile(rawState);
  const effectiveForm = rawState.lastGenerationIdentity?.macroFormId || formId;
  const plannedSections = rawState.songPlan?.sections.map(section => ({id:section.id,name:section.name,startBar:section.fromBeat/4+1,endBar:section.toBeat/4,role:({Intro:'Intro',Groove:'Groove_Establish',Development:'Hypnotic_Lock',Breakdown:'Breakdown',Peak:'Peak_Drop',Outro:'Outro'} as const)[section.name as 'Intro'] || 'Hypnotic_Lock',targetEnergy:section.energy,sectionEvent:rawState.songPlan!.transitions.find(t=>t.destinationSection===section.id)?.kind || 'Independent phrase development',activeArchetypes:rawState.songPlan!.roles.filter(role=>role.spans.some(span=>span.fromBeat<section.toBeat&&span.toBeat>section.fromBeat)).map(role=>role.role)}));
  const arrangementSections = plannedSections || rawState.arrangementSections || generateSectionArrangementPlan(effectiveForm, totalBars, rawState.lastGenerationIdentity?.compositionSeed ?? rawState.generationSeed ?? 0);
  const alsValidation = validateAlsProjectCadence(rawState.rawXmlModified);
  return {
    ...rawState,
    arrangementLengthBars: totalBars,
    musicalProfile,
    arrangementSections,
    alsValidation,
  };
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveWorkspaceTab>('workbench');
  const [mobileSection, setMobileSection] = useState<MobileDawSection>('arrange');
  const [desktopBottomTab, setDesktopBottomTab] = useState<DesktopBottomTab>('composer');
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('berghain-134');
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState<boolean>(false);
  const [newProjectBars, setNewProjectBars] = useState(128);
  const [isUnsupportedPluginModalOpen, setIsUnsupportedPluginModalOpen] = useState<boolean>(false);

  // Granular Clear Arrangement state
  const clearDialogRef = useRef<ClearArrangementDialogHandle>(null);

  const [initialCompositionSeed] = useState<number>(
    () => Math.floor(Math.random() * 1000000) + 101
  );
  const [activeStrategyId, setActiveStrategyId] =
    useState<CompositionStrategyId>('hypnotic_evolving');
  const [activeFormId, setActiveFormId] =
    useState<MacroArrangementFormId>('hypnotic_longform');

  const [project, setProject] = useState<AbletonProjectState>(() => {
    const active = projectQueueService.getActiveItem()?.workingProjectState;
    if (active) return active;
    const seed = initialCompositionSeed;
    const { xml, meta } = buildStarterAbletonXml('berghain-134', seed);
    const parsed = parseAbletonXmlDom(xml, meta.name, xml);
    return enrichProjectWithAnalysis(parsed, 'hypnotic_longform');
  });
  const [isRecoveringProject, setIsRecoveringProject] = useState(
    () => projectQueueService.getAllItems().length === 0,
  );

  const [requestedCompositionSeed,setRequestedCompositionSeed]=useState<number>();
  const compositionSeed = requestedCompositionSeed ?? project.songPlan?.seed ?? project.generationSeed ?? project.lastGenerationIdentity?.compositionSeed ?? initialCompositionSeed;
  const jitterSeed = project.humanizationSeed ?? project.lastGenerationIdentity?.humanizationSeed ?? compositionSeed + 79;
  const settings = useMemo(() => projectAudioSettings(project), [project.audioSettings, project.arrangementLengthBars]);
  const humanization = settings.humanization;
  const masterBus = settings.masterBus;
  const transport = useMemo(() => ({ ...settings.transport, arrangementLengthBars: project.arrangementLengthBars || 16 }), [settings.transport, project.arrangementLengthBars]);

  // A pointer to the same current domain object, for ordered commands within a single React batch.
  const projectRef = useRef(project);
  projectRef.current = project;

  const [selectedTrackId, setSelectedTrackId] = useState<string>('1');
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const wavExportAbort=useRef<AbortController|null>(null);
  const wavExportPhase=useRef('idle');
  const [canCancelWavExport,setCanCancelWavExport]=useState(true);
  const [isExportingWav, setIsExportingWav] = useState<boolean>(false);
  const [wavExportProgress, setWavExportProgress] = useState<number>(0);
  const [playheadBeat, setPlayheadBeat] = useState<number>(0);
  const [modulatedCutoffHz, setModulatedCutoffHz] = useState<number>(145.0);
  const [masterPeakDb, setMasterPeakDb] = useState<number>(-60);
  const [masterTruePeakDbtp, setMasterTruePeakDbtp] = useState<number>(-60);
  const [masterLufs, setMasterLufs] = useState<number>(-24);
  const [aiLoadingArchetype, setAiLoadingArchetype] = useState<TechnoArchetype | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>(
    `Ready · ${project.fileName} (${project.tempo} BPM · ${project.rootKey} ${project.scale}).`
  );

  // SoundCraft Workstation & Dock Layout States
  const [pendingProposal,setPendingProposal]=useState<ProjectChangeProposal|null>(null);
  const [inspectorTab,setInspectorTab]=useState<InspectorTab>('inspect');
  const [editorSelection,setEditorSelection]=useState<EditorSelection>();
  const [editorRevealToken,setEditorRevealToken]=useState(0);
  const [browserView,setBrowserView]=useState<'devices'|'tracks'>('devices');
  const [studioWorkspace, setStudioWorkspace] = useState<WorkspaceTabId>('edit');
  const [activeEditingTool, setActiveEditingTool] = useState<StudioEditingTool>('smart');
  const [spectrumOverlayMode, setSpectrumOverlayMode] = useState<SpectrumOverlayMode>('off');
  const [leftDockOpen, setLeftDockOpen] = useState<boolean>(false);
  const [bottomDockOpen, setBottomDockOpen] = useState<boolean>(false);
  const [rightDockOpen, setRightDockOpen] = useState<boolean>(false);
  const [bottomEditorTab, setBottomEditorTab] = useState<'composer' | 'devices' | 'pads' | 'spectrum'>('devices');

  const [editMode, setEditMode] = useState<TimelineEditMode>('grid');
  // Theme & Settings States
  const [themeMode, setThemeMode] = useState<'dark' | 'light'>(() => {
    try {
      return (localStorage.getItem('aidaw_theme_mode') as 'dark' | 'light') || 'dark';
    } catch {
      return 'dark';
    }
  });
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  useEffect(() => {
    try {
      localStorage.setItem('aidaw_theme_mode', themeMode);
    } catch {}
    const root = document.documentElement;
    if (themeMode === 'light') {
      root.classList.add('theme-light');
      root.setAttribute('data-theme', 'light');
    } else {
      root.classList.remove('theme-light');
      root.removeAttribute('data-theme');
    }
  }, [themeMode]);

  const handleSelectTrack = useCallback((trackId: string) => {
    setSelectedTrackId(trackId);
    setEditorSelection(previous=>previous?.trackId===trackId?previous:{trackId});
  }, []);

  const [queueItems, setQueueItems] = useState<QueuedProjectRecord[]>(() =>
    projectQueueService.getAllItems()
  );
  const [activeQueueId, setActiveQueueId] = useState<string | null>(() =>
    projectQueueService.getActiveQueueId()
  );
  const [isBulkQueueModalOpen, setIsBulkQueueModalOpen] = useState<boolean>(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);
  const [isCompingModalOpen, setIsCompingModalOpen] = useState<boolean>(false);
  const [isReferenceModalOpen, setIsReferenceModalOpen] = useState<boolean>(false);
  const [isHeatmapModalOpen, setIsHeatmapModalOpen] = useState<boolean>(false);
  const [isTouchSettingsOpen, setIsTouchSettingsOpen] = useState<boolean>(false);
  const [isDiagnosticsOpen, setIsDiagnosticsOpen] = useState<boolean>(false);
  const [touchConfig, setTouchConfig] = useState<TouchInteractionConfig>(DEFAULT_TOUCH_CONFIG);
  const [commandBusTick, setCommandBusTick] = useState<number>(0);

  const handleApplyLayoutPreset = (
    preset: 'edit' | 'mix' | 'session' | 'sound_design' | 'mastering'
  ) => {
    if (preset === 'edit') {
      setStudioWorkspace('edit');
      setLeftDockOpen(true);
      setBottomDockOpen(true);
      setRightDockOpen(false);
      setBottomEditorTab('composer');
    } else if (preset === 'mix') {
      setStudioWorkspace('mix');
      setLeftDockOpen(false);
      setBottomDockOpen(false);
      setRightDockOpen(false);
    } else if (preset === 'session') {
      setStudioWorkspace('session');
      setLeftDockOpen(true);
      setBottomDockOpen(false);
      setRightDockOpen(false);
    } else if (preset === 'sound_design') {
      setStudioWorkspace('devices');
      setLeftDockOpen(true);
      setBottomDockOpen(true);
      setRightDockOpen(true);
      setBottomEditorTab('devices');
    } else if (preset === 'mastering') {
      setStudioWorkspace('edit');
      setLeftDockOpen(false);
      setBottomDockOpen(true);
      setRightDockOpen(true);
      setSpectrumOverlayMode('expanded_strip');
    }
  };

  // Recovery workflow state
  const [storageStatus, setStorageStatus] = useState<StorageStatus>(() => projectQueueService.getStorageStatus());
  const [migrationStatus, setMigrationStatus] = useState<RecoveryMigrationStatus>(() => projectQueueService.getMigrationStatus());
  const [blockedRecoveryRecords, setBlockedRecoveryRecords] = useState<BlockedRecoveryRecordInfo[]>(() => projectQueueService.getBlockedRecoveryRecords());
  const [recoveryBannerActive, setRecoveryBannerActive] = useState<boolean>(() => projectQueueService.isRecoveryBannerActive());

  const projectSnapshotInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const syncRecoveryServiceState = useCallback(() => {
    setStorageStatus(projectQueueService.getStorageStatus());
    setMigrationStatus(projectQueueService.getMigrationStatus());
    setBlockedRecoveryRecords(projectQueueService.getBlockedRecoveryRecords());
    setRecoveryBannerActive(projectQueueService.isRecoveryBannerActive());
  }, []);

  // Subscribe to ProjectQueueService & StudioCommandBus
  useEffect(() => {
    const unsubQueue = projectQueueService.subscribe(() => {
      const persistence = projectQueueService.getPersistenceStatus();
      if (persistence.status === 'error') {
        setStatusMessage(`Recovery storage warning: ${persistence.error}. Save a native project file.`);
      }
      setQueueItems(projectQueueService.getAllItems());
      commandTargetRef.current = projectQueueService.getActiveQueueId() || 'default_workstation_project';
      setActiveQueueId(projectQueueService.getActiveQueueId());
      syncRecoveryServiceState();
    });
    const unsubCmd = studioCommandBus.subscribe(() => {
      setCommandBusTick((t) => t + 1);
    });
    let cancelled = false;
    if (projectQueueService.getAllItems().length === 0) {
      const initial = projectRef.current;
      void projectQueueService.restorePersistedProjects().then(async restored => {
        if (cancelled) return;
        syncRecoveryServiceState();
        if (restored && projectRef.current === initial) {
          projectRef.current = restored;
          setProject(restored);
          setSelectedTrackId(restored.tracks[0]?.id || '1');
          if (restored.lastGenerationIdentity) {
            setActiveStrategyId(restored.lastGenerationIdentity.strategyId);
            setActiveFormId(restored.lastGenerationIdentity.macroFormId);
          }
          const migStatus = projectQueueService.getMigrationStatus();
          const migNote = migStatus === 'migrated' ? ' (Migrated legacy conversion records)' : '';
          setStatusMessage(`Recovered ${restored.fileName}.${migNote} ${projectQueueService.getPersistenceStatus().error || ''}`.trim());
        } else if (!restored && projectQueueService.getAllItems().length === 0) {
          const recovery = projectQueueService.getPersistenceStatus();
          if (recovery.status === 'error') {
            setStatusMessage(`Recovery blocked: ${recovery.error}. Open a compatible saved project; stored records are unchanged.`);
          } else {
            await projectQueueService.enqueueProjectState(initial);
          }
        }
      }).catch(error => {
        if (!cancelled) {
          syncRecoveryServiceState();
          setStatusMessage(`Recovery failed: ${String(error)}. Open a saved project file.`);
        }
      }).finally(() => {
        if (!cancelled) setIsRecoveringProject(false);
      });
    } else setIsRecoveringProject(false);
    return () => {
      cancelled = true;
      unsubQueue();
      unsubCmd();
    };
  }, [syncRecoveryServiceState]);

  const handleRetryRecovery = useCallback(async () => {
    try {
      setStatusMessage('Retrying project recovery from local storage...');
      const restored = await projectQueueService.retryRecovery();
      syncRecoveryServiceState();
      if (restored) {
        projectRef.current = restored;
        setProject(restored);
        setSelectedTrackId(restored.tracks[0]?.id || '1');
        if (restored.lastGenerationIdentity) {
          setActiveStrategyId(restored.lastGenerationIdentity.strategyId);
          setActiveFormId(restored.lastGenerationIdentity.macroFormId);
        }
        setStatusMessage(`Recovered ${restored.fileName}.`);
      } else {
        const recovery = projectQueueService.getPersistenceStatus();
        if (recovery.status === 'error') {
          setStatusMessage(`Recovery blocked: ${recovery.error}. Open a compatible saved project; stored records are unchanged.`);
        } else {
          setStatusMessage('Recovery completed: no pending projects found in local storage.');
        }
      }
    } catch (error) {
      syncRecoveryServiceState();
      setStatusMessage(`Retry recovery failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [syncRecoveryServiceState]);

  const handleRepairLegacyRecovery = useCallback(async (queueId?: string) => {
    try {
      setStatusMessage('Repairing legacy conversion metadata and validating project...');
      const repaired = await projectQueueService.repairLegacyRecoveryRecord(queueId);
      syncRecoveryServiceState();
      if (repaired) {
        projectRef.current = repaired;
        setProject(repaired);
        setSelectedTrackId(repaired.tracks[0]?.id || '1');
        if (repaired.lastGenerationIdentity) {
          setActiveStrategyId(repaired.lastGenerationIdentity.strategyId);
          setActiveFormId(repaired.lastGenerationIdentity.macroFormId);
        }
        setStatusMessage(`Repaired legacy project ${repaired.fileName}. A valid recovery revision was persisted.`);
      }
    } catch (error) {
      syncRecoveryServiceState();
      setStatusMessage(`Repair blocked: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [syncRecoveryServiceState]);

  const handleExportOriginalRecoveryData = useCallback(async (queueId?: string) => {
    try {
      const exported = await projectQueueService.exportOriginalRecoveryData(queueId);
      if (!exported) {
        setStatusMessage('No original recovery data available to export.');
        return;
      }
      const saved = await saveExportBlob(exported.blob, exported.filename);
      setStatusMessage(`${saved.verified ? 'Exported and verified' : 'Download requested'}: ${exported.filename}`);
    } catch (error) {
      setStatusMessage(`Export original recovery data failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  const handleStartSeparateProject = useCallback(async () => {
    try {
      projectQueueService.acknowledgeWorkspaceTransitionAfterBlockedRecovery();
      syncRecoveryServiceState();
      await handleLoadStarterTemplate(selectedTemplateId, 16, 'sketch');
    } catch (error) {
      setStatusMessage(`Start separate project failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, [selectedTemplateId, syncRecoveryServiceState]);

  const currentProjectQueueKey = activeQueueId || 'default_workstation_project';
  const commandTargetRef = useRef(currentProjectQueueKey);
  commandTargetRef.current = currentProjectQueueKey;

  const handleExecuteProjectCommand = useCallback(
    (
      label: string,
      category:
        | 'transport'
        | 'edit_mode'
        | 'locator'
        | 'mixer'
        | 'vca'
        | 'comping'
        | 'strip_silence'
        | 'ghost_prune'
        | 'calibration'
        | 'clip_edit',
      mutator: (draft: AbletonProjectState) => AbletonProjectState
    ) => {
      try {
        const next = studioCommandBus.executeMutation(
          currentProjectQueueKey, label, category, projectRef.current, mutator, { activeProjectQueueId: commandTargetRef.current }
        );
        const enriched = enrichProjectWithAnalysis(next, activeFormId);
        projectRef.current = enriched;
        setProject(enriched);
        if (activeQueueId) projectQueueService.updateWorkingProjectState(activeQueueId, enriched);
        setStatusMessage(`Executed: ${label}`);
        return enriched;
      } catch (error) {
        setStatusMessage(`Edit rejected: ${error instanceof Error ? error.message : String(error)}`);
      }
    },
    [currentProjectQueueKey, activeFormId, activeQueueId]
  );

  const handleCreateNewProject = async (options: NewProjectOptions) => {
    const loadRevision = ++projectLoadRevision.current;
    try {
      const created = createEditableFullTrack(options);
      // Native state is validated and journaled before active project/transport changes.
      const record = await projectQueueService.enqueueProjectState(created);
      if (loadRevision !== projectLoadRevision.current) return;
      synthEngine.stop(); synthEngine.seek(0);
      setIsPlaying(false); setPlayheadBeat(0);
      projectQueueService.acknowledgeWorkspaceTransitionAfterBlockedRecovery();
      syncRecoveryServiceState();
      projectQueueService.switchActiveProject(record.queueId, projectRef.current);
      const installed = enrichProjectWithAnalysis(created, 'hypnotic_longform');
      projectQueueService.updateWorkingProjectState(record.queueId, installed);
      projectRef.current = installed; setProject(installed);
      setSelectedTrackId(installed.tracks[0]?.id || '1');
      setActiveStrategyId(installed.songPlan!.style);
      setStudioWorkspace('edit'); setActiveTab('workbench');
      const persistence = projectQueueService.getPersistenceStatus();
      setStatusMessage(`Created Full Track: ${installed.fileName} (${options.durationBars} bars, ${options.bpm} BPM, seed ${options.seed}).${persistence.status === 'error' ? ' Recovery storage failed; save a native project file.' : ''}`);
    } catch (error) {
      setStatusMessage(`Project creation failed: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  };

  const updateAudioSettings = <K extends keyof ProjectAudioSettings>(key: K, update: React.SetStateAction<ProjectAudioSettings[K]>) => {
    handleExecuteProjectCommand(`Update ${key}`, 'mixer', draft => {
      const current = projectAudioSettings(draft);
      const next = typeof update === 'function' ? (update as (value: ProjectAudioSettings[K]) => ProjectAudioSettings[K])(current[key]) : update;
      return { ...draft, audioSettings: { ...current, [key]: next } };
    });
  };
  const setMasterBus = (update: React.SetStateAction<MasterBusConfig>) => updateAudioSettings('masterBus', update);
  const setTransport = (update: React.SetStateAction<TransportConfig>) => updateAudioSettings('transport', update);

  const handlePreviewProjectCommand = useCallback((label:string,category:ChangeCategory,mutator:(draft:AbletonProjectState)=>AbletonProjectState)=>{
    try {
      const proposal=prepareProjectChange(commandTargetRef.current,projectRef.current,label,category,mutator);
      setPendingProposal(proposal);setStatusMessage(`Preview ready: ${label}. Review before applying.`);
      return proposal.after;
    } catch(error){setStatusMessage(`Preview rejected: ${error instanceof Error?error.message:String(error)}`);}
  },[]);
  const comparisonBase=useMemo(()=>studioCommandBus.getLatestComparison(currentProjectQueueKey),[currentProjectQueueKey,commandBusTick]);
  const staleProposal=useMemo(()=>Boolean(pendingProposal&&(pendingProposal.sourceQueueId!==currentProjectQueueKey||pendingProposal.baseline!==JSON.stringify(project))),[pendingProposal,currentProjectQueueKey,project]);
  useEffect(()=>{setEditorSelection(undefined);setRequestedCompositionSeed(undefined);},[currentProjectQueueKey]);
  useEffect(()=>{if(!project.tracks.some(t=>t.id===selectedTrackId)){const first=project.tracks[0]?.id||'';setSelectedTrackId(first);setEditorSelection(first?{trackId:first}:undefined);}},[project.tracks,selectedTrackId]);
  const handleEditorSelection=(selection:EditorSelection)=>{setSelectedTrackId(selection.trackId);setEditorSelection(selection);};
  const revealEditor=()=>{setActiveTab('workbench');setStudioWorkspace('edit');setBottomDockOpen(false);setEditorRevealToken(n=>n+1);};
  const revealInspector=(tab:InspectorTab)=>{setActiveTab('workbench');setStudioWorkspace('edit');setRightDockOpen(true);setInspectorTab(tab);};
  const openLayerBrowser=()=>{setActiveTab('workbench');setBrowserView('tracks');setStudioWorkspace('browser');};
  const handleCreateEmptyClip=()=>{
    const next=handleExecuteProjectCommand('Add MIDI clip','clip_edit',draft=>appendEmptyArrangementClip(draft,selectedTrackId,Math.floor(playheadBeat),4));
    const clip=next?.tracks.find(t=>t.id===selectedTrackId)?.clips.at(-1);
    if(clip){setEditorSelection({trackId:selectedTrackId,clipId:clip.id});revealEditor();}
  };
  const handleAddNote=()=>{
    const track=projectRef.current.tracks.find(t=>t.id===selectedTrackId),clip=track?.clips.find(c=>c.id===editorSelection?.clipId)??track?.clips[0];
    if(!clip){setStatusMessage('Add a MIDI clip before adding a note.');return;}
    const next=handleExecuteProjectCommand('Add MIDI note','clip_edit',draft=>appendArrangementNote(draft,selectedTrackId,clip.id));
    const note=next?.tracks.find(t=>t.id===selectedTrackId)?.clips.find(c=>c.id===clip.id)?.notes.at(-1);
    if(note)setEditorSelection({trackId:selectedTrackId,clipId:clip.id,noteId:note.id});
  };
  const handleGenerateSelectedLayer=()=>handlePreviewProjectCommand('Generate selected layer phrase','clip_edit',draft=>generateTrackLayer(draft,selectedTrackId,activeStrategyId,compositionSeed));
  const auditionReviewedProject=(candidate?:AbletonProjectState)=>{
    synthEngine.stop();setIsPlaying(false);
    try {
      const target=candidate?structuredClone(candidate):projectRef.current,settings=projectAudioSettings(target);
      synthEngine.setState(target,settings.humanization,candidate?{...settings.transport,arrangementMode:'arrangement',loopEnabled:false}:settings.transport,settings.masterBus);
      if(candidate){synthEngine.seek(0);synthEngine.start(false);setIsPlaying(synthEngine.getIsPlaying());return synthEngine.getIsPlaying();}
    }catch(error){setStatusMessage(`Audition blocked: ${error instanceof Error?error.message:String(error)}`);}
    return false;
  };
  const cancelReviewedChange=()=>{auditionReviewedProject();setPendingProposal(null);setStatusMessage('Proposal discarded; editable project unchanged.');};
  const applyReviewedChange=()=>{
    if(!pendingProposal)return;auditionReviewedProject();
    const next=handleExecuteProjectCommand(pendingProposal.label,pendingProposal.category,draft=>applyReviewedProjectChange(commandTargetRef.current,draft,pendingProposal));
    if(next){const added=next.tracks.find(t=>!pendingProposal.before.tracks.some(old=>old.id===t.id));if(added)handleSelectTrack(added.id);setPendingProposal(null);}
  };

  const handleUndo = useCallback(() => {
    const restored = studioCommandBus.undo(currentProjectQueueKey);
    if (restored) {
      const enriched = enrichProjectWithAnalysis(restored, activeFormId);
      projectRef.current = enriched;
      setProject(enriched);
      if (activeQueueId) {
        projectQueueService.updateWorkingProjectState(activeQueueId, enriched);
      }
      setStatusMessage('Undo applied.');
    }
  }, [currentProjectQueueKey, activeFormId, activeQueueId]);

  const handleRedo = useCallback(() => {
    const restored = studioCommandBus.redo(currentProjectQueueKey);
    if (restored) {
      const enriched = enrichProjectWithAnalysis(restored, activeFormId);
      projectRef.current = enriched;
      setProject(enriched);
      if (activeQueueId) {
        projectQueueService.updateWorkingProjectState(activeQueueId, enriched);
      }
      setStatusMessage('Redo applied.');
    }
  }, [currentProjectQueueKey, activeFormId, activeQueueId]);

  const handleDropMemoryLocationAtPlayhead = useCallback(() => {
    const existing = project.memoryLocations || [];
    const nextSlot = existing.length < 9 ? existing.length + 1 : ((existing.length % 9) + 1);
    const barNum = beatToBarBeatTick(playheadBeat,project.meterMap,project.ppq).bar;
    handleExecuteProjectCommand(
      `Drop Memory Location [${nextSlot}] at Bar ${barNum}`,
      'locator',
      (draft) => upsertMemoryLocationMarker(draft, nextSlot, `Bar ${barNum}`, playheadBeat)
    );
  }, [project.memoryLocations, project.meterMap, project.ppq, playheadBeat, handleExecuteProjectCommand]);

  useEffect(() => {
    synthEngine.setState(
      project,
      humanization,
      transport,
      masterBus,
      (beat, cutoffMod, peakDb, truePeakDbtp, lufs) => {
        setPlayheadBeat(beat);
        setModulatedCutoffHz(cutoffMod);
        setMasterPeakDb(peakDb);
        if (truePeakDbtp !== undefined) setMasterTruePeakDbtp(truePeakDbtp);
        if (lufs !== undefined) setMasterLufs(lufs);
      },
      (reason?: string) => {
        setIsPlaying(false);
        if (reason) {
          setStatusMessage(reason);
        } else {
          const bars = project.arrangementLengthBars || transport.arrangementLengthBars || 16;
          setStatusMessage(
            `Completed full ${bars}-bar (${bars * 4}-beat) arrangement sequence playthrough.`
          );
        }
      }
    );
  }, [project, humanization, transport, masterBus]);

  const [includeMidiHumanization, setIncludeMidiHumanization] = useState<boolean>(true);

  const handleExportClipToMidi = useCallback(
    async (trackId: string, clipId?: string, includeHumanizationOverride?: boolean) => {
      const targetTrack = project.tracks.find((t) => t.id === trackId);
      if (!targetTrack) return;
      const targetClip =
        (clipId ? targetTrack.clips.find((c) => c.id === clipId) : undefined) ||
        targetTrack.clips[0];
      if (!targetClip) return;

      const useHumanization =
        typeof includeHumanizationOverride === 'boolean'
          ? includeHumanizationOverride
          : includeMidiHumanization;

      const { fileName, blob } = exportClipToMidiFile(
        targetClip,
        targetTrack,
        project.tempo || 134,
        480,
        {
          includeHumanization: useHumanization,
          humanization,
          seed: jitterSeed,
        }
      );
      downloadMidiFile(blob, fileName);
      projectQueueService.enqueueMidiClip(
        targetClip.name,
        targetTrack.name,
        fileName,
        blob,
        blob.size,
        project,
        useHumanization
      );
      setStatusMessage(
        `Exported MIDI Clip "${fileName}" (${targetClip.notes.length} ${
          useHumanization ? 'micro-timed humanized' : 'quantized grid'
        } notes) to Browser & Project Queue.`
      );
    },
    [project, includeMidiHumanization, humanization, jitterSeed]
  );

  useEffect(() => {
    return () => {
      synthEngine.stop();
    };
  }, []);

  const preserveTrackStates = (
    nextState: AbletonProjectState,
    prevState: AbletonProjectState
  ): AbletonProjectState => {
    return {
      ...nextState,
      audioSettings: prevState.audioSettings,
      humanizationSeed: prevState.humanizationSeed,
      creationMode: prevState.creationMode ?? nextState.creationMode,
      requestedDurationBars: prevState.requestedDurationBars ?? nextState.requestedDurationBars,
      ppq: prevState.ppq ?? nextState.ppq,
      tempoMap: prevState.tempoMap ?? nextState.tempoMap,
      meterMap: prevState.meterMap ?? nextState.meterMap,
      lastGenerationIdentity: prevState.lastGenerationIdentity,
      arrangementLengthBars:
        prevState.arrangementLengthBars || nextState.arrangementLengthBars || 16,
      tracks: nextState.tracks.map((ut) => {
        const prev = prevState.tracks.find(
          (pt) => pt.id === ut.id || pt.archetype === ut.archetype
        );
        if (!prev) return ut;
        return {
          ...ut,
          muted: prev.muted,
          soloed: prev.soloed,
          locked: prev.locked,
          sessionClips: prev.sessionClips,
          activeSessionSlot: prev.activeSessionSlot,
          compositionStrategy: prev.compositionStrategy,
          mixer: prev.mixer || ut.mixer,
          velocityCurve: prev.velocityCurve || ut.velocityCurve,
          spectralDucking: prev.spectralDucking || ut.spectralDucking,
          polyrhythm: prev.polyrhythm || ut.polyrhythm,
          automationPoints: prev.automationPoints?.length
            ? prev.automationPoints
            : ut.automationPoints,
        };
      }),
    };
  };

  const buildVelocityCurveLookup = (
    tracks: AbletonProjectState['tracks']
  ): Record<string, VelocityCurveConfig> => {
    const map: Record<string, VelocityCurveConfig> = {};
    tracks.forEach((t) => {
      if (t.velocityCurve) {
        map[t.id] = t.velocityCurve;
        map[t.name] = t.velocityCurve;
        map[t.archetype] = t.velocityCurve;
      }
    });
    return map;
  };

  const projectLoadRevision = useRef(0);
  const handleLoadStarterTemplate = async (
    templateId = selectedTemplateId,
    requestedBars = 16,
    creationMode: 'sketch' | 'full-track' = requestedBars > 16 ? 'full-track' : 'sketch'
  ) => {
    const loadRevision = ++projectLoadRevision.current;
    const freshSeed = Math.floor(Math.random() * 10000000) + 1;

    const nextForm: MacroArrangementFormId =
      templateId === 'tresor-138'
        ? 'industrial_assault'
        : templateId === 'ostgut-128'
        ? 'deep_dub_evolution'
        : 'hypnotic_longform';
    const nextStrategy: CompositionStrategyId =
      templateId === 'tresor-138'
        ? 'asymmetric_industrial'
        : templateId === 'ostgut-128'
        ? 'dub_space'
        : 'hypnotic_evolving';

    const { xml: initialXml, meta } = buildStarterAbletonXml(
      templateId,
      freshSeed,
      creationMode === 'full-track' ? 4 : requestedBars,
      creationMode
    );
    let workingXml = initialXml;
    let parsed = parseAbletonXmlDom(workingXml, meta.name, workingXml);
    parsed = {...parsed, creationMode, requestedDurationBars: requestedBars, arrangementLengthBars: requestedBars};
    if (creationMode === 'full-track') {
      parsed = composeSongPlan(parsed, createSongPlan(parsed, freshSeed, nextStrategy));
      workingXml = synchronizeProjectStateToXml(parsed);
      parsed = {...parsed, rawXmlModified:workingXml, rawXml:workingXml};
    }
    const enriched = enrichProjectWithAnalysis(parsed, nextForm);
    // Persist outgoing work before giving the new project a separate queue/history identity.
    const record = await projectQueueService.enqueueProjectFromXml(meta.name, workingXml);
    if (loadRevision !== projectLoadRevision.current) return;
    if (!record.workingProjectState || record.state === 'failed' || record.state === 'unsupported') {
      setStatusMessage(`Project open failed: ${record.errorDetails || 'starter initialization failed'}`);
      return;
    }
    // Validation passed: now safe to transition active workspace
    synthEngine.stop();
    synthEngine.seek(0);
    setIsPlaying(false);
    setPlayheadBeat(0);
    setSelectedTemplateId(templateId);
    setActiveFormId(nextForm);
    setActiveStrategyId(nextStrategy);

    projectQueueService.acknowledgeWorkspaceTransitionAfterBlockedRecovery();
    syncRecoveryServiceState();
    projectQueueService.switchActiveProject(record.queueId, projectRef.current);
    projectQueueService.updateWorkingProjectState(record.queueId, enriched);
    const baseSettings = projectAudioSettings(enriched);
    const installed: AbletonProjectState = {
      ...enriched,
      creationMode,
      requestedDurationBars: requestedBars,
      arrangementLengthBars: requestedBars,
      audioSettings: {
        ...baseSettings,
        transport: {
          ...baseSettings.transport,
          loopLengthBars: requestedBars,
        },
      },
    };
    projectRef.current = installed;
    setProject(installed);
    setSelectedTrackId(enriched.tracks[0]?.id || '1');
    setStatusMessage(
      `Loaded & Analyzed ${creationMode === 'full-track' ? `Full Track (${requestedBars} Bars)` : `Sketch (${requestedBars} Bars)`}: ${meta.name} (${enriched.tempo} BPM · ${enriched.rootKey} ${enriched.scale} · Strategy: ${nextStrategy}).`
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const loadRevision = ++projectLoadRevision.current;
    try {
      setStatusMessage(`Ingesting ${files.length} .als project file(s) into Studio Queue...`);
      const records = [];
      for (const file of files) {
        records.push(await projectQueueService.enqueueBrowserFile(file));
        if (loadRevision !== projectLoadRevision.current) return;
      }
      const first = records[0];
      if (!first.workingProjectState || first.state === 'failed' || first.state === 'unsupported') {
        throw new Error(first.errorDetails || 'Project initialization failed');
      }
      const enriched = enrichProjectWithAnalysis(first.workingProjectState, activeFormId);
      synthEngine.stop(); synthEngine.seek(0);
      setIsPlaying(false); setPlayheadBeat(0);
      projectQueueService.acknowledgeWorkspaceTransitionAfterBlockedRecovery();
      syncRecoveryServiceState();
      projectQueueService.switchActiveProject(first.queueId, projectRef.current);
      projectQueueService.updateWorkingProjectState(first.queueId, enriched);
      projectRef.current = enriched; setProject(enriched);
      setSelectedTrackId(enriched.tracks[0]?.id || '1');
      if (files.length > 1) setIsBulkQueueModalOpen(true);
      const failures = records.filter(record => record.state === 'failed' || record.state === 'unsupported');
      setStatusMessage(`Ingested ${records.length - failures.length}/${files.length} project(s) · Active: ${files[0].name}. ${failures.length ? `${failures.length} failed; inspect the queue.` : ''} ${enriched.compatibilityWarnings?.join(' ') || ''}`);
    } catch (error) {
      if (loadRevision === projectLoadRevision.current) setStatusMessage(`Failed to parse .als file: ${error instanceof Error ? error.message : String(error)}`);
    } finally { if (fileInputRef.current) fileInputRef.current.value = ''; }
  };

  const syncTrackNotesToXml = (
    currentXml: string,
    trackName: string,
    archetype: TechnoArchetype,
    clipName: string,
    notes: {
      id: string;
      time: number;
      quantizedTime: number;
      duration: number;
      pitch: number;
      velocity: number;
      isGhost: boolean;
    }[],
    clipLengthBeats = 64,
    loopEndBeats?: number
  ): string => {
    const parser = new DOMParser();
    const sanitized = currentXml.replace(/xmlns(:[a-zA-Z0-9_-]+)?="[^"]*"/g, '');
    const xmlDoc = parser.parseFromString(sanitized, 'application/xml');
    const trackEl = Array.from(xmlDoc.querySelectorAll('Tracks > MidiTrack')).find((el) => {
      const eff = el.querySelector('Name > EffectiveName')?.getAttribute('Value') || '';
      return eff === trackName || eff.toLowerCase().includes(archetype);
    });
    if (trackEl) {
      injectMidiClipXmlNode(
        xmlDoc,
        trackEl,
        clipName,
        0,
        clipLengthBeats,
        notes,
        loopEndBeats
      );
      return formatXmlString(new XMLSerializer().serializeToString(xmlDoc));
    }
    return currentXml;
  };

  const handleInjectLayer = (archetype:TechnoArchetype,targetTrackId?:string) => {
    handlePreviewProjectCommand('Generate planned layer','clip_edit',draft=>{
      let track=targetTrackId?draft.tracks.find(t=>t.id===targetTrackId):draft.tracks.find(t=>t.archetype===archetype);
      if(targetTrackId&&(!track||track.archetype!==archetype))throw new Error('LAYER_TARGET: selected role does not match the target');
      if(!track){const role=INSTRUMENT_ROLE_TAXONOMY.find(r=>r.archetype===archetype);if(!role)throw new Error('LAYER_ROLE_UNSUPPORTED');track=createUserTrackFromRole(role.roleCode,draft.tracks.length);draft={...draft,tracks:[...draft.tracks,track]};}
      return generateTrackLayer(draft,track.id,activeStrategyId,compositionSeed);
    });
  };

  const handleInjectAllMissingLayers = () => {
    const bars = project.arrangementLengthBars || 64;
    handlePreviewProjectCommand('Compose complete SongPlan', 'clip_edit', draft => {
      const tracks=[...draft.tracks];
      for(const archetype of ['kick','rumble','hats','percussion','synth','acid','pad','ride'] as TechnoArchetype[]) {
        if(!tracks.some(t=>t.archetype===archetype)) {
          const role=INSTRUMENT_ROLE_TAXONOMY.find(r=>r.archetype===archetype);
          if(role) tracks.push(createUserTrackFromRole(role.roleCode,tracks.length));
        }
      }
      const base={...draft,tracks,arrangementLengthBars:bars};
      const plan=ensureAuthoringSongPlan(base,activeStrategyId,compositionSeed);
      return composeSongPlan(base,plan,{fromBeat:0,toBeat:plan.durationBars*4});
    });
  };

  // Handler: Spectral Auto-Ducking (Dynamic EQEight notch + Compressor2 sidechain into XML & DSP)
  const handleApplySpectralAutoDuck = (trackId: string, config: SpectralDuckingConfig) => {
    handleExecuteProjectCommand('Apply Spectral Auto Duck', 'mixer', (prev) => {
      const targetTrack = prev.tracks.find((t) => t.id === trackId);
      if (!targetTrack) return prev;

      const kickTrack = prev.tracks.find((t) => t.archetype === 'kick') || prev.tracks[0];
      const kickId = kickTrack?.id || '1';

      const updatedXml = applySpectralAutoDuckToTrackXml(
        prev.rawXmlModified,
        trackId,
        targetTrack.name,
        config,
        kickId
      );

      const reParsed = parseNativeDeviceEdit(updatedXml, prev.fileName, prev.rawXmlOriginal);
      const preserved = preserveTrackStates(reParsed, prev);

      const updatedTracks = preserved.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const freshParsedTrack = reParsed.tracks.find((rt) => rt.id === trackId || rt.name === t.name);
        return {
          ...t,
          devices: freshParsedTrack ? freshParsedTrack.devices : t.devices,
          spectralDucking: config,
          mixer: {
            ...t.mixer,
            sidechainDepth: Math.max(t.mixer.sidechainDepth, 0.72),
          },
        };
      });

      setStatusMessage(
        `Spectral Auto-Duck Active on ${targetTrack.name}: Injected <EQEight> Dynamic Notch (${config.notchGainDb} dB @ ${config.notchFreqHz} Hz) + <Compressor2> (${config.sidechainRatio}:1 Sidechain from Track #${kickId}).`
      );

      return enrichProjectWithAnalysis(
        {
          ...preserved,
          tracks: updatedTracks,
          rawXmlModified: updatedXml,
        },
        activeFormId
      );
    });
  };

  // Handler: Inject Ableton Live 12 Built-in Library Device into Track XML
  const handleInjectLibraryDevice = (trackId:string,templateId:string) => {
    const template=ABLETON_BUILTIN_LIBRARY.find(t=>t.id===templateId);
    const mutate=(draft:AbletonProjectState)=>chooseTrackDevice(draft,trackId,templateId);
    if(template?.category==='instrument')handlePreviewProjectCommand(`Choose instrument: ${template.displayName}`,'mixer',mutate);
    else handleExecuteProjectCommand('Insert Library Device','mixer',mutate);
  };

  // Handler: AI Smart Leveling & Anti-Distortion Mix Calibration
  const handleApplySmartLeveling = () => {
    handleExecuteProjectCommand('Apply Smart Leveling', 'calibration', prev => {
      const calibration = computeAiSmartMixCalibration(prev);
      const settings = projectAudioSettings(prev);
      return { ...prev, rawXmlModified: calibration.updatedXml,
        tracks: calibration.updatedTracks,
        audioSettings: { ...settings, masterBus: { ...settings.masterBus, ...calibration.masterBusPatch } } };
    });
  };

  // Handler: Inject Euclidean Polyrhythm / True Polymeter Clip into Ableton XML
  const handleInjectPolyrhythmClip = (trackId: string, config: PolyrhythmConfig) => {
    handlePreviewProjectCommand('Generate Polymeter Clip', 'clip_edit', (prev) => {
      const targetTrack = prev.tracks.find((t) => t.id === trackId);
      if (!targetTrack || targetTrack.locked) return prev;

      const totalBars = prev.arrangementLengthBars || transport.arrangementLengthBars || 16;
      const totalBeats = totalBars * 4;
      const nextSeed = Math.floor(Math.random() * 1000000) + 1;

      const { notes, loopEndBeats, clipName } = generatePolymeterEuclideanClipNotes(
        targetTrack.archetype,
        prev.rootKey,
        prev.scale,
        config,
        humanization,
        totalBars,
        nextSeed
      );

      const updatedTracks = prev.tracks.map((t) => {
        if (t.id !== trackId) return t;
        return {
          ...t,
          polyrhythm: config,
          clips: [
            {
              id: `poly_${trackId}_${Date.now()}`,
              name: clipName,
              startTime: 0,
              length: totalBeats,
              loopEndBeats,
              isPolymeter: Math.abs(loopEndBeats % 4) > 0.001,
              notes,
            },
          ],
        };
      });

      setStatusMessage(
        `Injected Euclidean Polymeter E(${config.pulses},${config.steps}) (${config.stepDivision} grid · ${config.voicingSpread.toUpperCase()} voicing · <LoopEnd Value="${loopEndBeats}" />) into ${targetTrack.name} across ${totalBars} bars.`
      );

      return enrichProjectWithAnalysis(
        {
          ...prev,
          tracks: updatedTracks,
          rawXmlModified: prev.rawXmlModified,
        },
        activeFormId
      );
    });
  };

  // Handler: Apply Chord Voicing Spread, Key/Scale & Note Grid Division
  const handleApplyChordGridTransform = (trackId:string,gridDivision:NoteGridDivision,voicingSpread:VoicingSpreadStyle,customRootKey?:string,customScale?:string) => {
    handlePreviewProjectCommand('Transform selected chord phrase','clip_edit',draft=>{
      const track=draft.tracks.find(t=>t.id===trackId),clip=track?.clips.find(c=>c.id===(editorSelection?.trackId===trackId?editorSelection.clipId:undefined))??track?.clips[0];
      if(!clip||!track)throw new Error('PHRASE_TARGET: choose a MIDI clip');
      return transformSelectedPhrase(draft,trackId,clip.id,(notes,length)=>applyChordAndGridTransformToNotes(notes,customRootKey||draft.rootKey,customScale||draft.scale,gridDivision,voicingSpread,track.archetype,Math.max(1,length/4),compositionSeed).notes);
    });
  };

  // Handler: Granular Clear Arrangement (Preserves DeviceChain!)
  const handleClearArrangement = (options: ClearArrangementOptions) => {
    try { clearArrangementContent(projectRef.current, selectedTrackId, options); }
    catch(error) {return error instanceof Error ? error.message : String(error)}
    const next = handleExecuteProjectCommand('Clear Arrangement', 'clip_edit', draft =>
      clearArrangementContent(draft, selectedTrackId, options));
    return next ? undefined : 'Edit rejected; project and history were preserved.';
  };

  // Handler: Configurable Arrangement Duration (1 to 4096 Bars) - Non-destructive Extent Change
  const handleChangeArrangementLength = (bars: number) => {
    const safeBars = Math.max(1, Math.min(MAX_SUPPORTED_TIMELINE_BARS, Math.round(bars)));
    handleExecuteProjectCommand('Change Arrangement Extent', 'transport', prev => ({
      ...prev, arrangementLengthBars: safeBars,
    }));
    if(project.songPlan) setStatusMessage(`Timeline extent: ${safeBars} bars. Composed score: ${project.songPlan.durationBars} bars. Compose creates material for a changed duration.`);
  };

  const handleApplyMidiTool = (trackId:string,toolId:MidiToolTransformationId) => {
    handlePreviewProjectCommand(`Transform selected phrase: ${toolId}`,'clip_edit',draft=>{
      const track=draft.tracks.find(t=>t.id===trackId),clip=track?.clips.find(c=>c.id===(editorSelection?.trackId===trackId?editorSelection.clipId:undefined))??track?.clips[0];
      if(!clip||!track)throw new Error('PHRASE_TARGET: choose a MIDI clip');
      if(draft.meterMap?.some(m=>m.numerator!==4||m.denominator!==4))throw new Error('MIDI_TOOL_METER: this phrase tool requires 4/4; existing material is unchanged');
      return transformSelectedPhrase(draft,trackId,clip.id,(notes,length)=>applyLive12MidiTool(notes,toolId,draft.rootKey,track.archetype,compositionSeed,Math.max(1,length/4)).notes);
    });
  };

  const handleToggleTrackLock = (trackId: string) => {
    handleExecuteProjectCommand('Toggle Track Lock', 'clip_edit', prev => ({
      ...prev, tracks: prev.tracks.map(t => t.id === trackId ? { ...t, locked: !t.locked } : t),
    }));
  };

  const handleSessionLaunch = (slot: number|null, trackId?: string) => {
    const now=synthEngine.getSessionLaunchBeat();
    const next=handleExecuteProjectCommand(slot===null?'Queue Session Stop':'Queue Session Launch','clip_edit',draft=>
      queueSessionLaunch(draft,trackId || null,slot,now,draft.session?.quantizationBeats || 4));
    if(next) {
      try {
        const settings=projectAudioSettings(next);
        synthEngine.setState(next,settings.humanization,settings.transport,settings.masterBus);
        if (!synthEngine.getIsPlaying()) synthEngine.start(false);
        setIsPlaying(synthEngine.getIsPlaying());
      } catch(error) {setIsPlaying(false);setStatusMessage(`Playback blocked: ${error instanceof Error?error.message:String(error)}`);}
    }
  };
  const handleLaunchSessionScene = (slot: number, trackId?: string) => handleSessionLaunch(slot,trackId);
  const handleReturnToArrangement = () => {
    const next=handleExecuteProjectCommand('Return to Arrangement','transport',draft=>{
      const settings=projectAudioSettings(draft);
      return {...draft,audioSettings:{...settings,transport:{...settings.transport,arrangementMode:'arrangement'}}};
    });
    if(next) {synthEngine.stop();synthEngine.seek(0);setIsPlaying(false);setPlayheadBeat(0);}
  };

  const handleUpdateHumanization = (partial: Partial<HumanizationConfig>, explicitSeed = jitterSeed) => {
    handleExecuteProjectCommand('Humanize Existing Events', 'clip_edit', prev => {
      const oldSettings = projectAudioSettings(prev);
      const nextConfig = { ...oldSettings.humanization, ...partial };
      const updatedXml = TechnoHeuristicEngine.rehumanizeAllProjectTracks(prev.rawXmlModified,
        prev.rootKey, nextConfig, explicitSeed, buildVelocityCurveLookup(prev.tracks), prev.arrangementLengthBars, prev.tempo);
      const parsed = parseAbletonXmlDom(updatedXml, prev.fileName, prev.rawXmlOriginal);
      const preserved = preserveTrackStates(parsed, prev);
      return { ...preserved, humanizationSeed: explicitSeed, audioSettings: { ...oldSettings, humanization: nextConfig }, rawXmlModified: updatedXml };
    });
  };

  const handleRehumanizeAll = () => {
    const seed = Math.floor(Math.random() * 1000000) + 1;

    handleUpdateHumanization({}, seed);
  };

  const handleTogglePlay = () => {
    if (isPlaying) {
      synthEngine.stop();
      setIsPlaying(false);
      setMasterPeakDb(-60);
    } else {
      try {
        synthEngine.setState(projectRef.current, humanization, transport, masterBus);
        synthEngine.start(false);
        setIsPlaying(synthEngine.getIsPlaying());
      } catch(error) {
        setStatusMessage(`Playback blocked: ${error instanceof Error?error.message:String(error)}`);
        setIsPlaying(false);
      }
    }
  };

  const handlePlayCompleteSequence = () => {
    const next=handleExecuteProjectCommand('Play Complete Arrangement','transport',draft=>{
      const settings=projectAudioSettings(draft);
      return {...draft,audioSettings:{...settings,transport:{...settings.transport,arrangementMode:'arrangement',loopEnabled:false}}};
    });
    if (!next) return;
    const settings=projectAudioSettings(next);
    try {
      synthEngine.stop();synthEngine.setState(next,settings.humanization,settings.transport,settings.masterBus);
      synthEngine.seek(0);setPlayheadBeat(0);synthEngine.start(true);setIsPlaying(synthEngine.getIsPlaying());
      setStatusMessage(`Loop OFF · Playing complete ${next.arrangementLengthBars || 16}-bar arrangement.`);
    } catch(error) {setIsPlaying(false);setStatusMessage(`Playback blocked: ${error instanceof Error?error.message:String(error)}`);}
  };

  const handleReturnToZero = () => {
    synthEngine.seek(0);
    setPlayheadBeat(0);
    setStatusMessage('Playhead returned to Bar 1.1.1 (Beat 0.00).');
  };

  const handleUpdateTransport = (partial: Partial<TransportConfig>) => {
    setTransport((prev) => {
      const next = { ...prev, ...partial };
      if (partial.loopEnabled !== undefined) {
        const bars = project.arrangementLengthBars || next.arrangementLengthBars || 16;
        setStatusMessage(
          next.loopEnabled
            ? `Loop Brace ON (${next.loopLengthBars} Bars).`
            : `Loop Brace OFF · Full ${bars}-bar (${bars * 4}-beat) sequence playback enabled.`
        );
      }
      return next;
    });
  };

  const handleUpdateMasterBus = (partial: Partial<MasterBusConfig>) => {
    setMasterBus((prev) => ({ ...prev, ...partial }));
  };

  const handleUpdateTrackMixer = (trackId: string, partial: Partial<TrackMixerParams>) => {
    handleExecuteProjectCommand('Update Track Mixer', 'mixer', prev => ({
      ...prev, tracks: prev.tracks.map(t => t.id === trackId ? { ...t, mixer: { ...t.mixer, ...partial } } : t),
    }));
  };

  const handleUpdateTrackVelocityCurve = (trackId: string, velocityCurve: VelocityCurveConfig, injectImmediately = true) => {
    handleExecuteProjectCommand('Update Track Velocity Curve', 'clip_edit', draft => {
      const transformed = injectImmediately ? transformTrackArrangementNotes(draft, trackId, notes =>
        applyTrackVelocityCurveToNotes(notes, velocityCurve, projectAudioSettings(draft).humanization, draft.humanizationSeed ?? jitterSeed)
      ) : draft;
      const target = draft.tracks.find(track => track.id === trackId);
      if (!target || target.locked) throw new Error('Velocity curve target is missing or locked');
      return { ...transformed, tracks: transformed.tracks.map(track => track.id === trackId ? { ...track, velocityCurve } : track) };
    });
  };

  const handleRandomizeTrackVelocities = (trackId: string, config: TrackVelocityRandomizerConfig) => {
    handlePreviewProjectCommand('Randomize Track Velocities', 'clip_edit', draft =>
      transformTrackArrangementNotes(draft, trackId, notes => randomizeTrackNoteVelocities(notes, config))
    );
  };

  const handleApplyMidiQuantizeStrength = (trackId: string, gridDivision: NoteGridDivision, strengthPct: 50 | 75 | 100) => {
    handlePreviewProjectCommand(`Quantize Track ${strengthPct}% (${gridDivision})`, 'clip_edit', draft =>
      transformTrackArrangementNotes(draft, trackId, notes => applyMidiQuantizeStrength(notes, gridDivision, strengthPct).notes)
    );
  };

  const handleUpdateTrackAutomation = (trackId: string, points: AutomationPoint[]) => {
    handleExecuteProjectCommand('Update Filter Energy Automation', 'mixer', prev => ({
      ...prev, tracks: prev.tracks.map(t => t.id === trackId ? { ...t, automationPoints: points } : t),
    }));
  };

  const handleToggleMute = (trackId: string) => {
    handleExecuteProjectCommand('Toggle Track Mute', 'mixer', prev => ({
      ...prev, tracks: prev.tracks.map(t => t.id === trackId ? { ...t, muted: !t.muted } : t),
    }));
  };

  const handleToggleSolo = (trackId: string) => {
    handleExecuteProjectCommand('Toggle Track Solo', 'mixer', prev => ({
      ...prev, tracks: prev.tracks.map(t => t.id === trackId ? { ...t, soloed: !t.soloed } : t),
    }));
  };

  const handleToggleNoteInTrack = (trackId:string,stepBeat:number,pitch:number,stepDuration=.25,clipId?:string) => {
    handleExecuteProjectCommand('Toggle MIDI Note','clip_edit',draft=>toggleArrangementNote(draft,trackId,stepBeat,pitch,stepDuration,clipId));
  };
  const handleEditArrangementClip = (trackId:string,clipId:string,edit:ArrangementClipEdit) => {
    handleExecuteProjectCommand(`Clip ${edit.kind}`,'clip_edit',draft=>editArrangementClip(draft,trackId,clipId,edit));
  };
  const handleEditArrangementNote = (trackId:string,clipId:string,noteId:string,edit:ArrangementNoteEdit) => {
    handleExecuteProjectCommand(edit.delete?'Delete MIDI note':'Edit MIDI note','clip_edit',draft=>editArrangementNote(draft,trackId,clipId,noteId,edit));
  };

  const [barRangeSelection, setBarRangeSelection] = useState<TimelineBarRangeSelection>({
    startBar: 33,
    endBar: 41,
    startBeat: 128,
    endBeat: 160,
  });

  const handleGenerateClipInRange = useCallback(
    (trackId: string, startBar: number, endBar: number, mode: RangeClipGeneratorMode) => {
      handleExecuteProjectCommand(
        mode==='voiced-midi'||mode==='chord-device' ? `Set ${mode} harmonic ownership (Bars ${startBar}–${endBar-1})` : `Generate ${mode.toUpperCase()} Clip (Bars ${startBar}–${endBar - 1})`,
        'clip_edit',
        (draft) => {
          const targetTrack = draft.tracks.find((t) => t.id === trackId);
          if (!targetTrack) return draft;
          if(targetTrack.locked) throw new Error('SONG_PLAN_TARGET: track is locked');
          if(mode==='voiced-midi'||mode==='chord-device') {
            if(mode==='chord-device'&&!targetTrack.devices.some(d=>d.xmlTag==='MidiChord'&&!d.bypassed))throw new Error('HARMONIC_OWNER: enable a Chord MIDI device first');
            return transformTrackArrangementNotes(draft,trackId,notes=>notes.map(note=>{
              if(note.time<(startBar-1)*4||note.time>=(endBar-1)*4)return note;
              const next={...note};if(mode==='voiced-midi')next.harmonicOwner='voiced-midi';else delete next.harmonicOwner;return next;
            }));
          }

          if(mode !== 'empty') {
            const plan=draft.songPlan??createSongPlan(draft,draft.generationSeed??1,activeStrategyId);
            return composeSongPlan(draft,plan,{fromBeat:(startBar-1)*4,toBeat:(endBar-1)*4,trackId,roleOverride:mode==='chord'?'synth':mode==='bass'?'rumble':mode==='drum'?'kick':'percussion'});
          }
          const { updatedClips, summary } = generateClipForBarRange({
            track: targetTrack,
            startBar,
            endBar,
            mode,
            rootKey: draft.rootKey,
            scale: draft.scale,
            swingStrength: humanization.swingStrength ?? 14,
            tempo: draft.tempo,
            seed: Date.now(),
          });

          const neededBars = Math.max(draft.arrangementLengthBars || 16, endBar - 1);
          const updatedXml = syncTrackClipsToXml(draft.rawXmlModified, trackId, updatedClips);
          setStatusMessage(summary);

          return enrichProjectWithAnalysis(
            {
              ...draft,
              arrangementLengthBars: neededBars,
              rawXmlModified: updatedXml,
              tracks: draft.tracks.map((t) =>
                t.id === trackId ? { ...t, clips: updatedClips } : t
              ),
            },
            activeFormId
          );
        }
      );
    },
    [handleExecuteProjectCommand, humanization.swingStrength, activeFormId]
  );

  const handleSplitClipAtBeat = useCallback(
    (trackId: string, splitBeat: number) => {
      handleExecuteProjectCommand(
        `Split Clip at Bar ${Math.floor(splitBeat / 4) + 1}`,
        'clip_edit',
        (draft) => {
          const targetTrack = draft.tracks.find((t) => t.id === trackId);
          if (!targetTrack) return draft;
          const { clips: nextClips, splitOccurred } = splitTrackClipAtBeat(
            targetTrack.clips,
            splitBeat
          );
          if (!splitOccurred) {
            setStatusMessage('No clip boundary spanned the target split bar.');
            return draft;
          }
          setStatusMessage(
            `Split clip on "${targetTrack.name}" at Bar ${Math.floor(splitBeat / 4) + 1} (${nextClips.length} clips on track).`
          );
          return {
            ...draft,
            tracks: draft.tracks.map((t) => (t.id === trackId ? { ...t, clips: nextClips } : t)),
          };
        }
      );
    },
    [handleExecuteProjectCommand]
  );

  const handleDuplicateClipOnTrack = useCallback(
    (trackId: string, clipId?: string) => {
      handleExecuteProjectCommand('Duplicate Clip', 'clip_edit', (draft) => {
        const targetTrack = draft.tracks.find((t) => t.id === trackId);
        if (!targetTrack || targetTrack.clips.length === 0) return draft;
        const targetClipId = clipId || targetTrack.clips[targetTrack.clips.length - 1].id;
        const { clips: nextClips, duplicatedClip } = duplicateTrackClip(
          targetTrack.clips,
          targetClipId
        );
        if (!duplicatedClip) return draft;
        const neededBars = Math.max(
          draft.arrangementLengthBars || 16,
          Math.ceil((duplicatedClip.startTime + duplicatedClip.length) / 4)
        );
        setStatusMessage(
          `Duplicated clip "${duplicatedClip.name}" to Bar ${Math.floor(duplicatedClip.startTime / 4) + 1}.`
        );
        return {
          ...draft,
          arrangementLengthBars: neededBars,
          tracks: draft.tracks.map((t) => (t.id === trackId ? { ...t, clips: nextClips } : t)),
        };
      });
    },
    [handleExecuteProjectCommand]
  );

  const handleConsolidateClipsInRange = useCallback(
    (trackId: string, startBar: number, endBar: number) => {
      handleExecuteProjectCommand(
        `Consolidate Clips (Bars ${startBar}–${endBar - 1})`,
        'clip_edit',
        (draft) => {
          const targetTrack = draft.tracks.find((t) => t.id === trackId);
          if (!targetTrack) return draft;
          const nextClips = consolidateTrackClipsInRange(
            targetTrack.clips,
            (startBar - 1) * 4,
            (endBar - 1) * 4,
            targetTrack.name
          );
          setStatusMessage(
            `Consolidated Bars ${startBar}–${endBar - 1} into a single contiguous MIDI clip on "${targetTrack.name}".`
          );
          return {
            ...draft,
            tracks: draft.tracks.map((t) => (t.id === trackId ? { ...t, clips: nextClips } : t)),
          };
        }
      );
    },
    [handleExecuteProjectCommand]
  );

  const handleDeleteClipsInRange = useCallback(
    (trackId: string, startBar: number, endBar: number) => {
      handleExecuteProjectCommand(
        `Delete Clip Range (Bars ${startBar}–${endBar - 1})`,
        'clip_edit',
        (draft) => {
          const targetTrack = draft.tracks.find((t) => t.id === trackId);
          if (!targetTrack) return draft;
          const startBeat = (startBar - 1) * 4;
          const endBeat = (endBar - 1) * 4;
          const nextClips = deleteClipsInBeatRange(targetTrack.clips,startBeat,endBeat);
          setStatusMessage(
            `Deleted clip content in Bars ${startBar}–${endBar - 1} on "${targetTrack.name}".`
          );
          return {
            ...draft,
            tracks: draft.tracks.map((t) => (t.id === trackId ? { ...t, clips: nextClips } : t)),
          };
        }
      );
    },
    [handleExecuteProjectCommand]
  );

  const handleAddUserTrackFromRole = useCallback(
    (roleCode: string) => {
      handleExecuteProjectCommand(`Add Track (${roleCode})`, 'mixer', (draft) => {
        const newTrack = createUserTrackFromRole(roleCode, draft.tracks.length);
        setSelectedTrackId(newTrack.id);
        setStatusMessage(
          `Added new Underground Techno Track "${newTrack.name}" (${roleCode}) — select a Bar Range and click + Gen Chord / Bass / Drum Clip.`
        );
        return {
          ...draft,
          tracks: [...draft.tracks, newTrack],
        };
      });
    },
    [handleExecuteProjectCommand]
  );

  const handleUpdateTempo = (newBpm: number) => {
    handleExecuteProjectCommand('Change Tempo', 'transport', prev => editProjectBaseTempo(prev, newBpm));
  };

  const handleSaveProjectSnapshot = async () => {
    try {
      const text = encodeProjectSnapshot(project, humanization, masterBus, transport);
      const blob = new Blob([text], { type: 'application/json' });
      const name = `${project.fileName.replace(/\.(als|xml|aidaw\.json)$/i, '')}.aidaw.json`;
      const saved = await saveExportBlob(blob, name);
      setStatusMessage(`${saved.verified ? 'Saved and verified' : 'Download requested'}: ${name}. External audio assets remain referenced.`);
    } catch (error) { setStatusMessage(`Project save failed: ${error instanceof Error ? error.message : String(error)}`); }
  };

  const handleOpenProjectSnapshot = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const loadRevision = ++projectLoadRevision.current;
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const snapshot = decodeProjectSnapshot(new TextDecoder().decode(bytes));
      // Validate and prepare before replacing active state or interrupting playback.
      if (loadRevision !== projectLoadRevision.current) return;
      const record = await projectQueueService.enqueueProjectState(snapshot.project, file.name, bytes);
      if (loadRevision !== projectLoadRevision.current) return;
      if (record.state === 'failed' || record.state === 'unsupported') throw new Error(record.errorDetails || 'Project initialization failed');
      synthEngine.stop(); synthEngine.seek(0);
      setIsPlaying(false); setPlayheadBeat(0);
      projectQueueService.acknowledgeWorkspaceTransitionAfterBlockedRecovery();
      syncRecoveryServiceState();
      projectQueueService.updateWorkingProjectState(record.queueId, snapshot.project);
      projectQueueService.switchActiveProject(record.queueId, projectRef.current);
      projectRef.current = snapshot.project;
      setProject(snapshot.project);

      if (snapshot.project.lastGenerationIdentity) {
        setActiveStrategyId(snapshot.project.lastGenerationIdentity.strategyId);
        setActiveFormId(snapshot.project.lastGenerationIdentity.macroFormId);
      }
      setSelectedTrackId(snapshot.project.tracks[0]?.id || '1');
      setStatusMessage(`Opened ${file.name}. External assets remain referenced; missing assets are not embedded in the project file.`);
    } catch (error) { if (loadRevision === projectLoadRevision.current) setStatusMessage(`Project open failed: ${error instanceof Error ? error.message : String(error)}`); }
    finally { if (projectSnapshotInputRef.current) projectSnapshotInputRef.current.value = ''; }
  };

  const handleExportNativeAls = async () => {
    try {
      setStatusMessage(
        'Compressing modified XML DOM into native gzipped Ableton Live .als binary...'
      );
      const { blob, gzipBytes } = await compressXmlToAlsBlob(synchronizeProjectStateToXml(project));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const cleanBase = project.fileName.replace(/\.als$/i, '').replace(/\.xml$/i, '');
      const exportName = `${cleanBase}_parametric_techno.als`;
      a.href = url;
      a.download = exportName;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMessage(
        `Exported ${exportName} (${(gzipBytes / 1024).toFixed(1)} KB gzipped .als) — ALS interchange saved. Parametric mixer/energy automation uses app metadata; native Live playback requires validation.`
      );
    } catch (err: any) {
      setStatusMessage(`Export failed: ${err.message}`);
    }
  };

  const handleExportLosslessWav = async (
    bitDepth: 16 | 24 = 24,
    options?: { stream?: boolean; sampleRate?: 44100 | 48000 | 96000 },
  ) => {
    if (wavExportAbort.current) return;
    const control = new AbortController();
    wavExportAbort.current = control;
    wavExportPhase.current = 'rendering';
    setCanCancelWavExport(true);
    const totalBars =
      project.arrangementLengthBars || transport.arrangementLengthBars || 16;
    const sampleRate = options?.sampleRate ?? 44100;
    const streaming = options?.stream || usesNativeStreamingFileExport();
    const exportName = `${project.fileName.replace(/\.(als|xml)$/i, '')}_${project.tempo}bpm_${totalBars}bars_${bitDepth}bit.wav`;
    const progress = (percent: number) => {
      setWavExportProgress(Math.min(99, Math.floor(percent)));
      setStatusMessage(
        `Exporting complete ${totalBars}-bar arrangement (${sampleRate} Hz / ${bitDepth}-bit): ${Math.floor(percent)}%`,
      );
    };
    try {
      setIsExportingWav(true);
      setWavExportProgress(0);
      if (streaming) {
        const plan = planArrangementWavExport(
          project,
          masterBus,
          sampleRate,
          bitDepth,
          totalBars,
        );
        setStatusMessage(
          'Choose a destination. The complete arrangement will render directly to that file.',
        );
        const result = await saveExportStream(
          exportName,
          plan.sizeBytes,
          async (write) =>
            renderArrangementToWavStream(
              project,
              humanization,
              masterBus,
              write,
              {
                sampleRate,
                bitDepth,
                totalBars,
                onProgress: progress,
                signal: control.signal,
              },
            ),
          control.signal,
          (phase) => {
            wavExportPhase.current = phase;
            setCanCancelWavExport(phase !== 'verifying');
            if (phase === 'verifying')
              setStatusMessage('Verifying the saved file; please wait...');
          },
        );
        setWavExportProgress(100);
        setStatusMessage(
          `${result.verified ? 'Saved and verified' : 'Saved (file size checked)'}: ${exportName} (${(plan.sizeBytes / (1024 * 1024)).toFixed(2)} MB · ${plan.durationSeconds.toFixed(1)}s · ${sampleRate} Hz/${bitDepth}-bit).`,
        );
      } else {
        setStatusMessage(
          `Rendering complete ${totalBars}-bar arrangement (${sampleRate} Hz / ${bitDepth}-bit)...`,
        );
        const { blob, durationSeconds } = await renderArrangementToWavBlob(
          project,
          humanization,
          masterBus,
          totalBars,
          bitDepth,
          progress,
          control.signal,
        );
        const saved = await saveExportBlob(blob, exportName, control.signal, phase => {
          wavExportPhase.current = phase;
          setCanCancelWavExport(phase !== 'verifying');
          if (phase === 'verifying') setStatusMessage('Finalizing the saved file; please wait...');
        });
        setWavExportProgress(100);
        setStatusMessage(
          `${saved.verified ? 'Saved and verified' : 'Download requested'}: ${exportName} (${(blob.size / (1024 * 1024)).toFixed(2)} MB · ${durationSeconds.toFixed(1)}s · 44.1kHz/${bitDepth}-bit PCM).`,
        );
      }
    } catch (error) {
      const e = error as Error;
      setStatusMessage(
        e.name === 'AbortError' ||
          /SAVE_CANCELLED|Save cancelled/.test(e.message)
          ? 'WAV export cancelled; partial destination discarded.'
          : `Lossless WAV render failed: ${e.message}`,
      );
    } finally {
      if (wavExportAbort.current === control) wavExportAbort.current = null;
      setIsExportingWav(false);
    }
  };
  const selectedTrack = project.tracks.find((t) => t.id === selectedTrackId) || project.tracks[0];
  const hasSubOrRumble = project.tracks.some((t) => t.archetype === 'rumble');
  const activeTotalBars = project.arrangementLengthBars || transport.arrangementLengthBars || 16;

  const handleApplyNoteEditModeOperation = useCallback(
    (
      trackId: string,
      noteId: string,
      targetBeat: number,
      mode: TimelineEditMode,
      gridStepBeats: number,
      clipId?: string
    ) => {
      handleExecuteProjectCommand(
        `Move Note (${mode.toUpperCase()} Mode) to Beat ${targetBeat.toFixed(2)}`,
        'edit_mode',
        (draft) => {
          const track = draft.tracks.find(t => t.id === trackId);
          const clipIndex = track?.clips.findIndex(c => (!clipId || c.id === clipId) && c.notes.some(n => n.id === noteId)) ?? -1;
          return clipIndex < 0 ? draft : applyNoteEditWithMode(draft, trackId, clipIndex, noteId, targetBeat, mode, gridStepBeats);
        }
      );
    },
    [handleExecuteProjectCommand]
  );

  const handleExecuteStudioCommand = useCallback(
    (commandId: string) => {
      switch (commandId) {
        case 'transport.togglePlay':
          handleTogglePlay();
          break;
        case 'transport.stopAndRewind':
          synthEngine.stop();
          setIsPlaying(false);
          handleReturnToZero();
          break;
        case 'edit.undo':
          handleUndo();
          break;
        case 'edit.redo':
          handleRedo();
          break;
        case 'editMode.grid':
          setEditMode('grid');
          setStatusMessage('Edit Mode switched to GRID (Quantized Snap).');
          break;
        case 'editMode.slip':
          setEditMode('slip');
          setStatusMessage('Edit Mode switched to SLIP (Sub-Grid Free).');
          break;
        case 'editMode.shuffle':
          setEditMode('shuffle');
          setStatusMessage('Edit Mode switched to SHUFFLE (Contiguous Ripple).');
          break;
        case 'editMode.spot':
          setEditMode('spot');
          setStatusMessage('Edit Mode switched to SPOT (Exact Bar.Beat.16th Coordinate).');
          break;
        case 'locator.dropAtPlayhead':
          handleDropMemoryLocationAtPlayhead();
          break;
        case 'workspace.mixConsole':
          setActiveTab('workbench');
          setDesktopBottomTab('mix_console');
          setMobileSection('mix_console');
          break;
        case 'comping.createSnapshotTake':
          if (selectedTrack) {
            handleExecuteProjectCommand(
              `Snapshot Comp Take on ${selectedTrack.name}`,
              'comping',
              (draft) => createTrackTakeSnapshot(draft, selectedTrack.id)
            );
          }
          break;
        case 'comping.openTransientTools':
          setIsCompingModalOpen(true);
          break;
        case 'batch.openQueueModal':
          setIsBulkQueueModalOpen(true);
          break;
        case 'batch.calibrateActiveProject':
          handleApplySmartLeveling();
          break;
        case 'arrangement.generateSectionProposal': {
          const proposal = generateSectionArrangementProposal(project);
          handleExecuteProjectCommand(
            'Generate Section Arrangement Proposal',
            'clip_edit',
            (draft) => {
              const enriched = {
                ...draft,
                tracks: proposal.proposedTracks,
              };
              return enrichProjectWithAnalysis(enriched, activeFormId);
            }
          );
          setStatusMessage(proposal.summary);
          break;
        }
        default:
          break;
      }
    },
    [
      handleTogglePlay,
      handleUndo,
      handleRedo,
      handleDropMemoryLocationAtPlayhead,
      selectedTrack,
      handleExecuteProjectCommand,
      project,
      activeFormId,
    ]
  );

  // Global Studio Keyboard Shortcuts (Cmd/Ctrl+K, Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z, F1-F4)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isRecoveringProject) return;
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsCommandPaletteOpen((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        setIsBulkQueueModalOpen((v) => !v);
        return;
      }
      if ((e.metaKey || e.ctrlKey) && !isInput && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
        return;
      }
      if (!isInput) {
        if (e.key === 'F1') {
          e.preventDefault();
          setEditMode('grid');
        } else if (e.key === 'F2') {
          e.preventDefault();
          setEditMode('slip');
        } else if (e.key === 'F3') {
          e.preventDefault();
          setEditMode('shuffle');
        } else if (e.key === 'F4') {
          e.preventDefault();
          setEditMode('spot');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleUndo, handleRedo, isRecoveringProject]);

  const unsupportedPluginCount = useMemo(() => project.tracks.reduce((count, track) =>
    count + track.devices.filter(isPluginDependency).length, 0), [project.tracks]);

  // A placeholder must never accept edits under the recovered project's queue ID.
  if (isRecoveringProject) return (
    <main className="studio-shell h-dvh grid place-items-center bg-[#080A0D] text-[#F1F5F9]" aria-busy="true">
      <p role="status">Restoring saved projects…</p>
    </main>
  );

  return (
    <div className="studio-shell h-dvh w-full overflow-hidden grid grid-cols-[minmax(0,1fr)] bg-[#080A0D] text-[#F1F5F9] select-none font-sans">
      {/* 1. TOP 28px SOUNDCRAFT STUDIO MENU BAR */}
      <StudioMenuBar
        projectName={project.fileName}
        canUndo={studioCommandBus.canUndo(currentProjectQueueKey)}
        canRedo={studioCommandBus.canRedo(currentProjectQueueKey)}
        themeMode={themeMode}
        onToggleTheme={(mode) => setThemeMode(mode)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onNewProject={() => { setNewProjectBars(128); setIsNewProjectModalOpen(true); }}
        onCreateProjectWithMode={(mode, bars) => {
          if (mode === 'full-track' || bars >= 32) {
            setNewProjectBars(bars); setIsNewProjectModalOpen(true);
          } else {
            void handleLoadStarterTemplate(selectedTemplateId, bars, mode);
          }
        }}
        onReportStatus={setStatusMessage}
        onSaveProject={() => { void handleSaveProjectSnapshot(); }}
        onOpenProject={() => projectSnapshotInputRef.current?.click()}
        onImportAlsClick={() => fileInputRef.current?.click()}
        onExportAls={handleExportNativeAls}
        onExportWav={() => handleExportLosslessWav(24)}
        onExportFileWav={()=>handleExportLosslessWav(24,{stream:true,sampleRate:48000})}
        fileWavAvailable={supportsStreamingFileExport()}
        onOpenQueueModal={() => setIsBulkQueueModalOpen(true)}
        onOpenClearModal={() => clearDialogRef.current?.show()}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onOpenCompingModal={() => setIsCompingModalOpen(true)}
        onSwitchWorkspace={(ws) => {
          setActiveTab('workbench');
          setStudioWorkspace(ws);
        }}
        onToggleTracks={() => setLeftDockOpen(v => !v)}
        onToggleEditor={revealEditor}
        onToggleInspector={() => revealInspector('inspect')}
        onCompare={() => revealInspector('compare')}
        onResetLayout={() => handleApplyLayoutPreset('edit')}
        onOpenXmlInspector={() => setActiveTab('xml')}
        onOpenPythonExporter={() => setActiveTab('python')}
        onOpenArchitectureModal={() => setActiveTab('architecture')}
        onOpenDiagnostics={() => setIsDiagnosticsOpen(true)}
      />

      <input ref={projectSnapshotInputRef} type="file" accept=".aidaw.json,application/json"
        onChange={handleOpenProjectSnapshot} className="hidden" aria-label="Open saved DAW project" />
      {/* Hidden File Input for .als Import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".als"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* 2. TOP 48px PRECISION STUDIO TRANSPORT BAR */}
      <StudioTransportBar
        isPlaying={isPlaying}
        playheadBeat={playheadBeat}
        tempo={project.tempo}
        meterMap={project.meterMap}
        ppq={project.ppq}
        transport={transport}
        masterPeakDb={masterPeakDb}
        masterTruePeakDbtp={masterTruePeakDbtp}
        masterLufs={masterLufs}
        canUndo={studioCommandBus.canUndo(currentProjectQueueKey)}
        canRedo={studioCommandBus.canRedo(currentProjectQueueKey)}
        editMode={editMode}
        onTogglePlay={handleTogglePlay}
        onStop={() => { synthEngine.stop(); setIsPlaying(false); setMasterPeakDb(-60); }}
        onRewindToStart={handleReturnToZero}
        onUpdateTempo={handleUpdateTempo}
        onUpdateTransport={handleUpdateTransport}
        onChangeEditMode={setEditMode}
        onUndo={handleUndo}
        onRedo={handleRedo}
      />

      {/* 3. 34px WORKSPACE SWITCHER TABS & DOCK TOGGLES */}
      <StudioWorkspaceTabs
        activeTab={studioWorkspace}
        leftDockOpen={leftDockOpen}
        bottomDockOpen={bottomDockOpen}
        rightDockOpen={rightDockOpen}
        onSelectTab={(tab) => {
          setActiveTab('workbench');
          if(tab==='browser')setBrowserView('devices');
          setStudioWorkspace(tab);
        }}
        onToggleLeftDock={() => setLeftDockOpen((v) => !v)}
        onToggleBottomDock={revealEditor}
        onToggleRightDock={() => setRightDockOpen((v) => !v)}
        onApplyLayoutPreset={handleApplyLayoutPreset}
      />

      {/* 4. SOUNDCRAFT PROFESSIONAL DAW WORKSTATION BODY (CSS GRID CELL) */}
      <div className="studio-main min-h-0 min-w-0 flex flex-col overflow-hidden">
        {unsupportedPluginCount > 0 && <button type="button" className="shrink-0 p-2 text-xs text-amber-200 bg-amber-950/50" onClick={() => setIsUnsupportedPluginModalOpen(true)}>
          Resolve plugin dependencies ({unsupportedPluginCount})
        </button>}
        {activeTab === 'workbench' && (
          <SoundCraftWorkstation key={currentProjectQueueKey}
            editorSelection={editorSelection}
            onEditorSelectionChange={handleEditorSelection}
            editorRevealToken={editorRevealToken}
            onOpenLayerBrowser={openLayerBrowser}
            onCreateClip={handleCreateEmptyClip}
            onAddNote={handleAddNote}
            browserView={browserView}
            onAddGeneratedLayer={roleCode=>handlePreviewProjectCommand('Add layer with phrase','clip_edit',draft=>{const track=createUserTrackFromRole(roleCode,draft.tracks.length);return generateTrackLayer({...draft,tracks:[...draft.tracks,track]},track.id,activeStrategyId,compositionSeed);})}
            renderInspector={assist=><ProjectInspector project={project} track={selectedTrack} selection={editorSelection} tab={inspectorTab} onTab={setInspectorTab} onSelect={handleEditorSelection} onCreateClip={handleCreateEmptyClip} onAddNote={handleAddNote} onGenerate={handleGenerateSelectedLayer} onEditClip={handleEditArrangementClip} onEditNote={handleEditArrangementNote} onRename={name=>handleExecuteProjectCommand('Rename layer','clip_edit',draft=>({...draft,tracks:draft.tracks.map(t=>t.id===selectedTrackId?{...t,name}:t)}))} comparison={comparisonBase}>{assist}</ProjectInspector>}
            activeTab={activeTab}
            studioWorkspace={studioWorkspace}
            activeEditingTool={activeEditingTool}
            editMode={editMode}
            spectrumOverlayMode={spectrumOverlayMode}
            leftDockOpen={leftDockOpen}
            bottomDockOpen={bottomDockOpen}
            rightDockOpen={rightDockOpen}
            bottomEditorTab={bottomEditorTab}
            project={project}
            selectedTrack={selectedTrack}
            selectedTrackId={selectedTrackId}
            playheadBeat={playheadBeat}
            modulatedCutoffHz={modulatedCutoffHz}
            humanization={humanization}
            transport={transport}
            masterBus={masterBus}
            masterPeakDb={masterPeakDb}
            isPlaying={isPlaying}
            isExportingWav={isExportingWav}
            wavExportProgress={wavExportProgress}
            activeTotalBars={activeTotalBars}
            activeStrategyId={activeStrategyId}
            activeFormId={activeFormId}
            onChangeCompositionSeed={setRequestedCompositionSeed}
            compositionSeed={compositionSeed}
            jitterSeed={jitterSeed}
            onSelectTrack={handleSelectTrack}
            onChangeEditMode={setEditMode}
            onChangeActiveTool={setActiveEditingTool}
            onChangeSpectrumMode={setSpectrumOverlayMode}
            onChangeArrangementLength={handleChangeArrangementLength}
            onDropMemoryLocationAtPlayhead={handleDropMemoryLocationAtPlayhead}
            onSeekBeat={(beat) => {
              synthEngine.seek(beat);
              setPlayheadBeat(beat);
            }}
            onToggleNoteInTrack={handleToggleNoteInTrack}
            onEditArrangementClip={handleEditArrangementClip}
            onEditArrangementNote={handleEditArrangementNote}
            onToggleMute={handleToggleMute}
            onToggleSolo={handleToggleSolo}
            onUpdateTrackMixer={handleUpdateTrackMixer}
            onUpdateTrackAutomation={handleUpdateTrackAutomation}
            onUpdateTransport={handleUpdateTransport}
            onUpdateMasterBus={handleUpdateMasterBus}
            onOpenCompingModal={() => setIsCompingModalOpen(true)}
            onApplyNoteEditModeOperation={handleApplyNoteEditModeOperation}
            onOpenBulkQueueModal={() => setIsBulkQueueModalOpen(true)}
            onExecuteProjectCommand={handleExecuteProjectCommand}
            onExportLosslessWav={handleExportLosslessWav}
            onClearArrangement={() => clearDialogRef.current?.show()}
            onExportNativeAls={handleExportNativeAls}
            onRandomizeTrackVelocities={handleRandomizeTrackVelocities}
            onApplyMidiQuantizeStrength={handleApplyMidiQuantizeStrength}
            onSelectStrategy={setActiveStrategyId}
            onSelectForm={setActiveFormId}
            onComposeSingleLayer={handleInjectLayer}
            onComposeAllUnlockedLayers={handleInjectAllMissingLayers}
            onApplyMidiTool={handleApplyMidiTool}
            onInjectPolyrhythmClip={handleInjectPolyrhythmClip}
            onApplyChordGridTransform={handleApplyChordGridTransform}
            onLaunchSessionScene={handleLaunchSessionScene}
            sessionActions={{
              onLaunch:handleLaunchSessionScene,
              onStop:trackId=>handleSessionLaunch(null,trackId),
              onStore:(trackId,slot,clipId)=>handleExecuteProjectCommand('Store Session Clip','clip_edit',draft=>storeArrangementClipInSession(draft,trackId,slot,clipId)),
              onReturn:handleReturnToArrangement,
              onClear:()=>handleExecuteProjectCommand('Clear Session Performance','clip_edit',draft=>({...draft,session:{quantizationBeats:draft.session?.quantizationBeats || 4,events:[]}})),
              onQuantization:beats=>handleExecuteProjectCommand('Set Session Launch Grid','transport',draft=>({...draft,session:{quantizationBeats:beats,events:draft.session?.events || []}})),
              onCapture:(from,to,destination)=>handleExecuteProjectCommand('Capture Session Performance','clip_edit',draft=>captureSessionPerformance(draft,from,to,destination)),
            }}
            onToggleTrackLock={handleToggleTrackLock}
            onUpdateHumanization={handleUpdateHumanization}
            onUpdateTrackVelocityCurve={handleUpdateTrackVelocityCurve}
            onApplySpectralAutoDuck={handleApplySpectralAutoDuck}
            onInjectLibraryDevice={handleInjectLibraryDevice}
            onApplySmartLeveling={handleApplySmartLeveling}
            onRehumanizeAll={handleRehumanizeAll}
            onCloseLeftDock={() => setLeftDockOpen(false)}
            onCloseBottomDock={() => setBottomDockOpen(false)}
            onCloseRightDock={() => setRightDockOpen(false)}
            onChangeBottomTab={setBottomEditorTab}
            onOpenReferenceTrackModal={() => setIsReferenceModalOpen(true)}
            onOpenHumanizationHeatmap={() => setIsHeatmapModalOpen(true)}
            includeMidiHumanization={includeMidiHumanization}
            onToggleIncludeMidiHumanization={setIncludeMidiHumanization}
            onExportClipToMidi={handleExportClipToMidi}
            barRangeSelection={barRangeSelection}
            onChangeBarRangeSelection={setBarRangeSelection}
            onGenerateClipInRange={handleGenerateClipInRange}
            onSplitClipAtBeat={handleSplitClipAtBeat}
            onDuplicateClipOnTrack={handleDuplicateClipOnTrack}
            onConsolidateClipsInRange={handleConsolidateClipsInRange}
            onDeleteClipsInRange={handleDeleteClipsInRange}
            onAddUserTrackFromRole={handleAddUserTrackFromRole}
          />
        )}

        {activeTab === 'xml' && (
          <XmlInspectorView project={project} onDownloadAls={handleExportNativeAls} />
        )}

        {activeTab === 'python' && <PythonFastApiView humanization={humanization} />}

        {activeTab === 'architecture' && (
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-[#0B0D10]">
            <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b border-[#232934]">
              <div>
                <h2 className="text-base sm:text-lg font-display font-semibold text-slate-100">
                  Parametric AI DAW Engine v4.0 — System Architecture &amp; Native Ableton XML Heuristics
                </h2>
                <p className="text-xs text-slate-400 font-mono mt-1">
                  Full 8-Track Techno Suite · Spectral Auto-Ducking · True Polymeter Euclidean XML · 16–128 Bar Arrangement Engine.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveTab('python')}
                className="px-3.5 py-2 text-xs font-mono bg-[#171C26] hover:bg-[#222938] text-amber-400 border border-[#2E3748] rounded flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
              >
                <Layers className="w-3.5 h-3.5" />
                Inspect FastAPI Python Code
              </button>
            </div>

            <div className="bg-[#11151C] border border-[#232934] rounded overflow-hidden">
              <iframe
                src="/assets/aistudio/interactive_visual_im_b85db2ad2477683d_287a157b.html"
                title=".als Ghost Note Processing Architecture"
                className="w-full h-[520px] sm:h-[640px] border-0"
              />
            </div>

            <div className="bg-[#11151C] border border-[#232934] rounded p-4 sm:p-5 space-y-3">
              <h3 className="text-sm font-display font-semibold text-slate-100">
                Full 8-Track Techno Suite &amp; Ableton Native Device Mapping Matrix
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs font-mono">
                  <thead>
                    <tr className="border-b border-[#232934] text-slate-400">
                      <th className="py-2.5 pr-4">Track Archetype</th>
                      <th className="py-2.5 pr-4">Generative MIDI Pattern &amp; Polymeter</th>
                      <th className="py-2.5 pr-4">Ableton Native Device Chain (XML Injection)</th>
                      <th className="py-2.5">Spectral Ducking &amp; Automation Target</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1C222D] text-slate-200">
                    <tr>
                      <td className="py-2.5 pr-4 font-semibold text-amber-400">01. Kick 909</td>
                      <td className="py-2.5 pr-4">4/4 Anchor + Turnaround Ghost Kicks</td>
                      <td className="py-2.5 pr-4">DrumGroupDevice (909 Core) → EQEight → DrumBuss</td>
                      <td className="py-2.5 text-amber-400">Master Sidechain Trigger Source (Id=1)</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-semibold text-sky-400">02. Rumble Sub-Bass</td>
                      <td className="py-2.5 pr-4">Kick-ducked 16th rolling sub + Phrygian b2 turnaround</td>
                      <td className="py-2.5 pr-4">Operator (Sine) → Reverb → AutoFilter (LPF) → EQEight → Compressor2</td>
                      <td className="py-2.5 text-emerald-400">Dynamic EQEight Notch @ Kick Root Hz + 4.8:1 Sidechain</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-semibold text-lime-400">03. 303 Acid Line</td>
                      <td className="py-2.5 pr-4">Accented 16th resonant bassline with octave jumps &amp; slides</td>
                      <td className="py-2.5 pr-4">Analog (303 Diode) → Overdrive → Roar → Compressor2</td>
                      <td className="py-2.5 text-amber-400">24dB Diode Filter Cutoff &amp; Resonance Sweep</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-semibold text-orange-400">04. Industrial Perc</td>
                      <td className="py-2.5 pr-4">True Polymeter Euclidean (7/16, 11/16, 13/16)</td>
                      <td className="py-2.5 pr-4">Collision → DrumBuss → Erosion → Saturator</td>
                      <td className="py-2.5 text-amber-400">Transient drive &amp; bandpass resonator drift</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-semibold text-purple-400">05. Hypnotic Synth</td>
                      <td className="py-2.5 pr-4">Scale-conditioned motifs with 1/4–1/32 chord spread</td>
                      <td className="py-2.5 pr-4">Wavetable → Echo (3/16) → AutoPan (3/16)</td>
                      <td className="py-2.5 text-amber-400">Echo Feedback ramp before peak drops</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-semibold text-indigo-400">06. Dub Chord Pad</td>
                      <td className="py-2.5 pr-4">Minor 9th dub chord voicings (Narrow/Close/Wide/Octave)</td>
                      <td className="py-2.5 pr-4">Drift → ChorusEnsemble → HybridReverb → Compressor2</td>
                      <td className="py-2.5 text-amber-400">Slow lowpass filter breath &amp; Return A/B send</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-semibold text-emerald-400">07. Offbeat 909 Hats</td>
                      <td className="py-2.5 pr-4">8th offbeat open hat + swung 16th ghost groove</td>
                      <td className="py-2.5 pr-4">Simpler (909) → Overdrive → AutoFilter (HPF)</td>
                      <td className="py-2.5 text-amber-400">Velocity mapped strictly to envelope decay</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 pr-4 font-semibold text-cyan-400">08. 909 Ride Cymbal</td>
                      <td className="py-2.5 pr-4">Peak-energy metallic 8th/16th warehouse ride</td>
                      <td className="py-2.5 pr-4">Simpler (909 Ride) → EQEight (HPF 650Hz) → Saturator → Compressor2</td>
                      <td className="py-2.5 text-amber-400">High-shelf shimmer &amp; quarter-note kick pump</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 5. FOOTER TELEMETRY STATUS BAR */}
      <StudioStatusBar
        projectName={project.fileName}
        projectRevision={project.projectRevision || project.revision || 1}
        trackCount={project.tracks.length}
        activeSoloCount={project.tracks.filter((t) => t.soloed).length}
        editMode={editMode}
        activeTool={activeEditingTool}
        isPlaying={isPlaying}
        isExportingWav={isExportingWav}
        wavExportProgress={wavExportProgress}
        onCancelExport={()=>{if(wavExportPhase.current==='verifying')return;wavExportAbort.current?.abort();setStatusMessage('Cancelling WAV export and discarding the partial file...');}}
        canCancelExport={canCancelWavExport}
        statusMessage={statusMessage}
        alsValid={!!project.alsValidation?.isValid}
        canUndo={studioCommandBus.canUndo(currentProjectQueueKey)}
        canRedo={studioCommandBus.canRedo(currentProjectQueueKey)}
        storageStatus={storageStatus}
        migrationStatus={migrationStatus}
        blockedRecoveryRecords={blockedRecoveryRecords}
        recoveryBannerActive={recoveryBannerActive}
        onRetryRecovery={handleRetryRecovery}
        onRepairLegacyProject={handleRepairLegacyRecovery}
        onExportOriginalRecoveryData={handleExportOriginalRecoveryData}
        onQuarantineRecovery={async (queueId) => {
          try { await projectQueueService.quarantineBlockedRecoveryRecord(queueId); setStatusMessage('Quarantine copy saved with original envelope and diagnosis. Original retained for export and retry.'); }
          catch (error) { setStatusMessage(`Recovery storage warning: ${error instanceof Error ? error.message : String(error)}`); }
        }}
        onOpenSavedProject={() => projectSnapshotInputRef.current?.click()}
        onStartSeparateProject={handleStartSeparateProject}
      />

      {/* Multi-Project Bulk Smart Leveling 2.0 Queue & Master Export 2.0 Modal */}
      <BulkQueueAndExportModal
        isOpen={isBulkQueueModalOpen}
        onClose={() => setIsBulkQueueModalOpen(false)}
        activeProject={project}
        humanization={humanization}
        masterBus={masterBus}
        queueItems={queueItems}
        activeQueueId={activeQueueId}
        onSwitchToQueueProject={(targetQueueId) => {
          ++projectLoadRevision.current;
          const switched = projectQueueService.switchActiveProject(targetQueueId, projectRef.current);
          if (switched) {
            synthEngine.stop(); synthEngine.seek(0);
            setIsPlaying(false); setPlayheadBeat(0);
            const enriched = enrichProjectWithAnalysis(switched, activeFormId);
            projectRef.current = enriched; setProject(enriched);
            setSelectedTrackId(enriched.tracks[0]?.id || '1');
            setStatusMessage(`Switched active workstation project to ${enriched.fileName}.`);
          }
        }}
        onSyncActiveProjectFromQueue={(updatedProject) => {
          handleExecuteProjectCommand('Apply Queue Changes', 'calibration', () => updatedProject);
        }}
      />

      {pendingProposal&&<ProjectChangeReviewDialog proposal={pendingProposal} stale={staleProposal} onApply={applyReviewedChange} onCancel={cancelReviewedChange} onAudition={auditionReviewedProject}/>}

      {/* Studio Command Palette (Cmd/Ctrl+K) */}
      <StudioCommandPalette
        isOpen={isCommandPaletteOpen}
        onClose={() => setIsCommandPaletteOpen(false)}
        onExecuteCommandId={handleExecuteStudioCommand}
        project={project}
        onJumpToBeat={(beat) => {
          synthEngine.seek(beat);
          setPlayheadBeat(beat);
          setStatusMessage(`Jumped to Beat ${beat.toFixed(2)} (Bar ${Math.floor(beat / 4) + 1}).`);
        }}
        onSelectTrack={(trackId) => setSelectedTrackId(trackId)}
      />

      {/* Track Comping Playlists & Separate Audio Strip Silence / MIDI Ghost-Note Pruning Modal */}
      {selectedTrack && (
        <CompingAndTransientModal
          isOpen={isCompingModalOpen}
          onClose={() => setIsCompingModalOpen(false)}
          project={project}
          selectedTrack={selectedTrack}
          humanization={humanization}
          masterBus={masterBus}
          onExecuteProjectCommand={(label, category, mutator) =>
            handleExecuteProjectCommand(label, category, mutator)
          }
        />
      )}

      {/* Reference Track Deep AI Analysis & Counterpart Re-Composition Modal */}
      <ReferenceTrackModal
        isOpen={isReferenceModalOpen}
        onClose={() => setIsReferenceModalOpen(false)}
        onLoadCounterpartProject={(newProject) => {
          handleExecuteProjectCommand('Apply Reference Composition', 'clip_edit', prev => ({
            ...newProject, audioSettings: projectAudioSettings(prev),
          }));
          setSelectedTrackId(newProject.tracks[0]?.id || '1');
        }}
      />

      {/* Visual MIDI Humanization Variance Heatmap & Bar Micro-Timing Inspector Modal */}
      <MidiHumanizationHeatmapModal
        isOpen={isHeatmapModalOpen}
        onClose={() => setIsHeatmapModalOpen(false)}
        humanization={humanization}
        arrangementLengthBars={activeTotalBars}
        currentPlayheadBeat={playheadBeat}
        onUpdateHumanization={handleUpdateHumanization}
      />

      {/* Android & iOS Touch Interaction Settings Modal */}
      <TouchInteractionSettingsModal
        isOpen={isTouchSettingsOpen}
        onClose={() => setIsTouchSettingsOpen(false)}
        config={touchConfig}
        onChangeConfig={(partial) => setTouchConfig((prev) => ({ ...prev, ...partial }))}
      />

      {/* Real-Time Audio Diagnostics Sidebar Drawer */}
      <DiagnosticsPanel
        isOpen={isDiagnosticsOpen}
        onClose={() => setIsDiagnosticsOpen(false)}
        onReportStatus={setStatusMessage}
      />

      {/* Interactive Dynamic New Project Modal */}
      <ClearArrangementDialog ref={clearDialogRef} onApply={handleClearArrangement} />
      <NewProjectModal
        isOpen={isNewProjectModalOpen}
        initialDurationBars={newProjectBars}
        onClose={() => setIsNewProjectModalOpen(false)}
        onCreateProject={handleCreateNewProject}
      />

      {/* Unsupported Third-Party Plugin Dependency Management Modal */}
      <UnsupportedPluginModal
        isOpen={isUnsupportedPluginModalOpen}
        onClose={() => setIsUnsupportedPluginModalOpen(false)}
        project={project}
        onUpdateProject={(updated) =>
          handleExecuteProjectCommand('Substitute Unsupported Device', 'clip_edit', () => updated)
        }
      />

      {/* Studio Settings Modal */}
      <StudioSettingsModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        themeMode={themeMode}
        onToggleTheme={(mode) => setThemeMode(mode)}
        spectrumOverlayMode={spectrumOverlayMode}
        onChangeSpectrumOverlayMode={setSpectrumOverlayMode}
        masterBus={masterBus}
        onUpdateMasterBus={handleUpdateMasterBus}
        onResetLayout={() => handleApplyLayoutPreset('edit')}
      />
    </div>
  );
}

