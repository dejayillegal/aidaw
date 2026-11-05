import type { AbletonProjectState, HumanizationConfig, MasterBusConfig, TransportConfig } from '../types/ableton';
import {
  determineLegacyConversionMigrationEligibility,
  migrateCompatibleProjectUnitConversions,
  migrateMissingLegacyProjectConversions,
} from '../engine/abletonCapabilityMatrix';
import { synchronizeProjectStateToXml } from '../engine/alsXmlEngine';
import { assertAudioSettings } from '../engine/audioSettingsContracts';
import { assertProjectState, assertStructuralProjectState } from '../engine/projectStateContracts';

export interface ProjectSnapshot {
  format: 'parametric-als-daw';
  version: 2 | 3;
  conversionSchemaVersion?: number;
  project: AbletonProjectState;
  audioSettings: { humanization: HumanizationConfig; masterBus: MasterBusConfig; transport: TransportConfig };
}

function assertFiniteJson(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('PROJECT_SNAPSHOT: non-finite value');
  if (value && typeof value === 'object') for (const child of Object.values(value)) assertFiniteJson(child);
}
function validate(snapshot: ProjectSnapshot): void {
  if (!snapshot || snapshot.format !== 'parametric-als-daw') throw new Error('PROJECT_SNAPSHOT: unrecognized project format');
  assertFiniteJson(snapshot);
  assertProjectState(snapshot.project);
  assertAudioSettings(snapshot.project.audioSettings!);
  assertFiniteJson(snapshot);
}

function exposedSnapshot(project: AbletonProjectState): ProjectSnapshot {
  // Legacy API access is a derived getter, never another mutable or serialized settings owner.
  return { format: 'parametric-als-daw', version: project.session || project.audioSettings?.transport.arrangementMode==='session' ? 3 : 2, project,
    get audioSettings() { return project.audioSettings!; } };
}

/** Native project file stores the existing domain plus audio settings and opaque source XML. No assets are embedded. */
export function encodeProjectSnapshot(
  project: AbletonProjectState,
  humanization: HumanizationConfig,
  masterBus: MasterBusConfig,
  transport: TransportConfig
): string {
  const input = exposedSnapshot({ ...project, audioSettings: project.audioSettings || { humanization, masterBus, transport } });
  validate(input);
  const clonedProject = JSON.parse(JSON.stringify(input.project)) as AbletonProjectState;
  delete clonedProject.audioSettings!.transport.arrangementLengthBars;
  clonedProject.rawXmlModified = synchronizeProjectStateToXml(clonedProject);
  clonedProject.rawXml = clonedProject.rawXmlModified;
  return JSON.stringify({ format: 'parametric-als-daw', version: input.version, project: clonedProject }, null, 2);
}

export function decodeProjectSnapshot(text: string): ProjectSnapshot {
  let input: {
    format: string;
    version: number;
    conversionSchemaVersion?: number;
    project: AbletonProjectState;
    audioSettings?: ProjectSnapshot['audioSettings'];
  };
  try { input = JSON.parse(text); } catch { throw new Error('PROJECT_SNAPSHOT: invalid JSON'); }
  if (!input || input.format !== 'parametric-als-daw') throw new Error('PROJECT_SNAPSHOT: unrecognized project format');
  if (![1,2,3].includes(input.version)) throw new Error('PROJECT_SNAPSHOT_VERSION: unsupported version; original file is unchanged');
  if (input.version===3 && !input.project?.session) throw new Error('PROJECT_SNAPSHOT: v3 requires Session performance state');
  if (input.version === 1) {
    if (input.project?.audioSettings && JSON.stringify(input.project.audioSettings) !== JSON.stringify(input.audioSettings)) {
      throw new Error('PROJECT_SNAPSHOT: ambiguous settings owners');
    }
    input.project = { ...input.project, audioSettings: input.audioSettings };
  } else if (input.audioSettings !== undefined) throw new Error('PROJECT_SNAPSHOT: duplicate settings owner');

  assertFiniteJson(input);
  assertStructuralProjectState(input.project);
  assertAudioSettings(input.project.audioSettings!);

  // Older v1, v2, and v3 snapshots may predate mandatory conversion records.
  // Check legacy migration eligibility before running strict conversion validation.
  input.project = migrateCompatibleProjectUnitConversions(input.project).project;
  const eligibility = determineLegacyConversionMigrationEligibility(input.project, {
    envelopeConversionSchemaVersion: input.conversionSchemaVersion,
  });
  if (['FUTURE_CONVERSION_VERSION', 'INVALIDATED_RECORD', 'STALE_PARAMETER_HASH', 'ALTERED_DESCRIPTOR', 'UNEXPECTED_CONVERSION_RECORD'].includes(eligibility.code)) {
    throw new Error(`CONVERSION_REQUIRED: ${eligibility.code}: ${eligibility.reason}`);
  }
  if (eligibility.eligible) {
    const clonedCandidate = JSON.parse(JSON.stringify(input.project)) as AbletonProjectState;
    input.project = migrateMissingLegacyProjectConversions(clonedCandidate).project;
  }

  const snapshot = exposedSnapshot(input.project);
  validate(snapshot);
  delete snapshot.project.audioSettings!.transport.arrangementLengthBars;
  snapshot.project.rawXmlModified = synchronizeProjectStateToXml(snapshot.project);
  snapshot.project.rawXml = snapshot.project.rawXmlModified;
  return snapshot;
}

