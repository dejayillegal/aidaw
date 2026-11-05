import React,{useEffect,useRef,useState} from 'react';
import type {AbletonProjectState} from '../types/ableton';
import type {ProjectChangeProposal} from '../services/projectChangeReview';
import {ProjectComparison} from './ProjectComparison';
import {ProposalTimeline} from './ProposalTimeline';
export function ProjectChangeReviewDialog({proposal,stale,onApply,onCancel,onAudition}:{proposal:ProjectChangeProposal;stale:boolean;onApply:()=>void;onCancel:()=>void;onAudition:(project?:AbletonProjectState)=>boolean|Promise<boolean>}){
 const ref=useRef<HTMLDialogElement>(null);const[audition,setAudition]=useState<string>();
 useEffect(()=>{const el=ref.current;if(!el)return;el.showModal();return()=>{if(el.open)el.close();};},[]);
 useEffect(()=>{if(stale){onAudition();setAudition(undefined);}},[stale]);
 const button='min-h-11 rounded border border-slate-600 px-3 text-xs disabled:opacity-40';
 return <dialog ref={ref} aria-labelledby="change-review-title" onCancel={e=>{e.preventDefault();onCancel();}} className="m-auto w-[min(48rem,calc(100vw-24px))] max-h-[calc(100dvh-24px)] overflow-y-auto rounded-lg border border-slate-600 bg-[#0B0D10] p-4 text-slate-100 backdrop:bg-black/75">
  <header className="flex items-start justify-between gap-3"><div><h2 id="change-review-title" className="font-semibold">Review changes · {proposal.label}</h2><p className="mt-1 text-xs text-zinc-400">Your project stays unchanged until you apply. Cancel discards the proposal. Auditions restart from the beginning.</p></div><button type="button" aria-label="Close change review" onClick={onCancel} className={button}>×</button></header>
  {stale&&<p role="alert" className="my-3 rounded bg-amber-950 p-3 text-xs text-amber-200">Project changed after preview. Discard this proposal and generate a new one.</p>}
  <ProposalTimeline before={proposal.before} after={proposal.after}/>
  <div className="my-4"><ProjectComparison before={proposal.before} after={proposal.after}/></div>
  <div className="flex flex-wrap items-center gap-2 border-t border-slate-700 pt-3">
   <button type="button" disabled={stale} onClick={async()=>setAudition(await onAudition(proposal.before)?'Current project':undefined)} className={button}>Audition current</button>
   <button type="button" disabled={stale} onClick={async()=>setAudition(await onAudition(proposal.after)?'Proposed project':undefined)} className={button}>Audition proposal</button>
   <button type="button" onClick={()=>{onAudition();setAudition(undefined);}} className={button}>Stop audition</button>
   <span role="status" className="text-xs text-cyan-300">{audition?`Auditioning: ${audition}`:'Audition stopped'}</span>
  </div>
  <footer className="sticky bottom-0 mt-3 flex justify-end gap-2 bg-[#0B0D10] py-2"><button type="button" onClick={onCancel} className={button}>Cancel changes</button><button type="button" disabled={stale} onClick={onApply} className={`${button} bg-amber-500 text-black`}>Apply changes</button></footer>
 </dialog>;
}
