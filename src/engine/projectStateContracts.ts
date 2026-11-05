import { assertSongPlan } from './songPlanEngine';
import { assertAudioSettings } from './audioSettingsContracts';
import {
  classifyAbletonDeviceTag,
  CURRENT_DEVICE_CONVERSION_VERSION,
  verifyDeviceConversionRecord,
} from './abletonCapabilityMatrix';
import {
  assertValidPpq,
  MAX_SUPPORTED_TIMELINE_BARS,
  validateAndNormalizeMeterMap,
  validateAndNormalizeTempoMap,
} from './timelineCoordinates';
import type { AbletonProjectState } from '../types/ableton';

/**
 * Deterministically repairs missing or duplicate note identities across all tracks and clips,
 * guaranteeing stable, unique IDs without altering pitch, timing, velocity, duration,
 * probability, or clip ownership.
 */
export function repairProjectNoteIdentities(project: AbletonProjectState): {
  project: AbletonProjectState;
  repairedNoteCount: number;
} {
  if (!project || !Array.isArray(project.tracks)) {
    return { project, repairedNoteCount: 0 };
  }

  let repairedNoteCount = 0;
  const projectNoteIds = new Set<string>();

  const updatedTracks = project.tracks.map((track) => {
    const updatedClips = (track.clips || []).map((clip) => {
      const clipNoteIds = new Set<string>();
      const updatedNotes = (clip.notes || []).map((note, idx) => {
        const needsRepair =
          !note.id ||
          typeof note.id !== 'string' ||
          clipNoteIds.has(note.id) ||
          projectNoteIds.has(note.id);

        let finalId = note.id;
        if (needsRepair) {
          repairedNoteCount++;
          finalId = `${clip.id}_n${idx}_p${note.pitch}_t${Math.round(note.time * 1000)}`;
          let suffix = 1;
          while (projectNoteIds.has(finalId) || clipNoteIds.has(finalId)) {
            finalId = `${clip.id}_n${idx}_p${note.pitch}_t${Math.round(note.time * 1000)}_${suffix++}`;
          }
        }

        clipNoteIds.add(finalId);
        projectNoteIds.add(finalId);

        return needsRepair ? { ...note, id: finalId } : note;
      });

      return { ...clip, notes: updatedNotes };
    });

    const updatedSessionClips = (track.sessionClips || []).map((clip) => {
      const clipNoteIds = new Set<string>();
      const updatedNotes = (clip.notes || []).map((note, idx) => {
        const needsRepair =
          !note.id ||
          typeof note.id !== 'string' ||
          clipNoteIds.has(note.id) ||
          projectNoteIds.has(note.id);

        let finalId = note.id;
        if (needsRepair) {
          repairedNoteCount++;
          finalId = `${clip.id}_n${idx}_p${note.pitch}_t${Math.round(note.time * 1000)}`;
          let suffix = 1;
          while (projectNoteIds.has(finalId) || clipNoteIds.has(finalId)) {
            finalId = `${clip.id}_n${idx}_p${note.pitch}_t${Math.round(note.time * 1000)}_${suffix++}`;
          }
        }

        clipNoteIds.add(finalId);
        projectNoteIds.add(finalId);

        return needsRepair ? { ...note, id: finalId } : note;
      });

      return { ...clip, notes: updatedNotes };
    });

    return { ...track, clips: updatedClips, sessionClips: updatedSessionClips };
  });

  return {
    project: { ...project, tracks: updatedTracks },
    repairedNoteCount,
  };
}

/**
 * Validates the structural project shape, track/clip/note identities, timing maps,
 * Session performance contract, and source device parameters BEFORE conversion record validation.
 */
