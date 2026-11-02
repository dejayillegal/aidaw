import type { AbletonProjectState } from '../types/ableton';

export type AbletonCapabilityStatus =
  | 'executable'
  | 'preserved-only'
  | 'converted'
  | 'unsupported';

export interface AbletonCapabilityEntry {
  id: string;
  category:
    | 'instrument'
    | 'audio_effect'
    | 'midi_effect'
    | 'routing'
    | 'automation'
    | 'session'
    | 'timeline'
    | 'media'
    | 'rack';
  xmlTagOrFeature: string;
  displayName: string;
  status: AbletonCapabilityStatus;
  maxInstancesPerTrack?: number;
  executedParameters: string[];
  preservedXmlScope: string;
  limitationsAndWarnings: string;
}

export const MAX_EXECUTABLE_INSERT_DEVICES = 10;

export const ABLETON_CAPABILITY_MATRIX: readonly AbletonCapabilityEntry[] = [
  {
    id: 'inst_drum_group',
    category: 'instrument',
    xmlTagOrFeature: 'DrumGroupDevice',
    displayName: 'Drum Rack (909 Core Synthesis Approximation)',
    status: 'executable',
    maxInstancesPerTrack: 1,
    executedParameters: ['MacroControls.0', 'Pitch', 'Velocity', 'Probability'],
    preservedXmlScope: 'Full <DrumGroupDevice> XML subtree preserved on import/export',
    limitationsAndWarnings:
      'Browser synthesis approximates 909 drum voice archetypes; arbitrary multi-sample chains inside Drum Rack branches are preserved in XML but not sample-decoded unless explicitly loaded.',
  },
  {
    id: 'inst_operator',
    category: 'instrument',
    xmlTagOrFeature: 'Operator',
    displayName: 'Operator FM / Sub Synth',
    status: 'executable',
    maxInstancesPerTrack: 1,
    executedParameters: ['Osc A Wave', 'Osc A Level', 'Coarse', 'FilterCutoffHz', 'FilterResonance'],
    preservedXmlScope: 'Full <Operator> XML subtree preserved on import/export',
    limitationsAndWarnings:
      'Executes primary FM/Sub-bass synthesis path in shared live/offline Web Audio graph; full 4-operator custom routing algorithms beyond primary carrier/modulator are preserved in XML.',
  },
  {
    id: 'inst_analog',
    category: 'instrument',
    xmlTagOrFeature: 'UltraAnalog',
    displayName: 'Analog (303 Diode Acid Approximation)',
    status: 'executable',
    maxInstancesPerTrack: 1,
    executedParameters: ['Osc 1 Wave', '303Reso', 'FilterCutoffHz', 'Accent', 'Slide'],
    preservedXmlScope: 'Full <UltraAnalog> XML subtree preserved on import/export',
    limitationsAndWarnings:
      'Executes resonant acid bassline synthesis with slide/accent articulation; dual-filter parallel native routing is preserved in XML.',
  },
  {
    id: 'inst_wavetable',
    category: 'instrument',
    xmlTagOrFeature: 'InstrumentVector',
    displayName: 'Wavetable Synth',
    status: 'executable',
    maxInstancesPerTrack: 1,
    executedParameters: ['FilterCutoffHz', 'FilterResonance', 'Detune', 'PolyVoicing'],
    preservedXmlScope: 'Full <InstrumentVector> XML subtree preserved on import/export',
    limitationsAndWarnings:
      'Executes multi-oscillator detuned synth voicings in browser; custom user wavetable sprite files are preserved by reference only.',
  },
  {
    id: 'inst_drift',
    category: 'instrument',
    xmlTagOrFeature: 'Drift',
    displayName: 'Drift Analog Pad Synth',
    status: 'executable',
    maxInstancesPerTrack: 1,
    executedParameters: ['Drift Mod', 'Stereo Spread', 'FilterCutoffHz', 'FilterResonance'],
    preservedXmlScope: 'Full <Drift> XML subtree preserved on import/export',
    limitationsAndWarnings: 'Executes analog-drift chord pad voices; full MPE per-note pitch-bend lanes are preserved in XML.',
  },
  {
    id: 'inst_collision',
    category: 'instrument',
    xmlTagOrFeature: 'Collision',
    displayName: 'Collision Mallet / Industrial Resonator',
    status: 'executable',
    maxInstancesPerTrack: 1,
    executedParameters: ['FilterCutoffHz', 'FilterResonance', 'StrikeDecay'],
    preservedXmlScope: 'Full <Collision> XML subtree preserved on import/export',
    limitationsAndWarnings: 'Executes metallic industrial percussion synthesis; full dual-resonator physical matrix is preserved in XML.',
  },
  {
    id: 'inst_simpler',
    category: 'instrument',
    xmlTagOrFeature: 'OriginalSimpler',
    displayName: 'Simpler (909 Hat / Ride Voice)',
    status: 'executable',
    maxInstancesPerTrack: 1,
    executedParameters: ['FilterCutoffHz', 'Transpose', 'FineTune', 'Decay'],
    preservedXmlScope: 'Full <OriginalSimpler> XML subtree and <SampleRef> preserved on import/export',
    limitationsAndWarnings:
      'External disk sample paths inside <SampleRef> are preserved in XML; offline/live DSP uses procedural 909 hat/ride synthesis when external sample files are not bundled.',
  },
  {
    id: 'fx_eq_eight',
    category: 'audio_effect',
    xmlTagOrFeature: 'EQEight',
    displayName: 'EQ Eight (3-Band + Surgical Dynamic Notch)',
    status: 'executable',
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    executedParameters: ['Band 1 HPF', 'Sub Notch', 'Notch Gain', 'Notch Q', 'Bypass'],
    preservedXmlScope: 'Full <EQEight> XML subtree preserved on import/export',
    limitationsAndWarnings: 'Executes HPF, surgical sub-notch, and low-shelf bands; bands 4–8 remain preserved in XML.',
  },
  {
    id: 'fx_compressor2',
    category: 'audio_effect',
    xmlTagOrFeature: 'Compressor2',
    displayName: 'Compressor / Sidechain Ducking',
    status: 'executable',
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    executedParameters: ['Threshold', 'Ratio', 'Attack', 'Release', 'SidechainDepth', 'Bypass'],
    preservedXmlScope: 'Full <Compressor2> XML subtree preserved on import/export',
    limitationsAndWarnings: 'Executes dynamics compression and kick-triggered sidechain ducking.',
  },
  {
    id: 'fx_autofilter',
    category: 'audio_effect',
    xmlTagOrFeature: 'AutoFilter',
    displayName: 'Auto Filter',
    status: 'executable',
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    executedParameters: ['FilterType', 'Cutoff', 'Resonance', 'Bypass'],
    preservedXmlScope: 'Full <AutoFilter> XML subtree preserved on import/export',
    limitationsAndWarnings: 'Executes resonant biquad filtering and energy envelope modulation.',
  },
  {
    id: 'fx_saturator_roar_overdrive',
    category: 'audio_effect',
    xmlTagOrFeature: 'Saturator|Roar|Overdrive',
    displayName: 'Harmonic Saturation & Waveshaper Distortion Inserts',
    status: 'executable',
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    executedParameters: ['Drive', 'Bypass'],
    preservedXmlScope: 'Full native XML subtree preserved on import/export',
    limitationsAndWarnings:
      'Executed via dedicated Web Audio WaveShaper insert nodes within the 10-insert-per-track limit.',
  },
  {
    id: 'fx_delay_chorus_limiter_utility',
    category: 'audio_effect',
    xmlTagOrFeature: 'Delay|Echo|ChorusEnsemble|Limiter|GlueCompressor|Utility',
    displayName: 'Delay, Chorus, Dynamics & Utility Inserts',
    status: 'executable',
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    executedParameters: ['Feedback', 'Ceiling', 'Gain', 'Bypass'],
    preservedXmlScope: 'Full native XML subtree preserved on import/export',
    limitationsAndWarnings:
      'Executed via dedicated Web Audio Delay/DynamicsCompressor/Gain insert nodes within the 10-insert-per-track limit.',
  },
  {
    id: 'fx_converted_bus_and_drive',
    category: 'audio_effect',
    xmlTagOrFeature: 'DrumBuss|Reverb|HybridReverb|Erosion|AutoPan|Lfo',
    displayName: 'Converted Bus/Send & Gain-Approximated Native Effects',
    status: 'converted',
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    executedParameters: ['Drive', 'DecayTime', 'DryWet', 'Rate', 'Depth', 'Bypass'],
    preservedXmlScope: 'Full native XML subtree preserved on import/export',
    limitationsAndWarnings:
      'Approximated via channel drive multiplier (DrumBuss), shared Warehouse Reverb return bus (Reverb/HybridReverb), or voice LFO modulation rather than discrete per-insert convolver/autopan graphs.',
  },
  {
    id: 'midi_fx_converted_note_generators',
    category: 'midi_effect',
    xmlTagOrFeature: 'MidiChord|MidiArpeggiator',
    displayName: 'Converted Ableton MIDI Chord & Arpeggiator',
    status: 'converted',
    executedParameters: ['Shift1', 'Shift2', 'Shift3', 'Rate', 'Bypass'],
    preservedXmlScope: 'Preserved verbatim in <DeviceChain> XML; chord/arp notes materialized in <MidiNoteEvent>',
    limitationsAndWarnings:
      'Chord and arpeggio voicings are materialized into <MidiNoteEvent> clip data via studio commands rather than evaluated as a live MIDI stream filter.',
  },
  {
    id: 'midi_and_audio_preserved_only',
    category: 'midi_effect',
    xmlTagOrFeature: 'MidiScale|MidiVelocity|MidiNoteLength|MidiPitch|MidiRandom|Pedal|Redux|Redux2|PhaserFlanger|PhaserNew|Spectrum',
    displayName: 'Preserved-Only Native MIDI & Audio Effects',
    status: 'preserved-only',
    executedParameters: ['Bypass'],
    preservedXmlScope: 'Preserved verbatim in <DeviceChain> XML',
    limitationsAndWarnings:
      'No browser DSP processor is implemented; active instances are flagged as preserved-only and require bypass before live/offline DSP execution.',
  },
  {
    id: 'rack_group_devices',
    category: 'rack',
    xmlTagOrFeature: 'InstrumentGroupDevice|AudioEffectGroupDevice|MidiEffectGroupDevice',
    displayName: 'Instrument / Audio / MIDI Effect Racks',
    status: 'preserved-only',
    executedParameters: ['MacroControls.0'],
    preservedXmlScope: 'Nested <BranchPresets> and rack chains preserved in XML when untouched',
    limitationsAndWarnings:
      'Arbitrary multi-branch parallel rack graphs and proprietary Pack presets are preserved in XML but not executed as nested DSP graphs.',
  },
  {
    id: 'automation_envelopes',
    category: 'automation',
    xmlTagOrFeature: 'AutomationEnvelopes',
    displayName: 'Track Filter-Energy & Native Parameter Automation',
    status: 'converted',
    executedParameters: ['parametric:filter-energy'],
    preservedXmlScope: 'Native <AutomationEnvelopes> preserved in XML; app filter-energy lane stored in <ParametricTrackState>',
    limitationsAndWarnings:
      'Browser executes normalized filter-energy automation lane; native arbitrary parameter-target envelopes are preserved in XML with a compatibility warning.',
  },
  {
    id: 'session_performance',
    category: 'session',
    xmlTagOrFeature: 'ParametricSessionState',
    displayName: 'Session Matrix Clip Launch & Arrangement Capture',
    status: 'converted',
    executedParameters: ['quantizationBeats', 'events', 'sessionClips'],
    preservedXmlScope: 'Stored in v3 native snapshot and <ParametricSessionState>; captured clips written to <ArrangerAutomation>',
    limitationsAndWarnings:
      'Session launches must be captured into Arrangement before WAV export or native Ableton Arrangement playback.',
  },
  {
    id: 'external_vst_au_m4l',
    category: 'rack',
    xmlTagOrFeature: 'PluginDevice|AuPluginDevice|MxDeviceAudioEffect|MxDeviceInstrument|MxDeviceMidiEffect',
    displayName: 'Third-Party VST/AU Plugins & Max for Live',
    status: 'unsupported',
    executedParameters: [],
    preservedXmlScope: 'Preserved in XML if untouched; flagged as unsupported for offline/live DSP synthesis',
    limitationsAndWarnings: 'Third-party binary plugins and Max for Live devices cannot execute in browser/Android WebView.',
  },
] as const;

