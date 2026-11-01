import React, { useState, useEffect } from 'react';
import {
  AbletonProjectState,
  AbletonTrack,
  AutomationPoint,
  CompositionStrategyId,
  HumanizationConfig,
  MacroArrangementFormId,
  MasterBusConfig,
  MidiToolTransformationId,
  NoteGridDivision,
  PolyrhythmConfig,
  SpectralDuckingConfig,
  TechnoArchetype,
  TimelineBarRangeSelection,
  TimelineEditMode,
  TrackMixerParams,
  TransportConfig,
  VelocityCurveConfig,
  VoicingSpreadStyle,
} from '../types/ableton';
import { RangeClipGeneratorMode } from '../engine/compositionIntelligenceEngine';
import { StudioEditingTool, StudioEditorToolbar, SpectrumOverlayMode } from './StudioEditorToolbar';
import { WorkspaceTabId } from './StudioWorkspaceTabs';
import { TimelineCanvas } from './TimelineCanvas';
import { SoundCraftMixConsole } from './SoundCraftMixConsole';
import { DeviceRackPanel } from './DeviceRackPanel';
import { AiComposerIntelligencePanel, TrackVelocityRandomizerConfig } from './AiComposerIntelligencePanel';
import { TouchJamPads } from './TouchJamPads';
import { MasterSpectrumAnalyzer } from './MasterSpectrumAnalyzer';
import { XmlInspectorView } from './XmlInspectorView';
import { PythonFastApiView } from './PythonFastApiView';
import {
  Disc,
  Download,
  Eraser,
  Flame,
  Layers,
  Sparkles,
  X,
} from 'lucide-react';

