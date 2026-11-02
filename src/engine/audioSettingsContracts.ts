import type { ProjectAudioSettings } from '../types/ableton';
export function assertAudioSettings(value: ProjectAudioSettings): void {
  const fail = (): never => { throw new Error('PROJECT_SETTINGS: invalid audio settings'); };
  const numeric = (object: unknown, keys: string[]) => !!object && keys.every(key => Number.isFinite((object as Record<string, unknown>)[key]));
  if (!value || !numeric(value.humanization, ['microTimingMaxShiftBeats','velocityVariancePct','ghostVelocityMin','ghostVelocityMax','lfoRateHz','lfoDepth','cutoffHz','macroTransition']) ||
      !numeric(value.masterBus, ['masterVolumeDb','glueCompressionDrive','reverbDecaySec','reverbReturnLevel','delayFeedback','delayReturnLevel','subBassMonoCutoffHz']) ||
      !value.transport || !['loopEnabled','metronomeEnabled','followPlayhead','showAutomationLanes'].every(key => typeof (value.transport as unknown as Record<string, unknown>)[key] === 'boolean')) fail();
  const h = value.humanization, m = value.masterBus, t = value.transport;
  if (h.cutoffHz <= 0 || h.microTimingMaxShiftBeats < 0 || h.velocityVariancePct < 0 || h.velocityVariancePct > 1 || h.ghostVelocityMin < 0 || h.ghostVelocityMax > 127 || h.ghostVelocityMin > h.ghostVelocityMax ||
      h.lfoRateHz < 0 || h.lfoDepth < 0 || h.macroTransition < 0 || h.macroTransition > 127 ||
      m.reverbDecaySec < 0 || m.delayFeedback < 0 || m.delayFeedback >= 1 || m.reverbReturnLevel < 0 || m.delayReturnLevel < 0 || m.subBassMonoCutoffHz <= 0 ||
      !Number.isSafeInteger(t.loopStartBar) || t.loopStartBar < 1 || !Number.isSafeInteger(t.loopLengthBars) || t.loopLengthBars < 1) fail();
  if (m.masterAutomationPoints?.some(p => !Number.isFinite(p.beat) || p.beat < 0 || !Number.isFinite(p.value) || p.value < 0 || p.value > 1)) fail();
}
