import type { AbletonDevice, AbletonProjectState } from '../types/ableton';
import { ABLETON_DEVICE_REGISTRY, buildDeviceConversionRecord, classifyAbletonDeviceTag } from './abletonCapabilityMatrix';

export type PluginRole = 'instrument' | 'audio_effect';
export type ReplacementType = 'Operator' | 'Analog' | 'Wavetable' | 'Simpler' | 'EQEight' | 'Reverb' | 'Compressor2';
const tags: Record<ReplacementType, string> = {Operator:'Operator',Analog:'UltraAnalog',Wavetable:'InstrumentVector',Simpler:'OriginalSimpler',EQEight:'EQEight',Reverb:'Reverb',Compressor2:'Compressor2'};
export const isPluginDependency = (d: AbletonDevice) => !!d.originalPlugin || d.isUnsupportedPlugin === true || ['AuPluginDevice','PluginDevice','MxDeviceAudioEffect'].includes(d.xmlTag);
export function pluginRole(d: AbletonDevice): PluginRole | undefined {
  const source = d.originalPlugin || d;
  return source.pluginRole || (source.xmlTag === 'MxDeviceAudioEffect' ? 'audio_effect' : undefined);
}
export function replacePlugin(source: AbletonDevice, requested: ReplacementType, chosenRole?: PluginRole): AbletonDevice {
  if (!isPluginDependency(source)) throw new Error('DEPENDENCY_TARGET: device is not an imported plugin');
  const original = structuredClone(source.originalPlugin || source);
  const evidenceRole = pluginRole(original);
  if (evidenceRole && chosenRole && evidenceRole !== chosenRole) throw new Error('DEPENDENCY_ROLE: conflicts with imported evidence');
  const role = evidenceRole || chosenRole;
  if (!role) throw new Error('DEPENDENCY_ROLE_REQUIRED: select instrument or audio effect');
  const tag = tags[requested], contract = ABLETON_DEVICE_REGISTRY[tag];
  if (!contract || !['executable','converted'].includes(classifyAbletonDeviceTag(tag))) throw new Error('DEPENDENCY_EXECUTABLE: replacement is not registered');
  if (contract.kind !== role) throw new Error('DEPENDENCY_ROLE: incompatible replacement');
  // The browser does not resolve imported sample assets for this replacement path.
  if (requested === 'Simpler') throw new Error('DEPENDENCY_SAMPLE_REQUIRED: resolve and validate sample assets before selecting a sampler');
  const device: AbletonDevice = { id: original.id, xmlTag: tag, displayName: `${contract.displayName} (replacement)`, category: role,
    bypassed: false, browserDspSupported: true, parameters: contract.parameterSpecs.map(p => ({name:p.name,value:p.defaultValue,unit:p.unit})),
    originalPlugin: original, pluginRole: role, substitutedActiveType: tag,
    pluginResolution: { action: 'replace', role, alsExport: 'original-plugin' },
  };
  if (classifyAbletonDeviceTag(tag) === 'converted') device.conversionRecord = buildDeviceConversionRecord(device);
  return device;
}
export function assertPluginExecutable(d: AbletonDevice): void {
  if (d.originalPlugin) {
    const contract = ABLETON_DEVICE_REGISTRY[d.xmlTag];
    if (!d.pluginResolution || d.pluginResolution.alsExport !== 'original-plugin') throw new Error('DEPENDENCY_RESOLUTION: missing explicit action');
    if (d.pluginResolution.action === 'replace' && (!contract || contract.kind !== d.pluginResolution.role || !['executable','converted'].includes(classifyAbletonDeviceTag(d.xmlTag)))) throw new Error('DEPENDENCY_EXECUTABLE: invalid replacement');
    if (d.pluginResolution.action === 'bypass' && !d.bypassed) throw new Error('DEPENDENCY_RESOLUTION: explicit bypass must be disabled');
  } else if (isPluginDependency(d) && !(d.bypassed && d.pluginOriginalEnabled === false)) {
    throw new Error('DEPENDENCY_UNRESOLVED: explicitly replace or bypass the imported plugin');
  }
}
export function restoreOriginalPlugin(project: AbletonProjectState, trackId: string, deviceId: string): AbletonProjectState {
  return editDependency(project, trackId, deviceId, d => {
    const original = structuredClone(d.originalPlugin || d);
    return original.pluginOriginalEnabled === undefined ? original : {...original,bypassed:!original.pluginOriginalEnabled};
  });
}
export function bypassUnsupportedPlugin(project: AbletonProjectState, trackId: string, deviceId: string): AbletonProjectState {
  return editDependency(project, trackId, deviceId, d => {
    const original = structuredClone(d.originalPlugin || d);
    return {...original, originalPlugin: original, bypassed:true, pluginResolution:{action:'bypass',alsExport:'original-plugin'}};
  });
}
export function editDependency(project: AbletonProjectState, trackId: string, deviceId: string, edit: (d:AbletonDevice)=>AbletonDevice): AbletonProjectState {
  const track = project.tracks.find(t=>t.id===trackId);
  if (!track || track.locked || !track.devices.some(d=>d.id===deviceId)) throw new Error('DEPENDENCY_TARGET: missing or locked track/device');
  return {...project, projectRevision:(project.projectRevision || 1)+1, tracks:project.tracks.map(t=>t.id===trackId?{...t,devices:t.devices.map(d=>d.id===deviceId?edit(d):d)}:t)};
}
