import { readAlsIdentity } from './alsIdentity';
import { assertAudioSettings } from './audioSettingsContracts';
import { assertProjectState } from './projectStateContracts';
import {
  AbletonDevice,
  AbletonLibraryDeviceTemplate,
  AbletonMidiClip,
  AbletonProjectState,
  AbletonTrack,
  AutomationPoint,
  ClearArrangementOptions,
  HumanizationConfig,
  MemoryLocationMarker,
  MidiNoteEvent,
  NoteGridDivision,
  PolyrhythmConfig,
  SpectralDuckingConfig,
  StarterTemplateMeta,
  TechnoArchetype,
  TrackMixerParams,
  VcaGroupId,
  VcaGroupState,
  VelocityCurveConfig,
  VelocityCurvePreset,
  VoicingSpreadStyle,
} from '../types/ableton';
import {
  decomposeNotesIntoSectionClips,
  generateSectionArrangementProposal,
  GenerateSectionArrangementProposal,
} from './compositionIntelligenceEngine';

import {
  CONVERTED_DEVICE_TAGS,
  EXECUTABLE_DEVICE_TAGS,
  migrateLegacyDeviceConversionRecord,
  migrateCompatibleUnitConversion,
  syncDeviceConversionRecord,
} from './abletonCapabilityMatrix';

export {
  generateSectionArrangementProposal,
  GenerateSectionArrangementProposal,
};

export const BROWSER_SUPPORTED_DEVICE_TAGS = new Set<string>([
  ...EXECUTABLE_DEVICE_TAGS,
  ...CONVERTED_DEVICE_TAGS,
]);

export function getDefaultVcaGroups(): VcaGroupState[] {
  return [
    { id: 'drums_vca', name: 'Drums & Perc VCA', color: '#F59E0B', gainDb: 0, muted: false, soloed: false },
    { id: 'low_end_vca', name: 'Sub & Acid VCA', color: '#38BDF8', gainDb: 0, muted: false, soloed: false },
    { id: 'synths_vca', name: 'Synths & Leads VCA', color: '#A855F7', gainDb: 0, muted: false, soloed: false },
    { id: 'atmos_vca', name: 'Pads & Returns VCA', color: '#10B981', gainDb: 0, muted: false, soloed: false },
  ];
}

export function defaultVcaGroupForArchetype(archetype: TechnoArchetype): VcaGroupId {
  switch (archetype) {
    case 'kick':
    case 'percussion':
    case 'hats':
    case 'ride':
      return 'drums_vca';
    case 'rumble':
    case 'acid':
      return 'low_end_vca';
    case 'synth':
      return 'synths_vca';
    case 'pad':
      return 'atmos_vca';
    default:
      return 'unassigned';
  }
}

export function getDefaultMemoryLocations(totalBars = 16): MemoryLocationMarker[] {
  const scale = Math.max(1, Math.floor(totalBars / 16));
  return [
    { id: 'loc_1', number: 1, name: '01. Intro Lock', bar: 1, beat: 0, color: '#F59E0B', comment: 'Kick + Sub Anchor' },
    { id: 'loc_2', number: 2, name: '02. Sub & Groove', bar: 1 + 4 * scale, beat: 16 * scale, color: '#38BDF8', comment: 'Rumble & Polyrhythm Entry' },
    { id: 'loc_3', number: 3, name: '03. Breakdown Tension', bar: 1 + 8 * scale, beat: 32 * scale, color: '#EC4899', comment: 'Filter Sweep & Acid Mod' },
    { id: 'loc_4', number: 4, name: '04. Peak Warehouse Drop', bar: 1 + 12 * scale, beat: 48 * scale, color: '#10B981', comment: 'Full 8-Track Peak Energy' },
  ];
}

export function computeDeterministicHash(input: string): string {
  let h1 = 0xdeadbeef ^ input.length;
  let h2 = 0x41c6ce57 ^ input.length;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

export async function computeSha256Hex(input: string | Uint8Array): Promise<string> {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    try {
      const buf = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buf).set(bytes);
      const digest = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Never substitute a non-cryptographic fingerprint for SHA-256.
    }
  }
  throw new Error('SHA256_UNAVAILABLE: Web Crypto SHA-256 is required; no non-cryptographic substitute is permitted');
}

export const STARTER_TEMPLATES: StarterTemplateMeta[] = [
  {
    id: 'berghain-134',
    name: 'Berghain_Raw_Foundation',
    subtitle: '133–136.5 BPM · Phrygian/Locrian · 8-Layer Warehouse Ready',
    tempo: 134,
    rootKey: 'F',
    scale: 'Phrygian',
    description:
      'Warehouse kick foundation. Ready for Full 8-Track Suite: Sub Rumble, Industrial Perc, Hypnotic Synth, 909 Hats, 303 Acid, 909 Ride & Dub Pad.',
  },
  {
    id: 'tresor-138',
    name: 'Tresor_Vault_Industrial',
    subtitle: '138–142 BPM · Natural Minor · Heavy Kick + Sub + 303 Acid Pre-Loaded',
    tempo: 138,
    rootKey: 'F#',
    scale: 'Natural Minor',
    description:
      'High-velocity industrial framework with Kick & Sub pre-loaded. Ready for 7/16 Polyrhythmic Percussion, 303 Acid, and Warehouse Ride.',
  },
  {
    id: 'ostgut-128',
    name: 'Ostgut_Hypnotic_Dub',
    subtitle: '127–130.5 BPM · Dorian · Kick + Wide Dub Chords Pre-Loaded',
    tempo: 128,
    rootKey: 'G',
    scale: 'Dorian',
    description:
      'Deep hypnotic dub techno groove with kick and filtered chord stabs. Ready for rolling sub rumble, dub pad, and ghost hats.',
  },
];

export const ABLETON_BUILTIN_LIBRARY: AbletonLibraryDeviceTemplate[] = [
  // INSTRUMENTS
  {
    id: 'inst_operator',
    xmlTag: 'Operator',
    displayName: 'Operator (FM & Sub Synth)',
    category: 'instrument',
    packName: 'Ableton Live 12 Suite Core',
    description: '4-oscillator FM & subtractive synthesizer ideal for phase-locked sub rumble and metallic percussion.',
    defaultParameters: [
      { name: 'Osc A Wave', value: 'Sine' },
      { name: 'Osc A Level', value: 0.92 },
      { name: 'Algorithm', value: 'FM-4' },
    ],
    xmlSnippet: `<Operator Id="8101"><IsOn><Manual Value="true" /></IsOn><OscillatorA><Waveform Value="Sine" /><Coarse Value="0" /><Level Value="0.92" /></OscillatorA></Operator>`,
  },
  {
    id: 'inst_wavetable',
    xmlTag: 'InstrumentVector',
    displayName: 'Wavetable (Dual Osc Synth)',
    category: 'instrument',
    packName: 'Ableton Live 12 Suite Core',
    description: 'Dual-oscillator wavetable synth with morphing filters and unison matrix for hypnotic techno leads.',
    defaultParameters: [
      { name: 'Wave Position', value: 0.64 },
      { name: 'Unison Voices', value: 4 },
      { name: 'Sub Gain', value: 0.45 },
    ],
    xmlSnippet: `<InstrumentVector Id="8102"><IsOn><Manual Value="true" /></IsOn><Oscillator1><WavePosition Value="0.64" /><UnisonVoices Value="4" /></Oscillator1></InstrumentVector>`,
  },
  {
    id: 'inst_analog',
    xmlTag: 'UltraAnalog',
    displayName: 'Analog (TB-303 & Subtractive)',
    category: 'instrument',
    packName: 'Ableton Live 12 Suite Core',
    description: 'Physical modeling virtual analog synth tuned for squelchy 303 acid basslines and resonant leads.',
    defaultParameters: [
      { name: 'Osc 1 Shape', value: 'Saw' },
      { name: 'Filter Resonance', value: 0.78 },
      { name: 'Glide Time', value: 42, unit: 'ms' },
    ],
    xmlSnippet: `<UltraAnalog Id="8103"><IsOn><Manual Value="true" /></IsOn><Oscillator1><Waveform Value="Saw" /></Oscillator1><Filter1><Resonance Value="0.78" /></Filter1></UltraAnalog>`,
  },
  {
    id: 'inst_drift',
    xmlTag: 'Drift',
    displayName: 'Drift (MPE Analog Pad)',
    category: 'instrument',
    packName: 'Ableton Live 12 Core',
    description: 'Organic analog-voiced polyphonic synth with built-in voice drift for wide dub techno chord pads.',
    defaultParameters: [
      { name: 'Drift Amount', value: 0.48 },
      { name: 'Shape Mod', value: 0.56 },
      { name: 'LPF Slope', value: '24dB' },
    ],
    xmlSnippet: `<Drift Id="8104"><IsOn><Manual Value="true" /></IsOn><DriftAmount><Manual Value="0.48" /></DriftAmount></Drift>`,
  },
  {
    id: 'inst_collision',
    xmlTag: 'Collision',
    displayName: 'Collision (Mallet & Metal)',
    category: 'instrument',
    packName: 'Ableton Physical Modeling Pack',
    description: 'Mallet and membrane physical modeling resonator for industrial tubes, plates, and metallic rides.',
    defaultParameters: [
      { name: 'Resonator', value: 'Tube / Metal' },
      { name: 'Mallet Stiffness', value: 0.82 },
      { name: 'Decay', value: 0.44, unit: 's' },
    ],
    xmlSnippet: `<Collision Id="8105"><IsOn><Manual Value="true" /></IsOn><MalletStiffness><Manual Value="0.82" /></MalletStiffness><Resonator1><Type Value="Tube" /><Decay Value="0.44" /></Resonator1></Collision>`,
  },
  {
    id: 'inst_drumrack',
    xmlTag: 'DrumGroupDevice',
    displayName: 'Drum Rack (909 Core Kit)',
    category: 'instrument',
    packName: '909 Core & Industrial Pack',
    description: 'Multi-pad Drum Rack housing TR-909 kicks, open/closed hats, rimshots, and warehouse rides.',
    defaultParameters: [
      { name: 'Kick Tune', value: -2, unit: 'st' },
      { name: 'Decay Macro', value: 84 },
      { name: 'Drive Macro', value: 38 },
    ],
    xmlSnippet: `<DrumGroupDevice Id="8106"><IsOn><Manual Value="true" /></IsOn><MacroControls.0><Manual Value="84.0" /></MacroControls.0></DrumGroupDevice>`,
  },
  // AUDIO EFFECTS
  {
    id: 'fx_eqeight',
    xmlTag: 'EQEight',
    displayName: 'EQ Eight (Surgical & Dynamic)',
    category: 'audio_effect',
    packName: 'Ableton Live 12 Core Audio FX',
    description: '8-band parametric equalizer with 48dB/oct sub cut and surgical kick fundamental notch.',
    defaultParameters: [
      { name: 'Band 1 HPF', value: 30, unit: 'Hz' },
      { name: 'Band 2 Notch', value: 55, unit: 'Hz', automationTarget: true },
      { name: 'Notch Gain', value: -8.5, unit: 'dB' },
    ],
    xmlSnippet: `<EQEight Id="8201"><IsOn><Manual Value="true" /></IsOn><Band.1><FilterType Value="HighPass48" /><Freq Value="30.0" /></Band.1><Band.2><FilterType Value="Bell" /><Freq Value="55.0" /><Gain Value="-8.5" /><Q Value="3.2" /></Band.2></EQEight>`,
  },
  {
    id: 'fx_compressor2',
    xmlTag: 'Compressor2',
    displayName: 'Compressor (Kick Sidechain)',
    category: 'audio_effect',
    packName: 'Ableton Live 12 Core Audio FX',
    description: 'Fast optical/peak sidechain compressor locked to Track 1 (909 Kick) with EQ sidechain filter.',
    defaultParameters: [
      { name: 'Sidechain', value: '01_Kick_909' },
      { name: 'Ratio', value: '4.8:1' },
      { name: 'Release', value: 112, unit: 'ms', automationTarget: true },
    ],
    xmlSnippet: `<Compressor2 Id="8202"><IsOn><Manual Value="true" /></IsOn><Sidechain><IsOn Value="true" /><SourceTrack Value="01_Kick_909_Foundation" /></Sidechain><Threshold><Manual Value="-23.0" /></Threshold><Ratio><Manual Value="4.8" /></Ratio><Release><Manual Value="112.0" /></Release></Compressor2>`,
  },
  {
    id: 'fx_roar',
    xmlTag: 'Roar',
    displayName: 'Roar (Multi-Stage Saturator)',
    category: 'audio_effect',
    packName: 'Ableton Live 12 Flagship FX',
    description: 'Live 12 multi-stage multiband saturation and feedback processor for acid and industrial bass.',
    defaultParameters: [
      { name: 'Routing', value: 'Mid/Side' },
      { name: 'Drive', value: 42, unit: '%', automationTarget: true },
      { name: 'Feedback', value: 18, unit: '%' },
    ],
    xmlSnippet: `<Roar Id="8203"><IsOn><Manual Value="true" /></IsOn><Drive><Manual Value="0.42" /></Drive><Routing Value="MidSide" /></Roar>`,
  },
  {
    id: 'fx_saturator',
    xmlTag: 'Saturator',
    displayName: 'Saturator (Analog Clip)',
    category: 'audio_effect',
    packName: 'Ableton Live 12 Core Audio FX',
    description: 'Waveshaping harmonic saturator with Analog Clip and Sinoid Fold curves.',
    defaultParameters: [
      { name: 'Drive', value: 6.5, unit: 'dB' },
      { name: 'Curve', value: 'Analog Clip' },
      { name: 'Soft Clip', value: 'On' },
    ],
    xmlSnippet: `<Saturator Id="8204"><IsOn><Manual Value="true" /></IsOn><Drive><Manual Value="6.5" /></Drive><Type Value="AnalogClip" /></Saturator>`,
  },
  {
    id: 'fx_hybrid_reverb',
    xmlTag: 'HybridReverb',
    displayName: 'Hybrid Reverb (Berghain Hall)',
    category: 'audio_effect',
    packName: 'Ableton Live 12 Suite FX',
    description: 'Blends convolution warehouse impulse responses with dark shimmer algorithmic tails.',
    defaultParameters: [
      { name: 'Decay', value: 3600, unit: 'ms' },
      { name: 'PreDelay', value: 18, unit: 'ms' },
      { name: 'Dry/Wet', value: 38, unit: '%' },
    ],
    xmlSnippet: `<HybridReverb Id="8205"><IsOn><Manual Value="true" /></IsOn><DecayTime><Manual Value="3600" /></DecayTime><DryWet><Manual Value="0.38" /></DryWet></HybridReverb>`,
  },
  {
    id: 'fx_echo',
    xmlTag: 'Echo',
    displayName: 'Echo (3/16 Dub Tape Delay)',
    category: 'audio_effect',
    packName: 'Ableton Live 12 Suite FX',
    description: 'Modulated stereo tape delay with 3/16 dotted sync, analog wobble, and resonant feedback.',
    defaultParameters: [
      { name: 'Sync Division', value: '3/16' },
      { name: 'Feedback', value: 58, unit: '%', automationTarget: true },
      { name: 'Dry/Wet', value: 44, unit: '%' },
    ],
    xmlSnippet: `<Echo Id="8206"><IsOn><Manual Value="true" /></IsOn><LeftTime><SyncDivision Value="3/16" /></LeftTime><Feedback><Manual Value="0.58" /></Feedback><DryWet><Manual Value="0.44" /></DryWet></Echo>`,
  },
  {
    id: 'fx_drumbuss',
    xmlTag: 'DrumBuss',
    displayName: 'Drum Buss (Sub Boom & Crunch)',
    category: 'audio_effect',
    packName: 'Ableton Live 12 Core Audio FX',
    description: 'All-in-one analog drum processor with transient shaper, sub-bass boom enhancer, and crunch.',
    defaultParameters: [
      { name: 'Drive', value: 36, unit: '%' },
      { name: 'Boom', value: 42, unit: '%' },
      { name: 'Transients', value: 0.28 },
    ],
    xmlSnippet: `<DrumBuss Id="8207"><IsOn><Manual Value="true" /></IsOn><Drive><Manual Value="0.36" /></Drive><Boom><Manual Value="0.42" /></Boom></DrumBuss>`,
  },
  {
    id: 'fx_glue',
    xmlTag: 'GlueCompressor',
    displayName: 'Glue Compressor (SSL Bus)',
    category: 'audio_effect',
    packName: 'Ableton Live 12 Core Audio FX',
    description: 'Classic 80s console bus compressor with soft-clipping and sidechain high-pass.',
    defaultParameters: [
      { name: 'Ratio', value: '4:1' },
      { name: 'Makeup', value: 2.5, unit: 'dB' },
      { name: 'Soft Clip', value: 'In' },
    ],
    xmlSnippet: `<GlueCompressor Id="8208"><IsOn><Manual Value="true" /></IsOn><Ratio><Manual Value="4.0" /></Ratio><Makeup><Manual Value="2.5" /></Makeup></GlueCompressor>`,
  },
  {
    id: 'fx_limiter',
    xmlTag: 'Limiter',
    displayName: 'Limiter (Brickwall -0.3 dBFS)',
    category: 'audio_effect',
    packName: 'Ableton Live 12 Core Audio FX',
    description: 'Zero-overshoot lookahead brickwall limiter protecting tracks and master bus from digital clipping.',
    defaultParameters: [
      { name: 'Ceiling', value: -0.3, unit: 'dB' },
      { name: 'Gain', value: 2.0, unit: 'dB' },
      { name: 'Release', value: 85, unit: 'ms' },
    ],
    xmlSnippet: `<Limiter Id="8209"><IsOn><Manual Value="true" /></IsOn><Ceiling><Manual Value="-0.3" /></Ceiling><Gain><Manual Value="2.0" /></Gain></Limiter>`,
  },
  {
    id: 'inst_simpler',
    xmlTag: 'OriginalSimpler',
    displayName: 'Simpler (909 Hat / Ride Voice)',
    category: 'instrument',
    packName: 'Ableton Live 12 Core',
    description: '909 hat and cymbal voice synthesizer with pitch transpose, fine tune, decay, and lowpass filter.',
    defaultParameters: [
      { name: 'FilterCutoffHz', value: 7500, unit: 'Hz' },
      { name: 'Transpose', value: 0, unit: 'st' },
      { name: 'Decay', value: 0.18, unit: 's' },
    ],
    xmlSnippet: `<OriginalSimpler Id="8107"><IsOn><Manual Value="true" /></IsOn><Cutoff><Manual Value="7500" /></Cutoff><Transpose><Manual Value="0" /></Transpose><Decay><Manual Value="0.18" /></Decay></OriginalSimpler>`,
  },
  {
    id: 'fx_autofilter',
    xmlTag: 'AutoFilter',
    displayName: 'Auto Filter (24dB Resonant)',
    category: 'audio_effect',
    packName: 'Ableton Live 12 Core Audio FX',
    description: 'Resonant multimode biquad filter with envelope modulation.',
    defaultParameters: [
      { name: 'FilterType', value: 'Lowpass' },
      { name: 'Cutoff', value: 1200, unit: 'Hz', automationTarget: true },
      { name: 'Resonance', value: 0.35 },
    ],
    xmlSnippet: `<AutoFilter Id="8210"><IsOn><Manual Value="true" /></IsOn><FilterType><Manual Value="Lowpass" /></FilterType><Cutoff><Manual Value="1200" /></Cutoff><Resonance><Manual Value="0.35" /></Resonance></AutoFilter>`,
  },
  {
    id: 'fx_delay',
    xmlTag: 'Delay',
    displayName: 'Delay (Stereo Feedback Delay)',
    category: 'audio_effect',
    packName: 'Ableton Live 12 Core Audio FX',
    description: 'Clean feedback delay line with lowpass damping filter.',
    defaultParameters: [
      { name: 'DelayTime', value: 280, unit: 'ms' },
      { name: 'Feedback', value: 0.35 },
      { name: 'DryWet', value: 32, unit: '%' },
    ],
    xmlSnippet: `<Delay Id="8211"><IsOn><Manual Value="true" /></IsOn><DelayTime><Manual Value="280" /></DelayTime><Feedback><Manual Value="0.35" /></Feedback><DryWet><Manual Value="32" /></DryWet></Delay>`,
  },
  {
    id: 'fx_chorus_ensemble',
    xmlTag: 'ChorusEnsemble',
    displayName: 'Chorus-Ensemble (LFO Modulated)',
    category: 'audio_effect',
    packName: 'Ableton Live 12 Core Audio FX',
    description: 'LFO-modulated stereo chorus and ensemble widener.',
    defaultParameters: [
      { name: 'Rate', value: 0.65, unit: 'Hz' },
      { name: 'Amount', value: 50, unit: '%' },
      { name: 'DryWet', value: 45, unit: '%' },
    ],
    xmlSnippet: `<ChorusEnsemble Id="8212"><IsOn><Manual Value="true" /></IsOn><Rate><Manual Value="0.65" /></Rate><Amount><Manual Value="50" /></Amount><DryWet><Manual Value="45" /></DryWet></ChorusEnsemble>`,
  },
  {
    id: 'fx_overdrive',
    xmlTag: 'Overdrive',
    displayName: 'Overdrive (Midrange Diode Drive)',
    category: 'audio_effect',
    packName: 'Ableton Live 12 Core Audio FX',
    description: 'Band-focused harmonic overdrive for percussion and acid leads.',
    defaultParameters: [
      { name: 'Drive', value: 45, unit: '%' },
      { name: 'Tone', value: 2800, unit: 'Hz' },
      { name: 'DryWet', value: 80, unit: '%' },
    ],
    xmlSnippet: `<Overdrive Id="8213"><IsOn><Manual Value="true" /></IsOn><Drive><Manual Value="45" /></Drive><Tone><Manual Value="2800" /></Tone><DryWet><Manual Value="80" /></DryWet></Overdrive>`,
  },
  {
    id: 'fx_utility',
    xmlTag: 'Utility',
    displayName: 'Utility (Gain & Stereo Trim)',
    category: 'audio_effect',
    packName: 'Ableton Live 12 Core Audio FX',
    description: 'Precision gain staging and stereo balance utility.',
    defaultParameters: [
      { name: 'Gain', value: 0, unit: 'dB' },
      { name: 'Balance', value: 0 },
    ],
    xmlSnippet: `<Utility Id="8214"><IsOn><Manual Value="true" /></IsOn><Gain><Manual Value="0" /></Gain><Balance><Manual Value="0" /></Balance></Utility>`,
  },
  {
    id: 'fx_reverb',
    xmlTag: 'Reverb',
    displayName: 'Reverb (Algorithmic Tank)',
    category: 'audio_effect',
    packName: 'Ableton Live 12 Core Audio FX',
    description: 'Multi-tap feedback diffuser with pre-delay and high-cut damping.',
    defaultParameters: [
      { name: 'DecayTime', value: 2.4, unit: 's' },
      { name: 'PreDelay', value: 18, unit: 'ms' },
      { name: 'HighCut', value: 4800, unit: 'Hz' },
      { name: 'DryWet', value: 35, unit: '%' },
    ],
    xmlSnippet: `<Reverb Id="8215"><IsOn><Manual Value="true" /></IsOn><DecayTime><Manual Value="2.4" /></DecayTime><PreDelay><Manual Value="18" /></PreDelay><HighCut><Manual Value="4800" /></HighCut><DryWet><Manual Value="35" /></DryWet></Reverb>`,
  },
  {
    id: 'fx_autopan',
    xmlTag: 'AutoPan',
    displayName: 'Auto Pan (LFO Stereo Modulator)',
    category: 'audio_effect',
    packName: 'Ableton Live 12 Core Audio FX',
    description: 'LFO-modulated stereo panner and amplitude tremolo.',
    defaultParameters: [
      { name: 'Rate', value: 1.5, unit: 'Hz' },
      { name: 'Amount', value: 65, unit: '%' },
      { name: 'Shape', value: 'Sine' },
    ],
    xmlSnippet: `<AutoPan Id="8216"><IsOn><Manual Value="true" /></IsOn><Rate><Manual Value="1.5" /></Rate><Amount><Manual Value="65" /></Amount><Shape Value="Sine" /></AutoPan>`,
  },
  {
    id: 'fx_erosion',
    xmlTag: 'Erosion',
    displayName: 'Erosion (Short-Delay FM Grit)',
    category: 'audio_effect',
    packName: 'Ableton Live 12 Core Audio FX',
    description: 'Audio-rate short-delay modulation for metallic grit and crunch.',
    defaultParameters: [
      { name: 'Frequency', value: 2400, unit: 'Hz' },
      { name: 'Amount', value: 40, unit: '%' },
      { name: 'Width', value: 2.0 },
    ],
    xmlSnippet: `<Erosion Id="8217"><IsOn><Manual Value="true" /></IsOn><Frequency><Manual Value="2400" /></Frequency><Amount><Manual Value="40" /></Amount><Width><Manual Value="2.0" /></Width></Erosion>`,
  },
  // MIDI EFFECTS & RACKS
  {
    id: 'midi_chord',
    xmlTag: 'MidiChord',
    displayName: 'Chord (Dub Minor 9th Voicer)',
    category: 'midi_effect',
    packName: 'Ableton Live 12 Core MIDI FX',
    description: 'Builds multi-note minor 7th, Phrygian cluster, or wide dub 9th voicings from single MIDI notes.',
    defaultParameters: [
      { name: 'Shift 1', value: '+3 st (m3)' },
      { name: 'Shift 2', value: '+7 st (P5)' },
      { name: 'Shift 3', value: '+14 st (9th)' },
    ],
    xmlSnippet: `<MidiChord Id="8301"><IsOn><Manual Value="true" /></IsOn><Shift1 Value="3" /><Shift2 Value="7" /><Shift3 Value="14" /></MidiChord>`,
  },
  {
    id: 'midi_arpeggiator',
    xmlTag: 'MidiArpeggiator',
    displayName: 'Arpeggiator (Poly-Rate 1/16)',
    category: 'midi_effect',
    packName: 'Ableton Live 12 Core MIDI FX',
    description: 'Tempo-synced rhythmic step arpeggiator with gate scaling and octave transposition.',
    defaultParameters: [
      { name: 'Rate', value: '1/16' },
      { name: 'Gate', value: 68, unit: '%' },
      { name: 'Style', value: 'Up/Down' },
    ],
    xmlSnippet: `<MidiArpeggiator Id="8302"><IsOn><Manual Value="true" /></IsOn><Rate Value="1/16" /><Gate Value="0.68" /></MidiArpeggiator>`,
  },
  {
    id: 'rack_acid_303',
    xmlTag: 'InstrumentGroupDevice',
    displayName: 'TB-303 Acid Squelch Rack',
    category: 'rack',
    packName: 'Underground Acid Pack',
    description: 'Complete Ableton Instrument Rack combining Analog 303 diode filter, Overdrive, Roar, and 3/16 Echo.',
    defaultParameters: [
      { name: 'Cutoff Macro', value: 420, unit: 'Hz', automationTarget: true },
      { name: 'Resonance', value: 82, unit: '%' },
      { name: 'Env Mod', value: 74, unit: '%' },
    ],
    xmlSnippet: `<InstrumentGroupDevice Id="8401"><IsOn><Manual Value="true" /></IsOn><MacroControls.0><Manual Value="78.0" /></MacroControls.0></InstrumentGroupDevice>`,
  },
];

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function rootKeyToMidiBase(rootKey: string, octave = 1): number {
  const idx = NOTE_NAMES.indexOf(rootKey.toUpperCase());
  const semitone = idx >= 0 ? idx : 5; // Default F
  return (octave + 1) * 12 + semitone; // F1 = 29
}