export interface SoundCraftWorkstationProps {
  activeTab: 'workbench' | 'xml' | 'python' | 'architecture';
  studioWorkspace: WorkspaceTabId;
  activeEditingTool: StudioEditingTool;
  editMode: TimelineEditMode;
  spectrumOverlayMode: SpectrumOverlayMode;
  leftDockOpen: boolean;
  bottomDockOpen: boolean;
  rightDockOpen: boolean;
  bottomEditorTab: 'devices' | 'composer' | 'pads' | 'spectrum';
  project: AbletonProjectState;
  selectedTrack: AbletonTrack | undefined;
  selectedTrackId: string;
  playheadBeat: number;
  modulatedCutoffHz: number;
  humanization: HumanizationConfig;
  transport: TransportConfig;
  masterBus: MasterBusConfig;
  masterPeakDb: number;
  isPlaying: boolean;
  isExportingWav: boolean;
  wavExportProgress?: number;
  activeTotalBars: number;
  activeStrategyId: CompositionStrategyId;
  activeFormId: MacroArrangementFormId;
  compositionSeed: number;
  jitterSeed: number;
  // Handlers
  onSelectTrack: (trackId: string) => void;
  onChangeEditMode: (mode: TimelineEditMode) => void;
  onChangeActiveTool: (tool: StudioEditingTool) => void;
  onChangeSpectrumMode: (mode: SpectrumOverlayMode) => void;
  onChangeArrangementLength: (bars: number) => void;
  onDropMemoryLocationAtPlayhead: () => void;
  onSeekBeat: (beat: number) => void;
  onToggleNoteInTrack: (trackId: string, beat: number, pitch: number, duration?: number) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onUpdateTrackMixer: (trackId: string, partial: Partial<TrackMixerParams>) => void;
  onUpdateTrackAutomation: (trackId: string, points: AutomationPoint[]) => void;
  onUpdateTransport: (partial: Partial<TransportConfig>) => void;
  onUpdateMasterBus: (partial: Partial<MasterBusConfig>) => void;
  onOpenCompingModal: () => void;
  onApplyNoteEditModeOperation: (
    trackId: string,
    noteId: string,
    targetBeat: number,
    mode: TimelineEditMode,
    gridStepBeats: number
  ) => void;
  onOpenBulkQueueModal: () => void;
  onExecuteProjectCommand: (
    label: string,
    category: any,
    mutator: (draft: AbletonProjectState) => AbletonProjectState
  ) => void;
  onExportLosslessWav: (bitDepth: 16 | 24) => void;
  onClearArrangement: () => void;
  onExportNativeAls: () => void;
  onRandomizeTrackVelocities: (trackId: string, config: TrackVelocityRandomizerConfig) => void;
  onSelectStrategy: (id: CompositionStrategyId) => void;
  onSelectForm: (id: MacroArrangementFormId) => void;
  onComposeSingleLayer: (arch: TechnoArchetype) => void;
  onComposeAllUnlockedLayers: () => void;
  onApplyMidiTool: (trackId: string, toolId: MidiToolTransformationId) => void;
  onInjectPolyrhythmClip: (trackId: string, config: PolyrhythmConfig) => void;
  onApplyChordGridTransform: (
    trackId: string,
    grid: NoteGridDivision,
    voicing: VoicingSpreadStyle,
    key?: string,
    scale?: string,
    prompt?: string
  ) => void;
  onLaunchSessionScene: (sceneIdx: number) => void;
  onToggleTrackLock: (trackId: string) => void;
  onTriggerPadNote?: (pitch: number, velocity: number) => void;
  onUpdateHumanization: (partial: Partial<HumanizationConfig>) => void;
  onUpdateTrackVelocityCurve: (trackId: string, curve: VelocityCurveConfig, inject?: boolean) => void;
  onApplySpectralAutoDuck: (carrierId: string, duckConfig: SpectralDuckingConfig) => void;
  onInjectLibraryDevice: (trackId: string, deviceName: string) => void;
  onApplySmartLeveling: () => void;
  onRehumanizeAll: () => void;
  onApplyMidiQuantizeStrength?: (
    trackId: string,
    gridDivision: NoteGridDivision,
    strengthPct: 50 | 75 | 100
  ) => void;
  onCloseLeftDock: () => void;
  onCloseBottomDock: () => void;
  onCloseRightDock: () => void;
  onChangeBottomTab: (tab: 'devices' | 'composer' | 'pads' | 'spectrum') => void;
  onOpenReferenceTrackModal?: () => void;
  onOpenHumanizationHeatmap?: () => void;
  includeMidiHumanization?: boolean;
  onToggleIncludeMidiHumanization?: (include: boolean) => void;
  onExportClipToMidi?: (trackId: string, clipId: string, includeHumanization?: boolean) => void;
  barRangeSelection?: TimelineBarRangeSelection;
  onChangeBarRangeSelection?: (range: TimelineBarRangeSelection) => void;
  onGenerateClipInRange?: (
    trackId: string,
    startBar: number,
    endBar: number,
    mode: RangeClipGeneratorMode
  ) => void;
  onSplitClipAtBeat?: (trackId: string, beat: number) => void;
  onDuplicateClipOnTrack?: (trackId: string, clipId?: string) => void;
  onConsolidateClipsInRange?: (trackId: string, startBar: number, endBar: number) => void;
  onDeleteClipsInRange?: (trackId: string, startBar: number, endBar: number) => void;
  onAddUserTrackFromRole?: (roleCode: string) => void;
}

