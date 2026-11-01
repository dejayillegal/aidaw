import React, { useState } from 'react';
import {
  Activity,
  Check,
  Clock,
  Flame,
  Gauge,
  Layers,
  RotateCcw,
  Sliders,
  Sparkles,
  Wand2,
  X,
} from 'lucide-react';
import { HumanizationConfig } from '../types/ableton';

interface MidiHumanizationHeatmapModalProps {
  isOpen: boolean;
  onClose: () => void;
  humanization: HumanizationConfig;
  arrangementLengthBars: number;
  currentPlayheadBeat: number;
  onUpdateHumanization: (partial: Partial<HumanizationConfig>) => void;
}

export const MidiHumanizationHeatmapModal: React.FC<MidiHumanizationHeatmapModalProps> = ({
  isOpen,
  onClose,
  humanization,
  arrangementLengthBars,
  currentPlayheadBeat,
  onUpdateHumanization,
}) => {
  if (!isOpen) return null;

  const totalBars = Math.max(16, arrangementLengthBars || 16);
  const currentBar = Math.floor(Math.max(0, currentPlayheadBeat) / 4) + 1;
  const barVariances = humanization.barVarianceIntensity || {};

  const getBarIntensity = (bar: number) => {
    return barVariances[bar] !== undefined ? barVariances[bar] : 1.0;
  };

  const handleSetBarIntensity = (bar: number, intensity: number) => {
    const next = { ...barVariances, [bar]: Number(Math.max(0, Math.min(2.0, intensity)).toFixed(2)) };
    onUpdateHumanization({ barVarianceIntensity: next });
  };

  const handleApplyPreset = (preset: 'lock' | 'warehouse' | 'ramp' | 'droplock' | 'reset') => {
    const updated: Record<number, number> = {};
    for (let b = 1; b <= totalBars; b++) {
      if (preset === 'lock') {
        updated[b] = 0.0;
      } else if (preset === 'warehouse') {
        updated[b] = 1.35;
      } else if (preset === 'ramp') {
        const t = (b - 1) / Math.max(1, totalBars - 1);
        updated[b] = Number((0.4 + t * 1.4).toFixed(2));
      } else if (preset === 'droplock') {
        // Tight on drops (bars 9-12 or 25-28), loose elsewhere
        const isDrop = (b >= 9 && b <= 12) || (b >= 25 && b <= 28);
        updated[b] = isDrop ? 0.2 : 1.15;
      } else {
        updated[b] = 1.0;
      }
    }
    onUpdateHumanization({ barVarianceIntensity: updated });
  };

  const getIntensityColor = (intensity: number) => {
    if (intensity < 0.45) return 'from-blue-600 to-cyan-500 border-cyan-500/50 text-cyan-300';
    if (intensity < 0.95) return 'from-emerald-600 to-teal-500 border-emerald-500/50 text-emerald-300';
    if (intensity < 1.35) return 'from-amber-500 to-orange-500 border-amber-500/50 text-amber-300';
    return 'from-rose-600 to-pink-500 border-rose-500/50 text-rose-300';
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md font-mono select-none">
      <div className="w-full max-w-4xl max-h-[90vh] bg-[#0C0F14] border border-[#232B3A] rounded-xl flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="h-12 px-4 bg-[#090C10] border-b border-[#1E2533] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-amber-400" />
            <h2 className="text-xs sm:text-sm font-bold text-zinc-100 tracking-wide uppercase">
              Visual MIDI Mapping Tool · Humanization Heatmap
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Subtitle & Legend */}
        <div className="px-4 py-2.5 bg-[#0F131C] border-b border-[#1C2330] flex flex-wrap items-center justify-between gap-3 text-[11px]">
          <p className="text-zinc-400">
            Per-bar micro-timing variance intensity (0% Robot Quantize → 100% Organic → 200% Loose Warehouse).
          </p>
          <div className="flex items-center gap-3 text-[10px]">
            <span className="flex items-center gap-1 text-cyan-300">
              <span className="w-2.5 h-2.5 rounded-full bg-cyan-500" /> 0–40% Tight
            </span>
            <span className="flex items-center gap-1 text-emerald-300">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" /> 50–90% Groove
            </span>
            <span className="flex items-center gap-1 text-amber-300">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500" /> 100–130% Swing
            </span>
            <span className="flex items-center gap-1 text-rose-300">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> 140–200% Loose
            </span>
          </div>
        </div>

        {/* Preset Toolbar */}
        <div className="px-4 py-2 bg-[#0B0E14] border-b border-[#1A202C] flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[10px] text-zinc-500 uppercase mr-1">PRESETS:</span>
            <button
              type="button"
              onClick={() => handleApplyPreset('reset')}
              className="px-2 py-0.5 rounded bg-[#161B24] hover:bg-zinc-800 text-zinc-300 text-[10px]"
            >
              Reset 100%
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('lock')}
              className="px-2 py-0.5 rounded bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 text-[10px]"
            >
              0% Robot Lock
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('warehouse')}
              className="px-2 py-0.5 rounded bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 text-[10px]"
            >
              135% Warehouse
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('ramp')}
              className="px-2 py-0.5 rounded bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 border border-purple-500/30 text-[10px]"
            >
              Tension Ramp
            </button>
            <button
              type="button"
              onClick={() => handleApplyPreset('droplock')}
              className="px-2 py-0.5 rounded bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px]"
            >
              Drop Lock
            </button>
          </div>

          <div className="flex items-center gap-2 text-[10px] text-zinc-400">
            <span>Base Shift:</span>
            <input
              type="range"
              min={0.002}
              max={0.03}
              step={0.001}
              value={humanization.microTimingMaxShiftBeats}
              onChange={(e) =>
                onUpdateHumanization({ microTimingMaxShiftBeats: parseFloat(e.target.value) })
              }
              className="w-20 accent-amber-400"
            />
            <span className="text-amber-400 font-bold tabular-nums">
              ±{(humanization.microTimingMaxShiftBeats * 1000).toFixed(0)}mBeat
            </span>
          </div>
        </div>

        {/* Heatmap Grid */}
        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-4 sm:grid-cols-8 md:grid-cols-16 gap-2">
            {Array.from({ length: totalBars }).map((_, idx) => {
              const barNum = idx + 1;
              const intensity = getBarIntensity(barNum);
              const isPlayingHere = currentBar === barNum;
              const colorClasses = getIntensityColor(intensity);
              const shiftBeats = (humanization.microTimingMaxShiftBeats * intensity).toFixed(3);

              return (
                <div
                  key={barNum}
                  className={`p-2 rounded-lg bg-[#10141D] border flex flex-col items-center justify-between text-center relative transition-all group ${
                    isPlayingHere
                      ? 'border-amber-400 ring-2 ring-amber-400/30 shadow-lg'
                      : 'border-[#1E2533] hover:border-zinc-600'
                  }`}
                >
                  <div className="w-full flex items-center justify-between text-[9px] text-zinc-400 font-bold">
                    <span>B{barNum}</span>
                    {isPlayingHere && (
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-ping" />
                    )}
                  </div>

                  {/* Heatmap Vertical Bar Gauge */}
                  <div className="w-full h-16 bg-zinc-950 rounded relative my-1.5 overflow-hidden border border-zinc-900 flex items-end">
                    <div
                      className={`w-full bg-gradient-to-t ${colorClasses} rounded-b transition-all`}
                      style={{ height: `${Math.min(100, (intensity / 2.0) * 100)}%` }}
                    />
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <span className="text-[10px] font-bold text-white drop-shadow tabular-nums">
                        {(intensity * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>

                  {/* Micro-timing Readout */}
                  <span className="text-[8px] text-zinc-500 tabular-nums">±{shiftBeats}b</span>

                  {/* Interactive Slider */}
                  <input
                    type="range"
                    min={0.0}
                    max={2.0}
                    step={0.05}
                    value={intensity}
                    onChange={(e) => handleSetBarIntensity(barNum, parseFloat(e.target.value))}
                    className="w-full mt-1.5 accent-amber-400 h-1 bg-zinc-800 rounded cursor-pointer"
                    title={`Bar ${barNum} Variance: ${(intensity * 100).toFixed(0)}%`}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="h-10 px-4 bg-[#090C10] border-t border-[#1E2533] flex items-center justify-between shrink-0 text-xs">
          <span className="text-[11px] text-zinc-500">
            Current Playhead: Bar {currentBar} · Real-time Heuristic Live-12 Micro-Timing Engine
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs rounded transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
