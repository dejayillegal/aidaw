import type {
  AbletonDevice,
  AbletonProjectState,
  AbletonTrack,
  DeviceConversionRecord,
  MidiNoteEvent,
} from '../types/ableton';

export type AbletonCapabilityStatus =
  | 'executable'
  | 'preserved-only'
  | 'converted'
  | 'unsupported';

export type AbletonDeviceKind =
  | 'midi_processor'
  | 'instrument'
  | 'audio_effect'
  | 'modulator'
  | 'preserved_native_structure'
  | 'external_plugin';

export interface AbletonDeviceParamSpec {
  name: string;
  aliases?: readonly string[];
  min: number;
  max: number;
  defaultValue: number | string;
  unit: string;
  description: string;
}

export interface AbletonDeviceContract {
  xmlTag: string;
  displayName: string;
  kind: AbletonDeviceKind;
  status: AbletonCapabilityStatus;
  requiresConversionRecord: boolean;
  conversionKind?: DeviceConversionRecord['conversionKind'];
  maxInstancesPerTrack: number;
  parameterSpecs: readonly AbletonDeviceParamSpec[];
  bypassBehavior: string;
  parameterUpdateBehavior: string;
  disposalBehavior: string;
  routing: 'midi_stream' | 'voice_generator' | 'channel_insert' | 'voice_modulation' | 'none';
  limitations: string;
  requiredTests: readonly string[];
}

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
export const CURRENT_DEVICE_CONVERSION_VERSION = 1;
export const LEGACY_CONVERSION_MIGRATION_V1 = 'legacy_missing_conversion_record_v1';

