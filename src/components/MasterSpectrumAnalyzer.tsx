import React, { useEffect, useRef, useState } from 'react';
import { synthEngine } from '../engine/webAudioSynth';
import { Activity, BarChart2, Maximize2, Minimize2, Radio } from 'lucide-react';

interface MasterSpectrumAnalyzerProps {
  isPlaying: boolean;
  tempo: number;
}

const FREQ_TICKS = [
  { freq: 30, label: '30' },
  { freq: 60, label: '60' },
  { freq: 120, label: '120' },
  { freq: 250, label: '250' },
  { freq: 500, label: '500' },
  { freq: 1000, label: '1k' },
  { freq: 2500, label: '2.5k' },
  { freq: 5000, label: '5k' },
  { freq: 10000, label: '10k' },
  { freq: 20000, label: '20k' },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

function freqToNoteName(freq: number): string {
  if (freq < 16) return '';
  const midi = Math.round(12 * Math.log2(freq / 440) + 69);
  if (midi < 0 || midi > 127) return '';
  const note = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

export const MasterSpectrumAnalyzer: React.FC<MasterSpectrumAnalyzerProps> = ({ isPlaying }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [displayMode, setDisplayMode] = useState<'curve' | 'bars'>('curve');
  const [peakHoldEnabled, setPeakHoldEnabled] = useState<boolean>(true);
  const [isExpanded, setIsExpanded] = useState<boolean>(false);
  const [hoverData, setHoverData] = useState<{ freq: number; db: number; note: string; x: number; y: number } | null>(null);
  const [livePeakInfo, setLivePeakInfo] = useState<{
    freq: number;
    note: string;
    db: number;
    peakDbfs: number;
    rmsDb: number;
    kWeightedLufs: number;
  }>({
    freq: 42,
    note: 'F1',
    db: -48,
    peakDbfs: -60,
    rmsDb: -60,
    kWeightedLufs: -60,
  });

  const stateRef = useRef<{
    smoothedData: Float32Array;
    peakHoldData: Float32Array;
    peakHoldDecay: Float32Array;
    rawFreqData: Uint8Array<ArrayBuffer>;
  }>({
    smoothedData: new Float32Array(256),
    peakHoldData: new Float32Array(256),
    peakHoldDecay: new Float32Array(256),
    rawFreqData: new Uint8Array(new ArrayBuffer(256)),
  });

  // Mouse hover listener for frequency inspection cursor
  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const width = rect.width;
    const height = rect.height;

    if (x < 0 || x > width || y < 0 || y > height) {
      setHoverData(null);
      return;
    }

    // Logarithmic frequency mapping from 20 Hz to 20,000 Hz
    const minF = 20;
    const maxF = 20000;
    const freq = minF * Math.pow(maxF / minF, Math.max(0, Math.min(1, x / width)));
    const normAmp = Math.max(0, Math.min(1, 1 - y / height));
    const db = -90 + normAmp * 84; // -90 dB to -6 dB range
    const note = freqToNoteName(freq);

    setHoverData({
      freq: Math.round(freq),
      db: Math.round(db * 10) / 10,
      note,
      x,
      y,
    });
  };

  const handleMouseLeave = () => {
    setHoverData(null);
  };

  useEffect(() => {
    let animId: number;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let lastPeakUpdate = 0;

    const render = (time: number) => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = rect.width;
      const height = rect.height;

      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // Background
      ctx.fillStyle = '#0B0E14';
      ctx.fillRect(0, 0, width, height);

      // Frequency and dB Grid Lines
      const minF = 20;
      const maxF = 20000;
      const logSpan = Math.log10(maxF / minF);

      // Horizontal dB lines (-12, -24, -36, -48 dB)
      const dbLines = [
        { db: -12, label: '-12' },
        { db: -24, label: '-24' },
        { db: -36, label: '-36' },
        { db: -48, label: '-48' },
      ];

      ctx.strokeStyle = '#181E29';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);

      ctx.font = '500 8px "JetBrains Mono", monospace';
      ctx.fillStyle = '#3E4C63';

      dbLines.forEach((line) => {
        // Map -90 dB .. -6 dB to height .. 0
        const norm = (line.db - -90) / 84;
        const y = Math.round(height - norm * height);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
        ctx.fillText(`${line.label}dB`, 3, y - 2);
      });

      // Vertical Frequency Grid Lines
      FREQ_TICKS.forEach((tick) => {
        const x = Math.round((Math.log10(tick.freq / minF) / logSpan) * width);
        ctx.strokeStyle = tick.freq === 60 || tick.freq === 1000 ? '#263245' : '#161B26';
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();

        ctx.fillStyle = tick.freq === 60 || tick.freq === 120 ? '#F59E0B' : '#475569';
        ctx.fillText(tick.label, x + 2, height - 3);
      });
      ctx.setLineDash([]);

      // Fetch Real-time FFT Frequency Data
      const binCount = synthEngine.getFrequencyBinCount();
      if (stateRef.current.rawFreqData.length !== binCount) {
        stateRef.current.rawFreqData = new Uint8Array(new ArrayBuffer(binCount));
        stateRef.current.smoothedData = new Float32Array(binCount);
        stateRef.current.peakHoldData = new Float32Array(binCount);
        stateRef.current.peakHoldDecay = new Float32Array(binCount);
      }

      const raw = stateRef.current.rawFreqData;
      synthEngine.getByteFrequencyData(raw);

      const smoothed = stateRef.current.smoothedData;
      const peakHold = stateRef.current.peakHoldData;

      const audioCtx = synthEngine.getAudioContext();
      const sampleRate = audioCtx ? audioCtx.sampleRate : 44100;
      const nyquist = sampleRate / 2;

      // Smooth data with exponential decay ballistics
      let currentMaxVal = 0;
      let currentMaxBin = 0;

      for (let i = 0; i < binCount; i++) {
        const target = raw[i];
        if (target > smoothed[i]) {
          // Fast attack (18ms)
          smoothed[i] += (target - smoothed[i]) * 0.45;
        } else {
          // Slow authentic decay
          smoothed[i] += (target - smoothed[i]) * 0.08;
        }

        if (smoothed[i] > currentMaxVal && i > 1) {
          currentMaxVal = smoothed[i];
          currentMaxBin = i;
        }

        // Peak Hold logic with slow gravity drop
        if (smoothed[i] > peakHold[i]) {
          peakHold[i] = smoothed[i];
        } else {
          peakHold[i] = Math.max(0, peakHold[i] - 0.45);
        }
      }

      // Update Live Peak Frequency diagnostics every 100ms
      if (time - lastPeakUpdate > 100) {
        lastPeakUpdate = time;
        const loudness = synthEngine.getLoudnessMetrics();
        if (currentMaxVal > 15) {
          const peakFreq = (currentMaxBin * nyquist) / binCount;
          const peakDb = -90 + (currentMaxVal / 255) * 84;
          setLivePeakInfo({
            freq: Math.round(peakFreq),
            note: freqToNoteName(peakFreq),
            db: Math.round(peakDb * 10) / 10,
            peakDbfs: loudness.peakDbfs,
            rmsDb: loudness.rmsDb,
            kWeightedLufs: loudness.kWeightedLufs,
          });
        } else {
          setLivePeakInfo((prev) => ({
            ...prev,
            peakDbfs: loudness.peakDbfs,
            rmsDb: loudness.rmsDb,
            kWeightedLufs: loudness.kWeightedLufs,
          }));
        }
      }

      // Pre-calculate visual points across the width
      const numPoints = displayMode === 'bars' ? 42 : Math.min(width, 160);
      const points: { x: number; y: number; peakY: number; bin: number; freq: number }[] = [];

      for (let p = 0; p < numPoints; p++) {
        const normX = p / (numPoints - 1);
        const freq = minF * Math.pow(maxF / minF, normX);
        const binIndex = Math.min(binCount - 1, Math.max(0, (freq / nyquist) * binCount));
        const lowerBin = Math.floor(binIndex);
        const upperBin = Math.min(binCount - 1, lowerBin + 1);
        const frac = binIndex - lowerBin;

        const val = smoothed[lowerBin] * (1 - frac) + smoothed[upperBin] * frac;
        const pVal = peakHold[lowerBin] * (1 - frac) + peakHold[upperBin] * frac;

        // Amplitude normalization: map 0..255 byte value to canvas Y
        const normAmp = Math.pow(val / 255, 1.15);
        const normPeak = Math.pow(pVal / 255, 1.15);

        const x = normX * width;
        const y = height - normAmp * (height - 12) - 2;
        const peakY = height - normPeak * (height - 12) - 2;

        points.push({ x, y, peakY, bin: lowerBin, freq });
      }

      // Render Mode: BARS
      if (displayMode === 'bars') {
        const barWidth = Math.max(2, (width / numPoints) - 2);
        points.forEach((pt) => {
          const barHeight = Math.max(0, height - pt.y);
          if (barHeight > 1) {
            // Gradient fill from green (sub) to amber (mids) to cyan (highs)
            const grad = ctx.createLinearGradient(0, height, 0, pt.y);
            if (pt.freq < 150) {
              grad.addColorStop(0, '#047857');
              grad.addColorStop(1, '#10B981');
            } else if (pt.freq < 3000) {
              grad.addColorStop(0, '#B45309');
              grad.addColorStop(1, '#F59E0B');
            } else {
              grad.addColorStop(0, '#0369A1');
              grad.addColorStop(1, '#38BDF8');
            }

            ctx.fillStyle = grad;
            ctx.fillRect(pt.x, pt.y, barWidth, barHeight);
          }

          // Peak Hold Bar Cap
          if (peakHoldEnabled && pt.peakY < height - 3) {
            ctx.fillStyle = pt.freq < 150 ? '#34D399' : pt.freq < 3000 ? '#FBBF24' : '#7DD3FC';
            ctx.fillRect(pt.x, pt.peakY - 1, barWidth, 1.5);
          }
        });
      } else {
        // Render Mode: CURVE (Continuous Spline with Glowing Gradient Fill)
        if (points.length > 1) {
          // 1. Fill Area Under Curve
          ctx.beginPath();
          ctx.moveTo(points[0].x, height);
          ctx.lineTo(points[0].x, points[0].y);

          for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i];
            const p1 = points[i + 1];
            const cpx = (p0.x + p1.x) / 2;
            ctx.quadraticCurveTo(p0.x, p0.y, cpx, (p0.y + p1.y) / 2);
          }
          const lastPt = points[points.length - 1];
          ctx.lineTo(lastPt.x, lastPt.y);
          ctx.lineTo(lastPt.x, height);
          ctx.closePath();

          const areaGrad = ctx.createLinearGradient(0, 0, width, 0);
          areaGrad.addColorStop(0, 'rgba(16, 185, 129, 0.28)'); // Sub green
          areaGrad.addColorStop(0.35, 'rgba(245, 158, 11, 0.25)'); // Bass/Mids amber
          areaGrad.addColorStop(0.85, 'rgba(56, 189, 248, 0.22)'); // Highs cyan
          ctx.fillStyle = areaGrad;
          ctx.fill();

          // 2. Stroke Glowing Curve Line
          ctx.beginPath();
          ctx.moveTo(points[0].x, points[0].y);
          for (let i = 0; i < points.length - 1; i++) {
            const p0 = points[i];
            const p1 = points[i + 1];
            const cpx = (p0.x + p1.x) / 2;
            ctx.quadraticCurveTo(p0.x, p0.y, cpx, (p0.y + p1.y) / 2);
          }
          ctx.lineTo(lastPt.x, lastPt.y);

          const strokeGrad = ctx.createLinearGradient(0, 0, width, 0);
          strokeGrad.addColorStop(0, '#10B981');
          strokeGrad.addColorStop(0.35, '#F59E0B');
          strokeGrad.addColorStop(0.85, '#38BDF8');

          ctx.strokeStyle = strokeGrad;
          ctx.lineWidth = 1.8;
          ctx.stroke();

          // 3. Peak Hold Spline Line
          if (peakHoldEnabled) {
            ctx.beginPath();
            ctx.moveTo(points[0].x, points[0].peakY);
            for (let i = 0; i < points.length - 1; i++) {
              const p0 = points[i];
              const p1 = points[i + 1];
              const cpx = (p0.x + p1.x) / 2;
              ctx.quadraticCurveTo(p0.x, p0.peakY, cpx, (p0.peakY + p1.peakY) / 2);
            }
            ctx.lineTo(lastPt.x, lastPt.peakY);
            ctx.strokeStyle = 'rgba(245, 158, 11, 0.55)';
            ctx.lineWidth = 1;
            ctx.setLineDash([2, 2]);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }

      // Draw Cursor inspection line if user is hovering
      if (hoverData) {
        ctx.strokeStyle = '#FFFFFF';
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(hoverData.x, 0);
        ctx.lineTo(hoverData.x, height);
        ctx.stroke();
        ctx.setLineDash([]);

        // Cursor Dot
        ctx.fillStyle = '#F59E0B';
        ctx.beginPath();
        ctx.arc(hoverData.x, hoverData.y, 3, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();
      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, [displayMode, peakHoldEnabled, hoverData]);

  return (
    <div className="bg-[#0E121A] border border-[#212938] rounded overflow-hidden flex flex-col">
      {/* Top Header Toolbar */}
      <div className="px-2.5 py-1.5 bg-[#131722] border-b border-[#212838] flex items-center justify-between text-[10px] font-mono select-none">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Radio className={`w-3 h-3 ${isPlaying ? 'text-amber-400 animate-pulse' : 'text-slate-500'}`} />
            <span className="font-semibold text-slate-200 uppercase tracking-wider">MASTER SPECTRUM</span>
          </div>

          <span className="text-slate-600">·</span>

          {/* Real-time Sub/Peak readout */}
          <div className="flex items-center gap-1.5 tabular-nums">
            <span className="text-slate-400">PEAK:</span>
            <span className="text-amber-400 font-semibold px-1 py-0.2 bg-[#090C12] rounded border border-[#1E2536]">
              {livePeakInfo.freq} Hz {livePeakInfo.note ? `(${livePeakInfo.note})` : ''}
            </span>
            <span className="text-slate-400">
              {livePeakInfo.db > -80 ? `${livePeakInfo.db}dB` : '-∞'}
            </span>
          </div>
        </div>

        {/* Visual Controls: Curve / Bars / Peak Hold / Expand */}
        <div className="flex items-center gap-1">
          {/* Curve Mode */}
          <button
            type="button"
            onClick={() => setDisplayMode('curve')}
            title="Continuous curve mode"
            className={`p-1 rounded transition-colors ${
              displayMode === 'curve'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Activity className="w-3 h-3" />
          </button>

          {/* Bars Mode */}
          <button
            type="button"
            onClick={() => setDisplayMode('bars')}
            title="Discrete frequency bands mode"
            className={`p-1 rounded transition-colors ${
              displayMode === 'bars'
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart2 className="w-3 h-3" />
          </button>

          {/* Peak Hold Toggle */}
          <button
            type="button"
            onClick={() => setPeakHoldEnabled(!peakHoldEnabled)}
            title="Toggle peak hold contour"
            className={`px-1.5 py-0.5 rounded text-[9px] font-mono border transition-colors ${
              peakHoldEnabled
                ? 'bg-[#1D2536] text-amber-300 border-[#2E3B54]'
                : 'bg-transparent text-slate-500 border-transparent hover:text-slate-400'
            }`}
          >
            PEAK
          </button>

          {/* Expand / Minimize Height */}
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            title={isExpanded ? 'Minimize spectrum height' : 'Expand spectrum height'}
            className="p-1 rounded text-slate-400 hover:text-slate-200 transition-colors"
          >
            {isExpanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>
        </div>
      </div>

      {/* Canvas Viewport */}
      <div
        className="relative w-full cursor-crosshair transition-all duration-150"
        style={{ height: isExpanded ? '150px' : '88px' }}
      >
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="w-full h-full block"
        />

        {/* Hover Inspection Tooltip */}
        {hoverData && (
          <div
            className="absolute pointer-events-none px-1.5 py-0.5 bg-[#0A0D14]/95 border border-amber-500/60 rounded text-[9px] font-mono text-slate-100 shadow-md whitespace-nowrap z-10"
            style={{
              left: `${Math.min(hoverData.x + 8, 220)}px`,
              top: `${Math.max(4, hoverData.y - 20)}px`,
            }}
          >
            <span className="text-amber-400 font-semibold">{hoverData.freq} Hz</span>
            {hoverData.note && <span className="text-sky-300 ml-1">({hoverData.note})</span>}
            <span className="text-slate-400 ml-1">· {hoverData.db} dB</span>
          </div>
        )}
      </div>
    </div>
  );
};
