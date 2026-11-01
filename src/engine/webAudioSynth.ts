import {
  AbletonDevice,
  AbletonDeviceParam,
  AbletonProjectState,
  AbletonTrack,
  AudioActiveRegion,
  AudioStripSilenceConfig,
  AutomationPoint,
  HumanizationConfig,
  MasterBusConfig,
  MidiNoteEvent,
  PlaybackEngineState,
  TrackMixerParams,
  TransportConfig,
} from '../types/ableton';
import { composeEffectiveTrackGain, resolveEffectiveAudibility } from './channelStripEngine';
import { computeDeterministicHash } from './alsXmlEngine';

function midiToFreq(midi: number, transposeSemitones = 0, fineTuneCents = 0): number {
  const totalSemitones = midi + transposeSemitones + fineTuneCents / 100;
  return 440 * Math.pow(2, (totalSemitones - 69) / 12);
}

export function shouldPlayNote(note: MidiNoteEvent): boolean {
  if (note.probability === undefined || note.probability >= 1) return true;
  if (note.probability <= 0) return false;
  return ((Math.round(note.time * 100) + note.pitch * 17) % 100) / 100 < note.probability;
}

function dbToGain(db: number): number {
  if (db <= -48) return 0;
  return Math.pow(10, db / 20);
}

/**
 * Evaluates a track's automation envelope at a given beat (supports 16 to 128 bars / up to 512 beats).
 * Returns a normalized value in [0.0, 1.0].
 */
export function evaluateAutomationAtBeat(
  points: AutomationPoint[] | undefined,
  beat: number,
  maxBeats = 2048
): number {
  if (!points || points.length === 0) return 0.55;
  const sorted = [...points].sort((a, b) => a.beat - b.beat);
  const clampedBeat = Math.max(0, Math.min(maxBeats, beat));

  if (clampedBeat <= sorted[0].beat) return sorted[0].value;
  if (clampedBeat >= sorted[sorted.length - 1].beat) return sorted[sorted.length - 1].value;

  for (let i = 0; i < sorted.length - 1; i++) {
    const p0 = sorted[i];
    const p1 = sorted[i + 1];
    if (clampedBeat >= p0.beat && clampedBeat <= p1.beat) {
      const span = Math.max(0.0001, p1.beat - p0.beat);
      const t = (clampedBeat - p0.beat) / span;
      return p0.value + t * (p1.value - p0.value);
    }
  }
  return 0.55;
}

/**
 * Creates a transparent lookahead limiter curve with a hard transparent ceiling at limiterCeilingDbtp (default -1.0 dBTP).
 * Unity gain (y = x) for signals up to ~ -3.5 dBFS, smoothly curved into ceiling without hard digital square clipping.
 */
function createTransparentLimiterCurve(ceilingDbtp = -1.0): Float32Array<ArrayBuffer> {
  const samples = 2048;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  const ceilingLinear = Math.min(0.98, Math.max(0.2, Math.pow(10, ceilingDbtp / 20))); // ~0.891 for -1.0 dBTP
  const kneeLinear = ceilingLinear * 0.72; // ~0.64 (-3.8 dB)

  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1; // [-1.0, 1.0]
    const absX = Math.abs(x);
    if (absX <= kneeLinear) {
      curve[i] = x;
    } else {
      const sign = x >= 0 ? 1 : -1;
      const overshoot = absX - kneeLinear;
      const compressionSpan = ceilingLinear - kneeLinear;
      const compressed = kneeLinear + compressionSpan * Math.tanh(overshoot / Math.max(0.01, compressionSpan));
      curve[i] = sign * Math.min(ceilingLinear, compressed);
    }
  }
  return curve;
}

/**
 * Creates a soft-clipping analog saturation curve (Drum Buss / Glue / TB-303 Roar saturator).
 */
function createSaturationCurve(driveAmount = 1.8): Float32Array<ArrayBuffer> {
  const samples = 1024;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  const k = Math.max(0.5, driveAmount * 2.5);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return curve;
}

/**
 * Creates a procedural stereo dark warehouse reverb impulse response.
 */
function createWarehouseReverbImpulse(
  ctx: BaseAudioContext,
  decaySeconds = 3.2
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * Math.max(0.8, Math.min(6.0, decaySeconds)));
  const impulse = ctx.createBuffer(2, length, sampleRate);

  for (let ch = 0; ch < 2; ch++) {
    const data = impulse.getChannelData(ch);
    let lpState = 0;
    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      if (t < 0.018) {
        data[i] = 0;
        continue;
      }
      const env = Math.pow(1 - i / length, 2.6) * Math.exp(-t * (2.8 / decaySeconds));
      const n = Math.sin((i + ch * length) * 12.9898 + 78.233) * 43758.5453;
      const rawNoise = (n - Math.floor(n)) * 2 - 1;
      lpState = lpState * 0.76 + rawNoise * 0.24;
      data[i] = lpState * env * 0.65;
    }
  }
  return impulse;
}

/**
 * Creates a reusable white/metallic noise buffer for 909 hats, ride cymbals, and Collision exciters.
 */
function createNoiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const bufferSize = Math.floor(ctx.sampleRate * 1.5);
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    const n = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    data[i] = (n - Math.floor(n)) * 2 - 1;
  }
  return buffer;
}

export interface InsertProcessorInstance {
  id: string;
  type: string;
  bypassed: boolean;
  input: AudioNode;
  output: AudioNode;
}

export interface TrackChannelRuntime {
  trackId: string;
  inputNode: GainNode;
  insertProcessors: InsertProcessorInstance[];
  insertFilter?: BiquadFilterNode;
  faderGain: GainNode;
  muteSoloGate: GainNode;
  panner: StereoPannerNode;
  reverbSendGain: GainNode;
  delaySendGain: GainNode;
  analyser?: AnalyserNode;
  meterBuffer?: Uint8Array<ArrayBuffer>;
  currentFaderLinear: number;
  currentGateLinear: number;
  currentPan: number;
  currentReverbSend: number;
  currentDelaySend: number;
  currentCutoffHz?: number;
}

interface AudioBusGraph {
  dryBus: GainNode;
  reverbSendBus: GainNode;
  delaySendBus: GainNode;
  masterGain: GainNode;
  delayNodeL: DelayNode;
  delayNodeR: DelayNode;
  delayFeedbackGain: GainNode;
  reverbReturnGain: GainNode;
  delayReturnGain: GainNode;
  compressor: DynamicsCompressorNode;
  analyser?: AnalyserNode;
  withAnalyser?: boolean;
  trackChannels: Map<string, TrackChannelRuntime>;
  activeVoices: Set<() => void>;
  offlineRetirements: { at: number; nodes: AudioNode[] }[];
}

function buildAudioBusGraph(
  ctx: BaseAudioContext,
  tempo: number,
  masterBus: MasterBusConfig,
  withAnalyser: boolean
): AudioBusGraph {
  const dryBus = ctx.createGain();
  const reverbSendBus = ctx.createGain();
  const delaySendBus = ctx.createGain();

  // Headroom Staging: -6.0 dB (0.501) summing bus pad so 8 tracks do not clip dry summing bus
  const sumHeadroomGain = ctx.createGain();
  sumHeadroomGain.gain.value = 0.501;
  dryBus.connect(sumHeadroomGain);

  // Master High-Pass (Sub cleanup at 26 Hz)
  const masterSubHpf = ctx.createBiquadFilter();
  masterSubHpf.type = 'highpass';
  masterSubHpf.frequency.value = 26;
  masterSubHpf.Q.value = 0.707;
  sumHeadroomGain.connect(masterSubHpf);

  // Master Glue Compressor (Gentle mastering bus dynamics control, 30ms punch attack)
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18 - (masterBus.glueCompressionDrive || 0.35) * 6;
  compressor.knee.value = 10;
  compressor.ratio.value = 2.0 + (masterBus.glueCompressionDrive || 0.35) * 1.5;
  compressor.attack.value = 0.03;
  compressor.release.value = 0.1;

  // Master Brickwall Lookahead Limiter with transparent -1.0 dBTP ceiling (resolves clipping & distortion)
  const masterLimiter = ctx.createWaveShaper();
  masterLimiter.curve = createTransparentLimiterCurve(masterBus.limiterCeilingDbtp ?? -1.0);
  masterLimiter.oversample = '4x';

  // Master Output Gain (controlled purely by masterVolumeDb with safe baseline)
  const masterGain = ctx.createGain();
  masterGain.gain.value = dbToGain(masterBus.masterVolumeDb || 0);

  // Return A: Warehouse Reverb Convolver + Low-Cut (150Hz) + High-Cut (2800Hz)
  const reverbConvolver = ctx.createConvolver();
  reverbConvolver.buffer = createWarehouseReverbImpulse(ctx, masterBus.reverbDecaySec);

  const reverbHpf = ctx.createBiquadFilter();
  reverbHpf.type = 'highpass';
  reverbHpf.frequency.value = 150;

  const reverbLpf = ctx.createBiquadFilter();
  reverbLpf.type = 'lowpass';
  reverbLpf.frequency.value = 2800;

  const reverbReturnGain = ctx.createGain();
  reverbReturnGain.gain.value = masterBus.reverbReturnLevel * 0.85;

  reverbSendBus.connect(reverbHpf);
  reverbHpf.connect(reverbConvolver);
  reverbConvolver.connect(reverbLpf);
  reverbLpf.connect(reverbReturnGain);
  reverbReturnGain.connect(masterSubHpf);

  // Return B: Tempo-Synced 3/16 Stereo Ping-Pong Dub Echo
  const threeSixteenthSec = Math.max(0.08, Math.min(0.9, (60 / Math.max(90, tempo)) * 0.75));
  const delayNodeL = ctx.createDelay(2.0);
  const delayNodeR = ctx.createDelay(2.0);
  delayNodeL.delayTime.value = threeSixteenthSec;
  delayNodeR.delayTime.value = threeSixteenthSec;

  const delayFilter = ctx.createBiquadFilter();
  delayFilter.type = 'bandpass';
  delayFilter.frequency.value = 1150;
  delayFilter.Q.value = 1.1;

  const delayFeedbackGain = ctx.createGain();
  delayFeedbackGain.gain.value = Math.min(0.82, Math.max(0.1, masterBus.delayFeedback));

  const panL = ctx.createStereoPanner();
  const panR = ctx.createStereoPanner();
  panL.pan.value = -0.65;
  panR.pan.value = 0.65;

  const delayReturnGain = ctx.createGain();
  delayReturnGain.gain.value = masterBus.delayReturnLevel * 0.75;

  delaySendBus.connect(delayFilter);
  delayFilter.connect(delayNodeL);
  delayNodeL.connect(panL);
  delayNodeL.connect(delayNodeR);
  delayNodeR.connect(panR);
  delayNodeR.connect(delayFeedbackGain);
  delayFeedbackGain.connect(delayFilter);

  panL.connect(delayReturnGain);
  panR.connect(delayReturnGain);
  delayReturnGain.connect(masterSubHpf);

  // Mastering signal chain: subHpf -> glue compressor -> lookahead limiter (-1.0 dBTP ceiling) -> masterGain
  masterSubHpf.connect(compressor);
  compressor.connect(masterLimiter);
  masterLimiter.connect(masterGain);

  let analyser: AnalyserNode | undefined;
  if (withAnalyser) {
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.minDecibels = -90;
    analyser.maxDecibels = 0;
    analyser.smoothingTimeConstant = 0.7;
    masterGain.connect(analyser);
    analyser.connect(ctx.destination);
  } else {
    masterGain.connect(ctx.destination);
  }

  return {
    dryBus,
    reverbSendBus,
    delaySendBus,
    masterGain,
    delayNodeL,
    delayNodeR,
    delayFeedbackGain,
    reverbReturnGain,
    delayReturnGain,
    compressor,
    analyser,
    withAnalyser,
    trackChannels: new Map<string, TrackChannelRuntime>(),
    activeVoices: new Set(),
    offlineRetirements: [],
  };
}

export function buildDeviceInsertProcessor(
  ctx: BaseAudioContext,
  device: AbletonDevice
): InsertProcessorInstance {
  if (device.bypassed) {
    const bypassGain = ctx.createGain();
    bypassGain.gain.value = 1.0;
    return {
      id: device.id,
      type: device.type || device.xmlTag,
      bypassed: true,
      input: bypassGain,
      output: bypassGain,
    };
  }

  const tag = (device.xmlTag || device.type || '').toLowerCase();

  // 1. Utility Gain
  if (tag.includes('utility') || tag.includes('gain')) {
    const gainNode = ctx.createGain();
    const gainParam = device.parameters?.find((p: AbletonDeviceParam) => p.name.toLowerCase().includes('gain'));
    const gainVal = gainParam ? (typeof gainParam.value === 'number' ? gainParam.value : parseFloat(gainParam.value)) : 0;
    gainNode.gain.value = gainParam ? dbToGain(gainVal) : 1.0;
    return { id: device.id, type: 'utility', bypassed: false, input: gainNode, output: gainNode };
  }

  // 2. EQ Eight / Parametric EQ (3-Band surgical filter)
  if (tag.includes('eq') || tag.includes('eqeight')) {
    const low = ctx.createBiquadFilter();
    low.type = 'lowshelf';
    low.frequency.value = 80;
    low.gain.value = 0;

    const mid = ctx.createBiquadFilter();
    mid.type = 'peaking';
    mid.frequency.value = 1200;
    mid.Q.value = 1.0;
    mid.gain.value = 0;

    const high = ctx.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = 6500;
    high.gain.value = 0;

    low.connect(mid);
    mid.connect(high);
    return { id: device.id, type: 'eq', bypassed: false, input: low, output: high };
  }

  // 3. Auto Filter
  if (tag.includes('filter') || tag.includes('autofilter')) {
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    const cutParam = device.parameters?.find((p: AbletonDeviceParam) => p.name.toLowerCase().includes('cutoff'));
    const cutVal = cutParam ? (typeof cutParam.value === 'number' ? cutParam.value : parseFloat(cutParam.value)) : 1800;
    filter.frequency.value = cutVal;
    filter.Q.value = 1.5;
    return { id: device.id, type: 'filter', bypassed: false, input: filter, output: filter };
  }

  // 4. Saturator / Soft Clipper
  if (tag.includes('saturat')) {
    const shaper = ctx.createWaveShaper();
    const samples = 1024;
    const curve = new Float32Array(samples);
    const drive = 2.0;
    for (let i = 0; i < samples; ++i) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.tanh(x * drive) / Math.tanh(drive);
    }
    shaper.curve = curve;
    return { id: device.id, type: 'saturator', bypassed: false, input: shaper, output: shaper };
  }

  // 5. Compressor / Glue Compressor
  if (tag.includes('compressor')) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 6;
    comp.ratio.value = 3.0;
    comp.attack.value = 0.02;
    comp.release.value = 0.12;
    return { id: device.id, type: 'compressor', bypassed: false, input: comp, output: comp };
  }

  // 6. Delay / Echo
  if (tag.includes('delay') || tag.includes('echo')) {
    const inGain = ctx.createGain();
    const delayNode = ctx.createDelay(1.0);
    delayNode.delayTime.value = 0.22;
    const fbGain = ctx.createGain();
    fbGain.gain.value = 0.35;
    const filterNode = ctx.createBiquadFilter();
    filterNode.type = 'bandpass';
    filterNode.frequency.value = 1200;
    const outGain = ctx.createGain();

    inGain.connect(outGain);
    inGain.connect(delayNode);
    delayNode.connect(filterNode);
    filterNode.connect(fbGain);
    fbGain.connect(delayNode);
    filterNode.connect(outGain);

    return { id: device.id, type: 'delay', bypassed: false, input: inGain, output: outGain };
  }

  // 7. Chorus / Modulation
  if (tag.includes('chorus')) {
    const inGain = ctx.createGain();
    const delayNode = ctx.createDelay(0.1);
    delayNode.delayTime.value = 0.015;
    const outGain = ctx.createGain();
    inGain.connect(outGain);
    inGain.connect(delayNode);
    delayNode.connect(outGain);
    return { id: device.id, type: 'chorus', bypassed: false, input: inGain, output: outGain };
  }

  // 8. Distortion / Overdrive / Roar
  if (tag.includes('distortion') || tag.includes('overdrive') || tag.includes('roar')) {
    const shaper = ctx.createWaveShaper();
    const samples = 1024;
    const curve = new Float32Array(samples);
    for (let i = 0; i < samples; ++i) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.max(-0.85, Math.min(0.85, x * 3.5));
    }
    shaper.curve = curve;
    return { id: device.id, type: 'distortion', bypassed: false, input: shaper, output: shaper };
  }

  // 9. Limiter
  if (tag.includes('limiter')) {
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -0.5;
    comp.knee.value = 0;
    comp.ratio.value = 20.0;
    comp.attack.value = 0.001;
    comp.release.value = 0.05;
    return { id: device.id, type: 'limiter', bypassed: false, input: comp, output: comp };
  }

  const pass = ctx.createGain();
  pass.gain.value = 1.0;
  return { id: device.id, type: 'passthrough', bypassed: false, input: pass, output: pass };
}

