import React, { useEffect, useState } from 'react';
import type { AbletonProjectState, AbletonTrack, SidechainCompressorConfig } from '../types/ableton';
import { defaultSidechain, SIDECHAIN_RANGES } from '../engine/sidechainGraph';
import { synthEngine } from '../engine/webAudioSynth';

export function SidechainCompressorEditor({project,track,onApply}:{project:AbletonProjectState;track:AbletonTrack;onApply:(config?:SidechainCompressorConfig)=>void}) {
  const keys=project.tracks.filter(t=>t.id!==track.id&&!t.isGroupTrack);
  const [draft,setDraft]=useState(()=>track.sidechainCompressor||defaultSidechain(keys.find(t=>t.archetype==='kick')?.id||keys[0]?.id||''));
  useEffect(()=>{setDraft(track.sidechainCompressor||defaultSidechain(keys.find(t=>t.archetype==='kick')?.id||keys[0]?.id||''));},[track.id,track.sidechainCompressor]);
  const gr=synthEngine.getSidechainReductionDb(track.id);
  return <details aria-label="Sidechain compressor editor" className="rounded border border-slate-700 p-2 text-xs">
    <summary className="min-h-12 cursor-pointer py-3 font-semibold">Signal-key sidechain · {track.sidechainCompressor?.enabled?'enabled':'off'}</summary>
    <p className="mb-2 text-zinc-400">Post-fader, post-mute stereo-linked key. Replaces event ducking on this destination. Processing is shared by playback and WAV export.</p>
    <label className="block">Key source<select aria-label="Sidechain key source" className="min-h-12 w-full rounded bg-slate-800 px-2" value={draft.sourceTrackId} onChange={e=>setDraft({...draft,sourceTrackId:e.target.value})}>
      {keys.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
    </select></label>
    <div className="my-2 grid grid-cols-2 gap-2">{Object.entries(SIDECHAIN_RANGES).map(([key,[min,max]])=><label key={key} className="min-w-0">{key}<input aria-label={`Sidechain ${key}`} type="number" min={min} max={max} step="any" value={draft[key as keyof typeof SIDECHAIN_RANGES]} onChange={e=>setDraft({...draft,[key]:e.target.valueAsNumber})} className="min-h-12 w-full min-w-0 rounded bg-slate-800 px-2"/></label>)}</div>
    <output aria-label="Sidechain gain reduction" className="block py-2 text-cyan-300">{gr===null?'Prepare with Play to read signal gain reduction':`${gr.toFixed(1)} dB gain reduction`}</output>
    <div className="flex flex-wrap gap-2"><button type="button" disabled={track.locked||!keys.length||Object.entries(SIDECHAIN_RANGES).some(([key,[min,max]])=>{const value=draft[key as keyof typeof SIDECHAIN_RANGES];return !Number.isFinite(value)||value<min||value>max;})} onClick={()=>onApply({...draft,enabled:true})} className="min-h-12 rounded border border-cyan-800 px-2 text-cyan-300 disabled:opacity-40">Apply signal sidechain</button>
      <button type="button" disabled={track.locked||!track.sidechainCompressor} onClick={()=>onApply(track.sidechainCompressor?{...track.sidechainCompressor,enabled:false}:undefined)} className="min-h-12 rounded border border-slate-700 px-2 disabled:opacity-40">Disable signal sidechain</button></div>
  </details>;
}
