import { saveExportBlob } from './services/fileExportService';
import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  STARTER_TEMPLATES,
  syncTrackClipsToXml,
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

const DEFAULT_HUMANIZATION: HumanizationConfig = {
  microTimingMaxShiftBeats: 0.015,
  swingStrength: 0,
  shuffleSwing: 0,
  velocityVariancePct: 0.08,
  ghostVelocityMin: 20,
  ghostVelocityMax: 45,
  lfoRateHz: 0.1,
  lfoDepth: 0.42,
  cutoffHz: 145.0,
  macroTransition: 42,
};

const DEFAULT_TRANSPORT: TransportConfig = {
  loopEnabled: true,
  loopStartBar: 1,
  loopLengthBars: 4,
  arrangementLengthBars: 16,
  metronomeEnabled: false,
  followPlayhead: true,
  showAutomationLanes: false,
};

const DEFAULT_MASTER_BUS: MasterBusConfig = {
  masterVolumeDb: 0,
  glueCompressionDrive: 0.35,
  reverbDecaySec: 3.2,
  reverbReturnLevel: 0.45,
  delayFeedback: 0.42,
  delayReturnLevel: 0.4,
  subBassMonoCutoffHz: 120,
  limiterCeilingDbtp: -1.0,
  limiterReleaseMs: 85,
  limiterLookaheadMs: 4,
  targetIntegratedLufs: -14.0,
  masterAutomationPoints: [
    { beat: 0, value: 0.55 },
    { beat: 32, value: 0.52 },
    { beat: 48, value: 0.55 },
    { beat: 64, value: 0.55 },
  ],
};

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