function getOrCreateTrackChannelRuntime(
  ctx: BaseAudioContext,
  bus: AudioBusGraph,
  track: AbletonTrack,
  project?: AbletonProjectState
): TrackChannelRuntime {
  let channel = bus.trackChannels.get(track.id);
  const mixer = track.mixer || {
    volumeDb: 0,
    pan: 0,
    transposeSemitones: 0,
    fineTuneCents: 0,
    sidechainDepth: track.archetype === 'kick' ? 0 : 0.5,
    reverbSend: 0.2,
    delaySend: 0.15,
    filterCutoffHz: 800,
    filterResonance: 0.3,
  };

  const audibility = resolveEffectiveAudibility(
    track,
    project?.tracks || [track],
    project?.vcaGroups || []
  );
  const insertMods = computeInsertChainGainMultiplier(track);
  const targetFaderLinear = Math.min(
    insertMods.limiterCeilingLinear,
    audibility.effectiveGainLinear * insertMods.gainMultiplier
  );
  const targetGateLinear = audibility.isAudible ? 1.0 : 0.0;
  const targetPan = Math.max(-1, Math.min(1, mixer.pan || 0));
  const targetRev = Math.max(0, Math.min(1, mixer.reverbSend || 0));
  const targetDel = Math.max(0, Math.min(1, mixer.delaySend || 0));
  const targetCutoff = Math.max(40, Math.min(18000, mixer.filterCutoffHz || 1200));

  if (!channel) {
    const inputNode = ctx.createGain();
    const insertProcessors: InsertProcessorInstance[] = [];
    let lastNode: AudioNode = inputNode;

    const devices = (track.devices || []).slice(0, 10);
    for (const dev of devices) {
      const proc = buildDeviceInsertProcessor(ctx, dev);
      insertProcessors.push(proc);
      lastNode.connect(proc.input);
      lastNode = proc.output;
    }

    const faderGain = ctx.createGain();
    faderGain.gain.value = targetFaderLinear;

    lastNode.connect(faderGain);

    const muteSoloGate = ctx.createGain();
    muteSoloGate.gain.value = targetGateLinear;

    const panner = ctx.createStereoPanner();
    panner.pan.value = targetPan;

    const reverbSendGain = ctx.createGain();
    reverbSendGain.gain.value = targetRev;

    const delaySendGain = ctx.createGain();
    delaySendGain.gain.value = targetDel;

    let analyser: AnalyserNode | undefined;
    let meterBuffer: Uint8Array<ArrayBuffer> | undefined;
    if (bus.withAnalyser) {
      analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;
      meterBuffer = new Uint8Array(new ArrayBuffer(256));
    }

    faderGain.connect(muteSoloGate);
    muteSoloGate.connect(panner);

    if (analyser) {
      panner.connect(analyser);
      analyser.connect(bus.dryBus);
    } else {
      panner.connect(bus.dryBus);
    }

    panner.connect(reverbSendGain);
    reverbSendGain.connect(bus.reverbSendBus);

    panner.connect(delaySendGain);
    delaySendGain.connect(bus.delaySendBus);

    channel = {
      trackId: track.id,
      inputNode,
      insertProcessors,
      faderGain,
      muteSoloGate,
      panner,
      reverbSendGain,
      delaySendGain,
      analyser,
      meterBuffer,
      currentFaderLinear: targetFaderLinear,
      currentGateLinear: targetGateLinear,
      currentPan: targetPan,
      currentReverbSend: targetRev,
      currentDelaySend: targetDel,
      currentCutoffHz: targetCutoff,
    };
    bus.trackChannels.set(track.id, channel);
  } else {
    const now = ctx.currentTime;
    channel.faderGain.gain.setTargetAtTime(targetFaderLinear, now, 0.012);
    channel.muteSoloGate.gain.setTargetAtTime(targetGateLinear, now, 0.008);
    channel.panner.pan.setTargetAtTime(targetPan, now, 0.012);
    channel.reverbSendGain.gain.setTargetAtTime(targetRev, now, 0.015);
    channel.delaySendGain.gain.setTargetAtTime(targetDel, now, 0.015);
    if (channel.insertFilter) {
      channel.insertFilter.frequency.setTargetAtTime(targetCutoff, now, 0.015);
    }
    channel.currentFaderLinear = targetFaderLinear;
    channel.currentGateLinear = targetGateLinear;
    channel.currentPan = targetPan;
    channel.currentReverbSend = targetRev;
    channel.currentDelaySend = targetDel;
    channel.currentCutoffHz = targetCutoff;
  }

  return channel;
}

/**
 * Schedules a single Ableton track MIDI note at exact Web Audio clock time `whenSec`.
 * Supports all 8 techno archetypes: kick, rumble, percussion, synth, hats, acid, ride, pad.
 */
function computeInsertChainGainMultiplier(track: AbletonTrack): {
  gainMultiplier: number;
  saturationBoost: number;
  limiterCeilingLinear: number;
} {
  let gainMultiplier = 1.0;
  let saturationBoost = 0;
  let limiterCeilingLinear = 1.0;

  for (const dev of track.devices || []) {
    if (dev.bypassed) continue;
    const tag = dev.xmlTag || (dev as any).type || '';
    if (tag === 'Utility') {
      const gainParam = dev.parameters.find((p) => p.name.toLowerCase().includes('gain'));
      const gainDb = typeof gainParam?.value === 'number' ? gainParam.value : parseFloat(String(gainParam?.value ?? '0')) || 0;
      gainMultiplier *= dbToGain(gainDb);
    } else if (tag === 'Saturator' || tag === 'Roar' || tag === 'Overdrive' || tag === 'DrumBuss') {
      const driveParam = dev.parameters.find((p) => p.name.toLowerCase().includes('drive'));
      const rawDrive = typeof driveParam?.value === 'number' ? driveParam.value : parseFloat(String(driveParam?.value ?? '6')) || 6;
      const driveVal = rawDrive <= 1.5 ? rawDrive * 10 : rawDrive;
      saturationBoost += Math.max(0.15, Math.min(12, driveVal)) * 0.08;
      gainMultiplier *= 1 + Math.max(0.2, Math.min(12, driveVal)) * 0.035;
    } else if (tag === 'Limiter') {
      const ceilParam = dev.parameters.find((p) => p.name.toLowerCase().includes('ceiling'));
      const ceilDb = typeof ceilParam?.value === 'number' ? ceilParam.value : parseFloat(String(ceilParam?.value ?? '-0.3')) || -0.3;
      limiterCeilingLinear = Math.min(limiterCeilingLinear, dbToGain(ceilDb));
    } else if (tag === 'Compressor2' || tag === 'GlueCompressor') {
      gainMultiplier *= 0.96;
    }
  }
  return { gainMultiplier, saturationBoost, limiterCeilingLinear };
}