export function rootKeyToFundamentalHz(rootKey: string): number {
  const midiSub = rootKeyToMidiBase(rootKey, 1); // e.g., F1 = 29 (43.65 Hz) or F2 = 41 (87.31 Hz)
  const rawHz = 440 * Math.pow(2, (midiSub - 69) / 12);
  // Keep kick fundamental notch in the optimal 46 Hz - 68 Hz club sub-fundamental zone
  return Number((rawHz < 45 ? rawHz * 1.25 : rawHz).toFixed(1));
}

export function midiNoteToName(midi: number): string {
  const note = NOTE_NAMES[((midi % 12) + 12) % 12] || 'C';
  const octave = Math.floor(midi / 12) - 1;
  return `${note}${octave}`;
}

export function gridDivisionToStepBeats(division: NoteGridDivision): number {
  switch (division) {
    case '1/4':
      return 1.0;
    case '1/8':
      return 0.5;
    case '1/32':
      return 0.125;
    case '1/16':
    default:
      return 0.25;
  }
}

export function buildChordVoicingOffsets(
  voicingSpread: VoicingSpreadStyle,
  scale = 'Phrygian'
): number[] {
  const isPhrygian =
    scale.toLowerCase().includes('phrygian') || scale.toLowerCase().includes('locrian');
  switch (voicingSpread) {
    case 'narrow':
      return [0, isPhrygian ? 1 : 2];
    case 'close':
      return [0, 3, 7];
    case 'wide':
      return [0, 7, 15, 22];
    case 'octave':
      return [0, 12];
    default:
      return [0];
  }
}

/**
 * SplitMix32 Seeded PRNG for high-entropy, deterministic, non-repeating randomness
 */
export function seededRandom(seed: number): number {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/**
 * Box-Muller Gaussian random number generator using SplitMix32
 */
export function gaussianRandom(mean = 0, stdev = 1, seed = 0): number {
  const u1 = Math.max(1e-7, seededRandom(seed * 2 + 1));
  const u2 = seededRandom(seed * 2 + 2);
  const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
  return z0 * stdev + mean;
}

/**
 * Generates 16 normalized control points (0.0 to 1.0) for a given velocity curve preset.
 */
export function generateVelocityCurvePoints(preset: VelocityCurvePreset, seed = 1): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 16; i++) {
    const x = i / 15; // 0.0 to 1.0
    switch (preset) {
      case 'exponential':
        pts.push(Number(Math.min(1, Math.max(0.08, Math.pow(x, 2.2) * 0.88 + 0.12)).toFixed(3)));
        break;
      case 'inverse':
        pts.push(Number(Math.min(1, Math.max(0.08, Math.pow(1 - x, 1.85) * 0.88 + 0.12)).toFixed(3)));
        break;
      case 'linear':
        pts.push(Number((0.18 + x * 0.78).toFixed(3)));
        break;
      case 's_curve': {
        const s = 1 / (1 + Math.exp(-8 * (x - 0.5)));
        pts.push(Number((0.12 + s * 0.84).toFixed(3)));
        break;
      }
      case 'accent_4x4': {
        const stepInBeat = i % 4;
        const val = stepInBeat === 0 ? 0.94 : stepInBeat === 1 ? 0.28 : stepInBeat === 2 ? 0.86 : 0.62;
        pts.push(val);
        break;
      }
      case 'random': {
        const r = 0.16 + seededRandom(seed + i * 29 + 17) * 0.8;
        pts.push(Number(r.toFixed(3)));
        break;
      }
      case 'custom':
      default:
        pts.push(0.75);
        break;
    }
  }
  return pts;
}

export function getDefaultVelocityCurveForArchetype(archetype: TechnoArchetype): VelocityCurveConfig {
  switch (archetype) {
    case 'kick':
      return {
        preset: 'accent_4x4',
        points: generateVelocityCurvePoints('accent_4x4', 101),
        intensity: 0.45,
        minVelocity: 32,
        maxVelocity: 126,
        scopeMode: 'bar_16th',
      };
    case 'rumble':
      return {
        preset: 'exponential',
        points: [
          0.22, 0.34, 0.88, 0.74,
          0.22, 0.36, 0.90, 0.76,
          0.22, 0.35, 0.88, 0.78,
          0.24, 0.40, 0.92, 0.84,
        ],
        intensity: 0.65,
        minVelocity: 26,
        maxVelocity: 118,
        scopeMode: 'bar_16th',
      };
    case 'acid':
      return {
        preset: 's_curve',
        points: [
          0.88, 0.36, 0.94, 0.42,
          0.76, 0.32, 0.96, 0.64,
          0.84, 0.35, 0.92, 0.48,
          0.90, 0.58, 0.98, 0.78,
        ],
        intensity: 0.75,
        minVelocity: 34,
        maxVelocity: 126,
        scopeMode: 'bar_16th',
      };
    case 'ride':
      return {
        preset: 'accent_4x4',
        points: [
          0.62, 0.38, 0.94, 0.52,
          0.64, 0.40, 0.95, 0.54,
          0.62, 0.38, 0.94, 0.52,
          0.68, 0.46, 0.96, 0.62,
        ],
        intensity: 0.68,
        minVelocity: 38,
        maxVelocity: 122,
        scopeMode: 'bar_16th',
      };
    case 'pad':
      return {
        preset: 'exponential',
        points: generateVelocityCurvePoints('exponential', 404),
        intensity: 0.6,
        minVelocity: 40,
        maxVelocity: 112,
        scopeMode: 'arrangement_16bar',
      };
    case 'percussion':
      return {
        preset: 's_curve',
        points: generateVelocityCurvePoints('s_curve', 202),
        intensity: 0.6,
        minVelocity: 28,
        maxVelocity: 122,
        scopeMode: 'bar_16th',
      };
    case 'synth':
      return {
        preset: 'exponential',
        points: generateVelocityCurvePoints('exponential', 303),
        intensity: 0.7,
        minVelocity: 30,
        maxVelocity: 124,
        scopeMode: 'arrangement_16bar',
      };
    case 'hats':
    default:
      return {
        preset: 'accent_4x4',
        points: [
          0.32, 0.26, 0.92, 0.35,
          0.30, 0.28, 0.94, 0.38,
          0.32, 0.25, 0.92, 0.36,
          0.34, 0.30, 0.95, 0.44,
        ],
        intensity: 0.7,
        minVelocity: 22,
        maxVelocity: 120,
        scopeMode: 'bar_16th',
      };
  }
}

export function getDefaultSpectralDuckingConfig(
  archetypeOrKey: TechnoArchetype | string,
  rootKeyOrArchetype = 'F',
  tempo = 134
): SpectralDuckingConfig {
  const knownArchetypes = new Set([
    'kick',
    'rumble',
    'percussion',
    'synth',
    'hats',
    'acid',
    'ride',
    'pad',
    'existing',
  ]);
  const isFirstArchetype = knownArchetypes.has(archetypeOrKey);
  const archetype = (isFirstArchetype ? archetypeOrKey : rootKeyOrArchetype) as TechnoArchetype;
  const rootKey = isFirstArchetype ? rootKeyOrArchetype : archetypeOrKey;

  const notchHz = rootKeyToFundamentalHz(rootKey);
  const sixteenthMs = Math.round((60000 / Math.max(90, tempo)) * 0.25);
  const isLowEndHeavy = archetype === 'rumble' || archetype === 'acid' || archetype === 'pad';
  return {
    enabled: isLowEndHeavy,
    notchFreqHz: notchHz,
    notchGainDb: archetype === 'rumble' ? -9.5 : archetype === 'acid' ? -7.5 : -5.5,
    notchQ: archetype === 'rumble' ? 3.4 : 2.8,
    dynamicThresholdDb: -22.0,
    sidechainThresholdDb: -22.0,
    sidechainRatio: archetype === 'rumble' ? 5.2 : archetype === 'acid' ? 4.4 : 3.5,
    releaseMs: Math.max(45, Math.min(220, sixteenthMs)),
    subCrossoverHz: archetype === 'rumble' ? 135 : 115,
    collisionIndexPct: isLowEndHeavy ? 12 : 4,
    collisionIndex: isLowEndHeavy ? 0.12 : 0.04,
  };
}

export function getDefaultPolyrhythmConfig(archetype: TechnoArchetype): PolyrhythmConfig {
  switch (archetype) {
    case 'percussion':
      return {
        steps: 7,
        pulses: 4,
        rotation: 1,
        stepDivision: '1/16',
        voicingSpread: 'close',
        accentProbability: 0.75,
        truePolymeterLoop: true,
      };
    case 'acid':
      return {
        steps: 13,
        pulses: 8,
        rotation: 0,
        stepDivision: '1/16',
        voicingSpread: 'octave',
        accentProbability: 0.82,
        truePolymeterLoop: true,
      };
    case 'synth':
      return {
        steps: 11,
        pulses: 5,
        rotation: 2,
        stepDivision: '1/16',
        voicingSpread: 'wide',
        accentProbability: 0.7,
        truePolymeterLoop: true,
      };
    case 'pad':
      return {
        steps: 16,
        pulses: 4,
        rotation: 2,
        stepDivision: '1/8',
        voicingSpread: 'wide',
        accentProbability: 0.65,
        truePolymeterLoop: false,
      };
    case 'ride':
      return {
        steps: 16,
        pulses: 12,
        rotation: 0,
        stepDivision: '1/16',
        voicingSpread: 'narrow',
        accentProbability: 0.78,
        truePolymeterLoop: false,
      };
    case 'rumble':
    default:
      return {
        steps: 16,
        pulses: 11,
        rotation: 1,
        stepDivision: '1/16',
        voicingSpread: 'narrow',
        accentProbability: 0.85,
        truePolymeterLoop: false,
      };
  }
}

/**
 * Computes the frequency overlap & phase collision between the Kick track and the Sub/Rumble/Acid track.
 */
export function computeKickSubSpectralOverlap(
  projectOrKick?: AbletonProjectState | AbletonTrack,
  targetOrSubTrack?: AbletonTrack,
  rootKeyOverride?: string,
  duckConfigOverride?: SpectralDuckingConfig
): {
  kickFundamentalHz: number;
  kickPunchHz: number;
  subEnergyRatio: number;
  rawCollisionPct: number;
  postDuckCollisionPct: number;
  collisionIndex: number;
  recommendedNotchHz: number;
  recommendedNotchDb: number;
  overlapCurveKick: number[];
  overlapCurveSub: number[];
  overlapCurveDucked: number[];
  kickSpectrum: number[];
  subSpectrumRaw: number[];
  subSpectrumDucked: number[];
} {
  const isProject = Boolean(projectOrKick && 'tracks' in projectOrKick);
  const project = isProject ? (projectOrKick as AbletonProjectState) : undefined;
  const kickTrack = isProject
    ? project!.tracks.find((t) => t.archetype === 'kick') || project!.tracks[0]
    : (projectOrKick as AbletonTrack | undefined);

  const subTrack =
    targetOrSubTrack && targetOrSubTrack.archetype !== 'kick'
      ? targetOrSubTrack
      : project?.tracks.find((t) => t.archetype === 'rumble' || t.archetype === 'acid') ||
        project?.tracks[1] ||
        targetOrSubTrack;

  const rootKey = rootKeyOverride || project?.rootKey || 'F';
  const tempo = project?.tempo || 134;

  const kickFundHz = rootKeyToFundamentalHz(rootKey);
  const kickPunchHz = Math.round(kickFundHz * 1.85);

  const kickSteps = new Set<number>();
  kickTrack?.clips?.[0]?.notes.forEach((n) => {
    const step = Math.round((n.quantizedTime % 4) * 4) % 16;
    kickSteps.add(step);
  });
  if (kickSteps.size === 0) {
    [0, 4, 8, 12].forEach((s) => kickSteps.add(s));
  }

  let simultaneousHits = 0;
  let totalSubHits = 0;
  subTrack?.clips?.[0]?.notes.forEach((n) => {
    totalSubHits++;
    const step = Math.round((n.quantizedTime % 4) * 4) % 16;
    if (kickSteps.has(step)) simultaneousHits++;
  });

  const duckCfg =
    duckConfigOverride ||
    subTrack?.spectralDucking ||
    getDefaultSpectralDuckingConfig(subTrack?.archetype || 'rumble', rootKey, tempo);
  const scDepth = subTrack?.mixer?.sidechainDepth ?? 0.75;

  const stepOverlapFactor = totalSubHits > 0 ? simultaneousHits / totalSubHits : 0.25;
  const rawCollisionPct = Math.min(
    96,
    Math.max(18, Math.round(48 + stepOverlapFactor * 38 + (subTrack?.archetype === 'rumble' ? 14 : 6)))
  );

  const notchAttenuationFactor = duckCfg.enabled
    ? Math.min(0.82, Math.abs(duckCfg.notchGainDb) / 14)
    : 0.1;
  const postDuckCollisionPct = Math.max(
    4,
    Math.round(rawCollisionPct * (1 - notchAttenuationFactor * 0.65) * (1 - scDepth * 0.45))
  );

  const overlapCurveKick: number[] = [];
  const overlapCurveSub: number[] = [];
  const overlapCurveDucked: number[] = [];

  for (let i = 0; i < 32; i++) {
    const freq = 20 * Math.pow(320 / 20, i / 31); // 20 Hz to 320 Hz log spacing
    const dFund = (freq - kickFundHz) / 14;
    const dPunch = (freq - kickPunchHz) / 28;
    const kickMag = Math.min(
      1,
      Math.max(0.05, 0.94 * Math.exp(-0.5 * dFund * dFund) + 0.62 * Math.exp(-0.5 * dPunch * dPunch))
    );

    const subCenter = subTrack?.archetype === 'acid' ? kickFundHz * 1.65 : kickFundHz * 1.12;
    const subWidth = subTrack?.archetype === 'acid' ? 52 : 34;
    const dSub = (freq - subCenter) / subWidth;
    const subMag = Math.min(0.95, Math.max(0.06, 0.88 * Math.exp(-0.5 * dSub * dSub)));

    const dNotch =
      (freq - duckCfg.notchFreqHz) / Math.max(6, duckCfg.notchFreqHz / Math.max(0.7, duckCfg.notchQ));
    const notchLinearCut = duckCfg.enabled
      ? 1 - (Math.min(12, Math.abs(duckCfg.notchGainDb)) / 15) * Math.exp(-0.5 * dNotch * dNotch)
      : 1.0;
    const hpfCut = freq < 30 ? Math.pow(freq / 30, 3) : 1.0;

    overlapCurveKick.push(Number(kickMag.toFixed(3)));
    overlapCurveSub.push(Number(subMag.toFixed(3)));
    overlapCurveDucked.push(Number((subMag * notchLinearCut * hpfCut * (1 - scDepth * 0.25)).toFixed(3)));
  }

  const effectivePct = duckCfg.enabled ? postDuckCollisionPct : rawCollisionPct;

  return {
    kickFundamentalHz: kickFundHz,
    kickPunchHz,
    subEnergyRatio: Number((1 - postDuckCollisionPct / 100).toFixed(2)),
    rawCollisionPct,
    postDuckCollisionPct,
    collisionIndex: Number((effectivePct / 100).toFixed(2)),
    recommendedNotchHz: kickFundHz,
    recommendedNotchDb: subTrack?.archetype === 'rumble' ? -9.5 : -7.5,
    overlapCurveKick,
    overlapCurveSub,
    overlapCurveDucked,
    kickSpectrum: overlapCurveKick,
    subSpectrumRaw: overlapCurveSub,
    subSpectrumDucked: overlapCurveDucked,
  };
}

/**
 * Injects a surgical dynamic <EQEight> notch + <Compressor2> sidechain into the target track's <DeviceChain> XML.
 */
export function applySpectralAutoDuckToTrackXml(
  currentXml: string,
  trackIdOrName: string,
  trackNameOrArchetype: string,
  config: SpectralDuckingConfig,
  _kickId?: string
): string {
  const parser = new DOMParser();
  const sanitized = currentXml.replace(/xmlns(:[a-zA-Z0-9_-]+)?="[^"]*"/g, '');
  const xmlDoc = parser.parseFromString(sanitized, 'application/xml');

  const trackEl = Array.from(xmlDoc.querySelectorAll('Tracks > MidiTrack, Tracks > AudioTrack')).find((el) => {
    const eff = el.querySelector('Name > EffectiveName')?.getAttribute('Value') || '';
    const idAttr = el.getAttribute('Id') || '';
    return (
      idAttr === trackIdOrName ||
      eff === trackIdOrName ||
      eff === trackNameOrArchetype ||
      eff.toLowerCase().includes(trackNameOrArchetype.toLowerCase())
    );
  });

  if (!trackEl) return currentXml;

  let devicesContainer =
    trackEl.querySelector('DeviceChain > MidiToAudioDeviceChain > Devices') ||
    trackEl.querySelector('DeviceChain > Devices');

  if (!devicesContainer) {
    const dc = trackEl.querySelector('DeviceChain') || trackEl.appendChild(xmlDoc.createElement('DeviceChain'));
    const m2a = xmlDoc.createElement('MidiToAudioDeviceChain');
    devicesContainer = xmlDoc.createElement('Devices');
    m2a.appendChild(devicesContainer);
    dc.appendChild(m2a);
  }

  // GATE 1 SAFETY: Only replace previous Parametric-injected Auto-Duck nodes; NEVER remove user-created EQEight or Compressor2
  Array.from(devicesContainer.querySelectorAll('EQEight')).forEach((el) => {
    if (el.getAttribute('Data-Parametric-AutoDuck') === 'true' || el.getAttribute('Id') === '8801') {
      el.remove();
    }
  });

  const effThreshold = config.sidechainThresholdDb ?? config.dynamicThresholdDb ?? -22.0;
  const effSubCross = config.subCrossoverHz ?? 135.0;
  const effRelease = config.releaseMs ?? config.sidechainReleaseMs ?? 115.0;
  const effAttack = config.sidechainAttackMs ?? 0.25;

  const eqEightXml = `
    <EQEight Id="8801" Data-Parametric-AutoDuck="true">
      <LomId Value="0" />
      <IsOn><Manual Value="${config.enabled ? 'true' : 'false'}" /></IsOn>
      <Band.1>
        <IsOn Value="true" />
        <FilterType Value="HighPass48" />
        <Freq Value="28.0" />
        <Gain Value="0.0" />
        <Q Value="0.71" />
      </Band.1>
      <Band.2>
        <IsOn Value="true" />
        <FilterType Value="Bell" />
        <Freq Value="${config.notchFreqHz.toFixed(1)}" />
        <Gain Value="${config.notchGainDb.toFixed(1)}" />
        <Q Value="${config.notchQ.toFixed(2)}" />
        <DynamicMode Value="true" />
        <DynamicThreshold Value="${effThreshold.toFixed(1)}" />
      </Band.2>
      <Band.3>
        <IsOn Value="true" />
        <FilterType Value="LowShelf" />
        <Freq Value="${effSubCross.toFixed(1)}" />
        <Gain Value="-1.8" />
        <Q Value="0.90" />
      </Band.3>
    </EQEight>
  `.trim();

  const eqDoc = new DOMParser().parseFromString(eqEightXml, 'application/xml');
  devicesContainer.appendChild(xmlDoc.importNode(eqDoc.documentElement, true));

  Array.from(devicesContainer.querySelectorAll('Compressor2')).forEach((el) => {
    if (el.getAttribute('Data-Parametric-AutoDuck') === 'true' || el.getAttribute('Id') === '8802') {
      el.remove();
    }
  });
  const compXml = `
    <Compressor2 Id="8802" Data-Parametric-AutoDuck="true">
      <LomId Value="0" />
      <IsOn><Manual Value="true" /></IsOn>
      <Sidechain>
        <IsOn Value="true" />
        <SourceTrack Value="01_Kick_909_Foundation" />
        <EqFrequency Value="${config.notchFreqHz.toFixed(1)}" />
      </Sidechain>
      <Threshold><Manual Value="${effThreshold.toFixed(1)}" /></Threshold>
      <Ratio><Manual Value="${config.sidechainRatio.toFixed(1)}" /></Ratio>
      <Attack><Manual Value="${effAttack.toFixed(2)}" /></Attack>
      <Release><Manual Value="${effRelease.toFixed(1)}" /></Release>
    </Compressor2>
  `.trim();

  const compDoc = new DOMParser().parseFromString(compXml, 'application/xml');
  devicesContainer.appendChild(xmlDoc.importNode(compDoc.documentElement, true));

  trackEl.setAttribute('Data-Spectral-AutoDuck', config.enabled ? 'true' : 'false');
  return formatXmlString(new XMLSerializer().serializeToString(xmlDoc));
}

export function injectLibraryDeviceIntoTrackXml(
  currentXml: string,
  trackIdOrName: string,
  trackNameOrArchetype: string,
  templateOrId: AbletonLibraryDeviceTemplate | string
): string {
  const template =
    typeof templateOrId === 'string'
      ? ABLETON_BUILTIN_LIBRARY.find((d) => d.id === templateOrId || d.xmlTag === templateOrId) ||
        ABLETON_BUILTIN_LIBRARY[0]
      : templateOrId;

  const parser = new DOMParser();
  const sanitized = currentXml.replace(/xmlns(:[a-zA-Z0-9_-]+)?="[^"]*"/g, '');
  const xmlDoc = parser.parseFromString(sanitized, 'application/xml');

  const trackEl = Array.from(xmlDoc.querySelectorAll('Tracks > MidiTrack, Tracks > AudioTrack')).find((el) => {
    const eff = el.querySelector('Name > EffectiveName')?.getAttribute('Value') || '';
    const idAttr = el.getAttribute('Id') || '';
    return (
      idAttr === trackIdOrName ||
      eff === trackIdOrName ||
      eff === trackNameOrArchetype ||
      eff.toLowerCase().includes(trackNameOrArchetype.toLowerCase())
    );
  });

  if (!trackEl) return currentXml;

  let devicesContainer =
    trackEl.querySelector('DeviceChain > MidiToAudioDeviceChain > Devices') ||
    trackEl.querySelector('DeviceChain > Devices');

  if (!devicesContainer) {
    const dc = trackEl.querySelector('DeviceChain') || trackEl.appendChild(xmlDoc.createElement('DeviceChain'));
    const m2a = xmlDoc.createElement('MidiToAudioDeviceChain');
    devicesContainer = xmlDoc.createElement('Devices');
    m2a.appendChild(devicesContainer);
    dc.appendChild(m2a);
  }

  const devDoc = new DOMParser().parseFromString(template.xmlSnippet, 'application/xml');
  const imported = xmlDoc.importNode(devDoc.documentElement, true);
  imported.setAttribute('Id', `${Math.floor(8000 + Math.random() * 1900)}`);

  if (template.category === 'instrument' || template.category === 'midi_effect') {
    devicesContainer.insertBefore(imported, devicesContainer.firstChild);
  } else {
    devicesContainer.appendChild(imported);
  }

  return formatXmlString(new XMLSerializer().serializeToString(xmlDoc));
}

/**
 * Evaluates a track's VelocityCurveConfig across an array of MidiNoteEvents,
 * blending the custom/preset curve with Gaussian velocity humanization and ghost note bounds.
 */
export function applyTrackVelocityCurveToNotes(
  notes: MidiNoteEvent[],
  velocityCurve: VelocityCurveConfig | undefined,
  humanization: HumanizationConfig,
  seed: number,
  totalArrangementBeats = 64
): MidiNoteEvent[] {
  if (!velocityCurve || !velocityCurve.points || velocityCurve.points.length === 0) {
    return notes;
  }

  const pts = velocityCurve.points;
  const numPts = pts.length;
  const minVel = Math.max(1, Math.min(126, velocityCurve.minVelocity));
  const maxVel = Math.max(minVel + 1, Math.min(127, velocityCurve.maxVelocity));
  const intensity = Math.max(0, Math.min(1, velocityCurve.intensity));
  const velVar = humanization.velocityVariancePct;
  const macroSpan = Math.max(16, totalArrangementBeats);

  return notes.map((note, idx) => {
    const qTime = typeof note.quantizedTime === 'number' ? note.quantizedTime : note.time;
    const normPos =
      velocityCurve.scopeMode === 'arrangement_16bar'
        ? (((qTime % macroSpan) + macroSpan) % macroSpan) / macroSpan
        : (((qTime % 4) + 4) % 4) / 4;

    const exactIdx = normPos * (numPts - 1);
    const i0 = Math.max(0, Math.min(numPts - 1, Math.floor(exactIdx)));
    const i1 = Math.max(0, Math.min(numPts - 1, i0 + 1));
    const frac = exactIdx - i0;
    const curveNorm = pts[i0] * (1 - frac) + pts[i1] * frac;

    const targetCurveVelocity = minVel + curveNorm * (maxVel - minVel);
    const blendedBase = note.velocity * (1 - intensity) + targetCurveVelocity * intensity;

    const jitterFactor = 1 + (seededRandom(seed + idx * 19 + Math.round(qTime * 4) * 7) * 2 - 1) * (velVar * 0.65);
    let finalVelocity = Math.round(blendedBase * jitterFactor);

    if (curveNorm < 0.32 && intensity >= 0.4) {
      finalVelocity = Math.max(
        humanization.ghostVelocityMin,
        Math.min(humanization.ghostVelocityMax, finalVelocity)
      );
    } else {
      finalVelocity = Math.max(minVel, Math.min(maxVel, finalVelocity));
    }

    finalVelocity = Math.max(1, Math.min(127, finalVelocity));

    return {
      ...note,
      velocity: finalVelocity,
      isGhost: finalVelocity <= humanization.ghostVelocityMax,
      isAccent: finalVelocity >= 108,
    };
  });
}

