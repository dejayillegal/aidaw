import React, { useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Layers,
  Plus,
  Power,
  Sliders,
  Volume2,
} from 'lucide-react';
import {
  AbletonDeviceType,
  AbletonProjectState,
  AbletonTrack,
  MasterBusConfig,
  VcaGroupId,
  VcaGroupState,
} from '../types/ableton';
import {
  commitVcaGainsToTrackFaders,
  composeEffectiveTrackGain,
  getDeviceCompatibilityInfo,
  insertDeviceIntoChannelStrip,
  MAX_CHANNEL_INSERT_SLOTS,
  reorderChannelInsertDevice,
  toggleChannelInsertBypass,
} from '../engine/channelStripEngine';
import { getDefaultVcaGroups } from '../engine/alsXmlEngine';
import { synthEngine } from '../engine/webAudioSynth';

interface SoundCraftMixConsoleProps {
  project: AbletonProjectState;
  selectedTrackId: string;
  masterBus: MasterBusConfig;
  masterPeakDb: number;
  onSelectTrack: (trackId: string) => void;
  onUpdateProjectWithUndo: (
    label: string,
    category: 'mixer' | 'vca',
    mutator: (draft: AbletonProjectState) => AbletonProjectState
  ) => void;
  onUpdateMasterBus: (next: MasterBusConfig) => void;
}

const INSERTABLE_DSP_DEVICES: { type: AbletonDeviceType; label: string }[] = [
  { type: 'EQEight', label: 'EQ Eight (8-Band Parametric)' },
  { type: 'Compressor2', label: 'Compressor 2 (Sidechain)' },
  { type: 'GlueCompressor', label: 'Glue Compressor (Analog Bus)' },
  { type: 'Saturator', label: 'Saturator (Waveshaper Drive)' },
  { type: 'Roar', label: 'Roar (Multi-Stage Saturation)' },
  { type: 'AutoFilter', label: 'Auto Filter (24dB Ladder)' },
  { type: 'Limiter', label: 'Limiter (True Peak Brickwall)' },
  { type: 'Utility', label: 'Utility (Gain & Stereo Width)' },
  { type: 'DrumBuss', label: 'Drum Buss (Transient Shaper)' },
  { type: 'Reverb', label: 'Hybrid Reverb (Send/Insert)' },
  { type: 'Delay', label: 'Ping-Pong Delay (3/16 Sync)' },
];

