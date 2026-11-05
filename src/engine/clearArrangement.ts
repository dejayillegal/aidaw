import type { AbletonProjectState, ClearArrangementOptions } from '../types/ableton';

/** Canonical edit only. The existing command bus owns validation, XML and history. */
export function clearArrangementContent(project: AbletonProjectState, selectedTrackId: string, options: ClearArrangementOptions): AbletonProjectState {
  if (!['selected_track', 'unlocked_tracks', 'all_tracks'].includes(options.scope)) throw new Error('CLEAR_SCOPE: invalid scope');
  if (![options.wipeNotes, options.wipeAutomation, options.wipeSessionClips, options.resetMixerToNeutral].some(Boolean)) throw new Error('CLEAR_EMPTY: select content to clear');
  if (options.wipeSessionClips && project.session?.events.length) throw new Error('CLEAR_SESSION: clear or capture the Session performance before removing referenced slots');
  let affected = 0;
  const tracks = project.tracks.map(track => {
    if (track.locked || (options.scope === 'selected_track' && track.id !== selectedTrackId)) return track;
    if (track.type !== 'midi' && options.wipeNotes && !options.wipeAutomation && !options.wipeSessionClips && !options.resetMixerToNeutral) return track;
    affected++;
    return { ...track,
      clips: options.wipeNotes && track.type === 'midi' ? track.clips.map(clip => ({ ...clip, notes: [], userEdited: true })) : track.clips,
      automationPoints: options.wipeAutomation ? [] : track.automationPoints,
      ...(options.wipeSessionClips ? { sessionClips: [], activeSessionSlot: undefined } : {}),
      mixer: options.resetMixerToNeutral ? { ...track.mixer, volumeDb: 0, pan: 0, transposeSemitones: 0, fineTuneCents: 0 } : track.mixer,
    };
  });
  if (!affected) throw new Error('CLEAR_TARGET: no unlocked supported target tracks');
  return { ...project, tracks };
}
