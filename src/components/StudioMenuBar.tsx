import React, { useState } from 'react';
import {
  Activity,
  Check,
  ChevronDown,
  Code2,
  Cpu,
  Download,
  Eraser,
  FileText,
  FolderUp,
  HelpCircle,
  Layers,
  Layout,
  Maximize2,
  Music,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  Settings,
  Sliders,
  Sparkles,
  Sun,
  Moon,
  Undo2,
  Volume2,
  Wand2,
} from 'lucide-react';
import { PWAInstallButton } from './PWAInstallButton';

interface StudioMenuBarProps {
  projectName: string;
  canUndo: boolean;
  canRedo: boolean;
  themeMode?: 'dark' | 'light';
  onToggleTheme?: (mode: 'dark' | 'light') => void;
  onOpenSettings?: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onNewProject: () => void;
  onImportAlsClick: () => void;
  onExportAls: () => void;
  onExportWav: () => void;
  onOpenQueueModal: () => void;
  onOpenClearModal: () => void;
  onOpenCommandPalette: () => void;
  onOpenCompingModal: () => void;
  onSwitchWorkspace: (tab: 'edit' | 'mix' | 'session' | 'devices' | 'ai' | 'queue') => void;
  onResetLayout: () => void;
  onOpenXmlInspector: () => void;
  onOpenPythonExporter: () => void;
  onOpenArchitectureModal?: () => void;
}

