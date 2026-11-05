import type { EditorSelection } from './ProjectInspector';
import {pianoPitchRows} from '../engine/arrangementEditing';
import {ArrangementEditInspector} from './ArrangementEditInspector';
import type {ArrangementClipEdit,ArrangementNoteEdit} from '../engine/arrangementEditing';
import React, { useEffect, useRef, useState } from 'react';
import {
  AbletonMidiClip,
  AbletonProjectState,
  AbletonTrack,
  AutomationPoint,
  HumanizationConfig,
  MasterBusConfig,
  MidiNoteEvent,
  NoteGridDivision,
  SpectrumOverlayMode,
  TimelineBarRangeSelection,
  TimelineEditMode,
  TrackMixerParams,
  TransportConfig,
} from '../types/ableton';
import { gridDivisionToStepBeats, midiNoteToName } from '../engine/alsXmlEngine';
import {
  INSTRUMENT_ROLE_TAXONOMY,
  RangeClipGeneratorMode,
} from '../engine/compositionIntelligenceEngine';
import { evaluateAutomationAtBeat, synthEngine } from '../engine/webAudioSynth';
import { evaluateParameterLane, PARAMETER_LIMITS } from '../engine/parameterAutomation';
import { exportClipToMidiFile, downloadMidiFile } from '../engine/midiFileExporter';
import { projectQueueService } from '../services/projectQueueService';
import { resolveBeatForEditMode, spotPositionToBeat } from '../services/commandBus';
import {
  beatToBarBeatTick,
  barBeatTickToBeat,
  musicalBarViewport,
  CANONICAL_PPQ,
  MAX_SUPPORTED_TIMELINE_BARS,
  MusicalTimeService,
} from '../engine/timelineCoordinates';
import { SelectedTrackAnalysisStrip } from './SelectedTrackAnalysisStrip';
import {
  Activity,
  Bookmark,
  Download,
  FileAudio,
  Flame,
  Layers,
  Repeat,
  Sliders,
  ZoomIn,
} from 'lucide-react';

export interface MidiGridPlayheadSyncMetrics {
  syncedBeat: number;
  windowStartBeat: number;
  windowEndBeat: number;
  visibleBeats: number;
  keyColWidth: number;
  gridWidth: number;
  pixelsPerBeat: number;
  pixelsPerSixteenth: number;
  playheadPixelX: number;
  stepStartPixelX: number;
  stepEndPixelX: number;
  activeStepIndex: number;
  totalGridSteps: number;
  sixteenthIndexInBar: number;
  isInsideWindow: boolean;
}

/**
 * Maps a live synthEngine beat position to exact pixel-based MIDI grid coordinates
 * within the Piano Roll viewport (accounting for the left piano key column, zoom bars,
 * follow-playhead windowing, and active quantization grid division).
 */
export function mapBeatToMidiGridCoordinates(
  beat: number,
  options: {
    canvasWidth: number;
    keyColWidth?: number;
    zoomBars?: number;
    totalBars?: number;
    pianoScrollBar?: number;
    followPlayhead?: boolean;
    gridDivision?: NoteGridDivision;
    meterMap?: AbletonProjectState['meterMap'];
    ppq?: number;
  }
): MidiGridPlayheadSyncMetrics {
  const safeBeat = Number.isFinite(beat) ? Math.max(0, beat) : 0;
  const keyColWidth = options.keyColWidth ?? 58;
  const effectiveCanvasWidth = options.canvasWidth > keyColWidth ? options.canvasWidth : 800;
  const gridWidth = Math.max(1, effectiveCanvasWidth - keyColWidth);
  const zoomBars = options.zoomBars ?? 2;
  const totalBars = options.totalBars ?? 16;
  const pianoScrollBar = options.pianoScrollBar ?? 0;
  const followPlayhead = options.followPlayhead ?? true;
  const gridDivision = options.gridDivision ?? '1/16';

  const viewport=musicalBarViewport(safeBeat,totalBars,zoomBars,pianoScrollBar,followPlayhead,options.meterMap,options.ppq);
  const {visibleBeats,startBeat:windowStartBeat,endBeat:windowEndBeat}=viewport;
  const isInsideWindow = safeBeat >= windowStartBeat && safeBeat <= windowEndBeat;

  const stepBeats = gridDivisionToStepBeats(gridDivision);
  const totalGridSteps = Math.max(1, Math.round(visibleBeats / stepBeats));
  const pixelsPerBeat = gridWidth / visibleBeats;
  const pixelsPerSixteenth = pixelsPerBeat * 0.25;

  const relBeatUnclamped = safeBeat - windowStartBeat;
  const relBeatClamped = Math.max(0, Math.min(visibleBeats, relBeatUnclamped));
  const playheadPixelX = keyColWidth + relBeatClamped * pixelsPerBeat;

  const rawStepIndex = Math.floor(relBeatClamped / stepBeats + 1e-6);
  const activeStepIndex = Math.max(0, Math.min(totalGridSteps - 1, rawStepIndex));
  const stepWidthPx = gridWidth / totalGridSteps;
  const stepStartPixelX = keyColWidth + activeStepIndex * stepWidthPx;
  const stepEndPixelX = stepStartPixelX + stepWidthPx;

  const position=beatToBarBeatTick(safeBeat,options.meterMap,options.ppq);
  const beatInBar=safeBeat-barBeatTickToBeat(position.bar,1,0,options.meterMap,options.ppq);
  const sixteenthIndexInBar = Math.floor(beatInBar / 0.25 + 1e-6) + 1;

  return {
    syncedBeat: safeBeat,
    windowStartBeat,
    windowEndBeat,
    visibleBeats,
    keyColWidth,
    gridWidth,
    pixelsPerBeat,
    pixelsPerSixteenth,
    playheadPixelX,
    stepStartPixelX,
    stepEndPixelX,
    activeStepIndex,
    totalGridSteps,
    sixteenthIndexInBar,
    isInsideWindow,
  };
}

export interface PlayheadSmoothingSnapshot {
  isPlaying: boolean;
  beat: number;
  scrollBar: number;
  zoom: number;
  projectRevision: number;
  prefersReducedMotion: boolean;
}

/**
 * Determines whether the visual playhead must snap immediately (`transition: none`)
 * rather than interpolating across a transport discontinuity (seek, stop/reset,
 * loop wrap, backward jump, project switch, viewport scroll/zoom change, or
 * reduced-motion preference).
 */
export function shouldSnapPlayheadImmediately(
  prev: PlayheadSmoothingSnapshot | null,
  next: PlayheadSmoothingSnapshot
): boolean {
  if (next.prefersReducedMotion) return true;
  if (!next.isPlaying) return true;
  if (!prev) return true;
  if (!prev.isPlaying) return true;
  if (prev.projectRevision !== next.projectRevision) return true;
  if (prev.scrollBar !== next.scrollBar) return true;
  if (Math.abs(prev.zoom - next.zoom) > 1e-6) return true;
  const deltaBeat = next.beat - prev.beat;
  // Backward jump (loop wrap, stop/reset, or backward seek) or large forward jump (seek)
  if (deltaBeat < -1e-4 || deltaBeat > 1.25) return true;
  return false;
}

export function mapBeatToArrangementPlayheadTransform(
  beat: number,
  options: {
    canvasWidthPx: number;
    arrStartBeat: number;
    arrVisibleBeats: number;
  }
): { isVisible: boolean; translateX: number; normalizedRatio: number } {
  const safeBeat = Number.isFinite(beat) ? Math.max(0, beat) : 0;
  const width = Math.max(1, options.canvasWidthPx || 800);
  const start = options.arrStartBeat;
  const span = Math.max(1 / CANONICAL_PPQ, options.arrVisibleBeats);
  const end = start + span;
  const isVisible = safeBeat >= start && safeBeat <= end;
  const normalizedRatio = Math.max(0, Math.min(1, (safeBeat - start) / span));
  const translateX = normalizedRatio * width;
  return { isVisible, translateX, normalizedRatio };
}

interface TimelineCanvasProps {
  editorSelection?: EditorSelection;
  onEditorSelectionChange?: (selection:EditorSelection)=>void;
  editorRevealToken?: number;
  onOpenLayerBrowser?: ()=>void;
  onCreateClip?: ()=>void;
  onAddNote?: ()=>void;
  project: AbletonProjectState;
  selectedTrackId: string;
  onSelectTrack: (trackId: string) => void;
  playheadBeat: number;
  modulatedCutoffHz: number;
  humanization: HumanizationConfig;
  transport: TransportConfig;
  masterBus?: MasterBusConfig;
  spectrumOverlayMode?: SpectrumOverlayMode;
  isPlaying?: boolean;
  onUpdateTransport: (partial: Partial<TransportConfig>) => void;
  onChangeArrangementLength?: (bars: number) => void;
  onUpdateMasterBus?: (partial: Partial<MasterBusConfig>) => void;
  onSeekBeat: (beat: number) => void;
  onToggleNoteInTrack: (trackId: string, stepBeat: number, pitch: number, stepDuration?: number, clipId?:string) => void;
  onEditArrangementClip?:(trackId:string,clipId:string,edit:ArrangementClipEdit)=>void;
  onEditArrangementNote?:(trackId:string,clipId:string,noteId:string,edit:ArrangementNoteEdit)=>void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onUpdateTrackMixer: (trackId: string, partial: Partial<TrackMixerParams>) => void;
  onUpdateTrackAutomation: (trackId: string, points: AutomationPoint[]) => void;
  editMode?: TimelineEditMode;
  onChangeEditMode?: (mode: TimelineEditMode) => void;
  onDropMemoryLocationAtPlayhead?: () => void;
  onOpenCompingAndTransientModal?: () => void;
  onOpenHumanizationHeatmap?: () => void;
  includeMidiHumanization?: boolean;
  onToggleIncludeMidiHumanization?: (include: boolean) => void;
  onExportClipToMidi?: (trackId: string, clipId: string, includeHumanization?: boolean) => void;
  onApplyNoteEditModeOperation?: (
    trackId: string,
    noteId: string,
    targetBeat: number,
    editMode: TimelineEditMode,
    gridStepBeats: number,
    clipId?: string
  ) => void;
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

export const TimelineCanvas: React.FC<TimelineCanvasProps> = ({
  project,
  selectedTrackId,
  onSelectTrack,
  playheadBeat,
  modulatedCutoffHz,
  humanization,
  transport,
  masterBus,
  spectrumOverlayMode = 'compact_lane',
  isPlaying = false,
  onUpdateTransport,
  onChangeArrangementLength,
  onUpdateMasterBus,
  onSeekBeat,
  onToggleNoteInTrack,
  onEditArrangementClip,
  onEditArrangementNote,
  onToggleMute,
  onToggleSolo,
  onUpdateTrackMixer,
  onUpdateTrackAutomation,
  editMode = 'grid',
  onChangeEditMode,
  onDropMemoryLocationAtPlayhead,
  onOpenCompingAndTransientModal,
  onOpenHumanizationHeatmap,
  includeMidiHumanization,
  onToggleIncludeMidiHumanization,
  onExportClipToMidi,
  onApplyNoteEditModeOperation,
  barRangeSelection,
  onChangeBarRangeSelection,
  onGenerateClipInRange,
  onSplitClipAtBeat,
  onDuplicateClipOnTrack,
  onConsolidateClipsInRange,
  onDeleteClipsInRange,
  onAddUserTrackFromRole,
  editorSelection,onEditorSelectionChange,editorRevealToken,onOpenLayerBrowser,onCreateClip,onAddNote,
}) => {
  const arrangementCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pianoRollCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string>();
  const [selectedNoteId, setSelectedNoteId] = useState<string>();
  const [clipPreview, setClipPreview] = useState<{
    trackId: string;
    clipId: string;
    start: number;
    length: number;
  }>();
  const [notePreview, setNotePreview] = useState<{
    clipId: string;
    noteId: string;
    time: number;
    duration: number;
    pitch: number;
  }>();
  const clipGesture = useRef<
    | {
        pointerId: number;
        trackId: string;
        clipId: string;
        start: number;
        length: number;
        anchorX: number;
        pixelsPerBeat: number;
        resize: boolean;
        moved: boolean;
      }
    | undefined
  >(undefined);
  const noteGesture = useRef<
    | {
        pointerId: number;
        trackId: string;
        clipId: string;
        noteId: string;
        time: number;
        duration: number;
        pitch: number;
        anchorX: number;
        anchorY: number;
        pixelsPerBeat: number;
        rowHeight: number;
        resize: boolean;
        moved: boolean;
        clipStart: number;
        clipEnd: number;
      }
    | undefined
  >(undefined);
  const [editorSelectionTrackId, setEditorSelectionTrackId] =
    useState(selectedTrackId);
  const activeClipId =
    (editorSelection?.trackId ?? editorSelectionTrackId) === selectedTrackId ? (editorSelection ? editorSelection.clipId : selectedClipId) : undefined;
  const activeNoteId =
    (editorSelection?.trackId ?? editorSelectionTrackId) === selectedTrackId ? (editorSelection ? editorSelection.noteId : selectedNoteId) : undefined;
  const selectEditorTarget = (
    clipId: string,
    noteId?: string,
    trackId = selectedTrackId,
  ) => {
    setEditorSelectionTrackId(trackId);
    setSelectedClipId(clipId);
    setSelectedNoteId(noteId);
    onEditorSelectionChange?.({trackId,clipId,noteId});
  };
  useEffect(() => {
    const cancel = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        clipGesture.current = undefined;
        noteGesture.current = undefined;
        setClipPreview(undefined);
        setNotePreview(undefined);
        setIsDraggingArrangement(false);
      }
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  const reusableFftRef = useRef<Uint8Array>(new Uint8Array(256));
  const [zoomBars, setZoomBars] = useState<1 | 2 | 4>(2);
  const [pianoScrollBar, setPianoScrollBar] = useState<number>(0);
  const [pianoGridDivision, setPianoGridDivision] = useState<NoteGridDivision>('1/16');
  const [arrangementZoom, setArrangementZoom] = useState<number>(1);
  const [arrangementScrollBar, setArrangementScrollBar] = useState<number>(0);
  const [showReturnLanes, setShowReturnLanes] = useState<boolean>(false);
  const [showTrackHeadersMobile, setShowTrackHeadersMobile] = useState<boolean>(true);
  const [isDraggingArrangement, setIsDraggingArrangement] = useState<boolean>(false);
  const [spotBar, setSpotBar] = useState<number>(1);
  const [spotBeat, setSpotBeat] = useState<number>(1);
  const [spotSixteenth, setSpotSixteenth] = useState<number>(1);
  const [pianoRollWidthPx, setPianoRollWidthPx] = useState<number>(800);
  const [localIncludeHumanization, setLocalIncludeHumanization] = useState<boolean>(true);
  const [localRangeStartBar, setLocalRangeStartBar] = useState<number>(
    barRangeSelection?.startBar ?? 33
  );
  const [localRangeEndBar, setLocalRangeEndBar] = useState<number>(
    barRangeSelection?.endBar ?? 41
  );
  const [newTrackRoleCode, setNewTrackRoleCode] = useState<string>('E2');

  const [foldedGroupIds, setFoldedGroupIds] = useState<Set<string>>(() => {
    const set = new Set<string>();
    project.tracks.forEach((t) => {
      if (t.isGroupTrack && t.isFolded) set.add(t.id);
    });
    return set;
  });

  useEffect(() => {
    setFoldedGroupIds((prev) => {
      const next = new Set(prev);
      project.tracks.forEach((t) => {
        if (t.isGroupTrack && t.isFolded) next.add(t.id);
      });
      return next;
    });
  }, [project.tracks]);

  const toggleFoldGroup = (groupId: string) => {
    setFoldedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const visibleTracks = React.useMemo(() => {
    return project.tracks.filter((t) => !t.groupId || !foldedGroupIds.has(t.groupId));
  }, [project.tracks, foldedGroupIds]);

  const effectiveRangeStartBar = barRangeSelection?.startBar ?? localRangeStartBar;
  const effectiveRangeEndBar = barRangeSelection?.endBar ?? localRangeEndBar;

  const updateBarRange = (nextStartBar: number, nextEndBar: number) => {
    const lo = Math.max(1, Math.min(nextStartBar, nextEndBar));
    const hi = Math.max(lo + 1, Math.max(nextStartBar, nextEndBar));
    setLocalRangeStartBar(lo);
    setLocalRangeEndBar(hi);
    onChangeBarRangeSelection?.({
      startBar: lo,
      endBar: hi,
      startBeat: barBeatTickToBeat(lo,1,0,project.meterMap,project.ppq),
      endBeat: barBeatTickToBeat(hi,1,0,project.meterMap,project.ppq),
      trackId: selectedTrackId,
    });
  };

  const effectiveIncludeHumanization =
    includeMidiHumanization !== undefined ? includeMidiHumanization : localIncludeHumanization;

  const handleToggleIncludeHumanization = (nextValue: boolean) => {
    setLocalIncludeHumanization(nextValue);
    onToggleIncludeMidiHumanization?.(nextValue);
  };
  const [engineSyncedBeat, setEngineSyncedBeat] = useState<number>(() =>
    synthEngine.getCurrentBeat()
  );
  const [arrangementWidthPx, setArrangementWidthPx] = useState<number>(800);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return Boolean(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  });
  const prevPlayheadSnapshotRef = useRef<PlayheadSmoothingSnapshot | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setPrefersReducedMotion(Boolean(e.matches));
    setPrefersReducedMotion(Boolean(mq.matches));
    mq.addEventListener?.('change', handler);
    return () => mq.removeEventListener?.('change', handler);
  }, []);

