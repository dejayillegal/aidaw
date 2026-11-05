import type {AbletonProjectState, MidiNoteEvent} from '../types/ableton';
import {readAlsIdentity} from './alsIdentity';

/**
 * Some legacy generators serialized duplicate native NoteIds while the journal's
 * canonical score retained unique identities. Repair the XML projection only
 * after the caller has verified the envelope checksum and canonical score.
 * Every affected note must match uniquely by music; never choose by position.
 */
export function migrateLegacyRecoveryXmlIdentities(project: AbletonProjectState, legacyEnvelope: boolean): {
  project: AbletonProjectState; migrated: boolean;
} {
  if (!legacyEnvelope) return {project,migrated:false};
  const xml=project.rawXmlModified || project.rawXml || '';
  const doc=new DOMParser().parseFromString(xml,'application/xml');
  const fail=():never=>{throw new Error('RECOVERY_XML_IDENTITY: ambiguous or mismatched legacy projection; original preserved');};
  if(doc.querySelector('parsererror')) fail();
  const clips=Array.from(doc.querySelectorAll('Tracks > MidiTrack > DeviceChain > MainSequencer > ClipTimeable > ArrangerAutomation > Events > MidiClip'));
  const affected=clips.filter(clip=>{
    const ids=Array.from(clip.querySelectorAll('MidiNoteEvent')).map(n=>readAlsIdentity(n,'NoteId'));
    return new Set(ids).size!==ids.length;
  });
  if(!affected.length)return {project,migrated:false};

  // External numeric references cannot be disambiguated when native IDs collide.
  if(Array.from(doc.querySelectorAll('[NoteId]')).some(n=>n.tagName!=='MidiNoteEvent'))fail();
  const signature=(note:Pick<MidiNoteEvent,'time'|'duration'|'pitch'|'velocity'|'probability'>)=>
    JSON.stringify([note.time,note.duration,note.pitch,note.velocity,note.probability ?? 1]);
  const projected=new Set<Element>();
  for(const track of project.tracks.filter(t=>t.type==='midi')) {
    const sources=Array.from(doc.querySelectorAll('Tracks > MidiTrack')).filter(el=>readAlsIdentity(el)===track.id);
    if(sources.length!==1)fail();
    const nativeClips=Array.from(sources[0].querySelectorAll('DeviceChain > MainSequencer > ClipTimeable > ArrangerAutomation > Events > MidiClip'));
    for(const clip of track.clips) {
      const byMusic=new Map<string,MidiNoteEvent>();
      for(const note of clip.notes) {
        const key=signature(note);if(byMusic.has(key))fail();byMusic.set(key,note);
      }
      const projection=(el:Element)=>{
        const notes=Array.from(el.querySelectorAll('MidiNoteEvent'));
        const matches=new Map<Element,MidiNoteEvent>();
        const used=new Set<string>();
        for(const note of notes) {
          const keyTrack=note.closest('KeyTrack');
          const pitch=Number(keyTrack?.querySelector('MidiKey')?.getAttribute('Value') ?? note.getAttribute('Pitch'));
          const key=signature({time:Number(note.getAttribute('Time')),duration:Number(note.getAttribute('Duration')),pitch,velocity:Number(note.getAttribute('Velocity')),probability:Number(note.getAttribute('Probability') ?? 1)});
          const match=byMusic.get(key);
          if(!match || used.has(key))return null;
          used.add(key);matches.set(note,match);
        }
        return matches.size===byMusic.size?matches:null;
      };
      const candidates=nativeClips.filter(el=>!projected.has(el) &&
        Number(el.querySelector('CurrentStart')?.getAttribute('Value') ?? el.getAttribute('Time'))===clip.startTime &&
        Number(el.querySelector('CurrentEnd')?.getAttribute('Value'))===clip.startTime+clip.length)
        .map(el=>({el,matches:projection(el)})).filter(x=>x.matches);
      if(candidates.length!==1)fail();
      const {el,matches}=candidates[0];projected.add(el);
      if(el.querySelector('NoteExpression, PerNoteEventStore, Expression'))fail();
      // Keep native clip identity and every opaque subtree; restore logical aliases.
      el.removeAttribute('Data-Parametric-ClipId');el.setAttribute('Data-AIDAW-LogicalId',clip.id);
      const notes=Array.from(matches!.keys());
      if(notes.some(n=>n.children.length>0))fail();
      if(notes.some(n=>!/^\d+$/.test(n.getAttribute('NoteId') || '') || !Number.isSafeInteger(Number(n.getAttribute('NoteId')))))fail();
      const ids=new Set<string>();
      let next=notes.reduce((max,n)=>Math.max(max,Number(n.getAttribute('NoteId')) || 0),0)+1;
      for(const [note,match] of matches!) {
        const id=note.getAttribute('NoteId');
        if(!id || ids.has(id))note.setAttribute('NoteId',String(next++));
        ids.add(note.getAttribute('NoteId')!);
        note.removeAttribute('Data-Parametric-NoteId');note.setAttribute('Data-AIDAW-LogicalId',match.id);
      }
      const generator=el.querySelector('Notes > NoteIdGenerator');
      if(generator)generator.setAttribute('NextId',String(next));
    }
  }
  if(affected.some(el=>!projected.has(el)))fail();
  const migratedXml=new XMLSerializer().serializeToString(doc);
  return {project:{...project,rawXml:migratedXml,rawXmlModified:migratedXml},migrated:true};
}
