// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import type { AbletonDevice } from "../types/ableton";
import {
  buildDeviceConversionRecord,
  migrateCompatibleUnitConversion,
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
  it("preserves future, stale, corrupt and ambiguous records for targeted repair", () => {
    for (const change of [
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
