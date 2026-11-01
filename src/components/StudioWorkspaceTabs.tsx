import React from 'react';
import {
  Activity,
  Cpu,
  FolderUp,
  Grid,
  Layers,
  Layout,
  Maximize2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Sliders,
  Sparkles,
} from 'lucide-react';

export type WorkspaceTabId = 'edit' | 'mix' | 'session' | 'devices' | 'ai' | 'queue';

interface StudioWorkspaceTabsProps {
  activeTab: WorkspaceTabId;
  leftDockOpen: boolean;
  bottomDockOpen: boolean;
  rightDockOpen: boolean;
  onSelectTab: (tab: WorkspaceTabId) => void;
  onToggleLeftDock: () => void;
  onToggleBottomDock: () => void;
  onToggleRightDock: () => void;
  onApplyLayoutPreset?: (preset: 'edit' | 'mix' | 'session' | 'sound_design' | 'mastering') => void;
}

export const StudioWorkspaceTabs: React.FC<StudioWorkspaceTabsProps> = ({
  activeTab,
  leftDockOpen,
  bottomDockOpen,
  rightDockOpen,
  onSelectTab,
  onToggleLeftDock,
  onToggleBottomDock,
  onToggleRightDock,
  onApplyLayoutPreset,
}) => {
  const tabs: { id: WorkspaceTabId; label: string; icon: React.ReactNode; badge?: string }[] = [
    { id: 'edit', label: 'EDIT WINDOW', icon: <Layers className="w-3.5 h-3.5" /> },
    { id: 'mix', label: 'MIX CONSOLE', icon: <Sliders className="w-3.5 h-3.5" />, badge: '10 Inserts' },
    { id: 'session', label: 'SESSION MATRIX', icon: <Grid className="w-3.5 h-3.5" /> },
    { id: 'devices', label: 'DEVICE RACK', icon: <Cpu className="w-3.5 h-3.5" /> },
    { id: 'ai', label: 'AI COMPOSER', icon: <Sparkles className="w-3.5 h-3.5" /> },
    { id: 'queue', label: 'BATCH QUEUE', icon: <FolderUp className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="h-9 bg-[#0B0E13] border-b border-[#1E2530] px-3 flex items-center justify-between text-xs font-mono select-none shrink-0 z-20">
      {/* Primary Workspace Tabs */}
      <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              className={`px-3 py-1.5 rounded-t-md text-xs font-bold flex items-center gap-1.5 transition-all whitespace-nowrap border-t border-x ${
                isActive
                  ? 'bg-[#131821] text-amber-400 border-[#2A3444] shadow-xs'
                  : 'bg-transparent text-zinc-400 hover:text-zinc-200 hover:bg-[#10141C] border-transparent'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
              {tab.badge && (
                <span className="px-1 py-0.2 rounded bg-amber-500/10 text-amber-300 text-[9px] font-normal border border-amber-500/30">
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Dock Viewport Controls & Layout Presets */}
      <div className="hidden sm:flex items-center gap-1.5 text-[10px]">
        {onApplyLayoutPreset && (
          <div className="hidden md:flex items-center gap-1 mr-2 border-r border-[#1E2530] pr-2 text-zinc-500">
            <span className="uppercase text-[9px]">PRESETS:</span>
            <button
              type="button"
              onClick={() => onApplyLayoutPreset('edit')}
              className="px-1.5 py-0.5 rounded bg-[#12161F] hover:bg-zinc-800 text-zinc-300"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => onApplyLayoutPreset('mix')}
              className="px-1.5 py-0.5 rounded bg-[#12161F] hover:bg-zinc-800 text-zinc-300"
            >
              Mix
            </button>
            <button
              type="button"
              onClick={() => onApplyLayoutPreset('session')}
              className="px-1.5 py-0.5 rounded bg-[#12161F] hover:bg-zinc-800 text-zinc-300"
            >
              Session
            </button>
            <button
              type="button"
              onClick={() => onApplyLayoutPreset('mastering')}
              className="px-1.5 py-0.5 rounded bg-[#12161F] hover:bg-zinc-800 text-zinc-300"
            >
              Master
            </button>
          </div>
        )}

        <button
          type="button"
          onClick={onToggleLeftDock}
          title="Toggle Tracks &amp; Groups Tree (Left Dock)"
          className={`px-2 py-1 rounded border flex items-center gap-1 transition-colors ${
            leftDockOpen
              ? 'bg-[#18202C] text-amber-300 border-[#2C384B]'
              : 'bg-[#10141C] text-zinc-500 border-[#1E2530] hover:text-zinc-300'
          }`}
        >
          <PanelLeft className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Tracks</span>
        </button>

        <button
          type="button"
          onClick={onToggleBottomDock}
          title="Toggle MIDI / Device Editor (Bottom Dock)"
          className={`px-2 py-1 rounded border flex items-center gap-1 transition-colors ${
            bottomDockOpen
              ? 'bg-[#18202C] text-amber-300 border-[#2C384B]'
              : 'bg-[#10141C] text-zinc-500 border-[#1E2530] hover:text-zinc-300'
          }`}
        >
          <PanelBottom className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Editor</span>
        </button>

        <button
          type="button"
          onClick={onToggleRightDock}
          title="Toggle AI &amp; Inspector (Right Dock)"
          className={`px-2 py-1 rounded border flex items-center gap-1 transition-colors ${
            rightDockOpen
              ? 'bg-[#18202C] text-amber-300 border-[#2C384B]'
              : 'bg-[#10141C] text-zinc-500 border-[#1E2530] hover:text-zinc-300'
          }`}
        >
          <PanelRight className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Inspector</span>
        </button>
      </div>
    </div>
  );
};
