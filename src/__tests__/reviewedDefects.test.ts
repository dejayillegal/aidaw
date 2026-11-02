// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveBeatForEditMode, applyNoteEditWithMode, deleteNoteWithEditMode, StudioCommandBus } from '../services/commandBus';
import { buildStarterAbletonXml, parseAlsXmlString } from '../engine/alsXmlEngine';
import { DEFAULT_HUMANIZATION, DEFAULT_MASTER_BUS, DEFAULT_TRANSPORT } from '../engine/projectDefaults';
import { ParametricWebAudioEngine, synthesizeProjectToStereoFloatBuffers } from '../engine/webAudioSynth';
import { evaluateProjectRenderCapabilities } from '../engine/masteringEngine';
const fixture = () => parseAlsXmlString(buildStarterAbletonXml('berghain-134',777,4).xml);
afterEach(()=>vi.unstubAllGlobals());
describe('attached review: coordinate precision',()=>{
  it('uses a one-bar Arrangement extent rather than an accidental four-bar live minimum',()=>{
    const p=fixture();p.arrangementLengthBars=1;
    const engine=new ParametricWebAudioEngine();engine.setState(p,DEFAULT_HUMANIZATION,{...DEFAULT_TRANSPORT,loopEnabled:false});
    Object.assign(engine,{ctx:{currentTime:1000},isPlaying:true,anchorBeat:0,anchorAudioTime:0});
    expect(engine.getCurrentBeat()).toBe(4);
  });
  it.each(['grid','shuffle'] as const)('preserves rational/tuplet and fine %s grids',mode=>{
    expect(resolveBeatForEditMode(1/3,mode,1/3)).toBe(1/3);
    expect(resolveBeatForEditMode(1/128,mode,1/128)).toBe(1/128);
  });
  it('retains a tuplet note move, resize, grid base and shifted neighbors through XML and undo',()=>{
    const p=fixture(), t=p.tracks[0], first=t.clips[0].notes[0];
    const bus=new StudioCommandBus();
    const next=bus.executeMutation('p','tuplet','clip_edit',p,d=>applyNoteEditWithMode(d,t.id,0,first.id,1/3,'grid',1/3,2/3));
    const n=next.tracks[0].clips[0].notes.find(n=>n.id===first.id)!;
    expect([n.time,n.quantizedTime,n.duration]).toEqual([1/3,1/3,2/3]);
    const reload=parseAlsXmlString(next.rawXmlModified).tracks[0].clips[0].notes.find(n=>n.id===first.id)!;
    expect([reload.time,reload.quantizedTime,reload.duration]).toEqual([1/3,1/3,2/3]);
    expect(bus.undo('p')!.tracks).toEqual(p.tracks);
  });
  it('retains fine free timing during slip resize and shuffle deletion',()=>{
    const p=fixture(),t=p.tracks[0];
    t.clips[0].notes=t.clips[0].notes.slice(0,2).map((n,i)=>({...n,time:i/3,quantizedTime:i/3,duration:1/3}));
    const resized=applyNoteEditWithMode(p,t.id,0,t.clips[0].notes[0].id,1/128,'slip',1/128,1/128);
    expect(resized.tracks[0].clips[0].notes[0].duration).toBe(1/128);
    const deleted=deleteNoteWithEditMode(p,t.id,0,t.clips[0].notes[0].id,'shuffle');
    expect(deleted.tracks[0].clips[0].notes[0].time).toBe(0);
  });
  it.each([0,-1,NaN,Infinity])('rejects invalid grid %s',grid=>expect(()=>resolveBeatForEditMode(1,'grid',grid)).toThrow());
});
describe('attached review: insert resource boundary',()=>{
  const overLimit=()=>{
    const p=fixture(); const template=p.tracks[0].devices[0];
    p.tracks[0].devices=Array.from({length:11},(_,i)=>({...template,id:`fx-${i}`,xmlTag:'Utility',parameters:[]}));return p;
  };
  it('rejects over-limit playback before allocating an audio context',()=>{
    const engine=new ParametricWebAudioEngine();
    engine.setState(overLimit(),DEFAULT_HUMANIZATION);
    const create=vi.fn();vi.stubGlobal('AudioContext',create);
    expect(()=>engine.start()).toThrow(/INSERT_LIMIT/);
    expect(engine.getIsPlaying()).toBe(false);expect(create).not.toHaveBeenCalled();
  });
  it('rejects over-limit offline rendering before allocation, instead of ignoring insert 11',async()=>{
    const create=vi.fn();vi.stubGlobal('OfflineAudioContext',create);
    await expect(synthesizeProjectToStereoFloatBuffers(overLimit(),DEFAULT_HUMANIZATION,DEFAULT_MASTER_BUS)).rejects.toThrow(/INSERT_LIMIT/);
    expect(create).not.toHaveBeenCalled();
  });
  it('reports an over-limit imported chain as unavailable in queue/measurement capability analysis',()=>{
    const caps=evaluateProjectRenderCapabilities(overLimit());
    expect(caps.canRenderAudio).toBe(false);expect(caps.unavailableReason).toContain('INSERT_LIMIT');
  });
  it('blocks pad/note audition and mixer preview through the same visible error callback',()=>{
    const engine=new ParametricWebAudioEngine(),blocked=vi.fn(),create=vi.fn();
    engine.setState(overLimit(),DEFAULT_HUMANIZATION,undefined,undefined,undefined,blocked);blocked.mockClear();
    vi.stubGlobal('AudioContext',create);
    engine.triggerLivePad('kick');
    expect(engine.updateTrackMixerLive(overLimit().tracks[0].id)).toBeNull();
    expect(blocked).toHaveBeenCalledWith(expect.stringContaining('INSERT_LIMIT'));
    expect(create).not.toHaveBeenCalled();
  });
});
