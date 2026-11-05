// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {buildStarterAbletonXml,parseAlsXmlString} from '../engine/alsXmlEngine';
import {createSongPlan} from '../engine/songPlanEngine';
import {chooseTrackDevice,generateTrackLayer,appendEmptyArrangementClip,appendArrangementNote,transformSelectedPhrase} from '../engine/authoringActions';
import {createUserTrackFromRole} from '../engine/compositionIntelligenceEngine';
import {assertProjectState} from '../engine/projectStateContracts';
import {resolveTrackInstrumentSynthesis} from '../engine/webAudioSynth';
import {StudioCommandBus} from '../services/commandBus';
const fixture=()=>{const p=parseAlsXmlString(buildStarterAbletonXml('berghain-134',77,1,'sketch').xml);p.arrangementLengthBars=32;p.tracks=p.tracks.filter(t=>t.archetype!=='acid');p.songPlan=createSongPlan(p,77,'raw_warehouse');p.songPlan.roles=p.songPlan.roles.filter(r=>r.role!=='acid');return p;};
describe('real layer and instrument authoring',()=>{
 it('replaces the instrument, retaining notes, effects, other tracks and undo/reopen identity',()=>{
  const p=fixture(),track=p.tracks[0],before=structuredClone(p);const bus=new StudioCommandBus();
  const next=bus.executeMutation('author','Choose instrument','mixer',p,d=>chooseTrackDevice(d,track.id,'inst_operator'));
  expect(next.tracks[0].devices.filter(d=>d.category==='instrument'&&!d.bypassed)).toHaveLength(1);
  expect(resolveTrackInstrumentSynthesis(next.tracks[0]).instrumentTag).toBe('Operator');
  expect(next.tracks[0].clips).toEqual(track.clips);
  expect(next.tracks[0].devices.filter(d=>d.category!=='instrument')).toEqual(track.devices.filter(d=>d.category!=='instrument'));
  expect(next.tracks.slice(1)).toEqual(p.tracks.slice(1));expect(p).toEqual(before);assertProjectState(next);
  expect(bus.undo('author')?.tracks).toEqual(p.tracks);
 });
 it('rejects unknown devices and locked tracks rather than silently selecting a fallback',()=>{
  const p=fixture();expect(()=>chooseTrackDevice(p,p.tracks[0].id,'nonsense')).toThrow();
  p.tracks[0].locked=true;expect(()=>chooseTrackDevice(p,p.tracks[0].id,'inst_operator')).toThrow('LOCKED');
 });
 it('generates a newly added role missing from the existing song plan without replacing other layers',()=>{
  const p=fixture(),track=createUserTrackFromRole('B4',p.tracks.length);expect(track.archetype).toBe('acid');
  p.tracks.push(track);const before=structuredClone(p);const next=generateTrackLayer(p,track.id,'raw_warehouse',77);
  expect(next.tracks.at(-1)!.clips.flatMap(c=>c.notes).length).toBeGreaterThan(0);
  expect(next.tracks.slice(0,-1)).toEqual(p.tracks.slice(0,-1));expect(p).toEqual(before);assertProjectState(next);
 });
 it('protects locked and manually edited content while generating only the selected layer',()=>{
  const p=fixture(),t=p.tracks[0];t.locked=true;expect(()=>generateTrackLayer(p,t.id,'raw_warehouse',77)).toThrow('LOCKED');
  t.locked=false;t.clips[0].userEdited=true;const protectedClip=structuredClone(t.clips[0]);
  const next=generateTrackLayer(p,t.id,'raw_warehouse',78);expect(next.tracks[0].clips).toContainEqual(protectedClip);
 });
 it('creates an editable empty clip and adds a real note without toggling or overwriting existing material',()=>{
  const p=fixture(),id=p.tracks[0].id,before=structuredClone(p);
  const clipped=appendEmptyArrangementClip(p,id,2,4),clip=clipped.tracks[0].clips.at(-1)!;
  const next=appendArrangementNote(clipped,id,clip.id);
  expect(clip.notes).toHaveLength(0);expect(next.tracks[0].clips.at(-1)!.notes).toHaveLength(1);
  expect(next.tracks[0].clips.at(-1)!.notes[0].time).toBe(2);
  expect(next.tracks[0].clips.at(-1)!.userEdited).toBe(true);
  expect(appendArrangementNote(next,id,clip.id).tracks[0].clips.at(-1)!.notes).toHaveLength(2);
  expect(p).toEqual(before);assertProjectState(next);
 });

 it('transforms the selected later phrase in local time without changing the first clip or project key',()=>{
  const p=fixture(),t=p.tracks[0],first=structuredClone(t.clips[0]);
  const later={...structuredClone(first),id:'later',startTime:8,length:4,endTime:12,notes:first.notes.slice(0,2).map(n=>({...n,time:n.time+8,quantizedTime:n.quantizedTime+8}))};t.clips.push(later);
  const next=transformSelectedPhrase(p,t.id,'later',notes=>notes.map(n=>({...n,pitch:65,time:n.time+.25,quantizedTime:n.quantizedTime+.25})));
  expect(next.tracks[0].clips[0]).toEqual(first);expect(next.tracks[0].clips[1].notes[0].time).toBe(later.notes[0].time+.25);expect(next.tracks[0].clips[1].notes[0].pitch).toBe(65);
  expect(next.rootKey).toBe(p.rootKey);expect(next.tracks.slice(1)).toEqual(p.tracks.slice(1));expect(next.tracks[0].clips[1].userEdited).toBe(true);
 });

});
