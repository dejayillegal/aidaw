// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {editProjectBaseTempo} from '../engine/projectTempoEditing';
import {createEditableFullTrack} from '../services/projectCreationService';
import {beatToSecondsWithTempoMap} from '../engine/timelineCoordinates';
import {StudioCommandBus} from '../services/commandBus';

const fixture=()=>createEditableFullTrack({title:'TempoEdit',subgenreId:'raw_warehouse',bpm:128,durationBars:32,layerDensity:'compact',seed:777});
describe('canonical base tempo editing',()=>{
  it('changes actual mapped timing and preserves later tempo/meter automation and score',()=>{
    const p=fixture();p.tempoMap=[{beat:0,bpm:128,curve:'linear'},{beat:8,bpm:160,curve:'step'},{beat:16,bpm:100,curve:'step'}];
    const before=structuredClone(p);const result=editProjectBaseTempo(p,143.25);
    expect(result.tempo).toBe(143.25);expect(result.songPlan?.tempo).toBe(143.25);
    expect(result.tempoMap).toEqual([{beat:0,bpm:143.25,curve:'linear'},...before.tempoMap!.slice(1)]);
    expect(beatToSecondsWithTempoMap(4,result.tempo,result.tempoMap)).not.toBe(beatToSecondsWithTempoMap(4,p.tempo,p.tempoMap));
    expect(result.tracks).toBe(p.tracks);expect(result.meterMap).toBe(p.meterMap);expect(p).toEqual(before);
  });
  it('initializes scalar projects and includes range boundaries',()=>{
    const p=fixture();delete p.tempoMap;
    for(const bpm of [40,240])expect(editProjectBaseTempo(p,bpm).tempoMap).toEqual([{beat:0,bpm,curve:'step'}]);
  });
  it('rejects invalid input without changing the project',()=>{
    const p=fixture(),before=structuredClone(p);
    for(const bpm of [NaN,Infinity,-Infinity,39.9,240.1])expect(()=>editProjectBaseTempo(p,bpm)).toThrow('TEMPO_RANGE');
    expect(p).toEqual(before);
  });
  it('undoes and redoes the map and song plan as one canonical transaction',()=>{
    const p=fixture(),bus=new StudioCommandBus();
    const tx=bus.executeMutation('tempo-test','Change Tempo','transport',p,project=>editProjectBaseTempo(project,143.25));
    expect(tx.tempoMap?.[0].bpm).toBe(143.25);
    expect(bus.undo('tempo-test')).toEqual(p);
    expect(bus.redo('tempo-test')?.tempoMap?.[0].bpm).toBe(143.25);
  });
});
