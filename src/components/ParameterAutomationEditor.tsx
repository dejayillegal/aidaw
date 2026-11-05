import React, { useState } from 'react';
import type { AbletonTrack, AutomatedTrackParameter, ParameterAutomationLane } from '../types/ableton';
import { PARAMETER_LIMITS } from '../engine/parameterAutomation';

export function ParameterAutomationEditor({ track, endBeat, onApply }: {
  track: AbletonTrack; endBeat: number; onApply: (lanes: ParameterAutomationLane[]) => void;
}) {
  const [target, setTarget] = useState<AutomatedTrackParameter>('filterCutoffHz');
  const [start, setStart] = useState(200), [end, setEnd] = useState(5000);
  const [curve, setCurve] = useState<'linear' | 'exponential' | 'smooth' | 'step'>('smooth');
  const limits = PARAMETER_LIMITS[target];
  const existing = track.parameterAutomation || [];
  const input = 'min-h-12 min-w-0 w-full rounded border border-slate-700 bg-[#12161B] px-2';
  return <details className="rounded border border-slate-700 p-2" aria-label="Parameter automation editor">
    <summary className="min-h-12 cursor-pointer py-3 text-xs font-semibold">Parameter automation · {existing.filter(l => l.enabled).length} active</summary>
    <p className="mb-2 text-xs text-zinc-400">Audio-time channel automation. Volume is a dB offset after the channel fader; cutoff is an additional channel low-pass. Sends and pan override their base values.</p>
    <label className="block text-xs">Target<select aria-label="Automation target" className={input} value={target} onChange={e => {
      const value = e.target.value as AutomatedTrackParameter; setTarget(value);
      setStart(value === 'filterCutoffHz' ? 200 : value === 'volumeDb' ? -6 : 0);
      setEnd(value === 'filterCutoffHz' ? 5000 : value === 'volumeDb' ? 0 : .5);
      if (value !== 'filterCutoffHz') setCurve('linear');
    }}>{Object.keys(PARAMETER_LIMITS).map(key => <option key={key} value={key}>{key}</option>)}</select></label>
    <div className="my-2 grid grid-cols-2 gap-2 text-xs">
      <label>Start value<input aria-label="Automation start value" type="number" min={limits[0]} max={limits[1]} step="any" value={start} onChange={e => setStart(e.target.valueAsNumber)} className={input} /></label>
      <label>End value<input aria-label="Automation end value" type="number" min={limits[0]} max={limits[1]} step="any" value={end} onChange={e => setEnd(e.target.valueAsNumber)} className={input} /></label>
    </div>
    <label className="block text-xs">Curve<select aria-label="Automation curve" value={curve} onChange={e => setCurve(e.target.value as typeof curve)} className={input}>
      {(['linear', 'exponential', 'smooth', 'step'] as const).map(value => <option key={value}>{value}</option>)}
    </select></label>
    <button type="button" disabled={track.locked || !Number.isFinite(start) || !Number.isFinite(end) || start < limits[0] || start > limits[1] || end < limits[0] || end > limits[1] || (curve === 'exponential' && (start <= 0 || end <= 0))}
      onClick={() => onApply([...existing.filter(l => l.target !== target), { version: 1, id: `lane:${track.id}:${target}`, target, enabled: true,
        points: [{ beat: 0, value: start, curve }, { beat: endBeat, value: end }] }])}
      className="my-2 min-h-12 w-full rounded border border-cyan-700 px-2 text-xs text-cyan-300 disabled:opacity-40">Apply sweep over {endBeat} beats</button>
    {existing.map(lane => <div key={lane.id} className="my-2 border-t border-slate-700 py-2 text-xs">
      <p>{lane.target} · {lane.points.length} points · {lane.enabled ? 'active' : 'disabled'}</p>
      <button type="button" disabled={track.locked} className="min-h-12 px-2 text-cyan-300 disabled:opacity-40" onClick={() => onApply(existing.map(l => l.id === lane.id ? { ...l, enabled: !l.enabled } : l))}>{lane.enabled ? 'Disable' : 'Enable'} {lane.target}</button>
      <button type="button" disabled={track.locked} className="min-h-12 px-2 text-rose-300 disabled:opacity-40" onClick={() => onApply(existing.filter(l => l.id !== lane.id))}>Remove {lane.target}</button>
    </div>)}
  </details>;
}