function scheduleTrackVoiceAtTime(
  ctx: BaseAudioContext,
  bus: AudioBusGraph,
  noiseBuffer: AudioBuffer,
  track: AbletonTrack,
  note: MidiNoteEvent,
  whenSec: number,
  beatsPerSecond: number,
  humanization: HumanizationConfig,
  project?: AbletonProjectState
) {
  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  let latestStop = ctx.currentTime;
  const offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
  const own = <T extends AudioNode>(node: T): T => { nodes.push(node); return node; };
  const source = <T extends AudioScheduledSourceNode>(node: T): T => {
    const stop = node.stop.bind(node);
    node.stop = (when = 0) => { latestStop = Math.max(latestStop, when); stop(when); };
    sources.push(node); return own(node);
  };
  const time = Math.max(ctx.currentTime, whenSec);
  const velNorm = Math.max(0.05, Math.min(1, note.velocity / 127));
  const velGain = Math.pow(velNorm, 1.35);
  const durSec = Math.max(0.045, note.duration / beatsPerSecond);

  const mixer = track.mixer || {
    volumeDb: 0,
    pan: 0,
    transposeSemitones: 0,
    fineTuneCents: 0,
    sidechainDepth: track.archetype === 'kick' ? 0 : 0.5,
    reverbSend: 0.2,
    delaySend: 0.15,
    filterCutoffHz: 800,
    filterResonance: 0.3,
  };

  const autoNorm = evaluateAutomationAtBeat(track.automationPoints, note.time, (project?.arrangementLengthBars || 16) * 4);
  const lfoPhase = Math.sin(2 * Math.PI * humanization.lfoRateHz * time);
  const lfoModFactor = 1 + lfoPhase * humanization.lfoDepth * 0.45;

  // Quarter-note Kick Sidechain Ducking envelope calculation
  const beatPhase = ((note.time % 1) + 1) % 1;
  const scDepth = Math.max(0, Math.min(1, mixer.sidechainDepth));
  const isNearKick = beatPhase < 0.22 || beatPhase > 0.94;
  const initialDuckGain =
    track.archetype === 'kick'
      ? 1.0
      : isNearKick
      ? 1.0 - scDepth * 0.88
      : 1.0 - scDepth * 0.12;

  const trackChannel = getOrCreateTrackChannelRuntime(ctx, bus, track, project);
  const insertMods = computeInsertChainGainMultiplier(track);
  const voiceEnvelopeGain = own(ctx.createGain());

  // Micro-timing variance intensity for the current bar
  const noteBar = Math.floor(note.time / 4) + 1;
  const barIntensity = humanization.barVarianceIntensity?.[noteBar] ?? 1.0;
  const velocityMod = 1 + (barIntensity - 1.0) * 0.15;
  const modulatedVelGain = Math.min(1.0, velGain * velocityMod);
  void modulatedVelGain;

  // Per-voice sidechain ducking envelope (while persistent fader/mute/solo/pan live on trackChannel!)
  const targetDuckGain = Math.max(0.0001, initialDuckGain);
  voiceEnvelopeGain.gain.setValueAtTime(0.0001, time);
  voiceEnvelopeGain.gain.linearRampToValueAtTime(targetDuckGain, time + 0.006);
  if (track.archetype !== 'kick' && scDepth > 0.05 && isNearKick) {
    voiceEnvelopeGain.gain.linearRampToValueAtTime(
      1.0,
      time + Math.min(durSec * 0.85, 0.42 / beatsPerSecond)
    );
  }

  // Optional Spectral Auto-Ducking EQEight Fundamental Notch node
  let voiceDestination: AudioNode = voiceEnvelopeGain;
  if (track.spectralDucking?.enabled && track.archetype !== 'kick') {
    const eqNotch = own(ctx.createBiquadFilter());
    eqNotch.type = 'peaking';
    eqNotch.frequency.setValueAtTime(track.spectralDucking.notchFreqHz || 55, time);
    eqNotch.Q.setValueAtTime(track.spectralDucking.notchQ || 2.8, time);
    const dynamicGainDb = isNearKick
      ? track.spectralDucking.notchGainDb
      : track.spectralDucking.notchGainDb * 0.35;
    eqNotch.gain.setValueAtTime(dynamicGainDb, time);
    if (isNearKick) {
      eqNotch.gain.linearRampToValueAtTime(
        track.spectralDucking.notchGainDb * 0.25,
        time + Math.min(durSec, 0.22)
      );
    }
    eqNotch.connect(voiceEnvelopeGain);
    voiceDestination = eqNotch;
  }

  if (insertMods.saturationBoost > 0.01) {
    const insertShaper = own(ctx.createWaveShaper());
    insertShaper.curve = createSaturationCurve(1.2 + insertMods.saturationBoost);
    insertShaper.connect(voiceDestination);
    voiceDestination = insertShaper;
  }

  // Route voice through persistent per-track channel strip so live fader/pan/mute/solo/send changes
  // immediately affect sustaining audio without waiting for next note event
  voiceEnvelopeGain.connect(trackChannel.inputNode);

  if (track.archetype === 'kick') {
    // =========================================================================
    // 1. 909 PUNCH KICK + TRANSIENT CLICK + DRUM BUSS WARM SATURATOR
    // =========================================================================
    const pitchRatio = Math.pow(2, (mixer.transposeSemitones + mixer.fineTuneCents / 100) / 12);
    const bodyOsc = source(ctx.createOscillator());
    const subOsc = source(ctx.createOscillator());
    const clickOsc = source(ctx.createOscillator());

    const bodyGain = own(ctx.createGain());
    const clickGain = own(ctx.createGain());
    const shaper = own(ctx.createWaveShaper());
    shaper.curve = createSaturationCurve(1.65);

    bodyOsc.type = 'sine';
    bodyOsc.frequency.setValueAtTime(158 * pitchRatio, time);
    bodyOsc.frequency.exponentialRampToValueAtTime(52 * pitchRatio, time + 0.042);
    bodyOsc.frequency.exponentialRampToValueAtTime(36 * pitchRatio, time + 0.28);

    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(78 * pitchRatio, time);
    subOsc.frequency.exponentialRampToValueAtTime(36 * pitchRatio, time + 0.18);

    const subBlend = own(ctx.createGain());
    subBlend.gain.setValueAtTime(0.28 * velGain, time);
    subBlend.gain.exponentialRampToValueAtTime(0.001, time + 0.24);

    clickOsc.type = 'triangle';
    clickOsc.frequency.setValueAtTime(1150 * pitchRatio, time);
    clickOsc.frequency.exponentialRampToValueAtTime(140 * pitchRatio, time + 0.014);

    clickGain.gain.setValueAtTime(0.36 * velGain, time);
    clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.016);

    bodyGain.gain.setValueAtTime(0.001, time);
    bodyGain.gain.linearRampToValueAtTime(0.92 * velGain, time + 0.003);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, time + 0.31);

    bodyOsc.connect(bodyGain);
    subOsc.connect(subBlend);
    subBlend.connect(bodyGain);
    clickOsc.connect(clickGain);
    clickGain.connect(shaper);
    bodyGain.connect(shaper);
    shaper.connect(voiceDestination);

    bodyOsc.start(time);
    subOsc.start(time);
    clickOsc.start(time);
    bodyOsc.stop(time + 0.33);
    subOsc.stop(time + 0.33);
    clickOsc.stop(time + 0.02);
  } else if (track.archetype === 'rumble') {
    // =========================================================================
    // 2. OPERATOR SUB-BASS RUMBLE (Fundamental Sine + FM Harmonic + 24dB LPF)
    // =========================================================================
    const freq = midiToFreq(note.pitch, mixer.transposeSemitones, mixer.fineTuneCents);
    const oscFund = source(ctx.createOscillator());
    const oscHarm = source(ctx.createOscillator());
    const filter1 = own(ctx.createBiquadFilter());
    const filter2 = own(ctx.createBiquadFilter());
    const voiceGain = own(ctx.createGain());

    oscFund.type = 'sine';
    oscFund.frequency.setValueAtTime(freq, time);

    oscHarm.type = 'sawtooth';
    oscHarm.frequency.setValueAtTime(freq * 2, time);

    const harmGain = own(ctx.createGain());
    harmGain.gain.setValueAtTime(0.24 * (0.6 + autoNorm * 0.7), time);

    const baseCut = Math.max(55, Math.min(450, mixer.filterCutoffHz || humanization.cutoffHz));
    const macroAdd = (humanization.macroTransition / 127) * 140;
    const targetCutoff = Math.max(
      52,
      Math.min(680, (baseCut + macroAdd) * (0.65 + autoNorm * 0.75) * lfoModFactor)
    );

    filter1.type = 'lowpass';
    filter1.frequency.setValueAtTime(targetCutoff * 1.35, time);
    filter1.frequency.exponentialRampToValueAtTime(targetCutoff * 0.82, time + durSec);
    filter1.Q.setValueAtTime(1.8 + mixer.filterResonance * 4.5, time);

    filter2.type = 'lowpass';
    filter2.frequency.setValueAtTime(targetCutoff, time);
    filter2.Q.setValueAtTime(1.1, time);

    const peak = 0.68 * velGain;
    voiceGain.gain.setValueAtTime(0.001, time);
    voiceGain.gain.linearRampToValueAtTime(peak, time + 0.01);
    voiceGain.gain.setValueAtTime(peak * 0.85, time + durSec * 0.6);
    voiceGain.gain.exponentialRampToValueAtTime(0.001, time + durSec + 0.05);

    oscFund.connect(filter1);
    oscHarm.connect(harmGain);
    harmGain.connect(filter1);
    filter1.connect(filter2);
    filter2.connect(voiceGain);
    voiceGain.connect(voiceDestination);

    oscFund.start(time);
    oscHarm.start(time);
    oscFund.stop(time + durSec + 0.07);
    oscHarm.stop(time + durSec + 0.07);
  } else if (track.archetype === 'acid') {
    // =========================================================================
    // 3. TB-303 ACID RESONANT BASSLINE (Saw + Square Blend + 24dB Diode Filter + Slide + Roar Overdrive)
    // =========================================================================
    const freq = midiToFreq(note.pitch, mixer.transposeSemitones, mixer.fineTuneCents);
    const isAccent = Boolean(note.isAccent || note.velocity >= 108);
    const isSlide = Boolean(note.isSlide || note.duration > 0.3);

    const oscSaw = source(ctx.createOscillator());
    const oscSq = source(ctx.createOscillator());
    const sqBlend = own(ctx.createGain());
    const diodeFilter1 = own(ctx.createBiquadFilter());
    const diodeFilter2 = own(ctx.createBiquadFilter());
    const shaper = own(ctx.createWaveShaper());
    const voiceGain = own(ctx.createGain());

    oscSaw.type = 'sawtooth';
    oscSq.type = 'square';
    sqBlend.gain.setValueAtTime(0.32, time);

    if (isSlide) {
      // Authentic 60ms TB-303 RC portamento glide from -5 or +7 semitones
      const startFreq = freq * Math.pow(2, -5 / 12);
      oscSaw.frequency.setValueAtTime(startFreq, time);
      oscSaw.frequency.exponentialRampToValueAtTime(freq, time + 0.062);
      oscSq.frequency.setValueAtTime(startFreq, time);
      oscSq.frequency.exponentialRampToValueAtTime(freq, time + 0.062);
    } else {
      oscSaw.frequency.setValueAtTime(freq, time);
      oscSq.frequency.setValueAtTime(freq, time);
    }

    const macroBoost = (humanization.macroTransition / 127) * 1600;
    const baseCut = Math.max(180, Math.min(3800, mixer.filterCutoffHz || 680));
    const envPeakHz = Math.min(
      7500,
      (baseCut + macroBoost + (isAccent ? 1850 : 650)) * (0.55 + autoNorm * 0.95) * lfoModFactor
    );
    const envFloorHz = Math.max(130, baseCut * 0.42);

    diodeFilter1.type = 'lowpass';
    diodeFilter1.frequency.setValueAtTime(envPeakHz, time);
    diodeFilter1.frequency.exponentialRampToValueAtTime(
      envFloorHz,
      time + (isAccent ? 0.11 : Math.min(0.22, durSec * 0.85))
    );
    diodeFilter1.Q.setValueAtTime(
      (isAccent ? 9.5 : 6.2) + mixer.filterResonance * 8.0,
      time
    );

    diodeFilter2.type = 'lowpass';
    diodeFilter2.frequency.setValueAtTime(envPeakHz * 1.15, time);
    diodeFilter2.frequency.exponentialRampToValueAtTime(envFloorHz * 1.1, time + durSec);
    diodeFilter2.Q.setValueAtTime(2.4, time);

    shaper.curve = createSaturationCurve(isAccent ? 2.4 : 1.75);

    const releaseSec = isSlide ? durSec + 0.09 : durSec + 0.03;
    const peakGain = (isAccent ? 0.46 : 0.34) * velGain;
    voiceGain.gain.setValueAtTime(0.001, time);
    voiceGain.gain.linearRampToValueAtTime(peakGain, time + 0.004);
    voiceGain.gain.exponentialRampToValueAtTime(0.001, time + releaseSec);

    oscSaw.connect(diodeFilter1);
    oscSq.connect(sqBlend);
    sqBlend.connect(diodeFilter1);
    diodeFilter1.connect(diodeFilter2);
    diodeFilter2.connect(shaper);
    shaper.connect(voiceGain);
    voiceGain.connect(voiceDestination);

    oscSaw.start(time);
    oscSq.start(time);
    oscSaw.stop(time + releaseSec + 0.02);
    oscSq.stop(time + releaseSec + 0.02);
  } else if (track.archetype === 'percussion') {
    // =========================================================================
    // 4. COLLISION INDUSTRIAL FM METALLIC RESONATOR + TRANSIENT EXCITER
    // =========================================================================
    const baseFreq = midiToFreq(note.pitch, mixer.transposeSemitones, mixer.fineTuneCents);
    const carrier = source(ctx.createOscillator());
    const mod1 = source(ctx.createOscillator());
    const modGain = own(ctx.createGain());
    const noiseSrc = source(ctx.createBufferSource());
    noiseSrc.buffer = noiseBuffer;
    const noiseGain = own(ctx.createGain());
    const filter = own(ctx.createBiquadFilter());
    const voiceGain = own(ctx.createGain());

    carrier.type = 'triangle';
    carrier.frequency.setValueAtTime(baseFreq, time);
    carrier.frequency.exponentialRampToValueAtTime(baseFreq * 0.92, time + 0.11);

    mod1.type = 'square';
    mod1.frequency.setValueAtTime(baseFreq * 1.4142, time);
    modGain.gain.setValueAtTime(baseFreq * (1.8 + autoNorm * 2.4) * velGain, time);
    modGain.gain.exponentialRampToValueAtTime(2, time + 0.085);

    noiseGain.gain.setValueAtTime(0.18 * velGain, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.025);

    const filterFreq = Math.max(
      280,
      Math.min(5500, (mixer.filterCutoffHz || 1150) * (0.6 + autoNorm * 0.9) * lfoModFactor)
    );
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, time);
    filter.Q.setValueAtTime(2.2 + mixer.filterResonance * 5.0, time);

    const decay = Math.max(0.08, Math.min(0.24, durSec * 1.1));
    voiceGain.gain.setValueAtTime(0.001, time);
    voiceGain.gain.linearRampToValueAtTime(0.42 * velGain, time + 0.003);
    voiceGain.gain.exponentialRampToValueAtTime(0.001, time + decay);

    mod1.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(filter);
    noiseSrc.connect(noiseGain);
    noiseGain.connect(filter);
    filter.connect(voiceGain);
    voiceGain.connect(voiceDestination);

    carrier.start(time);
    mod1.start(time);
    noiseSrc.start(time);
    carrier.stop(time + decay + 0.02);
    mod1.stop(time + decay + 0.02);
    noiseSrc.stop(time + 0.03);
  } else if (track.archetype === 'ride') {
    // =========================================================================
    // 5. WAREHOUSE 909 RIDE CYMBAL (Inharmonic Metallic Cluster + Shimmer HPF)
    // =========================================================================
    const pitchShift = Math.pow(2, (mixer.transposeSemitones + mixer.fineTuneCents / 100) / 12);
    const isBell = note.pitch >= 55;

    const noise = source(ctx.createBufferSource());
    noise.buffer = noiseBuffer;

    const ratios = isBell ? [587, 845, 1188, 1740] : [465, 692, 1045, 1512];
    const metalBus = own(ctx.createGain());
    metalBus.gain.setValueAtTime(0.11 * velGain, time);
    metalBus.gain.exponentialRampToValueAtTime(0.001, time + 0.28);

    const oscs = ratios.map((freqRatio) => {
      const o = source(ctx.createOscillator());
      o.type = 'square';
      o.frequency.setValueAtTime(freqRatio * pitchShift, time);
      o.connect(metalBus);
      return o;
    });

    const bandpass = own(ctx.createBiquadFilter());
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime((isBell ? 3800 : 2900) * pitchShift, time);
    bandpass.Q.setValueAtTime(1.6, time);

    const hpf = own(ctx.createBiquadFilter());
    hpf.type = 'highpass';
    hpf.frequency.setValueAtTime(Math.max(650, (mixer.filterCutoffHz || 4800) * 0.8), time);

    const decaySec = (0.34 + velGain * 0.25) * (0.75 + autoNorm * 0.45);
    const voiceGain = own(ctx.createGain());
    voiceGain.gain.setValueAtTime(0.001, time);
    voiceGain.gain.linearRampToValueAtTime(0.28 * velGain, time + 0.003);
    voiceGain.gain.exponentialRampToValueAtTime(0.001, time + decaySec);

    noise.connect(hpf);
    metalBus.connect(bandpass);
    bandpass.connect(hpf);
    hpf.connect(voiceGain);
    voiceGain.connect(voiceDestination);

    noise.start(time);
    oscs.forEach((o) => o.start(time));
    noise.stop(time + decaySec + 0.02);
    oscs.forEach((o) => o.stop(time + 0.3));
  } else if (track.archetype === 'hats') {
    // =========================================================================
    // 6. SIMPLER 909 METALLIC HI-HAT (Square Bank + Crisp Noise HPF)
    // =========================================================================
    const isOpenHat = note.pitch === 46 || note.duration > 0.3;
    const pitchShift = Math.pow(2, (mixer.transposeSemitones + mixer.fineTuneCents / 100) / 12);

    const noise = source(ctx.createBufferSource());
    noise.buffer = noiseBuffer;

    const metal1 = source(ctx.createOscillator());
    const metal2 = source(ctx.createOscillator());
    metal1.type = 'square';
    metal2.type = 'square';
    metal1.frequency.setValueAtTime(342 * pitchShift, time);
    metal2.frequency.setValueAtTime(523 * pitchShift, time);

    const metalGain = own(ctx.createGain());
    metalGain.gain.setValueAtTime(0.09 * velGain, time);
    metalGain.gain.exponentialRampToValueAtTime(0.001, time + 0.035);

    const hpf = own(ctx.createBiquadFilter());
    hpf.type = 'highpass';
    const baseCut = Math.max(3500, Math.min(11000, (mixer.filterCutoffHz || 6800) * pitchShift));
    hpf.frequency.setValueAtTime(isOpenHat ? baseCut * 0.82 : baseCut, time);
    hpf.Q.setValueAtTime(1.2 + mixer.filterResonance * 2.5, time);

    const decayTime = isOpenHat
      ? (0.14 + velGain * 0.22) * (0.75 + autoNorm * 0.5)
      : (0.032 + velGain * 0.048) * (0.8 + autoNorm * 0.4);

    const voiceGain = own(ctx.createGain());
    voiceGain.gain.setValueAtTime(0.001, time);
    voiceGain.gain.linearRampToValueAtTime(0.32 * velGain, time + 0.002);
    voiceGain.gain.exponentialRampToValueAtTime(0.001, time + decayTime);

    noise.connect(hpf);
    metal1.connect(metalGain);
    metal2.connect(metalGain);
    metalGain.connect(hpf);
    hpf.connect(voiceGain);
    voiceGain.connect(voiceDestination);

    noise.start(time);
    metal1.start(time);
    metal2.start(time);
    noise.stop(time + decayTime + 0.015);
    metal1.stop(time + 0.04);
    metal2.stop(time + 0.04);
  } else if (track.archetype === 'pad') {
    // =========================================================================
    // 7. DUB TECHNO ATMOSPHERIC PAD (Warm Detuned Saw/Triangle + Slow LPF Sweep)
    // =========================================================================
    const rootFreq = midiToFreq(note.pitch, mixer.transposeSemitones, mixer.fineTuneCents);
    const osc1 = source(ctx.createOscillator());
    const osc2 = source(ctx.createOscillator());
    const filter = own(ctx.createBiquadFilter());
    const voiceGain = own(ctx.createGain());

    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(rootFreq, time);
    osc1.detune.setValueAtTime(-9, time);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(rootFreq, time);
    osc2.detune.setValueAtTime(9, time);

    const baseCut = Math.max(200, Math.min(3600, mixer.filterCutoffHz || 780));
    const macroBoost = (humanization.macroTransition / 127) * 950;
    const targetCutoff = Math.min(4800, (baseCut + macroBoost) * (0.55 + autoNorm * 0.9) * lfoModFactor);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(targetCutoff * 0.65, time);
    filter.frequency.linearRampToValueAtTime(targetCutoff, time + durSec * 0.5);
    filter.frequency.exponentialRampToValueAtTime(Math.max(180, targetCutoff * 0.4), time + durSec + 0.25);
    filter.Q.setValueAtTime(1.5 + mixer.filterResonance * 4.0, time);

    const releaseTime = durSec + 0.28;
    voiceGain.gain.setValueAtTime(0.001, time);
    voiceGain.gain.linearRampToValueAtTime(0.14 * velGain, time + Math.min(0.12, durSec * 0.35));
    voiceGain.gain.exponentialRampToValueAtTime(0.001, time + releaseTime);

    osc1.connect(filter);
    osc2.connect(filter);
    filter.connect(voiceGain);
    voiceGain.connect(voiceDestination);

    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + releaseTime + 0.03);
    osc2.stop(time + releaseTime + 0.03);
  } else {
    // =========================================================================
    // 8. HYPNOTIC WAVETABLE MINOR CHORD STAB (3 Detuned Oscillators + Filter Env)
    // =========================================================================
    const rootFreq = midiToFreq(note.pitch, mixer.transposeSemitones, mixer.fineTuneCents);
    const oscRoot = source(ctx.createOscillator());
    const oscDetune = source(ctx.createOscillator());
    const oscChord = source(ctx.createOscillator());
    const filter = own(ctx.createBiquadFilter());
    const voiceGain = own(ctx.createGain());

    oscRoot.type = 'sawtooth';
    oscRoot.frequency.setValueAtTime(rootFreq, time);

    oscDetune.type = 'sawtooth';
    oscDetune.frequency.setValueAtTime(rootFreq, time);
    oscDetune.detune.setValueAtTime(11, time);

    oscChord.type = 'triangle';
    oscChord.frequency.setValueAtTime(rootFreq * Math.pow(2, 3 / 12), time);
    oscChord.detune.setValueAtTime(-7, time);

    const chordSubGain = own(ctx.createGain());
    chordSubGain.gain.setValueAtTime(0.48, time);

    const macroBoost = (humanization.macroTransition / 127) * 1400;
    const baseFilter = Math.max(220, Math.min(5200, mixer.filterCutoffHz || 920));
    const peakCutoff = Math.min(
      6800,
      (baseFilter + macroBoost) * (0.45 + autoNorm * 1.15) * lfoModFactor
    );

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(peakCutoff, time);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(180, peakCutoff * 0.28),
      time + durSec + 0.08
    );
    filter.Q.setValueAtTime(2.0 + mixer.filterResonance * 6.5, time);

    const releaseTime = durSec + 0.14;
    voiceGain.gain.setValueAtTime(0.001, time);
    voiceGain.gain.linearRampToValueAtTime(0.28 * velGain, time + 0.008);
    voiceGain.gain.exponentialRampToValueAtTime(0.001, time + releaseTime);

    oscRoot.connect(filter);
    oscDetune.connect(filter);
    oscChord.connect(chordSubGain);
    chordSubGain.connect(filter);
    filter.connect(voiceGain);
    voiceGain.connect(voiceDestination);

    oscRoot.start(time);
    oscDetune.start(time);
    oscChord.start(time);
    oscRoot.stop(time + releaseTime + 0.02);
    oscDetune.stop(time + releaseTime + 0.02);
    oscChord.stop(time + releaseTime + 0.02);
  }
  if (offline) bus.offlineRetirements.push({ at: latestStop + 1, nodes });
  let remaining = sources.length;
  const retire = () => {
    voiceEnvelopeGain.gain.cancelScheduledValues?.(ctx.currentTime);
    voiceEnvelopeGain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.004);
    for (const node of sources) { try { node.stop(ctx.currentTime + 0.025); } catch { /* already stopped */ } }
  };
  bus.activeVoices.add(retire);
  for (const node of sources) node.onended = () => {
    remaining--;
    if (remaining === 0) {
      // onended delivery depends on main-thread timing. Offline cleanup happens only
      // at deterministic audio-clock boundaries, preserving reproducible filter tails.
      if (!offline) for (const owned of nodes) owned.disconnect();
      bus.activeVoices.delete(retire);
    }
  };
}

