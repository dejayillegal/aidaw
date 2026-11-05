import { describe, expect, it } from 'vitest';
import { evaluateParameterLane, scheduleParameterLane, assertParameterLanes } from '../engine/parameterAutomation';
import type { ParameterAutomationLane } from '../types/ableton';
const lane: ParameterAutomationLane = { id: 'cutoff', version: 1, target: 'filterCutoffHz', enabled: true,
  points: [{ beat: 0, value: 200, curve: 'linear' }, { beat: 4, value: 1800, curve: 'linear' }] };
describe('executable target-addressed parameter automation', () => {
  it('evaluates linear, exponential and smooth curves in parameter units', () => {
    expect(evaluateParameterLane(lane, 2)).toBe(1000);
    expect(evaluateParameterLane({ ...lane, points: [{ beat: 0, value: 200, curve: 'exponential' }, { beat: 4, value: 1800 }] }, 2)).toBeCloseTo(600);
    expect(evaluateParameterLane({ ...lane, points: [{ beat: 0, value: 200, curve: 'smooth' }, { beat: 4, value: 1800 }] }, 1)).toBe(450);
  });
  it('reanchors at the requested seek value and preserves beat-domain curves across tempo maps', () => {
    const events: [string, number, number][] = [];
    const param = { cancelScheduledValues: (t: number) => events.push(['cancel', 0, t]),
      setValueAtTime: (v: number, t: number) => events.push(['set', v, t]),
      linearRampToValueAtTime: (v: number, t: number) => events.push(['ramp', v, t]) };
    scheduleParameterLane(param, lane, { tempo: 120, tempoMap: [{ beat: 0, bpm: 120, curve: 'step' }, { beat: 2, bpm: 60, curve: 'step' }] }, 2, 4, 10);
    expect(events[1]).toEqual(['set', 1000, 10]);
    expect(events.at(-1)).toEqual(['ramp', 1800, 12]);
    expect(events.every(([, , t]) => t >= 10 && t <= 12)).toBe(true);
  });
  it('rejects unsupported versions, duplicate target owners and invalid values', () => {
    expect(() => assertParameterLanes([lane, { ...lane, id: 'second' }])).toThrow('AUTOMATION');
    expect(() => assertParameterLanes([{ ...lane, points: [{ beat: 0, value: -2 }] }])).toThrow('AUTOMATION');
    expect(() => assertParameterLanes([{ ...lane, version: 9 } as unknown as ParameterAutomationLane])).toThrow('AUTOMATION');
  });
});
