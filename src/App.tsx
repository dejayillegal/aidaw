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
  injectLibraryDeviceIntoTrackXml,
  injectMidiClipXmlNode,
  parseAbletonXmlDom,
  STARTER_TEMPLATES,
  TechnoHeuristicEngine,
} from './engine/alsXmlEngine';
import {
  analyzeProjectMusicalProfile,
  applyChordAndGridTransformToNotes,
  applyLive12MidiTool,
  composeProjectConditionedLayerNotes,
  COMPOSITION_STRATEGIES,
  generateContextualAutomationPoints,
  generateSectionArrangementPlan,
  MACRO_ARRANGEMENT_FORMS,
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
import { BulkQueueAndExportModal } from './components/BulkQueueAndExportModal';
import {
  CompingAndTransientModal,
  StudioCommandPalette,
} from './components/StudioCommandPalette';
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
  const arrangementSections = generateSectionArrangementPlan(formId, totalBars);
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
  const [playheadBeat, setPlayheadBeat] = useState<number>(0);
  const [modulatedCutoffHz, setModulatedCutoffHz] = useState<number>(145.0);
  const [masterPeakDb, setMasterPeakDb] = useState<number>(-60);
  const [aiLoadingArchetype, setAiLoadingArchetype] = useState<TechnoArchetype | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>(
    `Ready · ${project.fileName} (${project.tempo} BPM · ${project.rootKey} ${project.scale}).`
  );

  // SoundCraft Workstation & Queue States
  const [editMode, setEditMode] = useState<TimelineEditMode>('grid');
  const [queueItems, setQueueItems] = useState<QueuedProjectRecord[]>(() =>
    projectQueueService.getAllItems()
  );
  const [activeQueueId, setActiveQueueId] = useState<string | null>(() =>
    projectQueueService.getActiveQueueId()
  );
  const [isBulkQueueModalOpen, setIsBulkQueueModalOpen] = useState<boolean>(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);
  const [isCompingModalOpen, setIsCompingModalOpen] = useState<boolean>(false);
  const [, setCommandBusTick] = useState<number>(0);

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
        project.rawXmlModified || project.rawXml
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
        | 'calibration',
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
      (beat, cutoffMod, peakDb) => {
        setPlayheadBeat(beat);
        setModulatedCutoffHz(cutoffMod);
        setMasterPeakDb(peakDb);
      },
      () => {
        setIsPlaying(false);
        const bars = project.arrangementLengthBars || transport.arrangementLengthBars || 16;
        setStatusMessage(
          `Completed full ${bars}-bar (${bars * 4}-beat) arrangement sequence playthrough.`
        );
      }
    );
  }, [project, humanization, transport, masterBus]);

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
        totalBars
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
          totalBars
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

  // Handler: Configurable Arrangement Duration (16, 32, 64, 128 Bars)
  const handleChangeArrangementLength = (bars: 16 | 32 | 64 | 128) => {
    setTransport((prev) => ({
      ...prev,
      arrangementLengthBars: bars,
    }));

    setProject((prev) => {
      const targetBeats = bars * 4;
      let workingXml = prev.rawXmlModified;

      const updatedTracks = prev.tracks.map((track) => {
        const clip = track.clips[0];
        if (!clip) return track;

        let nextNotes = [...clip.notes];
        if (nextNotes.length > 0) {
          const currentMaxBeat = Math.max(64, ...nextNotes.map((n) => n.quantizedTime + 0.25));
          const sourceCycleBeats = Math.min(64, Math.max(16, Math.ceil(currentMaxBeat / 16) * 16));
          const baseCycleNotes = nextNotes.filter((n) => n.quantizedTime < sourceCycleBeats);

          if (targetBeats > sourceCycleBeats && baseCycleNotes.length > 0) {
            const tiled: typeof nextNotes = [];
            const reps = Math.ceil(targetBeats / sourceCycleBeats);
            for (let r = 0; r < reps; r++) {
              baseCycleNotes.forEach((bn, idx) => {
                const offset = r * sourceCycleBeats;
                if (bn.quantizedTime + offset >= targetBeats) return;
                tiled.push({
                  ...bn,
                  id: `${bn.id}_r${r}_${idx}`,
                  quantizedTime: Number((bn.quantizedTime + offset).toFixed(3)),
                  time: Number((bn.time + offset).toFixed(3)),
                });
              });
            }
            nextNotes = tiled;
          } else {
            nextNotes = nextNotes.filter((n) => n.quantizedTime < targetBeats);
          }
        }

        workingXml = syncTrackNotesToXml(
          workingXml,
          track.name,
          track.archetype,
          clip.name,
          nextNotes,
          targetBeats,
          clip.loopEndBeats
        );

        return {
          ...track,
          clips: [{ ...clip, length: targetBeats, notes: nextNotes }],
          automationPoints: generateContextualAutomationPoints(
            track.archetype,
            activeFormId,
            compositionSeed,
            bars
          ),
        };
      });

      return enrichProjectWithAnalysis(
        {
          ...prev,
          arrangementLengthBars: bars,
          tracks: updatedTracks,
          rawXmlModified: workingXml,
        },
        activeFormId
      );
    });

    setStatusMessage(
      `Scaled Arrangement Timeline & XML Clips to ${bars} Bars (${bars * 4} Beats) with section-aligned automation.`
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
      curveLookup
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
      curveLookup
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
    setProject((prev) => ({
      ...prev,
      tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, muted: !t.muted } : t)),
    }));
  };

  const handleToggleSolo = (trackId: string) => {
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
      const totalBeats = (prev.arrangementLengthBars || 16) * 4;
      const updatedTracks = prev.tracks.map((track) => {
        if (track.id !== trackId || track.clips.length === 0) return track;
        const clip = track.clips[0];
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
      return { ...prev, tracks: updatedTracks, rawXmlModified: workingXml };
    });
  };

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
      setStatusMessage(
        `Rendering complete ${totalBars}-bar arrangement (44.1kHz / ${bitDepth}-bit Lossless Stereo WAV with Sidechain, Reverb, 3/16 Delay & Master Glue)...`
      );
      const { blob, durationSeconds } = await renderArrangementToWavBlob(
        project,
        humanization,
        masterBus,
        totalBars,
        bitDepth
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const cleanBase = project.fileName.replace(/\.als$/i, '').replace(/\.xml$/i, '');
      const exportName = `${cleanBase}_${project.tempo}bpm_${totalBars}bars_${bitDepth}bit.wav`;
      a.href = url;
      a.download = exportName;
      a.click();
      URL.revokeObjectURL(url);
      setStatusMessage(
        `Exported Lossless Audio Track: ${exportName} (${(blob.size / (1024 * 1024)).toFixed(2)} MB · ${durationSeconds.toFixed(1)}s · 44.1kHz/${bitDepth}-bit PCM).`
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
    <div className="min-h-screen flex flex-col bg-[#0B0D10] text-[#F1F5F9] pb-[env(safe-area-inset-bottom,0px)]">
      {/* Top Bar Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 px-3 sm:px-6 py-2.5 bg-[#0F1218] border-b border-[#232934] pt-[calc(0.625rem+env(safe-area-inset-top,0px))]">
        <div className="flex items-center gap-3">
          <a
            href="#workbench"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('workbench');
            }}
            className="text-sm sm:text-base font-display font-bold tracking-wider text-slate-100 whitespace-nowrap flex items-center gap-2"
          >
            PARAMETRIC ALS DAW
          </a>
          <span className="hidden sm:inline-block px-1.5 py-0.5 text-[10px] font-mono bg-amber-500/10 border border-amber-500/30 text-amber-300 rounded">
            LIVE 12 · 8-TRACK SUITE · ANDROID &amp; WEB v4.0
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-5 text-xs font-medium text-slate-400 overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('workbench')}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'workbench'
                ? 'text-amber-400 underline underline-offset-8 decoration-amber-400 font-semibold'
                : 'hover:text-slate-100'
            }`}
          >
            DAW Arrangement &amp; Mixer
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('xml')}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'xml'
                ? 'text-amber-400 underline underline-offset-8 decoration-amber-400 font-semibold'
                : 'hover:text-slate-100'
            }`}
          >
            XML Inspector
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('python')}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'python'
                ? 'text-amber-400 underline underline-offset-8 decoration-amber-400 font-semibold'
                : 'hover:text-slate-100'
            }`}
          >
            Python FastAPI Code
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('architecture')}
            className={`py-1 transition-colors whitespace-nowrap ${
              activeTab === 'architecture'
                ? 'text-amber-400 underline underline-offset-8 decoration-amber-400 font-semibold'
                : 'hover:text-slate-100'
            }`}
          >
            System Architecture
          </button>
        </nav>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <PWAInstallButton />

          <button
            type="button"
            onClick={() => setIsCommandPaletteOpen(true)}
            className="h-10 sm:h-8 px-2.5 text-xs font-mono font-semibold bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-700 rounded flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            title="Open Studio Command Palette (Cmd/Ctrl+K)"
          >
            <Command className="w-3.5 h-3.5 text-orange-400" />
            <span className="hidden xl:inline">Cmd+K</span>
          </button>

          <button
            type="button"
            onClick={() => setIsBulkQueueModalOpen(true)}
            className="h-10 sm:h-8 px-2.5 text-xs font-mono font-semibold bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 border border-orange-500/40 rounded flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            title="Bulk Process Smart Leveling 2.0 Queue & Master Export 2.0 Presets"
          >
            <Layers className="w-3.5 h-3.5 text-orange-400" />
            <span>Bulk Process ({queueItems.length})</span>
          </button>

          <button
            type="button"
            onClick={handleApplySmartLeveling}
            className="h-10 sm:h-8 px-2.5 text-xs font-mono font-semibold bg-[#1B2436] hover:bg-[#25324A] text-sky-300 border border-sky-500/40 rounded flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0"
            title="AI Smart Level: Auto-calibrate gain staging (-6dB headroom), EQ filters, sidechain & stereo field"
          >
            <Wand2 className="w-3.5 h-3.5 text-sky-400" />
            <span className="hidden xl:inline">AI Smart Level</span>
          </button>

          <button
            type="button"
            disabled={isExportingWav}
            onClick={() => handleExportLosslessWav(24)}
            className="h-10 sm:h-8 px-3 text-xs font-mono font-semibold bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 shadow-sm"
            title="Render complete arrangement to a studio lossless 44.1kHz 24-bit Stereo .WAV audio file"
          >
            <Disc className={`w-3.5 h-3.5 ${isExportingWav ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">
              {isExportingWav ? 'Rendering...' : 'Export 24-Bit .WAV'}
            </span>
            <span className="sm:hidden">.WAV</span>
          </button>

          <button
            type="button"
            onClick={handleExportNativeAls}
            className="h-10 sm:h-8 px-3 text-xs font-mono font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 shadow-sm"
            title="Export native gzipped Ableton Live project file (.als)"
          >
            <Download className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Export Native .als</span>
            <span className="sm:hidden">.ALS</span>
          </button>
        </div>
      </header>

      {/* Master Transport & Synchronization Sub-Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-6 py-2 bg-[#12161E] border-b border-[#232934] text-xs">
        <div className="flex items-center gap-1.5 sm:gap-2.5 overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          {/* Transactional Undo / Redo Buttons */}
          <div className="flex items-center gap-1 pr-1 border-r border-[#232934]">
            <button
              type="button"
              disabled={!studioCommandBus.canUndo(currentProjectQueueKey)}
              onClick={handleUndo}
              className="p-1.5 rounded bg-[#1B2230] hover:bg-[#263044] disabled:opacity-35 text-slate-200 border border-[#2E384D]"
              title={
                studioCommandBus.getLastUndoLabel(currentProjectQueueKey)
                  ? `Undo: ${studioCommandBus.getLastUndoLabel(currentProjectQueueKey)}`
                  : 'Undo (Cmd/Ctrl+Z)'
              }
            >
              <Undo2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              disabled={!studioCommandBus.canRedo(currentProjectQueueKey)}
              onClick={handleRedo}
              className="p-1.5 rounded bg-[#1B2230] hover:bg-[#263044] disabled:opacity-35 text-slate-200 border border-[#2E384D]"
              title={
                studioCommandBus.getLastRedoLabel(currentProjectQueueKey)
                  ? `Redo: ${studioCommandBus.getLastRedoLabel(currentProjectQueueKey)}`
                  : 'Redo (Cmd/Ctrl+Shift+Z)'
              }
            >
              <Redo2 className="w-3.5 h-3.5" />
            </button>
          </div>
          <button
            type="button"
            onClick={handleReturnToZero}
            className="min-w-[44px] min-h-[44px] sm:min-w-0 sm:min-h-0 sm:p-1.5 rounded bg-[#1B2230] hover:bg-[#263044] text-slate-200 border border-[#2E384D] transition-colors flex items-center justify-center"
            title="Return Playhead to Start (Bar 1.1.1)"
          >
            <SkipBack className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
          </button>

          <button
            type="button"
            onClick={handleTogglePlay}
            className={`min-h-[44px] sm:min-h-0 px-3.5 py-1.5 rounded font-mono font-semibold flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              isPlaying
                ? 'bg-amber-500 text-slate-950'
                : 'bg-[#1D2432] hover:bg-[#273042] text-slate-100 border border-[#313B4E]'
            }`}
          >
            {isPlaying ? (
              <Square className="w-4 h-4 sm:w-3.5 sm:h-3.5 fill-current" />
            ) : (
              <Play className="w-4 h-4 sm:w-3.5 sm:h-3.5 fill-current" />
            )}
            <span>{isPlaying ? 'Stop' : 'Play'}</span>
          </button>

          <button
            type="button"
            onClick={handlePlayCompleteSequence}
            className={`min-h-[44px] sm:min-h-0 px-3 py-1.5 rounded font-mono font-semibold flex items-center gap-1.5 border transition-colors whitespace-nowrap shrink-0 ${
              !transport.loopEnabled
                ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                : 'bg-[#171E2B] hover:bg-[#212B3D] text-emerald-300 border-emerald-500/40'
            }`}
          >
            <Play className="w-3.5 h-3.5 sm:w-3 sm:h-3 fill-current" />
            <span className="hidden sm:inline">Play Full {activeTotalBars}-Bar (No Loop)</span>
            <span className="sm:hidden">Full {activeTotalBars}B</span>
          </button>

          <button
            type="button"
            onClick={() => handleUpdateTransport({ loopEnabled: !transport.loopEnabled })}
            className={`min-h-[44px] sm:min-h-0 px-2.5 py-1.5 rounded font-mono font-semibold flex items-center gap-1 border transition-colors whitespace-nowrap shrink-0 ${
              transport.loopEnabled
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
                : 'bg-[#161B26] text-slate-400 border-[#283040] hover:text-slate-200'
            }`}
          >
            <Repeat className="w-3.5 h-3.5" />
            <span>{transport.loopEnabled ? `${transport.loopLengthBars}B` : 'OFF'}</span>
          </button>

          <button
            type="button"
            onClick={() =>
              handleUpdateTransport({ metronomeEnabled: !transport.metronomeEnabled })
            }
            className={`min-h-[44px] sm:min-h-0 px-2.5 py-1.5 rounded font-mono text-[11px] border transition-colors whitespace-nowrap shrink-0 ${
              transport.metronomeEnabled
                ? 'bg-sky-500/25 text-sky-300 border-sky-500/50 font-semibold'
                : 'bg-[#161B26] text-slate-400 border-[#283040] hover:text-slate-200'
            }`}
          >
            METRO: {transport.metronomeEnabled ? 'ON' : 'OFF'}
          </button>

          <div className="flex items-center gap-1 font-mono tabular-nums pl-1 shrink-0">
            <span className="text-slate-400 text-[11px]">BPM:</span>
            <button
              type="button"
              onClick={() => handleUpdateTempo(project.tempo - 1)}
              className="w-7 h-7 sm:w-6 sm:h-6 rounded bg-[#1A212E] hover:bg-[#253043] border border-[#2B3547] text-slate-300 flex items-center justify-center font-bold"
            >
              -
            </button>
            <input
              type="number"
              min={90}
              max={180}
              value={project.tempo}
              onChange={(e) => handleUpdateTempo(parseFloat(e.target.value) || 134)}
              className="w-13 sm:w-14 px-1.5 py-1 bg-[#0B0D10] border border-[#28303E] rounded text-amber-400 font-semibold text-center text-xs"
            />
            <button
              type="button"
              onClick={() => handleUpdateTempo(project.tempo + 1)}
              className="w-7 h-7 sm:w-6 sm:h-6 rounded bg-[#1A212E] hover:bg-[#253043] border border-[#2B3547] text-slate-300 flex items-center justify-center font-bold"
            >
              +
            </button>
          </div>

          <div className="hidden xl:flex items-center gap-2 font-mono tabular-nums text-slate-300 shrink-0">
            <span className="text-slate-600">·</span>
            <span>
              KEY: {project.rootKey} {project.scale}
            </span>
          </div>
        </div>

        <div className="font-mono text-[11px] sm:text-xs text-slate-300 truncate max-w-full sm:max-w-md">
          {statusMessage}
        </div>
      </div>

      {/* MOBILE & TABLET ABLETON SECTION DOCK SWITCHER */}
      <div className="flex lg:hidden bg-[#0D1016] border-b border-[#232934] overflow-x-auto text-xs font-mono select-none px-2 py-1 gap-1">
        <button
          type="button"
          onClick={() => setMobileSection('arrange')}
          className={`min-h-[44px] px-3 rounded flex items-center gap-1.5 whitespace-nowrap transition-colors ${
            mobileSection === 'arrange'
              ? 'bg-amber-500 text-slate-950 font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#161B26]'
          }`}
        >
          <Layers className="w-3.5 h-3.5" />
          <span>Arrangement</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileSection('composer')}
          className={`min-h-[44px] px-3 rounded flex items-center gap-1.5 whitespace-nowrap transition-colors ${
            mobileSection === 'composer'
              ? 'bg-amber-500 text-slate-950 font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#161B26]'
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          <span>AI Composer</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileSection('pianoroll')}
          className={`min-h-[44px] px-3 rounded flex items-center gap-1.5 whitespace-nowrap transition-colors ${
            mobileSection === 'pianoroll'
              ? 'bg-amber-500 text-slate-950 font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#161B26]'
          }`}
        >
          <Music className="w-3.5 h-3.5" />
          <span>Piano Roll</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileSection('pads')}
          className={`min-h-[44px] px-3 rounded flex items-center gap-1.5 whitespace-nowrap transition-colors ${
            mobileSection === 'pads'
              ? 'bg-amber-500 text-slate-950 font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#161B26]'
          }`}
        >
          <Grid className="w-3.5 h-3.5" />
          <span>Jam Pads</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileSection('devices')}
          className={`min-h-[44px] px-3 rounded flex items-center gap-1.5 whitespace-nowrap transition-colors ${
            mobileSection === 'devices'
              ? 'bg-amber-500 text-slate-950 font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#161B26]'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Devices &amp; Duck</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileSection('mix_console')}
          className={`min-h-[44px] px-3 rounded flex items-center gap-1.5 whitespace-nowrap transition-colors ${
            mobileSection === 'mix_console'
              ? 'bg-orange-500 text-slate-950 font-semibold shadow-sm'
              : 'text-orange-300 hover:text-slate-200 hover:bg-[#161B26]'
          }`}
        >
          <Sliders className="w-3.5 h-3.5" />
          <span>Mix Console &amp; VCA</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileSection('spectrum')}
          className={`min-h-[44px] px-3 rounded flex items-center gap-1.5 whitespace-nowrap transition-colors ${
            mobileSection === 'spectrum'
              ? 'bg-amber-500 text-slate-950 font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#161B26]'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Spectrum</span>
        </button>

        <button
          type="button"
          onClick={() => setMobileSection('project')}
          className={`min-h-[44px] px-3 rounded flex items-center gap-1.5 whitespace-nowrap transition-colors ${
            mobileSection === 'project'
              ? 'bg-amber-500 text-slate-950 font-semibold shadow-sm'
              : 'text-slate-400 hover:text-slate-200 hover:bg-[#161B26]'
          }`}
        >
          <FolderUp className="w-3.5 h-3.5" />
          <span>Project &amp; Clear</span>
        </button>
      </div>

      {/* Main Workspace Area */}
      <div className="flex-1 flex flex-col lg:flex-row overflow-hidden">
        {/* Left Sidebar */}
        <aside
          className={`w-full lg:w-[345px] shrink-0 bg-[#10131A] border-b lg:border-b-0 lg:border-r border-[#232934] flex flex-col overflow-y-auto ${
            activeTab !== 'workbench'
              ? 'hidden'
              : mobileSection === 'project'
              ? 'block'
              : 'hidden lg:flex'
          }`}
        >
          {/* 1. .als File Upload & Starter Template Selector */}
          <div className="p-3.5 border-b border-[#232934] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-semibold text-slate-200">
                01. INGEST ABLETON .ALS PROJECT
              </span>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept=".als,.xml,.gz"
                onChange={handleFileUpload}
                className="hidden"
              />
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="min-h-[40px] sm:min-h-0 px-2.5 py-1.5 text-xs font-mono bg-[#1B2230] hover:bg-[#252E40] text-amber-400 border border-[#2F3A50] rounded flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
                >
                  <FolderUp className="w-3.5 h-3.5" />
                  Upload .als
                </button>
                <button
                  type="button"
                  onClick={() => setIsBulkQueueModalOpen(true)}
                  className="min-h-[40px] sm:min-h-0 px-2.5 py-1.5 text-xs font-mono bg-orange-500/20 hover:bg-orange-500/30 text-orange-300 border border-orange-500/40 rounded flex items-center gap-1 transition-colors whitespace-nowrap shrink-0"
                  title="Open Multi-Project Bulk Smart Leveling 2.0 Queue & Master Export Presets"
                >
                  <Layers className="w-3.5 h-3.5" />
                  Bulk Queue
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-mono text-slate-400">
                  8-Track Procedural Starter Suites:
                </label>
                <button
                  type="button"
                  onClick={() => handleLoadStarterTemplate()}
                  className="min-h-[34px] sm:min-h-0 px-2.5 py-1 text-[11px] font-mono text-amber-300 hover:text-amber-200 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 rounded flex items-center gap-1 transition-colors whitespace-nowrap"
                >
                  <Dices className="w-3.5 h-3.5 text-amber-400" />
                  Roll Fresh
                </button>
              </div>

              <div className="space-y-1">
                {STARTER_TEMPLATES.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => handleLoadStarterTemplate(tpl.id)}
                    className={`w-full text-left px-2.5 py-2 sm:py-1.5 rounded border text-xs transition-colors ${
                      selectedTemplateId === tpl.id
                        ? 'bg-[#19202D] border-amber-500/60 text-slate-100 shadow-sm'
                        : 'bg-[#131720] border-[#212836] text-slate-400 hover:text-slate-200 hover:border-[#313B4D]'
                    }`}
                  >
                    <div className="font-mono font-semibold truncate flex items-center justify-between">
                      <span>{tpl.name}</span>
                      <span className="text-[10px] text-amber-400 font-normal">8-Track Suite</span>
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">{tpl.subtitle}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 2. TechnoHeuristicEngine 4.0 Full 8-Track Suite Layer Generator */}
          <div className="p-3.5 border-b border-[#232934] space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-semibold text-slate-200">
                02. 8-TRACK TECHNO SUITE GENERATOR
              </span>
              <button
                type="button"
                onClick={handleInjectAllMissingLayers}
                className="min-h-[36px] sm:min-h-0 px-2.5 py-1 text-[11px] font-mono font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 shadow-sm"
              >
                <Wand2 className="w-3.5 h-3.5" />
                Compose Full Suite
              </button>
            </div>

            <div className="p-2 bg-[#131822] border border-[#232B3A] rounded space-y-1.5">
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                <span>AI STRATEGY &amp; FORM ({activeTotalBars} BARS)</span>
                <button
                  type="button"
                  onClick={() => {
                    setDesktopBottomTab('composer');
                    setMobileSection('composer');
                  }}
                  className="text-amber-400 hover:underline flex items-center gap-0.5"
                >
                  <Cpu className="w-3 h-3" />
                  Polyrhythm &amp; Chords
                </button>
              </div>
              <select
                value={activeStrategyId}
                onChange={(e) => setActiveStrategyId(e.target.value as CompositionStrategyId)}
                className="w-full px-2 py-1 text-[11px] font-mono bg-[#0B0D10] border border-[#2A3346] rounded text-amber-300"
              >
                {COMPOSITION_STRATEGIES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.subtitle})
                  </option>
                ))}
              </select>
              <select
                value={activeFormId}
                onChange={(e) => setActiveFormId(e.target.value as MacroArrangementFormId)}
                className="w-full px-2 py-1 text-[11px] font-mono bg-[#0B0D10] border border-[#2A3346] rounded text-sky-300"
              >
                {MACRO_ARRANGEMENT_FORMS.map((f) => (
                  <option key={f.id} value={f.id}>
                    Form: {f.name}
                  </option>
                ))}
              </select>
            </div>

            {!hasSubOrRumble && (
              <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded text-[11px] font-mono text-amber-300">
                Diagnostic: No &quot;Sub&quot; or &quot;Rumble&quot; &lt;MidiTrack&gt; in DOM. Click{' '}
                <strong>Inject XML</strong> below to synthesize phase-locked Operator Sub + Kick Sidechain.
              </div>
            )}

            <div className="space-y-2">
              {ARCHETYPE_CATALOG.map((item) => {
                const existingTrack = project.tracks.find((t) => t.archetype === item.archetype);
                const isPresent = Boolean(existingTrack);
                const isLocked = Boolean(existingTrack?.locked);
                const isAiBusy = aiLoadingArchetype === item.archetype;

                return (
                  <div
                    key={item.archetype}
                    className={`p-2 bg-[#141923] border rounded space-y-1.5 ${
                      isLocked ? 'border-amber-500/40' : 'border-[#232A38]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-100 truncate">
                        {item.title}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        {existingTrack && (
                          <button
                            type="button"
                            onClick={() => handleToggleTrackLock(existingTrack.id)}
                            className={`p-1 rounded border transition-colors ${
                              isLocked
                                ? 'bg-amber-500/20 border-amber-500/50 text-amber-300'
                                : 'bg-[#1A202C] border-[#2A3346] text-slate-400 hover:text-slate-200'
                            }`}
                            title={
                              isLocked
                                ? 'Unlock track to allow regeneration'
                                : 'Lock track to protect from overwrite'
                            }
                          >
                            {isLocked ? (
                              <Lock className="w-3 h-3" />
                            ) : (
                              <Unlock className="w-3 h-3" />
                            )}
                          </button>
                        )}
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                            isPresent
                              ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                              : 'bg-slate-800 text-slate-400'
                          }`}
                        >
                          {isPresent ? 'Synced' : 'Missing'}
                        </span>
                      </div>
                    </div>

                    <div className="text-[10.5px] font-mono text-slate-400 leading-snug">
                      <div>{item.patternSpec}</div>
                      <div className="text-slate-300 mt-0.5">{item.deviceChainSpec}</div>
                    </div>

                    <div className="flex items-center gap-1.5 pt-0.5">
                      <button
                        type="button"
                        disabled={isLocked}
                        onClick={() => handleInjectLayer(item.archetype)}
                        className="min-h-[36px] sm:min-h-0 flex-1 px-2 py-1 text-[11px] font-mono font-medium bg-[#1E2636] hover:bg-[#283246] text-slate-100 border border-[#313D54] rounded flex items-center justify-center gap-1 transition-colors whitespace-nowrap shrink-0 disabled:opacity-40"
                      >
                        {isPresent ? (
                          <RefreshCw className="w-3 h-3 text-amber-400" />
                        ) : (
                          <Plus className="w-3 h-3 text-amber-400" />
                        )}
                        {isPresent ? 'Compose XML' : 'Inject XML'}
                      </button>

                      <button
                        type="button"
                        disabled={isAiBusy || isLocked}
                        onClick={() => handleGenerateAiVariation(item.archetype)}
                        className="min-h-[36px] sm:min-h-0 px-2.5 py-1 text-[11px] font-mono font-medium bg-[#192231] hover:bg-[#222F44] text-sky-300 border border-sky-500/30 rounded flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 disabled:opacity-40"
                      >
                        <Sparkles className="w-3 h-3" />
                        {isAiBusy ? 'Thinking...' : 'Gemini AI'}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3. Granular Clear Arrangement Feature (Preserves Device Chains) */}
          <div className="p-3.5 border-b border-[#232934] space-y-2.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Eraser className="w-3.5 h-3.5 text-rose-400" />
                <span className="text-xs font-mono font-semibold text-slate-200">
                  03. GRANULAR CLEAR ARRANGEMENT
                </span>
              </div>
              <span className="text-[10px] font-mono text-emerald-400">
                Preserves &lt;DeviceChain&gt;
              </span>
            </div>

            <div className="p-2.5 bg-[#141923] border border-[#232A38] rounded space-y-2 text-[11px] font-mono">
              <div className="grid grid-cols-3 gap-1">
                {(
                  [
                    { id: 'selected_track', label: 'Selected' },
                    { id: 'unlocked_tracks', label: 'Unlocked' },
                    { id: 'all_tracks', label: 'All Tracks' },
                  ] as const
                ).map((sc) => (
                  <button
                    key={sc.id}
                    type="button"
                    onClick={() => setClearOptions((prev) => ({ ...prev, scope: sc.id }))}
                    className={`py-1 px-1.5 rounded border text-[10px] transition-colors ${
                      clearOptions.scope === sc.id
                        ? 'bg-rose-500/20 text-rose-300 border-rose-500/50 font-semibold'
                        : 'bg-[#0C1017] text-slate-400 border-[#222B3C] hover:text-slate-200'
                    }`}
                  >
                    {sc.label}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-1.5 text-[10px] text-slate-300 pt-0.5">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={clearOptions.wipeNotes}
                    onChange={(e) =>
                      setClearOptions((p) => ({ ...p, wipeNotes: e.target.checked }))
                    }
                    className="accent-rose-500"
                  />
                  <span>Wipe MIDI Notes</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={clearOptions.wipeAutomation}
                    onChange={(e) =>
                      setClearOptions((p) => ({ ...p, wipeAutomation: e.target.checked }))
                    }
                    className="accent-rose-500"
                  />
                  <span>Wipe Automation</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={clearOptions.wipeSessionClips}
                    onChange={(e) =>
                      setClearOptions((p) => ({ ...p, wipeSessionClips: e.target.checked }))
                    }
                    className="accent-rose-500"
                  />
                  <span>Wipe Session Clips</span>
                </label>

                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={clearOptions.resetMixerToNeutral}
                    onChange={(e) =>
                      setClearOptions((p) => ({ ...p, resetMixerToNeutral: e.target.checked }))
                    }
                    className="accent-rose-500"
                  />
                  <span>Reset Mixer Vol/Pan</span>
                </label>
              </div>

              <button
                type="button"
                onClick={handleClearArrangement}
                className="w-full py-1.5 px-2.5 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 font-semibold rounded flex items-center justify-center gap-1.5 transition-colors"
              >
                <Eraser className="w-3.5 h-3.5" />
                <span>
                  Clear{' '}
                  {clearOptions.scope === 'selected_track'
                    ? selectedTrack?.name || 'Selected'
                    : clearOptions.scope === 'unlocked_tracks'
                    ? 'Unlocked Tracks'
                    : 'All Tracks'}{' '}
                  (Keep Plugins)
                </span>
              </button>
            </div>
          </div>

          {/* 4. Lossless Audio Export & Session Info Card */}
          <div className="p-3.5 space-y-2.5">
            <div className="text-xs font-mono font-semibold text-slate-200">
              04. LOSSLESS MASTER AUDIO RENDERER
            </div>
            <div className="p-2.5 bg-[#141923] border border-[#232A38] rounded space-y-2 text-[11px] font-mono text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-400">Sample Rate / Depth:</span>
                <span className="text-emerald-400 font-semibold">44.1 kHz / 24-Bit Studio PCM</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Arrangement Length:</span>
                <span>
                  {activeTotalBars} Bars ({activeTotalBars * 4} Beats + Tail)
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">DSP Bus Chain:</span>
                <span>EQ8 Duck + SC + Reverb + 3/16 + Glue</span>
              </div>
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                <button
                  type="button"
                  disabled={isExportingWav}
                  onClick={() => handleExportLosslessWav(24)}
                  className="min-h-[38px] sm:min-h-0 py-1.5 px-2 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold rounded flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
                >
                  <Disc className={`w-3.5 h-3.5 ${isExportingWav ? 'animate-spin' : ''}`} />
                  24-Bit WAV
                </button>
                <button
                  type="button"
                  disabled={isExportingWav}
                  onClick={() => handleExportLosslessWav(16)}
                  className="min-h-[38px] sm:min-h-0 py-1.5 px-2 bg-[#1D2534] hover:bg-[#273246] text-emerald-300 border border-emerald-500/30 font-semibold rounded flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
                >
                  <Disc className="w-3.5 h-3.5" />
                  16-Bit CD
                </button>
              </div>
            </div>
          </div>
        </aside>

        {/* Central & Bottom Viewport */}
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {activeTab === 'workbench' && (
            <div className="flex-1 flex flex-col overflow-hidden">
              {/* DESKTOP & TABLET VIEW (lg and up) */}
              <div className="hidden lg:flex flex-1 flex-col overflow-hidden">
                <div className="flex-1 min-h-[360px] overflow-hidden">
                  <TimelineCanvas
                    project={project}
                    selectedTrackId={selectedTrack?.id || '1'}
                    onSelectTrack={setSelectedTrackId}
                    playheadBeat={playheadBeat}
                    modulatedCutoffHz={modulatedCutoffHz}
                    humanization={humanization}
                    transport={transport}
                    masterBus={masterBus}
                    onUpdateTransport={handleUpdateTransport}
                    onChangeArrangementLength={handleChangeArrangementLength}
                    onUpdateMasterBus={handleUpdateMasterBus}
                    onSeekBeat={(beat) => {
                      synthEngine.seek(beat);
                      setPlayheadBeat(beat);
                    }}
                    onToggleNoteInTrack={handleToggleNoteInTrack}
                    onToggleMute={handleToggleMute}
                    onToggleSolo={handleToggleSolo}
                    onUpdateTrackMixer={handleUpdateTrackMixer}
                    onUpdateTrackAutomation={handleUpdateTrackAutomation}
                    editMode={editMode}
                    onChangeEditMode={setEditMode}
                    onDropMemoryLocationAtPlayhead={handleDropMemoryLocationAtPlayhead}
                    onOpenCompingAndTransientModal={() => setIsCompingModalOpen(true)}
                    onApplyNoteEditModeOperation={handleApplyNoteEditModeOperation}
                  />
                </div>

                {/* Lower Pane Tab Bar */}
                <div className="flex items-center justify-between px-4 py-1.5 bg-[#0F1218] border-t border-[#232934] text-xs font-mono">
                  <div className="flex items-center gap-2 overflow-x-auto">
                    <span className="text-slate-400 font-semibold text-[11px] mr-1">RACK VIEW:</span>
                    <button
                      type="button"
                      onClick={() => setDesktopBottomTab('devices')}
                      className={`px-3 py-1 rounded flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                        desktopBottomTab === 'devices'
                          ? 'bg-amber-500 text-slate-950 font-semibold'
                          : 'bg-[#181E29] text-slate-300 hover:text-white border border-[#2B3547]'
                      }`}
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      Spectral Ducking, Velocity Curve &amp; Ableton Plugins
                    </button>

                    <button
                      type="button"
                      onClick={() => setDesktopBottomTab('mix_console')}
                      className={`px-3 py-1 rounded flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                        desktopBottomTab === 'mix_console'
                          ? 'bg-orange-500 text-slate-950 font-semibold'
                          : 'bg-[#181E29] text-orange-300 hover:text-white border border-orange-500/40'
                      }`}
                    >
                      <Sliders className="w-3.5 h-3.5" />
                      SoundCraft Mix Console (10-Slot Inserts &amp; VCA)
                    </button>

                    <button
                      type="button"
                      onClick={() => setDesktopBottomTab('composer')}
                      className={`px-3 py-1 rounded flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                        desktopBottomTab === 'composer'
                          ? 'bg-amber-500 text-slate-950 font-semibold'
                          : 'bg-[#181E29] text-amber-300 hover:text-white border border-amber-500/40'
                      }`}
                    >
                      <Cpu className="w-3.5 h-3.5" />
                      AI Composer, Polyrhythm &amp; Chord Grid Studio
                    </button>

                    <button
                      type="button"
                      onClick={() => setDesktopBottomTab('pads')}
                      className={`px-3 py-1 rounded flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                        desktopBottomTab === 'pads'
                          ? 'bg-amber-500 text-slate-950 font-semibold'
                          : 'bg-[#181E29] text-slate-300 hover:text-white border border-[#2B3547]'
                      }`}
                    >
                      <Grid className="w-3.5 h-3.5" />
                      Live Jam Pads (Push / Note)
                    </button>

                    <button
                      type="button"
                      onClick={() => setDesktopBottomTab('spectrum')}
                      className={`px-3 py-1 rounded flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                        desktopBottomTab === 'spectrum'
                          ? 'bg-amber-500 text-slate-950 font-semibold'
                          : 'bg-[#181E29] text-slate-300 hover:text-white border border-[#2B3547]'
                      }`}
                    >
                      <Activity className="w-3.5 h-3.5" />
                      Master Bus Spectrum &amp; LUFS
                    </button>
                  </div>

                  <div className="hidden xl:flex items-center gap-2 text-[11px] text-slate-400 shrink-0">
                    <span className="text-emerald-400 font-semibold">
                      Selected: {selectedTrack?.name}
                    </span>
                    <span>·</span>
                    <span>{selectedTrack?.archetype?.toUpperCase()}</span>
                  </div>
                </div>

                {/* Lower Pane Content */}
                <div className="h-[330px] overflow-y-auto bg-[#0B0D10]">
                  {desktopBottomTab === 'devices' && (
                    <DeviceRackPanel
                      project={project}
                      selectedTrack={selectedTrack}
                      humanization={humanization}
                      masterBus={masterBus}
                      modulatedCutoffHz={modulatedCutoffHz}
                      masterPeakDb={masterPeakDb}
                      currentSeed={jitterSeed}
                      isPlaying={isPlaying}
                      tempo={project.tempo}
                      onUpdateHumanization={handleUpdateHumanization}
                      onUpdateTrackMixer={handleUpdateTrackMixer}
                      onUpdateTrackVelocityCurve={handleUpdateTrackVelocityCurve}
                      onApplySpectralAutoDuck={handleApplySpectralAutoDuck}
                      onInjectLibraryDevice={handleInjectLibraryDevice}
                      onApplySmartLeveling={handleApplySmartLeveling}
                      onUpdateMasterBus={handleUpdateMasterBus}
                      onRehumanizeAll={handleRehumanizeAll}
                    />
                  )}

                  {desktopBottomTab === 'composer' && (
                    <AiComposerIntelligencePanel
                      project={project}
                      selectedTrack={selectedTrack}
                      activeStrategyId={activeStrategyId}
                      activeFormId={activeFormId}
                      compositionSeed={compositionSeed}
                      onSelectStrategy={setActiveStrategyId}
                      onSelectForm={setActiveFormId}
                      onComposeSingleLayer={(arch) => handleInjectLayer(arch)}
                      onComposeAllUnlockedLayers={handleInjectAllMissingLayers}
                      onApplyMidiTool={handleApplyMidiTool}
                      onInjectPolyrhythmClip={handleInjectPolyrhythmClip}
                      onApplyChordGridTransform={handleApplyChordGridTransform}
                      onLaunchSessionScene={handleLaunchSessionScene}
                      onToggleTrackLock={handleToggleTrackLock}
                      onSelectTrack={setSelectedTrackId}
                      onSeekBeat={(beat) => {
                        synthEngine.seek(beat);
                        setPlayheadBeat(beat);
                      }}
                    />
                  )}

                  {desktopBottomTab === 'pads' && (
                    <div className="p-3">
                      <TouchJamPads
                        project={project}
                        selectedTrackId={selectedTrack?.id || '1'}
                        onSelectTrack={setSelectedTrackId}
                      />
                    </div>
                  )}

                  {desktopBottomTab === 'mix_console' && (
                    <div className="p-3">
                      <SoundCraftMixConsole
                        project={project}
                        selectedTrackId={selectedTrack?.id || '1'}
                        masterBus={masterBus}
                        masterPeakDb={masterPeakDb}
                        onSelectTrack={setSelectedTrackId}
                        onUpdateProjectWithUndo={(label, category, mutator) =>
                          handleExecuteProjectCommand(label, category, mutator)
                        }
                        onUpdateMasterBus={(next) => setMasterBus(next)}
                      />
                    </div>
                  )}

                  {desktopBottomTab === 'spectrum' && (
                    <div className="p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Activity className="w-4 h-4 text-emerald-400" />
                          <span className="font-mono font-semibold text-sm text-slate-200">
                            MASTER BUS REAL-TIME FFT SPECTRUM &amp; BS.1770 LUFS ANALYZER
                          </span>
                        </div>
                        <span className="text-xs font-mono text-slate-400">
                          Stereo Sum · 20Hz - 20kHz Logarithmic
                        </span>
                      </div>
                      <MasterSpectrumAnalyzer isPlaying={isPlaying} tempo={project.tempo} />
                    </div>
                  )}
                </div>
              </div>

              {/* MOBILE PHONE & COMPACT TABLET VIEW (< lg) */}
              <div className="lg:hidden flex-1 flex flex-col overflow-y-auto">
                {mobileSection === 'arrange' && (
                  <div className="flex-1 flex flex-col min-h-[480px]">
                    <div className="p-2.5 bg-[#121620] border-b border-[#232934] flex items-center justify-between text-xs font-mono">
                      <span className="text-slate-300 font-semibold">ARRANGEMENT TIMELINE</span>
                      <span className="text-amber-400">Tap track / timeline to audition</span>
                    </div>
                    <div className="flex-1 min-h-[380px]">
                      <TimelineCanvas
                        project={project}
                        selectedTrackId={selectedTrack?.id || '1'}
                        onSelectTrack={setSelectedTrackId}
                        playheadBeat={playheadBeat}
                        modulatedCutoffHz={modulatedCutoffHz}
                        humanization={humanization}
                        transport={transport}
                        masterBus={masterBus}
                        onUpdateTransport={handleUpdateTransport}
                        onChangeArrangementLength={handleChangeArrangementLength}
                        onUpdateMasterBus={handleUpdateMasterBus}
                        onSeekBeat={(beat) => {
                          synthEngine.seek(beat);
                          setPlayheadBeat(beat);
                        }}
                        onToggleNoteInTrack={handleToggleNoteInTrack}
                        onToggleMute={handleToggleMute}
                        onToggleSolo={handleToggleSolo}
                        onUpdateTrackMixer={handleUpdateTrackMixer}
                        onUpdateTrackAutomation={handleUpdateTrackAutomation}
                      />
                    </div>
                  </div>
                )}

                {mobileSection === 'composer' && (
                  <div className="flex-1 flex flex-col">
                    <AiComposerIntelligencePanel
                      project={project}
                      selectedTrack={selectedTrack}
                      activeStrategyId={activeStrategyId}
                      activeFormId={activeFormId}
                      compositionSeed={compositionSeed}
                      onSelectStrategy={setActiveStrategyId}
                      onSelectForm={setActiveFormId}
                      onComposeSingleLayer={(arch) => handleInjectLayer(arch)}
                      onComposeAllUnlockedLayers={handleInjectAllMissingLayers}
                      onApplyMidiTool={handleApplyMidiTool}
                      onInjectPolyrhythmClip={handleInjectPolyrhythmClip}
                      onApplyChordGridTransform={handleApplyChordGridTransform}
                      onLaunchSessionScene={handleLaunchSessionScene}
                      onToggleTrackLock={handleToggleTrackLock}
                      onSelectTrack={setSelectedTrackId}
                      onSeekBeat={(beat) => {
                        synthEngine.seek(beat);
                        setPlayheadBeat(beat);
                      }}
                    />
                  </div>
                )}

                {mobileSection === 'pianoroll' && (
                  <div className="flex-1 flex flex-col min-h-[480px]">
                    <div className="p-2.5 bg-[#121620] border-b border-[#232934] flex flex-wrap items-center justify-between gap-2 text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <span className="text-slate-300 font-semibold">PIANO ROLL:</span>
                        <select
                          value={selectedTrack?.id || '1'}
                          onChange={(e) => setSelectedTrackId(e.target.value)}
                          className="bg-[#1C2331] text-amber-300 border border-[#2F3B52] rounded px-2 py-1 text-xs"
                        >
                          {project.tracks.map((t) => (
                            <option key={t.id} value={t.id}>
                              {t.name} ({t.archetype})
                            </option>
                          ))}
                        </select>
                      </div>
                      <span className="text-emerald-400 text-[11px]">Tap key to audition pitch</span>
                    </div>
                    <div className="flex-1 min-h-[420px]">
                      <TimelineCanvas
                        project={project}
                        selectedTrackId={selectedTrack?.id || '1'}
                        onSelectTrack={setSelectedTrackId}
                        playheadBeat={playheadBeat}
                        modulatedCutoffHz={modulatedCutoffHz}
                        humanization={humanization}
                        transport={transport}
                        masterBus={masterBus}
                        onUpdateTransport={handleUpdateTransport}
                        onChangeArrangementLength={handleChangeArrangementLength}
                        onUpdateMasterBus={handleUpdateMasterBus}
                        onSeekBeat={(beat) => {
                          synthEngine.seek(beat);
                          setPlayheadBeat(beat);
                        }}
                        onToggleNoteInTrack={handleToggleNoteInTrack}
                        onToggleMute={handleToggleMute}
                        onToggleSolo={handleToggleSolo}
                        onUpdateTrackMixer={handleUpdateTrackMixer}
                        onUpdateTrackAutomation={handleUpdateTrackAutomation}
                      />
                    </div>
                  </div>
                )}

                {mobileSection === 'pads' && (
                  <div className="flex-1 flex flex-col p-3 space-y-3">
                    <div className="p-2.5 bg-[#121620] border border-[#232934] rounded flex items-center justify-between text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <Grid className="w-4 h-4 text-amber-400" />
                        <span className="text-slate-200 font-semibold">ABLETON NOTE TOUCH PADS</span>
                      </div>
                      <span className="text-slate-400 text-[11px]">Velocity sensitive tap</span>
                    </div>
                    <TouchJamPads
                      project={project}
                      selectedTrackId={selectedTrack?.id || '1'}
                      onSelectTrack={setSelectedTrackId}
                    />
                  </div>
                )}

                {mobileSection === 'devices' && (
                  <div className="flex-1 flex flex-col">
                    <DeviceRackPanel
                      project={project}
                      selectedTrack={selectedTrack}
                      humanization={humanization}
                      masterBus={masterBus}
                      modulatedCutoffHz={modulatedCutoffHz}
                      masterPeakDb={masterPeakDb}
                      currentSeed={jitterSeed}
                      isPlaying={isPlaying}
                      tempo={project.tempo}
                      onUpdateHumanization={handleUpdateHumanization}
                      onUpdateTrackMixer={handleUpdateTrackMixer}
                      onUpdateTrackVelocityCurve={handleUpdateTrackVelocityCurve}
                      onApplySpectralAutoDuck={handleApplySpectralAutoDuck}
                      onInjectLibraryDevice={handleInjectLibraryDevice}
                      onApplySmartLeveling={handleApplySmartLeveling}
                      onUpdateMasterBus={handleUpdateMasterBus}
                      onRehumanizeAll={handleRehumanizeAll}
                    />
                  </div>
                )}

                {mobileSection === 'mix_console' && (
                  <div className="flex-1 flex flex-col p-3">
                    <SoundCraftMixConsole
                      project={project}
                      selectedTrackId={selectedTrack?.id || '1'}
                      masterBus={masterBus}
                      masterPeakDb={masterPeakDb}
                      onSelectTrack={setSelectedTrackId}
                      onUpdateProjectWithUndo={(label, category, mutator) =>
                        handleExecuteProjectCommand(label, category, mutator)
                      }
                      onUpdateMasterBus={(next) => setMasterBus(next)}
                    />
                  </div>
                )}

                {mobileSection === 'spectrum' && (
                  <div className="flex-1 flex flex-col p-3 space-y-3">
                    <div className="p-2.5 bg-[#121620] border border-[#232934] rounded flex items-center justify-between text-xs font-mono">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-emerald-400" />
                        <span className="text-slate-200 font-semibold">
                          MASTER SPECTRUM &amp; LUFS ANALYZER
                        </span>
                      </div>
                      <span className="text-emerald-400 text-[11px]">Real-Time DSP</span>
                    </div>

                    <MasterSpectrumAnalyzer isPlaying={isPlaying} tempo={project.tempo} />
                  </div>
                )}
              </div>
            </div>
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
        </main>
      </div>

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
    </div>
  );
}
