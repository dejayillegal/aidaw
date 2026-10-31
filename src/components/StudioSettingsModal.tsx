import React, { useState } from 'react';
import {
  Check,
  Disc,
  Key,
  Layers,
  Moon,
  Sliders,
  Sun,
  Volume2,
  X,
} from 'lucide-react';
import { MasterBusConfig, NoteGridDivision } from '../types/ableton';
import { SpectrumOverlayMode } from './StudioEditorToolbar';

interface StudioSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  themeMode: 'dark' | 'light';
  onToggleTheme: (mode: 'dark' | 'light') => void;
  spectrumOverlayMode: SpectrumOverlayMode;
  onChangeSpectrumOverlayMode: (mode: SpectrumOverlayMode) => void;
  masterBus: MasterBusConfig;
  onUpdateMasterBus: (partial: Partial<MasterBusConfig>) => void;
  onResetLayout: () => void;
}

export const StudioSettingsModal: React.FC<StudioSettingsModalProps> = ({
  isOpen,
  onClose,
  themeMode,
  onToggleTheme,
  spectrumOverlayMode,
  onChangeSpectrumOverlayMode,
  masterBus,
  onUpdateMasterBus,
  onResetLayout,
}) => {
  const [activeTab, setActiveTab] = useState<'appearance' | 'audio' | 'export' | 'shortcuts'>('appearance');
  const [sampleRate, setSampleRate] = useState<'44.1' | '48.0' | '96.0'>('48.0');
  const [bufferSize, setBufferSize] = useState<128 | 256 | 512>(256);
  const [lufsTarget, setLufsTarget] = useState<number>(-14);
  const [bitDepth, setBitDepth] = useState<16 | 24>(24);
  const [truePeakCeiling, setTruePeakCeiling] = useState<number>(-0.3);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-3 sm:p-6 animate-fadeIn">
      <div className="w-full max-w-2xl bg-[#0F131A] dark:bg-[#0F131A] border border-[#232B38] rounded-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="px-4 py-3 bg-[#090C11] border-b border-[#1F2734] flex items-center justify-between select-none">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-amber-400" />
            <h3 className="font-display font-semibold text-sm text-slate-100">
              Parametric DAW Workstation Settings
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

        {/* Tab Navigation */}
        <div className="px-4 py-1.5 bg-[#0C0F15] border-b border-[#1F2734] flex items-center gap-2 text-xs font-mono select-none overflow-x-auto">
          <button
            type="button"
            onClick={() => setActiveTab('appearance')}
            className={`px-3 py-1 rounded transition-colors whitespace-nowrap ${
              activeTab === 'appearance'
                ? 'bg-amber-500 text-slate-950 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Appearance &amp; Theme
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('audio')}
            className={`px-3 py-1 rounded transition-colors whitespace-nowrap ${
              activeTab === 'audio'
                ? 'bg-amber-500 text-slate-950 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Audio Engine DSP
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('export')}
            className={`px-3 py-1 rounded transition-colors whitespace-nowrap ${
              activeTab === 'export'
                ? 'bg-amber-500 text-slate-950 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Mastering &amp; Export Presets
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('shortcuts')}
            className={`px-3 py-1 rounded transition-colors whitespace-nowrap ${
              activeTab === 'shortcuts'
                ? 'bg-amber-500 text-slate-950 font-bold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Shortcuts Reference
          </button>
        </div>

        {/* Modal Body Content */}
        <div className="p-4 sm:p-6 overflow-y-auto flex-1 space-y-5 font-mono text-xs text-slate-200">
          {/* TAB 1: APPEARANCE & THEME */}
          {activeTab === 'appearance' && (
            <div className="space-y-5">
              {/* Theme Switcher Card */}
              <div className="p-4 bg-[#141923] border border-[#232C3A] rounded-md space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-semibold text-slate-100 text-sm">
                      Workspace Visual Theme Mode
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Toggle between Dark Studio and High-Contrast Light Mode across all docks, timeline, and mix console.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 p-1 bg-[#0B0E14] border border-[#2A3446] rounded-md">
                    <button
                      type="button"
                      onClick={() => onToggleTheme('dark')}
                      className={`px-3 py-1.5 rounded flex items-center gap-1.5 font-bold transition-all ${
                        themeMode === 'dark'
                          ? 'bg-amber-500 text-slate-950 shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Moon className="w-3.5 h-3.5" />
                      Dark Studio
                    </button>
                    <button
                      type="button"
                      onClick={() => onToggleTheme('light')}
                      className={`px-3 py-1.5 rounded flex items-center gap-1.5 font-bold transition-all ${
                        themeMode === 'light'
                          ? 'bg-amber-500 text-slate-950 shadow-sm'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <Sun className="w-3.5 h-3.5" />
                      High Contrast Light
                    </button>
                  </div>
                </div>
              </div>

              {/* Spectrum HUD Mode Card */}
              <div className="p-4 bg-[#141923] border border-[#232C3A] rounded-md space-y-3">
                <h4 className="font-semibold text-slate-100 text-sm">
                  8-Band Peak Spectrum Overlay Mode
                </h4>
                <p className="text-[11px] text-slate-400">
                  Select default real-time spectrum HUD layout on track lanes during playback.
                </p>
                <div className="grid grid-cols-3 gap-2 pt-1">
                  {(['off', 'compact_lane', 'expanded_strip'] as SpectrumOverlayMode[]).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => onChangeSpectrumOverlayMode(mode)}
                      className={`py-2 px-3 rounded border text-center transition-all ${
                        spectrumOverlayMode === mode
                          ? 'bg-amber-500/20 text-amber-300 border-amber-500 font-bold'
                          : 'bg-[#0B0E14] border-[#222A38] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {mode === 'off' ? 'Disabled' : mode === 'compact_lane' ? 'Compact Lane' : 'Expanded Strip'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Restore Workstation Layout Button */}
              <div className="pt-2 flex justify-between items-center border-t border-[#1F2734]">
                <span className="text-slate-400 text-[11px]">
                  Reset docks, editor tab panels, and transforms to default state.
                </span>
                <button
                  type="button"
                  onClick={onResetLayout}
                  className="px-3.5 py-1.5 bg-[#1C2332] hover:bg-[#252E42] text-amber-400 border border-[#2D384D] rounded font-semibold transition-colors"
                >
                  Restore Workstation Layout
                </button>
              </div>
            </div>
          )}

          {/* TAB 2: AUDIO ENGINE DSP */}
          {activeTab === 'audio' && (
            <div className="space-y-4">
              <div className="p-4 bg-[#141923] border border-[#232C3A] rounded-md space-y-3">
                <h4 className="font-semibold text-slate-100 text-sm">
                  Web Audio API Engine &amp; Sample Rate
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-slate-400 block mb-1">Sample Rate (kHz):</label>
                    <select
                      value={sampleRate}
                      onChange={(e) => setSampleRate(e.target.value as any)}
                      className="w-full bg-[#0C0F15] border border-[#252F3E] text-amber-300 rounded px-2.5 py-1.5"
                    >
                      <option value="44.1">44.1 kHz (CD Standard)</option>
                      <option value="48.0">48.0 kHz (Studio Production)</option>
                      <option value="96.0">96.0 kHz (High Resolution)</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">Buffer Size (Samples):</label>
                    <select
                      value={bufferSize}
                      onChange={(e) => setBufferSize(Number(e.target.value) as any)}
                      className="w-full bg-[#0C0F15] border border-[#252F3E] text-amber-300 rounded px-2.5 py-1.5"
                    >
                      <option value={128}>128 Samples (Ultra-Low Latency ~2.6ms)</option>
                      <option value={256}>256 Samples (Balanced Studio Default)</option>
                      <option value={512}>512 Samples (High DSP Stability)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Master Glue Compression Drive */}
              <div className="p-4 bg-[#141923] border border-[#232C3A] rounded-md space-y-3">
                <div className="flex justify-between items-center">
                  <h4 className="font-semibold text-slate-100 text-sm">
                    Master Bus Glue Compression Drive
                  </h4>
                  <span className="text-emerald-400 font-bold">
                    {Math.round((masterBus.glueCompressionDrive || 0.35) * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={masterBus.glueCompressionDrive || 0.35}
                  onChange={(e) => onUpdateMasterBus({ glueCompressionDrive: parseFloat(e.target.value) })}
                  className="w-full studio-slider"
                />
              </div>

              {/* Studio-Wide Global Groove Swing % */}
              <div className="p-4 bg-[#141923] border border-[#232C3A] rounded-md space-y-3">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="font-semibold text-slate-100 text-sm">
                      Global Groove Swing Percentage
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Applies studio-wide 16th-note swing timing offset (50% straight to 75% heavy shuffle) across all MIDI clips.
                    </p>
                  </div>
                  <span className="text-amber-400 font-bold text-sm">
                    {masterBus.globalGroovePct ?? 50}%
                  </span>
                </div>
                <input
                  type="range"
                  min="50"
                  max="75"
                  step="1"
                  value={masterBus.globalGroovePct ?? 50}
                  onChange={(e) => onUpdateMasterBus({ globalGroovePct: parseInt(e.target.value, 10) })}
                  className="w-full studio-slider accent-amber-500"
                />
              </div>
            </div>
          )}

          {/* TAB 3: MASTERING & EXPORT PRESETS */}
          {activeTab === 'export' && (
            <div className="space-y-4">
              <div className="p-4 bg-[#141923] border border-[#232C3A] rounded-md space-y-3">
                <h4 className="font-semibold text-slate-100 text-sm">
                  Integrated LUFS Loudness Target
                </h4>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { val: -14, label: '-14.0 LUFS (Streaming)' },
                    { val: -11, label: '-11.0 LUFS (Club Master)' },
                    { val: -8, label: '-8.0 LUFS (Warehouse Crush)' },
                  ].map((preset) => (
                    <button
                      key={preset.val}
                      type="button"
                      onClick={() => setLufsTarget(preset.val)}
                      className={`py-2 px-2.5 rounded border text-center font-bold transition-colors ${
                        lufsTarget === preset.val
                          ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500'
                          : 'bg-[#0C0F15] border-[#222A38] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-[#141923] border border-[#232C3A] rounded-md space-y-3">
                <h4 className="font-semibold text-slate-100 text-sm">
                  Export PCM Bit Depth &amp; True Peak Ceiling
                </h4>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-slate-400 block mb-1">PCM Bit Depth:</label>
                    <select
                      value={bitDepth}
                      onChange={(e) => setBitDepth(Number(e.target.value) as any)}
                      className="w-full bg-[#0C0F15] border border-[#252F3E] text-amber-300 rounded px-2.5 py-1.5"
                    >
                      <option value={24}>24-Bit Studio High-Res</option>
                      <option value={16}>16-Bit Redbook CD Standard</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-slate-400 block mb-1">True Peak Ceiling (dBTP):</label>
                    <select
                      value={truePeakCeiling}
                      onChange={(e) => setTruePeakCeiling(Number(e.target.value))}
                      className="w-full bg-[#0C0F15] border border-[#252F3E] text-amber-300 rounded px-2.5 py-1.5"
                    >
                      <option value={-0.3}>-0.3 dBTP (EBU R128 Safety)</option>
                      <option value={-1.0}>-1.0 dBTP (Streaming Inter-sample Safety)</option>
                    </select>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: SHORTCUTS REFERENCE */}
          {activeTab === 'shortcuts' && (
            <div className="space-y-3">
              <h4 className="font-semibold text-slate-100 text-sm">
                Keyboard Shortcuts Reference List
              </h4>
              <div className="bg-[#121620] border border-[#222A38] rounded divide-y divide-[#1C222D]">
                {[
                  { key: 'Cmd/Ctrl + K', desc: 'Open Studio Command Palette' },
                  { key: 'Spacebar', desc: 'Toggle Transport Play / Stop' },
                  { key: 'Cmd/Ctrl + Z', desc: 'Undo Last Action' },
                  { key: 'Cmd/Ctrl + Y', desc: 'Redo Last Action' },
                  { key: 'Cmd/Ctrl + S', desc: 'Export Native Ableton .ALS Project' },
                  { key: 'Cmd/Ctrl + B', desc: 'Open Multi-Project Batch Queue & Master Export' },
                  { key: 'Keys 1 - 5', desc: 'Switch Workspaces (1: Edit, 2: Mix, 3: Session, 4: Devices, 5: AI)' },
                ].map((s, idx) => (
                  <div key={idx} className="px-3.5 py-2 flex justify-between items-center">
                    <span className="text-amber-400 font-bold">{s.key}</span>
                    <span className="text-slate-300 text-[11px]">{s.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-4 py-3 bg-[#090C11] border-t border-[#1F2734] flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold rounded transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
