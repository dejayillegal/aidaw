import React, { useState } from 'react';
import { AbletonDevice, AbletonProjectState, AbletonTrack } from '../types/ableton';
import { substituteUnsupportedDevice } from '../services/commandBus';
import { AlertTriangle, CheckCircle2, Cpu, Download, HardDrive, ShieldCheck, X } from 'lucide-react';

interface UnsupportedPluginModalProps {
  project: AbletonProjectState;
  isOpen: boolean;
  onClose: () => void;
  onUpdateProject: (updated: AbletonProjectState) => void;
}

export const UnsupportedPluginModal: React.FC<UnsupportedPluginModalProps> = ({
  project,
  isOpen,
  onClose,
  onUpdateProject,
}) => {
  if (!isOpen) return null;

  // Locate all tracks and devices containing unsupported devices (<AuPluginDevice>, <PluginDevice>, etc.)
  const unsupportedItems: { track: AbletonTrack; device: AbletonDevice }[] = [];
  project.tracks.forEach((track) => {
    track.devices.forEach((dev) => {
      const isUnsupported =
        dev.xmlTag === 'AuPluginDevice' ||
        dev.xmlTag === 'PluginDevice' ||
        dev.xmlTag === 'MxDeviceAudioEffect' ||
        dev.isUnsupportedPlugin === true;
      if (isUnsupported) {
        unsupportedItems.push({ track, device: dev });
      }
    });
  });

  const handleSubstitute = (
    trackId: string,
    deviceId: string,
    replacement: 'Operator' | 'Analog' | 'Wavetable' | 'Simpler' | 'EQEight' | 'Reverb' | 'Compressor2'
  ) => {
    const updated = substituteUnsupportedDevice(project, trackId, deviceId, replacement);
    onUpdateProject(updated);
  };

  const handleToggleBypass = (trackId: string, deviceId: string) => {
    const updatedTracks = project.tracks.map((t) => {
      if (t.id !== trackId) return t;
      const updatedDevs = t.devices.map((d) => {
        if (d.id !== deviceId) return d;
        return { ...d, bypassed: !d.bypassed };
      });
      return { ...t, devices: updatedDevs };
    });
    onUpdateProject({ ...project, tracks: updatedTracks });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-150">
      <div
        className="w-full max-w-2xl bg-[#0F131A] border border-[#232B3A] rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh] text-slate-100 font-mono"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 bg-[#141A24] border-b border-[#232B3A] flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-amber-400" />
            <div>
              <h2 className="text-sm font-bold text-amber-300 uppercase tracking-wide">
                Third-Party Plugin Dependencies ({unsupportedItems.length})
              </h2>
              <p className="text-[11px] text-slate-400">
                Preserve original plugin XML &amp; parameters while driving browser playback with built-in DSP
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-[#1E2736] text-slate-400 hover:text-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="p-5 overflow-y-auto space-y-4 flex-1">
          <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-200 text-xs flex items-start gap-2.5">
            <ShieldCheck className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
            <div>
              <span className="font-bold">Non-Destructive XML Provenance Guarantee:</span>
              <p className="mt-0.5 text-[11px] text-amber-200/90 leading-relaxed">
                Imported VST3/AU binary plugin state (<code className="text-amber-100">&lt;AuPluginDevice&gt;</code>) is preserved 100% intact in original XML. Substituting a browser synthesis engine allows immediate sample-accurate audio playback &amp; WAV export without corrupting your original Ableton Live set.
              </p>
            </div>
          </div>

          {unsupportedItems.length === 0 ? (
            <div className="py-8 text-center text-slate-400 text-xs flex flex-col items-center gap-2">
              <CheckCircle2 className="w-8 h-8 text-emerald-400" />
              <span>No unsupported plugin dependencies in current project!</span>
            </div>
          ) : (
            <div className="space-y-3">
              {unsupportedItems.map(({ track, device }) => {
                const isSubstituted = Boolean(device.substitutedActiveType);
                const isBypassed = Boolean(device.bypassed);

                return (
                  <div
                    key={`${track.id}_${device.id}`}
                    className="p-4 rounded-lg bg-[#121721] border border-[#232B3A] space-y-3"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <div>
                        <div className="font-bold text-slate-100 flex items-center gap-2">
                          <span
                            className="w-2 h-2 rounded-full"
                            style={{ backgroundColor: track.hexColor || '#F59E0B' }}
                          />
                          <span>{track.name}</span>
                          <span className="text-slate-500">·</span>
                          <span className="text-sky-300">&lt;{device.xmlTag}&gt;</span>
                        </div>
                        <p className="text-[10.5px] text-slate-400 mt-0.5">
                          ID {device.id} · {device.displayName}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 text-[10px]">
                        {isSubstituted ? (
                          <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold">
                            Substituted ({device.substitutedActiveType})
                          </span>
                        ) : isBypassed ? (
                          <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/40 font-bold">
                            Bypassed (Original XML Safe)
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded bg-rose-500/20 text-rose-300 border border-rose-500/40 font-bold">
                            Un-bypassed
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Action Row */}
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#1C2330] text-[11px]">
                      <button
                        type="button"
                        onClick={() => handleToggleBypass(track.id, device.id)}
                        className={`px-2.5 py-1 rounded border font-semibold transition-colors ${
                          isBypassed
                            ? 'bg-amber-500/25 text-amber-300 border-amber-500/50 hover:bg-amber-500/35'
                            : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                        }`}
                      >
                        {isBypassed ? 'Keep Bypassed' : 'Bypass Plugin'}
                      </button>

                      <div className="h-4 w-px bg-slate-800 my-auto" />

                      <span className="text-slate-400 text-[10px]">Substitute Active DSP:</span>

                      {device.category === 'instrument' || device.xmlTag === 'AuPluginDevice' || device.xmlTag === 'PluginDevice' ? (
                        <>
                          <button
                            type="button"
                            onClick={() => handleSubstitute(track.id, device.id, 'Operator')}
                            className="px-2.5 py-1 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 font-semibold"
                          >
                            + Operator Synth
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSubstitute(track.id, device.id, 'Analog')}
                            className="px-2.5 py-1 rounded bg-purple-500/20 hover:bg-purple-500/30 text-purple-300 border border-purple-500/40 font-semibold"
                          >
                            + Analog 303
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSubstitute(track.id, device.id, 'Simpler')}
                            className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-semibold"
                          >
                            + Simpler Sampler
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => handleSubstitute(track.id, device.id, 'EQEight')}
                            className="px-2.5 py-1 rounded bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-500/40 font-semibold"
                          >
                            + EQ Eight
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSubstitute(track.id, device.id, 'Reverb')}
                            className="px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 border border-emerald-500/40 font-semibold"
                          >
                            + Hybrid Reverb
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSubstitute(track.id, device.id, 'Compressor2')}
                            className="px-2.5 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-semibold"
                          >
                            + Compressor
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-[#141A24] border-t border-[#232B3A] flex items-center justify-between text-xs shrink-0">
          <span className="text-slate-400 text-[11px]">
            Original XML preserved for round-trip .als export
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
};
