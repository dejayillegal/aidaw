import type {AbletonProjectState,CompositionStrategyId} from '../types/ableton';
import {ABLETON_BUILTIN_LIBRARY} from './alsXmlEngine';
import {insertDeviceIntoChannelStrip} from './channelStripEngine';
import {ABLETON_DEVICE_REGISTRY} from './abletonCapabilityMatrix';
import {createSongPlan,composeSongPlan} from './songPlanEngine';
import {nextArrangementIdentity} from './compositionIntelligenceEngine';
import {MusicalTimeService} from './timelineCoordinates';

export function chooseTrackDevice(project:AbletonProjectState,trackId:string,templateId:string):AbletonProjectState {
 const track=project.tracks.find(t=>t.id===trackId);if(!track)throw new Error('TRACK_MISSING');
 if(track.locked)throw new Error('TRACK_LOCKED: unlock the track before changing its devices');
 const template=ABLETON_BUILTIN_LIBRARY.find(t=>t.id===templateId);if(!template)throw new Error('DEVICE_UNKNOWN');
 if(template.category==='instrument'&&track.type!=='midi')throw new Error('INSTRUMENT_TARGET: choose a MIDI track');
 // Replacement is explicit in the review UI; effect and MIDI processor order is retained.
 const devices=template.category==='instrument'?track.devices.filter(d=>d.category!=='instrument'&&d.pluginRole!=='instrument'&&ABLETON_DEVICE_REGISTRY[d.xmlTag]?.kind!=='instrument'):track.devices;
 const base={...project,tracks:project.tracks.map(t=>t.id===trackId?{...t,devices}:t)};
 const result=insertDeviceIntoChannelStrip(base,trackId,templateId);
 if(result.error||!result.insertedDevice)throw new Error(result.error||'DEVICE_INSERT_FAILED');
 return {...project,tracks:project.tracks.map(t=>t.id===trackId?result.updatedTrack:t)};
}
export function ensureAuthoringSongPlan(project:AbletonProjectState,strategy:CompositionStrategyId,seed:number){
 if(!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff)throw new Error('GENERATION_SEED: use an unsigned 32-bit integer');
 if(project.meterMap?.some(m=>m.numerator!==4||m.denominator!==4))throw new Error('GENERATION_METER: phrase generation currently requires 4/4; existing material is unchanged');
 const old=project.songPlan,fresh=createSongPlan(project,seed,strategy,old?.formFamily);
 return old&&old.version===3&&old.style===strategy&&old.seed===seed&&old.durationBars===(project.arrangementLengthBars||16)?{...old,
  roles:[...old.roles,...fresh.roles.filter(r=>!old.roles.some(p=>p.trackId===r.trackId))],
  motifs:[...old.motifs,...fresh.motifs.filter(r=>!old.motifs.some(p=>p.trackId===r.trackId))]}:fresh;
}
export function generateTrackLayer(project:AbletonProjectState,trackId:string,strategy:CompositionStrategyId,seed:number):AbletonProjectState {
 const track=project.tracks.find(t=>t.id===trackId);if(!track||track.type!=='midi')throw new Error('TRACK_MISSING: choose a MIDI layer');
 if(track.locked)throw new Error('TRACK_LOCKED: unlock the layer before generating');
 const plan=ensureAuthoringSongPlan(project,strategy,seed);
 // Scoped composition preserves user-edited spans and every unrelated track.
 const result=composeSongPlan(project,plan,{trackId,fromBeat:0,toBeat:plan.durationBars*4});
 if(!result.tracks.find(t=>t.id===trackId)?.clips.some(c=>c.notes.length))throw new Error('GENERATION_EMPTY: selected style and duration omit this role; choose another style/duration or add an empty layer');
 return result;
}
export function appendEmptyArrangementClip(project:AbletonProjectState,trackId:string,startBeat:number,lengthBeats:number):AbletonProjectState {
 const track=project.tracks.find(t=>t.id===trackId);
 if(!track||track.type!=='midi')throw new Error('CLIP_TARGET: choose a MIDI layer');
 if(track.locked)throw new Error('TRACK_LOCKED');
 if(!Number.isFinite(startBeat)||!Number.isFinite(lengthBeats)||startBeat<0||lengthBeats<=0||startBeat+lengthBeats>65536)throw new Error('CLIP_RANGE');
 const id=nextArrangementIdentity(`clip_${trackId}`,track.clips.map(c=>c.id));
 return {...project,arrangementLengthBars:Math.max(project.arrangementLengthBars||1,MusicalTimeService.barsCoveringBeat(startBeat+lengthBeats,project.meterMap,project.ppq)),tracks:project.tracks.map(t=>t.id===trackId?{...t,clips:[...t.clips,{id,name:'New MIDI clip',startTime:startBeat,length:lengthBeats,endTime:startBeat+lengthBeats,notes:[]}]}:t)};
}

