import type { AbletonProjectState, HumanizationConfig, MasterBusConfig, TransportConfig } from '../types/ableton';
import { synchronizeProjectStateToXml } from '../engine/alsXmlEngine';
import { assertProjectState } from '../engine/projectStateContracts';

export interface ProjectSnapshot {
  format: 'parametric-als-daw';
  version: 1;
  project: AbletonProjectState;
  audioSettings: { humanization: HumanizationConfig; masterBus: MasterBusConfig; transport: TransportConfig };
}

function assertFiniteJson(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('PROJECT_SNAPSHOT: non-finite value');
  if (value && typeof value === 'object') for (const child of Object.values(value)) assertFiniteJson(child);
}
function validate(snapshot: ProjectSnapshot): void {
  if (!snapshot || snapshot.format !== 'parametric-als-daw') throw new Error('PROJECT_SNAPSHOT: unrecognized project format');
  if (snapshot.version !== 1) throw new Error('PROJECT_SNAPSHOT_VERSION: unsupported version; original file is unchanged');
  assertProjectState(snapshot.project);
  const settings = snapshot.audioSettings;
  if (!settings?.humanization || !settings?.masterBus || !settings?.transport ||
      !Number.isFinite(settings.humanization.cutoffHz) || settings.humanization.cutoffHz <= 0 ||
      !Number.isFinite(settings.masterBus.masterVolumeDb) ||
      !Number.isInteger(settings.transport.loopStartBar) || settings.transport.loopStartBar < 1 ||
      !Number.isInteger(settings.transport.loopLengthBars) || settings.transport.loopLengthBars < 1) {
    throw new Error('PROJECT_SNAPSHOT: invalid audio settings');
  }
  assertFiniteJson(snapshot);
}

/** Native project file stores the existing domain plus audio settings and opaque source XML. No assets are embedded. */
export function encodeProjectSnapshot(
  project: AbletonProjectState,
  humanization: HumanizationConfig,
  masterBus: MasterBusConfig,
  transport: TransportConfig
): string {
  const input: ProjectSnapshot = { format: 'parametric-als-daw', version: 1, project,
    audioSettings: { humanization, masterBus, transport } };
  validate(input);
  const snapshot = JSON.parse(JSON.stringify(input)) as ProjectSnapshot;
  snapshot.project.rawXmlModified = synchronizeProjectStateToXml(snapshot.project);
  snapshot.project.rawXml = snapshot.project.rawXmlModified;
  snapshot.audioSettings.transport.arrangementLengthBars = project.arrangementLengthBars || 16;
  return JSON.stringify(snapshot, null, 2);
}

export function decodeProjectSnapshot(text: string): ProjectSnapshot {
  let snapshot: ProjectSnapshot;
  try { snapshot = JSON.parse(text); } catch { throw new Error('PROJECT_SNAPSHOT: invalid JSON'); }
  validate(snapshot);
  // Typed project is authoritative; rebuild supported XML fields instead of trusting stale cached XML.
  snapshot.project.rawXmlModified = synchronizeProjectStateToXml(snapshot.project);
  snapshot.project.rawXml = snapshot.project.rawXmlModified;
  snapshot.audioSettings.transport.arrangementLengthBars = snapshot.project.arrangementLengthBars || 16;
  return snapshot;
}
