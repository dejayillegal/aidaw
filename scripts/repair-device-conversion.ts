/** Inspect a saved record; explicitly repair one selected derived descriptor into a NEW file. */
import fs from "node:fs";
import { createRequire } from "node:module";
import type { AbletonProjectState } from "../src/types/ableton";
const { JSDOM } = createRequire(import.meta.url)("jsdom");
import { assertStructuralProjectState } from "../src/engine/projectStateContracts";
import {
  buildDeviceConversionRecord,
  computeDeviceParameterHash,
  migrateCompatibleProjectUnitConversions,
  CURRENT_DEVICE_CONVERSION_VERSION,
} from "../src/engine/abletonCapabilityMatrix";
import { encodeProjectSnapshot } from "../src/services/projectSnapshotService";
const [input, trackId, deviceId, expectedHash, output] = process.argv.slice(2);
if (!input)
  throw new Error(
    "Usage: tsx scripts/repair-device-conversion.ts input.aidaw.json [trackId deviceId expectedSourceHash NEW-output.aidaw.json]",
  );
const envelope = JSON.parse(fs.readFileSync(input, "utf8"));
if (
  envelope.format !== "parametric-als-daw" ||
  ![1, 2, 3].includes(envelope.version)
)
  throw new Error(
    "REPAIR_VERSION: only known native snapshots accepted; export original recovery data separately",
  );
const p: AbletonProjectState = structuredClone(envelope.project);
if (envelope.version === 1) p.audioSettings = envelope.audioSettings;
assertStructuralProjectState(p);
const rows = p.tracks.flatMap((t) =>
  t.devices
    .filter((d) => !deviceId || d.id === deviceId)
    .map((d) => ({
      trackId: t.id,
      deviceId: d.id,
      xmlTag: d.xmlTag,
      rawParameters: d.parameters,
      sourceHash: computeDeviceParameterHash(d),
      actual: d.conversionRecord,
      expected: buildDeviceConversionRecord(d),
    })),
);
console.log(JSON.stringify(rows, null, 2));
if (output) {
  if (!trackId || !deviceId || !expectedHash)
    throw new Error(
      "REPAIR_TARGET: provide the exact inspected track/device/hash",
    );
  const targets = p.tracks
    .filter((t) => t.id === trackId)
    .flatMap((t) => t.devices.filter((d) => d.id === deviceId));
  if (targets.length !== 1)
    throw new Error("REPAIR_TARGET: missing or ambiguous device");
  const d = targets[0];
  if (
    (d.conversionRecord?.conversionVersion ?? 0) >
    CURRENT_DEVICE_CONVERSION_VERSION
  )
    throw new Error("FUTURE_CONVERSION_VERSION: use a compatible reader");
  if (computeDeviceParameterHash(d) !== expectedHash)
    throw new Error("REPAIR_HASH: source changed; inspect again");
  if (!d.conversionRecord)
    throw new Error(
      "REPAIR_TARGET: use the existing missing-legacy migration action",
    );
  // The explicit action rebuilds only this selected derived record; editable source parameters remain exact.
  d.conversionRecord = buildDeviceConversionRecord(d);
  const repaired = migrateCompatibleProjectUnitConversions(p).project;
  const dom = new JSDOM();
  Object.assign(globalThis, {
    DOMParser: dom.window.DOMParser,
    XMLSerializer: dom.window.XMLSerializer,
  });
  const a = repaired.audioSettings;
  if (!a)
    throw new Error(
      "REPAIR_SETTINGS: ambiguous/missing settings; original preserved",
    );
  fs.writeFileSync(
    output,
    encodeProjectSnapshot(repaired, a.humanization, a.masterBus, a.transport),
    { flag: "wx" },
  );
  console.log(
    `Wrote separate repaired snapshot: ${output}. Original unchanged.`,
  );
}
