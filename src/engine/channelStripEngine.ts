import {
  AbletonDevice,
  AbletonProjectState,
  AbletonTrack,
  VcaGroupId,
  VcaGroupState,
} from '../types/ableton';
import {
  ABLETON_BUILTIN_LIBRARY,
  BROWSER_SUPPORTED_DEVICE_TAGS,
  formatXmlString,
  getDefaultVcaGroups,
} from './alsXmlEngine';
import {
  auditProjectCapabilities,
  classifyAbletonDeviceTag,
  getAbletonDeviceContract,
  isInstrumentDeviceTag,
   isMidiProcessorDeviceTag,
  MAX_EXECUTABLE_INSERT_DEVICES,
  syncDeviceConversionRecord,
  validateTrackDeviceChainOrderingAndCounts,
  verifyDeviceConversionRecord,
} from './abletonCapabilityMatrix';
import { assertRuntimeTimingMapSupport } from './timelineCoordinates';

export const MAX_CHANNEL_INSERT_SLOTS = MAX_EXECUTABLE_INSERT_DEVICES;

/** Imported chains are preserved; execution must never truncate them or silently pass through unsupported devices. */
export function assertExecutableInsertLimits(project: AbletonProjectState): void {
  for (const track of project.tracks) {
    if (track.devices.length > MAX_CHANNEL_INSERT_SLOTS) {
      throw new Error(`INSERT_LIMIT: ${track.name} has ${track.devices.length} devices; the browser supports ${MAX_CHANNEL_INSERT_SLOTS} chain slots. Remove devices or retain this project for XML preservation only.`);
    }
  }
  assertRuntimeTimingMapSupport(project);
  const audit = auditProjectCapabilities(project);
  if (audit.unsupportedDevices.length > 0) {
    const first = audit.unsupportedDevices[0];
    throw new Error(
      `UNSUPPORTED_DEVICE: ${first.trackName} contains unsupported device <${first.xmlTag}> (${first.deviceId}); bypass or remove it before playback or WAV rendering.`
    );
  }
  if (audit.preservedOnlyDevices.length > 0) {
    const first = audit.preservedOnlyDevices[0];
    throw new Error(
      `PRESERVED_ONLY_DEVICE: ${first.trackName} contains preserved-only native device <${first.xmlTag}> (${first.deviceId}) with no browser DSP processor; bypass it to audition/render with approximations or retain this project for XML preservation.`
    );
  }
  if (audit.unconvertedDevices.length > 0) {
    const first = audit.unconvertedDevices[0];
    throw new Error(
      `CONVERSION_REQUIRED: ${first.trackName} contains converted device <${first.xmlTag}> (${first.deviceId}) with ${first.status} conversion record (${first.reason}); regenerate or validate its conversion record or bypass it before playback or WAV rendering.`
    );
  }
  if (audit.deviceOrderingOrCountViolations.length > 0) {
    const first = audit.deviceOrderingOrCountViolations[0];
    throw new Error(`DEVICE_CHAIN_CONTRACT: ${first.reason}`);
  }
}

export interface EffectiveTrackGainBreakdown {
  baseFaderDb: number;
  baseVolumeDb: number;
  automationOffsetDb: number;
  vcaGroupGainDb: number;
  vcaGainDb: number;
  effectiveGainDb: number;
  effectiveVolumeDb: number;
  effectiveLinearGain: number;
  isEffectivelyMuted: boolean;
  effectivelyMuted: boolean;
  vcaGroupId: VcaGroupId;
}

export function normalizeVcaGroupId(id: string | undefined): VcaGroupId {
  if (!id) return 'unassigned';
  if (id === 'drums' || id === 'drums_vca') return 'drums_vca';
  if (id === 'low_end' || id === 'low_end_vca') return 'low_end_vca';
  if (id === 'synths' || id === 'synths_vca') return 'synths_vca';
  if (id === 'atmos' || id === 'atmos_vca') return 'atmos_vca';
  return 'unassigned';
}

/**
 * Gate 4 & Section 9: Non-destructive VCA Gain Composition Model.
 * Keeps separate:
 *  - Track base fader (track.mixer.volumeDb)
 *  - Track automation gain offset (track.automationGainOffsetDb)
 *  - VCA control gain (vcaGroup.gainDb)
 *  - Mute / Solo state (both track-level and VCA-group level)
 * Avoids double application across groups and NEVER overwrites track.mixer.volumeDb when VCA moves.
 */
