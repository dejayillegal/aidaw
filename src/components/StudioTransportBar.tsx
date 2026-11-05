import React, { useEffect, useRef, useState } from 'react';
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
import { AbletonProjectState, TimelineEditMode, TransportConfig } from '../types/ableton';
import { beatToBarBeatTick, CANONICAL_PPQ } from '../engine/timelineCoordinates';
import { PWAInstallButton } from './PWAInstallButton';

interface StudioTransportBarProps {
  isPlaying: boolean;
  playheadBeat: number;
  tempo: number;
  meter?: string;
  meterMap?: AbletonProjectState['meterMap'];
  ppq?: number;
  transport: TransportConfig;
  masterPeakDb: number;
  masterTruePeakDbtp?: number;
  masterLufs?: number;
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
  meterMap,
  ppq = CANONICAL_PPQ,
  transport,
  masterPeakDb,
  masterTruePeakDbtp,
  masterLufs,
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
  const [tempoDraft, setTempoDraft] = useState(String(tempo));
  useEffect(() => setTempoDraft(String(tempo)), [tempo]);
  const commitTempo = () => {
    const value = Number(tempoDraft);
    if (tempoDraft.trim() && Number.isFinite(value) && value >= 40 && value <= 240) {
      if (value !== tempo) onUpdateTempo(value);
    } else setTempoDraft(String(tempo));
  };
  const [tapTimestamps, setTapTimestamps] = useState<number[]>([]);
  const [peakHoldDb, setPeakHoldDb] = useState<number>(-60);
  const [hasClipped, setHasClipped] = useState<boolean>(false);
  const lastPeakTimeRef = useRef<number>(0);

