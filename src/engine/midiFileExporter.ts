import { AbletonMidiClip, AbletonTrack } from '../types/ableton';

/**
 * Standard MIDI File (SMF) Type 0 / Type 1 Exporter.
 * Serializes heuristic-humanized MIDI note events into a binary .mid file
 * ready for import into Ableton Live, Logic Pro, Pro Tools, Bitwig, or FL Studio.
 */

function encodeVariableLengthQuantity(value: number): number[] {
  const bytes: number[] = [];
  let buffer = value & 0x7f;

  while ((value >>= 7)) {
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

export function exportClipToMidiFile(
  clip: AbletonMidiClip,
  track: AbletonTrack,
  tempo = 134,
  ppq = 480
): { fileName: string; blob: Blob; arrayBuffer: ArrayBuffer; byteLength: number } {
  const safeTempo = Math.max(20, Math.min(300, tempo));
  const rawEvents: RawMidiEvent[] = [];

  // Track Name meta event
  const trackName = `${track.name} - ${clip.name}`.slice(0, 64);
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

  // Convert note events to Note-On and Note-Off events
  // Note: clip.notes.time is in beats (1 beat = 1 quarter note = ppq ticks)
  // Maintains heuristic micro-timing shifts
  const channel = track.archetype === 'kick' || track.archetype === 'hats' || track.archetype === 'ride' ? 9 : 0;

  clip.notes.forEach((note) => {
    const startTick = Math.max(0, Math.round(note.time * ppq));
    const durationTicks = Math.max(1, Math.round(Math.max(0.04, note.duration) * ppq));
    const endTick = startTick + durationTicks;
    const safePitch = Math.max(0, Math.min(127, Math.round(note.pitch)));
    const safeVel = Math.max(1, Math.min(127, Math.round(note.velocity)));

    rawEvents.push({
      tick: startTick,
      type: 'noteOn',
      channel,
      pitch: safePitch,
      velocity: safeVel,
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
  const fileName = `${sanitizedTrackName}_${sanitizedClipName}_${tempo}BPM.mid`;

  const blob = new Blob([fullFileBytes], { type: 'audio/midi' });
  return {
    fileName,
    blob,
    arrayBuffer: fullFileBytes.buffer,
    byteLength: fullFileBytes.byteLength,
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
