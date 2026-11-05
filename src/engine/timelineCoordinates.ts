import type {
  AbletonMidiClip,
  AbletonProjectState,
  AbletonTrack,
  MeterChangeEvent,
  MidiNoteEvent,
  TempoAutomationPoint,
  TransportConfig,
} from '../types/ableton';
import { evaluateTrackMidiDeviceChain } from './abletonCapabilityMatrix';

/**
 * Canonical integer resolution: 960 ticks per quarter note (PPQ).
 * Divisible by 2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 20, 24, 30, 32, 40, 48, 60, 64, 80, 96, 120, 160, 192, 240, 320, 480.
 */
export const CANONICAL_PPQ = 960;
export const SUPPORTED_PPQ_RESOLUTIONS = [96, 192, 240, 480, 960, 1920, 3840] as const;
export const MAX_SUPPORTED_TIMELINE_BARS = 4096;
export const MAX_SUPPORTED_TICKS = MAX_SUPPORTED_TIMELINE_BARS * 4 * CANONICAL_PPQ;

export function assertValidPpq(ppq: number): void {
  if (
    !Number.isSafeInteger(ppq) ||
    ppq <= 0 ||
    !(SUPPORTED_PPQ_RESOLUTIONS as readonly number[]).includes(ppq)
  ) {
    throw new Error(
      `TIMELINE_INPUT: invalid or unsupported PPQ resolution ${String(ppq)} (supported: ${SUPPORTED_PPQ_RESOLUTIONS.join(', ')})`
    );
  }
}

export function maxSupportedBeatsForMeterMap(meterMap?: MeterChangeEvent[]): number {
  if (!meterMap || meterMap.length === 0) {
    return MAX_SUPPORTED_TIMELINE_BARS * 4;
  }
  const meters = validateAndNormalizeMeterMap(meterMap);
  const last = meters[meters.length - 1];
  const quarterBeatsPerBar = last.numerator * (4 / last.denominator);
  return last.beat + (MAX_SUPPORTED_TIMELINE_BARS + 1 - last.bar) * quarterBeatsPerBar;
}

export function maxSupportedTicksForPpq(
  ppq = CANONICAL_PPQ,
  meterMap?: MeterChangeEvent[]
): number {
  assertValidPpq(ppq);
  const maxBeats = maxSupportedBeatsForMeterMap(meterMap);
  return Math.round(maxBeats * ppq);
}

export function beatsToTicks(
  beats: number,
  ppq = CANONICAL_PPQ,
  meterMap?: MeterChangeEvent[]
): number {
  assertValidPpq(ppq);
  if (!Number.isFinite(beats) || beats < 0) {
    throw new Error('TIMELINE_INPUT: invalid beat or PPQ coordinate');
  }
  const maxTicks = maxSupportedTicksForPpq(ppq, meterMap);
  const rounded = Math.round(beats * ppq);
  if (!Number.isSafeInteger(rounded) || rounded > maxTicks) {
    throw new Error(
      `TIMELINE_INPUT: tick coordinate ${rounded} exceeds maximum supported bound (${maxTicks})`
    );
  }
  return rounded;
}

export function ticksToBeats(
  ticks: number,
  ppq = CANONICAL_PPQ,
  meterMap?: MeterChangeEvent[]
): number {
  assertValidPpq(ppq);
  if (!Number.isFinite(ticks) || ticks < 0) {
    throw new Error('TIMELINE_INPUT: invalid tick or PPQ coordinate');
  }
  const maxTicks = maxSupportedTicksForPpq(ppq, meterMap);
  const rounded = Math.round(ticks);
  if (!Number.isSafeInteger(rounded) || rounded > maxTicks) {
    throw new Error(
      `TIMELINE_INPUT: tick coordinate ${rounded} exceeds maximum supported bound (${maxTicks})`
    );
  }
  return rounded / ppq;
}

/**
 * Explicitly decomposes a floating-point beat coordinate into canonical integer ticks
 * and any sub-tick micro-timing remainder, so callers can choose between exact tick
 * quantization and sub-tick micro-shift preservation.
 */
export function quantizeBeatToCanonicalTick(
  beat: number,
  ppq = CANONICAL_PPQ
): {
  quantizedBeat: number;
  canonicalTicks: number;
  subTickRemainderBeats: number;
  isSubTick: boolean;
} {
  const canonicalTicks = beatsToTicks(beat, ppq);
  const quantizedBeat = canonicalTicks / ppq;
  const subTickRemainderBeats = beat - quantizedBeat;
  const isSubTick = Math.abs(subTickRemainderBeats) > 1e-9;
  return {
    quantizedBeat,
    canonicalTicks,
    subTickRemainderBeats,
    isSubTick,
  };
}

