import React, { useState } from 'react';
import type { AbletonProjectState } from '../types/ableton';
import { MusicalTimeService } from '../engine/timelineCoordinates';

export interface SessionMatrixProps {
  project: AbletonProjectState;
  beat: number;
  isPlaying: boolean;
  onLaunch: (slot: number, trackId?: string) => void;
  onStop: (trackId?: string) => void;
  onStore: (trackId: string, slot: number, clipId: string) => void;
  onReturn: () => void;
  onClear: () => void;
  onQuantization: (beats: number) => void;
  onCapture: (from: number, to: number, destination: number) => void;
}

export function SessionMatrix({project,beat,isPlaying,onLaunch,onStop,onStore,onReturn,onClear,onQuantization,onCapture}:SessionMatrixProps) {
  const [from,setFrom]=useState(0),[to,setTo]=useState(16),[destination,setDestination]=useState(()=>MusicalTimeService.arrangementTotalBeats(project));
  const session=project.audioSettings?.transport.arrangementMode==='session';
  const control='min-h-11 px-3 py-2 rounded border border-slate-700 bg-slate-900 text-slate-100 disabled:opacity-40';
  return <section aria-label="Session clip matrix" className="min-w-0 w-full space-y-4 text-sm text-slate-200">
    <div className="flex flex-wrap gap-2 items-center">
      <h2 className="font-bold">Session clips</h2>
      <span role="status">{session?'Session owns playback':'Arrangement owns playback'} · {isPlaying?'Playing':'Stopped'} · Beat {beat.toFixed(2)}</span>
      <label>Launch grid <select aria-label="Session launch quantization" className={control} value={project.session?.quantizationBeats || 4} onChange={e=>onQuantization(Number(e.target.value))}>
        {[0.25,1,4,8].map(value=><option key={value} value={value}>{value} beats</option>)}
      </select></label>
      <button className={control} onClick={()=>onStop()}>Stop all Session clips</button>
      <button className={control} onClick={onReturn}>Return to Arrangement</button>
      <button className={control} onClick={onClear}>Clear performance</button>
    </div>
    <p className="text-xs text-slate-400">Copy an Arrangement clip into an empty slot, then launch a clip or scene. Launch starts transport; queued changes use the launch grid. Empty scene slots stop that track. Arrangement clips remain unchanged. Clip length defines the Session loop.</p>
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      {[0,1,2,3].map(slot=><button key={slot} className={control} onClick={()=>onLaunch(slot)}>Launch Scene {String.fromCharCode(65+slot)}</button>)}
    </div>
    {project.tracks.filter(track=>track.type==='midi').map(track=>{
      const decisions=(project.session?.events || []).filter(e=>e.trackId===track.id);
      const current=[...decisions].filter(e=>e.atBeat<=beat).sort((a,b)=>a.atBeat-b.atBeat).at(-1);
      const pending=[...decisions].filter(e=>e.atBeat>beat).sort((a,b)=>a.atBeat-b.atBeat).at(0);
      return <div key={track.id} className="min-w-0 p-3 border border-slate-700 rounded space-y-2">
        <div className="flex flex-wrap justify-between items-center gap-2">
          <h3 className="break-all font-semibold" style={{color:track.hexColor}}>{track.name}{track.locked?' · Locked':''}</h3>
          <span className="text-xs">{pending?`Queued at beat ${pending.atBeat.toFixed(2)}`:current?.clipId&&session?'Clip active':'Stopped'}</span>
          <button className={control} onClick={()=>onStop(track.id)} aria-label={`Stop Session track ${track.name}`}>Stop track</button>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {[0,1,2,3].map(slot=>{
            const clip=track.sessionClips?.[slot],letter=String.fromCharCode(65+slot),filled=Boolean(clip?.notes.length);
            return <button key={slot} className={`${control} min-w-0 break-words ${session&&current?.clipId===clip?.id?'border-emerald-400':''}`}
              disabled={track.locked || (!filled&&!track.clips.length)}
              aria-label={filled?`Launch ${track.name} slot ${letter}`:`Copy ${track.name} first clip to slot ${letter}`}
              onClick={()=>filled?onLaunch(slot,track.id):onStore(track.id,slot,track.clips[0].id)}>
              {filled?`Launch ${letter} · ${clip!.name}`:`Copy first clip → ${letter}`}
            </button>;
          })}
        </div>
      </div>;
    })}
    <fieldset className="p-3 border border-slate-700 rounded flex flex-wrap gap-3 items-end">
      <legend>Capture performance into new Arrangement clips</legend>
      {([{label:'Capture from beat',value:from,set:setFrom},{label:'Capture to beat',value:to,set:setTo},{label:'Capture destination beat',value:destination,set:setDestination}]).map(field=><label key={field.label} className="text-xs flex flex-col gap-1">{field.label}<input className={`${control} w-32`} aria-label={field.label} type="number" min={0} step="any" value={field.value} onChange={e=>field.set(Number(e.target.value))}/></label>)}
      <button className={control} disabled={!project.session?.events.length} onClick={()=>onCapture(from,to,destination)}>Append Session capture</button>
      <p className="w-full text-xs text-slate-400">Appends editable clips without replacing existing clips. Overlapping destinations mix with existing material. Captured probability records the realized event decisions. Undo reverses one capture.</p>
    </fieldset>
  </section>;
}