export function composeEffectiveTrackGain(
  track: AbletonTrack,
  allTracks: AbletonTrack[],
  vcaGroups?: VcaGroupState[]
): EffectiveTrackGainBreakdown {
  const groups = vcaGroups && vcaGroups.length > 0 ? vcaGroups : getDefaultVcaGroups();
  const groupId = normalizeVcaGroupId(track.vcaGroupId);
  const assignedGroup = groups.find((g) => normalizeVcaGroupId(g.id) === groupId);

  const anyTrackSoloed = allTracks.some((t) => t.soloed);
  const anyVcaSoloed = groups.some((g) => g.soloed);

  const mutedByTrack = track.muted || (anyTrackSoloed && !track.soloed);
  const mutedByVca =
    Boolean(assignedGroup?.muted) ||
    (anyVcaSoloed && (!assignedGroup || !assignedGroup.soloed));

  const isEffectivelyMuted = mutedByTrack || mutedByVca;

  const baseFaderDb = Number.isFinite(track.mixer?.volumeDb) ? track.mixer.volumeDb : 0;
  const automationOffsetDb = Number.isFinite(track.automationGainOffsetDb)
    ? track.automationGainOffsetDb!
    : 0;
  const vcaGroupGainDb = assignedGroup ? assignedGroup.gainDb : 0;

  // Compose in dB domain once per track (guaranteed single VCA membership -> zero double application)
  const rawSumDb = baseFaderDb + automationOffsetDb + vcaGroupGainDb;
  const effectiveGainDb = Math.max(-60, Math.min(12, Number(rawSumDb.toFixed(2))));

  const effectiveLinearGain =
    isEffectivelyMuted || effectiveGainDb <= -48 ? 0 : Math.pow(10, effectiveGainDb / 20);

  return {
    baseFaderDb,
    baseVolumeDb: baseFaderDb,
    automationOffsetDb,
    vcaGroupGainDb,
    vcaGainDb: vcaGroupGainDb,
    effectiveGainDb,
    effectiveVolumeDb: effectiveGainDb,
    effectiveLinearGain,
    isEffectivelyMuted,
    effectivelyMuted: isEffectivelyMuted,
    vcaGroupId: groupId,
  };
}

export interface EffectiveAudibilityResult {
  isAudible: boolean;
  mutedByTrackMute: boolean;
  mutedBySoloIsolation: boolean;
  mutedByVcaMute: boolean;
  mutedByVcaSoloIsolation: boolean;
  activeSoloTrackIds: string[];
  activeSoloVcaIds: string[];
  effectiveGainLinear: number;
  effectiveGainDb: number;
}

/**
 * Shared service: Resolves complete effective audibility considering track mute,
 * track solo, multi-track solo, group mute/solo, and VCA solo isolation.
 */
export function resolveEffectiveAudibility(
  track: AbletonTrack,
  allTracks: AbletonTrack[],
  vcaGroups?: VcaGroupState[]
): EffectiveAudibilityResult {
  const groups = vcaGroups && vcaGroups.length > 0 ? vcaGroups : getDefaultVcaGroups();
  const groupId = normalizeVcaGroupId(track.vcaGroupId);
  const assignedGroup = groups.find((g) => normalizeVcaGroupId(g.id) === groupId);

  const activeSoloTracks = allTracks.filter((t) => t.soloed);
  const activeSoloVcas = groups.filter((g) => g.soloed);
  const anyTrackSoloed = activeSoloTracks.length > 0;
  const anyVcaSoloed = activeSoloVcas.length > 0;

  const mutedByTrackMute = Boolean(track.muted);
  const mutedBySoloIsolation = anyTrackSoloed && !track.soloed;
  const mutedByVcaMute = Boolean(assignedGroup?.muted);
  const mutedByVcaSoloIsolation = anyVcaSoloed && (!assignedGroup || !assignedGroup.soloed);

  const isAudible =
    !mutedByTrackMute && !mutedBySoloIsolation && !mutedByVcaMute && !mutedByVcaSoloIsolation;

  const breakdown = composeEffectiveTrackGain(track, allTracks, vcaGroups);

  return {
    isAudible,
    mutedByTrackMute,
    mutedBySoloIsolation,
    mutedByVcaMute,
    mutedByVcaSoloIsolation,
    activeSoloTrackIds: activeSoloTracks.map((t) => t.id),
    activeSoloVcaIds: activeSoloVcas.map((g) => g.id),
    effectiveGainLinear: isAudible ? breakdown.effectiveLinearGain : 0,
    effectiveGainDb: isAudible ? breakdown.effectiveGainDb : -60,
  };
}

/**
 * Commits non-destructive VCA group gains into native track base faders ONLY when explicitly requested by the user.
 * Resets VCA group gains to 0.0 dB in the same transaction to prevent double application.
 */