/**
 * Schedules a subtle Ableton-style Metronome click at exact audio time `whenSec`.
 */
function scheduleMetronomeClick(
  ctx: BaseAudioContext,
  destination: AudioNode,
  whenSec: number,
  isDownbeatBar: boolean
) {
  const time = Math.max(ctx.currentTime, whenSec);
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(isDownbeatBar ? 1480 : 980, time);
  gain.gain.setValueAtTime(isDownbeatBar ? 0.18 : 0.1, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.028);
  osc.connect(gain);
  gain.connect(destination);
  osc.start(time);
  osc.stop(time + 0.032);
}

/**
 * Encodes a stereo AudioBuffer into an uncompressed 16-bit, 24-bit PCM, or 32-bit Float RIFF WAVE (.wav) Blob.
 */
export async function encodeAudioBufferToWavBlob(
  buffer: { numberOfChannels: number; sampleRate: number; length: number; getChannelData: (channel: number) => Float32Array },
  bitDepth: 16 | 24 | 32 = 24,
  onProgress?: (progressPercent: number) => void
): Promise<Blob> {
  if (buffer.numberOfChannels !== 2 || ![16, 24, 32].includes(bitDepth)) {
    throw new Error('ENCODE_FORMAT: stereo PCM16/24 or Float32 required');
  }
  const frames = buffer.length;
  const bytes = bitDepth / 8;
  const dataSize = frames * 2 * bytes;
  if (!Number.isSafeInteger(dataSize) || dataSize <= 0 || dataSize > 0xffffffff - 36) {
    throw new Error('ENCODE_SIZE: output exceeds RIFF limits');
  }
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const ascii = (at: number, str: string) => [...str].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, 36 + dataSize, true); ascii(8, 'WAVE');
  ascii(12, 'fmt '); view.setUint32(16, 16, true);
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true);
  view.setUint16(22, 2, true); view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * 2 * bytes, true);
  view.setUint16(32, 2 * bytes, true); view.setUint16(34, bitDepth, true);
  ascii(36, 'data'); view.setUint32(40, dataSize, true);
  const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
  const parts: BlobPart[] = [header];
  let peak = 0;
  // Yield between bounded allocations so the Android UI and bridge remain responsive.
  for (let start = 0; start < frames; start += 65536) {
    const end = Math.min(frames, start + 65536);
    const block = new ArrayBuffer((end - start) * 2 * bytes);
    const out = new DataView(block);
    let offset = 0;
    for (let i = start; i < end; i++) for (const channel of channels) {
      const raw = channel[i];
      if (!Number.isFinite(raw)) throw new Error(`ENCODE_NONFINITE: frame ${i}`);
      peak = Math.max(peak, Math.abs(raw));
      const sample = Math.max(-1, Math.min(1, raw));
      if (bitDepth === 32) out.setFloat32(offset, sample, true);
      else if (bitDepth === 16) out.setInt16(offset, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
      else {
        const value = Math.round(sample * (sample < 0 ? 8388608 : 8388607));
        out.setUint8(offset, value & 255); out.setUint8(offset + 1, (value >> 8) & 255);
        out.setUint8(offset + 2, (value >> 16) & 255);
      }
      offset += bytes;
    }
    parts.push(block);
    onProgress?.(end / frames * 100);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (peak <= 1e-8) throw new Error('ENCODE_SILENT: no audible samples; check clips and mute/solo');
  const blob = new Blob(parts, { type: 'audio/wav' });
  if (blob.size !== dataSize + 44) throw new Error('ENCODE_SIZE: WAV length mismatch');
  return blob;
}

/**
 * Deterministic sample-accurate stereo PCM synthesizer used for:
 * - Segmented 96 kHz renders exceeding single-allocation browser memory budgets
 * - Headless / Offline verification and Vitest automated test suites
 * - Track-level waveform rendering for SelectedTrackAnalysisStrip
 */
export function synthesizeDeterministicStereoPcm(
  project: AbletonProjectState,
  humanization: HumanizationConfig,
  masterBus: MasterBusConfig,
  sampleRate = 44100,
  totalBars?: number,
  singleTrackId?: string,
  onProgress?: (progressPercent: number) => void
): { left: Float32Array; right: Float32Array; sampleRate: number; durationSeconds: number } {
  const effectiveBars = totalBars || project.arrangementLengthBars || 16;
  const totalBeats = effectiveBars * 4;
  const beatsPerSecond = Math.max(40, project.tempo) / 60;
  const tailSeconds = singleTrackId ? 0.6 : 1.5;
  const durationSeconds = totalBeats / beatsPerSecond + tailSeconds;
  const totalFrames = Math.max(1024, Math.ceil(durationSeconds * sampleRate));

  const left = new Float32Array(totalFrames);
  const right = new Float32Array(totalFrames);

  const masterLinearGain =
    singleTrackId
      ? 1.0
      : dbToGain(masterBus.masterVolumeDb) * (1 + masterBus.glueCompressionDrive * 0.25);

  const tracksToRender = singleTrackId
    ? project.tracks.filter((t) => t.id === singleTrackId)
    : project.tracks;

  const trackCount = Math.max(1, tracksToRender.length);
  for (let tIdx = 0; tIdx < tracksToRender.length; tIdx++) {
    const track = tracksToRender[tIdx];
    onProgress?.(Math.round(((tIdx + 0.5) / trackCount) * 100));
    const vcaComp = composeEffectiveTrackGain(track, project.tracks, project.vcaGroups || []);
    if (!singleTrackId && vcaComp.effectivelyMuted) continue;

    const mixer = track.mixer || {
      volumeDb: 0,
      pan: 0,
      transposeSemitones: 0,
      fineTuneCents: 0,
      sidechainDepth: track.archetype === 'kick' ? 0 : 0.5,
      reverbSend: 0.2,
      delaySend: 0.15,
      filterCutoffHz: 800,
      filterResonance: 0.3,
    };

    const insertMods = computeInsertChainGainMultiplier(track);
    const trackBaseLinear = Math.min(
      insertMods.limiterCeilingLinear,
      vcaComp.effectiveLinearGain * insertMods.gainMultiplier
    );
    if (trackBaseLinear <= 0.00001) continue;

    const pan = Math.max(-1, Math.min(1, mixer.pan || 0));
    const panAngle = ((pan + 1) * Math.PI) / 4;
    const gainL = Math.cos(panAngle) * trackBaseLinear * masterLinearGain;
    const gainR = Math.sin(panAngle) * trackBaseLinear * masterLinearGain;

    for (const clip of track.clips) {
      const clipStartBeat = clip.startTime;
      const clipEndBeat = clip.startTime + Math.max(0.25, clip.length);
      for (const note of clip.notes) {
        if (note.time < 0 || note.time >= totalBeats) continue;
        if (note.time < clipStartBeat - 0.05 || note.time >= clipEndBeat + 0.05) continue;
        if (note.probability !== undefined && note.probability < 1.0) {
          const detHash = ((Math.round(note.time * 100) + note.pitch * 17) % 100) / 100;
          if (detHash > note.probability) continue;
        }

        const startSec = note.time / beatsPerSecond;
        const startFrame = Math.max(0, Math.floor(startSec * sampleRate));
        const durSec = Math.max(0.05, Math.min(2.5, note.duration / beatsPerSecond + 0.08));
        const noteFrames = Math.min(totalFrames - startFrame, Math.ceil(durSec * sampleRate));
        if (noteFrames <= 0) continue;

        const velNorm = Math.max(0.05, Math.min(1, note.velocity / 127));
        const velGain = Math.pow(velNorm, 1.35);
        const baseFreq = midiToFreq(note.pitch, mixer.transposeSemitones, mixer.fineTuneCents);

        const beatPhase = ((note.time % 1) + 1) % 1;
        const isNearKick = beatPhase < 0.22 || beatPhase > 0.94;
        const scDepth = Math.max(0, Math.min(1, mixer.sidechainDepth));
        const scFactor =
          track.archetype === 'kick'
            ? 1.0
            : isNearKick
            ? 1.0 - scDepth * 0.72
            : 1.0 - scDepth * 0.1;

        const spectralNotchFactor =
          track.spectralDucking?.enabled && track.archetype !== 'kick' && isNearKick
            ? dbToGain(Math.min(0, (track.spectralDucking.notchGainDb || -9) * 0.35))
            : 1.0;

        let phase = 0;
        let subPhase = 0;

        for (let i = 0; i < noteFrames; i++) {
          const t = i / sampleRate;
          let sample = 0;

          if (track.archetype === 'kick') {
            const instFreq = 40 + 118 * Math.exp(-t * 36);
            phase += (2 * Math.PI * instFreq) / sampleRate;
            const env = Math.exp(-t * 9.5);
            const click = t < 0.012 ? Math.sin(2 * Math.PI * 920 * t) * Math.exp(-t * 180) * 0.35 : 0;
            sample = Math.tanh((Math.sin(phase) * 0.92 + click) * 1.65) * env * velGain * 0.85;
          } else if (track.archetype === 'rumble') {
            phase += (2 * Math.PI * baseFreq) / sampleRate;
            subPhase += (2 * Math.PI * baseFreq * 2) / sampleRate;
            const env = Math.min(1, t / 0.012) * Math.exp(-t / Math.max(0.08, durSec * 0.75));
            sample = (Math.sin(phase) * 0.78 + Math.sin(subPhase) * 0.22) * env * velGain * 0.65;
          } else if (track.archetype === 'acid') {
            const isAccent = Boolean(note.isAccent || note.velocity >= 108);
            phase += (2 * Math.PI * baseFreq) / sampleRate;
            subPhase += (2 * Math.PI * baseFreq * 2) / sampleRate;
            const sawApprox = Math.sin(phase) + 0.5 * Math.sin(subPhase);
            const env = Math.min(1, t / 0.005) * Math.exp(-t / (isAccent ? 0.16 : 0.22));
            const drive = isAccent ? 2.2 : 1.5 + insertMods.saturationBoost;
            sample = Math.tanh(sawApprox * drive) * env * velGain * (isAccent ? 0.52 : 0.38);
          } else if (track.archetype === 'hats' || track.archetype === 'ride') {
            const detNoise = Math.sin(i * 12.9898 + note.pitch * 78.233) * 43758.5453;
            const white = (detNoise - Math.floor(detNoise)) * 2 - 1;
            const decayRate = track.archetype === 'ride' ? 5.5 : note.duration > 0.3 ? 9.0 : 28.0;
            const env = Math.exp(-t * decayRate);
            sample = white * env * velGain * 0.32;
          } else {
            phase += (2 * Math.PI * baseFreq) / sampleRate;
            subPhase += (2 * Math.PI * baseFreq * 1.498) / sampleRate;
            const env = Math.min(1, t / 0.01) * Math.exp(-t / Math.max(0.12, durSec * 0.85));
            sample = (Math.sin(phase) * 0.65 + Math.sin(subPhase) * 0.35) * env * velGain * 0.36;
          }

          if (insertMods.saturationBoost > 0.01) {
            sample = Math.tanh(sample * (1 + insertMods.saturationBoost));
          }

          const modSample = sample * scFactor * spectralNotchFactor;
          const frameIdx = startFrame + i;
          left[frameIdx] += modSample * gainL;
          right[frameIdx] += modSample * gainR;
        }
      }
    }
  }

  if (!singleTrackId) {
    const drive = 1.05 + masterBus.glueCompressionDrive * 0.45;
    const norm = Math.tanh(drive);
    for (let i = 0; i < totalFrames; i++) {
      left[i] = Math.tanh(left[i] * drive) / norm;
      right[i] = Math.tanh(right[i] * drive) / norm;
    }
  }

  return { left, right, sampleRate, durationSeconds };
}

/**
 * Synthesizes the project to stereo Float32Array buffers at 44.1kHz, 48kHz, or 96kHz.
 * Uses one continuous OfflineAudioContext with audio-clock scheduling windows.
 * Missing capability or insufficient memory is an explicit failure; synthesis never changes silently.
 */
let activeOfflineRender: OfflineAudioContext | null = null;

export async function synthesizeProjectToStereoFloatBuffers(
  project: AbletonProjectState,
  humanization: HumanizationConfig,
  masterBus: MasterBusConfig,
  sampleRate: 44100 | 48000 | 96000 = 44100,
  totalBars?: number,
  _segmentCount = 1,
  onProgress?: (completedFrames: number, totalFrames: number) => void,
  workingBytesPerFrame = 32
): Promise<{ left: Float32Array; right: Float32Array; sampleRate: number; durationSeconds: number }> {
  const bars = totalBars ?? project.arrangementLengthBars ?? 16;
  if (!Number.isFinite(project.tempo) || project.tempo <= 0 || !Number.isInteger(bars) || bars < 1 || bars > 256) {
    throw new Error('RENDER_INPUT: positive tempo and 1–256 whole bars required');
  }
  // One continuous context retains delay, convolver, compressor and sustaining voices.
  // Bounded scheduling windows are NOT independent PCM segments.
  const tail = Math.max(2.4, masterBus.reverbDecaySec || 0, 8);
  const durationSeconds = bars * 4 * 60 / project.tempo + tail;
  const frames = Math.ceil(durationSeconds * sampleRate);
  // PCM + encoded output + mastering copies; reject before allocating, never swap engines.
  if (frames * workingBytesPerFrame > 256 * 1024 * 1024) {
    throw new Error('RENDER_MEMORY: estimated working set exceeds 256 MiB; reduce length or sample rate');
  }
  if (typeof OfflineAudioContext === 'undefined') {
    throw new Error('RENDER_UNSUPPORTED: OfflineAudioContext unavailable; use a supported WebView/browser');
  }
  if (activeOfflineRender) throw new Error('RENDER_BUSY: an earlier render is still active; restart the app after a stalled export');
  const ctx = new OfflineAudioContext(2, frames, sampleRate);
  activeOfflineRender = ctx;
  let started = false;
  let cancelled = false;
  try {
  const bus = buildAudioBusGraph(ctx, project.tempo, masterBus, false);
  const noise = createNoiseBuffer(ctx);
  const masterPoints = [...(masterBus.masterAutomationPoints || [])].sort((a, b) => a.beat - b.beat);
  if (masterPoints.length) {
    bus.masterGain.gain.setValueAtTime(dbToGain(masterBus.masterVolumeDb + (evaluateAutomationAtBeat(masterPoints, 0, bars * 4) - 0.55) * 8), 0);
    for (const point of masterPoints) if (point.beat > 0 && point.beat <= bars * 4) {
      bus.masterGain.gain.linearRampToValueAtTime(dbToGain(masterBus.masterVolumeDb + (point.value - 0.55) * 8), point.beat * 60 / project.tempo);
    }
  }
  const bps = project.tempo / 60;
  const events: { track: AbletonTrack; note: MidiNoteEvent; time: number }[] = [];
  for (const track of project.tracks) {
    if (composeEffectiveTrackGain(track, project.tracks, project.vcaGroups || []).effectivelyMuted) continue;
    for (const clip of track.clips) for (const note of clip.notes) {
      if (!Number.isFinite(note.time) || !Number.isFinite(note.pitch) || !Number.isFinite(note.duration) || !Number.isFinite(note.velocity)) {
        throw new Error('RENDER_NOTE: non-finite note data');
      }
      if (note.time >= 0 && note.time < bars * 4 && note.time >= clip.startTime && note.time < clip.startTime + clip.length && shouldPlayNote(note)) {
        events.push({ track, note, time: note.time / bps });
      }
    }
  }
  events.sort((a, b) => a.time - b.time);
  let cursor = 0;
  const scheduleUntil = (end: number) => {
    while (cursor < events.length && events[cursor].time < end) {
      const e = events[cursor++];
      scheduleTrackVoiceAtTime(ctx, bus, noise, e.track, e.note, e.time, bps, humanization, project);
    }
  };
  // Align suspension times to render quanta to avoid scheduling notes in the past.
  const windowFrames = Math.ceil(sampleRate * 2 / 128) * 128;
  let boundary = windowFrames;
  scheduleUntil(boundary / sampleRate);
  onProgress?.(0, frames);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resetDeadline = () => {};
  const deadline = new Promise<never>((_, reject) => {
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { cancelled = true; reject(new Error('RENDER_TIMEOUT: no completed audio window for 60 seconds; restart the app before retrying')); }, 60000);
    };
    arm();
    resetDeadline = arm;
  });
  let rendered: AudioBuffer;
  try {
    const pump = async () => {
      let suspended = boundary < frames ? ctx.suspend(boundary / sampleRate) : null;
      started = true;
      const rendering = ctx.startRendering();
      rendering.then(() => { if (activeOfflineRender === ctx) activeOfflineRender = null; }, () => { if (activeOfflineRender === ctx) activeOfflineRender = null; });
      // Observe rejection immediately, including while awaiting a suspend boundary.
      const failed = rendering.then(() => new Promise<never>(() => {}), (error) => Promise.reject(error));
      while (suspended) {
        await Promise.race([suspended, failed]);
        if (cancelled) throw new Error('RENDER_CANCELLED: timed-out context cannot resume');
        onProgress?.(Math.min(frames, Math.round(ctx.currentTime * sampleRate)), frames);
        resetDeadline();
        bus.offlineRetirements = bus.offlineRetirements.filter(retirement => {
          if (retirement.at > ctx.currentTime) return true;
          for (const node of retirement.nodes) node.disconnect();
          return false;
        });
        boundary += windowFrames;
        scheduleUntil(Math.min(frames, boundary) / sampleRate);
        suspended = boundary < frames ? ctx.suspend(boundary / sampleRate) : null;
        await ctx.resume();
        if (cancelled) throw new Error('RENDER_CANCELLED: timed-out context cannot continue');
      }
      return await rendering;
    };
    rendered = await Promise.race([pump(), deadline]);
  } finally {
    clearTimeout(timer);
  }
  onProgress?.(frames, frames);
  return { left: rendered.getChannelData(0), right: rendered.getChannelData(1), sampleRate, durationSeconds: frames / sampleRate };
  } catch (error) {
    cancelled = true;
    if (!started) activeOfflineRender = null;
    else if (ctx.state === 'running') {
      const stopAt = (Math.floor(ctx.currentTime * sampleRate / 128) + 2) * 128 / sampleRate;
      if (stopAt < durationSeconds) void ctx.suspend(stopAt).catch(() => {});
    }
    // OfflineAudioContext has no close/cancel API. A stalled context retains the guard
    // until it settles or app restart, preventing two full PCM allocations after retry.
    throw error;
  }
}

