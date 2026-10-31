import React from 'react';
import {
  Activity,
  Bookmark,
  Crop,
  Edit2,
  Hand,
  Layers,
  MousePointer,
  Move,
  Music,
  Plus,
  Search,
  Sliders,
  Volume2,
  Wand2,
  ZoomIn,
} from 'lucide-react';
import { MemoryLocationMarker, TimelineEditMode } from '../types/ableton';

export type StudioEditingTool =
  | 'smart'
  | 'selector'
  | 'grabber'
  | 'trim'
  | 'pencil'
  | 'zoom'
  | 'scrubber';

export type SpectrumOverlayMode = 'off' | 'compact_lane' | 'expanded_strip';

interface StudioEditorToolbarProps {
  editMode: TimelineEditMode;
  activeTool: StudioEditingTool;
  spectrumMode: SpectrumOverlayMode;
  arrangementLengthBars: 16 | 32 | 64 | 128;
  memoryLocations: MemoryLocationMarker[];
  selectedTrackName?: string;
  onChangeEditMode: (mode: TimelineEditMode) => void;
  onChangeActiveTool: (tool: StudioEditingTool) => void;
  onChangeSpectrumMode: (mode: SpectrumOverlayMode) => void;
  onChangeArrangementLength: (bars: 16 | 32 | 64 | 128) => void;
  onDropMarkerAtPlayhead: () => void;
  onSeekToMarker: (beat: number) => void;
  onOpenCompingModal: () => void;
}

