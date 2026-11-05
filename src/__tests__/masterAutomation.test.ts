import { describe, expect, it } from 'vitest';
import { scheduleMasterAutomation } from '../engine/masterAutomation';

function recorder() {
  const events: {kind:string;value:number;time:number}[]=[];
  return {events,param:{
    cancelScheduledValues(time:number){events.push({kind:'cancel',value:0,time});},
    setValueAtTime(value:number,time:number){events.push({kind:'set',value,time});},
    linearRampToValueAtTime(value:number,time:number){events.push({kind:'ramp',value,time});},
  }};
}
const project={tempo:60,tempoMap:[{beat:0,bpm:60},{beat:4,bpm:120}]};
const master={masterVolumeDb:0,masterAutomationPoints:[{beat:0,value:0},{beat:8,value:1}]};

describe('shared master gain automation',()=>{
  it('maps a beat-linear dB envelope through tempo changes rather than interpolating endpoint gains',()=>{
    const {events,param}=recorder();
    scheduleMasterAutomation(param,project,master,0,8,10);
    const at=events.find(e=>Math.abs(e.time-15)<1e-8)!;
    expect(at.value).toBeCloseTo(10**(((.75-.55)*8)/20),10);
    expect(events.at(-1)!.time).toBeCloseTo(16,10);
  });
  it('uses the same gain at a sought live position and the corresponding export time',()=>{
    const full=recorder(),live=recorder();
    scheduleMasterAutomation(full.param,project,master,0,8,0);
    scheduleMasterAutomation(live.param,project,master,6,6.24,20);
    expect(live.events[0].kind).toBe('cancel');
    expect(live.events[1].value).toBeCloseTo(full.events.find(e=>Math.abs(e.time-5)<1e-8)!.value,10);
    expect(live.events.at(-1)!.time).toBeCloseTo(20.12,10);
  });
  it('cancels stale automation when the envelope is removed',()=>{
    const {events,param}=recorder();
    scheduleMasterAutomation(param,project,{masterVolumeDb:-6},2,3,40);
    expect(events).toEqual([{kind:'cancel',value:0,time:40},{kind:'set',value:10**(-6/20),time:40}]);
  });
  it('holds the final value without allocating samples for a long silent automation tail',()=>{
    const {events,param}=recorder();
    scheduleMasterAutomation(param,project,master,9,100000,0);
    expect(events).toHaveLength(2);
  });
});
