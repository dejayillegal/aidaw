import type {
  AbletonMidiClip,
  AbletonProjectState,
  MeterChangeEvent,
  MidiNoteEvent,
  TempoAutomationPoint,
  TransportConfig,
} from '../types/ableton';

/**
 * Canonical integer resolution: 960 ticks per quarter note (PPQ).
 * Divisible by 2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 20, 24, 30, 32, 40, 48, 60, 64, 80, 96, 120, 160, 192, 240, 320, 480.
 */
export const CANONICAL_PPQ = 960;
export const MAX_SUPPORTED_TIMELINE_BARS = 4096;
export const MAX_SUPPORTED_TICKS = MAX_SUPPORTED_TIMELINE_BARS * 4 * CANONICAL_PPQ;

export function beatsToTicks(beats: number, ppq = CANONICAL_PPQ): number {
  if (!Number.isFinite(beats) || beats < 0 || !Number.isSafeInteger(ppq) || ppq <= 0) {
    throw new Error('TIMELINE_INPUT: invalid beat or PPQ coordinate');
  }
  const rounded = Math.round(beats * ppq);
  if (!Number.isSafeInteger(rounded) || rounded > MAX_SUPPORTED_TICKS) {
    throw new Error(`TIMELINE_INPUT: tick coordinate ${rounded} exceeds maximum supported bound (${MAX_SUPPORTED_TICKS})`);
  }
  return rounded;
}

export function ticksToBeats(ticks: number, ppq = CANONICAL_PPQ): number {
  if (!Number.isFinite(ticks) || ticks < 0 || !Number.isSafeInteger(ppq) || ppq <= 0) {
    throw new Error('TIMELINE_INPUT: invalid tick or PPQ coordinate');
  }
  const rounded = Math.round(ticks);
  if (!Number.isSafeInteger(rounded) || rounded > MAX_SUPPORTED_TICKS) {
    throw new Error(`TIMELINE_INPUT: tick coordinate ${rounded} exceeds maximum supported bound (${MAX_SUPPORTED_TICKS})`);
  }
  return rounded / ppq;
}

export function snapBeatsToGridTicks(
  beats: number,
  stepBeats: number,
  ppq = CANONICAL_PPQ
): { ticks: number; beats: number; quantizationErrorBeats: number; isExactTick: boolean } {
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
  if (!Number.isFinite(beat) || beat < 0) {
    throw new Error('TIMELINE_INPUT: beat must be a finite non-negative number');
  }
  const totalTicks = beatsToTicks(beat, ppq);
  const meters = validateAndNormalizeMeterMap(meterMap);
  let active = meters[0];
  for (const candidate of meters) {
    if (beatsToTicks(candidate.beat, ppq) <= totalTicks) {
      active = candidate;
    } else {
      break;
    }
  }
  const quarterBeatsPerBar = active.numerator * (4 / active.denominator);
  const ticksPerBar = beatsToTicks(quarterBeatsPerBar, ppq);
  const ticksPerMeterBeat = Math.max(1, Math.round((4 / active.denominator) * ppq));
  const deltaTicks = Math.max(0, totalTicks - beatsToTicks(active.beat, ppq));
  const barOffset = Math.floor(deltaTicks / ticksPerBar);
  const remTicksInBar = deltaTicks - barOffset * ticksPerBar;
  const beatIndexInBar = Math.floor(remTicksInBar / ticksPerMeterBeat);
  const tickInBeat = remTicksInBar - beatIndexInBar * ticksPerMeterBeat;

  return {
    bar: active.bar + barOffset,
    beatInBar: beatIndexInBar + 1,
    tickInBeat,
    totalTicks,
    numerator: active.numerator,
    denominator: active.denominator,
  };
}

/**
 * Converts 1-indexed Bar, 1-indexed Beat-in-Bar, and 0-indexed Tick-in-Beat back to 0-indexed quarter-note beats.
 */