/**
 * Generates an advanced poly-metered Euclidean sequence (e.g., 7/16, 11/16, 13/16) with
 * customizable rhythmic step division (1/4, 1/8, 1/16, 1/32) and chord voicing spread (narrow, close, wide, octave).
 */
export function generatePolymeterEuclideanClipNotes(
  archetype: TechnoArchetype,
  rootKey: string,
  scale: string,
  polyConfig: PolyrhythmConfig,
  humanization: HumanizationConfig,
  totalBars = 16,
  seed = 101
): { notes: MidiNoteEvent[]; loopEndBeats: number; clipName: string } {
  const steps = Math.max(3, Math.min(32, polyConfig.steps));
  const pulses = Math.max(1, Math.min(steps, polyConfig.pulses));
  const rotation = ((polyConfig.rotation % steps) + steps) % steps;

  const stepBeatsMap: Record<NoteGridDivision, number> = {
    '1/4': 1.0,
    '1/8': 0.5,
    '1/16': 0.25,
    '1/32': 0.125,
  };
  const stepBeatLen = stepBeatsMap[polyConfig.stepDivision] || 0.25;
  const loopEndBeats = Number((steps * stepBeatLen).toFixed(3));
  const totalArrangementBeats = totalBars * 4;

  // Build Bjorklund Euclidean bitmask
  const activeStepSet = new Set<number>();
  for (let i = 0; i < steps; i++) {
    if (Math.floor((i * pulses) / steps) !== Math.floor(((i - 1) * pulses) / steps)) {
      activeStepSet.add((i + rotation) % steps);
    }
  }

  const octave =
    archetype === 'rumble'
      ? 1
      : archetype === 'acid'
      ? 2
      : archetype === 'kick'
      ? 1
      : 3;
  const basePitch =
    archetype === 'kick'
      ? 36
      : archetype === 'hats'
      ? 46
      : archetype === 'ride'
      ? 51
      : rootKeyToMidiBase(rootKey, octave);

  const isPhrygian = scale.toLowerCase().includes('phrygian') || scale.toLowerCase().includes('locrian');
  const scaleIntervals = isPhrygian ? [0, 1, 3, 5, 7, 8, 10] : [0, 2, 3, 5, 7, 9, 10];

  // Determine chord / voicing intervals based on voicingSpread
  const getVoicingOffsets = (spread: VoicingSpreadStyle, hitIdx: number): number[] => {
    if (archetype === 'kick' || archetype === 'hats' || archetype === 'ride' || archetype === 'rumble') {
      if (spread === 'octave' && hitIdx % 3 === 2 && archetype === 'rumble') return [0, 12];
      return [0];
    }
    switch (spread) {
      case 'narrow':
        return hitIdx % 2 === 0 ? [0, isPhrygian ? 1 : 2] : [0];
      case 'close':
        return hitIdx % 3 === 0 ? [0, 3, 7] : [0];
      case 'wide':
        return hitIdx % 2 === 0 ? [0, 7, 15, 22] : [0, 7, 14];
      case 'octave':
        return hitIdx % 2 === 1 ? [0, 12] : [0];
      default:
        return [0];
    }
  };

  const notes: MidiNoteEvent[] = [];
  const totalStepsAcrossArrangement = Math.ceil(totalArrangementBeats / stepBeatLen);
  let hitCounter = 0;

  for (let globalStep = 0; globalStep < totalStepsAcrossArrangement; globalStep++) {
    const polyStep = globalStep % steps;
    if (!activeStepSet.has(polyStep)) continue;

    const quantizedTime = Number((globalStep * stepBeatLen).toFixed(3));
    if (quantizedTime >= totalArrangementBeats) break;

    // Protect kick downbeats for sub-rumble
    if (archetype === 'rumble' && Math.abs(quantizedTime % 1) < 0.01) continue;

    hitCounter++;
    const maxShift = humanization.microTimingMaxShiftBeats;
    const isDownbeat = Math.abs(quantizedTime % 1) < 0.001;
    const shift = isDownbeat
      ? 0
      : Math.max(-maxShift, Math.min(maxShift, gaussianRandom(0.002, maxShift * 0.55, seed + globalStep * 13)));
    const finalTime = Math.max(0, Number((quantizedTime + shift).toFixed(3)));

    const isAccent = seededRandom(seed + globalStep * 29) <= (polyConfig.accentProbability ?? 0.78);
    const baseVel = isAccent ? 114 : polyStep % 2 === 1 ? 82 : humanization.ghostVelocityMin + 14;
    const velJitter = 1 + (seededRandom(seed + globalStep * 17) * 2 - 1) * humanization.velocityVariancePct;
    const velocity = Math.max(22, Math.min(126, Math.round(baseVel * velJitter)));

    const degreeOffset =
      archetype === 'acid' || archetype === 'synth' || archetype === 'pad' || archetype === 'percussion'
        ? scaleIntervals[(hitCounter + Math.floor(quantizedTime / 4)) % scaleIntervals.length]
        : 0;

    const isSlide = archetype === 'acid' && hitCounter % 3 === 0;
    const gateDur = Number((stepBeatLen * (isSlide ? 1.18 : archetype === 'pad' ? 1.65 : 0.85)).toFixed(3));
    const voicingOffsets = getVoicingOffsets(polyConfig.voicingSpread, hitCounter);

    voicingOffsets.forEach((vOffset, vIdx) => {
      const pitch = Math.max(24, Math.min(96, basePitch + degreeOffset + vOffset));
      const voiceVel = vIdx === 0 ? velocity : Math.max(28, Math.round(velocity * 0.84));
      notes.push({
        id: `poly_${archetype}_${globalStep}_${vIdx}`,
        time: finalTime,
        quantizedTime,
        duration: gateDur,
        pitch,
        velocity: voiceVel,
        isGhost: voiceVel <= humanization.ghostVelocityMax,
        isAccent,
        isSlide,
        motifRole: isAccent ? 'anchor' : 'call',
      });
    });
  }

  const clipName = `Euc_${pulses}_${steps}_${polyConfig.stepDivision.replace('/', '-')}_${polyConfig.voicingSpread}`;
  return { notes, loopEndBeats, clipName };
}

/**
 * Decompresses an uploaded .als file (gzip-compressed XML) in the browser using DecompressionStream
 * with a fallback to server /api/als/decompress or plain UTF-8 XML.
 */
export async function decompressAlsFile(file: File): Promise<{ xml: string; wasGzipped: boolean }> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  const isGzip = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

  if (isGzip && typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('gzip');
      const decompressedStream = new Blob([bytes]).stream().pipeThrough(ds);
      const xmlText = await new Response(decompressedStream).text();
      return { xml: xmlText, wasGzipped: true };
    } catch {
      // Fallback to backend decompression
    }
  }

  if (isGzip) {
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64Data = btoa(binary);
    const res = await fetch('/api/als/decompress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ base64Data }),
    });
    if (!res.ok) {
      throw new Error('Failed to decompress .als archive');
    }
    return await res.json();
  }

  const decoder = new TextDecoder('utf-8');
  return { xml: decoder.decode(bytes), wasGzipped: false };
}

/**
 * Compresses the serialized Ableton XML DOM string into a genuine gzipped .als Blob
 */
export async function compressXmlToAlsBlob(xmlString: string): Promise<{ blob: Blob; gzipBytes: number }> {
  if (typeof CompressionStream !== 'undefined') {
    try {
      const cs = new CompressionStream('gzip');
      const encoder = new TextEncoder();
      const inputBytes = encoder.encode(xmlString);
      const compressedStream = new Blob([inputBytes]).stream().pipeThrough(cs);
      const compressedBuffer = await new Response(compressedStream).arrayBuffer();
      const blob = new Blob([compressedBuffer], { type: 'application/x-ableton-live-set' });
      return { blob, gzipBytes: compressedBuffer.byteLength };
    } catch {
      // Fallback to server compression
    }
  }

  try {
    const res = await fetch('/api/als/compress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ xml: xmlString }),
    });
    const data = await res.json();
    if (data && data.base64Als) {
      const binary = atob(data.base64Als);
      const array = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        array[i] = binary.charCodeAt(i);
      }
      const blob = new Blob([array], { type: 'application/x-ableton-live-set' });
      return { blob, gzipBytes: array.byteLength };
    }
  } catch {
    // Standalone offline fallback
  }

  const fallbackBytes = new TextEncoder().encode(xmlString);
  const fallbackBlob = new Blob([fallbackBytes], { type: 'application/x-ableton-live-set' });
  return { blob: fallbackBlob, gzipBytes: fallbackBytes.byteLength };
}

/**
 * Pretty-formats XML with clean 2-space indentation for inspection and export
 */
