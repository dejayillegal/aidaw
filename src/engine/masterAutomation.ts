import type { AutomationPoint, MasterBusConfig } from '../types/ableton';
import { projectBeat, projectSeconds, type TimingProject } from './runtimeTiming';

/**
 * Evaluates the normalized automation envelope at an absolute arrangement beat.
 * Returns a normalized value in [0.0, 1.0].
 */
export function evaluateAutomationAtBeat(
  points: AutomationPoint[] | undefined,
  beat: number,
  maxBeats = Number.POSITIVE_INFINITY
): number {
  if (!points || points.length === 0) return 0.55;
  const sorted = [...points].sort((a, b) => a.beat - b.beat);
  const clampedBeat = Math.max(0, Math.min(maxBeats, beat));
  return evaluateSortedAutomationAtBeat(sorted, clampedBeat);
}

function evaluateSortedAutomationAtBeat(sorted: AutomationPoint[], beat: number): number {
  if (!sorted.length) return 0.55;
  if (beat <= sorted[0].beat) return sorted[0].value;
  if (beat >= sorted[sorted.length - 1].beat) return sorted[sorted.length - 1].value;
  // First knot at or after the beat; preserves existing duplicate-knot semantics.
  let low = 1, high = sorted.length - 1;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (sorted[mid].beat < beat) low = mid + 1;
    else high = mid;
  }
  const p0 = sorted[low - 1], p1 = sorted[low];
  const t = (beat - p0.beat) / Math.max(0.0001, p1.beat - p0.beat);
  return p0.value + t * (p1.value - p0.value);
}

/**
 * Shared live/export master envelope: values are linear in beat-domain dB.
 * Web Audio gain ramps approximate that curve at <=10ms intervals, including
 * every envelope knot. A bounded live window uses the same evaluation as export.
 */
export function scheduleMasterAutomation(
  param: {
    cancelScheduledValues(time: number): void;
    setValueAtTime(value: number, time: number): void;
    linearRampToValueAtTime(value: number, time: number): void;
  },
  project: TimingProject,
  master: Pick<MasterBusConfig, 'masterVolumeDb' | 'masterAutomationPoints'>,
  fromBeat: number,
  toBeat: number,
  atSeconds: number,
  cancel = true,
): void {
  const points = [...(master.masterAutomationPoints || [])].sort((a,b) => a.beat-b.beat);
  const gain = (beat: number) => {
    const db = master.masterVolumeDb + (evaluateSortedAutomationAtBeat(points, beat) - 0.55) * 8;
    return db <= -48 ? 0 : 10 ** (db / 20);
  };
  if (cancel) param.cancelScheduledValues(atSeconds);
  param.setValueAtTime(gain(fromBeat), atSeconds);
  if (!points?.length || toBeat <= fromBeat) return;

  // Beyond the last knot the envelope is constant, regardless of project length.
  const lastBeat = points[points.length - 1].beat;
  const endBeat = Math.min(toBeat, lastBeat);
  if (endBeat <= fromBeat) return;
  const start = projectSeconds(project, fromBeat);
  const end = projectSeconds(project, endBeat);
  const knots = new Set<number>([end]);
  for (const point of points)
    if (point.beat > fromBeat && point.beat < endBeat)
      knots.add(projectSeconds(project, point.beat));
  for (const point of project.tempoMap || [])
    if (point.beat > fromBeat && point.beat < endBeat)
      knots.add(projectSeconds(project, point.beat));
  // Align samples to project seconds so seek/live and full-export windows agree.
  for (let n = Math.floor(start * 100) + 1; n / 100 < end; n++) knots.add(n / 100);
  for (const seconds of [...knots].sort((a, b) => a - b))
    param.linearRampToValueAtTime(gain(projectBeat(project, seconds)), atSeconds + seconds - start);
}
