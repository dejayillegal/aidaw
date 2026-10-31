import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Command,
  Disc,
  Layers,
  Plus,
  Scissors,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import {
  AbletonProjectState,
  AbletonTrack,
  AudioStripSilenceConfig,
  HumanizationConfig,
  MasterBusConfig,
  MidiGhostPruningConfig,
} from '../types/ableton';
import {
  applyAudioStripSilenceToTrack,
  applyMidiGhostNotePruning,
  createTrackTakeSnapshot,
  previewAudioStripSilence,
  previewMidiGhostNotePruning,
  STUDIO_COMMAND_DEFINITIONS,
  switchActiveTrackTake,
} from '../services/commandBus';

interface StudioCommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onExecuteCommandId: (commandId: string) => void;
  project: AbletonProjectState;
  onJumpToBeat: (beat: number, zoomBars?: number) => void;
  onSelectTrack: (trackId: string) => void;
}

export const StudioCommandPalette: React.FC<StudioCommandPaletteProps> = ({
  isOpen,
  onClose,
  onExecuteCommandId,
  project,
  onJumpToBeat,
  onSelectTrack,
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filteredCommands = useMemo(() => {
    const q = query.trim().toLowerCase();
    const baseCommands = STUDIO_COMMAND_DEFINITIONS.map((cmd) => ({
      id: cmd.id,
      title: cmd.title,
      category: cmd.category,
      shortcut: cmd.shortcut || '',
      description: cmd.description,
      action: () => {
        onExecuteCommandId(cmd.id);
        onClose();
      },
    }));

    const locatorCommands = (project.memoryLocations || []).map((loc) => ({
      id: `locator.jump.${loc.number}`,
      title: `Jump to Memory Location [${loc.number}]: ${loc.name} (Bar ${
        Math.floor(loc.beat / 4) + 1
      })`,
      category: 'Edit Modes & Locators' as const,
      shortcut: `${loc.number}`,
      description: `Recall marker #${loc.number} at beat ${loc.beat}`,
      action: () => {
        onJumpToBeat(loc.beat, loc.zoomBars);
        onClose();
      },
    }));

    const trackCommands = project.tracks.map((trk, idx) => ({
      id: `track.select.${trk.id}`,
      title: `Focus Track ${idx + 1}: ${trk.name} (${trk.archetype.toUpperCase()})`,
      category: 'SoundCraft Mix & VCA' as const,
      shortcut: `Alt+${idx + 1}`,
      description: `Select ${trk.name} in timeline, device rack, and waveform strip`,
      action: () => {
        onSelectTrack(trk.id);
        onClose();
      },
    }));

    const all = [...baseCommands, ...locatorCommands, ...trackCommands];
    if (!q) return all;
    return all.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        item.category.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q)
    );
  }, [query, project, onExecuteCommandId, onJumpToBeat, onSelectTrack, onClose]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filteredCommands.length > 0 ? (prev + 1) % filteredCommands.length : 0
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) =>
          filteredCommands.length > 0
            ? (prev - 1 + filteredCommands.length) % filteredCommands.length
            : 0
        );
      } else if (e.key === 'Enter' && filteredCommands[selectedIndex]) {
        e.preventDefault();
        filteredCommands[selectedIndex].action();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, filteredCommands, selectedIndex, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-start justify-center pt-14 p-3 font-mono">
      <div className="bg-zinc-950 border border-zinc-700 rounded-2xl w-full max-w-2xl shadow-2xl overflow-hidden">
        <div className="px-3.5 py-2.5 bg-zinc-900 border-b border-zinc-800 flex items-center gap-2.5">
          <Command className="w-4 h-4 text-orange-400 shrink-0" />
          <Search className="w-4 h-4 text-zinc-500 shrink-0" />
          <input
            type="text"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a studio command, edit mode (Grid/Slip/Shuffle/Spot), locator, or track..."
            className="flex-1 bg-transparent text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none"
          />
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded bg-zinc-800 text-zinc-400 hover:text-zinc-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="max-h-[380px] overflow-y-auto divide-y divide-zinc-900 p-1.5">
          {filteredCommands.length === 0 ? (
            <div className="py-8 text-center text-xs text-zinc-500">
              No matching studio commands found.
            </div>
          ) : (
            filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={cmd.id}
                  type="button"
                  onClick={cmd.action}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`w-full text-left px-3 py-2 rounded-lg flex items-center justify-between gap-3 transition-colors ${
                    isSelected ? 'bg-orange-500/20 text-zinc-100' : 'text-zinc-300 hover:bg-zinc-900'
                  }`}
                >
                  <div className="min-w-0">
                    <div className="text-xs font-bold truncate">{cmd.title}</div>
                    <div className="text-[10px] text-zinc-400 truncate">
                      <span className="text-orange-400/90">{cmd.category}</span> — {cmd.description}
                    </div>
                  </div>
                  {cmd.shortcut && (
                    <span className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-700 text-[10px] text-zinc-300 shrink-0">
                      {cmd.shortcut}
                    </span>
                  )}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

// ============================================================================
// TRACK COMPING PLAYLISTS & SEPARATE AUDIO STRIP SILENCE / GHOST PRUNING MODAL
// ============================================================================

interface CompingAndTransientModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: AbletonProjectState;
  selectedTrack: AbletonTrack;
  humanization: HumanizationConfig;
  masterBus: MasterBusConfig;
  onExecuteProjectCommand: (
    label: string,
    category: 'comping' | 'strip_silence' | 'ghost_prune',
    mutator: (draft: AbletonProjectState) => AbletonProjectState
  ) => void;
}

export const CompingAndTransientModal: React.FC<CompingAndTransientModalProps> = ({
  isOpen,
  onClose,
  project,
  selectedTrack,
  humanization,
  masterBus,
  onExecuteProjectCommand,
}) => {
  const [tab, setTab] = useState<'comping' | 'audio_strip_silence' | 'midi_ghost_prune'>(
    'comping'
  );
  const [newTakeName, setNewTakeName] = useState('');

  // Separate Audio Strip Silence state
  const [stripConfig, setStripConfig] = useState<AudioStripSilenceConfig>({
    thresholdOpenDb: -30,
    thresholdCloseDb: -34,
    minActiveDurationMs: 65,
    preAttackPadMs: 12,
    postReleasePadMs: 35,
  });

  // Separate MIDI Ghost-Note Pruning state
  const [ghostConfig, setGhostConfig] = useState<MidiGhostPruningConfig>({
    velocityThreshold: 55,
    probabilityThreshold: 0.65,
    minDurationBeats: 0.125,
    protectDownbeats: true,
    protectChordTones: true,
    protectAccents: true,
  });

  const stripPreview = useMemo(() => {
    if (!isOpen) {
      return { activeRegions: [], retainedNoteCount: 0, strippedSilentEventCount: 0 };
    }
    return previewAudioStripSilence(
      project,
      selectedTrack.id,
      humanization,
      masterBus,
      stripConfig
    );
  }, [isOpen, project, selectedTrack.id, humanization, masterBus, stripConfig]);

  const ghostPreview = useMemo(() => {
    if (!isOpen) {
      return {
        totalNotes: 0,
        prunedNoteIds: [],
        retainedNotes: [],
        protectedAnchorCount: 0,
      };
    }
    return previewMidiGhostNotePruning(selectedTrack, ghostConfig);
  }, [isOpen, selectedTrack, ghostConfig]);

  if (!isOpen) return null;

  const takes = selectedTrack.takes || [];

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 font-mono">
      <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
              Track Comping Playlists &amp; Transient Tools — {selectedTrack.name}
            </h3>
            <p className="text-[10px] text-zinc-400">
              Extensible Comp Takes + Strictly Separated Audio Strip Silence vs MIDI Ghost-Note Pruning
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Sub-Tabs */}
        <div className="px-4 pt-3 flex flex-wrap gap-2 border-b border-zinc-800 pb-2.5 bg-zinc-900/40">
          <button
            type="button"
            onClick={() => setTab('comping')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              tab === 'comping'
                ? 'bg-orange-500 text-zinc-950'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            1. Track Comping Playlists ({takes.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('audio_strip_silence')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              tab === 'audio_strip_silence'
                ? 'bg-emerald-500 text-zinc-950'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
            }`}
          >
            <Scissors className="w-3.5 h-3.5" />
            2. Audio Strip Silence (dB Hysteresis)
          </button>
          <button
            type="button"
            onClick={() => setTab('midi_ghost_prune')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
              tab === 'midi_ghost_prune'
                ? 'bg-purple-500 text-zinc-950'
                : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            3. MIDI Ghost-Note Pruning
          </button>
        </div>

        <div className="p-4 space-y-4">
          {tab === 'comping' && (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={newTakeName}
                  onChange={(e) => setNewTakeName(e.target.value)}
                  placeholder="Optional Take Name (e.g., Peak Warehouse Variation)..."
                  className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-100"
                />
                <button
                  type="button"
                  onClick={() => {
                    onExecuteProjectCommand(
                      `Create Take Snapshot on ${selectedTrack.name}`,
                      'comping',
                      (draft) =>
                        createTrackTakeSnapshot(draft, selectedTrack.id, newTakeName)
                    );
                    setNewTakeName('');
                  }}
                  className="px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-400 text-zinc-950 font-bold text-xs flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Snapshot Current Pattern as New Take
                </button>
              </div>

              <div className="space-y-2 max-h-[280px] overflow-y-auto">
                {takes.map((take, idx) => {
                  const isActive = take.id === selectedTrack.activeTakeId;
                  return (
                    <div
                      key={take.id}
                      onClick={() =>
                        onExecuteProjectCommand(
                          `Switch Active Take to ${take.name}`,
                          'comping',
                          (draft) =>
                            switchActiveTrackTake(draft, selectedTrack.id, take.id)
                        )
                      }
                      className={`p-3 rounded-xl border cursor-pointer flex items-center justify-between ${
                        isActive
                          ? 'bg-orange-500/15 border-orange-500/60 text-zinc-100'
                          : 'bg-zinc-900/60 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Disc
                          className={`w-4 h-4 ${
                            isActive ? 'text-orange-400' : 'text-zinc-500'
                          }`}
                        />
                        <div>
                          <div className="text-xs font-bold">
                            #{idx + 1} — {take.name}
                          </div>
                          <div className="text-[10px] text-zinc-400">
                            {(take.notesSnapshot || take.notes || []).length} MIDI events •{' '}
                            {take.activeAudioRegions
                              ? `${take.activeAudioRegions.length} gated audio regions`
                              : 'Full arrangement span'}
                          </div>
                        </div>
                      </div>

                      {isActive ? (
                        <span className="px-2 py-0.5 rounded bg-orange-500 text-zinc-950 font-bold text-[10px] flex items-center gap-1">
                          <Check className="w-3 h-3" /> ACTIVE TAKE
                        </span>
                      ) : (
                        <span className="text-[10px] text-zinc-400">Click to Audition</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {tab === 'audio_strip_silence' && (
            <div className="space-y-3 text-xs">
              <div className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-[11px] text-emerald-200">
                <strong>Audio Strip Silence (Signal Energy Gate):</strong> Evaluates the track&apos;s
                rendered audio/synthesis waveform with open/close hysteresis, minimum active duration,
                and pre-attack/post-release padding.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">
                    Open Threshold ({stripConfig.thresholdOpenDb} dBFS)
                  </label>
                  <input
                    type="range"
                    min={-54}
                    max={-10}
                    step={1}
                    value={stripConfig.thresholdOpenDb}
                    onChange={(e) => {
                      const openDb = Number(e.target.value);
                      setStripConfig((prev) => ({
                        ...prev,
                        thresholdOpenDb: openDb,
                        thresholdCloseDb: Math.min(prev.thresholdCloseDb ?? -35, openDb - 2),
                      }));
                    }}
                    className="w-full accent-emerald-400"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">
                    Close Hysteresis Threshold ({stripConfig.thresholdCloseDb ?? -35} dBFS)
                  </label>
                  <input
                    type="range"
                    min={-60}
                    max={(stripConfig.thresholdOpenDb ?? -32) - 1}
                    step={1}
                    value={stripConfig.thresholdCloseDb}
                    onChange={(e) =>
                      setStripConfig((prev) => ({
                        ...prev,
                        thresholdCloseDb: Number(e.target.value),
                      }))
                    }
                    className="w-full accent-emerald-400"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">
                    Min Active Region Duration ({stripConfig.minActiveDurationMs} ms)
                  </label>
                  <input
                    type="range"
                    min={20}
                    max={300}
                    step={5}
                    value={stripConfig.minActiveDurationMs}
                    onChange={(e) =>
                      setStripConfig((prev) => ({
                        ...prev,
                        minActiveDurationMs: Number(e.target.value),
                      }))
                    }
                    className="w-full accent-emerald-400"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">
                    Pre-Attack / Post-Release Pad ({stripConfig.preAttackPadMs}ms /{' '}
                    {stripConfig.postReleasePadMs}ms)
                  </label>
                  <input
                    type="range"
                    min={5}
                    max={120}
                    step={5}
                    value={stripConfig.postReleasePadMs}
                    onChange={(e) =>
                      setStripConfig((prev) => ({
                        ...prev,
                        postReleasePadMs: Number(e.target.value),
                      }))
                    }
                    className="w-full accent-emerald-400"
                  />
                </div>
              </div>

              <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between">
                <div className="text-[11px] text-zinc-300">
                  Detected Active Regions: <strong className="text-emerald-400">{stripPreview.activeRegions.length}</strong> •
                  Retained Events: <strong>{stripPreview.retainedNoteCount}</strong> •
                  Gated Out: <strong className="text-rose-400">{stripPreview.strippedSilentEventCount}</strong>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onExecuteProjectCommand(
                      `Apply Audio Strip Silence on ${selectedTrack.name}`,
                      'strip_silence',
                      (draft) =>
                        applyAudioStripSilenceToTrack(
                          draft,
                          selectedTrack.id,
                          humanization,
                          masterBus,
                          stripConfig
                        )
                    );
                    onClose();
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-xs"
                >
                  Apply Audio Strip Silence (Undoable)
                </button>
              </div>
            </div>
          )}

          {tab === 'midi_ghost_prune' && (
            <div className="space-y-3 text-xs">
              <div className="p-2.5 rounded-lg bg-purple-500/10 border border-purple-500/30 text-[11px] text-purple-200">
                <strong>MIDI Ghost-Note Pruning:</strong> Filters low-velocity, low-probability, or
                ultra-short ornamental notes while strictly protecting structural downbeats, chord
                tones, and TB-303 accents.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">
                    Velocity Threshold (&le; {ghostConfig.velocityThreshold})
                  </label>
                  <input
                    type="range"
                    min={20}
                    max={95}
                    step={1}
                    value={ghostConfig.velocityThreshold}
                    onChange={(e) =>
                      setGhostConfig((prev) => ({
                        ...prev,
                        velocityThreshold: Number(e.target.value),
                      }))
                    }
                    className="w-full accent-purple-400"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">
                    Probability Threshold (&lt; {Math.round((ghostConfig.probabilityThreshold ?? 0.5) * 100)}%)
                  </label>
                  <input
                    type="range"
                    min={0.1}
                    max={0.95}
                    step={0.05}
                    value={ghostConfig.probabilityThreshold ?? 0.5}
                    onChange={(e) =>
                      setGhostConfig((prev) => ({
                        ...prev,
                        probabilityThreshold: Number(e.target.value),
                      }))
                    }
                    className="w-full accent-purple-400"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-zinc-400 mb-1">
                    Short Duration (&le; {ghostConfig.minDurationBeats} beats)
                  </label>
                  <input
                    type="range"
                    min={0.0625}
                    max={0.5}
                    step={0.0625}
                    value={ghostConfig.minDurationBeats}
                    onChange={(e) =>
                      setGhostConfig((prev) => ({
                        ...prev,
                        minDurationBeats: Number(e.target.value),
                      }))
                    }
                    className="w-full accent-purple-400"
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4 pt-1">
                <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ghostConfig.protectDownbeats}
                    onChange={(e) =>
                      setGhostConfig((prev) => ({
                        ...prev,
                        protectDownbeats: e.target.checked,
                      }))
                    }
                    className="accent-purple-400"
                  />
                  Protect Downbeat Anchors
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ghostConfig.protectChordTones}
                    onChange={(e) =>
                      setGhostConfig((prev) => ({
                        ...prev,
                        protectChordTones: e.target.checked,
                      }))
                    }
                    className="accent-purple-400"
                  />
                  Protect Chord Tones
                </label>
                <label className="flex items-center gap-1.5 text-[11px] text-zinc-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={ghostConfig.protectAccents}
                    onChange={(e) =>
                      setGhostConfig((prev) => ({
                        ...prev,
                        protectAccents: e.target.checked,
                      }))
                    }
                    className="accent-purple-400"
                  />
                  Protect Accents (&ge; 108 vel)
                </label>
              </div>

              <div className="p-3 rounded-xl bg-zinc-900 border border-zinc-800 flex items-center justify-between">
                <div className="text-[11px] text-zinc-300">
                  Total Notes: <strong>{ghostPreview.totalNotes}</strong> • Pruned Ghosts:{' '}
                  <strong className="text-purple-400">{ghostPreview.prunedNoteIds.length}</strong> •
                  Protected Anchors: <strong className="text-emerald-400">{ghostPreview.protectedAnchorCount}</strong>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onExecuteProjectCommand(
                      `Prune ${ghostPreview.prunedNoteIds.length} Ghost Notes on ${selectedTrack.name}`,
                      'ghost_prune',
                      (draft) =>
                        applyMidiGhostNotePruning(draft, selectedTrack.id, ghostConfig)
                    );
                    onClose();
                  }}
                  className="px-3.5 py-1.5 rounded-lg bg-purple-500 hover:bg-purple-400 text-zinc-950 font-bold text-xs"
                >
                  Apply MIDI Ghost-Note Pruning (Undoable)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