export function formatXmlString(xml: string): string {
  const PADDING = '  ';
  const reg = /(>)(<)(\/*)/g;
  let formatted = '';
  let pad = 0;

  const cleaned = xml.replace(/>\s+</g, '><').replace(reg, '$1\r\n$2$3');
  cleaned.split('\r\n').forEach((node) => {
    let indent = 0;
    if (node.match(/.+<\/\w[^>]*>$/)) {
      indent = 0;
    } else if (node.match(/^<\/\w/) && pad > 0) {
      pad -= 1;
    } else if (node.match(/^<\w[^>]*[^\/]>.*$/)) {
      indent = 1;
    } else {
      indent = 0;
    }

    formatted += PADDING.repeat(pad) + node + '\n';
    pad += indent;
  });

  return formatted.trim();
}

/**
 * Procedurally generates a CREATIVELY UNIQUE starter Ableton Live 12 XML project document.
 */
export function buildStarterAbletonXml(
  templateId = 'berghain-134',
  seed?: number,
  totalBars = 16,
  creationMode?: 'sketch' | 'full-track'
): { xml: string; meta: StarterTemplateMeta } {
  const effectiveSeed = typeof seed === 'number' ? seed : Math.floor(Math.random() * 10000000) + 1;
  const rnd = (offset: number) => seededRandom(effectiveSeed + offset);
  const totalBeats = totalBars * 4;
  const effectiveMode: 'sketch' | 'full-track' | undefined = creationMode;

  const rootKeys = ['F', 'F#', 'G', 'G#', 'A', 'D', 'C#', 'E'];
  const scales = ['Phrygian', 'Dorian', 'Natural Minor', 'Locrian'];

  let chosenRoot = rootKeys[Math.floor(rnd(1) * rootKeys.length)];
  let chosenScale = scales[Math.floor(rnd(2) * scales.length)];
  let chosenTempo = 134.0;
  let templateTitle = 'Berghain_Raw_Foundation';
  let templateSub = '';
  let archetypeVariant = templateId;

  if (templateId === 'tresor-138' || rnd(3) > 0.66) {
    archetypeVariant = 'tresor-138';
    chosenTempo = Number((137.0 + rnd(4) * 5.0).toFixed(1));
    chosenRoot = ['F#', 'G', 'A', 'D'][Math.floor(rnd(5) * 4)];
    chosenScale = 'Natural Minor';
    templateTitle = `Tresor_Vault_${chosenTempo}BPM_${effectiveSeed % 1000}`;
    templateSub = `${chosenTempo} BPM · ${chosenRoot} ${chosenScale} · Industrial Kick + Sub Pre-Loaded`;
  } else if (templateId === 'ostgut-128' || rnd(3) > 0.33) {
    archetypeVariant = 'ostgut-128';
    chosenTempo = Number((126.5 + rnd(4) * 4.5).toFixed(1));
    chosenRoot = ['G', 'F', 'D', 'A'][Math.floor(rnd(5) * 4)];
    chosenScale = 'Dorian';
    templateTitle = `Ostgut_Dub_${chosenTempo}BPM_${effectiveSeed % 1000}`;
    templateSub = `${chosenTempo} BPM · ${chosenRoot} ${chosenScale} · Deep Dub Chord Stem`;
  } else {
    archetypeVariant = 'berghain-134';
    chosenTempo = Number((133.0 + rnd(4) * 3.5).toFixed(1));
    chosenRoot = ['F', 'F#', 'C#', 'G#'][Math.floor(rnd(5) * 4)];
    chosenScale = 'Phrygian';
    templateTitle = `Berghain_Core_${chosenTempo}BPM_${effectiveSeed % 1000}`;
    templateSub = `${chosenTempo} BPM · ${chosenRoot} ${chosenScale} · Kick Foundation`;
  }

  const kickPitch = 36;
  const kickVariationType = Math.floor(rnd(6) * 4);
  const kickEvents: string[] = [];

  for (let bar = 0; bar < totalBars; bar++) {
    for (let beat = 0; beat < 4; beat++) {
      const globalBeat = bar * 4 + beat;
      const vel = beat === 0 ? 122 : 115 + Math.floor(rnd(globalBeat * 7) * 6);
      kickEvents.push(
        `<MidiNoteEvent Time="${globalBeat.toFixed(3)}" Duration="0.250" Velocity="${vel}" OffVelocity="64" NoteId="${1000 + globalBeat}" IsEnabled="true" />`
      );

      if (kickVariationType === 1 && beat === 2 && rnd(bar * 5) > 0.4) {
        const ghostBeat = globalBeat + 0.75;
        kickEvents.push(
          `<MidiNoteEvent Time="${ghostBeat.toFixed(3)}" Duration="0.180" Velocity="78" OffVelocity="64" NoteId="${5000 + globalBeat}" IsEnabled="true" />`
        );
      } else if (kickVariationType === 2 && bar % 4 === 3 && beat === 3) {
        const fillBeat = globalBeat + 0.5;
        kickEvents.push(
          `<MidiNoteEvent Time="${fillBeat.toFixed(3)}" Duration="0.200" Velocity="96" OffVelocity="64" NoteId="${6000 + globalBeat}" IsEnabled="true" />`
        );
      }
    }
  }

  let extraTracksXml = '';

  if (archetypeVariant === 'tresor-138') {
    const rumblePitch = rootKeyToMidiBase(chosenRoot, 1);
    const rumbleNotes: string[] = [];
    const rollStyle = Math.floor(rnd(7) * 3);

    for (let bar = 0; bar < totalBars; bar++) {
      for (let step = 0; step < 16; step++) {
        const isDownbeat = step % 4 === 0;
        if (isDownbeat && rollStyle !== 2) continue;

        const t = bar * 4 + step * 0.25 + (step % 2 === 1 ? 0.008 : -0.005);
        let vel = step % 4 === 2 ? 104 : step % 2 === 1 ? 84 : 40;
        if (rollStyle === 1 && step >= 12) vel = 96;

        rumbleNotes.push(
          `<MidiNoteEvent Time="${t.toFixed(3)}" Duration="0.220" Velocity="${vel}" OffVelocity="64" NoteId="${3000 + bar * 16 + step}" IsEnabled="true" />`
        );
      }
    }

    extraTracksXml = `
      <MidiTrack Id="2">
        <Name>
          <EffectiveName Value="02_Rumble_Sub_Operator" />
          <UserName Value="02_Rumble_Sub_Operator" />
        </Name>
        <Color Value="14" />
        <DeviceChain>
          <MidiToAudioDeviceChain>
            <Devices>
              <Operator Id="201">
                <IsOn><Manual Value="true" /></IsOn>
                <OscillatorA><Waveform Value="Sine" /><Coarse Value="0" /><Level Value="0.90" /></OscillatorA>
              </Operator>
              <Reverb Id="202">
                <IsOn><Manual Value="true" /></IsOn>
                <DecayTime><Manual Value="${Math.round(2800 + rnd(8) * 1200)}" /></DecayTime>
                <DryWet><Manual Value="0.40" /></DryWet>
              </Reverb>
              <AutoFilter Id="203">
                <IsOn><Manual Value="true" /></IsOn>
                <FilterType><Manual Value="Lowpass" /></FilterType>
                <Cutoff Id="9203"><Manual Value="${(130 + rnd(9) * 35).toFixed(1)}" /></Cutoff>
                <Resonance><Manual Value="0.26" /></Resonance>
              </AutoFilter>
            </Devices>
          </MidiToAudioDeviceChain>
          <MainSequencer>
            <ClipTimeable>
              <ArrangerAutomation>
                <Events>
                  <MidiClip Id="2001" Time="0">
                    <Name Value="Rumble_16th_Roll" />
                    <CurrentStart Value="0" />
                    <CurrentEnd Value="${totalBeats}" />
                    <Loop><LoopStart Value="0" /><LoopEnd Value="4" /></Loop>
                    <Notes>
                      <KeyTracks>
                        <KeyTrack Id="1">
                          <MidiKey Value="${rumblePitch}" />
                          <Notes>${rumbleNotes.join('')}</Notes>
                        </KeyTrack>
                      </KeyTracks>
                    </Notes>
                  </MidiClip>
                </Events>
              </ArrangerAutomation>
            </ClipTimeable>
          </MainSequencer>
        </DeviceChain>
      </MidiTrack>`;
  } else if (archetypeVariant === 'ostgut-128') {
    const stabPitch = rootKeyToMidiBase(chosenRoot, 3);
    const stabNotes: string[] = [];
    const stabOffsets = rnd(10) > 0.5 ? [0.75, 1.5, 2.75, 3.5] : [0.5, 1.25, 2.5, 3.25];

    for (let bar = 0; bar < totalBars; bar++) {
      stabOffsets.forEach((offset, idx) => {
        const t = bar * 4 + offset + (idx % 2 === 0 ? 0.009 : -0.007);
        stabNotes.push(
          `<MidiNoteEvent Time="${t.toFixed(3)}" Duration="0.320" Velocity="${88 + (idx % 3) * 8}" OffVelocity="64" NoteId="${4000 + bar * 4 + idx}" IsEnabled="true" />`
        );
      });
    }

    extraTracksXml = `
      <MidiTrack Id="2">
        <Name>
          <EffectiveName Value="02_Dub_Chord_Wavetable" />
          <UserName Value="02_Dub_Chord_Wavetable" />
        </Name>
        <Color Value="42" />
        <DeviceChain>
          <MidiToAudioDeviceChain>
            <Devices>
              <InstrumentVector Id="301">
                <IsOn><Manual Value="true" /></IsOn>
                <Oscillator1><WavePosition Value="${(0.35 + rnd(11) * 0.4).toFixed(2)}" /></Oscillator1>
              </InstrumentVector>
              <Echo Id="302">
                <IsOn><Manual Value="true" /></IsOn>
                <Feedback><Manual Value="0.65" /></Feedback>
              </Echo>
            </Devices>
          </MidiToAudioDeviceChain>
          <MainSequencer>
            <ClipTimeable>
              <ArrangerAutomation>
                <Events>
                  <MidiClip Id="3001" Time="0">
                    <Name Value="Dub_Chord_Stabs" />
                    <CurrentStart Value="0" />
                    <CurrentEnd Value="${totalBeats}" />
                    <Loop><LoopStart Value="0" /><LoopEnd Value="4" /></Loop>
                    <Notes>
                      <KeyTracks>
                        <KeyTrack Id="1">
                          <MidiKey Value="${stabPitch}" />
                          <Notes>${stabNotes.join('')}</Notes>
                        </KeyTrack>
                      </KeyTracks>
                    </Notes>
                  </MidiClip>
                </Events>
              </ArrangerAutomation>
            </ClipTimeable>
          </MainSequencer>
        </DeviceChain>
      </MidiTrack>`;
  }

  const modeAttrs = effectiveMode
    ? ` Data-Parametric-RequestedDurationBars="${totalBars}" Data-Parametric-CreationMode="${effectiveMode}"`
    : '';
  const rawXml = `<?xml version="1.0" encoding="UTF-8"?>
<Ableton MajorVersion="5" MinorVersion="12.0_12049" SchemaChangeCount="3" Creator="Ableton Live 12.0.5" Revision=" parametric-ai-daw-seed-${effectiveSeed} " Data-Parametric-GenerationSeed="${effectiveSeed}"${modeAttrs}>
  <LiveSet>
    <NextPointeeId Value="${30000 + (effectiveSeed % 5000)}" />
    <OverwriteProtectionNumber Value="${4000 + (effectiveSeed % 1000)}" />
    <MasterTrack>
      <DeviceChain>
        <Mixer>
          <Tempo>
            <Manual Value="${chosenTempo}" />
          </Tempo>
          <TimeSignature>
            <RemoteableTimeSignature Id="0">
              <Numerator Value="4" />
              <Denominator Value="4" />
            </RemoteableTimeSignature>
          </TimeSignature>
        </Mixer>
      </DeviceChain>
    </MasterTrack>
    <ScaleInformation>
      <RootNote Value="${chosenRoot}" />
      <Name Value="${chosenScale}" />
    </ScaleInformation>
    <Tracks>
      <MidiTrack Id="1">
        <Name>
          <EffectiveName Value="01_Kick_909_Foundation" />
          <UserName Value="01_Kick_909_Foundation" />
        </Name>
        <Color Value="60" />
        <DeviceChain>
          <MidiToAudioDeviceChain>
            <Devices>
              <DrumGroupDevice Id="101">
                <IsOn><Manual Value="true" /></IsOn>
                <MacroControls.0><Manual Value="${(75 + rnd(12) * 20).toFixed(1)}" /></MacroControls.0>
              </DrumGroupDevice>
              <DrumBuss Id="102">
                <IsOn><Manual Value="true" /></IsOn>
                <Drive><Manual Value="${(0.25 + rnd(13) * 0.3).toFixed(2)}" /></Drive>
                <Boom><Manual Value="${(0.35 + rnd(14) * 0.25).toFixed(2)}" /></Boom>
              </DrumBuss>
            </Devices>
          </MidiToAudioDeviceChain>
          <MainSequencer>
            <ClipTimeable>
              <ArrangerAutomation>
                <Events>
                  <MidiClip Id="1001" Time="0">
                    <Name Value="Kick_909_Foundation" />
                    <CurrentStart Value="0" />
                    <CurrentEnd Value="${totalBeats}" />
                    <Loop><LoopStart Value="0" /><LoopEnd Value="4" /></Loop>
                    <Notes>
                      <KeyTracks>
                        <KeyTrack Id="0">
                          <MidiKey Value="${kickPitch}" />
                          <Notes>${kickEvents.join('')}</Notes>
                        </KeyTrack>
                      </KeyTracks>
                    </Notes>
                  </MidiClip>
                </Events>
              </ArrangerAutomation>
            </ClipTimeable>
          </MainSequencer>
        </DeviceChain>
      </MidiTrack>
      ${extraTracksXml}
    </Tracks>
  </LiveSet>
</Ableton>`;

  const defaultHumanization: HumanizationConfig = {
    microTimingMaxShiftBeats: 0.015,
    swingStrength: 0,
    shuffleSwing: 0,
    velocityVariancePct: 0.08,
    ghostVelocityMin: 20,
    ghostVelocityMax: 45,
    lfoRateHz: 0.1,
    lfoDepth: 0.42,
    cutoffHz: 145.0,
    macroTransition: 42,
  };

  let fullSuiteXml = rawXml;
  const suiteArchetypes: TechnoArchetype[] = [
    'rumble',
    'percussion',
    'synth',
    'hats',
    'acid',
    'ride',
    'pad',
  ];
  suiteArchetypes.forEach((arch, idx) => {
    fullSuiteXml = TechnoHeuristicEngine.injectTechnoLayerIntoXml(
      fullSuiteXml,
      arch,
      chosenRoot,
      defaultHumanization,
      undefined,
      undefined,
      effectiveSeed + (idx + 1) * 97,
      totalBars
    );
  });
  // Starter suite tracks represent the baseline project (preserve their native devices as user-created)
  fullSuiteXml = fullSuiteXml.replace(/\s*Data-Parametric-Injected="true"/g, '');
  // Generated tracks need actual mixer destinations; patching imported documents
  // must never silently claim success when these destinations are absent.
  fullSuiteXml = fullSuiteXml.replace(/(<MidiTrack\b[^>]*>[\s\S]*?<DeviceChain>)/g,
    '$1<Mixer><Volume><Manual Value="1" /></Volume><Pan><Manual Value="0" /></Pan><Speaker><Manual Value="true" /></Speaker><Solo><Manual Value="false" /></Solo></Mixer>');

  const metaObj: StarterTemplateMeta = {
    id: `${archetypeVariant}-${effectiveSeed}`,
    name: `${templateTitle}.als`,
    subtitle: templateSub,
    tempo: chosenTempo,
    rootKey: chosenRoot,
    scale: chosenScale,
    description: `Procedurally unique underground techno project #${effectiveSeed}.`,
    ...(effectiveMode ? { creationMode: effectiveMode, requestedDurationBars: totalBars } : {}),
  };

  return { xml: formatXmlString(fullSuiteXml), meta: metaObj };
}

/**
 * TASK 1: THE PARSER ENGINE
 * Parses an Ableton .als XML tree to extract Tempo, Root Key, Scale, and existing MidiTrack / AudioTrack structures.
 */
/** Only project-owned tempo targets may define or receive the global scalar tempo. */
function projectTempoTarget(doc: Document): Element | null {
  return doc.querySelector('LiveSet > MasterTrack > DeviceChain > Mixer > Tempo > Manual')
    || doc.querySelector('LiveSet > MasterTrack > Tempo > Manual')
    || doc.querySelector('LiveSet > Tempo > Manual');
}

export function parseAbletonXmlDom(
  xmlString: string,
  fileName: string,
  rawXmlBaseline?: string
): AbletonProjectState {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlString, 'application/xml');

  const parseError = xmlDoc.querySelector('parsererror');
  if (parseError) {
    throw new Error(`Invalid Ableton XML schema: ${parseError.textContent?.slice(0, 120)}`);
  }

  const abletonRoot = xmlDoc.querySelector('Ableton');
  const creator = abletonRoot?.getAttribute('Creator') || 'Ableton Live 12.0';
  const schemaVersion = abletonRoot?.getAttribute('MinorVersion') || '12.0_12049';

  const tempoManualNode = projectTempoTarget(xmlDoc);
  const tempoVal = parseFloat(
    tempoManualNode?.getAttribute('Value') || tempoManualNode?.textContent || '134'
  );
  const tempo = Number.isFinite(tempoVal) && tempoVal >= 40 && tempoVal <= 240 ? tempoVal : 134;

  const rootNoteAttr = xmlDoc.querySelector('ScaleInformation > RootNote')?.getAttribute('Value');
  const scaleNameAttr = xmlDoc.querySelector('ScaleInformation > Name')?.getAttribute('Value');

  const trackNodes = Array.from(xmlDoc.querySelectorAll('Tracks > MidiTrack, Tracks > AudioTrack'));
  const tracks: AbletonTrack[] = [];
  const compatibilityWarnings: string[] = [];
  let totalNotesCount = 0;
  let maxEndBeatDetected = 0;
  const pitchCounts: Record<number, number> = {};

  trackNodes.forEach((trackEl, idx) => {
    const isMidi = trackEl.tagName === 'MidiTrack';
    const trackId = readAlsIdentity(trackEl) || `${idx + 1}`;
    const effectiveName =
      trackEl.querySelector('Name > EffectiveName')?.getAttribute('Value') ||
      trackEl.querySelector('Name > UserName')?.getAttribute('Value') ||
      `${trackEl.tagName}_${trackId}`;

    const isGenerated = trackEl.getAttribute('Data-Parametric-Injected') === 'true';

    const lowerName = effectiveName.toLowerCase();
    let archetype: TechnoArchetype = 'existing';
    if (lowerName.includes('kick')) archetype = 'kick';
    else if (lowerName.includes('acid') || lowerName.includes('303')) archetype = 'acid';
    else if (lowerName.includes('ride') || lowerName.includes('cymbal') || lowerName.includes('crash'))
      archetype = 'ride';
    else if (lowerName.includes('pad') || lowerName.includes('atmo') || lowerName.includes('drone') || lowerName.includes('chord_pad'))
      archetype = 'pad';
    else if (lowerName.includes('sub') || lowerName.includes('rumble') || lowerName.includes('bass'))
      archetype = 'rumble';
    else if (lowerName.includes('perc') || lowerName.includes('industrial') || lowerName.includes('collision'))
      archetype = 'percussion';
    else if (lowerName.includes('synth') || lowerName.includes('stab') || lowerName.includes('wavetable') || lowerName.includes('dub'))
      archetype = 'synth';
    else if (lowerName.includes('hat') || lowerName.includes('909')) archetype = 'hats';

    if (trackEl.getAttribute('Data-Parametric-DeviceExecution') === 'browser-only') {
      compatibilityWarnings.push(`Track ${trackId}: MIDI is serialized; its browser device state is preserved as metadata, not a native Ableton instrument.`);
    }
    const colorMap: Record<TechnoArchetype, string> = {
      kick: '#F59E0B',
      rumble: '#38BDF8',
      percussion: '#F97316',
      synth: '#A855F7',
      hats: '#10B981',
      acid: '#EC4899',
      ride: '#06B6D4',
      pad: '#818CF8',
      existing: '#94A3B8',
    };

    const deviceElements = Array.from(
      trackEl.querySelectorAll(
        'DeviceChain > MidiToAudioDeviceChain > Devices > *, DeviceChain > AudioToAudioDeviceChain > Devices > *, DeviceChain > Devices > *'
      )
    );
    const devices: AbletonDevice[] = deviceElements.map((devEl, dIdx) => {
      const tag = devEl.tagName;
      const devId = devEl.getAttribute('Id') || `${trackId}_dev_${dIdx}`;
      const params: { name: string; value: string | number; unit?: string; automationTarget?: boolean }[] = [];

      if (tag === 'Operator') {
        params.push(
          { name: 'Osc A Wave', value: devEl.querySelector('OscillatorA > Waveform')?.getAttribute('Value') || 'Sine' },
          { name: 'Osc A Level', value: devEl.querySelector('OscillatorA > Level')?.getAttribute('Value') || '0.92' },
          { name: 'Coarse', value: devEl.querySelector('OscillatorA > Coarse')?.getAttribute('Value') || '0' }
        );
      } else if (tag === 'UltraAnalog') {
        params.push(
          { name: 'Osc 1 Wave', value: devEl.querySelector('Oscillator1 > Waveform')?.getAttribute('Value') || 'Saw' },
          { name: '303Reso', value: devEl.querySelector('Filter1 > Resonance')?.getAttribute('Value') || '0.82', automationTarget: true }
        );
      } else if (tag === 'Drift') {
        params.push(
          { name: 'Drift Mod', value: devEl.querySelector('DriftAmount > Manual')?.getAttribute('Value') || '0.48' },
          { name: 'Stereo Spread', value: 'Wide' }
        );
      } else if (tag === 'EQEight') {
        params.push(
          { name: 'Band 1 HPF', value: devEl.querySelector('Band\\.1 > Freq')?.getAttribute('Value') || '28.0', unit: 'Hz' },
          {
            name: 'Sub Notch',
            value: devEl.querySelector('Band\\.2 > Freq')?.getAttribute('Value') || '55.0',
            unit: 'Hz',
            automationTarget: true,
          },
          {
            name: 'Notch Gain',
            value: devEl.querySelector('Band\\.2 > Gain')?.getAttribute('Value') || '-8.5',
            unit: 'dB',
          }
        );
      } else if (tag === 'Roar') {
        params.push(
          { name: 'Drive', value: devEl.querySelector('Drive > Manual')?.getAttribute('Value') || '0.44', automationTarget: true },
          { name: 'Routing', value: devEl.querySelector('Routing')?.getAttribute('Value') || 'MidSide' }
        );
      } else if (tag === 'Reverb' || tag === 'HybridReverb') {
        params.push(
          { name: 'DecayTime', value: devEl.querySelector('DecayTime > Manual')?.getAttribute('Value') || '3600', unit: 'ms' },
          { name: 'DryWet', value: devEl.querySelector('DryWet > Manual')?.getAttribute('Value') || '0.40' }
        );
      } else if (tag === 'AutoFilter') {
        params.push(
          { name: 'FilterType', value: devEl.querySelector('FilterType > Manual')?.getAttribute('Value') || 'Lowpass' },
          {
            name: 'Cutoff',
            value: devEl.querySelector('Cutoff > Manual')?.getAttribute('Value') || '145.0',
            unit: 'Hz',
            automationTarget: true,
          },
          { name: 'Resonance', value: devEl.querySelector('Resonance > Manual')?.getAttribute('Value') || '0.32' }
        );
      } else if (tag === 'Compressor2') {
        params.push(
          { name: 'Sidechain', value: 'Kick 909' },
          { name: 'Ratio', value: devEl.querySelector('Ratio > Manual')?.getAttribute('Value') || '4.8:1' },
          { name: 'Release', value: devEl.querySelector('Release > Manual')?.getAttribute('Value') || '115', unit: 'ms', automationTarget: true }
        );
      } else if (tag === 'Limiter') {
        params.push(
          { name: 'Ceiling', value: devEl.querySelector('Ceiling > Manual')?.getAttribute('Value') || '-0.3', unit: 'dB' },
          { name: 'Gain', value: devEl.querySelector('Gain > Manual')?.getAttribute('Value') || '2.0', unit: 'dB' }
        );
      } else if (tag === 'DrumGroupDevice') {
        params.push(
          { name: 'MacroControls.0', value: devEl.querySelector('MacroControls\\.0 > Manual')?.getAttribute('Value') || '80.0' },
          { name: 'Pitch', value: devEl.querySelector('Pitch > Manual')?.getAttribute('Value') || '0', unit: 'st' },
          { name: 'Decay', value: devEl.querySelector('Decay > Manual')?.getAttribute('Value') || '0.42', unit: 's' }
        );
      } else if (tag === 'InstrumentVector') {
        params.push(
          { name: 'FilterCutoffHz', value: devEl.querySelector('Cutoff > Manual')?.getAttribute('Value') || '2200', unit: 'Hz' },
          { name: 'Detune', value: devEl.querySelector('UnisonDetune > Manual')?.getAttribute('Value') || '14', unit: 'ct' }
        );
      } else if (tag === 'Collision') {
        params.push(
          { name: 'FilterCutoffHz', value: devEl.querySelector('Brightness > Manual, Cutoff > Manual')?.getAttribute('Value') || '2600', unit: 'Hz' },
          { name: 'StrikeDecay', value: devEl.querySelector('Decay > Manual')?.getAttribute('Value') || '0.28', unit: 's' }
        );
      } else if (tag === 'OriginalSimpler') {
        params.push(
          { name: 'FilterCutoffHz', value: devEl.querySelector('Cutoff > Manual')?.getAttribute('Value') || '7500', unit: 'Hz' },
          { name: 'Transpose', value: devEl.querySelector('Transpose > Manual')?.getAttribute('Value') || '0', unit: 'st' },
          { name: 'Decay', value: devEl.querySelector('Decay > Manual')?.getAttribute('Value') || '0.18', unit: 's' }
        );
      } else if (tag === 'Saturator' || tag === 'Overdrive') {
        params.push(
          { name: 'Drive', value: devEl.querySelector('Drive > Manual')?.getAttribute('Value') || (tag === 'Saturator' ? '8' : '45'), unit: tag === 'Saturator' ? 'dB' : '%' },
          { name: 'DryWet', value: devEl.querySelector('DryWet > Manual')?.getAttribute('Value') || '100', unit: '%' }
        );
      } else if (tag === 'DrumBuss') {
        const rawDrive = parseFloat(devEl.querySelector('Drive > Manual')?.getAttribute('Value') || '0.35');
        const rawBoom = parseFloat(devEl.querySelector('Boom > Manual')?.getAttribute('Value') || '0.25');
        params.push(
          { name: 'Drive', value: rawDrive <= 1 ? Math.round(rawDrive * 100) : rawDrive, unit: '%' },
          { name: 'Boom', value: rawBoom <= 1 ? Math.round(rawBoom * 100) : rawBoom, unit: '%' },
          { name: 'Damp', value: devEl.querySelector('Damp > Manual')?.getAttribute('Value') || '11000', unit: 'Hz' },
          { name: 'DryWet', value: devEl.querySelector('DryWet > Manual')?.getAttribute('Value') || '100', unit: '%' }
        );
      } else if (tag === 'Delay' || tag === 'Echo') {
        const rawFb = parseFloat(devEl.querySelector('Feedback > Manual')?.getAttribute('Value') || '0.42');
        params.push(
          { name: 'DelayTime', value: devEl.querySelector('DelayTime > Manual')?.getAttribute('Value') || (tag === 'Echo' ? '335' : '280'), unit: 'ms' },
          { name: 'Feedback', value: Number.isFinite(rawFb) ? rawFb : 0.42 },
          { name: 'DryWet', value: devEl.querySelector('DryWet > Manual')?.getAttribute('Value') || '35', unit: '%' }
        );
      } else if (tag === 'ChorusEnsemble') {
        params.push(
          { name: 'Rate', value: devEl.querySelector('Rate > Manual')?.getAttribute('Value') || '0.65', unit: 'Hz' },
          { name: 'Amount', value: devEl.querySelector('Amount > Manual')?.getAttribute('Value') || '50', unit: '%' },
          { name: 'DryWet', value: devEl.querySelector('DryWet > Manual')?.getAttribute('Value') || '45', unit: '%' }
        );
      } else if (tag === 'GlueCompressor') {
        params.push(
          { name: 'Threshold', value: devEl.querySelector('Threshold > Manual')?.getAttribute('Value') || '-14', unit: 'dB' },
          { name: 'Ratio', value: devEl.querySelector('Ratio > Manual')?.getAttribute('Value') || '4', unit: ':1' },
          { name: 'Makeup', value: devEl.querySelector('Makeup > Manual')?.getAttribute('Value') || '2', unit: 'dB' }
        );
      } else if (tag === 'Utility') {
        params.push(
          { name: 'Gain', value: devEl.querySelector('Gain > Manual')?.getAttribute('Value') || '0', unit: 'dB' },
          { name: 'Balance', value: devEl.querySelector('Balance > Manual')?.getAttribute('Value') || '0' }
        );
      } else if (tag === 'Erosion') {
        params.push(
          { name: 'Frequency', value: devEl.querySelector('Frequency > Manual')?.getAttribute('Value') || '2400', unit: 'Hz' },
          { name: 'Amount', value: devEl.querySelector('Amount > Manual')?.getAttribute('Value') || '40', unit: '%' }
        );
      } else if (tag === 'AutoPan') {
        params.push(
          { name: 'Rate', value: devEl.querySelector('Rate > Manual')?.getAttribute('Value') || '1.5', unit: 'Hz' },
          { name: 'Amount', value: devEl.querySelector('Amount > Manual')?.getAttribute('Value') || '65', unit: '%' }
        );
      } else if (tag === 'MidiChord') {
        params.push(
          { name: 'Shift1', value: devEl.querySelector('Shift1 > Manual')?.getAttribute('Value') || '3', unit: 'st' },
          { name: 'Shift2', value: devEl.querySelector('Shift2 > Manual')?.getAttribute('Value') || '7', unit: 'st' },
          { name: 'Shift3', value: devEl.querySelector('Shift3 > Manual')?.getAttribute('Value') || '12', unit: 'st' }
        );
      } else if (tag === 'MidiArpeggiator') {
        params.push(
          { name: 'Rate', value: devEl.querySelector('Rate > Manual')?.getAttribute('Value') || '0.25', unit: 'beats' },
          { name: 'Gate', value: devEl.querySelector('Gate > Manual')?.getAttribute('Value') || '75', unit: '%' },
          { name: 'Steps', value: devEl.querySelector('Steps > Manual')?.getAttribute('Value') || '3' },
          { name: 'Distance', value: devEl.querySelector('Distance > Manual')?.getAttribute('Value') || '7', unit: 'st' }
        );
      } else if (tag === 'Lfo') {
        params.push(
          { name: 'Rate', value: devEl.querySelector('Rate > Manual')?.getAttribute('Value') || '0.10', unit: 'Hz' },
          { name: 'Depth', value: devEl.querySelector('Depth > Manual')?.getAttribute('Value') || '0.42' },
          { name: 'Waveform', value: devEl.querySelector('Waveform')?.getAttribute('Value') || 'Sine' },
          { name: 'Target', value: devEl.querySelector('ModulationTarget')?.getAttribute('Parameter') || 'AutoFilter.Cutoff', automationTarget: true }
        );
      } else {
        params.push({ name: 'Status', value: 'Active Native DSP' });
      }

      const displayMap: Record<string, string> = {
        InstrumentVector: 'Wavetable',
        OriginalSimpler: 'Simpler (909)',
        UltraAnalog: 'Analog (303)',
        DrumGroupDevice: 'Drum Rack',
        InstrumentGroupDevice: 'Instrument Rack',
        MidiChord: 'Chord',
        MidiArpeggiator: 'Arpeggiator',
      };

      const isOnManual = devEl.querySelector('IsOn > Manual')?.getAttribute('Value');
      const bypassed = isOnManual === 'false';
      const isAutoDuckInjected =
        devEl.getAttribute('Data-Parametric-AutoDuck') === 'true' ||
        devId === '8801' ||
        devId === '8802';

      return syncDeviceConversionRecord({
        id: devId,
        xmlTag: tag,
        displayName: displayMap[tag] || tag,
        category:
          tag === 'Operator' ||
          tag === 'InstrumentVector' ||
          tag === 'Collision' ||
          tag === 'OriginalSimpler' ||
          tag === 'DrumGroupDevice' ||
          tag === 'UltraAnalog' ||
          tag === 'Drift'
            ? 'instrument'
            : tag === 'MidiChord' || tag === 'MidiArpeggiator'
            ? 'midi_effect'
            : tag === 'Lfo'
            ? 'max_modulator'
            : 'audio_effect',
        parameters: params,
        bypassed,
        isUserCreated: !isGenerated && !isAutoDuckInjected,
        browserDspSupported: BROWSER_SUPPORTED_DEVICE_TAGS.has(tag),
      });
    });

    const lfoEl = trackEl.querySelector('Lfo');
    const lfoDrift = lfoEl
      ? {
          enabled: true,
          rateHz: parseFloat(lfoEl.querySelector('Rate > Manual')?.getAttribute('Value') || '0.10'),
          depth: parseFloat(lfoEl.querySelector('Depth > Manual')?.getAttribute('Value') || '0.42'),
          waveform: (lfoEl.querySelector('Waveform')?.getAttribute('Value') as any) || 'Sine',
          targetDevice: 'AutoFilter',
          targetParam: 'Cutoff',
          targetParamId: lfoEl.querySelector('ModulationTarget')?.getAttribute('Id') || '9203',
        }
      : undefined;

    // Session slots are preserved in raw XML, never scheduled as Arrangement events.
    const clipNodes = Array.from(trackEl.querySelectorAll(
      'DeviceChain > MainSequencer > ClipTimeable > ArrangerAutomation > Events > MidiClip'
    ));
    const clips: AbletonMidiClip[] = clipNodes.map((clipEl, cIdx) => {
      const clipName = clipEl.querySelector('Name')?.getAttribute('Value') || `${effectiveName}_Clip_${cIdx + 1}`;
      const startTime = parseFloat(
        clipEl.querySelector('CurrentStart')?.getAttribute('Value') || clipEl.getAttribute('Time') || '0'
      );
      const endTime = parseFloat(clipEl.querySelector('CurrentEnd')?.getAttribute('Value') || '64');
      const length = Math.max(0, endTime - startTime);
      if (endTime > maxEndBeatDetected) {
        maxEndBeatDetected = endTime;
      }

      const loopEndAttr = clipEl.querySelector('Loop > LoopEnd')?.getAttribute('Value');
      const loopEndBeats = loopEndAttr ? parseFloat(loopEndAttr) : undefined;
      const isPolymeter = Boolean(loopEndBeats && Math.abs(loopEndBeats % 4) > 0.01);

      const notes: MidiNoteEvent[] = [];
      const keyTracks = Array.from(clipEl.querySelectorAll('KeyTrack'));

      if (keyTracks.length > 0) {
        keyTracks.forEach((kt) => {
          const pitch = parseInt(kt.querySelector('MidiKey')?.getAttribute('Value') || '36', 10);
          const noteEls = Array.from(kt.querySelectorAll('MidiNoteEvent'));
          noteEls.forEach((nEl, nIdx) => {
            const time = parseFloat(nEl.getAttribute('Time') || '0');
            const duration = parseFloat(nEl.getAttribute('Duration') || '0.25');
            const velocity = Math.round(parseFloat(nEl.getAttribute('Velocity') || '100'));
            const quantizedTime = Number(nEl.getAttribute('Data-Parametric-QuantizedTime') ?? Math.round(time * 8) / 8);
            notes.push({
              id: readAlsIdentity(nEl, 'NoteId') || `${trackId}_${cIdx}_${pitch}_${nIdx}`,
              time,
              quantizedTime,
              duration,
              pitch,
              velocity,
              probability: Number(nEl.getAttribute('Probability') ?? 1),
              ...(nEl.getAttribute('Data-Parametric-HarmonicOwner')==='voiced-midi'?{harmonicOwner:'voiced-midi' as const}:{}),
              isGhost: velocity <= 48,
              isAccent: nEl.hasAttribute('Data-Parametric-Accent') ? nEl.getAttribute('Data-Parametric-Accent') === 'true' : velocity >= 110,
              isSlide: nEl.getAttribute('Data-Parametric-Slide') === 'true',
            });
            totalNotesCount++;
            pitchCounts[pitch % 12] = (pitchCounts[pitch % 12] || 0) + 1;
          });
        });
      } else {
        const directNotes = Array.from(clipEl.querySelectorAll('MidiNoteEvent'));
        directNotes.forEach((nEl, nIdx) => {
          const time = parseFloat(nEl.getAttribute('Time') || '0');
          const duration = parseFloat(nEl.getAttribute('Duration') || '0.25');
          const pitch = parseInt(nEl.getAttribute('Pitch') || '36', 10);
          const velocity = Math.round(parseFloat(nEl.getAttribute('Velocity') || '100'));
          const quantizedTime = Number(nEl.getAttribute('Data-Parametric-QuantizedTime') ?? Math.round(time * 8) / 8);
          notes.push({
            id: readAlsIdentity(nEl, 'NoteId') || `${trackId}_d_${nIdx}`,
            time,
            quantizedTime,
            duration,
            pitch,
            velocity,
            probability: Number(nEl.getAttribute('Probability') ?? 1),
            ...(nEl.getAttribute('Data-Parametric-HarmonicOwner')==='voiced-midi'?{harmonicOwner:'voiced-midi' as const}:{}),
            isGhost: velocity <= 48,
            isAccent: nEl.hasAttribute('Data-Parametric-Accent') ? nEl.getAttribute('Data-Parametric-Accent') === 'true' : velocity >= 110,
            isSlide: nEl.getAttribute('Data-Parametric-Slide') === 'true',
          });
          totalNotesCount++;
          pitchCounts[pitch % 12] = (pitchCounts[pitch % 12] || 0) + 1;
        });
      }

      notes.sort((a, b) => a.time - b.time);

      return {
        id: readAlsIdentity(clipEl) || `clip_${trackId}_${cIdx}`,
        ...(clipEl.getAttribute('Data-Parametric-UserEdited')==='true'?{userEdited:true}:{}),

        name: clipName,
        startTime,
        endTime,
        length,
        loopEndBeats,
        isPolymeter,
        notes,
      };
    });

    // Content-preserving ALS Import (v7.1 P0-001):
    // Preserves all original track structures, clips, notes, and timings without destructive transformation on import.
    // Creative section decomposition is available as an explicit user command via generateSectionArrangementProposal().
    const resolvedClips: AbletonMidiClip[] = clips;

    const defaultMixerByArchetype: Record<TechnoArchetype, TrackMixerParams> = {
      kick: {
        volumeDb: 0.0,
        pan: 0,
        transposeSemitones: 0,
        fineTuneCents: 0,
        sidechainDepth: 0.0,
        reverbSend: 0.03,
        delaySend: 0.0,
        filterCutoffHz: 8500,
        filterResonance: 0.15,
      },
      rumble: {
        volumeDb: -1.5,
        pan: 0,
        transposeSemitones: 0,
        fineTuneCents: 0,
        sidechainDepth: 0.88,
        reverbSend: 0.36,
        delaySend: 0.04,
        filterCutoffHz: 142,
        filterResonance: 0.32,
      },
      percussion: {
        volumeDb: -3.2,
        pan: -0.16,
        transposeSemitones: 0,
        fineTuneCents: 0,
        sidechainDepth: 0.45,
        reverbSend: 0.3,
        delaySend: 0.42,
        filterCutoffHz: 1850,
        filterResonance: 0.38,
      },
      synth: {
        volumeDb: -2.8,
        pan: 0.14,
        transposeSemitones: 0,
        fineTuneCents: 0,
        sidechainDepth: 0.72,
        reverbSend: 0.52,
        delaySend: 0.62,
        filterCutoffHz: 1050,
        filterResonance: 0.46,
      },
      hats: {
        volumeDb: -2.4,
        pan: 0.1,
        transposeSemitones: 0,
        fineTuneCents: 0,
        sidechainDepth: 0.35,
        reverbSend: 0.22,
        delaySend: 0.18,
        filterCutoffHz: 6800,
        filterResonance: 0.2,
      },
      acid: {
        volumeDb: -2.2,
        pan: -0.08,
        transposeSemitones: 0,
        fineTuneCents: 0,
        sidechainDepth: 0.76,
        reverbSend: 0.28,
        delaySend: 0.54,
        filterCutoffHz: 620,
        filterResonance: 0.76,
      },
      ride: {
        volumeDb: -4.2,
        pan: -0.22,
        transposeSemitones: 0,
        fineTuneCents: 0,
        sidechainDepth: 0.68,
        reverbSend: 0.44,
        delaySend: 0.16,
        filterCutoffHz: 7400,
        filterResonance: 0.24,
      },
      pad: {
        volumeDb: -3.8,
        pan: 0.2,
        transposeSemitones: 0,
        fineTuneCents: 0,
        sidechainDepth: 0.82,
        reverbSend: 0.68,
        delaySend: 0.58,
        filterCutoffHz: 820,
        filterResonance: 0.38,
      },
      existing: {
        volumeDb: -2.5,
        pan: 0,
        transposeSemitones: 0,
        fineTuneCents: 0,
        sidechainDepth: 0.5,
        reverbSend: 0.25,
        delaySend: 0.25,
        filterCutoffHz: 1600,
        filterResonance: 0.25,
      },
    };

    const defaultAutomation: AutomationPoint[] =
      archetype === 'synth' || archetype === 'acid'
        ? [
            { beat: 0, value: 0.32 },
            { beat: 16, value: 0.52 },
            { beat: 32, value: 0.38 },
            { beat: 48, value: 0.88 },
            { beat: 60, value: 0.96 },
            { beat: 64, value: 0.42 },
          ]
        : archetype === 'rumble'
        ? [
            { beat: 0, value: 0.45 },
            { beat: 24, value: 0.58 },
            { beat: 32, value: 0.32 },
            { beat: 48, value: 0.74 },
            { beat: 64, value: 0.48 },
          ]
        : [
            { beat: 0, value: 0.5 },
            { beat: 32, value: 0.65 },
            { beat: 48, value: 0.82 },
            { beat: 64, value: 0.55 },
          ];

    // Native lanes have distinct parameter targets and units. Never flatten Hz, dB and normalized lanes.
    if (trackEl.querySelector('AutomationEnvelopes FloatEvent, Automation FloatEvent, Envelope FloatEvent')) {
      compatibilityWarnings.push(`Track ${trackId}: native automation is preserved in XML; browser filter-energy automation does not interpret its parameter targets.`);
    }
    const resolvedAutomationPoints = defaultAutomation;

    let detectedRootForTrack = rootNoteAttr || 'F';
    const serializer = new XMLSerializer();
    const initialNotes = clips[0]?.notes ? [...clips[0].notes] : [];
    const defaultTakes = [
      {
        id: `take_${trackId}_main`,
        name: `Take 1 · Main Arrangement`,
        mediaType: (isMidi ? 'midi' : 'audio') as 'midi' | 'audio',
        createdAt: new Date().toISOString(),
        sourceClipId: clips[0]?.id || `clip_${trackId}_0`,
        startBeat: 0,
        endBeat: Math.max(64, maxEndBeatDetected),
        sourceOffsetBeats: 0,
        activeCompRanges: [
          {
            id: `comp_${trackId}_0`,
            takeId: `take_${trackId}_main`,
            startBeat: 0,
            endBeat: Math.max(64, maxEndBeatDetected),
            sourceOffsetBeats: 0,
          },
        ],
        notes: initialNotes,
        editHistory: ['Initial import / generation'],
      },
      {
        id: `take_${trackId}_sparse`,
        name: `Take 2 · Stripped Anchor Groove`,
        mediaType: (isMidi ? 'midi' : 'audio') as 'midi' | 'audio',
        createdAt: new Date().toISOString(),
        sourceClipId: clips[0]?.id || `clip_${trackId}_0`,
        startBeat: 0,
        endBeat: Math.max(64, maxEndBeatDetected),
        sourceOffsetBeats: 0,
        activeCompRanges: [],
        notes: initialNotes.filter((n) => !n.isGhost && n.velocity >= 75),
        editHistory: ['Generated sparse anchor variation'],
      },
    ];

    let appState: Partial<AbletonTrack> = {};
    const appStateNode = trackEl.querySelector(':scope > ParametricTrackState');
    if (appStateNode) {
      if (appStateNode.getAttribute('Version') !== '1') throw new Error('PROJECT_STATE_VERSION: unsupported track metadata');
      try { appState = JSON.parse(appStateNode.textContent || '{}');
        if (!appState || typeof appState !== 'object' || Array.isArray(appState)) throw new Error('invalid metadata');
      }
      catch { throw new Error('PROJECT_STATE: malformed track metadata'); }
      // Read only this application's serialized projection; never overlay native IDs/devices/clips.
      appState = Object.fromEntries(Object.entries(appState).filter(([key]) =>
        ['devices', 'mixer', 'muted', 'soloed', 'locked', 'automationPoints', 'vcaGroupId', 'automationGainOffsetDb', 'sessionClips', 'activeSessionSlot'].includes(key)));
    }
    if(appState.devices) appState.devices=appState.devices.map(device=>migrateCompatibleUnitConversion(device).device);
    tracks.push({
      id: trackId,
      name: effectiveName,
      type: isMidi ? 'midi' : 'audio',
      archetype,
      isGenerated,
      colorIndex: parseInt(trackEl.querySelector('Color')?.getAttribute('Value') || '14', 10),
      hexColor: colorMap[archetype],
      muted: false,
      soloed: false,
      vcaGroupId: defaultVcaGroupForArchetype(archetype),
      automationGainOffsetDb: 0,
      devices,
      clips: resolvedClips,
      takes: defaultTakes,
      activeTakeId: defaultTakes[0].id,
      lfoDrift,
      mixer: { ...defaultMixerByArchetype[archetype] },
      automationPoints: resolvedAutomationPoints,
      velocityCurve: getDefaultVelocityCurveForArchetype(archetype),
      spectralDucking: getDefaultSpectralDuckingConfig(archetype, detectedRootForTrack, tempo),
      polyrhythm: getDefaultPolyrhythmConfig(archetype),
      injectedXmlSnippet: isGenerated ? formatXmlString(serializer.serializeToString(trackEl)) : undefined,
      dspConfigRevision: 1,
      ...appState,
    });
  });

  let detectedRoot = rootNoteAttr || 'F';
  if (!rootNoteAttr && Object.keys(pitchCounts).length > 0) {
    const topPitchClass = Object.entries(pitchCounts).sort((a, b) => b[1] - a[1])[0][0];
    detectedRoot = NOTE_NAMES[parseInt(topPitchClass, 10)] || 'F';
  }

  const detectedBars = Math.round(maxEndBeatDetected / 4);
  const savedExtent = Number(abletonRoot?.getAttribute('Data-Parametric-ArrangementBars'));
  const arrangementLengthBars = Number.isSafeInteger(savedExtent) && savedExtent > 0
    ? savedExtent : Math.max(1, Math.ceil(maxEndBeatDetected / 4) || 16);

  // Parse existing Ableton <Locators> if present, otherwise seed default Memory Locations
  const locatorEls = Array.from(xmlDoc.querySelectorAll('Locators > Locators > Locator'));
  const memoryLocations: MemoryLocationMarker[] =
    locatorEls.length > 0
      ? locatorEls.map((locEl, lIdx) => {
          const timeBeats = parseFloat(locEl.querySelector('Time')?.getAttribute('Value') || '0');
          const barNum = Math.max(1, Math.floor(timeBeats / 4) + 1);
          const nameVal =
            locEl.querySelector('Name')?.getAttribute('Value') || `Marker ${lIdx + 1}`;
          const colors = ['#F59E0B', '#38BDF8', '#EC4899', '#10B981', '#A855F7', '#06B6D4'];
          return {
            id: locEl.getAttribute('Id') || `loc_${lIdx + 1}`,
            number: lIdx + 1,
            name: nameVal,
            bar: barNum,
            beat: timeBeats,
            color: colors[lIdx % colors.length],
            comment: locEl.querySelector('Annotation')?.getAttribute('Value') || '',
          };
        })
      : xmlDoc.querySelector('Locators') ? [] : getDefaultMemoryLocations(arrangementLengthBars);

  const formattedModified = xmlString;
  const formattedOriginal = rawXmlBaseline ?? xmlString;
  const rawByteSize = new TextEncoder().encode(formattedModified).length;

  const settingsNode = xmlDoc.querySelector('Ableton > LiveSet > ParametricAudioSettings');
  let audioSettings: AbletonProjectState['audioSettings'];
  if (settingsNode) {
    if (settingsNode.getAttribute('Version') !== '1') throw new Error('PROJECT_SETTINGS_VERSION: unsupported settings metadata');
    try { audioSettings = JSON.parse(settingsNode.textContent || 'null'); } catch { throw new Error('PROJECT_SETTINGS: malformed settings metadata'); }
    assertAudioSettings(audioSettings!);
  }
  const savedCreationMode = abletonRoot?.getAttribute('Data-Parametric-CreationMode');
  const creationMode =
    savedCreationMode === 'sketch' || savedCreationMode === 'full-track'
      ? savedCreationMode
      : undefined;
  const savedRequestedBars = Number(abletonRoot?.getAttribute('Data-Parametric-RequestedDurationBars'));
  const requestedDurationBars =
    Number.isSafeInteger(savedRequestedBars) && savedRequestedBars > 0
      ? savedRequestedBars
      : undefined;
  const songPlanNode=xmlDoc.querySelector('LiveSet > ParametricSongPlan');
  if(songPlanNode&&!['1','2'].includes(songPlanNode.getAttribute('Version')||'')) throw new Error('SONG_PLAN_VERSION: unsupported metadata; original preserved');
  const parsedProject: AbletonProjectState = {
    audioSettings,
    ...(xmlDoc.querySelector('LiveSet > ParametricSongPlan') ? {songPlan: JSON.parse(xmlDoc.querySelector('LiveSet > ParametricSongPlan')!.textContent || 'null')} : {}),
    humanizationSeed: abletonRoot?.hasAttribute('Data-Parametric-HumanizationSeed') ? Number(abletonRoot.getAttribute('Data-Parametric-HumanizationSeed')) : undefined,
    ...(creationMode ? { creationMode } : {}),
    ...(requestedDurationBars ? { requestedDurationBars } : {}),
    fileName,
    compatibilityWarnings,
    generationSeed: abletonRoot?.hasAttribute('Data-Parametric-GenerationSeed')
      ? Number(abletonRoot.getAttribute('Data-Parametric-GenerationSeed')) : undefined,
    schemaVersion,
    creator,
    tempo,
    rootKey: detectedRoot,
    scale: scaleNameAttr || 'Phrygian',
    polyrhythmicGrid: tracks.some((t) => t.clips[0]?.isPolymeter)
      ? 'Euclidean Poly-Meter + Micro-Shift'
      : tracks.some((t) => t.archetype === 'percussion')
      ? '3/16 + 16th Rolling'
      : '16th Quantized + Micro-Shift',
    energyDensity: Math.round((totalNotesCount / arrangementLengthBars) * 10) / 10,
    arrangementLengthBars,
    revision: 1,
    projectRevision: 1,
    tracks,
    memoryLocations,
    vcaGroups: getDefaultVcaGroups(),
    rawXmlOriginal: formattedOriginal,
    rawXmlModified: formattedModified,
    rawXml: formattedModified,
    rawByteSize,
    estimatedGzipByteSize: Math.round(rawByteSize * 0.14),
    lastActionLog: `Parsed ${tracks.length} tracks (${totalNotesCount} <MidiNoteEvent> nodes) across ${arrangementLengthBars} bars at ${tempo} BPM in ${detectedRoot} ${scaleNameAttr || 'Phrygian'}.`,
  };
  const sessionNode=xmlDoc.querySelector('LiveSet > ParametricSessionState');
  if (sessionNode) {
    if (sessionNode.getAttribute('Version')!=='1') throw new Error('SESSION_VERSION: unsupported Session metadata');
    try { parsedProject.session=JSON.parse(sessionNode.textContent || 'null'); } catch { throw new Error('SESSION_STATE: invalid metadata'); }
    if (!parsedProject.session) throw new Error('SESSION_STATE: missing performance');
    compatibilityWarnings.push('Session performance is browser application metadata; native Ableton Session slots and launch execution are not exported.');
  }
  const timingNode = xmlDoc.querySelector('LiveSet > ParametricTimingMaps');
  if (timingNode) {
    if (timingNode.getAttribute('Version') !== '1') throw new Error('TIMING_MAP_VERSION: unsupported timing map metadata');
    let parsedTiming: { ppq?: number; tempoMap?: AbletonProjectState['tempoMap']; meterMap?: AbletonProjectState['meterMap'] } | null = null;
    try { parsedTiming = JSON.parse(timingNode.textContent || 'null'); } catch { throw new Error('TIMING_MAP_STATE: invalid timing map metadata'); }
    if (!parsedTiming || typeof parsedTiming !== 'object') throw new Error('TIMING_MAP_STATE: missing timing map payload');
    if (parsedTiming.ppq !== undefined) parsedProject.ppq = parsedTiming.ppq;
    if (parsedTiming.tempoMap !== undefined) parsedProject.tempoMap = parsedTiming.tempoMap;
    if (parsedTiming.meterMap !== undefined) parsedProject.meterMap = parsedTiming.meterMap;
  }
  if (settingsNode || sessionNode || timingNode || xmlDoc.querySelector('ParametricTrackState')) assertProjectState(parsedProject);
  return parsedProject;
}

/**
 * TASK 1.3: inject_midi_clip(track_node, clip_name, start_time, length, midi_notes_array, loopEndBeats)
 * Formats Ableton's <MidiNoteEvent> nodes with exact Time, Duration, Pitch, Velocity, and <Loop><LoopEnd> poly-meter attributes.
 */
export function injectMidiClipXmlNode(
  xmlDoc: Document,
  trackNode: Element,
  clipName: string,
  startTime: number,
  length: number,
  midiNotesArray: MidiNoteEvent[],
  loopEndBeats?: number
): Element {
  const previous = trackNode.querySelector(
    'DeviceChain > MainSequencer > ClipTimeable > ArrangerAutomation > Events > MidiClip'
  );
  return injectMultipleMidiClipsXmlNodes(xmlDoc, trackNode, [{
    id: previous?.getAttribute('Data-Parametric-ClipId') || previous?.getAttribute('Id') ||
      `clip_${trackNode.getAttribute('Id') || 'track'}_primary`,
    name: clipName, startTime, length, endTime: startTime + length,
    loopEndBeats: loopEndBeats ?? 4, notes: midiNotesArray,
  }])[0];
}

/**
 * Serializes an array of `AbletonMidiClip` objects into `<MidiClip>` XML nodes inside a track's `<Events>` container.
 */
export function injectMultipleMidiClipsXmlNodes(
  xmlDoc: Document,
  trackNode: Element,
  clips: AbletonMidiClip[]
): Element[] {
  let eventsContainer = trackNode.querySelector(
    'DeviceChain > MainSequencer > ClipTimeable > ArrangerAutomation > Events'
  );
  if (!eventsContainer) {
    const deviceChain =
      trackNode.querySelector('DeviceChain') ||
      trackNode.appendChild(xmlDoc.createElement('DeviceChain'));
    const mainSeq = xmlDoc.createElement('MainSequencer');
    const clipTimeable = xmlDoc.createElement('ClipTimeable');
    const arrangerAuto = xmlDoc.createElement('ArrangerAutomation');
    eventsContainer = xmlDoc.createElement('Events');
    arrangerAuto.appendChild(eventsContainer);
    clipTimeable.appendChild(arrangerAuto);
    mainSeq.appendChild(clipTimeable);
    deviceChain.appendChild(mainSeq);
  }

  const previousClips = new Map(Array.from(eventsContainer.children)
    .filter(el => el.tagName === 'MidiClip')
    .map(el => [el.getAttribute('Data-Parametric-ClipId') || el.getAttribute('Id'), el]));
  const usedIds = new Set(Array.from(xmlDoc.querySelectorAll('[Id]')).map(el => el.getAttribute('Id')));
  let nextId = 5000;
  const allocateId = () => {
    while (usedIds.has(String(nextId))) nextId++;
    const id = String(nextId++);
    usedIds.add(id);
    return id;
  };
  previousClips.forEach(el => el.remove());

  const createdNodes: Element[] = [];
  clips.forEach((clip, clipIdx) => {
    const midiClip = xmlDoc.createElement('MidiClip');
    const previous = previousClips.get(clip.id);
    if (previous) for (const attr of Array.from(previous.attributes)) midiClip.setAttribute(attr.name, attr.value);
    midiClip.setAttribute('Id', previous?.getAttribute('Id') || allocateId());
    // ALS IDs stay numeric while application clip identity survives save/reload.
    midiClip.setAttribute('Data-Parametric-ClipId', clip.id);
    if (previous) for (const child of Array.from(previous.children)) {
      if (!['Name', 'CurrentStart', 'CurrentEnd', 'Loop', 'Notes'].includes(child.tagName)) {
        midiClip.appendChild(child.cloneNode(true));
      }
    }
    midiClip.setAttribute('Time', String(clip.startTime));

    const nameEl = xmlDoc.createElement('Name');
    nameEl.setAttribute('Value', clip.name || `Clip_${clipIdx + 1}`);
    midiClip.appendChild(nameEl);

    const startEl = xmlDoc.createElement('CurrentStart');
    startEl.setAttribute('Value', String(clip.startTime));
    midiClip.appendChild(startEl);

    const endEl = xmlDoc.createElement('CurrentEnd');
    endEl.setAttribute('Value', String(clip.startTime + clip.length));
    midiClip.appendChild(endEl);

    const loopEl = (previous?.querySelector(':scope > Loop')?.cloneNode(true) as Element) || xmlDoc.createElement('Loop');
    for (const child of Array.from(loopEl.children)) {
      if (['LoopStart', 'LoopEnd', 'StartRelative', 'LoopOn'].includes(child.tagName)) child.remove();
    }
    const loopStartEl = xmlDoc.createElement('LoopStart');
    loopStartEl.setAttribute('Value', previous?.querySelector('Loop > LoopStart')?.getAttribute('Value') || '0');
    const loopEndEl = xmlDoc.createElement('LoopEnd');
    const effectiveLoopEnd =
      typeof clip.loopEndBeats === 'number' && clip.loopEndBeats > 0 ? clip.loopEndBeats : clip.length;
    loopEndEl.setAttribute('Value', String(effectiveLoopEnd));
    const startRelEl = xmlDoc.createElement('StartRelative');
    startRelEl.setAttribute('Value', previous?.querySelector('Loop > StartRelative')?.getAttribute('Value') || '0');
    const loopOnEl = xmlDoc.createElement('LoopOn');
    loopOnEl.setAttribute('Value', previous?.querySelector('Loop > LoopOn')?.getAttribute('Value') || 'false');
    loopEl.appendChild(loopStartEl);
    loopEl.appendChild(loopEndEl);
    loopEl.appendChild(startRelEl);
    loopEl.appendChild(loopOnEl);
    midiClip.appendChild(loopEl);

    const notesEl = xmlDoc.createElement('Notes');
    const keyTracksEl = xmlDoc.createElement('KeyTracks');
    const byPitch = new Map<number, MidiNoteEvent[]>();
    clip.notes.forEach((note) => {
      const list = byPitch.get(note.pitch) || [];
      list.push(note);
      byPitch.set(note.pitch, list);
    });

    const previousNotes = new Map(Array.from(previous?.querySelectorAll('MidiNoteEvent') || [])
      .map(el => [el.getAttribute('Data-Parametric-NoteId') || el.getAttribute('NoteId'), el]));
    const usedNoteIds = new Set<string>();
    let nextNoteId = 1;
    let ktIdx = 0;
    byPitch.forEach((pitchNotes, pitchVal) => {
      const keyTrack = xmlDoc.createElement('KeyTrack');
      keyTrack.setAttribute('Id', `${ktIdx++}`);

      const midiKey = xmlDoc.createElement('MidiKey');
      midiKey.setAttribute('Value', `${pitchVal}`);
      keyTrack.appendChild(midiKey);

      const ktNotesContainer = xmlDoc.createElement('Notes');
      pitchNotes.forEach((n, idx) => {
        const noteEvent = (previousNotes.get(n.id)?.cloneNode(true) as Element) || xmlDoc.createElement('MidiNoteEvent');
        noteEvent.setAttribute('Time', String(n.time));
        noteEvent.setAttribute('Duration', String(n.duration));
        noteEvent.setAttribute('Pitch', `${n.pitch}`);
        noteEvent.setAttribute('Velocity', `${Math.max(1, Math.min(127, Math.round(n.velocity)))}`);
        noteEvent.setAttribute('OffVelocity', '64');
        while (usedNoteIds.has(String(nextNoteId))) nextNoteId++;
        const noteId = /^\d+$/.test(n.id) && !usedNoteIds.has(n.id) ? n.id : String(nextNoteId++);
        usedNoteIds.add(noteId);
        noteEvent.setAttribute('NoteId', noteId);
        noteEvent.setAttribute('Data-Parametric-NoteId', n.id);
        noteEvent.setAttribute('Data-Parametric-QuantizedTime', String(n.quantizedTime));
        noteEvent.setAttribute('Probability', String(n.probability ?? 1));
        noteEvent.setAttribute('IsEnabled', 'true');
        ktNotesContainer.appendChild(noteEvent);
      });

      keyTrack.appendChild(ktNotesContainer);
      keyTracksEl.appendChild(keyTrack);
    });

    notesEl.appendChild(keyTracksEl);
    midiClip.appendChild(notesEl);
    eventsContainer!.appendChild(midiClip);
    createdNodes.push(midiClip);
  });

  return createdNodes;
}

/**
 * Updates a track's `<Events>` container in the raw Ableton XML string with its current `AbletonMidiClip[]` array.
 */
export function syncTrackClipsToXml(
  xmlString: string,
  trackId: string,
  clips: AbletonMidiClip[]
): string {
  const doc = new DOMParser().parseFromString(xmlString, 'application/xml');
  if (doc.querySelector('parsererror') || doc.documentElement.tagName !== 'Ableton') throw new Error('Invalid source XML');
  const matches = Array.from(doc.querySelectorAll('Tracks > MidiTrack')).filter(el => readAlsIdentity(el) === trackId);
  if (matches.length !== 1) throw new Error(`CLIP_SYNC_TRACK: target track ${trackId} missing or ambiguous`);
  const track = matches[0];
  const child = (parent: Element, tag: string) => Array.from(parent.children).find(el => el.tagName === tag);
  const ensure = (parent: Element, tag: string) => child(parent, tag) || parent.appendChild(doc.createElement(tag));
  const setValue = (parent: Element, tag: string, value: string) => ensure(parent, tag).setAttribute('Value', value);
  const identity = readAlsIdentity;
  const allocations = new WeakMap<Element, Map<string, { next: number; used: Set<number> }>>();
  const numericId = (parent: Element, attribute: string) => {
    let scopes = allocations.get(parent);
    if (!scopes) { scopes = new Map(); allocations.set(parent, scopes); }
    let state = scopes.get(attribute);
    if (!state) {
      const used = new Set(Array.from(parent.querySelectorAll(`[${attribute}]`)).map(el => Number(el.getAttribute(attribute))));
      // Reserve requested native identities too, even if added later in this transaction.
      for (const c of clips) {
        if (/^\d+$/.test(c.id)) used.add(Number(c.id));
        for (const n of c.notes) if (/^\d+$/.test(n.id)) used.add(Number(n.id));
      }
      let next = 1;
      for (const id of used) if (Number.isSafeInteger(id)) next = Math.max(next, id + 1);
      state = { next, used }; scopes.set(attribute, state);
    }
    while (state.used.has(state.next)) state.next++;
    if (!Number.isSafeInteger(state.next)) throw new Error('Native ID allocation exhausted');
    const id = state.next++; state.used.add(id); return String(id);
  };
  const requireUnique = (ids: string[], kind: string) => {
    if (ids.some(id => !id) || new Set(ids).size !== ids.length) throw new Error(`CLIP_SYNC_ID: missing or duplicate ${kind} ID`);
  };
  const finite = (value: number, field: string) => {
    if (!Number.isFinite(value)) throw new Error(`${field.startsWith('note') ? 'CLIP_SYNC_NOTE' : 'CLIP_SYNC_TIME'}: invalid ${field}`);
  };
  requireUnique(clips.map(c => c.id), 'clip');
  for (const clip of clips) {
    finite(clip.startTime, 'clip start'); finite(clip.length, 'clip length');
    if (clip.startTime < 0 || clip.length <= 0 || !Number.isFinite(clip.startTime + clip.length)) throw new Error('Invalid clip bounds');
    if (clip.loopEndBeats !== undefined && (!Number.isFinite(clip.loopEndBeats) || clip.loopEndBeats <= 0)) throw new Error('Invalid clip loop');
    requireUnique(clip.notes.map(n => n.id), 'note');
    for (const n of clip.notes) {
      for (const [value, field] of [[n.time, 'note time'], [n.quantizedTime, 'note grid time'], [n.duration, 'note duration'], [n.velocity, 'note velocity'], [n.pitch, 'note pitch']] as const) finite(value, field);
      if (n.duration <= 0 || !Number.isInteger(n.pitch) || n.pitch < 0 || n.pitch > 127 || n.velocity < 1 || n.velocity > 127) throw new Error('CLIP_SYNC_NOTE: invalid note data');
      if (n.probability !== undefined && (!Number.isFinite(n.probability) || n.probability < 0 || n.probability > 1)) throw new Error('CLIP_SYNC_NOTE: invalid note probability');
    }
  }
  let events = track.querySelector('DeviceChain > MainSequencer > ClipTimeable > ArrangerAutomation > Events');
  if (!events) events = ensure(ensure(ensure(ensure(track, 'DeviceChain'), 'MainSequencer'), 'ClipTimeable'), 'ArrangerAutomation').appendChild(doc.createElement('Events'));
  const existing = Array.from(events.children).filter(el => el.tagName === 'MidiClip');
  requireUnique(existing.map(el => identity(el)), 'native clip');
  const noteTemplatesByClip=new Map(existing.map(el=>[identity(el),new Map(Array.from(el.querySelectorAll('MidiNoteEvent')).map(note=>[identity(note,'NoteId'),note.cloneNode(true) as Element]))]));
  // Consolidation has one native clip envelope. Differing opaque state cannot be
  // combined safely: reject the edit before removing any source material.
  const opaqueClipState=(el:Element)=>JSON.stringify({
    attributes:Array.from(el.attributes).filter(a=>!['Id','Time','Data-AIDAW-LogicalId','Data-Parametric-ClipId','Data-Parametric-UserEdited'].includes(a.name)).map(a=>[a.name,a.value]).sort(),
    children:Array.from(el.children).filter(c=>!['Notes','Name','CurrentStart','CurrentEnd','Loop'].includes(c.tagName)).map(c=>new XMLSerializer().serializeToString(c)),
  });
  const opaqueByClip=new Map(existing.map(el=>[identity(el),opaqueClipState(el)]));
  for(const clip of clips)if((clip.sourceClipIds?.length??0)>1&&!existing.some(el=>identity(el)===clip.id)){
    const states=clip.sourceClipIds!.map(id=>opaqueByClip.get(id));
    if(states.some(state=>state===undefined)||new Set(states).size>1)throw new Error('CLIP_CONSOLIDATION_UNSUPPORTED: source clips have incompatible opaque metadata; keep them separate');
  }
  const requested = new Set(clips.map(c => c.id));
  for (const el of existing) if (!requested.has(identity(el))) el.remove();
  for (const clip of clips) {
    let el = existing.find(el => identity(el) === clip.id);
    if (!el) {
      const source = clip.sourceClipId ? existing.find(el => identity(el) === clip.sourceClipId) : undefined;
      if (clip.sourceClipId && !source) throw new Error(`Source clip ${clip.sourceClipId} not found`);
      el = source ? source.cloneNode(true) as Element : doc.createElement('MidiClip');
      // Native numeric IDs remain separate from existing public generator identities.
      el.setAttribute('Id', /^\d+$/.test(clip.id) ? clip.id : numericId(doc.documentElement, 'Id'));
      el.removeAttribute('Data-AIDAW-LogicalId'); el.removeAttribute('Data-Parametric-ClipId');
      if (el.getAttribute('Id') !== clip.id) el.setAttribute('Data-AIDAW-LogicalId', clip.id);
      events.appendChild(el);
      if (!source) {
        const loop = ensure(el, 'Loop');
        setValue(loop, 'LoopStart', '0'); setValue(loop, 'StartRelative', '0'); setValue(loop, 'LoopOn', 'true');
        setValue(loop, 'LoopEnd', String(clip.loopEndBeats ?? clip.length));
      }
    }
    const putNumber = (node: Element, attr: string, value: number, digits = 3) => {
      if (Number(node.getAttribute(attr)) !== value || !node.hasAttribute(attr)) node.setAttribute(attr, Number(value.toFixed(digits)) === value ? value.toFixed(digits) : String(value));
    };
    putNumber(el, 'Time', clip.startTime);
    if(clip.userEdited) el.setAttribute('Data-Parametric-UserEdited','true');
    else el.removeAttribute('Data-Parametric-UserEdited');
    setValue(el, 'Name', clip.name);
    putNumber(ensure(el, 'CurrentStart'), 'Value', clip.startTime);
    putNumber(ensure(el, 'CurrentEnd'), 'Value', clip.startTime + clip.length);
    if (clip.loopEndBeats !== undefined) putNumber(ensure(ensure(el, 'Loop'), 'LoopEnd'), 'Value', clip.loopEndBeats);
    const notes = ensure(el, 'Notes'), keyTracks = ensure(notes, 'KeyTracks');
    const oldNotes = Array.from(el.querySelectorAll('MidiNoteEvent'));
    requireUnique(oldNotes.map(n => identity(n, 'NoteId')), 'native note');
    const oldById = new Map(oldNotes.map(n => [identity(n, 'NoteId'), n]));
    const wanted = new Set(clip.notes.map(n => n.id));
    for (const note of oldNotes) if (!wanted.has(identity(note, 'NoteId'))) note.remove();
    for (const n of clip.notes) {
      let note = oldById.get(n.id);
      let keyTrack = Array.from(keyTracks.children).find(kt => Number(child(kt, 'MidiKey')?.getAttribute('Value')) === n.pitch);
      if (!keyTrack) {
        keyTrack = doc.createElement('KeyTrack'); keyTrack.setAttribute('Id', numericId(keyTracks, 'Id'));
        setValue(keyTrack, 'MidiKey', String(n.pitch)); keyTracks.appendChild(keyTrack);
      }
      if (!note) {
        const source = n.sourceNoteId ? (n.sourceNoteClipId ? noteTemplatesByClip.get(n.sourceNoteClipId)?.get(n.sourceNoteId) : oldById.get(n.sourceNoteId)) : undefined;
        if (n.sourceNoteId && !source) throw new Error(`Source note ${n.sourceNoteId} not found`);
        note = source ? source.cloneNode(true) as Element : doc.createElement('MidiNoteEvent');
        note.setAttribute('NoteId', /^\d+$/.test(n.id) ? n.id : numericId(el, 'NoteId'));
        note.removeAttribute('Data-AIDAW-LogicalId'); note.removeAttribute('Data-Parametric-NoteId');
        if (note.getAttribute('NoteId') !== n.id) note.setAttribute('Data-AIDAW-LogicalId', n.id);
        if (!source) { note.setAttribute('OffVelocity', '64'); note.setAttribute('IsEnabled', 'true'); }
      }
      const destination = ensure(keyTrack, 'Notes');
      if (note.parentElement !== destination) destination.appendChild(note);
      putNumber(note, 'Time', n.time); putNumber(note, 'Duration', n.duration);
      if(n.harmonicOwner) note.setAttribute('Data-Parametric-HarmonicOwner',n.harmonicOwner);
      else note.removeAttribute('Data-Parametric-HarmonicOwner');
      if(n.isSlide !== undefined) note.setAttribute('Data-Parametric-Slide',String(n.isSlide));
      if(n.isAccent !== undefined) note.setAttribute('Data-Parametric-Accent',String(n.isAccent));
      if (note.hasAttribute('Data-Parametric-QuantizedTime') || n.quantizedTime !== Math.round(n.time * 8) / 8) putNumber(note, 'Data-Parametric-QuantizedTime', n.quantizedTime);
      putNumber(note, 'Velocity', Math.max(1, Math.min(127, Math.round(n.velocity))), 0);
      if (note.hasAttribute('Pitch')) putNumber(note, 'Pitch', n.pitch, 0);
      if (n.probability !== undefined) putNumber(note, 'Probability', n.probability);
    }
    const nativeIds = Array.from(el.querySelectorAll('MidiNoteEvent')).map(n => Number(n.getAttribute('NoteId')));
    requireUnique(nativeIds.map(String), 'serialized note');
    const generator = child(notes, 'NoteIdGenerator');
    const next = nativeIds.reduce((max, id) => Math.max(max, id), 0) + 1;
    if (!generator || Number(generator.getAttribute('NextId')) < next) ensure(notes, 'NoteIdGenerator').setAttribute('NextId', String(next));
  }
  requireUnique(Array.from(events.children).filter(el => el.tagName === 'MidiClip').map(el => el.getAttribute('Id') || ''), 'serialized clip');
  return new XMLSerializer().serializeToString(doc);


}

/**
 * TASK 3: AUTOMATION & DRIFT
 * Appends an Ableton <Lfo> XML node to a track and maps it to <AutoFilter><Cutoff>.
 */
export function injectAnalogDriftXmlNode(
  xmlDoc: Document,
  deviceChainNode: Element,
  lfoRateHz = 0.1,
  lfoDepth = 0.42
): Element {
  let devicesContainer =
    deviceChainNode.querySelector('MidiToAudioDeviceChain > Devices') ||
    deviceChainNode.querySelector('Devices');

  if (!devicesContainer) {
    const midiToAudio = xmlDoc.createElement('MidiToAudioDeviceChain');
    devicesContainer = xmlDoc.createElement('Devices');
    midiToAudio.appendChild(devicesContainer);
    deviceChainNode.appendChild(midiToAudio);
  }

  let autoFilterCutoff = devicesContainer.querySelector('AutoFilter > Cutoff');
  let cutoffParamId = autoFilterCutoff?.getAttribute('Id') || '9401';
  if (autoFilterCutoff && !autoFilterCutoff.getAttribute('Id')) {
    autoFilterCutoff.setAttribute('Id', cutoffParamId);
  }

  Array.from(devicesContainer.querySelectorAll('Lfo')).forEach((el) => el.remove());

  const lfoTemplate = `
    <Lfo Id="9901">
      <LomId Value="0" />
      <IsOn><Manual Value="true" /></IsOn>
      <Waveform Value="Sine" />
      <SyncMode Value="FreeHz" />
      <Rate>
        <Manual Value="${lfoRateHz.toFixed(3)}" />
      </Rate>
      <Depth>
        <Manual Value="${lfoDepth.toFixed(2)}" />
      </Depth>
      <Jitter>
        <Manual Value="0.08" />
      </Jitter>
      <ModulationTarget Id="${cutoffParamId}" Parameter="AutoFilter.Cutoff" />
    </Lfo>
  `.trim();

  const tempDoc = new DOMParser().parseFromString(lfoTemplate, 'application/xml');
  const lfoNode = xmlDoc.importNode(tempDoc.documentElement, true);
  devicesContainer.appendChild(lfoNode);

  return lfoNode;
}

/**
 * Granular non-destructive Clear Arrangement utility:
 * Wipes notes, automation, or session clips while preserving each track's native <DeviceChain>.
 */
export function clearProjectArrangementXml(
  projectOrXml: AbletonProjectState | string,
  tracksOrSelectedId: AbletonTrack[] | string,
  selectedTrackIdOrOptions: string | ClearArrangementOptions,
  optionsMaybe?: ClearArrangementOptions
): { updatedXml: string; updatedTracks: AbletonTrack[]; clearedTrackCount: number; summary: string } {
  const isProject = typeof projectOrXml !== 'string';
  const rawXml = isProject ? projectOrXml.rawXmlModified : projectOrXml;
  const tracks = isProject ? projectOrXml.tracks : (tracksOrSelectedId as AbletonTrack[]);
  const selectedTrackId = isProject ? (tracksOrSelectedId as string) : (selectedTrackIdOrOptions as string);
  const options = isProject ? (selectedTrackIdOrOptions as ClearArrangementOptions) : optionsMaybe!;
  const totalBeats = isProject ? (projectOrXml.arrangementLengthBars || 16) * 4 : 64;

  const shouldWipeNotes = options.wipeNotes ?? options.clearNotes ?? true;
  const shouldWipeAuto = options.wipeAutomation ?? options.clearAutomation ?? true;
  const shouldWipeSession = options.wipeSessionClips ?? options.clearSessionClips ?? false;
  const shouldResetMixer = options.resetMixerToNeutral ?? options.resetMixerLevels ?? false;

  const parser = new DOMParser();
  const sanitized = rawXml.replace(/xmlns(:[a-zA-Z0-9_-]+)?="[^"]*"/g, '');
  const xmlDoc = parser.parseFromString(sanitized, 'application/xml');

  let affectedCount = 0;

  const updatedTracks = tracks.map((track) => {
    const isTarget =
      options.scope === 'all_tracks'
        ? true
        : options.scope === 'unlocked_tracks'
        ? !track.locked
        : track.id === selectedTrackId;

    if (!isTarget) return track;
    affectedCount++;

    let nextClips = [...track.clips];
    if (shouldWipeNotes) {
      nextClips = nextClips.map((c) => ({ ...c, notes: [] }));
      const trackEl = Array.from(xmlDoc.querySelectorAll('Tracks > MidiTrack')).find((el) => {
        const eff = el.querySelector('Name > EffectiveName')?.getAttribute('Value') || '';
        return eff === track.name || el.getAttribute('Id') === track.id;
      });
      if (trackEl) {
        Array.from(trackEl.querySelectorAll('MidiNoteEvent')).forEach((nEl) => nEl.remove());
      }
    }

    const nextAutomation = shouldWipeAuto
      ? [
          { beat: 0, value: 0.65 },
          { beat: totalBeats, value: 0.65 },
        ]
      : track.automationPoints;

    const nextSessionClips = shouldWipeSession
      ? track.sessionClips?.map((sc) => ({ ...sc, notes: [] }))
      : track.sessionClips;

    const nextMixer = shouldResetMixer
      ? {
          ...track.mixer,
          volumeDb: track.archetype === 'kick' ? 0 : -2.5,
          pan: 0,
          transposeSemitones: 0,
          fineTuneCents: 0,
        }
      : track.mixer;

    return {
      ...track,
      clips: nextClips,
      automationPoints: nextAutomation,
      sessionClips: nextSessionClips,
      mixer: nextMixer,
    };
  });

  const updatedXml = formatXmlString(new XMLSerializer().serializeToString(xmlDoc));
  const clearedParts: string[] = [];
  if (shouldWipeNotes) clearedParts.push('MIDI notes');
  if (shouldWipeAuto) clearedParts.push('automation envelopes');
  if (shouldWipeSession) clearedParts.push('Session clips');
  if (shouldResetMixer) clearedParts.push('mixer offsets');

  return {
    updatedXml,
    updatedTracks,
    clearedTrackCount: affectedCount,
    summary: `Cleared ${clearedParts.join(', ') || 'arrangement state'} on ${affectedCount} track(s) while preserving native Ableton <DeviceChain> racks.`,
  };
}

/**
 * AI Smart Leveling & Auto-Gain Stage Calibrator:
 * Balances all tracks for -6.0 dB pre-master headroom, optimal stereo spread, surgical sub ducking, and zero distortion.
 */
export function computeAiSmartMixCalibration(
  project: AbletonProjectState
): {
  updatedTracks: AbletonTrack[];
  updatedXml: string;
  trackMixerPatches: Record<string, Partial<TrackMixerParams>>;
  masterBusPatch: {
    masterVolumeDb: number;
    glueCompressionDrive: number;
    reverbReturnLevel: number;
    delayReturnLevel: number;
    subBassMonoCutoffHz: number;
  };
  summary: string;
} {
  let workingXml = project.rawXmlModified;
  const activeCount = Math.max(1, project.tracks.filter((t) => !t.muted).length);
  const headroomOffsetDb = activeCount > 5 ? -1.4 : -0.5;
  const trackMixerPatches: Record<string, Partial<TrackMixerParams>> = {};

  const updatedTracks = project.tracks.map((track) => {
    const noteCount = track.clips[0]?.notes.length || 0;
    const densityFactor = Math.min(1.5, noteCount / 64);

    let targetVolDb = -2.0;
    let targetPan = 0.0;
    let targetScDepth = 0.65;
    let targetCutoff = track.mixer.filterCutoffHz;
    let targetReso = Math.min(0.72, track.mixer.filterResonance);
    let targetRev = track.mixer.reverbSend;
    let targetDel = track.mixer.delaySend;

    switch (track.archetype) {
      case 'kick':
        targetVolDb = 0.0;
        targetPan = 0.0;
        targetScDepth = 0.0;
        targetRev = 0.02;
        targetDel = 0.0;
        targetCutoff = 9200;
        targetReso = 0.14;
        break;
      case 'rumble':
        targetVolDb = Number((-1.8 + headroomOffsetDb * 0.5).toFixed(1));
        targetPan = 0.0;
        targetScDepth = 0.9;
        targetCutoff = 138;
        targetReso = 0.28;
        targetRev = 0.34;
        targetDel = 0.04;
        break;
      case 'acid':
        targetVolDb = Number((-2.4 + headroomOffsetDb).toFixed(1));
        targetPan = -0.09;
        targetScDepth = 0.78;
        targetCutoff = 680;
        targetReso = 0.74;
        targetRev = 0.24;
        targetDel = 0.52;
        break;
      case 'percussion':
        targetVolDb = Number((-3.4 - (densityFactor > 1 ? 0.6 : 0) + headroomOffsetDb).toFixed(1));
        targetPan = -0.18;
        targetScDepth = 0.48;
        targetCutoff = 1950;
        targetReso = 0.34;
        targetRev = 0.28;
        targetDel = 0.4;
        break;
      case 'synth':
        targetVolDb = Number((-2.8 + headroomOffsetDb).toFixed(1));
        targetPan = 0.15;
        targetScDepth = 0.74;
        targetCutoff = 1120;
        targetReso = 0.42;
        targetRev = 0.48;
        targetDel = 0.6;
        break;
      case 'hats':
        targetVolDb = Number((-2.8 + headroomOffsetDb).toFixed(1));
        targetPan = 0.12;
        targetScDepth = 0.36;
        targetCutoff = 7200;
        targetReso = 0.18;
        targetRev = 0.18;
        targetDel = 0.16;
        break;
      case 'ride':
        targetVolDb = Number((-4.6 + headroomOffsetDb).toFixed(1));
        targetPan = -0.24;
        targetScDepth = 0.7;
        targetCutoff = 7600;
        targetReso = 0.2;
        targetRev = 0.42;
        targetDel = 0.14;
        break;
      case 'pad':
        targetVolDb = Number((-4.0 + headroomOffsetDb).toFixed(1));
        targetPan = 0.24;
        targetScDepth = 0.84;
        targetCutoff = 890;
        targetReso = 0.32;
        targetRev = 0.66;
        targetDel = 0.56;
        break;
      default:
        targetVolDb = -3.0;
        break;
    }

    const nextSpectral = getDefaultSpectralDuckingConfig(
      track.archetype,
      project.rootKey,
      project.tempo
    );

    // GATE 1 SAFETY: Never overwrite user-created EQEight or Compressor2 devices during Smart Leveling!
    // Only inject Auto-Duck XML nodes if the track is a generated track or has no user-created EQEight/Compressor2
    const hasUserEqOrComp = track.devices.some(
      (d) => (d.xmlTag === 'EQEight' || d.xmlTag === 'Compressor2') && d.isUserCreated
    );
    if (
      !hasUserEqOrComp &&
      (track.archetype === 'rumble' || track.archetype === 'acid' || track.archetype === 'pad')
    ) {
      workingXml = applySpectralAutoDuckToTrackXml(
        workingXml,
        track.id,
        track.name,
        nextSpectral
      );
    }

    const patch: Partial<TrackMixerParams> = {
      volumeDb: targetVolDb,
      pan: targetPan,
      sidechainDepth: targetScDepth,
      filterCutoffHz: targetCutoff,
      filterResonance: targetReso,
      reverbSend: targetRev,
      delaySend: targetDel,
    };
    trackMixerPatches[track.id] = patch;

    return {
      ...track,
      spectralDucking: nextSpectral,
      mixer: {
        ...track.mixer,
        ...patch,
      },
    };
  });

  return {
    updatedTracks,
    updatedXml: workingXml,
    trackMixerPatches,
    masterBusPatch: {
      masterVolumeDb: 0.0,
      glueCompressionDrive: 0.38,
      reverbReturnLevel: 0.34,
      delayReturnLevel: 0.32,
      subBassMonoCutoffHz: 120,
    },
    summary: `AI Smart Level calibrated ${updatedTracks.length} tracks: user devices preserved, mono sub-bass isolation (<120Hz), dynamic EQ8 kick-fundamental notches @ ${rootKeyToFundamentalHz(project.rootKey)}Hz, balanced stereo field, and -6.0 dB pre-master headroom.`,
  };
}

/**
 * Synchronizes Memory Location markers (<Locators>) and non-destructive track mixer parameters into the Ableton XML DOM.
 */
export function syncLocatorsAndMixerToXml(
  projectOrXml: AbletonProjectState | string,
  tracksArg?: AbletonTrack[],
  memoryLocationsArg?: MemoryLocationMarker[]
): string {
  const isProject = typeof projectOrXml !== 'string';
  const currentXml = isProject
    ? projectOrXml.rawXmlModified || projectOrXml.rawXml || ''
    : projectOrXml;
  const tracks = isProject ? projectOrXml.tracks : tracksArg || [];
  const memoryLocations = isProject ? projectOrXml.memoryLocations : memoryLocationsArg;

  if (!currentXml) throw new Error('PROJECT_XML: missing source XML');

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(currentXml, 'application/xml');
  if (xmlDoc.querySelector('parsererror')) throw new Error('PROJECT_XML: invalid source XML');
  const liveSet = xmlDoc.querySelector('Ableton > LiveSet');
  if (!liveSet) throw new Error('PROJECT_XML: missing LiveSet');

  if (memoryLocations !== undefined && liveSet) {
    let locatorsOuter = liveSet.querySelector('Locators');
    if (!locatorsOuter) {
      locatorsOuter = xmlDoc.createElement('Locators');
      liveSet.appendChild(locatorsOuter);
    }
    locatorsOuter.innerHTML = '';
    const locatorsInner = xmlDoc.createElement('Locators');
    memoryLocations.forEach((loc, idx) => {
      const locatorEl = xmlDoc.createElement('Locator');
      locatorEl.setAttribute('Id', `${idx + 1}`);
      const timeEl = xmlDoc.createElement('Time');
      const beatVal =
        typeof loc.beat === 'number'
          ? loc.beat
          : Math.max(0, ((loc.bar || 1) - 1) * 4);
      timeEl.setAttribute('Value', String(beatVal));
      const nameEl = xmlDoc.createElement('Name');
      nameEl.setAttribute('Value', loc.name);
      const annEl = xmlDoc.createElement('Annotation');
      annEl.setAttribute('Value', loc.comment || '');
      locatorEl.appendChild(timeEl);
      locatorEl.appendChild(nameEl);
      locatorEl.appendChild(annEl);
      locatorsInner.appendChild(locatorEl);
    });
    locatorsOuter.appendChild(locatorsInner);
  }

  tracks.forEach((t) => {
    const trackEl = Array.from(xmlDoc.querySelectorAll('Tracks > MidiTrack, Tracks > AudioTrack')).find(
      (el) => readAlsIdentity(el) === t.id
    );
    if (!trackEl) return;
    trackEl.setAttribute('Data-Base-Volume-Db', String(t.mixer.volumeDb));
    trackEl.setAttribute('Data-Pan', String(t.mixer.pan));
    let appState = trackEl.querySelector(':scope > ParametricTrackState');
    if (!appState) { appState = xmlDoc.createElement('ParametricTrackState'); trackEl.appendChild(appState); }
    appState.setAttribute('Version', '1');
    appState.setAttribute('AutomationParameter', 'parametric:filter-energy');
    appState.textContent = JSON.stringify({ devices: t.devices, mixer: t.mixer, muted: t.muted, soloed: t.soloed,
      locked: t.locked, automationPoints: t.automationPoints, vcaGroupId: t.vcaGroupId,
      automationGainOffsetDb: t.automationGainOffsetDb, sessionClips: t.sessionClips, activeSessionSlot: t.activeSessionSlot });
  });

  return new XMLSerializer().serializeToString(xmlDoc);
}

/** Serialize the existing canonical domain. Unchanged clip/unknown XML is left intact. */
export function parseNativeDeviceEdit(xml: string, fileName: string, baseline: string): AbletonProjectState {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  const projected = new Map<string, AbletonDevice[]>();
  for (const track of Array.from(doc.querySelectorAll('Tracks > MidiTrack, Tracks > AudioTrack'))) {
    const node = track.querySelector(':scope > ParametricTrackState');
    if (!node) continue;
    const state = JSON.parse(node.textContent || '{}');
    projected.set(readAlsIdentity(track), state.devices || []);
    delete state.devices; node.textContent = JSON.stringify(state);
  }
  const parsed = parseAbletonXmlDom(new XMLSerializer().serializeToString(doc), fileName, baseline);
  parsed.tracks = parsed.tracks.map(track => ({ ...track, devices: [
    ...(projected.get(track.id) || [])
      .filter(device => !track.devices.some(native => native.id === device.id))
      .map(device => migrateCompatibleUnitConversion(migrateLegacyDeviceConversionRecord(device).device).device),
    ...track.devices,
  ] }));
  return parsed;
}

export function synchronizeProjectStateToXml(
  project: AbletonProjectState,
  previous?: AbletonProjectState
): string {
  assertProjectState(project);
  let xml = project.rawXmlModified || project.rawXml || '';
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror') || !doc.querySelector('Ableton > LiveSet')) {
    throw new Error('PROJECT_XML: invalid Ableton project');
  }
  const tracksNode = doc.querySelector('LiveSet > Tracks');
  if (!tracksNode) throw new Error('PROJECT_XML: missing Tracks');
  // Reconcile only the track kinds represented by the editable domain. Groups,
  // returns and future track types remain opaque, in their existing positions.
  const desiredIds = new Set(project.tracks.map(track => track.id));
  for (const node of Array.from(tracksNode.children)) {
    if (['MidiTrack', 'AudioTrack'].includes(node.tagName) && !desiredIds.has(readAlsIdentity(node))) node.remove();
  }
  const present = new Map(Array.from(tracksNode.children).map(node => [readAlsIdentity(node), node]));
  const used = new Set(Array.from(doc.querySelectorAll('[Id]')).map(node => node.getAttribute('Id')));
  let nextId = 10000;
  for (const track of project.tracks) {
    if (present.has(track.id)) continue;
    if (track.type !== 'midi' || !track.isGenerated) throw new Error(`PROJECT_XML: cannot materialize track ${track.id}`);
    while (used.has(String(nextId))) nextId++;
    const node = doc.createElement('MidiTrack'); node.setAttribute('Id', String(nextId)); used.add(String(nextId++));
    node.setAttribute('Data-Parametric-TrackId', track.id);
    node.setAttribute('Data-Parametric-DeviceExecution', 'browser-only');
    const name = doc.createElement('Name');
    for (const key of ['EffectiveName', 'UserName']) { const n = doc.createElement(key); n.setAttribute('Value', track.name); name.appendChild(n); }
    node.appendChild(name);
    const chain = doc.createElement('DeviceChain'); node.appendChild(chain);
    const instrumentChain = doc.createElement('MidiToAudioDeviceChain'); instrumentChain.appendChild(doc.createElement('Devices')); chain.appendChild(instrumentChain);
    tracksNode.appendChild(node);
    injectMultipleMidiClipsXmlNodes(doc, node, track.clips);
  }
  const represented = Array.from(tracksNode.children).filter(node => ['MidiTrack', 'AudioTrack'].includes(node.tagName));
  const byId = new Map<string, Element>();
  for (const node of represented) {
    const id = readAlsIdentity(node);
    if (byId.has(id)) throw new Error(`PROJECT_XML: ambiguous track identity ${id}`);
    byId.set(id, node);
  }
  const slots = represented.map(node => {
    const slot = doc.createComment('track'); tracksNode.replaceChild(slot, node); return slot;
  });
  project.tracks.forEach((track, index) => {
    const node = byId.get(track.id)!;
    let name = node.querySelector(':scope > Name');
    if (!name) { name = doc.createElement('Name'); node.appendChild(name); }
    // Avoid rewriting an untouched native name representation on unrelated edits.
    if (name.querySelector(':scope > EffectiveName')?.getAttribute('Value') !== track.name) {
      for (const key of ['EffectiveName', 'UserName']) {
        let value = name.querySelector(`:scope > ${key}`);
        if (!value) { value = doc.createElement(key); name.appendChild(value); }
        value.setAttribute('Value', track.name);
      }
    }
    tracksNode.replaceChild(node, slots[index]);
  });
  const root = doc.querySelector('Ableton')!;
  if (project.generationSeed !== undefined) root.setAttribute('Data-Parametric-GenerationSeed',String(project.generationSeed));
  if (project.humanizationSeed !== undefined) root.setAttribute('Data-Parametric-HumanizationSeed', String(project.humanizationSeed));
  if (project.creationMode !== undefined) root.setAttribute('Data-Parametric-CreationMode', project.creationMode);
  if (project.requestedDurationBars !== undefined) root.setAttribute('Data-Parametric-RequestedDurationBars', String(project.requestedDurationBars));
  root.setAttribute('Data-Parametric-ArrangementBars', String(project.arrangementLengthBars || 16));
  const tempo = projectTempoTarget(doc);
  if (tempo) tempo.setAttribute('Value', String(project.tempo));
  else if (project.tempo !== (previous?.tempo ?? parseAbletonXmlDom(xml, project.fileName).tempo)) {
    throw new Error('PROJECT_XML: missing tempo target for tempo edit');
  }
  if (project.songPlan) {
    let node = doc.querySelector('LiveSet > ParametricSongPlan');
    if (!node) { node = doc.createElement('ParametricSongPlan'); doc.querySelector('LiveSet')!.appendChild(node); }
    node.setAttribute('Version', String(project.songPlan.version)); node.textContent = JSON.stringify(project.songPlan);
  }
  if (project.audioSettings) {
    let node = doc.querySelector('LiveSet > ParametricAudioSettings');
    if (!node) { node = doc.createElement('ParametricAudioSettings'); doc.querySelector('LiveSet')!.appendChild(node); }
    node.setAttribute('Version', '1'); node.textContent = JSON.stringify(project.audioSettings);
  }
  let sessionNode=doc.querySelector('LiveSet > ParametricSessionState');
  if (project.session) {
    if (!sessionNode) { sessionNode=doc.createElement('ParametricSessionState'); doc.querySelector('LiveSet')!.appendChild(sessionNode); }
    sessionNode.setAttribute('Version','1');sessionNode.textContent=JSON.stringify(project.session);
  } else sessionNode?.remove();
  let timingNode = doc.querySelector('LiveSet > ParametricTimingMaps');
  if (project.ppq !== undefined || project.tempoMap !== undefined || project.meterMap !== undefined) {
    if (!timingNode) {
      timingNode = doc.createElement('ParametricTimingMaps');
      doc.querySelector('LiveSet')!.appendChild(timingNode);
    }
    timingNode.setAttribute('Version', '1');
    timingNode.textContent = JSON.stringify({
      ...(project.ppq !== undefined ? { ppq: project.ppq } : {}),
      ...(project.tempoMap !== undefined ? { tempoMap: project.tempoMap } : {}),
      ...(project.meterMap !== undefined ? { meterMap: project.meterMap } : {}),
    });
  } else timingNode?.remove();

  xml = new XMLSerializer().serializeToString(doc);
  // Compare against the prior complete projection, never the half-built document:
  // new Session references are not resolvable until track metadata is written below.
  const serialized = previous ? null : parseAbletonXmlDom(project.rawXmlModified || project.rawXml || '', project.fileName);
  const clipContent = (clips: AbletonMidiClip[] = []) => clips.map(c => ({
    id: c.id, name: c.name, userEdited:c.userEdited, startTime: c.startTime, length: c.length, loopEndBeats: c.loopEndBeats,
    notes: c.notes.map(n => ({ id: n.id, time: n.time, quantizedTime: n.quantizedTime,
      duration: n.duration, pitch: n.pitch, velocity: n.velocity, probability: n.probability ?? 1, harmonicOwner:n.harmonicOwner, isSlide:n.isSlide??false, isAccent:n.isAccent??(n.velocity>=110) })),
  }));
  for (const track of project.tracks) {
    if (track.type !== 'midi') continue;
    const before = (previous || serialized)?.tracks.find(t => t.id === track.id);
    if (JSON.stringify(clipContent(track.clips)) !== JSON.stringify(clipContent(before?.clips))) {
      xml = syncTrackClipsToXml(xml, track.id, track.clips);
    }
  }
  return syncLocatorsAndMixerToXml(xml, project.tracks, project.memoryLocations);
}