export const ABLETON_DEVICE_REGISTRY: Record<string, AbletonDeviceContract> = {
  DrumGroupDevice: {
    xmlTag: 'DrumGroupDevice',
    displayName: 'Drum Rack (909 Core Synthesis)',
    kind: 'instrument',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: 1,
    parameterSpecs: [
      { name: 'MacroControls.0', aliases: ['Drive', 'Punch'], min: 0, max: 127, defaultValue: 64, unit: '', description: 'Drum punch and transient drive macro' },
      { name: 'Pitch', aliases: ['Transpose', 'Tune'], min: -24, max: 24, defaultValue: 0, unit: 'st', description: 'Coarse drum pitch offset in semitones' },
      { name: 'Decay', aliases: ['StrikeDecay'], min: 0.05, max: 2.5, defaultValue: 0.42, unit: 's', description: 'Amplitude envelope decay time' },
      { name: 'FilterCutoffHz', aliases: ['Cutoff'], min: 40, max: 18000, defaultValue: 4500, unit: 'Hz', description: 'Voice lowpass filter cutoff' },
    ],
    bypassBehavior: 'Silences instrument note synthesis on the track when bypassed.',
    parameterUpdateBehavior: 'Applies pitch, decay, drive, and filter cutoff on the next scheduled voice and updates active channel synthesis state.',
    disposalBehavior: 'Stops and disconnects active oscillator/noise voice nodes at voice completion or emergency shutdown.',
    routing: 'voice_generator',
    limitations: 'Synthesizes 909/techno drum voices procedurally; arbitrary nested multi-sample chains inside Drum Rack branches remain preserved in XML.',
    requiredTests: ['instrument_selection', 'instrument_bypass', 'instrument_param_response'],
  },
  Operator: {
    xmlTag: 'Operator',
    displayName: 'Operator FM / Sub Synth',
    kind: 'instrument',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: 1,
    parameterSpecs: [
      { name: 'Osc A Wave', aliases: ['Waveform'], min: 0, max: 3, defaultValue: 'Sine', unit: '', description: 'Carrier oscillator waveform' },
      { name: 'Osc A Level', aliases: ['FMDrive', 'ModIndex'], min: 0, max: 1, defaultValue: 0.85, unit: '', description: 'Carrier/FM modulation index level' },
      { name: 'Coarse', aliases: ['Transpose'], min: -24, max: 24, defaultValue: 0, unit: 'st', description: 'FM harmonic ratio / coarse pitch' },
      { name: 'FilterCutoffHz', aliases: ['Cutoff'], min: 40, max: 18000, defaultValue: 1800, unit: 'Hz', description: '24dB lowpass filter cutoff' },
      { name: 'FilterResonance', aliases: ['Resonance'], min: 0.1, max: 0.95, defaultValue: 0.35, unit: '', description: 'Filter resonance Q' },
    ],
    bypassBehavior: 'Silences Operator FM synthesis when bypassed.',
    parameterUpdateBehavior: 'Modulates carrier/modulator FM index, coarse ratio, and filter cutoff/resonance on voice generation.',
    disposalBehavior: 'Disconnects carrier, modulator, filter, and envelope nodes upon voice release.',
    routing: 'voice_generator',
    limitations: 'Executes 2-operator FM + sub carrier synthesis in Web Audio; full 11-algorithm 4-op matrix is preserved in XML.',
    requiredTests: ['instrument_selection', 'instrument_replacement', 'instrument_param_response'],
  },
  UltraAnalog: {
    xmlTag: 'UltraAnalog',
    displayName: 'Analog (303 Diode Acid Synth)',
    kind: 'instrument',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: 1,
    parameterSpecs: [
      { name: 'Osc 1 Wave', aliases: ['Waveform'], min: 0, max: 1, defaultValue: 'Saw', unit: '', description: 'Sawtooth or square acid oscillator' },
      { name: '303Reso', aliases: ['FilterResonance', 'Resonance'], min: 0.1, max: 0.95, defaultValue: 0.78, unit: '', description: 'Diode ladder resonance' },
      { name: 'FilterCutoffHz', aliases: ['Cutoff'], min: 60, max: 16000, defaultValue: 920, unit: 'Hz', description: 'Acid filter base cutoff frequency' },
      { name: 'Accent', aliases: ['EnvMod'], min: 0, max: 1, defaultValue: 0.65, unit: '', description: 'Filter envelope accent sweep depth' },
    ],
    bypassBehavior: 'Silences Analog 303 synthesis when bypassed.',
    parameterUpdateBehavior: 'Updates acid waveform, cutoff sweep, resonance, and accent depth.',
    disposalBehavior: 'Disconnects acid oscillator, waveshaper, and resonant filter nodes after voice release.',
    routing: 'voice_generator',
    limitations: 'Executes monophonic/polyphonic 303 acid voice; dual parallel filter chains remain preserved in XML.',
    requiredTests: ['instrument_selection', 'instrument_replacement', 'instrument_param_response'],
  },
  InstrumentVector: {
    xmlTag: 'InstrumentVector',
    displayName: 'Wavetable Synth',
    kind: 'instrument',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: 1,
    parameterSpecs: [
      { name: 'FilterCutoffHz', aliases: ['Cutoff'], min: 60, max: 18000, defaultValue: 2200, unit: 'Hz', description: 'Wavetable lowpass filter cutoff' },
      { name: 'FilterResonance', aliases: ['Resonance'], min: 0.1, max: 0.95, defaultValue: 0.4, unit: '', description: 'Wavetable filter resonance' },
      { name: 'Detune', aliases: ['UnisonDetune', 'Spread'], min: 0, max: 50, defaultValue: 14, unit: 'ct', description: 'Dual-oscillator unison detune in cents' },
    ],
    bypassBehavior: 'Silences Wavetable synthesis when bypassed.',
    parameterUpdateBehavior: 'Updates unison detune spread and filter cutoff/resonance.',
    disposalBehavior: 'Disconnects detuned oscillator pair and filter nodes on note off.',
    routing: 'voice_generator',
    limitations: 'Executes detuned multi-oscillator wavetable synthesis; external custom wavetable files are preserved by reference.',
    requiredTests: ['instrument_selection', 'instrument_param_response'],
  },
  Drift: {
    xmlTag: 'Drift',
    displayName: 'Drift Analog Pad Synth',
    kind: 'instrument',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: 1,
    parameterSpecs: [
      { name: 'Drift Mod', aliases: ['Drift'], min: 0, max: 1, defaultValue: 0.35, unit: '', description: 'Analog pitch drift depth' },
      { name: 'Stereo Spread', aliases: ['Spread'], min: 0, max: 1, defaultValue: 0.5, unit: '', description: 'Pad voice detune spread' },
      { name: 'FilterCutoffHz', aliases: ['Cutoff'], min: 80, max: 16000, defaultValue: 1600, unit: 'Hz', description: 'Pad lowpass filter cutoff' },
      { name: 'FilterResonance', aliases: ['Resonance'], min: 0.1, max: 0.95, defaultValue: 0.25, unit: '', description: 'Pad filter resonance' },
    ],
    bypassBehavior: 'Silences Drift pad synthesis when bypassed.',
    parameterUpdateBehavior: 'Updates analog pitch drift and pad filter parameters.',
    disposalBehavior: 'Disconnects pad oscillators and envelope nodes upon release.',
    routing: 'voice_generator',
    limitations: 'Executes warm analog-drift pad voices; MPE per-note expression lanes are preserved in XML.',
    requiredTests: ['instrument_selection', 'instrument_param_response'],
  },
  Collision: {
    xmlTag: 'Collision',
    displayName: 'Collision Mallet / Industrial Resonator',
    kind: 'instrument',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: 1,
    parameterSpecs: [
      { name: 'FilterCutoffHz', aliases: ['Cutoff', 'Brightness'], min: 100, max: 16000, defaultValue: 2600, unit: 'Hz', description: 'Resonator modal center frequency' },
      { name: 'FilterResonance', aliases: ['Resonance', 'Material'], min: 0.1, max: 0.98, defaultValue: 0.72, unit: '', description: 'Modal resonator Q factor' },
      { name: 'StrikeDecay', aliases: ['Decay'], min: 0.04, max: 2.0, defaultValue: 0.28, unit: 's', description: 'Resonator decay time' },
    ],
    bypassBehavior: 'Silences Collision modal percussion synthesis when bypassed.',
    parameterUpdateBehavior: 'Updates modal resonator brightness, Q, and decay.',
    disposalBehavior: 'Disconnects exciter and modal resonator nodes upon voice completion.',
    routing: 'voice_generator',
    limitations: 'Executes metallic modal percussion synthesis; dual coupled beam/membrane matrix is preserved in XML.',
    requiredTests: ['instrument_selection', 'instrument_param_response'],
  },
  OriginalSimpler: {
    xmlTag: 'OriginalSimpler',
    displayName: 'Simpler (909 Hat / Metallic Cymbal Voice)',
    kind: 'instrument',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: 1,
    parameterSpecs: [
      { name: 'FilterCutoffHz', aliases: ['Cutoff'], min: 500, max: 18000, defaultValue: 7500, unit: 'Hz', description: 'Highpass/bandpass metallic filter cutoff' },
      { name: 'Transpose', aliases: ['Pitch'], min: -24, max: 24, defaultValue: 0, unit: 'st', description: 'Sample/metallic voice pitch transposition' },
      { name: 'Decay', aliases: ['Release'], min: 0.03, max: 2.5, defaultValue: 0.18, unit: 's', description: 'Cymbal/hat decay duration' },
    ],
    bypassBehavior: 'Silences Simpler voice generation when bypassed.',
    parameterUpdateBehavior: 'Updates metallic voice pitch transposition, filter cutoff, and decay.',
    disposalBehavior: 'Disconnects metallic partial bank and filter nodes upon voice completion.',
    routing: 'voice_generator',
    limitations: 'External disk sample paths in <SampleRef> are preserved in XML; synthesizes procedural 909 hat/ride voices when external samples are not bundled.',
    requiredTests: ['instrument_selection', 'instrument_param_response'],
  },
  EQEight: {
    xmlTag: 'EQEight',
    displayName: 'EQ Eight (3-Band + Dynamic Notch)',
    kind: 'audio_effect',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    parameterSpecs: [
      { name: 'Band 1 HPF', aliases: ['HPF', 'LowCutHz', 'Cutoff'], min: 20, max: 1000, defaultValue: 35, unit: 'Hz', description: 'Band 1 highpass cutoff frequency' },
      { name: 'Sub Notch', aliases: ['NotchFreqHz', 'Freq'], min: 30, max: 4000, defaultValue: 55, unit: 'Hz', description: 'Band 2 peaking/notch center frequency' },
      { name: 'Notch Gain', aliases: ['GainDb', 'Gain'], min: -18, max: 18, defaultValue: -3.5, unit: 'dB', description: 'Band 2 peaking/notch gain in dB' },
      { name: 'Notch Q', aliases: ['Q', 'Resonance'], min: 0.3, max: 12, defaultValue: 2.4, unit: '', description: 'Band 2 surgical Q factor' },
    ],
    bypassBehavior: 'Disconnects EQ biquad stages and routes signal unity-clean when bypassed.',
    parameterUpdateBehavior: 'Updates HPF frequency, peaking frequency, gain dB, and Q on active BiquadFilterNodes.',
    disposalBehavior: 'Disconnects HPF, peaking, and shelf BiquadFilterNodes.',
    routing: 'channel_insert',
    limitations: 'Executes HPF, peaking/notch, and low-shelf bands; bands 4-8 remain preserved in XML.',
    requiredTests: ['insert_param_response', 'insert_bypass_order'],
  },
  Compressor2: {
    xmlTag: 'Compressor2',
    displayName: 'Compressor / Sidechain Ducking',
    kind: 'audio_effect',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    parameterSpecs: [
      { name: 'Threshold', aliases: ['ThresholdDb'], min: -60, max: 0, defaultValue: -18, unit: 'dB', description: 'Compression threshold in dB' },
      { name: 'Ratio', aliases: ['CompressionRatio'], min: 1, max: 20, defaultValue: 4, unit: ':1', description: 'Compression ratio' },
      { name: 'Attack', aliases: ['AttackMs'], min: 0.1, max: 200, defaultValue: 6, unit: 'ms', description: 'Attack time in milliseconds' },
      { name: 'Release', aliases: ['ReleaseMs'], min: 10, max: 1000, defaultValue: 90, unit: 'ms', description: 'Release time in milliseconds' },
      { name: 'MakeupGain', aliases: ['Gain', 'OutputGain'], min: -12, max: 18, defaultValue: 0, unit: 'dB', description: 'Output makeup gain in dB' },
    ],
    bypassBehavior: 'Bypasses dynamics compressor and makeup gain stage.',
    parameterUpdateBehavior: 'Updates threshold, ratio, attack, release, and makeup gain on live DynamicsCompressorNode and GainNode.',
    disposalBehavior: 'Disconnects DynamicsCompressorNode and makeup GainNode.',
    routing: 'channel_insert',
    limitations: 'Executes feed-forward Web Audio dynamics compression and kick-triggered sidechain ducking.',
    requiredTests: ['insert_param_response', 'insert_bypass_order'],
  },
  GlueCompressor: {
    xmlTag: 'GlueCompressor',
    displayName: 'Glue Compressor',
    kind: 'audio_effect',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    parameterSpecs: [
      { name: 'Threshold', aliases: ['ThresholdDb'], min: -48, max: 0, defaultValue: -14, unit: 'dB', description: 'Glue bus threshold in dB' },
      { name: 'Ratio', aliases: ['CompressionRatio'], min: 1, max: 10, defaultValue: 4, unit: ':1', description: 'Glue compression ratio' },
      { name: 'Makeup', aliases: ['MakeupGain', 'Gain', 'Drive'], min: 0, max: 18, defaultValue: 2, unit: 'dB', description: 'Makeup gain and soft-clip drive in dB' },
      { name: 'DryWet', aliases: ['Mix'], min: 0, max: 100, defaultValue: 100, unit: '%', description: 'Parallel compression dry/wet blend' },
    ],
    bypassBehavior: 'Bypasses bus compressor and parallel blend.',
    parameterUpdateBehavior: 'Updates threshold, ratio, makeup gain, and dry/wet parallel blend in place.',
    disposalBehavior: 'Disconnects compressor, dry/wet gains, and soft-clip nodes.',
    routing: 'channel_insert',
    limitations: 'Executes bus compression with parallel dry/wet blend.',
    requiredTests: ['insert_param_response', 'insert_bypass_order'],
  },
  AutoFilter: {
    xmlTag: 'AutoFilter',
    displayName: 'Auto Filter',
    kind: 'audio_effect',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    parameterSpecs: [
      { name: 'FilterType', aliases: ['Type', 'Mode'], min: 0, max: 2, defaultValue: 'Lowpass', unit: '', description: 'Filter response type (Lowpass, Highpass, Bandpass)' },
      { name: 'Cutoff', aliases: ['Frequency', 'FilterCutoffHz'], min: 30, max: 18500, defaultValue: 1800, unit: 'Hz', description: 'Filter cutoff frequency in Hz' },
      { name: 'Resonance', aliases: ['Q', 'FilterResonance'], min: 0.1, max: 1.0, defaultValue: 0.35, unit: '', description: 'Normalized filter resonance' },
      { name: 'EnvMod', aliases: ['Drive'], min: -12, max: 12, defaultValue: 0, unit: 'dB', description: 'Filter output drive/trim in dB' },
    ],
    bypassBehavior: 'Bypasses resonant filter stage when bypassed.',
    parameterUpdateBehavior: 'Updates BiquadFilterNode type, cutoff frequency, Q, and output trim in place.',
    disposalBehavior: 'Disconnects BiquadFilterNode and trim GainNode.',
    routing: 'channel_insert',
    limitations: 'Executes resonant biquad filtering and energy envelope modulation.',
    requiredTests: ['insert_param_response', 'insert_bypass_order', 'live_reconciliation'],
  },
  Saturator: {
    xmlTag: 'Saturator',
    displayName: 'Saturator (Analog Waveshaper)',
    kind: 'audio_effect',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    parameterSpecs: [
      { name: 'Drive', aliases: ['DriveDb', 'PreDrive'], min: 0, max: 36, defaultValue: 8, unit: 'dB', description: 'Input saturation drive in dB' },
      { name: 'Output', aliases: ['PostGain', 'Gain'], min: -24, max: 12, defaultValue: -2, unit: 'dB', description: 'Output attenuation in dB' },
      { name: 'DryWet', aliases: ['Mix'], min: 0, max: 100, defaultValue: 100, unit: '%', description: 'Dry/wet saturation mix' },
    ],
    bypassBehavior: 'Bypasses WaveShaper distortion stage when bypassed.',
    parameterUpdateBehavior: 'Updates pre-drive gain, waveshaper curve, output trim, and dry/wet mix.',
    disposalBehavior: 'Disconnects pre-drive, WaveShaperNode, output gain, and dry/wet mix nodes.',
    routing: 'channel_insert',
    limitations: 'Executes hyperbolic tangent harmonic waveshaping.',
    requiredTests: ['insert_param_response', 'insert_bypass_order'],
  },
  Roar: {
    xmlTag: 'Roar',
    displayName: 'Roar Multi-Stage Saturator',
    kind: 'audio_effect',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    parameterSpecs: [
      { name: 'Drive', aliases: ['Amount', 'DriveDb'], min: 0, max: 36, defaultValue: 12, unit: 'dB', description: 'Multi-stage saturation drive' },
      { name: 'Tone', aliases: ['Tilt', 'FilterFreq'], min: 200, max: 12000, defaultValue: 3200, unit: 'Hz', description: 'Post-saturation tone filter frequency' },
      { name: 'Output', aliases: ['Gain'], min: -24, max: 12, defaultValue: -3, unit: 'dB', description: 'Output level trim in dB' },
    ],
    bypassBehavior: 'Bypasses asymmetric waveshaper and tone stage.',
    parameterUpdateBehavior: 'Updates drive gain, asymmetric waveshaper curve, tone filter cutoff, and output level.',
    disposalBehavior: 'Disconnects drive, WaveShaperNode, tone BiquadFilterNode, and output GainNode.',
    routing: 'channel_insert',
    limitations: 'Executes asymmetric harmonic waveshaping and tone filtering.',
    requiredTests: ['insert_param_response', 'insert_bypass_order'],
  },
  Overdrive: {
    xmlTag: 'Overdrive',
    displayName: 'Overdrive',
    kind: 'audio_effect',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    parameterSpecs: [
      { name: 'Drive', aliases: ['DrivePct'], min: 0, max: 100, defaultValue: 45, unit: '%', description: 'Overdrive harmonic distortion percentage' },
      { name: 'Tone', aliases: ['FilterFreq'], min: 300, max: 12000, defaultValue: 2800, unit: 'Hz', description: 'Band-emphasis center frequency' },
      { name: 'DryWet', aliases: ['Mix'], min: 0, max: 100, defaultValue: 100, unit: '%', description: 'Dry/wet mix percentage' },
    ],
    bypassBehavior: 'Bypasses bandpass drive and waveshaper stage.',
    parameterUpdateBehavior: 'Updates bandpass emphasis, drive curve, and dry/wet mix.',
    disposalBehavior: 'Disconnects bandpass filter, WaveShaperNode, and mix nodes.',
    routing: 'channel_insert',
    limitations: 'Executes band-focused overdrive waveshaping.',
    requiredTests: ['insert_param_response', 'insert_bypass_order'],
  },
  Delay: {
    xmlTag: 'Delay',
    displayName: 'Delay',
    kind: 'audio_effect',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    parameterSpecs: [
      { name: 'DelayTime', aliases: ['Time', 'TimeMs'], min: 10, max: 1500, defaultValue: 280, unit: 'ms', description: 'Delay line time in milliseconds' },
      { name: 'Feedback', aliases: ['FB'], min: 0, max: 0.92, defaultValue: 0.35, unit: '', description: 'Delay feedback loop gain' },
      { name: 'DryWet', aliases: ['Mix'], min: 0, max: 100, defaultValue: 32, unit: '%', description: 'Dry/wet delay blend percentage' },
    ],
    bypassBehavior: 'Mutes delay input while allowing existing tail to decay cleanly during live transitions.',
    parameterUpdateBehavior: 'Updates DelayNode delayTime, feedback GainNode, and dry/wet mix in place.',
    disposalBehavior: 'Zeroes feedback loop and disconnects DelayNode, feedback filter, and mix nodes after tail decay.',
    routing: 'channel_insert',
    limitations: 'Executes damped feedback delay line.',
    requiredTests: ['insert_param_response', 'stateful_tail_reconciliation'],
  },
  Echo: {
    xmlTag: 'Echo',
    displayName: 'Echo (Tape Dub Delay)',
    kind: 'audio_effect',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    parameterSpecs: [
      { name: 'DelayTime', aliases: ['Time', 'TimeMs'], min: 20, max: 1500, defaultValue: 335, unit: 'ms', description: 'Tape echo delay time in milliseconds' },
      { name: 'Feedback', aliases: ['FB'], min: 0, max: 0.92, defaultValue: 0.42, unit: '', description: 'Tape feedback loop gain' },
      { name: 'FilterCutoff', aliases: ['Cutoff', 'Tone'], min: 300, max: 10000, defaultValue: 2600, unit: 'Hz', description: 'Feedback tape lowpass cutoff' },
      { name: 'DryWet', aliases: ['Mix'], min: 0, max: 100, defaultValue: 35, unit: '%', description: 'Dry/wet echo blend percentage' },
    ],
    bypassBehavior: 'Mutes echo input and preserves tail decay on live bypass.',
    parameterUpdateBehavior: 'Updates tape delay time, feedback gain, damping filter cutoff, and dry/wet mix.',
    disposalBehavior: 'Zeroes feedback loop and disconnects DelayNode, BiquadFilterNode, and mix GainNodes.',
    routing: 'channel_insert',
    limitations: 'Executes filtered tape echo feedback loop.',
    requiredTests: ['insert_param_response', 'stateful_tail_reconciliation'],
  },
  ChorusEnsemble: {
    xmlTag: 'ChorusEnsemble',
    displayName: 'Chorus-Ensemble',
    kind: 'audio_effect',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    parameterSpecs: [
      { name: 'Rate', aliases: ['RateHz'], min: 0.05, max: 8, defaultValue: 0.65, unit: 'Hz', description: 'Chorus LFO modulation rate in Hz' },
      { name: 'Amount', aliases: ['Depth', 'Width'], min: 0, max: 100, defaultValue: 50, unit: '%', description: 'Chorus modulation depth percentage' },
      { name: 'DryWet', aliases: ['Mix'], min: 0, max: 100, defaultValue: 45, unit: '%', description: 'Dry/wet chorus blend percentage' },
    ],
    bypassBehavior: 'Bypasses modulated delay chorus branch when bypassed.',
    parameterUpdateBehavior: 'Updates chorus LFO frequency, modulation depth gain, and dry/wet mix in place.',
    disposalBehavior: 'Stops chorus LFO OscillatorNode and disconnects DelayNode and GainNodes.',
    routing: 'channel_insert',
    limitations: 'Executes LFO-modulated chorus delay line.',
    requiredTests: ['insert_param_response', 'modulation_source_disposal'],
  },
  Limiter: {
    xmlTag: 'Limiter',
    displayName: 'Limiter (Brickwall Ceiling)',
    kind: 'audio_effect',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    parameterSpecs: [
      { name: 'Gain', aliases: ['InputGain', 'Drive'], min: -12, max: 24, defaultValue: 0, unit: 'dB', description: 'Pre-limiter input boost in dB' },
      { name: 'Ceiling', aliases: ['CeilingDb'], min: -24, max: 0, defaultValue: -0.3, unit: 'dB', description: 'Output ceiling level in dB' },
      { name: 'Release', aliases: ['ReleaseMs'], min: 10, max: 500, defaultValue: 85, unit: 'ms', description: 'Limiter release time in ms' },
    ],
    bypassBehavior: 'Bypasses pre-gain and brickwall limiter stage.',
    parameterUpdateBehavior: 'Updates pre-gain, limiter threshold/ceiling, and release time in place.',
    disposalBehavior: 'Disconnects input GainNode, DynamicsCompressorNode, and ceiling GainNode.',
    routing: 'channel_insert',
    limitations: 'Executes fast-attack 20:1 peak limiting with output ceiling trim.',
    requiredTests: ['insert_param_response', 'insert_bypass_order'],
  },
  Utility: {
    xmlTag: 'Utility',
    displayName: 'Utility (Gain / Stereo Trim)',
    kind: 'audio_effect',
    status: 'executable',
    requiresConversionRecord: false,
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    parameterSpecs: [
      { name: 'Gain', aliases: ['GainDb', 'Level'], min: -36, max: 35, defaultValue: 0, unit: 'dB', description: 'Linear utility gain offset in dB' },
      { name: 'Balance', aliases: ['Pan'], min: -50, max: 50, defaultValue: 0, unit: '', description: 'Stereo pan balance (-50L to +50R)' },
      { name: 'Mute', aliases: ['Muted'], min: 0, max: 1, defaultValue: 0, unit: '', description: 'Utility mute toggle (0 or 1)' },
    ],
    bypassBehavior: 'Resets Utility stage to unity 0 dB / center pan when bypassed.',
    parameterUpdateBehavior: 'Updates GainNode gain and StereoPannerNode pan in place.',
    disposalBehavior: 'Disconnects GainNode and StereoPannerNode.',
    routing: 'channel_insert',
    limitations: 'Executes precision gain staging and stereo balance.',
    requiredTests: ['insert_param_response', 'insert_bypass_order', 'live_reconciliation'],
  },
  DrumBuss: {
    xmlTag: 'DrumBuss',
    displayName: 'Drum Buss (Converted Analog Drive + Boom Exciter)',
    kind: 'audio_effect',
    status: 'converted',
    requiresConversionRecord: true,
    conversionKind: 'audio_insert_dsp',
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    parameterSpecs: [
      { name: 'Drive', aliases: ['DrivePct'], min: 0, max: 100, defaultValue: 35, unit: '%', description: 'Drum Buss harmonic saturation drive' },
      { name: 'Boom', aliases: ['BoomPct', 'SubBoost'], min: 0, max: 100, defaultValue: 25, unit: '%', description: 'Low-end sub resonant boom boost' },
      { name: 'Crunch', aliases: ['CrunchPct'], min: 0, max: 100, defaultValue: 20, unit: '%', description: 'Mid-high transient crunch emphasis' },
      { name: 'Damp', aliases: ['DampHz', 'Cutoff'], min: 500, max: 20000, defaultValue: 11000, unit: 'Hz', description: 'High-frequency damping lowpass cutoff' },
      { name: 'DryWet', aliases: ['Mix'], min: 0, max: 100, defaultValue: 100, unit: '%', description: 'Dry/wet mix percentage' },
    ],
    bypassBehavior: 'Bypasses DrumBuss waveshaper, sub-boom filter, and damping filter when bypassed.',
    parameterUpdateBehavior: 'Regenerates conversion descriptor and updates sub-boom shelf, crunch waveshaper, damping filter, and dry/wet mix.',
    disposalBehavior: 'Disconnects boom filter, waveshaper, damping filter, and dry/wet gain nodes.',
    routing: 'channel_insert',
    limitations: 'Converted approximation using Web Audio sub-peaking boom filter + waveshaper + damping lowpass.',
    requiredTests: ['conversion_record_validation', 'insert_param_response'],
  },
  Reverb: {
    xmlTag: 'Reverb',
    displayName: 'Reverb (Converted Per-Insert Algorithmic Diffuser)',
    kind: 'audio_effect',
    status: 'converted',
    requiresConversionRecord: true,
    conversionKind: 'audio_insert_dsp',
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    parameterSpecs: [
      { name: 'DecayTime', aliases: ['Decay', 'DecaySec'], min: 0.2, max: 15, defaultValue: 2.4, unit: 's', description: 'Reverb tail decay time in seconds' },
      { name: 'PreDelay', aliases: ['PredelayMs'], min: 1, max: 200, defaultValue: 18, unit: 'ms', description: 'Initial reflection pre-delay in ms' },
      { name: 'HighCut', aliases: ['DampingHz', 'ShelfFreq'], min: 400, max: 16000, defaultValue: 4800, unit: 'Hz', description: 'Reverb tail high-cut damping frequency' },
      { name: 'DryWet', aliases: ['Mix'], min: 0, max: 100, defaultValue: 35, unit: '%', description: 'Dry/wet reverb blend percentage' },
    ],
    bypassBehavior: 'Mutes reverb diffuser input and preserves tail decay when bypassed.',
    parameterUpdateBehavior: 'Regenerates conversion descriptor and updates pre-delay, feedback decay gain, damping filter, and dry/wet mix.',
    disposalBehavior: 'Zeroes diffuser feedback and disconnects delay/filter/mix nodes.',
    routing: 'channel_insert',
    limitations: 'Converted per-insert algorithmic multi-tap feedback delay network approximation.',
    requiredTests: ['conversion_record_validation', 'insert_param_response', 'stateful_tail_reconciliation'],
  },
  HybridReverb: {
    xmlTag: 'HybridReverb',
    displayName: 'Hybrid Reverb (Converted Shimmer/Algorithmic Diffuser)',
    kind: 'audio_effect',
    status: 'converted',
    requiresConversionRecord: true,
    conversionKind: 'audio_insert_dsp',
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    parameterSpecs: [
      { name: 'DecayTime', aliases: ['Decay', 'DecaySec'], min: 0.2, max: 15, defaultValue: 3.2, unit: 's', description: 'Hybrid reverb decay time in seconds' },
      { name: 'PreDelay', aliases: ['PredelayMs'], min: 1, max: 250, defaultValue: 24, unit: 'ms', description: 'Pre-delay in milliseconds' },
      { name: 'DampingHz', aliases: ['HighCut', 'Cutoff'], min: 500, max: 16000, defaultValue: 5400, unit: 'Hz', description: 'High-frequency damping cutoff' },
      { name: 'DryWet', aliases: ['Mix'], min: 0, max: 100, defaultValue: 40, unit: '%', description: 'Dry/wet blend percentage' },
    ],
    bypassBehavior: 'Mutes HybridReverb input and allows tail to decay cleanly.',
    parameterUpdateBehavior: 'Regenerates conversion descriptor and updates pre-delay, decay feedback, damping filter, and dry/wet mix.',
    disposalBehavior: 'Zeroes feedback loop and disconnects diffuser delay/filter/gain nodes.',
    routing: 'channel_insert',
    limitations: 'Converted per-insert algorithmic diffuser approximation; custom convolution IR WAV files are preserved in XML.',
    requiredTests: ['conversion_record_validation', 'insert_param_response', 'stateful_tail_reconciliation'],
  },
  Erosion: {
    xmlTag: 'Erosion',
    displayName: 'Erosion (Converted Modulated Band-Noise Degrader)',
    kind: 'audio_effect',
    status: 'converted',
    requiresConversionRecord: true,
    conversionKind: 'audio_insert_dsp',
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    parameterSpecs: [
      { name: 'Frequency', aliases: ['Freq', 'CenterFreq'], min: 100, max: 14000, defaultValue: 2400, unit: 'Hz', description: 'Erosion modulation frequency in Hz' },
      { name: 'Amount', aliases: ['Depth', 'Drive'], min: 0, max: 100, defaultValue: 40, unit: '%', description: 'Short-delay phase/grit modulation depth' },
      { name: 'Width', aliases: ['Q'], min: 0.3, max: 8, defaultValue: 2.0, unit: '', description: 'Bandpass focus width' },
    ],
    bypassBehavior: 'Bypasses modulated short-delay grit processor when bypassed.',
    parameterUpdateBehavior: 'Regenerates conversion descriptor and updates modulator frequency, modulation depth, and filter Q.',
    disposalBehavior: 'Stops modulation OscillatorNode and disconnects DelayNode, BiquadFilterNode, and GainNodes.',
    routing: 'channel_insert',
    limitations: 'Converted short-delay FM degradation approximation.',
    requiredTests: ['conversion_record_validation', 'insert_param_response', 'modulation_source_disposal'],
  },
  AutoPan: {
    xmlTag: 'AutoPan',
    displayName: 'Auto Pan (Converted LFO Stereo/Tremolo Modulator)',
    kind: 'audio_effect',
    status: 'converted',
    requiresConversionRecord: true,
    conversionKind: 'audio_insert_dsp',
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    parameterSpecs: [
      { name: 'Rate', aliases: ['RateHz', 'Frequency'], min: 0.05, max: 20, defaultValue: 1.5, unit: 'Hz', description: 'LFO panning/tremolo rate in Hz' },
      { name: 'Amount', aliases: ['Depth'], min: 0, max: 100, defaultValue: 65, unit: '%', description: 'Stereo pan and amplitude modulation depth' },
      { name: 'Shape', aliases: ['Waveform'], min: 0, max: 1, defaultValue: 'Sine', unit: '', description: 'LFO waveform shape' },
    ],
    bypassBehavior: 'Centers stereo image and disables LFO modulation when bypassed.',
    parameterUpdateBehavior: 'Regenerates conversion descriptor and updates LFO rate, modulation depth, and waveform.',
    disposalBehavior: 'Stops LFO OscillatorNode and disconnects StereoPannerNode and GainNodes.',
    routing: 'channel_insert',
    limitations: 'Converted Web Audio LFO panner + amplitude tremolo stage.',
    requiredTests: ['conversion_record_validation', 'insert_param_response', 'modulation_source_disposal'],
  },
  MidiChord: {
    xmlTag: 'MidiChord',
    displayName: 'MIDI Chord (Converted Polyphonic Voicing Transformer)',
    kind: 'midi_processor',
    status: 'converted',
    requiresConversionRecord: true,
    conversionKind: 'midi_note_transformer',
    maxInstancesPerTrack: 4,
    parameterSpecs: [
      { name: 'Shift1', aliases: ['Interval1'], min: -24, max: 24, defaultValue: 3, unit: 'st', description: 'Voice 1 semitone transposition offset' },
      { name: 'Shift2', aliases: ['Interval2'], min: -24, max: 24, defaultValue: 7, unit: 'st', description: 'Voice 2 semitone transposition offset' },
      { name: 'Shift3', aliases: ['Interval3'], min: -24, max: 24, defaultValue: 12, unit: 'st', description: 'Voice 3 semitone transposition offset' },
      { name: 'VelocityPct', aliases: ['Velocity'], min: 10, max: 127, defaultValue: 88, unit: '%', description: 'Chord harmony velocity scaling percentage' },
    ],
    bypassBehavior: 'Passes incoming MIDI notes unmodified when bypassed.',
    parameterUpdateBehavior: 'Regenerates conversion descriptor and immediately updates live and offline chord note expansion.',
    disposalBehavior: 'Stateless MIDI note transformer; no persistent audio nodes to dispose.',
    routing: 'midi_stream',
    limitations: 'Evaluated deterministically in shared live/offline MIDI pre-synthesis pipeline.',
    requiredTests: ['conversion_record_validation', 'midi_chord_transform', 'live_offline_parity'],
  },
  MidiArpeggiator: {
    xmlTag: 'MidiArpeggiator',
    displayName: 'MIDI Arpeggiator (Converted Step Pattern Transformer)',
    kind: 'midi_processor',
    status: 'converted',
    requiresConversionRecord: true,
    conversionKind: 'midi_note_transformer',
    maxInstancesPerTrack: 4,
    parameterSpecs: [
      { name: 'Rate', aliases: ['RateBeats', 'StepRate'], min: 0.0625, max: 2.0, defaultValue: 0.25, unit: 'beats', description: 'Arpeggiator step rate in quarter-note beats (0.25 = 1/16)' },
      { name: 'Gate', aliases: ['GatePct'], min: 10, max: 150, defaultValue: 75, unit: '%', description: 'Arpeggiated note gate duration percentage' },
      { name: 'Steps', aliases: ['Octaves'], min: 1, max: 6, defaultValue: 3, unit: '', description: 'Number of transposition steps' },
      { name: 'Distance', aliases: ['Transpose', 'Semitones'], min: -24, max: 24, defaultValue: 7, unit: 'st', description: 'Semitone transposition per step' },
      { name: 'Style', aliases: ['Order', 'Direction'], min: 0, max: 2, defaultValue: 'Up', unit: '', description: 'Step ordering (Up, Down, UpDown)' },
    ],
    bypassBehavior: 'Passes incoming MIDI notes unmodified when bypassed.',
    parameterUpdateBehavior: 'Regenerates conversion descriptor and immediately updates live and offline arpeggio note scheduling.',
    disposalBehavior: 'Stateless MIDI note transformer; no persistent audio nodes to dispose.',
    routing: 'midi_stream',
    limitations: 'Evaluated deterministically in shared live/offline MIDI pre-synthesis pipeline.',
    requiredTests: ['conversion_record_validation', 'midi_arp_transform', 'live_offline_parity'],
  },
  Lfo: {
    xmlTag: 'Lfo',
    displayName: 'Max for Live LFO (Converted Filter Modulation Source)',
    kind: 'modulator',
    status: 'converted',
    requiresConversionRecord: true,
    conversionKind: 'voice_modulation_lfo',
    maxInstancesPerTrack: 2,
    parameterSpecs: [
      { name: 'Rate', aliases: ['RateHz', 'Frequency'], min: 0.01, max: 20, defaultValue: 0.12, unit: 'Hz', description: 'Modulation LFO frequency in Hz' },
      { name: 'Depth', aliases: ['Amount'], min: 0, max: 1, defaultValue: 0.42, unit: '', description: 'Normalized modulation depth' },
      { name: 'Waveform', aliases: ['Shape'], min: 0, max: 2, defaultValue: 'Sine', unit: '', description: 'LFO waveform (Sine, Triangle, Random)' },
    ],
    bypassBehavior: 'Disables LFO filter cutoff modulation when bypassed.',
    parameterUpdateBehavior: 'Regenerates conversion descriptor and updates voice filter LFO modulation.',
    disposalBehavior: 'Stateless voice modulation evaluator.',
    routing: 'voice_modulation',
    limitations: 'Modulates track filter cutoff/energy; arbitrary third-party Max patcher routing is not executed.',
    requiredTests: ['conversion_record_validation'],
  },
};

