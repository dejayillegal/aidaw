import React, { useState, useRef } from 'react';
import {
  AbletonProjectState,
  AbletonTrack,
  HumanizationConfig,
  MasterBusConfig,
  SpectralDuckingConfig,
  TrackMixerParams,
  VelocityCurveConfig,
  VelocityCurvePreset,
} from '../types/ableton';
import {
  ABLETON_BUILTIN_LIBRARY,
  computeKickSubSpectralOverlap,
  generateVelocityCurvePoints,
  getDefaultSpectralDuckingConfig,
  getDefaultVelocityCurveForArchetype,
} from '../engine/alsXmlEngine';
import {
  Sliders,
  RefreshCw,
  Activity,
  Cpu,
  Minus,
  Plus,
  Volume2,
  Waves,
  PenTool,
  Sparkles,
  Layers,
  ShieldAlert,
  CheckCircle2,
  Wand2,
} from 'lucide-react';
import { MasterSpectrumAnalyzer } from './MasterSpectrumAnalyzer';

interface DeviceRackPanelProps {
  project?: AbletonProjectState;
  selectedTrack?: AbletonTrack;
  humanization: HumanizationConfig;
  masterBus: MasterBusConfig;
  modulatedCutoffHz: number;
  masterPeakDb?: number;
  currentSeed?: number;
  isPlaying?: boolean;
  tempo?: number;
  onUpdateHumanization: (partial: Partial<HumanizationConfig>) => void;
  onUpdateTrackMixer: (trackId: string, partial: Partial<TrackMixerParams>) => void;
  onUpdateTrackVelocityCurve?: (
    trackId: string,
    config: VelocityCurveConfig,
    injectImmediately?: boolean
  ) => void;
  onApplySpectralAutoDuck?: (trackId: string, config: SpectralDuckingConfig) => void;
  onInjectLibraryDevice?: (trackId: string, templateId: string) => void;
  onApplySmartLeveling?: () => void;
  onUpdateMasterBus: (partial: Partial<MasterBusConfig>) => void;
  onRehumanizeAll: () => void;
}

const VELOCITY_PRESETS: { id: VelocityCurvePreset; label: string; shortDesc: string }[] = [
  { id: 'exponential', label: 'Exponential', shortDesc: 'Rising energy curve (x²·²)' },
  { id: 'inverse', label: 'Inverse', shortDesc: 'Decaying tail curve ((1-x)¹·⁸)' },
  { id: 'random', label: 'Random', shortDesc: 'Stochastic seeded velocity map' },
  { id: 'linear', label: 'Linear', shortDesc: 'Steady upward velocity ramp' },
  { id: 's_curve', label: 'S-Curve', shortDesc: 'Sigmoid tension build' },
  { id: 'accent_4x4', label: '4x4 Accent', shortDesc: 'Downbeat + offbeat 8th groove' },
];

