import React from 'react';
import { CheckCircle2, Cpu, Database, Disc, Layers, ShieldCheck, Volume2 } from 'lucide-react';
import { TimelineEditMode } from '../types/ableton';
import { StudioEditingTool } from './StudioEditorToolbar';

interface StudioStatusBarProps {
  projectName: string;
  projectRevision: number;
  trackCount: number;
  activeSoloCount: number;
  editMode: TimelineEditMode;
  activeTool: StudioEditingTool;
  isPlaying: boolean;
  statusMessage?: string;
  alsValid: boolean;
  canUndo: boolean;
  canRedo: boolean;
}

export const StudioStatusBar: React.FC<StudioStatusBarProps> = ({
  projectName,
  projectRevision,
  trackCount,
  activeSoloCount,
  editMode,
  activeTool,
  isPlaying,
  statusMessage,
  alsValid,
  canUndo,
  canRedo,
}) => {
  return (
    <div className="h-6.5 bg-[#080A0D] border-t border-[#1C222C] px-3 flex items-center justify-between text-[10px] font-mono text-zinc-400 select-none shrink-0 z-30">
      {/* LEFT: ENGINE & AUDIO METRICS */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-zinc-300">
          <span className={`w-1.5 h-1.5 rounded-full ${isPlaying ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`} />
          <span className="font-bold text-zinc-200">
            {isPlaying ? 'PLAYING' : 'ENGINE READY'}
          </span>
          <span className="text-zinc-600">·</span>
          <span>48kHz 32-bit float</span>
        </div>

        {activeSoloCount > 0 ? (
          <div className="flex items-center gap-1 px-1.5 py-0.2 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 font-bold">
            <Volume2 className="w-3 h-3" />
            <span>SOLO: {activeSoloCount} TRACK{activeSoloCount > 1 ? 'S' : ''} ACTIVE</span>
          </div>
        ) : (
          <div className="hidden sm:flex items-center gap-1 text-zinc-500">
            <span>SOLO: NONE</span>
          </div>
        )}

        <div className="hidden md:flex items-center gap-1 text-zinc-400 border-l border-[#1C222C] pl-2">
          <span className="uppercase text-zinc-500">TOOL:</span>
          <span className="text-zinc-200 uppercase font-semibold">{activeTool}</span>
          <span className="text-zinc-600">/</span>
          <span className="text-amber-400 uppercase font-semibold">{editMode}</span>
        </div>
      </div>

      {/* CENTER: REAL-TIME OPERATION MESSAGE */}
      <div className="hidden lg:block truncate max-w-md text-zinc-300 text-center px-2">
        {statusMessage || `${projectName} · Ready`}
      </div>

      {/* RIGHT: TRACK COUNT, PROJECT REVISION & ALS VALIDITY */}
      <div className="flex items-center gap-3">
        <div className="hidden sm:flex items-center gap-1 text-zinc-400">
          <Layers className="w-3 h-3 text-zinc-500" />
          <span>{trackCount} Tracks</span>
        </div>

        <div className="flex items-center gap-1 text-emerald-400">
          <ShieldCheck className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">ALS 12.0</span>
          <span>{alsValid ? 'VALID' : 'CHECK'}</span>
        </div>

        <div className="hidden sm:flex items-center gap-1 text-zinc-500 border-l border-[#1C222C] pl-2">
          <span>REV #{projectRevision}</span>
        </div>
      </div>
    </div>
  );
};