export function snapBeatsToGridTicks(
  beats: number,
  stepBeats: number,
  ppq = CANONICAL_PPQ
): { ticks: number; beats: number; quantizationErrorBeats: number; isExactTick: boolean } {
  assertValidPpq(ppq);
  if (!Number.isFinite(beats) || beats < 0 || !Number.isFinite(stepBeats) || stepBeats <= 0) {
    throw new Error('TIMELINE_INPUT: invalid grid snap coordinates');
  }
  const stepIndex = Math.round(beats / stepBeats);
  const snappedBeats = stepIndex * stepBeats;
  const exactTicks = snappedBeats * ppq;
  const ticks = beatsToTicks(snappedBeats, ppq);
  const quantizationErrorBeats = Math.abs(ticks / ppq - snappedBeats);
  const isExactTick = Math.abs(exactTicks - ticks) <= 1e-9;
  return { ticks, beats: snappedBeats, quantizationErrorBeats, isExactTick };
}

export function validateAndNormalizeMeterMap(meterMap?: MeterChangeEvent[]): MeterChangeEvent[] {
  if (!meterMap || meterMap.length === 0) {
    return [{ bar: 1, beat: 0, numerator: 4, denominator: 4 }];
  }
  const sorted = [...meterMap];
  for (let i = 0; i < sorted.length; i++) {
    const evt = sorted[i];
    if (
      !evt ||
      !Number.isSafeInteger(evt.bar) ||
      evt.bar < 1 ||
      evt.bar > MAX_SUPPORTED_TIMELINE_BARS ||
      !Number.isFinite(evt.beat) ||
      evt.beat < 0 ||
      !Number.isSafeInteger(evt.numerator) ||
      evt.numerator < 1 ||
      evt.numerator > 64 ||
      !Number.isSafeInteger(evt.denominator) ||
      evt.denominator < 1 ||
      evt.denominator > 64 ||
      (evt.denominator & (evt.denominator - 1)) !== 0
    ) {
      throw new Error('TIMELINE_INPUT: invalid meter change event');
    }
    if (i > 0 && (evt.beat <= sorted[i - 1].beat || evt.bar <= sorted[i - 1].bar)) {
      throw new Error('TIMELINE_INPUT: meter map must be strictly increasing');
    }
  }
  if ((sorted[0].bar === 1 && sorted[0].beat !== 0) || (sorted[0].beat === 0 && sorted[0].bar !== 1)) {
    throw new Error('TIMELINE_INPUT: meter map anchor at bar 1 must start at beat 0');
  }
  if (sorted[0].bar > 1) {
    sorted.unshift({ bar: 1, beat: 0, numerator: 4, denominator: 4 });
  }
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const quarterBeatsPerPrevBar = prev.numerator * (4 / prev.denominator);
    const expectedBeat = prev.beat + (curr.bar - prev.bar) * quarterBeatsPerPrevBar;
    if (Math.abs(curr.beat - expectedBeat) > 1e-9) {
      throw new Error(
        `TIMELINE_INPUT: discontinuous meter map anchor at bar ${curr.bar} (expected beat ${expectedBeat}, got ${curr.beat})`
      );
    }
  }
  return sorted;
}

/**
 * Converts a 0-indexed quarter-note beat position into 1-indexed Bar, 1-indexed Beat-in-Bar, and 0-indexed Tick-in-Beat
 * across constant or changing time signatures.
 */
export function beatToBarBeatTick(
  beat: number,
  meterMap?: MeterChangeEvent[],
  ppq = CANONICAL_PPQ
): {
  bar: number;
  beatInBar: number;
  tickInBeat: number;
  totalTicks: number;
  numerator: number;
  denominator: number;
} {
  assertValidPpq(ppq);
  if (!Number.isFinite(beat) || beat < 0) {
    throw new Error('TIMELINE_INPUT: beat must be a finite non-negative number');
  }
  const meters = validateAndNormalizeMeterMap(meterMap);
  const totalTicks = beatsToTicks(beat, ppq, meters);
  let active = meters[0];
  for (const candidate of meters) {
    if (beatsToTicks(candidate.beat, ppq, meters) <= totalTicks) {
      active = candidate;
    } else {
      break;
    }
  }
  const quarterBeatsPerBar = active.numerator * (4 / active.denominator);
  const ticksPerBar = Math.max(1, Math.round(quarterBeatsPerBar * ppq));
  const ticksPerMeterBeat = Math.max(1, Math.round((4 / active.denominator) * ppq));
  const deltaTicks = Math.max(0, totalTicks - beatsToTicks(active.beat, ppq, meters));
  const barOffset = Math.floor(deltaTicks / ticksPerBar);
  const remTicksInBar = deltaTicks - barOffset * ticksPerBar;
  const beatIndexInBar = Math.floor(remTicksInBar / ticksPerMeterBeat);
  const tickInBeat = remTicksInBar - beatIndexInBar * ticksPerMeterBeat;
  const resolvedBar = active.bar + barOffset;
  const resolvedBeatInBar = beatIndexInBar + 1;

  const isExclusiveMaxEndBoundary =
    resolvedBar === MAX_SUPPORTED_TIMELINE_BARS + 1 &&
    resolvedBeatInBar === 1 &&
    tickInBeat === 0;
  if (resolvedBar > MAX_SUPPORTED_TIMELINE_BARS && !isExclusiveMaxEndBoundary) {
    throw new Error(
      `TIMELINE_INPUT: beat ${beat} resolves to bar ${resolvedBar} exceeding maximum supported bar bound (${MAX_SUPPORTED_TIMELINE_BARS})`
    );
  }

  return {
    bar: resolvedBar,
    beatInBar: resolvedBeatInBar,
    tickInBeat,
    totalTicks,
    numerator: active.numerator,
    denominator: active.denominator,
  };
}

