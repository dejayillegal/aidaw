import React, { useState } from 'react';
import {
  Activity,
  Circle,
  Clock,
  Cpu,
  FastForward,
  Play,
  Redo2,
  Repeat,
  Rewind,
  RotateCcw,
  Sliders,
  Square,
  Undo2,
  Volume2,
} from 'lucide-react';
import { TimelineEditMode, TransportConfig } from '../types/ableton';
import { PWAInstallButton } from './PWAInstallButton';

interface StudioTransportBarProps {
  isPlaying: boolean;
  playheadBeat: number;
  tempo: number;
  meter?: string;
  transport: TransportConfig;
  masterPeakDb: number;
  canUndo: boolean;
  canRedo: boolean;
  editMode: TimelineEditMode;
  onTogglePlay: () => void;
  onStop: () => void;
  onRewindToStart: () => void;
  onUpdateTempo: (bpm: number) => void;
  onUpdateTransport: (partial: Partial<TransportConfig>) => void;
  onChangeEditMode: (mode: TimelineEditMode) => void;
  onUndo: () => void;
  onRedo: () => void;
}

export const StudioTransportBar: React.FC<StudioTransportBarProps> = ({
  isPlaying,
  playheadBeat,
  tempo,
  meter = '4/4',
  transport,
  masterPeakDb,
  canUndo,
  canRedo,
  editMode,
  onTogglePlay,
  onStop,
  onRewindToStart,
  onUpdateTempo,
  onUpdateTransport,
  onChangeEditMode,
  onUndo,
  onRedo,
}) => {
  const [tapTimestamps, setTapTimestamps] = useState<number[]>([]);

  // Calculate Bar.Beat.Sixteenth counter from playheadBeat
  const safeBeat = Math.max(0, playheadBeat);
  const currentBar = Math.floor(safeBeat / 4) + 1;
  const currentBeatInBar = Math.floor(safeBeat % 4) + 1;
  const currentSixteenth = Math.floor((safeBeat % 1) * 4) + 1;

  const barStr = String(currentBar).padStart(3, '0');
  const beatStr = String(currentBeatInBar);
  const sixteenthStr = String(currentSixteenth);

  const handleTapTempo = () => {
    const now = performance.now();
    const recent = [...tapTimestamps, now].filter((t) => now - t < 3000).slice(-5);
    setTapTimestamps(recent);
    if (recent.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < recent.length; i++) {
        intervals.push(recent[i] - recent[i - 1]);
      }
      const avgIntervalMs = intervals.reduce((a, b) => a + b, 0) / intervals.length;
      if (avgIntervalMs > 250 && avgIntervalMs < 1200) {
        const computedBpm = Math.round(60000 / avgIntervalMs);
        onUpdateTempo(Math.max(90, Math.min(180, computedBpm)));
      }
    }
  };

  const isClipping = masterPeakDb > -0.1;
  const meterWidthPct = Math.max(0, Math.min(100, ((masterPeakDb + 48) / 48) * 100));

  return (
    <div className="h-12 bg-[#0E1217] border-b border-[#1E2530] px-3 flex items-center justify-between font-mono select-none shrink-0 z-30">
      {/* LEFT: TRANSPORT PLAYBACK CONTROLS */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={onRewindToStart}
          title="Return to Zero (Beat 1)"
          className="w-8 h-8 rounded bg-[#151B24] hover:bg-[#1E2735] border border-[#263140] text-zinc-300 flex items-center justify-center transition-colors active:scale-95"
        >
          <Rewind className="w-4 h-4 fill-current" />
        </button>

        <button
          type="button"
          onClick={onStop}
          title="Stop Playback (Space)"
          className="w-8 h-8 rounded bg-[#151B24] hover:bg-[#1E2735] border border-[#263140] text-zinc-300 flex items-center justify-center transition-colors active:scale-95"
        >
          <Square className="w-3.5 h-3.5 fill-current" />
        </button>

        <button
          type="button"
          onClick={onTogglePlay}
          title={isPlaying ? 'Pause Playback (Space)' : 'Start Playback (Space)'}
          className={`w-10 h-8 rounded font-bold flex items-center justify-center transition-all active:scale-95 shadow-xs ${
            isPlaying
              ? 'bg-amber-400 text-zinc-950 hover:bg-amber-300 ring-2 ring-amber-400/30'
              : 'bg-emerald-500 text-zinc-950 hover:bg-emerald-400'
          }`}
        >
          {isPlaying ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
        </button>

        {/* Loop Toggle */}
        <button
          type="button"
          onClick={() => onUpdateTransport({ loopEnabled: !transport.loopEnabled })}
          title={`Loop Toggle (${transport.loopLengthBars} Bars)`}
          className={`px-2.5 h-8 rounded text-xs font-semibold flex items-center gap-1 border transition-colors ${
            transport.loopEnabled
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
              : 'bg-[#151B24] text-zinc-400 border-[#263140] hover:text-zinc-200'
          }`}
        >
          <Repeat className="w-3.5 h-3.5" />
          <span>{transport.loopEnabled ? `${transport.loopLengthBars}B` : 'OFF'}</span>
        </button>

        {/* Undo / Redo */}
        <div className="hidden sm:flex items-center gap-1 ml-1 border-l border-[#202734] pl-2">
          <button
            type="button"
            disabled={!canUndo}
            onClick={onUndo}
            title="Undo (Cmd+Z)"
            className="w-7 h-7 rounded bg-[#151B24] hover:bg-[#1E2735] disabled:opacity-30 border border-[#263140] text-zinc-300 flex items-center justify-center"
          >
            <Undo2 className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            disabled={!canRedo}
            onClick={onRedo}
            title="Redo (Cmd+Y)"
            className="w-7 h-7 rounded bg-[#151B24] hover:bg-[#1E2735] disabled:opacity-30 border border-[#263140] text-zinc-300 flex items-center justify-center"
          >
            <Redo2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* CENTER: TIMECODE, BPM, METER, TAP TEMPO */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Ableton/SoundCraft Bar.Beat.Tick Display */}
        <div className="bg-[#07090C] border border-[#222B38] px-3 py-1 rounded flex items-baseline gap-1.5 shadow-inner">
          <span className="text-zinc-500 text-[10px]">LOC</span>
          <span className="text-amber-400 text-base font-bold tracking-widest tabular-nums">
            {barStr}.{beatStr}.{sixteenthStr}
          </span>
        </div>

        {/* BPM Controller */}
        <div className="flex items-center gap-1 bg-[#0A0D12] border border-[#222B38] px-2 py-0.5 rounded">
          <span className="text-zinc-400 text-[10px]">BPM</span>
          <button
            type="button"
            onClick={() => onUpdateTempo(tempo - 1)}
            className="w-5 h-5 rounded bg-[#161C24] hover:bg-[#1F2732] text-zinc-300 flex items-center justify-center text-xs font-bold"
          >
            -
          </button>
          <input
            type="number"
            min={80}
            max={185}
            value={tempo}
            onChange={(e) => onUpdateTempo(parseFloat(e.target.value) || 134)}
            className="w-12 text-center bg-transparent text-amber-300 font-bold text-xs outline-none tabular-nums"
          />
          <button
            type="button"
            onClick={() => onUpdateTempo(tempo + 1)}
            className="w-5 h-5 rounded bg-[#161C24] hover:bg-[#1F2732] text-zinc-300 flex items-center justify-center text-xs font-bold"
          >
            +
          </button>
          <button
            type="button"
            onClick={handleTapTempo}
            className="px-1.5 py-0.5 text-[9px] rounded bg-[#161C24] hover:bg-amber-500/20 text-zinc-300 hover:text-amber-300 font-semibold uppercase ml-1 border border-[#242D3A]"
          >
            TAP
          </button>
        </div>

        {/* Meter & Metronome */}
        <div className="hidden md:flex items-center gap-1.5 text-xs text-zinc-400">
          <span className="px-1.5 py-0.5 rounded bg-[#12161E] border border-[#222B38] text-zinc-300 font-semibold text-[11px]">
            {meter}
          </span>
          <button
            type="button"
            onClick={() => onUpdateTransport({ metronomeEnabled: !transport.metronomeEnabled })}
            className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
              transport.metronomeEnabled
                ? 'bg-sky-500/20 text-sky-300 border-sky-500/50'
                : 'bg-[#12161E] text-zinc-400 border-[#222B38] hover:text-zinc-200'
            }`}
          >
            CLICK: {transport.metronomeEnabled ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      {/* RIGHT: EDIT MODE, METERS, CPU & AUDIO ENGINE STATUS */}
      <div className="flex items-center gap-3 shrink-0">
        {/* Edit Mode Quick Indicator */}
        <div className="hidden lg:flex items-center gap-1 text-[10px]">
          <span className="text-zinc-500 uppercase">MODE:</span>
          {(['grid', 'slip', 'shuffle', 'spot'] as TimelineEditMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => onChangeEditMode(m)}
              className={`px-1.5 py-0.5 rounded uppercase font-semibold transition-colors ${
                editMode === m
                  ? 'bg-amber-500 text-zinc-950'
                  : 'text-zinc-400 hover:text-zinc-200 bg-[#12161E]'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        {/* Master Output Peak Meter */}
        <div className="flex items-center gap-1.5 bg-[#07090C] border border-[#222B38] px-2 py-1 rounded">
          <div className="w-14 sm:w-20 h-2 bg-zinc-900 rounded-sm overflow-hidden relative">
            <div
              className={`h-full transition-all duration-75 ${
                isClipping ? 'bg-rose-500' : masterPeakDb > -6 ? 'bg-amber-400' : 'bg-emerald-400'
              }`}
              style={{ width: `${meterWidthPct}%` }}
            />
          </div>
          <span
            className={`text-[10px] font-bold tabular-nums ${
              isClipping ? 'text-rose-400' : 'text-zinc-400'
            }`}
          >
            {masterPeakDb > -60 ? `${masterPeakDb.toFixed(1)} dB` : '-inf'}
          </span>
        </div>

        {/* Download APK / Install App Button */}
        <PWAInstallButton />

        {/* Audio Engine Status */}
        <div className="hidden xl:flex items-center gap-1.5 text-[10px] text-zinc-400 border-l border-[#202734] pl-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          <span>48kHz · DSP ACTIVE</span>
        </div>
      </div>
    </div>
  );
};
