import React from 'react';
import { Cpu, FolderOpen, Grid, Layers, PanelBottom, PanelLeft, PanelRight, Sliders, Sparkles } from 'lucide-react';

export type WorkspaceTabId = 'edit' | 'mix' | 'session' | 'devices' | 'browser' | 'ai' | 'queue';
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
export const StudioWorkspaceTabs: React.FC<StudioWorkspaceTabsProps> = (props) => {
  const tabs = [
    { id: 'edit', label: 'Arrange', icon: Layers },
    { id: 'session', label: 'Session', icon: Grid },
    { id: 'mix', label: 'Mixer', icon: Sliders },
    { id: 'devices', label: 'Devices', icon: Cpu },
    { id: 'browser', label: 'Browser', icon: FolderOpen },
  ] as const;
  return <nav aria-label="Studio workspaces" className="studio-workspaces flex shrink-0 items-center justify-between border-y border-[#232a33] bg-[#12161B] px-2">
    <div className="workspace-destinations flex min-w-0 items-stretch gap-1">
      {tabs.map(({id,label,icon:Icon}) => <button key={id} type="button" aria-current={props.activeTab === id ? 'page' : undefined}
        data-workspace={id} onClick={() => props.onSelectTab(id)}
        className={`min-h-11 flex items-center justify-center gap-2 rounded px-3 text-xs font-semibold ${props.activeTab === id ? 'bg-amber-500/15 text-amber-300' : 'text-zinc-400 hover:text-white'}`}>
        <Icon className="h-4 w-4" aria-hidden="true"/><span>{label}</span>
      </button>)}
    </div>
    <div className="hidden md:flex items-center gap-2">
      <button type="button" onClick={() => props.onSelectTab('ai')} aria-pressed={props.activeTab==='ai'} className="flex min-h-11 items-center gap-2 px-3 text-xs text-amber-300"><Sparkles className="h-4 w-4"/>Compose</button>
      <details className="relative">
        <summary className="min-h-11 cursor-pointer px-3 py-3 text-xs text-zinc-300">Panels</summary>
        <div className="absolute right-0 top-full z-50 w-52 rounded border border-[#2a333e] bg-[#12161B] p-2 shadow-xl">
          {[
            {label:'Tracks',title:'Toggle Tracks & Groups Tree (Left Dock)',active:props.leftDockOpen,action:props.onToggleLeftDock,Icon:PanelLeft},
            {label:'Editor',title:'Toggle MIDI / Device Editor (Bottom Dock)',active:props.bottomDockOpen,action:props.onToggleBottomDock,Icon:PanelBottom},
            {label:'Inspector',title:'Toggle AI & Inspector (Right Dock)',active:props.rightDockOpen,action:props.onToggleRightDock,Icon:PanelRight},
          ].map(({label,title,active,action,Icon})=><button key={label} type="button" title={title} aria-pressed={active} onClick={action} className="flex min-h-11 w-full items-center gap-2 px-2 text-xs text-zinc-300 hover:bg-[#1B2128]"><Icon className="h-4 w-4"/>{label}</button>)}
          {props.onApplyLayoutPreset && <button type="button" onClick={()=>props.onApplyLayoutPreset?.('edit')} className="min-h-11 w-full text-left px-2 text-xs text-zinc-300">Reset layout</button>}
        </div>
      </details>
    </div>
  </nav>;
};