export const StudioEditorToolbar: React.FC<StudioEditorToolbarProps> = ({
  editMode,
  activeTool,
  spectrumMode,
  arrangementLengthBars,
  memoryLocations,
  selectedTrackName,
  onChangeEditMode,
  onChangeActiveTool,
  onChangeSpectrumMode,
  onChangeArrangementLength,
  onDropMarkerAtPlayhead,
  onSeekToMarker,
  onOpenCompingModal,
}) => {
  const tools: { id: StudioEditingTool; label: string; icon: React.ReactNode; shortcut: string }[] = [
    { id: 'smart', label: 'Smart', icon: <Wand2 className="w-3 h-3" />, shortcut: 'Cmd+1' },
    { id: 'selector', label: 'Select', icon: <MousePointer className="w-3 h-3" />, shortcut: 'Cmd+2' },
    { id: 'grabber', label: 'Grab', icon: <Hand className="w-3 h-3" />, shortcut: 'Cmd+3' },
    { id: 'trim', label: 'Trim', icon: <Crop className="w-3 h-3" />, shortcut: 'Cmd+4' },
    { id: 'pencil', label: 'Draw', icon: <Edit2 className="w-3 h-3" />, shortcut: 'Cmd+5' },
    { id: 'zoom', label: 'Zoom', icon: <ZoomIn className="w-3 h-3" />, shortcut: 'Cmd+6' },
    { id: 'scrubber', label: 'Scrub', icon: <Volume2 className="w-3 h-3" />, shortcut: 'Cmd+7' },
  ];

  return (
    <div className="h-9 bg-[#0E1217] border-b border-[#1E2530] px-3 flex items-center justify-between text-[11px] font-mono select-none shrink-0 z-10 overflow-x-auto no-scrollbar">
      {/* LEFT: EDIT MODES & TOOL CLUSTERS */}
      <div className="flex items-center gap-3 shrink-0">
        {/* SoundCraft Edit Modes */}
        <div className="flex items-center gap-0.5 bg-[#080A0E] border border-[#202734] p-0.5 rounded">
          <span className="text-[9px] text-zinc-500 uppercase px-1.5 hidden sm:inline">MODE</span>
          {(['shuffle', 'slip', 'spot', 'grid'] as TimelineEditMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChangeEditMode(mode)}
              className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase transition-all ${
                editMode === mode
                  ? 'bg-amber-500 text-zinc-950 shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#151B24]'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>

        {/* Tool State Machine */}
        <div className="flex items-center gap-0.5 bg-[#080A0E] border border-[#202734] p-0.5 rounded">
          <span className="text-[9px] text-zinc-500 uppercase px-1.5 hidden sm:inline">TOOL</span>
          {tools.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onChangeActiveTool(t.id)}
              title={`${t.label} Tool (${t.shortcut})`}
              className={`px-2 py-0.5 rounded text-[10px] font-medium flex items-center gap-1 transition-all ${
                activeTool === t.id
                  ? 'bg-amber-400 text-zinc-950 font-bold shadow-xs'
                  : 'text-zinc-400 hover:text-zinc-200 hover:bg-[#151B24]'
              }`}
            >
              {t.icon}
              <span className="hidden md:inline">{t.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* CENTER: MEMORY LOCATIONS (1-9) */}
      <div className="hidden lg:flex items-center gap-1 shrink-0 bg-[#080A0E] border border-[#202734] px-1.5 py-0.5 rounded">
        <button
          type="button"
          onClick={onDropMarkerAtPlayhead}
          title="Drop Memory Location Marker at Playhead"
          className="px-1.5 py-0.5 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-[10px] font-semibold flex items-center gap-1"
        >
          <Bookmark className="w-3 h-3" />
          <span>+Loc</span>
        </button>
        <div className="flex items-center gap-0.5 ml-1">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((slot) => {
            const marker = memoryLocations.find((m) => m.number === slot);
            return (
              <button
                key={slot}
                type="button"
                onClick={() => marker && onSeekToMarker(marker.beat)}
                title={marker ? `Jump to Marker ${slot}: ${marker.name} (Beat ${marker.beat})` : `Slot ${slot} (Empty)`}
                className={`w-5 h-5 rounded text-[10px] font-bold flex items-center justify-center transition-all ${
                  marker
                    ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40 hover:bg-sky-500/30'
                    : 'text-zinc-600 bg-transparent hover:text-zinc-400'
                }`}
              >
                {slot}
              </button>
            );
          })}
        </div>
      </div>

      {/* RIGHT: REAL-TIME 8-BAND FFT & DURATION */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Real-Time 8-Band Frequency Distribution HUD Toggle */}
        <div className="flex items-center gap-1 bg-[#080A0E] border border-[#202734] px-1.5 py-0.5 rounded text-[10px]">
          <Activity className="w-3 h-3 text-cyan-400" />
          <span className="text-zinc-400 hidden xl:inline">8-BAND FFT:</span>
          {(['off', 'compact_lane', 'expanded_strip'] as SpectrumOverlayMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => onChangeSpectrumMode(mode)}
              className={`px-1.5 py-0.5 rounded uppercase font-semibold transition-colors ${
                spectrumMode === mode
                  ? 'bg-cyan-500 text-zinc-950 font-bold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {mode === 'off' ? 'Off' : mode === 'compact_lane' ? 'Lane' : 'Strip'}
            </button>
          ))}
        </div>

        {/* Arrangement Length Selector */}
        <div className="flex items-center gap-0.5 bg-[#080A0E] border border-[#202734] px-1.5 py-0.5 rounded text-[10px]">
          <span className="text-zinc-500 mr-1 hidden sm:inline">LEN:</span>
          {([16, 32, 64, 128] as const).map((bars) => (
            <button
              key={bars}
              type="button"
              onClick={() => onChangeArrangementLength(bars)}
              className={`px-1.5 py-0.5 rounded font-bold transition-colors ${
                arrangementLengthBars === bars
                  ? 'bg-amber-500 text-zinc-950'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {bars}B
            </button>
          ))}
        </div>

        {/* Comping & Transient Tools */}
        <button
          type="button"
          onClick={onOpenCompingModal}
          title="Open Track Takes (Comping) &amp; Transient Silence Tools"
          className="px-2 py-0.5 rounded bg-[#151B24] hover:bg-[#1E2735] border border-[#263140] text-zinc-300 text-[10px] font-semibold flex items-center gap-1 transition-colors"
        >
          <Layers className="w-3 h-3 text-orange-400" />
          <span className="hidden sm:inline">Takes</span>
        </button>
      </div>
    </div>
  );
};
