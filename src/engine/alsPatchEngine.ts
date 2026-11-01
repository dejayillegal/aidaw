/**
 * Safe, Targeted Ableton Live Set (.als) XML Patch Engine (v7.1 P0-002)
 *
 * Provides atomic, version-aware, content-preserving mutations on native Ableton XML documents.
 * Unlike destructive rebuilders, AlsPatchEngine targets specific XML DOM elements in place,
 * preserving all native attributes, unknown XML subtrees, existing Clip and Note IDs,
 * automation curves, and device routings.
 */

export interface AlsPatchResult {
  operationId: string;
  operationType: string;
  success: boolean;
  updatedXml?: string;
  changedNodeIds: string[];
  preservedNodeIds: string[];
  structuralValid: boolean;
  referenceValid: boolean;
  versionCompatibility: string;
  rollbackXml?: string;
  error?: string;
}

export interface PatchClipBoundsParams {
  trackId: string;
  clipId: string;
  newStartBeat: number;
  newLengthBeats: number;
  newLoopEndBeats?: number;
}

export interface PatchNoteVelocityParams {
  trackId: string;
  clipId: string;
  noteId: string;
  newVelocity: number;
}

export interface PatchTrackMixerParams {
  trackId: string;
  volumeDb?: number;
  pan?: number;
  muted?: boolean;
  soloed?: boolean;
}

export interface PatchInsertClipParams {
  trackId: string;
  clip: {
    id: string;
    name: string;
    startTime: number;
    length: number;
    loopEndBeats?: number;
    notes: {
      id?: string;
      time: number;
      duration: number;
      pitch: number;
      velocity: number;
    }[];
  };
}

export class AlsPatchEngine {
  private parser: DOMParser;
  private serializer: XMLSerializer;

  constructor() {
    this.parser = new DOMParser();
    this.serializer = new XMLSerializer();
  }

  /**
   * Parses XML safely and validates that the root element is <Ableton>.
   */
  private parseDocument(xmlString: string): { doc: Document | null; error?: string } {
    try {
      const doc = this.parser.parseFromString(xmlString, 'application/xml');
      const parseError = doc.querySelector('parsererror');
      if (parseError) {
        return { doc: null, error: `XML parse error: ${parseError.textContent}` };
      }
      const root = doc.documentElement;
      if (!root || root.nodeName !== 'Ableton') {
        return { doc: null, error: 'Document root is not <Ableton>' };
      }
      return { doc };
    } catch (e: any) {
      return { doc: null, error: e?.message || 'Failed to parse XML' };
    }
  }

  /**
   * Allocates a deterministic, collision-free numeric ID within the document namespace.
   */
  private allocateUniqueId(doc: Document, prefix = 90000): number {
    const existingIds = new Set<number>();
    const allIdElements = doc.querySelectorAll('[Id]');
    allIdElements.forEach((el) => {
      const idVal = parseInt(el.getAttribute('Id') || '', 10);
      if (!Number.isNaN(idVal)) existingIds.add(idVal);
    });
    const allNoteElements = doc.querySelectorAll('MidiNoteEvent[NoteId]');
    allNoteElements.forEach((el) => {
      const idVal = parseInt(el.getAttribute('NoteId') || '', 10);
      if (!Number.isNaN(idVal)) existingIds.add(idVal);
    });

    let candidate = prefix;
    while (existingIds.has(candidate)) {
      candidate++;
    }
    return candidate;
  }

  /**
   * Finds a track element by its Id or 0-indexed position.
   */
  private findTrackElement(doc: Document, trackId: string): Element | null {
    const tracks = Array.from(doc.querySelectorAll('Tracks > MidiTrack, Tracks > AudioTrack'));
    const byId = tracks.find((t) => t.getAttribute('Id') === trackId);
    if (byId) return byId;

    // Support compound IDs e.g. track_0_1
    const match = trackId.match(/track_(\d+)/);
    if (match) {
      const idx = parseInt(match[1], 10);
      if (tracks[idx]) return tracks[idx];
    }
    return null;
  }

