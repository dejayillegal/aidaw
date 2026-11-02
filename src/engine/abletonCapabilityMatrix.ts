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
    id: 'fx_ saturator_roar_overdrive_drumbuss',
    category: 'audio_effect',
    xmlTagOrFeature: 'Saturator|Roar|Overdrive|DrumBuss|Pedal|Erosion|Redux',
    displayName: 'Harmonic Saturation / Distortion Inserts',
    status: 'executable',
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    executedParameters: ['Drive', 'Boom', 'DryWet', 'Bypass'],
    preservedXmlScope: 'Full native XML subtree preserved on import/export',
    limitationsAndWarnings:
      'Up to 10 insert devices per track are executed in the shared live/offline DSP chain; >10 inserts are explicitly rejected with INSERT_LIMIT.',
  },
  {
    id: 'fx_time_spatial',
    category: 'audio_effect',
    xmlTagOrFeature: 'Reverb|HybridReverb|Delay|Echo|ChorusEnsemble|PhaserFlanger|AutoPan|Limiter|GlueCompressor|Utility|Spectrum',
    displayName: 'Spatial, Delay, Modulation & Dynamics Inserts',
    status: 'executable',
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    executedParameters: ['DecayTime', 'DryWet', 'Feedback', 'Ceiling', 'Gain', 'Bypass'],
    preservedXmlScope: 'Full native XML subtree preserved on import/export',
    limitationsAndWarnings: 'Executed in shared track/master DSP graph within the 10-insert-per-track limit.',
  },
  {
    id: 'midi_fx_chord_arp',
    category: 'midi_effect',
    xmlTagOrFeature: 'MidiChord|MidiArpeggiator|MidiScale|MidiVelocity|MidiNoteLength|MidiPitch|MidiRandom',
    displayName: 'Ableton MIDI Effects',
    status: 'preserved-only',
    executedParameters: ['Bypass'],
    preservedXmlScope: 'Preserved verbatim in <DeviceChain> XML',
    limitationsAndWarnings:
      'Chord/grid/velocity transformations are applied explicitly into <MidiNoteEvent> data via studio commands; native real-time MIDI device evaluation is preserved in XML.',
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

export interface ProjectCapabilityAuditReport {
  executableTrackCount: number;
  insertLimitExceededTracks: { trackId: string; trackName: string; deviceCount: number; maxAllowed: number }[];
  unsupportedDevices: { trackId: string; trackName: string; deviceId: string; xmlTag: string }[];
  preservedOnlyDevices: { trackId: string; trackName: string; deviceId: string; xmlTag: string }[];
  warnings: string[];
  canExecuteFullDsp: boolean;
}

export function auditProjectCapabilities(project: AbletonProjectState): ProjectCapabilityAuditReport {
  const insertLimitExceededTracks: ProjectCapabilityAuditReport['insertLimitExceededTracks'] = [];
  const unsupportedDevices: ProjectCapabilityAuditReport['unsupportedDevices'] = [];
  const preservedOnlyDevices: ProjectCapabilityAuditReport['preservedOnlyDevices'] = [];
  const warnings = [...(project.compatibilityWarnings || [])];

  const unsupportedTags = new Set([
    'PluginDevice',
    'AuPluginDevice',
    'MxDeviceAudioEffect',
    'MxDeviceInstrument',
    'MxDeviceMidiEffect',
  ]);
  const preservedOnlyTags = new Set([
    'InstrumentGroupDevice',
    'AudioEffectGroupDevice',
    'MidiEffectGroupDevice',
    'MidiChord',
    'MidiArpeggiator',
    'MidiScale',
    'MidiVelocity',
    'MidiNoteLength',
    'MidiPitch',
    'MidiRandom',
  ]);

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
      if (unsupportedTags.has(dev.xmlTag) || dev.browserDspSupported === false) {
        unsupportedDevices.push({
          trackId: track.id,
          trackName: track.name,
          deviceId: dev.id,
          xmlTag: dev.xmlTag,
        });
      } else if (preservedOnlyTags.has(dev.xmlTag)) {
        preservedOnlyDevices.push({
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
    warnings,
    canExecuteFullDsp: insertLimitExceededTracks.length === 0 && unsupportedDevices.length === 0,
  };
}