  // Calculate Bar.Beat.Sixteenth counter from playheadBeat
  const safeBeat = Math.max(0, playheadBeat);
  const position=beatToBarBeatTick(safeBeat,meterMap,ppq);
  const currentBar = position.bar;
  const currentBeatInBar = position.beatInBar;
  const currentSixteenth = Math.floor(position.tickInBeat/ppq*4)+1;
  const meterLabel=meterMap?.length?`${position.numerator}/${position.denominator}`:meter;

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
      if (avgIntervalMs >= 250 && avgIntervalMs <= 1500) {
        const computedBpm = Math.round(60000 / avgIntervalMs);
        onUpdateTempo(Math.max(40, Math.min(240, computedBpm)));
      }
    }
  };

  useEffect(() => {
    const currentPeak = masterTruePeakDbtp !== undefined ? masterTruePeakDbtp : masterPeakDb;
    if (currentPeak >= -0.1) {
      setHasClipped(true);
    }
    if (currentPeak > peakHoldDb) {
      setPeakHoldDb(currentPeak);
      lastPeakTimeRef.current = performance.now();
    } else {
      const now = performance.now();
      if (now - lastPeakTimeRef.current > 1200) {
        setPeakHoldDb((prev) => Math.max(-60, prev - 1.5));
      }
    }
  }, [masterPeakDb, masterTruePeakDbtp, peakHoldDb]);

  const dbToPct = (db: number) => Math.max(0, Math.min(100, ((db + 48) / 48) * 100));
  const meterWidthPct = dbToPct(masterPeakDb);
  const peakHoldPct = dbToPct(peakHoldDb);

  return (
    <div className="studio-transport min-h-12 overflow-x-auto gap-3 bg-[#0E1217] border-b border-[#1E2530] px-3 flex items-center justify-between font-mono select-none shrink-0 z-30">
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
          disabled={transport.arrangementMode==='session'}
          onClick={() => onUpdateTransport({ loopEnabled: !transport.loopEnabled })}
          title={transport.arrangementMode==='session'?'Arrangement loop unavailable in Session':`Loop Toggle (${transport.loopLengthBars} Bars)`}
          className={`px-2.5 h-8 rounded text-xs font-semibold flex items-center gap-1 border transition-colors ${
            transport.loopEnabled && transport.arrangementMode!=='session'
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/50'
              : 'bg-[#151B24] text-zinc-400 border-[#263140] hover:text-zinc-200'
          }`}
        >
          <Repeat className="w-3.5 h-3.5" />
          <span>{transport.arrangementMode==='session'?'SESSION':transport.loopEnabled ? `${transport.loopLengthBars}B` : 'OFF'}</span>
        </button>

        <button type="button" aria-label="Metronome" aria-pressed={transport.metronomeEnabled} onClick={()=>onUpdateTransport({metronomeEnabled:!transport.metronomeEnabled})} className={`md:hidden min-h-11 min-w-11 rounded border text-xs ${transport.metronomeEnabled?'border-cyan-400 text-cyan-300':'border-[#263140] text-zinc-400'}`}>Click</button>

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
          <span data-testid="transport-position" className="text-amber-400 text-base font-bold tracking-widest tabular-nums">
            {barStr}.{beatStr}.{sixteenthStr}
          </span>
        </div>

        {/* BPM Controller */}
        <div className="flex items-center gap-1 bg-[#0A0D12] border border-[#222B38] px-2 py-0.5 rounded">
          <span className="text-zinc-400 text-[10px]">BPM</span>
          <button
            type="button"
            aria-label="Decrease tempo"
            onClick={() => onUpdateTempo(Math.max(40, tempo - 1))}
            className="tempo-stepper w-5 h-5 rounded bg-[#161C24] hover:bg-[#1F2732] text-zinc-300 flex items-center justify-center text-xs font-bold"
          >
            -
          </button>
          <input
            type="number"
            aria-label="Tempo BPM"
            min={40}
            max={240}
            step={0.01}
            value={tempoDraft}
            onChange={e=>setTempoDraft(e.target.value)}
            onBlur={commitTempo}
            onKeyDown={e=>{if(e.key==='Enter'){e.preventDefault();e.currentTarget.blur();}else if(e.key==='Escape'){setTempoDraft(String(tempo));e.stopPropagation();}}}
            className="w-16 text-center bg-transparent text-amber-300 font-bold text-xs outline-none tabular-nums"
          />
          <button
            type="button"
            aria-label="Increase tempo"
            onClick={() => onUpdateTempo(Math.min(240, tempo + 1))}
            className="tempo-stepper w-5 h-5 rounded bg-[#161C24] hover:bg-[#1F2732] text-zinc-300 flex items-center justify-center text-xs font-bold"
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
            {meterLabel}
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
        {/* Master Output Peak Meter with Fixed Width, Graduation Ticks & Clipping Latch */}
        <div className="flex items-center gap-2 bg-[#07090C] border border-[#222B38] px-2 py-1 rounded select-none shrink-0">
          <div className="flex flex-col gap-0.5">
            {/* Graduation Ticks Header */}
            <div className="relative w-24 sm:w-32 h-2 text-[7.5px] text-zinc-500 font-mono flex justify-between leading-none pointer-events-none px-0.5">
              <span>-48</span>
              <span className="hidden sm:inline">-24</span>
              <span>-12</span>
              <span>-6</span>
              <span className="text-amber-400 font-bold">-1</span>
              <span className={hasClipped ? 'text-rose-400 font-bold' : ''}>0</span>
            </div>

            {/* Meter Bar Container (fixed width to prevent layout wobbling) */}
            <div className="w-24 sm:w-32 h-2 bg-zinc-950 rounded-xs overflow-hidden relative border border-zinc-800">
              {/* Colored meter fill (Strictly NO transition to prevent animation glitching/jitter) */}
              <div
                className={`h-full ${
                  hasClipped || masterPeakDb >= -0.5
                    ? 'bg-rose-500'
                    : masterPeakDb >= -1.0
                    ? 'bg-amber-400'
                    : masterPeakDb > -6
                    ? 'bg-gradient-to-r from-emerald-500 to-amber-400'
                    : 'bg-emerald-500'
                }`}
                style={{ width: `${meterWidthPct}%` }}
              />

              {/* Peak Hold Indicator Tick */}
              {peakHoldDb > -48 && (
                <div
                  className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_4px_#ffffff]"
                  style={{ left: `calc(${peakHoldPct}% - 1px)` }}
                />
              )}

              {/* -1.0 dBTP Ceiling Placeholder Marker */}
              <div
                className="absolute top-0 bottom-0 w-[1px] bg-rose-400/80 z-10"
                style={{ left: `${dbToPct(-1.0)}%` }}
                title="-1 dB reference"
              />
            </div>
          </div>

          {/* Readout (Fixed width tabular-nums) */}
          <div className="flex flex-col text-right w-14 sm:w-18 shrink-0 leading-tight">
            <span
              className={`text-[9.5px] font-bold tabular-nums ${
                hasClipped ? 'text-rose-400' : masterPeakDb >= -1.0 ? 'text-amber-400' : 'text-zinc-300'
              }`}
            >
              {masterPeakDb > -58
                ? `${masterPeakDb.toFixed(1)} dB`
                : '-inf dB'}
            </span>
            <span className="text-[8.5px] text-zinc-500 tabular-nums">
              {isPlaying && masterLufs !== undefined && masterLufs > -50
                ? `${masterLufs.toFixed(1)} LUFS est.`
                : '— LUFS'}
            </span>
          </div>

          {/* Clip LED indicator (Clickable to reset latch) */}
          <button
            type="button"
            onClick={() => setHasClipped(false)}
            title={hasClipped ? 'Peak exceeded -0.1 dB (Click to reset)' : 'Reset peak indicator'}
            className={`w-2.5 h-2.5 rounded-full transition-colors cursor-pointer border ${
              hasClipped
                ? 'bg-rose-500 border-rose-300 shadow-[0_0_8px_rgba(244,63,94,0.9)] animate-pulse'
                : 'bg-zinc-800 border-zinc-700 hover:border-zinc-500'
            }`}
          />
        </div>

      </div>
    </div>
  );
};

