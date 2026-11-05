import React, { useMemo, useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { ABLETON_BUILTIN_LIBRARY } from '../engine/alsXmlEngine';
import { ABLETON_DEVICE_REGISTRY } from '../engine/abletonCapabilityMatrix';
import { INSTRUMENT_ROLE_TAXONOMY } from '../engine/compositionIntelligenceEngine';
import type { AbletonProjectState } from '../types/ableton';

interface Props {
  initialView?: 'devices'|'tracks';
  onAddGeneratedLayer?: (roleCode:string)=>void;
  project: AbletonProjectState;
  selectedTrackId: string;
  onSelectTrack: (id: string) => void;
  onInsertDevice: (trackId: string, templateId: string) => void;
  onAddTrack?: (roleCode: string) => void;
}
export function StudioBrowser({initialView='devices',onAddGeneratedLayer,project,selectedTrackId,onSelectTrack,onInsertDevice,onAddTrack}: Props) {
  const [query,setQuery]=useState('');
  const [category,setCategory]=useState('all');
  const [view,setView]=useState<'devices'|'tracks'>(initialView);
  const needle=query.trim().toLocaleLowerCase();
  const devices=useMemo(()=>ABLETON_BUILTIN_LIBRARY.filter(d=>(category==='all'||d.category===category)&&`${d.displayName} ${d.description}`.toLocaleLowerCase().includes(needle)),[category,needle]);
  const roles=INSTRUMENT_ROLE_TAXONOMY.filter(r=>`${r.roleCode} ${r.name}`.toLocaleLowerCase().includes(needle));
  const target=project.tracks.find(t=>t.id===selectedTrackId);
  return <section aria-label="Sound browser" className="flex-1 min-h-0 min-w-0 overflow-y-auto bg-[#0B0D10] p-3 sm:p-5">
    <div className="mx-auto max-w-5xl space-y-4">
      <header><h1 className="text-lg font-semibold">Browser</h1><p className="mt-1 text-xs text-zinc-400">Add a track or a device to your project. Device support is shown before insertion.</p></header>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex min-h-11 flex-1 items-center gap-2 rounded border border-[#2a333e] bg-[#12161B] px-3"><Search className="h-4 w-4 text-zinc-400"/><input aria-label="Search browser" placeholder="Search tracks and devices" value={query} onChange={e=>setQuery(e.target.value)} className="w-full min-w-0 bg-transparent text-sm outline-none"/></label>
        <button type="button" aria-pressed={view==='devices'} onClick={()=>setView('devices')} className="min-h-11 rounded border border-[#2a333e] px-3 text-xs">Devices</button>
        <button type="button" aria-pressed={view==='tracks'} onClick={()=>setView('tracks')} className="min-h-11 rounded border border-[#2a333e] px-3 text-xs">Track roles</button>
      </div>
      {view==='devices' && <div className="flex flex-wrap items-center gap-3 text-xs">
        <label className="flex items-center gap-2">Category<select aria-label="Device category" value={category} onChange={e=>setCategory(e.target.value)} className="min-h-11 rounded border border-[#2a333e] bg-[#12161B] px-2">
          <option value="all">All devices</option><option value="instrument">Instruments</option><option value="audio_effect">Audio effects</option><option value="midi_effect">MIDI effects</option><option value="rack">Racks</option><option value="max_modulator">Modulators</option>
        </select></label>
        <label className="flex min-w-0 items-center gap-2">Target<select aria-label="Browser target track" value={selectedTrackId} onChange={e=>onSelectTrack(e.target.value)} className="min-h-11 max-w-64 rounded border border-[#2a333e] bg-[#12161B] px-2">
          {!target && <option value={selectedTrackId}>Select a track</option>}{project.tracks.map(t=><option key={t.id} value={t.id}>{t.name}</option>)}
        </select></label>
      </div>}
      <div role="status" className="text-xs text-zinc-400">{view==='devices'?devices.length:roles.length} results</div>
      <div className="grid gap-3 md:grid-cols-2">
        {view==='devices'?devices.map(d=>{
          const contract=ABLETON_DEVICE_REGISTRY[d.xmlTag];
          const support=contract?.status??'preserved-only';
          return <article key={d.id} className="rounded-lg border border-[#2a333e] bg-[#12161B] p-4">
            <div className="flex items-start justify-between gap-3"><h2 className="text-sm font-semibold">{d.displayName}</h2><span className="rounded bg-[#1B2128] px-2 py-1 text-[10px] text-cyan-300">{support}</span></div>
            <p className="mt-2 text-xs leading-relaxed text-zinc-400">{contract?.limitations||'Preserved in the project; audio execution is not qualified.'}</p>
            <button type="button" disabled={!target||!['executable','converted'].includes(support)} onClick={()=>target&&onInsertDevice(target.id,d.id)} className="mt-3 flex min-h-11 items-center gap-2 rounded bg-amber-500/15 px-3 text-xs font-semibold text-amber-300 disabled:opacity-40"><Plus className="h-4 w-4"/>{!['executable','converted'].includes(support)?'Import preservation only':d.category==='instrument'?'Choose instrument':'Add device'}</button>
          </article>;
        }):roles.map(r=><article key={r.roleCode} className="rounded-lg border border-[#2a333e] bg-[#12161B] p-4"><h2 className="text-sm font-semibold">{r.name}</h2><p className="mt-1 text-xs text-zinc-400">{r.roleCode} · editable instrument track</p><button type="button" disabled={!onAddTrack} onClick={()=>onAddTrack?.(r.roleCode)} className="mt-3 flex min-h-11 items-center gap-2 rounded bg-amber-500/15 px-3 text-xs text-amber-300 disabled:opacity-40"><Plus className="h-4 w-4"/>Add track</button>{onAddGeneratedLayer&&<button type="button" onClick={()=>onAddGeneratedLayer(r.roleCode)} className="mt-2 min-h-11 rounded border border-amber-600/40 px-3 text-xs text-amber-300">Preview layer with phrase</button>}</article>)}
      </div>
    </div>
  </section>;
}
