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
