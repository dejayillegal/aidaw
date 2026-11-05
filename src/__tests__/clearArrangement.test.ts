// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { clearArrangementContent } from '../engine/clearArrangement';
import { StudioCommandBus } from '../services/commandBus';
import { buildStarterAbletonXml, parseAlsXmlString } from '../engine/alsXmlEngine';
import { encodeProjectSnapshot, decodeProjectSnapshot } from '../services/projectSnapshotService';
import { projectAudioSettings } from '../engine/projectDefaults';
const options = { scope: 'unlocked_tracks' as const, wipeNotes: true, wipeAutomation: true, wipeSessionClips: false, resetMixerToNeutral: false };
it('clears through history without XML reconstruction, preserves locked tracks and persists the edit', () => {
 const xml=buildStarterAbletonXml('berghain-134',777,4).xml.replace('<LiveSet>','<LiveSet xmlns:v="urn:test"><v:State xml:space="preserve">  keep\n  state  </v:State>');
 const p=parseAlsXmlString(xml);p.tracks[1].locked=true;
 const bus=new StudioCommandBus(), q=bus.executeMutation('clear','Clear','clip_edit',p,d=>clearArrangementContent(d,p.tracks[0].id,options));
 expect(q.tracks[0].clips.every(c=>!c.notes.length)).toBe(true);expect(q.tracks[1]).toEqual(p.tracks[1]);expect(q.tracks[0].devices).toEqual(p.tracks[0].devices);
 expect(q.rawXmlModified).toContain('  keep\n  state  ');expect(q.rawXmlModified).toContain('urn:test');
 expect(bus.undo('clear')!.tracks).toEqual(p.tracks);expect(bus.redo('clear')!.tracks).toEqual(q.tracks);
 const s=projectAudioSettings(q);expect(decodeProjectSnapshot(encodeProjectSnapshot(q,s.humanization,s.masterBus,s.transport)).project.tracks).toEqual(q.tracks);
});
it('rejects locked selection, empty actions and referenced Session deletion atomically', () => {
 const p=parseAlsXmlString(buildStarterAbletonXml('berghain-134',777,4).xml);p.tracks[0].locked=true; const before=JSON.stringify(p);const bus=new StudioCommandBus();
 expect(()=>bus.executeMutation('p','Clear','clip_edit',p,d=>clearArrangementContent(d,p.tracks[0].id,{...options,scope:'selected_track'}))).toThrow(/CLEAR_TARGET/);
 expect(bus.canUndo('p')).toBe(false);expect(JSON.stringify(p)).toBe(before);
 expect(()=>clearArrangementContent(p,'1',{...options,wipeNotes:false,wipeAutomation:false})).toThrow(/CLEAR_EMPTY/);
 const session={...p,session:{events:[{}]} } as any;
 expect(()=>clearArrangementContent(session,'1',{...options,wipeSessionClips:true})).toThrow(/CLEAR_SESSION/);
});