export const EXECUTABLE_DEVICE_TAGS = new Set<string>([
  'DrumGroupDevice',
  'Operator',
  'UltraAnalog',
  'InstrumentVector',
  'Drift',
  'Collision',
  'OriginalSimpler',
  'EQEight',
  'Compressor2',
  'GlueCompressor',
  'AutoFilter',
  'Saturator',
  'Roar',
  'Overdrive',
  'Delay',
  'Echo',
  'ChorusEnsemble',
  'Limiter',
  'Utility',
]);

export const CONVERTED_DEVICE_TAGS = new Set<string>([
  'DrumBuss',
  'Reverb',
  'HybridReverb',
  'Erosion',
  'AutoPan',
  'MidiChord',
  'MidiArpeggiator',
  'Lfo',
]);

export const PRESERVED_ONLY_DEVICE_TAGS = new Set<string>([
  'InstrumentGroupDevice',
  'AudioEffectGroupDevice',
  'MidiEffectGroupDevice',
  'MidiScale',
  'MidiVelocity',
  'MidiNoteLength',
  'MidiPitch',
  'MidiRandom',
  'Pedal',
  'Redux',
  'Redux2',
  'PhaserFlanger',
  'PhaserNew',
  'Spectrum',
]);

export const UNSUPPORTED_DEVICE_TAGS = new Set<string>([
  'PluginDevice',
  'AuPluginDevice',
  'MxDeviceAudioEffect',
  'MxDeviceInstrument',
  'MxDeviceMidiEffect',
]);

