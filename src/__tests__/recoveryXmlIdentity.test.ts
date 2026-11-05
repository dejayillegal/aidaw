// @vitest-environment jsdom
import {describe,it,expect} from 'vitest';
import {buildStarterAbletonXml,parseAlsXmlString,synchronizeProjectStateToXml} from '../engine/alsXmlEngine';
import {migrateLegacyRecoveryXmlIdentities} from '../engine/recoveryXmlIdentityMigration';

function fixture() {
  const p=parseAlsXmlString(buildStarterAbletonXml('berghain-134',19,4).xml);
  p.tracks=p.tracks.slice(0,1);
  const clip=p.tracks[0].clips[0];clip.notes=clip.notes.slice(0,3);
  p.rawXmlModified=synchronizeProjectStateToXml(p);
  const doc=new DOMParser().parseFromString(p.rawXmlModified,'application/xml');
  const el=doc.querySelector('MidiClip')!;el.setAttribute('Id','888');
  el.removeAttribute('Data-AIDAW-LogicalId');el.removeAttribute('Data-Parametric-ClipId');
  for(const note of el.querySelectorAll('MidiNoteEvent')) {
    note.setAttribute('NoteId','9000');note.removeAttribute('Data-AIDAW-LogicalId');note.removeAttribute('Data-Parametric-NoteId');
  }
  const opaque=doc.createElement('FutureClipState');opaque.textContent='preserve';el.appendChild(opaque);
  p.rawXmlModified=new XMLSerializer().serializeToString(doc);
  return p;
}
describe('provenance-scoped recovery of a stale legacy XML identity projection',()=>{
  it('repairs only XML identities when every canonical note matches uniquely, preserving score and opaque state',()=>{
    const p=fixture(),before=structuredClone(p.tracks);
    expect(()=>parseAlsXmlString(p.rawXmlModified!)).toThrow(/identity/);
    const result=migrateLegacyRecoveryXmlIdentities(p,true);
    expect(result.migrated).toBe(true);expect(result.project.tracks).toEqual(before);
    const xml=synchronizeProjectStateToXml(result.project),opened=parseAlsXmlString(xml);
    expect(opened.tracks[0].clips[0].notes.map(n=>n.id)).toEqual(before[0].clips[0].notes.map(n=>n.id));
    expect(xml).toContain('<FutureClipState>preserve</FutureClipState>');
    expect(migrateLegacyRecoveryXmlIdentities(result.project,true).migrated).toBe(false);
    expect(p.rawXmlModified).not.toBe(result.project.rawXmlModified);
  });
  it('rejects ambiguous music, mismatched edits, per-note references and current envelopes',()=>{
    expect(migrateLegacyRecoveryXmlIdentities(fixture(),false).migrated).toBe(false);
    const mismatch=fixture();mismatch.tracks[0].clips[0].notes[0].pitch++;
    expect(()=>migrateLegacyRecoveryXmlIdentities(mismatch,true)).toThrow(/RECOVERY_XML_IDENTITY/);
    const microEdit=fixture();microEdit.tracks[0].clips[0].notes[0].time+=.00001;
    expect(()=>migrateLegacyRecoveryXmlIdentities(microEdit,true)).toThrow(/RECOVERY_XML_IDENTITY/);
    const probability=fixture();probability.tracks[0].clips[0].notes[0].probability=.5;
    expect(()=>migrateLegacyRecoveryXmlIdentities(probability,true)).toThrow(/RECOVERY_XML_IDENTITY/);
    const ambiguous=fixture();ambiguous.tracks[0].clips[0].notes[1]={...ambiguous.tracks[0].clips[0].notes[0],id:'different'};
    expect(()=>migrateLegacyRecoveryXmlIdentities(ambiguous,true)).toThrow(/RECOVERY_XML_IDENTITY/);
    const expressions=fixture();expressions.rawXmlModified=expressions.rawXmlModified!.replace('</MidiClip>','<Expression NoteId="9000"/></MidiClip>');
    expect(()=>migrateLegacyRecoveryXmlIdentities(expressions,true)).toThrow(/RECOVERY_XML_IDENTITY/);
  });
});
