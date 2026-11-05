import React, { useState } from 'react';
import { Sparkles, Music, Layers, Clock, Sliders, X, Play } from 'lucide-react';
import { TechnoSubgenreId } from '../types/ableton';

export interface NewProjectOptions {
  title: string;
  subgenreId: TechnoSubgenreId;
  bpm: number;
  durationBars: number; // 32, 64, 128, 180
  formFamily: 'hypnotic_longform' | 'industrial_assault' | 'deep_dub_evolution' | 'subtractive_raw' | 'acid_modulation';
  layerDensity: 'compact' | 'standard' | 'full_reference';
}

interface NewProjectModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateProject: (options: NewProjectOptions) => void;
}

export const NewProjectModal: React.FC<NewProjectModalProps> = ({
  isOpen,
  onClose,
  onCreateProject,
}) => {
  const [title, setTitle] = useState('Underground Techno Session');
  const [subgenreId, setSubgenreId] = useState<TechnoSubgenreId>('raw_warehouse');
  const [bpm, setBpm] = useState<number>(138);
  const [durationBars, setDurationBars] = useState<number>(128);
  const [formFamily, setFormFamily] = useState<'hypnotic_longform' | 'industrial_assault' | 'deep_dub_evolution' | 'subtractive_raw' | 'acid_modulation'>('hypnotic_longform');
  const [layerDensity, setLayerDensity] = useState<'compact' | 'standard' | 'full_reference'>('full_reference');

  if (!isOpen) return null;

  const handleSubgenreChange = (sub: TechnoSubgenreId) => {
    setSubgenreId(sub);
    switch (sub) {
      case 'berlin_industrial': setBpm(134); break;
      case 'raw_warehouse': setBpm(138); break;
      case 'hardgroove': setBpm(142); break;
      case 'acid_techno': setBpm(140); break;
      case 'dub_techno': setBpm(130); break;
      default: setBpm(136); break;
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onCreateProject({
      title,
      subgenreId,
      bpm,
      durationBars,
      formFamily,
      layerDensity,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 overflow-y-auto">
      <div className="bg-slate-900 border border-slate-700 rounded-xl max-w-2xl w-full text-slate-100 shadow-2xl overflow-hidden my-8">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-800/80 border-b border-slate-700">
          <div className="flex items-center space-x-2">
            <Sparkles className="w-5 h-5 text-emerald-400" />
            <h2 className="text-lg font-bold text-white tracking-wide">New Dynamic Ableton Project Generator</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Project Title */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Project Title
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition"
              placeholder="Enter session title..."
              required
            />
          </div>

          {/* Subgenre Selection */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Techno Subgenre & Tempo
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5">
              {[
                { id: 'raw_warehouse', label: 'Raw Warehouse', defaultBpm: 138, desc: 'Hypnotic rolling 909 drums & sub' },
                { id: 'berlin_industrial', label: 'Berlin Industrial', defaultBpm: 134, desc: 'Berghain dark resonance & noise' },
                { id: 'hardgroove', label: 'Hardgroove Tribal', defaultBpm: 142, desc: 'Percussive syncopated rides' },
                { id: 'acid_techno', label: '303 Acid Modular', defaultBpm: 140, desc: 'Resonant diode sweeps & slides' },
                { id: 'dub_techno', label: 'Dub Atmospheric', defaultBpm: 130, desc: '3/16 echo throws & chord pads' },
                { id: 'driving_rolling', label: 'Driving Peak Time', defaultBpm: 136, desc: 'Relentless driving bassline' },
              ].map((style) => (
                <button
                  type="button"
                  key={style.id}
                  onClick={() => handleSubgenreChange(style.id as TechnoSubgenreId)}
                  className={`p-3 text-left rounded-lg border text-xs transition ${
                    subgenreId === style.id
                      ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300'
                      : 'bg-slate-800/60 border-slate-700/80 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="font-semibold text-white mb-0.5">{style.label}</div>
                  <div className="text-[10px] text-slate-400">{style.defaultBpm} BPM · {style.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Target Duration */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Arrangement Span & Duration (4/4 @ {bpm} BPM)
            </label>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
              {[
                { bars: 128, label: '128 Bars', badge: 'Recommended', role: 'Full Track' },
                { bars: 64, label: '64 Bars', badge: 'Extended', role: 'Extended' },
                { bars: 180, label: '180 Bars', badge: 'Reference', role: 'Reference' },
                { bars: 32, label: '32 Bars', badge: 'Sketch', role: 'Sketch' },
              ].map((dur) => {
                const exactSeconds = (dur.bars * 240) / Math.max(20, bpm);
                const mins = Math.floor(exactSeconds / 60);
                const secs = Math.round(exactSeconds % 60);
                const formattedTime = `${mins}:${secs.toString().padStart(2, '0')}`;
                return (
                  <button
                    type="button"
                    key={dur.bars}
                    onClick={() => setDurationBars(dur.bars)}
                    className={`p-3 text-left rounded-lg border text-xs transition ${
                      durationBars === dur.bars
                        ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300'
                        : 'bg-slate-800/60 border-slate-700/80 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-0.5">
                      <span className="font-bold text-white">{dur.label}</span>
                      <span className="text-[9px] px-1.5 py-0.5 bg-slate-700/60 rounded text-slate-300">{dur.badge}</span>
                    </div>
                    <div className="text-[10px] text-slate-400">
                      {formattedTime} ({exactSeconds.toFixed(1)}s) · {dur.role}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Form Dynamic Family */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Arrangement Dynamic Form
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
              {[
                { id: 'hypnotic_longform', label: 'Full Techno Plateaus & Drops', desc: 'Staggered layer withdrawals, 2 breakdown plateaus, & peak drops' },
                { id: 'subtractive_raw', label: 'Subtractive Raw Pressure', desc: 'Sudden kick dropouts & percussion isolation windows' },
                { id: 'industrial_assault', label: 'Industrial Tension Riser', desc: 'Noise sweeps, distorted ratchets, & relentless drive' },
                { id: 'acid_modulation', label: '303 Acid Filter Evolution', desc: 'Resonance sweeps, slide articulation, & 16th accent modulation' },
              ].map((form) => (
                <button
                  type="button"
                  key={form.id}
                  onClick={() => setFormFamily(form.id as any)}
                  className={`p-3 text-left rounded-lg border text-xs transition ${
                    formFamily === form.id
                      ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300'
                      : 'bg-slate-800/60 border-slate-700/80 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="font-semibold text-white mb-0.5">{form.label}</div>
                  <div className="text-[10px] text-slate-400">{form.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Layer Density */}
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-400 mb-2">
              Instrument & Role Layer Density
            </label>
            <div className="grid grid-cols-3 gap-2.5">
              {[
                { id: 'full_reference', label: 'Full Reference Pack', desc: '14-19 Layers (Dual Kick, Rumble, Congas, Hats, Rides, Acid, Pads, Returns)' },
                { id: 'standard', label: 'Standard Production', desc: '9-12 Layers (Kick, Sub, Perc, Synth, Hats, Rides, Return Reverb)' },
                { id: 'compact', label: 'Essential Groove', desc: '6-8 Layers (Kick, Rumble, Hats, Lead Synth, Return Echo)' },
              ].map((den) => (
                <button
                  type="button"
                  key={den.id}
                  onClick={() => setLayerDensity(den.id as any)}
                  className={`p-2.5 text-left rounded-lg border text-xs transition ${
                    layerDensity === den.id
                      ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300'
                      : 'bg-slate-800/60 border-slate-700/80 text-slate-300 hover:border-slate-600'
                  }`}
                >
                  <div className="font-semibold text-white mb-0.5">{den.label}</div>
                  <div className="text-[10px] text-slate-400">{den.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Footer Submit Button */}
          <div className="pt-2 flex items-center justify-end space-x-3 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-400 hover:text-white transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs rounded-lg shadow-lg flex items-center space-x-2 transition"
            >
              <Sparkles className="w-4 h-4" />
              <span>Generate Complete Project ({durationBars} Bars)</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