/**
 * Converts 1-indexed Bar, 1-indexed Beat-in-Bar, and 0-indexed Tick-in-Beat back to 0-indexed quarter-note beats.
 * Supports the exclusive end boundary of the final supported bar (bar = MAX_SUPPORTED_TIMELINE_BARS + 1, beatInBar = 1, tickInBeat = 0).
 */
export function barBeatTickToBeat(
  bar: number,
  beatInBar = 1,
  tickInBeat = 0,
  meterMap?: MeterChangeEvent[],
  ppq = CANONICAL_PPQ
): number {
  assertValidPpq(ppq);
  const isExclusiveMaxEndBoundary =
    bar === MAX_SUPPORTED_TIMELINE_BARS + 1 && beatInBar === 1 && tickInBeat === 0;
  if (
    !Number.isSafeInteger(bar) ||
    bar < 1 ||
    (bar > MAX_SUPPORTED_TIMELINE_BARS && !isExclusiveMaxEndBoundary) ||
    !Number.isSafeInteger(beatInBar) ||
    beatInBar < 1 ||
    !Number.isSafeInteger(tickInBeat) ||
    tickInBeat < 0
  ) {
    throw new Error('TIMELINE_INPUT: invalid bar/beat/tick coordinates');
  }
  const meters = validateAndNormalizeMeterMap(meterMap);
  let active = meters[0];
  for (const candidate of meters) {
    if (candidate.bar <= bar) {
      active = candidate;
    } else {
      break;
    }
  }
  if (beatInBar > active.numerator) {
    throw new Error('TIMELINE_INPUT: beatInBar exceeds active time signature numerator');
  }
  const quarterBeatsPerMeterBeat = 4 / active.denominator;
  const ticksPerMeterBeat = Math.max(1, Math.round(quarterBeatsPerMeterBeat * ppq));
  if (tickInBeat >= ticksPerMeterBeat) {
    throw new Error(
      `TIMELINE_INPUT: tickInBeat ${tickInBeat} exceeds ticksPerMeterBeat (${ticksPerMeterBeat})`
    );
  }
  const quarterBeatsPerBar = active.numerator * quarterBeatsPerMeterBeat;
  const barBeats = active.beat + (bar - active.bar) * quarterBeatsPerBar;
  const beatOffset = (beatInBar - 1) * quarterBeatsPerMeterBeat;
  const tickBeats = tickInBeat / ppq;
  const totalBeats = barBeats + beatOffset + tickBeats;
  beatsToTicks(totalBeats, ppq, meters);
  return totalBeats;
}

export function validateAndNormalizeTempoMap(
  baseTempo: number,
  tempoMap?: TempoAutomationPoint[]
): TempoAutomationPoint[] {
  if (!Number.isFinite(baseTempo) || baseTempo <= 0) {
    throw new Error('TIMELINE_INPUT: invalid base tempo');
  }
  if (!tempoMap || tempoMap.length === 0) {
    return [{ beat: 0, bpm: baseTempo, curve: 'step' }];
  }
  const sorted = [...tempoMap];
  for (let i = 0; i < sorted.length; i++) {
    const pt = sorted[i];
    if (!pt || !Number.isFinite(pt.beat) || pt.beat < 0 || !Number.isFinite(pt.bpm) || pt.bpm <= 0) {
      throw new Error('TIMELINE_INPUT: invalid tempo map point');
    }
    if (i > 0 && pt.beat <= sorted[i - 1].beat) {
      throw new Error('TIMELINE_INPUT: tempo map beats must be strictly increasing');
    }
  }
  if (sorted[0].beat > 0) {
    sorted.unshift({ beat: 0, bpm: baseTempo, curve: 'step' });
  }
  return sorted;
}

/**
 * Evaluates exact elapsed seconds at a given musical beat across constant, stepped, or piecewise-linear tempo maps.
 * For a beat-linear ramp BPM(b) = B0 + k*(b - b0) where k = (B1 - B0)/(b1 - b0),
 * integrates dt = (60 / BPM(b)) db = (60 / k) * ln(1 + (k * deltaBeats) / B0).
 */
export function beatToSecondsWithTempoMap(
  beat: number,
  baseTempo: number,
  tempoMap?: TempoAutomationPoint[]
): number {
  if (!Number.isFinite(beat) || beat < 0) {
    throw new Error('TIMELINE_INPUT: beat must be finite and non-negative');
  }
  const points = validateAndNormalizeTempoMap(baseTempo, tempoMap);
  if (beat === 0) return 0;

  let elapsedSeconds = 0;
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    if (beat <= curr.beat) break;
    const next = points[i + 1];
    const segEndBeat = next ? Math.min(beat, next.beat) : beat;
    const deltaBeats = segEndBeat - curr.beat;
    if (deltaBeats <= 0) continue;

    if (next && curr.curve === 'linear') {
      const spanBeats = next.beat - curr.beat;
      const slopeBpmPerBeat = (next.bpm - curr.bpm) / spanBeats;
      const relDelta = (slopeBpmPerBeat * deltaBeats) / curr.bpm;
      if (Math.abs(slopeBpmPerBeat) <= 1e-12 || Math.abs(relDelta) <= 1e-12) {
        elapsedSeconds += (deltaBeats * 60) / curr.bpm;
      } else {
        elapsedSeconds += (60 / slopeBpmPerBeat) * Math.log1p(relDelta);
      }
    } else {
      elapsedSeconds += (deltaBeats * 60) / curr.bpm;
    }
  }
  return elapsedSeconds;
}

