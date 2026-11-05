import type { AbletonProjectState, CompositionStrategyId, TechnoSubgenreId } from '../types/ableton';
import { buildStarterAbletonXml, parseAbletonXmlDom, synchronizeProjectStateToXml } from '../engine/alsXmlEngine';
import { createSongPlan, composeSongPlan } from '../engine/songPlanEngine';
import { projectAudioSettings } from '../engine/projectDefaults';
import { assertProjectState } from '../engine/projectStateContracts';
import { createUserTrackFromRole } from '../engine/compositionIntelligenceEngine';
import { layerSeed, styleLayerRecipes } from '../engine/layerPlanning';
import { createLayerAutomation } from '../engine/compositionAutomation';
import { defaultSidechain } from '../engine/sidechainGraph';

export interface NewProjectOptions {
  rootKey?: string;
  mode?: string;
  formFamily?: 'style-default' | 'plateau' | 'dual-drop' | 'dub-evolution';
  title: string;
  subgenreId: TechnoSubgenreId;
  bpm: number;
  durationBars: number;
  layerDensity: 'compact' | 'standard' | 'full_reference';
  seed: number;
}

export const CREATION_STYLE_STRATEGIES: Record<string, CompositionStrategyId> = {
  raw_warehouse: 'raw_warehouse', berlin_industrial: 'asymmetric_industrial',
  hardgroove: 'detroit_funk', acid_techno: 'acid_modulation',
  dub_techno: 'dub_space', driving_rolling: 'peak_rolling',
  hypnotic_deep: 'hypnotic_evolving', minimal_micro: 'minimal_groove',
};

export function createStyleLayerTracks(style: CompositionStrategyId, density: NewProjectOptions['layerDensity'], seed: number) {
  return styleLayerRecipes(style, density, seed).map((recipe, index) => {
    const id = `style_${style}_${recipe.variant}`;
    const track = createUserTrackFromRole(recipe.roleCode, index, recipe.name, id);
    return { ...track, layer: { version: 1 as const, id: `layer:${id}`, family: recipe.family,
      variant: recipe.variant, seed: layerSeed(seed, id), phraseBeats: recipe.phraseBeats,
      registerHz: recipe.registerHz, provenance: 'procedural-style-v1' as const } };
  });
}

/** Reuse existing authored layers; expand only genuinely missing layer duties. */
export function extendStyleEnsemble(project: AbletonProjectState, style: CompositionStrategyId, seed: number): AbletonProjectState {
  const tracks=[...project.tracks],claimed=new Set<string>();
  for(const candidate of createStyleLayerTracks(style,'full_reference',seed)) {
    const existing=tracks.find(t=>t.layer?.variant===candidate.layer.variant)||tracks.find(t=>!t.layer&&!t.isGroupTrack&&t.type==='midi'&&t.archetype===candidate.archetype&&!claimed.has(t.id));
    if(existing){claimed.add(existing.id);continue;}
    if(tracks.some(t=>t.id===candidate.id))throw new Error('LAYER_ID_COLLISION: preserve existing identity; rename the conflicting layer before adding this ensemble');
    tracks.push(candidate);claimed.add(candidate.id);
  }
  return {...project,tracks};
}

/** Orchestrates the existing generator and canonical XML projection; owns no score or clock. */
export function createEditableFullTrack(options: NewProjectOptions): AbletonProjectState {
  const style = CREATION_STYLE_STRATEGIES[options.subgenreId];
  if (!style || !options.title.trim() || options.title.length > 160 ||
      !Number.isFinite(options.bpm) || options.bpm < 40 || options.bpm > 240 ||
      !Number.isSafeInteger(options.durationBars) || options.durationBars < 4 || options.durationBars > 4096 ||
      !Number.isSafeInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff ||
      !['compact', 'standard', 'full_reference'].includes(options.layerDensity) ||
      options.rootKey !== undefined && !['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'].includes(options.rootKey) ||
      options.mode !== undefined && !['Phrygian','Dorian','Natural Minor','Harmonic Minor','Locrian','Phrygian Dominant','Octatonic'].includes(options.mode)) {
    throw new Error('PROJECT_CREATION: valid title, style, 40–240 BPM, 4–4096 bars, density and uint32 seed required');
  }
  const template = style === 'dub_space' ? 'ostgut-128' : style === 'asymmetric_industrial' ? 'tresor-138' : 'berghain-134';
  const { xml } = buildStarterAbletonXml(template, options.seed, 4, 'full-track');
  const parsed = parseAbletonXmlDom(xml, options.title.trim().replace(/\.als$/i, '') + '.als', xml);
  const project: AbletonProjectState = { ...parsed, tempo: options.bpm,
    tempoMap: [{ beat: 0, bpm: options.bpm, curve: 'step' }],
    meterMap: [{ bar: 1, beat: 0, numerator: 4, denominator: 4 }], ppq: 960,
    subgenreId: options.subgenreId, generationSeed: options.seed,
    ...(options.rootKey ? {rootKey:options.rootKey} : {}), ...(options.mode ? {scale:options.mode} : {}),
    creationMode: 'full-track', requestedDurationBars: options.durationBars, arrangementLengthBars: options.durationBars };
  project.tracks = createStyleLayerTracks(style, options.layerDensity, options.seed);
  const plan = createSongPlan(project, options.seed, style, options.formFamily);
  const composed = composeSongPlan(project, plan);
  composed.tracks = composed.tracks.map(track => ({...track,parameterAutomation:createLayerAutomation(plan,track)}));
  composed.memoryLocations = plan.sections.slice(0,9).map((section,i)=>({id:`section-marker:${section.id}`,number:i+1,
    name:section.name,bar:section.fromBeat/4+1,beat:section.fromBeat,color:'#06B6D4',comment:`Target energy ${section.energy.toFixed(2)}`}));
  // Short sketches may intentionally omit supporting layers; never ship empty filler tracks.
  composed.tracks = composed.tracks.filter(t => t.clips.some(c => c.notes.length));
  const kick = composed.tracks.find(t => t.archetype === 'kick');
  if (kick) composed.tracks = composed.tracks.map(t => ['rumble','pad','synth','acid'].includes(t.archetype)
    ? {...t,sidechainCompressor:defaultSidechain(kick.id)} : t);
  const selectedIds = new Set(composed.tracks.map(t => t.id));
  plan.roles = plan.roles.filter(r => r.trackId && selectedIds.has(r.trackId));
  plan.motifs = plan.motifs.filter(r => r.trackId && selectedIds.has(r.trackId));
  const settings = projectAudioSettings(composed);
  const result = { ...composed, audioSettings: { ...settings,
    transport: { ...settings.transport, arrangementMode: 'arrangement' as const, loopEnabled: false, loopStartBar: 1, loopLengthBars: options.durationBars } } };
  assertProjectState(result);
  const projected = synchronizeProjectStateToXml(result);
  return { ...result, rawXmlModified: projected, rawXml: projected };
}