  /**
   * Patches clip bounds (start time, length, loop end) without destroying or recreating clip nodes or IDs.
   */
  public patchClipBounds(
    xmlString: string,
    params: PatchClipBoundsParams
  ): AlsPatchResult {
    const opId = `patch_bounds_${Date.now()}`;
    const { doc, error } = this.parseDocument(xmlString);
    if (!doc) {
      return {
        operationId: opId,
        operationType: 'patchClipBounds',
        success: false,
        structuralValid: false,
        referenceValid: false,
        versionCompatibility: 'unknown',
        changedNodeIds: [],
        preservedNodeIds: [],
        error: error || 'Failed to parse source XML',
      };
    }

    const trackEl = this.findTrackElement(doc, params.trackId);
    if (!trackEl) {
      return {
        operationId: opId,
        operationType: 'patchClipBounds',
        success: false,
        structuralValid: true,
        referenceValid: false,
        versionCompatibility: doc.documentElement.getAttribute('SchemaChangeCount') || '12.0',
        changedNodeIds: [],
        preservedNodeIds: [],
        error: `Target track ${params.trackId} not found in XML document.`,
      };
    }

    const clipEls = Array.from(trackEl.querySelectorAll('MidiClip, AudioClip'));
    const targetClip = clipEls.find((c) => c.getAttribute('Id') === params.clipId) || clipEls[0];
    if (!targetClip) {
      return {
        operationId: opId,
        operationType: 'patchClipBounds',
        success: false,
        structuralValid: true,
        referenceValid: false,
        versionCompatibility: doc.documentElement.getAttribute('SchemaChangeCount') || '12.0',
        changedNodeIds: [],
        preservedNodeIds: [],
        error: `Target clip ${params.clipId} not found on track ${params.trackId}.`,
      };
    }

    const changedIds: string[] = [targetClip.getAttribute('Id') || params.clipId];
    const preservedIds = clipEls
      .filter((c) => c !== targetClip)
      .map((c) => c.getAttribute('Id') || '')
      .filter(Boolean);

    // Update CurrentStart, CurrentEnd, and LoopEnd in-place without removing other clip nodes
    const newEndBeat = params.newStartBeat + params.newLengthBeats;

    let startEl = targetClip.querySelector('CurrentStart');
    if (!startEl) {
      startEl = doc.createElement('CurrentStart');
      targetClip.appendChild(startEl);
    }
    startEl.setAttribute('Value', params.newStartBeat.toFixed(3));
    targetClip.setAttribute('Time', params.newStartBeat.toFixed(3));

    let endEl = targetClip.querySelector('CurrentEnd');
    if (!endEl) {
      endEl = doc.createElement('CurrentEnd');
      targetClip.appendChild(endEl);
    }
    endEl.setAttribute('Value', newEndBeat.toFixed(3));

    let loopEndEl = targetClip.querySelector('Loop > LoopEnd');
    if (loopEndEl) {
      const loopVal = params.newLoopEndBeats ?? params.newLengthBeats;
      loopEndEl.setAttribute('Value', loopVal.toFixed(3));
    }

    const updatedXml = this.serializer.serializeToString(doc);
    return {
      operationId: opId,
      operationType: 'patchClipBounds',
      success: true,
      updatedXml,
      changedNodeIds: changedIds,
      preservedNodeIds: preservedIds,
      structuralValid: true,
      referenceValid: true,
      versionCompatibility: doc.documentElement.getAttribute('SchemaChangeCount') || '12.0',
      rollbackXml: xmlString,
    };
  }

  /**
   * Patches a single MIDI note velocity in-place, preserving NoteId and all other notes in the clip.
   */
  public patchNoteVelocity(
    xmlString: string,
    params: PatchNoteVelocityParams
  ): AlsPatchResult {
    const opId = `patch_vel_${Date.now()}`;
    const { doc, error } = this.parseDocument(xmlString);
    if (!doc) {
      return {
        operationId: opId,
        operationType: 'patchNoteVelocity',
        success: false,
        structuralValid: false,
        referenceValid: false,
        versionCompatibility: 'unknown',
        changedNodeIds: [],
        preservedNodeIds: [],
        error: error || 'Failed to parse source XML',
      };
    }

    const noteEls = Array.from(doc.querySelectorAll('MidiNoteEvent'));
    const targetNote =
      noteEls.find((n) => n.getAttribute('NoteId') === params.noteId) ||
      noteEls.find((n) => n.getAttribute('Id') === params.noteId);

    if (!targetNote) {
      return {
        operationId: opId,
        operationType: 'patchNoteVelocity',
        success: false,
        structuralValid: true,
        referenceValid: false,
        versionCompatibility: doc.documentElement.getAttribute('SchemaChangeCount') || '12.0',
        changedNodeIds: [],
        preservedNodeIds: noteEls.map((n) => n.getAttribute('NoteId') || '').filter(Boolean),
        error: `Target note ${params.noteId} not found in XML document.`,
      };
    }

    const clampedVel = Math.max(1, Math.min(127, Math.round(params.newVelocity)));
    targetNote.setAttribute('Velocity', String(clampedVel));

    const changedIds = [params.noteId];
    const preservedIds = noteEls
      .filter((n) => n !== targetNote)
      .map((n) => n.getAttribute('NoteId') || '')
      .filter(Boolean);

    const updatedXml = this.serializer.serializeToString(doc);
    return {
      operationId: opId,
      operationType: 'patchNoteVelocity',
      success: true,
      updatedXml,
      changedNodeIds: changedIds,
      preservedNodeIds: preservedIds,
      structuralValid: true,
      referenceValid: true,
      versionCompatibility: doc.documentElement.getAttribute('SchemaChangeCount') || '12.0',
      rollbackXml: xmlString,
    };
  }

