import React from 'react';
import type {AbletonProjectState} from '../types/ableton';
import {MusicalTimeService} from '../engine/timelineCoordinates';
/** Read-only diff geometry; it never installs the proposed score into the Editor. */
export function ProposalTimeline({before,after}:{before:AbletonProjectState;after:AbletonProjectState}) {
  const ids=[...new Set([...before.tracks,...after.tracks].map(t=>t.id))];
  const end=Math.max(MusicalTimeService.arrangementTotalBeats(before),MusicalTimeService.arrangementTotalBeats(after));
  const x=(beat:number)=>150+beat/end*490;
  return <figure aria-label="Arrangement ghost diff" className="my-3 overflow-auto rounded border border-cyan-900 bg-[#12161B] p-2">
    <figcaption className="mb-2 text-xs text-cyan-200">Arrangement preview · gray current · cyan proposed · red removed</figcaption>
    <svg role="img" aria-label="Current and proposed clip positions, lengths and layer activity" viewBox={`0 0 650 ${24+ids.length*20}`} className="w-full min-w-[480px]">
      {(after.songPlan?.sections||[]).map(section=><g key={section.id}><rect x={x(section.fromBeat)} y={0} width={Math.max(1,x(section.toBeat)-x(section.fromBeat))} height={7} fill="#06B6D4" opacity={section.energy}/><title>{section.name}: {section.fromBeat}–{section.toBeat} beats</title></g>)}
      {ids.map((id,i)=>{const a=before.tracks.find(t=>t.id===id),b=after.tracks.find(t=>t.id===id),y=18+i*20;return <g key={id}>
        <text x={2} y={y+10} fill={b?'#CBD5E1':'#FB7185'} fontSize={9}>{(b?.name||a?.name||id).slice(0,25)}</text>
        {(a?.clips||[]).map(c=><rect key={`before:${c.id}`} x={x(c.startTime)} y={y} width={Math.max(1,c.length/end*490)} height={12} fill={b?'#64748B':'#F43F5E'} opacity={.45}/>)}
        {(b?.clips||[]).map(c=><rect key={`after:${c.id}`} x={x(c.startTime)} y={y+3} width={Math.max(1,c.length/end*490)} height={9} fill="#06B6D4" fillOpacity={.2} stroke="#22D3EE" strokeWidth={.7}><title>{c.name}: {c.startTime}–{c.startTime+c.length} beats; {c.notes.length} notes</title></rect>)}
      </g>;})}
    </svg>
  </figure>;
}
