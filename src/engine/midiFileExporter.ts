import { AbletonMidiClip, AbletonTrack, HumanizationConfig } from '../types/ableton';
import {
  computeDillaShuffleOffsetBeats,
  gaussianRandom,
  MAX_SIXTEENTH_SWING_SHIFT_BEATS,
  seededRandom,
} from './alsXmlEngine';
import { beatsToTicks, SUPPORTED_PPQ_RESOLUTIONS } from './timelineCoordinates';

/**
 * Standard MIDI File (SMF) Type 0 / Type 1 Exporter.
 * Supports exporting either quantized grid MIDI or micro-timed humanized MIDI output
 * into a binary .mid file ready for import into Ableton Live, Logic Pro, Pro Tools, Bitwig, or FL Studio.
 */

function encodeVariableLengthQuantity(value: number): number[] {
  const bytes: number[] = [];
  let buffer = value & 0x7f;

  for (value >>= 7; value !== 0; value >>= 7) {
    buffer <<= 8;
    buffer |= (value & 0x7f) | 0x80;
  }

  while (true) {
    bytes.push(buffer & 0xff);
    if (buffer & 0x80) buffer >>= 8;
    else break;
  }
  return bytes;
}

interface RawMidiEvent {
  tick: number;
  type: 'noteOn' | 'noteOff' | 'meta';
  channel: number;
  pitch?: number;
  velocity?: number;
  metaBytes?: number[];
}

export interface MidiClipExportOptions {
  includeHumanization?: boolean;
  humanization?: HumanizationConfig;
  seed?: number;
}

export interface ExportedMidiNoteSummary {
  id: string;
  pitch: number;
  velocity: number;
  quantizedBeat: number;
  startBeat: number;
  durationBeats: number;
  quantizedTick: number;
  startTick: number;
  durationTicks: number;
  microTimingOffsetTicks: number;
}

