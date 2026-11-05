import React, { useEffect, useRef, useState, useImperativeHandle, forwardRef } from 'react';
import type { ClearArrangementOptions } from '../types/ableton';
export interface ClearArrangementDialogHandle { show: () => void }
export const ClearArrangementDialog = forwardRef<ClearArrangementDialogHandle, { onApply: (options: ClearArrangementOptions) => string | undefined }>(function ClearArrangementDialog({onApply}, handle) {
  const [open, setOpen] = useState(false);
  const [options, onChange] = useState<ClearArrangementOptions>({scope:'selected_track',wipeNotes:true,wipeAutomation:true,wipeSessionClips:false,resetMixerToNeutral:false});
  const [error, setError] = useState<string>();
  const onClose = () => setOpen(false);
  useImperativeHandle(handle, () => ({show: () => {setError(undefined);setOpen(true)}}), []);
  const apply = () => {const error = onApply(options);setError(error);if(!error)onClose()};
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => { ref.current?.close(); if (previous?.isConnected) previous.focus(); };
  }, [open]);
  if (!open) return null;
  return <dialog ref={ref} aria-labelledby="clear-arrangement-title" onCancel={event => { event.preventDefault(); onClose(); }} className="m-auto w-[calc(100%-1.5rem)] max-w-lg max-h-[calc(100dvh-1.5rem)] overflow-y-auto rounded-xl border border-slate-600 bg-slate-900 text-slate-100 p-5 backdrop:bg-black/80">
    <h2 id="clear-arrangement-title" className="font-bold">Clear arrangement</h2>
    <p className="text-sm text-slate-300 my-3">Locked tracks, devices and audio media are preserved. This edit can be undone. Original ALS source and comp takes remain available.</p>
    <label className="block text-sm">Target tracks<select aria-label="Clear scope" value={options.scope} onChange={e => onChange({ ...options, scope: e.target.value as ClearArrangementOptions['scope'] })} className="w-full min-h-11 my-2 p-2 bg-slate-800 rounded">
      <option value="selected_track">Selected unlocked track</option><option value="unlocked_tracks">All unlocked tracks</option>
    </select></label>
    {([{ key: 'wipeNotes', label: 'Clear arrangement MIDI notes' }, { key: 'wipeAutomation', label: 'Clear filter-energy automation' }, { key: 'wipeSessionClips', label: 'Remove Session slots' }, { key: 'resetMixerToNeutral', label: 'Reset gain, pan and tuning' }] as const).map(({ key, label }) => <label key={key} className="flex gap-3 items-center min-h-11 text-sm"><input type="checkbox" checked={Boolean(options[key])} onChange={e => onChange({ ...options, [key]: e.target.checked })} />{label}</label>)}
    {error && <p role="alert" className="text-sm text-rose-300 my-3 break-words">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2 mt-4"><button type="button" onClick={onClose} className="min-h-11 px-4 border border-slate-600 rounded">Cancel</button><button type="button" onClick={apply} disabled={![options.wipeNotes, options.wipeAutomation, options.wipeSessionClips, options.resetMixerToNeutral].some(Boolean)} className="min-h-11 px-4 bg-rose-800 disabled:opacity-40 rounded">Clear selected content</button></div>
  </dialog>;
});