export function commitVcaGainsToTrackFaders(
  projectOrTracks: AbletonProjectState | AbletonTrack[],
  vcaGroupsArg?: VcaGroupState[]
): AbletonProjectState & { tracks: AbletonTrack[]; vcaGroups: VcaGroupState[] } {
  const isTracksArray = Array.isArray(projectOrTracks);
  const sourceTracks = isTracksArray ? projectOrTracks : projectOrTracks.tracks;
  const groups =
    (isTracksArray ? vcaGroupsArg : projectOrTracks.vcaGroups) || getDefaultVcaGroups();

  const groupGainMap = new Map<VcaGroupId, number>();
  groups.forEach((g) => groupGainMap.set(normalizeVcaGroupId(g.id), g.gainDb));

  const updatedTracks = sourceTracks.map((t) => {
    const vcaDelta = groupGainMap.get(normalizeVcaGroupId(t.vcaGroupId)) || 0;
    if (Math.abs(vcaDelta) < 0.001) return t;
    const nextVolDb = Math.max(-36, Math.min(6, Number((t.mixer.volumeDb + vcaDelta).toFixed(2))));
    return {
      ...t,
      mixer: {
        ...t.mixer,
        volumeDb: nextVolDb,
      },
      dspConfigRevision: (t.dspConfigRevision || 1) + 1,
    };
  });

  const resetVcaGroups = groups.map((g) => ({ ...g, gainDb: 0 }));

  if (isTracksArray) {
    return {
      fileName: 'Committed_Project.als',
      schemaVersion: '12.0',
      creator: 'Ableton Live 12',
      tempo: 134,
      rootKey: 'F',
      scale: 'Phrygian',
      polyrhythmicGrid: '16th',
      energyDensity: 16,
      tracks: updatedTracks,
      vcaGroups: resetVcaGroups,
      rawXmlOriginal: '',
      rawXmlModified: '',
      rawByteSize: 0,
      estimatedGzipByteSize: 0,
      lastActionLog: 'Committed VCA group offsets to native track faders and reset VCA trims to 0.0 dB.',
    };
  }

  return {
    ...projectOrTracks,
    revision: (projectOrTracks.revision || 1) + 1,
    projectRevision: (projectOrTracks.projectRevision || projectOrTracks.revision || 1) + 1,
    tracks: updatedTracks,
    vcaGroups: resetVcaGroups,
    lastActionLog: `Committed VCA group offsets to native track faders and reset VCA trims to 0.0 dB.`,
  };
}

/**
 * Returns the browser DSP compatibility status of an Ableton device or XML tag.
 */
export function getDeviceCompatibilityInfo(deviceOrTag: AbletonDevice | string | undefined): {
  supportedInBrowserDsp: boolean;
  badgeText: string;
  badgeLabel: string;
  description: string;
} {
  if (!deviceOrTag) {
    return {
      supportedInBrowserDsp: false,
      badgeText: 'Empty Slot',
      badgeLabel: 'Empty Slot',
      description: 'No device assigned.',
    };
  }

  const isObject = typeof deviceOrTag === 'object';
  const xmlTag = isObject ? deviceOrTag.xmlTag : String(deviceOrTag);
  const isUser = isObject ? Boolean(deviceOrTag.isUserCreated) : false;
  const status = classifyAbletonDeviceTag(xmlTag);
  const supported = isObject
    ? (deviceOrTag.browserDspSupported ?? BROWSER_SUPPORTED_DEVICE_TAGS.has(xmlTag))
    : BROWSER_SUPPORTED_DEVICE_TAGS.has(xmlTag);

  if (status === 'converted' && isObject) {
    const verification = verifyDeviceConversionRecord(deviceOrTag);
    if (!verification.isValid) {
      const badgeText = 'Conversion Required';
      return {
        supportedInBrowserDsp: false,
        badgeText,
        badgeLabel: badgeText,
        description: verification.reason,
      };
    }
    const badgeText = isUser ? 'User ALS · Converted DSP' : 'Converted Browser DSP';
    return {
      supportedInBrowserDsp: true,
      badgeText,
      badgeLabel: badgeText,
      description: `Converted browser approximation [hash=${deviceOrTag.conversionRecord?.sourceParameterHash}].`,
    };
  }

  if (supported && (status === 'executable' || status === 'converted')) {
    const badgeText = isUser ? 'User ALS · Active DSP' : 'Active Browser DSP';
    return {
      supportedInBrowserDsp: true,
      badgeText,
      badgeLabel: badgeText,
      description: 'Processed in real-time by the browser Web Audio ChannelStripEngine.',
    };
  }

  const badgeText = status === 'preserved-only' ? 'Preserved Native XML (Bypass Required)' : 'Unsupported Plugin (Bypass Required)';
  return {
    supportedInBrowserDsp: false,
    badgeText,
    badgeLabel: badgeText,
    description:
      'Preserved intact in .als XML on export; must be bypassed before browser DSP playback or WAV rendering.',
  };
}

