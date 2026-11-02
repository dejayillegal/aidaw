import { DEFAULT_HUMANIZATION, DEFAULT_MASTER_BUS, DEFAULT_TRANSPORT, projectAudioSettings } from './engine/projectDefaults';
import { decodeProjectSnapshot, encodeProjectSnapshot } from './services/projectSnapshotService';
import { saveExportBlob } from './services/fileExportService';
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
  decomposeNotesIntoSectionClips,
  duplicateTrackClip,
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
import { renderArrangementToWavBlob, synthEngine } from './engine/webAudioSynth';
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
import { TrackVelocityRandomizerConfig } from './components/AiComposerIntelligencePanel';
import { projectQueueService } from './services/projectQueueService';
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
  const arrangementSections = rawState.arrangementSections || generateSectionArrangementPlan(effectiveForm, totalBars, rawState.lastGenerationIdentity?.compositionSeed ?? rawState.generationSeed ?? 0);
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

  // Granular Clear Arrangement state
  const [clearOptions, setClearOptions] = useState<ClearArrangementOptions>({
    scope: 'selected_track',
    wipeNotes: true,
    wipeAutomation: true,
    wipeSessionClips: false,
    resetMixerToNeutral: false,
  });

  const [initialCompositionSeed] = useState<number>(
    () => Math.floor(Math.random() * 1000000) + 101
  );
  const [activeStrategyId, setActiveStrategyId] =
    useState<CompositionStrategyId>('hypnotic_evolving');
  const [activeFormId, setActiveFormId] =
    useState<MacroArrangementFormId>('hypnotic_longform');

  const [project, setProject] = useState<AbletonProjectState>(() => {
    const seed = initialCompositionSeed;
    const { xml, meta } = buildStarterAbletonXml('berghain-134', seed);
    const parsed = parseAbletonXmlDom(xml, meta.name, xml);
    return enrichProjectWithAnalysis(parsed, 'hypnotic_longform');
  });

  const compositionSeed = project.lastGenerationIdentity?.compositionSeed ?? project.generationSeed ?? initialCompositionSeed;
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
  const [studioWorkspace, setStudioWorkspace] = useState<WorkspaceTabId>('edit');
  const [activeEditingTool, setActiveEditingTool] = useState<StudioEditingTool>('smart');
  const [spectrumOverlayMode, setSpectrumOverlayMode] = useState<SpectrumOverlayMode>('compact_lane');
  const [leftDockOpen, setLeftDockOpen] = useState<boolean>(true);
  const [bottomDockOpen, setBottomDockOpen] = useState<boolean>(true);
  const [rightDockOpen, setRightDockOpen] = useState<boolean>(false);
  const [bottomEditorTab, setBottomEditorTab] = useState<'composer' | 'devices' | 'pads' | 'spectrum'>('composer');

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
    setBottomDockOpen(true);
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
  const [, setCommandBusTick] = useState<number>(0);

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

  const projectSnapshotInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Subscribe to ProjectQueueService & StudioCommandBus
  useEffect(() => {
    const unsubQueue = projectQueueService.subscribe(() => {
      const persistence = projectQueueService.getPersistenceStatus();
      if (persistence.status === 'error') setStatusMessage(`Recovery storage warning: ${persistence.error}. Save a native project file.`);
      setQueueItems(projectQueueService.getAllItems());
      commandTargetRef.current = projectQueueService.getActiveQueueId() || 'default_workstation_project';
      setActiveQueueId(projectQueueService.getActiveQueueId());
    });
    const unsubCmd = studioCommandBus.subscribe(() => {
      setCommandBusTick((t) => t + 1);
    });
    let cancelled = false;
    if (projectQueueService.getAllItems().length === 0) {
      const initial = projectRef.current;
      void projectQueueService.restorePersistedProjects().then(async restored => {
        if (cancelled) return;
        if (restored && projectRef.current === initial) {
          projectRef.current = restored; setProject(restored);
          setSelectedTrackId(restored.tracks[0]?.id || '1');
          if (restored.lastGenerationIdentity) {
            setActiveStrategyId(restored.lastGenerationIdentity.strategyId);
            setActiveFormId(restored.lastGenerationIdentity.macroFormId);
          }
          setStatusMessage(`Recovered ${restored.fileName}. ${projectQueueService.getPersistenceStatus().error || ''}`);
        } else if (!restored && projectQueueService.getAllItems().length === 0) {
          const recovery = projectQueueService.getPersistenceStatus();
          if (recovery.status === 'error') {
            setStatusMessage(`Recovery blocked: ${recovery.error}. Open a compatible saved project; stored records are unchanged.`);
          } else {
            await projectQueueService.enqueueProjectFromXml(initial.fileName, initial.rawXmlModified || initial.rawXml || '');
          }
        }
      }).catch(error => { if (!cancelled) setStatusMessage(`Recovery failed: ${String(error)}. Open a saved project file.`); });
    }
    return () => {
      cancelled = true;
      unsubQueue();
      unsubCmd();
    };
  }, []);

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

  const updateAudioSettings = <K extends keyof ProjectAudioSettings>(key: K, update: React.SetStateAction<ProjectAudioSettings[K]>) => {
    handleExecuteProjectCommand(`Update ${key}`, 'mixer', draft => {
      const current = projectAudioSettings(draft);
      const next = typeof update === 'function' ? (update as (value: ProjectAudioSettings[K]) => ProjectAudioSettings[K])(current[key]) : update;
      return { ...draft, audioSettings: { ...current, [key]: next } };
    });
  };
  const setMasterBus = (update: React.SetStateAction<MasterBusConfig>) => updateAudioSettings('masterBus', update);
  const setTransport = (update: React.SetStateAction<TransportConfig>) => updateAudioSettings('transport', update);

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
    const barNum = Math.floor(playheadBeat / 4) + 1;
    handleExecuteProjectCommand(
      `Drop Memory Location [${nextSlot}] at Bar ${barNum}`,
      'locator',
      (draft) => upsertMemoryLocationMarker(draft, nextSlot, `Bar ${barNum}`, playheadBeat)
    );
  }, [project.memoryLocations, playheadBeat, handleExecuteProjectCommand]);

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
    synthEngine.stop();
    synthEngine.seek(0);
    setIsPlaying(false);
    setPlayheadBeat(0);
    const freshSeed = Math.floor(Math.random() * 10000000) + 1;
    setSelectedTemplateId(templateId);

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

    setActiveFormId(nextForm);
    setActiveStrategyId(nextStrategy);

    const { xml: initialXml, meta } = buildStarterAbletonXml(
      templateId,
      freshSeed,
      requestedBars,
      creationMode
    );
    let workingXml = initialXml;
    let parsed = parseAbletonXmlDom(workingXml, meta.name, workingXml);
    if (creationMode === 'full-track' && requestedBars > 16) {
      const sections = generateSectionArrangementPlan(nextForm, requestedBars, freshSeed);
      const sectionedTracks = parsed.tracks.map((track, idx) => {
        if (track.type !== 'midi') return track;
        const clips = decomposeNotesIntoSectionClips(
          track.name,
          track.archetype,
          track.clips.flatMap((c) => c.notes),
          requestedBars,
          sections
        );
        return {
          ...track,
          clips,
          automationPoints: generateContextualAutomationPoints(
            track.archetype,
            nextForm,
            freshSeed + idx * 53,
            requestedBars,
            sections
          ),
        };
      });
      for (const track of sectionedTracks) {
        if (track.type === 'midi') {
          workingXml = syncTrackClipsToXml(workingXml, track.id, track.clips);
        }
      }
      parsed = {
        ...parsed,
        creationMode: 'full-track',
        requestedDurationBars: requestedBars,
        arrangementLengthBars: requestedBars,
        tracks: sectionedTracks,
        rawXmlOriginal: workingXml,
        rawXmlModified: workingXml,
        rawXml: workingXml,
      };
    } else {
      parsed = {
        ...parsed,
        creationMode,
        requestedDurationBars: requestedBars,
        arrangementLengthBars: requestedBars,
      };
    }
    const enriched = enrichProjectWithAnalysis(parsed, nextForm);
    // Persist outgoing work before giving the new project a separate queue/history identity.
    const record = await projectQueueService.enqueueProjectFromXml(meta.name, workingXml);
    if (loadRevision !== projectLoadRevision.current) return;
    if (!record.workingProjectState || record.state === 'failed' || record.state === 'unsupported') {
      setStatusMessage(`Project open failed: ${record.errorDetails || 'starter initialization failed'}`); return;
    }
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

  const handleInjectLayer = useCallback(
    (
      archetype: TechnoArchetype,
      customOneBarPattern?: { time: number; duration: number; pitch: number; velocity: number }[],
      customClipName?: string,
      rationaleNote?: string,
      explicitSeed?: number
    ) => {
      const existingTrack = project.tracks.find((t) => t.archetype === archetype);
      if (existingTrack?.locked) {
        setStatusMessage(`Track "${existingTrack.name}" is LOCKED. Unlock it first to regenerate.`);
        return;
      }

      const totalBars = project.arrangementLengthBars || transport.arrangementLengthBars || 16;
      const totalBeats = totalBars * 4;

      const nextCompSeed =
        typeof explicitSeed === 'number'
          ? explicitSeed
          : Math.floor(Math.random() * 10000000) + 1;
      const nextHumSeed = Math.floor(Math.random() * 1000000) + 1;


      let updatedXml = TechnoHeuristicEngine.injectTechnoLayerIntoXml(
        project.rawXmlModified,
        archetype,
        project.rootKey,
        humanization,
        customOneBarPattern,
        customClipName,
        nextCompSeed,
        totalBars
      );

      const composed = composeProjectConditionedLayerNotes(
        project,
        archetype,
        activeStrategyId,
        activeFormId,
        humanization,
        nextCompSeed,
        nextHumSeed,
        totalBars
      );

      const finalNotes =
        customOneBarPattern && customOneBarPattern.length > 0
          ? TechnoHeuristicEngine.generateHumanizedMidiArray(
              archetype,
              project.rootKey,
              humanization,
              customOneBarPattern,
              nextCompSeed,
              totalBars
            )
          : composed.notes;

      const clipLabel =
        customClipName || `${archetype.toUpperCase()}_${activeStrategyId}_v${nextCompSeed % 100}`;
      updatedXml = syncTrackNotesToXml(
        updatedXml,
        '',
        archetype,
        clipLabel,
        finalNotes,
        totalBeats
      );

      const rawNextState = parseAbletonXmlDom(
        updatedXml,
        project.fileName,
        project.rawXmlOriginal
      );
      const preserved = preserveTrackStates(rawNextState, project);

      const contextualAuto = generateContextualAutomationPoints(
        archetype,
        activeFormId,
        nextCompSeed,
        totalBars
      );

      const updatedTracks = preserved.tracks.map((t) => {
        if (t.archetype !== archetype) return t;
        return {
          ...t,
          clips: t.clips.map((c, idx) =>
            idx === 0 ? { ...c, name: clipLabel, length: totalBeats, notes: finalNotes } : c
          ),
          sessionClips: composed.sessionClips,
          activeSessionSlot: 0,
          compositionStrategy: activeStrategyId,
          automationPoints: contextualAuto,
        };
      });

      const identityRecord: GenerationIdentityRecord = {
        generationId: `gen_${Date.now()}_${nextCompSeed % 1000}`,
        timestampIso: new Date().toISOString(),
        projectFingerprint:
          project.musicalProfile?.projectFingerprint || `${project.fileName}_${project.tempo}`,
        compositionSeed: nextCompSeed,
        humanizationSeed: nextHumSeed,
        strategyId: activeStrategyId,
        macroFormId: activeFormId,
        targetArchetype: archetype,
        noveltyMetrics: composed.novelty,
        musicalReasoning: rationaleNote || composed.reasoning,
      };

      const enriched = enrichProjectWithAnalysis(
        {
          ...preserved,
          arrangementLengthBars: totalBars,
          tracks: updatedTracks,
          rawXmlModified: updatedXml,
          lastGenerationIdentity: identityRecord,
        },
        activeFormId
      );

      handleExecuteProjectCommand('Generate Layer', 'clip_edit', () => enriched);

      const injectedTrack = enriched.tracks.find((t) => t.archetype === archetype);
      if (injectedTrack) {
        setSelectedTrackId(injectedTrack.id);
      }

      setStatusMessage(
        rationaleNote
          ? `AI Layer (${archetype.toUpperCase()}): ${rationaleNote}`
          : composed.reasoning
      );
    },
    [project, humanization, activeStrategyId, activeFormId, transport.arrangementLengthBars]
  );

  const handleInjectAllMissingLayers = () => {
    let workingXml = project.rawXmlModified;
    const totalBars = project.arrangementLengthBars || transport.arrangementLengthBars || 16;
    const totalBeats = totalBars * 4;
    const archetypesToEnsure: TechnoArchetype[] = [
      'rumble',
      'acid',
      'percussion',
      'synth',
      'pad',
      'hats',
      'ride',
    ];
    const baseCompSeed = Math.floor(Math.random() * 10000000) + 1;
    const baseHumSeed = Math.floor(Math.random() * 1000000) + 1;


    const sharedSections = generateSectionArrangementPlan(activeFormId, totalBars, baseCompSeed);
    // Full-arrangement composition also withdraws the existing unlocked kick during
    // builds/breakdowns. Preserve its rhythm and every locked track.
    for (const track of project.tracks.filter(track => track.type === 'midi' && track.archetype === 'kick' && !track.locked)) {
      const arranged = decomposeNotesIntoSectionClips(track.name, track.archetype,
        track.clips.flatMap(clip => clip.notes), totalBars, sharedSections);
      workingXml = syncTrackClipsToXml(workingXml, track.id, arranged);
    }

    const composedMap = new Map<
      TechnoArchetype,
      ReturnType<typeof composeProjectConditionedLayerNotes>
    >();

    archetypesToEnsure.forEach((arch, idx) => {
      const existing = project.tracks.find((t) => t.archetype === arch);
      if (existing?.locked) return;

      const cSeed = baseCompSeed + idx * 193;
      const hSeed = baseHumSeed + idx * 71;

      workingXml = TechnoHeuristicEngine.injectTechnoLayerIntoXml(
        workingXml,
        arch,
        project.rootKey,
        humanization,
        undefined,
        undefined,
        cSeed,
        totalBars
      );

      const comp = composeProjectConditionedLayerNotes(
        project,
        arch,
        activeStrategyId,
        activeFormId,
        humanization,
        cSeed,
        hSeed,
        totalBars,
        sharedSections
      );
      composedMap.set(arch, comp);

      const clipLabel = `${arch.toUpperCase()}_${activeStrategyId}_v${cSeed % 100}`;
      workingXml = syncTrackNotesToXml(
        workingXml,
        '',
        arch,
        clipLabel,
        comp.notes,
        totalBeats
      );
    });

    const rawNextState = parseAbletonXmlDom(workingXml, project.fileName, project.rawXmlOriginal);
    const preserved = preserveTrackStates(rawNextState, project);

    const finalTracks = preserved.tracks.map((t) => {
      const comp = composedMap.get(t.archetype);
      if (t.locked || t.type !== 'midi') return project.tracks.find(track => track.id === t.id) || t;
      if (!comp) return t;
      return {
        ...t,
        clips: decomposeNotesIntoSectionClips(t.name, t.archetype, comp.notes, totalBars, sharedSections),
        sessionClips: comp.sessionClips,
        activeSessionSlot: 0,
        compositionStrategy: activeStrategyId,
        automationPoints: generateContextualAutomationPoints(
          t.archetype,
          activeFormId,
          baseCompSeed,
          totalBars,
          sharedSections
        ),
      };
    });

    for (const track of finalTracks) {
      if (track.type === 'midi' && !track.locked) workingXml = syncTrackClipsToXml(workingXml, track.id, track.clips);
    }

    const sampleComp = composedMap.get('rumble') || composedMap.values().next().value;
    const identityRecord: GenerationIdentityRecord | undefined = sampleComp
      ? {
          generationId: `gen_all_${Date.now()}`,
          timestampIso: new Date().toISOString(),
          projectFingerprint:
            project.musicalProfile?.projectFingerprint || `${project.fileName}_${project.tempo}`,
          compositionSeed: baseCompSeed,
          humanizationSeed: baseHumSeed,
          strategyId: activeStrategyId,
          macroFormId: activeFormId,
          targetArchetype: 'all',
          noveltyMetrics: sampleComp.novelty,
          musicalReasoning: sampleComp.reasoning,
        }
      : project.lastGenerationIdentity;

    const enriched = enrichProjectWithAnalysis(
      {
        ...preserved,
        arrangementLengthBars: totalBars,
        tracks: finalTracks,
        rawXmlModified: workingXml,
        lastGenerationIdentity: identityRecord,
      },
      activeFormId
    );

    handleExecuteProjectCommand('Compose section arrangement', 'clip_edit', () => enriched);
    const rumbleTrack = enriched.tracks.find((t) => t.archetype === 'rumble');
    if (rumbleTrack) setSelectedTrackId(rumbleTrack.id);
    setStatusMessage(
      `Composed full 8-track techno suite (${totalBars} Bars) using "${activeStrategyId}" (${activeFormId}) · Section clips applied; listening review required.`
    );
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
  const handleInjectLibraryDevice = (trackId: string, templateId: string) => {
    handleExecuteProjectCommand('Insert Library Device', 'mixer', (prev) => {
      const targetTrack = prev.tracks.find((t) => t.id === trackId);
      if (!targetTrack) return prev;

      const updatedXml = injectLibraryDeviceIntoTrackXml(
        prev.rawXmlModified,
        trackId,
        targetTrack.name,
        templateId
      );

      const reParsed = parseNativeDeviceEdit(updatedXml, prev.fileName, prev.rawXmlOriginal);
      const preserved = preserveTrackStates(reParsed, prev);

      const updatedTracks = preserved.tracks.map((t) => {
        if (t.id !== trackId) return t;
        const fresh = reParsed.tracks.find((rt) => rt.id === trackId || rt.name === t.name);
        return {
          ...t,
          devices: fresh ? fresh.devices : t.devices,
        };
      });

      setStatusMessage(
        `Injected native Ableton device (${templateId.toUpperCase()}) into ${targetTrack.name} <DeviceChain>.`
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
    handleExecuteProjectCommand('Generate Polymeter Clip', 'clip_edit', (prev) => {
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
  const handleApplyChordGridTransform = (
    trackId: string,
    gridDivision: NoteGridDivision,
    voicingSpread: VoicingSpreadStyle,
    customRootKey?: string,
    customScale?: string,
    stylePrompt?: string
  ) => {
    handleExecuteProjectCommand('Transform Chord Grid', 'clip_edit', (prev) => {
      const targetTrack = prev.tracks.find((t) => t.id === trackId);
      if (!targetTrack || !targetTrack.clips[0] || targetTrack.locked) return prev;

      const effectiveKey = customRootKey || prev.rootKey;
      const effectiveScale = customScale || prev.scale;
      const totalBars = prev.arrangementLengthBars || transport.arrangementLengthBars || 16;
      const totalBeats = totalBars * 4;

      const { notes: transformedNotes, summary } = applyChordAndGridTransformToNotes(
        targetTrack.clips[0].notes,
        effectiveKey,
        effectiveScale,
        gridDivision,
        voicingSpread,
        targetTrack.archetype,
        totalBars,
        compositionSeed
      );

      const clipName = `${targetTrack.archetype.toUpperCase()}_${effectiveKey}_${gridDivision.replace('/', '_')}_${voicingSpread.toUpperCase()}`;
      const updatedTracks = prev.tracks.map((t) => {
        if (t.id !== trackId) return t;
        return {
          ...t,
          clips: t.clips.map((c, idx) =>
            idx === 0 ? { ...c, name: clipName, notes: transformedNotes } : c
          ),
        };
      });

      setStatusMessage(
        `${targetTrack.name} · ${summary}${stylePrompt ? ` · Direction: "${stylePrompt}"` : ''}`
      );

      return enrichProjectWithAnalysis(
        {
          ...prev,
          rootKey: effectiveKey,
          scale: effectiveScale,
          tracks: updatedTracks,

        },
        activeFormId
      );
    });
  };

  // Handler: Granular Clear Arrangement (Preserves DeviceChain!)
  const handleClearArrangement = () => {
    const { updatedXml, clearedTrackCount, summary } = clearProjectArrangementXml(
      project.rawXmlModified,
      project.tracks,
      selectedTrackId,
      clearOptions
    );

    if (clearedTrackCount === 0) {
      setStatusMessage('No unlocked target tracks matched Clear Arrangement scope.');
      return;
    }

    const reParsed = parseAbletonXmlDom(updatedXml, project.fileName, project.rawXmlOriginal);
    const preserved = preserveTrackStates(reParsed, project);

    const updatedTracks = preserved.tracks.map((t) => {
      const isTargeted =
        clearOptions.scope === 'all_tracks' ||
        (clearOptions.scope === 'unlocked_tracks' && !t.locked) ||
        (clearOptions.scope === 'selected_track' && t.id === selectedTrackId);

      if (!isTargeted) return t;

      return {
        ...t,
        clips: clearOptions.wipeNotes
          ? t.clips.map((c) => ({ ...c, notes: [] }))
          : t.clips,
        automationPoints: clearOptions.wipeAutomation ? [] : t.automationPoints,
        sessionClips: clearOptions.wipeSessionClips ? [] : t.sessionClips,
        mixer: clearOptions.resetMixerToNeutral
          ? {
              ...t.mixer,
              volumeDb: 0,
              pan: 0,
              transposeSemitones: 0,
              fineTuneCents: 0,
            }
          : t.mixer,
      };
    });

    handleExecuteProjectCommand('Clear Arrangement', 'clip_edit', () =>
      enrichProjectWithAnalysis(
        {
          ...preserved,
          tracks: updatedTracks,
          rawXmlModified: updatedXml,
        },
        activeFormId
      )
    );
    setStatusMessage(summary);
  };

  // Handler: Configurable Arrangement Duration (4 to 1024 Bars) - Non-destructive Extent Change (v7.1 P1-006)
  const handleChangeArrangementLength = (bars: number) => {
    const safeBars = Math.max(4, Math.min(1024, Math.round(bars)));
    handleExecuteProjectCommand('Change Arrangement Extent', 'transport', prev => ({
      ...prev, arrangementLengthBars: safeBars,
    }));
  };

  const handleApplyMidiTool = (trackId: string, toolId: MidiToolTransformationId) => {
    const targetTrack = project.tracks.find((t) => t.id === trackId);
    if (!targetTrack || !targetTrack.clips[0] || targetTrack.locked) return;

    const totalBars = project.arrangementLengthBars || transport.arrangementLengthBars || 16;
    const totalBeats = totalBars * 4;
    const nextSeed = Math.floor(Math.random() * 1000000) + 1;
    const { notes: transformedNotes, description } = applyLive12MidiTool(
      targetTrack.clips[0].notes,
      toolId,
      project.rootKey,
      targetTrack.archetype,
      nextSeed,
      totalBars
    );

    handleExecuteProjectCommand('Apply MIDI Tool', 'clip_edit', (prev) =>
      enrichProjectWithAnalysis(
        {
          ...prev,
          tracks: prev.tracks.map((t) =>
            t.id === trackId
              ? {
                  ...t,
                  clips: t.clips.map((c, idx) =>
                    idx === 0 ? { ...c, notes: transformedNotes } : c
                  ),
                }
              : t
          ),
        },
        activeFormId
      )
    );
    setStatusMessage(`${targetTrack.name} · ${description}`);
  };

  const handleToggleTrackLock = (trackId: string) => {
    handleExecuteProjectCommand('Toggle Track Lock', 'clip_edit', prev => ({
      ...prev, tracks: prev.tracks.map(t => t.id === trackId ? { ...t, locked: !t.locked } : t),
    }));
  };

  const handleSessionLaunch = (slot: number|null, trackId?: string) => {
    const current=projectRef.current;
    const now=synthEngine.getCurrentBeat()+(synthEngine.getIsPlaying()?0.15*current.tempo/60:0);
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

  const handleGenerateAiVariation = async (archetype: TechnoArchetype) => {
    const aiSeed = Math.floor(Math.random() * 1000000) + 1;
    const sourceProject = projectRef.current;
    try {
      setAiLoadingArchetype(archetype);
      setStatusMessage(
        `Synthesizing creative ${archetype.toUpperCase()} sequence via Gemini Techno Brain...`
      );
      const res = await fetch('/api/ai/sequence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          archetype,
          tempo: project.tempo,
          rootKey: project.rootKey,
          scale: project.scale,
          existingTracks: project.tracks.map((t) => t.name),
        }),
      });

      const data = await res.json();
      if (projectRef.current !== sourceProject) { setStatusMessage('Discarded a stale AI response after project edits or switch.'); return; }
      if (data.notes && Array.isArray(data.notes)) {
        handleInjectLayer(archetype, data.notes, data.clipName, data.rationale, aiSeed);
      } else {
        handleInjectLayer(archetype, undefined, undefined, undefined, aiSeed);
      }
    } catch {
      if (projectRef.current === sourceProject) handleInjectLayer(archetype, undefined, undefined, undefined, aiSeed);
    } finally {
      setAiLoadingArchetype(null);
    }
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
      try { synthEngine.start(false); setIsPlaying(synthEngine.getIsPlaying()); }
      catch(error) { setStatusMessage(`Playback blocked: ${error instanceof Error?error.message:String(error)}`); setIsPlaying(false); }
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
    handleExecuteProjectCommand('Randomize Track Velocities', 'clip_edit', draft =>
      transformTrackArrangementNotes(draft, trackId, notes => randomizeTrackNoteVelocities(notes, config))
    );
  };

  const handleApplyMidiQuantizeStrength = (trackId: string, gridDivision: NoteGridDivision, strengthPct: 50 | 75 | 100) => {
    handleExecuteProjectCommand(`Quantize Track ${strengthPct}% (${gridDivision})`, 'clip_edit', draft =>
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

  const handleToggleNoteInTrack = (
    trackId: string,
    stepBeat: number,
    pitch: number,
    stepDuration = 0.25
  ) => {
    handleExecuteProjectCommand('Toggle MIDI Note', 'clip_edit', (prev) => {
      let workingXml = prev.rawXmlModified;
      const updatedTracks = prev.tracks.map((track) => {
        if (track.id !== trackId) return track;

        // Find the clip covering stepBeat, or create a 4-bar clip at that bar if none covers stepBeat
        let targetClipIdx = track.clips.findIndex(
          (c) => stepBeat >= c.startTime - 0.05 && stepBeat < c.startTime + Math.max(0.25, c.length) + 0.05
        );
        let nextClips = [...track.clips];
        if (targetClipIdx < 0) {
          const barIndex = Math.floor(stepBeat / 4);
          const clipStart = barIndex * 4;
          const newClip = {
            id: `clip_${track.id}_${barIndex + 1}_${Date.now()}`,
            name: `${track.name}_Bar_${barIndex + 1}`,
            startTime: clipStart,
            endTime: clipStart + 16,
            length: 16,
            notes: [] as typeof track.clips[0]['notes'],
            revision: 1,
          };
          nextClips.push(newClip);
          nextClips.sort((a, b) => a.startTime - b.startTime);
          targetClipIdx = nextClips.findIndex((c) => c.id === newClip.id);
        }

        const clip = nextClips[targetClipIdx];
        const existingIdx = clip.notes.findIndex(
          (n) => Math.abs(n.quantizedTime - stepBeat) < stepDuration * 0.45 && n.pitch === pitch
        );
        const nextNotes = [...clip.notes];
        if (existingIdx >= 0) {
          nextNotes.splice(existingIdx, 1);
        } else {
          nextNotes.push({
            id: `manual_${Date.now()}`,
            time: Number((stepBeat + (track.archetype === 'kick' ? 0 : 0.005)).toFixed(3)),
            quantizedTime: stepBeat,
            duration: stepDuration,
            pitch,
            velocity: 98,
            isGhost: false,
          });
          nextNotes.sort((a, b) => a.time - b.time);
        }

        nextClips[targetClipIdx] = { ...clip, notes: nextNotes };
        workingXml = syncTrackClipsToXml(workingXml, track.id, nextClips);
        return {
          ...track,
          clips: nextClips,
        };
      });
      return { ...prev, tracks: updatedTracks, rawXmlModified: workingXml };
    });
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
        `Generate ${mode.toUpperCase()} Clip (Bars ${startBar}–${endBar - 1})`,
        'clip_edit',
        (draft) => {
          const targetTrack = draft.tracks.find((t) => t.id === trackId);
          if (!targetTrack) return draft;
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
          const updatedXml = syncTrackClipsToXml(draft.rawXmlModified, trackId, nextClips);
          setStatusMessage(
            `Split clip on "${targetTrack.name}" at Bar ${Math.floor(splitBeat / 4) + 1} (${nextClips.length} clips on track).`
          );
          return {
            ...draft,
            rawXmlModified: updatedXml,
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
        const updatedXml = syncTrackClipsToXml(draft.rawXmlModified, trackId, nextClips);
        setStatusMessage(
          `Duplicated clip "${duplicatedClip.name}" to Bar ${Math.floor(duplicatedClip.startTime / 4) + 1}.`
        );
        return {
          ...draft,
          arrangementLengthBars: neededBars,
          rawXmlModified: updatedXml,
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
          const updatedXml = syncTrackClipsToXml(draft.rawXmlModified, trackId, nextClips);
          setStatusMessage(
            `Consolidated Bars ${startBar}–${endBar - 1} into a single contiguous MIDI clip on "${targetTrack.name}".`
          );
          return {
            ...draft,
            rawXmlModified: updatedXml,
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
          const nextClips = targetTrack.clips.filter(
            (c) => c.startTime + c.length <= startBeat + 0.01 || c.startTime >= endBeat - 0.01
          );
          const updatedXml = syncTrackClipsToXml(draft.rawXmlModified, trackId, nextClips);
          setStatusMessage(
            `Deleted clip content in Bars ${startBar}–${endBar - 1} on "${targetTrack.name}".`
          );
          return {
            ...draft,
            rawXmlModified: updatedXml,
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
    const clamped = Math.max(90, Math.min(180, newBpm));
    handleExecuteProjectCommand('Change Tempo', 'transport', prev => ({ ...prev, tempo: clamped }));
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

  const handleExportLosslessWav = async (bitDepth: 16 | 24 = 24) => {
    if (isExportingWav) return;
    const totalBars = project.arrangementLengthBars || transport.arrangementLengthBars || 16;
    try {
      setIsExportingWav(true);
      setWavExportProgress(0);
      setStatusMessage(
        `Rendering complete ${totalBars}-bar arrangement (44.1kHz / ${bitDepth}-bit Lossless Stereo WAV with Sidechain, Reverb, 3/16 Delay & Master Glue)...`
      );
      const { blob, durationSeconds } = await renderArrangementToWavBlob(
        project,
        humanization,
        masterBus,
        totalBars,
        bitDepth,
        (progressPct) => {
          setWavExportProgress(progressPct);
          setStatusMessage(
            `Rendering complete ${totalBars}-bar arrangement to ${bitDepth}-bit Lossless Stereo WAV (${progressPct}%)...`
          );
        }
      );
      const cleanBase = project.fileName.replace(/\.(als|xml)$/i, '');
      const exportName = `${cleanBase}_${project.tempo}bpm_${totalBars}bars_${bitDepth}bit.wav`;
      setStatusMessage('Audio rendered. Select a destination to save the WAV…');
      const saved = await saveExportBlob(blob, exportName);
      setStatusMessage(
        `${saved.verified ? 'Saved and verified' : 'Download requested'}: ${exportName} (${(blob.size / (1024 * 1024)).toFixed(2)} MB · ${durationSeconds.toFixed(1)}s · 44.1kHz/${bitDepth}-bit PCM).`
      );
    } catch (err: any) {
      setStatusMessage(`Lossless WAV render failed: ${err.message}`);
    } finally {
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
  }, [handleUndo, handleRedo]);

  return (
    <div className="studio-shell h-dvh w-full overflow-hidden grid grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] bg-[#080A0D] text-[#F1F5F9] select-none font-sans">
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
        onNewProject={() => { void handleLoadStarterTemplate(selectedTemplateId, 16, 'sketch'); }}
        onCreateProjectWithMode={(mode, bars) => {
          void handleLoadStarterTemplate(selectedTemplateId, bars, mode);
        }}
        onReportStatus={setStatusMessage}
        onSaveProject={() => { void handleSaveProjectSnapshot(); }}
        onOpenProject={() => projectSnapshotInputRef.current?.click()}
        onImportAlsClick={() => fileInputRef.current?.click()}
        onExportAls={handleExportNativeAls}
        onExportWav={() => handleExportLosslessWav(24)}
        onOpenQueueModal={() => setIsBulkQueueModalOpen(true)}
        onOpenClearModal={() => setStudioWorkspace('queue')}
        onOpenCommandPalette={() => setIsCommandPaletteOpen(true)}
        onOpenCompingModal={() => setIsCompingModalOpen(true)}
        onSwitchWorkspace={(ws) => {
          setActiveTab('workbench');
          setStudioWorkspace(ws);
        }}
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
          setStudioWorkspace(tab);
        }}
        onToggleLeftDock={() => setLeftDockOpen((v) => !v)}
        onToggleBottomDock={() => setBottomDockOpen((v) => !v)}
        onToggleRightDock={() => setRightDockOpen((v) => !v)}
        onApplyLayoutPreset={handleApplyLayoutPreset}
      />

      {/* 4. SOUNDCRAFT PROFESSIONAL DAW WORKSTATION BODY (CSS GRID CELL) */}
      <div className="min-h-0 min-w-0 flex flex-col overflow-hidden">
        {activeTab === 'workbench' && (
          <SoundCraftWorkstation
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
            onClearArrangement={handleClearArrangement}
            onExportNativeAls={handleExportNativeAls}
            onRandomizeTrackVelocities={handleRandomizeTrackVelocities}
            onApplyMidiQuantizeStrength={handleApplyMidiQuantizeStrength}
            onSelectStrategy={setActiveStrategyId}
            onSelectForm={setActiveFormId}
            onComposeSingleLayer={(arch) => handleInjectLayer(arch)}
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
        statusMessage={statusMessage}
        alsValid={!!project.alsValidation?.isValid}
        canUndo={studioCommandBus.canUndo(currentProjectQueueKey)}
        canRedo={studioCommandBus.canRedo(currentProjectQueueKey)}
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