export const ABLETON_CAPABILITY_MATRIX: readonly AbletonCapabilityEntry[] = [
  {
    id: 'inst_drum_group',
    category: 'instrument',
    xmlTagOrFeature: 'DrumGroupDevice',
    displayName: 'Drum Rack (909 Core Synthesis Approximation)',
    status: 'executable',
    maxInstancesPerTrack: 1,
    executedParameters: ['MacroControls.0', 'Pitch', 'Decay', 'FilterCutoffHz', 'Velocity', 'Probability'],
    preservedXmlScope: 'Full <DrumGroupDevice> XML subtree preserved on import/export',
    limitationsAndWarnings:
      'Browser synthesis executes 909/techno drum voices controlled by DrumGroupDevice parameters; arbitrary multi-sample chains inside Drum Rack branches are preserved in XML.',
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
    executedParameters: ['Threshold', 'Ratio', 'Attack', 'Release', 'MakeupGain', 'Bypass'],
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
    executedParameters: ['FilterType', 'Cutoff', 'Resonance', 'EnvMod', 'Bypass'],
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
    executedParameters: ['Drive', 'Tone', 'Output', 'DryWet', 'Bypass'],
    preservedXmlScope: 'Full native XML subtree preserved on import/export',
    limitationsAndWarnings:
      'Executed via dedicated Web Audio WaveShaper and tone filter insert nodes within the 10-insert-per-track limit.',
  },
  {
    id: 'fx_delay_chorus_limiter_utility',
    category: 'audio_effect',
    xmlTagOrFeature: 'Delay|Echo|ChorusEnsemble|Limiter|GlueCompressor|Utility',
    displayName: 'Delay, Chorus, Dynamics & Utility Inserts',
    status: 'executable',
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    executedParameters: ['DelayTime', 'Feedback', 'Rate', 'Amount', 'Ceiling', 'Gain', 'Balance', 'DryWet', 'Bypass'],
    preservedXmlScope: 'Full native XML subtree preserved on import/export',
    limitationsAndWarnings:
      'Executed via dedicated Web Audio Delay/DynamicsCompressor/Gain/StereoPanner insert nodes within the 10-insert-per-track limit.',
  },
  {
    id: 'fx_converted_bus_and_drive',
    category: 'audio_effect',
    xmlTagOrFeature: 'DrumBuss|Reverb|HybridReverb|Erosion|AutoPan|Lfo',
    displayName: 'Converted Per-Insert Audio & Modulation Effects',
    status: 'converted',
    maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
    executedParameters: ['Drive', 'Boom', 'Crunch', 'Damp', 'DecayTime', 'PreDelay', 'DryWet', 'Frequency', 'Amount', 'Rate', 'Depth', 'Bypass'],
    preservedXmlScope: 'Full native XML subtree preserved on import/export; per-instance DeviceConversionRecord required',
    limitationsAndWarnings:
      'Executed via verified per-insert Web Audio DSP conversions (sub-boom saturator, multi-tap feedback diffuser, LFO stereo autopan, modulated delay erosion) backed by explicit DeviceConversionRecord hashes.',
  },
  {
    id: 'midi_fx_converted_note_generators',
    category: 'midi_effect',
    xmlTagOrFeature: 'MidiChord|MidiArpeggiator',
    displayName: 'Converted Ableton MIDI Chord & Arpeggiator',
    status: 'converted',
    executedParameters: ['Shift1', 'Shift2', 'Shift3', 'VelocityPct', 'Rate', 'Gate', 'Steps', 'Distance', 'Style', 'Bypass'],
    preservedXmlScope: 'Preserved verbatim in <DeviceChain> XML; evaluated deterministically in shared live/offline MIDI pipeline',
    limitationsAndWarnings:
      'Requires valid per-instance DeviceConversionRecord; transforms clip note streams identically in live scheduling and offline rendering.',
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

export const INSTRUMENT_DEVICE_TAGS = new Set<string>([
  'DrumGroupDevice',
  'Operator',
  'UltraAnalog',
  'InstrumentVector',
  'Drift',
  'Collision',
  'OriginalSimpler',
]);

export const MIDI_PROCESSOR_DEVICE_TAGS = new Set<string>([
  'MidiChord',
  'MidiArpeggiator',
]);

export const AUDIO_EFFECT_INSERT_TAGS = new Set<string>([
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
  'DrumBuss',
  'Reverb',
  'HybridReverb',
  'Erosion',
  'AutoPan',
]);

export const MODULATOR_DEVICE_TAGS = new Set<string>(['Lfo']);

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

for (const tag of PRESERVED_ONLY_DEVICE_TAGS) {
  if (!ABLETON_DEVICE_REGISTRY[tag]) {
    ABLETON_DEVICE_REGISTRY[tag] = {
      xmlTag: tag,
      displayName: `${tag} (Preserved Native Structure)`,
      kind: 'preserved_native_structure',
      status: 'preserved-only',
      requiresConversionRecord: false,
      maxInstancesPerTrack: MAX_EXECUTABLE_INSERT_DEVICES,
      parameterSpecs: [],
      bypassBehavior: 'When bypassed, allows track DSP execution while preserving XML subtree.',
      parameterUpdateBehavior: 'Preserves native XML subtree; active execution blocked until bypassed.',
      disposalBehavior: 'No browser DSP nodes created when bypassed.',
      routing: 'none',
      limitations: 'Preserved verbatim in XML; no browser DSP equivalent implemented.',
      requiredTests: ['preserved_only_preflight_guard'],
    };
  }
}

for (const tag of UNSUPPORTED_DEVICE_TAGS) {
  if (!ABLETON_DEVICE_REGISTRY[tag]) {
    ABLETON_DEVICE_REGISTRY[tag] = {
      xmlTag: tag,
      displayName: `${tag} (External Binary Plugin / Max for Live)`,
      kind: 'external_plugin',
      status: 'unsupported',
      requiresConversionRecord: false,
      maxInstancesPerTrack: 0,
      parameterSpecs: [],
      bypassBehavior: 'When bypassed, allows track DSP execution while preserving XML reference.',
      parameterUpdateBehavior: 'Preserves native XML plugin reference; active execution blocked.',
      disposalBehavior: 'No browser DSP nodes created.',
      routing: 'none',
      limitations: 'Third-party binary plugins and Max for Live patchers cannot execute in browser/Android WebView.',
      requiredTests: ['unsupported_plugin_preflight_guard'],
    };
  }
}

export function isInstrumentDeviceTag(xmlTag: string): boolean {
  return INSTRUMENT_DEVICE_TAGS.has(xmlTag);
}

export function isMidiProcessorDeviceTag(xmlTag: string): boolean {
  return MIDI_PROCESSOR_DEVICE_TAGS.has(xmlTag);
}

export function isAudioEffectInsertTag(xmlTag: string): boolean {
  return AUDIO_EFFECT_INSERT_TAGS.has(xmlTag);
}

export function isModulatorDeviceTag(xmlTag: string): boolean {
  return MODULATOR_DEVICE_TAGS.has(xmlTag);
}

export function getAbletonDeviceContract(xmlTag: string): AbletonDeviceContract | undefined {
  return ABLETON_DEVICE_REGISTRY[xmlTag];
}

export function classifyAbletonDeviceTag(xmlTag: string): AbletonCapabilityStatus {
  if (EXECUTABLE_DEVICE_TAGS.has(xmlTag)) return 'executable';
  if (CONVERTED_DEVICE_TAGS.has(xmlTag)) return 'converted';
  if (PRESERVED_ONLY_DEVICE_TAGS.has(xmlTag)) return 'preserved-only';
  return 'unsupported';
}

export function readDeviceParamNumber(
  device: Pick<AbletonDevice, 'xmlTag' | 'parameters'>,
  canonicalName: string,
  fallback?: number
): number {
  const contract = ABLETON_DEVICE_REGISTRY[device.xmlTag];
  const spec = contract?.parameterSpecs.find(
    (s) =>
      s.name.toLowerCase() === canonicalName.toLowerCase() ||
      (s.aliases && s.aliases.some((a) => a.toLowerCase() === canonicalName.toLowerCase()))
  );
  const candidateNames = [
    canonicalName.toLowerCase(),
    ...(spec ? [spec.name.toLowerCase(), ...(spec.aliases || []).map((a) => a.toLowerCase())] : []),
  ];
  for (const param of device.parameters || []) {
    const pName = param.name.trim().toLowerCase();
    if (candidateNames.includes(pName)) {
      const rawVal = param.value;
      if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
        return spec ? Math.max(spec.min, Math.min(spec.max, rawVal)) : rawVal;
      }
      if (typeof rawVal === 'string') {
        const trimmed = rawVal.trim();
        if (trimmed === '1/4') return 1.0;
        if (trimmed === '1/8') return 0.5;
        if (trimmed === '1/16') return 0.25;
        if (trimmed === '1/32') return 0.125;
        const parsed = Number.parseFloat(trimmed.replace(/[^0-9.+-]/g, ''));
        if (Number.isFinite(parsed)) {
          return spec ? Math.max(spec.min, Math.min(spec.max, parsed)) : parsed;
        }
      }
    }
  }
  if (typeof fallback === 'number') return fallback;
  if (spec && typeof spec.defaultValue === 'number') return spec.defaultValue;
  return 0;
}

export function readDeviceParamString(
  device: Pick<AbletonDevice, 'xmlTag' | 'parameters'>,
  canonicalName: string,
  fallback = ''
): string {
  const contract = ABLETON_DEVICE_REGISTRY[device.xmlTag];
  const spec = contract?.parameterSpecs.find(
    (s) =>
      s.name.toLowerCase() === canonicalName.toLowerCase() ||
      (s.aliases && s.aliases.some((a) => a.toLowerCase() === canonicalName.toLowerCase()))
  );
  const candidateNames = [
    canonicalName.toLowerCase(),
    ...(spec ? [spec.name.toLowerCase(), ...(spec.aliases || []).map((a) => a.toLowerCase())] : []),
  ];
  for (const param of device.parameters || []) {
    if (candidateNames.includes(param.name.trim().toLowerCase())) {
      return String(param.value);
    }
  }
  if (fallback) return fallback;
  if (spec && typeof spec.defaultValue === 'string') return spec.defaultValue;
  return '';
}

/**
 * Deterministic canonical hash of a device's XML tag and parameter key/value pairs.
 */
export function computeDeviceParameterHash(device: Pick<AbletonDevice, 'xmlTag' | 'parameters'>): string {
  const canonicalParams = [...(device.parameters || [])]
    .map((p) => `${p.name.trim()}=${String(p.value).trim()}:${p.unit || ''}`)
    .sort()
    .join('|');
  const payload = `${device.xmlTag}::${canonicalParams}`;
  let h1 = 0x811c9dc5;
  for (let i = 0; i < payload.length; i++) {
    h1 ^= payload.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193);
  }
  return `fnv1a_${(h1 >>> 0).toString(16).padStart(8, '0')}`;
}

