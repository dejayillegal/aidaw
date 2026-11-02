import {
  AbletonProjectState,
  AbletonTrack,
  AudioActiveRegion,
  AudioStripSilenceConfig,
  HumanizationConfig,
  MasterBusConfig,
  MemoryLocationMarker,
  MidiGhostPruningConfig,
  MidiNoteEvent,
  TimelineEditMode,
  TrackTakeRecord,
} from '../types/ableton';
import { syncLocatorsAndMixerToXml, syncTrackClipsToXml } from '../engine/alsXmlEngine';

import { synchronizeProjectStateToXml, syncLocatorsAndMixerToXml } from '../engine/alsXmlEngine';
import {
  computeSelectedTrackAnalysisData,
  detectAudioStripSilenceRegions,
} from '../engine/webAudioSynth';

export interface ProjectCommandTransaction {
  id: string;
  projectQueueId: string;
  label: string;
  category:
    | 'transport'
    | 'edit_mode'
    | 'locator'
    | 'mixer'
    | 'vca'
    | 'comping'
    | 'strip_silence'
    | 'ghost_prune'
    | 'calibration'
    | 'clip_edit';
  timestamp: string;
  beforeState: AbletonProjectState;
  afterState: AbletonProjectState;
}

function deepCloneProject(project: AbletonProjectState): AbletonProjectState {
  return JSON.parse(JSON.stringify(project)) as AbletonProjectState;
}

/**
 * Transactional CommandBus with per-project Undo/Redo history stacks.
 */