/**
 * Maximum forward shift in beats applied to even-numbered 16th notes at 100% Swing Strength.
 * A 16th note is 0.25 beats; 50% of a 16th-note step is 0.125 beats (a 32nd-note swing offset).
 */
export const MAX_SIXTEENTH_SWING_SHIFT_BEATS = 0.125;

/**
 * Applies percentage-based 16th-note swing (0% to 100%) to a MIDI clip or note array
 * by shifting even-numbered 16th notes (the 2nd, 4th, 6th, 8th, 10th, 12th, 14th, 16th
 * sixteenth notes of each bar, occurring at 0.25, 0.75, 1.25, 1.75... beats) forward in time
 * proportionally to the selected swing strength.
 */
export function applySwingToMidiClip(clip: AbletonMidiClip, swingStrength: number): AbletonMidiClip;
export function applySwingToMidiClip(notes: MidiNoteEvent[], swingStrength: number): MidiNoteEvent[];
export function applySwingToMidiClip(
  clipOrNotes: AbletonMidiClip | MidiNoteEvent[],
  swingStrength: number
): AbletonMidiClip | MidiNoteEvent[] {
  const clampedStrength = Math.max(0, Math.min(100, Number.isFinite(swingStrength) ? swingStrength : 0));
  const swingShiftBeats = (clampedStrength / 100) * MAX_SIXTEENTH_SWING_SHIFT_BEATS;

  const transformNotes = (notes: MidiNoteEvent[]): MidiNoteEvent[] => {
    if (clampedStrength <= 0) {
      return notes.map((n) => ({ ...n }));
    }
    return notes.map((note) => {
      const refTime = note.quantizedTime !== undefined ? note.quantizedTime : note.time;
      const zeroBasedSixteenthIndex = Math.round(refTime / 0.25);
      const isOnSixteenthGrid = Math.abs(refTime - zeroBasedSixteenthIndex * 0.25) < 0.06;
      // In 1-based musical counting (1st, 2nd, 3rd, 4th 16th note), even-numbered 16th notes
      // have (zeroBasedSixteenthIndex + 1) % 2 === 0 (i.e. zeroBasedSixteenthIndex % 2 === 1: 0.25, 0.75, 1.25, 1.75...)
      const oneBasedSixteenthNumber = zeroBasedSixteenthIndex + 1;
      const isEvenSixteenthNote = isOnSixteenthGrid && oneBasedSixteenthNumber % 2 === 0;
      if (!isEvenSixteenthNote) {
        return { ...note };
      }
      return {
        ...note,
        time: Number(Math.max(0, note.time + swingShiftBeats).toFixed(4)),
      };
    });
  };

  if (Array.isArray(clipOrNotes)) {
    return transformNotes(clipOrNotes);
  }
  return {
    ...clipOrNotes,
    notes: transformNotes(clipOrNotes.notes),
  };
}