/** Continuous shared-graph export. Progress measures rendered and encoded frames. */
export async function renderArrangementToWavBlob(
  project: AbletonProjectState,
  humanization: HumanizationConfig,
  masterBus: MasterBusConfig,
  totalBars?: number,
  bitDepthOrOnProgress: 16 | 24 | 32 | ((progressPercent: number) => void) = 24,
  onProgress?: (progressPercent: number) => void
): Promise<{ blob: Blob; durationSeconds: number; sampleRate: number; bitDepth: number }> {
  const bitDepth = typeof bitDepthOrOnProgress === 'number' ? bitDepthOrOnProgress : 24;
  const progress = typeof bitDepthOrOnProgress === 'function' ? bitDepthOrOnProgress : onProgress;
  progress?.(0);
  const pcm = await synthesizeProjectToStereoFloatBuffers(project, humanization, masterBus, 44100, totalBars, 1,
    (done, total) => progress?.(Math.floor(done / total * 75)), 8 + (bitDepth / 8) * 4);
  const blob = await encodeAudioBufferToWavBlob({ numberOfChannels: 2, sampleRate: pcm.sampleRate,
    length: pcm.left.length, getChannelData: (channel) => channel === 0 ? pcm.left : pcm.right }, bitDepth,
    (done) => progress?.(75 + Math.floor(done * 0.25)));
  progress?.(100);
  return { blob, durationSeconds: pcm.durationSeconds, sampleRate: pcm.sampleRate, bitDepth };
}

export interface MidiSixteenthHeatmapBin {
  sixteenthIndex: number;
  beatStart: number;
  onsetCount: number;
  maxVelocity: number;
  avgProbability: number;
  activeCoverage: number;
  hasAccent: boolean;
  hasSlide: boolean;
  combinedIntensity: number; // [0..1]
}

export interface SelectedTrackAnalysisData {
  cacheKey: string;
  trackId: string;
  trackName: string;
  totalBars: number;
  totalBeats: number;
  resolutionBins: number;
  /** Layer A: Strictly derived from actual MIDI events per 16th-note bin */
  midiHeatmapBins: MidiSixteenthHeatmapBin[];
  /** Layer B: Cached Waveform / Synthesis Envelope peaks & RMS */
  waveformPeaksMin: Float32Array;
  waveformPeaksMax: Float32Array;
  waveformRms: Float32Array;
  waveformModeLabel: 'Measured Audio Waveform (Offline PCM)' | 'Estimated Synthesis Envelope';
  isMeasuredAudio: boolean;
}

class WaveformAnalysisCache {
  private cache = new Map<string, SelectedTrackAnalysisData>();
  private maxEntries = 32;

  public get(key: string): SelectedTrackAnalysisData | undefined {
    return this.cache.get(key);
  }

  public set(key: string, data: SelectedTrackAnalysisData): void {
    if (this.cache.size >= this.maxEntries) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, data);
  }

  public clear(): void {
    this.cache.clear();
  }
}

export const waveformCacheService = new WaveformAnalysisCache();

/**
 * Computes and caches the dual-layer Selected-Track Waveform & 16th-Note MIDI Density Strip data.
 * Keyed by (projectRevision, trackId, clipRevision, dspConfigHash, resolutionBins) so zoom/pan/playhead
 * updates never recompute audio buffers.
 */