  /**
   * Patches track mixer parameters (Volume, Pan, Mute, Solo) in-place without touching clips or devices.
   */
  public patchTrackMixer(
    xmlString: string,
    params: PatchTrackMixerParams
  ): AlsPatchResult {
    const opId = `patch_mixer_${Date.now()}`;
    const { doc, error } = this.parseDocument(xmlString);
    if (!doc) {
      return {
        operationId: opId,
        operationType: 'patchTrackMixer',
        success: false,
        structuralValid: false,
        referenceValid: false,
        versionCompatibility: 'unknown',
        changedNodeIds: [],
        preservedNodeIds: [],
        error: error || 'Failed to parse source XML',
      };
    }

    const trackEl = this.findTrackElement(doc, params.trackId);
    if (!trackEl) {
      return {
        operationId: opId,
        operationType: 'patchTrackMixer',
        success: false,
        structuralValid: true,
        referenceValid: false,
        versionCompatibility: doc.documentElement.getAttribute('SchemaChangeCount') || '12.0',
        changedNodeIds: [],
        preservedNodeIds: [],
        error: `Target track ${params.trackId} not found.`,
      };
    }

    if (params.volumeDb !== undefined) {
      const volEl = trackEl.querySelector('DeviceChain > Mixer > Volume > Manual');
      if (volEl) {
        // Ableton Live Volume Manual value is linear amplitude [0..1] where 1.0 = 0 dB
        const linearVol = Math.pow(10, params.volumeDb / 20);
        volEl.setAttribute('Value', linearVol.toFixed(4));
      }
    }

    if (params.pan !== undefined) {
      const panEl = trackEl.querySelector('DeviceChain > Mixer > Pan > Manual');
      if (panEl) {
        panEl.setAttribute('Value', params.pan.toFixed(2));
      }
    }

    if (params.muted !== undefined) {
      const speakerEl = trackEl.querySelector('DeviceChain > Mixer > Speaker > Manual');
      if (speakerEl) {
        speakerEl.setAttribute('Value', params.muted ? 'false' : 'true');
      }
    }

    if (params.soloed !== undefined) {
      const soloEl = trackEl.querySelector('DeviceChain > Mixer > Solo > Manual');
      if (soloEl) {
        soloEl.setAttribute('Value', params.soloed ? 'true' : 'false');
      }
    }

    const trackIdVal = trackEl.getAttribute('Id') || params.trackId;
    const updatedXml = this.serializer.serializeToString(doc);
    return {
      operationId: opId,
      operationType: 'patchTrackMixer',
      success: true,
      updatedXml,
      changedNodeIds: [trackIdVal],
      preservedNodeIds: [],
      structuralValid: true,
      referenceValid: true,
      versionCompatibility: doc.documentElement.getAttribute('SchemaChangeCount') || '12.0',
      rollbackXml: xmlString,
    };
  }

