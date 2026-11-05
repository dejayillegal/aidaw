import React,{useMemo,useState} from 'react';
import type {AbletonProjectState} from '../types/ableton';
import {compareProjects} from '../services/projectChangeReview';
function ExactChange({before,after}:{before:unknown;after:unknown}){
 const[open,setOpen]=useState(false);
 return <details onToggle={e=>setOpen(e.currentTarget.open)} className="mt-2"><summary className="min-h-11 cursor-pointer py-3 text-xs text-cyan-300">Exact before / after values</summary>{open&&<div className="grid gap-2 sm:grid-cols-2"><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-[10px]">Before: {JSON.stringify(before??null,null,2)}</pre><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all text-[10px]">After: {JSON.stringify(after??null,null,2)}</pre></div>}</details>;
}
const label=(field:string)=>({fileName:'Project name',tempo:'Tempo',tempoMap:'Tempo automation',meterMap:'Time signatures',rootKey:'Key',scale:'Scale',arrangementLengthBars:'Arrangement length',audioSettings:'Audio settings',songPlan:'Composition plan',name:'Name',locked:'Lock',clips:'Clips',sessionClips:'Session clips',devices:'Device chain',mixer:'Mixer',automationPoints:'Automation',routing:'Routing'}[field]||field);
export function ProjectComparison({before,after}:{before:AbletonProjectState;after:AbletonProjectState}){
 const diff=useMemo(()=>compareProjects(before,after),[before,after]);
 return <div aria-label="Project change comparison" className="space-y-3 text-xs">
  <p className="text-zinc-400">{diff.tracks.length} changed layers · {diff.globalChanges.length} project fields. This compares editable state; audition to judge the sound.</p>
  {diff.globalChanges.length>0&&<section className="rounded border border-slate-700 p-3"><h3 className="font-semibold">Project: {diff.globalChanges.map(label).join(', ')}</h3><ExactChange before={Object.fromEntries(diff.globalChanges.map(k=>[k,before[k as keyof AbletonProjectState]]))} after={Object.fromEntries(diff.globalChanges.map(k=>[k,after[k as keyof AbletonProjectState]]))}/></section>}
  {diff.tracks.map(t=><section key={t.id} className="rounded border border-slate-700 bg-[#12161B] p-3"><h3 className="font-semibold">{t.name} · {t.status}</h3><dl className="mt-2 grid grid-cols-2 gap-2"><dt>Clips</dt><dd>{t.clipsBefore} → {t.clipsAfter}</dd><dt>Notes</dt><dd>{t.notesBefore} → {t.notesAfter}</dd><dt>Changed note records</dt><dd>{t.changedNotes}</dd></dl><p className="mt-2 text-zinc-400">Changed: {t.fields.map(label).join(', ')||'track metadata'}</p><ExactChange before={t.before} after={t.after}/></section>)}
  {!diff.changed&&<p>No editable state changes.</p>}
 </div>;
}
