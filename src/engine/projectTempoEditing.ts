import type { AbletonProjectState } from '../types/ableton';

/** Change the initial tempo; later automation points remain deliberate user edits. */
export function editProjectBaseTempo(project: AbletonProjectState, bpm: number): AbletonProjectState {
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 240) {
    throw new Error('TEMPO_RANGE: tempo must be between 40 and 240 BPM');
  }
  const points = project.tempoMap ?? [];
  const initial = points.find(point => point.beat === 0);
  return {
    ...project,
    tempo: bpm,
    tempoMap: [{ ...initial, beat: 0, bpm, curve: initial?.curve ?? 'step' }, ...points.filter(point => point.beat !== 0)],
    ...(project.songPlan ? { songPlan: { ...project.songPlan, tempo: bpm } } : {}),
  };
}
