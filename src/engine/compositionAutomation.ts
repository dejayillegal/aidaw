import type { AbletonTrack, ParameterAutomationLane } from '../types/ableton';
import type { SongPlan } from './songPlanEngine';

/** Original, editable channel-lane material. Never replaces an existing user lane. */
export function createLayerAutomation(plan: SongPlan, track: AbletonTrack): ParameterAutomationLane[] {
  if (!track.layer || track.parameterAutomation?.length || ['kick','rumble','hats','ride','percussion'].includes(track.archetype)) return track.parameterAutomation || [];
  const ceiling = track.archetype === 'acid' ? 6500 : track.archetype === 'pad' ? 3500 : 5500;
  const cutoff: ParameterAutomationLane = {version:1,id:`lane:${track.id}:filterCutoffHz`,target:'filterCutoffHz',enabled:true,points:[]};
  const send: ParameterAutomationLane = {version:1,id:`lane:${track.id}:reverbSend`,target:'reverbSend',enabled:true,points:[]};
  for (const section of plan.sections) {
    const atEnd = section.toBeat - Math.min(.25, (section.toBeat - section.fromBeat) / 2);
    const reduction = ['Breakdown','Reduction'].includes(section.name);
    cutoff.points.push({beat:section.fromBeat,value:180+section.energy*ceiling*.35,curve:'smooth'},
      {beat:atEnd,value:250+section.energy*ceiling,curve:'linear'});
    send.points.push({beat:section.fromBeat,value:reduction?.35:.1,curve:'linear'},
      {beat:atEnd,value:reduction?.5:.18,curve:'linear'});
  }
  return [cutoff,send];
}