/**
 * Exact analytic inverse mapping from elapsed seconds to musical beat across a tempo map.
 * For a beat-linear ramp with slope k = (B1 - B0)/(b1 - b0),
 * inverts dt = (60 / k) * ln(BPM(b) / B0) via b(dt) = b0 + (B0 / k) * expm1(k * dt / 60).
 */
export function secondsToBeatWithTempoMap(
  seconds: number,
  baseTempo: number,
  tempoMap?: TempoAutomationPoint[]
): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error('TIMELINE_INPUT: seconds must be finite and non-negative');
  }
  const points = validateAndNormalizeTempoMap(baseTempo, tempoMap);
  if (seconds === 0) return 0;

  let remainingSec = seconds;
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const next = points[i + 1];
    if (!next) {
      return curr.beat + (remainingSec * curr.bpm) / 60;
    }
    const spanBeats = next.beat - curr.beat;
    if (curr.curve === 'linear') {
      const slopeBpmPerBeat = (next.bpm - curr.bpm) / spanBeats;
      const relSpan = ( next.bpm - curr.bpm ) / curr.bpm;
      const segSeconds =
        Math.abs(slopeBpmPerBeat) <= 1e-12 || Math.abs(relSpan) <= 1e-12
          ? (spanBeats * 60) / curr.bpm
          : (60 / slopeBpmPerBeat) * Math.log1p(relSpan);
      if (remainingSec <= segSeconds + 1e-12) {
        const clampedSec = Math.min(remainingSec, segSeconds);
        const exponent = (slopeBpmPerBeat * clampedSec) / 60;
        if (Math.abs(slopeBpmPerBeat) <= 1e-12 || Math.abs(exponent) <= 1e-12) {
          return curr.beat + (clampedSec * curr.bpm) / 60;
        }
        return curr.beat + (curr.bpm / slopeBpmPerBeat) * Math.expm1(exponent);
      }
      remainingSec -= segSeconds;
    } else {
      const segSeconds = (spanBeats * 60) / curr.bpm;
      if (remainingSec <= segSeconds + 1e-12) {
        return curr.beat + (Math.min(remainingSec, segSeconds) * curr.bpm) / 60;
      }
      remainingSec -= segSeconds;
    }
  }
  const last = points[points.length - 1];
  return last.beat + (remainingSec * last.bpm) / 60;
}

export function hasNonConstantTimingMap(
  project: Pick<AbletonProjectState, 'tempo' | 'tempoMap' | 'meterMap'>
): boolean {
  const tempoPoints = validateAndNormalizeTempoMap(project.tempo, project.tempoMap);
  const meterEvents = validateAndNormalizeMeterMap(project.meterMap);
  const hasDynamicTempo = tempoPoints.some((pt) => Math.abs(pt.bpm - project.tempo) > 1e-6);
  const hasNonFourFourMeter = meterEvents.some(
    (evt) => evt.numerator !== 4 || evt.denominator !== 4
  );
  return hasDynamicTempo || hasNonFourFourMeter;
}

export function assertRuntimeTimingMapSupport(
  project: Pick<AbletonProjectState, 'tempo' | 'tempoMap' | 'meterMap'>
): void {
  validateAndNormalizeTempoMap(project.tempo,project.tempoMap);
  validateAndNormalizeMeterMap(project.meterMap);
}

export function noteProbabilityPasses(note: MidiNoteEvent): boolean {
  if (note.probability === undefined || note.probability >= 1) return true;
  if (note.probability <= 0) return false;
  return ((Math.round(note.time * 100) + note.pitch * 17) % 100) / 100 < note.probability;
}

export interface SessionScheduledNote {
  trackId: string;
  eventId: string;
  cycle: number;
  clipId: string;
  periodStart: number;
  periodEnd: number;
  endBeat: number;
  sourceNote: MidiNoteEvent;
  note: MidiNoteEvent;
}