/**
 * Builds an explicit, inspectable per-instance DeviceConversionRecord for a converted Ableton device.
 */
export function buildDeviceConversionRecord(device: AbletonDevice): DeviceConversionRecord {
  const contract = ABLETON_DEVICE_REGISTRY[device.xmlTag];
  const sourceParameterHash = computeDeviceParameterHash(device);
  const conversionKind: DeviceConversionRecord['conversionKind'] =
    contract?.conversionKind ||
    (isMidiProcessorDeviceTag(device.xmlTag)
      ? 'midi_note_transformer'
      : isModulatorDeviceTag(device.xmlTag)
      ? 'voice_modulation_lfo'
      : 'audio_insert_dsp');

  const generatedDescriptor: Record<string, string | number | boolean> = {
    xmlTag: device.xmlTag,
    bypassed: Boolean(device.bypassed),
  };

  if (device.xmlTag === 'MidiChord') {
    generatedDescriptor.shift1Semitones = readDeviceParamNumber(device, 'Shift1', 3);
    generatedDescriptor.shift2Semitones = readDeviceParamNumber(device, 'Shift2', 7);
    generatedDescriptor.shift3Semitones = readDeviceParamNumber(device, 'Shift3', 12);
    generatedDescriptor.velocityPct = readDeviceParamNumber(device, 'VelocityPct', 88);
  } else if (device.xmlTag === 'MidiArpeggiator') {
    generatedDescriptor.rateBeats = readDeviceParamNumber(device, 'Rate', 0.25);
    generatedDescriptor.gatePct = readDeviceParamNumber(device, 'Gate', 75);
    generatedDescriptor.steps = Math.round(readDeviceParamNumber(device, 'Steps', 3));
    generatedDescriptor.distanceSemitones = Math.round(readDeviceParamNumber(device, 'Distance', 7));
    generatedDescriptor.style = readDeviceParamString(device, 'Style', 'Up');
  } else if (device.xmlTag === 'DrumBuss') {
    generatedDescriptor.drivePct = readDeviceParamNumber(device, 'Drive', 35);
    generatedDescriptor.boomPct = readDeviceParamNumber(device, 'Boom', 25);
    generatedDescriptor.crunchPct = readDeviceParamNumber(device, 'Crunch', 20);
    generatedDescriptor.dampHz = readDeviceParamNumber(device, 'Damp', 11000);
    generatedDescriptor.dryWetPct = readDeviceParamNumber(device, 'DryWet', 100);
  } else if (device.xmlTag === 'Reverb' || device.xmlTag === 'HybridReverb') {
    generatedDescriptor.decaySec = readDeviceParamNumber(device, 'DecayTime', device.xmlTag === 'HybridReverb' ? 3.2 : 2.4);
    generatedDescriptor.preDelayMs = readDeviceParamNumber(device, 'PreDelay', device.xmlTag === 'HybridReverb' ? 24 : 18);
    generatedDescriptor.dampingHz = readDeviceParamNumber(device, 'HighCut', 4800);
    generatedDescriptor.dryWetPct = readDeviceParamNumber(device, 'DryWet', 35);
  } else if (device.xmlTag === 'AutoPan') {
    generatedDescriptor.rateHz = readDeviceParamNumber(device, 'Rate', 1.5);
    generatedDescriptor.amountPct = readDeviceParamNumber(device, 'Amount', 65);
    generatedDescriptor.shape = readDeviceParamString(device, 'Shape', 'Sine');
  } else if (device.xmlTag === 'Erosion') {
    generatedDescriptor.frequencyHz = readDeviceParamNumber(device, 'Frequency', 2400);
    generatedDescriptor.amountPct = readDeviceParamNumber(device, 'Amount', 40);
    generatedDescriptor.widthQ = readDeviceParamNumber(device, 'Width', 2.0);
  } else if (device.xmlTag === 'Lfo') {
    generatedDescriptor.rateHz = readDeviceParamNumber(device, 'Rate', 0.12);
    generatedDescriptor.depth = readDeviceParamNumber(device, 'Depth', 0.42);
    generatedDescriptor.waveform = readDeviceParamString(device, 'Waveform', 'Sine');
  }

  return {
    sourceDeviceId: device.id,
    xmlTag: device.xmlTag,
    sourceParameterHash,
    conversionVersion: CURRENT_DEVICE_CONVERSION_VERSION,
    conversionKind,
    generatedDescriptor,
    supportedSemantics: contract
      ? contract.parameterSpecs.map((s) => `${s.name} (${s.min}..${s.max}${s.unit ? ' ' + s.unit : ''})`)
      : ['Bypass'],
    limitations: contract ? [contract.limitations] : ['Converted browser approximation.'],
    status: 'valid',
  };
}