/**
 * Inserts a verified DSP-backed library device into a channel strip's 10-slot insert chain.
 * Supports both (project, trackId, templateId, slotIndex) and (track, templateId, slotIndex) call signatures.
 */
export function insertDeviceIntoChannelStrip(
  projectOrTrack: AbletonProjectState | AbletonTrack,
  trackIdOrTemplateId: string,
  templateIdOrSlotIndex?: string | number,
  targetSlotIndexMaybe?: number
): {
  project: AbletonProjectState;
  updatedTrack: AbletonTrack;
  insertedDevice: AbletonDevice | null;
  error?: string;
} {
  const isTrackDirect = !('tracks' in projectOrTrack);
  const templateId = isTrackDirect ? trackIdOrTemplateId : String(templateIdOrSlotIndex || '');
  const targetSlotIndex = isTrackDirect
    ? typeof templateIdOrSlotIndex === 'number'
      ? templateIdOrSlotIndex
      : undefined
    : targetSlotIndexMaybe;

  const targetTrack = isTrackDirect
    ? (projectOrTrack as AbletonTrack)
    : (projectOrTrack as AbletonProjectState).tracks.find((t) => t.id === trackIdOrTemplateId);

  const fallbackProject: AbletonProjectState = isTrackDirect
    ? {
        fileName: 'Track.als',
        schemaVersion: '12.0',
        creator: 'Ableton Live 12',
        tempo: 134,
        rootKey: 'F',
        scale: 'Phrygian',
        polyrhythmicGrid: '16th',
        energyDensity: 16,
        tracks: [projectOrTrack as AbletonTrack],
        rawXmlOriginal: '',
        rawXmlModified: '',
        rawByteSize: 0,
        estimatedGzipByteSize: 0,
        lastActionLog: '',
      }
    : (projectOrTrack as AbletonProjectState);

  if (!targetTrack) {
    return {
      project: fallbackProject,
      updatedTrack: (projectOrTrack as AbletonTrack) || fallbackProject.tracks[0],
      insertedDevice: null,
      error: `Track ${trackIdOrTemplateId} not found.`,
    };
  }

  const template =
    ABLETON_BUILTIN_LIBRARY.find(
      (d) =>
        d.id === templateId ||
        d.xmlTag === templateId ||
        d.xmlTag.toLowerCase() === templateId.toLowerCase()
    ) ||
    ABLETON_BUILTIN_LIBRARY.find((d) =>
      d.displayName.toLowerCase().includes(templateId.toLowerCase())
    );
  if (!template) {
    return {
      project: fallbackProject,
      updatedTrack: targetTrack,
      insertedDevice: null,
      error: `Device template "${templateId}" is not registered in the verified DSP library.`,
    };
  }

  if (!BROWSER_SUPPORTED_DEVICE_TAGS.has(template.xmlTag)) {
    return {
      project: fallbackProject,
      updatedTrack: targetTrack,
      insertedDevice: null,
      error: `Device "${template.displayName}" does not have a browser DSP backend and cannot be inserted as a decorative placeholder.`,
    };
  }

  if (targetTrack.devices.length >= MAX_CHANNEL_INSERT_SLOTS) {
    return {
      project: fallbackProject,
      updatedTrack: targetTrack,
      insertedDevice: null,
      error: `Channel strip "${targetTrack.name}" has reached its 10-slot insert capacity (${MAX_CHANNEL_INSERT_SLOTS}/${MAX_CHANNEL_INSERT_SLOTS}).`,
    };
  }

  const contract = getAbletonDeviceContract(template.xmlTag);
  if (contract && contract.maxInstancesPerTrack > 0) {
    const existingActiveCount = targetTrack.devices.filter(
      (d) => !d.bypassed && d.xmlTag === template.xmlTag
    ).length;
    if (existingActiveCount >= contract.maxInstancesPerTrack) {
      return {
        project: fallbackProject,
        updatedTrack: targetTrack,
        insertedDevice: null,
        error: `DEVICE_CHAIN_CONTRACT: Track "${targetTrack.name}" already has ${existingActiveCount} active instance(s) of <${template.xmlTag}> (maxInstancesPerTrack=${contract.maxInstancesPerTrack}).`,
      };
    }
  }

  const newDeviceId = `${targetTrack.id}_ins_${Date.now()}_${targetTrack.devices.length + 1}`;
  const newDevice: AbletonDevice = syncDeviceConversionRecord({
    id: newDeviceId,
    xmlTag: template.xmlTag,
    displayName: template.displayName,
    category: template.category,
    parameters: template.defaultParameters.map((p) => ({ ...p })),
    bypassed: false,
    isUserCreated: false,
    browserDspSupported: true,
  });

  const nextDevices = [...targetTrack.devices];
  if (
    typeof targetSlotIndex === 'number' &&
    targetSlotIndex >= 0 &&
    targetSlotIndex <= nextDevices.length
  ) {
    nextDevices.splice(targetSlotIndex, 0, newDevice);
  } else if (isMidiProcessorDeviceTag(template.xmlTag)) {
    // Default insertion position for a MIDI processor is before the first instrument or audio effect
    const firstInstOrAudioIdx = nextDevices.findIndex(
      (d) => !isMidiProcessorDeviceTag(d.xmlTag || d.type || '')
    );
    if (firstInstOrAudioIdx >= 0) {
      nextDevices.splice(firstInstOrAudioIdx, 0, newDevice);
    } else {
      nextDevices.push(newDevice);
    }
  } else if (isInstrumentDeviceTag(template.xmlTag)) {
    // Default insertion position for an instrument is after MIDI processors and before audio effects
    const firstAudioIdx = nextDevices.findIndex(
      (d) =>
        !isMidiProcessorDeviceTag(d.xmlTag || d.type || '') &&
        !isInstrumentDeviceTag(d.xmlTag || d.type || '')
    );
    if (firstAudioIdx >= 0) {
      nextDevices.splice(firstAudioIdx, 0, newDevice);
    } else {
      nextDevices.push(newDevice);
    }
  } else {
    nextDevices.push(newDevice);
  }

  const candidateViolations = validateTrackDeviceChainOrderingAndCounts({
    ...targetTrack,
    devices: nextDevices,
  });
  if (candidateViolations.length > 0) {
    return {
      project: fallbackProject,
      updatedTrack: targetTrack,
      insertedDevice: null,
      error: `DEVICE_CHAIN_CONTRACT: ${candidateViolations[0].reason}`,
    };
  }

  const updatedTrack: AbletonTrack = {
    ...targetTrack,
    devices: nextDevices,
    instrumentDeleted: isInstrumentDeviceTag(template.xmlTag)
      ? false
      : targetTrack.instrumentDeleted,
    dspConfigRevision: (targetTrack.dspConfigRevision || 1) + 1,
  };

  let updatedXml = fallbackProject.rawXmlModified;
  if (updatedXml) {
    const parser = new DOMParser();
    const sanitized = updatedXml.replace(/xmlns(:[a-zA-Z0-9_-]+)?="[^"]*"/g, '');
    const xmlDoc = parser.parseFromString(sanitized, 'application/xml');
    const trackEl = Array.from(
      xmlDoc.querySelectorAll('Tracks > MidiTrack, Tracks > AudioTrack')
    ).find((el) => el.getAttribute('Id') === targetTrack.id);

    if (trackEl) {
      let devicesContainer =
        trackEl.querySelector('DeviceChain > MidiToAudioDeviceChain > Devices') ||
        trackEl.querySelector('DeviceChain > Devices');
      if (!devicesContainer) {
        const dc =
          trackEl.querySelector('DeviceChain') ||
          trackEl.appendChild(xmlDoc.createElement('DeviceChain'));
        const m2a = xmlDoc.createElement('MidiToAudioDeviceChain');
        devicesContainer = xmlDoc.createElement('Devices');
        m2a.appendChild(devicesContainer);
        dc.appendChild(m2a);
      }
      const devDoc = new DOMParser().parseFromString(template.xmlSnippet, 'application/xml');
      const importedNode = xmlDoc.importNode(devDoc.documentElement, true);
      importedNode.setAttribute('Id', newDeviceId);
      const children = Array.from(devicesContainer.children);
      if (
        typeof targetSlotIndex === 'number' &&
        targetSlotIndex >= 0 &&
        targetSlotIndex < children.length
      ) {
        devicesContainer.insertBefore(importedNode, children[targetSlotIndex]);
      } else {
        devicesContainer.appendChild(importedNode);
      }
    }
    updatedXml = formatXmlString(new XMLSerializer().serializeToString(xmlDoc));
  }

  const updatedTracks = fallbackProject.tracks.map((t) =>
    t.id === targetTrack.id ? updatedTrack : t
  );

  return {
    project: {
      ...fallbackProject,
      revision: (fallbackProject.revision || 1) + 1,
      projectRevision: (fallbackProject.projectRevision || fallbackProject.revision || 1) + 1,
      tracks: updatedTracks,
      rawXmlModified: updatedXml,
      rawXml: updatedXml,
      lastActionLog: `Inserted ${newDevice.displayName} into slot #${
        typeof targetSlotIndex === 'number' ? targetSlotIndex + 1 : targetTrack.devices.length + 1
      } on ${targetTrack.name}.`,
    },
    updatedTrack,
    insertedDevice: newDevice,
  };
}