export const DeviceRackPanel: React.FC<DeviceRackPanelProps> = ({
  project,
  selectedTrack,
  humanization,
  masterBus,
  modulatedCutoffHz,
  masterPeakDb = -60,
  currentSeed = 1,
  isPlaying = false,
  tempo = 134,
  onUpdateHumanization,
  onUpdateTrackMixer,
  onUpdateTrackVelocityCurve,
  onApplySpectralAutoDuck,
  onInjectLibraryDevice,
  onApplySmartLeveling,
  onUpdateMasterBus,
  onRehumanizeAll,
}) => {
  const [masterViewMode, setMasterViewMode] = useState<'split' | 'spectrum' | 'params'>('split');
  const [leftColTab, setLeftColTab] = useState<'dsp' | 'ducking' | 'library'>('ducking');
  const [libraryCategory, setLibraryCategory] = useState<
    'all' | 'instrument' | 'audio_effect' | 'midi_effect' | 'rack'
  >('all');
  const [isDrawingCurve, setIsDrawingCurve] = useState<boolean>(false);
  const [hoveredStepIdx, setHoveredStepIdx] = useState<number | null>(null);
  const curveContainerRef = useRef<HTMLDivElement | null>(null);

  const handleWheelPrevent = (e: React.WheelEvent<HTMLInputElement>) => {
    e.currentTarget.blur();
  };

  const activeVelocityCurve: VelocityCurveConfig =
    selectedTrack?.velocityCurve ||
    getDefaultVelocityCurveForArchetype(selectedTrack?.archetype || 'rumble');

  const rootKey = project?.rootKey || 'F';
  const activeSpectralDuck: SpectralDuckingConfig =
    selectedTrack?.spectralDucking ||
    getDefaultSpectralDuckingConfig(rootKey, selectedTrack?.archetype || 'rumble');

  // Identify kick track and target sub/acid/selected track for spectral overlap visualization
  const kickTrack = project?.tracks.find((t) => t.archetype === 'kick') || project?.tracks[0];
  const subOrSelectedTrack =
    selectedTrack && selectedTrack.archetype !== 'kick'
      ? selectedTrack
      : project?.tracks.find((t) => t.archetype === 'rumble' || t.archetype === 'acid') ||
        selectedTrack;

  const spectralOverlap = computeKickSubSpectralOverlap(
    kickTrack,
    subOrSelectedTrack,
    rootKey,
    subOrSelectedTrack?.spectralDucking || activeSpectralDuck
  );

  const updateVelocityCurve = (
    partial: Partial<VelocityCurveConfig>,
    injectImmediately = true
  ) => {
    if (!selectedTrack || !onUpdateTrackVelocityCurve) return;
    const nextConfig: VelocityCurveConfig = {
      ...activeVelocityCurve,
      ...partial,
    };
    onUpdateTrackVelocityCurve(selectedTrack.id, nextConfig, injectImmediately);
  };

  const handleSelectVelocityPreset = (preset: VelocityCurvePreset) => {
    if (!selectedTrack) return;
    const randomSeed = Math.floor(Math.random() * 100000) + currentSeed;
    const newPoints = generateVelocityCurvePoints(preset, randomSeed);
    updateVelocityCurve(
      {
        preset,
        points: newPoints,
      },
      true
    );
  };

  const applyPointerToCurve = (clientX: number, clientY: number) => {
    if (!curveContainerRef.current || !selectedTrack) return;
    const rect = curveContainerRef.current.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;

    const relX = Math.max(0, Math.min(0.999, (clientX - rect.left) / rect.width));
    const relY = Math.max(0.04, Math.min(1.0, 1 - (clientY - rect.top) / rect.height));
    const stepIndex = Math.min(15, Math.max(0, Math.floor(relX * 16)));

    setHoveredStepIdx(stepIndex);

    const nextPoints = [...(activeVelocityCurve.points || generateVelocityCurvePoints('linear'))];
    while (nextPoints.length < 16) nextPoints.push(0.75);
    nextPoints[stepIndex] = Number(relY.toFixed(3));

    updateVelocityCurve(
      {
        preset: 'custom',
        points: nextPoints,
      },
      true
    );
  };

  const handleTriggerAutoDuck = (partial?: Partial<SpectralDuckingConfig>) => {
    const target = subOrSelectedTrack || selectedTrack;
    if (!target || !onApplySpectralAutoDuck) return;
    const baseCfg =
      target.spectralDucking || getDefaultSpectralDuckingConfig(rootKey, target.archetype);
    const nextCfg: SpectralDuckingConfig = {
      ...baseCfg,
      ...partial,
      enabled: partial?.enabled !== undefined ? partial.enabled : true,
      collisionIndex: spectralOverlap.collisionIndex,
    };
    onApplySpectralAutoDuck(target.id, nextCfg);
  };

  const mixer: TrackMixerParams = selectedTrack?.mixer || {
    volumeDb: 0,
    pan: 0,
    transposeSemitones: 0,
    fineTuneCents: 0,
    sidechainDepth: 0.5,
    reverbSend: 0.25,
    delaySend: 0.2,
    filterCutoffHz: 800,
    filterResonance: 0.3,
  };

  const meterPercent = Math.max(2, Math.min(100, ((masterPeakDb + 48) / 54) * 100));

  const curvePointsList =
    activeVelocityCurve.points?.length === 16
      ? activeVelocityCurve.points
      : generateVelocityCurvePoints(activeVelocityCurve.preset, currentSeed);
  const svgPolylinePoints = curvePointsList
    .map((val, idx) => {
      const x = ((idx + 0.5) / 16) * 100;
      const y = (1 - Math.max(0.04, Math.min(1, val))) * 100;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  // Build SVG polylines for Kick vs Sub/Rumble Spectral Overlap (20 Hz - 320 Hz)
  const buildSpectrumPolyline = (arr: number[]) =>
    arr
      .map((val, idx) => {
        const x = (idx / Math.max(1, arr.length - 1)) * 100;
        const y = (1 - Math.max(0.02, Math.min(0.98, val))) * 100;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const kickSpecPolyline = buildSpectrumPolyline(spectralOverlap.kickSpectrum);
  const rawSubPolyline = buildSpectrumPolyline(spectralOverlap.subSpectrumRaw);
  const duckedSubPolyline = buildSpectrumPolyline(spectralOverlap.subSpectrumDucked);
  const notchXPercent = Math.max(
    5,
    Math.min(
      95,
      (Math.log(Math.max(20, spectralOverlap.recommendedNotchHz) / 20) / Math.log(320 / 20)) * 100
    )
  );

  const filteredLibrary = ABLETON_BUILTIN_LIBRARY.filter(
    (d) => libraryCategory === 'all' || d.category === libraryCategory
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 bg-[#11141B] border-t border-[#232934]">
      {/* Column 1: Track DSP, Spectral Ducking Control & Ableton Built-in Plugin Browser (4 cols) */}
      <div className="lg:col-span-4 p-3.5 border-b lg:border-b-0 lg:border-r border-[#232934] flex flex-col justify-between space-y-2.5">
        <div className="space-y-2.5">
          {/* Header & Sub-Tab Switcher */}
          <div className="flex flex-wrap items-center justify-between gap-1.5">
            <div className="flex items-center gap-1.5 min-w-0">
              <Cpu className="w-4 h-4 text-amber-400 shrink-0" />
              <h3 className="text-xs font-mono font-semibold tracking-wider text-slate-200 uppercase truncate">
                {selectedTrack?.name || 'TRACK RACK'}
              </h3>
            </div>

            <div className="flex items-center bg-[#090C12] border border-[#232B3B] rounded p-0.5 text-[9px] font-mono shrink-0">
              <button
                type="button"
                onClick={() => setLeftColTab('ducking')}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  leftColTab === 'ducking'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Kick vs Sub Spectral Ducking Analyzer & Auto-Duck XML Injector"
              >
                SPECTRAL DUCK
              </button>
              <button
                type="button"
                onClick={() => setLeftColTab('dsp')}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  leftColTab === 'dsp'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Track Tuning, Sidechain, Sends & Active XML Device Chain"
              >
                TRACK RACK
              </button>
              <button
                type="button"
                onClick={() => setLeftColTab('library')}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  leftColTab === 'library'
                    ? 'bg-amber-500 text-slate-950 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Browse & Inject Ableton Live 12 Built-in Instruments, Effects & Racks"
              >
                PLUGINS ({ABLETON_BUILTIN_LIBRARY.length})
              </button>
            </div>
          </div>

          {/* SUB-TAB 1: SPECTRAL DUCKING CONTROL & KICK-SUB FREQUENCY OVERLAP */}
          {leftColTab === 'ducking' && (
            <div className="p-2.5 bg-[#141923] border border-[#253042] rounded space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Waves className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                  <span className="text-[11px] font-mono font-semibold text-slate-200 truncate">
                    KICK vs. {subOrSelectedTrack?.name || 'SUB'} OVERLAP (20–320 Hz)
                  </span>
                </div>
                <span
                  className={`px-1.5 py-0.5 text-[9px] font-mono font-semibold rounded border shrink-0 ${
                    subOrSelectedTrack?.spectralDucking?.enabled
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                      : spectralOverlap.collisionIndex > 0.35
                      ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                      : 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                  }`}
                >
                  {subOrSelectedTrack?.spectralDucking?.enabled
                    ? `AUTO-DUCKED (${Math.round(spectralOverlap.collisionIndex * 100)}% Overlap)`
                    : `MASKING: ${Math.round(spectralOverlap.collisionIndex * 100)}%`}
                </span>
              </div>

              {/* Dual-Spectrum Frequency Overlap Canvas (SVG 20Hz - 320Hz) */}
              <div className="relative h-24 bg-[#090C12] border border-[#232C3E] rounded overflow-hidden">
                {/* Frequency Grid Lines */}
                <div className="absolute inset-0 flex justify-between px-2 py-1 text-[8px] font-mono text-slate-500 pointer-events-none">
                  <span>20Hz</span>
                  <span>{spectralOverlap.recommendedNotchHz}Hz (Kick Root)</span>
                  <span>120Hz</span>
                  <span>320Hz</span>
                </div>

                {/* Vertical Notch Target Line */}
                <div
                  className="absolute inset-y-0 border-l border-dashed border-rose-400/60 pointer-events-none"
                  style={{ left: `${notchXPercent}%` }}
                />

                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="absolute inset-0 w-full h-full"
                >
                  {/* Kick Low-End Spectrum (Amber) */}
                  <polygon
                    fill="rgba(245, 158, 11, 0.16)"
                    points={`0,100 ${kickSpecPolyline} 100,100`}
                  />
                  <polyline
                    fill="none"
                    stroke="#F59E0B"
                    strokeWidth="1.8"
                    points={kickSpecPolyline}
                  />

                  {/* Raw Un-Ducked Sub Spectrum (Dashed Rose/Cyan) */}
                  <polyline
                    fill="none"
                    stroke="rgba(244, 63, 94, 0.55)"
                    strokeWidth="1.2"
                    strokeDasharray="2,2"
                    points={rawSubPolyline}
                  />

                  {/* Post-Duck Sub Spectrum with Dynamic EQEight Notch (Cyan/Emerald) */}
                  <polygon
                    fill="rgba(16, 185, 129, 0.14)"
                    points={`0,100 ${duckedSubPolyline} 100,100`}
                  />
                  <polyline
                    fill="none"
                    stroke="#10B981"
                    strokeWidth="2.0"
                    points={duckedSubPolyline}
                  />
                </svg>

                {/* Legend Overlay */}
                <div className="absolute bottom-1 left-2 right-2 flex items-center justify-between text-[9px] font-mono">
                  <div className="flex items-center gap-2">
                    <span className="text-amber-400">■ Kick 909</span>
                    <span className="text-rose-400">┈ Raw Sub</span>
                    <span className="text-emerald-400">■ EQ8 Auto-Ducked</span>
                  </div>
                  <span className="text-sky-300 tabular-nums">
                    Notch: {subOrSelectedTrack?.spectralDucking?.notchGainDb ?? -8.5} dB @{' '}
                    {subOrSelectedTrack?.spectralDucking?.notchFreqHz ??
                      spectralOverlap.recommendedNotchHz}{' '}
                    Hz
                  </span>
                </div>
              </div>

              {/* Spectral Ducking Parameter Sliders */}
              <div className="grid grid-cols-2 gap-1.5">
                <div className="p-1.5 bg-[#0E131C] border border-[#222B3C] rounded">
                  <div className="flex justify-between text-[10px] font-mono tabular-nums mb-0.5">
                    <span className="text-slate-400">EQ8 NOTCH HZ</span>
                    <span className="text-amber-400 font-semibold">
                      {subOrSelectedTrack?.spectralDucking?.notchFreqHz ??
                        spectralOverlap.recommendedNotchHz}{' '}
                      Hz
                    </span>
                  </div>
                  <input
                    type="range"
                    min={36}
                    max={110}
                    step={1}
                    value={
                      subOrSelectedTrack?.spectralDucking?.notchFreqHz ??
                      spectralOverlap.recommendedNotchHz
                    }
                    onWheel={handleWheelPrevent}
                    onChange={(e) =>
                      handleTriggerAutoDuck({ notchFreqHz: parseInt(e.target.value, 10) })
                    }
                    className="w-full studio-slider"
                  />
                </div>

                <div className="p-1.5 bg-[#0E131C] border border-[#222B3C] rounded">
                  <div className="flex justify-between text-[10px] font-mono tabular-nums mb-0.5">
                    <span className="text-slate-400">DYNAMIC CUT</span>
                    <span className="text-emerald-400 font-semibold">
                      {subOrSelectedTrack?.spectralDucking?.notchGainDb ?? -8.5} dB
                    </span>
                  </div>
                  <input
                    type="range"
                    min={-15}
                    max={-2}
                    step={0.5}
                    value={subOrSelectedTrack?.spectralDucking?.notchGainDb ?? -8.5}
                    onWheel={handleWheelPrevent}
                    onChange={(e) =>
                      handleTriggerAutoDuck({ notchGainDb: parseFloat(e.target.value) })
                    }
                    className="w-full studio-slider"
                  />
                </div>
              </div>

              {/* Auto-Duck & AI Smart Level Action Buttons */}
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    handleTriggerAutoDuck({
                      enabled: true,
                      notchFreqHz: spectralOverlap.recommendedNotchHz,
                      notchGainDb: -9.0,
                      sidechainRatio: 4.8,
                      sidechainThresholdDb: -21.0,
                    })
                  }
                  className="flex-1 py-1.5 px-2.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-mono text-[11px] font-semibold rounded flex items-center justify-center gap-1.5 transition-colors shadow-xs"
                  title="Inject dynamic <EQEight> notch and <Compressor2> sidechain into the XML track's <DeviceChain>"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  <span>Auto-Duck XML + DSP</span>
                </button>

                {onApplySmartLeveling && (
                  <button
                    type="button"
                    onClick={onApplySmartLeveling}
                    className="py-1.5 px-2.5 bg-[#1B2436] hover:bg-[#243148] text-sky-300 border border-sky-500/40 font-mono text-[11px] font-semibold rounded flex items-center justify-center gap-1 transition-colors shrink-0"
                    title="AI Smart Level: Auto-calibrate gain staging, EQ filters, sidechain depth & stereo balance across all tracks"
                  >
                    <Wand2 className="w-3.5 h-3.5" />
                    <span>AI Smart Level</span>
                  </button>
                )}
              </div>
            </div>
          )}

          {/* SUB-TAB 2: TRACK TUNING, SIDECHAIN, SENDS & ACTIVE DEVICE CHAIN */}
          {leftColTab === 'dsp' && (
            <div>
              {selectedTrack && (
                <div className="grid grid-cols-2 gap-2 mb-2.5">
                  <div className="p-2 bg-[#151A24] border border-[#242C3D] rounded">
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1">
                      <span>TUNING (SEMITONES)</span>
                      <span className="text-amber-400 font-semibold">
                        {mixer.transposeSemitones > 0
                          ? `+${mixer.transposeSemitones}`
                          : mixer.transposeSemitones}{' '}
                        st
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateTrackMixer(selectedTrack.id, {
                            transposeSemitones: Math.max(-12, mixer.transposeSemitones - 1),
                          })
                        }
                        className="w-5 h-5 bg-[#1E2636] hover:bg-[#2A354B] text-slate-200 rounded flex items-center justify-center border border-[#313C50]"
                      >
                        <Minus className="w-3 h-3" />
                      </button>
                      <input
                        type="range"
                        min={-12}
                        max={12}
                        step={1}
                        value={mixer.transposeSemitones}
                        onWheel={handleWheelPrevent}
                        onChange={(e) =>
                          onUpdateTrackMixer(selectedTrack.id, {
                            transposeSemitones: parseInt(e.target.value, 10),
                          })
                        }
                        className="flex-1 studio-slider"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          onUpdateTrackMixer(selectedTrack.id, {
                            transposeSemitones: Math.min(12, mixer.transposeSemitones + 1),
                          })
                        }
                        className="w-5 h-5 bg-[#1E2636] hover:bg-[#2A354B] text-slate-200 rounded flex items-center justify-center border border-[#313C50]"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  <div className="p-2 bg-[#151A24] border border-[#242C3D] rounded">
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1">
                      <span>KICK SIDECHAIN</span>
                      <span className="text-sky-400 font-semibold">
                        {Math.round(mixer.sidechainDepth * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={mixer.sidechainDepth}
                      onWheel={handleWheelPrevent}
                      onChange={(e) =>
                        onUpdateTrackMixer(selectedTrack.id, {
                          sidechainDepth: parseFloat(e.target.value),
                        })
                      }
                      className="w-full studio-slider mt-1"
                    />
                  </div>

                  <div className="p-2 bg-[#151A24] border border-[#242C3D] rounded">
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1">
                      <span>SEND A (REVERB)</span>
                      <span className="text-emerald-400 font-semibold">
                        {Math.round(mixer.reverbSend * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={mixer.reverbSend}
                      onWheel={handleWheelPrevent}
                      onChange={(e) =>
                        onUpdateTrackMixer(selectedTrack.id, {
                          reverbSend: parseFloat(e.target.value),
                        })
                      }
                      className="w-full studio-slider"
                    />
                  </div>

                  <div className="p-2 bg-[#151A24] border border-[#242C3D] rounded">
                    <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 mb-1">
                      <span>SEND B (3/16 DELAY)</span>
                      <span className="text-purple-400 font-semibold">
                        {Math.round(mixer.delaySend * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={mixer.delaySend}
                      onWheel={handleWheelPrevent}
                      onChange={(e) =>
                        onUpdateTrackMixer(selectedTrack.id, {
                          delaySend: parseFloat(e.target.value),
                        })
                      }
                      className="w-full studio-slider"
                    />
                  </div>
                </div>
              )}

              {selectedTrack && (
                <div className="grid grid-cols-2 gap-1.5 max-h-[125px] overflow-y-auto pr-0.5">
                  {selectedTrack.devices.map((device, idx) => (
                    <div
                      key={device.id}
                      className="bg-[#171C26] border border-[#262E3D] rounded p-2 flex flex-col justify-between"
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
                        <span className="text-slate-100 font-semibold truncate">
                          0{idx + 1}. {device.displayName}
                        </span>
                        <span className="text-amber-400/80">&lt;{device.xmlTag}&gt;</span>
                      </div>
                      <div className="mt-1 space-y-0.5 border-t border-[#232934] pt-1">
                        {device.parameters.slice(0, 2).map((param) => (
                          <div
                            key={param.name}
                            className="flex items-center justify-between text-[10px] font-mono tabular-nums"
                          >
                            <span className="text-slate-400 truncate pr-1">{param.name}</span>
                            <span
                              className={
                                param.automationTarget
                                  ? 'text-amber-400 font-semibold'
                                  : 'text-slate-200'
                              }
                            >
                              {param.value}
                              {param.unit ? ` ${param.unit}` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* SUB-TAB 3: ABLETON LIVE 12 BUILT-IN PLUGIN, INSTRUMENT & RACK BROWSER */}
          {leftColTab === 'library' && (
            <div className="p-2 bg-[#141923] border border-[#253042] rounded space-y-2">
              <div className="flex items-center justify-between gap-1 flex-wrap">
                {(['all', 'instrument', 'audio_effect', 'midi_effect', 'rack'] as const).map(
                  (cat) => (
                    <button
                      key={cat}
                      type="button"
                      onClick={() => setLibraryCategory(cat)}
                      className={`px-1.5 py-0.5 text-[9px] font-mono rounded border transition-colors ${
                        libraryCategory === cat
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500/50 font-semibold'
                          : 'bg-[#0C1017] text-slate-400 border-[#222B3C] hover:text-slate-200'
                      }`}
                    >
                      {cat === 'all'
                        ? 'ALL'
                        : cat === 'audio_effect'
                        ? 'AUDIO FX'
                        : cat === 'midi_effect'
                        ? 'MIDI FX'
                        : cat.toUpperCase()}
                    </button>
                  )
                )}
              </div>

              <div className="max-h-[168px] overflow-y-auto space-y-1 pr-0.5">
                {filteredLibrary.map((tpl) => (
                  <div
                    key={tpl.id}
                    className="p-1.5 bg-[#0D1119] border border-[#20293A] rounded flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[10px] font-mono">
                        <span className="font-semibold text-slate-100 truncate">
                          {tpl.displayName}
                        </span>
                        <span className="text-amber-400/80 text-[9px]">&lt;{tpl.xmlTag}&gt;</span>
                      </div>
                      <div className="text-[9px] font-mono text-slate-400 truncate">
                        {tpl.description}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={!selectedTrack}
                      onClick={() =>
                        selectedTrack &&
                        onInjectLibraryDevice &&
                        onInjectLibraryDevice(selectedTrack.id, tpl.id)
                      }
                      className="px-2 py-1 bg-[#1C2536] hover:bg-amber-500 hover:text-slate-950 text-amber-300 border border-[#2E3C56] rounded text-[9px] font-mono font-semibold shrink-0 transition-colors"
                    >
                      + XML
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="pt-1.5 border-t border-[#1E2430] flex items-center justify-between text-[10px] font-mono text-slate-400">
          <span>
            Chain: {selectedTrack?.devices.length || 0} XML Devices ·{' '}
            {selectedTrack?.spectralDucking?.enabled ? 'EQ8 Notch ON' : 'Standard'}
          </span>
          <span>
            {selectedTrack?.clips.reduce((acc, c) => acc + c.notes.length, 0) || 0} &lt;MidiNoteEvent&gt;
          </span>
        </div>
      </div>

      {/* Column 2: Per-Track Velocity Curve Map Injector & Anti-Slop Micro-Timing (4 cols) */}
      <div className="lg:col-span-4 p-3.5 border-b lg:border-b-0 lg:border-r border-[#232934] flex flex-col justify-between space-y-2.5">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sliders className="w-4 h-4 text-sky-400 shrink-0" />
              <h3 className="text-xs font-mono font-semibold tracking-wider text-slate-200">
                VELOCITY CURVE &amp; ANTI-SLOP HUMANIZER
              </h3>
            </div>

            <button
              type="button"
              onClick={onRehumanizeAll}
              className="px-2.5 py-1 text-[11px] font-mono font-semibold bg-amber-500 hover:bg-amber-400 text-slate-950 rounded flex items-center gap-1 transition-colors whitespace-nowrap shrink-0 shadow-sm"
              title="Recalculate Gaussian micro-timing shifts and inject per-track velocity curves into XML <MidiNoteEvent> nodes"
            >
              <RefreshCw className="w-3 h-3" />
              Re-Seed Jitter (#{currentSeed % 1000})
            </button>
          </div>

          {/* Interactive Per-Track Velocity Curve & Preset Map Control Panel */}
          <div className="p-2.5 bg-[#141923] border border-[#253042] rounded space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <PenTool className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span className="text-[11px] font-mono font-semibold text-slate-200 truncate">
                  TRACK VELOCITY MAP: {selectedTrack?.name || 'None'}
                </span>
              </div>
              <div className="flex items-center bg-[#0B0E14] border border-[#232B3A] rounded p-0.5 text-[9px] font-mono shrink-0">
                <button
                  type="button"
                  onClick={() => updateVelocityCurve({ scopeMode: 'bar_16th' }, true)}
                  className={`px-1.5 py-0.5 rounded transition-colors ${
                    activeVelocityCurve.scopeMode === 'bar_16th'
                      ? 'bg-[#1F293D] text-amber-300 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  1-BAR 16TH
                </button>
                <button
                  type="button"
                  onClick={() => updateVelocityCurve({ scopeMode: 'arrangement_16bar' }, true)}
                  className={`px-1.5 py-0.5 rounded transition-colors ${
                    activeVelocityCurve.scopeMode === 'arrangement_16bar'
                      ? 'bg-[#1F293D] text-sky-300 font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  MACRO ARC
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1">
              {VELOCITY_PRESETS.map((preset) => {
                const isActive = activeVelocityCurve.preset === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => handleSelectVelocityPreset(preset.id)}
                    title={preset.shortDesc}
                    className={`px-1.5 py-1 text-[10px] font-mono rounded border transition-colors truncate ${
                      isActive
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/60 font-semibold'
                        : 'bg-[#181F2C] text-slate-400 border-[#263143] hover:text-slate-200 hover:border-[#34435B]'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 tabular-nums">
                <span>
                  {activeVelocityCurve.preset === 'custom'
                    ? 'MODE: CUSTOM DRAWN CURVE'
                    : `PRESET: ${activeVelocityCurve.preset.toUpperCase()}`}{' '}
                  (Drag to draw)
                </span>
                <span className="text-amber-400 font-semibold">
                  {hoveredStepIdx !== null
                    ? `${activeVelocityCurve.scopeMode === 'bar_16th' ? 'Step' : 'Zone'} ${
                        hoveredStepIdx + 1
                      }: Vel ${Math.round(
                        activeVelocityCurve.minVelocity +
                          (curvePointsList[hoveredStepIdx] ?? 0.75) *
                            (activeVelocityCurve.maxVelocity - activeVelocityCurve.minVelocity)
                      )}`
                    : `Range: Vel ${activeVelocityCurve.minVelocity}–${activeVelocityCurve.maxVelocity}`}
                </span>
              </div>

              <div
                ref={curveContainerRef}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setIsDrawingCurve(true);
                  applyPointerToCurve(e.clientX, e.clientY);
                }}
                onPointerMove={(e) => {
                  if (isDrawingCurve) {
                    applyPointerToCurve(e.clientX, e.clientY);
                  } else if (curveContainerRef.current) {
                    const rect = curveContainerRef.current.getBoundingClientRect();
                    const relX = Math.max(0, Math.min(0.999, (e.clientX - rect.left) / rect.width));
                    setHoveredStepIdx(Math.min(15, Math.max(0, Math.floor(relX * 16))));
                  }
                }}
                onPointerUp={(e) => {
                  if (e.currentTarget.hasPointerCapture(e.pointerId)) {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  }
                  setIsDrawingCurve(false);
                }}
                onPointerLeave={() => {
                  setIsDrawingCurve(false);
                  setHoveredStepIdx(null);
                }}
                className="relative h-20 bg-[#0B0E14] border border-[#253044] rounded overflow-hidden select-none touch-none cursor-crosshair"
              >
                <div
                  className="absolute inset-x-0 border-t border-dashed border-amber-500/20 pointer-events-none"
                  style={{ top: '22%' }}
                />
                <div
                  className="absolute inset-x-0 border-t border-dashed border-sky-400/25 pointer-events-none"
                  style={{ top: '68%' }}
                />

                <div className="absolute inset-0 grid grid-cols-16 gap-0.5 p-1 items-end">
                  {curvePointsList.map((normVal, idx) => {
                    const clamped = Math.max(0.05, Math.min(1, normVal));
                    const mappedVel = Math.round(
                      activeVelocityCurve.minVelocity +
                        clamped * (activeVelocityCurve.maxVelocity - activeVelocityCurve.minVelocity)
                    );
                    const isGhostZone = mappedVel <= humanization.ghostVelocityMax;
                    const isAccentZone = mappedVel >= 100;
                    const isQuarterBeat = idx % 4 === 0;

                    return (
                      <div
                        key={idx}
                        className={`relative h-full flex flex-col justify-end rounded-xs ${
                          isQuarterBeat ? 'bg-[#121824]/70' : 'bg-transparent'
                        }`}
                      >
                        <div
                          style={{ height: `${Math.round(clamped * 100)}%` }}
                          className={`w-full rounded-t-xs transition-all duration-75 ${
                            hoveredStepIdx === idx
                              ? 'bg-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.6)]'
                              : isAccentZone
                              ? 'bg-amber-500/85'
                              : isGhostZone
                              ? 'bg-sky-400/75'
                              : 'bg-emerald-400/75'
                          }`}
                        />
                      </div>
                    );
                  })}
                </div>

                <svg
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  className="absolute inset-0 w-full h-full pointer-events-none"
                >
                  <polyline
                    fill="none"
                    stroke="#F59E0B"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    points={svgPolylinePoints}
                  />
                </svg>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 pt-0.5">
              <div className="bg-[#0E131C] border border-[#222B3C] rounded p-1.5">
                <div className="flex items-center justify-between text-[10px] font-mono tabular-nums mb-1">
                  <span className="text-slate-400">CURVE DEPTH</span>
                  <span className="text-amber-400 font-semibold">
                    {Math.round(activeVelocityCurve.intensity * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={activeVelocityCurve.intensity}
                  onWheel={handleWheelPrevent}
                  onChange={(e) =>
                    updateVelocityCurve({ intensity: parseFloat(e.target.value) }, true)
                  }
                  className="w-full studio-slider"
                />
              </div>

              <div className="bg-[#0E131C] border border-[#222B3C] rounded p-1.5">
                <div className="flex items-center justify-between text-[10px] font-mono tabular-nums mb-1">
                  <span className="text-slate-400">PEAK CEILING</span>
                  <span className="text-emerald-400 font-semibold">
                    Vel {activeVelocityCurve.maxVelocity}
                  </span>
                </div>
                <input
                  type="range"
                  min={75}
                  max={127}
                  step={1}
                  value={activeVelocityCurve.maxVelocity}
                  onWheel={handleWheelPrevent}
                  onChange={(e) =>
                    updateVelocityCurve({ maxVelocity: parseInt(e.target.value, 10) }, true)
                  }
                  className="w-full studio-slider"
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <div className="p-2 bg-[#141923] border border-[#232B39] rounded">
              <div className="flex items-center justify-between text-[10px] font-mono tabular-nums mb-1">
                <span className="text-slate-400 truncate">16TH SHIFT</span>
                <span className="text-amber-400 font-semibold">
                  ±{humanization.microTimingMaxShiftBeats.toFixed(3)}b
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={0.03}
                step={0.001}
                value={humanization.microTimingMaxShiftBeats}
                onWheel={handleWheelPrevent}
                onChange={(e) =>
                  onUpdateHumanization({ microTimingMaxShiftBeats: parseFloat(e.target.value) })
                }
                className="w-full studio-slider"
              />
            </div>

            <div className="p-2 bg-[#141923] border border-[#232B39] rounded">
              <div className="flex items-center justify-between text-[10px] font-mono tabular-nums mb-1">
                <span className="text-slate-400 truncate" title="16th-Note Swing Strength">
                  Swing Strength
                </span>
                <span className="text-emerald-400 font-semibold">
                  {Math.round(humanization.swingStrength ?? 0)}%
                </span>
              </div>
              <input
                type="range"
                aria-label="Swing Strength"
                min={0}
                max={100}
                step={1}
                value={humanization.swingStrength ?? 0}
                onWheel={handleWheelPrevent}
                onChange={(e) =>
                  onUpdateHumanization({ swingStrength: parseInt(e.target.value, 10) })
                }
                className="w-full studio-slider"
              />
            </div>

            <div className="p-2 bg-[#141923] border border-[#232B39] rounded">
              <div className="flex items-center justify-between text-[10px] font-mono tabular-nums mb-1">
                <span
                  className="text-slate-400 truncate"
                  title="Dilla-style BPM-dependent 16th-note push/pull pocket groove"
                >
                  Shuffle Swing
                </span>
                <span className="text-fuchsia-400 font-semibold">
                  {Math.round(humanization.shuffleSwing ?? 0)}%
                </span>
              </div>
              <input
                type="range"
                aria-label="Shuffle Swing"
                min={-100}
                max={100}
                step={1}
                value={humanization.shuffleSwing ?? 0}
                onWheel={handleWheelPrevent}
                onChange={(e) =>
                  onUpdateHumanization({ shuffleSwing: parseInt(e.target.value, 10) })
                }
                className="w-full studio-slider"
              />
            </div>

            <div className="p-2 bg-[#141923] border border-[#232B39] rounded">
              <div className="flex items-center justify-between text-[10px] font-mono tabular-nums mb-1">
                <span className="text-slate-400 truncate">VEL JITTER</span>
                <span className="text-amber-400 font-semibold">
                  ±{Math.round(humanization.velocityVariancePct * 100)}%
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={0.2}
                step={0.01}
                value={humanization.velocityVariancePct}
                onWheel={handleWheelPrevent}
                onChange={(e) =>
                  onUpdateHumanization({ velocityVariancePct: parseFloat(e.target.value) })
                }
                className="w-full studio-slider"
              />
            </div>

            <div className="p-2 bg-[#141923] border border-[#232B39] rounded">
              <div className="flex items-center justify-between text-[10px] font-mono tabular-nums mb-1">
                <span className="text-slate-400 truncate">GHOST MAX</span>
                <span className="text-sky-400 font-semibold">
                  Vel {humanization.ghostVelocityMax}
                </span>
              </div>
              <input
                type="range"
                min={28}
                max={60}
                step={1}
                value={humanization.ghostVelocityMax}
                onWheel={handleWheelPrevent}
                onChange={(e) =>
                  onUpdateHumanization({ ghostVelocityMax: parseInt(e.target.value, 10) })
                }
                className="w-full studio-slider"
              />
            </div>
          </div>
        </div>

        <div className="pt-1.5 border-t border-[#1E2430] flex items-center justify-between text-[10px] font-mono text-slate-400">
          <span>
            XML &lt;MidiNoteEvent Velocity&gt; Map: {activeVelocityCurve.preset.toUpperCase()}
          </span>
          <span className="text-emerald-400">Injected on Rehumanize</span>
        </div>
      </div>

      {/* Column 3: Real-Time Spectrum Analyzer, LFO Drift, Return Reverb/Delay & Master Bus Glue Rack (4 cols) */}
      <div className="lg:col-span-4 p-3.5 flex flex-col justify-between space-y-2.5">
        <div className="space-y-2">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <Activity className="w-4 h-4 text-emerald-400 shrink-0" />
              <h3 className="text-xs font-mono font-semibold tracking-wider text-slate-200 uppercase">
                MASTER SPECTRUM &amp; BUS
              </h3>
            </div>

            <div className="flex items-center bg-[#090C12] border border-[#232B3B] rounded p-0.5 text-[9px] font-mono">
              <button
                type="button"
                onClick={() => setMasterViewMode('split')}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  masterViewMode === 'split'
                    ? 'bg-[#1F2738] text-amber-300 font-semibold shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                SPLIT
              </button>
              <button
                type="button"
                onClick={() => setMasterViewMode('spectrum')}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  masterViewMode === 'spectrum'
                    ? 'bg-[#1F2738] text-amber-300 font-semibold shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                SPECTRUM
              </button>
              <button
                type="button"
                onClick={() => setMasterViewMode('params')}
                className={`px-1.5 py-0.5 rounded transition-colors ${
                  masterViewMode === 'params'
                    ? 'bg-[#1F2738] text-amber-300 font-semibold shadow-xs'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                PARAMS
              </button>
            </div>
          </div>

          {(masterViewMode === 'split' || masterViewMode === 'spectrum') && (
            <MasterSpectrumAnalyzer isPlaying={isPlaying} tempo={tempo} />
          )}

          {(masterViewMode === 'split' || masterViewMode === 'params') && (
            <div className="grid grid-cols-2 gap-1.5 pt-0.5">
              <div className="p-1.5 bg-[#141923] border border-[#232B39] rounded">
                <div className="flex justify-between text-[10px] font-mono tabular-nums mb-1">
                  <span className="text-slate-300">LFO DRIFT RATE</span>
                  <span className="text-amber-400 font-semibold">
                    {humanization.lfoRateHz.toFixed(2)} Hz
                  </span>
                </div>
                <input
                  type="range"
                  min={0.02}
                  max={0.5}
                  step={0.01}
                  value={humanization.lfoRateHz}
                  onWheel={handleWheelPrevent}
                  onChange={(e) =>
                    onUpdateHumanization({ lfoRateHz: parseFloat(e.target.value) })
                  }
                  className="w-full studio-slider"
                />
              </div>

              <div className="p-1.5 bg-[#141923] border border-[#232B39] rounded">
                <div className="flex justify-between text-[10px] font-mono tabular-nums mb-1">
                  <span className="text-slate-300">MACRO TRANSITION</span>
                  <span className="text-sky-400 font-semibold">
                    {humanization.macroTransition} / 127
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={127}
                  step={1}
                  value={humanization.macroTransition}
                  onWheel={handleWheelPrevent}
                  onChange={(e) =>
                    onUpdateHumanization({ macroTransition: parseInt(e.target.value, 10) })
                  }
                  className="w-full studio-slider"
                />
              </div>

              <div className="p-1.5 bg-[#141923] border border-[#232B39] rounded">
                <div className="flex justify-between text-[10px] font-mono tabular-nums mb-1">
                  <span className="text-slate-300">RETURN A REVERB</span>
                  <span className="text-emerald-400 font-semibold">
                    {Math.round(masterBus.reverbReturnLevel * 100)}% ({masterBus.reverbDecaySec.toFixed(1)}s)
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={masterBus.reverbReturnLevel}
                  onWheel={handleWheelPrevent}
                  onChange={(e) =>
                    onUpdateMasterBus({ reverbReturnLevel: parseFloat(e.target.value) })
                  }
                  className="w-full studio-slider"
                />
              </div>

              <div className="p-1.5 bg-[#141923] border border-[#232B39] rounded">
                <div className="flex justify-between text-[10px] font-mono tabular-nums mb-1">
                  <span className="text-slate-300">RETURN B 3/16 ECHO</span>
                  <span className="text-purple-400 font-semibold">
                    FB {Math.round(masterBus.delayFeedback * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0.1}
                  max={0.82}
                  step={0.02}
                  value={masterBus.delayFeedback}
                  onWheel={handleWheelPrevent}
                  onChange={(e) =>
                    onUpdateMasterBus({ delayFeedback: parseFloat(e.target.value) })
                  }
                  className="w-full studio-slider"
                />
              </div>

              <div className="p-1.5 bg-[#141923] border border-[#232B39] rounded">
                <div className="flex justify-between text-[10px] font-mono tabular-nums mb-1">
                  <span className="text-slate-300">GLUE COMP DRIVE</span>
                  <span className="text-amber-400 font-semibold">
                    {Math.round(masterBus.glueCompressionDrive * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={masterBus.glueCompressionDrive}
                  onWheel={handleWheelPrevent}
                  onChange={(e) =>
                    onUpdateMasterBus({ glueCompressionDrive: parseFloat(e.target.value) })
                  }
                  className="w-full studio-slider"
                />
              </div>

              <div className="p-1.5 bg-[#141923] border border-[#232B39] rounded">
                <div className="flex justify-between text-[10px] font-mono tabular-nums mb-1">
                  <span className="text-slate-300">MASTER OUT</span>
                  <span className="text-slate-100 font-semibold">
                    {masterBus.masterVolumeDb > 0
                      ? `+${masterBus.masterVolumeDb.toFixed(1)}`
                      : masterBus.masterVolumeDb.toFixed(1)}{' '}
                    dB
                  </span>
                </div>
                <input
                  type="range"
                  min={-12}
                  max={6}
                  step={0.5}
                  value={masterBus.masterVolumeDb}
                  onWheel={handleWheelPrevent}
                  onChange={(e) =>
                    onUpdateMasterBus({ masterVolumeDb: parseFloat(e.target.value) })
                  }
                  className="w-full studio-slider"
                />
              </div>
            </div>
          )}
        </div>

        <div className="pt-1.5 border-t border-[#1E2430] flex items-center gap-2 text-[10px] font-mono">
          <Volume2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          <span className="text-slate-400 shrink-0">MASTER METER:</span>
          <div className="flex-1 h-2 bg-[#0B0D10] rounded-full overflow-hidden border border-[#232934]">
            <div
              className="h-full bg-gradient-to-r from-emerald-500 via-amber-400 to-rose-500 transition-all duration-75"
              style={{ width: `${meterPercent}%` }}
            />
          </div>
          <span className="text-slate-300 tabular-nums w-12 text-right">
            {masterPeakDb <= -48 ? '-∞' : `${masterPeakDb.toFixed(1)}dB`}
          </span>
        </div>
      </div>
    </div>
  );
};