/** Pure projection into the current scheduler window. Does not own a clock or mutate clips. */
export function sessionEventsInWindow(
  project: AbletonProjectState,
  fromBeat: number,
  toBeat: number,
  options?: { evaluateMidiChain?: boolean; includeProbability?: boolean }
): SessionScheduledNote[] {
  if (!Number.isFinite(fromBeat) || !Number.isFinite(toBeat) || fromBeat < 0 || toBeat <= fromBeat) {
    throw new Error('SESSION_RANGE: invalid window');
  }
  const evaluateMidiChain = options?.evaluateMidiChain !== false;
  const result: SessionScheduledNote[] = [];
  let work = 0;
  for (const track of project.tracks) {
    const launches = (project.session?.events || [])
      .filter((e) => e.trackId === track.id)
      .map((event, index) => ({ event, index }))
      .sort((a, b) => a.event.atBeat - b.event.atBeat || a.index - b.index)
      .map((x) => x.event);
    for (let index = 0; index < launches.length; index++) {
      const launch = launches[index];
      const stop = launches[index + 1]?.atBeat ?? Infinity;
      if (!launch.clipId || stop <= fromBeat || launch.atBeat >= toBeat) continue;
      const clip = track.sessionClips?.find((c) => c.id === launch.clipId);
      if (!clip || !(clip.length > 0)) throw new Error('SESSION_TARGET: missing clip');
      const firstCycle = Math.max(0, Math.floor((fromBeat - launch.atBeat) / clip.length));
      const lastCycle = Math.floor((Math.min(toBeat, stop) - launch.atBeat) / clip.length);
      for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
        if (++work > 100000) {
          throw new Error(
            'SESSION_DENSITY: window exceeds 100000 clip/note visits; use a smaller capture range'
          );
        }
        const periodStart = launch.atBeat + cycle * clip.length;
        const periodEnd = Math.min(periodStart + clip.length, stop);
        const sourceMap = new Map<string, MidiNoteEvent>();
        const projectedNotes: MidiNoteEvent[] = [];

        for (const sourceNote of clip.notes) {
          if (++work > 100000) {
            throw new Error(
              'SESSION_DENSITY: window exceeds 100000 clip/note visits; use a smaller capture range'
            );
          }
          if (!noteIsInsideClip(sourceNote, clip)) continue;
          // Match Arrangement: a failed source cannot truncate an earlier
          // arpeggiator group or influence any other generated MIDI event.
          if (options?.includeProbability && !noteProbabilityPasses(sourceNote)) continue;
          const time = periodStart + sourceNote.time - clip.startTime;
          if (time >= stop) continue;
          sourceMap.set(sourceNote.id, sourceNote);
          projectedNotes.push({
            ...sourceNote,
            sourceNoteId: sourceNote.id,
            time,
            quantizedTime: periodStart + sourceNote.quantizedTime - clip.startTime,
            duration: Math.min(sourceNote.duration, stop - time),
          });
        }

        const effectiveNotes = evaluateMidiChain
          ? evaluateTrackMidiDeviceChain(track, projectedNotes, periodStart, periodEnd)
          : projectedNotes;

        for (const effNote of effectiveNotes) {
          if (++work > 100000) {
            throw new Error(
              'SESSION_DENSITY: window exceeds 100000 clip/note visits; use a smaller capture range'
            );
          }
          if (effNote.time < fromBeat || effNote.time >= toBeat || effNote.time >= stop) continue;
          const origSource =
            sourceMap.get(effNote.sourceNoteId || effNote.id) || effNote;
          result.push({
            trackId: track.id,
            eventId: launch.id,
            cycle,
            clipId: clip.id,
            periodStart,
            periodEnd,
            endBeat: stop,
            sourceNote: origSource,
            note: {
              ...effNote,
              duration: Math.min(effNote.duration, stop - effNote.time),
            },
          });
        }
      }
    }
  }
  return result.sort((a, b) => a.note.time - b.note.time || a.trackId.localeCompare(b.trackId));
}

export interface EvaluatedPlayableEvent {
  mode: 'arrangement' | 'session';
  track: AbletonTrack;
  trackId: string;
  clipId: string;
  eventId?: string;
  cycle?: number;
  dedupKey: string;
  sourceNote: MidiNoteEvent;
  note: MidiNoteEvent;
  beat: number;
  durationBeats: number;
  startTimeSeconds: number;
  durationSeconds: number;
  stopBeat?: number;
  stopTimeSeconds?: number;
}

/**
 * Shared event-evaluation boundary for Arrangement clips across live playback, offline WAV export,
 * and deterministic PCM synthesis. Evaluates clip boundary containment, deterministic note probability,
 * MIDI device chain (MidiChord / MidiArpeggiator in chain order), and tempo-dependent seconds mapping.
 */