export const SoundCraftWorkstation: React.FC<SoundCraftWorkstationProps> = ({
  activeTab,
  studioWorkspace,
  activeEditingTool,
  editMode,
  spectrumOverlayMode,
  leftDockOpen,
  bottomDockOpen,
  rightDockOpen,
  bottomEditorTab,
  project,
  selectedTrack,
  selectedTrackId,
  playheadBeat,
  modulatedCutoffHz,
  humanization,
  transport,
  masterBus,
  masterPeakDb,
  isPlaying,
  isExportingWav,
  wavExportProgress = 0,
  activeTotalBars,
  activeStrategyId,
  activeFormId,
  compositionSeed,
  jitterSeed,
  onSelectTrack,
  onChangeEditMode,
  onChangeActiveTool,
  onChangeSpectrumMode,
  onChangeArrangementLength,
  onDropMemoryLocationAtPlayhead,
  onSeekBeat,
  onToggleNoteInTrack,
  onToggleMute,
  onToggleSolo,
  onUpdateTrackMixer,
  onUpdateTrackAutomation,
  onUpdateTransport,
  onUpdateMasterBus,
  onOpenCompingModal,
  onApplyNoteEditModeOperation,
  onOpenBulkQueueModal,
  onExecuteProjectCommand,
  onExportLosslessWav,
  onClearArrangement,
  onExportNativeAls,
  onRandomizeTrackVelocities,
  onSelectStrategy,
  onSelectForm,
  onComposeSingleLayer,
  onComposeAllUnlockedLayers,
  onApplyMidiTool,
  onInjectPolyrhythmClip,
  onApplyChordGridTransform,
  onLaunchSessionScene,
  onToggleTrackLock,
  onUpdateHumanization,
  onUpdateTrackVelocityCurve,
  onApplySpectralAutoDuck,
  onInjectLibraryDevice,
  onApplySmartLeveling,
  onRehumanizeAll,
  onApplyMidiQuantizeStrength,
  onCloseLeftDock,
  onCloseBottomDock,
  onCloseRightDock,
  onChangeBottomTab,
  onOpenReferenceTrackModal,
  onOpenHumanizationHeatmap,
  includeMidiHumanization,
  onToggleIncludeMidiHumanization,
  onExportClipToMidi,
  barRangeSelection,
  onChangeBarRangeSelection,
  onGenerateClipInRange,
  onSplitClipAtBeat,
  onDuplicateClipOnTrack,
  onConsolidateClipsInRange,
  onDeleteClipsInRange,
  onAddUserTrackFromRole,
}) => {
  const [leftDockWidth, setLeftDockWidth] = useState<number>(224);
  const [bottomDockHeight, setBottomDockHeight] = useState<number>(256);
  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isCompact = windowWidth < 768;
  const inlineLeft = leftDockOpen && windowWidth >= 900;
  const inlineRight = rightDockOpen && windowWidth >= 1280;
  const effectiveLeftWidth = isCompact ? Math.min(leftDockWidth, 180) : leftDockWidth;
  const effectiveRightWidth = isCompact ? 260 : 320;

  const handleStartResizeLeft = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftDockWidth;
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(170, Math.min(360, startWidth + (ev.clientX - startX)));
      setLeftDockWidth(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const handleStartResizeBottom = (e: React.PointerEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = bottomDockHeight;
    const onMove = (ev: PointerEvent) => {
      const next = Math.max(150, Math.min(440, startHeight - (ev.clientY - startY)));
      setBottomDockHeight(next);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  // Auxiliary Inspector Tabs (XML / Python / Architecture)
  if (activeTab === 'xml') {
    return (
      <div className="flex-1 overflow-hidden bg-[#0A0D12]">
        <XmlInspectorView project={project} onDownloadAls={onExportNativeAls} />
      </div>
    );
  }

  if (activeTab === 'python') {
    return (
      <div className="flex-1 overflow-hidden bg-[#0A0D12]">
        <PythonFastApiView humanization={humanization} />
      </div>
    );
  }

  if (activeTab === 'architecture') {
    return (
      <div className="flex-1 overflow-y-auto p-4 lg:p-6 bg-[#0B0E14] text-slate-200">
        <div className="max-w-5xl mx-auto space-y-4">
          <h2 className="text-base font-bold font-mono text-amber-400">
            SOUNDCRAFT WORKSTATION ARCHITECTURE &amp; ABLETON LIVE 12 INTEGRATION
          </h2>
          <div className="p-4 bg-[#121620] border border-[#232B3A] rounded-md font-mono text-xs text-slate-300 space-y-2">
            <p>
              Integrated zero-regression audio engine connecting Web Audio DSP, Live 12 MIDI tools,
              and authentic Ableton .als XML parsing and compilation.
            </p>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 pt-2 text-[11px]">
              <div className="bg-[#0A0D12] p-2 rounded border border-[#1E2530]">
                <span className="text-zinc-500">Tracks:</span>
                <span className="ml-1 text-amber-400 font-bold">{project.tracks.length}</span>
              </div>
              <div className="bg-[#0A0D12] p-2 rounded border border-[#1E2530]">
                <span className="text-zinc-500">Tempo:</span>
                <span className="ml-1 text-emerald-400 font-bold">{project.tempo} BPM</span>
              </div>
              <div className="bg-[#0A0D12] p-2 rounded border border-[#1E2530]">
                <span className="text-zinc-500">Scale:</span>
                <span className="ml-1 text-cyan-400 font-bold">{project.rootKey} {project.scale}</span>
              </div>
              <div className="bg-[#0A0D12] p-2 rounded border border-[#1E2530]">
                <span className="text-zinc-500">Validation:</span>
                <span className="ml-1 text-emerald-400 font-bold">100% ALS Valid</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Full-Viewport Dedicated Workspaces
  if (studioWorkspace === 'mix') {
    return (
      <div className="flex-1 overflow-hidden bg-[#0A0D12] flex flex-col">
        <SoundCraftMixConsole
          project={project}
          selectedTrackId={selectedTrackId}
          masterBus={masterBus}
          masterPeakDb={masterPeakDb}
          onSelectTrack={onSelectTrack}
          onUpdateProjectWithUndo={(label, category, mutator) =>
            onExecuteProjectCommand(label, category, mutator)
          }
          onUpdateMasterBus={(partial) => onUpdateMasterBus(partial)}
        />
      </div>
    );
  }

  if (studioWorkspace === 'session') {
    return (
      <div className="flex-1 overflow-y-auto bg-[#0A0D12] p-4 flex flex-col items-center justify-center">
        <div className="w-full max-w-4xl space-y-4">
          <div className="flex items-center justify-between border-b border-[#232B3A] pb-3">
            <div>
              <h2 className="text-sm font-bold font-mono text-zinc-100 uppercase tracking-wider">
                SESSION MATRIX &amp; LIVE JAM PADS
              </h2>
              <p className="text-xs font-mono text-zinc-400">
                Live hardware trigger surface for {selectedTrack?.name || 'Selected Track'}
              </p>
            </div>
          </div>
          <TouchJamPads
            project={project}
            selectedTrackId={selectedTrackId}
            onSelectTrack={onSelectTrack}
          />
        </div>
      </div>
    );
  }

  if (studioWorkspace === 'devices') {
    return (
      <div className="flex-1 overflow-y-auto bg-[#0A0D12] p-4">
        <div className="max-w-5xl mx-auto space-y-4">
          <div className="flex items-center justify-between border-b border-[#232B3A] pb-3">
            <div>
              <h2 className="text-sm font-bold font-mono text-zinc-100 uppercase tracking-wider">
                DEVICE RACK &amp; SPECTRAL DUCKING
              </h2>
              <p className="text-xs font-mono text-zinc-400">
                Track {selectedTrack?.name || 'Selected'} · Native Ableton Live 12 devices &amp; DSP inserts
              </p>
            </div>
          </div>
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
            onUpdateHumanization={onUpdateHumanization}
            onUpdateTrackMixer={onUpdateTrackMixer}
            onUpdateTrackVelocityCurve={onUpdateTrackVelocityCurve}
            onApplySpectralAutoDuck={onApplySpectralAutoDuck}
            onInjectLibraryDevice={onInjectLibraryDevice}
            onApplySmartLeveling={onApplySmartLeveling}
            onUpdateMasterBus={(partial) => onUpdateMasterBus(partial)}
            onRehumanizeAll={onRehumanizeAll}
          />
        </div>
      </div>
    );
  }

  if (studioWorkspace === 'ai') {
    return (
      <div className="flex-1 overflow-y-auto bg-[#0A0D12] p-4">
        <div className="max-w-4xl mx-auto space-y-4">
          <AiComposerIntelligencePanel
            project={project}
            selectedTrack={selectedTrack}
            activeStrategyId={activeStrategyId}
            activeFormId={activeFormId}
            compositionSeed={compositionSeed}
            onSelectStrategy={onSelectStrategy}
            onSelectForm={onSelectForm}
            onComposeSingleLayer={onComposeSingleLayer}
            onComposeAllUnlockedLayers={onComposeAllUnlockedLayers}
            onApplyMidiTool={onApplyMidiTool}
            onInjectPolyrhythmClip={onInjectPolyrhythmClip}
            onApplyChordGridTransform={onApplyChordGridTransform}
            onLaunchSessionScene={onLaunchSessionScene}
            onToggleTrackLock={onToggleTrackLock}
            onSelectTrack={onSelectTrack}
            onSeekBeat={onSeekBeat}
            onRandomizeTrackVelocities={onRandomizeTrackVelocities}
          />
        </div>
      </div>
    );
  }

  if (studioWorkspace === 'queue') {
    return (
      <div className="flex-1 overflow-y-auto bg-[#0A0D12] p-6 flex items-center justify-center">
        <div className="max-w-xl text-center space-y-4 p-8 bg-[#10141C] border border-[#232B3A] rounded-lg">
          <Layers className="w-10 h-10 text-amber-400 mx-auto" />
          <h2 className="text-base font-mono font-bold text-zinc-100">
            MULTI-PROJECT BULK SMART LEVELING QUEUE
          </h2>
          <p className="text-xs font-mono text-zinc-400">
            Batch calibrate, process, and render repeated arrangement versions with saved Master Export presets.
          </p>
          <button
            type="button"
            onClick={onOpenBulkQueueModal}
            className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold font-mono text-xs rounded transition-colors"
          >
            Launch Bulk Queue &amp; Master Export
          </button>
        </div>
      </div>
    );
  }

  // PRIMARY SOUNDCRAFT EDIT WINDOW (Default)
  const soloActive = project.tracks.some((t) => t.soloed);

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#080A0D]">
      {/* SoundCraft Unified Edit Toolbar */}
      <StudioEditorToolbar
        editMode={editMode}
        activeTool={activeEditingTool}
        spectrumMode={spectrumOverlayMode}
        arrangementLengthBars={activeTotalBars as 16 | 32 | 64 | 128}
        memoryLocations={project.memoryLocations || []}
        selectedTrackName={selectedTrack?.name}
        onChangeEditMode={onChangeEditMode}
        onChangeActiveTool={onChangeActiveTool}
        onChangeSpectrumMode={onChangeSpectrumMode}
        onChangeArrangementLength={onChangeArrangementLength}
        onDropMarkerAtPlayhead={onDropMemoryLocationAtPlayhead}
        onSeekToMarker={onSeekBeat}
        onOpenCompingModal={onOpenCompingModal}
      />

      {/* CSS Grid Tri-Pane Workstation: [left-dock] auto [center-viewport] 1fr [right-dock] auto */}
      <div
        className="relative flex-1 grid min-w-0 min-h-0 overflow-hidden"
        style={{
          gridTemplateColumns: `${inlineLeft ? `${effectiveLeftWidth}px` : '0px'} minmax(0, 1fr) ${
            inlineRight ? `${effectiveRightWidth}px` : '0px'
          }`,
        }}
      >
        {/* Left Track & Group Tree Dock */}
        <aside
          style={{ gridColumn: 1, gridRow: 1, width: inlineLeft ? effectiveLeftWidth : 'min(85vw, 320px)', position: inlineLeft ? 'relative' : 'absolute', insetBlock: 0, left: 0, zIndex: inlineLeft ? undefined : 40 }}
          className={`${
            leftDockOpen ? 'flex' : 'hidden'
          } bg-[#0C0F15] border-r border-[#1C222C] flex-col overflow-hidden select-none relative`}
        >
          <div className="h-7 px-3 bg-[#080A0D] border-b border-[#1C222C] flex items-center justify-between text-[11px] font-mono text-zinc-400">
            <span className="font-bold text-zinc-300">TRACKS ({project.tracks.length})</span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={onOpenBulkQueueModal}
                className="text-[10px] text-amber-400 hover:text-amber-300 flex items-center gap-1"
                title="Bulk Queue"
              >
                <Layers className="w-3 h-3" />
                Queue
              </button>
              <button
                type="button"
                onClick={onCloseLeftDock}
                className="text-zinc-500 hover:text-zinc-300 text-[10px]"
                title="Close Left Dock"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-[#151922]">
            {project.tracks.map((t, idx) => {
              const isSelected = t.id === selectedTrackId;
              const isDimmed = soloActive && !t.soloed;
              return (
                <div
                  key={t.id}
                  onClick={() => onSelectTrack(t.id)}
                  className={`px-2.5 py-1.5 flex items-center justify-between cursor-pointer transition-colors text-xs font-mono ${
                    isSelected
                      ? 'bg-[#18202D] text-white border-l-2 border-amber-400'
                      : 'text-zinc-400 hover:bg-[#121620] hover:text-zinc-200'
                  } ${isDimmed ? 'opacity-40' : ''}`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] text-zinc-500 font-bold">
                      {String(idx + 1).padStart(2, '0')}
                    </span>
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: t.color || '#F59E0B' }}
                    />
                    <span className="truncate text-[11px] font-medium">{t.name}</span>
                  </div>

                  <div className="flex items-center gap-1 shrink-0">
                    {onExportClipToMidi && t.clips[0] && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onExportClipToMidi(t.id, t.clips[0].id, includeMidiHumanization);
                        }}
                        className="w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center text-emerald-400 hover:bg-emerald-500/20"
                        title="Export Clip as .MID to Queue"
                      >
                        <Download className="w-2.5 h-2.5" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSolo(t.id);
                      }}
                      className={`w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center transition-colors ${
                        t.soloed
                          ? 'bg-amber-400 text-slate-950 shadow-[0_0_6px_rgba(245,158,11,0.6)]'
                          : 'text-zinc-500 hover:text-amber-400 hover:bg-zinc-800'
                      }`}
                      title="Solo Track"
                    >
                      S
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleMute(t.id);
                      }}
                      className={`w-4 h-4 rounded text-[9px] font-bold flex items-center justify-center transition-colors ${
                        t.muted
                          ? 'bg-rose-500 text-white'
                          : 'text-zinc-500 hover:text-rose-400 hover:bg-zinc-800'
                      }`}
                      title="Mute Track"
                    >
                      M
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Left Dock Bottom Actions */}
          <div className="p-2 border-t border-[#1C222C] bg-[#080A0D] space-y-1 text-[10px] font-mono">
            {onOpenReferenceTrackModal && (
              <button
                type="button"
                onClick={onOpenReferenceTrackModal}
                className="w-full py-1 bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 rounded flex items-center justify-center gap-1 font-bold transition-colors"
              >
                <Sparkles className="w-3 h-3" />
                Reference Track AI
              </button>
            )}
            {onOpenHumanizationHeatmap && (
              <button
                type="button"
                onClick={onOpenHumanizationHeatmap}
                className="w-full py-1 bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 rounded flex items-center justify-center gap-1 font-bold transition-colors"
              >
                <Flame className="w-3 h-3" />
                Humanization Heatmap
              </button>
            )}
            <button
              type="button"
              onClick={() => onExportLosslessWav(24)}
              disabled={isExportingWav}
              className="w-full py-1 px-2 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded flex flex-col items-center justify-center gap-1 font-bold transition-colors disabled:opacity-90 relative overflow-hidden"
            >
              <div className="flex items-center justify-center gap-1 z-10">
                <Disc className={`w-3 h-3 ${isExportingWav ? 'animate-spin' : ''}`} />
                <span>
                  {isExportingWav
                    ? `Rendering WAV... ${Math.max(0, Math.min(100, Math.round(wavExportProgress)))}%`
                    : 'Export 24-Bit WAV'}
                </span>
              </div>
              {isExportingWav && (
                <div
                  role="progressbar"
                  aria-label="WAV Export Progress"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.max(0, Math.min(100, Math.round(wavExportProgress)))}
                  className="w-full h-1.5 bg-[#090C11] rounded-full overflow-hidden border border-emerald-500/30 z-10"
                >
                  <div
                    className="h-full bg-emerald-400 transition-all duration-150"
                    style={{ width: `${Math.max(0, Math.min(100, Math.round(wavExportProgress)))}%` }}
                  />
                </div>
              )}
            </button>
            <button
              type="button"
              onClick={onClearArrangement}
              className="w-full py-1 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded flex items-center justify-center gap-1 transition-colors"
            >
              <Eraser className="w-3 h-3" />
              Clear Arrangement
            </button>
          </div>

          {/* Interactive Left Dock Resize Handle */}
          <div
            onPointerDown={handleStartResizeLeft}
            className="absolute top-0 right-0 bottom-0 w-1 cursor-col-resize hover:bg-amber-400/50 transition-colors z-20"
            title="Drag to resize track tree panel"
          />
        </aside>

        {/* Center Viewport: CSS Grid Rows for Arrangement Canvas + Resizable Lower Editor */}
        <div
          className="grid min-w-0 min-h-0 overflow-hidden"
          style={{
            gridColumn: 2,
            gridRow: 1,
            gridTemplateRows: bottomDockOpen
              ? `minmax(0, 1fr) min(${bottomDockHeight}px, 45%)`
              : 'minmax(0, 1fr)',
          }}
        >
          {/* Arrangement Canvas */}
          <div className="min-h-0 overflow-hidden">
            <TimelineCanvas
              project={project}
              selectedTrackId={selectedTrackId}
              onSelectTrack={onSelectTrack}
              playheadBeat={playheadBeat}
              modulatedCutoffHz={modulatedCutoffHz}
              humanization={humanization}
              transport={transport}
              masterBus={masterBus}
              onUpdateTransport={onUpdateTransport}
              onChangeArrangementLength={onChangeArrangementLength}
              onUpdateMasterBus={onUpdateMasterBus}
              onSeekBeat={onSeekBeat}
              onToggleNoteInTrack={onToggleNoteInTrack}
              onToggleMute={onToggleMute}
              onToggleSolo={onToggleSolo}
              onUpdateTrackMixer={onUpdateTrackMixer}
              onUpdateTrackAutomation={onUpdateTrackAutomation}
              editMode={editMode}
              onChangeEditMode={onChangeEditMode}
              onDropMemoryLocationAtPlayhead={onDropMemoryLocationAtPlayhead}
              onOpenCompingAndTransientModal={onOpenCompingModal}
              onOpenHumanizationHeatmap={onOpenHumanizationHeatmap}
              includeMidiHumanization={includeMidiHumanization}
              onToggleIncludeMidiHumanization={onToggleIncludeMidiHumanization}
              onExportClipToMidi={onExportClipToMidi}
              onApplyNoteEditModeOperation={onApplyNoteEditModeOperation}
              barRangeSelection={barRangeSelection}
              onChangeBarRangeSelection={onChangeBarRangeSelection}
              onGenerateClipInRange={onGenerateClipInRange}
              onSplitClipAtBeat={onSplitClipAtBeat}
              onDuplicateClipOnTrack={onDuplicateClipOnTrack}
              onConsolidateClipsInRange={onConsolidateClipsInRange}
              onDeleteClipsInRange={onDeleteClipsInRange}
              onAddUserTrackFromRole={onAddUserTrackFromRole}
              spectrumOverlayMode={spectrumOverlayMode}
              isPlaying={isPlaying}
            />
          </div>

          {/* Resizable Lower Editor Dock */}
          {bottomDockOpen && (
            <div className="border-t border-[#1C222C] bg-[#0A0D12] flex flex-col min-h-0 overflow-hidden relative">
              {/* Interactive Bottom Dock Resize Handle */}
              <div
                onPointerDown={handleStartResizeBottom}
                className="h-1 w-full cursor-row-resize hover:bg-amber-400/50 transition-colors shrink-0"
                title="Drag to resize editor dock"
              />
              {/* Lower Dock Tab Header */}
              <div className="h-7 bg-[#080A0D] border-b border-[#1C222C] px-3 flex items-center justify-between text-xs font-mono">
                <div className="flex items-center gap-1 sm:gap-2">
                  <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mr-1">
                    EDITOR:
                  </span>
                  <button
                    type="button"
                    onClick={() => onChangeBottomTab('devices')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      bottomEditorTab === 'devices'
                        ? 'bg-amber-400 text-slate-950 font-bold'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Devices &amp; Inserts
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeBottomTab('composer')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      bottomEditorTab === 'composer'
                        ? 'bg-amber-400 text-slate-950 font-bold'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    AI Composer &amp; Velocity
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeBottomTab('pads')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      bottomEditorTab === 'pads'
                        ? 'bg-amber-400 text-slate-950 font-bold'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Touch Jam Pads
                  </button>
                  <button
                    type="button"
                    onClick={() => onChangeBottomTab('spectrum')}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                      bottomEditorTab === 'spectrum'
                        ? 'bg-amber-400 text-slate-950 font-bold'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    Master Spectrum
                  </button>
                </div>
                <button
                  type="button"
                  onClick={onCloseBottomDock}
                  className="text-zinc-500 hover:text-zinc-300 text-[11px]"
                  title="Close Lower Dock"
                >
                  ✕
                </button>
              </div>

              {/* Lower Dock Content */}
              <div className="flex-1 overflow-y-auto p-3">
                {bottomEditorTab === 'devices' && (
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
                    onUpdateHumanization={onUpdateHumanization}
                    onUpdateTrackMixer={onUpdateTrackMixer}
                    onUpdateTrackVelocityCurve={onUpdateTrackVelocityCurve}
                    onApplySpectralAutoDuck={onApplySpectralAutoDuck}
                    onInjectLibraryDevice={onInjectLibraryDevice}
                    onApplySmartLeveling={onApplySmartLeveling}
                    onUpdateMasterBus={(partial) => onUpdateMasterBus(partial)}
                    onRehumanizeAll={onRehumanizeAll}
                  />
                )}
                {bottomEditorTab === 'composer' && (
                  <AiComposerIntelligencePanel
                    project={project}
                    selectedTrack={selectedTrack}
                    activeStrategyId={activeStrategyId}
                    activeFormId={activeFormId}
                    compositionSeed={compositionSeed}
                    onSelectStrategy={onSelectStrategy}
                    onSelectForm={onSelectForm}
                    onComposeSingleLayer={onComposeSingleLayer}
                    onComposeAllUnlockedLayers={onComposeAllUnlockedLayers}
                    onApplyMidiTool={onApplyMidiTool}
                    onInjectPolyrhythmClip={onInjectPolyrhythmClip}
                    onApplyChordGridTransform={onApplyChordGridTransform}
                    onLaunchSessionScene={onLaunchSessionScene}
                    onToggleTrackLock={onToggleTrackLock}
                    onSelectTrack={onSelectTrack}
                    onSeekBeat={onSeekBeat}
                    onRandomizeTrackVelocities={onRandomizeTrackVelocities}
                    onApplyMidiQuantizeStrength={onApplyMidiQuantizeStrength}
                  />
                )}
                {bottomEditorTab === 'pads' && (
                  <TouchJamPads
                    project={project}
                    selectedTrackId={selectedTrackId}
                    onSelectTrack={onSelectTrack}
                  />
                )}
                {bottomEditorTab === 'spectrum' && (
                  <MasterSpectrumAnalyzer
                    isPlaying={isPlaying}
                    tempo={project.tempo}
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Right Inspector & AI Engine Dock */}
        <aside
          style={{ gridColumn: 3, gridRow: 1, width: inlineRight ? effectiveRightWidth : 'min(85vw, 320px)', position: inlineRight ? 'relative' : 'absolute', insetBlock: 0, right: 0, zIndex: inlineRight ? undefined : 41 }}
          className={`${
            rightDockOpen ? 'flex' : 'hidden'
          } w-80 bg-[#0C0F15] border-l border-[#1C222C] flex-col overflow-hidden`}
        >
          <div className="h-7 px-3 bg-[#080A0D] border-b border-[#1C222C] flex items-center justify-between text-[11px] font-mono text-zinc-400">
            <span className="font-bold text-zinc-300">INSPECTOR &amp; AI</span>
            <button
              type="button"
              onClick={onCloseRightDock}
              className="text-zinc-500 hover:text-zinc-300 text-[11px]"
              title="Close Right Dock"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <AiComposerIntelligencePanel
              project={project}
              selectedTrack={selectedTrack}
              activeStrategyId={activeStrategyId}
              activeFormId={activeFormId}
              compositionSeed={compositionSeed}
              onSelectStrategy={onSelectStrategy}
              onSelectForm={onSelectForm}
              onComposeSingleLayer={onComposeSingleLayer}
              onComposeAllUnlockedLayers={onComposeAllUnlockedLayers}
              onApplyMidiTool={onApplyMidiTool}
              onInjectPolyrhythmClip={onInjectPolyrhythmClip}
              onApplyChordGridTransform={onApplyChordGridTransform}
              onLaunchSessionScene={onLaunchSessionScene}
              onToggleTrackLock={onToggleTrackLock}
              onSelectTrack={onSelectTrack}
              onSeekBeat={onSeekBeat}
              onRandomizeTrackVelocities={onRandomizeTrackVelocities}
            />
          </div>
        </aside>
      </div>
    </div>
  );
};