export class StudioCommandBus {
  private undoStacks = new Map<string, ProjectCommandTransaction[]>();
  private redoStacks = new Map<string, ProjectCommandTransaction[]>();
  private maxStackDepth = 50;
  private listeners = new Set<() => void>();

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.listeners.forEach((fn) => fn());
  }

  public executeMutation(
    projectQueueId: string,
    label: string,
    category: ProjectCommandTransaction['category'],
    currentProject: AbletonProjectState,
    mutator: (draft: AbletonProjectState) => AbletonProjectState
  ): AbletonProjectState {
    const beforeSnapshot = deepCloneProject(currentProject);
    const workingDraft = deepCloneProject(currentProject);

    const mutated = mutator(workingDraft);
    // Commit native content before publishing state or adding a history entry.
    // Existing callers that already synchronized their XML remain valid.
    for (const track of mutated.tracks) {
      const previous = currentProject.tracks.find(t => t.id === track.id);
      if (previous && JSON.stringify(previous.clips) !== JSON.stringify(track.clips)) {
        mutated.rawXmlModified = syncTrackClipsToXml(mutated.rawXmlModified, track.id, track.clips);
      }
    }

    const mutated = { ...mutator(workingDraft) };

    const nextRev = (currentProject.projectRevision || currentProject.revision || 1) + 1;
    mutated.revision = nextRev;
    mutated.projectRevision = nextRev;
    const mixerState = (p: AbletonProjectState) => p.tracks.map(t => ({ id: t.id, mixer: t.mixer, muted: t.muted, soloed: t.soloed }));
    const needsMixerOrLocatorSync = JSON.stringify(mixerState(currentProject)) !== JSON.stringify(mixerState(mutated)) ||
      JSON.stringify(currentProject.memoryLocations) !== JSON.stringify(mutated.memoryLocations);
    const syncedXml = needsMixerOrLocatorSync ? syncLocatorsAndMixerToXml(mutated) : mutated.rawXmlModified;
    const native = new DOMParser().parseFromString(syncedXml, 'application/xml');
    if (native.querySelector('parsererror') || native.documentElement.tagName !== 'Ableton') throw new Error('Mutation produced invalid native XML');

    const syncedXml = synchronizeProjectStateToXml(mutated, currentProject);

    mutated.rawXmlModified = syncedXml;
    mutated.rawXml = syncedXml;
    const afterSnapshot = deepCloneProject(mutated);

    const tx: ProjectCommandTransaction = {
      id: `tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      projectQueueId,
      label,
      category,
      timestamp: new Date().toISOString(),
      beforeState: beforeSnapshot,
      afterState: afterSnapshot,
    };

    const undoStack = this.undoStacks.get(projectQueueId) || [];
    undoStack.push(tx);
    if (undoStack.length > this.maxStackDepth) {
      undoStack.shift();
    }
    this.undoStacks.set(projectQueueId, undoStack);
    this.redoStacks.set(projectQueueId, []);
    this.notify();

    return mutated;
  }

  public canUndo(projectQueueId: string): boolean {
    const stack = this.undoStacks.get(projectQueueId);
    return Boolean(stack && stack.length > 0);
  }

  public canRedo(projectQueueId: string): boolean {
    const stack = this.redoStacks.get(projectQueueId);
    return Boolean(stack && stack.length > 0);
  }

  public getLastUndoLabel(projectQueueId: string): string | null {
    const stack = this.undoStacks.get(projectQueueId);
    if (!stack || stack.length === 0) return null;
    return stack[stack.length - 1].label;
  }

  public getLastRedoLabel(projectQueueId: string): string | null {
    const stack = this.redoStacks.get(projectQueueId);
    if (!stack || stack.length === 0) return null;
    return stack[stack.length - 1].label;
  }

  public undo(projectQueueId: string): AbletonProjectState | null {
    const undoStack = this.undoStacks.get(projectQueueId);
    if (!undoStack || undoStack.length === 0) return null;

    const tx = undoStack.pop()!;
    const redoStack = this.redoStacks.get(projectQueueId) || [];
    redoStack.push(tx);
    this.redoStacks.set(projectQueueId, redoStack);
    this.notify();

    return deepCloneProject(tx.beforeState);
  }

  public redo(projectQueueId: string): AbletonProjectState | null {
    const redoStack = this.redoStacks.get(projectQueueId);
    if (!redoStack || redoStack.length === 0) return null;

    const tx = redoStack.pop()!;
    const undoStack = this.undoStacks.get(projectQueueId) || [];
    undoStack.push(tx);
    this.undoStacks.set(projectQueueId, undoStack);
    this.notify();

    return deepCloneProject(tx.afterState);
  }

  public getHistory(projectQueueId: string): ProjectCommandTransaction[] {
    return JSON.parse(JSON.stringify(this.undoStacks.get(projectQueueId) || []));
  }
}

export const studioCommandBus = new StudioCommandBus();

// ============================================================================
// TIMELINE EDIT MODES (GRID, SLIP, SHUFFLE, SPOT) & MEMORY LOCATIONS (1-9)
// ============================================================================

/**
 * Converts a 1-indexed Bar.Beat.Sixteenth coordinate (e.g. Bar 5, Beat 1, 16th 1) into 0-indexed beats.
 */
export function spotPositionToBeat(bar: number, beat = 1, sixteenth = 1): number {
  const safeBar = Math.max(1, Math.floor(bar));
  const safeBeat = Math.max(1, Math.min(4, Math.floor(beat)));
  const safeSixteenth = Math.max(1, Math.min(4, Math.floor(sixteenth)));
  return (safeBar - 1) * 4 + (safeBeat - 1) + (safeSixteenth - 1) * 0.25;
}

/**
 * Converts a timestamp in milliseconds to exact beat position at a given BPM.
 */
export function spotMillisecondsToBeat(milliseconds: number, tempoBpm: number): number {
  const beatsPerSecond = Math.max(40, tempoBpm) / 60;
  return Math.max(0, Number(((milliseconds / 1000) * beatsPerSecond).toFixed(4)));
}

/**
 * Snaps a beat position according to the active TimelineEditMode:
 * - Grid: snaps to `gridDivisionBeats` (e.g. 0.25 for 1/16, 0.5 for 1/8, 1.0 for 1/4)
 * - Slip: preserves free floating-point sub-grid precision (0.001 beat resolution)
 * - Shuffle: snaps or shifts contiguously with ripple delta
 * - Spot: places at exact numeric targetBeat
 */
export function resolveBeatForEditMode(
  rawBeat: number,
  editMode: TimelineEditMode,
  gridDivisionBeats = 0.25,
  maxBeats = Number.POSITIVE_INFINITY
): number {
  const clamped = Math.max(0, Math.min(maxBeats - 0.0625, rawBeat));
  if (editMode === 'slip' || editMode === 'spot') {
    return Number(clamped.toFixed(4));
  }
  const step = Math.max(0.03125, gridDivisionBeats);
  return Number((Math.round(clamped / step) * step).toFixed(4));
}

/**
 * Moves or resizes a MIDI note under Grid, Slip, Shuffle, or Spot mode:
 * - Grid: Snaps note start and duration to the selected grid division.
 * - Slip: Moves note freely without grid quantization.
 * - Shuffle: Shifts all subsequent notes in the clip (`note.time > originalNote.time`)
 *   by the exact displacement/duration delta so contiguous phrases ripple cleanly.
 * - Spot: Places note at exact numeric beat coordinate.
 */
export function applyNoteEditWithMode(
  project: AbletonProjectState,
  trackId: string,
  clipIndex: number,
  noteId: string,
  targetBeat: number,
  editMode: TimelineEditMode,
  gridDivisionBeats = 0.25,
  targetDurationBeats?: number
): AbletonProjectState {
  const draft = deepCloneProject(project);
  const maxBeats = (draft.arrangementLengthBars || 16) * 4;
  const track = draft.tracks.find((t) => t.id === trackId);
  if (!track || !track.clips[clipIndex]) throw new Error(`Target track/clip ${trackId}/${clipIndex} not found`);

  const clip = track.clips[clipIndex];
  const noteIdx = clip.notes.findIndex((n) => n.id === noteId);
  if (noteIdx === -1) throw new Error(`Target note ${noteId} not found`);

  const originalNote = clip.notes[noteIdx];
  const originalStart = originalNote.time;
  const originalEnd = originalNote.time + originalNote.duration;

  const resolvedBeat = resolveBeatForEditMode(targetBeat, editMode, gridDivisionBeats, maxBeats);
  const resolvedDuration =
    targetDurationBeats !== undefined
      ? editMode === 'slip' || editMode === 'spot'
        ? Math.max(0.03125, Number(targetDurationBeats.toFixed(4)))
        : Math.max(
            gridDivisionBeats,
            Number((Math.round(targetDurationBeats / gridDivisionBeats) * gridDivisionBeats).toFixed(4))
          )
      : originalNote.duration;

  const startDelta = resolvedBeat - originalStart;
  const endDelta = resolvedBeat + resolvedDuration - originalEnd;
  const rippleDelta = targetDurationBeats !== undefined ? endDelta : startDelta;

  clip.notes = clip.notes.map((n) => {
    if (n.id === noteId) {
      return {
        ...n,
        time: resolvedBeat,
        quantizedTime: Math.round(resolvedBeat * 4) / 4,
        duration: resolvedDuration,
      };
    }
    if (editMode === 'shuffle' && n.time > originalStart + 0.0001) {
      const shiftedTime = Math.max(0, Math.min(maxBeats - 0.125, Number((n.time + rippleDelta).toFixed(4))));
      return {
        ...n,
        time: shiftedTime,
        quantizedTime: Math.round(shiftedTime * 4) / 4,
      };
    }
    return n;
  });

  clip.notes.sort((a, b) => a.time - b.time);
  return draft;
}

/**
 * Deletes a MIDI note in Shuffle mode (closing the gap by shifting subsequent notes left by the deleted note's span)
 * or in standard Grid/Slip/Spot mode.
 */
export function deleteNoteWithEditMode(
  project: AbletonProjectState,
  trackId: string,
  clipIndex: number,
  noteId: string,
  editMode: TimelineEditMode
): AbletonProjectState {
  const draft = deepCloneProject(project);
  const track = draft.tracks.find((t) => t.id === trackId);
  if (!track || !track.clips[clipIndex]) throw new Error(`Target track/clip ${trackId}/${clipIndex} not found`);

  const clip = track.clips[clipIndex];
  const targetNote = clip.notes.find((n) => n.id === noteId);
  if (!targetNote) throw new Error(`Target note ${noteId} not found`);

  const deletedStart = targetNote.time;
  const deletedDuration = targetNote.duration;

  clip.notes = clip.notes
    .filter((n) => n.id !== noteId)
    .map((n) => {
      if (editMode === 'shuffle' && n.time >= deletedStart + deletedDuration - 0.001) {
        const shifted = Math.max(0, Number((n.time - deletedDuration).toFixed(4)));
        return {
          ...n,
          time: shifted,
          quantizedTime: Math.round(shifted * 4) / 4,
        };
      }
      return n;
    });

  return draft;
}

/**
 * Moves an entire Clip on a track under Grid, Slip, Shuffle, or Spot mode.
 * In Shuffle mode, clips positioned after the moved clip ripple by the exact displacement delta.
 */
export function applyClipPositionWithEditMode(
  project: AbletonProjectState,
  trackId: string,
  clipIndex: number,
  targetStartBeat: number,
  editMode: TimelineEditMode,
  gridDivisionBeats = 1.0
): AbletonProjectState {
  const draft = deepCloneProject(project);
  const maxBeats = (draft.arrangementLengthBars || 16) * 4;
  const track = draft.tracks.find((t) => t.id === trackId);
  if (!track || !track.clips[clipIndex]) throw new Error(`Target track/clip ${trackId}/${clipIndex} not found`);

  const clip = track.clips[clipIndex];
  const oldStart = clip.startTime || 0;
  const clipDuration = clip.length;
  if (!Number.isFinite(clipDuration) || clipDuration <= 0) throw new Error('Invalid clip length');

  const newStart = resolveBeatForEditMode(targetStartBeat, editMode, gridDivisionBeats, maxBeats);
  const deltaBeats = newStart - oldStart;

  clip.startTime = newStart;
  clip.endTime = newStart + clipDuration;
  clip.notes = clip.notes.map((n) => {
    const nextTime = Math.max(0, Number((n.time + deltaBeats).toFixed(4)));
    return {
      ...n,
      time: nextTime,
      quantizedTime: n.quantizedTime + deltaBeats,
    };
  });

  if (editMode === 'shuffle' && track.clips.length > 1) {
    track.clips.forEach((otherClip, idx) => {
      if (idx !== clipIndex && otherClip.startTime > oldStart) {
        const previousStart = otherClip.startTime;
        otherClip.startTime = Math.max(0, Number((previousStart + deltaBeats).toFixed(4)));
        const actualDelta = otherClip.startTime - previousStart;
        otherClip.endTime = otherClip.startTime + otherClip.length;
        otherClip.notes = otherClip.notes.map((n) => {
          const t = Math.max(0, Number((n.time + actualDelta).toFixed(4)));
          return { ...n, time: t, quantizedTime: n.quantizedTime + actualDelta };
        });
      }
    });
  }

  return draft;
}

/**
 * Upserts a numbered Memory Location Marker (1-9) on the project and syncs to `<Locators>` XML.
 */
export function upsertMemoryLocationMarker(
  project: AbletonProjectState,
  numberSlot: number,
  name: string,
  beat: number,
  zoomBars?: number
): AbletonProjectState {
  const draft = deepCloneProject(project);
  const safeSlot = Math.max(1, Math.min(9, Math.round(numberSlot)));
  const safeBeat = Math.max(0, Number(beat.toFixed(2)));
  const colors = ['#f97316', '#38bdf8', '#a855f7', '#10b981', '#eab308', '#ec4899', '#6366f1', '#14b8a6', '#f43f5e'];

  const locators: MemoryLocationMarker[] = [...(draft.memoryLocations || [])];
  const existingIdx = locators.findIndex((l) => l.number === safeSlot);

  const marker: MemoryLocationMarker = {
    id: `loc_${safeSlot}`,
    number: safeSlot,
    name: name.trim() || `Marker ${safeSlot}`,
    beat: safeBeat,
    zoomBars,
    color: colors[(safeSlot - 1) % colors.length],
  };

  if (existingIdx >= 0) {
    locators[existingIdx] = marker;
  } else {
    locators.push(marker);
  }

  locators.sort((a, b) => a.number - b.number);
  draft.memoryLocations = locators;
  const syncedXml = syncLocatorsAndMixerToXml(draft);
  draft.rawXmlModified = syncedXml;
  draft.rawXml = syncedXml;
  return draft;
}

export function removeMemoryLocationMarker(
  project: AbletonProjectState,
  numberSlot: number
): AbletonProjectState {
  const draft = deepCloneProject(project);
  draft.memoryLocations = (draft.memoryLocations || []).filter((l) => l.number !== numberSlot);
  const syncedXml = syncLocatorsAndMixerToXml(draft);
  draft.rawXmlModified = syncedXml;
  draft.rawXml = syncedXml;
  return draft;
}

// ============================================================================
// EXTENSIBLE TRACK TAKES (COMPING) & SEPARATE STRIP SILENCE / GHOST PRUNING
// ============================================================================

/**
 * Creates a new named Take in `track.takes[]` (supports unlimited takes: Take A, B, C, D, etc.).
 */
export function createTrackTakeSnapshot(
  project: AbletonProjectState,
  trackId: string,
  customName?: string,
  mutatedNotes?: MidiNoteEvent[]
): AbletonProjectState {
  const draft = deepCloneProject(project);
  const track = draft.tracks.find((t) => t.id === trackId);
  if (!track) return draft;

  const existingTakes = track.takes || [];
  const nextIndex = existingTakes.length;
  const letter = String.fromCharCode(65 + (nextIndex % 26));
  const takeId = `take_${track.id}_${Date.now()}_${nextIndex}`;
  const takeName = customName?.trim() || `Take ${letter} — Snapshot #${nextIndex + 1}`;

  const sourceNotes =
    mutatedNotes ||
    (track.clips[0]?.notes ? (JSON.parse(JSON.stringify(track.clips[0].notes)) as MidiNoteEvent[]) : []);

  const newTake: TrackTakeRecord = {
    id: takeId,
    name: takeName,
    createdAt: new Date().toISOString(),
    notes: sourceNotes,
    notesSnapshot: sourceNotes,
    compSegments: [
      {
        id: `seg_${takeId}`,
        startBeat: 0,
        endBeat: (draft.arrangementLengthBars || 16) * 4,
        takeId,
      },
    ],
  };

  track.takes = [...existingTakes, newTake];
  track.activeTakeId = takeId;
  if (track.clips[0]) {
    track.clips[0].notes = JSON.parse(JSON.stringify(sourceNotes));
  }

  return draft;
}

/**
 * Switches the active Take on `trackId` and restores its `notesSnapshot` into `track.clips[0].notes`.
 */
export function switchActiveTrackTake(
  project: AbletonProjectState,
  trackId: string,
  takeId: string
): AbletonProjectState {
  const draft = deepCloneProject(project);
  const track = draft.tracks.find((t) => t.id === trackId);
  if (!track || !track.takes) return draft;

  // Save current active take's latest notes before switching
  if (track.activeTakeId && track.clips[0]) {
    const latestNotes = JSON.parse(JSON.stringify(track.clips[0].notes));
    track.takes = track.takes.map((t) =>
      t.id === track.activeTakeId
        ? { ...t, notes: latestNotes, notesSnapshot: latestNotes }
        : t
    );
  }

  const targetTake = track.takes.find((t) => t.id === takeId);
  if (!targetTake) return draft;

  const targetNotes = targetTake.notesSnapshot || targetTake.notes || [];
  track.activeTakeId = takeId;
  if (track.clips[0]) {
    track.clips[0].notes = JSON.parse(JSON.stringify(targetNotes));
  }

  return draft;
}

/**
 * Previews MIDI Ghost-Note Pruning on a track without mutating it.
 * Evaluates velocity, probability, and duration thresholds while protecting downbeats,
 * chord tones, and accents.
 */
export function previewMidiGhostNotePruning(
  track: AbletonTrack,
  config: MidiGhostPruningConfig
): {
  totalNotes: number;
  prunedNoteIds: string[];
  retainedNotes: MidiNoteEvent[];
  protectedAnchorCount: number;
} {
  const notes = track.clips[0]?.notes || [];
  const prunedNoteIds: string[] = [];
  const retainedNotes: MidiNoteEvent[] = [];
  let protectedAnchorCount = 0;

  // Identify chord timestamps (2+ simultaneous notes at the same beat)
  const beatCounts = new Map<string, number>();
  for (const n of notes) {
    const key = n.time.toFixed(2);
    beatCounts.set(key, (beatCounts.get(key) || 0) + 1);
  }

  for (const note of notes) {
    const isDownbeat = Math.abs(note.time - Math.round(note.time)) < 0.01;
    const isChordTone = (beatCounts.get(note.time.toFixed(2)) || 0) > 1;
    const isAccent = Boolean(note.isAccent || note.velocity >= 108);

    const isProtected =
      (config.protectDownbeats && isDownbeat) ||
      (config.protectChordTones && isChordTone) ||
      (config.protectAccents && isAccent);

    const lowVelocity = note.velocity <= (config.velocityThreshold ?? 40);
    const probLimit = config.probabilityThreshold ?? config.minProbability ?? 0.5;
    const lowProbability = (note.probability ?? 1.0) < probLimit;
    const shortDuration = note.duration <= (config.minDurationBeats ?? 0.125);

    const isCandidateToPrune = Boolean(
      note.isGhost || lowVelocity || lowProbability || (shortDuration && note.velocity < 85)
    );

    if (isCandidateToPrune) {
      if (isProtected) {
        protectedAnchorCount++;
        retainedNotes.push(note);
      } else {
        prunedNoteIds.push(note.id);
      }
    } else {
      retainedNotes.push(note);
    }
  }

  return {
    totalNotes: notes.length,
    prunedNoteIds,
    retainedNotes,
    protectedAnchorCount,
  };
}

/**
 * Applies MIDI Ghost-Note Pruning to `trackId` and syncs the updated notes to the active take.
 */
export function applyMidiGhostNotePruning(
  project: AbletonProjectState,
  trackId: string,
  config: MidiGhostPruningConfig
): AbletonProjectState {
  const draft = deepCloneProject(project);
  const track = draft.tracks.find((t) => t.id === trackId);
  if (!track || !track.clips[0]) return draft;

  const preview = previewMidiGhostNotePruning(track, config);
  track.clips[0].notes = JSON.parse(JSON.stringify(preview.retainedNotes));

  if (track.takes && track.activeTakeId) {
    track.takes = track.takes.map((t) =>
      t.id === track.activeTakeId
        ? { ...t, notesSnapshot: JSON.parse(JSON.stringify(preview.retainedNotes)) }
        : t
    );
  }

  return draft;
}

/**
 * Previews Audio Strip Silence on a track's audio/synthesis waveform envelope using
 * open/close hysteresis, minimum active region duration, and pre-attack / post-release padding.
 */
export function previewAudioStripSilence(
  project: AbletonProjectState,
  trackId: string,
  humanization: HumanizationConfig,
  masterBus: MasterBusConfig,
  config: AudioStripSilenceConfig
): {
  activeRegions: AudioActiveRegion[];
  retainedNoteCount: number;
  strippedSilentEventCount: number;
} {
  const track = project.tracks.find((t) => t.id === trackId);
  if (!track) {
    return { activeRegions: [], retainedNoteCount: 0, strippedSilentEventCount: 0 };
  }

  const analysis = computeSelectedTrackAnalysisData(
    project,
    track,
    humanization,
    masterBus,
    project.arrangementLengthBars || 16,
    256
  );

  const activeRegions = detectAudioStripSilenceRegions(analysis, project.tempo, config);
  const notes = track.clips[0]?.notes || [];
  let retainedNoteCount = 0;
  let strippedSilentEventCount = 0;

  for (const n of notes) {
    const insideActiveRegion = activeRegions.some(
      (reg) => n.time + n.duration * 0.5 >= reg.startBeat && n.time <= reg.endBeat
    );
    if (insideActiveRegion) {
      retainedNoteCount++;
    } else {
      strippedSilentEventCount++;
    }
  }

  return {
    activeRegions,
    retainedNoteCount,
    strippedSilentEventCount,
  };
}

/**
 * Applies Audio Strip Silence region gating to `trackId`, storing the detected `AudioActiveRegion[]`
 * on the active take and removing events that fall outside the gated audio regions.
 */
export function applyAudioStripSilenceToTrack(
  project: AbletonProjectState,
  trackId: string,
  humanization: HumanizationConfig,
  masterBus: MasterBusConfig,
  config: AudioStripSilenceConfig
): AbletonProjectState {
  const draft = deepCloneProject(project);
  const track = draft.tracks.find((t) => t.id === trackId);
  if (!track || !track.clips[0]) return draft;

  const { activeRegions } = previewAudioStripSilence(
    draft,
    trackId,
    humanization,
    masterBus,
    config
  );

  if (activeRegions.length > 0) {
    track.clips[0].notes = track.clips[0].notes.filter((n) =>
      activeRegions.some(
        (reg) => n.time + n.duration * 0.5 >= reg.startBeat && n.time <= reg.endBeat
      )
    );
  }

  if (track.takes && track.activeTakeId) {
    track.takes = track.takes.map((t) =>
      t.id === track.activeTakeId
        ? {
            ...t,
            notesSnapshot: JSON.parse(JSON.stringify(track.clips[0].notes)),
            activeAudioRegions: activeRegions,
          }
        : t
    );
  }

  return draft;
}

// ============================================================================
// TYPED STUDIO COMMAND REGISTRY (SHARED BY UI & CMD/CTRL+K PALETTE)
// ============================================================================

export interface StudioCommandDefinition {
  id: string;
  title: string;
  category:
    | 'Transport & Timeline'
    | 'Edit Modes & Locators'
    | 'SoundCraft Mix & VCA'
    | 'Comping & Transient Tools'
    | 'Batch Queue & Mastering';
  shortcut?: string;
  description: string;
}

export const STUDIO_COMMAND_DEFINITIONS: StudioCommandDefinition[] = [
  {
    id: 'transport.togglePlay',
    title: 'Play / Pause Arrangement Transport',
    category: 'Transport & Timeline',
    shortcut: 'Space',
    description: 'Start or pause sample-accurate Web Audio arrangement playback',
  },
  {
    id: 'transport.stopAndRewind',
    title: 'Stop & Return to Bar 1.1.1',
    category: 'Transport & Timeline',
    shortcut: 'Shift+Space',
    description: 'Stop playback and reset playhead to beat 0',
  },
  {
    id: 'edit.undo',
    title: 'Undo Last Studio Operation',
    category: 'Edit Modes & Locators',
    shortcut: 'Cmd/Ctrl+Z',
    description: 'Revert the most recent transactional project command',
  },
  {
    id: 'edit.redo',
    title: 'Redo Studio Operation',
    category: 'Edit Modes & Locators',
    shortcut: 'Cmd/Ctrl+Shift+Z',
    description: 'Re-apply the most recently undone studio command',
  },
  {
    id: 'editMode.grid',
    title: 'Switch Edit Mode: GRID (Quantized Snap)',
    category: 'Edit Modes & Locators',
    shortcut: 'F1',
    description: 'Snap clip and MIDI note edits to the active musical grid (1/4, 1/8, 1/16, 1/32)',
  },
  {
    id: 'editMode.slip',
    title: 'Switch Edit Mode: SLIP (Sub-Grid Free)',
    category: 'Edit Modes & Locators',
    shortcut: 'F2',
    description: 'Move notes and clips with continuous sub-grid floating-point precision',
  },
  {
    id: 'editMode.shuffle',
    title: 'Switch Edit Mode: SHUFFLE (Contiguous Ripple)',
    category: 'Edit Modes & Locators',
    shortcut: 'F3',
    description: 'Ripple subsequent notes/clips automatically when moving, resizing, or deleting',
  },
  {
    id: 'editMode.spot',
    title: 'Switch Edit Mode: SPOT (Exact Bar.Beat.16th / ms Dialog)',
    category: 'Edit Modes & Locators',
    shortcut: 'F4',
    description: 'Place notes or clips at exact numeric Bar.Beat.Sixteenth or millisecond coordinates',
  },
  {
    id: 'locator.dropAtPlayhead',
    title: 'Drop Memory Location Marker at Playhead',
    category: 'Edit Modes & Locators',
    shortcut: 'M',
    description: 'Add or update a numbered Memory Location (1-9) at the current playhead bar',
  },
  {
    id: 'workspace.mixConsole',
    title: 'Open SoundCraft 10-Slot Mix Console & VCA Groups',
    category: 'SoundCraft Mix & VCA',
    shortcut: 'Cmd/Ctrl+M',
    description: 'Open full channel strip console with 10 ordered inserts, Send A/B, and VCA faders',
  },
  {
    id: 'comping.createSnapshotTake',
    title: 'Create New Comp Take Snapshot on Selected Track',
    category: 'Comping & Transient Tools',
    shortcut: 'Shift+T',
    description: 'Save current selected track pattern as a new named Take (Take B, C, D...)',
  },
  {
    id: 'comping.openTransientTools',
    title: 'Open Track Comping, Audio Strip Silence & Ghost-Note Pruning',
    category: 'Comping & Transient Tools',
    shortcut: 'Cmd/Ctrl+Shift+S',
    description: 'Configure Audio Strip Silence (dB hysteresis) or MIDI Ghost-Note Pruning',
  },
  {
    id: 'batch.openQueueModal',
    title: 'Open Bulk Process Smart Leveling 2.0 Queue & Master Export',
    category: 'Batch Queue & Mastering',
    shortcut: 'Cmd/Ctrl+B',
    description: 'Batch calibrate multiple .als files (Stages A-E) and manage Master Export presets',
  },
  {
    id: 'batch.calibrateActiveProject',
    title: 'Run Smart Leveling 2.0 Calibration on Active Project',
    category: 'Batch Queue & Mastering',
    shortcut: 'Cmd/Ctrl+Shift+L',
    description: 'Measure ITU-R BS.1770-4 LUFS & 4x True Peak and apply non-destructive calibration',
  },
  {
    id: 'arrangement.generateSectionProposal',
    title: 'Generate Section Arrangement Proposal',
    category: 'Transport & Timeline',
    shortcut: 'Cmd/Ctrl+Shift+A',
    description: 'Propose structured 6-section underground arrangement (Intro, Groove, Hypnotic, Breakdown, Drop, Outro) non-destructively',
  },
];
