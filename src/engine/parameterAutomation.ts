import type { AutomatedTrackParameter, ParameterAutomationLane } from '../types/ableton';
import { projectBeat, projectSeconds, type TimingProject } from './runtimeTiming';

export const PARAMETER_LIMITS: Record<AutomatedTrackParameter, [number, number]> = {
  filterCutoffHz: [20, 20000], volumeDb: [-60, 6], pan: [-1, 1], reverbSend: [0, 1], delaySend: [0, 1],
};
export function assertParameterLanes(lanes: ParameterAutomationLane[]): void {
  if (!Array.isArray(lanes) || lanes.length > 32) throw new Error('AUTOMATION_SHAPE: invalid lane collection');
  const ids = new Set<string>(), targets = new Set<string>();
  for (const lane of lanes) {
    const limits = PARAMETER_LIMITS[lane.target];
    if (lane.version !== 1 || typeof lane.id !== 'string' || !lane.id || ids.has(lane.id) || !limits ||
      typeof lane.enabled !== 'boolean' || (lane.enabled && targets.has(lane.target)) ||
      !Array.isArray(lane.points) || !lane.points.length || lane.points.length > 16384) throw new Error('AUTOMATION_LANE: invalid identity, target or version');
    ids.add(lane.id); if (lane.enabled) targets.add(lane.target);
    for (const [i, point] of lane.points.entries()) {
      if (!Number.isFinite(point.beat) || point.beat < 0 || point.beat > 65536 || !Number.isFinite(point.value) ||
        point.value < limits[0] || point.value > limits[1] || (i && point.beat <= lane.points[i - 1].beat) ||
        (point.curve !== undefined && !['linear', 'exponential', 'smooth', 'step'].includes(point.curve)) ||
        (point.curve === 'exponential' && (point.value <= 0 || (lane.points[i + 1]?.value ?? 1) <= 0))) {
        throw new Error('AUTOMATION_POINT: ordered, bounded values and supported curves required');
      }
    }
  }
}
export function evaluateParameterLane(lane: ParameterAutomationLane, beat: number): number {
  const points = lane.points;
  if (beat <= points[0].beat) return points[0].value;
  if (beat >= points.at(-1)!.beat) return points.at(-1)!.value;
  let low = 1, high = points.length - 1;
  while (low < high) { const mid = (low + high) >>> 1; if (points[mid].beat < beat) low = mid + 1; else high = mid; }
  const a = points[low - 1], b = points[low], fraction = (beat - a.beat) / (b.beat - a.beat);
  if (a.curve === 'step') return beat < b.beat ? a.value : b.value;
  if (a.curve === 'exponential') return a.value * (b.value / a.value) ** fraction;
  const mix = a.curve === 'smooth' ? fraction * fraction * (3 - 2 * fraction) : fraction;
  return a.value + (b.value - a.value) * mix;
}
type ScheduledParam = {
  cancelScheduledValues(time: number): void;
  setValueAtTime(value: number, time: number): void;
  linearRampToValueAtTime(value: number, time: number): void;
};
/** Native audio-time ramps, sampled at <=10ms with exact knots and step discontinuities. */
export function scheduleParameterLane(param: ScheduledParam, lane: ParameterAutomationLane, project: TimingProject,
  fromBeat: number, toBeat: number, atSeconds: number, cancel = true): void {
  if (!lane.enabled) return;
  const convert = (value: number) => lane.target === 'volumeDb' ? 10 ** (value / 20) : value;
  const encode = (beat: number) => convert(evaluateParameterLane(lane, beat));
  if (cancel) param.cancelScheduledValues(atSeconds);
  param.setValueAtTime(encode(fromBeat), atSeconds);
  if (toBeat <= fromBeat) return;
  const endBeat = Math.min(toBeat, lane.points.at(-1)!.beat);
  if (endBeat <= fromBeat) return;
  const start = projectSeconds(project, fromBeat), end = projectSeconds(project, endBeat);
  const moments = new Set<number>([end]);
  for (const p of lane.points) if (p.beat > fromBeat && p.beat <= endBeat) moments.add(projectSeconds(project, p.beat));
  for (const p of project.tempoMap || []) if (p.beat > fromBeat && p.beat < endBeat) moments.add(projectSeconds(project, p.beat));
  for (let i = Math.floor(start * 100) + 1; i / 100 < end; i++) moments.add(i / 100);
  for (const seconds of [...moments].sort((a, b) => a - b)) {
    const beat = projectBeat(project, seconds), at = atSeconds + seconds - start;
    const previousPoint = lane.points.findLast(p => p.beat < beat - 1e-8);
    if (previousPoint?.curve === 'step') {
      // Hold the old value up to the knot; set the new value exactly at it.
      param.linearRampToValueAtTime(convert(previousPoint.value), at);
      param.setValueAtTime(encode(beat), at);
    } else param.linearRampToValueAtTime(encode(beat), at);
  }
}
