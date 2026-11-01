import React, { useEffect, useRef, useState } from 'react';
import {
  AbletonProjectState,
  AbletonTrack,
  AutomationPoint,
  HumanizationConfig,
  MasterBusConfig,
  MidiNoteEvent,
  NoteGridDivision,
  SpectrumOverlayMode,
  TimelineEditMode,
  TrackMixerParams,
  TransportConfig,
} from '../types/ableton';
import { gridDivisionToStepBeats, midiNoteToName } from '../engine/alsXmlEngine';
import { evaluateAutomationAtBeat, synthEngine } from '../engine/webAudioSynth';
import { spotPositionToBeat } from '../services/commandBus';
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

interface TimelineCanvasProps {
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
  onChangeArrangementLength?: (bars: 16 | 32 | 64 | 128) => void;
  onUpdateMasterBus?: (partial: Partial<MasterBusConfig>) => void;
  onSeekBeat: (beat: number) => void;
  onToggleNoteInTrack: (trackId: string, stepBeat: number, pitch: number, stepDuration?: number) => void;
  onToggleMute: (trackId: string) => void;
  onToggleSolo: (trackId: string) => void;
  onUpdateTrackMixer: (trackId: string, partial: Partial<TrackMixerParams>) => void;
  onUpdateTrackAutomation: (trackId: string, points: AutomationPoint[]) => void;
  editMode?: TimelineEditMode;
  onChangeEditMode?: (mode: TimelineEditMode) => void;
  onDropMemoryLocationAtPlayhead?: () => void;
  onOpenCompingAndTransientModal?: () => void;
  onOpenHumanizationHeatmap?: () => void;
  onExportClipToMidi?: (trackId: string, clipId: string) => void;
  onApplyNoteEditModeOperation?: (
    trackId: string,
    noteId: string,
    targetBeat: number,
    editMode: TimelineEditMode,
    gridStepBeats: number
  ) => void;
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
  onToggleMute,
  onToggleSolo,
  onUpdateTrackMixer,
  onUpdateTrackAutomation,
  editMode = 'grid',
  onChangeEditMode,
  onDropMemoryLocationAtPlayhead,
  onOpenCompingAndTransientModal,
  onOpenHumanizationHeatmap,
  onExportClipToMidi,
  onApplyNoteEditModeOperation,
}) => {
  const arrangementCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pianoRollCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const reusableFftRef = useRef<Uint8Array>(new Uint8Array(256));
  const [zoomBars, setZoomBars] = useState<1 | 2 | 4>(2);
  const [pianoScrollBar, setPianoScrollBar] = useState<number>(0);
  const [pianoGridDivision, setPianoGridDivision] = useState<NoteGridDivision>('1/16');
  const [arrangementZoom, setArrangementZoom] = useState<1 | 2 | 4 | 8>(1);
  const [arrangementScrollBar, setArrangementScrollBar] = useState<number>(0);
  const [showReturnLanes, setShowReturnLanes] = useState<boolean>(false);
  const [showTrackHeadersMobile, setShowTrackHeadersMobile] = useState<boolean>(true);
  const [isDraggingArrangement, setIsDraggingArrangement] = useState<boolean>(false);
  const [spotBar, setSpotBar] = useState<number>(1);
  const [spotBeat, setSpotBeat] = useState<number>(1);
  const [spotSixteenth, setSpotSixteenth] = useState<number>(1);

  const selectedTrack: AbletonTrack | undefined =
    project.tracks.find((t) => t.id === selectedTrackId) || project.tracks[0];

  const rawBars = project.arrangementLengthBars || transport.arrangementLengthBars || 16;
  const totalBars: 16 | 32 | 64 | 128 =
    rawBars === 32 || rawBars === 64 || rawBars === 128 ? rawBars : 16;
  const totalBeats = totalBars * 4;

  // Compute visible bar window in the Arrangement View based on real-time zoom & scroll
  const visibleArrBars = Math.max(4, Math.floor(totalBars / arrangementZoom));
  const maxScrollBar = Math.max(0, totalBars - visibleArrBars);
  const effectiveScrollBar = transport.followPlayhead && arrangementZoom > 1
    ? Math.min(
        maxScrollBar,
        Math.floor(Math.floor(playheadBeat / 4) / visibleArrBars) * visibleArrBars
      )
    : Math.min(maxScrollBar, arrangementScrollBar);
  const arrStartBeat = effectiveScrollBar * 4;
  const arrVisibleBeats = visibleArrBars * 4;
  const arrEndBeat = arrStartBeat + arrVisibleBeats;

  const headerHeight = 32;
  const laneHeight = 72;
  const returnLaneHeight = 48;
  const busRowCount = showReturnLanes ? 3 : 0; // Return A (Reverb), Return B (3/16 Delay), Master Bus
  const totalArrangementHeight =
    headerHeight +
    Math.max(4, project.tracks.length) * laneHeight +
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

    const width = rect.width;
    const height = rect.height;

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
    const loopStartBeat = Math.max(0, (transport.loopStartBar - 1) * 4);
    const loopSpanBeats = transport.loopLengthBars * 4;
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
      const x = (bOffset / visibleArrBars) * width;
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
    project.tracks.forEach((track, idx) => {
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

      // Render Track Clips (dimmed with 0.35 opacity when solo-muted)
      track.clips.forEach((clip) => {
        const clipStart = Math.max(arrStartBeat, clip.startTime);
        const clipEnd = Math.min(arrEndBeat, clip.startTime + Math.max(clip.length, totalBeats));
        if (clipEnd <= clipStart) return;

        const clipX = ((clipStart - arrStartBeat) / arrVisibleBeats) * width;
        const clipW = ((clipEnd - clipStart) / arrVisibleBeats) * width;

        ctx.save();
        if (isSoloMuted) {
          ctx.globalAlpha = 0.38;
        }

        ctx.fillStyle = track.muted
          ? 'rgba(100, 116, 139, 0.12)'
          : track.soloed
          ? `${track.hexColor}35`
          : `${track.hexColor}20`;
        ctx.strokeStyle = track.muted
          ? '#475569'
          : track.soloed
          ? '#F59E0B'
          : track.hexColor;
        ctx.lineWidth = isSelected ? 1.5 : 1;
        ctx.fillRect(clipX + 1, y + 3, clipW - 2, laneHeight - 6);
        ctx.strokeRect(clipX + 1, y + 3, clipW - 2, laneHeight - 6);

        // Draw True Polymeter Loop Boundary Markers inside clip if clip.loopEndBeats is non-standard
        if (clip.loopEndBeats && clip.loopEndBeats > 0 && clip.loopEndBeats !== 16 && clip.loopEndBeats !== 64) {
          ctx.save();
          ctx.strokeStyle = 'rgba(251, 191, 36, 0.45)';
          ctx.setLineDash([2, 2]);
          for (
            let loopB = clip.loopEndBeats;
            loopB < totalBeats;
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
        ctx.fillRect(clipX + 1, y + 3, clipW - 2, 12);

        ctx.fillStyle = track.soloed ? '#0A0D12' : '#F8FAFC';
        ctx.font = '500 9.5px "JetBrains Mono", monospace';
        const scBadge =
          track.mixer?.sidechainDepth > 0.05
            ? ` · SC ${Math.round(track.mixer.sidechainDepth * 100)}%`
            : '';
        const duckBadge = track.spectralDucking?.enabled ? ' · EQ8-DUCK' : '';
        const polyBadge =
          clip.loopEndBeats && clip.isPolymeter ? ` · POLY ${clip.loopEndBeats}b` : '';
        const soloBadge = track.soloed ? ' · [SOLO]' : isSoloMuted ? ' · [MUTED]' : '';
        const label = `${clip.name} (${clip.notes.length}n${scBadge}${duckBadge}${polyBadge}${soloBadge})`;
        ctx.fillText(label, clipX + 5, y + 12);

        // Mini MIDI note ticks inside visible arrangement window
        ctx.fillStyle = track.muted ? '#64748B' : track.soloed ? '#FCD34D' : track.hexColor;
        clip.notes.forEach((note) => {
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

    // Draw Live Playhead if inside visible window
    if (playheadBeat >= arrStartBeat && playheadBeat <= arrEndBeat) {
      const playheadX = ((playheadBeat - arrStartBeat) / arrVisibleBeats) * width;
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(playheadX, 0);
      ctx.lineTo(playheadX, height);
      ctx.stroke();

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
  ]);

  // Draw Lower Microscopic Ghost-Note Piano Roll & Velocity Lane
  useEffect(() => {
    const canvas = pianoRollCanvasRef.current;
    if (!canvas || !selectedTrack) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    const keyColWidth = 58;
    const velLaneHeight = 54;
    const rollHeight = height - velLaneHeight;
    const visibleBeats = zoomBars * 4;
    const maxPianoStartBar = Math.max(0, totalBars - zoomBars);
    const effectivePianoBar = transport.followPlayhead
      ? Math.min(maxPianoStartBar, Math.floor(playheadBeat / visibleBeats) * zoomBars)
      : Math.min(maxPianoStartBar, pianoScrollBar);

    const windowStartBeat = effectivePianoBar * 4;
    const windowEndBeat = windowStartBeat + visibleBeats;

    ctx.fillStyle = '#0B0D11';
    ctx.fillRect(0, 0, width, height);

    const clip = selectedTrack.clips[0];
    const visibleNotes = clip
      ? clip.notes.filter((n) => n.time >= windowStartBeat - 0.1 && n.time < windowEndBeat + 0.1)
      : [];

    const allTrackPitches = clip ? clip.notes.map((n) => n.pitch) : [36];
    const uniquePitches = Array.from(new Set(allTrackPitches)).sort((a, b) => b - a);
    const centerPitch = uniquePitches[0] || 36;
    const pitchRows: number[] = [];
    for (let p = centerPitch + 3; p >= centerPitch - 3; p--) {
      pitchRows.push(p);
    }

    const rowHeight = rollHeight / pitchRows.length;
    const gridWidth = width - keyColWidth;
    const stepBeats = gridDivisionToStepBeats(pianoGridDivision);
    const totalGridSteps = Math.round(visibleBeats / stepBeats);

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
      const isBar = Math.abs(beatOffset % 4) < 0.001;
      const isBeat = Math.abs(beatOffset % 1) < 0.001;

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
        const absBeat = windowStartBeat + beatOffset;
        const barNum = Math.floor(absBeat / 4) + 1;
        const beatInBar = Math.floor(absBeat % 4) + 1;
        ctx.fillStyle = isBar ? '#CBD5E1' : '#64748B';
        ctx.font = '500 9px "JetBrains Mono", monospace';
        ctx.fillText(`${barNum}.${beatInBar}`, x + 3, 10);

        if (isBar) {
          const barIntensity = humanization.barVarianceIntensity?.[barNum] ?? 1.0;
          const barWidthPx = (4 / visibleBeats) * gridWidth;
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
    visibleNotes.forEach((note: MidiNoteEvent) => {
      const rowIdx = pitchRows.indexOf(note.pitch);
      const effectiveRow = rowIdx >= 0 ? rowIdx : Math.floor(pitchRows.length / 2);
      const y = effectiveRow * rowHeight + 3;
      const h = Math.max(10, rowHeight - 6);

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

      ctx.fillStyle = note.isGhost ? 'rgba(56, 189, 248, 0.42)' : selectedTrack.hexColor;
      ctx.strokeStyle = note.isSlide
        ? '#FACC15'
        : note.isGhost
        ? '#38BDF8'
        : '#F8FAFC';
      ctx.lineWidth = note.isSlide ? 1.8 : 1;
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
      ctx.fillStyle = note.isGhost ? '#38BDF8' : selectedTrack.hexColor;
      ctx.fillRect(actualX, stalkY, Math.max(4, Math.min(10, noteW * 0.45)), stalkHeight);
    });

    // 5. Draw Live Playhead inside Piano Roll
    const relPlayhead = Math.max(0, Math.min(visibleBeats, playheadBeat - windowStartBeat));
    const playheadX = keyColWidth + (relPlayhead / visibleBeats) * gridWidth;
    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(playheadX, 0);
    ctx.lineTo(playheadX, height);
    ctx.stroke();
  }, [
    selectedTrack,
    zoomBars,
    pianoScrollBar,
    totalBars,
    pianoGridDivision,
    playheadBeat,
    humanization,
    transport.followPlayhead,
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
      const targetBar = Math.floor(rawBeat / 4);
      setPianoScrollBar(targetBar);
      if (e.shiftKey) {
        onUpdateTransport({ loopStartBar: targetBar + 1 });
      }
      return;
    }

    const clickedIdx = Math.floor((y - headerHeight) / laneHeight);
    if (clickedIdx >= 0 && clickedIdx < project.tracks.length) {
      const targetTrack = project.tracks[clickedIdx];
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
        setPianoScrollBar(Math.floor(rawBeat / 4));
        if (isInitialDown) {
          synthEngine.triggerLivePad(targetTrack.archetype, 95);
        }
      }
    } else {
      // Clicked inside Return / Master Lanes at bottom: Seek Playhead
      onSeekBeat(rawBeat);
      setPianoScrollBar(Math.floor(rawBeat / 4));
    }
  };

  const handleArrangementPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    setIsDraggingArrangement(true);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore pointer capture errors on synthetic events
    }
    processArrangementPointer(e, true);
  };

  const handleArrangementPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingArrangement) return;
    processArrangementPointer(e, false);
  };

  const handleArrangementPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDraggingArrangement) return;
    setIsDraggingArrangement(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Ignore pointer release errors
    }
  };

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

  const handlePianoRollPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = pianoRollCanvasRef.current;
    if (!canvas || !selectedTrack) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const keyColWidth = 58;
    const velLaneHeight = 54;
    const rollHeight = rect.height - velLaneHeight;

    const visibleBeats = zoomBars * 4;
    const maxPianoStartBar = Math.max(0, totalBars - zoomBars);
    const effectivePianoBar = transport.followPlayhead
      ? Math.min(maxPianoStartBar, Math.floor(playheadBeat / visibleBeats) * zoomBars)
      : Math.min(maxPianoStartBar, pianoScrollBar);
    const windowStartBeat = effectivePianoBar * 4;

    if (y >= rollHeight) {
      // Clicked in the Velocity Lane at bottom: seek playhead to that beat
      if (x > keyColWidth) {
        const relBeat = ((x - keyColWidth) / Math.max(1, rect.width - keyColWidth)) * visibleBeats;
        onSeekBeat(windowStartBeat + relBeat);
      }
      return;
    }

    const clip = selectedTrack.clips[0];
    const allPitches = clip ? clip.notes.map((n) => n.pitch) : [36];
    const uniquePitches = Array.from(new Set(allPitches)).sort((a, b) => b - a);
    const centerPitch = uniquePitches[0] || 36;
    const pitchRows: number[] = [];
    for (let p = centerPitch + 3; p >= centerPitch - 3; p--) {
      pitchRows.push(p);
    }

    const rowIdx = Math.floor((y / rollHeight) * pitchRows.length);
    const pitch = pitchRows[Math.max(0, Math.min(pitchRows.length - 1, rowIdx))];

    if (x <= keyColWidth) {
      synthEngine.triggerLivePad(selectedTrack.archetype, 110, pitch);
      return;
    }

    const stepBeats = gridDivisionToStepBeats(pianoGridDivision);
    const relBeat = ((x - keyColWidth) / Math.max(1, rect.width - keyColWidth)) * visibleBeats;
    const rawTargetBeat =
      editMode === 'spot'
        ? spotPositionToBeat(spotBar, spotBeat, spotSixteenth)
        : editMode === 'slip'
        ? Number((windowStartBeat + relBeat).toFixed(3))
        : Number((windowStartBeat + Math.floor(relBeat / stepBeats) * stepBeats).toFixed(3));

    // In Shuffle or Spot mode, if clicking near an existing note on another beat, move/ripple it
    if (
      (editMode === 'shuffle' || editMode === 'spot') &&
      onApplyNoteEditModeOperation &&
      clip &&
      clip.notes.length > 0 &&
      e.shiftKey
    ) {
      const targetNote = clip.notes[0];
      onApplyNoteEditModeOperation(
        selectedTrack.id,
        targetNote.id,
        rawTargetBeat,
        editMode,
        stepBeats
      );
      return;
    }

    synthEngine.triggerLivePad(selectedTrack.archetype, 100, pitch);
    onToggleNoteInTrack(selectedTrack.id, rawTargetBeat, pitch, stepBeats);
  };

  const currentBarNumber = Math.floor(playheadBeat / 4) + 1;
  const currentBeatInBar = Math.floor(playheadBeat % 4) + 1;
  const currentSixteenth = Math.floor((playheadBeat % 1) * 4) + 1;
  const liveAutoVal = Math.round(
    evaluateAutomationAtBeat(selectedTrack?.automationPoints, playheadBeat, totalBeats) * 100
  );

  return (
    <div className="flex flex-col h-full bg-[#0D1015] select-none">
      {/* Ableton Arrangement View Header Bar with Duration, Real-Time Zoom, Loop & Automation */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 sm:px-4 py-1.5 bg-[#12161E] border-b border-[#232934] text-xs">
        <div className="flex flex-wrap items-center gap-2.5 text-slate-300 font-mono tabular-nums">
          <span className="font-semibold text-slate-100">
            ARRANGEMENT ({totalBars} BARS · {totalBeats} BEATS)
          </span>
          <span className="px-2 py-0.5 bg-[#0A0C10] border border-[#252D3D] rounded text-amber-400 font-semibold">
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

          {/* Configurable Track Arrangement Duration (16, 32, 64, 128 Bars) */}
          {onChangeArrangementLength && (
            <div className="flex items-center bg-[#0B0D11] border border-[#252D3D] rounded p-0.5 text-[10px]">
              <span className="px-1.5 text-slate-400">LENGTH:</span>
              {([16, 32, 64, 128] as const).map((bars) => (
                <button
                  key={bars}
                  type="button"
                  onClick={() => onChangeArrangementLength(bars)}
                  className={`px-1.5 py-0.5 rounded transition-colors ${
                    totalBars === bars
                      ? 'bg-amber-500 text-slate-950 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                  title={`Scale arrangement duration to ${bars} bars (${bars * 4} beats)`}
                >
                  {bars}B
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right Toolbar: Real-Time Zoom, Return Lanes, Loop & Automation */}
        <div className="flex flex-wrap items-center gap-1.5 font-mono">
          {/* Real-Time Arrangement Zoom In / Out (1x, 2x, 4x, 8x) */}
          <div className="flex items-center bg-[#0B0D11] border border-[#252D3D] rounded p-0.5 text-[10px]">
            <ZoomIn className="w-3 h-3 text-amber-400 mx-1" />
            {([1, 2, 4, 8] as const).map((z) => (
              <button
                key={z}
                type="button"
                onClick={() => {
                  setArrangementZoom(z);
                  if (z === 1) setArrangementScrollBar(0);
                }}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  arrangementZoom === z
                    ? 'bg-sky-500/25 text-sky-300 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title={`Zoom arrangement timeline ${z}x (${Math.max(4, Math.floor(totalBars / z))} visible bars)`}
              >
                {z}x
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
                step={2}
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
                onChange={(e) => setSpotBar(Math.max(1, Number(e.target.value)))}
                className="w-10 bg-zinc-950 border border-zinc-700 rounded px-1 text-center text-white"
                title="Target Bar (1-128)"
              />
              <span>.</span>
              <input
                type="number"
                min={1}
                max={4}
                value={spotBeat}
                onChange={(e) => setSpotBeat(Math.max(1, Math.min(4, Number(e.target.value))))}
                className="w-8 bg-zinc-950 border border-zinc-700 rounded px-1 text-center text-white"
                title="Target Beat (1-4)"
              />
              <span>.</span>
              <input
                type="number"
                min={1}
                max={4}
                value={spotSixteenth}
                onChange={(e) =>
                  setSpotSixteenth(Math.max(1, Math.min(4, Number(e.target.value))))
                }
                className="w-8 bg-zinc-950 border border-zinc-700 rounded px-1 text-center text-white"
                title="Target 16th (1-4)"
              />
              <button
                type="button"
                onClick={() => onSeekBeat(spotPositionToBeat(spotBar, spotBeat, spotSixteenth))}
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
                setPianoScrollBar(Math.floor(loc.beat / 4));
              }}
              className="px-1.5 py-0.5 rounded bg-[#141A24] hover:bg-[#1E2736] border border-[#2A3548] text-slate-200 flex items-center gap-1"
              title={`Jump to Memory Location [${loc.number}] ${loc.name} (Bar ${
                Math.floor(loc.beat / 4) + 1
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

      {/* Upper Arrangement Split: Left Ableton Track + Return Headers + Right Arrangement Canvas */}
      <div
        className="flex w-full border-b border-[#232934] overflow-y-auto"
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

            {project.tracks.map((track, idx) => {
              const isSelected = track.id === selectedTrack?.id;
              const anySoloActive = project.tracks.some((t) => t.soloed);
              const isSoloMuted = anySoloActive && !track.soloed;
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
                  <div className="flex items-center gap-2 min-w-0 flex-1">
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
                          : 'text-slate-100'
                      }`}>
                        <span>{track.name}</span>
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
          <div className="relative flex-1" style={{ height: `${totalArrangementHeight}px` }}>
            <canvas
              ref={arrangementCanvasRef}
              onPointerDown={handleArrangementPointerDown}
              onPointerMove={handleArrangementPointerMove}
              onPointerUp={handleArrangementPointerUp}
              onPointerCancel={handleArrangementPointerUp}
              className="w-full h-full block cursor-pointer touch-none"
            />
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
            setPianoScrollBar(Math.floor(beat / 4));
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
            Click grid to add/remove MIDI notes
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
            <button
              type="button"
              onClick={() => onExportClipToMidi(selectedTrack.id, selectedTrack.clips[0].id)}
              className="px-2 py-0.5 text-[10px] rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-semibold flex items-center gap-1 transition-colors"
              title="Export active MIDI clip as .mid file to Project Queue & Browser Download"
            >
              <Download className="w-3 h-3" />
              <span>Export Clip (.MID)</span>
            </button>
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

      {/* Lower Piano Roll + Velocity Stalks Canvas (Single Pointer Pipeline — No Double-Firing) */}
      <div className="relative flex-1 min-h-[175px] w-full">
        <canvas
          ref={pianoRollCanvasRef}
          onPointerDown={handlePianoRollPointerDown}
          className="w-full h-full block cursor-crosshair touch-none"
        />
      </div>
    </div>
  );
};