export function verifyDeviceConversionRecord(device: AbletonDevice): {
  isValid: boolean;
  status: 'valid' | 'invalidated' | 'unconverted';
  reason: string;
} {
  const rec = device.conversionRecord;
  if (
    rec &&
    typeof rec.conversionVersion === 'number' &&
    rec.conversionVersion > CURRENT_DEVICE_CONVERSION_VERSION
  ) {
    return {
      isValid: false,
      status: 'invalidated',
      reason: `FUTURE_CONVERSION_VERSION: Unsupported future conversionVersion ${rec.conversionVersion} on <${device.xmlTag}> (${device.id}); max supported is ${CURRENT_DEVICE_CONVERSION_VERSION}`,
    };
  }
  if (!CONVERTED_DEVICE_TAGS.has(device.xmlTag)) {
    if (rec !== undefined) {
      return {
        isValid: false,
        status: 'invalidated',
        reason: `Unexpected conversionRecord on non-converted device <${device.xmlTag}> (${device.id})`,
      };
    }
    return { isValid: true, status: 'valid', reason: 'Not a converted device' };
  }
  if (!rec || rec.status === 'unconverted') {
    return {
      isValid: false,
      status: 'unconverted',
      reason: `Missing conversion record for <${device.xmlTag}> (${device.id})`,
    };
  }
  if (rec.status === 'invalidated') {
    return {
      isValid: false,
      status: 'invalidated',
      reason: `Conversion record for <${device.xmlTag}> (${device.id}) is marked invalidated`,
    };
  }
  if (rec.conversionVersion !== CURRENT_DEVICE_CONVERSION_VERSION) {
    return {
      isValid: false,
      status: 'invalidated',
      reason: `Conversion version mismatch on <${device.xmlTag}> (${device.id}): expected ${CURRENT_DEVICE_CONVERSION_VERSION}, got ${rec.conversionVersion}`,
    };
  }
  const expectedRecord = buildDeviceConversionRecord(device);
  const expectedHash = expectedRecord.sourceParameterHash;
  if (
    rec.sourceDeviceId !== device.id ||
    rec.xmlTag !== device.xmlTag ||
    rec.sourceParameterHash !== expectedHash ||
    rec.conversionKind !== expectedRecord.conversionKind
  ) {
    return {
      isValid: false,
      status: 'invalidated',
      reason: `Parameter hash or conversion kind mismatch on <${device.xmlTag}> (${device.id}): expected ${expectedHash} (${expectedRecord.conversionKind}), got ${rec.sourceParameterHash} (${rec.conversionKind})`,
    };
  }
  const actualDesc = rec.generatedDescriptor || {};
  const expectedDesc = expectedRecord.generatedDescriptor || {};
  const expectedKeys = Object.keys(expectedDesc);
  const actualKeys = Object.keys(actualDesc);
  if (expectedKeys.length !== actualKeys.length) {
    return {
      isValid: false,
      status: 'invalidated',
      reason: `Generated descriptor key count mismatch on <${device.xmlTag}> (${device.id}): expected ${expectedKeys.length} keys, got ${actualKeys.length}`,
    };
  }
  for (const key of expectedKeys) {
    const expVal = expectedDesc[key];
    const actVal = actualDesc[key];
    if (typeof expVal === 'number' && typeof actVal === 'number') {
      if (!Number.isFinite(actVal) || Math.abs(expVal - actVal) > 1e-6) {
        return {
          isValid: false,
          status: 'invalidated',
          reason: `Generated descriptor value mismatch on <${device.xmlTag}> (${device.id}) for "${key}": expected ${expVal}, got ${actVal}`,
        };
      }
    } else if (expVal !== actVal) {
      return {
        isValid: false,
        status: 'invalidated',
        reason: `Generated descriptor value mismatch on <${device.xmlTag}> (${device.id}) for "${key}": expected ${String(expVal)}, got ${String(actVal)}`,
      };
    }
  }
  return { isValid: true, status: 'valid', reason: 'Verified conversion record' };
}

