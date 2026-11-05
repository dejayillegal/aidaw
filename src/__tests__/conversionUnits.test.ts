// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { buildStarterAbletonXml, parseAlsXmlString } from '../engine/alsXmlEngine';
import type { AbletonDevice } from "../types/ableton";
import {
  buildDeviceConversionRecord,
  migrateCompatibleUnitConversion,
  migrateCompatibleProjectUnitConversions,
  verifyDeviceConversionRecord,
  CURRENT_DEVICE_CONVERSION_VERSION,
} from "../engine/abletonCapabilityMatrix";
const dev = (): AbletonDevice => ({
  id: "202",
  xmlTag: "Reverb",
  displayName: "Reverb",
  category: "audio_effect",
  parameters: [
    { name: "DecayTime", value: 3600, unit: "ms" },
    { name: "DryWet", value: 35, unit: "%" },
  ],
});
describe("Versioned unit conversion compatibility", () => {
  it('migrates the historical built-in LFO filter route without discarding its target metadata',()=>{
    const d: AbletonDevice={id:'9901',xmlTag:'Lfo',displayName:'Lfo',category:'max_modulator',parameters:[
      {name:'Rate (Unsynced)',value:'0.100',unit:'Hz'},
      {name:'Waveform',value:'Sine'},
      {name:'Target',value:'AutoFilter.Cutoff',automationTarget:true},
    ]};
    d.conversionRecord=buildDeviceConversionRecord(d,true);
    const result=migrateCompatibleUnitConversion(d);
    expect(result.migrated).toBe(true);
    expect(result.device.parameters).toEqual(d.parameters);
    expect(verifyDeviceConversionRecord(result.device).isValid).toBe(true);
    expect(migrateCompatibleUnitConversion(result.device).migrated).toBe(false);
    // A fresh matching hash alone cannot authorize arbitrary automation routing.
    for(const target of ['OtherTrack.Cutoff','555','AutoFilter.Resonance']) {
      const unknown=structuredClone(d);unknown.parameters[2].value=target;
      unknown.conversionRecord=buildDeviceConversionRecord(unknown,true);
      expect(migrateCompatibleUnitConversion(unknown).migrated).toBe(false);
    }
    const altered=structuredClone(d);altered.conversionRecord!.generatedDescriptor.depth=.9;
    expect(migrateCompatibleUnitConversion(altered).migrated).toBe(false);
  });
  it("migrates only the exact reproducible v1 descriptor and preserves raw parameters", () => {
    const d = dev();
    d.conversionRecord = buildDeviceConversionRecord(d, true);
    expect(d.conversionRecord.generatedDescriptor.decaySec).toBe(15);
    const result = migrateCompatibleUnitConversion(d);
    expect(result.migrated).toBe(true);
    expect(result.device.parameters).toEqual(d.parameters);
    expect(result.device.conversionRecord!.conversionVersion).toBe(
      CURRENT_DEVICE_CONVERSION_VERSION,
    );
    expect(result.device.conversionRecord!.generatedDescriptor.decaySec).toBe(
      3.6,
    );
    expect(verifyDeviceConversionRecord(result.device).isValid).toBe(true);
    expect(migrateCompatibleUnitConversion(result.device).migrated).toBe(false);
    expect(d.conversionRecord.generatedDescriptor.decaySec).toBe(15);
  });
  it('rejects migration of historical records whose native automation is unresolved', () => {
    const p=parseAlsXmlString(buildStarterAbletonXml('berghain-134',19,4).xml), d=dev();
    d.conversionRecord=buildDeviceConversionRecord(d,true);p.tracks[0].devices=[d];
    const doc=new DOMParser().parseFromString(p.rawXml!, 'application/xml');
    doc.querySelector('MidiTrack Devices')!.innerHTML='<Reverb Id="202"><DecayTime><AutomationTarget Id="555"/></DecayTime></Reverb>';
    const envelopes=doc.createElement('AutomationEnvelopes');envelopes.innerHTML='<AutomationEnvelope><EnvelopeTarget><PointeeId Value="555"/></EnvelopeTarget></AutomationEnvelope>';
    doc.querySelector('MidiTrack')!.appendChild(envelopes);p.rawXmlModified=new XMLSerializer().serializeToString(doc);
    expect(migrateCompatibleProjectUnitConversions(p).migrated).toBe(false);
    expect(p.tracks[0].devices[0].conversionRecord!.conversionVersion).toBe(1);
  });
  it("preserves future, stale, corrupt and ambiguous records for targeted repair", () => {
    for (const change of [
      (d: AbletonDevice) => (d.conversionRecord!.conversionVersion = 0),
      (d: AbletonDevice) => (d.conversionRecord!.sourceDeviceId = 'wrong-device'),
      (d: AbletonDevice) => (d.conversionRecord!.xmlTag = 'HybridReverb'),
      (d: AbletonDevice) => (d.parameters[0].unit = 'unknown'),
      (d: AbletonDevice) => (d.parameters[0].automationTarget = true),
      (d: AbletonDevice) => (d.conversionRecord!.conversionVersion = 99),
      (d: AbletonDevice) => (d.conversionRecord!.sourceParameterHash = "bad"),
      (d: AbletonDevice) =>
        (d.conversionRecord!.generatedDescriptor.decaySec = 9),
      (d: AbletonDevice) => (d.conversionRecord!.status = "invalidated"),
    ]) {
      const d = dev();
      d.conversionRecord = buildDeviceConversionRecord(d, true);
      change(d);
      const before = JSON.stringify(d);
      expect(migrateCompatibleUnitConversion(d).migrated).toBe(false);
      expect(JSON.stringify(d)).toBe(before);
    }
  });
});