export const SoundCraftMixConsole: React.FC<SoundCraftMixConsoleProps> = ({
  project,
  selectedTrackId,
  masterBus,
  masterPeakDb,
  onSelectTrack,
  onUpdateProjectWithUndo,
  onUpdateMasterBus,
}) => {
  const [openInsertPickerSlot, setOpenInsertPickerSlot] = useState<{
    trackId: string;
    slotIdx: number;
  } | null>(null);

  const [previewVolumes, setPreviewVolumes] = useState<Record<string, number>>({});
  const [previewPans, setPreviewPans] = useState<Record<string, number>>({});
  const [previewSends, setPreviewSends] = useState<Record<string, { reverbSend?: number; delaySend?: number }>>({});

  const vcaGroups: VcaGroupState[] = project.vcaGroups || getDefaultVcaGroups();

  const handleTrackVolumePreview = (trackId: string, volumeDb: number) => {
    const roundedVol = Number(volumeDb.toFixed(1));
    setPreviewVolumes((prev) => ({ ...prev, [trackId]: roundedVol }));
    synthEngine.updateTrackMixerLive(trackId, { volumeDb: roundedVol });
  };

  const handleTrackVolumeCommit = (trackId: string, volumeDb: number) => {
    const roundedVol = Number(volumeDb.toFixed(1));
    setPreviewVolumes((prev) => {
      const next = { ...prev };
      delete next[trackId];
      return next;
    });
    synthEngine.updateTrackMixerLive(trackId, { volumeDb: roundedVol });
    onUpdateProjectWithUndo(
      `Set Track Fader (${roundedVol.toFixed(1)} dB)`,
      'mixer',
      (draft) => {
        draft.tracks = draft.tracks.map((t) =>
          t.id === trackId
            ? {
                ...t,
                mixer: {
                  ...(t.mixer || {
                    volumeDb: 0,
                    pan: 0,
                    transposeSemitones: 0,
                    fineTuneCents: 0,
                    sidechainDepth: 0.4,
                    reverbSend: 0.2,
                    delaySend: 0.15,
                    filterCutoffHz: 800,
                    filterResonance: 0.3,
                  }),
                  volumeDb: roundedVol,
                },
              }
            : t
        );
        return draft;
      }
    );
  };

  const handleTrackPanPreview = (trackId: string, pan: number) => {
    setPreviewPans((prev) => ({ ...prev, [trackId]: pan }));
    synthEngine.updateTrackMixerLive(trackId, { pan });
  };

  const handleTrackPanCommit = (trackId: string, pan: number) => {
    setPreviewPans((prev) => {
      const next = { ...prev };
      delete next[trackId];
      return next;
    });
    synthEngine.updateTrackMixerLive(trackId, { pan });
    onUpdateProjectWithUndo(`Set Track Pan (${pan.toFixed(2)})`, 'mixer', (draft) => {
      draft.tracks = draft.tracks.map((t) =>
        t.id === trackId && t.mixer ? { ...t, mixer: { ...t.mixer, pan } } : t
      );
      return draft;
    });
  };

  const handleTrackSendPreview = (
    trackId: string,
    sendKey: 'reverbSend' | 'delaySend',
    val: number
  ) => {
    setPreviewSends((prev) => ({
      ...prev,
      [trackId]: { ...(prev[trackId] || {}), [sendKey]: val },
    }));
    synthEngine.updateTrackMixerLive(trackId, { [sendKey]: val });
  };

  const handleTrackSendCommit = (
    trackId: string,
    sendKey: 'reverbSend' | 'delaySend',
    val: number
  ) => {
    setPreviewSends((prev) => {
      const next = { ...prev };
      delete next[trackId];
      return next;
    });
    synthEngine.updateTrackMixerLive(trackId, { [sendKey]: val });
    onUpdateProjectWithUndo(`Adjust ${sendKey}`, 'mixer', (draft) => {
      draft.tracks = draft.tracks.map((t) =>
        t.id === trackId && t.mixer ? { ...t, mixer: { ...t.mixer, [sendKey]: val } } : t
      );
      return draft;
    });
  };

  const handleTrackMuteSolo = (trackId: string, field: 'muted' | 'soloed') => {
    const currentTrack = project.tracks.find((t) => t.id === trackId);
    if (currentTrack) {
      synthEngine.updateTrackMixerLive(trackId, undefined, {
        [field]: !currentTrack[field],
      });
    }
    onUpdateProjectWithUndo(`Toggle Track ${field}`, 'mixer', (draft) => {
      draft.tracks = draft.tracks.map((t) =>
        t.id === trackId ? { ...t, [field]: !t[field] } : t
      );
      return draft;
    });
  };

  const handleAssignTrackVca = (trackId: string, vcaGroupId: VcaGroupId) => {
    onUpdateProjectWithUndo(`Assign Track VCA (${vcaGroupId})`, 'vca', (draft) => {
      draft.tracks = draft.tracks.map((t) =>
        t.id === trackId ? { ...t, vcaGroupId } : t
      );
      return draft;
    });
  };

  const handleInsertDevice = (
    trackId: string,
    deviceType: AbletonDeviceType,
    slotIdx: number
  ) => {
    onUpdateProjectWithUndo(
      `Insert ${deviceType} in Slot ${slotIdx + 1}`,
      'mixer',
      (draft) => {
        draft.tracks = draft.tracks.map((t) => {
          if (t.id !== trackId) return t;
          const res = insertDeviceIntoChannelStrip(t, deviceType, slotIdx);
          return res.updatedTrack;
        });
        return draft;
      }
    );
    setOpenInsertPickerSlot(null);
  };

  const handleToggleBypass = (trackId: string, deviceId: string) => {
    onUpdateProjectWithUndo('Toggle Insert Bypass', 'mixer', (draft) => {
      draft.tracks = draft.tracks.map((t) =>
        t.id === trackId ? toggleChannelInsertBypass(t, deviceId) : t
      );
      return draft;
    });
  };

  const handleReorderInsert = (trackId: string, fromIdx: number, toIdx: number) => {
    onUpdateProjectWithUndo('Reorder Channel Insert', 'mixer', (draft) => {
      draft.tracks = draft.tracks.map((t) =>
        t.id === trackId ? reorderChannelInsertDevice(t, fromIdx, toIdx) : t
      );
      return draft;
    });
  };

  const handleVcaGroupChange = (
    vcaId: VcaGroupId,
    updates: Partial<VcaGroupState>
  ) => {
    onUpdateProjectWithUndo(`Update VCA Group (${vcaId})`, 'vca', (draft) => {
      const currentGroups = draft.vcaGroups || vcaGroups;
      draft.vcaGroups = currentGroups.map((g) =>
        g.id === vcaId ? { ...g, ...updates } : g
      );
      return draft;
    });
  };

  const handleCommitVcaToTrackFaders = () => {
    onUpdateProjectWithUndo(
      'Commit VCA Gains to Track Faders',
      'vca',
      (draft) => {
        const committed = commitVcaGainsToTrackFaders(
          draft.tracks,
          draft.vcaGroups || vcaGroups
        );
        draft.tracks = committed.tracks;
        draft.vcaGroups = committed.vcaGroups;
        return draft;
      }
    );
  };

  return (
    <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-3 space-y-3 text-xs font-mono">
      {/* Top Console Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-800">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-orange-500/15 border border-orange-500/30 text-orange-400">
            <Sliders className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
              SoundCraft Mix Console — 10-Slot Channel Strips &amp; Non-Destructive VCA Matrix
            </h3>
            <p className="text-[10px] text-zinc-400">
              Effective Gain = TrackBaseFader + AutomationOffset + VCAGroupGain (Base faders never overwritten by VCA)
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="px-2 py-1 rounded bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-300">
            Channels: <strong className="text-orange-400">{project.tracks.length}</strong> + 2 Returns + Master
          </span>
          <button
            type="button"
            onClick={handleCommitVcaToTrackFaders}
            className="px-2.5 py-1 rounded bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-amber-300 text-[10px] font-semibold flex items-center gap-1 transition-colors"
            title="Explicitly bake non-destructive VCA group offsets into Track Base Faders and reset VCA faders to 0.0 dB"
          >
            <CheckCircle2 className="w-3 h-3" />
            Commit VCA Gains to Track Faders
          </button>
        </div>
      </div>

      {/* VCA Group Masters Strip Bar */}
      <div className="bg-zinc-900/70 border border-zinc-800/90 rounded-lg p-2.5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" />
            Non-Destructive VCA Group Master Faders
          </span>
          <span className="text-[10px] text-zinc-400">
            Adjusting VCA group gain scales member tracks without altering their individual base faders
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          {vcaGroups.map((vca) => {
            const memberCount = project.tracks.filter((t) => t.vcaGroupId === vca.id).length;
            return (
              <div
                key={vca.id}
                className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 flex flex-col gap-1.5"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: vca.color }}
                    />
                    <span className="text-[10px] font-bold text-zinc-200">{vca.name}</span>
                  </div>
                  <span className="text-[9px] text-zinc-400">{memberCount} trk</span>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    min={-24}
                    max={12}
                    step={0.5}
                    value={vca.gainDb}
                    onChange={(e) =>
                      handleVcaGroupChange(vca.id, { gainDb: Number(e.target.value) })
                    }
                    className="flex-1 accent-amber-400 h-1.5"
                  />
                  <span
                    className={`w-14 text-right text-[10px] font-bold ${
                      vca.gainDb > 0
                        ? 'text-amber-300'
                        : vca.gainDb < 0
                        ? 'text-sky-300'
                        : 'text-zinc-300'
                    }`}
                  >
                    {vca.gainDb >= 0 ? `+${vca.gainDb.toFixed(1)}` : vca.gainDb.toFixed(1)} dB
                  </span>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-zinc-900">
                  <button
                    type="button"
                    onClick={() => handleVcaGroupChange(vca.id, { gainDb: 0 })}
                    className="text-[9px] text-zinc-400 hover:text-zinc-200"
                  >
                    0.0 dB Unity
                  </button>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleVcaGroupChange(vca.id, { muted: !vca.muted })}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                        vca.muted
                          ? 'bg-rose-500/25 border-rose-500 text-rose-300'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                      }`}
                    >
                      VCA M
                    </button>
                    <button
                      type="button"
                      onClick={() => handleVcaGroupChange(vca.id, { soloed: !vca.soloed })}
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${
                        vca.soloed
                          ? 'bg-amber-500/25 border-amber-500 text-amber-300'
                          : 'bg-zinc-900 border-zinc-800 text-zinc-400'
                      }`}
                    >
                      VCA S
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Horizontal Scrollable Channel Strip Console */}
      <div className="overflow-x-auto pb-2">
        <div className="flex items-stretch gap-2.5 min-w-max">
          {project.tracks.map((track: AbletonTrack) => {
            const isSelected = track.id === selectedTrackId;
            const vcaComp = composeEffectiveTrackGain(track, project.tracks, vcaGroups);
            const devices = track.devices || [];

            return (
              <div
                key={track.id}
                onClick={() => onSelectTrack(track.id)}
                className={`w-[186px] rounded-xl border flex flex-col justify-between p-2 transition-all cursor-pointer ${
                  isSelected
                    ? 'bg-zinc-900/95 border-orange-500/60 shadow-lg shadow-orange-500/5'
                    : 'bg-zinc-900/50 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                {/* Strip Top Header */}
                <div>
                  <div
                    className="h-1.5 rounded-full mb-1.5"
                    style={{ backgroundColor: track.color || '#f97316' }}
                  />
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-bold text-[11px] text-zinc-100 truncate">
                      {track.name}
                    </span>
                    <span className="text-[9px] uppercase px-1 py-0.5 rounded bg-zinc-950 text-zinc-400 border border-zinc-800">
                      {track.archetype}
                    </span>
                  </div>

                  {/* VCA Assignment Selector */}
                  <div className="mt-1.5 flex items-center justify-between gap-1">
                    <span className="text-[9px] text-zinc-400">VCA:</span>
                    <select
                      value={track.vcaGroupId || 'none'}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        handleAssignTrackVca(track.id, e.target.value as VcaGroupId)
                      }
                      className="bg-zinc-950 border border-zinc-800 rounded px-1.5 py-0.5 text-[9px] text-zinc-200 focus:outline-none focus:border-orange-500"
                    >
                      <option value="drums">VCA 1: Drums</option>
                      <option value="bass">VCA 2: Bass</option>
                      <option value="synths">VCA 3: Synths</option>
                      <option value="fx">VCA 4: FX</option>
                      <option value="none">Unassigned</option>
                    </select>
                  </div>

                  {/* 10 Ordered Insert Slots */}
                  <div className="mt-2">
                    <div className="flex items-center justify-between text-[9px] text-zinc-400 mb-1">
                      <span>INSERTS (1–{MAX_CHANNEL_INSERT_SLOTS})</span>
                      <span>
                        {devices.length}/{MAX_CHANNEL_INSERT_SLOTS}
                      </span>
                    </div>

                    <div className="space-y-1 max-h-[210px] overflow-y-auto pr-0.5">
                      {Array.from({ length: MAX_CHANNEL_INSERT_SLOTS }, (_, slotIdx) => {
                        const dev = devices[slotIdx];
                        const isPickerOpen =
                          openInsertPickerSlot?.trackId === track.id &&
                          openInsertPickerSlot?.slotIdx === slotIdx;

                        if (dev) {
                          const compat = getDeviceCompatibilityInfo(dev);
                          return (
                            <div
                              key={dev.id || `slot_${slotIdx}`}
                              onClick={(e) => e.stopPropagation()}
                              className={`flex items-center justify-between gap-1 px-1.5 py-1 rounded border text-[9px] ${
                                dev.bypassed
                                  ? 'bg-zinc-950/60 border-zinc-800/70 text-zinc-500 line-through'
                                  : 'bg-zinc-950 border-zinc-700/80 text-zinc-200'
                              }`}
                              title={`${dev.name} — ${compat.badgeLabel} (${
                                dev.isUserCreated ? 'User/Imported Device' : 'Studio Calibrated'
                              })`}
                            >
                              <div className="flex items-center gap-1 min-w-0">
                                <button
                                  type="button"
                                  onClick={() => handleToggleBypass(track.id, dev.id)}
                                  className={`p-0.5 rounded ${
                                    dev.bypassed
                                      ? 'text-zinc-600 hover:text-zinc-400'
                                      : 'text-emerald-400 hover:text-emerald-300'
                                  }`}
                                  title="Toggle Insert Bypass"
                                >
                                  <Power className="w-2.5 h-2.5" />
                                </button>
                                <span className="truncate font-medium">
                                  {slotIdx + 1}. {dev.name}
                                </span>
                              </div>

                              <div className="flex items-center gap-0.5 shrink-0">
                                {slotIdx > 0 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleReorderInsert(track.id, slotIdx, slotIdx - 1)
                                    }
                                    className="text-zinc-500 hover:text-zinc-200"
                                    title="Move Insert Up"
                                  >
                                    <ArrowUp className="w-2.5 h-2.5" />
                                  </button>
                                )}
                                {slotIdx < devices.length - 1 && (
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleReorderInsert(track.id, slotIdx, slotIdx + 1)
                                    }
                                    className="text-zinc-500 hover:text-zinc-200"
                                    title="Move Insert Down"
                                  >
                                    <ArrowDown className="w-2.5 h-2.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div
                            key={`empty_${slotIdx}`}
                            onClick={(e) => e.stopPropagation()}
                            className="relative"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                setOpenInsertPickerSlot(
                                  isPickerOpen ? null : { trackId: track.id, slotIdx }
                                )
                              }
                              className="w-full flex items-center justify-between px-1.5 py-0.5 rounded border border-dashed border-zinc-800/80 hover:border-zinc-700 text-[9px] text-zinc-500 hover:text-zinc-300"
                            >
                              <span>Slot {slotIdx + 1}: Empty</span>
                              <Plus className="w-2.5 h-2.5" />
                            </button>

                            {isPickerOpen && (
                              <div className="mt-1 p-1 rounded bg-zinc-950 border border-zinc-700 shadow-xl space-y-0.5 z-20">
                                {INSERTABLE_DSP_DEVICES.map((opt) => (
                                  <button
                                    key={opt.type}
                                    type="button"
                                    onClick={() =>
                                      handleInsertDevice(track.id, opt.type, slotIdx)
                                    }
                                    className="w-full text-left px-1.5 py-1 rounded hover:bg-orange-500/20 text-[9px] text-zinc-200 flex items-center justify-between"
                                  >
                                    <span className="truncate">{opt.label}</span>
                                    <span className="text-[8px] text-emerald-400">DSP</span>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

                {/* Sends A & B + Pan + Base Fader & Composed Effective Gain */}
                <div className="mt-2 pt-2 border-t border-zinc-800 space-y-2" onClick={(e) => e.stopPropagation()}>
                  {/* Send A / Send B */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <div className="bg-zinc-950 border border-zinc-800/80 rounded p-1">
                      <div className="flex justify-between text-[8.5px] text-zinc-400">
                        <span>Send A (Rev)</span>
                        <span className="text-sky-300">
                          {Math.round((track.mixer?.reverbSend ?? 0.2) * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.02}
                        value={previewSends[track.id]?.reverbSend ?? track.mixer?.reverbSend ?? 0.2}
                        onInput={(e) =>
                          handleTrackSendPreview(
                            track.id,
                            'reverbSend',
                            Number((e.target as HTMLInputElement).value)
                          )
                        }
                        onChange={(e) =>
                          handleTrackSendCommit(
                            track.id,
                            'reverbSend',
                            Number(e.target.value)
                          )
                        }
                        onPointerUp={(e) =>
                          handleTrackSendCommit(
                            track.id,
                            'reverbSend',
                            Number((e.target as HTMLInputElement).value)
                          )
                        }
                        className="w-full accent-sky-400 h-1 mt-0.5"
                      />
                    </div>
                    <div className="bg-zinc-950 border border-zinc-800/80 rounded p-1">
                      <div className="flex justify-between text-[8.5px] text-zinc-400">
                        <span>Send B (Dly)</span>
                        <span className="text-purple-300">
                          {Math.round((previewSends[track.id]?.delaySend ?? track.mixer?.delaySend ?? 0.15) * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.02}
                        value={previewSends[track.id]?.delaySend ?? track.mixer?.delaySend ?? 0.15}
                        onInput={(e) =>
                          handleTrackSendPreview(
                            track.id,
                            'delaySend',
                            Number((e.target as HTMLInputElement).value)
                          )
                        }
                        onChange={(e) =>
                          handleTrackSendCommit(
                            track.id,
                            'delaySend',
                            Number(e.target.value)
                          )
                        }
                        onPointerUp={(e) =>
                          handleTrackSendCommit(
                            track.id,
                            'delaySend',
                            Number((e.target as HTMLInputElement).value)
                          )
                        }
                        className="w-full accent-purple-400 h-1 mt-0.5"
                      />
                    </div>
                  </div>

                  {/* Stereo Pan */}
                  <div className="bg-zinc-950 border border-zinc-800/80 rounded p-1">
                    <div className="flex justify-between text-[8.5px] text-zinc-400">
                      <span>Pan</span>
                      <span className="text-zinc-200">
                        {(() => {
                          const currentPan = previewPans[track.id] ?? track.mixer?.pan ?? 0;
                          return currentPan === 0
                            ? 'C'
                            : currentPan < 0
                            ? `${Math.round(Math.abs(currentPan) * 50)}L`
                            : `${Math.round(currentPan * 50)}R`;
                        })()}
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-1}
                      max={1}
                      step={0.05}
                      value={previewPans[track.id] ?? track.mixer?.pan ?? 0}
                      onInput={(e) =>
                        handleTrackPanPreview(track.id, Number((e.target as HTMLInputElement).value))
                      }
                      onChange={(e) =>
                        handleTrackPanCommit(track.id, Number(e.target.value))
                      }
                      onPointerUp={(e) =>
                        handleTrackPanCommit(track.id, Number((e.target as HTMLInputElement).value))
                      }
                      className="w-full accent-zinc-300 h-1 mt-0.5"
                    />
                  </div>

                  {/* Base Fader + Non-Destructive VCA Effective Readout */}
                  <div className="bg-zinc-950 border border-zinc-800 rounded p-1.5 space-y-1">
                    <div className="flex items-center justify-between text-[9px]">
                      <span className="text-zinc-400">Base Fader:</span>
                      <span className="font-bold text-zinc-100">
                        {(() => {
                          const displayVol = previewVolumes[track.id] ?? vcaComp.baseVolumeDb;
                          return displayVol >= 0 ? `+${displayVol.toFixed(1)}` : displayVol.toFixed(1);
                        })()}{' '}
                        dB
                      </span>
                    </div>
                    <input
                      type="range"
                      min={-36}
                      max={6}
                      step={0.5}
                      value={previewVolumes[track.id] ?? vcaComp.baseVolumeDb}
                      onInput={(e) =>
                        handleTrackVolumePreview(track.id, Number((e.target as HTMLInputElement).value))
                      }
                      onChange={(e) =>
                        handleTrackVolumeCommit(track.id, Number(e.target.value))
                      }
                      onPointerUp={(e) =>
                        handleTrackVolumeCommit(track.id, Number((e.target as HTMLInputElement).value))
                      }
                      className="w-full accent-orange-500 h-1.5"
                    />
                    <div className="flex items-center justify-between text-[8.5px] pt-0.5 border-t border-zinc-900">
                      <span className="text-zinc-500">
                        VCA:{' '}
                        {vcaComp.vcaGainDb >= 0
                          ? `+${vcaComp.vcaGainDb.toFixed(1)}`
                          : vcaComp.vcaGainDb.toFixed(1)}
                        dB
                      </span>
                      <span className="text-emerald-400 font-semibold">
                        Eff:{' '}
                        {vcaComp.effectivelyMuted
                          ? 'MUTED'
                          : `${vcaComp.effectiveVolumeDb.toFixed(1)}dB`}
                      </span>
                    </div>
                  </div>

                  {/* Mute / Solo Buttons */}
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleTrackMuteSolo(track.id, 'muted')}
                      className={`py-1 rounded font-bold text-[10px] border transition-colors ${
                        track.muted
                          ? 'bg-rose-500/25 border-rose-500 text-rose-300'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      MUTE
                    </button>
                    <button
                      type="button"
                      onClick={() => handleTrackMuteSolo(track.id, 'soloed')}
                      className={`py-1 rounded font-bold text-[10px] border transition-colors ${
                        track.soloed
                          ? 'bg-amber-500/25 border-amber-500 text-amber-300'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      SOLO
                    </button>
                  </div>
                </div>
              </div>
            );
          })}

          {/* Return A, Return B & Master Strip */}
          <div className="w-[205px] rounded-xl border border-zinc-700/80 bg-zinc-900/90 p-2.5 flex flex-col justify-between">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-1.5">
                <span className="font-bold text-[11px] text-orange-400 flex items-center gap-1">
                  <Volume2 className="w-3.5 h-3.5" />
                  RETURNS &amp; MASTER BUS
                </span>
              </div>

              {/* Return A: Warehouse Reverb */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 space-y-1">
                <div className="flex justify-between text-[9.5px]">
                  <span className="text-sky-300 font-semibold">Return A: Reverb</span>
                  <span className="text-zinc-300">
                    {Math.round(masterBus.reverbReturnLevel * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={masterBus.reverbReturnLevel}
                  onChange={(e) =>
                    onUpdateMasterBus({
                      ...masterBus,
                      reverbReturnLevel: Number(e.target.value),
                    })
                  }
                  className="w-full accent-sky-400 h-1"
                />
                <div className="flex justify-between text-[8.5px] text-zinc-400">
                  <span>Decay: {masterBus.reverbDecaySec.toFixed(1)}s</span>
                  <span>HPF 150Hz</span>
                </div>
              </div>

              {/* Return B: 3/16 Dub Echo */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 space-y-1">
                <div className="flex justify-between text-[9.5px]">
                  <span className="text-purple-300 font-semibold">Return B: 3/16 Echo</span>
                  <span className="text-zinc-300">
                    {Math.round(masterBus.delayReturnLevel * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={masterBus.delayReturnLevel}
                  onChange={(e) =>
                    onUpdateMasterBus({
                      ...masterBus,
                      delayReturnLevel: Number(e.target.value),
                    })
                  }
                  className="w-full accent-purple-400 h-1"
                />
                <div className="flex justify-between text-[8.5px] text-zinc-400">
                  <span>Feedback: {Math.round(masterBus.delayFeedback * 100)}%</span>
                  <span>Ping-Pong</span>
                </div>
              </div>

              {/* Master Glue Compressor */}
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 space-y-1">
                <div className="flex justify-between text-[9.5px]">
                  <span className="text-amber-300 font-semibold">Master Glue Drive</span>
                  <span className="text-zinc-300">
                    {Math.round(masterBus.glueCompressionDrive * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={masterBus.glueCompressionDrive}
                  onChange={(e) =>
                    onUpdateMasterBus({
                      ...masterBus,
                      glueCompressionDrive: Number(e.target.value),
                    })
                  }
                  className="w-full accent-amber-400 h-1"
                />
              </div>
            </div>

            {/* Master Output Fader & Peak Meter */}
            <div className="mt-2 pt-2 border-t border-zinc-800 space-y-2">
              <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-2 space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-300 font-bold">MASTER FADER</span>
                  <span className="text-orange-400 font-bold">
                    {masterBus.masterVolumeDb >= 0
                      ? `+${masterBus.masterVolumeDb.toFixed(1)}`
                      : masterBus.masterVolumeDb.toFixed(1)}{' '}
                    dB
                  </span>
                </div>
                <input
                  type="range"
                  min={-24}
                  max={6}
                  step={0.5}
                  value={masterBus.masterVolumeDb}
                  onChange={(e) =>
                    onUpdateMasterBus({
                      ...masterBus,
                      masterVolumeDb: Number(e.target.value),
                    })
                  }
                  className="w-full accent-orange-500 h-1.5"
                />
                <div className="flex justify-between text-[9px] text-zinc-400 pt-1">
                  <span>Live Bus Peak:</span>
                  <span
                    className={
                      masterPeakDb > -1.0 ? 'text-rose-400 font-bold' : 'text-emerald-400'
                    }
                  >
                    {masterPeakDb <= -58 ? '-∞' : `${masterPeakDb.toFixed(1)} dBFS`}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