export function classifyAbletonDeviceTag(xmlTag: string): AbletonCapabilityStatus {
  if (EXECUTABLE_DEVICE_TAGS.has(xmlTag)) return 'executable';
  if (CONVERTED_DEVICE_TAGS.has(xmlTag)) return 'converted';
  if (PRESERVED_ONLY_DEVICE_TAGS.has(xmlTag)) return 'preserved-only';
  return 'unsupported';
}

export interface ProjectCapabilityAuditReport {
  executableTrackCount: number;
  insertLimitExceededTracks: { trackId: string; trackName: string; deviceCount: number; maxAllowed: number }[];
  unsupportedDevices: { trackId: string; trackName: string; deviceId: string; xmlTag: string }[];
  preservedOnlyDevices: { trackId: string; trackName: string; deviceId: string; xmlTag: string }[];
  convertedDevices: { trackId: string; trackName: string; deviceId: string; xmlTag: string }[];
  warnings: string[];
  canExecuteFullDsp: boolean;
}

export function auditProjectCapabilities(project: AbletonProjectState): ProjectCapabilityAuditReport {
  const insertLimitExceededTracks: ProjectCapabilityAuditReport['insertLimitExceededTracks'] = [];
  const unsupportedDevices: ProjectCapabilityAuditReport['unsupportedDevices'] = [];
  const preservedOnlyDevices: ProjectCapabilityAuditReport['preservedOnlyDevices'] = [];
  const convertedDevices: ProjectCapabilityAuditReport['convertedDevices'] = [];
  const warnings = [...(project.compatibilityWarnings || [])];

  let executableTrackCount = 0;
  for (const track of project.tracks) {
    if (track.devices.length > MAX_EXECUTABLE_INSERT_DEVICES) {
      insertLimitExceededTracks.push({
        trackId: track.id,
        trackName: track.name,
        deviceCount: track.devices.length,
        maxAllowed: MAX_EXECUTABLE_INSERT_DEVICES,
      });
      warnings.push(
        `INSERT_LIMIT: Track "${track.name}" (${track.id}) has ${track.devices.length} devices (max executable=${MAX_EXECUTABLE_INSERT_DEVICES}).`
      );
    } else {
      executableTrackCount++;
    }

    for (const dev of track.devices) {
      if (dev.bypassed) continue;
      const status = classifyAbletonDeviceTag(dev.xmlTag);
      if (status === 'unsupported' || dev.browserDspSupported === false) {
        unsupportedDevices.push({
          trackId: track.id,
          trackName: track.name,
          deviceId: dev.id,
          xmlTag: dev.xmlTag,
        });
        warnings.push(
          `UNSUPPORTED_DEVICE: Track "${track.name}" (${track.id}) contains unsupported device <${dev.xmlTag}> (${dev.id}).`
        );
      } else if (status === 'preserved-only') {
        preservedOnlyDevices.push({
          trackId: track.id,
          trackName: track.name,
          deviceId: dev.id,
          xmlTag: dev.xmlTag,
        });
        warnings.push(
          `PRESERVED_ONLY_DEVICE: Track "${track.name}" (${track.id}) contains preserved-only device <${dev.xmlTag}> (${dev.id}).`
        );
      } else if (status === 'converted') {
        convertedDevices.push({
          trackId: track.id,
          trackName: track.name,
          deviceId: dev.id,
          xmlTag: dev.xmlTag,
        });
      }
    }
  }

  return {
    executableTrackCount,
    insertLimitExceededTracks,
    unsupportedDevices,
    preservedOnlyDevices,
    convertedDevices,
    warnings,
    canExecuteFullDsp:
      insertLimitExceededTracks.length === 0 &&
      unsupportedDevices.length === 0 &&
      preservedOnlyDevices.length === 0,
  };
}