export interface DeviceChainOrderingViolation {
  trackId: string;
  trackName: string;
  deviceId: string;
  xmlTag: string;
  violationKind: 'ordering' | 'max_instances';
  reason: string;
}

/**
 * Validates that active executable/converted devices on a track obey Ableton signal-flow ordering:
 *   1. midi_processor (MidiChord, MidiArpeggiator) before instrument
 *   2. instrument before audio_effect
 * and that no device tag exceeds its declared `maxInstancesPerTrack`.
 */
export function validateTrackDeviceChainOrderingAndCounts(
  track: Pick<AbletonTrack, 'id' | 'name' | 'type' | 'devices'>
): DeviceChainOrderingViolation[] {
  const violations: DeviceChainOrderingViolation[] = [];
  const countsByTag = new Map<string, number>();
  let seenInstrument = false;
  let seenAudioEffect = false;

  for (const dev of track.devices || []) {
    if (dev.bypassed) continue;
    const tag = dev.xmlTag || dev.type || '';
    const contract = ABLETON_DEVICE_REGISTRY[tag];
    if (!contract) continue;

    if (contract.status === 'executable' || contract.status === 'converted') {
      const nextCount = (countsByTag.get(tag) || 0) + 1;
      countsByTag.set(tag, nextCount);
      if (contract.maxInstancesPerTrack > 0 && nextCount > contract.maxInstancesPerTrack) {
        violations.push({
          trackId: track.id,
          trackName: track.name,
          deviceId: dev.id,
          xmlTag: tag,
          violationKind: 'max_instances',
          reason: `Track "${track.name}" has ${nextCount} active instances of <${tag}> (maxInstancesPerTrack=${contract.maxInstancesPerTrack}).`,
        });
      }

      if (contract.kind === 'midi_processor') {
        if (track.type === 'audio') {
          violations.push({
            trackId: track.id,
            trackName: track.name,
            deviceId: dev.id,
            xmlTag: tag,
            violationKind: 'ordering',
            reason: `Audio track "${track.name}" cannot execute MIDI processor <${tag}> (${dev.id}).`,
          });
        } else if (seenInstrument || seenAudioEffect) {
          violations.push({
            trackId: track.id,
            trackName: track.name,
            deviceId: dev.id,
            xmlTag: tag,
            violationKind: 'ordering',
            reason: `MIDI processor <${tag}> (${dev.id}) on track "${track.name}" must precede instrument and audio effect devices.`,
          });
        }
      } else if (contract.kind === 'instrument') {
        if (seenInstrument) {
          violations.push({
            trackId: track.id,
            trackName: track.name,
            deviceId: dev.id,
            xmlTag: tag,
            violationKind: 'ordering',
            reason: `Track "${track.name}" has multiple active instrument devices (<${tag}> ${dev.id}); only 1 active instrument per track is supported.`,
          });
        }
        seenInstrument = true;
      } else if (contract.kind === 'audio_effect') {
        seenAudioEffect = true;
      }
    }
  }

  return violations;
}