/**
 * Toggles insert bypass on a channel strip device and updates <IsOn><Manual Value="..."/></IsOn> in XML.
 * Supports both (project, trackId, deviceId) and (track, deviceId) call signatures.
 */
export function toggleChannelInsertBypass(
  project: AbletonProjectState,
  trackId: string,
  deviceId: string
): AbletonProjectState;
export function toggleChannelInsertBypass(track: AbletonTrack, deviceId: string): AbletonTrack;
export function toggleChannelInsertBypass(
  projectOrTrack: AbletonProjectState | AbletonTrack,
  trackIdOrDeviceId: string,
  deviceIdMaybe?: string
): AbletonProjectState | AbletonTrack {
  if (!('tracks' in projectOrTrack)) {
    const track = projectOrTrack as AbletonTrack;
    const deviceId = trackIdOrDeviceId;
    return {
      ...track,
      dspConfigRevision: (track.dspConfigRevision || 1) + 1,
      devices: track.devices.map((d) =>
        d.id === deviceId ? { ...d, bypassed: !d.bypassed } : d
      ),
    };
  }

  const project = projectOrTrack as AbletonProjectState;
  const trackId = trackIdOrDeviceId;
  const deviceId = deviceIdMaybe || '';

  let targetBypassState = false;
  const updatedTracks = project.tracks.map((t) => {
    if (t.id !== trackId) return t;
    return {
      ...t,
      dspConfigRevision: (t.dspConfigRevision || 1) + 1,
      devices: t.devices.map((d) => {
        if (d.id !== deviceId) return d;
        targetBypassState = !d.bypassed;
        return { ...d, bypassed: targetBypassState };
      }),
    };
  });

  const parser = new DOMParser();
  const sanitized = project.rawXmlModified.replace(/xmlns(:[a-zA-Z0-9_-]+)?="[^"]*"/g, '');
  const xmlDoc = parser.parseFromString(sanitized, 'application/xml');
  const trackEl = Array.from(
    xmlDoc.querySelectorAll('Tracks > MidiTrack, Tracks > AudioTrack')
  ).find((el) => el.getAttribute('Id') === trackId);

  if (trackEl) {
    const devEl = Array.from(
      trackEl.querySelectorAll(
        'DeviceChain > MidiToAudioDeviceChain > Devices > *, DeviceChain > Devices > *'
      )
    ).find((el) => el.getAttribute('Id') === deviceId);
    if (devEl) {
      let isOnManual = devEl.querySelector('IsOn > Manual');
      if (!isOnManual) {
        const isOn = devEl.querySelector('IsOn') || devEl.appendChild(xmlDoc.createElement('IsOn'));
        isOnManual = xmlDoc.createElement('Manual');
        isOn.appendChild(isOnManual);
      }
      isOnManual.setAttribute('Value', targetBypassState ? 'false' : 'true');
    }
  }

  const updatedXml = formatXmlString(new XMLSerializer().serializeToString(xmlDoc));

  return {
    ...project,
    revision: (project.revision || 1) + 1,
    projectRevision: (project.projectRevision || project.revision || 1) + 1,
    tracks: updatedTracks,
    rawXmlModified: updatedXml,
    rawXml: updatedXml,
    lastActionLog: `${targetBypassState ? 'Bypassed' : 'Enabled'} insert device ${deviceId} on Track #${trackId}.`,
  };
}