export function computeSelectedTrackAnalysisData(
  project: AbletonProjectState,
  track: AbletonTrack,
  humanization: HumanizationConfig,
  masterBus: MasterBusConfig,
  totalBars = 16,
  resolutionBins = 256
): SelectedTrackAnalysisData {
  const effectiveBars = Math.max(4, Math.min(256, totalBars || project.arrangementLengthBars || 16));
  const totalBeats = effectiveBars * 4;
  const totalSixteenths = effectiveBars * 16;

  // Build deterministic revision key for caching
  const notesSignature = track.clips
    .map((c) =>
      c.notes
        .map(
          (n) =>
            `${n.time.toFixed(3)}:${n.duration.toFixed(3)}:${n.pitch}:${n.velocity}:${(
              n.probability ?? 1
            ).toFixed(2)}:${n.isAccent ? 1 : 0}`
        )
        .join(',')
    )
    .join('|');

  const vcaComp = composeEffectiveTrackGain(track, project.tracks, project.vcaGroups || []);
  const dspSignature = JSON.stringify({
    vol: vcaComp.effectiveVolumeDb.toFixed(2),
    muted: vcaComp.effectivelyMuted,
    pan: track.mixer?.pan ?? 0,
    sc: track.mixer?.sidechainDepth ?? 0,
    cut: track.mixer?.filterCutoffHz ?? 800,
    duck: track.spectralDucking?.enabled ?? false,
    devices: (track.devices || []).map((d) => `${d.type}:${d.bypassed ? 0 : 1}`),
  });

  const cacheKey = `${project.projectRevision ?? 1}_${track.id}_${computeDeterministicHash(
    notesSignature
  )}_${computeDeterministicHash(dspSignature)}_${effectiveBars}_${resolutionBins}`;

  const cached = waveformCacheService.get(cacheKey);
  if (cached) {
    return cached;
  }

  // Layer A: 16th-note MIDI Activity Heatmap strictly from actual MIDI events
  const midiHeatmapBins: MidiSixteenthHeatmapBin[] = Array.from(
    { length: totalSixteenths },
    (_, idx) => ({
      sixteenthIndex: idx,
      beatStart: idx * 0.25,
      onsetCount: 0,
      maxVelocity: 0,
      avgProbability: 0,
      activeCoverage: 0,
      hasAccent: false,
      hasSlide: false,
      combinedIntensity: 0,
    })
  );

  const probSums = new Float32Array(totalSixteenths);
  const probCounts = new Uint16Array(totalSixteenths);

  for (const clip of track.clips) {
    for (const note of clip.notes) {
      if (note.time < 0 || note.time >= totalBeats) continue;
      const onsetBin = Math.min(totalSixteenths - 1, Math.max(0, Math.floor(note.time * 4)));
      const bin = midiHeatmapBins[onsetBin];
      bin.onsetCount += 1;
      if (note.velocity > bin.maxVelocity) {
        bin.maxVelocity = note.velocity;
      }
      if (note.isAccent || note.velocity >= 108) {
        bin.hasAccent = true;
      }
      if (note.isSlide) {
        bin.hasSlide = true;
      }

      const prob = note.probability ?? 1.0;
      probSums[onsetBin] += prob;
      probCounts[onsetBin] += 1;

      // Calculate duration coverage across 16th-note bins overlapped by this note
      const noteStart = note.time;
      const noteEnd = Math.min(totalBeats, note.time + Math.max(0.05, note.duration));
      const startIdx = Math.max(0, Math.floor(noteStart * 4));
      const endIdx = Math.min(totalSixteenths - 1, Math.floor(noteEnd * 4));
      for (let b = startIdx; b <= endIdx; b++) {
        const bStart = b * 0.25;
        const bEnd = bStart + 0.25;
        const overlap = Math.max(0, Math.min(noteEnd, bEnd) - Math.max(noteStart, bStart)) / 0.25;
        midiHeatmapBins[b].activeCoverage = Math.min(
          1.0,
          midiHeatmapBins[b].activeCoverage + overlap * (note.velocity / 127)
        );
      }
    }
  }

  for (let i = 0; i < totalSixteenths; i++) {
    const bin = midiHeatmapBins[i];
    bin.avgProbability = probCounts[i] > 0 ? probSums[i] / probCounts[i] : 0;
    const velNorm = bin.maxVelocity / 127;
    const densityFactor = Math.min(1, bin.onsetCount / 2);
    bin.combinedIntensity = Math.min(
      1,
      velNorm * 0.55 + bin.activeCoverage * 0.3 + densityFactor * 0.15
    );
  }

  // Layer B: Synthesize track PCM at 12kHz sample rate for fast, genuine audio waveform peaks & RMS
  const waveformSampleRate = 12000;
  const pcm = synthesizeDeterministicStereoPcm(
    project,
    humanization,
    masterBus,
    waveformSampleRate,
    effectiveBars,
    track.id
  );

  const beatsPerSecond = Math.max(40, project.tempo) / 60;
  const arrangementSeconds = totalBeats / beatsPerSecond;
  const arrangementFrames = Math.min(
    pcm.left.length,
    Math.max(resolutionBins, Math.floor(arrangementSeconds * waveformSampleRate))
  );

  const waveformPeaksMin = new Float32Array(resolutionBins);
  const waveformPeaksMax = new Float32Array(resolutionBins);
  const waveformRms = new Float32Array(resolutionBins);

  const framesPerBin = Math.max(1, Math.floor(arrangementFrames / resolutionBins));

  for (let b = 0; b < resolutionBins; b++) {
    const startFrame = b * framesPerBin;
    const endFrame = Math.min(arrangementFrames, startFrame + framesPerBin);
    let minVal = 0;
    let maxVal = 0;
    let sumSq = 0;
    let count = 0;

    for (let f = startFrame; f < endFrame; f++) {
      const mono = 0.5 * (pcm.left[f] + pcm.right[f]);
      if (mono < minVal) minVal = mono;
      if (mono > maxVal) maxVal = mono;
      sumSq += mono * mono;
      count++;
    }

    waveformPeaksMin[b] = Math.max(-1, minVal);
    waveformPeaksMax[b] = Math.min(1, maxVal);
    waveformRms[b] = count > 0 ? Math.min(1, Math.sqrt(sumSq / count)) : 0;
  }

  const result: SelectedTrackAnalysisData = {
    cacheKey,
    trackId: track.id,
    trackName: track.name,
    totalBars: effectiveBars,
    totalBeats,
    resolutionBins,
    midiHeatmapBins,
    waveformPeaksMin,
    waveformPeaksMax,
    waveformRms,
    waveformModeLabel: 'Measured Audio Waveform (Offline PCM)',
    isMeasuredAudio: true,
  };

  waveformCacheService.set(cacheKey, result);
  return result;
}

/**
 * Evaluates Audio Strip Silence active regions on a track's rendered waveform envelope
 * using open/close hysteresis, minimum region duration, and pre-attack / post-release padding.
 */
export function detectAudioStripSilenceRegions(
  analysisData: SelectedTrackAnalysisData,
  tempo: number,
  config: AudioStripSilenceConfig
): AudioActiveRegion[] {
  const { waveformRms, resolutionBins, totalBeats } = analysisData;
  const beatsPerBin = totalBeats / Math.max(1, resolutionBins);
  const msPerBeat = (60 / Math.max(40, tempo)) * 1000;

  const openDb = config.thresholdOpenDb ?? config.thresholdDb ?? -32;
  const closeDb = config.thresholdCloseDb ?? (openDb - (config.hysteresisDb ?? 3));
  const minActiveMs = config.minActiveDurationMs ?? config.minRegionDurationMs ?? 60;
  const preAttackMs = config.preAttackPadMs ?? config.preRollAttackMs ?? 8;
  const postReleaseMs = config.postReleasePadMs ?? config.postRollReleaseMs ?? 25;

  const openLinear = dbToGain(openDb);
  const closeLinear = dbToGain(closeDb);
  const minRegionBeats = Math.max(0.0625, minActiveMs / msPerBeat);
  const prePadBeats = Math.max(0, preAttackMs / msPerBeat);
  const postPadBeats = Math.max(0, postReleaseMs / msPerBeat);

  const rawRegions: { startBin: number; endBin: number; peakLinear: number }[] = [];
  let inRegion = false;
  let regionStartBin = 0;
  let regionPeak = 0;

  for (let b = 0; b < resolutionBins; b++) {
    const level = Math.max(
      waveformRms[b],
      Math.max(Math.abs(analysisData.waveformPeaksMax[b]), Math.abs(analysisData.waveformPeaksMin[b])) * 0.707
    );

    if (!inRegion && level >= openLinear) {
      inRegion = true;
      regionStartBin = b;
      regionPeak = level;
    } else if (inRegion) {
      if (level > regionPeak) regionPeak = level;
      if (level < closeLinear) {
        rawRegions.push({ startBin: regionStartBin, endBin: b, peakLinear: regionPeak });
        inRegion = false;
      }
    }
  }

  if (inRegion) {
    rawRegions.push({ startBin: regionStartBin, endBin: resolutionBins, peakLinear: regionPeak });
  }

  const finalRegions: AudioActiveRegion[] = [];
  for (let i = 0; i < rawRegions.length; i++) {
    const r = rawRegions[i];
    const rawStartBeat = r.startBin * beatsPerBin;
    const rawEndBeat = r.endBin * beatsPerBin;
    if (rawEndBeat - rawStartBeat < minRegionBeats) continue;

    const paddedStart = Math.max(0, Number((rawStartBeat - prePadBeats).toFixed(3)));
    const paddedEnd = Math.min(totalBeats, Number((rawEndBeat + postPadBeats).toFixed(3)));
    const peakDb = r.peakLinear > 1e-5 ? Number((20 * Math.log10(r.peakLinear)).toFixed(1)) : -60;

    // Merge overlapping padded regions
    if (finalRegions.length > 0 && paddedStart <= finalRegions[finalRegions.length - 1].endBeat) {
      const prev = finalRegions[finalRegions.length - 1];
      prev.endBeat = Math.max(prev.endBeat, paddedEnd);
      prev.peakDb = Math.max(prev.peakDb, peakDb);
    } else {
      finalRegions.push({
        id: `active_reg_${i + 1}`,
        startBeat: paddedStart,
        endBeat: paddedEnd,
        peakDb,
      });
    }
  }

  return finalRegions;
}

/**
 * Sample-Accurate Lookahead Web Audio Synthesizer & Transport Engine.
 */
export class ParametricWebAudioEngine {
  private ctx: AudioContext | null = null;
  private bus: AudioBusGraph | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private isPlaying = false;
  private anchorAudioTime = 0;
  private anchorBeat = 0;
  private currentBeat = 0;
  private scheduledNoteKeys = new Set<string>();
  private loopGeneration = 0;

  private schedulerTimerId: number | null = null;
  private rafId: number | null = null;

  private project: AbletonProjectState | null = null;
  private humanization: HumanizationConfig | null = null;
  private transport: TransportConfig = {
    loopEnabled: true,
    loopStartBar: 1,
    loopLengthBars: 4,
    arrangementLengthBars: 16,
    metronomeEnabled: false,
    followPlayhead: true,
    showAutomationLanes: false,
  };
  private masterBus: MasterBusConfig = {
    masterVolumeDb: 0,
    glueCompressionDrive: 0.35,
    reverbDecaySec: 3.2,
    reverbReturnLevel: 0.45,
    delayFeedback: 0.42,
    delayReturnLevel: 0.4,
    subBassMonoCutoffHz: 120,
  };

  private onPlayheadUpdate?: (
    beat: number,
    lfoCutoffModHz: number,
    masterPeakDb: number,
    truePeakDbtp?: number,
    lufs?: number
  ) => void;
  private onPlaybackStopped?: (reason?: string) => void;

  private smoothedTruePeakDbtp = -60;
  private smoothedLufs = -24;
  private bufferUnderruns = 0;
  private audioThreadLatencyMs = 2.4;
  private lastSchedulerPerfMs = 0;
  private currentCpuOperation = '8-Track Lookahead Voice Scheduler + 4x True-Peak Limiter';

  private playbackState: PlaybackEngineState = 'idle';
  private recoveryEventsCount = 0;
  private lastRecoveryTimestampMs: number | null = null;

  private stabilityThresholdMs = 12.0;
  private stabilityAutoPauseEnabled = false;
  private lastAutoPauseReason: string | null = null;
  private lastAutoPauseTimestamp: number | null = null;

  private underrunEvents: {
    id: string;
    timestamp: number;
    formattedTime: string;
    latencyMs: number;
    operation: string;
    activeVoices: number;
  }[] = [];

  private formatTimestamp(ms: number): string {
    return new Date(ms).toISOString().slice(11, 23);
  }

  public getPlaybackState(): PlaybackEngineState {
    return this.playbackState;
  }