/**
 * Verifies that every entry in ABLETON_DEVICE_REGISTRY has complete, consistent contract fields
 * and matches its classification set.
 */
export function verifyDeviceRegistryIntegrity(): {
  valid: boolean;
  totalRegistered: number;
  errors: string[];
} {
  const errors: string[] = [];
  const entries = Object.values(ABLETON_DEVICE_REGISTRY);
  for (const entry of entries) {
    if (!entry.xmlTag || !entry.displayName) {
      errors.push(`Missing xmlTag or displayName on registry entry`);
    }
    const classified = classifyAbletonDeviceTag(entry.xmlTag);
    if (entry.status !== classified) {
      errors.push(
        `Status mismatch for <${entry.xmlTag}>: registry=${entry.status}, classify=${classified}`
      );
    }
    if (entry.status === 'converted' && !entry.requiresConversionRecord) {
      errors.push(`Converted device <${entry.xmlTag}> must require a conversionRecord`);
    }
    if (
      (entry.status === 'executable' || entry.status === 'converted') &&
      entry.parameterSpecs.length === 0
    ) {
      errors.push(`Executable/converted device <${entry.xmlTag}> has no parameterSpecs`);
    }
    if (!entry.bypassBehavior || !entry.parameterUpdateBehavior || !entry.disposalBehavior) {
      errors.push(`Device <${entry.xmlTag}> is missing lifecycle behavior declarations`);
    }
    if (!entry.requiredTests || entry.requiredTests.length === 0) {
      errors.push(`Device <${entry.xmlTag}> has no requiredTests`);
    }
  }
  return {
    valid: errors.length === 0,
    totalRegistered: entries.length,
    errors,
  };
}

/**
 * Named, versioned migration for genuinely missing legacy conversion metadata (`conversionRecord === undefined`).
 * Never overwrites, repairs, or downgrades an existing `conversionRecord` (whether valid, stale, invalidated, altered, or future version).
 */
export function migrateLegacyDeviceConversionRecord(device: AbletonDevice): {
  device: AbletonDevice;
  migrated: boolean;
  migrationId?: string;
} {
  if (!CONVERTED_DEVICE_TAGS.has(device.xmlTag)) {
    return { device, migrated: false };
  }
  if (device.conversionRecord !== undefined) {
    return { device, migrated: false };
  }
  return {
    device: {
      ...device,
      conversionRecord: buildDeviceConversionRecord(device),
    },
    migrated: true,
    migrationId: LEGACY_CONVERSION_MIGRATION_V1,
  };
}

export function migrateMissingLegacyProjectConversions(project: AbletonProjectState): {
  project: AbletonProjectState;
  migrated: boolean;
  migratedDeviceIds: string[];
  migrationId: string;
} {
  const migratedDeviceIds: string[] = [];
  let tracksChanged = false;
  const nextTracks = project.tracks.map((track) => {
    let devicesChanged = false;
    const nextDevices = (track.devices || []).map((dev) => {
      const res = migrateLegacyDeviceConversionRecord(dev);
      if (res.migrated) {
        devicesChanged = true;
        migratedDeviceIds.push(dev.id);
      }
      return res.device;
    });
    if (!devicesChanged) {
      return track;
    }
    tracksChanged = true;
    return {
      ...track,
      devices: nextDevices,
    };
  });

  if (!tracksChanged) {
    return {
      project,
      migrated: false,
      migratedDeviceIds,
      migrationId: LEGACY_CONVERSION_MIGRATION_V1,
    };
  }

  return {
    project: {
      ...project,
      tracks: nextTracks,
    },
    migrated: true,
    migratedDeviceIds,
    migrationId: LEGACY_CONVERSION_MIGRATION_V1,
  };
}

/**
 * Synchronizes derived conversion metadata for a supported converted device during an atomic parameter edit or creation.
 * - Preserves and rejects unknown future `conversionVersion > CURRENT_DEVICE_CONVERSION_VERSION` without silently downgrading.
 * - Idempotent: returns the exact same `device` reference when the conversion record is already valid.
 */
export function syncDeviceConversionRecord(device: AbletonDevice): AbletonDevice {
  if (!CONVERTED_DEVICE_TAGS.has(device.xmlTag)) {
    return device;
  }
  if (
    device.conversionRecord &&
    typeof device.conversionRecord.conversionVersion === 'number' &&
    device.conversionRecord.conversionVersion > CURRENT_DEVICE_CONVERSION_VERSION
  ) {
    throw new Error(
      `FUTURE_CONVERSION_VERSION: Cannot downgrade or overwrite unsupported future conversionVersion ${device.conversionRecord.conversionVersion} on <${device.xmlTag}> (${device.id})`
    );
  }
  if (device.conversionRecord && verifyDeviceConversionRecord(device).isValid) {
    return device;
  }
  return {
    ...device,
    conversionRecord: buildDeviceConversionRecord(device),
  };
}

/**
 * Explicit validated command to convert or reconvert a supported converted device instance on a project track.
 * Rejects unsupported/non-converted devices and refuses to downgrade future conversion versions.
 */
export function convertOrReconvertDeviceInstance(
  project: AbletonProjectState,
  trackId: string,
  deviceId: string
): {
  project: AbletonProjectState;
  record: DeviceConversionRecord;
  changed: boolean;
} {
  const trackIdx = project.tracks.findIndex((t) => t.id === trackId);
  if (trackIdx < 0) {
    throw new Error(`CONVERT_TARGET_NOT_FOUND: Track ${trackId} not found`);
  }
  const track = project.tracks[trackIdx];
  const devIdx = (track.devices || []).findIndex((d) => d.id === deviceId);
  if (devIdx < 0) {
    throw new Error(`CONVERT_TARGET_NOT_FOUND: Device ${deviceId} not found on track ${trackId}`);
  }
  const targetDevice = track.devices[devIdx];
  if (!CONVERTED_DEVICE_TAGS.has(targetDevice.xmlTag)) {
    throw new Error(
      `UNSUPPORTED_CONVERSION_TARGET: Device ${deviceId} (<${targetDevice.xmlTag}>) is not a convertible device`
    );
  }
  if (
    targetDevice.conversionRecord &&
    typeof targetDevice.conversionRecord.conversionVersion === 'number' &&
    targetDevice.conversionRecord.conversionVersion > CURRENT_DEVICE_CONVERSION_VERSION
  ) {
    throw new Error(
      `FUTURE_CONVERSION_VERSION: Cannot downgrade unsupported future conversionVersion ${targetDevice.conversionRecord.conversionVersion} on <${targetDevice.xmlTag}> (${deviceId})`
    );
  }
  if (targetDevice.conversionRecord && verifyDeviceConversionRecord(targetDevice).isValid) {
    return {
      project,
      record: targetDevice.conversionRecord,
      changed: false,
    };
  }
  const synced = syncDeviceConversionRecord(targetDevice);
  const nextDevices = [...track.devices];
  nextDevices[devIdx] = synced;
  const nextTracks = [...project.tracks];
  nextTracks[trackIdx] = {
    ...track,
    devices: nextDevices,
  };
  return {
    project: {
      ...project,
      tracks: nextTracks,
    },
    record: synced.conversionRecord!,
    changed: true,
  };
}

export function invalidateDeviceConversionRecord(
  device: AbletonDevice,
  reason = 'Device parameter mutated without conversion sync'
): AbletonDevice {
  if (!CONVERTED_DEVICE_TAGS.has(device.xmlTag)) {
    return device;
  }
  if (
    device.conversionRecord &&
    typeof device.conversionRecord.conversionVersion === 'number' &&
    device.conversionRecord.conversionVersion > CURRENT_DEVICE_CONVERSION_VERSION
  ) {
    return device;
  }
  const base = device.conversionRecord ?? buildDeviceConversionRecord(device);
  return {
    ...device,
    conversionRecord: {
      ...base,
      status: 'invalidated',
      limitations: [...(base.limitations || []), reason],
    },
  };
}

export function ensureProjectDeviceConversions(project: AbletonProjectState): AbletonProjectState {
  return migrateMissingLegacyProjectConversions(project).project;
}

/**
 * Deterministically evaluates active MIDI processor devices (MidiChord, MidiArpeggiator)
 * on a track in their exact chain order. Shared across live lookahead scheduling and offline rendering.
 */