  // Synchronize with synthEngine high-precision audio clock during playback or seek
  useEffect(() => {
    setEngineSyncedBeat(synthEngine.getCurrentBeat());
    if (!isPlaying && !synthEngine.getIsPlaying()) return;
    let rafId: number | null = null;
    const syncTick = () => {
      setEngineSyncedBeat(synthEngine.getCurrentBeat());
      if (isPlaying || synthEngine.getIsPlaying()) {
        rafId = requestAnimationFrame(syncTick);
      }
    };
    rafId = requestAnimationFrame(syncTick);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
    };
  }, [isPlaying]);

  const currentEngineBeat = synthEngine.getCurrentBeat();
  const syncedPlayheadBeat = synthEngine.getIsPlaying()
    ? currentEngineBeat
    : playheadBeat > 0
    ? playheadBeat
    : currentEngineBeat > 0
    ? currentEngineBeat
    : engineSyncedBeat;

  const selectedTrack: AbletonTrack | undefined =
    project.tracks.find((t) => t.id === selectedTrackId) || project.tracks[0];

  const rawBars = project.arrangementLengthBars || transport.arrangementLengthBars || 16;
  const totalBars: number = Math.max(1, Math.min(MAX_SUPPORTED_TIMELINE_BARS, Math.round(rawBars)));
  const totalBeats = MusicalTimeService.arrangementTotalBeats(
    { ...project, arrangementLengthBars: totalBars },
    1
  );

  // Compute visible bar window in the Arrangement View based on continuous zoom & scroll
  const visibleArrBars = Math.max(1, Math.min(totalBars, Math.round(totalBars / Math.max(0.25, arrangementZoom))));
  const maxScrollBar = Math.max(0, totalBars - visibleArrBars);
  const arrangementViewport=musicalBarViewport(syncedPlayheadBeat,totalBars,visibleArrBars,arrangementScrollBar,transport.followPlayhead&&arrangementZoom>1,project.meterMap,project.ppq);
  const {startBar:effectiveScrollBar,startBeat:arrStartBeat,visibleBeats:arrVisibleBeats}=arrangementViewport;
  const spotMeter=beatToBarBeatTick(spotPositionToBeat(Math.min(totalBars,spotBar),1,1,project.meterMap,project.ppq),project.meterMap,project.ppq);
  const spotSubdivisions=Math.max(1,16/spotMeter.denominator);
  const arrEndBeat = arrStartBeat + arrVisibleBeats;

  const currentPlayheadSnapshot: PlayheadSmoothingSnapshot = {
    isPlaying: Boolean(isPlaying || synthEngine.getIsPlaying()),
    beat: syncedPlayheadBeat,
    scrollBar: effectiveScrollBar,
    zoom: arrangementZoom,
    projectRevision: project.projectRevision ?? project.revision ?? 1,
    prefersReducedMotion,
  };
  const snapPlayheadImmediately = shouldSnapPlayheadImmediately(
    prevPlayheadSnapshotRef.current,
    currentPlayheadSnapshot
  );
  useEffect(() => {
    prevPlayheadSnapshotRef.current = currentPlayheadSnapshot;
  });

  const arrangementPlayheadTransform = mapBeatToArrangementPlayheadTransform(syncedPlayheadBeat, {
    canvasWidthPx: arrangementWidthPx,
    arrStartBeat,
    arrVisibleBeats,
  });

  const midiGridSync = mapBeatToMidiGridCoordinates(syncedPlayheadBeat, {
    canvasWidth: pianoRollWidthPx,
    keyColWidth: 58,
    zoomBars,
    totalBars,
    pianoScrollBar,
    followPlayhead: transport.followPlayhead,
    gridDivision: pianoGridDivision,
    meterMap: project.meterMap,
    ppq: project.ppq,
  });

  const headerHeight = 32;
  const laneHeight = 72;
  const returnLaneHeight = 48;
  const busRowCount = showReturnLanes ? 3 : 0; // Return A (Reverb), Return B (3/16 Delay), Master Bus
  const totalArrangementHeight =
    headerHeight +
    Math.max(4, visibleTracks.length) * laneHeight +
    busRowCount * returnLaneHeight;

  // Draw Upper Arrangement Timeline + Loop Brace + Polymeter Markers + Return/Master Lanes
  useEffect(() => {
    const canvas = arrangementCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width > 0 ? rect.width : 800;
    const height = rect.height;
    if (rect.width > 0 && Math.abs(rect.width - arrangementWidthPx) > 1) {
      setArrangementWidthPx(rect.width);
    }

    ctx.fillStyle = '#0D1015';
    ctx.fillRect(0, 0, width, height);

    // Bar Ruler Header
    ctx.fillStyle = '#141820';
    ctx.fillRect(0, 0, width, headerHeight);
    ctx.strokeStyle = '#232934';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, headerHeight);
    ctx.lineTo(width, headerHeight);
    ctx.stroke();

    // Draw Ableton Loop Brace on Ruler
    const loopStartBeat = barBeatTickToBeat(transport.loopStartBar,1,0,project.meterMap,project.ppq);
    const loopSpanBeats = MusicalTimeService.barsToBeats(transport.loopLengthBars,transport.loopStartBar,project.meterMap,project.ppq);
    const loopEndBeat = Math.min(totalBeats, loopStartBeat + loopSpanBeats);

    if (transport.loopEnabled) {
      const visStart = Math.max(arrStartBeat, loopStartBeat);
      const visEnd = Math.min(arrEndBeat, loopEndBeat);
      if (visEnd > visStart) {
        const loopStartX = ((visStart - arrStartBeat) / arrVisibleBeats) * width;
        const loopWidth = ((visEnd - visStart) / arrVisibleBeats) * width;

        ctx.fillStyle = 'rgba(245, 158, 11, 0.06)';
        ctx.fillRect(loopStartX, headerHeight, loopWidth, height - headerHeight);

        ctx.fillStyle = '#F59E0B';
        ctx.fillRect(loopStartX, 0, loopWidth, 5);

        ctx.beginPath();
        ctx.moveTo(loopStartX, 0);
        ctx.lineTo(loopStartX + 7, 0);
        ctx.lineTo(loopStartX, 10);
        ctx.closePath();
        ctx.fill();

        ctx.beginPath();
        ctx.moveTo(loopStartX + loopWidth, 0);
        ctx.lineTo(loopStartX + loopWidth - 7, 0);
        ctx.lineTo(loopStartX + loopWidth, 10);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      ctx.fillStyle = 'rgba(16, 185, 129, 0.25)';
      ctx.fillRect(0, 0, width, 3);
    }

    // Draw Bar Grid Lines & Bar Numbers across visible window
    ctx.font = '500 10px "JetBrains Mono", monospace';
    const labelStep = visibleArrBars > 64 ? 8 : visibleArrBars > 32 ? 4 : visibleArrBars > 16 ? 2 : 1;
    for (let bOffset = 0; bOffset < visibleArrBars; bOffset++) {
      const barIndex = effectiveScrollBar + bOffset;
      const barBeat=barBeatTickToBeat(barIndex+1,1,0,project.meterMap,project.ppq);
      const x = ((barBeat-arrStartBeat)/arrVisibleBeats)*width;
      ctx.strokeStyle = barIndex % 4 === 0 ? '#28303E' : '#181D27';
      ctx.lineWidth = barIndex % 4 === 0 ? 1.2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      if (barIndex % labelStep === 0) {
        ctx.fillStyle = barIndex % 4 === 0 ? '#E2E8F0' : '#64748B';
        ctx.fillText(`${barIndex + 1}`, x + 4, 19);
      }
    }

    // Draw Memory Location Markers (1-9) on Arrangement Ruler
    (project.memoryLocations || []).forEach((loc) => {
      if (loc.beat < arrStartBeat || loc.beat > arrEndBeat) return;
      const lx = ((loc.beat - arrStartBeat) / arrVisibleBeats) * width;
      ctx.strokeStyle = loc.color || '#38bdf8';
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.moveTo(lx, 0);
      ctx.lineTo(lx, height);
      ctx.stroke();

      ctx.fillStyle = loc.color || '#38bdf8';
      ctx.fillRect(lx, 1, 52, 11);
      ctx.fillStyle = '#09090b';
      ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
      ctx.fillText(`[${loc.number}] ${loc.name.slice(0, 6)}`, lx + 2, 9.5);
    });

    // Check if any track in project has solo active
    const anySoloActive = project.tracks.some((t) => t.soloed);

    // Draw Track Lanes
    visibleTracks.forEach((track, idx) => {
      const y = headerHeight + idx * laneHeight;
      const isSelected = track.id === selectedTrack?.id;
      const isSoloMuted = anySoloActive && !track.soloed;

      // Lane Background: Amber highlight for soloed, dim for solo-muted, standard for normal
      if (track.soloed) {
        ctx.fillStyle = isSelected
          ? 'rgba(245, 158, 11, 0.18)'
          : 'rgba(245, 158, 11, 0.10)';
      } else if (isSoloMuted) {
        ctx.fillStyle = idx % 2 === 0 ? '#080A0E' : '#06070A';
      } else {
        ctx.fillStyle = isSelected
          ? 'rgba(245, 158, 11, 0.08)'
          : idx % 2 === 0
          ? '#0F1319'
          : '#0C0F14';
      }
      ctx.fillRect(0, y, width, laneHeight);

      // Amber solo glow borders
      if (track.soloed) {
        ctx.save();
        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 1.75;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();

        ctx.fillStyle = 'rgba(245, 158, 11, 0.35)';
        ctx.fillRect(0, y, 4, laneHeight);
        ctx.restore();
      }

      ctx.strokeStyle = isSoloMuted ? '#141820' : '#1E2530';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(0, y + laneHeight);
      ctx.lineTo(width, y + laneHeight);
      ctx.stroke();

      // Render Selected Bar-Range Highlight on Selected Track
      if (isSelected) {
        const rangeStartBeat = barBeatTickToBeat(effectiveRangeStartBar,1,0,project.meterMap,project.ppq);
        const rangeEndBeat = barBeatTickToBeat(effectiveRangeEndBar,1,0,project.meterMap,project.ppq);
        const visRangeStart = Math.max(arrStartBeat, rangeStartBeat);
        const visRangeEnd = Math.min(arrEndBeat, rangeEndBeat);
        if (visRangeEnd > visRangeStart) {
          const rx = ((visRangeStart - arrStartBeat) / arrVisibleBeats) * width;
          const rw = ((visRangeEnd - visRangeStart) / arrVisibleBeats) * width;
          ctx.save();
          ctx.fillStyle = 'rgba(56, 189, 248, 0.10)';
          ctx.strokeStyle = 'rgba(56, 189, 248, 0.75)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.fillRect(rx, y + 1, rw, laneHeight - 2);
          ctx.strokeRect(rx, y + 1, rw, laneHeight - 2);
          ctx.restore();
        }
      }

      // Render Track Clips at their exact true startTime and length (Fixed Bug P0-002!)
      track.clips.forEach((clip: AbletonMidiClip) => {
        const trueClipStart = clip.startTime;
        const trueClipEnd = clip.startTime + Math.max(1 / CANONICAL_PPQ, clip.length);
        const clipStart = Math.max(arrStartBeat, trueClipStart);
        const clipEnd = Math.min(arrEndBeat, trueClipEnd);
        if (clipEnd <= clipStart) return;

        const clipX = ((clipStart - arrStartBeat) / arrVisibleBeats) * width;
        const clipW = Math.max(4, ((clipEnd - clipStart) / arrVisibleBeats) * width);

        ctx.save();
        if (isSoloMuted) {
          ctx.globalAlpha = 0.38;
        }

        ctx.fillStyle = track.muted
          ? 'rgba(100, 116, 139, 0.12)'
          : track.soloed
          ? `${track.hexColor}35`
          : `${track.hexColor}22`;
        ctx.strokeStyle = track.muted
          ? '#475569'
          : track.soloed
          ? '#F59E0B'
          : track.hexColor;
        ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.fillRect(clipX + 1, y + 3, Math.max(2, clipW - 2), laneHeight - 6);
        ctx.strokeRect(clipX + 1, y + 3, Math.max(2, clipW - 2), laneHeight - 6);

        // Draw True Polymeter Loop Boundary Markers inside clip if clip.loopEndBeats is non-standard
        if (clip.loopEndBeats && clip.loopEndBeats > 0 && clip.loopEndBeats !== 16 && clip.loopEndBeats !== 64) {
          ctx.save();
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
          ctx.setLineDash([2, 2]);
          for (
            let loopB = trueClipStart + clip.loopEndBeats;
            loopB < trueClipEnd;
            loopB += clip.loopEndBeats
          ) {
            if (loopB >= arrStartBeat && loopB <= arrEndBeat) {
              const lx = ((loopB - arrStartBeat) / arrVisibleBeats) * width;
              ctx.beginPath();
              ctx.moveTo(lx, y + 15);
              ctx.lineTo(lx, y + laneHeight - 4);
              ctx.stroke();
            }
          }
          ctx.restore();
        }

        // Clip Header Strip
        ctx.fillStyle = track.muted
          ? '#334155'
          : track.soloed
          ? '#F59E0B'
          : `${track.hexColor}48`;
        ctx.fillRect(clipX + 1, y + 3, Math.max(2, clipW - 2), 12);

        if (clipW >= 28) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(clipX + 2, y + 2, Math.max(2, clipW - 4), 14);
          ctx.clip();
          ctx.fillStyle = track.soloed ? '#0A0D12' : '#F8FAFC';
          ctx.font = '500 9.5px "JetBrains Mono", monospace';
          const label = `${clip.name} (${Number(clip.length.toFixed(2))} beats · ${clip.notes.length}n)`;
          ctx.fillText(label, clipX + 5, y + 12);
          ctx.restore();
        }

        // Mini MIDI note ticks strictly inside clip's [trueClipStart, trueClipEnd) and visible window
        ctx.fillStyle = track.muted ? '#64748B' : track.soloed ? '#FCD34D' : track.hexColor;
        clip.notes.forEach((note) => {
          if (note.time < trueClipStart - 0.05 || note.time >= trueClipEnd + 0.05) return;
          if (note.time < arrStartBeat || note.time > arrEndBeat) return;
          const nx = ((note.time - arrStartBeat) / arrVisibleBeats) * width;
          const nw = Math.max(1.5, (note.duration / arrVisibleBeats) * width);
          const normVel = note.velocity / 127;
          const nh = Math.max(3, (laneHeight - 19) * normVel);
          const ny = y + laneHeight - 4 - nh;
          ctx.globalAlpha = isSoloMuted
            ? note.isGhost
              ? 0.18
              : 0.32
            : note.isGhost
            ? 0.42
            : 0.88;
          ctx.fillRect(nx, ny, nw, nh);
        });
        ctx.restore();
      });

      // Draw Ableton Automation Envelope Curve ONLY when Automation Mode [A] is explicitly enabled
      if (
        transport.showAutomationLanes &&
        track.automationPoints &&
        track.automationPoints.length > 0
      ) {
        const sortedPts = [...track.automationPoints].sort((a, b) => a.beat - b.beat);
        ctx.save();
        ctx.strokeStyle = isSelected ? '#F43F5E' : 'rgba(244, 63, 94, 0.55)';
        ctx.lineWidth = isSelected ? 2 : 1.2;

        ctx.beginPath();
        sortedPts.forEach((pt, pIdx) => {
          const px = ((pt.beat - arrStartBeat) / arrVisibleBeats) * width;
          const py = y + laneHeight - 5 - pt.value * (laneHeight - 18);
          if (pIdx === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        });
        ctx.stroke();

        sortedPts.forEach((pt) => {
          if (pt.beat < arrStartBeat || pt.beat > arrEndBeat) return;
          const px = ((pt.beat - arrStartBeat) / arrVisibleBeats) * width;
          const py = y + laneHeight - 5 - pt.value * (laneHeight - 18);
          ctx.fillStyle = '#0D1015';
          ctx.strokeStyle = '#F43F5E';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(px, py, 3.2, 0, Math.PI * 2);
          ctx.fill();
          ctx.stroke();
        });
        ctx.restore();
      }

      if (transport.showAutomationLanes) {
        for (const lane of track.parameterAutomation || []) {
          if (!lane.enabled) continue;
          const [min,max] = PARAMETER_LIMITS[lane.target];
          ctx.save(); ctx.strokeStyle = '#06B6D4'; ctx.lineWidth = 1.3; ctx.beginPath();
          for (let pixel = 0; pixel <= width; pixel += 4) {
            const beat = arrStartBeat + pixel / width * arrVisibleBeats;
            const value = (evaluateParameterLane(lane,beat)-min)/(max-min);
            const py = y+laneHeight-5-value*(laneHeight-18);
            if (!pixel) ctx.moveTo(pixel,py); else ctx.lineTo(pixel,py);
          }
          ctx.stroke();ctx.restore();
        }
      }

      // Render Solo & Solo-Muted Status Badges
      if (track.soloed) {
        const badgeX = width - 88;
        ctx.save();
        ctx.fillStyle = '#F59E0B';
        ctx.fillRect(badgeX, y + 4, 82, 13);
        ctx.fillStyle = '#080A0D';
        ctx.font = 'bold 8.5px "JetBrains Mono", monospace';
        ctx.fillText('SOLO ACTIVE', badgeX + 7, y + 13.5);
        ctx.restore();
      } else if (isSoloMuted) {
        const badgeX = width - 82;
        ctx.save();
        ctx.fillStyle = 'rgba(71, 85, 105, 0.35)';
        ctx.fillRect(badgeX, y + 4, 76, 13);
        ctx.fillStyle = '#64748B';
        ctx.font = 'bold 8px "JetBrains Mono", monospace';
        ctx.fillText('SOLO-MUTED', badgeX + 6, y + 13.5);
        ctx.restore();
      }

      // Real-Time 8-Band Frequency Distribution Overlay (compact_lane mode on selected track)
      if (isSelected && spectrumOverlayMode === 'compact_lane') {
        const hudW = 104;
        const hudH = laneHeight - 10;
        const hudX = width - (track.soloed || isSoloMuted ? 198 : 110);
        const hudY = y + 5;

        ctx.save();
        ctx.fillStyle = 'rgba(11, 14, 19, 0.90)';
        ctx.strokeStyle = '#252D3D';
        ctx.lineWidth = 1;
        ctx.fillRect(hudX, hudY, hudW, hudH);
        ctx.strokeRect(hudX, hudY, hudW, hudH);

        // Header label
        ctx.fillStyle = '#94A3B8';
        ctx.font = '600 7px "JetBrains Mono", monospace';
        ctx.fillText('8-BAND FFT', hudX + 4, hudY + 7);

        // 8 bands: Sub, Bass, LowMid, Mid, UpMid, Pres, Bril, Air
        const barW = 8;
        const barGap = 3;
        const startBarX = hudX + 5;
        const maxBarH = hudH - 11;

        // Fetch live FFT data if audio is playing
        if (isPlaying) {
          const binCount = synthEngine.getFrequencyBinCount();
          if (reusableFftRef.current.length !== binCount) {
            reusableFftRef.current = new Uint8Array(binCount);
          }
          synthEngine.getByteFrequencyData(reusableFftRef.current as any);
        }

        const binRanges = [
          [0, 2], [2, 5], [5, 10], [10, 22],
          [22, 50], [50, 100], [100, 180], [180, 255]
        ];

        const archetypeFreqBands: Record<string, number[]> = {
          kick: [0.95, 0.75, 0.35, 0.15, 0.08, 0.05, 0.02, 0.01],
          rumble: [0.88, 0.92, 0.45, 0.12, 0.04, 0.02, 0.01, 0.01],
          acid: [0.25, 0.55, 0.85, 0.92, 0.78, 0.45, 0.20, 0.10],
          synth: [0.10, 0.35, 0.70, 0.85, 0.80, 0.65, 0.40, 0.22],
          percussion: [0.30, 0.65, 0.80, 0.75, 0.60, 0.50, 0.35, 0.15],
          hats: [0.02, 0.05, 0.15, 0.35, 0.65, 0.88, 0.92, 0.75],
          ride: [0.04, 0.08, 0.20, 0.45, 0.72, 0.90, 0.85, 0.70],
          pad: [0.15, 0.30, 0.60, 0.75, 0.70, 0.55, 0.35, 0.20],
        };
        const profile = archetypeFreqBands[track.archetype] || [0.4, 0.5, 0.6, 0.5, 0.4, 0.3, 0.2, 0.1];

        for (let b = 0; b < 8; b++) {
          const bx = startBarX + b * (barW + barGap);
          let bandLevel = 0;

          if (isPlaying) {
            const binCount = reusableFftRef.current.length;
            const [bStart, bEnd] = binRanges[b];
            let sum = 0;
            let cnt = 0;
            for (let k = bStart; k <= Math.min(bEnd, binCount - 1); k++) {
              sum += reusableFftRef.current[k];
              cnt++;
            }
            bandLevel = cnt > 0 ? (sum / cnt) / 255 : 0;
          } else {
            bandLevel = profile[b] * 0.85;
          }

          const barH = Math.max(1.5, Math.min(maxBarH, bandLevel * maxBarH));
          const barY = hudY + hudH - barH - 1;

          // Band color gradient
          const barColor =
            b <= 1 ? '#F59E0B' : b <= 3 ? '#10B981' : b <= 5 ? '#06B6D4' : '#A855F7';

          ctx.fillStyle = `${barColor}33`;
          ctx.fillRect(bx, hudY + 8, barW, maxBarH);
          ctx.fillStyle = barColor;
          ctx.fillRect(bx, barY, barW, barH);

          // Peak dot
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(bx, Math.max(hudY + 8, barY - 1.5), barW, 1.5);
        }
        ctx.restore();
      }
    });

    // Draw Return A (Warehouse Reverb), Return B (3/16 Dub Delay), and Master Bus Lanes at bottom
    if (showReturnLanes) {
      const baseReturnY = headerHeight + project.tracks.length * laneHeight;
      const returnSpecs = [
        {
          label: `RETURN A · HybridReverb (${(masterBus?.reverbDecaySec || 3.2).toFixed(1)}s Dark Warehouse Tail)`,
          color: '#10B981',
          level: masterBus?.reverbReturnLevel ?? 0.45,
        },
        {
          label: `RETURN B · Echo 3/16 Ping-Pong (FB ${Math.round((masterBus?.delayFeedback ?? 0.42) * 100)}%)`,
          color: '#A855F7',
          level: masterBus?.delayReturnLevel ?? 0.4,
        },
        {
          label: `MASTER BUS · EQ8 Sub-Mono (${masterBus?.subBassMonoCutoffHz ?? 120}Hz) → Glue (${Math.round((masterBus?.glueCompressionDrive ?? 0.35) * 100)}%) → Limiter`,
          color: '#F59E0B',
          level: Math.min(1, 0.65 + (masterBus?.glueCompressionDrive ?? 0.35) * 0.25),
        },
      ];

      returnSpecs.forEach((spec, rIdx) => {
        const ry = baseReturnY + rIdx * returnLaneHeight;
        ctx.fillStyle = rIdx === 2 ? '#141923' : '#0E131B';
        ctx.fillRect(0, ry, width, returnLaneHeight);

        ctx.strokeStyle = '#222A38';
        ctx.beginPath();
        ctx.moveTo(0, ry + returnLaneHeight);
        ctx.lineTo(width, ry + returnLaneHeight);
        ctx.stroke();

        // Only draw automation contour on Return/Master lanes if Automation Mode [A] is ON
        if (transport.showAutomationLanes) {
          ctx.save();
          ctx.strokeStyle = spec.color;
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          for (let px = 0; px <= width; px += 8) {
            const beatAtPx = arrStartBeat + (px / width) * arrVisibleBeats;
            const barPhase = (beatAtPx % 16) / 16;
            const mod =
              rIdx === 0
                ? Math.sin(barPhase * Math.PI * 2) * 0.12
                : rIdx === 1
                ? (barPhase > 0.65 ? 0.2 : -0.05)
                : Math.cos(barPhase * Math.PI * 2) * 0.08;
            const normY = Math.max(0.15, Math.min(0.92, spec.level + mod));
            const py = ry + returnLaneHeight - 4 - normY * (returnLaneHeight - 12);
            if (px === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
          ctx.restore();
        } else {
          // Clean subtle level bar indicator without automation curve lines
          ctx.fillStyle = `${spec.color}18`;
          ctx.fillRect(2, ry + 15, width * spec.level, returnLaneHeight - 19);
        }

        ctx.fillStyle = spec.color;
        ctx.font = '600 9px "JetBrains Mono", monospace';
        ctx.fillText(spec.label, 6, ry + 11);
      });
    }

    // Draw Playhead Ruler Cap in header only (vertical line is rendered by the single GPU-composited playhead overlay to prevent duplicate competing playheads)
    if (syncedPlayheadBeat >= arrStartBeat && syncedPlayheadBeat <= arrEndBeat) {
      const playheadX = ((syncedPlayheadBeat - arrStartBeat) / arrVisibleBeats) * width;
      ctx.fillStyle = '#F59E0B';
      ctx.beginPath();
      ctx.moveTo(playheadX - 5, 0);
      ctx.lineTo(playheadX + 5, 0);
      ctx.lineTo(playheadX, 9);
      ctx.closePath();
      ctx.fill();
    }
  }, [
    project,
    selectedTrack,
    playheadBeat,
    syncedPlayheadBeat,
    humanization,
    transport,
    masterBus,
    totalArrangementHeight,
    totalBars,
    totalBeats,
    arrangementZoom,
    effectiveScrollBar,
    arrStartBeat,
    arrVisibleBeats,
    arrEndBeat,
    visibleArrBars,
    showReturnLanes,
    spectrumOverlayMode,
    isPlaying,
    effectiveRangeStartBar,
    effectiveRangeEndBar,
  ]);

  // Draw Lower Microscopic Ghost-Note Piano Roll & Velocity Lane
  useEffect(() => {
    const canvas = pianoRollCanvasRef.current;
    if (!canvas || !selectedTrack) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : canvas.width || 800;
    const height = rect.height > 0 ? rect.height : canvas.height || 240;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    if (rect.width > 0 && Math.abs(rect.width - pianoRollWidthPx) > 1) {
      setPianoRollWidthPx(rect.width);
    }

    const keyColWidth = 58;
    const velLaneHeight = 54;
    const rollHeight = height - velLaneHeight;
    const syncCoords = mapBeatToMidiGridCoordinates(syncedPlayheadBeat, {
      canvasWidth: width,
      keyColWidth,
      zoomBars,
      totalBars,
      pianoScrollBar,
      followPlayhead: transport.followPlayhead,
      gridDivision: pianoGridDivision,
    meterMap: project.meterMap,
    ppq: project.ppq,
    });
    const {
      visibleBeats,
      windowStartBeat,
      windowEndBeat,
      gridWidth,
      totalGridSteps,
      playheadPixelX,
      stepStartPixelX,
      stepEndPixelX,
      activeStepIndex,
      isInsideWindow,
    } = syncCoords;

    ctx.fillStyle = '#0B0D11';
    ctx.fillRect(0, 0, width, height);

    const allClipsNotes = selectedTrack.clips.flatMap((c) =>
      c.notes.filter(
        (n) => n.time >= c.startTime - 0.05 && n.time < c.startTime + Math.max(1 / CANONICAL_PPQ, c.length) + 0.05
      )
    );
    const visibleNotes = allClipsNotes.filter(
      (n) => n.time >= windowStartBeat - 0.1 && n.time < windowEndBeat + 0.1
    );

    const allTrackPitches = allClipsNotes.length > 0 ? allClipsNotes.map((n) => n.pitch) : [36];
    const uniquePitches = Array.from(new Set(allTrackPitches)).sort((a, b) => b - a);
    const pitchRows = pianoPitchRows(selectedTrack);
    const rowHeight = rollHeight / pitchRows.length;
    const stepBeats = gridDivisionToStepBeats(pianoGridDivision);

    // 1. Draw Horizontal Pitch Rows & Piano Key Labels
    pitchRows.forEach((pitch, rIdx) => {
      const y = rIdx * rowHeight;
      const isActivePitch = uniquePitches.includes(pitch);
      const transposedPitch = pitch + (selectedTrack.mixer?.transposeSemitones || 0);

      ctx.fillStyle = isActivePitch ? '#121721' : rIdx % 2 === 0 ? '#0E1218' : '#0B0E13';
      ctx.fillRect(keyColWidth, y, gridWidth, rowHeight);

      ctx.strokeStyle = '#1B212C';
      ctx.beginPath();
      ctx.moveTo(0, y + rowHeight);
      ctx.lineTo(width, y + rowHeight);
      ctx.stroke();

      ctx.fillStyle = isActivePitch ? '#1A202C' : '#11151C';
      ctx.fillRect(0, y, keyColWidth, rowHeight - 1);
      ctx.fillStyle = isActivePitch ? '#F8FAFC' : '#64748B';
      ctx.font = '500 10px "JetBrains Mono", monospace';
      ctx.fillText(`${midiNoteToName(transposedPitch)} (${pitch})`, 5, y + rowHeight * 0.62);
    });

    // 2. Draw Vertical Quantized Grid Lines (1/4, 1/8, 1/16, or 1/32) + Kick Sidechain Ducking Shading
    for (let step = 0; step <= totalGridSteps; step++) {
      const x = keyColWidth + (step / totalGridSteps) * gridWidth;
      const beatOffset = step * stepBeats;
      const absBeat=windowStartBeat+beatOffset;
      const coordinate=beatToBarBeatTick(absBeat,project.meterMap,project.ppq);
      const isBeat=coordinate.tickInBeat===0;
      const isBar=isBeat&&coordinate.beatInBar===1;

      if (
        isBeat &&
        step < totalGridSteps &&
        selectedTrack.archetype !== 'kick' &&
        (selectedTrack.mixer?.sidechainDepth || 0) > 0.1
      ) {
        const scWidth = (0.25 / visibleBeats) * gridWidth * 0.85;
        ctx.fillStyle = `rgba(245, 158, 11, ${(selectedTrack.mixer?.sidechainDepth || 0) * 0.08})`;
        ctx.fillRect(x, 0, scWidth, rollHeight);
      }

      ctx.strokeStyle = isBar ? '#2E3748' : isBeat ? '#212836' : '#161B24';
      ctx.lineWidth = isBar ? 1.5 : 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();

      if (isBeat && step < totalGridSteps) {
        const barNum=coordinate.bar;
        const beatInBar=coordinate.beatInBar;
        ctx.fillStyle = isBar ? '#CBD5E1' : '#64748B';
        ctx.font = '500 9px "JetBrains Mono", monospace';
        ctx.fillText(`${barNum}.${beatInBar}`, x + 3, 10);

        if (isBar) {
          const barIntensity = humanization.barVarianceIntensity?.[barNum] ?? 1.0;
          const barWidthPx = (MusicalTimeService.barsToBeats(1,barNum,project.meterMap,project.ppq) / visibleBeats) * gridWidth;
          // Draw subtle heatmap header tint and variance badge
          const heatColor =
            barIntensity < 0.45
              ? 'rgba(6, 182, 212, 0.08)'
              : barIntensity < 0.95
              ? 'rgba(16, 185, 129, 0.07)'
              : barIntensity < 1.35
              ? 'rgba(245, 158, 11, 0.08)'
              : 'rgba(244, 63, 94, 0.12)';
          ctx.fillStyle = heatColor;
          ctx.fillRect(x, 0, barWidthPx, rollHeight);

          ctx.fillStyle =
            barIntensity < 0.45
              ? '#22D3EE'
              : barIntensity < 0.95
              ? '#34D399'
              : barIntensity < 1.35
              ? '#FBBF24'
              : '#FB7185';
          ctx.font = '600 8px "JetBrains Mono", monospace';
          ctx.fillText(`VAR ${(barIntensity * 100).toFixed(0)}%`, x + 36, 10);
        }
      }
    }

    // 3. Draw Velocity Lane Divider
    ctx.fillStyle = '#10141C';
    ctx.fillRect(0, rollHeight, width, velLaneHeight);
    ctx.strokeStyle = '#262E3D';
    ctx.beginPath();
    ctx.moveTo(0, rollHeight);
    ctx.lineTo(width, rollHeight);
    ctx.stroke();

    ctx.fillStyle = '#64748B';
    ctx.font = '500 10px "JetBrains Mono", monospace';
    ctx.fillText('VEL', 12, rollHeight + 18);
    ctx.fillText('127', 12, rollHeight + 32);
    ctx.fillText('ghost', 8, rollHeight + 46);

    const ghostLineY =
      rollHeight + velLaneHeight - (humanization.ghostVelocityMax / 127) * (velLaneHeight - 10);
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.25)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(keyColWidth, ghostLineY);
    ctx.lineTo(width, ghostLineY);
    ctx.stroke();
    ctx.setLineDash([]);

    // 4. Draw <MidiNoteEvent> Blocks + Micro-Timing Shift Vectors + Velocity Stalks
    visibleNotes.forEach((sourceNote: MidiNoteEvent) => {
      const preview=notePreview?.noteId===sourceNote.id&&selectedTrack.clips.find(c=>c.id===notePreview.clipId)?.notes.includes(sourceNote)?notePreview:undefined;
      const note=preview?{...sourceNote,...preview}:sourceNote;
      const rowIdx = pitchRows.indexOf(note.pitch);
      if(rowIdx<0)return;
      const effectiveRow = rowIdx;
      const y = effectiveRow * rowHeight + 3;
      const h = Math.max(4, rowHeight - 6);

      const relQuantBeat = note.quantizedTime - windowStartBeat;
      const relActualBeat = note.time - windowStartBeat;

      const quantX = keyColWidth + (relQuantBeat / visibleBeats) * gridWidth;
      const actualX = keyColWidth + (relActualBeat / visibleBeats) * gridWidth;
      const noteW = Math.max(6, (note.duration / visibleBeats) * gridWidth - 2);

      const shiftBeats = note.time - note.quantizedTime;
      if (Math.abs(shiftBeats) >= 0.001) {
        ctx.strokeStyle = 'rgba(248, 250, 252, 0.24)';
        ctx.lineWidth = 1;
        ctx.strokeRect(quantX, y + 1, noteW, h - 2);

        ctx.strokeStyle = '#F59E0B';
        ctx.beginPath();
        ctx.moveTo(quantX, y + h / 2);
        ctx.lineTo(actualX, y + h / 2);
        ctx.stroke();
      }

      const isPlayheadCrossingNote =
        isInsideWindow &&
        syncedPlayheadBeat >= note.time &&
        syncedPlayheadBeat <= note.time + note.duration;

      ctx.fillStyle = isPlayheadCrossingNote
        ? '#F59E0B'
        : note.isGhost
        ? 'rgba(56, 189, 248, 0.42)'
        : selectedTrack.hexColor;
      ctx.strokeStyle = isPlayheadCrossingNote
        ? '#FEF08A'
        : note.isSlide
        ? '#FACC15'
        : note.isGhost
        ? '#38BDF8'
        : '#F8FAFC';
      ctx.lineWidth = isPlayheadCrossingNote ? 2 : note.isSlide ? 1.8 : 1;
      ctx.fillRect(actualX, y, noteW, h);
      ctx.strokeRect(actualX, y, noteW, h);

      if (zoomBars <= 2 && noteW > 20 && Math.abs(shiftBeats) >= 0.002) {
        ctx.fillStyle = '#0B0D10';
        ctx.font = '600 9px "JetBrains Mono", monospace';
        const sign = shiftBeats > 0 ? '+' : '';
        ctx.fillText(`${sign}${(shiftBeats * 1000).toFixed(0)}m`, actualX + 3, y + h - 4);
      }

      const stalkHeight = (note.velocity / 127) * (velLaneHeight - 12);
      const stalkY = height - 4 - stalkHeight;
      ctx.fillStyle = isPlayheadCrossingNote
        ? '#F59E0B'
        : note.isGhost
        ? '#38BDF8'
        : selectedTrack.hexColor;
      ctx.fillRect(actualX, stalkY, Math.max(4, Math.min(10, noteW * 0.45)), stalkHeight);
    });

    // 5. Draw Active Synchronized MIDI Grid Step Highlight & Playhead Cap (vertical line is rendered by the single transform overlay)
    if (isInsideWindow) {
      ctx.fillStyle = 'rgba(245, 158, 11, 0.09)';
      ctx.fillRect(stepStartPixelX, 0, Math.max(2, stepEndPixelX - stepStartPixelX), rollHeight);
    }

    ctx.fillStyle = '#F59E0B';
    ctx.beginPath();
    ctx.moveTo(playheadPixelX - 5, 0);
    ctx.lineTo(playheadPixelX + 5, 0);
    ctx.lineTo(playheadPixelX, 8);
    ctx.closePath();
    ctx.fill();

    ctx.font = '600 8.5px "JetBrains Mono", monospace';
    const syncLabel = `${syncedPlayheadBeat.toFixed(2)}B · S${activeStepIndex + 1} · ${Math.round(playheadPixelX)}px`;
    const labelX = Math.min(Math.max(keyColWidth + 4, playheadPixelX + 6), Math.max(keyColWidth + 4, width - 115));
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fillRect(labelX - 2, 12, 108, 12);
    ctx.fillStyle = '#FBBF24';
    ctx.fillText(syncLabel, labelX, 21);
  }, [
    selectedTrack,
    zoomBars,
    pianoScrollBar,
    totalBars,
    pianoGridDivision,
    notePreview,
    selectedClipId,
    selectedNoteId,
    playheadBeat,
    syncedPlayheadBeat,
    humanization,
    transport.followPlayhead,
    pianoRollWidthPx,
    isPlaying,
  ]);

  const processArrangementPointer = (
    e: React.PointerEvent<HTMLCanvasElement>,
    isInitialDown: boolean
  ) => {
    const canvas = arrangementCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, e.clientY - rect.top));

    const rawBeat = Math.max(
      0,
      Math.min(totalBeats - 0.01, arrStartBeat + (x / Math.max(1, rect.width)) * arrVisibleBeats)
    );

    // Top Ruler or Shift-click: Seek Playhead & Set Loop Start Bar on Shift+Click
    if (y <= headerHeight) {
      onSeekBeat(rawBeat);
      const targetBar = beatToBarBeatTick(rawBeat,project.meterMap,project.ppq).bar-1;
      setPianoScrollBar(targetBar);
      if (e.shiftKey) {
        onUpdateTransport({ loopStartBar: targetBar + 1 });
      }
      return;
    }

    const clickedIdx = Math.floor((y - headerHeight) / laneHeight);
    if (clickedIdx >= 0 && clickedIdx < visibleTracks.length) {
      const targetTrack = visibleTracks[clickedIdx];
      if (isInitialDown && targetTrack.id !== selectedTrack?.id) {
        onSelectTrack(targetTrack.id);
      }

      if (transport.showAutomationLanes) {
        // Explicit Automation Edit Mode [A]: Insert or update breakpoint on track
        const laneTop = headerHeight + clickedIdx * laneHeight;
        const relY = y - laneTop;
        const normVal = Math.max(
          0.05,
          Math.min(0.98, Number((1 - (relY - 6) / (laneHeight - 16)).toFixed(2)))
        );
        const snappedBeat = Math.round(rawBeat * 2) / 2;

        const existingPts = [...(targetTrack.automationPoints || [])];
        const nearIdx = existingPts.findIndex((p) => Math.abs(p.beat - snappedBeat) <= 1.25);
        if (nearIdx >= 0) {
          existingPts[nearIdx] = { beat: snappedBeat, value: normVal };
        } else {
          existingPts.push({ beat: snappedBeat, value: normVal });
        }
        existingPts.sort((a, b) => a.beat - b.beat);
        onUpdateTrackAutomation(targetTrack.id, existingPts);
      } else {
        // Standard Interactive Timeline Mode (Default): Select Track, Seek/Scrub Playhead & Sync Piano Roll Window
        onSeekBeat(rawBeat);
        setPianoScrollBar(beatToBarBeatTick(rawBeat,project.meterMap,project.ppq).bar-1);
      }
    } else {
      // Clicked inside Return / Master Lanes at bottom: Seek Playhead
      onSeekBeat(rawBeat);
      setPianoScrollBar(beatToBarBeatTick(rawBeat,project.meterMap,project.ppq).bar-1);
    }
  };

  const handleArrangementPointerDown = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (clipGesture.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    const track = visibleTracks[Math.floor((y - headerHeight) / laneHeight)];
    const beat = arrStartBeat + (x / Math.max(1, rect.width)) * arrVisibleBeats;
    const clip =
      y > headerHeight && track?.type === 'midi'
        ? [...track.clips]
            .reverse()
            .find((c) => beat >= c.startTime && beat < c.startTime + c.length)
        : undefined;
    if (
      clip &&
      !track.locked &&
      !transport.showAutomationLanes &&
      onEditArrangementClip
    ) {
      onSelectTrack(track.id);
      selectEditorTarget(clip.id, undefined, track.id);
      clipGesture.current = {
        pointerId: e.pointerId,
        trackId: track.id,
        clipId: clip.id,
        start: clip.startTime,
        length: clip.length,
        anchorX: e.clientX,
        pixelsPerBeat: rect.width / arrVisibleBeats,
        resize:
          Math.abs(
            ((clip.startTime + clip.length - beat) / arrVisibleBeats) *
              rect.width,
          ) <= 8,
        moved: false,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      return;
    }
    setIsDraggingArrangement(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
    processArrangementPointer(e, true);
  };
  const clipGestureValue = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = clipGesture.current;
    if (!g) return;
    const delta = (e.clientX - g.anchorX) / Math.max(0.000001, g.pixelsPerBeat);
    return {
      trackId: g.trackId,
      clipId: g.clipId,
      start: g.resize
        ? g.start
        : resolveBeatForEditMode(
            g.start + delta,
            editMode,
            gridDivisionToStepBeats(pianoGridDivision),
          ),
      length: g.resize
        ? Math.max(
            1 / CANONICAL_PPQ,
            resolveBeatForEditMode(
              g.length + delta,
              editMode,
              gridDivisionToStepBeats(pianoGridDivision),
            ),
          )
        : g.length,
    };
  };
  const handleArrangementPointerMove = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const g = clipGesture.current;
    if (g && g.pointerId !== e.pointerId) return;
    if (g) {
      if (Math.abs(e.clientX - g.anchorX) > 3) g.moved = true;
      if (g.moved) setClipPreview(clipGestureValue(e));
      return;
    }
    if (isDraggingArrangement) processArrangementPointer(e, false);
  };
  const finishArrangementPointer = (
    e: React.PointerEvent<HTMLCanvasElement>,
    cancelled = false,
  ) => {
    const g = clipGesture.current;
    if (g && g.pointerId !== e.pointerId) return;
    const next = clipGestureValue(e);
    clipGesture.current = undefined;
    setClipPreview(undefined);
    setIsDraggingArrangement(false);
    if (g?.moved && next && !cancelled)
      onEditArrangementClip?.(g.trackId, g.clipId, {
        kind: 'place',
        startBeat: next.start,
        lengthBeats: next.length,
        mode: editMode,
      });
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };
  const handleArrangementPointerUp = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ) => finishArrangementPointer(e);

  const handleApplyAutomationPreset = (
    preset: 'drop-ramp' | 'tension-wave' | 'sub-scoop' | 'flat' | 'clear'
  ) => {
    if (!selectedTrack) return;
    if (preset === 'clear') {
      onUpdateTrackAutomation(selectedTrack.id, []);
      return;
    }
    const scale = totalBeats / 64;
    let pts: AutomationPoint[] = [];
    if (preset === 'drop-ramp') {
      pts = [
        { beat: 0, value: 0.35 },
        { beat: 16 * scale, value: 0.5 },
        { beat: 32 * scale, value: 0.42 },
        { beat: 48 * scale, value: 0.92 },
        { beat: 56 * scale, value: 0.25 },
        { beat: 64 * scale, value: 0.78 },
      ];
    } else if (preset === 'tension-wave') {
      pts = [
        { beat: 0, value: 0.3 },
        { beat: 8 * scale, value: 0.75 },
        { beat: 16 * scale, value: 0.35 },
        { beat: 24 * scale, value: 0.82 },
        { beat: 32 * scale, value: 0.4 },
        { beat: 48 * scale, value: 0.95 },
        { beat: 64 * scale, value: 0.5 },
      ];
    } else if (preset === 'sub-scoop') {
      pts = [
        { beat: 0, value: 0.7 },
        { beat: 24 * scale, value: 0.65 },
        { beat: 32 * scale, value: 0.18 },
        { beat: 48 * scale, value: 0.22 },
        { beat: 52 * scale, value: 0.85 },
        { beat: 64 * scale, value: 0.75 },
      ];
    } else {
      pts = [
        { beat: 0, value: 0.65 },
        { beat: totalBeats, value: 0.65 },
      ];
    }
    onUpdateTrackAutomation(selectedTrack.id, pts);
  };

  const pianoPointerContext = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left,
      y = e.clientY - rect.top;
    const viewport=mapBeatToMidiGridCoordinates(syncedPlayheadBeat,{canvasWidth:rect.width,zoomBars,totalBars,pianoScrollBar,followPlayhead:transport.followPlayhead,meterMap:project.meterMap,ppq:project.ppq});
    const {visibleBeats,windowStartBeat:start}=viewport;
    const rows = selectedTrack ? pianoPitchRows(selectedTrack) : [36];
    const height = rect.height - 54;
    const row = Math.max(
      0,
      Math.min(
        rows.length - 1,
        Math.floor((y / Math.max(1, height)) * rows.length),
      ),
    );
    return {
      rect,
      x,
      y,
      start,
      rows,
      height,
      pitch: rows[row],
      pixelsPerBeat: Math.max(1, rect.width - 58) / visibleBeats,
      beat: start + ((x - 58) / Math.max(1, rect.width - 58)) * visibleBeats,
      rowHeight: height / rows.length,
    };
  };
  const handlePianoRollPointerDown = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    if (!selectedTrack || noteGesture.current) return;
    const c = pianoPointerContext(e);
    if (c.x <= 58) {
      synthEngine.triggerLivePad(selectedTrack.archetype, 100, c.pitch);
      return;
    }
    if (c.y >= c.height) {
      onSeekBeat(Math.max(0, c.beat));
      return;
    }
    if (selectedTrack.locked) return;
    const clips = [...selectedTrack.clips].sort(
      (a, b) => Number(b.id === activeClipId) - Number(a.id === activeClipId),
    );
    let hit: { clip: AbletonMidiClip; note: MidiNoteEvent } | undefined;
    for (const clip of clips) {
      const note = clip.notes.find(
        (n) =>
          n.pitch === c.pitch &&
          n.time >= clip.startTime &&
          n.time < clip.startTime + clip.length &&
          c.beat >= n.time &&
          c.beat <=
            Math.min(
              clip.startTime + clip.length,
              n.time + Math.max(n.duration, 6 / c.pixelsPerBeat),
            ),
      );
      if (note) {
        hit = { clip, note };
        break;
      }
    }
    if (hit && onEditArrangementNote) {
      selectEditorTarget(hit.clip.id, hit.note.id);
      if (e.altKey) {
        onEditArrangementNote(selectedTrack.id, hit.clip.id, hit.note.id, {
          delete: true,
        });
        return;
      }
      noteGesture.current = {
        pointerId: e.pointerId,
        trackId: selectedTrack.id,
        clipId: hit.clip.id,
        noteId: hit.note.id,
        time: hit.note.time,
        duration: hit.note.duration,
        pitch: hit.note.pitch,
        anchorX: e.clientX,
        anchorY: e.clientY,
        pixelsPerBeat: c.pixelsPerBeat,
        rowHeight: c.rowHeight,
        resize:
          Math.abs(
            (hit.note.time + hit.note.duration - c.beat) * c.pixelsPerBeat,
          ) <= 8,
        moved: false,
        clipStart: hit.clip.startTime,
        clipEnd: hit.clip.startTime + hit.clip.length,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {}
      return;
    }
    const step = gridDivisionToStepBeats(pianoGridDivision);
    const beat =
      editMode === 'spot'
        ? spotPositionToBeat(spotBar, spotBeat, spotSixteenth, project.meterMap, project.ppq)
        : editMode === 'slip'
          ? Math.max(0, c.beat)
          : c.start + Math.floor((c.beat - c.start) / step) * step;
    const destinations = selectedTrack.clips.filter(
      (clip) => beat >= clip.startTime && beat < clip.startTime + clip.length,
    );
    const destination =
      destinations.find((clip) => clip.id === activeClipId) ??
      (destinations.length === 1 ? destinations[0] : undefined);
    if (destination) selectEditorTarget(destination.id);
    onToggleNoteInTrack(selectedTrack.id, beat, c.pitch, step, destination?.id);
  };
  const noteGestureValue = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const g = noteGesture.current;
    if (!g) return;
    const step = gridDivisionToStepBeats(pianoGridDivision);
    const delta = (e.clientX - g.anchorX) / g.pixelsPerBeat;
    const time = g.resize
      ? g.time
      : Math.max(
          g.clipStart,
          Math.min(
            g.clipEnd - 1 / CANONICAL_PPQ,
            resolveBeatForEditMode(g.time + delta, editMode, step),
          ),
        );
    const duration = g.resize
      ? Math.min(
          g.clipEnd - g.time,
          Math.max(
            1 / CANONICAL_PPQ,
            resolveBeatForEditMode(g.duration + delta, editMode, step),
          ),
        )
      : g.duration;
    const pitch = g.resize
      ? g.pitch
      : Math.max(
          0,
          Math.min(
            127,
            g.pitch -
              Math.round((e.clientY - g.anchorY) / Math.max(1, g.rowHeight)),
          ),
        );
    return { clipId: g.clipId, noteId: g.noteId, time, duration, pitch };
  };
  const handlePianoRollPointerMove = (
    e: React.PointerEvent<HTMLCanvasElement>,
  ) => {
    const g = noteGesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    if (Math.hypot(e.clientX - g.anchorX, e.clientY - g.anchorY) > 3)
      g.moved = true;
    if (g.moved) setNotePreview(noteGestureValue(e));
  };
  const finishPianoPointer = (
    e: React.PointerEvent<HTMLCanvasElement>,
    cancelled = false,
  ) => {
    const g = noteGesture.current;
    if (g && g.pointerId !== e.pointerId) return;
    const next = noteGestureValue(e);
    noteGesture.current = undefined;
    setNotePreview(undefined);
    if (g?.moved && next && !cancelled)
      onEditArrangementNote?.(g.trackId, g.clipId, g.noteId, {
        time: next.time,
        quantizedTime: next.time,
        duration: next.duration,
        pitch: next.pitch,
        mode: editMode,
      });
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
  };

  const posCoord = beatToBarBeatTick(
    Math.max(0, playheadBeat),
    project.meterMap,
    project.ppq
  );
  const currentBarNumber = posCoord.bar;
  const currentBeatInBar = posCoord.beatInBar;
  const currentSixteenth = Math.floor(posCoord.tickInBeat / (project.ppq || CANONICAL_PPQ) * 4) + 1;
  const liveAutoVal = Math.round(
    evaluateAutomationAtBeat(selectedTrack?.automationPoints, playheadBeat, totalBeats) * 100
  );

  return (
    <div className="flex flex-col h-full min-h-0 overflow-y-auto bg-[#0D1015] select-none">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#232a33] bg-[#12161B] px-3 py-2 text-xs">
        <span className="font-semibold">Arrangement · {totalBars} bars</span>
        <div className="flex gap-1">{onOpenLayerBrowser&&<button type="button" onClick={onOpenLayerBrowser} className="min-h-11 rounded border border-slate-700 px-3">Add layer</button>}{onCreateClip&&<button type="button" disabled={!selectedTrack||selectedTrack.locked||selectedTrack.type!=='midi'} onClick={onCreateClip} className="min-h-11 rounded border border-slate-700 px-3 disabled:opacity-40">Add clip</button>}</div>
        <div className="flex items-center gap-2">
          <button type="button" aria-label="Zoom out timeline" onClick={()=>setArrangementZoom(z=>Math.max(1,z/2))} className="min-h-11 min-w-11 rounded bg-[#1B2128]">−</button>
          <button type="button" onClick={()=>{setArrangementZoom(1);setArrangementScrollBar(0);}} className="min-h-11 rounded bg-[#1B2128] px-3">Fit</button>
          <button type="button" aria-label="Zoom in timeline" onClick={()=>setArrangementZoom(z=>Math.min(16,z*2))} className="min-h-11 min-w-11 rounded bg-[#1B2128]">+</button>
          <label className="sr-only" htmlFor="timeline-edit-mode">Edit mode</label>
          <select id="timeline-edit-mode" value={editMode} onChange={e=>onChangeEditMode?.(e.target.value as TimelineEditMode)} className="min-h-11 rounded border border-[#2a333e] bg-[#12161B] px-2">
            <option value="grid">Grid</option><option value="slip">Slip</option><option value="shuffle">Shuffle</option><option value="spot">Spot</option>
          </select>
        </div>
      </div>
      <details data-testid="timeline-settings" className="shrink-0 border-b border-[#232a33]">
        <summary className="min-h-11 cursor-pointer px-3 py-3 text-xs text-zinc-400">Timeline settings · loop, markers and automation</summary>
      {/* Ableton Arrangement View Header Bar with Duration, Real-Time Zoom, Loop & Automation */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-1.5 bg-[#12161E] border-b border-[#232934] text-xs">
        <div className="flex flex-wrap items-center gap-2.5 text-slate-300 font-mono tabular-nums">
          <span className="font-semibold text-slate-100">
            ARRANGEMENT ({totalBars} BARS · {totalBeats} BEATS)
          </span>
          <span
            className="px-2 py-0.5 bg-[#0A0C10] border border-[#252D3D] rounded text-amber-400 font-semibold"
            title={`Canonical MusicalTimeService position: ${MusicalTimeService.formatBarBeatTick(
              Math.max(0, playheadBeat),
              project.meterMap,
              project.ppq
            )}`}
          >
            POS: {currentBarNumber}.{currentBeatInBar}.{currentSixteenth}
          </span>
          <span className="hidden xl:inline text-emerald-400">
            LFO: {modulatedCutoffHz.toFixed(0)} Hz
          </span>
          {transport.showAutomationLanes && (
            <span className="hidden xl:inline text-rose-400">
              AUTO: {liveAutoVal}%
            </span>
          )}

          {/* Configurable Track Arrangement Duration (1 to 4096 Bars) */}
          {onChangeArrangementLength && (
            <div className="flex items-center bg-[#0B0D11] border border-[#252D3D] rounded p-0.5 text-[10px]">
              <span className="px-1.5 text-slate-400">LENGTH:</span>
              {([1, 4, 8, 16, 32, 64, 128, 256, 1024, 4096] as const).map((bars) => (
                <button
                  key={bars}
                  type="button"
                  data-testid={`arrangement-length-${bars}b-btn`}
                  onClick={() => onChangeArrangementLength(bars)}
                  className={`px-1.5 py-0.5 rounded transition-colors ${
                    totalBars === bars
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title={`Scale arrangement duration to ${bars} bars (${MusicalTimeService.barsToBeats(bars,1,project.meterMap,project.ppq)} beats)`}
                >
                  {bars}B
                </button>
              ))}
              <input
                type="number"
                data-testid="arrangement-length-bars-input"
                min={1}
                max={MAX_SUPPORTED_TIMELINE_BARS}
                value={totalBars}
                onChange={(e) => {
                  const parsed = parseInt(e.target.value, 10);
                  if (Number.isFinite(parsed)) {
                    onChangeArrangementLength(
                      Math.max(1, Math.min(MAX_SUPPORTED_TIMELINE_BARS, parsed))
                    );
                  }
                }}
                className="ml-1 w-14 bg-[#07090D] border border-[#252D3D] rounded px-1 py-0.2 text-center text-amber-300 font-semibold"
                title={`Set exact arrangement extent in bars (1–${MAX_SUPPORTED_TIMELINE_BARS})`}
              />
            </div>
          )}
        </div>

        {/* Right Toolbar: Continuous Real-Time Zoom, Return Lanes, Loop & Automation */}
        <div className="flex flex-wrap items-center gap-1.5 font-mono">
          {/* Continuous Arrangement Zoom (Fit / 1x, 2x, 4x, 8x, 16x + Continuous Slider) */}
          <div className="flex items-center bg-[#0B0D11] border border-[#252D3D] rounded p-0.5 text-[10px]">
            <ZoomIn className="w-3 h-3 text-amber-400 mx-1" />
            {([1, 2, 4, 8, 16] as const).map((z) => (
              <button
                key={z}
                type="button"
                data-testid={`timeline-zoom-${z}x-btn`}
                onClick={() => {
                  setArrangementZoom(z);
                  if (z === 1) setArrangementScrollBar(0);
                }}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  Math.abs(arrangementZoom - z) < 0.1
                    ? 'bg-sky-500/25 text-sky-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title={`Zoom arrangement timeline ${z}x (${Math.max(1, Math.floor(totalBars / z))} visible bars)`}
              >
                {z === 1 ? 'FIT' : `${z}x`}
              </button>
            ))}
          </div>

          {arrangementZoom > 1 && (
            <div className="flex items-center gap-1 bg-[#0B0D11] border border-[#252D3D] rounded px-1.5 py-0.5 text-[10px]">
              <span className="text-slate-400">
                B{effectiveScrollBar + 1}–{effectiveScrollBar + visibleArrBars}
              </span>
              <input
                type="range"
                min={0}
                max={maxScrollBar}
                step={1}
                value={effectiveScrollBar}
                onChange={(e) => setArrangementScrollBar(parseInt(e.target.value, 10))}
                className="w-16 studio-slider"
                title="Scroll horizontal bar window across arrangement"
              />
            </div>
          )}

          {/* Toggle Return A / Return B / Master Timeline Lanes */}
          <button
            type="button"
            onClick={() => setShowReturnLanes(!showReturnLanes)}
            className={`px-2 py-1 rounded border text-[10px] font-semibold flex items-center gap-1 transition-colors ${
              showReturnLanes
                ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                : 'bg-[#181E29] text-slate-400 border-[#283142]'
            }`}
            title="Show or hide Return A (Reverb), Return B (3/16 Delay) & Master Bus lanes below tracks"
          >
            <Layers className="w-3 h-3" />
            <span>Returns &amp; Master</span>
          </button>

          {/* Loop ON / OFF Switch */}
          <button
            type="button"
            onClick={() => onUpdateTransport({ loopEnabled: !transport.loopEnabled })}
            className={`px-2 py-1 rounded border text-[10px] font-semibold flex items-center gap-1 transition-colors ${
              transport.loopEnabled
                ? 'bg-amber-500 text-slate-950 border-amber-400'
                : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
            }`}
          >
            <Repeat className="w-3 h-3" />
            {transport.loopEnabled
              ? `LOOP (${transport.loopLengthBars}B)`
              : `FULL ${totalBars}B`}
          </button>

          {transport.loopEnabled && (
            <div className="flex items-center bg-[#0B0D11] border border-[#252D3D] rounded p-0.5">
              {([4, 8, 16, 32] as const).map((bars) => (
                <button
                  key={bars}
                  type="button"
                  onClick={() => onUpdateTransport({ loopLengthBars: bars })}
                  className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                    transport.loopLengthBars === bars
                      ? 'bg-amber-500/25 text-amber-300 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {bars}B
                </button>
              ))}
            </div>
          )}

          {/* Ableton [A] Automation Lanes Mode Button (OFF by default) */}
          <button
            type="button"
            onClick={() =>
              onUpdateTransport({ showAutomationLanes: !transport.showAutomationLanes })
            }
            className={`px-2 py-1 rounded border text-[10px] font-semibold flex items-center gap-1 transition-colors ${
              transport.showAutomationLanes
                ? 'bg-rose-500 text-white border-rose-400'
                : 'bg-[#181E29] text-slate-400 border-[#283142] hover:text-white'
            }`}
            title="Toggle Automation Lanes [A] (Off by default so timeline track/playhead interactions are unobstructed)"
          >
            <Activity className="w-3 h-3" />
            Auto [A]: {transport.showAutomationLanes ? 'ON' : 'OFF'}
          </button>

          {transport.showAutomationLanes && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleApplyAutomationPreset('drop-ramp')}
                className="px-1.5 py-0.5 text-[10px] bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded"
              >
                Drop Ramp
              </button>
              <button
                type="button"
                onClick={() => handleApplyAutomationPreset('tension-wave')}
                className="px-1.5 py-0.5 text-[10px] bg-rose-500/15 hover:bg-rose-500/25 text-rose-300 border border-rose-500/30 rounded"
              >
                Filter Wave
              </button>
              <button
                type="button"
                onClick={() => handleApplyAutomationPreset('clear')}
                className="px-1.5 py-0.5 text-[10px] bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-600 rounded"
                title="Clear automation breakpoints on selected track"
              >
                Clear Line
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowTrackHeadersMobile(!showTrackHeadersMobile)}
            className="sm:hidden px-2 py-1 rounded border text-[10px] font-semibold bg-[#181E29] text-amber-300 border-[#283142]"
          >
            {showTrackHeadersMobile ? 'Hide Mixer' : 'Show Mixer'}
          </button>
        </div>
      </div>

      {/* SoundCraft Edit Modes (Grid | Slip | Shuffle | Spot) & Memory Locations (1-9) Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-1 bg-[#0E1218] border-b border-[#232934] text-[10px] font-mono">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-slate-400 font-semibold">EDIT MODE:</span>
          <div className="flex items-center bg-[#090B0E] border border-[#252D3D] rounded p-0.5">
            {(['grid', 'slip', 'shuffle', 'spot'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onChangeEditMode && onChangeEditMode(mode)}
                className={`px-2 py-0.5 rounded uppercase font-bold transition-colors ${
                  editMode === mode
                    ? mode === 'shuffle'
                      ? 'bg-purple-500 text-white'
                      : mode === 'slip'
                      ? 'bg-emerald-500 text-slate-950'
                      : mode === 'spot'
                      ? 'bg-sky-500 text-slate-950'
                      : 'bg-amber-500 text-slate-950'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title={
                  mode === 'grid'
                    ? 'Grid Mode: Quantize edits to musical division'
                    : mode === 'slip'
                    ? 'Slip Mode: Continuous sub-grid placement without quantization'
                    : mode === 'shuffle'
                    ? 'Shuffle Mode: Contiguous ripple of subsequent events on delete/move'
                    : 'Spot Mode: Exact numeric Bar.Beat.16th coordinate placement'
                }
              >
                {mode}
              </button>
            ))}
          </div>

          {editMode === 'spot' && (
            <div className="flex items-center gap-1 bg-sky-500/10 border border-sky-500/40 rounded px-2 py-0.5 text-sky-300">
              <span>SPOT POS:</span>
              <input
                type="number"
                min={1}
                max={totalBars}
                value={spotBar}
                onChange={(e) => setSpotBar(Math.max(1, Math.min(totalBars,Math.floor(Number(e.target.value)))))}
                className="w-10 bg-zinc-950 border border-zinc-700 rounded px-1 text-center text-white"
                title={`Target Bar (1-${totalBars})`}
              />
              <span>.</span>
              <input
                type="number"
                min={1}
                max={spotMeter.numerator}
                value={Math.min(spotMeter.numerator,spotBeat)}
                onChange={(e) => setSpotBeat(Math.max(1, Math.min(spotMeter.numerator, Number(e.target.value))))}
                className="w-8 bg-zinc-950 border border-zinc-700 rounded px-1 text-center text-white"
                title={`Target Beat (1-${spotMeter.numerator})`}
              />
              <span>.</span>
              <input
                type="number"
                min={1}
                max={spotSubdivisions}
                value={Math.min(spotSubdivisions,spotSixteenth)}
                onChange={(e) =>
                  setSpotSixteenth(Math.max(1, Math.min(spotSubdivisions, Number(e.target.value))))
                }
                className="w-8 bg-zinc-950 border border-zinc-700 rounded px-1 text-center text-white"
                title={`Target 16th (1-${spotSubdivisions})`}
              />
              <button
                type="button"
                onClick={() => onSeekBeat(spotPositionToBeat(spotBar, spotBeat, spotSixteenth, project.meterMap, project.ppq))}
                className="ml-1 px-1.5 py-0.5 rounded bg-sky-500 text-slate-950 font-bold"
              >
                Jump
              </button>
            </div>
          )}
        </div>

        {/* Memory Locations (1-9) Quick Recall & Drop Marker */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-slate-400 flex items-center gap-1">
            <Bookmark className="w-3 h-3 text-sky-400" />
            LOCATORS:
          </span>
          {(project.memoryLocations || []).map((loc) => (
            <button
              key={loc.id}
              type="button"
              onClick={() => {
                onSeekBeat(loc.beat);
                setPianoScrollBar(beatToBarBeatTick(loc.beat,project.meterMap,project.ppq).bar-1);
              }}
              className="px-1.5 py-0.5 rounded bg-[#141A24] hover:bg-[#1E2736] border border-[#2A3548] text-slate-200 flex items-center gap-1"
              title={`Jump to Memory Location [${loc.number}] ${loc.name} (Bar ${
                beatToBarBeatTick(loc.beat,project.meterMap,project.ppq).bar
              })`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: loc.color || '#38bdf8' }}
              />
              <span>
                [{loc.number}] {loc.name}
              </span>
            </button>
          ))}
          {onDropMemoryLocationAtPlayhead && (
            <button
              type="button"
              onClick={onDropMemoryLocationAtPlayhead}
              className="px-2 py-0.5 rounded bg-sky-500/20 hover:bg-sky-500/30 border border-sky-500/40 text-sky-300 font-semibold"
              title="Drop or update a numbered Memory Location at current playhead position"
            >
              + Drop Marker
            </button>
          )}
        </div>
      </div>

      </details>

      {/* Timeline Overview Navigator (Full-Song Minimap) + Bar-Range Clip Generator & Editor Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-1 bg-[#0A0D13] border-b border-[#1E2634] text-[10px] font-mono">
        {/* Full-Song Overview Navigator Minimap */}
        <div
          data-testid="timeline-overview-minimap"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const norm = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
            const clickedBar = Math.floor(norm * totalBars);
            setArrangementScrollBar(
              Math.max(0, Math.min(maxScrollBar, clickedBar - Math.floor(visibleArrBars / 2)))
            );
          }}
          className="relative h-5 w-44 sm:w-64 bg-[#07090D] border border-[#252E3F] rounded overflow-hidden cursor-pointer shrink-0"
          title="Full-Song Arrangement Overview Minimap (Click to pan viewport across entire project)"
        >
          {project.tracks.map((trk, tIdx) => {
            const rowH = Math.max(1.5, 18 / Math.max(1, project.tracks.length));
            return trk.clips.map((c) => {
              const leftPct = Math.max(0, Math.min(100, (c.startTime / Math.max(1 / CANONICAL_PPQ, totalBeats)) * 100));
              const widthPct = Math.max(
                0.8,
                Math.min(100 - leftPct, (Math.max(1 / CANONICAL_PPQ, c.length) / Math.max(1 / CANONICAL_PPQ, totalBeats)) * 100)
              );
              return (
                <div
                  key={`${trk.id}_${c.id}`}
                  style={{
                    left: `${leftPct}%`,
                    width: `${widthPct}%`,
                    top: `${1 + tIdx * rowH}px`,
                    height: `${Math.max(1, rowH - 0.5)}px`,
                    backgroundColor: trk.hexColor,
                  }}
                  className="absolute opacity-75 rounded-[1px]"
                />
              );
            });
          })}
          {/* Active Viewport Box */}
          <div
            style={{
              left: `${(effectiveScrollBar / Math.max(1, totalBars)) * 100}%`,
              width: `${Math.min(100, (visibleArrBars / Math.max(1, totalBars)) * 100)}%`,
            }}
            className="absolute inset-y-0 border border-amber-400 bg-amber-400/10 pointer-events-none"
          />
          {/* Smooth Transform-Synced Minimap Playhead */}
          <div
            data-testid="minimap-smooth-playhead"
            data-snap-immediate={snapPlayheadImmediately ? 'true' : 'false'}
            style={{
              left: `${Math.max(0, Math.min(100, (syncedPlayheadBeat / Math.max(1 / CANONICAL_PPQ, totalBeats)) * 100))}%`,
              transition: snapPlayheadImmediately ? 'none' : 'left 45ms linear, transform 45ms linear',
            }}
            className="absolute inset-y-0 w-[1.5px] bg-amber-300 shadow-[0_0_6px_rgba(251,191,36,0.9)] transition-[left,transform] duration-75 ease-linear will-change-[left,transform] pointer-events-none"
          />
        </div>

        <details data-testid="clip-actions" className="w-full min-w-0">
          <summary className="min-h-11 cursor-pointer py-3 text-xs text-zinc-300">Clip actions · {selectedTrack?.name || 'Select a track'}</summary>
        {/* Bar-Range Selection & Multi-Clip Creation / Generation Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div className="flex items-center gap-1 bg-[#111621] border border-sky-500/35 rounded px-1.5 py-0.5">
            <span className="text-sky-300 font-semibold">BAR RANGE:</span>
            <input
              type="number"
              data-testid="bar-range-start-input"
              min={1}
              max={totalBars}
              value={effectiveRangeStartBar}
              onChange={(e) =>
                updateBarRange(Math.max(1, Number(e.target.value)), effectiveRangeEndBar)
              }
              className="w-11 bg-[#090B0F] border border-[#283246] rounded px-1 text-center text-amber-300 font-bold"
              title="Range Start Bar (1-indexed inclusive)"
            />
            <span className="text-slate-400">to</span>
            <input
              type="number"
              data-testid="bar-range-end-input"
              min={effectiveRangeStartBar + 1}
              max={totalBars + 64}
              value={effectiveRangeEndBar}
              onChange={(e) =>
                updateBarRange(
                  effectiveRangeStartBar,
                  Math.max(effectiveRangeStartBar + 1, Number(e.target.value))
                )
              }
              className="w-11 bg-[#090B0F] border border-[#283246] rounded px-1 text-center text-amber-300 font-bold"
              title="Range End Bar (1-indexed exclusive, e.g. 33 to 41 = 8 bars)"
            />
            <span className="text-slate-400">
              ({Math.max(1, effectiveRangeEndBar - effectiveRangeStartBar)}B)
            </span>
          </div>

          {selectedTrack && onGenerateClipInRange && (
            <>
              <button type="button" className="min-h-11 px-2 border border-slate-700 rounded text-[10px] text-amber-200" title="Selected range: supplied MIDI pitches own harmony; skip further Chord expansion" onClick={()=>onGenerateClipInRange(selectedTrack.id,effectiveRangeStartBar,effectiveRangeEndBar,'voiced-midi')}>MIDI owns harmony</button>
              {selectedTrack.devices.some(d=>d.xmlTag==='MidiChord'&&!d.bypassed)&&<button type="button" className="min-h-11 px-2 border border-slate-700 rounded text-[10px] text-amber-200" title="Selected range: explicitly allow Chord device pitch expansion, including existing chords" onClick={()=>onGenerateClipInRange(selectedTrack.id,effectiveRangeStartBar,effectiveRangeEndBar,'chord-device')}>Chord device owns harmony</button>}

              <button
                type="button"
                data-testid="range-create-empty-clip-btn"
                onClick={() => {
                  onGenerateClipInRange(
                    selectedTrack.id,
                    effectiveRangeStartBar,
                    effectiveRangeEndBar,
                    'empty'
                  );
                  setPianoScrollBar(Math.max(0, effectiveRangeStartBar - 1));
                }}
                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 font-semibold"
                title="Create empty MIDI clip across selected bar range"
              >
                + Empty Clip
              </button>
              <button
                type="button"
                data-testid="range-generate-chord-clip-btn"
                onClick={() => {
                  onGenerateClipInRange(
                    selectedTrack.id,
                    effectiveRangeStartBar,
                    effectiveRangeEndBar,
                    'chord'
                  );
                  setPianoScrollBar(Math.max(0, effectiveRangeStartBar - 1));
                }}
                className="px-2 py-0.5 rounded bg-purple-500/20 hover:bg-purple-500/30 border border-purple-500/45 text-purple-200 font-semibold"
                title="Generate Dub/Detroit/Hypnotic MIDI Chord Clip strictly inside selected bar range"
              >
                + Gen Chord Clip
              </button>
              <button
                type="button"
                data-testid="range-generate-bass-clip-btn"
                onClick={() => {
                  onGenerateClipInRange(
                    selectedTrack.id,
                    effectiveRangeStartBar,
                    effectiveRangeEndBar,
                    'bass'
                  );
                  setPianoScrollBar(Math.max(0, effectiveRangeStartBar - 1));
                }}
                className="px-2 py-0.5 rounded bg-orange-500/20 hover:bg-orange-500/30 border border-orange-500/45 text-orange-200 font-semibold"
                title="Generate Syncopated Techno Bassline Clip strictly inside selected bar range"
              >
                + Gen Bass
              </button>
              <button
                type="button"
                data-testid="range-generate-drum-clip-btn"
                onClick={() => {
                  onGenerateClipInRange(
                    selectedTrack.id,
                    effectiveRangeStartBar,
                    effectiveRangeEndBar,
                    selectedTrack.archetype === 'percussion' ? 'percussion' : 'drum'
                  );
                  setPianoScrollBar(Math.max(0, effectiveRangeStartBar - 1));
                }}
                className="px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/45 text-amber-200 font-semibold"
                title="Generate Drum/Percussion Phrase Clip strictly inside selected bar range"
              >
                + Gen Drum/Perc
              </button>
            </>
          )}

          {selectedTrack && onSplitClipAtBeat && (
            <button
              type="button"
              data-testid="range-split-clip-btn"
              onClick={() => {
                const atBeat=playheadBeat > 0 ? playheadBeat : barBeatTickToBeat(effectiveRangeStartBar,1,0,project.meterMap,project.ppq);
                if(onEditArrangementClip && activeClipId) onEditArrangementClip(selectedTrack.id,activeClipId,{kind:'split',atBeat});
                else onSplitClipAtBeat(selectedTrack.id,atBeat);
              }}
              className="px-1.5 py-0.5 rounded bg-[#141A24] hover:bg-[#1E2736] border border-[#2A3548] text-slate-300"
              title="Split clip at current bar/playhead"
            >
              Split
            </button>
          )}

          {selectedTrack && onDuplicateClipOnTrack && (
            <button
              type="button"
              data-testid="range-duplicate-clip-btn"
              onClick={() => onDuplicateClipOnTrack(selectedTrack.id,activeClipId??selectedTrack.clips[0]?.id)}
              className="px-1.5 py-0.5 rounded bg-[#141A24] hover:bg-[#1E2736] border border-[#2A3548] text-slate-300"
              title="Duplicate active clip to next bar span"
            >
              Duplicate
            </button>
          )}

          {selectedTrack && onConsolidateClipsInRange && (
            <button
              type="button"
              data-testid="range-consolidate-clip-btn"
              onClick={() =>
                onConsolidateClipsInRange(
                  selectedTrack.id,
                  effectiveRangeStartBar,
                  effectiveRangeEndBar
                )
              }
              className="px-1.5 py-0.5 rounded bg-[#141A24] hover:bg-[#1E2736] border border-[#2A3548] text-slate-300"
              title="Consolidate clips across selected bar range into a single clip"
            >
              Consolidate
            </button>
          )}

          {selectedTrack && onDeleteClipsInRange && (
            <button
              type="button"
              data-testid="range-delete-clip-btn"
              onClick={() =>
                onDeleteClipsInRange(selectedTrack.id, effectiveRangeStartBar, effectiveRangeEndBar)
              }
              className="px-1.5 py-0.5 rounded bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/35 text-rose-300"
              title="Delete clip content inside selected bar range"
            >
              Del Range
            </button>
          )}

          {onAddUserTrackFromRole && (
            <div className="flex items-center gap-1 bg-[#111621] border border-emerald-500/35 rounded px-1.5 py-0.5">
              <select
                data-testid="add-track-role-select"
                value={newTrackRoleCode}
                onChange={(e) => setNewTrackRoleCode(e.target.value)}
                className="bg-[#090B0F] text-emerald-300 text-[10px] rounded px-1 py-0.2 border border-[#252E3F]"
                title="Select Underground Techno Instrument Role (Groups A-H)"
              >
                {INSTRUMENT_ROLE_TAXONOMY.map((r) => (
                  <option key={r.roleCode} value={r.roleCode}>
                    [{r.roleCode}] {r.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                data-testid="add-user-track-btn"
                onClick={() => onAddUserTrackFromRole(newTrackRoleCode)}
                className="px-1.5 py-0.5 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 font-bold"
                title="Add new track with selected Group A-H instrument role"
              >
                + Track
              </button>
            </div>
          )}
        </div>
        </details>
      </div>

      {/* Upper Arrangement Split: Left Ableton Track + Return Headers + Right Arrangement Canvas */}
      <div
        className="flex w-full shrink-0 border-b border-[#232934] overflow-y-auto"
        style={{ height: `${Math.min(340, totalArrangementHeight)}px` }}
      >
        <div
          className="flex w-full"
          style={{ minHeight: `${totalArrangementHeight}px` }}
        >
          {/* Left Ableton Track Header & Inline Mixer Column */}
          <div
            className={`${
              showTrackHeadersMobile ? 'w-[155px] sm:w-[250px] flex' : 'hidden sm:flex sm:w-[250px]'
            } shrink-0 bg-[#11151D] border-r border-[#232934] flex-col transition-all duration-150`}
          >
            <div
              className="px-2 sm:px-3 flex items-center justify-between bg-[#141820] border-b border-[#232934] text-[10px] font-mono text-slate-400 shrink-0"
              style={{ height: `${headerHeight}px` }}
            >
              <span className="truncate">TRACK ({project.tracks.length})</span>
              <span className="truncate">ACT · SOLO · VOL</span>
            </div>

            {visibleTracks.map((track, idx) => {
              const isSelected = track.id === selectedTrack?.id;
              const anySoloActive = project.tracks.some((t) => t.soloed);
              const isSoloMuted = anySoloActive && !track.soloed;
              const isGroup = Boolean(track.isGroupTrack);
              const isChild = Boolean(track.groupId);
              const isFolded = foldedGroupIds.has(track.id);
              const mixer = track.mixer || {
                volumeDb: 0,
                pan: 0,
                transposeSemitones: 0,
                fineTuneCents: 0,
                sidechainDepth: 0,
                reverbSend: 0.2,
                delaySend: 0.15,
                filterCutoffHz: 800,
                filterResonance: 0.25,
              };

              return (
                <div
                  key={track.id}
                  onClick={() => onSelectTrack(track.id)}
                  style={{ height: `${laneHeight}px` }}
                  className={`px-2.5 flex items-center justify-between gap-1.5 border-b border-[#1E2530] cursor-pointer transition-colors shrink-0 ${
                    isChild ? 'pl-5 border-l-2 border-[#283246]' : ''
                  } ${
                    track.soloed
                      ? isSelected
                        ? 'bg-[#2A2210] border-amber-500/40'
                        : 'bg-[#1C170B] border-amber-500/20'
                      : isSelected
                      ? 'bg-[#1B2230]'
                      : isSoloMuted
                      ? 'bg-[#0A0C10] opacity-70 hover:opacity-100'
                      : 'bg-[#10141C] hover:bg-[#151A24]'
                  }`}
                >
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    {isGroup && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleFoldGroup(track.id);
                        }}
                        className="w-4 h-4 rounded bg-[#1B2230] hover:bg-[#283246] border border-[#2E3B52] text-[#F59E0B] flex items-center justify-center text-[9px] font-bold shrink-0"
                        title={isFolded ? 'Unfold Group Track' : 'Fold Group Track'}
                      >
                        {isFolded ? '►' : '▼'}
                      </button>
                    )}
                    <div
                      className="w-1.5 h-7 rounded-sm shrink-0"
                      style={{ backgroundColor: track.soloed ? '#F59E0B' : track.muted ? '#475569' : track.hexColor }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className={`text-[11px] font-mono font-semibold truncate flex items-center gap-1 ${
                        track.soloed
                          ? 'text-amber-300'
                          : isSoloMuted
                          ? 'text-slate-500'
                          : isGroup
                          ? 'text-amber-200'
                          : 'text-slate-100'
                      }`}>
                        <span>{track.name}</span>
                        {isGroup && (
                          <span className="px-1 py-0.2 text-[8px] bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold rounded">
                            GRP {isFolded ? '(FOLD)' : ''}
                          </span>
                        )}
                        {track.soloed && (
                          <span className="px-1 py-0.2 text-[8px] bg-amber-400 text-slate-950 font-bold rounded">SOLO</span>
                        )}
                        {isSoloMuted && (
                          <span className="px-1 py-0.2 text-[8px] bg-slate-800 text-slate-500 rounded">MUTED</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1 text-[9.5px] font-mono text-slate-400 tabular-nums truncate">
                        <span className="text-amber-400">
                          {mixer.transposeSemitones > 0
                            ? `+${mixer.transposeSemitones}`
                            : mixer.transposeSemitones}
                          st
                        </span>
                        <span>·</span>
                        <span className="text-sky-400">
                          SC {Math.round(mixer.sidechainDepth * 100)}%
                        </span>
                        <span>·</span>
                        <span>
                          {mixer.volumeDb > 0
                            ? `+${mixer.volumeDb.toFixed(1)}`
                            : mixer.volumeDb.toFixed(1)}
                          dB
                        </span>
                      </div>
                    </div>
                  </div>

                  <div
                    className="flex items-center gap-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      onClick={() => onToggleMute(track.id)}
                      className={`w-5 h-5 text-[10px] font-mono font-bold rounded-xs border transition-colors ${
                        !track.muted
                          ? 'bg-amber-400 text-slate-950 border-amber-300'
                          : 'bg-[#0C0F14] text-slate-500 border-[#262E3D]'
                      }`}
                    >
                      {idx + 1}
                    </button>

                    <button
                      type="button"
                      onClick={() => onToggleSolo(track.id)}
                      className={`w-5 h-5 text-[10px] font-mono font-bold rounded-xs border transition-colors ${
                        track.soloed
                          ? 'bg-amber-400 text-slate-950 border-amber-300 shadow-[0_0_8px_rgba(245,158,11,0.5)]'
                          : isSoloMuted
                          ? 'bg-[#0A0D12] text-slate-600 border-[#1E2530] opacity-60'
                          : 'bg-[#0C0F14] text-slate-400 border-[#262E3D] hover:text-slate-200'
                      }`}
                      title={track.soloed ? 'Solo Active' : 'Solo Track'}
                    >
                      S
                    </button>

                    <input
                      type="range"
                      min={-18}
                      max={6}
                      step={0.5}
                      value={mixer.volumeDb}
                      onWheel={(e) => e.currentTarget.blur()}
                      onChange={(e) =>
                        onUpdateTrackMixer(track.id, { volumeDb: parseFloat(e.target.value) })
                      }
                      className="w-11 studio-slider"
                    />
                  </div>
                </div>
              );
            })}

            {/* Return A, Return B & Master Bus Headers matching Ableton Live bottom lanes */}
            {showReturnLanes && (
              <>
                <div
                  style={{ height: `${returnLaneHeight}px` }}
                  className="px-2.5 flex items-center justify-between bg-[#0E151E] border-b border-[#1E2736] text-[10px] font-mono shrink-0"
                >
                  <span className="text-emerald-400 font-semibold truncate">
                    A · Return Reverb
                  </span>
                  {onUpdateMasterBus && masterBus && (
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={masterBus.reverbReturnLevel}
                      onChange={(e) =>
                        onUpdateMasterBus({ reverbReturnLevel: parseFloat(e.target.value) })
                      }
                      className="w-14 studio-slider"
                    />
                  )}
                </div>

                <div
                  style={{ height: `${returnLaneHeight}px` }}
                  className="px-2.5 flex items-center justify-between bg-[#0E151E] border-b border-[#1E2736] text-[10px] font-mono shrink-0"
                >
                  <span className="text-purple-400 font-semibold truncate">
                    B · 3/16 Dub Echo
                  </span>
                  {onUpdateMasterBus && masterBus && (
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={masterBus.delayReturnLevel}
                      onChange={(e) =>
                        onUpdateMasterBus({ delayReturnLevel: parseFloat(e.target.value) })
                      }
                      className="w-14 studio-slider"
                    />
                  )}
                </div>

                <div
                  style={{ height: `${returnLaneHeight}px` }}
                  className="px-2.5 flex items-center justify-between bg-[#151B26] border-b border-[#263144] text-[10px] font-mono shrink-0"
                >
                  <span className="text-amber-400 font-semibold truncate">
                    MASTER · Glue + Limiter
                  </span>
                  <span className="text-slate-300 tabular-nums">
                    {masterBus?.masterVolumeDb ?? 0} dB
                  </span>
                </div>
              </>
            )}
          </div>

          {/* Right Arrangement Canvas (Single Pointer Pipeline — No Double-Firing) */}
          <div className="relative flex-1 overflow-hidden" style={{ height: `${totalArrangementHeight}px` }}>
            <canvas
              ref={arrangementCanvasRef}
              onPointerDown={handleArrangementPointerDown}
              onPointerMove={handleArrangementPointerMove}
              aria-label="Arrangement clips" data-testid="arrangement-clips-canvas"
              onPointerUp={handleArrangementPointerUp}
              onPointerCancel={e=>finishArrangementPointer(e,true)}
              className="w-full h-full block cursor-pointer touch-none"
            />
            {clipPreview&&<div data-testid="clip-drag-preview" className="absolute border-2 border-amber-300 bg-amber-400/20 pointer-events-none" style={{left:(clipPreview.start-arrStartBeat)/arrVisibleBeats*arrangementWidthPx,width:Math.max(2,clipPreview.length/arrVisibleBeats*arrangementWidthPx),top:headerHeight+visibleTracks.findIndex(t=>t.id===clipPreview.trackId)*laneHeight+3,height:laneHeight-6}}/>}
            {arrangementPlayheadTransform.isVisible && (
              <div
                data-testid="arrangement-smooth-playhead"
                data-snap-immediate={snapPlayheadImmediately ? 'true' : 'false'}
                style={{
                  left: 0,
                  transform: `translate3d(${arrangementPlayheadTransform.translateX.toFixed(2)}px, 0, 0)`,
                  transition: snapPlayheadImmediately ? 'none' : 'transform 45ms linear',
                }}
                className="absolute inset-y-0 w-[2px] bg-amber-400/90 shadow-[0_0_8px_rgba(245,158,11,0.85)] transition-[left,transform] duration-75 ease-linear will-change-[left,transform] pointer-events-none z-10"
              />
            )}
          </div>
        </div>
      </div>

      {/* Synchronized Selected-Track Waveform & 16th-Note MIDI Density Strip */}
      {selectedTrack && (
        <SelectedTrackAnalysisStrip
          project={project}
          selectedTrack={selectedTrack}
          humanization={humanization}
          masterBus={
            masterBus || {
              masterVolumeDb: 0,
              glueCompressionDrive: 0.35,
              reverbDecaySec: 3.2,
              reverbReturnLevel: 0.45,
              delayFeedback: 0.42,
              delayReturnLevel: 0.4,
              subBassMonoCutoffHz: 120,
            }
          }
          arrStartBeat={arrStartBeat}
          arrVisibleBeats={arrVisibleBeats}
          totalBars={totalBars}
          playheadBeat={playheadBeat}
          headerWidthPx={showTrackHeadersMobile ? 250 : 154}
          onSeekPlayhead={(beat) => {
            onSeekBeat(beat);
            setPianoScrollBar(beatToBarBeatTick(beat,project.meterMap,project.ppq).bar-1);
          }}
          onOpenCompingAndTransientModal={onOpenCompingAndTransientModal}
        />
      )}

      {/* Piano Roll & Anti-Slop Micro-Timing Subheader with 1/4, 1/8, 1/16, 1/32 Grid Selector */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-1.5 bg-[#12161E] border-b border-[#232934] text-xs">
        <div className="flex flex-wrap items-center gap-3 font-mono tabular-nums">
          <span className="font-semibold text-slate-100 flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-amber-400" />
            CLIP DETAIL &amp; MICRO-TIMING: {selectedTrack?.name}
          </span>
          <span className="hidden md:inline text-sky-400">
            Cyan = Ghost ({humanization.ghostVelocityMin}–{humanization.ghostVelocityMax})
          </span>
          <span className="hidden xl:inline text-amber-400">
            Click empty grid to draw · drag notes/edges · Alt-click to delete
          </span>
          <span
            data-testid="playhead-midi-grid-sync"
            className="px-2 py-0.5 rounded bg-amber-500/15 border border-amber-500/35 text-amber-300 text-[10px] font-semibold"
            title="Live synthEngine beat mapped to pixel-based MIDI grid coordinates"
          >
            SYNC {midiGridSync.syncedBeat.toFixed(2)}B → {Math.round(midiGridSync.playheadPixelX)}px (Step {midiGridSync.activeStepIndex + 1}/{midiGridSync.totalGridSteps})
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 font-mono">
          {onOpenHumanizationHeatmap && (
            <button
              type="button"
              onClick={onOpenHumanizationHeatmap}
              className="px-2 py-0.5 text-[10px] rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-semibold flex items-center gap-1 transition-colors"
              title="Open Visual MIDI Humanization Heatmap to adjust per-bar micro-timing variance"
            >
              <Flame className="w-3 h-3" />
              <span>Humanization Heatmap</span>
            </button>
          )}

          {onExportClipToMidi && selectedTrack && selectedTrack.clips[0] && (
            <div className="flex items-center gap-1.5 bg-[#0B0D11] border border-emerald-500/35 rounded px-1.5 py-0.5">
              <label
                className="flex items-center gap-1 text-[10px] text-slate-300 cursor-pointer select-none"
                title="Toggle between exporting micro-timed humanized MIDI output (ON) or quantized grid MIDI (OFF)"
              >
                <input
                  type="checkbox"
                  data-testid="export-midi-include-humanization-toggle"
                  aria-label="Include Humanization"
                  checked={effectiveIncludeHumanization}
                  onChange={(e) => handleToggleIncludeHumanization(e.target.checked)}
                  className="w-3 h-3 rounded border-emerald-500/50 bg-zinc-900 text-emerald-500 focus:ring-0 cursor-pointer"
                />
                <span>Include Humanization</span>
              </label>
              <button
                type="button"
                data-testid="export-clip-to-midi-btn"
                onClick={() =>
                  onExportClipToMidi(
                    selectedTrack.id,
                    activeClipId??selectedTrack.clips[0].id,
                    effectiveIncludeHumanization
                  )
                }
                className="px-2 py-0.5 text-[10px] rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-semibold flex items-center gap-1 transition-colors"
                title={`Export active MIDI clip as ${
                  effectiveIncludeHumanization ? 'micro-timed humanized' : 'quantized grid'
                } .mid file`}
              >
                <Download className="w-3 h-3" />
                <span>
                  Export Clip (.MID · {effectiveIncludeHumanization ? 'Humanized' : 'Quantized'})
                </span>
              </button>
            </div>
          )}

          {/* Note Grid Division Selector (1/4, 1/8, 1/16, 1/32) */}
          <div className="flex items-center bg-[#0B0D11] border border-[#252D3D] rounded p-0.5 text-[10px]">
            <span className="px-1.5 text-slate-400">GRID:</span>
            {(['1/4', '1/8', '1/16', '1/32'] as const).map((div) => (
              <button
                key={div}
                type="button"
                onClick={() => setPianoGridDivision(div)}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  pianoGridDivision === div
                    ? 'bg-sky-500/25 text-sky-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {div}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onUpdateTransport({ followPlayhead: !transport.followPlayhead })}
            className={`px-2 py-0.5 text-[10px] rounded border transition-colors ${
              transport.followPlayhead
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/50'
                : 'bg-[#1A202C] text-slate-400 border-[#283142]'
            }`}
          >
            Follow: {transport.followPlayhead ? 'ON' : 'OFF'}
          </button>

          {!transport.followPlayhead && (
            <div className="flex items-center gap-1 bg-[#0B0D11] border border-[#252D3D] rounded px-1.5 py-0.5 text-[10px]">
              <button
                type="button"
                onClick={() => setPianoScrollBar((b) => Math.max(0, b - zoomBars))}
                className="text-slate-400 hover:text-white px-1"
                title="Previous bars in Piano Roll"
              >
                &lt;
              </button>
              <span className="text-amber-300">
                Bar {pianoScrollBar + 1}–{Math.min(totalBars, pianoScrollBar + zoomBars)}
              </span>
              <button
                type="button"
                onClick={() =>
                  setPianoScrollBar((b) => Math.min(Math.max(0, totalBars - zoomBars), b + zoomBars))
                }
                className="text-slate-400 hover:text-white px-1"
                title="Next bars in Piano Roll"
              >
                &gt;
              </button>
            </div>
          )}

          <div className="flex items-center bg-[#0B0D11] border border-[#252D3D] rounded p-0.5 text-[10px]">
            {([1, 2, 4] as const).map((bars) => (
              <button
                key={bars}
                type="button"
                onClick={() => setZoomBars(bars)}
                className={`px-2 py-0.5 rounded transition-colors whitespace-nowrap shrink-0 ${
                  zoomBars === bars
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-300 hover:bg-[#252D3D]'
                }`}
              >
                {bars}B
              </button>
            ))}
          </div>
        </div>
      </div>

      <ArrangementEditInspector onAddNote={onAddNote} revealToken={editorRevealToken} track={selectedTrack} clipId={activeClipId} noteId={activeNoteId} playheadBeat={playheadBeat} onSelect={selectEditorTarget} onEditClip={onEditArrangementClip} onEditNote={onEditArrangementNote}/>
      <div className="flex shrink-0 items-center gap-2 px-3 text-xs text-slate-300">
        <button type="button" className="min-h-11 px-2 border border-slate-700 rounded" onClick={()=>pianoRollCanvasRef.current?.parentElement?.scrollBy({top:-144,behavior:'auto'})}>Higher keys</button>
        <button type="button" className="min-h-11 px-2 border border-slate-700 rounded" onClick={()=>pianoRollCanvasRef.current?.parentElement?.scrollBy({top:144,behavior:'auto'})}>Lower keys</button>
        <span>Drags commit on release. Escape cancels a drag. Click empty grid to draw.</span>
      </div>
      {/* Lower Piano Roll + Velocity Stalks Canvas (Single Pointer Pipeline — No Double-Firing) */}
      <div className="relative flex-1 min-h-[175px] w-full overflow-auto">
        <canvas
          ref={pianoRollCanvasRef}
          aria-label="MIDI piano roll" data-testid="midi-piano-roll"
          style={{height:Math.max(175,(selectedTrack?pianoPitchRows(selectedTrack).length:7)*18+54)}}
          onPointerDown={handlePianoRollPointerDown}
          onPointerMove={handlePianoRollPointerMove}
          onPointerUp={e=>finishPianoPointer(e)}
          onPointerCancel={e=>finishPianoPointer(e,true)}
          className="w-full block cursor-crosshair touch-none"
        />
        {midiGridSync.isInsideWindow && (
          <div
            data-testid="pianoroll-smooth-playhead"
            data-snap-immediate={snapPlayheadImmediately ? 'true' : 'false'}
            style={{
              left: 0,
              transform: `translate3d(${midiGridSync.playheadPixelX.toFixed(2)}px, 0, 0)`,
              transition: snapPlayheadImmediately ? 'none' : 'transform 45ms linear',
            }}
            className="absolute inset-y-0 w-[2px] bg-amber-400/90 shadow-[0_0_8px_rgba(245,158,11,0.85)] transition-[left,transform] duration-75 ease-linear will-change-[left,transform] pointer-events-none z-10"
          />
        )}
      </div>
    </div>
  );
};