export const applySixteenthNoteSwing = applySwingToMidiClip;

/**
 * Maximum physical perceptual pocket (in milliseconds) at 100% Dilla Shuffle Swing.
 * Converts dynamically into beats based on the current BPM:
 * beatsOffset = (pocketMs / 1000) * (bpm / 60).
 */
export const MAX_DILLA_SHUFFLE_POCKET_MS = 22.0;

/**
 * Computes the BPM-dependent 'Dilla-style' push/pull offset in beats for a given 16th-note grid position.
 * Models J Dilla's unquantized MPC3000 micro-timing feel across each beat's 16th-note subdivisions:
 * - stepInBeat === 1 (2nd 16th, "e", e.g. 0.25b): Pulled late (+1.0 weight, laid-back drunken drag behind the grid)
 * - stepInBeat === 2 (3rd 16th, "&", e.g. 0.50b): Pushed early (-0.55 weight, urgent anticipation ahead of the grid)
 * - stepInBeat === 3 (4th 16th, "a", e.g. 0.75b): Pulled late (+0.78 weight, heavy shuffle pocket pickup)
 * - stepInBeat === 0 (downbeat quarter): Beat 1 & 3 anchored (0.0); Beat 2 & 4 backbeats pushed slightly early (-0.28 weight)
 */
