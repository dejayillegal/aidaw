// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { buildStarterAbletonXml, parseAlsXmlString } from '../engine/alsXmlEngine';
import { StudioCommandBus, queueSessionLaunch, captureSessionPerformance, storeArrangementClipInSession } from '../services/commandBus';
import { sessionEventsInWindow } from '../engine/timelineCoordinates';
import { encodeProjectSnapshot, decodeProjectSnapshot } from '../services/projectSnapshotService';
import { DEFAULT_HUMANIZATION, DEFAULT_MASTER_BUS, DEFAULT_TRANSPORT } from '../engine/projectDefaults';
function fixture() {
  const p=parseAlsXmlString(buildStarterAbletonXml('berghain-134',777,4).xml);
  p.tracks=p.tracks.slice(0,2);
  p.tracks.forEach((t,index)=>{t.clips=[{...t.clips[0],id:`arr-${index}`,startTime:0,length:1,endTime:1,notes:[{...t.clips[0].notes[0],id:`n-${index}`,time:0.25,quantizedTime:0.25,duration:0.125,probability:1}]}];});
  return p;
}
describe('independent canonical Session performance',()=>{
  it('copies a chosen arrangement clip into a slot without modifying its source',()=>{
    const p=fixture();const next=storeArrangementClipInSession(p,p.tracks[0].id,0,p.tracks[0].clips[0].id);
    expect(next.tracks[0].clips).toEqual(p.tracks[0].clips);
    expect(p.tracks[0].sessionClips).toBeUndefined();
    expect(next.tracks[0].sessionClips![0].notes[0].time).toBe(0.25);
  });
  it('queues clip/scene launches at the next quantization boundary, preserving Arrangement and XML',()=>{
    let p=fixture();p=p.tracks.reduce((state,t)=>storeArrangementClipInSession(state,t.id,0,t.clips[0].id),p);
    const before=structuredClone(p.tracks.map(t=>t.clips));const bus=new StudioCommandBus();
    const launched=bus.executeMutation('p','scene','clip_edit',p,d=>queueSessionLaunch(d,null,0,1.2,1));
    expect(launched.session!.events.map(e=>e.atBeat)).toEqual([2,2]);
    expect(launched.tracks.map(t=>t.clips)).toEqual(before);
    expect(sessionEventsInWindow(launched,1.99,2.5).map(e=>[e.trackId,e.note.time])).toEqual(launched.tracks.map(t=>[t.id,2.25]));
    expect(bus.undo('p')!.session).toBeUndefined();expect(bus.redo('p')!.session).toEqual(launched.session);
    const restored=parseAlsXmlString(launched.rawXmlModified);
    expect(restored.session).toEqual(launched.session);expect(restored.tracks[0].sessionClips).toEqual(launched.tracks[0].sessionClips);
  });
  it('stops one track at a boundary without stopping others, and retriggers from clip start',()=>{
    let p=fixture();p=p.tracks.reduce((state,t)=>storeArrangementClipInSession(state,t.id,0,t.clips[0].id),p);
    p=queueSessionLaunch(p,null,0,0,1);
    p=queueSessionLaunch(p,p.tracks[0].id,null,1.1,1);
    expect(sessionEventsInWindow(p,2,3).map(e=>e.trackId)).toEqual([p.tracks[1].id]);
    p=queueSessionLaunch(p,p.tracks[0].id,0,3.1,1);
    expect(sessionEventsInWindow(p,4,4.5).filter(e=>e.trackId===p.tracks[0].id)[0].note.time).toBe(4.25);
  });
  it('captures an explicit range as new editable clips and survives native save/reopen',()=>{
    let p=fixture();p=storeArrangementClipInSession(p,p.tracks[0].id,0,p.tracks[0].clips[0].id);
    p=queueSessionLaunch(p,p.tracks[0].id,0,0,1);
    const bus=new StudioCommandBus(); const captured=bus.executeMutation('p','capture','clip_edit',p,d=>captureSessionPerformance(d,0,4,8));
    expect(p.tracks[0].clips).toHaveLength(1);
    expect(captured.tracks[0].clips.flatMap(c=>c.notes).map(n=>n.time)).toEqual([0.25,8.25,9.25,10.25,11.25]);
    expect(captured.tracks[1].clips).toEqual(p.tracks[1].clips);
    const opened=decodeProjectSnapshot(encodeProjectSnapshot(captured,DEFAULT_HUMANIZATION,DEFAULT_MASTER_BUS,DEFAULT_TRANSPORT));
    expect(opened.version).toBe(3); // Older readers must reject rather than play Arrangement in place of Session.
    expect(opened.project.tracks).toEqual(captured.tracks);expect(opened.project.session).toEqual(captured.session);
    expect(bus.undo('p')!.tracks).toEqual(p.tracks);
  });
  it('rejects invalid/locked targets atomically, respects empty scene slots and bounded capture',()=>{
    const p=fixture(); const bus=new StudioCommandBus();
    expect(()=>bus.executeMutation('p','empty','clip_edit',p,d=>queueSessionLaunch(d,p.tracks[0].id,0,0,1))).toThrow(/SESSION/);
    expect(()=>captureSessionPerformance(p,2,1,0)).toThrow(/SESSION/);
    let stored=storeArrangementClipInSession(p,p.tracks[0].id,0,p.tracks[0].clips[0].id);stored.tracks[0].locked=true;
    expect(()=>queueSessionLaunch(stored,stored.tracks[0].id,0,0,1)).toThrow(/locked/);
    expect(queueSessionLaunch(stored,stored.tracks[0].id,null,0,1).session!.events[0].clipId).toBeNull();
    expect(bus.canUndo('p')).toBe(false);
  });
  it('rejects corrupt Session events and unknown playback modes before file installation',()=>{
    let p=fixture();p=storeArrangementClipInSession(p,p.tracks[0].id,0,p.tracks[0].clips[0].id);p=queueSessionLaunch(p,p.tracks[0].id,0,0,1);
    const encoded=JSON.parse(encodeProjectSnapshot(p,DEFAULT_HUMANIZATION,DEFAULT_MASTER_BUS,DEFAULT_TRANSPORT));
    const badEvent=structuredClone(encoded);badEvent.project.session.events[0].clipId='missing';
    expect(()=>decodeProjectSnapshot(JSON.stringify(badEvent))).toThrow(/Session/);
    const badMode=structuredClone(encoded);badMode.project.audioSettings.transport.arrangementMode='other';
    expect(()=>decodeProjectSnapshot(JSON.stringify(badMode))).toThrow();
  });
});
