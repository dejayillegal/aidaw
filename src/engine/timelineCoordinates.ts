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

export function beatsToTicks(beats: number, ppq = CANONICAL_PPQ): number {
  if (!Number.isFinite(beats) || !Number.isSafeInteger(ppq) || ppq <= 0) {
    throw new Error('TIMELINE_INPUT: invalid beat or PPQ coordinate');
  }
  return Math.round(beats * ppq);
}

export function ticksToBeats(ticks: number, ppq = CANONICAL_PPQ): number {
  if (!Number.isFinite(ticks) || !Number.isSafeInteger(ppq) || ppq <= 0) {
    throw new Error('TIMELINE_INPUT: invalid tick or PPQ coordinate');
  }
  return Math.round(ticks) / ppq;
}

export function snapBeatsToGridTicks(
  beats: number,
  stepBeats: number,
  ppq = CANONICAL_PPQ
): { ticks: number; beats: number } {
  if (!Number.isFinite(beats) || beats < 0 || !Number.isFinite(stepBeats) || stepBeats <= 0) {
    throw new Error('TIMELINE_INPUT: invalid grid snap coordinates');
  }
  const stepIndex = Math.round(beats / stepBeats);
  const snappedBeats = stepIndex * stepBeats;
  const ticks = beatsToTicks(snappedBeats, ppq);
  return { ticks, beats: snappedBeats };
}

function normalizedMeterMap(meterMap?: MeterChangeEvent[]): MeterChangeEvent[] {
  if (!meterMap || meterMap.length === 0) {
    return [{ bar: 1, beat: 0, numerator: 4, denominator: 4 }];
  }
  const sorted = [...meterMap];
  for (let i = 0; i < sorted.length; i++) {
    const evt = sorted[i];
    if (
      !Number.isSafeInteger(evt.bar) ||
      evt.bar < 1 ||
      !Number.isFinite(evt.beat) ||
      evt.beat < 0 ||
      !Number.isSafeInteger(evt.numerator) ||
      evt.numerator < 1 ||
      !Number.isSafeInteger(evt.denominator) ||
      evt.denominator < 1 ||
      (evt.denominator & (evt.denominator - 1)) !== 0
    ) {
      throw new Error('TIMELINE_INPUT: invalid meter change event');
    }
    if (i > 0 && (evt.beat <= sorted[i - 1].beat || evt.bar <= sorted[i - 1].bar)) {
      throw new Error('TIMELINE_INPUT: meter map must be strictly increasing');
    }
  }
  if (sorted[0].beat > 0) {
    sorted.unshift({ bar: 1, beat: 0, numerator: 4, denominator: 4 });
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
  const meters = normalizedMeterMap(meterMap);
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
    !Number.isSafeInteger(beatInBar) ||
    beatInBar < 1 ||
    !Number.isFinite(tickInBeat) ||
    tickInBeat < 0
  ) {
    throw new Error('TIMELINE_INPUT: invalid bar/beat/tick coordinates');
  }
  const meters = normalizedMeterMap(meterMap);
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

function normalizedTempoMap(baseTempo: number, tempoMap?: TempoAutomationPoint[]): TempoAutomationPoint[] {
  if (!Number.isFinite(baseTempo) || baseTempo <= 0) {
    throw new Error('TIMELINE_INPUT: invalid base tempo');
  }
  if (!tempoMap || tempoMap.length === 0) {
    return [{ beat: 0, bpm: baseTempo, curve: 'step' }];
  }
  const sorted = [...tempoMap];
  for (let i = 0; i < sorted.length; i++) {
    const pt = sorted[i];
    if (!Number.isFinite(pt.beat) || pt.beat < 0 || !Number.isFinite(pt.bpm) || pt.bpm <= 0) {
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
 */
export function beatToSecondsWithTempoMap(
  beat: number,
  baseTempo: number,
  tempoMap?: TempoAutomationPoint[]
): number {
  if (!Number.isFinite(beat) || beat < 0) {
    throw new Error('TIMELINE_INPUT: beat must be finite and non-negative');
  }
  const points = normalizedTempoMap(baseTempo, tempoMap);
  if (beat === 0) return 0;

  let elapsedSeconds = 0;
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    if (beat <= curr.beat) break;
    const next = points[i + 1];
    const segEndBeat = next ? Math.min(beat, next.beat) : beat;
    const deltaBeats = segEndBeat - curr.beat;
    if (deltaBeats <= 0) continue;

    if (next && curr.curve === 'linear' && Math.abs(next.bpm - curr.bpm) > 1e-6) {
      const spanBeats = next.beat - curr.beat;
      const endBpm = curr.bpm + ((next.bpm - curr.bpm) * deltaBeats) / spanBeats;
      const avgBpm = 0.5 * (curr.bpm + endBpm);
      elapsedSeconds += (deltaBeats * 60) / avgBpm;
    } else {
      elapsedSeconds += (deltaBeats * 60) / curr.bpm;
    }
  }
  return elapsedSeconds;
}

/**
 * Inverse mapping from elapsed seconds to musical beat across a tempo map.
 */
export function secondsToBeatWithTempoMap(
  seconds: number,
  baseTempo: number,
  tempoMap?: TempoAutomationPoint[]
): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new Error('TIMELINE_INPUT: seconds must be finite and non-negative');
  }
  const points = normalizedTempoMap(baseTempo, tempoMap);
  if (seconds === 0) return 0;

  let remainingSec = seconds;
  for (let i = 0; i < points.length; i++) {
    const curr = points[i];
    const next = points[i + 1];
    if (!next) {
      return curr.beat + (remainingSec * curr.bpm) / 60;
    }
    const spanBeats = next.beat - curr.beat;
    const avgBpm =
      curr.curve === 'linear' ? 0.5 * (curr.bpm + next.bpm) : curr.bpm;
    const segSeconds = (spanBeats * 60) / avgBpm;
    if (remainingSec <= segSeconds) {
      return curr.beat + (remainingSec * avgBpm) / 60;
    }
    remainingSec -= segSeconds;
  }
  const last = points[points.length - 1];
  return last.beat + (remainingSec * last.bpm) / 60;
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

export function playbackRegion(totalBeats: number, transport: Pick<TransportConfig, 'loopEnabled' | 'loopStartBar' | 'loopLengthBars'>) {
  if (!Number.isFinite(totalBeats) || totalBeats <= 0) throw new Error('TIMELINE_INPUT: invalid extent');
  const start = Math.max(0, (transport.loopStartBar - 1) * 4);
  const end = Math.min(totalBeats, start + transport.loopLengthBars * 4);
  const enabled = transport.loopEnabled && Number.isFinite(start) && Number.isFinite(end) && end > start;
  return { start, end, span: enabled ? end - start : 0, enabled };
}

export function positionAtBeat(rawBeat: number, totalBeats: number, region: ReturnType<typeof playbackRegion>): number {
  if (region.enabled && rawBeat >= region.end) return region.start + ((rawBeat - region.start) % region.span);
  return Math.max(0, Math.min(totalBeats, rawBeat));
}