export function evaluateTrackMidiDeviceChain(
  track: Pick<AbletonTrack, 'id' | 'name' | 'devices'>,
  notes: readonly MidiNoteEvent[],
  clipStartBeat = 0,
  clipEndBeat = Number.POSITIVE_INFINITY
): MidiNoteEvent[] {
  const activeMidiDevices = (track.devices || []).filter(
    (d) => !d.bypassed && isMidiProcessorDeviceTag(d.xmlTag)
  );
  if (activeMidiDevices.length === 0 || notes.length === 0) {
    return [...notes];
  }

  let currentStream: MidiNoteEvent[] = notes.map((n) => ({ ...n }));

  for (const device of activeMidiDevices) {
    const verification = verifyDeviceConversionRecord(device);
    if (!verification.isValid) {
      throw new Error(
        `CONVERSION_REQUIRED: ${track.name} contains converted MIDI device <${device.xmlTag}> (${device.id}) with ${verification.status} conversion record (${verification.reason}).`
      );
    }
    const desc = device.conversionRecord!.generatedDescriptor;

    if (device.xmlTag === 'MidiChord') {
      const shift1 = Number(desc.shift1Semitones ?? readDeviceParamNumber(device, 'Shift1', 3));
      const shift2 = Number(desc.shift2Semitones ?? readDeviceParamNumber(device, 'Shift2', 7));
      const shift3 = Number(desc.shift3Semitones ?? readDeviceParamNumber(device, 'Shift3', 12));
      const velocityPct = Number(desc.velocityPct ?? readDeviceParamNumber(device, 'VelocityPct', 88));
      const shifts = [shift1, shift2, shift3].filter((s) => Number.isFinite(s) && Math.round(s) !== 0);

      const expanded: MidiNoteEvent[] = [];
      for (const note of currentStream) {
        expanded.push(note);
        shifts.forEach((rawShift, idx) => {
          const shift = Math.round(rawShift);
          const nextPitch = note.pitch + shift;
          if (nextPitch >= 0 && nextPitch <= 127) {
            expanded.push({
              ...note,
              id: `${note.id}_chord_${device.id}_${idx + 1}`,
              sourceNoteId: note.sourceNoteId || note.id,
              pitch: nextPitch,
              velocity: Math.max(1, Math.min(127, Math.round(note.velocity * (velocityPct / 100)))),
            });
          }
        });
      }
      currentStream = expanded;
    } else if (device.xmlTag === 'MidiArpeggiator') {
      const rateBeats = Math.max(
        0.0625,
        Math.min(2.0, Number(desc.rateBeats ?? readDeviceParamNumber(device, 'Rate', 0.25)))
      );
      const gatePct = Math.max(
        10,
        Math.min(150, Number(desc.gatePct ?? readDeviceParamNumber(device, 'Gate', 75)))
      );
      const steps = Math.max(
        1,
        Math.min(6, Math.round(Number(desc.steps ?? readDeviceParamNumber(device, 'Steps', 3))))
      );
      const distanceSemitones = Math.max(
        -24,
        Math.min(24, Math.round(Number(desc.distanceSemitones ?? readDeviceParamNumber(device, 'Distance', 7))))
      );
      const style = String(desc.style ?? readDeviceParamString(device, 'Style', 'Up')).toLowerCase();

      // Group notes starting at the same canonical tick into chords
      const groups = new Map<number, MidiNoteEvent[]>();
      for (const note of currentStream) {
        if (note.time < clipStartBeat - 1e-6 || note.time >= clipEndBeat) continue;
        const tickKey = Math.round(note.time * 960);
        const bucket = groups.get(tickKey);
        if (bucket) {
          bucket.push(note);
        } else {
          groups.set(tickKey, [note]);
        }
      }

      const sortedKeys = Array.from(groups.keys()).sort((a, b) => a - b);
      const arpeggiated: MidiNoteEvent[] = [];

      for (let gIdx = 0; gIdx < sortedKeys.length; gIdx++) {
        const tickKey = sortedKeys[gIdx];
        const chordNotes = groups.get(tickKey)!;
        const baseNotes = [...chordNotes].sort((a, b) => a.pitch - b.pitch);
        if (style === 'down') {
          baseNotes.reverse();
        }

        const patternPitches: { pitch: number; template: MidiNoteEvent }[] = [];
        for (let stepIdx = 0; stepIdx < steps; stepIdx++) {
          for (const baseNote of baseNotes) {
            const shiftedPitch = Math.max(0, Math.min(127, baseNote.pitch + stepIdx * distanceSemitones));
            patternPitches.push({ pitch: shiftedPitch, template: baseNote });
          }
        }
        if (style === 'updown' && patternPitches.length > 2) {
          const middle = patternPitches.slice(1, -1).reverse();
          patternPitches.push(...middle);
        }

        const startBeat = chordNotes[0].time;
        const nextGroupStartBeat =
          gIdx + 1 < sortedKeys.length
            ? groups.get(sortedKeys[gIdx + 1])![0].time
            : clipEndBeat;
        const maxNoteDuration = Math.max(...chordNotes.map((n) => n.duration));
        const minSpanForPattern = rateBeats * Math.max(2, patternPitches.length);
        const windowEndBeat = Math.min(
          clipEndBeat,
          nextGroupStartBeat,
          startBeat + (maxNoteDuration > rateBeats ? maxNoteDuration : minSpanForPattern)
        );

        const rawSpan = Math.max(0, windowEndBeat - startBeat);
        const totalArpSteps = Math.max(
          1,
          Math.ceil((rawSpan - 1e-9) / rateBeats)
        );
        const stepNoteDuration = Math.max(1e-6, rateBeats * (gatePct / 100));

        for (let s = 0; s < totalArpSteps; s++) {
          const stepTime = startBeat + s * rateBeats;
          if (stepTime >= windowEndBeat - 1e-9 || stepTime >= clipEndBeat - 1e-9) break;
          const remainingInClip = clipEndBeat - stepTime;
          if (remainingInClip <= 1e-9) break;
          const chosen = patternPitches[s % patternPitches.length];
          arpeggiated.push({
            ...chosen.template,
            id: `${chosen.template.id}_arp_${device.id}_${s}`,
            sourceNoteId: chosen.template.sourceNoteId || chosen.template.id,
            time: stepTime,
            quantizedTime: stepTime,
            duration: Math.max(1e-6, Math.min(stepNoteDuration, remainingInClip)),
            pitch: chosen.pitch,
          });
        }
      }
      currentStream = arpeggiated;
    }
  }

  return currentStream.sort((a, b) => a.time - b.time || a.pitch - b.pitch);
}

export interface ProjectCapabilityAuditReport {
  executableTrackCount: number;
  insertLimitExceededTracks: { trackId: string; trackName: string; deviceCount: number; maxAllowed: number }[];
  deviceOrderingOrCountViolations: DeviceChainOrderingViolation[];
  unsupportedDevices: { trackId: string; trackName: string; deviceId: string; xmlTag: string }[];
  preservedOnlyDevices: { trackId: string; trackName: string; deviceId: string; xmlTag: string }[];
  convertedDevices: {
    trackId: string;
    trackName: string;
    deviceId: string;
    xmlTag: string;
    conversionVersion: number;
    parameterHash: string;
  }[];
  unconvertedDevices: {
    trackId: string;
    trackName: string;
    deviceId: string;
    xmlTag: string;
    status: 'unconverted' | 'invalidated';
    reason: string;
  }[];
  warnings: string[];
  canExecuteFaithfully: boolean;
  canRenderApproximation: boolean;
  canExecuteFullDsp: boolean;
}

export function auditProjectCapabilities(project: AbletonProjectState): ProjectCapabilityAuditReport {
  const insertLimitExceededTracks: ProjectCapabilityAuditReport['insertLimitExceededTracks'] = [];
  const deviceOrderingOrCountViolations: DeviceChainOrderingViolation[] = [];
  const unsupportedDevices: ProjectCapabilityAuditReport['unsupportedDevices'] = [];
  const preservedOnlyDevices: ProjectCapabilityAuditReport['preservedOnlyDevices'] = [];
  const convertedDevices: ProjectCapabilityAuditReport['convertedDevices'] = [];
  const unconvertedDevices: ProjectCapabilityAuditReport['unconvertedDevices'] = [];
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

    const orderingViolations = validateTrackDeviceChainOrderingAndCounts(track);
    for (const v of orderingViolations) {
      deviceOrderingOrCountViolations.push(v);
      warnings.push(`DEVICE_CHAIN_CONTRACT: ${v.reason}`);
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
        const verification = verifyDeviceConversionRecord(dev);
        if (!verification.isValid) {
          unconvertedDevices.push({
            trackId: track.id,
            trackName: track.name,
            deviceId: dev.id,
            xmlTag: dev.xmlTag,
            status: verification.status === 'invalidated' ? 'invalidated' : 'unconverted',
            reason: verification.reason,
          });
          warnings.push(
            `CONVERSION_REQUIRED: Track "${track.name}" (${track.id}) contains converted device <${dev.xmlTag}> (${dev.id}) with ${verification.status} conversion record (${verification.reason}).`
          );
        } else {
          convertedDevices.push({
            trackId: track.id,
            trackName: track.name,
            deviceId: dev.id,
            xmlTag: dev.xmlTag,
            conversionVersion: dev.conversionRecord!.conversionVersion,
            parameterHash: dev.conversionRecord!.sourceParameterHash,
          });
          warnings.push(
            `CONVERTED_APPROXIMATION: Track "${track.name}" (${track.id}) executes converted approximation for <${dev.xmlTag}> (${dev.id}) [hash=${dev.conversionRecord!.sourceParameterHash}].`
          );
        }
      }
    }
  }

  const canRenderApproximation =
    insertLimitExceededTracks.length === 0 &&
    deviceOrderingOrCountViolations.length === 0 &&
    unsupportedDevices.length === 0 &&
    preservedOnlyDevices.length === 0 &&
    unconvertedDevices.length === 0;

  const canExecuteFaithfully =
    canRenderApproximation && convertedDevices.length === 0;

  return {
    executableTrackCount,
    insertLimitExceededTracks,
    deviceOrderingOrCountViolations,
    unsupportedDevices,
    preservedOnlyDevices,
    convertedDevices,
    unconvertedDevices,
    warnings,
    canExecuteFaithfully,
    canRenderApproximation,
    canExecuteFullDsp: canRenderApproximation,
  };
}

