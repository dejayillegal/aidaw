import { assertSongPlan } from './songPlanEngine';
import { assertParameterLanes } from './parameterAutomation';
import { assertSidechainRouting } from './sidechainGraph';
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

/** Repairs only missing identities; duplicate identities in one source clip are ambiguous.
 * sourceNoteId/sourceNoteClipId refer to native XML templates, not edited event IDs,
 * and must remain unchanged. IDs in different clips have distinct source scopes.
 */
export function repairProjectNoteIdentities(project: AbletonProjectState): {
  project: AbletonProjectState; repairedNoteCount: number;
} {
  let repairedNoteCount = 0;
  const reserved = new Set<string>();
  for (const track of project.tracks) for (const clips of [track.clips, track.sessionClips || []]) {
    for (const clip of clips) for (const note of clip.notes) if (typeof note.id === 'string' && note.id) reserved.add(note.id);
  }
  const tracks = project.tracks.map(track => {
    const repair = (clips: typeof track.clips, scope: string) => clips.map(clip => {
      const seen = new Set<string>();
      const notes = clip.notes.map((note, index) => {
        if (typeof note.id === 'string' && note.id) {
          if (seen.has(note.id)) throw new Error(`IDENTITY_AMBIGUOUS: ${track.id}/${scope}/${clip.id}/${note.id}`);
          seen.add(note.id); return note;
        }
        if (note.id !== undefined && note.id !== null && note.id !== '') throw new Error('IDENTITY_TYPE: invalid note identity');
        const base = `${clip.id}_n${index}_p${note.pitch}_t${Math.round(note.time * 1000)}`;
        let id = base, suffix = 1;
        while (reserved.has(id)) id = `${base}_${suffix++}`;
        reserved.add(id); seen.add(id); repairedNoteCount++;
        return { ...note, id };
      });
      return { ...clip, notes };
    });
    return { ...track, clips: repair(track.clips, 'arrangement'),
      ...(track.sessionClips ? {sessionClips: repair(track.sessionClips, 'session')} : {}) };
  });
  return { project: repairedNoteCount ? { ...project, tracks } : project, repairedNoteCount };
}

/** Recovery-only preflight. Strict validation runs against temporary unique IDs,
 * so malformed musical fields are rejected before any repair is considered.
 * This does not weaken the public structural or identity validators.
 */
export function migrateLegacyRecoveryNoteIdentities(project: AbletonProjectState, sourceXml: string, legacyEnvelope = false): {
  project: AbletonProjectState; repairedNoteCount: number;
} {
  if (!project || !Array.isArray(project.tracks)) throw new Error('IDENTITY_SHAPE: missing tracks');
  const safe = structuredClone(project);
  for (const track of safe.tracks) {
    if (!track || !Array.isArray(track.clips) || (track.sessionClips !== undefined && !Array.isArray(track.sessionClips))) throw new Error('IDENTITY_SHAPE: invalid clips');
    for (const clips of [track.clips, track.sessionClips || []]) for (const clip of clips) {
      if (!clip || !Array.isArray(clip.notes)) throw new Error('IDENTITY_SHAPE: invalid notes');
      clip.notes = clip.notes.map((note, i) => {
        if (!note || typeof note !== 'object') throw new Error('IDENTITY_SHAPE: invalid note');
        return { ...note, id: `preflight_${i}` };
      });
    }
  }
  assertStructuralProjectState(safe);
  // Identity repair cannot be applied to arbitrary current records or source-less data.
  const result = repairProjectNoteIdentities(project);
  if (result.repairedNoteCount && (!legacyEnvelope || !sourceXml || !sourceXml.includes('<Ableton') || project.identityMigration)) {
    throw new Error('IDENTITY_PROVENANCE: original Ableton source required; repeated identity damage rejected');
  }
  if (result.repairedNoteCount) {
    const doc = new DOMParser().parseFromString(sourceXml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('IDENTITY_PROVENANCE: malformed source XML');
    const identity = (el: Element, attr = 'Id') => el.getAttribute('Data-AIDAW-LogicalId') || el.getAttribute(attr === 'NoteId' ? 'Data-Parametric-NoteId' : 'Data-Parametric-ClipId') || el.getAttribute(attr);
    result.project.tracks = result.project.tracks.map((track, ti) => ({ ...track,
      clips: track.clips.map((clip, ci) => ({ ...clip, notes: clip.notes.map((note, ni) => {
        if (project.tracks[ti].clips[ci].notes[ni].id) return note;
        const sourceTrack = Array.from(doc.querySelectorAll('Tracks > MidiTrack')).find(el => (el.getAttribute('Data-Parametric-TrackId') || el.getAttribute('Id')) === track.id);
        const sourceClip = sourceTrack && Array.from(sourceTrack.querySelectorAll('MidiClip')).filter(el => identity(el) === (note.sourceNoteClipId || clip.sourceClipId || clip.id));
        if (!sourceClip || sourceClip.length !== 1) throw new Error('IDENTITY_PROVENANCE: source clip scope is ambiguous');
        const matches = Array.from(sourceClip[0].querySelectorAll('MidiNoteEvent')).filter(el => note.sourceNoteId
          ? identity(el, 'NoteId') === note.sourceNoteId
          : Number(el.getAttribute('Time')) === note.time && Number(el.getAttribute('Duration')) === note.duration
            && Number(el.getAttribute('Velocity')) === note.velocity
            && Number(el.parentElement?.parentElement?.querySelector('Key')?.getAttribute('Value')) === note.pitch);
        if (matches.length !== 1 || !identity(matches[0], 'NoteId')) throw new Error('IDENTITY_PROVENANCE: source note scope is ambiguous; manual edits retained');
        return { ...note, sourceNoteId: identity(matches[0], 'NoteId')!, sourceNoteClipId: identity(sourceClip[0])! };
      }) })),
    }));
    for (let ti = 0; ti < project.tracks.length; ti++) {
      for (const clip of project.tracks[ti].sessionClips || []) if (clip.notes.some(n => !n.id)) {
        throw new Error('IDENTITY_PROVENANCE: legacy Session identity migration is not supported');
      }
    }
    result.project.identityMigration = { version: 1, repairedNoteCount: result.repairedNoteCount, source: 'preserved-envelope-xml' };
  }
  assertStructuralProjectState(result.project);
  return result;
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
  const layerIds = new Set<string>();
  for (const track of project.tracks) {
    if (!track || typeof track.id !== 'string' || !track.id || trackIds.has(track.id)) {
      fail('duplicate or missing track identity');
    }
    trackIds.add(track.id);
    if (track.parameterAutomation !== undefined) assertParameterLanes(track.parameterAutomation);
    const layer = track.layer;
    if (layer) {
      if (layer.version !== 1 || typeof layer.id !== 'string' || !layer.id || layerIds.has(layer.id) ||
        layer.family !== track.archetype || typeof layer.variant !== 'string' || !layer.variant ||
        !Number.isSafeInteger(layer.seed) || layer.seed < 0 || layer.seed > 0xffffffff ||
        !Number.isFinite(layer.phraseBeats) || layer.phraseBeats <= 0 || layer.phraseBeats > 4096 ||
        !Array.isArray(layer.registerHz) || layer.registerHz.length !== 2 || !layer.registerHz.every(Number.isFinite) ||
        layer.registerHz[0] < 0 || layer.registerHz[1] <= layer.registerHz[0] || layer.registerHz[1] > 24000 ||
        !['legacy-score','procedural-style-v1'].includes(layer.provenance)) fail('invalid or duplicate layer descriptor');
      layerIds.add(layer.id);
    }
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
  assertSidechainRouting(project);
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

