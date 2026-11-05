import type { AbletonProjectState, AutomationPoint, ParameterAutomationLane, SidechainCompressorConfig } from '../types/ableton';
import { assertParameterLanes } from '../engine/parameterAutomation';
import { assertSidechainRouting } from '../engine/sidechainGraph';
import type { ArrangementClipEdit, ArrangementNoteEdit } from '../engine/arrangementEditing';
import { editArrangementClip, editArrangementNote } from '../engine/arrangementEditing';

export type ProjectCommandPayload =
  | { type: 'set-track-mute'; trackId: string; muted: boolean }
  | { type: 'set-track-solo'; trackId: string; soloed: boolean }
  | { type: 'rename-track'; trackId: string; name: string }
  | { type: 'set-filter-envelope'; trackId: string; points: AutomationPoint[] }
  | { type: 'set-parameter-lanes'; trackId: string; lanes: ParameterAutomationLane[] }
  | { type: 'set-sidechain'; trackId: string; config?: SidechainCompressorConfig }
  | { type: 'edit-clip'; trackId: string; clipId: string; edit: ArrangementClipEdit }
  | { type: 'edit-note'; trackId: string; clipId: string; noteId: string; edit: ArrangementNoteEdit };
export interface ProjectCommand {
  version: 1;
  id: string;
  projectQueueId: string;
  expectedRevision: number;
  actor: 'user' | 'assist';
  payload: ProjectCommandPayload;
}
/** Pure adapter: the existing command bus remains the only history authority. */
export function applyProjectCommand(project: AbletonProjectState, command: ProjectCommand): AbletonProjectState {
  if (command.version !== 1) throw new Error('COMMAND_VERSION: unsupported command; project unchanged');
  if (!command.id || !command.projectQueueId || !Number.isSafeInteger(command.expectedRevision) ||
    !['user', 'assist'].includes(command.actor)) throw new Error('COMMAND_INPUT: invalid identity');
  if (command.expectedRevision !== (project.projectRevision || project.revision || 1)) throw new Error('COMMAND_STALE: project revision changed');
  const payload = command.payload, track = project.tracks.find(t => t.id === payload.trackId);
  if (!track) throw new Error('COMMAND_TARGET: missing track');
  if (track.locked && !['set-track-mute', 'set-track-solo'].includes(payload.type)) throw new Error('TRACK_LOCKED: unlock before editing content');
  switch (payload.type) {
    case 'set-sidechain': {
      const updated = {...project,tracks:project.tracks.map(t=>t.id===track.id?{...t,sidechainCompressor:payload.config?structuredClone(payload.config):undefined}:t)};
      assertSidechainRouting(updated);return updated;
    }
    case 'set-parameter-lanes':
      assertParameterLanes(payload.lanes);
      return { ...project, tracks: project.tracks.map(t => t.id === track.id ? { ...t, parameterAutomation: structuredClone(payload.lanes) } : t) };
    case 'edit-clip': return editArrangementClip(project, track.id, payload.clipId, payload.edit);
    case 'edit-note': return editArrangementNote(project, track.id, payload.clipId, payload.noteId, payload.edit);
    case 'rename-track':
      if (typeof payload.name !== 'string' || !payload.name.trim() || payload.name.length > 160) throw new Error('COMMAND_NAME: invalid track name');
      return { ...project, tracks: project.tracks.map(t => t.id === track.id ? { ...t, name: payload.name.trim() } : t) };
    case 'set-track-mute':
      if (typeof payload.muted !== 'boolean') throw new Error('COMMAND_VALUE: mute must be boolean');
      return { ...project, tracks: project.tracks.map(t => t.id === track.id ? { ...t, muted: payload.muted } : t) };
    case 'set-track-solo':
      if (typeof payload.soloed !== 'boolean') throw new Error('COMMAND_VALUE: solo must be boolean');
      return { ...project, tracks: project.tracks.map(t => t.id === track.id ? { ...t, soloed: payload.soloed } : t) };
    case 'set-filter-envelope':
      if (!Array.isArray(payload.points) || payload.points.some((p, i) => !Number.isFinite(p.beat) || p.beat < 0 ||
        !Number.isFinite(p.value) || p.value < 0 || p.value > 1 || (i > 0 && p.beat <= payload.points[i - 1].beat))) throw new Error('COMMAND_ENVELOPE: ordered finite normalized points required');
      return { ...project, tracks: project.tracks.map(t => t.id === track.id ? { ...t, automationPoints: structuredClone(payload.points) } : t) };
    default: throw new Error('COMMAND_TYPE: unsupported operation');
  }
}