export function computeDillaShuffleOffsetBeats(
  beatTime: number,
  shuffleSwing: number,
  bpm = 134
): number {
  const clampedShuffle = Math.max(
    -100,
    Math.min(100, Number.isFinite(shuffleSwing) ? shuffleSwing : 0)
  );
  if (Math.abs(clampedShuffle) < 0.001) return 0;

  const safeBpm = Math.max(40, Math.min(240, Number.isFinite(bpm) && bpm > 0 ? bpm : 134));
  const zeroBasedSixteenth = Math.round(beatTime / 0.25);
  const isOnSixteenthGrid = Math.abs(beatTime - zeroBasedSixteenth * 0.25) < 0.08;
  if (!isOnSixteenthGrid) return 0;

  const stepInBar = ((zeroBasedSixteenth % 16) + 16) % 16;
  const stepInBeat = stepInBar % 4;

  // Dilla push/pull directional weights per 16th-note subdivision
  let dillaSubdivisionWeight = 0;
  if (stepInBeat === 1) {
    // 2nd 16th ("1e"): pulled late behind the grid
    dillaSubdivisionWeight = 1.0;
  } else if (stepInBeat === 2) {
    // 3rd 16th ("1&" offbeat 8th): pushed early ahead of the grid
    dillaSubdivisionWeight = -0.55;
  } else if (stepInBeat === 3) {
    // 4th 16th ("1a" pickup): pulled late into next downbeat
    dillaSubdivisionWeight = 0.78;
  } else if (stepInBar === 4 || stepInBar === 12) {
    // Backbeats (Beats 2 and 4): subtle early snare/clap push
    dillaSubdivisionWeight = -0.28;
  }

  // Convert millisecond pocket into beats using current BPM: beats = (ms / 1000) * (bpm / 60)
  const maxPocketBeatsAtBpm = (MAX_DILLA_SHUFFLE_POCKET_MS / 60000) * safeBpm;
  const normalizedStrength = clampedShuffle / 100;
  return Number((dillaSubdivisionWeight * normalizedStrength * maxPocketBeatsAtBpm).toFixed(4));
}

/**
 * Applies BPM-dependent 'Dilla-style' Shuffle Swing push/pull to a MIDI clip or note array.
 */
export function applyShuffleSwingToMidiClip(
  clip: AbletonMidiClip,
  shuffleSwing: number,
  bpm?: number
): AbletonMidiClip;
export function applyShuffleSwingToMidiClip(
  notes: MidiNoteEvent[],
  shuffleSwing: number,
  bpm?: number
): MidiNoteEvent[];
export function applyShuffleSwingToMidiClip(
  clipOrNotes: AbletonMidiClip | MidiNoteEvent[],
  shuffleSwing: number,
  bpm = 134
): AbletonMidiClip | MidiNoteEvent[] {
  const clampedShuffle = Math.max(
    -100,
    Math.min(100, Number.isFinite(shuffleSwing) ? shuffleSwing : 0)
  );

  const transformNotes = (notes: MidiNoteEvent[]): MidiNoteEvent[] => {
    if (Math.abs(clampedShuffle) < 0.001) {
      return notes.map((n) => ({ ...n }));
    }
    return notes.map((note) => {
      const refTime = note.quantizedTime !== undefined ? note.quantizedTime : note.time;
      const pushPullOffset = computeDillaShuffleOffsetBeats(refTime, clampedShuffle, bpm);
      if (Math.abs(pushPullOffset) < 0.0001) {
        return { ...note };
      }
      return {
        ...note,
        time: Number(Math.max(0, note.time + pushPullOffset).toFixed(4)),
      };
    });
  };

  if (Array.isArray(clipOrNotes)) {
    return transformNotes(clipOrNotes);
  }
  return {
    ...clipOrNotes,
    notes: transformNotes(clipOrNotes.notes),
  };
}

export const applyDillaShuffleSwing = applyShuffleSwingToMidiClip;

/**
 * TASK 2: THE TECHNO LAYER GENERATOR (TechnoHeuristicEngine)
 */
export class TechnoHeuristicEngine {
  static applySwingToMidiClip = applySwingToMidiClip;
  static applySixteenthNoteSwing = applySixteenthNoteSwing;
  static applyShuffleSwingToMidiClip = applyShuffleSwingToMidiClip;
  static applyDillaShuffleSwing = applyDillaShuffleSwing;
  static computeDillaShuffleOffsetBeats = computeDillaShuffleOffsetBeats;

  /**
   * Generates a multi-bar (16 to 128 bars) humanized MIDI note array for the target archetype.
   */
  static generateHumanizedMidiArray(
    archetype: TechnoArchetype,
    rootKey: string,
    humanization: HumanizationConfig,
    customOneBarPattern?: { time: number; duration: number; pitch: number; velocity: number }[],
    seed = 1,
    totalBars = 16,
    bpm = 134
  ): MidiNoteEvent[] {
    const notes: MidiNoteEvent[] = [];
    const subRoot = rootKeyToMidiBase(rootKey, 1); // e.g., F1 = 29
    const maxShift = humanization.microTimingMaxShiftBeats;
    const velVar = humanization.velocityVariancePct;
    const swingStrength = humanization.swingStrength ?? 0;
    const shuffleSwing = humanization.shuffleSwing ?? 0;
    const variantId = Math.abs(seed) % 4;

    if (customOneBarPattern && customOneBarPattern.length > 0) {
      for (let bar = 0; bar < totalBars; bar++) {
        customOneBarPattern.forEach((baseNote, idx) => {
          const quantizedTime = bar * 4 + baseNote.time;
          const isQuarterDownbeat = Math.abs(baseNote.time % 1) < 0.001;
          const rawShift = isQuarterDownbeat
            ? gaussianRandom(0, maxShift * 0.15, seed + bar * 31 + idx)
            : gaussianRandom(0.002, maxShift * 0.7, seed + bar * 31 + idx);
          const clampedShift = Math.max(-maxShift, Math.min(maxShift, rawShift));
          const time = Math.max(0, quantizedTime + clampedShift);

          const vFactor = 1 + (seededRandom(seed + bar * 19 + idx * 7) * 2 - 1) * velVar;
          const velocity = Math.max(18, Math.min(124, Math.round(baseNote.velocity * vFactor)));

          notes.push({
            id: `gen_${archetype}_${bar}_${idx}`,
            time: Number(time.toFixed(3)),
            quantizedTime: Number(quantizedTime.toFixed(3)),
            duration: Number(baseNote.duration.toFixed(3)),
            pitch: baseNote.pitch,
            velocity,
            isGhost: velocity <= humanization.ghostVelocityMax,
            isAccent: velocity >= 110,
            isSlide: archetype === 'acid' && baseNote.duration > 0.26,
          });
        });
      }
      const afterSwing = swingStrength > 0 ? applySwingToMidiClip(notes, swingStrength) : notes;
      return Math.abs(shuffleSwing) > 0
        ? applyShuffleSwingToMidiClip(afterSwing, shuffleSwing, bpm)
        : afterSwing;
    }

    if (archetype === 'rumble') {
      for (let bar = 0; bar < totalBars; bar++) {
        for (let step = 0; step < 16; step++) {
          const isDownbeat = step % 4 === 0;
          if (isDownbeat) continue;

          if (variantId === 1 && (step === 1 || step === 9)) continue;
          if (variantId === 2 && bar % 2 === 0 && (step === 5 || step === 13)) continue;

          const quantizedTime = bar * 4 + step * 0.25;
          const isOffbeatEighth = step % 4 === 2;
          const isSyncopated16th = step % 2 === 1;

          const safeMaxShift = Math.min(0.014, maxShift);
          const rawShift = isSyncopated16th
            ? gaussianRandom(0.002, safeMaxShift * 0.55, seed + bar * 16 + step)
            : gaussianRandom(0, safeMaxShift * 0.2, seed + bar * 16 + step);
          const timeShift = Math.max(-safeMaxShift, Math.min(safeMaxShift, rawShift));
          const finalTime = Math.max(0, quantizedTime + timeShift);

          let baseVelocity = 96;
          if (isOffbeatEighth) {
            baseVelocity = 112;
          } else if (step % 4 === 3) {
            baseVelocity = 94;
          } else {
            const ghostSpan = humanization.ghostVelocityMax - humanization.ghostVelocityMin;
            baseVelocity =
              humanization.ghostVelocityMin +
              Math.floor(seededRandom(seed + bar * 11 + step * 13) * (ghostSpan + 1));
          }

          const velMultiplier = 1.0 + (seededRandom(seed + bar * 23 + step * 17) * 2 - 1) * velVar;
          const finalVel = Math.max(24, Math.min(126, Math.round(baseVelocity * velMultiplier)));

          let pitch = subRoot;
          if (bar % 4 === 3 && step === 14) pitch = subRoot + 1;
          else if (variantId === 3 && step === 15) pitch = subRoot + 7;

          notes.push({
            id: `rumble_${bar}_${step}`,
            time: Number(finalTime.toFixed(3)),
            quantizedTime: Number(quantizedTime.toFixed(3)),
            duration: isOffbeatEighth ? 0.23 : 0.19,
            pitch,
            velocity: finalVel,
            isGhost: finalVel <= humanization.ghostVelocityMax,
          });
        }
      }
    } else if (archetype === 'acid') {
      // TB-303 Resonant Acid Bassline with octave jumps, Phrygian b2 accents, and overlapping slides
      const acidRoot = rootKeyToMidiBase(rootKey, 2); // e.g., F2 = 41
      const acidSteps = [
        { step: 0, offset: 0, vel: 116, dur: 0.2, slide: false },
        { step: 2, offset: 12, vel: 122, dur: 0.32, slide: true },
        { step: 3, offset: 0, vel: 72, dur: 0.18, slide: false },
        { step: 5, offset: 1, vel: 114, dur: 0.3, slide: true },
        { step: 6, offset: 0, vel: 42, dur: 0.16, slide: false },
        { step: 7, offset: 7, vel: 108, dur: 0.22, slide: false },
        { step: 9, offset: 0, vel: 38, dur: 0.16, slide: false },
        { step: 10, offset: 12, vel: 124, dur: 0.34, slide: true },
        { step: 11, offset: 10, vel: 92, dur: 0.2, slide: false },
        { step: 13, offset: 3, vel: 112, dur: 0.22, slide: false },
        { step: 14, offset: 1, vel: 120, dur: 0.32, slide: true },
        { step: 15, offset: 0, vel: 84, dur: 0.18, slide: false },
      ];

      for (let bar = 0; bar < totalBars; bar++) {
        acidSteps.forEach((s, idx) => {
          if (variantId === 1 && idx % 5 === 3) return;
          const effectiveStep = bar % 4 === 3 && idx >= 9 ? (s.step + 1) % 16 : s.step;
          const quantizedTime = bar * 4 + effectiveStep * 0.25;
          const shift = Math.max(
            -maxShift,
            Math.min(maxShift, gaussianRandom(0.001, maxShift * 0.45, seed + bar * 19 + idx))
          );
          const vMult = 1 + (seededRandom(seed + bar * 29 + idx * 7) * 2 - 1) * velVar;
          const velocity = Math.max(28, Math.min(127, Math.round(s.vel * vMult)));
          const extraOct = bar % 8 === 7 && idx === acidSteps.length - 2 ? 12 : 0;

          notes.push({
            id: `acid_${bar}_${idx}`,
            time: Number(Math.max(0, quantizedTime + shift).toFixed(3)),
            quantizedTime: Number(quantizedTime.toFixed(3)),
            duration: s.dur,
            pitch: acidRoot + s.offset + extraOct,
            velocity,
            isGhost: velocity <= humanization.ghostVelocityMax,
            isAccent: velocity >= 112,
            isSlide: s.slide,
          });
        });
      }
    } else if (archetype === 'ride') {
      // Warehouse 909 Ride Cymbal: relentless quarter/8th/16th metallic tension shimmer
      const ridePitch = 51; // D#2 / Eb2 GM Ride Cymbal
      for (let bar = 0; bar < totalBars; bar++) {
        for (let step = 0; step < 16; step++) {
          const isQuarter = step % 4 === 0;
          const isOffbeat8th = step % 4 === 2;
          const isTurnaround = bar % 4 === 3;
          // Play on 8ths plus rolling 16th pickups
          if (!isQuarter && !isOffbeat8th && step % 4 !== 3 && !(isTurnaround && step >= 12)) {
            continue;
          }
          const quantizedTime = bar * 4 + step * 0.25;
          const shift = Math.max(
            -maxShift,
            Math.min(maxShift, gaussianRandom(0.002, maxShift * 0.5, seed + bar * 17 + step))
          );
          const baseVel = isOffbeat8th ? 114 : isQuarter ? 86 : 54;
          const velocity = Math.max(
            28,
            Math.min(124, Math.round(baseVel * (1 + (seededRandom(seed + bar * 13 + step) * 2 - 1) * velVar)))
          );
          notes.push({
            id: `ride_${bar}_${step}`,
            time: Number(Math.max(0, quantizedTime + shift).toFixed(3)),
            quantizedTime: Number(quantizedTime.toFixed(3)),
            duration: isOffbeat8th ? 0.36 : 0.2,
            pitch: ridePitch,
            velocity,
            isGhost: velocity <= humanization.ghostVelocityMax,
          });
        }
      }
    } else if (archetype === 'pad') {
      // Deep Dub Techno Chord Pad & Atmospheric Texture
      const padRoot = rootKeyToMidiBase(rootKey, 3);
      const chordHits = [
        { beatOffset: 0.5, dur: 1.4, vel: 96, semitones: [0, 3, 7, 14] },
        { beatOffset: 2.75, dur: 1.1, vel: 88, semitones: [0, 3, 7, 10] },
      ];
      for (let bar = 0; bar < totalBars; bar++) {
        chordHits.forEach((ch, cIdx) => {
          const quantizedTime = bar * 4 + ch.beatOffset;
          const shift = gaussianRandom(0.003, maxShift * 0.5, seed + bar * 11 + cIdx);
          const inversionShift = bar % 4 === 2 && cIdx === 1 ? 2 : 0;
          ch.semitones.forEach((semi, vIdx) => {
            const vel = Math.max(
              36,
              Math.min(116, Math.round(ch.vel * (vIdx === 0 ? 1 : 0.86) * (1 + (seededRandom(seed + bar * 7 + vIdx) - 0.5) * velVar)))
            );
            notes.push({
              id: `pad_${bar}_${cIdx}_${vIdx}`,
              time: Number(Math.max(0, quantizedTime + shift).toFixed(3)),
              quantizedTime: Number(quantizedTime.toFixed(3)),
              duration: ch.dur,
              pitch: padRoot + semi + inversionShift,
              velocity: vel,
              isGhost: false,
            });
          });
        });
      }
    } else if (archetype === 'percussion') {
      const basePitch = rootKeyToMidiBase(rootKey, 3);
      const euclideanBarPatterns: number[][] = [
        [0, 3, 6, 9, 12, 14],
        [2, 5, 8, 11, 14, 15],
        [0, 3, 6, 10, 12, 15],
        [1, 4, 7, 10, 13, 14],
      ];
      const activeSteps = euclideanBarPatterns[variantId];

      for (let bar = 0; bar < totalBars; bar++) {
        activeSteps.forEach((step, idx) => {
          const quantizedTime = bar * 4 + step * 0.25;
          const safeShift = Math.min(0.012, maxShift);
          const shift =
            step % 4 === 0
              ? 0
              : Math.max(
                  -safeShift,
                  Math.min(safeShift, gaussianRandom(0.002, safeShift * 0.5, seed + bar * 16 + step))
                );
          const time = Math.max(0, quantizedTime + shift);
          const baseVel = step % 4 === 2 ? 108 : idx % 2 === 0 ? 94 : 42;
          const velMultiplier = 1.0 + (seededRandom(seed + bar * 19 + idx * 13) * 2 - 1) * velVar;
          const velocity = Math.max(24, Math.min(125, Math.round(baseVel * velMultiplier)));
          const pitchOffset = idx === 2 ? 7 : idx === 5 ? 12 : 0;

          notes.push({
            id: `perc_${bar}_${step}`,
            time: Number(time.toFixed(3)),
            quantizedTime: Number(quantizedTime.toFixed(3)),
            duration: 0.18,
            pitch: basePitch + pitchOffset,
            velocity,
            isGhost: velocity <= humanization.ghostVelocityMax,
          });
        });
      }
    } else if (archetype === 'synth') {
      const synthRoot = rootKeyToMidiBase(rootKey, 3);
      const stabPatterns = [
        [
          { step: 2, pitchOffset: 0, vel: 104, dur: 0.35 },
          { step: 5, pitchOffset: 1, vel: 38, dur: 0.2 },
          { step: 7, pitchOffset: 0, vel: 96, dur: 0.4 },
          { step: 11, pitchOffset: 7, vel: 88, dur: 0.3 },
          { step: 14, pitchOffset: 1, vel: 98, dur: 0.35 },
        ],
        [
          { step: 2, pitchOffset: 0, vel: 108, dur: 0.4 },
          { step: 6, pitchOffset: 7, vel: 92, dur: 0.3 },
          { step: 10, pitchOffset: 3, vel: 102, dur: 0.35 },
          { step: 14, pitchOffset: 1, vel: 88, dur: 0.25 },
        ],
        [
          { step: 1, pitchOffset: 0, vel: 90, dur: 0.2 },
          { step: 4, pitchOffset: 0, vel: 106, dur: 0.3 },
          { step: 7, pitchOffset: 1, vel: 44, dur: 0.18 },
          { step: 10, pitchOffset: 7, vel: 98, dur: 0.25 },
          { step: 13, pitchOffset: 1, vel: 92, dur: 0.3 },
        ],
        [
          { step: 3, pitchOffset: 12, vel: 105, dur: 0.25 },
          { step: 7, pitchOffset: 0, vel: 100, dur: 0.35 },
          { step: 11, pitchOffset: 1, vel: 42, dur: 0.2 },
          { step: 15, pitchOffset: 7, vel: 96, dur: 0.3 },
        ],
      ];

      const activePattern = stabPatterns[variantId];

      for (let bar = 0; bar < totalBars; bar++) {
        activePattern.forEach((s, idx) => {
          const quantizedTime = bar * 4 + s.step * 0.25;
          const shift = Math.max(
            -maxShift,
            Math.min(maxShift, gaussianRandom(0.002, maxShift * 0.65, seed + bar * 17 + idx))
          );
          const velMultiplier = 1.0 + (seededRandom(seed + bar * 13 + idx * 7) * 2 - 1) * velVar;
          const velocity = Math.max(22, Math.min(124, Math.round(s.vel * velMultiplier)));

          notes.push({
            id: `synth_${bar}_${idx}`,
            time: Number(Math.max(0, quantizedTime + shift).toFixed(3)),
            quantizedTime: Number(quantizedTime.toFixed(3)),
            duration: s.dur,
            pitch: synthRoot + s.pitchOffset,
            velocity,
            isGhost: velocity <= humanization.ghostVelocityMax,
          });
        });
      }
    } else if (archetype === 'hats') {
      for (let bar = 0; bar < totalBars; bar++) {
        for (let step = 0; step < 16; step++) {
          const isOffbeat8th = step % 4 === 2;
          let isGhost16th = step % 2 === 1;

          if (variantId === 1 && step % 4 === 3) isGhost16th = true;
          if (variantId === 2 && step % 4 === 0) continue;

          if (!isOffbeat8th && !isGhost16th) continue;

          const quantizedTime = bar * 4 + step * 0.25;
          const shift = Math.max(
            -maxShift,
            Math.min(maxShift, gaussianRandom(0.004, maxShift * 0.75, seed + bar * 23 + step))
          );
          const baseVel = isOffbeat8th
            ? 108
            : humanization.ghostVelocityMin +
              Math.floor(
                seededRandom(seed + bar * 19 + step * 7) *
                  (humanization.ghostVelocityMax - humanization.ghostVelocityMin + 1)
              );
          const velMultiplier = 1.0 + (seededRandom(seed + bar * 7 + step) * 2 - 1) * velVar;
          const velocity = Math.max(20, Math.min(124, Math.round(baseVel * velMultiplier)));

          notes.push({
            id: `hats_${bar}_${step}`,
            time: Number(Math.max(0, quantizedTime + shift).toFixed(3)),
            quantizedTime: Number(quantizedTime.toFixed(3)),
            duration: isOffbeat8th ? 0.35 : 0.12,
            pitch: isOffbeat8th ? 46 : 42,
            velocity,
            isGhost: !isOffbeat8th,
          });
        }
      }
    } else if (archetype === 'kick') {
      const kickPitch = 36;
      for (let bar = 0; bar < totalBars; bar++) {
        for (let beat = 0; beat < 4; beat++) {
          const globalBeat = bar * 4 + beat;
          const baseVel = beat === 0 ? 122 : 116;
          const velMultiplier = 1.0 + (seededRandom(seed + globalBeat * 11) * 2 - 1) * (velVar * 0.5);
          const velocity = Math.max(96, Math.min(127, Math.round(baseVel * velMultiplier)));

          notes.push({
            id: `kick_${bar}_${beat}`,
            time: Number(globalBeat.toFixed(3)),
            quantizedTime: Number(globalBeat.toFixed(3)),
            duration: 0.25,
            pitch: kickPitch,
            velocity,
            isGhost: false,
          });

          if ((variantId === 1 && beat === 2) || (bar % 4 === 3 && beat === 3)) {
            const ghostQuantized = globalBeat + 0.75;
            const shift = Math.max(
              -maxShift,
              Math.min(maxShift, gaussianRandom(0.003, maxShift * 0.65, seed + globalBeat * 19))
            );
            const ghostVel =
              humanization.ghostVelocityMin +
              Math.floor(
                seededRandom(seed + globalBeat * 23) *
                  (humanization.ghostVelocityMax - humanization.ghostVelocityMin + 1)
              );
            notes.push({
              id: `kick_ghost_${bar}_${beat}`,
              time: Number(Math.max(0, ghostQuantized + shift).toFixed(3)),
              quantizedTime: Number(ghostQuantized.toFixed(3)),
              duration: 0.18,
              pitch: kickPitch,
              velocity: ghostVel,
              isGhost: true,
            });
          }
        }
      }
    }

    const afterSwing = swingStrength > 0 ? applySwingToMidiClip(notes, swingStrength) : notes;
    return Math.abs(shuffleSwing) > 0
      ? applyShuffleSwingToMidiClip(afterSwing, shuffleSwing, bpm)
      : afterSwing;
  }

