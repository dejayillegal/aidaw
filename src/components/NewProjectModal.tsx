import React, { useEffect, useRef, useState } from 'react';
import { Sparkles, X } from 'lucide-react';
import type { TechnoSubgenreId } from '../types/ableton';
import type { NewProjectOptions } from '../services/projectCreationService';
import { CREATION_STYLE_STRATEGIES } from '../services/projectCreationService';
import { styleLayerRecipes } from '../engine/layerPlanning';
export type { NewProjectOptions } from '../services/projectCreationService';

const styles = [
  { id: 'raw_warehouse', label: 'Raw Warehouse', bpm: 138 },
  { id: 'hypnotic_deep', label: 'Hypnotic Plateau', bpm: 136 },
  { id: 'berlin_industrial', label: 'Berlin Industrial', bpm: 134 },
  { id: 'hardgroove', label: 'Hardgroove Tribal', bpm: 142 },
  { id: 'acid_techno', label: '303 Acid Modular', bpm: 140 },
  { id: 'dub_techno', label: 'Dub Atmospheric', bpm: 130 },
  { id: 'driving_rolling', label: 'Driving Peak Time', bpm: 136 },
  { id: 'minimal_micro', label: 'Minimal Micro Groove', bpm: 128 },
];

export function NewProjectModal({ isOpen, initialDurationBars = 128, onClose, onCreateProject }: {
  isOpen: boolean;
  initialDurationBars?: number;
  onClose: () => void;
  onCreateProject: (options: NewProjectOptions) => Promise<void>;
}) {
  const [title, setTitle] = useState('Underground Techno Session');
  const [subgenreId, setSubgenreId] = useState<TechnoSubgenreId>('raw_warehouse');
  const [bpm, setBpm] = useState(138);
  const [durationBars, setDurationBars] = useState(initialDurationBars);
  const [seed, setSeed] = useState(777);
  const [layerDensity, setLayerDensity] = useState<NewProjectOptions['layerDensity']>('full_reference');
  const [rootKey,setRootKey]=useState('F'),[mode,setMode]=useState('Phrygian');
  const [formFamily,setFormFamily]=useState<NonNullable<NewProjectOptions['formFamily']>>('style-default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialog = useRef<HTMLDivElement>(null);
  const submitting = useRef(false);

  useEffect(() => {
    if (!isOpen) return;
    setDurationBars(initialDurationBars); setError('');
    setSeed(Math.floor(Math.random() * 0x100000000));
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLInputElement>('input')?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); if (!submitting.current) onClose(); }
      if (event.key === 'Tab') {
        const elements = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') || [])];
        const first = elements[0], last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => { document.removeEventListener('keydown', key, true); previous?.focus(); };
  }, [isOpen, initialDurationBars]);

  if (!isOpen) return null;
  const seconds = durationBars * 240 / bpm;
  const rounded = Math.round(seconds);
  const durationText = Number.isFinite(rounded) ? `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}` : '—';
  const inputClass = 'w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-white focus:outline-none focus:ring-2 focus:ring-emerald-500';
  return (
    <div className="fixed inset-0 z-50 bg-black/80 p-3 sm:p-5 flex items-center justify-center">
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="new-project-title"
        className="w-full max-w-2xl max-h-[calc(100dvh-1.5rem)] overflow-y-auto bg-slate-900 border border-slate-700 rounded-xl text-slate-100 shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 p-4 bg-slate-900 border-b border-slate-700">
          <h2 id="new-project-title" className="font-semibold">Create Full Track</h2>
          <button type="button" aria-label="Close new project" disabled={busy} onClick={onClose} className="min-w-11 min-h-11 grid place-items-center rounded hover:bg-slate-800"><X className="w-5 h-5" /></button>
        </div>
        <form className="p-4 space-y-5" onSubmit={async event => {
          event.preventDefault(); if (submitting.current) return;
          submitting.current = true; setBusy(true); setError('');
          try { await onCreateProject({ title, subgenreId, bpm, durationBars, seed, layerDensity,rootKey,mode,formFamily }); onClose(); }
          catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
          finally { submitting.current = false; setBusy(false); }
        }}>
          <fieldset disabled={busy} className="space-y-5 min-w-0">
            <label className="block text-sm space-y-2"><span>Project title</span><input required maxLength={160} value={title} onChange={e => setTitle(e.target.value)} className={inputClass} /></label>
            <div className="space-y-2"><h3 className="text-sm">Techno style</h3><div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {styles.map(style => <button type="button" key={style.id} aria-pressed={subgenreId === style.id}
                onClick={() => { setSubgenreId(style.id as TechnoSubgenreId); setBpm(style.bpm); }}
                className={`min-h-11 px-3 py-2 rounded border text-left text-xs ${subgenreId === style.id ? 'border-emerald-500 bg-emerald-950' : 'border-slate-600 bg-slate-800'}`}>
                {style.label}<span className="block text-slate-400">{style.bpm} BPM preset</span>
              </button>)}
            </div></div>
            <div className="grid grid-cols-2 gap-3">
              <label className="space-y-2 text-sm"><span>Tempo (BPM)</span><input type="number" min={40} max={240} step={0.5} required value={bpm} onChange={e => setBpm(e.target.valueAsNumber)} className={inputClass} /></label>
              <label className="space-y-2 text-sm"><span>Duration (bars)</span><input type="number" min={4} max={4096} step={1} required value={durationBars} onChange={e => setDurationBars(e.target.valueAsNumber)} className={inputClass} /></label>
            </div>
            <p className="text-xs text-slate-300" aria-live="polite">{durationText} in 4/4 at {bpm} BPM ({Number.isFinite(seconds) ? seconds.toFixed(1) : '—'} seconds), plus effect tails.</p>
            <div className="grid grid-cols-2 gap-3 text-sm"><label>Key<select aria-label="Composition key" value={rootKey} onChange={e=>setRootKey(e.target.value)} className={inputClass}>{['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].map(key=><option key={key}>{key}</option>)}</select></label>
              <label>Mode<select aria-label="Composition mode" value={mode} onChange={e=>setMode(e.target.value)} className={inputClass}>{['Phrygian','Dorian','Natural Minor','Harmonic Minor','Locrian','Phrygian Dominant','Octatonic'].map(value=><option key={value}>{value}</option>)}</select></label></div>
            <label className="block text-sm">Song form<select aria-label="Composition form" value={formFamily} onChange={e=>setFormFamily(e.target.value as typeof formFamily)} className={inputClass}>
              <option value="style-default">Style-led form</option><option value="plateau">Plateau and reduction</option><option value="dual-drop">Dual arrival and main peak</option><option value="dub-evolution">Overlapping dub evolution</option>
            </select><span className="text-xs text-slate-400">Forms adapt to duration; extended forms develop from 64 bars.</span></label>
            <div className="flex flex-wrap gap-2">{[32, 64, 128, 180].map(bars => <button type="button" key={bars} aria-pressed={durationBars === bars} onClick={() => setDurationBars(bars)} className="min-h-11 px-3 rounded border border-slate-600 text-xs">{bars} Bars</button>)}</div>
            <label className="block text-sm space-y-2"><span>Generation seed</span><input type="number" min={0} max={0xffffffff} step={1} required value={seed} onChange={e => setSeed(e.target.valueAsNumber)} className={inputClass} /></label>
            <div className="space-y-2"><h3 className="text-sm">Instrument layers</h3><div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {([{ id: 'compact', label: 'Essential ensemble' }, { id: 'standard', label: 'Developed ensemble' }, { id: 'full_reference', label: 'Full style ensemble' }] as const).map(density => <button type="button" key={density.id} aria-pressed={layerDensity === density.id} onClick={() => setLayerDensity(density.id)} className={`min-h-12 p-2 rounded border text-xs ${layerDensity === density.id ? 'border-emerald-500 bg-emerald-950' : 'border-slate-600'}`}>{density.label}</button>)}
            </div><p className="text-xs text-slate-400">The selected style plans sections, harmony and independent track phrases. Sketch projects remain available in the File menu.</p></div>
            <div aria-label="Planned style layers" className="rounded border border-slate-700 p-3 text-xs text-cyan-200"><p>Layer palette · inactive supporting layers are omitted from short sketches.</p><p className="mt-2 text-slate-300">{styleLayerRecipes(CREATION_STYLE_STRATEGIES[subgenreId],layerDensity,Number.isSafeInteger(seed)?seed:0).map(r=>r.name).join(' · ')}</p></div>
          </fieldset>
          {error && <p role="alert" className="text-sm text-rose-300 break-words">{error}</p>}
          <div className="flex flex-wrap justify-end gap-2 border-t border-slate-700 pt-4">
            <button type="button" disabled={busy} onClick={onClose} className="min-h-11 px-4 rounded border border-slate-600">Cancel</button>
            <button type="submit" disabled={busy} className="min-h-11 px-4 py-2 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 rounded text-sm flex items-center gap-2"><Sparkles className="w-4 h-4" />{busy ? 'Creating and saving project…' : `Generate Complete Project (${durationBars} Bars)`}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