export const StudioMenuBar: React.FC<StudioMenuBarProps> = ({
  projectName,
  canUndo,
  canRedo,
  themeMode = 'dark',
  onToggleTheme,
  onOpenSettings,
  onUndo,
  onRedo,
  onNewProject,
  onImportAlsClick,
  onExportAls,
  onExportWav,
  onOpenQueueModal,
  onOpenClearModal,
  onOpenCommandPalette,
  onOpenCompingModal,
  onSwitchWorkspace,
  onResetLayout,
  onOpenXmlInspector,
  onOpenPythonExporter,
  onOpenArchitectureModal,
}) => {
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const closeMenu = () => setActiveMenu(null);

  return (
    <div
      className="h-7 bg-[#090B0E] border-b border-[#1E242E] px-2 flex items-center justify-between text-[11px] font-sans text-zinc-300 select-none shrink-0 z-40 relative"
      onMouseLeave={closeMenu}
    >
      {/* Brand & Menu Items */}
      <div className="flex items-center gap-1">
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-400 font-bold tracking-tight text-[10px] mr-1">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
          <span>PARAMETRIC ALS</span>
        </div>

        {/* FILE MENU */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setActiveMenu(activeMenu === 'file' ? null : 'file')}
            onMouseEnter={() => activeMenu && setActiveMenu('file')}
            className={`px-2 py-1 rounded transition-colors ${
              activeMenu === 'file' ? 'bg-[#1E2530] text-amber-400' : 'hover:bg-[#161C24] text-zinc-300'
            }`}
          >
            File
          </button>
          {activeMenu === 'file' && (
            <div className="absolute top-full left-0 mt-0.5 w-56 bg-[#10141B] border border-[#232B36] rounded-md shadow-2xl py-1 z-50 text-[11px]">
              <button
                type="button"
                onClick={() => { onNewProject(); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 flex items-center justify-between"
              >
                <span>New Project (Berghain 134)</span>
                <span className="text-[10px] text-zinc-500">Cmd+N</span>
              </button>
              <button
                type="button"
                onClick={() => { onImportAlsClick(); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 flex items-center justify-between"
              >
                <span>Import Ableton .ALS File...</span>
                <span className="text-[10px] text-zinc-500">Cmd+O</span>
              </button>
              <div className="h-px bg-[#1F2733] my-1" />
              <button
                type="button"
                onClick={() => { onExportAls(); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 flex items-center justify-between"
              >
                <span>Export Ableton Live 12 (.ALS)</span>
                <span className="text-[10px] text-zinc-500">Cmd+S</span>
              </button>
              <button
                type="button"
                onClick={() => { onExportWav(); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 flex items-center justify-between"
              >
                <span>Master Export WAV (24-bit PCM)...</span>
                <span className="text-[10px] text-zinc-500">Cmd+E</span>
              </button>
              <button
                type="button"
                onClick={() => { onOpenQueueModal(); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 flex items-center justify-between"
              >
                <span>Multi-Project Batch Queue...</span>
                <span className="text-[10px] text-zinc-500">Cmd+B</span>
              </button>
              <div className="h-px bg-[#1F2733] my-1" />
              <button
                type="button"
                onClick={() => { onOpenClearModal(); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-rose-500/20 text-rose-300 flex items-center justify-between"
              >
                <span>Clear Arrangement State...</span>
              </button>
              <div className="h-px bg-[#1F2733] my-1" />
              <div className="px-3 py-1.5 opacity-80">
                <PWAInstallButton className="w-full justify-center py-2" />
              </div>
            </div>
          )}
        </div>

        {/* EDIT MENU */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setActiveMenu(activeMenu === 'edit' ? null : 'edit')}
            onMouseEnter={() => activeMenu && setActiveMenu('edit')}
            className={`px-2 py-1 rounded transition-colors ${
              activeMenu === 'edit' ? 'bg-[#1E2530] text-amber-400' : 'hover:bg-[#161C24] text-zinc-300'
            }`}
          >
            Edit
          </button>
          {activeMenu === 'edit' && (
            <div className="absolute top-full left-0 mt-0.5 w-52 bg-[#10141B] border border-[#232B36] rounded-md shadow-2xl py-1 z-50 text-[11px]">
              <button
                type="button"
                disabled={!canUndo}
                onClick={() => { onUndo(); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 disabled:opacity-40 flex items-center justify-between"
              >
                <span>Undo</span>
                <span className="text-[10px] text-zinc-500">Cmd+Z</span>
              </button>
              <button
                type="button"
                disabled={!canRedo}
                onClick={() => { onRedo(); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 disabled:opacity-40 flex items-center justify-between"
              >
                <span>Redo</span>
                <span className="text-[10px] text-zinc-500">Cmd+Y</span>
              </button>
              <div className="h-px bg-[#1F2733] my-1" />
              <button
                type="button"
                onClick={() => { onOpenCompingModal(); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 flex items-center justify-between"
              >
                <span>Comping Takes &amp; Strip Silence</span>
              </button>
              <button
                type="button"
                onClick={() => { onOpenCommandPalette(); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 flex items-center justify-between"
              >
                <span>Command Palette...</span>
                <span className="text-[10px] text-zinc-500">Cmd+K</span>
              </button>
            </div>
          )}
        </div>

        {/* VIEW MENU */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setActiveMenu(activeMenu === 'view' ? null : 'view')}
            onMouseEnter={() => activeMenu && setActiveMenu('view')}
            className={`px-2 py-1 rounded transition-colors ${
              activeMenu === 'view' ? 'bg-[#1E2530] text-amber-400' : 'hover:bg-[#161C24] text-zinc-300'
            }`}
          >
            View
          </button>
          {activeMenu === 'view' && (
            <div className="absolute top-full left-0 mt-0.5 w-52 bg-[#10141B] border border-[#232B36] rounded-md shadow-2xl py-1 z-50 text-[11px]">
              <button
                type="button"
                onClick={() => { onSwitchWorkspace('edit'); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 flex items-center justify-between"
              >
                <span>SoundCraft Edit Window</span>
                <span className="text-[10px] text-zinc-500">1</span>
              </button>
              <button
                type="button"
                onClick={() => { onSwitchWorkspace('mix'); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 flex items-center justify-between"
              >
                <span>SoundCraft Mix Console</span>
                <span className="text-[10px] text-zinc-500">2</span>
              </button>
              <button
                type="button"
                onClick={() => { onSwitchWorkspace('session'); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 flex items-center justify-between"
              >
                <span>Session Matrix</span>
                <span className="text-[10px] text-zinc-500">3</span>
              </button>
              <button
                type="button"
                onClick={() => { onSwitchWorkspace('devices'); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 flex items-center justify-between"
              >
                <span>Device Rack</span>
                <span className="text-[10px] text-zinc-500">4</span>
              </button>
              <button
                type="button"
                onClick={() => { onSwitchWorkspace('ai'); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 flex items-center justify-between"
              >
                <span>AI Composer Studio</span>
                <span className="text-[10px] text-zinc-500">5</span>
              </button>
              <div className="h-px bg-[#1F2733] my-1" />
              <button
                type="button"
                onClick={() => { onResetLayout(); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 flex items-center justify-between"
              >
                <span>Reset Workstation Layout</span>
              </button>
            </div>
          )}
        </div>

        {/* TOOLS MENU */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setActiveMenu(activeMenu === 'tools' ? null : 'tools')}
            onMouseEnter={() => activeMenu && setActiveMenu('tools')}
            className={`px-2 py-1 rounded transition-colors ${
              activeMenu === 'tools' ? 'bg-[#1E2530] text-amber-400' : 'hover:bg-[#161C24] text-zinc-300'
            }`}
          >
            Tools
          </button>
          {activeMenu === 'tools' && (
            <div className="absolute top-full left-0 mt-0.5 w-56 bg-[#10141B] border border-[#232B36] rounded-md shadow-2xl py-1 z-50 text-[11px]">
              <button
                type="button"
                onClick={() => { onOpenQueueModal(); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 flex items-center justify-between"
              >
                <span>Smart Leveling 2.0 Calibrator</span>
              </button>
              <button
                type="button"
                onClick={() => { onOpenXmlInspector(); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 flex items-center justify-between"
              >
                <span>Ableton XML Inspector</span>
              </button>
              <button
                type="button"
                onClick={() => { onOpenPythonExporter(); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 flex items-center justify-between"
              >
                <span>Python FastAPI Exporter</span>
              </button>
              {onOpenArchitectureModal && (
                <button
                  type="button"
                  onClick={() => { onOpenArchitectureModal(); closeMenu(); }}
                  className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 flex items-center justify-between"
                >
                  <span>System Architecture Spec</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* WINDOW / HELP MENU */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setActiveMenu(activeMenu === 'window' ? null : 'window')}
            onMouseEnter={() => activeMenu && setActiveMenu('window')}
            className={`px-2 py-1 rounded transition-colors ${
              activeMenu === 'window' ? 'bg-[#1E2530] text-amber-400' : 'hover:bg-[#161C24] text-zinc-300'
            }`}
          >
            Window
          </button>
          {activeMenu === 'window' && (
            <div className="absolute top-full left-0 mt-0.5 w-52 bg-[#10141B] border border-[#232B36] rounded-md shadow-2xl py-1 z-50 text-[11px]">
              <button
                type="button"
                onClick={() => { onResetLayout(); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300"
              >
                Restore Default Layout
              </button>
              <button
                type="button"
                onClick={() => { onOpenCommandPalette(); closeMenu(); }}
                className="w-full text-left px-3 py-1.5 hover:bg-amber-500/20 hover:text-amber-300 flex items-center justify-between"
              >
                <span>Command Search</span>
                <span className="text-[10px] text-zinc-500">Cmd+K</span>
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Active Project Title, Theme Toggle & Settings */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-[10px] text-zinc-400 truncate max-w-[160px] sm:max-w-[280px]">
          {projectName}
        </span>

        {/* Theme Switcher Toggle */}
        {onToggleTheme && (
          <button
            type="button"
            onClick={() => onToggleTheme(themeMode === 'light' ? 'dark' : 'light')}
            className="p-1 rounded bg-[#161C24] hover:bg-[#202835] text-amber-400 border border-[#273244] transition-colors flex items-center gap-1 text-[10px]"
            title={`Switch to ${themeMode === 'light' ? 'Dark Mode' : 'High Contrast Light Mode'}`}
          >
            {themeMode === 'light' ? <Moon className="w-3 h-3 text-amber-400" /> : <Sun className="w-3 h-3 text-amber-400" />}
            <span className="hidden md:inline">{themeMode === 'light' ? 'Dark' : 'Light'}</span>
          </button>
        )}

        {/* Settings Modal Toggle */}
        {onOpenSettings && (
          <button
            type="button"
            onClick={onOpenSettings}
            className="p-1 px-1.5 rounded bg-[#161C24] hover:bg-[#202835] text-zinc-300 border border-[#273244] hover:text-amber-400 transition-colors flex items-center gap-1 text-[10px]"
            title="Open DAW Workstation Settings"
          >
            <Settings className="w-3 h-3 text-amber-400" />
            <span className="hidden sm:inline">Settings</span>
          </button>
        )}

        {/* PWA / APK Install Button */}
        <PWAInstallButton />

        <span className="px-1.5 py-0.5 rounded bg-zinc-800 border border-zinc-700 text-[9px] text-zinc-400">
          ALS 12.0
        </span>
      </div>
    </div>
  );
};
