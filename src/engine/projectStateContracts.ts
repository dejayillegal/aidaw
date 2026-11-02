import { assertAudioSettings } from './audioSettingsContracts';
import {
  MAX_SUPPORTED_TIMELINE_BARS,
  validateAndNormalizeMeterMap,
  validateAndNormalizeTempoMap,
} from './timelineCoordinates';
import type { AbletonProjectState } from '../types/ableton';

/** Validates the existing domain; this does not create a second editable model. */
export function assertProjectState(project: AbletonProjectState): void {
  const fail = (message: string): never => { throw new Error(`PROJECT_STATE: ${message}`); };
  if (!project || !Array.isArray(project.tracks) || typeof project.fileName !== 'string') fail('missing project/tracks');
  if (!Number.isFinite(project.tempo) || project.tempo <= 0) fail('invalid tempo');
  if (project.arrangementLengthBars !== undefined && (!Number.isSafeInteger(project.arrangementLengthBars) || project.arrangementLengthBars < 1 || project.arrangementLengthBars > MAX_SUPPORTED_TIMELINE_BARS)) fail('invalid arrangement extent');
  if (project.creationMode !== undefined && project.creationMode !== 'sketch' && project.creationMode !== 'full-track') fail('invalid creation mode');
  if (project.requestedDurationBars !== undefined && (!Number.isSafeInteger(project.requestedDurationBars) || project.requestedDurationBars < 1 || project.requestedDurationBars > MAX_SUPPORTED_TIMELINE_BARS)) fail('invalid requested duration bars');
  if (project.ppq !== undefined && (!Number.isSafeInteger(project.ppq) || project.ppq <= 0)) fail('invalid PPQ resolution');
  if (project.tempoMap !== undefined) {
    if (!Array.isArray(project.tempoMap)) fail('invalid tempoMap');
    try {
      validateAndNormalizeTempoMap(project.tempo, project.tempoMap);
    } catch (err) {
      fail(err instanceof Error ? err.message.replace(/^TIMELINE_INPUT:\s*/, '') : 'invalid tempoMap');
    }
  }
  if (project.meterMap !== undefined) {
    if (!Array.isArray(project.meterMap)) fail('invalid meterMap');
    try {
      validateAndNormalizeMeterMap(project.meterMap);
    } catch (err) {
      fail(err instanceof Error ? err.message.replace(/^TIMELINE_INPUT:\s*/, '') : 'invalid meterMap');
    }
  }
  if (project.audioSettings) assertAudioSettings(project.audioSettings);
  if (project.audioSettings?.transport.arrangementMode==='session' && !project.session) fail('missing Session performance');
  if ([project.generationSeed, project.humanizationSeed].some(seed => seed !== undefined && !Number.isFinite(seed))) fail('invalid generation seed');
  const trackIds = new Set<string>();
  for (const track of project.tracks) {
    if (!track || typeof track.id !== 'string' || !track.id || trackIds.has(track.id)) fail('duplicate or missing track identity');
    trackIds.add(track.id);
    if (!['midi', 'audio'].includes(track.type) || !Array.isArray(track.clips) || !Array.isArray(track.devices)) fail('invalid track');
    if (!track.mixer || !['volumeDb', 'pan', 'transposeSemitones', 'fineTuneCents', 'sidechainDepth', 'reverbSend', 'delaySend', 'filterCutoffHz', 'filterResonance'].every(key => Number.isFinite(track.mixer[key as keyof typeof track.mixer]))) fail(`invalid mixer on ${track.id}`);
    if (track.mixer.pan < -1 || track.mixer.pan > 1) fail('pan outside [-1,1]');
    if (!Array.isArray(track.automationPoints) || track.automationPoints.some(p => !Number.isFinite(p.beat) || p.beat < 0 || !Number.isFinite(p.value) || p.value < 0 || p.value > 1)) fail('invalid normalized energy automation');
    for (const clipList of [track.clips, track.sessionClips || []]) {
    if (!Array.isArray(clipList)) fail('invalid clip list');
    const clipIds = new Set<string>();
    for (const clip of clipList) {
      if (!clip) fail('missing clip');
      if (typeof clip.id !== 'string' || !clip.id || clipIds.has(clip.id)) fail('duplicate or missing clip identity');
      clipIds.add(clip.id);
      if (!Number.isFinite(clip.startTime) || clip.startTime < 0 || !Number.isFinite(clip.length) || clip.length <= 0 || !Array.isArray(clip.notes)) fail('invalid clip extent');
      const noteIds = new Set<string>();
      for (const note of clip.notes) {
        if (typeof note.id !== 'string' || !note.id || noteIds.has(note.id)) fail('duplicate or missing note identity');
        noteIds.add(note.id);
        if (![note.time, note.quantizedTime, note.duration, note.pitch, note.velocity].every(Number.isFinite) || note.duration <= 0 ||
            !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127 || note.velocity < 1 || note.velocity > 127 ||
            (note.probability !== undefined && (!Number.isFinite(note.probability) || note.probability < 0 || note.probability > 1))) fail('invalid MIDI event');
      }
    }
    }
  }
  if (project.session) {
    const { events, quantizationBeats }=project.session;
    if (!Array.isArray(events) || events.length>4096 || !Number.isFinite(quantizationBeats) || quantizationBeats<=0) fail('invalid Session performance');
    const eventIds=new Set<string>();
    for(const event of events) {
      const track=project.tracks.find(t=>t.id===event.trackId);
      if (!track || track.type!=='midi' || typeof event.id!=='string' || !event.id || eventIds.has(event.id) || !Number.isFinite(event.atBeat) || event.atBeat<0 ||
          (event.clipId!==null && !track.sessionClips?.some(c=>c.id===event.clipId && c.notes.length))) fail('invalid Session event target/identity/time');
      eventIds.add(event.id);
    }
  }
  if (project.memoryLocations?.some(p => !Number.isFinite(p.beat ?? ((p.bar ?? 1) - 1) * 4) || (p.beat ?? ((p.bar ?? 1) - 1) * 4) < 0)) fail('invalid locator');
}
