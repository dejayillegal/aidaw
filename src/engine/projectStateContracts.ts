import { assertAudioSettings } from './audioSettingsContracts';
import type { AbletonProjectState } from '../types/ableton';

/** Validates the existing domain; this does not create a second editable model. */
export function assertProjectState(project: AbletonProjectState): void {
  const fail = (message: string): never => { throw new Error(`PROJECT_STATE: ${message}`); };
  if (!project || !Array.isArray(project.tracks) || typeof project.fileName !== 'string') fail('missing project/tracks');
  if (!Number.isFinite(project.tempo) || project.tempo <= 0) fail('invalid tempo');
  if (project.arrangementLengthBars !== undefined && (!Number.isSafeInteger(project.arrangementLengthBars) || project.arrangementLengthBars < 1)) fail('invalid arrangement extent');
  if (project.audioSettings) assertAudioSettings(project.audioSettings);
  if ([project.generationSeed, project.humanizationSeed].some(seed => seed !== undefined && !Number.isFinite(seed))) fail('invalid generation seed');
  const trackIds = new Set<string>();
  for (const track of project.tracks) {
    if (!track || typeof track.id !== 'string' || !track.id || trackIds.has(track.id)) fail('duplicate or missing track identity');
    trackIds.add(track.id);
    if (!['midi', 'audio'].includes(track.type) || !Array.isArray(track.clips) || !Array.isArray(track.devices)) fail('invalid track');
    if (!track.mixer || !['volumeDb', 'pan', 'transposeSemitones', 'fineTuneCents', 'sidechainDepth', 'reverbSend', 'delaySend', 'filterCutoffHz', 'filterResonance'].every(key => Number.isFinite(track.mixer[key as keyof typeof track.mixer]))) fail(`invalid mixer on ${track.id}`);
    if (track.mixer.pan < -1 || track.mixer.pan > 1) fail('pan outside [-1,1]');
    if (!Array.isArray(track.automationPoints) || track.automationPoints.some(p => !Number.isFinite(p.beat) || p.beat < 0 || !Number.isFinite(p.value) || p.value < 0 || p.value > 1)) fail('invalid normalized energy automation');
    const clipIds = new Set<string>();
    for (const clip of track.clips) {
      if (typeof clip.id !== 'string' || !clip.id || clipIds.has(clip.id)) fail('duplicate or missing clip identity');
      clipIds.add(clip.id);
      if (!Number.isFinite(clip.startTime) || clip.startTime < 0 || !Number.isFinite(clip.length) || clip.length <= 0 || !Array.isArray(clip.notes)) fail('invalid clip extent');
      for (const note of clip.notes) {
        if (![note.time, note.quantizedTime, note.duration, note.pitch, note.velocity].every(Number.isFinite) || note.duration <= 0 ||
            !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127 || note.velocity < 1 || note.velocity > 127 ||
            (note.probability !== undefined && (!Number.isFinite(note.probability) || note.probability < 0 || note.probability > 1))) fail('invalid MIDI event');
      }
    }
  }
  if (project.memoryLocations?.some(p => !Number.isFinite(p.beat ?? ((p.bar ?? 1) - 1) * 4) || (p.beat ?? ((p.bar ?? 1) - 1) * 4) < 0)) fail('invalid locator');
}