export function assertStructuralProjectState(project: AbletonProjectState): void {
  const fail = (message: string): never => {
    throw new Error(`PROJECT_STATE: ${message}`);
  };
  if (!project || !Array.isArray(project.tracks) || typeof project.fileName !== 'string') {
    fail('missing project/tracks');
  }
  if (!Number.isFinite(project.tempo) || project.tempo <= 0) fail('invalid tempo');
  if (
    project.arrangementLengthBars !== undefined &&
    (!Number.isSafeInteger(project.arrangementLengthBars) ||
      project.arrangementLengthBars < 1 ||
      project.arrangementLengthBars > MAX_SUPPORTED_TIMELINE_BARS)
  ) {
    fail('invalid arrangement extent');
  }
  if (
    project.creationMode !== undefined &&
    project.creationMode !== 'sketch' &&
    project.creationMode !== 'full-track'
  ) {
    fail('invalid creation mode');
  }
  if (
    project.requestedDurationBars !== undefined &&
    (!Number.isSafeInteger(project.requestedDurationBars) ||
      project.requestedDurationBars < 1 ||
      project.requestedDurationBars > MAX_SUPPORTED_TIMELINE_BARS)
  ) {
    fail('invalid requested duration bars');
  }
  if (project.songPlan) assertSongPlan(project.songPlan);
  if (project.ppq !== undefined) {
    try {
      assertValidPpq(project.ppq);
    } catch (err) {
      fail(err instanceof Error ? err.message.replace(/^TIMELINE_INPUT:\s*/, '') : 'invalid PPQ resolution');
    }
  }
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
  if (project.audioSettings?.transport.arrangementMode === 'session' && !project.session) {
    fail('missing Session performance');
  }
  if (
    [project.generationSeed, project.humanizationSeed].some(
      (seed) => seed !== undefined && !Number.isFinite(seed)
    )
  ) {
    fail('invalid generation seed');
  }

  const trackIds = new Set<string>();
  for (const track of project.tracks) {
    if (!track || typeof track.id !== 'string' || !track.id || trackIds.has(track.id)) {
      fail('duplicate or missing track identity');
    }
    trackIds.add(track.id);
    if (
      !['midi', 'audio'].includes(track.type) ||
      !Array.isArray(track.clips) ||
      !Array.isArray(track.devices)
    ) {
      fail('invalid track');
    }
    const devIds = new Set<string>();
    for (const dev of track.devices) {
      if (
        !dev ||
        typeof dev.id !== 'string' ||
        !dev.id ||
        devIds.has(dev.id) ||
        typeof dev.xmlTag !== 'string' ||
        !dev.xmlTag ||
        !Array.isArray(dev.parameters)
      ) {
        fail(`invalid device on ${track.id}`);
      }
      devIds.add(dev.id);
      for (const param of dev.parameters) {
        if (
          !param ||
          typeof param.name !== 'string' ||
          !param.name.trim() ||
          (typeof param.value !== 'string' &&
            (typeof param.value !== 'number' || !Number.isFinite(param.value)))
        ) {
          fail(`invalid device parameter on ${track.id}/${dev.id}`);
        }
      }
    }
    if (
      !track.mixer ||
      ![
        'volumeDb',
        'pan',
        'transposeSemitones',
        'fineTuneCents',
        'sidechainDepth',
        'reverbSend',
        'delaySend',
        'filterCutoffHz',
        'filterResonance',
      ].every((key) => Number.isFinite(track.mixer[key as keyof typeof track.mixer]))
    ) {
      fail(`invalid mixer on ${track.id}`);
    }
    if (track.mixer.pan < -1 || track.mixer.pan > 1) fail('pan outside [-1,1]');
    if (
      !Array.isArray(track.automationPoints) ||
      track.automationPoints.some(
        (p) =>
          !Number.isFinite(p.beat) ||
          p.beat < 0 ||
          !Number.isFinite(p.value) ||
          p.value < 0 ||
          p.value > 1
      )
    ) {
      fail('invalid normalized energy automation');
    }
    for (const clipList of [track.clips, track.sessionClips || []]) {
      if (!Array.isArray(clipList)) fail('invalid clip list');
      const clipIds = new Set<string>();
      for (const clip of clipList) {
        if (!clip) fail('missing clip');
        if (typeof clip.id !== 'string' || !clip.id || clipIds.has(clip.id)) {
          fail('duplicate or missing clip identity');
        }
        clipIds.add(clip.id);
        if (
          !Number.isFinite(clip.startTime) ||
          clip.startTime < 0 ||
          !Number.isFinite(clip.length) ||
          clip.length <= 0 ||
          !Array.isArray(clip.notes)
        ) {
          fail('invalid clip extent');
        }
        const noteIds = new Set<string>();
        for (const note of clip.notes) {
          if (typeof note.id !== 'string' || !note.id || noteIds.has(note.id)) {
            fail('duplicate or missing note identity');
          }
          noteIds.add(note.id);
          if(note.harmonicOwner!==undefined&&note.harmonicOwner!=='voiced-midi')fail('invalid harmonic owner');
          if (
            ![note.time, note.quantizedTime, note.duration, note.pitch, note.velocity].every(
              Number.isFinite
            ) ||
            note.duration <= 0 ||
            !Number.isInteger(note.pitch) ||
            note.pitch < 0 ||
            note.pitch > 127 ||
            note.velocity < 1 ||
            note.velocity > 127 ||
            (note.probability !== undefined &&
              (!Number.isFinite(note.probability) ||
                note.probability < 0 ||
                note.probability > 1))
          ) {
            fail('invalid MIDI event');
          }
        }
      }
    }
  }
  if (project.session) {
    const { events, quantizationBeats } = project.session;
    if (
      !Array.isArray(events) ||
      events.length > 4096 ||
      !Number.isFinite(quantizationBeats) ||
      quantizationBeats <= 0
    ) {
      fail('invalid Session performance');
    }
    const eventIds = new Set<string>();
    for (const event of events) {
      const track = project.tracks.find((t) => t.id === event.trackId);
      if (
        !track ||
        track.type !== 'midi' ||
        typeof event.id !== 'string' ||
        !event.id ||
        eventIds.has(event.id) ||
        !Number.isFinite(event.atBeat) ||
        event.atBeat < 0 ||
        (event.clipId !== null &&
          !track.sessionClips?.some((c) => c.id === event.clipId && c.notes.length))
      ) {
        fail('invalid Session event target/identity/time');
      }
      eventIds.add(event.id);
    }
  }
  if (
    project.memoryLocations?.some(
      (p) =>
        !Number.isFinite(p.beat ?? ((p.bar ?? 1) - 1) * 4) ||
        (p.beat ?? ((p.bar ?? 1) - 1) * 4) < 0
    )
  ) {
    fail('invalid locator');
  }
}

