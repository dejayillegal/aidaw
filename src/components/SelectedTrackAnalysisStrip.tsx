import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Layers, Scissors, Sparkles, Volume2 } from 'lucide-react';
import {
  AbletonProjectState,
  AbletonTrack,
  AudioStripSilenceConfig,
  HumanizationConfig,
  MasterBusConfig,
} from '../types/ableton';
import {
  computeSelectedTrackAnalysisData,
  detectAudioStripSilenceRegions,
} from '../engine/webAudioSynth';

interface SelectedTrackAnalysisStripProps {
  project: AbletonProjectState;
  selectedTrack: AbletonTrack;
  humanization: HumanizationConfig;
  masterBus: MasterBusConfig;
  arrStartBeat: number;
  arrVisibleBeats: number;
  totalBars: number;
  playheadBeat: number;
  headerWidthPx?: number;
  onSeekPlayhead?: (beat: number) => void;
  onOpenCompingAndTransientModal?: () => void;
}

export const SelectedTrackAnalysisStrip: React.FC<SelectedTrackAnalysisStripProps> = ({
  project,
  selectedTrack,
  humanization,
  masterBus,
  arrStartBeat,
  arrVisibleBeats,
  totalBars,
  playheadBeat,
  headerWidthPx = 154,
  onSeekPlayhead,
  onOpenCompingAndTransientModal,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [displayMode, setDisplayMode] = useState<'dual' | 'waveform' | 'heatmap'>('dual');
  const [showSilenceOverlay, setShowSilenceOverlay] = useState<boolean>(false);
  const [silenceThresholdDb, setSilenceThresholdDb] = useState<number>(-32);

  // Memoize cached track analysis data keyed by projectRevision, trackId, clip notes, and DSP config
  const analysisData = useMemo(() => {
    return computeSelectedTrackAnalysisData(
      project,
      selectedTrack,
      humanization,
      masterBus,
      totalBars,
      320
    );
  }, [project, selectedTrack, humanization, masterBus, totalBars]);

  const stripSilenceConfig: AudioStripSilenceConfig = useMemo(
    () => ({
      thresholdOpenDb: silenceThresholdDb,
      thresholdCloseDb: silenceThresholdDb - 4,
      minActiveDurationMs: 65,
      preAttackPadMs: 12,
      postReleasePadMs: 35,
    }),
    [silenceThresholdDb]
  );

  const activeSilenceRegions = useMemo(() => {
    if (!showSilenceOverlay) return [];
    return detectAudioStripSilenceRegions(analysisData, project.tempo, stripSilenceConfig);
  }, [showSilenceOverlay, analysisData, project.tempo, stripSilenceConfig]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(320, rect.width);
    const height = Math.max(54, rect.height);

    if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
    }

    ctx.save();
    ctx.scale(dpr, dpr);

    const headerW = width < 520 ? 112 : headerWidthPx;
    const gridW = Math.max(100, width - headerW);
    const totalBeats = Math.max(16, totalBars * 4);
    const arrEndBeat = Math.min(totalBeats, arrStartBeat + arrVisibleBeats);

    const beatToX = (beat: number) =>
      headerW + ((beat - arrStartBeat) / Math.max(1, arrVisibleBeats)) * gridW;

    // Background
    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, width, height);

    // Header column
    ctx.fillStyle = '#111114';
    ctx.fillRect(0, 0, headerW, height);
    ctx.strokeStyle = '#27272a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(headerW, 0);
    ctx.lineTo(headerW, height);
    ctx.stroke();

    // Track color accent bar
    ctx.fillStyle = selectedTrack.color || '#f97316';
    ctx.fillRect(0, 0, 3.5, height);

    // Header labels
    ctx.fillStyle = '#f4f4f5';
    ctx.font = 'bold 9.5px "JetBrains Mono", monospace';
    ctx.fillText(selectedTrack.name.slice(0, 16), 9, 15);

    ctx.fillStyle = '#38bdf8';
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.fillText(
      displayMode === 'dual'
        ? 'WAVE + 16TH HEATMAP'
        : displayMode === 'waveform'
        ? 'OFFLINE PCM WAVE'
        : '16TH MIDI DENSITY',
      9,
      27
    );

    const activeTake = (selectedTrack.takes || []).find(
      (t) => t.id === selectedTrack.activeTakeId
    );
    ctx.fillStyle = '#a1a1aa';
    ctx.font = '8px "JetBrains Mono", monospace';
    ctx.fillText(
      activeTake ? activeTake.name.slice(0, 18) : `${selectedTrack.clips[0]?.notes.length || 0} notes`,
      9,
      39
    );

    // Clip to grid region
    ctx.save();
    ctx.beginPath();
    ctx.rect(headerW, 0, gridW, height);
    ctx.clip();

    // Bar vertical grid lines
    const barStep = arrVisibleBeats > 128 ? 4 : arrVisibleBeats > 64 ? 2 : 1;
    for (let bar = 0; bar <= totalBars; bar += barStep) {
      const beat = bar * 4;
      if (beat < arrStartBeat || beat > arrEndBeat) continue;
      const x = beatToX(beat);
      ctx.strokeStyle = bar % 4 === 0 ? '#27272a' : '#18181b';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }

    // ========================================================================
    // LAYER A: 16th-Note MIDI Activity Heatmap (Bottom ribbon or full strip)
    // ========================================================================
    if (displayMode === 'dual' || displayMode === 'heatmap') {
      const heatmapTop = displayMode === 'dual' ? height - 15 : 4;
      const heatmapH = displayMode === 'dual' ? 13 : height - 8;

      const startSixteenth = Math.max(0, Math.floor(arrStartBeat * 4));
      const endSixteenth = Math.min(
        analysisData.midiHeatmapBins.length - 1,
        Math.ceil(arrEndBeat * 4)
      );

      for (let s = startSixteenth; s <= endSixteenth; s++) {
        const bin = analysisData.midiHeatmapBins[s];
        if (!bin) continue;
        const x0 = beatToX(bin.beatStart);
        const x1 = beatToX(bin.beatStart + 0.25);
        const cellW = Math.max(1.5, x1 - x0 - 0.5);

        if (bin.combinedIntensity > 0.01) {
          const alpha = Math.min(0.95, 0.2 + bin.combinedIntensity * 0.78);
          if (bin.hasAccent) {
            ctx.fillStyle = `rgba(249, 115, 22, ${alpha})`; // Orange accent
          } else if (bin.hasSlide) {
            ctx.fillStyle = `rgba(168, 85, 247, ${alpha})`; // Purple slide
          } else {
            ctx.fillStyle = `rgba(56, 189, 248, ${alpha})`; // Sky cyan density
          }
          ctx.fillRect(x0, heatmapTop, cellW, heatmapH);

          // Velocity top cap inside heatmap cell
          const velBarH = Math.max(2, (bin.maxVelocity / 127) * heatmapH);
          ctx.fillStyle = bin.hasAccent ? '#fdba74' : '#e0f2fe';
          ctx.fillRect(x0, heatmapTop + (heatmapH - velBarH), Math.max(1, cellW * 0.7), 2);
        } else {
          ctx.fillStyle = 'rgba(39, 39, 42, 0.28)';
          ctx.fillRect(x0, heatmapTop + heatmapH - 2, cellW, 1.5);
        }
      }
    }

    // ========================================================================
    // LAYER B: Cached Audio Waveform / Synthesis Envelope (Upper waveform lane)
    // ========================================================================
    if (displayMode === 'dual' || displayMode === 'waveform') {
      const waveTop = 2;
      const waveH = displayMode === 'dual' ? height - 18 : height - 4;
      const centerY = waveTop + waveH / 2;
      const halfAmp = waveH * 0.45;

      // Center zero-crossing reference line
      ctx.strokeStyle = 'rgba(63, 63, 70, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(headerW, centerY);
      ctx.lineTo(width, centerY);
      ctx.stroke();

      const totalBins = analysisData.resolutionBins;
      const beatsPerBin = totalBeats / Math.max(1, totalBins);
      const firstBin = Math.max(0, Math.floor(arrStartBeat / beatsPerBin));
      const lastBin = Math.min(totalBins - 1, Math.ceil(arrEndBeat / beatsPerBin));

      for (let b = firstBin; b <= lastBin; b++) {
        const binBeatStart = b * beatsPerBin;
        const binBeatEnd = (b + 1) * beatsPerBin;
        const x0 = beatToX(binBeatStart);
        const x1 = beatToX(binBeatEnd);
        const barW = Math.max(1.5, x1 - x0 - 0.4);

        const peakMax = Math.min(1, Math.abs(analysisData.waveformPeaksMax[b]));
        const peakMin = Math.min(1, Math.abs(analysisData.waveformPeaksMin[b]));
        const rms = Math.min(1, analysisData.waveformRms[b]);

        const topY = centerY - Math.max(1, peakMax * halfAmp);
        const botY = centerY + Math.max(1, peakMin * halfAmp);

        // Outer peak bar
        ctx.fillStyle = `${selectedTrack.color || '#f97316'}66`;
        ctx.fillRect(x0, topY, barW, Math.max(1.5, botY - topY));

        // Inner RMS energy core
        const rmsHalf = Math.max(0.8, rms * halfAmp * 0.85);
        ctx.fillStyle = selectedTrack.color || '#f97316';
        ctx.fillRect(x0, centerY - rmsHalf, barW, rmsHalf * 2);
      }

      // Optional Audio Strip Silence region overlay
      if (showSilenceOverlay) {
        const threshLin = Math.pow(10, silenceThresholdDb / 20);
        const threshOffset = Math.min(halfAmp, threshLin * halfAmp * 2.2);

        ctx.strokeStyle = 'rgba(244, 63, 94, 0.75)';
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        ctx.moveTo(headerW, centerY - threshOffset);
        ctx.lineTo(width, centerY - threshOffset);
        ctx.stroke();
        ctx.setLineDash([]);

        for (const reg of activeSilenceRegions) {
          if (reg.endBeat < arrStartBeat || reg.startBeat > arrEndBeat) continue;
          const rx0 = Math.max(headerW, beatToX(reg.startBeat));
          const rx1 = Math.min(width, beatToX(reg.endBeat));
          ctx.fillStyle = 'rgba(16, 185, 129, 0.16)';
          ctx.fillRect(rx0, waveTop, Math.max(2, rx1 - rx0), waveH);
          ctx.strokeStyle = 'rgba(16, 185, 129, 0.8)';
          ctx.lineWidth = 1;
          ctx.strokeRect(rx0, waveTop, Math.max(2, rx1 - rx0), waveH);
        }
      }
    }

    // Playhead cursor synchronized with Arrangement Timeline
    if (playheadBeat >= arrStartBeat && playheadBeat <= arrEndBeat) {
      const px = beatToX(playheadBeat);
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }

    ctx.restore();
    ctx.restore();
  }, [
    analysisData,
    selectedTrack,
    arrStartBeat,
    arrVisibleBeats,
    totalBars,
    playheadBeat,
    headerWidthPx,
    displayMode,
    showSilenceOverlay,
    silenceThresholdDb,
    activeSilenceRegions,
  ]);

  const handleCanvasPointerDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !onSeekPlayhead) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const headerW = rect.width < 520 ? 112 : headerWidthPx;
    if (x <= headerW) return;
    const gridW = Math.max(100, rect.width - headerW);
    const targetBeat = arrStartBeat + ((x - headerW) / gridW) * arrVisibleBeats;
    onSeekPlayhead(Math.max(0, Math.min(totalBars * 4 - 0.01, targetBeat)));
  };

  return (
    <div className="bg-zinc-950 border-b border-zinc-800 select-none">
      {/* Compact Strip Header Bar */}
      <div className="px-2.5 py-1 bg-zinc-900/90 border-b border-zinc-800/80 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono">
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 text-orange-400 font-semibold">
            <Activity className="w-3 h-3" />
            SELECTED TRACK WAVEFORM &amp; 16TH DENSITY STRIP
          </span>
          <span
            className="px-1.5 py-0.5 rounded bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-[9px]"
            title="Cached by (projectRevision, trackId, clipRevision, dspConfigHash)"
          >
            {analysisData.waveformModeLabel}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Layer Mode Selector */}
          <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded p-0.5">
            <button
              type="button"
              onClick={() => setDisplayMode('dual')}
              className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                displayMode === 'dual'
                  ? 'bg-orange-500/20 text-orange-300 border border-orange-500/40'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Layers className="w-2.5 h-2.5 inline mr-1" />
              Dual Overlay
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('waveform')}
              className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                displayMode === 'waveform'
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Volume2 className="w-2.5 h-2.5 inline mr-1" />
              Waveform
            </button>
            <button
              type="button"
              onClick={() => setDisplayMode('heatmap')}
              className={`px-1.5 py-0.5 rounded text-[9px] transition-colors ${
                displayMode === 'heatmap'
                  ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Sparkles className="w-2.5 h-2.5 inline mr-1" />
              16th Heatmap
            </button>
          </div>

          {/* Strip Silence Threshold Preview Toggle */}
          <button
            type="button"
            onClick={() => setShowSilenceOverlay((v) => !v)}
            className={`px-1.5 py-0.5 rounded border text-[9px] flex items-center gap-1 transition-colors ${
              showSilenceOverlay
                ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
            }`}
            title="Preview Audio Strip Silence active regions on waveform"
          >
            <Scissors className="w-2.5 h-2.5" />
            Gate Preview
          </button>

          {showSilenceOverlay && (
            <div className="flex items-center gap-1 bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5">
              <span className="text-[9px] text-zinc-400">Thresh:</span>
              <input
                type="range"
                min={-54}
                max={-12}
                step={1}
                value={silenceThresholdDb}
                onChange={(e) => setSilenceThresholdDb(Number(e.target.value))}
                className="w-14 accent-emerald-400 h-1"
              />
              <span className="text-[9px] text-emerald-300">{silenceThresholdDb}dB</span>
            </div>
          )}

          {onOpenCompingAndTransientModal && (
            <button
              type="button"
              onClick={onOpenCompingAndTransientModal}
              className="px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-[9px] font-semibold"
            >
              Comping &amp; Strip Silence...
            </button>
          )}
        </div>
      </div>

      {/* Synchronized Waveform + 16th-Note Heatmap Canvas */}
      <div className="relative h-[58px] w-full">
        <canvas
          ref={canvasRef}
          onMouseDown={handleCanvasPointerDown}
          className="w-full h-full block cursor-pointer"
        />
      </div>
    </div>
  );
};
