import type { HumanizationConfig, MasterBusConfig, TransportConfig, AbletonProjectState, ProjectAudioSettings } from '../types/ableton';

export const DEFAULT_HUMANIZATION: HumanizationConfig = {
  microTimingMaxShiftBeats: 0.015,
  swingStrength: 0,
  shuffleSwing: 0,
  velocityVariancePct: 0.08,
  ghostVelocityMin: 20,
  ghostVelocityMax: 45,
  lfoRateHz: 0.1,
  lfoDepth: 0.42,
  cutoffHz: 145.0,
  macroTransition: 42,
};

export const DEFAULT_TRANSPORT: TransportConfig = {
  loopEnabled: true,
  loopStartBar: 1,
  loopLengthBars: 4,
  arrangementLengthBars: 16,
  metronomeEnabled: false,
  followPlayhead: true,
  showAutomationLanes: false,
};

export const DEFAULT_MASTER_BUS: MasterBusConfig = {
  masterVolumeDb: 0,
  glueCompressionDrive: 0.35,
  reverbDecaySec: 3.2,
  reverbReturnLevel: 0.45,
  delayFeedback: 0.42,
  delayReturnLevel: 0.4,
  subBassMonoCutoffHz: 120,
  limiterCeilingDbtp: -1.0,
  limiterReleaseMs: 85,
  limiterLookaheadMs: 4,
  targetIntegratedLufs: -14.0,
  masterAutomationPoints: [
    { beat: 0, value: 0.55 },
    { beat: 32, value: 0.52 },
    { beat: 48, value: 0.55 },
    { beat: 64, value: 0.55 },
  ],
};

export function projectAudioSettings(project: AbletonProjectState): ProjectAudioSettings {
  return project.audioSettings || {
    humanization: structuredClone(DEFAULT_HUMANIZATION), masterBus: structuredClone(DEFAULT_MASTER_BUS),
    transport: Object.fromEntries(Object.entries(DEFAULT_TRANSPORT).filter(([key]) => key !== 'arrangementLengthBars')) as TransportConfig,
  };
}