/**
 * Validates device support classification, future conversion versions, and per-device
 * conversion records across all tracks in the project.
 */
export function assertProjectConversionState(project: AbletonProjectState): void {
  const fail = (message: string): never => {
    throw new Error(`PROJECT_STATE: ${message}`);
  };
  for (const track of project.tracks) {
    for (const dev of track.devices) {
      if (
        dev.conversionRecord &&
        typeof dev.conversionRecord.conversionVersion === 'number' &&
        dev.conversionRecord.conversionVersion > CURRENT_DEVICE_CONVERSION_VERSION
      ) {
        fail(
          `FUTURE_CONVERSION_VERSION: Unsupported future conversionVersion ${dev.conversionRecord.conversionVersion} on <${dev.xmlTag}> (${dev.id})`
        );
      }
      if (!dev.bypassed) {
        const supportClass = classifyAbletonDeviceTag(dev.xmlTag);
        if (supportClass === 'unsupported' && !dev.isUserCreated && !dev.browserDspSupported) {
          fail(
            `UNSUPPORTED_DEVICE: ${track.name} contains unsupported device <${dev.xmlTag}> (${dev.id})`
          );
        }
        const convCheck = verifyDeviceConversionRecord(dev);
        if (!convCheck.isValid) {
          fail(`CONVERSION_REQUIRED: ${convCheck.reason}`);
        }
      }
    }
  }
}

/** Validates the existing domain; this does not create a second editable model. */
export function assertProjectState(project: AbletonProjectState): void {
  assertStructuralProjectState(project);
  assertProjectConversionState(project);
}