function enrichProjectWithAnalysis(
  rawState: AbletonProjectState,
  formId: MacroArrangementFormId
): AbletonProjectState {
  const totalBars = rawState.arrangementLengthBars || 16;
  const musicalProfile = analyzeProjectMusicalProfile(rawState);
  const arrangementSections = generateSectionArrangementPlan(formId, totalBars, rawState.lastGenerationIdentity?.compositionSeed || 0);
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
  const [humanization, setHumanization] = useState<HumanizationConfig>(DEFAULT_HUMANIZATION);
  const [transport, setTransport] = useState<TransportConfig>(DEFAULT_TRANSPORT);
  const [masterBus, setMasterBus] = useState<MasterBusConfig>(DEFAULT_MASTER_BUS);

  // Granular Clear Arrangement state
  const [clearOptions, setClearOptions] = useState<ClearArrangementOptions>({
    scope: 'selected_track',
    wipeNotes: true,
    wipeAutomation: true,
    wipeSessionClips: false,
    resetMixerToNeutral: false,
  });

  const [compositionSeed, setCompositionSeed] = useState<number>(
    () => Math.floor(Math.random() * 1000000) + 101
  );
  const [jitterSeed, setJitterSeed] = useState<number>(
    () => Math.floor(Math.random() * 1000000) + 1
  );
  const [activeStrategyId, setActiveStrategyId] =
    useState<CompositionStrategyId>('hypnotic_evolving');
  const [activeFormId, setActiveFormId] =
    useState<MacroArrangementFormId>('hypnotic_longform');

  const [project, setProject] = useState<AbletonProjectState>(() => {
    const seed = Math.floor(Math.random() * 1000000) + 1;
    const { xml, meta } = buildStarterAbletonXml('berghain-134', seed);
    const parsed = parseAbletonXmlDom(xml, meta.name, xml);
    return enrichProjectWithAnalysis(parsed, 'hypnotic_longform');
  });

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

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Subscribe to ProjectQueueService & StudioCommandBus
  useEffect(() => {
    const unsubQueue = projectQueueService.subscribe(() => {
      setQueueItems(projectQueueService.getAllItems());
      setActiveQueueId(projectQueueService.getActiveQueueId());
    });
    const unsubCmd = studioCommandBus.subscribe(() => {
      setCommandBusTick((t) => t + 1);
    });
    if (projectQueueService.getAllItems().length === 0) {
      void projectQueueService.enqueueProjectFromXml(
        project.fileName,
        project.rawXmlModified || project.rawXml || ''
      );
    }
    return () => {
      unsubQueue();
      unsubCmd();
    };
  }, []);

  const currentProjectQueueKey = activeQueueId || 'default_workstation_project';

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
      setProject((prev) => {
        const next = studioCommandBus.executeMutation(
          currentProjectQueueKey,
          label,
          category,
          prev,
          mutator
        );
        const enriched = enrichProjectWithAnalysis(next, activeFormId);
        if (activeQueueId) {
          projectQueueService.updateWorkingProjectState(activeQueueId, enriched);
        }
        setStatusMessage(`Executed: ${label}`);
        return enriched;
      });
    },
    [currentProjectQueueKey, activeFormId, activeQueueId]
  );

  const handleUndo = useCallback(() => {
    const restored = studioCommandBus.undo(currentProjectQueueKey);
    if (restored) {
      const enriched = enrichProjectWithAnalysis(restored, activeFormId);
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

  const handleLoadStarterTemplate = (templateId = selectedTemplateId) => {
    const freshSeed = Math.floor(Math.random() * 10000000) + 1;
    setSelectedTemplateId(templateId);
    setCompositionSeed(freshSeed);
    setJitterSeed(freshSeed + 79);

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

    const { xml, meta } = buildStarterAbletonXml(templateId, freshSeed);
    const parsed = parseAbletonXmlDom(xml, meta.name, xml);
    const enriched = enrichProjectWithAnalysis(parsed, nextForm);
    setProject(enriched);
    setSelectedTrackId(enriched.tracks[0]?.id || '1');
    setStatusMessage(
      `Loaded & Analyzed: ${meta.name} (${enriched.tempo} BPM · ${enriched.rootKey} ${enriched.scale} · Strategy: ${nextStrategy}).`
    );
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    try {
      const firstFile = files[0];
      setStatusMessage(
        `Decompressing & ingesting ${files.length} .als project file(s) into Studio Queue...`
      );
      const { xml, wasGzipped } = await decompressAlsFile(firstFile);
      const parsed = parseAbletonXmlDom(xml, firstFile.name, xml);
      const enriched = enrichProjectWithAnalysis(parsed, activeFormId);
      setProject(enriched);
      setSelectedTrackId(enriched.tracks[0]?.id || '1');

      // Enqueue all selected files into ProjectQueueService
      for (let i = 0; i < files.length; i++) {
        const rec = await projectQueueService.enqueueBrowserFile(files[i]);
        if (i === 0) {
          projectQueueService.switchActiveProject(rec.queueId, enriched);
        }
      }

      if (files.length > 1) {
        setIsBulkQueueModalOpen(true);
      }

      setStatusMessage(
        `Ingested ${files.length} project(s) · Active: ${firstFile.name} (${
          wasGzipped ? 'Gzipped .als' : 'Raw XML'
        }) · ${enriched.tracks.length} tracks @ ${enriched.tempo} BPM.`
      );
    } catch (err: any) {
      setStatusMessage(`Failed to parse .als file: ${err.message}`);
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
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
      setCompositionSeed(nextCompSeed);
      setJitterSeed(nextHumSeed);

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

      setProject(enriched);

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
    setCompositionSeed(baseCompSeed);
    setJitterSeed(baseHumSeed);

    const sharedSections = generateSectionArrangementPlan(activeFormId, totalBars, baseCompSeed);
    // Full-arrangement composition also withdraws the existing unlocked kick during
    // builds/breakdowns. Preserve its rhythm and every locked track.
    for (const track of project.tracks.filter(track => track.archetype === 'kick' && !track.locked)) {
      const arranged = decomposeNotesIntoSectionClips(track.name, track.archetype,
        track.clips.flatMap(clip => clip.notes), totalBars, sharedSections);
      workingXml = syncTrackNotesToXml(workingXml, track.id, track.archetype,
        `${track.name}_Arranged`, arranged.flatMap(clip => clip.notes), totalBeats);
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
      if (!comp || t.locked) return t;
      return {
        ...t,
        clips: t.clips.map((c, i) =>
          i === 0 ? { ...c, length: totalBeats, notes: comp.notes } : c
        ),
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

    setProject(enriched);
    const rumbleTrack = enriched.tracks.find((t) => t.archetype === 'rumble');
    if (rumbleTrack) setSelectedTrackId(rumbleTrack.id);
    setStatusMessage(
      `Composed full 8-track techno suite (${totalBars} Bars) using "${activeStrategyId}" (${activeFormId}) · Novelty & Kick-Sidechain verified.`
    );
  };

  // Handler: Spectral Auto-Ducking (Dynamic EQEight notch + Compressor2 sidechain into XML & DSP)
  const handleApplySpectralAutoDuck = (trackId: string, config: SpectralDuckingConfig) => {
    setProject((prev) => {
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

      const reParsed = parseAbletonXmlDom(updatedXml, prev.fileName, prev.rawXmlOriginal);
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
    setProject((prev) => {
      const targetTrack = prev.tracks.find((t) => t.id === trackId);
      if (!targetTrack) return prev;

      const updatedXml = injectLibraryDeviceIntoTrackXml(
        prev.rawXmlModified,
        trackId,
        targetTrack.name,
        templateId
      );

      const reParsed = parseAbletonXmlDom(updatedXml, prev.fileName, prev.rawXmlOriginal);
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
    const calibration = computeAiSmartMixCalibration(project);
    setMasterBus((prev) => ({
      ...prev,
      ...calibration.masterBusPatch,
    }));

    setProject((prev) => {
      const updatedTracks = prev.tracks.map((t) => {
        const patch = calibration.trackMixerPatches[t.id];
        if (!patch) return t;
        return {
          ...t,
          mixer: {
            ...t.mixer,
            ...patch,
          },
        };
      });
      return {
        ...prev,
        tracks: updatedTracks,
      };
    });

    setStatusMessage(calibration.summary);
  };

  // Handler: Inject Euclidean Polyrhythm / True Polymeter Clip into Ableton XML
  const handleInjectPolyrhythmClip = (trackId: string, config: PolyrhythmConfig) => {
    setProject((prev) => {
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

      const updatedXml = syncTrackNotesToXml(
        prev.rawXmlModified,
        targetTrack.name,
        targetTrack.archetype,
        clipName,
        notes,
        totalBeats,
        loopEndBeats
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
          rawXmlModified: updatedXml,
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
    setProject((prev) => {
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
      const updatedXml = syncTrackNotesToXml(
        prev.rawXmlModified,
        targetTrack.name,
        targetTrack.archetype,
        clipName,
        transformedNotes,
        totalBeats
      );

      const updatedTracks = prev.tracks.map((t) => {
        if (t.id !== trackId) return t;
        return {
          ...t,
          clips: t.clips.map((c, idx) =>
            idx === 0 ? { ...c, name: clipName, length: totalBeats, notes: transformedNotes } : c
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
          rawXmlModified: updatedXml,
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

    setProject(
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
    setTransport((prev) => ({
      ...prev,
      arrangementLengthBars: safeBars,
    }));

    setProject((prev) => {
      // Non-destructive extent change: Preserves 100% of existing clips, notes, and track structures
      return {
        ...prev,
        arrangementLengthBars: safeBars,
      };
    });

    setStatusMessage(
      `Set Arrangement Extent to ${safeBars} Bars (${safeBars * 4} Beats). All existing clips and notes preserved.`
    );
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

    const updatedXml = syncTrackNotesToXml(
      project.rawXmlModified,
      targetTrack.name,
      targetTrack.archetype,
      targetTrack.clips[0].name,
      transformedNotes,
      totalBeats
    );

    setProject((prev) =>
      enrichProjectWithAnalysis(
        {
          ...prev,
          rawXmlModified: updatedXml,
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
    setProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, locked: !t.locked } : t)),
    }));
  };

  const handleLaunchSessionScene = (sceneIdx: number, specificTrackId?: string) => {
    setProject((prev) => {
      let workingXml = prev.rawXmlModified;
      const totalBeats = (prev.arrangementLengthBars || 16) * 4;
      const updatedTracks = prev.tracks.map((track) => {
        if (specificTrackId && track.id !== specificTrackId) return track;
        const sceneClip = track.sessionClips?.[sceneIdx];
        if (!sceneClip || sceneClip.notes.length === 0) {
          return { ...track, activeSessionSlot: sceneIdx };
        }
        workingXml = syncTrackNotesToXml(
          workingXml,
          track.name,
          track.archetype,
          sceneClip.name,
          sceneClip.notes,
          totalBeats
        );
        return {
          ...track,
          activeSessionSlot: sceneIdx,
          clips: [{ ...sceneClip, length: totalBeats }],
        };
      });
      return enrichProjectWithAnalysis(
        {
          ...prev,
          rawXmlModified: workingXml,
          tracks: updatedTracks,
        },
        activeFormId
      );
    });
    setStatusMessage(
      specificTrackId
        ? `Launched Session Clip Scene ${String.fromCharCode(65 + sceneIdx)} on Track #${specificTrackId}.`
        : `Launched Master Session Scene ${String.fromCharCode(65 + sceneIdx)} across all tracks.`
    );
  };

  const handleGenerateAiVariation = async (archetype: TechnoArchetype) => {
    const aiSeed = Math.floor(Math.random() * 1000000) + 1;
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
      if (data.notes && Array.isArray(data.notes)) {
        handleInjectLayer(archetype, data.notes, data.clipName, data.rationale, aiSeed);
      } else {
        handleInjectLayer(archetype, undefined, undefined, undefined, aiSeed);
      }
    } catch {
      handleInjectLayer(archetype, undefined, undefined, undefined, aiSeed);
    } finally {
      setAiLoadingArchetype(null);
    }
  };

  const handleUpdateHumanization = (partial: Partial<HumanizationConfig>) => {
    const nextConfig = { ...humanization, ...partial };
    setHumanization(nextConfig);

    const curveLookup = buildVelocityCurveLookup(project.tracks);
    const updatedXml = TechnoHeuristicEngine.rehumanizeAllProjectTracks(
      project.rawXmlModified,
      project.rootKey,
      nextConfig,
      jitterSeed,
      curveLookup,
      undefined,
      project.tempo
    );
    const rawUpdatedState = parseAbletonXmlDom(
      updatedXml,
      project.fileName,
      project.rawXmlOriginal
    );
    const updatedState = preserveTrackStates(rawUpdatedState, project);
    setProject(enrichProjectWithAnalysis(updatedState, activeFormId));
  };

  const handleRehumanizeAll = () => {
    const nextSeed = Math.floor(Math.random() * 1000000) + 1;
    setJitterSeed(nextSeed);

    const curveLookup = buildVelocityCurveLookup(project.tracks);
    const updatedXml = TechnoHeuristicEngine.rehumanizeAllProjectTracks(
      project.rawXmlModified,
      project.rootKey,
      humanization,
      nextSeed,
      curveLookup,
      undefined,
      project.tempo
    );
    const rawUpdatedState = parseAbletonXmlDom(
      updatedXml,
      project.fileName,
      project.rawXmlOriginal
    );
    const preserved = preserveTrackStates(rawUpdatedState, project);

    const updatedTracks = preserved.tracks.map((t, idx) => {
      if (!t.sessionClips || !t.velocityCurve) return t;
      return {
        ...t,
        sessionClips: t.sessionClips.map((sc, sIdx) => ({
          ...sc,
          notes: applyTrackVelocityCurveToNotes(
            sc.notes,
            t.velocityCurve,
            humanization,
            nextSeed + idx * 31 + sIdx * 13
          ),
        })),
      };
    });

    const updatedState = { ...preserved, tracks: updatedTracks };
    setProject(enrichProjectWithAnalysis(updatedState, activeFormId));

    const activeCurveLabel = selectedTrack?.velocityCurve?.preset?.toUpperCase() || 'CUSTOM';
    setStatusMessage(
      `Re-seeded Jitter (Seed #${nextSeed % 1000}) · Injected ${activeCurveLabel} velocity curves & Gaussian micro-timing (±${humanization.microTimingMaxShiftBeats.toFixed(3)} b) into XML <MidiNoteEvent> nodes.`
    );
  };

  const handleTogglePlay = () => {
    if (isPlaying) {
      synthEngine.stop();
      setIsPlaying(false);
      setMasterPeakDb(-60);
    } else {
      synthEngine.start(false);
      setIsPlaying(true);
    }
  };

  const handlePlayCompleteSequence = () => {
    const bars = project.arrangementLengthBars || transport.arrangementLengthBars || 16;
    const nextTransport: TransportConfig = { ...transport, loopEnabled: false };
    setTransport(nextTransport);
    synthEngine.setState(project, humanization, nextTransport, masterBus);
    synthEngine.seek(0);
    setPlayheadBeat(0);
    if (!isPlaying) {
      synthEngine.start(true);
      setIsPlaying(true);
    }
    setStatusMessage(
      `Loop OFF · Playing complete ${bars}-bar (${bars * 4}-beat) arrangement sequence.`
    );
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
    synthEngine.updateTrackMixerLive(trackId, partial);
    setProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) =>
        t.id === trackId ? { ...t, mixer: { ...t.mixer, ...partial } } : t
      ),
    }));
  };

  const handleUpdateTrackVelocityCurve = (
    trackId: string,
    velocityCurve: VelocityCurveConfig,
    injectImmediately = true
  ) => {
    setProject((prev) => {
      let workingXml = prev.rawXmlModified;
      let updatedNoteCount = 0;
      let targetTrackName = '';
      const totalBeats = (prev.arrangementLengthBars || 16) * 4;

      const updatedTracks = prev.tracks.map((t, idx) => {
        if (t.id !== trackId) return t;
        targetTrackName = t.name;

        if (!injectImmediately || t.clips.length === 0) {
          return { ...t, velocityCurve };
        }

        const primaryClip = t.clips[0];
        const curvedNotes = applyTrackVelocityCurveToNotes(
          primaryClip.notes,
          velocityCurve,
          humanization,
          jitterSeed + idx * 29
        );
        updatedNoteCount = curvedNotes.length;

        workingXml = syncTrackNotesToXml(
          workingXml,
          t.name,
          t.archetype,
          primaryClip.name,
          curvedNotes,
          totalBeats,
          primaryClip.loopEndBeats
        );

        const nextSessionClips = t.sessionClips?.map((sc, sIdx) => ({
          ...sc,
          notes: applyTrackVelocityCurveToNotes(
            sc.notes,
            velocityCurve,
            humanization,
            jitterSeed + idx * 29 + sIdx * 11
          ),
        }));

        return {
          ...t,
          velocityCurve,
          clips: [{ ...primaryClip, notes: curvedNotes }],
          sessionClips: nextSessionClips,
        };
      });

      if (targetTrackName && injectImmediately) {
        setStatusMessage(
          `Injected ${velocityCurve.preset.toUpperCase()} velocity curve (${Math.round(
            velocityCurve.intensity * 100
          )}% depth · Vel ${velocityCurve.minVelocity}–${velocityCurve.maxVelocity}) into ${updatedNoteCount} <MidiNoteEvent> nodes on ${targetTrackName}.`
        );
      }

      return enrichProjectWithAnalysis(
        {
          ...prev,
          tracks: updatedTracks,
          rawXmlModified: workingXml,
        },
        activeFormId
      );
    });
  };

  const handleRandomizeTrackVelocities = (
    trackId: string,
    config: TrackVelocityRandomizerConfig
  ) => {
    handleExecuteProjectCommand(
      `Randomize Velocities (${selectedTrack?.name || 'Track'})`,
      'clip_edit',
      (proj) => {
        let workingXml = proj.rawXmlModified;
        let randomizedCount = 0;
        const totalBeats = (proj.arrangementLengthBars || 16) * 4;

        const updatedTracks = proj.tracks.map((track, idx) => {
          if (track.id !== trackId || track.clips.length === 0) return track;
          const clip = track.clips[0];

          const blend = Math.max(0, Math.min(1, config.blendPct / 100));
          const span = Math.max(1, config.maxVelocity - config.minVelocity);

          const nextNotes = clip.notes.map((note, nIdx) => {
            const isAccent = Boolean(note.isAccent || note.velocity >= 110);
            const isDownbeat = Math.abs(note.time % 4) < 0.05;

            if (config.accentLock && isAccent) return note;
            if (config.downbeatLock && isDownbeat) return note;

            const hash =
              Math.sin(config.seed + idx * 79 + nIdx * 19 + note.pitch * 31 + note.time * 97) *
              43758.5453;
            const randNorm = hash - Math.floor(hash);
            const targetRandVel = Math.round(config.minVelocity + randNorm * span);

            const blendedVel = Math.max(
              1,
              Math.min(127, Math.round(note.velocity * (1 - blend) + targetRandVel * blend))
            );
            randomizedCount++;

            return {
              ...note,
              velocity: blendedVel,
            };
          });

          workingXml = syncTrackNotesToXml(
            workingXml,
            track.name,
            track.archetype,
            clip.name,
            nextNotes,
            totalBeats,
            clip.loopEndBeats
          );

          return {
            ...track,
            clips: [{ ...clip, notes: nextNotes }],
          };
        });

        setStatusMessage(
          `Randomized ${randomizedCount} note velocities on ${selectedTrack?.name || 'track'} (${config.minVelocity}–${config.maxVelocity} · Blend ${config.blendPct}%)`
        );

        return enrichProjectWithAnalysis(
          {
            ...proj,
            tracks: updatedTracks,
            rawXmlModified: workingXml,
          },
          activeFormId
        );
      }
    );
  };

  const handleApplyMidiQuantizeStrength = (
    trackId: string,
    gridDivision: NoteGridDivision,
    strengthPct: 50 | 75 | 100
  ) => {
    handleExecuteProjectCommand(
      `Quantize ${strengthPct}% (${gridDivision}) on ${selectedTrack?.name || 'Track'}`,
      'clip_edit',
      (proj) => {
        let workingXml = proj.rawXmlModified;
        const totalBeats = (proj.arrangementLengthBars || 16) * 4;

        const updatedTracks = proj.tracks.map((track) => {
          if (track.id !== trackId || track.clips.length === 0) return track;
          const clip = track.clips[0];

          const { notes: quantizedNotes, description } = applyMidiQuantizeStrength(
            clip.notes,
            gridDivision,
            strengthPct
          );

          workingXml = syncTrackNotesToXml(
            workingXml,
            track.name,
            track.archetype,
            clip.name,
            quantizedNotes,
            totalBeats,
            clip.loopEndBeats
          );

          setStatusMessage(`${track.name} · ${description}`);

          return {
            ...track,
            clips: [{ ...clip, notes: quantizedNotes }],
          };
        });

        return enrichProjectWithAnalysis(
          {
            ...proj,
            tracks: updatedTracks,
            rawXmlModified: workingXml,
          },
          activeFormId
        );
      }
    );
  };

  const handleUpdateTrackAutomation = (trackId: string, points: AutomationPoint[]) => {
    setProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) =>
        t.id === trackId ? { ...t, automationPoints: points } : t
      ),
    }));
    setStatusMessage(`Updated <AutomationEnvelope> curve (${points.length} breakpoints).`);
  };

  const handleToggleMute = (trackId: string) => {
    const target = project.tracks.find((t) => t.id === trackId);
    if (target) {
      synthEngine.updateTrackMixerLive(trackId, undefined, { muted: !target.muted });
    }
    setProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)),
    }));
  };

  const handleToggleSolo = (trackId: string) => {
    const target = project.tracks.find((t) => t.id === trackId);
    if (target) {
      synthEngine.updateTrackMixerLive(trackId, undefined, { soloed: !target.soloed });
    }
    setProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, soloed: !t.soloed } : t)),
    }));
  };

  const handleToggleNoteInTrack = (
    trackId: string,
    stepBeat: number,
    pitch: number,
    stepDuration = 0.25
  ) => {
    setProject((prev) => {
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
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(project.rawXmlModified, 'application/xml');
    const tempoManual =
      xmlDoc.querySelector('MasterTrack Tempo Manual') || xmlDoc.querySelector('Tempo > Manual');
    if (tempoManual) {
      tempoManual.setAttribute('Value', `${clamped}`);
    }
    const serialized = formatXmlString(new XMLSerializer().serializeToString(xmlDoc));
    setProject((prev) => ({
      ...prev,
      tempo: clamped,
      rawXmlModified: serialized,
    }));
  };

  const handleExportNativeAls = async () => {
    try {
      setStatusMessage(
        'Compressing modified XML DOM into native gzipped Ableton Live .als binary...'
      );
      const { blob, gzipBytes } = await compressXmlToAlsBlob(project.rawXmlModified);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const cleanBase = project.fileName.replace(/\.als$/i, '').replace(/\.xml$/i, '');
      const exportName = `${cleanBase}_parametric_techno.als`;
      a.href = url;
      a.download = exportName;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMessage(
        `Exported ${exportName} (${(gzipBytes / 1024).toFixed(1)} KB gzipped .als) — 100% native Ableton Live 11/12 compatible.`
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
      gridStepBeats: number
    ) => {
      handleExecuteProjectCommand(
        `Move Note (${mode.toUpperCase()} Mode) to Beat ${targetBeat.toFixed(2)}`,
        'edit_mode',
        (draft) => applyNoteEditWithMode(draft, trackId, 0, noteId, targetBeat, mode, gridStepBeats)
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
    <div className="studio-shell h-dvh w-full overflow-hidden grid grid-rows-[auto_auto_auto_minmax(0,1fr)_auto] bg-[#080A0D] text-[#F1F5F9] select-none font-sans">
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
        onNewProject={() => {
          const seed = Math.floor(Math.random() * 1000000) + 1;
          const { xml, meta } = buildStarterAbletonXml('berghain-134', seed);
          const parsed = parseAbletonXmlDom(xml, meta.name, xml);
          setProject(enrichProjectWithAnalysis(parsed, 'hypnotic_longform'));
        }}
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
          const switched = projectQueueService.switchActiveProject(targetQueueId, project);
          if (switched) {
            const enriched = enrichProjectWithAnalysis(switched, activeFormId);
            setProject(enriched);
            setSelectedTrackId(enriched.tracks[0]?.id || '1');
            setStatusMessage(`Switched active workstation project to ${enriched.fileName}.`);
          }
        }}
        onSyncActiveProjectFromQueue={(updatedProject) => {
          setProject(enrichProjectWithAnalysis(updatedProject, activeFormId));
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
          const enriched = enrichProjectWithAnalysis(newProject, activeFormId);
          setProject(enriched);
          const safeBars: 16 | 32 | 64 | 128 =
            enriched.arrangementLengthBars === 32 ||
            enriched.arrangementLengthBars === 64 ||
            enriched.arrangementLengthBars === 128
              ? enriched.arrangementLengthBars
              : 16;
          setTransport((prev) => ({
            ...prev,
            arrangementLengthBars: safeBars,
          }));
          setMasterBus((prev) => ({
            ...prev,
            limiterCeilingDbtp: -1.0,
            targetIntegratedLufs: -14.0,
            masterAutomationPoints: [
              { beat: 0, value: 0.96 },
              { beat: (safeBars * 4) * 0.5, value: 0.88 },
              { beat: (safeBars * 4) * 0.75, value: 1.0 },
              { beat: safeBars * 4, value: 0.95 },
            ],
          }));
          setSelectedTrackId(enriched.tracks[0]?.id || '1');
          setStatusMessage(
            `AI Reference Counterpart Loaded: ${enriched.fileName} (${enriched.tempo} BPM · ${enriched.rootKey} ${enriched.scale} · -1.0 dBTP Master Automated).`
          );
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