/**
 * Reorders an insert device within a track's 10-slot insert chain and synchronizes the XML DOM order.
 * Supports both (project, trackId, fromIndex, toIndex) and (track, fromIndex, toIndex).
 */
export function reorderChannelInsertDevice(
  project: AbletonProjectState,
  trackId: string,
  fromIndex: number,
  toIndex: number
): AbletonProjectState;
export function reorderChannelInsertDevice(
  track: AbletonTrack,
  fromIndex: number,
  toIndex: number
): AbletonTrack;
export function reorderChannelInsertDevice(
  projectOrTrack: AbletonProjectState | AbletonTrack,
  trackIdOrFromIndex: string | number,
  fromIndexOrToIndex: number,
  toIndexMaybe?: number
): AbletonProjectState | AbletonTrack {
  if (!('tracks' in projectOrTrack)) {
    const track = projectOrTrack as AbletonTrack;
    const fromIndex = Number(trackIdOrFromIndex);
    const toIndex = fromIndexOrToIndex;
    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= track.devices.length ||
      toIndex >= track.devices.length ||
      fromIndex === toIndex
    ) {
      return track;
    }
    const reordered = [...track.devices];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    return {
      ...track,
      devices: reordered,
      dspConfigRevision: (track.dspConfigRevision || 1) + 1,
    };
  }

  const project = projectOrTrack as AbletonProjectState;
  const trackId = String(trackIdOrFromIndex);
  const fromIndex = fromIndexOrToIndex;
  const toIndex = toIndexMaybe ?? 0;

  const targetTrack = project.tracks.find((t) => t.id === trackId);
  if (!targetTrack) return project;
  if (
    fromIndex < 0 ||
    toIndex < 0 ||
    fromIndex >= targetTrack.devices.length ||
    toIndex >= targetTrack.devices.length ||
    fromIndex === toIndex
  ) {
    return project;
  }

  const reordered = [...targetTrack.devices];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);

  const parser = new DOMParser();
  const sanitized = project.rawXmlModified.replace(/xmlns(:[a-zA-Z0-9_-]+)?="[^"]*"/g, '');
  const xmlDoc = parser.parseFromString(sanitized, 'application/xml');
  const trackEl = Array.from(
    xmlDoc.querySelectorAll('Tracks > MidiTrack, Tracks > AudioTrack')
  ).find((el) => el.getAttribute('Id') === trackId);

  if (trackEl) {
    const devicesContainer =
      trackEl.querySelector('DeviceChain > MidiToAudioDeviceChain > Devices') ||
      trackEl.querySelector('DeviceChain > Devices');
    if (devicesContainer) {
      const xmlChildren = Array.from(devicesContainer.children);
      if (fromIndex < xmlChildren.length && toIndex < xmlChildren.length) {
        const [movedEl] = xmlChildren.splice(fromIndex, 1);
        xmlChildren.splice(toIndex, 0, movedEl);
        devicesContainer.innerHTML = '';
        xmlChildren.forEach((child) => devicesContainer.appendChild(child));
      }
    }
  }

  const updatedXml = formatXmlString(new XMLSerializer().serializeToString(xmlDoc));

  return {
    ...project,
    revision: (project.revision || 1) + 1,
    projectRevision: (project.projectRevision || project.revision || 1) + 1,
    tracks: project.tracks.map((t) =>
      t.id === trackId
        ? { ...t, devices: reordered, dspConfigRevision: (t.dspConfigRevision || 1) + 1 }
        : t
    ),
    rawXmlModified: updatedXml,
    rawXml: updatedXml,
    lastActionLog: `Reordered ${moved.displayName} from slot #${fromIndex + 1} to slot #${toIndex + 1} on ${targetTrack.name}.`,
  };
}