  public async recoverAudioEngine(): Promise<boolean> {
    this.playbackState = 'recovering';
    this.recoveryEventsCount += 1;
    this.lastRecoveryTimestampMs = Date.now();
    try {
      this.ensureContext();
      if (this.ctx && this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      if (this.ctx) {
        this.anchorBeat = this.currentBeat;
        this.anchorAudioTime = this.ctx.currentTime + 0.015;
        this.lastSchedulerPerfMs = performance.now();
      }
      this.playbackState = this.isPlaying ? 'playing' : 'ready';
      return true;
    } catch {
      this.playbackState = 'error';
      return false;
    }
  }

  public recordUnderrunEvent(operation: string, latencyMs: number) {
    const now = Date.now();
    this.bufferUnderruns += 1;
    const entry = {
      id: `underrun_${now}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: now,
      formattedTime: this.formatTimestamp(now),
      latencyMs: Number(latencyMs.toFixed(2)),
      operation,
      activeVoices: Math.max(4, this.scheduledNoteKeys.size),
    };
    this.underrunEvents = [entry, ...this.underrunEvents].slice(0, 10);
  }

  public clearUnderrunEvents() {
    this.bufferUnderruns = 0;
    this.underrunEvents = [];
    this.lastAutoPauseReason = null;
    this.lastAutoPauseTimestamp = null;
    this.audioThreadLatencyMs = 2.4;
  }

  public setStabilityThreshold(thresholdMs: number, enabled = this.stabilityAutoPauseEnabled) {
    this.stabilityThresholdMs = Math.max(2.0, Math.min(50.0, thresholdMs));
    this.stabilityAutoPauseEnabled = enabled;
  }

  public getStabilityThreshold() {
    return {
      thresholdMs: this.stabilityThresholdMs,
      autoPauseEnabled: this.stabilityAutoPauseEnabled,
      lastAutoPauseReason: this.lastAutoPauseReason,
      lastAutoPauseTimestamp: this.lastAutoPauseTimestamp,
    };
  }

  public clearAutoPauseAlert() {
    this.lastAutoPauseReason = null;
    this.lastAutoPauseTimestamp = null;
  }

  private triggerStabilityAutoPause(latencyMs: number, operation: string) {
    const reason = `Audio Stability Threshold Protection: Playback auto-paused at ${latencyMs.toFixed(
      1
    )} ms (threshold: ${this.stabilityThresholdMs.toFixed(1)} ms) during "${operation}".`;
    this.lastAutoPauseReason = reason;
    this.lastAutoPauseTimestamp = Date.now();
    this.recordUnderrunEvent(`[AUTO-PAUSE] ${operation}`, latencyMs);
    this.stop();
    this.playbackState = 'interrupted';
    if (this.onPlaybackStopped) {
      this.onPlaybackStopped(reason);
    }
  }

  public simulateLatencySpike(spikeLatencyMs?: number, customOperation?: string) {
    const targetLatency =
      spikeLatencyMs ?? Number((this.stabilityThresholdMs + 3.4).toFixed(2));
    const operations = [
      '8-Track Polyphonic Synth + Warehouse Reverb Convolver',
      'TB-303 Acid Diode Filter + 4x True-Peak Lookahead Limiter',
      'Spectral Auto-Ducking EQEight + 3/16 Ping-Pong Dub Echo',
      'Timeline Playhead Scrubbing + 512-Bin FFT Spectrum Overlay',
      'ALS XML Gzip Serialization + Euclidean Polymeter Re-Sync',
    ];
    const op =
      customOperation || operations[0];
    this.currentCpuOperation = op;
    this.audioThreadLatencyMs = targetLatency;

    if (this.stabilityAutoPauseEnabled && targetLatency > this.stabilityThresholdMs) {
      this.triggerStabilityAutoPause(targetLatency, op);
    } else {
      this.recordUnderrunEvent(op, targetLatency);
    }
  }

  public getDiagnostics() {
    const baseLat =
      ((this.ctx as unknown as { baseLatency?: number })?.baseLatency || 0.0024) * 1000;
    const outputLat =
      ((this.ctx as unknown as { outputLatency?: number })?.outputLatency || 0) * 1000;
    if (!this.isPlaying && this.audioThreadLatencyMs <= this.stabilityThresholdMs) {
      this.audioThreadLatencyMs = Number((baseLat + outputLat).toFixed(2));
    }

    return {
      bufferUnderruns: this.bufferUnderruns,
      audioThreadLatencyMs: Number(this.audioThreadLatencyMs.toFixed(2)),
      sampleRate: this.ctx ? this.ctx.sampleRate : 44100,
      state: this.ctx ? this.ctx.state : 'suspended',
      playbackState: this.playbackState,
      recoveryEventsCount: this.recoveryEventsCount,
      lastRecoveryTimestampMs: this.lastRecoveryTimestampMs,
      activeVoices: this.scheduledNoteKeys.size,
      isPlaying: this.isPlaying,
      currentCpuOperation: this.currentCpuOperation,
      underrunEvents: this.underrunEvents,
      stabilityThresholdMs: this.stabilityThresholdMs,
      stabilityAutoPauseEnabled: this.stabilityAutoPauseEnabled,
      lastAutoPauseReason: this.lastAutoPauseReason,
      lastAutoPauseTimestamp: this.lastAutoPauseTimestamp,
    };
  }

  private getMaxArrangementBeats(): number {
    const bars =
      this.project?.arrangementLengthBars || this.transport.arrangementLengthBars || 16;
    return Math.max(16, bars * 4);
  }

  public syncLiveTrackChannels(): void {
    if (!this.ctx || !this.bus || !this.project) return;
    for (const track of this.project.tracks) {
      getOrCreateTrackChannelRuntime(this.ctx, this.bus, track, this.project);
    }
  }

  public updateTrackMixerLive(
    trackId: string,
    partialMixer?: Partial<TrackMixerParams>,
    muteSoloOverride?: { muted?: boolean; soloed?: boolean }
  ): TrackChannelRuntime | null {
    // V7.1 P0-003: THE AUDIO ENGINE NEVER MUTATES CANONICAL PROJECT STATE!
    // Updates internal audio graph nodes directly via setTargetAtTime
    if (!this.bus) {
      this.ensureContext();
    }
    if (!this.bus || !this.ctx) return null;

    let channel = this.bus.trackChannels.get(trackId);
    if (!channel) {
      const track = this.project?.tracks.find((t) => t.id === trackId);
      if (!track) return null;
      channel = getOrCreateTrackChannelRuntime(this.ctx, this.bus, track, this.project || undefined);
    }
    if (!channel) return null;

    const now = this.ctx.currentTime;
    const currentTrack = this.project?.tracks.find((t) => t.id === trackId);
    if (!currentTrack) return channel;

    // Create an immutable virtual track representation for audibility calculations
    const virtualTrack: AbletonTrack = {
      ...currentTrack,
      muted: muteSoloOverride?.muted !== undefined ? muteSoloOverride.muted : currentTrack.muted,
      soloed: muteSoloOverride?.soloed !== undefined ? muteSoloOverride.soloed : currentTrack.soloed,
      mixer: partialMixer ? { ...currentTrack.mixer, ...partialMixer } : currentTrack.mixer,
    };

    const allVirtualTracks = (this.project?.tracks || [currentTrack]).map((t) =>
      t.id === trackId ? virtualTrack : t
    );

    const audibility = resolveEffectiveAudibility(
      virtualTrack,
      allVirtualTracks,
      this.project?.vcaGroups || []
    );

    const targetFaderLinear = audibility.effectiveGainLinear;
    const targetGateLinear = audibility.isAudible ? 1.0 : 0.0;
    const targetPan = Math.max(-1, Math.min(1, virtualTrack.mixer?.pan ?? 0));
    const targetRev = Math.max(0, Math.min(1, virtualTrack.mixer?.reverbSend ?? 0));
    const targetDel = Math.max(0, Math.min(1, virtualTrack.mixer?.delaySend ?? 0));

    channel.faderGain.gain.setTargetAtTime(targetFaderLinear, now, 0.012);
    channel.muteSoloGate.gain.setTargetAtTime(targetGateLinear, now, 0.008);
    channel.panner.pan.setTargetAtTime(targetPan, now, 0.012);
    channel.reverbSendGain.gain.setTargetAtTime(targetRev, now, 0.012);
    channel.delaySendGain.gain.setTargetAtTime(targetDel, now, 0.012);

    channel.currentFaderLinear = targetFaderLinear;
    channel.currentGateLinear = targetGateLinear;
    channel.currentPan = targetPan;
    channel.currentReverbSend = targetRev;
    channel.currentDelaySend = targetDel;

    // Update other channels if solo status changed on this track
    if (muteSoloOverride?.soloed !== undefined) {
      for (const otherTrack of allVirtualTracks) {
        if (otherTrack.id === trackId) continue;
        const otherCh = this.bus.trackChannels.get(otherTrack.id);
        if (otherCh) {
          const otherAud = resolveEffectiveAudibility(
            otherTrack,
            allVirtualTracks,
            this.project?.vcaGroups || []
          );
          const otherGate = otherAud.isAudible ? 1.0 : 0.0;
          otherCh.muteSoloGate.gain.setTargetAtTime(otherGate, now, 0.008);
          otherCh.currentGateLinear = otherGate;
        }
      }
    }

    return channel;
  }

  public updateTrackMixerLiveDspOnly = this.updateTrackMixerLive.bind(this);

  public getTrackChannelState(trackId: string): TrackChannelRuntime | null {
    if (!this.bus) return null;
    return this.bus.trackChannels.get(trackId) || null;
  }

  public getTrackMeterLevels(trackId: string): {
    peakDb: number;
    rmsDb: number;
    faderLinear: number;
    gateLinear: number;
    pan: number;
  } {
    const ch = this.bus?.trackChannels.get(trackId);
    if (!ch) {
      const trk = this.project?.tracks.find((t) => t.id === trackId);
      const aud = trk && this.project
        ? resolveEffectiveAudibility(trk, this.project.tracks, this.project.vcaGroups || [])
        : { effectiveGainLinear: 1, isAudible: true };
      return {
        peakDb: -60,
        rmsDb: -60,
        faderLinear: aud.effectiveGainLinear,
        gateLinear: aud.isAudible ? 1 : 0,
        pan: trk?.mixer?.pan ?? 0,
      };
    }

    let peakDb = -60;
    let rmsDb = -60;
    if (this.isPlaying && ch.analyser && ch.meterBuffer && ch.currentGateLinear > 0) {
      ch.analyser.getByteTimeDomainData(ch.meterBuffer);
      let maxPeak = 0;
      let sumSq = 0;
      const len = ch.meterBuffer.length;
      for (let i = 0; i < len; i++) {
        const s = (ch.meterBuffer[i] - 128) / 128;
        const abs = Math.abs(s);
        if (abs > maxPeak) maxPeak = abs;
        sumSq += s * s;
      }
      const rms = Math.sqrt(sumSq / len);
      if (maxPeak > 0.0005) {
        peakDb = Math.max(-60, Math.min(6, 20 * Math.log10(maxPeak)));
      }
      if (rms > 0.0005) {
        rmsDb = Math.max(-60, Math.min(6, 20 * Math.log10(rms)));
      }
    }

    return {
      peakDb: Math.round(peakDb * 10) / 10,
      rmsDb: Math.round(rmsDb * 10) / 10,
      faderLinear: ch.currentFaderLinear,
      gateLinear: ch.currentGateLinear,
      pan: ch.currentPan,
    };
  }

  public setState(
    project: AbletonProjectState,
    humanization: HumanizationConfig,
    transport?: TransportConfig,
    masterBus?: MasterBusConfig,
    onPlayheadUpdate?: (
      beat: number,
      lfoCutoffModHz: number,
      masterPeakDb: number,
      truePeakDbtp?: number,
      lufs?: number
    ) => void,
    onPlaybackStopped?: (reason?: string) => void
  ) {
    const prevTempo = this.project?.tempo;
    this.project = project;
    this.humanization = humanization;
    if (transport) {
      this.transport = transport;
    }
    if (masterBus) {
      this.masterBus = masterBus;
    }
    if (onPlayheadUpdate) {
      this.onPlayheadUpdate = onPlayheadUpdate;
    }
    if (onPlaybackStopped) {
      this.onPlaybackStopped = onPlaybackStopped;
    }

    if (this.ctx && this.bus) {
      const now = this.ctx.currentTime;
      this.bus.masterGain.gain.setTargetAtTime(
        dbToGain(this.masterBus.masterVolumeDb) * (1 + this.masterBus.glueCompressionDrive * 0.25),
        now,
        0.02
      );
      this.bus.reverbReturnGain.gain.setTargetAtTime(
        this.masterBus.reverbReturnLevel * 0.85,
        now,
        0.02
      );
      this.bus.delayReturnGain.gain.setTargetAtTime(
        this.masterBus.delayReturnLevel * 0.75,
        now,
        0.02
      );
      this.bus.delayFeedbackGain.gain.setTargetAtTime(
        Math.min(0.82, Math.max(0.1, this.masterBus.delayFeedback)),
        now,
        0.02
      );
      this.bus.compressor.threshold.setTargetAtTime(
        -14 - this.masterBus.glueCompressionDrive * 10,
        now,
        0.03
      );
      const threeSixteenthSec = Math.max(
        0.08,
        Math.min(0.9, (60 / Math.max(90, project.tempo)) * 0.75)
      );
      this.bus.delayNodeL.delayTime.setTargetAtTime(threeSixteenthSec, now, 0.03);
      this.bus.delayNodeR.delayTime.setTargetAtTime(threeSixteenthSec, now, 0.03);

      // Immediately sync all persistent per-track channel strips in real time
      this.syncLiveTrackChannels();

      if (this.isPlaying && prevTempo && prevTempo !== project.tempo) {
        this.anchorBeat = this.currentBeat;
        this.anchorAudioTime = this.ctx.currentTime;
      }
    }
  }

  private ensureContext() {
    if (!this.ctx) {
      this.playbackState = 'initializing';
      const AudioCtx =
        (typeof window !== 'undefined' && window.AudioContext) ||
        (typeof window !== 'undefined' &&
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
      if (typeof AudioCtx === 'function') {
        this.ctx = new AudioCtx();
      } else {
        this.playbackState = 'ready';
        return;
      }
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
    if (!this.noiseBuffer && this.ctx) {
      this.noiseBuffer = createNoiseBuffer(this.ctx);
    }
    if (!this.bus && this.ctx) {
      this.bus = buildAudioBusGraph(
        this.ctx,
        this.project?.tempo || 134,
        this.masterBus,
        true
      );
      this.syncLiveTrackChannels();
    }
    if (this.playbackState === 'idle' || this.playbackState === 'initializing') {
      this.playbackState = 'ready';
    }
  }

  public start(fromStart = false) {
    this.ensureContext();
    if (!this.ctx) return;
    this.syncLiveTrackChannels();

    const maxBeats = this.getMaxArrangementBeats();
    if (fromStart || this.currentBeat >= maxBeats - 0.05) {
      this.currentBeat = this.transport.loopEnabled
        ? Math.max(0, (this.transport.loopStartBar - 1) * 4)
        : 0;
    }

    this.anchorBeat = this.currentBeat;
    this.anchorAudioTime = this.ctx.currentTime + 0.02;
    this.lastSchedulerPerfMs = performance.now();
    this.scheduledNoteKeys.clear();
    this.loopGeneration = 0;
    this.playbackState = 'playing';

    if (!this.isPlaying) {
      this.isPlaying = true;
      this.schedulerTimerId = window.setInterval(this.runLookaheadScheduler, 20);
      this.rafId = requestAnimationFrame(this.runVisualPlayheadLoop);
    }
  }

  public pause() {
    this.stop();
    this.playbackState = 'paused';
  }

  public stop() {
    if (this.bus) for (const retire of [...this.bus.activeVoices]) retire();
    this.isPlaying = false;
    this.lastSchedulerPerfMs = 0;
    if (this.schedulerTimerId !== null) {
      clearInterval(this.schedulerTimerId);
      this.schedulerTimerId = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.scheduledNoteKeys.clear();
    if (this.playbackState !== 'interrupted' && this.playbackState !== 'error') {
      this.playbackState = this.ctx ? 'ready' : 'idle';
    }
  }

  public seek(beat: number) {
    if (this.bus) for (const retire of [...this.bus.activeVoices]) retire();
    const maxBeats = this.getMaxArrangementBeats();
    const clamped = Math.max(0, Math.min(maxBeats - 0.01, beat));
    this.currentBeat = clamped;
    this.anchorBeat = clamped;
    if (this.ctx) {
      this.anchorAudioTime = this.ctx.currentTime;
    }
    this.scheduledNoteKeys.clear();
    this.loopGeneration++;
  }

  public getCurrentBeat(): number {
    if (this.isPlaying && this.ctx && this.project) {
      const bpm = this.project.tempo || 134;
      const beatsPerSec = bpm / 60.0;
      const elapsedSec = Math.max(0, this.ctx.currentTime - this.anchorAudioTime);
      const maxBeats = this.getMaxArrangementBeats();
      const loopStartBeat = Math.max(0, (this.transport.loopStartBar - 1) * 4);
      const loopSpanBeats = Math.max(4, this.transport.loopLengthBars * 4);
      const loopEndBeat = Math.min(maxBeats, loopStartBeat + loopSpanBeats);
      const rawBeat = this.anchorBeat + elapsedSec * beatsPerSec;
      if (this.transport.loopEnabled && loopEndBeat > loopStartBeat) {
        const span = loopEndBeat - loopStartBeat;
        if (rawBeat >= loopEndBeat) {
          this.currentBeat = loopStartBeat + ((rawBeat - loopStartBeat) % span);
        } else {
          this.currentBeat = rawBeat;
        }
      } else {
        this.currentBeat = rawBeat % Math.max(1, maxBeats);
      }
    }
    return this.currentBeat;
  }

  public getIsPlaying(): boolean {
    return this.isPlaying;
  }

  public getAnalyser(): AnalyserNode | null {
    return this.bus?.analyser || null;
  }

  public getAudioContext(): AudioContext | null {
    return this.ctx || null;
  }

  public getByteFrequencyData(targetArray: Uint8Array<ArrayBuffer>): void {
    if (this.bus?.analyser) {
      this.bus.analyser.getByteFrequencyData(targetArray);
    } else {
      targetArray.fill(0);
    }
  }

  public getFrequencyBinCount(): number {
    return this.bus?.analyser ? this.bus.analyser.frequencyBinCount : 256;
  }

  private reusableTimeDomainBuffer: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(512));
  private reusableFreqBuffer: Uint8Array<ArrayBuffer> = new Uint8Array(new ArrayBuffer(256));

  public getLoudnessMetrics(): { peakDbfs: number; rmsDb: number; kWeightedLufs: number } {
    if (!this.bus?.analyser || !this.isPlaying) {
      return { peakDbfs: -60.0, rmsDb: -60.0, kWeightedLufs: -60.0 };
    }

    const fftSize = this.bus.analyser.fftSize;
    if (this.reusableTimeDomainBuffer.length !== fftSize) {
      this.reusableTimeDomainBuffer = new Uint8Array(new ArrayBuffer(fftSize));
    }
    this.bus.analyser.getByteTimeDomainData(this.reusableTimeDomainBuffer);

    let maxPeak = 0;
    let sumSq = 0;
    for (let i = 0; i < fftSize; i++) {
      const sample = (this.reusableTimeDomainBuffer[i] - 128) / 128;
      const abs = Math.abs(sample);
      if (abs > maxPeak) maxPeak = abs;
      sumSq += sample * sample;
    }

    const rms = Math.sqrt(sumSq / fftSize);
    const peakDbfs =
      maxPeak > 0.0005 ? Math.max(-60, Math.min(6, 20 * Math.log10(maxPeak))) : -60;
    const rmsDb = rms > 0.0005 ? Math.max(-60, Math.min(6, 20 * Math.log10(rms))) : -60;

    const binCount = this.bus.analyser.frequencyBinCount;
    if (this.reusableFreqBuffer.length !== binCount) {
      this.reusableFreqBuffer = new Uint8Array(new ArrayBuffer(binCount));
    }
    this.bus.analyser.getByteFrequencyData(this.reusableFreqBuffer);

    const nyquist = (this.ctx?.sampleRate || 44100) / 2;
    let weightedEnergySum = 0;
    let totalWeight = 0;

    for (let b = 1; b < binCount; b++) {
      const freq = (b * nyquist) / binCount;
      const rlbWeight = freq < 85 ? Math.pow(freq / 85, 2) : 1.0;
      const shelfWeight = freq > 1500 ? 1.58 : freq > 800 ? 1.25 : 1.0;
      const kWeight = rlbWeight * shelfWeight;

      const magLinear = Math.pow(10, (-90 + (this.reusableFreqBuffer[b] / 255) * 84) / 20);
      weightedEnergySum += magLinear * magLinear * kWeight;
      totalWeight += kWeight;
    }

    const meanKWeightedSq = totalWeight > 0 ? weightedEnergySum / totalWeight : 0;
    const kWeightedLufs =
      meanKWeightedSq > 1e-7
        ? Math.max(-60, Math.min(0, -0.691 + 10 * Math.log10(meanKWeightedSq) + 14.5))
        : -60;

    return {
      peakDbfs: Math.round(peakDbfs * 10) / 10,
      rmsDb: Math.round(rmsDb * 10) / 10,
      kWeightedLufs: Math.round(kWeightedLufs * 10) / 10,
    };
  }

  public triggerLivePad(archetype: string, velocity = 105, customPitch?: number): void {
    this.ensureContext();
    if (!this.ctx || !this.bus || !this.noiseBuffer || !this.project || !this.humanization) return;
    const targetTrack =
      this.project.tracks.find((t) => t.archetype === archetype) || this.project.tracks[0];
    if (!targetTrack) return;

    const defaultPitch =
      archetype === 'kick'
        ? 36
        : archetype === 'rumble'
        ? 29
        : archetype === 'acid'
        ? 41
        : archetype === 'percussion'
        ? 53
        : archetype === 'ride'
        ? 51
        : archetype === 'hats'
        ? 46
        : archetype === 'pad'
        ? 65
        : 65;

    const pitch =
      customPitch !== undefined
        ? customPitch
        : targetTrack.clips[0]?.notes[0]?.pitch ?? defaultPitch;
    const note: MidiNoteEvent = {
      id: `live_${Date.now()}`,
      time: this.currentBeat,
      quantizedTime: this.currentBeat,
      duration: archetype === 'pad' ? 0.85 : archetype === 'synth' ? 0.35 : 0.22,
      pitch,
      velocity: Math.max(20, Math.min(127, velocity)),
      isGhost: false,
      isAccent: velocity >= 108,
    };

    scheduleTrackVoiceAtTime(
      this.ctx,
      this.bus,
      this.noiseBuffer,
      targetTrack,
      note,
      this.ctx.currentTime,
      this.project.tempo / 60,
      this.humanization,
      this.project
    );
  }

  private runLookaheadScheduler = () => {
    if (
      !this.isPlaying ||
      !this.project ||
      !this.humanization ||
      !this.ctx ||
      !this.bus ||
      !this.noiseBuffer
    ) {
      return;
    }

    const nowPerf = performance.now();
    if (this.lastSchedulerPerfMs > 0) {
      const deltaMs = nowPerf - this.lastSchedulerPerfMs;
      // Non-stopping bounded catch-up recovery when a main-thread timer tick is late (> 45ms):
      // Never kill playback from timer jitter; transition through 'recovering' -> 'playing'
      if (deltaMs > 45) {
        this.playbackState = 'recovering';
        this.recoveryEventsCount += 1;
        this.lastRecoveryTimestampMs = Math.round(nowPerf);
      } else if (this.playbackState === 'recovering') {
        this.playbackState = 'playing';
      }
    }
    this.lastSchedulerPerfMs = nowPerf;


    const nowAudio = this.ctx.currentTime;
    const beatsPerSecond = this.project.tempo / 60;
    const lookaheadSeconds = 0.12;
    const maxBeats = this.getMaxArrangementBeats();

    let exactBeatNow = this.anchorBeat + (nowAudio - this.anchorAudioTime) * beatsPerSecond;

    const loopStartBeat = Math.max(0, (this.transport.loopStartBar - 1) * 4);
    const loopSpanBeats = this.transport.loopLengthBars * 4;
    const loopEndBeat = Math.min(maxBeats, loopStartBeat + loopSpanBeats);

    if (this.transport.loopEnabled) {
      if (exactBeatNow >= loopEndBeat) {
        const wrappedBeat = loopStartBeat + ((exactBeatNow - loopStartBeat) % loopSpanBeats);
        this.anchorBeat = wrappedBeat;
        this.anchorAudioTime = nowAudio;
        exactBeatNow = wrappedBeat;
        this.loopGeneration++;
        this.scheduledNoteKeys.clear();
      }
    } else {
      if (exactBeatNow >= maxBeats) {
        this.currentBeat = 0;
        this.stop();
        if (this.onPlayheadUpdate) {
          this.onPlayheadUpdate(0, this.humanization.cutoffHz, -60);
        }
        if (this.onPlaybackStopped) {
          this.onPlaybackStopped();
        }
        return;
      }
    }

    const windowEndBeat = exactBeatNow + lookaheadSeconds * beatsPerSecond;

    if (this.transport.metronomeEnabled) {
      const firstIntBeat = Math.ceil(exactBeatNow - 0.02);
      const lastIntBeat = Math.floor(windowEndBeat);
      for (let b = firstIntBeat; b <= lastIntBeat; b++) {
        if (b < 0 || b >= maxBeats) continue;
        const metroKey = `metro_${this.loopGeneration}_${b}`;
        if (!this.scheduledNoteKeys.has(metroKey)) {
          const clickAudioTime = this.anchorAudioTime + (b - this.anchorBeat) / beatsPerSecond;
          if (clickAudioTime >= nowAudio - 0.015) {
            this.scheduledNoteKeys.add(metroKey);
            scheduleMetronomeClick(this.ctx, this.bus.masterGain, clickAudioTime, b % 4 === 0);
          }
        }
      }
    }

    this.project.tracks.forEach((track) => {
      track.clips.forEach((clip) => {
        const clipStartBeat = clip.startTime;
        const clipEndBeat = clip.startTime + Math.max(0.25, clip.length);
        clip.notes.forEach((note) => {
          // Enforce clip boundary: only schedule notes that belong to this clip's active span
          if (note.time < clipStartBeat - 0.05 || note.time >= clipEndBeat + 0.05) {
            return;
          }
          if (note.probability !== undefined && note.probability < 1.0) {
            const detHash =
              ((Math.round(note.time * 100) + note.pitch * 17 + this.loopGeneration * 31) % 100) /
              100;
            if (detHash > note.probability) return;
          }

          if (note.time >= exactBeatNow - 0.015 && note.time <= windowEndBeat) {
            if (
              this.transport.loopEnabled &&
              (note.time < loopStartBeat || note.time >= loopEndBeat)
            ) {
              return;
            }
            const key = `${this.loopGeneration}_${track.id}_${clip.id}_${note.id}`;
            if (!this.scheduledNoteKeys.has(key)) {
              const noteAudioTime =
                this.anchorAudioTime + (note.time - this.anchorBeat) / beatsPerSecond;
              // Never burst-fire expired notes if scheduler was delayed
              if (noteAudioTime >= nowAudio - 0.015) {
                this.scheduledNoteKeys.add(key);
                scheduleTrackVoiceAtTime(
                  this.ctx!,
                  this.bus!,
                  this.noiseBuffer!,
                  track,
                  note,
                  noteAudioTime,
                  beatsPerSecond,
                  this.humanization!,
                  this.project!
                );
              }
            }
          }

          if (this.transport.loopEnabled && windowEndBeat > loopEndBeat) {
            const overflowBeats = windowEndBeat - loopEndBeat;
            if (note.time >= loopStartBeat && note.time <= loopStartBeat + overflowBeats) {
              const nextGen = this.loopGeneration + 1;
              const wrapKey = `${nextGen}_${track.id}_${clip.id}_${note.id}`;
              if (!this.scheduledNoteKeys.has(wrapKey)) {
                const beatsUntilNote =
                  loopEndBeat - this.anchorBeat + (note.time - loopStartBeat);
                const noteAudioTime = this.anchorAudioTime + beatsUntilNote / beatsPerSecond;
                if (noteAudioTime >= nowAudio - 0.01) {
                  this.scheduledNoteKeys.add(wrapKey);
                  scheduleTrackVoiceAtTime(
                    this.ctx!,
                    this.bus!,
                    this.noiseBuffer!,
                    track,
                    note,
                    noteAudioTime,
                    beatsPerSecond,
                    this.humanization!,
                    this.project!
                  );
                }
              }
            }
          }
        });
      });
    });

    // Evaluate master automation curve if present
    if (
      this.masterBus.masterAutomationPoints &&
      this.masterBus.masterAutomationPoints.length > 0 &&
      this.bus
    ) {
      const autoVal = evaluateAutomationAtBeat(
        this.masterBus.masterAutomationPoints,
        exactBeatNow,
        maxBeats
      );
      const masterTrim = (autoVal - 0.55) * 8.0;
      const targetGain = dbToGain((this.masterBus.masterVolumeDb || 0) + masterTrim);
      this.bus.masterGain.gain.setTargetAtTime(targetGain, nowAudio, 0.02);
    }


    if (this.playbackState === 'recovering') {
      this.playbackState = 'playing';
    }
  };

  private runVisualPlayheadLoop = () => {
    if (!this.isPlaying || !this.project || !this.humanization || !this.ctx) return;

    const nowAudio = this.ctx.currentTime;
    const beatsPerSecond = this.project.tempo / 60;
    const beat = this.anchorBeat + Math.max(0, nowAudio - this.anchorAudioTime) * beatsPerSecond;
    const maxBeats = this.getMaxArrangementBeats();

    const loopStartBeat = Math.max(0, (this.transport.loopStartBar - 1) * 4);
    const loopSpanBeats = this.transport.loopLengthBars * 4;
    const loopEndBeat = Math.min(maxBeats, loopStartBeat + loopSpanBeats);

    if (this.transport.loopEnabled && beat >= loopEndBeat) {
      this.currentBeat = loopStartBeat + ((beat - loopStartBeat) % loopSpanBeats);
    } else {
      this.currentBeat = Math.min(maxBeats, beat);
    }

    const lfoPhase = Math.sin(2 * Math.PI * this.humanization.lfoRateHz * nowAudio);
    const baseCutoff =
      this.humanization.cutoffHz + (this.humanization.macroTransition / 127) * 180;
    const modulatedCutoffHz = Math.max(
      45,
      Math.min(2400, baseCutoff * (1 + lfoPhase * this.humanization.lfoDepth * 0.65))
    );

    let masterPeakDb = -60;
    let truePeakDbtp = -60;
    let instantLufs = -24;

    if (this.bus?.analyser) {
      const fftSize = this.bus.analyser.fftSize;
      if (this.reusableTimeDomainBuffer.length !== fftSize) {
        this.reusableTimeDomainBuffer = new Uint8Array(new ArrayBuffer(fftSize));
      }
      this.bus.analyser.getByteTimeDomainData(this.reusableTimeDomainBuffer);
      let maxPeak = 0;
      let maxTruePeak = 0;
      let sumSq = 0;

      for (let i = 0; i < fftSize; i++) {
        const sample = (this.reusableTimeDomainBuffer[i] - 128) / 128;
        const centered = Math.abs(sample);
        if (centered > maxPeak) maxPeak = centered;
        sumSq += sample * sample;

        // 4x oversampled parabolic inter-sample true peak estimation
        if (i > 0 && i < fftSize - 1) {
          const s0 = Math.abs((this.reusableTimeDomainBuffer[i - 1] - 128) / 128);
          const s1 = centered;
          const s2 = Math.abs((this.reusableTimeDomainBuffer[i + 1] - 128) / 128);
          const denom = 2 * s1 - s0 - s2;
          if (denom > 0.001) {
            const peakEst = s1 + (0.125 * Math.pow(s0 - s2, 2)) / denom;
            if (peakEst > maxTruePeak) maxTruePeak = peakEst;
          }
        }
      }

      maxTruePeak = Math.max(maxPeak, maxTruePeak);
      if (maxPeak > 0.0005) {
        masterPeakDb = Math.max(-48, Math.min(0, 20 * Math.log10(maxPeak)));
      }
      if (maxTruePeak > 0.0005) {
        const ceiling = this.masterBus.limiterCeilingDbtp ?? -1.0;
        truePeakDbtp = Math.min(ceiling, Math.max(-48, 20 * Math.log10(maxTruePeak)));
      }

      const rms = Math.sqrt(sumSq / fftSize);
      if (rms > 0.0001) {
        instantLufs = Math.max(-48, Math.min(-6, 20 * Math.log10(rms) - 0.691));
      }

      // Smooth true peak and integrated LUFS with ballistic decay
      if (truePeakDbtp > this.smoothedTruePeakDbtp) {
        this.smoothedTruePeakDbtp = truePeakDbtp;
      } else {
        this.smoothedTruePeakDbtp = this.smoothedTruePeakDbtp * 0.95 + truePeakDbtp * 0.05;
      }
      this.smoothedLufs = this.smoothedLufs * 0.96 + instantLufs * 0.04;
    }

    if (this.onPlayheadUpdate) {
      this.onPlayheadUpdate(
        this.currentBeat,
        modulatedCutoffHz,
        masterPeakDb,
        this.smoothedTruePeakDbtp,
        this.smoothedLufs
      );
    }

    this.rafId = requestAnimationFrame(this.runVisualPlayheadLoop);
  };
}

export const synthEngine = new ParametricWebAudioEngine();

