// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {buildStarterAbletonXml,parseAlsXmlString} from '../engine/alsXmlEngine';
import {prepareProjectChange,applyReviewedProjectChange,compareProjects} from '../services/projectChangeReview';
import {StudioCommandBus} from '../services/commandBus';
const fixture=()=>parseAlsXmlString(buildStarterAbletonXml('berghain-134',77,1,'sketch').xml);
describe('reviewed and inspectable project changes',()=>{
 it('prepares a detached preview without changing source or the real command history',()=>{
  const p=fixture(),before=JSON.stringify(p),bus=new StudioCommandBus();
  const proposal=prepareProjectChange('one',p,'Rename','clip_edit',d=>({...d,tracks:d.tracks.map((t,i)=>i? t:{...t,name:'Reviewed name'})}));
  expect(JSON.stringify(p)).toBe(before);expect(bus.canUndo('one')).toBe(false);
  expect(compareProjects(p,proposal.after).tracks[0].fields).toContain('name');
  const next=bus.executeMutation('one','Apply reviewed change','clip_edit',p,d=>applyReviewedProjectChange('one',d,proposal));
  expect(next.tracks[0].name).toBe('Reviewed name');expect(bus.undo('one')?.tracks[0].name).toBe(p.tracks[0].name);
 });
 it('rejects stale or switched-project proposals even if revisions happen to match',()=>{
  const p=fixture(),proposal=prepareProjectChange('one',p,'Rename','clip_edit',d=>({...d,fileName:'Changed'}));
  expect(()=>applyReviewedProjectChange('two',p,proposal)).toThrow('REVIEW_STALE');
  const edited=structuredClone(p);edited.tracks[0].mixer.pan=.2;
  expect(()=>applyReviewedProjectChange('one',edited,proposal)).toThrow('REVIEW_STALE');
 });
 it('rejects invalid/locked changes before displaying an applicable proposal',()=>{
  const p=fixture();p.tracks[0].locked=true;
  expect(()=>prepareProjectChange('one',p,'Unsafe','clip_edit',d=>({...d,tracks:d.tracks.slice(1)}))).toThrow();
  expect(()=>prepareProjectChange('one',p,'Invalid','clip_edit',d=>({...d,tempo:NaN}))).toThrow();
 });
 it('reports note edits with unchanged counts and protects preview ownership',()=>{
  const p=fixture(),proposal=prepareProjectChange('one',p,'Note edit','clip_edit',d=>{d.tracks[0].clips[0].notes[0].velocity=41;return d;});
  const report=compareProjects(proposal.before,proposal.after);expect(report.tracks[0].changedNotes).toBe(1);expect(report.tracks[0].notesBefore).toBe(report.tracks[0].notesAfter);
  expect(()=>{proposal.after.tracks[0].name='Tamper';}).toThrow();
  const first=applyReviewedProjectChange('one',p,proposal);first.tracks[0].name='Changed outside';expect(proposal.after.tracks[0].name).toBe(p.tracks[0].name);
 });
});