/**
 * Updates a parameter on a specific channel strip insert or instrument device,
 * atomically regenerates any per-instance DeviceConversionRecord, and increments dspConfigRevision.
 */
export function updateChannelInsertParam(
  project: AbletonProjectState,
  trackId: string,
  deviceId: string,
  paramName: string,
  newValue: string | number,
  options?: { regenerateConversion?: boolean }
): AbletonProjectState {
  const shouldRegenerate = options?.regenerateConversion !== false;
  const updatedTracks = project.tracks.map((t) => {
    if (t.id !== trackId) return t;
    return {
      ...t,
      dspConfigRevision: (t.dspConfigRevision || 1) + 1,
      devices: t.devices.map((d) => {
        if (d.id !== deviceId) return d;
        const hasExistingParam = d.parameters.some(
          (p) => p.name.toLowerCase() === paramName.toLowerCase()
        );
        const nextParameters = hasExistingParam
          ? d.parameters.map((p) =>
              p.name.toLowerCase() === paramName.toLowerCase() ? { ...p, value: newValue } : p
            )
          : [...d.parameters, { name: paramName, value: newValue }];
        const nextDevice: AbletonDevice = {
          ...d,
          parameters: nextParameters,
        };
        return shouldRegenerate ? syncDeviceConversionRecord(nextDevice) : nextDevice;
      }),
    };
  });

  return {
    ...project,
    revision: (project.revision || 1) + 1,
    projectRevision: (project.projectRevision || project.revision || 1) + 1,
    tracks: updatedTracks,
    lastActionLog: `Updated ${paramName} = ${newValue} on device ${deviceId} (Track #${trackId}).`,
  };
}

