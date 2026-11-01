import React, { useEffect, useState, useRef } from 'react';
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  PauseCircle,
  ShieldAlert,
  Sliders,
  Trash2,
  Waves,
  X,
  Zap,
} from 'lucide-react';
import * as d3 from 'd3';
import { synthEngine } from '../engine/webAudioSynth';
import { downloadDebugApk } from '../utils/apkDownloader';

interface DiagnosticsPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

interface LatencySample {
  timestamp: number;
  latencyMs: number;
  underruns: number;
}

interface UnderrunEventItem {
  id: string;
  timestamp: number;
  formattedTime: string;
  latencyMs: number;
  operation: string;
  activeVoices: number;
}

export const DiagnosticsPanel: React.FC<DiagnosticsPanelProps> = ({ isOpen, onClose }) => {
  const [stats, setStats] = useState<{
    bufferUnderruns: number;
    audioThreadLatencyMs: number;
    sampleRate: number;
    state: string;
    activeVoices: number;
    isPlaying: boolean;
    currentCpuOperation: string;
    underrunEvents: UnderrunEventItem[];
    stabilityThresholdMs: number;
    stabilityAutoPauseEnabled: boolean;
    lastAutoPauseReason: string | null;
    lastAutoPauseTimestamp: number | null;
  }>(() => synthEngine.getDiagnostics());

  const [thresholdMs, setThresholdMs] = useState<number>(
    () => synthEngine.getStabilityThreshold().thresholdMs
  );
  const [autoPauseEnabled, setAutoPauseEnabled] = useState<boolean>(
    () => synthEngine.getStabilityThreshold().autoPauseEnabled
  );
  const [history, setHistory] = useState<LatencySample[]>(() => {
    const initDiag = synthEngine.getDiagnostics();
    return [
      {
        timestamp: Date.now() - 100,
        latencyMs: initDiag.audioThreadLatencyMs,
        underruns: initDiag.bufferUnderruns,
      },
      {
        timestamp: Date.now(),
        latencyMs: initDiag.audioThreadLatencyMs,
        underruns: initDiag.bufferUnderruns,
      },
    ];
  });
  const [downloadingApk, setDownloadingApk] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Poll synthEngine diagnostics every 100ms as requested
  useEffect(() => {
    if (!isOpen) return;

    const timer = setInterval(() => {
      const diag = synthEngine.getDiagnostics();
      setStats(diag);

      setHistory((prev) => {
        const next = [
          ...prev,
          {
            timestamp: Date.now(),
            latencyMs: diag.audioThreadLatencyMs,
            underruns: diag.bufferUnderruns,
          },
        ];
        if (next.length > 50) next.shift();
        return next;
      });
    }, 100);

    return () => clearInterval(timer);
  }, [isOpen]);

  const handleThresholdChange = (newThreshold: number, newEnabled = autoPauseEnabled) => {
    setThresholdMs(newThreshold);
    setAutoPauseEnabled(newEnabled);
    synthEngine.setStabilityThreshold(newThreshold, newEnabled);
  };

  const handleSimulateSpike = () => {
    synthEngine.simulateLatencySpike(Number((thresholdMs + 3.6).toFixed(1)));
    setStats(synthEngine.getDiagnostics());
  };

  const handleClearUnderruns = () => {
    synthEngine.clearUnderrunEvents();
    setStats(synthEngine.getDiagnostics());
  };

  const handleDownloadApk = async () => {
    if (downloadingApk) return;
    setDownloadingApk(true);
    try {
      await downloadDebugApk('parametric-techno-daw-debug.apk');
    } finally {
      setDownloadingApk(false);
    }
  };

  // Render live latency D3 line chart with threshold line
  useEffect(() => {
    if (!isOpen || !svgRef.current || history.length === 0) return;

    const svgElement = d3.select(svgRef.current);
    svgElement.selectAll('*').remove();

    const width = 360;
    const height = 115;
    const margin = { top: 10, right: 15, bottom: 20, left: 32 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svgElement
      .attr('viewBox', `0 0 ${width} ${height}`)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const xScale = d3
      .scaleLinear()
      .domain([0, Math.max(49, history.length - 1)])
      .range([0, innerWidth]);

    const maxLatency = Math.max(
      14,
      thresholdMs + 3,
      d3.max(history, (d) => d.latencyMs) || 14
    );
    const yScale = d3
      .scaleLinear()
      .domain([0, maxLatency])
      .range([innerHeight, 0])
      .nice();

    const defs = svgElement.append('defs');
    const areaGradient = defs
      .append('linearGradient')
      .attr('id', 'latency-gradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%');

    areaGradient
      .append('stop')
      .attr('offset', '0%')
      .attr('stop-color', '#10B981')
      .attr('stop-opacity', 0.4);

    areaGradient
      .append('stop')
      .attr('offset', '100%')
      .attr('stop-color', '#10B981')
      .attr('stop-opacity', 0.0);

    // Horizontal Grid Lines
    const yTicks = yScale.ticks(4);
    g.selectAll('.grid-line')
      .data(yTicks)
      .enter()
      .append('line')
      .attr('class', 'grid-line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', '#1F2733')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2,2');

    // Audio Stability Threshold horizontal line
    if (autoPauseEnabled && thresholdMs <= maxLatency) {
      const threshY = yScale(thresholdMs);
      g.append('line')
        .attr('x1', 0)
        .attr('x2', innerWidth)
        .attr('y1', threshY)
        .attr('y2', threshY)
        .attr('stroke', '#F43F5E')
        .attr('stroke-width', 1.2)
        .attr('stroke-dasharray', '4,3');

      g.append('text')
        .attr('x', innerWidth - 4)
        .attr('y', Math.max(8, threshY - 3))
        .attr('text-anchor', 'end')
        .attr('fill', '#FDA4AF')
        .attr('font-size', '8px')
        .attr('font-family', 'monospace')
        .text(`Limit ${thresholdMs.toFixed(1)}ms`);
    }

    // Axes
    const yAxis = d3.axisLeft(yScale).ticks(3).tickFormat((d) => `${d}ms`);
    g.append('g')
      .call(yAxis)
      .selectAll('text')
      .attr('fill', '#94A3B8')
      .attr('font-size', '9px')
      .attr('font-family', 'monospace');

    g.selectAll('.domain, .tick line').attr('stroke', '#273244');

    const areaGenerator = d3
      .area<LatencySample>()
      .x((_, i) => xScale(i))
      .y0(innerHeight)
      .y1((d) => yScale(d.latencyMs))
      .curve(d3.curveMonotoneX);

    const lineGenerator = d3
      .line<LatencySample>()
      .x((_, i) => xScale(i))
      .y((d) => yScale(d.latencyMs))
      .curve(d3.curveMonotoneX);

    g.append('path')
      .datum(history)
      .attr('fill', 'url(#latency-gradient)')
      .attr('d', areaGenerator);

    const isExceeding = stats.audioThreadLatencyMs > thresholdMs;

    g.append('path')
      .datum(history)
      .attr('fill', 'none')
      .attr('stroke', isExceeding ? '#F43F5E' : '#10B981')
      .attr('stroke-width', 2)
      .attr('d', lineGenerator);

    const lastIndex = history.length - 1;
    const lastPoint = history[lastIndex];
    if (lastPoint) {
      const cx = xScale(lastIndex);
      const cy = yScale(lastPoint.latencyMs);

      g.append('circle')
        .attr('cx', cx)
        .attr('cy', cy)
        .attr('r', 4)
        .attr('fill', isExceeding ? '#F43F5E' : '#34D399')
        .attr('stroke', '#0B0E14')
        .attr('stroke-width', 1.5);
    }
  }, [history, isOpen, thresholdMs, autoPauseEnabled, stats.audioThreadLatencyMs]);

  if (!isOpen) return null;

  const isHealthy =
    stats.audioThreadLatencyMs <= thresholdMs && !stats.lastAutoPauseReason;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-96 sm:w-[440px] bg-[#0B0E14] border-l border-[#232B38] shadow-2xl flex flex-col font-mono text-xs text-slate-200 animate-slideLeft">
      {/* Drawer Header */}
      <div className="px-4 py-3 bg-[#090C11] border-b border-[#1F2734] flex items-center justify-between select-none">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-emerald-400 animate-pulse" />
          <h3 className="font-display font-semibold text-sm text-slate-100">
            Real-Time Audio Diagnostics &amp; Protection
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-[#1A202C] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Drawer Body */}
      <div className="p-4 space-y-4 flex-1 overflow-y-auto">
        {/* Status Indicator Banner */}
        <div
          className={`p-3 rounded-md border flex items-start gap-3 ${
            isHealthy
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-rose-500/10 border-rose-500/30 text-rose-300'
          }`}
        >
          {isHealthy ? (
            <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400 mt-0.5" />
          ) : (
            <PauseCircle className="w-5 h-5 shrink-0 text-rose-400 mt-0.5" />
          )}
          <div className="flex-1 min-w-0">
            <div className="font-bold">
              {stats.lastAutoPauseReason
                ? 'Playback Auto-Paused (Clipping Prevented)'
                : isHealthy
                ? 'Audio Engine Stable Below Threshold'
                : 'Latency Threshold Exceeded'}
            </div>
            <div className="text-[10px] opacity-85 mt-0.5 leading-relaxed">
              {stats.lastAutoPauseReason
                ? stats.lastAutoPauseReason
                : `Audio thread latency (${stats.audioThreadLatencyMs} ms) is within the ${thresholdMs.toFixed(
                    1
                  )} ms stability ceiling.`}
            </div>
          </div>
          {stats.lastAutoPauseReason && (
            <button
              type="button"
              onClick={() => {
                synthEngine.clearAutoPauseAlert();
                setStats(synthEngine.getDiagnostics());
              }}
              className="px-2 py-0.5 text-[10px] rounded bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-500/40 shrink-0"
            >
              Dismiss
            </button>
          )}
        </div>

        {/* Key Metrics Cards */}
        <div className="grid grid-cols-2 gap-2.5">
          <div className="p-2.5 bg-[#11151C] border border-[#232B38] rounded-md">
            <div className="text-[10px] text-slate-400">Audio Thread Latency</div>
            <div
              className={`text-base font-bold mt-0.5 ${
                stats.audioThreadLatencyMs > thresholdMs
                  ? 'text-rose-400'
                  : 'text-emerald-400'
              }`}
            >
              {stats.audioThreadLatencyMs} ms
            </div>
          </div>
          <div className="p-2.5 bg-[#11151C] border border-[#232B38] rounded-md">
            <div className="text-[10px] text-slate-400">Buffer Underruns</div>
            <div
              className={`text-base font-bold mt-0.5 ${
                stats.bufferUnderruns > 0 ? 'text-amber-400' : 'text-cyan-400'
              }`}
            >
              {stats.bufferUnderruns} Events
            </div>
          </div>
          <div className="p-2.5 bg-[#11151C] border border-[#232B38] rounded-md">
            <div className="text-[10px] text-slate-400">Active Synth Voices</div>
            <div className="text-base font-bold text-amber-400 mt-0.5">
              {stats.activeVoices} Voices
            </div>
          </div>
          <div className="p-2.5 bg-[#11151C] border border-[#232B38] rounded-md">
            <div className="text-[10px] text-slate-400">Audio Context State</div>
            <div className="text-xs font-bold text-purple-400 uppercase mt-1">
              {stats.state}
            </div>
          </div>
        </div>

        {/* Live Latency Graph Card (D3.js Line Chart) */}
        <div className="p-3 bg-[#11151C] border border-[#232B38] rounded-md space-y-2">
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-slate-300 flex items-center gap-1.5">
              <Waves className="w-3.5 h-3.5 text-emerald-400" />
              D3 Latency Stability Graph (100ms)
            </span>
            <span className="text-emerald-400 font-mono">
              {stats.audioThreadLatencyMs}ms / {thresholdMs.toFixed(1)}ms max
            </span>
          </div>
          <div className="bg-[#080A0D] border border-[#1F2733] rounded overflow-hidden p-1">
            <svg ref={svgRef} className="w-full h-28 block" />
          </div>
        </div>

        {/* Audio Stability Threshold Setting Card */}
        <div className="p-3.5 bg-[#11151C] border border-[#232B38] rounded-md space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              <span className="font-semibold text-slate-100 text-xs">
                Audio Stability Threshold
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleThresholdChange(thresholdMs, !autoPauseEnabled)}
              className={`px-2 py-0.5 rounded text-[10px] font-bold border transition ${
                autoPauseEnabled
                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                  : 'bg-slate-800 text-slate-400 border-slate-700'
              }`}
            >
              {autoPauseEnabled ? 'Auto-Pause ON' : 'Auto-Pause OFF'}
            </button>
          </div>

          <p className="text-[10px] text-slate-400 leading-relaxed">
            Automatically pauses playback if audio thread latency exceeds the threshold below, preventing buffer starvation and harsh digital clipping.
          </p>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px]">
              <span className="text-slate-400">Max Allowed Latency Ceiling:</span>
              <span className="font-bold text-amber-400">{thresholdMs.toFixed(1)} ms</span>
            </div>
            <input
              type="range"
              min={3.0}
              max={25.0}
              step={0.5}
              value={thresholdMs}
              onChange={(e) => handleThresholdChange(parseFloat(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />
            <div className="flex items-center justify-between gap-1.5 pt-1">
              {[
                { label: 'Strict (5ms)', val: 5.0 },
                { label: 'Balanced (12ms)', val: 12.0 },
                { label: 'Relaxed (18ms)', val: 18.0 },
              ].map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => handleThresholdChange(preset.val)}
                  className={`flex-1 py-1 px-1.5 rounded text-[10px] border transition ${
                    Math.abs(thresholdMs - preset.val) < 0.1
                      ? 'bg-amber-500 text-slate-950 font-bold border-amber-400'
                      : 'bg-[#0B0E14] text-slate-400 border-[#232B38] hover:text-slate-200'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          <div className="pt-1 flex items-center justify-between gap-2 border-t border-[#1F2733]">
            <span className="text-[10px] text-slate-400 truncate">
              Active DSP: {stats.currentCpuOperation}
            </span>
            <button
              type="button"
              onClick={handleSimulateSpike}
              className="px-2.5 py-1 bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/40 rounded text-[10px] font-bold flex items-center gap-1 shrink-0 transition"
              title="Simulate a high-load CPU latency spike exceeding the threshold to test automatic playback pause and underrun logging"
            >
              <Zap className="w-3 h-3 text-rose-400" />
              <span>Test Spike</span>
            </button>
          </div>
        </div>

        {/* Last 10 Buffer Underrun Events Table */}
        <div className="p-3 bg-[#11151C] border border-[#232B38] rounded-md space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span className="font-semibold text-slate-100 text-[11px]">
                Last 10 Buffer Underrun Events
              </span>
            </div>
            <button
              type="button"
              onClick={handleClearUnderruns}
              className="px-2 py-0.5 bg-[#19202B] hover:bg-[#232D3D] text-slate-300 border border-[#2B3648] rounded text-[10px] flex items-center gap-1 transition"
            >
              <Trash2 className="w-2.5 h-2.5" />
              <span>Clear</span>
            </button>
          </div>

          <div className="border border-[#1F2733] rounded overflow-hidden bg-[#080A0E]">
            <table className="w-full text-left border-collapse text-[10px]">
              <thead>
                <tr className="bg-[#121722] text-slate-400 border-b border-[#1F2733]">
                  <th className="py-1.5 px-2 font-semibold">Timestamp</th>
                  <th className="py-1.5 px-2 font-semibold">CPU-Intensive Operation</th>
                  <th className="py-1.5 px-2 font-semibold text-right">Latency</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#161C26]">
                {stats.underrunEvents.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="py-4 text-center text-slate-500">
                      Zero buffer underruns recorded in current session.
                    </td>
                  </tr>
                ) : (
                  stats.underrunEvents.slice(0, 10).map((evt) => (
                    <tr
                      key={evt.id}
                      className="hover:bg-[#131923] transition-colors text-slate-300"
                    >
                      <td className="py-1.5 px-2 font-mono text-cyan-400 whitespace-nowrap align-top">
                        {evt.formattedTime}
                      </td>
                      <td className="py-1.5 px-2 text-slate-200 leading-tight align-top">
                        {evt.operation}
                      </td>
                      <td
                        className={`py-1.5 px-2 font-mono font-bold text-right whitespace-nowrap align-top ${
                          evt.latencyMs > thresholdMs ? 'text-rose-400' : 'text-amber-400'
                        }`}
                      >
                        {evt.latencyMs.toFixed(1)} ms
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Drawer Footer */}
      <div className="px-4 py-3 bg-[#090C11] border-t border-[#1F2734] flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={handleDownloadApk}
          className="px-3 py-1.5 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 rounded text-xs font-bold flex items-center gap-1.5 transition cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-emerald-400" />
          <span>{downloadingApk ? 'Packaging APK...' : 'Download Debug APK'}</span>
        </button>
        <button
          type="button"
          onClick={onClose}
          className="px-3.5 py-1.5 bg-[#1B2230] hover:bg-[#252E40] text-slate-200 border border-[#2E3A4E] rounded text-xs font-bold transition"
        >
          Close Drawer
        </button>
      </div>
    </div>
  );
};


