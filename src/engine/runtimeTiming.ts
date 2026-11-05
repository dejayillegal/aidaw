import type {AbletonProjectState} from '../types/ableton';
import {beatToSecondsWithTempoMap, secondsToBeatWithTempoMap, validateAndNormalizeMeterMap, validateAndNormalizeTempoMap} from './timelineCoordinates';
export type TimingProject = Pick<AbletonProjectState,'tempo'|'tempoMap'|'meterMap'>;
export interface ClockLoop {enabled:boolean;start:number;end:number;span:number}
export const projectSeconds=(p:TimingProject,beat:number)=>beatToSecondsWithTempoMap(Math.max(0,beat),p.tempo,p.tempoMap);
export const projectBeat=(p:TimingProject,seconds:number)=>secondsToBeatWithTempoMap(Math.max(0,seconds),p.tempo,p.tempoMap);
/** Loop debt is measured in seconds, not in beats at the tempo after the loop. */
export function runtimeClockPosition(p:TimingProject,anchorBeat:number,elapsedSeconds:number,loop?:ClockLoop) {
 if(elapsedSeconds===0 && !(loop?.enabled && anchorBeat>=loop.end))return{beat:anchorBeat,completedLoops:0};
 const absolute=projectSeconds(p,anchorBeat)+elapsedSeconds;
 if(loop?.enabled){
  const start=projectSeconds(p,loop.start),end=projectSeconds(p,loop.end),duration=end-start;
  if(!(duration>0))throw new Error('RUNTIME_TIMING: non-positive loop duration');
  if(absolute>=end){const debt=absolute-end;return{beat:projectBeat(p,start+debt%duration),completedLoops:Math.floor(debt/duration)+1};}
 }
 return{beat:projectBeat(p,absolute),completedLoops:0};
}
export function runtimeAudioTime(p:TimingProject,anchorBeat:number,anchorSeconds:number,beat:number,loop?:ClockLoop,nextCycle=false){
 return anchorSeconds+projectSeconds(p,beat)-projectSeconds(p,anchorBeat)+(nextCycle&&loop?.enabled?projectSeconds(p,loop.end)-projectSeconds(p,loop.start):0);
}
/** Virtual beat extent consumed by the existing indexed score query at a wrap. */
export function runtimeWindowEnd(p:TimingProject,beat:number,seconds:number,loop:ClockLoop){
 const result=runtimeClockPosition(p,beat,seconds,loop);
 return result.completedLoops?loop.end+(result.completedLoops-1)*loop.span+result.beat-loop.start:result.beat;
}
export function metronomeEvents(p:TimingProject,from:number,to:number):{beat:number;downbeat:boolean}[]{
 const meters=validateAndNormalizeMeterMap(p.meterMap),events:{beat:number;downbeat:boolean}[]=[];
 for(let i=0;i<meters.length;i++){
  const m=meters[i],end=Math.min(to,meters[i+1]?.beat??Infinity),step=4/m.denominator;
  const first=Math.max(0,Math.ceil((Math.max(from,m.beat)-m.beat)/step-1e-9));
  for(let n=first;m.beat+n*step<=end+1e-9;n++){
   const beat=m.beat+n*step;if(beat>= (meters[i+1]?.beat??Infinity)||beat>to+1e-9)break;
   events.push({beat,downbeat:n%m.numerator===0});
  }
 }
 return events;
}
export function tempoAtBeat(p:TimingProject,beat:number){
 const points=validateAndNormalizeTempoMap(p.tempo,p.tempoMap);
 let i=0;while(i+1<points.length&&points[i+1].beat<=beat)i++;
 const a=points[i],b=points[i+1];
 return b&&a.curve==='linear'?a.bpm+(b.bpm-a.bpm)*(beat-a.beat)/(b.beat-a.beat):a.bpm;
}
/** Beat-linear BPM ramps become exponential delay-time ramps in elapsed seconds. */
export function scheduleTempoSyncedReturns(bus:{delayNodeL:{delayTime:AudioParam};delayNodeR:{delayTime:AudioParam}},p:TimingProject,fromBeat:number,atSeconds:number){
 const points=validateAndNormalizeTempoMap(p.tempo,p.tempoMap),knots=new Set([fromBeat]);
 for(let i=0;i<points.length;i++){
  const a=points[i],b=points[i+1];if(a.beat>fromBeat)knots.add(a.beat);
  if(b&&a.curve==='linear'&&b.bpm!==a.bpm)for(const bpm of [90,562.5]){
   const beat=a.beat+(bpm-a.bpm)*(b.beat-a.beat)/(b.bpm-a.bpm);
   if(beat>fromBeat&&beat>a.beat&&beat<b.beat)knots.add(beat);
  }
 }
 const delay=(beat:number)=>Math.max(.08,Math.min(.9,45/Math.max(90,tempoAtBeat(p,beat))));
 const beats=[...knots].sort((a,b)=>a-b);
 for(const [param,multiplier] of [[bus.delayNodeL.delayTime,1],[bus.delayNodeR.delayTime,2]] as const){
  param.cancelScheduledValues(atSeconds);param.setValueAtTime(delay(fromBeat)*multiplier,atSeconds);
  for(let i=1;i<beats.length;i++){
   const before=beats[i-1],beat=beats[i],sec=atSeconds+projectSeconds(p,beat)-projectSeconds(p,fromBeat);
   const segment=[...points].reverse().find(pt=>pt.beat<=before)!,value=delay(beat)*multiplier;
   if(segment.curve==='linear'&&Math.abs(delay(before)-delay(beat))>1e-12)param.exponentialRampToValueAtTime(value,sec);
   else param.setValueAtTime(value,sec);
  }
 }
}
/** Integrate a sustaining note over loop boundaries using the repeated tempo path. */
export function runtimeNoteDuration(p:TimingProject,start:number,duration:number,loop?:ClockLoop){
 if(!loop?.enabled || start<loop.start || start>=loop.end || start+duration<=loop.end)return projectSeconds(p,start+duration)-projectSeconds(p,start);
 const remaining=duration-(loop.end-start),cycles=Math.floor(remaining/loop.span),tail=remaining%loop.span;
 return projectSeconds(p,loop.end)-projectSeconds(p,start)+cycles*(projectSeconds(p,loop.end)-projectSeconds(p,loop.start))+projectSeconds(p,loop.start+tail)-projectSeconds(p,loop.start);
}