/**
 * Removes a device (instrument, MIDI effect, or audio insert) from a track's device chain
 * and increments dspConfigRevision so live and offline audio graphs reconcile immediately.
 */
export function removeChannelInsertDevice(
  project: AbletonProjectState,
  trackId: string,
  deviceId: string
): AbletonProjectState {
  const targetTrack = project.tracks.find((t) => t.id === trackId);
  if (!targetTrack) return project;
  const removed = targetTrack.devices.find((d) => d.id === deviceId);
  if (!removed) return project;

  let updatedXml = project.rawXmlModified;
  if (updatedXml) {
    const parser = new DOMParser();
    const sanitized = updatedXml.replace(/xmlns(:[a-zA-Z0-9_-]+)?="[^"]*"/g, '');
    const xmlDoc = parser.parseFromString(sanitized, 'application/xml');
    const trackEl = Array.from(
      xmlDoc.querySelectorAll('Tracks > MidiTrack, Tracks > AudioTrack')
    ).find((el) => el.getAttribute('Id') === trackId);
    if (trackEl) {
      const devEl = Array.from(
        trackEl.querySelectorAll(
          'DeviceChain > MidiToAudioDeviceChain > Devices > *, DeviceChain > Devices > *'
        )
      ).find((el) => el.getAttribute('Id') === deviceId);
      if (devEl && devEl.parentNode) {
        devEl.parentNode.removeChild(devEl);
      }
    }
    updatedXml = formatXmlString(new XMLSerializer().serializeToString(xmlDoc));
  }

  return {
    ...project,
    revision: (project.revision || 1) + 1,
    projectRevision: (project.projectRevision || project.revision || 1) + 1,
    tracks: project.tracks.map((t) =>
      t.id === trackId
        ? {
            ...t,
            devices: t.devices.filter((d) => d.id !== deviceId),
            instrumentDeleted: isInstrumentDeviceTag(removed.xmlTag || removed.type || '')
              ? true
              : t.instrumentDeleted,
            dspConfigRevision: (t.dspConfigRevision || 1) + 1,
          }
        : t
    ),
    rawXmlModified: updatedXml,
    rawXml: updatedXml,
    lastActionLog: `Removed device ${removed.displayName} (${deviceId}) from ${targetTrack.name}.`,
  };
}

/**
 * Replaces (or installs) the primary instrument device on a track while preserving its
 * compositional archetype and downstream audio effect inserts.
 */
export function replaceTrackInstrumentDevice(
  project: AbletonProjectState,
  trackId: string,
  instrumentTemplateIdOrTag: string
): AbletonProjectState {
  const targetTrack = project.tracks.find((t) => t.id === trackId);
  if (!targetTrack) {
    throw new Error(`Track ${trackId} not found.`);
  }
  const template = ABLETON_BUILTIN_LIBRARY.find(
    (d) =>
      isInstrumentDeviceTag(d.xmlTag) &&
      (d.id === instrumentTemplateIdOrTag ||
        d.xmlTag.toLowerCase() === instrumentTemplateIdOrTag.toLowerCase() ||
        d.displayName.toLowerCase().includes(instrumentTemplateIdOrTag.toLowerCase()))
  );
  if (!template) {
    throw new Error(`Instrument template "${instrumentTemplateIdOrTag}" not found in verified library.`);
  }

  const existingInstIndex = targetTrack.devices.findIndex((d) => isInstrumentDeviceTag(d.xmlTag));
  let intermediateProject = project;
  let insertSlotIndex = 0;

  if (existingInstIndex >= 0) {
    insertSlotIndex = existingInstIndex;
    intermediateProject = removeChannelInsertDevice(
      project,
      trackId,
      targetTrack.devices[existingInstIndex].id
    );
  } else {
    // Place after any leading MIDI effects, before audio effects
    const lastMidiIdx = targetTrack.devices.reduce(
      (acc, d, idx) => (d.category === 'midi_effect' ? idx : acc),
      -1
    );
    insertSlotIndex = lastMidiIdx + 1;
  }

  const res = insertDeviceIntoChannelStrip(
    intermediateProject,
    trackId,
    template.id,
    insertSlotIndex
  );
  if (res.error) {
    throw new Error(res.error);
  }
  return res.project;
}