export function appendArrangementNote(project:AbletonProjectState,trackId:string,clipId:string):AbletonProjectState {
 const track=project.tracks.find(t=>t.id===trackId),clip=track?.clips.find(c=>c.id===clipId);
 if(!track||track.type!=='midi'||!clip)throw new Error('NOTE_TARGET: select a MIDI clip');
 if(track.locked)throw new Error('TRACK_LOCKED');
 const occupied=new Set(clip.notes.filter(n=>n.pitch===60).map(n=>Math.round((n.time-clip.startTime)*4)));
 let step=0;while(occupied.has(step))step++;
 const time=clip.startTime+step*.25;
 if(time>=clip.startTime+clip.length)throw new Error('NOTE_RANGE: clip has no free sixteenth-note position at C4');
 const id=nextArrangementIdentity(`${clip.id}_note`,clip.notes.map(n=>n.id));
 return {...project,tracks:project.tracks.map(t=>t.id===trackId?{...t,clips:t.clips.map(c=>c.id===clipId?{...c,userEdited:true,notes:[...c.notes,{id,time,quantizedTime:time,pitch:60,duration:Math.min(.25,c.startTime+c.length-time),velocity:100,probability:1,isGhost:false}]}:c)}:t)};
}

/** MIDI operations use a clip-local time domain; all unrelated content is retained. */
export function transformSelectedPhrase(project:AbletonProjectState,trackId:string,clipId:string,transform:(notes:import('../types/ableton').MidiNoteEvent[],lengthBeats:number)=>import('../types/ableton').MidiNoteEvent[]):AbletonProjectState {
 const track=project.tracks.find(t=>t.id===trackId),clip=track?.clips.find(c=>c.id===clipId);
 if(!track||track.type!=='midi'||!clip)throw new Error('PHRASE_TARGET: choose a MIDI clip');
 if(track.locked)throw new Error('TRACK_LOCKED');
 if(clip.length<1/960)throw new Error('PHRASE_RANGE: extend the clip to at least one tick before transforming');
 const end=clip.startTime+clip.length,hidden=clip.notes.filter(n=>n.time<clip.startTime||n.time>=end);
 const visible=clip.notes.filter(n=>n.time>=clip.startTime&&n.time<end).map(n=>({...structuredClone(n),time:n.time-clip.startTime,quantizedTime:n.quantizedTime-clip.startTime}));
 const originalIds=new Set(visible.map(n=>n.id));
 const changed=transform(visible,clip.length).map((n,i)=>{const time=Math.min(clip.length-1/960,Math.max(0,n.time));return {...n,id:originalIds.has(n.id)?n.id:`${clip.id}_phrase_${i}`,time:clip.startTime+time,quantizedTime:clip.startTime+Math.min(clip.length-1/960,Math.max(0,n.quantizedTime)),duration:Math.max(1/960,Math.min(n.duration,clip.length-time))};});
 const used=hidden.map(n=>n.id);for(const n of changed){n.id=nextArrangementIdentity(n.id,used);used.push(n.id);}
 return {...project,tracks:project.tracks.map(t=>t.id===trackId?{...t,clips:t.clips.map(c=>c.id===clipId?{...c,userEdited:true,notes:[...hidden,...changed].sort((a,b)=>a.time-b.time)}:c)}:t)};
}