export function barBeatTickToBeat(
  bar: number,
  beatInBar = 1,
  tickInBeat = 0,
  meterMap?: MeterChangeEvent[],
  ppq = CANONICAL_PPQ
): number {
  if (
    !Number.isSafeInteger(bar) ||
    bar < 1 ||
    bar > MAX_SUPPORTED_TIMELINE_BARS ||
    !Number.isSafeInteger(beatInBar) ||
    beatInBar < 1 ||
    !Number.isFinite(tickInBeat) ||
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
  const quarterBeatsPerBar = active.numerator * quarterBeatsPerMeterBeat;
  const barBeats = active.beat + (bar - active.bar) * quarterBeatsPerBar;
  const beatOffset = (beatInBar - 1) * quarterBeatsPerMeterBeat;
  const tickBeats = tickInBeat / ppq;
  return barBeats + beatOffset + tickBeats;
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
 * integrates dt = (60 / BPM(b)) db = (60 / k) * ln(BPM(b) / B0).
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
      if (Math.abs(slopeBpmPerBeat) <= 1e-9) {
        elapsedSeconds += (deltaBeats * 60) / curr.bpm;
      } else {
        const endBpm = curr.bpm + slopeBpmPerBeat * deltaBeats;
        elapsedSeconds += (60 / slopeBpmPerBeat) * Math.log(endBpm / curr.bpm);
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
 * inverts dt = (60 / k) * ln(BPM(b) / B0) via b(dt) = b0 + (B0 / k) * (exp(k * dt / 60) - 1).
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
      const segSeconds =
        Math.abs(slopeBpmPerBeat) <= 1e-9
          ? (spanBeats * 60) / curr.bpm
          : (60 / slopeBpmPerBeat) * Math.log(next.bpm / curr.bpm);
      if (remainingSec <= segSeconds + 1e-12) {
        const clampedSec = Math.min(remainingSec, segSeconds);
        if (Math.abs(slopeBpmPerBeat) <= 1e-9) {
          return curr.beat + (clampedSec * curr.bpm) / 60;
        }
        return curr.beat + (curr.bpm / slopeBpmPerBeat) * (Math.exp((slopeBpmPerBeat * clampedSec) / 60) - 1);
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
  if (hasNonConstantTimingMap(project)) {
    throw new Error(
      'TIMING_MAP_UNSUPPORTED: Non-constant tempoMap or non-4/4 meterMap is preserved in project state and XML, but variable-tempo/meter DSP scheduling is not yet enabled for live playback or offline WAV export.'
    );
  }
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
export function sessionEventsInWindow(project: AbletonProjectState, fromBeat: number, toBeat: number): SessionScheduledNote[] {
  if (!Number.isFinite(fromBeat) || !Number.isFinite(toBeat) || fromBeat < 0 || toBeat <= fromBeat) throw new Error('SESSION_RANGE: invalid window');
  const result: SessionScheduledNote[] = [];
  let work = 0;
  for (const track of project.tracks) {
    const launches = (project.session?.events || []).filter(e=>e.trackId===track.id)
      .map((event,index)=>({event,index})).sort((a,b)=>a.event.atBeat-b.event.atBeat || a.index-b.index).map(x=>x.event);
    for (let index=0; index<launches.length; index++) {
      const launch = launches[index], stop = launches[index+1]?.atBeat ?? Infinity;
      if (!launch.clipId || stop <= fromBeat || launch.atBeat >= toBeat) continue;
      const clip = track.sessionClips?.find(c=>c.id===launch.clipId);
      if (!clip || !(clip.length>0)) throw new Error('SESSION_TARGET: missing clip');
      const firstCycle=Math.max(0,Math.floor((fromBeat-launch.atBeat)/clip.length));
      const lastCycle=Math.floor((Math.min(toBeat,stop)-launch.atBeat)/clip.length);
      for (let cycle=firstCycle;cycle<=lastCycle;cycle++) {
        if (++work>100000) throw new Error('SESSION_DENSITY: window exceeds 100000 clip/note visits; use a smaller capture range');
        const periodStart=launch.atBeat+cycle*clip.length, periodEnd=Math.min(periodStart+clip.length,stop);
        for (const sourceNote of clip.notes) {
          if (++work>100000) throw new Error('SESSION_DENSITY: window exceeds 100000 clip/note visits; use a smaller capture range');
          const time=periodStart+sourceNote.time-clip.startTime;
          if (!noteIsInsideClip(sourceNote,clip) || time<fromBeat || time>=toBeat || time>=stop) continue;
          result.push({trackId:track.id,eventId:launch.id,cycle,clipId:clip.id,periodStart,periodEnd,endBeat:stop,sourceNote,
            note:{...sourceNote,time,quantizedTime:periodStart+sourceNote.quantizedTime-clip.startTime,duration:Math.min(sourceNote.duration,stop-time)}});
        }
      }
    }
  }
  return result.sort((a,b)=>a.note.time-b.note.time || a.trackId.localeCompare(b.trackId));
}

/** Compatibility boundary for the existing absolute-beat domain. No second clock or stored time state. */
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
  if (meterMap && meterMap.length > 0 && Number.isSafeInteger(transport.loopStartBar) && transport.loopStartBar >= 1 && Number.isSafeInteger(transport.loopLengthBars) && transport.loopLengthBars >= 1) {
    start = Math.max(0, barBeatTickToBeat(transport.loopStartBar, 1, 0, meterMap));
    const endBar = Math.min(MAX_SUPPORTED_TIMELINE_BARS, transport.loopStartBar + transport.loopLengthBars);
    end = Math.min(totalBeats, barBeatTickToBeat(endBar, 1, 0, meterMap));
  } else {
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