export function evaluatePlayableArrangementEvents(
  project: AbletonProjectState,
  fromBeat = 0,
  toBeat?: number,
  options?: {
    loopGeneration?: number;
    singleTrackId?: string;
    includeProbability?: boolean;
    evaluateMidiChain?: boolean;
  }
): EvaluatedPlayableEvent[] {
  const maxBeats =
    typeof toBeat === 'number' && Number.isFinite(toBeat)
      ? toBeat
      : MusicalTimeService.arrangementTotalBeats(project, 1);
  if (!Number.isFinite(fromBeat) || fromBeat < 0 || maxBeats < fromBeat) {
    throw new Error('TIMELINE_INPUT: invalid arrangement evaluation window');
  }
  const loopGen = options?.loopGeneration ?? 0;
  const checkProb = options?.includeProbability !== false;
  const evalMidi = options?.evaluateMidiChain !== false;
  const tracks = options?.singleTrackId
    ? project.tracks.filter((t) => t.id === options.singleTrackId)
    : project.tracks;

  const events: EvaluatedPlayableEvent[] = [];
  for (const track of tracks) {
    for (const clip of track.clips || []) {
      if (!Number.isFinite(clip.length) || clip.length <= 0) continue;
      const clipStartBeat = clip.startTime;
      const clipEndBeat = clip.startTime + clip.length;
      if (clipEndBeat <= fromBeat || clipStartBeat >= maxBeats) continue;

      const sourceMap = new Map<string, MidiNoteEvent>();
      const eligibleNotes: MidiNoteEvent[] = [];
      for (const rawNote of clip.notes || []) {
        if (
          !Number.isFinite(rawNote.time) ||
          !Number.isFinite(rawNote.pitch) ||
          !Number.isFinite(rawNote.duration) ||
          !Number.isFinite(rawNote.velocity)
        ) {
          throw new Error('RENDER_NOTE: non-finite note data');
        }
        if (!noteIsInsideClip(rawNote, clip)) continue;
        if (checkProb && !noteProbabilityPasses(rawNote)) continue;
        sourceMap.set(rawNote.id, rawNote);
        eligibleNotes.push(rawNote);
      }

      const effectiveClipEnd = Math.min(maxBeats, clipEndBeat);
      const transformedNotes = evalMidi
        ? evaluateTrackMidiDeviceChain(track, eligibleNotes, clipStartBeat, effectiveClipEnd)
        : eligibleNotes;

      for (const note of transformedNotes) {
        if (note.time < fromBeat || note.time >= maxBeats || note.time >= effectiveClipEnd) {
          continue;
        }
        const sourceNote = sourceMap.get(note.sourceNoteId || note.id) || note;
        const clampedDurationBeats = Math.max(
          1e-6,
          Math.min(note.duration, effectiveClipEnd - note.time)
        );
        const startTimeSeconds = beatToSecondsWithTempoMap(
          note.time,
          project.tempo,
          project.tempoMap
        );
        const durationSeconds = MusicalTimeService.noteDurationSeconds(
          note.time,
          clampedDurationBeats,
          project.tempo,
          project.tempoMap
        );
        events.push({
          mode: 'arrangement',
          track,
          trackId: track.id,
          clipId: clip.id,
          dedupKey: `${loopGen}_${track.id}_${clip.id}_${note.id}`,
          sourceNote,
          note: {
            ...note,
            duration: clampedDurationBeats,
          },
          beat: note.time,
          durationBeats: clampedDurationBeats,
          startTimeSeconds,
          durationSeconds,
        });
      }
    }
  }

  return events.sort(
    (a, b) =>
      a.beat - b.beat ||
      a.trackId.localeCompare(b.trackId) ||
      a.note.pitch - b.note.pitch
  );
}

/**
 * Shared event-evaluation boundary for Session performance windows.
 * Evaluates Session launch quantization, clip loop cycles, retrigger/stop truncation,
 * source note probability, and track MIDI device chain (MidiChord / MidiArpeggiator).
 */
export function evaluatePlayableSessionEvents(
  project: AbletonProjectState,
  fromBeat: number,
  toBeat: number,
  options?: {
    singleTrackId?: string;
    includeProbability?: boolean;
    evaluateMidiChain?: boolean;
  }
): EvaluatedPlayableEvent[] {
  const checkProb = options?.includeProbability !== false;
  const evalMidi = options?.evaluateMidiChain !== false;
  const rawWindowEvents = sessionEventsInWindow(project, fromBeat, toBeat, {
    evaluateMidiChain: evalMidi,
    includeProbability: checkProb,
  });

  const events: EvaluatedPlayableEvent[] = [];
  for (const item of rawWindowEvents) {
    if (options?.singleTrackId && item.trackId !== options.singleTrackId) continue;
    if (checkProb && !noteProbabilityPasses(item.sourceNote)) continue;
    const track = project.tracks.find((t) => t.id === item.trackId);
    if (!track) continue;

    const startTimeSeconds = beatToSecondsWithTempoMap(
      item.note.time,
      project.tempo,
      project.tempoMap
    );
    const durationSeconds = MusicalTimeService.noteDurationSeconds(
      item.note.time,
      item.note.duration,
      project.tempo,
      project.tempoMap
    );
    const stopTimeSeconds = Number.isFinite(item.endBeat)
      ? beatToSecondsWithTempoMap(item.endBeat, project.tempo, project.tempoMap)
      : undefined;

    events.push({
      mode: 'session',
      track,
      trackId: item.trackId,
      clipId: item.clipId,
      eventId: item.eventId,
      cycle: item.cycle,
      dedupKey: `s_${item.note.time}_${item.eventId}_${item.cycle}_${item.note.id}`,
      sourceNote: item.sourceNote,
      note: item.note,
      beat: item.note.time,
      durationBeats: item.note.duration,
      startTimeSeconds,
      durationSeconds,
      stopBeat: item.endBeat,
      stopTimeSeconds,
    });
  }

  return events.sort(
    (a, b) =>
      a.beat - b.beat ||
      a.trackId.localeCompare(b.trackId) ||
      a.note.pitch - b.note.pitch
  );
}

