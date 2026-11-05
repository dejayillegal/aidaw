// @vitest-environment jsdom
// All projects in this suite are SYNTHETIC, not the user's recovery envelopes.
import { describe, expect, it } from 'vitest';
import { buildStarterAbletonXml, parseAlsXmlString, parseAbletonXmlDom } from '../engine/alsXmlEngine';
import { StudioCommandBus, substituteUnsupportedDevice } from '../services/commandBus';
import { buildDeviceInsertProcessor, resolveTrackInstrumentSynthesis } from '../engine/webAudioSynth';
import { restoreOriginalPlugin, bypassUnsupportedPlugin } from '../engine/pluginDependencies';
import { encodeProjectSnapshot, decodeProjectSnapshot } from '../services/projectSnapshotService';
import { synchronizeProjectStateToXml } from '../engine/alsXmlEngine';
import { DEFAULT_HUMANIZATION, DEFAULT_MASTER_BUS, DEFAULT_TRANSPORT } from '../engine/projectDefaults';
import { repairProjectNoteIdentities } from '../engine/projectStateContracts';

function fixture() {
  const p = parseAlsXmlString(buildStarterAbletonXml('berghain-134', 123, 4).xml);
  p.tracks[0].devices = [{ id: '31', xmlTag: 'AuPluginDevice', displayName: 'Unknown AU', category: 'instrument',
    isUserCreated: true, bypassed: false, browserDspSupported: false, parameters: [{name:'Private',value:17}],
    opaqueSubtreeXml: '<AuPluginDevice Id="31"><Private Value="17"/></AuPluginDevice>' }];
  const doc = new DOMParser().parseFromString(p.rawXml!, 'application/xml');
  doc.querySelector('MidiTrack Devices')!.innerHTML = p.tracks[0].devices[0].opaqueSubtreeXml!;
  p.rawXml = p.rawXmlModified = new XMLSerializer().serializeToString(doc);
  return p;
}
describe('P0 resume synthetic regression', () => {
  it('serializes imported GroupTrack state without dropping opaque group XML', () => {
    const xml=buildStarterAbletonXml('berghain-134',1,4).xml;
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    const group=doc.createElement('GroupTrack');group.setAttribute('Id','91000');
    group.innerHTML='<Name><EffectiveName Value="Synthetic group"/></Name><OpaqueGroupData Value="preserve"/><DeviceChain><Devices/></DeviceChain>';
    doc.querySelector('LiveSet > Tracks')!.prepend(group);
    const p=parseAbletonXmlDom(new XMLSerializer().serializeToString(doc),'synthetic-group.als');
    expect(p.tracks.some(t=>t.isGroupTrack)).toBe(true);
    const out=synchronizeProjectStateToXml(p);
    expect(out).toContain('OpaqueGroupData');
    expect(parseAbletonXmlDom(out,'synthetic-group.als').tracks.filter(t=>t.isGroupTrack)).toHaveLength(1);
  });
  it('requires evidence or explicit user role for ambiguous AU containers', () => {
    const p = fixture();
    expect(() => substituteUnsupportedDevice(p,p.tracks[0].id,'31','Operator')).toThrow(/ROLE/);
  });
  it('dispatches registered factories, preserves originals, restores and saves history independently', () => {
    const p = fixture(), id = p.tracks[0].id;
    const original = structuredClone(p.tracks[0].devices[0]);
    const bus = new StudioCommandBus();
    const updated = bus.executeMutation('synthetic','Replace plugin','clip_edit',p,draft=>substituteUnsupportedDevice(draft,id,'31','Analog','instrument'));
    const d = updated.tracks[0].devices[0];
    expect(d.xmlTag).toBe('UltraAnalog');
    expect(d.originalPlugin).toEqual(original);
    expect(resolveTrackInstrumentSynthesis(updated.tracks[0]).instrumentTag).toBe('UltraAnalog');
    const ctx = {createGain:()=>({gain:{value:1},disconnect(){},connect(){}})} as unknown as BaseAudioContext;
    expect(buildDeviceInsertProcessor(ctx,d).xmlTag).toBe('UltraAnalog');
    expect(bus.undo('synthetic')!.tracks[0].devices[0]).toEqual(original);
    expect(bus.redo('synthetic')!.tracks[0].devices[0].xmlTag).toBe('UltraAnalog');
    const saved = encodeProjectSnapshot(updated,DEFAULT_HUMANIZATION,DEFAULT_MASTER_BUS,DEFAULT_TRANSPORT);
    const reopened = decodeProjectSnapshot(saved).project;
    expect(reopened.tracks[0].devices[0]).toEqual(d);
    expect(restoreOriginalPlugin(reopened,id,'31').tracks[0].devices[0]).toEqual(original);
    const exported = new DOMParser().parseFromString(synchronizeProjectStateToXml(updated), 'application/xml');
    expect(exported.querySelector('AuPluginDevice')!.outerHTML).toBe(original.opaqueSubtreeXml);
    expect(() => resolveTrackInstrumentSynthesis(p.tracks[0])).toThrow(/UNRESOLVED/);
    expect(() => resolveTrackInstrumentSynthesis(bypassUnsupportedPlugin(p,id,'31').tracks[0])).not.toThrow();
  });
  it('rejects incompatible replacements, sample dependencies and forged support flags', () => {
    const p=fixture(),id=p.tracks[0].id;
    expect(()=>substituteUnsupportedDevice(p,id,'31','Reverb','instrument')).toThrow(/ROLE/);
    expect(()=>substituteUnsupportedDevice(p,id,'31','Simpler','instrument')).toThrow(/SAMPLE/);
    p.tracks[0].devices[0].browserDspSupported=true;
    expect(()=>resolveTrackInstrumentSynthesis(p.tracks[0])).toThrow(/UNRESOLVED/);
  });
  it('blocks legacy automatic bypass flags without an explicit dependency action', () => {
    const p=fixture();p.tracks[0].devices[0].bypassed=true;
    expect(()=>resolveTrackInstrumentSynthesis(p.tracks[0])).toThrow(/UNRESOLVED/);
  });
  it('rejects replacement that would exceed the registered instrument count', () => {
    const p=fixture(),id=p.tracks[0].id;
    p.tracks[0].devices.unshift({id:'existing-synth',xmlTag:'Operator',displayName:'Operator',category:'instrument',parameters:[]});
    expect(()=>substituteUnsupportedDevice(p,id,'31','Analog','instrument')).toThrow(/COMPATIBILITY/);
  });
  it('does not steal a valid later note identity during repair', () => {
    const p = fixture(), clip = p.tracks[0].clips[0];
    const note = clip.notes[0];
    const reserved = `${clip.id}_n0_p${note.pitch}_t${Math.round(note.time*1000)}`;
    clip.notes = [{...note,id:''},{...note,id:reserved,time:1}];
    const result = repairProjectNoteIdentities(p).project.tracks[0].clips[0].notes;
    expect(result[1].id).toBe(reserved);
    expect(result[0].id).not.toBe(reserved);
  });
  it('rejects duplicate identities inside a source scope as ambiguous', () => {
    const p = fixture(), clip = p.tracks[0].clips[0];
    clip.notes = [{...clip.notes[0],id:'duplicate'},{...clip.notes[0],id:'duplicate',pitch:70}];
    expect(() => repairProjectNoteIdentities(p)).toThrow(/AMBIGUOUS/);
  });
});
