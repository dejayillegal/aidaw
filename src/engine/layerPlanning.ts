import type { AbletonTrack, CompositionStrategyId, LayerDescriptor, TechnoArchetype } from '../types/ableton';

/** Stable string mixing: adding/reordering layers never reseeds existing identities. */
export function layerSeed(seed: number, identity: string): number {
  let hash = seed >>> 0;
  for (let i = 0; i < identity.length; i++) hash = Math.imul(hash ^ identity.charCodeAt(i), 16777619) >>> 0;
  return hash;
}

export interface LayerRecipe {
  variant: string; name: string; family: TechnoArchetype; roleCode: string;
  phraseBeats: number; registerHz: [number, number];
}
const recipe = (variant: string, name: string, family: TechnoArchetype, roleCode: string, phraseBeats: number, low: number, high: number): LayerRecipe =>
  ({ variant, name, family, roleCode, phraseBeats, registerHz: [low, high] });
export const LAYER_RECIPES: LayerRecipe[] = [
  recipe('kick', 'Kick foundation', 'kick', 'A1', 16, 25, 160),
  recipe('sub', 'Sub pulse', 'rumble', 'B1', 32, 30, 110),
  recipe('rolling-bass', 'Rolling bass', 'rumble', 'B2', 16, 45, 250),
  recipe('closed-hat', 'Closed hat anchor', 'hats', 'D1', 16, 3000, 14000),
  recipe('ghost-hat', 'Closed hat response', 'hats', 'D1', 12, 4000, 16000),
  recipe('open-hat', 'Open hat lift', 'hats', 'D1', 32, 2500, 16000),
  recipe('shaker', 'Shaker interlock', 'hats', 'D1', 20, 5000, 16000),
  recipe('ride', 'Ride punctuation', 'ride', 'D4', 16, 2500, 16000),
  recipe('clap', 'Clap backbeat', 'percussion', 'C1', 32, 400, 9000),
  recipe('tom-low', 'Low tom cycle', 'percussion', 'C4', 12, 100, 900),
  recipe('conga-mid', 'Conga mid', 'percussion', 'C4', 20, 200, 3000),
  recipe('conga-high', 'Conga response', 'percussion', 'C4', 12, 450, 4500),
  recipe('bongo', 'Bongo accents', 'percussion', 'C4', 16, 650, 5500),
  recipe('metal', 'Metallic counter rhythm', 'percussion', 'C1', 20, 600, 10000),
  recipe('rim', 'Rim micro groove', 'percussion', 'C1', 12, 500, 6500),
  recipe('stab', 'Chord stab', 'synth', 'E1', 32, 180, 5000),
  recipe('answer', 'Motif answer', 'synth', 'G2', 24, 350, 6500),
  recipe('modular', 'Modular sequence', 'synth', 'E1', 12, 250, 7000),
  recipe('dub-chord', 'Dub chord', 'synth', 'E2', 48, 180, 4500),
  recipe('dub-answer', 'Dub chord answer', 'synth', 'G1', 24, 350, 5500),
  recipe('acid-low', 'Acid groove', 'acid', 'B4', 16, 140, 3500),
  recipe('acid-high', 'Acid response', 'acid', 'B4', 12, 450, 9000),
  recipe('pad', 'Atmospheric pad', 'pad', 'F1', 64, 220, 7000),
  recipe('texture', 'Evolving texture', 'pad', 'F2', 48, 400, 10000),
  recipe('riser', 'Transition noise riser', 'percussion', 'H1', 16, 400, 16000),
  recipe('impact', 'Arrival impact', 'percussion', 'H1', 16, 40, 12000),
  recipe('downlifter', 'Reduction downlifter', 'percussion', 'H1', 16, 200, 14000),
];
const palettes: Partial<Record<CompositionStrategyId, string[]>> = {
  hypnotic_evolving: ['kick','sub','closed-hat','open-hat','modular','tom-low','ghost-hat','metal','answer','ride','pad','texture','rim','shaker'],
  asymmetric_industrial: ['kick','sub','closed-hat','metal','stab','tom-low','open-hat','rim','texture','answer','ride','ghost-hat','acid-low','pad','clap'],
  minimal_groove: ['kick','sub','closed-hat','rim','stab','open-hat','texture','ghost-hat','answer','pad'],
  dub_space: ['kick','sub','closed-hat','dub-chord','rim','pad','open-hat','dub-answer','texture','shaker','ghost-hat','tom-low'],
  detroit_funk: ['kick','rolling-bass','closed-hat','conga-mid','conga-high','bongo','clap','open-hat','stab','shaker','tom-low','ghost-hat','answer','ride','texture','pad'],
  raw_warehouse: ['kick','sub','closed-hat','tom-low','stab','open-hat','metal','ghost-hat','clap','answer','ride','texture','pad','rim','modular','shaker'],
  acid_modulation: ['kick','sub','closed-hat','acid-low','acid-high','clap','open-hat','tom-low','ride','ghost-hat','pad','metal','texture','shaker'],
  peak_rolling: ['kick','rolling-bass','closed-hat','stab','clap','open-hat','answer','tom-low','ride','pad','shaker','metal','ghost-hat','texture'],
};
export function styleLayerRecipes(style: CompositionStrategyId, density: 'compact' | 'standard' | 'full_reference', seed: number): LayerRecipe[] {
  const palette = palettes[style];
  if (!palette) throw new Error('LAYER_STYLE: unsupported style');
  // Foundations remain stable; optional supporting layers vary by seed and density.
  const count = density === 'compact' ? Math.min(8, palette.length) : density === 'standard' ? Math.min(11, palette.length) : palette.length - seed % 2;
  const variants = palette.slice(0, count);
  if (density === 'full_reference') variants.push('riser', 'impact', 'downlifter');
  return variants.map(variant => LAYER_RECIPES.find(r => r.variant === variant)!);
}
export function describeTrackLayer(track: AbletonTrack, seed: number): LayerDescriptor {
  if (track.layer) return track.layer;
  return { version: 1, id: `layer:${track.id}`, family: track.archetype, variant: track.archetype,
    seed: layerSeed(seed, track.id), phraseBeats: 16, registerHz: [20, 20000], provenance: 'legacy-score' };
}