/**
 * Unified playable event evaluation boundary across Arrangement and Session modes.
 */
export function evaluatePlayableProjectEvents(
  project: AbletonProjectState,
  fromBeat = 0,
  toBeat?: number,
  options?: {
    mode?: 'arrangement' | 'session';
    loopGeneration?: number;
    singleTrackId?: string;
    includeProbability?: boolean;
    evaluateMidiChain?: boolean;
  }
): EvaluatedPlayableEvent[] {
  const effectiveMode =
    options?.mode ??
    (project.audioSettings?.transport.arrangementMode === 'session'
      ? 'session'
      : 'arrangement');
  if (effectiveMode === 'session') {
    const endBeat =
      typeof toBeat === 'number' && Number.isFinite(toBeat)
        ? toBeat
        : MusicalTimeService.arrangementTotalBeats(project, 1);
    return evaluatePlayableSessionEvents(project, fromBeat, endBeat, options);
  }
  return evaluatePlayableArrangementEvents(project, fromBeat, toBeat, options);
}

/** Compatibility boundary for the existing absolute-beat domain. No second clock or stored time state. */
/** Shared Arrangement/Piano Roll window in bars, projected to quarter-note beats. */
export function musicalBarViewport(beat: number,totalBars: number,visibleBars: number,scrollBar: number,follow: boolean,meterMap?: MeterChangeEvent[],ppq=CANONICAL_PPQ) {
  const count=Math.max(1,Math.min(totalBars,Math.round(visibleBars)));
  const maxStart=Math.max(0,totalBars-count);
  const currentBar=beatToBarBeatTick(Math.max(0,beat),meterMap,ppq).bar-1;
  const startBar=Math.max(0,Math.min(maxStart,follow?Math.floor(currentBar/count)*count:Math.floor(scrollBar)));
  const startBeat=barBeatTickToBeat(startBar+1,1,0,meterMap,ppq);
  const endBeat=barBeatTickToBeat(startBar+count+1,1,0,meterMap,ppq);
  return {startBar,startBeat,endBeat,visibleBeats:endBeat-startBeat};
}

export function noteIsInsideClip(note: MidiNoteEvent, clip: AbletonMidiClip): boolean {
  return Number.isFinite(note.time) && clip.length > 0 && note.time >= clip.startTime && note.time < clip.startTime + clip.length;
}

export function playbackRegion(
  totalBeats: number,
  transport: Pick<TransportConfig, 'loopEnabled' | 'loopStartBar' | 'loopLengthBars'>,
  meterMap?: MeterChangeEvent[]
) {
  if (!Number.isFinite(totalBeats) || totalBeats <= 0) throw new Error('TIMELINE_INPUT: invalid extent');
  let start: number;
  let end: number;
  if (
    Number.isSafeInteger(transport.loopStartBar) &&
    transport.loopStartBar >= 1 &&
    transport.loopStartBar <= MAX_SUPPORTED_TIMELINE_BARS &&
    Number.isSafeInteger(transport.loopLengthBars) &&
    transport.loopLengthBars >= 1
  ) {
    start = Math.max(0, barBeatTickToBeat(transport.loopStartBar, 1, 0, meterMap));
    const endBar = Math.min(
      MAX_SUPPORTED_TIMELINE_BARS + 1,
      transport.loopStartBar + transport.loopLengthBars
    );
    end = Math.min(totalBeats, barBeatTickToBeat(endBar, 1, 0, meterMap));
  } else {
    if (meterMap && meterMap.length > 0) {
      validateAndNormalizeMeterMap(meterMap);
    }
    start = Math.max(0, (transport.loopStartBar - 1) * 4);
    end = Math.min(totalBeats, start + transport.loopLengthBars * 4);
  }
  const enabled = transport.loopEnabled && Number.isFinite(start) && Number.isFinite(end) && end > start;
  return { start, end, span: enabled ? end - start : 0, enabled };
}

export function positionAtBeat(rawBeat: number, totalBeats: number, region: ReturnType<typeof playbackRegion>): number {
  if (region.enabled && rawBeat >= region.end) return region.start + ((rawBeat - region.start) % region.span);
  return Math.max(0, Math.min(totalBeats, rawBeat));
}

/**
 * Unified MusicalTimeService consumed across timeline/ruler/playhead, arrangement extent,
 * loop boundaries, transport seek/follow, note duration conversion, automation domain clamping,
 * Session launch quantization, and offline render duration.
 */
