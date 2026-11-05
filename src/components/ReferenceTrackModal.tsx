import React, { useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Cpu,
  Disc,
  Download,
  FileAudio,
  Layers,
  Music,
  Play,
  RotateCcw,
  Sliders,
  Sparkles,
  Upload,
  Volume2,
  Wand2,
  X,
} from 'lucide-react';
import {
  AbletonProjectState,
  ReferenceTrackAnalysisReport,
  ReferenceTrackLayerProfile,
  ReferenceTrackStructuralSection,
} from '../types/ableton';
import {
  analyzeUploadedReferenceTrack,
  generateCreativeCounterpartProject,
  CreativeCounterpartOptions,
} from '../engine/referenceTrackEngine';

interface ReferenceTrackModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLoadCounterpartProject: (project: AbletonProjectState) => void;
}

export const ReferenceTrackModal: React.FC<ReferenceTrackModalProps> = ({
  isOpen,
  onClose,
  onLoadCounterpartProject,
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState<boolean>(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [report, setReport] = useState<ReferenceTrackAnalysisReport | null>(null);

  // Creative options
  const [approach, setApproach] = useState<
    'subtle_homage' | 'radical_reimagining' | 'berlin_warehouse' | 'hypnotic_dub'
  >('subtle_homage');
  const [targetKey, setTargetKey] = useState<string>('F');
  const [targetScale, setTargetScale] = useState<string>('Minor');
  const [arrangementBars, setArrangementBars] = useState<16 | 32 | 64 | 128>(32);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);

  if (!isOpen) return null;

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsAnalyzing(true);
    setAnalysisError(null);
    try {
      const res = await analyzeUploadedReferenceTrack(file);
      setReport(res);
      setTargetKey(res.detectedRootKey);
      setTargetScale(res.detectedScale);
    } catch (err: any) {
      setAnalysisError(`Analysis failed: ${err.message || 'Unable to decode audio'}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleGenerate = () => {
    if (!report) return;
    setIsGenerating(true);
    try {
      const newProject = generateCreativeCounterpartProject(report, {
        approach,
        targetKey,
        targetScale,
        arrangementBars,
      });
      onLoadCounterpartProject(newProject);
      onClose();
    } catch (err: any) {
      setAnalysisError(`Generation failed: ${err.message}`);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-black/80 backdrop-blur-md font-mono select-none">
      <div className="w-full max-w-4xl max-h-[90vh] bg-[#0C0F14] border border-[#232B3A] rounded-xl flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="h-12 px-4 bg-[#090C10] border-b border-[#1E2533] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <h2 className="text-xs sm:text-sm font-bold text-zinc-100 tracking-wide uppercase">
              Reference Track Deep Analysis &amp; AI Re-Composition
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

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Upload Dropzone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-[#232D3F] hover:border-amber-400/60 bg-[#10141D]/60 hover:bg-[#141A25] p-5 rounded-lg text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-2 group"
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.flac,.aif,.aiff,.ogg"
              onChange={handleFileUpload}
              className="hidden"
            />
            <div className="w-10 h-10 rounded-full bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 group-hover:scale-110 transition-transform">
              {isAnalyzing ? (
                <RotateCcw className="w-5 h-5 animate-spin" />
              ) : (
                <Upload className="w-5 h-5" />
              )}
            </div>
            <div>
              <p className="text-xs font-bold text-zinc-200">
                {isAnalyzing
                  ? 'Performing Deep MIR Analysis (Tempo, Chroma, Spectral Bands, Sections)...'
                  : report
                  ? `Active Reference: ${report.fileName}`
                  : 'Drop Reference Audio Track (WAV, MP3, AIFF, FLAC)'}
              </p>
              <p className="text-[10px] text-zinc-500 mt-0.5">
                Measure loudness and peak, then explore a creative reference profile
              </p>
            </div>
          </div>

          {analysisError && (
            <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded text-rose-300 text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{analysisError}</span>
            </div>
          )}

          {/* Analysis Dashboard */}
          {report && (
            <div className="space-y-4">
              {/* Metrics Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <div className="p-2.5 rounded bg-[#10141C] border border-[#1C2330]">
                  <span className="text-[10px] text-zinc-500 uppercase">Estimated tempo</span>
                  <p className="text-base font-bold text-amber-400 tabular-nums">
                    {report.detectedTempo} BPM
                  </p>
                </div>
                <div className="p-2.5 rounded bg-[#10141C] border border-[#1C2330]">
                  <span className="text-[10px] text-zinc-500 uppercase">Suggested key &amp; scale</span>
                  <p className="text-base font-bold text-cyan-400">
                    {report.detectedRootKey} {report.detectedScale}
                  </p>
                </div>
                <div className="p-2.5 rounded bg-[#10141C] border border-[#1C2330]">
                  <span className="text-[10px] text-zinc-500 uppercase">Integrated Loudness</span>
                  <p className="text-base font-bold text-emerald-400 tabular-nums">
                    {report.signalMeasurement?.integratedAvailable === false ? 'Unavailable' : `${report.integratedLufs} LUFS`}
                  </p>
                </div>
                <div className="p-2.5 rounded bg-[#10141C] border border-[#1C2330]">
                  <span className="text-[10px] text-zinc-500 uppercase">True Peak</span>
                  <p className="text-base font-bold text-sky-400 tabular-nums">
                    {report.truePeakDbtp} dBTP
                  </p>
                </div>
              </div>

              <p className="text-xs text-zinc-400">
                {report.signalMeasurement
                  ? report.signalMeasurement.integratedAvailable
                    ? 'Loudness and peak are measured; musical descriptors are creative estimates.'
                    : report.signalMeasurement.unavailableReason === 'insufficient-duration'
                      ? 'Loudness unavailable: at least 400 ms of audio is required. Peak is measured.'
                      : 'Loudness unavailable: audio is below the measurement gate. Peak is measured.'
                  : 'Legacy report: loudness and peak are estimates. Analyze the file again for measured values.'}
              </p>
              {/* Spectral Decomposition */}
              <div className="p-3.5 bg-[#10141C] border border-[#1C2330] rounded space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-zinc-300 uppercase">Creative band profile · estimate</span>
                  <span className="text-[10px] text-zinc-500">
                    Estimated range: {report.dynamicRangeDb} dB · Crest: {report.crestFactorDb} dB
                  </span>
                </div>
                <div className="grid grid-cols-5 gap-2 text-[10px] pt-1">
                  <div>
                    <div className="flex justify-between text-zinc-400 mb-1">
                      <span>Sub</span>
                      <span>{(report.spectralBands.subRatio * 100).toFixed(0)}%</span>
                    </div>
                    <div className="h-2 bg-zinc-900 rounded overflow-hidden">
                      <div
                        className="h-full bg-amber-400"
                        style={{ width: `${report.spectralBands.subRatio * 100}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-zinc-400 mb-1">
                      <span>Low</span>
                      <span>{(report.spectralBands.lowRatio * 100).toFixed(0)}%</span>
                    </div>
                    <div className="h-2 bg-zinc-900 rounded overflow-hidden">
                      <div
                        className="h-full bg-sky-400"
                        style={{ width: `${report.spectralBands.lowRatio * 100}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-zinc-400 mb-1">
                      <span>Mid</span>
                      <span>{(report.spectralBands.midRatio * 100).toFixed(0)}%</span>
                    </div>
                    <div className="h-2 bg-zinc-900 rounded overflow-hidden">
                      <div
                        className="h-full bg-emerald-400"
                        style={{ width: `${report.spectralBands.midRatio * 100}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-zinc-400 mb-1">
                      <span>High</span>
                      <span>{(report.spectralBands.highRatio * 100).toFixed(0)}%</span>
                    </div>
                    <div className="h-2 bg-zinc-900 rounded overflow-hidden">
                      <div
                        className="h-full bg-purple-400"
                        style={{ width: `${report.spectralBands.highRatio * 100}%` }}
                      />
                    </div>
                  </div>
                  <div>
                    <div className="flex justify-between text-zinc-400 mb-1">
                      <span>Air</span>
                      <span>{(report.spectralBands.airRatio * 100).toFixed(0)}%</span>
                    </div>
                    <div className="h-2 bg-zinc-900 rounded overflow-hidden">
                      <div
                        className="h-full bg-cyan-400"
                        style={{ width: `${report.spectralBands.airRatio * 100}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Detected Structural Sections */}
              <div className="p-3.5 bg-[#10141C] border border-[#1C2330] rounded space-y-2">
                <span className="text-xs font-bold text-zinc-300 uppercase">
                  Detected Arrangement Flow ({report.structuralSections.length} Sections)
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 text-[10px]">
                  {report.structuralSections.map((sec, idx) => (
                    <div
                      key={idx}
                      className="p-2 rounded bg-[#0A0D12] border border-[#181F2C] space-y-1"
                    >
                      <div className="flex justify-between font-bold text-zinc-200">
                        <span>{sec.role}</span>
                        <span className="text-zinc-500">
                          B{sec.startBar}–B{sec.endBar}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-zinc-400">
                        <span>Energy:</span>
                        <div className="flex-1 h-1 bg-zinc-800 rounded">
                          <div
                            className="h-full bg-amber-400 rounded"
                            style={{ width: `${sec.targetEnergy * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Detected Layer Fingerprints */}
              <div className="p-3.5 bg-[#10141C] border border-[#1C2330] rounded space-y-2">
                <span className="text-xs font-bold text-zinc-300 uppercase">
                  Detected Instrument Layers &amp; Live 12 Recommendations
                </span>
                <div className="divide-y divide-[#181F2C] max-h-48 overflow-y-auto pr-1 text-[11px]">
                  {report.detectedLayers.map((layer) => (
                    <div key={layer.archetype} className="py-1.5 flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="font-bold text-amber-300">{layer.detectedName}</span>
                        <p className="text-[10px] text-zinc-400 truncate">
                          {layer.recommendedInstrument} · {layer.timbralCharacteristics}
                        </p>
                      </div>
                      <span className="text-[10px] text-zinc-500 font-mono shrink-0">
                        {layer.frequencyRange}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Re-Composition Controls */}
              <div className="p-3.5 bg-[#121620] border border-[#232B3A] rounded space-y-3">
                <span className="text-xs font-bold text-amber-400 uppercase flex items-center gap-1.5">
                  <Wand2 className="w-3.5 h-3.5" />
                  Creative Re-Composition Configuration
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-1">CREATIVE APPROACH</label>
                    <select
                      value={approach}
                      onChange={(e) => setApproach(e.target.value as any)}
                      className="w-full bg-[#0A0D12] border border-[#222B38] px-2 py-1.5 rounded text-zinc-200 outline-none font-mono"
                    >
                      <option value="subtle_homage">Subtle Homage (Preserve Energy)</option>
                      <option value="radical_reimagining">Radical Reimagining</option>
                      <option value="berlin_warehouse">Berlin Warehouse (Tresor)</option>
                      <option value="hypnotic_dub">Hypnotic Dub (Ostgut)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-1">TARGET KEY</label>
                    <select
                      value={targetKey}
                      onChange={(e) => setTargetKey(e.target.value)}
                      className="w-full bg-[#0A0D12] border border-[#222B38] px-2 py-1.5 rounded text-zinc-200 outline-none font-mono"
                    >
                      {['F', 'D', 'G', 'C', 'A', 'E', 'B', 'A#'].map((k) => (
                        <option key={k} value={k}>
                          {k}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-1">TARGET SCALE</label>
                    <select
                      value={targetScale}
                      onChange={(e) => setTargetScale(e.target.value)}
                      className="w-full bg-[#0A0D12] border border-[#222B38] px-2 py-1.5 rounded text-zinc-200 outline-none font-mono"
                    >
                      {['Minor', 'Phrygian', 'Dorian', 'Aeolian'].map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-zinc-400 block mb-1">ARRANGEMENT BARS</label>
                    <select
                      value={arrangementBars}
                      onChange={(e) => setArrangementBars(Number(e.target.value) as any)}
                      className="w-full bg-[#0A0D12] border border-[#222B38] px-2 py-1.5 rounded text-zinc-200 outline-none font-mono"
                    >
                      {[16, 32, 64, 128].map((b) => (
                        <option key={b} value={b}>
                          {b} Bars
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleGenerate}
                  disabled={isGenerating}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold font-mono text-xs rounded transition-all flex items-center justify-center gap-2 shadow-lg disabled:opacity-50"
                >
                  <Sparkles className="w-4 h-4" />
                  {isGenerating
                    ? 'Generating Complete 8-Track Project...'
                    : 'Generate Creative Counterpart Project & Load in DAW'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
