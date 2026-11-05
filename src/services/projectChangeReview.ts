import type {AbletonProjectState,AbletonTrack} from '../types/ableton';
import {StudioCommandBus,type ProjectCommandTransaction} from './commandBus';
import {assertProjectState} from '../engine/projectStateContracts';
export type ChangeCategory=ProjectCommandTransaction['category'];
export interface ProjectChangeProposal { sourceQueueId:string; label:string; category:ChangeCategory; baseline:string; before:AbletonProjectState; after:AbletonProjectState; }
const clone=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
export function compareProjects(before:AbletonProjectState,after:AbletonProjectState){
 const globalChanges=['fileName','tempo','tempoMap','meterMap','rootKey','scale','arrangementLengthBars','audioSettings','songPlan'].filter(field=>JSON.stringify(before[field as keyof AbletonProjectState])!==JSON.stringify(after[field as keyof AbletonProjectState]));
 const ids=[...new Set([...before.tracks,...after.tracks].map(t=>t.id))];
 const notes=(t?:AbletonTrack)=>new Map((t?.clips||[]).flatMap(c=>c.notes.map(n=>[`${c.id}\0${n.id}`,JSON.stringify(n)] as const)));
 const tracks=ids.flatMap(id=>{
  const a=before.tracks.find(t=>t.id===id),b=after.tracks.find(t=>t.id===id);
  if(JSON.stringify(a)===JSON.stringify(b))return [];
  const an=notes(a),bn=notes(b),keys=new Set([...an.keys(),...bn.keys()]);
  return [{id,name:b?.name||a!.name,status:!a?'added':!b?'removed':'changed',before:a,after:b,changedNotes:[...keys].filter(k=>an.get(k)!==bn.get(k)).length,notesBefore:an.size,notesAfter:bn.size,clipsBefore:a?.clips.length||0,clipsAfter:b?.clips.length||0,fields:['name','locked','clips','sessionClips','devices','mixer','automationPoints','routing'].filter(k=>JSON.stringify(a?.[k as keyof AbletonTrack])!==JSON.stringify(b?.[k as keyof AbletonTrack]))}];
 });
 return {globalChanges,tracks,changed:globalChanges.length>0||tracks.length>0};
}
export function prepareProjectChange(sourceQueueId:string,project:AbletonProjectState,label:string,category:ChangeCategory,mutator:(draft:AbletonProjectState)=>AbletonProjectState):ProjectChangeProposal {
 const before=clone(project);
 const isolated=new StudioCommandBus();
 const after=isolated.executeMutation(sourceQueueId,label,category,before,mutator);
 assertProjectState(after);
 if(!compareProjects(before,after).changed)throw new Error('REVIEW_NO_CHANGE: this action produces no project changes');
 const freeze=(value:unknown):void=>{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}};
 const proposal={sourceQueueId,label,category,baseline:JSON.stringify(project),before,after};freeze(proposal);return proposal;
}
export function applyReviewedProjectChange(queueId:string,current:AbletonProjectState,proposal:ProjectChangeProposal):AbletonProjectState {
 if(queueId!==proposal.sourceQueueId||JSON.stringify(current)!==proposal.baseline)throw new Error('REVIEW_STALE: project changed after preview; discard and generate a new preview');
 assertProjectState(proposal.after);return clone(proposal.after);
}