export const MusicalTimeService = {
  canonicalPpq: CANONICAL_PPQ,
  supportedPpqResolutions: SUPPORTED_PPQ_RESOLUTIONS,
  maxSupportedBars: MAX_SUPPORTED_TIMELINE_BARS,

  /** Number of whole meter-aware bars covering an exclusive end beat. */
  barsCoveringBeat(endBeat: number, meterMap?: MeterChangeEvent[], ppq = CANONICAL_PPQ): number {
    const end = beatToBarBeatTick(endBeat, meterMap, ppq);
    const start = barBeatTickToBeat(end.bar, 1, 0, meterMap, ppq);
    return Math.max(0, end.bar - (endBeat <= start + 1e-9 ? 1 : 0));
  },

  barsToBeats(
    bars: number,
    startBar = 1,
    meterMap?: MeterChangeEvent[],
    ppq = CANONICAL_PPQ
  ): number {
    if (!Number.isFinite(bars) || bars < 0) {
      throw new Error('TIMELINE_INPUT: bars must be a finite non-negative number');
    }
    if (bars === 0) return 0;
    const clampedStart = Math.max(1, Math.min(MAX_SUPPORTED_TIMELINE_BARS, Math.floor(startBar)));
    const clampedEnd = Math.min(
      MAX_SUPPORTED_TIMELINE_BARS + 1,
      clampedStart + Math.round(bars)
    );
    const startBeat = barBeatTickToBeat(clampedStart, 1, 0, meterMap, ppq);
    const endBeat = barBeatTickToBeat(clampedEnd, 1, 0, meterMap, ppq);
    return Math.max(0, endBeat - startBeat);
  },

  arrangementTotalBeats(
    project: Pick<
      AbletonProjectState,
      'arrangementLengthBars' | 'audioSettings' | 'tracks' | 'meterMap' | 'ppq'
    >,
    minBars = 1,
    includeClipExtent = false
  ): number {
    const ppq = project.ppq || CANONICAL_PPQ;
    const rawDeclaredBars =
      project.arrangementLengthBars ||
      project.audioSettings?.transport?.arrangementLengthBars ||
      16;
    const declaredBars = Math.max(minBars, rawDeclaredBars);
    const declaredBeats = this.barsToBeats(declaredBars, 1, project.meterMap, ppq);
    let maxClipEndBeat = 0;
    if (includeClipExtent) {
      for (const track of project.tracks || []) {
        for (const clip of track.clips || []) {
          const endBeat = (clip.startTime || 0) + (clip.length || 0);
          if (endBeat > maxClipEndBeat) {
            maxClipEndBeat = endBeat;
          }
        }
      }
    }
    const maxSupportedBeats = barBeatTickToBeat(
      MAX_SUPPORTED_TIMELINE_BARS + 1,
      1,
      0,
      project.meterMap,
      ppq
    );
    return Math.min(maxSupportedBeats, Math.max(declaredBeats, maxClipEndBeat));
  },

  arrangementDurationSeconds(
    project: Pick<
      AbletonProjectState,
      | 'tempo'
      | 'tempoMap'
      | 'meterMap'
      | 'arrangementLengthBars'
      | 'audioSettings'
      | 'tracks'
      | 'ppq'
    >,
    totalBeatsOverride?: number,
    tailSeconds = 0
  ): number {
    const totalBeats =
      typeof totalBeatsOverride === 'number' && Number.isFinite(totalBeatsOverride)
        ? totalBeatsOverride
        : this.arrangementTotalBeats(project);
    const musicalSeconds = beatToSecondsWithTempoMap(totalBeats, project.tempo, project.tempoMap);
    return musicalSeconds + Math.max(0, tailSeconds);
  },

  noteDurationSeconds(
    startBeat: number,
    durationBeats: number,
    baseTempo: number,
    tempoMap?: TempoAutomationPoint[]
  ): number {
    const safeStart = Math.max(0, startBeat);
    const safeEnd = Math.max(safeStart + 1e-6, safeStart + Math.max(1e-6, durationBeats));
    return Math.max(
      1e-4,
      beatToSecondsWithTempoMap(safeEnd, baseTempo, tempoMap) -
        beatToSecondsWithTempoMap(safeStart, baseTempo, tempoMap)
    );
  },

  clampBeatToArrangement(beat: number, totalBeats: number): number {
    if (!Number.isFinite(beat) || !Number.isFinite(totalBeats) || totalBeats <= 0) {
      throw new Error('TIMELINE_INPUT: invalid beat or arrangement extent');
    }
    return Math.max(0, Math.min(totalBeats, beat));
  },

  quantizeSessionLaunchBeat(
    currentBeat: number,
    quantizationBeats: number,
    ppq = CANONICAL_PPQ
  ): number {
    assertValidPpq(ppq);
    if (!Number.isFinite(currentBeat) || currentBeat < 0) {
      throw new Error('TIMELINE_INPUT: invalid currentBeat for Session quantization');
    }
    if (!Number.isFinite(quantizationBeats) || quantizationBeats <= 0) {
      return quantizeBeatToCanonicalTick(currentBeat, ppq).quantizedBeat;
    }
    const nextSlot = Math.ceil((currentBeat - 1e-9) / quantizationBeats) * quantizationBeats;
    return quantizeBeatToCanonicalTick(Math.max(0, nextSlot), ppq).quantizedBeat;
  },

  formatBarBeatTick(
    beat: number,
    meterMap?: MeterChangeEvent[],
    ppq = CANONICAL_PPQ
  ): string {
    const coord = beatToBarBeatTick(beat, meterMap, ppq);
    return `${coord.bar}.${coord.beatInBar}.${ String(coord.tickInBeat).padStart(3, '0') }`;
  },
};