  /**
   * Returns the raw Ableton Live 11/12 XML DeviceChain template for the specified techno archetype
   */
  static getDeviceChainXmlTemplate(archetype: TechnoArchetype, humanization: HumanizationConfig): string {
    if (archetype === 'rumble') {
      return `
        <MidiToAudioDeviceChain>
          <Devices>
            <Operator Id="4101">
              <LomId Value="0" />
              <IsOn><Manual Value="true" /></IsOn>
              <Algorithm Value="0" />
              <Transpose><Manual Value="0" /></Transpose>
              <OscillatorA>
                <IsOn><Manual Value="true" /></IsOn>
                <Waveform Value="Sine" />
                <Coarse Value="0" />
                <Fine Value="0" />
                <Level Value="0.92" />
                <Envelope>
                  <Attack Value="2.5" />
                  <Decay Value="620.0" />
                  <Sustain Value="0.75" />
                  <Release Value="180.0" />
                </Envelope>
              </OscillatorA>
            </Operator>
            <Reverb Id="4102">
              <LomId Value="0" />
              <IsOn><Manual Value="true" /></IsOn>
              <PreDelay><Manual Value="12.5" /></PreDelay>
              <DecayTime><Manual Value="${Math.round(2800 + humanization.macroTransition * 18)}" /></DecayTime>
              <RoomSize><Manual Value="88.0" /></RoomSize>
              <StereoSeparation><Manual Value="0.0" /></StereoSeparation>
              <DryWet><Manual Value="0.44" /></DryWet>
            </Reverb>
            <AutoFilter Id="4103">
              <LomId Value="0" />
              <IsOn><Manual Value="true" /></IsOn>
              <FilterType><Manual Value="Lowpass" /></FilterType>
              <Slope><Manual Value="24dB" /></Slope>
              <Cutoff Id="9401">
                <Manual Value="${humanization.cutoffHz.toFixed(1)}" />
              </Cutoff>
              <Resonance>
                <Manual Value="0.28" />
              </Resonance>
              <EnvModulation><Manual Value="0.15" /></EnvModulation>
            </AutoFilter>
            <EQEight Id="4105">
              <IsOn><Manual Value="true" /></IsOn>
              <Band.1><FilterType Value="HighPass48" /><Freq Value="28.0" /></Band.1>
              <Band.2><FilterType Value="Bell" /><Freq Value="55.0" /><Gain Value="-9.5" /><Q Value="3.4" /></Band.2>
            </EQEight>
            <Compressor2 Id="4104">
              <LomId Value="0" />
              <IsOn><Manual Value="true" /></IsOn>
              <Sidechain><IsOn Value="true" /><SourceTrack Value="01_Kick_909_Foundation" /></Sidechain>
              <Threshold><Manual Value="-22.5" /></Threshold>
              <Ratio><Manual Value="4.8" /></Ratio>
              <Attack><Manual Value="0.4" /></Attack>
              <Release><Manual Value="118.0" /></Release>
            </Compressor2>
          </Devices>
        </MidiToAudioDeviceChain>
      `.trim();
    }

    if (archetype === 'acid') {
      return `
        <MidiToAudioDeviceChain>
          <Devices>
            <UltraAnalog Id="4201">
              <IsOn><Manual Value="true" /></IsOn>
              <Oscillator1><Waveform Value="Saw" /></Oscillator1>
              <Filter1><Resonance Value="0.82" /></Filter1>
            </UltraAnalog>
            <AutoFilter Id="4202">
              <IsOn><Manual Value="true" /></IsOn>
              <FilterType><Manual Value="Lowpass" /></FilterType>
              <Slope><Manual Value="24dB" /></Slope>
              <Cutoff Id="9401"><Manual Value="620.0" /></Cutoff>
              <Resonance><Manual Value="0.78" /></Resonance>
            </AutoFilter>
            <Roar Id="4203">
              <IsOn><Manual Value="true" /></IsOn>
              <Drive><Manual Value="0.46" /></Drive>
              <Routing Value="MidSide" />
            </Roar>
            <Echo Id="4204">
              <IsOn><Manual Value="true" /></IsOn>
              <LeftTime><SyncDivision Value="3/16" /></LeftTime>
              <Feedback><Manual Value="0.48" /></Feedback>
              <DryWet><Manual Value="0.34" /></DryWet>
            </Echo>
            <EQEight Id="4205">
              <IsOn><Manual Value="true" /></IsOn>
              <Band.1><FilterType Value="HighPass48" /><Freq Value="95.0" /></Band.1>
              <Band.2><FilterType Value="Bell" /><Freq Value="55.0" /><Gain Value="-7.5" /><Q Value="2.8" /></Band.2>
            </EQEight>
            <Compressor2 Id="4206">
              <IsOn><Manual Value="true" /></IsOn>
              <Sidechain><IsOn Value="true" /><SourceTrack Value="01_Kick_909_Foundation" /></Sidechain>
              <Threshold><Manual Value="-20.0" /></Threshold>
              <Ratio><Manual Value="4.2" /></Ratio>
              <Release><Manual Value="110.0" /></Release>
            </Compressor2>
          </Devices>
        </MidiToAudioDeviceChain>
      `.trim();
    }

    if (archetype === 'ride') {
      return `
        <MidiToAudioDeviceChain>
          <Devices>
            <Collision Id="4301">
              <IsOn><Manual Value="true" /></IsOn>
              <MalletStiffness><Manual Value="0.88" /></MalletStiffness>
              <Resonator1><Type Value="Plate" /><Decay Value="0.65" /><Material Value="Metal" /></Resonator1>
            </Collision>
            <EQEight Id="4302">
              <IsOn><Manual Value="true" /></IsOn>
              <Band.1><FilterType Value="HighPass48" /><Freq Value="650.0" /></Band.1>
            </EQEight>
            <HybridReverb Id="4303">
              <IsOn><Manual Value="true" /></IsOn>
              <DecayTime><Manual Value="3200" /></DecayTime>
              <DryWet><Manual Value="0.32" /></DryWet>
            </HybridReverb>
            <Compressor2 Id="4304">
              <IsOn><Manual Value="true" /></IsOn>
              <Sidechain><IsOn Value="true" /><SourceTrack Value="01_Kick_909_Foundation" /></Sidechain>
              <Threshold><Manual Value="-21.0" /></Threshold>
              <Ratio><Manual Value="4.5" /></Ratio>
              <Release><Manual Value="105.0" /></Release>
            </Compressor2>
          </Devices>
        </MidiToAudioDeviceChain>
      `.trim();
    }

    if (archetype === 'pad') {
      return `
        <MidiToAudioDeviceChain>
          <Devices>
            <MidiChord Id="4401">
              <IsOn><Manual Value="true" /></IsOn>
              <Shift1 Value="3" /><Shift2 Value="7" /><Shift3 Value="14" />
            </MidiChord>
            <Drift Id="4402">
              <IsOn><Manual Value="true" /></IsOn>
              <DriftAmount><Manual Value="0.52" /></DriftAmount>
            </Drift>
            <AutoFilter Id="4403">
              <IsOn><Manual Value="true" /></IsOn>
              <FilterType><Manual Value="Lowpass" /></FilterType>
              <Cutoff Id="9401"><Manual Value="840.0" /></Cutoff>
              <Resonance><Manual Value="0.36" /></Resonance>
            </AutoFilter>
            <Echo Id="4404">
              <IsOn><Manual Value="true" /></IsOn>
              <LeftTime><SyncDivision Value="3/16" /></LeftTime>
              <Feedback><Manual Value="0.64" /></Feedback>
              <DryWet><Manual Value="0.52" /></DryWet>
            </Echo>
            <HybridReverb Id="4405">
              <IsOn><Manual Value="true" /></IsOn>
              <DecayTime><Manual Value="4600" /></DecayTime>
              <DryWet><Manual Value="0.48" /></DryWet>
            </HybridReverb>
            <Compressor2 Id="4406">
              <IsOn><Manual Value="true" /></IsOn>
              <Sidechain><IsOn Value="true" /><SourceTrack Value="01_Kick_909_Foundation" /></Sidechain>
              <Threshold><Manual Value="-23.0" /></Threshold>
              <Ratio><Manual Value="5.0" /></Ratio>
              <Release><Manual Value="125.0" /></Release>
            </Compressor2>
          </Devices>
        </MidiToAudioDeviceChain>
      `.trim();
    }

    if (archetype === 'percussion') {
      return `
        <MidiToAudioDeviceChain>
          <Devices>
            <Collision Id="5101">
              <IsOn><Manual Value="true" /></IsOn>
              <MalletStiffness><Manual Value="0.78" /></MalletStiffness>
              <Resonator1><Type Value="Tube" /><Decay Value="0.42" /><Material Value="Metal" /></Resonator1>
            </Collision>
            <DrumBuss Id="5102">
              <IsOn><Manual Value="true" /></IsOn>
              <Drive><Manual Value="0.54" /></Drive>
              <Transients><Manual Value="0.38" /></Transients>
              <Crunch><Manual Value="0.46" /></Crunch>
            </DrumBuss>
            <Erosion Id="5103">
              <IsOn><Manual Value="true" /></IsOn>
              <Mode Value="WideNoise" />
              <Frequency><Manual Value="3400.0" /></Frequency>
              <Amount><Manual Value="0.32" /></Amount>
            </Erosion>
            <Saturator Id="5104">
              <IsOn><Manual Value="true" /></IsOn>
              <Drive><Manual Value="6.5" /></Drive>
              <Type Value="AnalogClip" />
            </Saturator>
            <AutoFilter Id="5105">
              <IsOn><Manual Value="true" /></IsOn>
              <FilterType><Manual Value="Bandpass" /></FilterType>
              <Cutoff Id="9401"><Manual Value="1280.0" /></Cutoff>
              <Resonance><Manual Value="0.35" /></Resonance>
            </AutoFilter>
          </Devices>
        </MidiToAudioDeviceChain>
      `.trim();
    }

    if (archetype === 'synth') {
      return `
        <MidiToAudioDeviceChain>
          <Devices>
            <InstrumentVector Id="6101">
              <IsOn><Manual Value="true" /></IsOn>
              <Oscillator1><WavePosition Value="0.64" /><UnisonVoices Value="4" /></Oscillator1>
            </InstrumentVector>
            <Echo Id="6102">
              <IsOn><Manual Value="true" /></IsOn>
              <LeftTime><SyncDivision Value="3/16" /></LeftTime>
              <RightTime><SyncDivision Value="3/16" /></RightTime>
              <Feedback><Manual Value="${(0.45 + (humanization.macroTransition / 127) * 0.4).toFixed(2)}" /></Feedback>
              <DryWet><Manual Value="0.48" /></DryWet>
            </Echo>
            <AutoPan Id="6103">
              <IsOn><Manual Value="true" /></IsOn>
              <SyncRate Value="3/16" />
              <Amount><Manual Value="0.68" /></Amount>
            </AutoPan>
            <AutoFilter Id="6104">
              <IsOn><Manual Value="true" /></IsOn>
              <FilterType><Manual Value="Lowpass" /></FilterType>
              <Cutoff Id="9401"><Manual Value="${Math.round(620 + humanization.macroTransition * 14)}.0" /></Cutoff>
              <Resonance><Manual Value="0.44" /></Resonance>
            </AutoFilter>
          </Devices>
        </MidiToAudioDeviceChain>
      `.trim();
    }

    return `
      <MidiToAudioDeviceChain>
        <Devices>
          <OriginalSimpler Id="7101">
            <IsOn><Manual Value="true" /></IsOn>
            <SampleRef><FileRef><Name Value="HiHat_909_Open_Raw.wav" /></FileRef></SampleRef>
            <VelToVol><Manual Value="0.88" /></VelToVol>
            <AmpEnvelope><Decay Value="210.0" /><VelocityToDecay Value="0.92" /></AmpEnvelope>
          </OriginalSimpler>
          <Overdrive Id="7102">
            <IsOn><Manual Value="true" /></IsOn>
            <Drive><Manual Value="0.28" /></Drive>
            <Tone><Manual Value="0.72" /></Tone>
          </Overdrive>
          <AutoFilter Id="7103">
            <IsOn><Manual Value="true" /></IsOn>
            <FilterType><Manual Value="Highpass" /></FilterType>
            <Cutoff Id="9401"><Manual Value="580.0" /></Cutoff>
            <Resonance><Manual Value="0.18" /></Resonance>
          </AutoFilter>
        </Devices>
      </MidiToAudioDeviceChain>
    `.trim();
  }

  /**
   * Injects or regenerates a complementary techno layer <MidiTrack> into the Ableton XML tree.
   */
  static injectTechnoLayerIntoXml(
    currentXml: string,
    archetype: TechnoArchetype,
    rootKey: string,
    humanization: HumanizationConfig,
    customOneBarPattern?: { time: number; duration: number; pitch: number; velocity: number }[],
    customClipName?: string,
    seed?: number,
    totalBars = 16
  ): string {
    const effectiveSeed = typeof seed === 'number' ? seed : Math.floor(Math.random() * 10000000) + 1;
    const parser = new DOMParser();
    const sanitizedXml = currentXml.replace(/xmlns(:[a-zA-Z0-9_-]+)?="[^"]*"/g, '');
    const xmlDoc = parser.parseFromString(sanitizedXml, 'application/xml');
    const totalBeats = totalBars * 4;

    let tracksContainer = xmlDoc.querySelector('LiveSet > Tracks') || xmlDoc.querySelector('Tracks');
    if (!tracksContainer) {
      const liveSet = xmlDoc.querySelector('LiveSet') || xmlDoc.documentElement;
      tracksContainer = xmlDoc.createElement('Tracks');
      liveSet.appendChild(tracksContainer);
    }

    const trackNamesByArchetype: Record<TechnoArchetype, { name: string; clipName: string; color: string }> = {
      rumble: {
        name: '02_Sub_Rumble_Operator_AI',
        clipName: customClipName || `Rumble_16th_Roll_v${effectiveSeed % 100}`,
        color: '14',
      },
      percussion: {
        name: '03_Industrial_Perc_3_16_AI',
        clipName: customClipName || `Industrial_Polyrhythm_v${effectiveSeed % 100}`,
        color: '9',
      },
      synth: {
        name: '04_Hypnotic_Wavetable_Stab_AI',
        clipName: customClipName || `Phrygian_Stab_v${effectiveSeed % 100}`,
        color: '42',
      },
      hats: {
        name: '05_Offbeat_909_Hats_Ghost_AI',
        clipName: customClipName || `909_Offbeat_Ghost_v${effectiveSeed % 100}`,
        color: '26',
      },
      acid: {
        name: '06_Acid_303_Resonant_Line_AI',
        clipName: customClipName || `TB303_Acid_Slide_v${effectiveSeed % 100}`,
        color: '56',
      },
      ride: {
        name: '07_Warehouse_909_Ride_AI',
        clipName: customClipName || `Warehouse_Ride_Shimmer_v${effectiveSeed % 100}`,
        color: '18',
      },
      pad: {
        name: '08_Dub_Chord_Atmosphere_Pad_AI',
        clipName: customClipName || `Dub_Chord_Atmosphere_v${effectiveSeed % 100}`,
        color: '45',
      },
      kick: {
        name: '01_Kick_909_Foundation',
        clipName: 'Kick_909_Foundation',
        color: '60',
      },
      existing: {
        name: 'Aux_Track',
        clipName: 'Clip',
        color: '1',
      },
    };

    const meta = trackNamesByArchetype[archetype];

    let targetTrack = Array.from(tracksContainer.querySelectorAll('MidiTrack')).find((el) => {
      const eff = (el.querySelector('Name > EffectiveName')?.getAttribute('Value') || '').toLowerCase();
      if (archetype === 'rumble') {
        return eff.includes('sub') || eff.includes('rumble');
      }
      if (archetype === 'acid') {
        return eff.includes('acid') || eff.includes('303');
      }
      if (archetype === 'ride') {
        return eff.includes('ride') || eff.includes('cymbal');
      }
      if (archetype === 'pad') {
        return eff.includes('pad') || eff.includes('atmo');
      }
      return eff === meta.name.toLowerCase() || eff.includes(archetype);
    });

    if (!targetTrack) {
      targetTrack = xmlDoc.createElement('MidiTrack');
      const nextId = tracksContainer.querySelectorAll('MidiTrack, AudioTrack').length + 1;
      targetTrack.setAttribute('Id', `${nextId}`);
      targetTrack.setAttribute('Data-Parametric-Injected', 'true');

      const nameEl = xmlDoc.createElement('Name');
      const effName = xmlDoc.createElement('EffectiveName');
      effName.setAttribute('Value', meta.name);
      const userName = xmlDoc.createElement('UserName');
      userName.setAttribute('Value', meta.name);
      nameEl.appendChild(effName);
      nameEl.appendChild(userName);
      targetTrack.appendChild(nameEl);

      const colorEl = xmlDoc.createElement('Color');
      colorEl.setAttribute('Value', meta.color);
      targetTrack.appendChild(colorEl);

      const deviceChainEl = xmlDoc.createElement('DeviceChain');
      targetTrack.appendChild(deviceChainEl);
      tracksContainer.appendChild(targetTrack);
    } else {
      targetTrack.setAttribute('Data-Parametric-Injected', 'true');
    }

    const deviceChain =
      targetTrack.querySelector('DeviceChain') || targetTrack.appendChild(xmlDoc.createElement('DeviceChain'));

    const existingMidiToAudio = deviceChain.querySelector('MidiToAudioDeviceChain');
    if (!existingMidiToAudio) {
    const chainXml = TechnoHeuristicEngine.getDeviceChainXmlTemplate(archetype, humanization);
    const chainDoc = new DOMParser().parseFromString(chainXml, 'application/xml');
    deviceChain.insertBefore(xmlDoc.importNode(chainDoc.documentElement, true), deviceChain.firstChild);
    }

    const tempoNode =
      xmlDoc.querySelector('MasterTrack Tempo Manual') ||
      xmlDoc.querySelector('Tempo > Manual') ||
      xmlDoc.querySelector('Tempo');
    const parsedTempo = parseFloat(tempoNode?.getAttribute('Value') || tempoNode?.textContent || '134');
    const effectiveBpm = Number.isFinite(parsedTempo) && parsedTempo >= 40 ? parsedTempo : 134;

    const midiArray = TechnoHeuristicEngine.generateHumanizedMidiArray(
      archetype,
      rootKey,
      humanization,
      customOneBarPattern,
      effectiveSeed,
      totalBars,
      effectiveBpm
    );
    injectMidiClipXmlNode(xmlDoc, targetTrack, meta.clipName, 0, totalBeats, midiArray, 4.0);

    injectAnalogDriftXmlNode(xmlDoc, deviceChain, humanization.lfoRateHz, humanization.lfoDepth);

    const serializer = new XMLSerializer();
    return formatXmlString(serializer.serializeToString(xmlDoc));
  }

  /**
   * Re-seeds jitter and recalculates Gaussian micro-timing shifts and velocities across ALL MIDI tracks in the project,
   * injecting each track's custom or preset VelocityCurveConfig directly into the XML <MidiNoteEvent Velocity="..."> nodes.
   */
  static rehumanizeAllProjectTracks(
    currentXml: string,
    rootKey: string,
    humanization: HumanizationConfig,
    seed: number,
    trackVelocityCurves?: Record<string, VelocityCurveConfig>,
    totalBars = 16,
    bpmOverride?: number
  ): string {
    const doc = new DOMParser().parseFromString(currentXml, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('HUMANIZATION_XML: invalid source');
    const tempo = bpmOverride || Number(doc.querySelector('Tempo > Manual')?.getAttribute('Value')) || 134;
    for (const [trackIndex, track] of Array.from(doc.querySelectorAll('Tracks > MidiTrack')).entries()) {
      const name = track.querySelector('Name > EffectiveName')?.getAttribute('Value') || '';
      const id = track.getAttribute('Data-Parametric-TrackId') || track.getAttribute('Id') || String(trackIndex);
      const curve = trackVelocityCurves?.[id] || trackVelocityCurves?.[name];
      const clips = Array.from(track.querySelectorAll('DeviceChain > MainSequencer > ClipTimeable > ArrangerAutomation > Events > MidiClip'));
      for (const [clipIndex, clip] of clips.entries()) {
        const start = Number(clip.querySelector('CurrentStart')?.getAttribute('Value') || 0);
        const end = Number(clip.querySelector('CurrentEnd')?.getAttribute('Value') || totalBars * 4);
        for (const [index, note] of Array.from(clip.querySelectorAll('MidiNoteEvent')).entries()) {
          const quantized = Number(note.getAttribute('Data-Parametric-QuantizedTime') ?? note.getAttribute('Time') ?? 0);
          const baseVelocity = Number(note.getAttribute('Data-Parametric-BaseVelocity') ?? note.getAttribute('Velocity') ?? 100);
          const noteSeed = seed + trackIndex * 37 + clipIndex * 997 + index * 13;
          const shift = Math.abs(quantized % 1) < 0.000001 ? 0 : gaussianRandom(0, humanization.microTimingMaxShiftBeats * 0.5, noteSeed);
          const sixteenth = Math.round(quantized / 0.25);
          const swing = sixteenth % 2 === 1 ? (humanization.swingStrength || 0) / 100 * MAX_SIXTEENTH_SWING_SHIFT_BEATS : 0;
          const time = quantized + Math.max(-humanization.microTimingMaxShiftBeats, Math.min(humanization.microTimingMaxShiftBeats, shift)) + swing + computeDillaShuffleOffsetBeats(quantized, humanization.shuffleSwing || 0, tempo);
          note.setAttribute('Data-Parametric-QuantizedTime', String(quantized));
          note.setAttribute('Data-Parametric-BaseVelocity', String(baseVelocity));
          note.setAttribute('Time', String(Math.max(start, Math.min(end - 0.000001, time))));
          let velocity = baseVelocity;
          if (curve?.points.length) {
            const phase = ((quantized % 4) + 4) % 4 / 4;
            const position = phase * (curve.points.length - 1);
            const lo = Math.floor(position), hi = Math.min(curve.points.length - 1, lo + 1);
            const value = curve.points[lo] * (1 - position + lo) + curve.points[hi] * (position - lo);
            const target = curve.minVelocity + value * (curve.maxVelocity - curve.minVelocity);
            velocity = velocity * (1 - curve.intensity) + target * curve.intensity;
          }
          velocity *= 1 + (seededRandom(noteSeed) * 2 - 1) * humanization.velocityVariancePct;
          note.setAttribute('Velocity', String(Math.max(1, Math.min(127, Math.round(velocity)))));
        }
      }
    }
    return new XMLSerializer().serializeToString(doc);
  }

}

/**
 * Primary content-preserving Ableton Live (.als) XML string parser (v7.1 P0-001).
 * Retains the original XML for incremental projection and opaque state preservation.
 * Supported-field parsing is not a guarantee of complete native Live fidelity.
 * Automatic section proposals are decoupled into GenerateSectionArrangementProposal.
 */
export function parseAbletonXmlString(
  xmlString: string,
  fileName = 'Untitled_Project.als',
  rawXmlBaseline?: string
): AbletonProjectState {
  return parseAbletonXmlDom(xmlString, fileName, rawXmlBaseline);
}

/**
 * Backward-compatible alias for parseAbletonXmlString.
 */
export const parseAlsXmlString = parseAbletonXmlString;

/**
 * Compiles a project's current tracks, velocity curves, memory locations, and mixer state into valid Ableton XML.
 */
export function compileRehumanizedAlsXml(
  project: AbletonProjectState,
  humanization: HumanizationConfig,
  seed = 101
): string {
  const velocityCurves: Record<string, VelocityCurveConfig> = {};
  project.tracks.forEach((t) => {
    if (t.velocityCurve) {
      velocityCurves[t.id] = t.velocityCurve;
    }
  });
  const rehumanized = TechnoHeuristicEngine.rehumanizeAllProjectTracks(
    project.rawXmlModified,
    project.rootKey,
    humanization,
    seed,
    velocityCurves,
    project.arrangementLengthBars
  );
  return syncLocatorsAndMixerToXml(rehumanized, project.tracks, project.memoryLocations);
}

/**
 * Validates the structural integrity of a compiled Ableton Live .als XML document.
 */
export function validateAlsStructuralIntegrity(
  xmlString: string,
  expectedTrackCount?: number,
  expectedBars?: number
): {
  valid: boolean;
  trackCount: number;
  noteCount: number;
  bars: number;
  errors: string[];
  details: string;
} {
  const errors: string[] = [];
  const parser = new DOMParser();
  const sanitized = xmlString.replace(/xmlns(:[a-zA-Z0-9_-]+)?="[^"]*"/g, '');
  const doc = parser.parseFromString(sanitized, 'application/xml');

  const parseErr = doc.querySelector('parsererror');
  if (parseErr) {
    errors.push(`XML Parse Error: ${parseErr.textContent?.slice(0, 100)}`);
  }
  const liveSet = doc.querySelector('Ableton > LiveSet');
  if (!liveSet) {
    errors.push('Missing <Ableton><LiveSet> root hierarchy');
  }
  const trackEls = Array.from(doc.querySelectorAll('Tracks > MidiTrack, Tracks > AudioTrack'));
  if (typeof expectedTrackCount === 'number' && trackEls.length < expectedTrackCount) {
    errors.push(`Expected at least ${expectedTrackCount} tracks, found ${trackEls.length}`);
  }
  const noteCount = doc.querySelectorAll('MidiNoteEvent').length;
  return {
    valid: errors.length === 0 && trackEls.length > 0,
    trackCount: trackEls.length,
    noteCount,
    bars: expectedBars || 16,
    errors,
    details: errors.join('; '),
  };
}


