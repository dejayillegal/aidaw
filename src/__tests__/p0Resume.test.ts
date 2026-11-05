// @vitest-environment jsdom
// All projects in this suite are SYNTHETIC, not the user's recovery envelopes.
import { describe, expect, it } from 'vitest';
import { buildStarterAbletonXml, parseAlsXmlString, parseAbletonXmlDom } from '../engine/alsXmlEngine';
import { StudioCommandBus, substituteUnsupportedDevice } from '../services/commandBus';
import {
  buildDeviceInsertProcessor,
  encodeAudioBufferToWavBlob,
  resolveTrackInstrumentSynthesis,
  synthesizeDeterministicStereoPcm,
} from '../engine/webAudioSynth';
import { restoreOriginalPlugin, bypassUnsupportedPlugin } from '../engine/pluginDependencies';
import { encodeProjectSnapshot, decodeProjectSnapshot } from '../services/projectSnapshotService';
import { synchronizeProjectStateToXml } from '../engine/alsXmlEngine';
import { DEFAULT_HUMANIZATION, DEFAULT_MASTER_BUS, DEFAULT_TRANSPORT } from '../engine/projectDefaults';
import { assertProjectState, repairProjectNoteIdentities } from '../engine/projectStateContracts';
import {
  CURRENT_DEVICE_CONVERSION_VERSION,
  buildDeviceConversionRecord,
  migrateCompatibleProjectUnitConversions,
} from '../engine/abletonCapabilityMatrix';
import { inspectWavBinaryHeader } from '../engine/masteringEngine';
import { MusicalTimeService } from '../engine/timelineCoordinates';

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
  it('renders non-zero audible PCM and independently decoded RIFF WAVE output after replacing AuPluginDevice without mutating unrelated tracks', async () => {
    const p = fixture();
    const track0Id = p.tracks[0].id;
    const unrelatedTracksBefore = structuredClone(p.tracks.slice(1));

    // Unresolved plugin blocks synthesis before user action
    expect(() =>
      synthesizeDeterministicStereoPcm(p, DEFAULT_HUMANIZATION, DEFAULT_MASTER_BUS, 22050)
    ).toThrow(/UNSUPPORTED_DEVICE|UNRESOLVED/);

    // Explicit replacement with Analog instrument
    const replaced = substituteUnsupportedDevice(p, track0Id, '31', 'Analog', 'instrument');
    expect(replaced.tracks.slice(1)).toEqual(unrelatedTracksBefore);

    // Solo track 0 to prove the replaced plugin track itself generates audible sound
    const soloReplaced = {
      ...replaced,
      arrangementLengthBars: 1,
      tracks: [{ ...replaced.tracks[0], soloed: true }, ...replaced.tracks.slice(1).map(t => ({ ...t, muted: true }))],
    };
    const pcm = synthesizeDeterministicStereoPcm(soloReplaced, DEFAULT_HUMANIZATION, DEFAULT_MASTER_BUS, 22050);
    let sumSq = 0;
    let peak = 0;
    for (let i = 0; i < pcm.left.length; i++) {
      const s = Math.abs(pcm.left[i]);
      sumSq += s * s;
      if (s > peak) peak = s;
    }
    const rms = Math.sqrt(sumSq / pcm.left.length);
    expect(rms).toBeGreaterThan(0.01);
    expect(peak).toBeGreaterThan(0.05);

    // Encode to 24-bit WAV and independently decode RIFF WAVE binary header & PCM payload
    const audioBufferLike = {
      numberOfChannels: 2,
      sampleRate: pcm.sampleRate,
      length: pcm.left.length,
      getChannelData: (ch: number) => (ch === 0 ? pcm.left : pcm.right),
      copyFromChannel: (dest: Float32Array, ch: number, start: number) =>
        dest.set((ch === 0 ? pcm.left : pcm.right).subarray(start, start + dest.length)),
    };
    const wavBlob = await encodeAudioBufferToWavBlob(audioBufferLike, 24);
    const wavBytes = await wavBlob.arrayBuffer();
    const header = inspectWavBinaryHeader(wavBytes);
    expect(header.isValid).toBe(true);
    expect(header.riffMagic).toBe('RIFF');
    expect(header.waveMagic).toBe('WAVE');
    expect(header.numChannels).toBe(2);
    expect(header.sampleRate).toBe(22050);
    expect(header.bitsPerSample).toBe(24);
    expect(new DataView(wavBytes).getUint32(40, true)).toBe(pcm.left.length * 2 * 3);
    expect(header.durationSeconds).toBeCloseTo(pcm.left.length / 22050, 4);
  });
  it('enforces historical-record equivalence on v1 -> v2 Reverb migration and rejects tampered descriptors or unknown versions', () => {
    const p = parseAlsXmlString(buildStarterAbletonXml('berghain-134', 123, 4).xml);
    const canonicalV1Reverb = {
      id: '202',
      xmlTag: 'Reverb',
      displayName: 'Reverb',
      category: 'audio_effect' as const,
      bypassed: false,
      parameters: [
        { name: 'DecayTime', value: 3600, unit: 'ms' as const },
        { name: 'DryWet', value: 0.4 },
      ],
    };
    const v1Record = buildDeviceConversionRecord(canonicalV1Reverb, true);
    p.tracks[0].devices.push({ ...canonicalV1Reverb, conversionRecord: v1Record });

    const migratedOnce = migrateCompatibleProjectUnitConversions(p);
    expect(migratedOnce.migrated).toBe(true);
    const migratedReverb = migratedOnce.project.tracks[0].devices.find(d => d.id === '202')!;
    expect(migratedReverb.conversionRecord?.conversionVersion).toBe(CURRENT_DEVICE_CONVERSION_VERSION);
    expect(() => assertProjectState(migratedOnce.project)).not.toThrow();

    // Repeat migration is a no-op
    const migratedTwice = migrateCompatibleProjectUnitConversions(migratedOnce.project);
    expect(migratedTwice.migrated).toBe(false);

    // Tampered descriptor is rejected and fails assertProjectState with CONVERSION_REQUIRED
    const tampered = structuredClone(p);
    const tamperedDev = tampered.tracks[0].devices.find(d => d.id === '202')!;
    tamperedDev.conversionRecord = {
      ...v1Record,
      generatedDescriptor: { ...v1Record.generatedDescriptor, reverbDecaySec: 99.9 },
    };
    const tamperedMigration = migrateCompatibleProjectUnitConversions(tampered);
    expect(tamperedMigration.migrated).toBe(false);
    expect(() => assertProjectState(tamperedMigration.project)).toThrow(/CONVERSION_REQUIRED/);

    // Unknown future conversionVersion (e.g. 99) is rejected
    const unknownVersion = structuredClone(p);
    const unknownDev = unknownVersion.tracks[0].devices.find(d => d.id === '202')!;
    unknownDev.conversionRecord = {
      ...v1Record,
      conversionVersion: 99,
    };
    const unknownMigration = migrateCompatibleProjectUnitConversions(unknownVersion);
    expect(unknownMigration.migrated).toBe(false);
    expect(() => assertProjectState(unknownMigration.project)).toThrow(/FUTURE_CONVERSION_VERSION/);
  });
  it('computes exact 4/4 musical duration from tempo and bars (seconds = bars * 240 / BPM)', () => {
    const p138 = parseAlsXmlString(buildStarterAbletonXml('berghain-134', 123, 4).xml);
    p138.tempo = 138;
    p138.tempoMap = [{ beat: 0, bpm: 138, curve: 'step' }];
    p138.arrangementLengthBars = 128;
    expect(MusicalTimeService.arrangementDurationSeconds(p138, 128 * 4)).toBeCloseTo((128 * 240) / 138, 6);
    p138.arrangementLengthBars = 64;
    expect(MusicalTimeService.arrangementDurationSeconds(p138, 64 * 4)).toBeCloseTo((64 * 240) / 138, 6);

    p138.tempo = 133.5;
    p138.tempoMap = [{ beat: 0, bpm: 133.5, curve: 'step' }];
    p138.arrangementLengthBars = 128;
    expect(MusicalTimeService.arrangementDurationSeconds(p138, 128 * 4)).toBeCloseTo((128 * 240) / 133.5, 6);
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