export function exportClipToMidiFile(
  clip: AbletonMidiClip,
  track: AbletonTrack,
  tempo = 134,
  ppq = 480,
  optionsOrIncludeHumanization: boolean | MidiClipExportOptions = true
): {
  fileName: string;
  blob: Blob;
  arrayBuffer: ArrayBuffer;
  byteLength: number;
  includeHumanization: boolean;
  exportedNotes: ExportedMidiNoteSummary[];
} {
  const safeTempo = Math.max(20, Math.min(300, tempo));
  const includeHumanization =
    typeof optionsOrIncludeHumanization === 'boolean'
      ? optionsOrIncludeHumanization
      : optionsOrIncludeHumanization?.includeHumanization ?? true;
  const humanizationConfig =
    typeof optionsOrIncludeHumanization === 'object'
      ? optionsOrIncludeHumanization?.humanization
      : undefined;
  const seed =
    typeof optionsOrIncludeHumanization === 'object' &&
    typeof optionsOrIncludeHumanization?.seed === 'number'
      ? optionsOrIncludeHumanization.seed
      : 101;

  const rawEvents: RawMidiEvent[] = [];

  // Track Name meta event
  const modeTag = includeHumanization ? 'Humanized' : 'Quantized';
  const trackName = `${track.name} - ${clip.name} (${modeTag})`.slice(0, 64);
  const trackNameBytes = Array.from(trackName).map((c) => c.charCodeAt(0));
  rawEvents.push({
    tick: 0,
    type: 'meta',
    channel: 0,
    metaBytes: [0xff, 0x03, trackNameBytes.length, ...trackNameBytes],
  });

  // Set Tempo meta event (microseconds per quarter note)
  const usPerQuarter = Math.round(60000000 / safeTempo);
  rawEvents.push({
    tick: 0,
    type: 'meta',
    channel: 0,
    metaBytes: [
      0xff,
      0x51,
      0x03,
      (usPerQuarter >> 16) & 0xff,
      (usPerQuarter >> 8) & 0xff,
      usPerQuarter & 0xff,
    ],
  });

  // Time Signature meta event: 4/4 (4, 2=2^2, 24 clocks/tick, 8 32nd notes/beat)
  rawEvents.push({
    tick: 0,
    type: 'meta',
    channel: 0,
    metaBytes: [0xff, 0x58, 0x04, 0x04, 0x02, 0x18, 0x08],
  });

  const channel =
    track.archetype === 'kick' || track.archetype === 'hats' || track.archetype === 'ride'
      ? 9
      : 0;

  const exportedNotes: ExportedMidiNoteSummary[] = [];
  const isCanonicalPpqSupported = (SUPPORTED_PPQ_RESOLUTIONS as readonly number[]).includes(ppq);
  const toTick = (beatVal: number): number =>
    isCanonicalPpqSupported
      ? beatsToTicks(Math.max(0, beatVal), ppq)
      : Math.max(0, Math.round(beatVal * ppq));

  clip.notes.forEach((note, idx) => {
    const rawGridBeat =
      typeof note.quantizedTime === 'number' && Number.isFinite(note.quantizedTime)
        ? Math.max(0, note.quantizedTime)
        : Math.max(0, Math.round(note.time * 4) / 4);
    // Ensure quantizedBeat is strictly snapped to the nearest 1/32nd or 1/16th grid
    const quantizedBeat = Math.max(0, Math.round(rawGridBeat * 8) / 8);
    const quantizedTick = toTick(quantizedBeat);

    let effectiveStartBeat = quantizedBeat;
    let effectiveVelocity = Math.max(1, Math.min(127, Math.round(note.velocity)));

    if (includeHumanization) {
      const hasExistingMicroTiming = Math.abs(note.time - quantizedBeat) > 1e-5;
      let baseHumanizedBeat = hasExistingMicroTiming ? Math.max(0, note.time) : quantizedBeat;

      // Apply swingStrength, shuffleSwing, and micro-timing if humanization config is provided
      // or if the note was on a strict grid and needs micro-timed humanization
      const swingStrength = humanizationConfig?.swingStrength ?? 0;
      const shuffleSwing = humanizationConfig?.shuffleSwing ?? 0;
      const maxShift = humanizationConfig?.microTimingMaxShiftBeats ?? 0.015;

      const zeroBased16th = Math.round(quantizedBeat / 0.25);
      const isOn16thGrid = Math.abs(quantizedBeat - zeroBased16th * 0.25) < 0.06;
      const isEven16th = isOn16thGrid && (zeroBased16th + 1) % 2 === 0;
      const swingOffset =
        isEven16th && swingStrength > 0
          ? (Math.max(0, Math.min(100, swingStrength)) / 100) * MAX_SIXTEENTH_SWING_SHIFT_BEATS
          : 0;
      const shuffleOffset = computeDillaShuffleOffsetBeats(quantizedBeat, shuffleSwing, safeTempo);

      if (!hasExistingMicroTiming) {
        const isKickDownbeat =
          track.archetype === 'kick' && Math.abs(quantizedBeat % 1) < 0.001;
        let microShift = isKickDownbeat
          ? 0
          : Math.max(
              -maxShift,
              Math.min(maxShift, gaussianRandom(0.004, Math.max(0.003, maxShift * 0.65), seed + idx * 17))
            );
        if (!isKickDownbeat && Math.abs(microShift + swingOffset + shuffleOffset) < 0.0025) {
          microShift = idx % 2 === 0 ? 0.008 : -0.006;
        }
        baseHumanizedBeat = Math.max(0, quantizedBeat + microShift + swingOffset + shuffleOffset);
      } else if (swingOffset !== 0 || shuffleOffset !== 0) {
        baseHumanizedBeat = Math.max(0, baseHumanizedBeat + swingOffset + shuffleOffset);
      }

      effectiveStartBeat = Number(baseHumanizedBeat.toFixed(4));

      if (humanizationConfig && (humanizationConfig.velocityVariancePct ?? 0) > 0 && !hasExistingMicroTiming) {
        const velVar = humanizationConfig.velocityVariancePct;
        const jitter = 1 + (seededRandom(seed + idx * 23) * 2 - 1) * velVar;
        effectiveVelocity = Math.max(1, Math.min(127, Math.round(note.velocity * jitter)));
      }
    } else {
      // Quantized grid MIDI mode: snap timing strictly to gridBeat and normalize velocity to clean step tier
      effectiveStartBeat = quantizedBeat;
    }

    const startTick = Math.max(0, Math.round(effectiveStartBeat * ppq));
    const durationBeats = Math.max(0.04, note.duration);
    const durationTicks = Math.max(1, Math.round(durationBeats * ppq));
    const endTick = startTick + durationTicks;
    const safePitch = Math.max(0, Math.min(127, Math.round(note.pitch)));

    exportedNotes.push({
      id: note.id,
      pitch: safePitch,
      velocity: effectiveVelocity,
      quantizedBeat,
      startBeat: effectiveStartBeat,
      durationBeats,
      quantizedTick,
      startTick,
      durationTicks,
      microTimingOffsetTicks: startTick - quantizedTick,
    });

    rawEvents.push({
      tick: startTick,
      type: 'noteOn',
      channel,
      pitch: safePitch,
      velocity: effectiveVelocity,
    });

    rawEvents.push({
      tick: endTick,
      type: 'noteOff',
      channel,
      pitch: safePitch,
      velocity: 0,
    });
  });

  // End of Track meta event
  const maxTick = rawEvents.reduce((acc, ev) => Math.max(acc, ev.tick), 0) + ppq;
  rawEvents.push({
    tick: maxTick,
    type: 'meta',
    channel: 0,
    metaBytes: [0xff, 0x2f, 0x00],
  });

  // Sort events chronologically (NoteOffs before NoteOns at same tick for crisp voice releases)
  rawEvents.sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick;
    if (a.type === 'noteOff' && b.type === 'noteOn') return -1;
    if (a.type === 'noteOn' && b.type === 'noteOff') return 1;
    return 0;
  });

  // Build MTrk track chunk
  const trackBytes: number[] = [];
  let previousTick = 0;

  for (const ev of rawEvents) {
    const delta = Math.max(0, ev.tick - previousTick);
    previousTick = ev.tick;

    const deltaBytes = encodeVariableLengthQuantity(delta);
    trackBytes.push(...deltaBytes);

    if (ev.type === 'meta' && ev.metaBytes) {
      trackBytes.push(...ev.metaBytes);
    } else if (ev.type === 'noteOn') {
      const status = 0x90 | (ev.channel & 0x0f);
      trackBytes.push(status, ev.pitch!, ev.velocity!);
    } else if (ev.type === 'noteOff') {
      const status = 0x80 | (ev.channel & 0x0f);
      trackBytes.push(status, ev.pitch!, 0);
    }
  }

  // Build MThd Header Chunk (SMF format 0, 1 track, ppq division)
  const headerBytes = [
    0x4d, 0x54, 0x68, 0x64, // 'MThd'
    0x00, 0x00, 0x00, 0x06, // Chunk length 6
    0x00, 0x00,             // Format 0 (single multichannel track)
    0x00, 0x01,             // 1 track
    (ppq >> 8) & 0xff, ppq & 0xff // Division (ticks per quarter note)
  ];

  // Track Chunk Header
  const trackLen = trackBytes.length;
  const trackHeader = [
    0x4d, 0x54, 0x72, 0x6b, // 'MTrk'
    (trackLen >> 24) & 0xff,
    (trackLen >> 16) & 0xff,
    (trackLen >> 8) & 0xff,
    trackLen & 0xff
  ];

  const fullFileBytes = new Uint8Array([...headerBytes, ...trackHeader, ...trackBytes]);
  const sanitizedTrackName = track.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const sanitizedClipName = clip.name.replace(/[^a-zA-Z0-9_-]/g, '_');
  const fileName = `${sanitizedTrackName}_${sanitizedClipName}_${tempo}BPM_${modeTag}.mid`;

  const blob = new Blob([fullFileBytes], { type: 'audio/midi' });
  return {
    fileName,
    blob,
    arrayBuffer: fullFileBytes.buffer,
    byteLength: fullFileBytes.byteLength,
    includeHumanization,
    exportedNotes,
  };
}

/**
 * Downloads a generated .mid file directly to the user's browser.
 */
export function downloadMidiFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