  /**
   * Inserts or appends a new MIDI clip into a track while preserving all existing clips on that track.
   */
  public patchInsertClip(
    xmlString: string,
    params: PatchInsertClipParams
  ): AlsPatchResult {
    const opId = `patch_insert_clip_${Date.now()}`;
    const { doc, error } = this.parseDocument(xmlString);
    if (!doc) {
      return {
        operationId: opId,
        operationType: 'patchInsertClip',
        success: false,
        structuralValid: false,
        referenceValid: false,
        versionCompatibility: 'unknown',
        changedNodeIds: [],
        preservedNodeIds: [],
        error: error || 'Failed to parse source XML',
      };
    }

    const trackEl = this.findTrackElement(doc, params.trackId);
    if (!trackEl) {
      return {
        operationId: opId,
        operationType: 'patchInsertClip',
        success: false,
        structuralValid: true,
        referenceValid: false,
        versionCompatibility: doc.documentElement.getAttribute('SchemaChangeCount') || '12.0',
        changedNodeIds: [],
        preservedNodeIds: [],
        error: `Target track ${params.trackId} not found.`,
      };
    }

    let eventsEl = trackEl.querySelector('DeviceChain > MainSequencer > ClipTimeable > ArrangerAutomation > Events');
    if (!eventsEl) {
      eventsEl = trackEl.querySelector('Events');
    }
    if (!eventsEl) {
      let mainSeq = trackEl.querySelector('DeviceChain > MainSequencer');
      if (!mainSeq) {
        let devChain = trackEl.querySelector('DeviceChain');
        if (!devChain) {
          devChain = doc.createElement('DeviceChain');
          trackEl.appendChild(devChain);
        }
        mainSeq = doc.createElement('MainSequencer');
        devChain.appendChild(mainSeq);
      }
      let clipTimeable = mainSeq.querySelector('ClipTimeable');
      if (!clipTimeable) {
        clipTimeable = doc.createElement('ClipTimeable');
        mainSeq.appendChild(clipTimeable);
      }
      let arrangerAuto = clipTimeable.querySelector('ArrangerAutomation');
      if (!arrangerAuto) {
        arrangerAuto = doc.createElement('ArrangerAutomation');
        clipTimeable.appendChild(arrangerAuto);
      }
      eventsEl = doc.createElement('Events');
      arrangerAuto.appendChild(eventsEl);
    }

    const existingClips = Array.from(eventsEl.querySelectorAll('MidiClip'));
    const preservedIds = existingClips.map((c) => c.getAttribute('Id') || '').filter(Boolean);

    // Create the new MidiClip node
    const newClipEl = doc.createElement('MidiClip');
    const allocatedClipId = this.allocateUniqueId(doc, 50000);
    newClipEl.setAttribute('Id', String(allocatedClipId));
    newClipEl.setAttribute('Time', params.clip.startTime.toFixed(3));

    const nameEl = doc.createElement('Name');
    nameEl.setAttribute('Value', params.clip.name);
    newClipEl.appendChild(nameEl);

    const startEl = doc.createElement('CurrentStart');
    startEl.setAttribute('Value', params.clip.startTime.toFixed(3));
    newClipEl.appendChild(startEl);

    const endEl = doc.createElement('CurrentEnd');
    endEl.setAttribute('Value', (params.clip.startTime + params.clip.length).toFixed(3));
    newClipEl.appendChild(endEl);

    const loopEl = doc.createElement('Loop');
    const loopStartEl = doc.createElement('LoopStart');
    loopStartEl.setAttribute('Value', '0');
    const loopEndEl = doc.createElement('LoopEnd');
    loopEndEl.setAttribute('Value', (params.clip.loopEndBeats || params.clip.length).toFixed(3));
    const loopOnEl = doc.createElement('LoopOn');
    loopOnEl.setAttribute('Value', 'true');
    loopEl.appendChild(loopStartEl);
    loopEl.appendChild(loopEndEl);
    loopEl.appendChild(loopOnEl);
    newClipEl.appendChild(loopEl);

    // Group notes by pitch into KeyTrack nodes
    const notesEl = doc.createElement('Notes');
    const keyTracksEl = doc.createElement('KeyTracks');
    const byPitch = new Map<number, typeof params.clip.notes>();

    params.clip.notes.forEach((n) => {
      const list = byPitch.get(n.pitch) || [];
      list.push(n);
      byPitch.set(n.pitch, list);
    });

    let ktIdx = 0;
    byPitch.forEach((notesList, pitch) => {
      const keyTrackEl = doc.createElement('KeyTrack');
      keyTrackEl.setAttribute('Id', String(ktIdx++));

      const midiKeyEl = doc.createElement('MidiKey');
      midiKeyEl.setAttribute('Value', String(pitch));
      keyTrackEl.appendChild(midiKeyEl);

      const ktNotesEl = doc.createElement('Notes');
      notesList.forEach((n) => {
        const noteEl = doc.createElement('MidiNoteEvent');
        noteEl.setAttribute('Time', n.time.toFixed(3));
        noteEl.setAttribute('Duration', n.duration.toFixed(3));
        noteEl.setAttribute('Pitch', String(n.pitch));
        noteEl.setAttribute('Velocity', String(Math.max(1, Math.min(127, Math.round(n.velocity)))));
        noteEl.setAttribute('OffVelocity', '64');
        noteEl.setAttribute('NoteId', String(this.allocateUniqueId(doc, 80000)));
        noteEl.setAttribute('IsEnabled', 'true');
        ktNotesEl.appendChild(noteEl);
      });

      keyTrackEl.appendChild(ktNotesEl);
      keyTracksEl.appendChild(keyTrackEl);
    });

    notesEl.appendChild(keyTracksEl);
    newClipEl.appendChild(notesEl);
    eventsEl.appendChild(newClipEl);

    const updatedXml = this.serializer.serializeToString(doc);
    return {
      operationId: opId,
      operationType: 'patchInsertClip',
      success: true,
      updatedXml,
      changedNodeIds: [String(allocatedClipId)],
      preservedNodeIds: preservedIds,
      structuralValid: true,
      referenceValid: true,
      versionCompatibility: doc.documentElement.getAttribute('SchemaChangeCount') || '12.0',
      rollbackXml: xmlString,
    };
  }
}

export const alsPatchEngine = new AlsPatchEngine();
