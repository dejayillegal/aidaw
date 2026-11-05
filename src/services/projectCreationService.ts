import type { AbletonProjectState, CompositionStrategyId, TechnoSubgenreId } from '../types/ableton';
import { buildStarterAbletonXml, parseAbletonXmlDom, synchronizeProjectStateToXml } from '../engine/alsXmlEngine';
import { createSongPlan, composeSongPlan } from '../engine/songPlanEngine';
import { projectAudioSettings } from '../engine/projectDefaults';
import { assertProjectState } from '../engine/projectStateContracts';

export interface NewProjectOptions {
  title: string;
  subgenreId: TechnoSubgenreId;
  bpm: number;
  durationBars: number;
  layerDensity: 'compact' | 'standard' | 'full_reference';
  seed: number;
}

const styles: Record<string, CompositionStrategyId> = {
  raw_warehouse: 'raw_warehouse', berlin_industrial: 'asymmetric_industrial',
  hardgroove: 'minimal_groove', acid_techno: 'acid_modulation',
  dub_techno: 'dub_space', driving_rolling: 'peak_rolling',
};

/** Orchestrates the existing generator and canonical XML projection; owns no score or clock. */
export function createEditableFullTrack(options: NewProjectOptions): AbletonProjectState {
  const style = styles[options.subgenreId];
  if (!style || !options.title.trim() || options.title.length > 160 ||
      !Number.isFinite(options.bpm) || options.bpm < 40 || options.bpm > 240 ||
      !Number.isSafeInteger(options.durationBars) || options.durationBars < 4 || options.durationBars > 4096 ||
      !Number.isSafeInteger(options.seed) || options.seed < 0 || options.seed > 0xffffffff ||
      !['compact', 'standard', 'full_reference'].includes(options.layerDensity)) {
    throw new Error('PROJECT_CREATION: valid title, style, 40–240 BPM, 4–4096 bars, density and uint32 seed required');
  }
  const template = style === 'dub_space' ? 'ostgut-128' : style === 'asymmetric_industrial' ? 'tresor-138' : 'berghain-134';
  const { xml } = buildStarterAbletonXml(template, options.seed, 4, 'full-track');
  const parsed = parseAbletonXmlDom(xml, options.title.trim().replace(/\.als$/i, '') + '.als', xml);
  const project: AbletonProjectState = { ...parsed, tempo: options.bpm,
    tempoMap: [{ beat: 0, bpm: options.bpm, curve: 'step' }],
    meterMap: [{ bar: 1, beat: 0, numerator: 4, denominator: 4 }], ppq: 960,
    subgenreId: options.subgenreId, generationSeed: options.seed,
    creationMode: 'full-track', requestedDurationBars: options.durationBars, arrangementLengthBars: options.durationBars };
  // The current registered generator has eight roles. The UI states these actual counts.
  project.tracks = project.tracks.filter(t =>
    options.layerDensity === 'full_reference' ||
    (t.archetype !== 'ride' && (options.layerDensity === 'standard' || t.archetype !== 'acid')));
  const plan = createSongPlan(project, options.seed, style);
  const selected = new Set(project.tracks.map(t => t.archetype));
  plan.roles = plan.roles.filter(r => selected.has(r.role));
  plan.transitions = plan.transitions.map(t => ({ ...t, roles: t.roles.filter(r => selected.has(r)) }));
  const composed = composeSongPlan(project, plan);
  const settings = projectAudioSettings(composed);
  const result = { ...composed, audioSettings: { ...settings,
    transport: { ...settings.transport, arrangementMode: 'arrangement' as const, loopEnabled: false, loopStartBar: 1, loopLengthBars: options.durationBars } } };
  assertProjectState(result);
  const projected = synchronizeProjectStateToXml(result);
  return { ...result, rawXmlModified: projected, rawXml: projected };
}
