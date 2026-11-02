import type { AbletonMidiClip, MidiNoteEvent, TransportConfig } from '../types/ableton';

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
