import { OrderedAudioSum, connectOrderedSources } from './orderedAudioSum';
import {
  assertValidPpq,
  evaluatePlayableArrangementEvents,
  evaluatePlayableProjectEvents,
  evaluatePlayableSessionEvents,
  EvaluatedPlayableEvent,
  MusicalTimeService,
  noteIsInsideClip,
  noteProbabilityPasses,
  playbackRegion,
  positionAtBeat,
  sessionEventsInWindow,
  validateAndNormalizeMeterMap,
  validateAndNormalizeTempoMap,
} from './timelineCoordinates';
import {
  AbletonDevice,
  AbletonProjectState,
  AbletonTrack,
  AudioActiveRegion,
  AudioStripSilenceConfig,
  AutomationPoint,
  HumanizationConfig,
  MasterBusConfig,
  MidiNoteEvent,
  PlaybackEngineState,
  TempoAutomationPoint,
  TrackMixerParams,
  TransportConfig,
} from '../types/ableton';
import { composeEffectiveTrackGain, resolveEffectiveAudibility, assertExecutableInsertLimits } from './channelStripEngine';
import {
  classifyAbletonDeviceTag,
  computeDeviceParameterHash,
  evaluateTrackMidiDeviceChain,
  isAudioEffectInsertTag,
  isInstrumentDeviceTag,
  isMidiProcessorDeviceTag,
  readDeviceParamNumber,
  readDeviceParamString,
  verifyDeviceConversionRecord,
} from './abletonCapabilityMatrix';
import { computeDeterministicHash } from './alsXmlEngine';
import { assertProjectState } from './projectStateContracts';

function midiToFreq(midi: number, transposeSemitones = 0, fineTuneCents = 0): number {
  const totalSemitones = midi + transposeSemitones + fineTuneCents / 100;
  return 440 * Math.pow(2, (totalSemitones - 69) / 12);
}

export function shouldPlayNote(note: MidiNoteEvent): boolean {
  return noteProbabilityPasses(note);
}

function dbToGain(db: number): number {
  if (db <= -48) return 0;
  return Math.pow(10, db / 20);
}

/**
 * Evaluates the normalized automation envelope at an absolute arrangement beat.
 * Returns a normalized value in [0.0, 1.0].
 */
export function evaluateAutomationAtBeat(
  points: AutomationPoint[] | undefined,
  beat: number,
  maxBeats = Number.POSITIVE_INFINITY
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
export function createTransparentLimiterCurve(ceilingDbtp = -1.0): Float32Array<ArrayBuffer> {
  const samples = 2049;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  const ceilingLinear = Math.min(0.98, Math.max(0.2, Math.pow(10, ceilingDbtp / 20))); // ~0.891 for -1.0 dBTP
  const kneeLinear = ceilingLinear * 0.72; // ~0.64 (-3.8 dB)

  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1; // [-1.0, 1.0]
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
export function createSaturationCurve(driveAmount = 1.8): Float32Array<ArrayBuffer> {
  const samples = 1025;
  const curve = new Float32Array(new ArrayBuffer(samples * 4));
  const k = Math.max(0.5, driveAmount * 2.5);
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / (samples - 1) - 1;
    curve[i] = Math.tanh(x * k) / Math.tanh(k);
  }
  return curve;
}

/**
 * Creates a procedural stereo dark warehouse reverb impulse response.
 */
export function createSeededNoise(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    return (state >>> 0) / 2147483648 - 1;
  };
}

function createWarehouseReverbImpulse(
  ctx: BaseAudioContext,
  decaySeconds = 3.2
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * Math.max(0.8, Math.min(6.0, decaySeconds)));
  const impulse = ctx.createBuffer(2, length, sampleRate);

  const random = createSeededNoise(0x52455642);
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
      const rawNoise = random();
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
  const random = createSeededNoise(0x4e4f4953);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = random();
  }
  return buffer;
}

export interface InsertProcessorInstance {
  id: string;
  xmlTag?: string;
  type: string;
  bypassed: boolean;
  parameterHash: string;
  input: AudioNode;
  output: AudioNode;
  hasStatefulTail?: boolean;
  tailDecaySeconds?: number;
  getTailDecaySeconds?: () => number;
  updateParams?: (device: AbletonDevice, now: number) => void;
  muteInputForTailDecay?: (now: number) => void;
  dispose?: () => void;
}

export interface RetiringInsertChainEntry {
  retireAtAudioTime: number;
  startedAtAudioTime: number;
  chainInputGain: GainNode;
  chainOutputGain: GainNode;
  processors: InsertProcessorInstance[];
  disposed: boolean;
  disposeNow: () => void;
}

export interface TrackChannelRuntime {
  trackId: string;
  inputNode: GainNode;
  voiceSum: OrderedAudioSum;
  chainInputGain: GainNode;
  chainOutputGain: GainNode;
  insertProcessors: InsertProcessorInstance[];
  retiringChains: RetiringInsertChainEntry[];
  structuralSignature: string;
  reconciliationCount: number;
  disposedProcessorIds: string[];
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

export const MAX_RETAINED_DISPOSED_PROCESSOR_IDS = 64;
export const MAX_CONCURRENT_RETIRING_CHAINS = 4;

export function recordDisposedProcessorId(
  channel: Pick<TrackChannelRuntime, 'disposedProcessorIds'>,
  processorId: string
): void {
  const existingIdx = channel.disposedProcessorIds.indexOf(processorId);
  if (existingIdx >= 0) {
    channel.disposedProcessorIds.splice(existingIdx, 1);
  }
  channel.disposedProcessorIds.push(processorId);
  while (channel.disposedProcessorIds.length > MAX_RETAINED_DISPOSED_PROCESSOR_IDS) {
    channel.disposedProcessorIds.shift();
  }
}

export function pruneRetiringTrackChains(
  channel: TrackChannelRuntime,
  nowAudioTime: number
): number {
  if (!channel.retiringChains || channel.retiringChains.length === 0) return 0;
  let retiredCount = 0;
  channel.retiringChains = channel.retiringChains.filter((entry) => {
    if (entry.disposed) return false;
    if (nowAudioTime >= entry.retireAtAudioTime - 1e-6) {
      entry.disposeNow();
      retiredCount++;
      return false;
    }
    return true;
  });
  return retiredCount;
}

export function flushRetiringTrackChains(channel: TrackChannelRuntime): number {
  if (!channel.retiringChains || channel.retiringChains.length === 0) return 0;
  let flushedCount = 0;
  while (channel.retiringChains.length > 0) {
    const entry = channel.retiringChains.shift();
    if (entry && !entry.disposed) {
      entry.disposeNow();
      flushedCount++;
    }
  }
  return flushedCount;
}

interface AcidMonoVoiceState {start:number;end:number;startHz:number;targetHz:number;glideEnd:number;retire:(at?:number)=>void}
export function resolveAcidSlideStart(slide:boolean,time:number,targetHz:number,previous?:Omit<AcidMonoVoiceState,'retire'>):number {
  if(!slide||!previous||time<previous.start||time>previous.end)return targetHz;
  const fraction=Math.max(0,Math.min(1,(time-previous.start)/Math.max(.000001,previous.glideEnd-previous.start)));
  return previous.startHz*Math.pow(previous.targetHz/previous.startHz,fraction);
}
/** Sidechain control follows the actual routed source score and effective audibility. */
export function routedKickBeats(project:AbletonProjectState,receiver:AbletonTrack,fromBeat:number,toBeat:number):number[] {
  const sources=project.tracks.filter(t=>(receiver.spectralDucking?.sourceTrackId?t.id===receiver.spectralDucking.sourceTrackId:t.archetype==='kick')&&t.id!==receiver.id&&resolveEffectiveAudibility(t,project.tracks,project.vcaGroups||[]).isAudible);
  return sources.flatMap(t=>evaluatePlayableProjectEvents(project,Math.max(0,fromBeat),toBeat,{singleTrackId:t.id}).map(e=>e.note.time)).sort((a,b)=>a-b);
}

interface AudioBusGraph {
  acidMonoVoices?:Map<string,AcidMonoVoiceState>;
  dryBus: GainNode;
  drySum: OrderedAudioSum;
  reverbSum: OrderedAudioSum;
  delaySum: OrderedAudioSum;
  reverbSendBus: GainNode;
  delaySendBus: GainNode;
  masterGain: GainNode;
  delayNodeL: DelayNode;
  delayNodeR: DelayNode;
  delayFeedbackGain: GainNode;
  delayLeftTapGain: GainNode;
  reverbReturnGain: GainNode;
  delayReturnGain: GainNode;
  compressor: DynamicsCompressorNode;
  analyser?: AnalyserNode;
  withAnalyser?: boolean;
  trackChannels: Map<string, TrackChannelRuntime>;
  activeVoices: Set<() => void>;
  trackVoices?: Map<string, Set<(when?: number) => void>>;
  offlineRetirements: { at: number; nodes: AudioNode[]; releaseMix: () => void }[];
}

export function buildAudioBusGraph(
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

  // Master Glue Compressor (Gentle mastering bus dynamics control, 30ms punch attack)
  const compressor = ctx.createDynamicsCompressor();
  compressor.threshold.value = -18 - (masterBus.glueCompressionDrive || 0.35) * 6;
  compressor.knee.value = 10;
  compressor.ratio.value = 2.0 + (masterBus.glueCompressionDrive || 0.35) * 1.5;
  compressor.attack.value = 0.03;
  compressor.release.value = 0.1;

  // Oversampled waveshaper ceiling; this is not a separately qualified true-peak/lookahead limiter.
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
  reverbLpf.Q.value = -3.0103;

  const reverbReturnGain = ctx.createGain();
  reverbReturnGain.gain.value = masterBus.reverbReturnLevel * 0.85;

  reverbSendBus.connect(reverbHpf);
  reverbHpf.connect(reverbConvolver);
  reverbConvolver.connect(reverbLpf);
  reverbLpf.connect(reverbReturnGain);

  // Return B: Tempo-Synced 3/16 Stereo Ping-Pong Dub Echo
  const threeSixteenthSec = Math.max(0.08, Math.min(0.9, (60 / Math.max(90, tempo)) * 0.75));
  const delayNodeL = ctx.createDelay(2.0);
  const delayNodeR = ctx.createDelay(2.0);
  delayNodeL.delayTime.value = threeSixteenthSec;
  delayNodeR.delayTime.value = threeSixteenthSec * 2;

  const delayFilter = ctx.createBiquadFilter();
  delayFilter.type = 'bandpass';
  delayFilter.frequency.value = 1150;
  delayFilter.Q.value = 1.1;

  const delayFeedbackGain = ctx.createGain();
  delayFeedbackGain.gain.value = Math.min(0.82, Math.max(0.1, masterBus.delayFeedback));
  const delayLeftTapGain = ctx.createGain();
  delayLeftTapGain.gain.value = delayFeedbackGain.gain.value;

  const panL = ctx.createStereoPanner();
  const panR = ctx.createStereoPanner();
  panL.pan.value = -0.65;
  panR.pan.value = 0.65;

  const delayReturnGain = ctx.createGain();
  delayReturnGain.gain.value = masterBus.delayReturnLevel * 0.75;

  delaySendBus.connect(delayFilter);
  delayFilter.connect(delayNodeL);
  delayNodeL.connect(panL);
  // One feedback delay with a half-period output tap. Keep filtering outside
  // the cycle: native filter-containing cycles can change render-quantum order.
  delayFilter.connect(delayNodeR);
  delayNodeR.connect(panR);
  delayNodeR.connect(delayFeedbackGain);
  delayFeedbackGain.connect(delayNodeR);
  // Keep the loop gain's sole destination inside the cycle. A separate tap gain
  // preserves left repeats without making native cycle traversal depend on fan-out.
  delayNodeR.connect(delayLeftTapGain);
  delayLeftTapGain.connect(delayNodeL);

  panL.connect(delayReturnGain);
  panR.connect(delayReturnGain);

  // Mastering signal chain: subHpf -> glue compressor -> oversampled waveshaper -> masterGain
  connectOrderedSources(ctx, [sumHeadroomGain, reverbReturnGain, delayReturnGain], masterSubHpf);
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
    drySum: new OrderedAudioSum(ctx, dryBus),
    reverbSum: new OrderedAudioSum(ctx, reverbSendBus),
    delaySum: new OrderedAudioSum(ctx, delaySendBus),
    reverbSendBus,
    delaySendBus,
    masterGain,
    delayNodeL,
    delayNodeR,
    delayFeedbackGain,
    delayLeftTapGain,
    reverbReturnGain,
    delayReturnGain,
    compressor,
    analyser,
    withAnalyser,
    trackChannels: new Map<string, TrackChannelRuntime>(),
    activeVoices: new Set(),
    trackVoices: new Map(),
    offlineRetirements: [],
  };
}

export function buildDeviceInsertProcessor(
  ctx: BaseAudioContext,
  device: AbletonDevice
): InsertProcessorInstance {
  const rawTag = device.xmlTag || device.type || '';
  const parameterHash = computeDeviceParameterHash({
    xmlTag: rawTag,
    parameters: device.parameters || [],
  });

  if (device.bypassed) {
    const bypassGain = ctx.createGain();
    bypassGain.gain.value = 1.0;
    return {
      id: device.id,
      xmlTag: rawTag,
      type: rawTag,
      bypassed: true,
      parameterHash,
      input: bypassGain,
      output: bypassGain,
      dispose: () => {
        try {
          bypassGain.disconnect();
        } catch {
          /* already disconnected */
        }
      },
    };
  }

  const capabilityStatus = classifyAbletonDeviceTag(rawTag);
  if (
    rawTag &&
    (device.browserDspSupported === false ||
      capabilityStatus === 'unsupported' ||
      capabilityStatus === 'preserved-only')
  ) {
    throw new Error(
      `UNSUPPORTED_DEVICE: Cannot build browser insert processor for un-bypassed <${rawTag}> (${device.id}); bypass or remove the device first.`
    );
  }

  if (capabilityStatus === 'converted') {
    const verification = verifyDeviceConversionRecord({ ...device, xmlTag: rawTag });
    if (!verification.isValid) {
      throw new Error(
        `CONVERSION_REQUIRED: Cannot build converted processor for <${rawTag}> (${device.id}) with ${verification.status} conversion record (${verification.reason}).`
      );
    }
  }

  const tag = rawTag.toLowerCase();

  // Instruments, MIDI processors, and voice modulators execute in the MIDI/voice stage,
  // so their channel-strip slot acts as a unity bridge while preserving slot indexing.
  if (!isAudioEffectInsertTag(rawTag)) {
    const bridge = ctx.createGain();
    bridge.gain.value = 1.0;
    return {
      id: device.id,
      xmlTag: rawTag,
      type: rawTag || 'bridge',
      bypassed: false,
      parameterHash,
      input: bridge,
      output: bridge,
      dispose: () => {
        try {
          bridge.disconnect();
        } catch {
          /* already disconnected */
        }
      },
    };
  }

  const setAudioParamSmooth = (param: AudioParam, value: number, now: number) => {
    if (typeof param.setTargetAtTime === 'function' && now > 0) {
      param.setTargetAtTime(value, now, 0.012);
    } else {
      param.value = value;
    }
  };

  // 1. Utility (Gain + Stereo Balance + Mute)
  if (rawTag === 'Utility' || tag.includes('utility')) {
    const gainNode = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const applyUtility = (dev: AbletonDevice, now: number) => {
      const gainDb = readDeviceParamNumber(dev, 'Gain', 0);
      const balance = readDeviceParamNumber(dev, 'Balance', 0);
      const mute = readDeviceParamNumber(dev, 'Mute', 0) >= 0.5;
      const linear = mute ? 0 : dbToGain(gainDb);
      const pan = Math.max(-1, Math.min(1, balance / 50));
      setAudioParamSmooth(gainNode.gain, linear, now);
      setAudioParamSmooth(panner.pan, pan, now);
    };
    applyUtility(device, 0);
    gainNode.connect(panner);
    return {
      id: device.id,
      xmlTag: rawTag,
      type: 'utility',
      bypassed: false,
      parameterHash,
      input: gainNode,
      output: panner,
      updateParams: applyUtility,
      dispose: () => {
        for (const n of [gainNode, panner]) {
          try {
            n.disconnect();
          } catch {
            /* ignore */
          }
        }
      },
    };
  }

  // 2. EQ Eight (Band 1 HPF + Band 2 Surgical Notch/Peaking + Band 3 High Shelf)
  if (rawTag === 'EQEight' || tag.includes('eq')) {
    const hpf = ctx.createBiquadFilter();
    hpf.type = 'highpass';
    hpf.Q.value = 0.707;

    const notch = ctx.createBiquadFilter();
    notch.type = 'peaking';

    const high = ctx.createBiquadFilter();
    high.type = 'highshelf';
    high.frequency.value = 6500;
    high.gain.value = 0;

    const applyEq = (dev: AbletonDevice, now: number) => {
      const hpfHz = readDeviceParamNumber(dev, 'Band 1 HPF', 35);
      const notchHz = readDeviceParamNumber(dev, 'Sub Notch', 55);
      const notchGainDb = readDeviceParamNumber(dev, 'Notch Gain', -3.5);
      const notchQ = readDeviceParamNumber(dev, 'Notch Q', 2.4);
      setAudioParamSmooth(hpf.frequency, Math.max(20, Math.min(1000, hpfHz)), now);
      setAudioParamSmooth(notch.frequency, Math.max(30, Math.min(4000, notchHz)), now);
      setAudioParamSmooth(notch.gain, Math.max(-18, Math.min(18, notchGainDb)), now);
      setAudioParamSmooth(notch.Q, Math.max(0.3, Math.min(12, notchQ)), now);
    };
    applyEq(device, 0);

    hpf.connect(notch);
    notch.connect(high);
    return {
      id: device.id,
      xmlTag: rawTag,
      type: 'eq',
      bypassed: false,
      parameterHash,
      input: hpf,
      output: high,
      updateParams: applyEq,
      dispose: () => {
        for (const n of [hpf, notch, high]) {
          try {
            n.disconnect();
          } catch {
            /* ignore */
          }
        }
      },
    };
  }

  // 3. Auto Filter
  if (rawTag === 'AutoFilter' || tag.includes('filter')) {
    const filter = ctx.createBiquadFilter();
    const trimGain = ctx.createGain();
    const applyFilter = (dev: AbletonDevice, now: number) => {
      const fType = readDeviceParamString(dev, 'FilterType', 'Lowpass').toLowerCase();
      filter.type = fType.includes('high')
        ? 'highpass'
        : fType.includes('band')
        ? 'bandpass'
        : 'lowpass';
      const cutoff = readDeviceParamNumber(dev, 'Cutoff', 1800);
      const res = readDeviceParamNumber(dev, 'Resonance', 0.35);
      const envModDb = readDeviceParamNumber(dev, 'EnvMod', 0);
      setAudioParamSmooth(filter.frequency, Math.max(30, Math.min(18500, cutoff)), now);
      setAudioParamSmooth(filter.Q, Math.max(0.5, Math.min(14, 0.7 + res * 8.5)), now);
      setAudioParamSmooth(trimGain.gain, dbToGain(envModDb), now);
    };
    applyFilter(device, 0);
    filter.connect(trimGain);
    return {
      id: device.id,
      xmlTag: rawTag,
      type: 'filter',
      bypassed: false,
      parameterHash,
      input: filter,
      output: trimGain,
      updateParams: applyFilter,
      dispose: () => {
        for (const n of [filter, trimGain]) {
          try {
            n.disconnect();
          } catch {
            /* ignore */
          }
        }
      },
    };
  }

  // 4. Saturator
  if (rawTag === 'Saturator' || tag.includes('saturat')) {
    const inGain = ctx.createGain();
    const dryGain = ctx.createGain();
    const preDriveGain = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    const wetTrimGain = ctx.createGain();
    const outGain = ctx.createGain();

    const applySaturator = (dev: AbletonDevice, now: number) => {
      const driveDb = readDeviceParamNumber(dev, 'Drive', 8);
      const outputDb = readDeviceParamNumber(dev, 'Output', -2);
      const dryWetPct = readDeviceParamNumber(dev, 'DryWet', 100);
      const wet = Math.max(0, Math.min(1, dryWetPct <= 1 && dryWetPct > 0 ? dryWetPct : dryWetPct / 100));
      const driveFactor = Math.max(0.6, 1.0 + (driveDb / 12) * 1.8);
      shaper.curve = createSaturationCurve(driveFactor);
      setAudioParamSmooth(preDriveGain.gain, dbToGain(driveDb * 0.45), now);
      setAudioParamSmooth(wetTrimGain.gain, dbToGain(outputDb) * wet, now);
      setAudioParamSmooth(dryGain.gain, 1 - wet, now);
    };
    applySaturator(device, 0);

    inGain.connect(dryGain);
    dryGain.connect(outGain);
    inGain.connect(preDriveGain);
    preDriveGain.connect(shaper);
    shaper.connect(wetTrimGain);
    wetTrimGain.connect(outGain);

    return {
      id: device.id,
      xmlTag: rawTag,
      type: 'saturator',
      bypassed: false,
      parameterHash,
      input: inGain,
      output: outGain,
      updateParams: applySaturator,
      dispose: () => {
        for (const n of [inGain, dryGain, preDriveGain, shaper, wetTrimGain, outGain]) {
          try {
            n.disconnect();
          } catch {
            /* ignore */
          }
        }
      },
    };
  }

  // 5. Compressor2 / GlueCompressor
  if (rawTag === 'Compressor2' || rawTag === 'GlueCompressor' || tag.includes('compressor')) {
    const inGain = ctx.createGain();
    const dryGain = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    const makeupGain = ctx.createGain();
    const outGain = ctx.createGain();

    const applyCompressor = (dev: AbletonDevice, now: number) => {
      const isGlue = rawTag === 'GlueCompressor';
      const threshold = readDeviceParamNumber(dev, 'Threshold', isGlue ? -14 : -18);
      const ratio = readDeviceParamNumber(dev, 'Ratio', 4);
      const attackMs = readDeviceParamNumber(dev, 'Attack', isGlue ? 15 : 6);
      const releaseMs = readDeviceParamNumber(dev, 'Release', isGlue ? 110 : 90);
      const makeupDb = readDeviceParamNumber(
        dev,
        isGlue ? 'Makeup' : 'MakeupGain',
        isGlue ? 2 : 0
      );
      const dryWetPct = readDeviceParamNumber(dev, 'DryWet', 100);
      const wet = Math.max(0, Math.min(1, dryWetPct <= 1 && dryWetPct > 0 ? dryWetPct : dryWetPct / 100));

      setAudioParamSmooth(comp.threshold, Math.max(-60, Math.min(0, threshold)), now);
      setAudioParamSmooth(comp.ratio, Math.max(1, Math.min(20, ratio)), now);
      setAudioParamSmooth(comp.attack, Math.max(0.001, Math.min(0.2, attackMs / 1000)), now);
      setAudioParamSmooth(comp.release, Math.max(0.01, Math.min(1.0, releaseMs / 1000)), now);
      setAudioParamSmooth(makeupGain.gain, dbToGain(makeupDb) * wet, now);
      setAudioParamSmooth(dryGain.gain, 1 - wet, now);
    };
    applyCompressor(device, 0);

    inGain.connect(dryGain);
    dryGain.connect(outGain);
    inGain.connect(comp);
    comp.connect(makeupGain);
    makeupGain.connect(outGain);

    return {
      id: device.id,
      xmlTag: rawTag,
      type: 'compressor',
      bypassed: false,
      parameterHash,
      input: inGain,
      output: outGain,
      updateParams: applyCompressor,
      dispose: () => {
        for (const n of [inGain, dryGain, comp, makeupGain, outGain]) {
          try {
            n.disconnect();
          } catch {
            /* ignore */
          }
        }
      },
    };
  }

  // 6. Delay / Echo (Stateful Feedback Delay)
  if (rawTag === 'Delay' || rawTag === 'Echo' || tag.includes('delay') || tag.includes('echo')) {
    const inGain = ctx.createGain();
    const dryGain = ctx.createGain();
    const wetInputGate = ctx.createGain();
    wetInputGate.gain.value = 1.0;
    const delayNode = ctx.createDelay(2.0);
    const fbGain = ctx.createGain();
    const filterNode = ctx.createBiquadFilter();
    filterNode.type = 'lowpass';
    // Web Audio BiquadFilterNode 'lowpass' Q is in dB; -3.0103 dB = Butterworth maximally flat (no resonant peak > 1.0)
    filterNode.Q.value = -3.0103;
    const wetGain = ctx.createGain();
    const outGain = ctx.createGain();

    let tailDecaySeconds = 0.5;
    const applyDelay = (dev: AbletonDevice, now: number) => {
      const delayTimeMs = readDeviceParamNumber(dev, 'DelayTime', rawTag === 'Echo' ? 335 : 280);
      const rawFb = readDeviceParamNumber(dev, 'Feedback', rawTag === 'Echo' ? 0.42 : 0.35);
      const fb = Math.max(0, Math.min(0.88, rawFb > 1 ? rawFb / 100 : rawFb));
      const cutoffHz = readDeviceParamNumber(dev, 'FilterCutoff', 2600);
      const rawMix = readDeviceParamNumber(dev, 'DryWet', rawTag === 'Echo' ? 35 : 32);
      const wet = Math.max(0, Math.min(1, rawMix <= 1 && rawMix > 0 ? rawMix : rawMix / 100));
      const delaySec = Math.max(0.01, Math.min(1.5, delayTimeMs / 1000));
      tailDecaySeconds = Math.min(2.5, delaySec * (1 / Math.max(0.12, 1 - fb)));

      setAudioParamSmooth(delayNode.delayTime, delaySec, now);
      setAudioParamSmooth(fbGain.gain, fb, now);
      setAudioParamSmooth(filterNode.frequency, Math.max(300, Math.min(10000, cutoffHz)), now);
      setAudioParamSmooth(wetGain.gain, wet, now);
      setAudioParamSmooth(dryGain.gain, 1 - wet * 0.35, now);
    };
    applyDelay(device, 0);

    inGain.connect(dryGain);
    dryGain.connect(outGain);
    inGain.connect(wetInputGate);
    wetInputGate.connect(delayNode);
    delayNode.connect(filterNode);
    filterNode.connect(fbGain);
    fbGain.connect(delayNode);
    delayNode.connect(wetGain);
    wetGain.connect(outGain);

    return {
      id: device.id,
      xmlTag: rawTag,
      type: 'delay',
      bypassed: false,
      parameterHash,
      input: inGain,
      output: outGain,
      hasStatefulTail: true,
      get tailDecaySeconds() {
        return tailDecaySeconds;
      },
      getTailDecaySeconds: () => tailDecaySeconds,
      updateParams: applyDelay,
      muteInputForTailDecay: (now: number) => {
        setAudioParamSmooth(wetInputGate.gain, 0, now);
      },
      dispose: () => {
        fbGain.gain.value = 0;
        for (const n of [inGain, dryGain, wetInputGate, delayNode, fbGain, filterNode, wetGain, outGain]) {
          try {
            n.disconnect();
          } catch {
            /* ignore */
          }
        }
      },
    };
  }

  // 7. ChorusEnsemble (LFO Modulated Chorus)
  if (rawTag === 'ChorusEnsemble' || tag.includes('chorus')) {
    const inGain = ctx.createGain();
    const dryGain = ctx.createGain();
    const delayNode = ctx.createDelay(0.1);
    delayNode.delayTime.value = 0.015;
    const wetGain = ctx.createGain();
    const outGain = ctx.createGain();
    const lfo = typeof ctx.createOscillator === 'function' ? ctx.createOscillator() : null;
    if (lfo) lfo.type = 'sine';
    const lfoDepth = ctx.createGain();

    const applyChorus = (dev: AbletonDevice, now: number) => {
      const rateHz = readDeviceParamNumber(dev, 'Rate', 0.65);
      const amountPct = readDeviceParamNumber(dev, 'Amount', 50);
      const rawMix = readDeviceParamNumber(dev, 'DryWet', 45);
      const wet = Math.max(0, Math.min(1, rawMix <= 1 && rawMix > 0 ? rawMix : rawMix / 100));
      if (lfo) setAudioParamSmooth(lfo.frequency, Math.max(0.05, Math.min(8, rateHz)), now);
      setAudioParamSmooth(lfoDepth.gain, (Math.max(0, Math.min(100, amountPct)) / 100) * 0.008, now);
      setAudioParamSmooth(wetGain.gain, wet, now);
      setAudioParamSmooth(dryGain.gain, 1 - wet * 0.3, now);
    };
    applyChorus(device, 0);

    if (lfo) {
      lfo.connect(lfoDepth);
      lfoDepth.connect(delayNode.delayTime);
      lfo.start(Math.max(0, ctx.currentTime));
    }

    inGain.connect(dryGain);
    dryGain.connect(outGain);
    inGain.connect(delayNode);
    delayNode.connect(wetGain);
    wetGain.connect(outGain);

    return {
      id: device.id,
      xmlTag: rawTag,
      type: 'chorus',
      bypassed: false,
      parameterHash,
      input: inGain,
      output: outGain,
      updateParams: applyChorus,
      dispose: () => {
        if (lfo) {
          try {
            lfo.stop();
          } catch {
            /* ignore */
          }
          try {
            lfo.disconnect();
          } catch {
            /* ignore */
          }
        }
        for (const n of [lfoDepth, inGain, dryGain, delayNode, wetGain, outGain]) {
          try {
            n.disconnect();
          } catch {
            /* ignore */
          }
        }
      },
    };
  }

  // 8. Roar / Overdrive
  if (rawTag === 'Roar' || rawTag === 'Overdrive' || tag.includes('overdrive') || tag.includes('roar')) {
    const inGain = ctx.createGain();
    const dryGain = ctx.createGain();
    const driveGain = ctx.createGain();
    const shaper = ctx.createWaveShaper();
    const toneFilter = ctx.createBiquadFilter();
    toneFilter.type = rawTag === 'Overdrive' ? 'peaking' : 'lowpass';
    const wetGain = ctx.createGain();
    const outGain = ctx.createGain();

    const applyDistortion = (dev: AbletonDevice, now: number) => {
      const rawDrive = readDeviceParamNumber(dev, 'Drive', rawTag === 'Roar' ? 12 : 45);
      const normDrive = rawDrive <= 1.5 ? rawDrive * 18 : rawDrive;
      const toneHz = readDeviceParamNumber(dev, 'Tone', rawTag === 'Roar' ? 3200 : 2800);
      const outputDb = readDeviceParamNumber(dev, 'Output', -2);
      const rawMix = readDeviceParamNumber(dev, 'DryWet', 100);
      const wet = Math.max(0, Math.min(1, rawMix <= 1 && rawMix > 0 ? rawMix : rawMix / 100));

      shaper.curve = createSaturationCurve(1.1 + (normDrive / 25) * 2.2);
      setAudioParamSmooth(driveGain.gain, 1.0 + normDrive * 0.03, now);
      setAudioParamSmooth(toneFilter.frequency, Math.max(200, Math.min(12000, toneHz)), now);
      if (rawTag === 'Overdrive') {
        setAudioParamSmooth(toneFilter.gain, 4.5, now);
      }
      setAudioParamSmooth(wetGain.gain, dbToGain(outputDb) * wet, now);
      setAudioParamSmooth(dryGain.gain, 1 - wet, now);
    };
    applyDistortion(device, 0);

    inGain.connect(dryGain);
    dryGain.connect(outGain);
    inGain.connect(driveGain);
    driveGain.connect(shaper);
    shaper.connect(toneFilter);
    toneFilter.connect(wetGain);
    wetGain.connect(outGain);

    return {
      id: device.id,
      xmlTag: rawTag,
      type: 'distortion',
      bypassed: false,
      parameterHash,
      input: inGain,
      output: outGain,
      updateParams: applyDistortion,
      dispose: () => {
        for (const n of [inGain, dryGain, driveGain, shaper, toneFilter, wetGain, outGain]) {
          try {
            n.disconnect();
          } catch {
            /* ignore */
          }
        }
      },
    };
  }

  // 9. Limiter
  if (rawTag === 'Limiter' || tag.includes('limiter')) {
    const preGain = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.knee.value = 0;
    comp.ratio.value = 20.0;
    comp.attack.value = 0.001;
    const shaper = ctx.createWaveShaper();
    const ceilingGain = ctx.createGain();

    const applyLimiter = (dev: AbletonDevice, now: number) => {
      const gainDb = readDeviceParamNumber(dev, 'Gain', 0);
      const ceilingDb = readDeviceParamNumber(dev, 'Ceiling', -0.3);
      const releaseMs = readDeviceParamNumber(dev, 'Release', 85);
      shaper.curve = createTransparentLimiterCurve(ceilingDb);
      setAudioParamSmooth(preGain.gain, dbToGain(gainDb), now);
      setAudioParamSmooth(comp.threshold, Math.max(-24, Math.min(-0.1, ceilingDb)), now);
      setAudioParamSmooth(comp.release, Math.max(0.01, Math.min(0.5, releaseMs / 1000)), now);
      setAudioParamSmooth(ceilingGain.gain, 1, now);
    };
    applyLimiter(device, 0);

    preGain.connect(comp);
    comp.connect(shaper);
    shaper.connect(ceilingGain);

    return {
      id: device.id,
      xmlTag: rawTag,
      type: 'limiter',
      bypassed: false,
      parameterHash,
      input: preGain,
      output: ceilingGain,
      updateParams: applyLimiter,
      dispose: () => {
        for (const n of [preGain, comp, shaper, ceilingGain]) {
          try {
            n.disconnect();
          } catch {
            /* ignore */
          }
        }
      },
    };
  }

  // 10. DrumBuss (Converted Per-Insert Sub-Boom + Crunch Waveshaper + Damping)
  if (rawTag === 'DrumBuss') {
    const inGain = ctx.createGain();
    const dryGain = ctx.createGain();
    const boomFilter = ctx.createBiquadFilter();
    boomFilter.type = 'peaking';
    boomFilter.frequency.value = 54;
    boomFilter.Q.value = 2.2;
    const crunchFilter = ctx.createBiquadFilter();
    crunchFilter.type = 'peaking';
    crunchFilter.frequency.value = 1850;
    crunchFilter.Q.value = 1.4;
    const shaper = ctx.createWaveShaper();
    const dampFilter = ctx.createBiquadFilter();
    dampFilter.type = 'lowpass';
    const wetGain = ctx.createGain();
    const outGain = ctx.createGain();

    const applyDrumBuss = (dev: AbletonDevice, now: number) => {
      const rawDrive = readDeviceParamNumber(dev, 'Drive', 35);
      const drivePct = rawDrive <= 1 && rawDrive > 0 ? rawDrive * 100 : rawDrive;
      const rawBoom = readDeviceParamNumber(dev, 'Boom', 25);
      const boomPct = rawBoom <= 1 && rawBoom > 0 ? rawBoom * 100 : rawBoom;
      const crunchPct = readDeviceParamNumber(dev, 'Crunch', 20);
      const dampHz = readDeviceParamNumber(dev, 'Damp', 11000);
      const rawMix = readDeviceParamNumber(dev, 'DryWet', 100);
      const wet = Math.max(0, Math.min(1, rawMix <= 1 && rawMix > 0 ? rawMix : rawMix / 100));

      shaper.curve = createSaturationCurve(1.0 + (drivePct / 100) * 2.4);
      setAudioParamSmooth(boomFilter.gain, (boomPct / 100) * 9.0, now);
      setAudioParamSmooth(crunchFilter.gain, (crunchPct / 100) * 6.5, now);
      setAudioParamSmooth(dampFilter.frequency, Math.max(500, Math.min(20000, dampHz)), now);
      setAudioParamSmooth(wetGain.gain, wet * (1 + (drivePct / 100) * 0.15), now);
      setAudioParamSmooth(dryGain.gain, 1 - wet, now);
    };
    applyDrumBuss(device, 0);

    inGain.connect(dryGain);
    dryGain.connect(outGain);
    inGain.connect(boomFilter);
    boomFilter.connect(crunchFilter);
    crunchFilter.connect(shaper);
    shaper.connect(dampFilter);
    dampFilter.connect(wetGain);
    wetGain.connect(outGain);

    return {
      id: device.id,
      xmlTag: rawTag,
      type: 'drumbuss',
      bypassed: false,
      parameterHash,
      input: inGain,
      output: outGain,
      updateParams: applyDrumBuss,
      dispose: () => {
        for (const n of [inGain, dryGain, boomFilter, crunchFilter, shaper, dampFilter, wetGain, outGain]) {
          try {
            n.disconnect();
          } catch {
            /* ignore */
          }
        }
      },
    };
  }

  // 11. Reverb / HybridReverb (Converted Per-Insert Algorithmic Multi-Tap Diffuser with Independent Stable Comb Loops)
  if (rawTag === 'Reverb' || rawTag === 'HybridReverb') {
    const inGain = ctx.createGain();
    const dryGain = ctx.createGain();
    const wetInputGate = ctx.createGain();
    wetInputGate.gain.value = 1.0;
    const preDelay = ctx.createDelay(0.5);

    const delay1Sec = rawTag === 'HybridReverb' ? 0.043 : 0.037;
    const delay2Sec = rawTag === 'HybridReverb' ? 0.061 : 0.053;

    const comb1 = ctx.createDelay(0.2);
    comb1.delayTime.value = delay1Sec;
    const damp1 = ctx.createBiquadFilter();
    damp1.type = 'lowpass';
    // Butterworth non-resonant Q in dB (-3.0103 dB) ensures filter magnitude <= 1.0 at all frequencies
    damp1.Q.value = -3.0103;
    const fb1 = ctx.createGain();

    const comb2 = ctx.createDelay(0.2);
    comb2.delayTime.value = delay2Sec;
    const damp2 = ctx.createBiquadFilter();
    damp2.type = 'lowpass';
    damp2.Q.value = -3.0103;
    const fb2 = ctx.createGain();

    const wetGain = ctx.createGain();
    const outGain = ctx.createGain();

    let tailDecaySeconds = 2.4;
    const applyReverb = (dev: AbletonDevice, now: number) => {
      const rawDecay = readDeviceParamNumber(dev, 'DecayTime', rawTag === 'HybridReverb' ? 3.2 : 2.4);
      const decaySec = Math.max(0.2, Math.min(15, rawDecay));
      const preDelayMs = readDeviceParamNumber(dev, 'PreDelay', rawTag === 'HybridReverb' ? 24 : 18);
      const dampHz = readDeviceParamNumber(dev, 'HighCut', rawTag === 'HybridReverb' ? 5400 : 4800);
      const rawMix = readDeviceParamNumber(dev, 'DryWet', rawTag === 'HybridReverb' ? 40 : 35);
      const wet = Math.max(0, Math.min(1, rawMix <= 1 && rawMix > 0 ? rawMix : rawMix / 100));

      tailDecaySeconds = Math.min(15.0, decaySec);
      // Independently stable comb feedback derived from each comb's delay and requested T60:
      // g_i = 10^(-3 * delaySeconds_i / T60Seconds), bounded strictly below unity (<= 0.992)
      // so long DecayTime settings up to 15s produce distinct, monotonically longer tails.
      const g1 = computeStableCombFeedbackGain(delay1Sec, decaySec);
      const g2 = computeStableCombFeedbackGain(delay2Sec, decaySec);
      const clampedDampHz = Math.max(400, Math.min(16000, dampHz));

      setAudioParamSmooth(preDelay.delayTime, Math.max(0.001, Math.min(0.25, preDelayMs / 1000)), now);
      setAudioParamSmooth(damp1.frequency, clampedDampHz, now);
      setAudioParamSmooth(damp2.frequency, clampedDampHz, now);
      setAudioParamSmooth(fb1.gain, g1, now);
      setAudioParamSmooth(fb2.gain, g2, now);
      // Sum independent comb wet outputs outside the feedback loops with 0.5 per-comb normalization
      setAudioParamSmooth(wetGain.gain, wet * 0.5, now);
      setAudioParamSmooth(dryGain.gain, 1 - wet * 0.35, now);
    };
    applyReverb(device, 0);

    inGain.connect(dryGain);
    dryGain.connect(outGain);
    inGain.connect(wetInputGate);
    wetInputGate.connect(preDelay);

    // Independent Comb Loop 1: preDelay -> comb1 -> damp1 -> fb1 -> comb1
    preDelay.connect(comb1);
    comb1.connect(damp1);
    damp1.connect(fb1);
    fb1.connect(comb1);

    // Independent Comb Loop 2: preDelay -> comb2 -> damp2 -> fb2 -> comb2
    preDelay.connect(comb2);
    comb2.connect(damp2);
    damp2.connect(fb2);
    fb2.connect(comb2);

    // Sum wet outputs outside the independent feedback loops
    comb1.connect(wetGain);
    comb2.connect(wetGain);
    wetGain.connect(outGain);

    return {
      id: device.id,
      xmlTag: rawTag,
      type: 'reverb',
      bypassed: false,
      parameterHash,
      input: inGain,
      output: outGain,
      hasStatefulTail: true,
      get tailDecaySeconds() {
        return tailDecaySeconds;
      },
      getTailDecaySeconds: () => tailDecaySeconds,
      updateParams: applyReverb,
      muteInputForTailDecay: (now: number) => {
        setAudioParamSmooth(wetInputGate.gain, 0, now);
      },
      dispose: () => {
        fb1.gain.value = 0;
        fb2.gain.value = 0;
        for (const n of [inGain, dryGain, wetInputGate, preDelay, comb1, damp1, fb1, comb2, damp2, fb2, wetGain, outGain]) {
          try {
            n.disconnect();
          } catch {
            /* ignore */
          }
        }
      },
    };
  }

  // 12. AutoPan (Converted LFO Stereo Panner + Amplitude Tremolo)
  if (rawTag === 'AutoPan') {
    const inGain = ctx.createGain();
    const tremoloGain = ctx.createGain();
    const panner = ctx.createStereoPanner();
    const lfo = typeof ctx.createOscillator === 'function' ? ctx.createOscillator() : null;
    const panDepth = ctx.createGain();
    const tremDepth = ctx.createGain();

    const applyAutoPan = (dev: AbletonDevice, now: number) => {
      const rateHz = readDeviceParamNumber(dev, 'Rate', 1.5);
      const rawAmount = readDeviceParamNumber(dev, 'Amount', 65);
      const amountNorm = Math.max(0, Math.min(1, rawAmount <= 1 && rawAmount > 0 ? rawAmount : rawAmount / 100));
      const shape = readDeviceParamString(dev, 'Shape', 'Sine').toLowerCase();
      if (lfo) {
        lfo.type = shape.includes('tri') ? 'triangle' : 'sine';
        setAudioParamSmooth(lfo.frequency, Math.max(0.05, Math.min(20, rateHz)), now);
      }
      setAudioParamSmooth(panDepth.gain, amountNorm * 0.9, now);
      setAudioParamSmooth(tremDepth.gain, amountNorm * 0.35, now);
      setAudioParamSmooth(tremoloGain.gain, 1.0 - amountNorm * 0.2, now);
    };
    applyAutoPan(device, 0);

    if (lfo) {
      lfo.connect(panDepth);
      panDepth.connect(panner.pan);
      lfo.connect(tremDepth);
      tremDepth.connect(tremoloGain.gain);
      lfo.start(Math.max(0, ctx.currentTime));
    }

    inGain.connect(tremoloGain);
    tremoloGain.connect(panner);

    return {
      id: device.id,
      xmlTag: rawTag,
      type: 'autopan',
      bypassed: false,
      parameterHash,
      input: inGain,
      output: panner,
      updateParams: applyAutoPan,
      dispose: () => {
        if (lfo) {
          try {
            lfo.stop();
          } catch {
            /* ignore */
          }
          try {
            lfo.disconnect();
          } catch {
            /* ignore */
          }
        }
        for (const n of [panDepth, tremDepth, inGain, tremoloGain, panner]) {
          try {
            n.disconnect();
          } catch {
            /* ignore */
          }
        }
      },
    };
  }

  // 13. Erosion (Converted Short-Delay Audio-Rate FM Grit Processor)
  if (rawTag === 'Erosion') {
    const inGain = ctx.createGain();
    const dryGain = ctx.createGain();
    const modDelay = ctx.createDelay(0.05);
    modDelay.delayTime.value = 0.003;
    const gritShaper = ctx.createWaveShaper();
    const wetGain = ctx.createGain();
    const outGain = ctx.createGain();
    const modOsc = typeof ctx.createOscillator === 'function' ? ctx.createOscillator() : null;
    if (modOsc) modOsc.type = 'sine';
    const modBand = ctx.createBiquadFilter();
    modBand.type = 'bandpass';
    const modDepth = ctx.createGain();

    const applyErosion = (dev: AbletonDevice, now: number) => {
      const freqHz = readDeviceParamNumber(dev, 'Frequency', 2400);
      const rawAmount = readDeviceParamNumber(dev, 'Amount', 40);
      const amountNorm = Math.max(0, Math.min(1, rawAmount <= 1 && rawAmount > 0 ? rawAmount : rawAmount / 100));
      const widthQ = readDeviceParamNumber(dev, 'Width', 2.0);
      if (modOsc) setAudioParamSmooth(modOsc.frequency, Math.max(100, Math.min(14000, freqHz)), now);
      setAudioParamSmooth(modBand.frequency, Math.max(100, Math.min(14000, freqHz)), now);
      setAudioParamSmooth(modBand.Q, Math.max(0.3, Math.min(8, widthQ)), now);
      setAudioParamSmooth(modDepth.gain, amountNorm * 0.0022, now);
      gritShaper.curve = createSaturationCurve(1.0 + amountNorm * 2.0);
      setAudioParamSmooth(wetGain.gain, amountNorm * 0.85, now);
      setAudioParamSmooth(dryGain.gain, 1.0 - amountNorm * 0.35, now);
    };
    applyErosion(device, 0);

    if (modOsc) {
      modOsc.connect(modBand);
      modBand.connect(modDepth);
      modDepth.connect(modDelay.delayTime);
      modOsc.start(Math.max(0, ctx.currentTime));
    }

    inGain.connect(dryGain);
    dryGain.connect(outGain);
    inGain.connect(modDelay);
    modDelay.connect(gritShaper);
    gritShaper.connect(wetGain);
    wetGain.connect(outGain);

    return {
      id: device.id,
      xmlTag: rawTag,
      type: 'erosion',
      bypassed: false,
      parameterHash,
      input: inGain,
      output: outGain,
      updateParams: applyErosion,
      dispose: () => {
        if (modOsc) {
          try {
            modOsc.stop();
          } catch {
            /* ignore */
          }
          try {
            modOsc.disconnect();
          } catch {
            /* ignore */
          }
        }
        for (const n of [modBand, modDepth, inGain, dryGain, modDelay, gritShaper, wetGain, outGain]) {
          try {
            n.disconnect();
          } catch {
            /* ignore */
          }
        }
      },
    };
  }

  const pass = ctx.createGain();
  pass.gain.value = 1.0;
  return {
    id: device.id,
    xmlTag: rawTag,
    type: 'passthrough',
    bypassed: false,
    parameterHash,
    input: pass,
    output: pass,
    dispose: () => {
      try {
        pass.disconnect();
      } catch {
        /* ignore */
      }
    },
  };
}

function computeTrackChainStructuralSignature(devices: readonly AbletonDevice[]): string {
  return devices.map((d) => `${d.id}:${d.xmlTag || d.type || ''}:${Boolean(d.bypassed)}`).join('|');
}

export function getOrCreateTrackChannelRuntime(
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
  // Inserts own their DSP gain in order. The channel owns only mixer/VCA gain.
  const targetFaderLinear = audibility.effectiveGainLinear;
  const targetGateLinear = audibility.isAudible ? 1.0 : 0.0;
  const targetPan = Math.max(-1, Math.min(1, mixer.pan || 0));
  const targetRev = Math.max(0, Math.min(1, mixer.reverbSend || 0));
  const targetDel = Math.max(0, Math.min(1, mixer.delaySend || 0));
  const targetCutoff = Math.max(40, Math.min(18000, mixer.filterCutoffHz || 1200));

  const devices = track.devices || [];
  const nextSignature = computeTrackChainStructuralSignature(devices);

  if (!channel) {
    const inputNode = ctx.createGain();
    const chainInputGain = ctx.createGain();
    const chainOutputGain = ctx.createGain();
    const insertProcessors: InsertProcessorInstance[] = [];

    inputNode.connect(chainInputGain);
    let lastNode: AudioNode = chainInputGain;

    for (const dev of devices) {
      const proc = buildDeviceInsertProcessor(ctx, dev);
      insertProcessors.push(proc);
      lastNode.connect(proc.input);
      lastNode = proc.output;
    }

    lastNode.connect(chainOutputGain);

    const faderGain = ctx.createGain();
    faderGain.gain.value = targetFaderLinear;

    chainOutputGain.connect(faderGain);

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
      bus.drySum.add(analyser);
    } else {
      bus.drySum.add(panner);
    }

    panner.connect(reverbSendGain);
    bus.reverbSum.add(reverbSendGain);

    panner.connect(delaySendGain);
    bus.delaySum.add(delaySendGain);

    channel = {
      trackId: track.id,
      inputNode,
      voiceSum: new OrderedAudioSum(ctx, inputNode),
      chainInputGain,
      chainOutputGain,
      insertProcessors,
      retiringChains: [],
      structuralSignature: nextSignature,
      reconciliationCount: 0,
      disposedProcessorIds: [],
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
    pruneRetiringTrackChains(channel, now);

    // Reconcile insert device chain:
    if (channel.structuralSignature === nextSignature) {
      // Same device chain topology & bypass states: update AudioParams in place if parameters changed
      for (let i = 0; i < devices.length; i++) {
        const dev = devices[i];
        const proc = channel.insertProcessors[i];
        if (!proc) continue;
        const nextHash = computeDeviceParameterHash({
          xmlTag: dev.xmlTag || dev.type || '',
          parameters: dev.parameters || [],
        });
        if (proc.parameterHash !== nextHash) {
          if (classifyAbletonDeviceTag(dev.xmlTag || dev.type || '') === 'converted' && !dev.bypassed) {
            const verification = verifyDeviceConversionRecord(dev);
            if (!verification.isValid) {
              throw new Error(
                `CONVERSION_REQUIRED: ${track.name} contains converted device <${dev.xmlTag}> (${dev.id}) with ${verification.status} conversion record (${verification.reason}).`
              );
            }
          }
          proc.updateParams?.(dev, now);
          proc.parameterHash = nextHash;
        }
      }
    } else {
      // Structural chain change (insertion, deletion, reorder, or bypass toggle):
      // 1. Build and validate new processor chain BEFORE disconnecting the old chain.
      const nextProcessors: InsertProcessorInstance[] = [];
      try {
        for (const dev of devices) {
          nextProcessors.push(buildDeviceInsertProcessor(ctx, dev));
        }
      } catch (err) {
        for (const built of nextProcessors) {
          built.dispose?.();
        }
        throw err;
      }

      const nextChainInput = ctx.createGain();
      const nextChainOutput = ctx.createGain();
      let cursorNode: AudioNode = nextChainInput;
      for (const proc of nextProcessors) {
        cursorNode.connect(proc.input);
        cursorNode = proc.output;
      }
      cursorNode.connect(nextChainOutput);

      // Click-safe audio-clock transition without unintended gain boost
      if (now > 0 && typeof nextChainOutput.gain.setValueAtTime === 'function') {
        nextChainOutput.gain.setValueAtTime(0.0001, now);
        nextChainOutput.gain.linearRampToValueAtTime(1.0, now + 0.012);
      } else {
        nextChainOutput.gain.value = 1.0;
      }

      channel.inputNode.connect(nextChainInput);
      nextChainOutput.connect(channel.faderGain);

      const prevChainInput = channel.chainInputGain;
      const prevChainOutput = channel.chainOutputGain;
      const prevProcessors = channel.insertProcessors;

      // Stop feeding new dry input into the old chain immediately
      try {
        channel.inputNode.disconnect(prevChainInput);
      } catch {
        prevChainInput.gain.value = 0;
      }

      const statefulProcessors = prevProcessors.filter((p) => p.hasStatefulTail && !p.bypassed);
      const hasActiveTail = statefulProcessors.length > 0;
      let maxTailDecaySeconds = 0;
      for (const oldProc of statefulProcessors) {
        oldProc.muteInputForTailDecay?.(now);
        const tailSec = oldProc.getTailDecaySeconds?.() ?? oldProc.tailDecaySeconds ?? 0.5;
        if (tailSec > maxTailDecaySeconds) {
          maxTailDecaySeconds = tailSec;
        }
      }

      const disposeOldChain = () => {
        for (const oldProc of prevProcessors) {
          oldProc.dispose?.();
          recordDisposedProcessorId(channel!, oldProc.id);
        }
        try {
          prevChainInput.disconnect();
        } catch {
          /* ignore */
        }
        try {
          prevChainOutput.disconnect();
        } catch {
          /* ignore */
        }
      };

      if (!hasActiveTail || now <= 0) {
        disposeOldChain();
      } else {
        const boundedTailSec = Math.max(0.08, Math.min(15.0, maxTailDecaySeconds));
        const retireAtAudioTime = now + boundedTailSec;
        if (typeof prevChainOutput.gain.setValueAtTime === 'function') {
          prevChainOutput.gain.setValueAtTime(1.0, now);
          prevChainOutput.gain.linearRampToValueAtTime(0.0001, retireAtAudioTime);
        } else if (typeof prevChainOutput.gain.setTargetAtTime === 'function') {
          prevChainOutput.gain.setTargetAtTime(0.0001, now, boundedTailSec / 4);
        }

        const entry: RetiringInsertChainEntry = {
          retireAtAudioTime,
          startedAtAudioTime: now,
          chainInputGain: prevChainInput,
          chainOutputGain: prevChainOutput,
          processors: prevProcessors,
          disposed: false,
          disposeNow: () => {
            if (entry.disposed) return;
            entry.disposed = true;
            disposeOldChain();
          },
        };

        // Bound maximum concurrent retiring chains per track (max 4)
        while (channel.retiringChains.length >= MAX_CONCURRENT_RETIRING_CHAINS) {
          const oldest = channel.retiringChains.shift();
          oldest?.disposeNow();
        }
        channel.retiringChains.push(entry);

        bus.offlineRetirements.push({
          at: retireAtAudioTime,
          nodes: [prevChainInput, prevChainOutput],
          releaseMix: () => entry.disposeNow(),
        });
      }

      channel.chainInputGain = nextChainInput;
      channel.chainOutputGain = nextChainOutput;
      channel.insertProcessors = nextProcessors;
      channel.structuralSignature = nextSignature;
      channel.reconciliationCount += 1;
    }

    if (channel.currentFaderLinear !== targetFaderLinear) channel.faderGain.gain.setTargetAtTime(targetFaderLinear, now, 0.012);
    if (channel.currentGateLinear !== targetGateLinear) channel.muteSoloGate.gain.setTargetAtTime(targetGateLinear, now, 0.008);
    if (channel.currentPan !== targetPan) channel.panner.pan.setTargetAtTime(targetPan, now, 0.012);
    if (channel.currentReverbSend !== targetRev) channel.reverbSendGain.gain.setTargetAtTime(targetRev, now, 0.015);
    if (channel.currentDelaySend !== targetDel) channel.delaySendGain.gain.setTargetAtTime(targetDel, now, 0.015);
    if (channel.insertFilter && channel.currentCutoffHz !== targetCutoff) {
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
 * Resolves the track's active instrument device and synthesis parameters while keeping
 * `track.archetype` as the compositional role.
 * - If all instrument devices on the track are bypassed, or if the track's instrument was removed, returns `active: false` (silence).
 * - If the track's instrument was replaced with another Ableton instrument (`Operator`, `UltraAnalog`, `InstrumentVector`, `Drift`, `Collision`, `OriginalSimpler`, `DrumGroupDevice`), dispatches to that instrument's synthesis engine.
 */
export interface ResolvedTrackInstrumentSpec {
  active: boolean;
  instrumentTag: string;
  synthesisRole: 'kick' | 'rumble' | 'acid' | 'percussion' | 'ride' | 'hats' | 'pad' | 'synth';
  pitchOffsetSemitones: number;
  decayScale: number;
  cutoffScale: number;
  resonanceAdd: number;
  driveScale: number;
  detuneCentsOverride?: number;
  waveformOverride?: OscillatorType;
}

export function resolveTrackInstrumentSynthesis(track: AbletonTrack): ResolvedTrackInstrumentSpec {
  const defaultRole: ResolvedTrackInstrumentSpec['synthesisRole'] =
    track.archetype === 'existing' ? 'synth' : track.archetype;

  const instrumentDevices = (track.devices || []).filter((d) =>
    isInstrumentDeviceTag(d.xmlTag || d.type || '')
  );

  if (instrumentDevices.length === 0) {
    // A MIDI track whose instrument device has been explicitly deleted (either instrumentDeleted
    // or non-instrument devices remain after removing the instrument) produces no synthesized audio.
    // An unconfigured empty device chain (devices: []) falls back to archetype synthesis.
    if (
      track.type === 'midi' &&
      (Boolean(track.instrumentDeleted) || (track.devices && track.devices.length > 0))
    ) {
      return {
        active: false,
        instrumentTag: 'none',
        synthesisRole: defaultRole,
        pitchOffsetSemitones: 0,
        decayScale: 1,
        cutoffScale: 1,
        resonanceAdd: 0,
        driveScale: 1,
      };
    }
    return {
      active: true,
      instrumentTag: track.type === 'midi' ? defaultRole : 'AudioTrack',
      synthesisRole: defaultRole,
      pitchOffsetSemitones: 0,
      decayScale: 1,
      cutoffScale: 1,
      resonanceAdd: 0,
      driveScale: 1,
    };
  }

  const activeInst = [...instrumentDevices].reverse().find((d) => !d.bypassed);
  if (!activeInst) {
    return {
      active: false,
      instrumentTag: instrumentDevices[0].xmlTag,
      synthesisRole: defaultRole,
      pitchOffsetSemitones: 0,
      decayScale: 1,
      cutoffScale: 1,
      resonanceAdd: 0,
      driveScale: 1,
    };
  }

  const tag = activeInst.xmlTag || activeInst.type || '';
  let synthesisRole: ResolvedTrackInstrumentSpec['synthesisRole'] = defaultRole;
  if (tag === 'Operator') {
    synthesisRole = 'rumble';
  } else if (tag === 'UltraAnalog') {
    synthesisRole = 'acid';
  } else if (tag === 'InstrumentVector') {
    synthesisRole = 'synth';
  } else if (tag === 'Drift') {
    synthesisRole = 'pad';
  } else if (tag === 'Collision') {
    synthesisRole = 'percussion';
  } else if (tag === 'OriginalSimpler') {
    synthesisRole = track.archetype === 'ride' ? 'ride' : 'hats';
  } else if (tag === 'DrumGroupDevice') {
    synthesisRole =
      track.archetype === 'percussion' || track.archetype === 'hats' || track.archetype === 'ride'
        ? track.archetype
        : 'kick';
  }

  let pitchOffsetSemitones = 0;
  let decayScale = 1.0;
  let cutoffScale = 1.0;
  let resonanceAdd = 0.0;
  let driveScale = 1.0;
  let detuneCentsOverride: number | undefined;
  let waveformOverride: OscillatorType | undefined;

  for (const param of activeInst.parameters || []) {
    const pName = param.name.trim().toLowerCase();
    const numVal = typeof param.value === 'number' ? param.value : Number.parseFloat(String(param.value));
    if ((pName === 'pitch' || pName === 'transpose' || pName === 'coarse') && Number.isFinite(numVal)) {
      pitchOffsetSemitones += Math.max(-24, Math.min(24, numVal));
    } else if ((pName === 'decay' || pName === 'strikedecay') && Number.isFinite(numVal)) {
      const baseDecay = tag === 'OriginalSimpler' ? 0.18 : tag === 'Collision' ? 0.28 : 0.42;
      if (Math.abs(numVal - baseDecay) > 0.01) {
        decayScale = Math.max(0.25, Math.min(3.5, numVal / baseDecay));
      }
    } else if ((pName === 'filtercutoffhz' || pName === 'cutoff') && Number.isFinite(numVal)) {
      const baseCut =
        tag === 'DrumGroupDevice'
          ? 4500
          : tag === 'OriginalSimpler'
          ? 7500
          : tag === 'Collision'
          ? 2600
          : tag === 'InstrumentVector'
          ? 2200
          : 1800;
      if (Math.abs(numVal - baseCut) > 25) {
        cutoffScale = Math.max(0.25, Math.min(3.5, numVal / baseCut));
      }
    } else if ((pName === 'filterresonance' || pName === '303reso' || pName === 'resonance') && Number.isFinite(numVal)) {
      if (Math.abs(numVal - 0.82) > 0.02 && Math.abs(numVal - 0.35) > 0.02) {
        resonanceAdd = Math.max(-0.3, Math.min(0.6, numVal - 0.4));
      }
    } else if ((pName === 'macrocontrols.0' || pName === 'drive' || pName === 'punch') && Number.isFinite(numVal)) {
      if (Math.abs(numVal - 80) > 15) {
        driveScale = Math.max(0.4, Math.min(2.2, 0.5 + (numVal / 127) * 1.2));
      }
    } else if ((pName === 'osc a level' || pName === 'accent') && Number.isFinite(numVal)) {
      if (Math.abs(numVal - 0.92) > 0.05 && Math.abs(numVal - 0.65) > 0.05) {
        driveScale = Math.max(0.3, Math.min(2.2, numVal * 1.3));
      }
    } else if ((pName === 'detune' || pName === 'drift mod') && Number.isFinite(numVal)) {
      if (Math.abs(numVal - 14) > 1 && Math.abs(numVal - 0.48) > 0.05) {
        detuneCentsOverride = numVal <= 1 ? numVal * 35 : numVal;
      }
    } else if (pName === 'osc a wave' || pName === 'osc 1 wave') {
      const w = String(param.value).toLowerCase();
      if (w.includes('sq')) waveformOverride = 'square';
      else if (w.includes('tri')) waveformOverride = 'triangle';
      else if (w.includes('saw')) waveformOverride = 'sawtooth';
      else if (w.includes('sin')) waveformOverride = 'sine';
    }
  }

  return {
    active: true,
    instrumentTag: tag,
    synthesisRole,
    pitchOffsetSemitones,
    decayScale,
    cutoffScale,
    resonanceAdd,
    driveScale,
    detuneCentsOverride,
    waveformOverride,
  };
}

// Analysis approximation only; never apply to the native production graph.
function estimateInsertChainGainMultiplier(track: AbletonTrack): {
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
      const gainDb = readDeviceParamNumber(dev, 'Gain', 0);
      const mute = readDeviceParamNumber(dev, 'Mute', 0) >= 0.5;
      gainMultiplier *= mute ? 0 : dbToGain(gainDb);
    } else if (tag === 'Saturator' || tag === 'Roar' || tag === 'Overdrive' || tag === 'DrumBuss') {
      const rawDrive = readDeviceParamNumber(dev, 'Drive', 6);
      const driveVal = rawDrive <= 1.5 ? rawDrive * 10 : rawDrive;
      const boomVal = tag === 'DrumBuss' ? readDeviceParamNumber(dev, 'Boom', 0) : 0;
      saturationBoost += Math.max(0.15, Math.min(18, driveVal)) * 0.08 + (boomVal / 100) * 0.25;
      gainMultiplier *= 1 + Math.max(0.2, Math.min(18, driveVal)) * 0.035 + (boomVal / 100) * 0.12;
    } else if (tag === 'Limiter') {
      const ceilDb = readDeviceParamNumber(dev, 'Ceiling', -0.3);
      const gainDb = readDeviceParamNumber(dev, 'Gain', 0);
      gainMultiplier *= dbToGain(gainDb * 0.5);
      limiterCeilingLinear = Math.min(limiterCeilingLinear, dbToGain(ceilDb));
    } else if (tag === 'Compressor2' || tag === 'GlueCompressor') {
      const makeupDb = readDeviceParamNumber(dev, tag === 'GlueCompressor' ? 'Makeup' : 'MakeupGain', 0);
      gainMultiplier *= 0.96 * dbToGain(makeupDb * 0.5);
    } else if (tag === 'AutoFilter') {
      const cutoffHz = readDeviceParamNumber(dev, 'Cutoff', 1800);
      const fType = readDeviceParamString(dev, 'FilterType', 'Lowpass').toLowerCase();
      if (fType.includes('high') && cutoffHz > 500) {
        gainMultiplier *= Math.max(0.25, 1 - Math.min(0.65, (cutoffHz - 500) / 8000));
      } else if (cutoffHz < 600) {
        gainMultiplier *= Math.max(0.35, 0.55 + (cutoffHz / 600) * 0.45);
      }
    } else if (tag === 'EQEight') {
      const notchGainDb = readDeviceParamNumber(dev, 'Notch Gain', -3.5);
      gainMultiplier *= dbToGain(notchGainDb * 0.18);
    } else if (tag === 'Reverb' || tag === 'HybridReverb' || tag === 'Delay' || tag === 'Echo' || tag === 'ChorusEnsemble') {
      const mix = readDeviceParamNumber(dev, 'DryWet', 35);
      const normMix = mix <= 1 && mix > 0 ? mix : mix / 100;
      gainMultiplier *= 1 + normMix * 0.12;
    } else if (tag === 'AutoPan' || tag === 'Erosion') {
      const amt = readDeviceParamNumber(dev, 'Amount', 40);
      const normAmt = amt <= 1 && amt > 0 ? amt : amt / 100;
      gainMultiplier *= 1 + (tag === 'Erosion' ? normAmt * 0.15 : -normAmt * 0.1);
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
  project?: AbletonProjectState,
  stopAtSeconds?: number
) {
  const instSpec = resolveTrackInstrumentSynthesis(track);
  if (!instSpec.active) {
    // Ensure channel runtime is still created/reconciled even if the instrument is bypassed or deleted
    getOrCreateTrackChannelRuntime(ctx, bus, track, project);
    return;
  }

  const nodes: AudioNode[] = [];
  const sources: AudioScheduledSourceNode[] = [];
  let latestStop = ctx.currentTime;
  const stopTimes=new Map<AudioScheduledSourceNode,number>();
  const offline = typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext;
  const own = <T extends AudioNode>(node: T): T => { nodes.push(node); return node; };
  const source = <T extends AudioScheduledSourceNode>(node: T): T => {
    const stop = node.stop.bind(node);
    node.stop = (when = 0) => { latestStop = Math.max(latestStop, when); stopTimes.set(node,when); stop(when); };
    sources.push(node); return own(node);
  };
  const time = Math.max(ctx.currentTime, whenSec);
  const velNorm = Math.max(0.05, Math.min(1, note.velocity / 127));
  const velGain = Math.pow(velNorm, 1.35) * instSpec.driveScale;
  const durSec = Math.max(0.045, (note.duration / beatsPerSecond) * instSpec.decayScale);

  const rawMixer = track.mixer || {
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
  const mixer: TrackMixerParams = {
    ...rawMixer,
    transposeSemitones: (rawMixer.transposeSemitones || 0) + instSpec.pitchOffsetSemitones,
    filterCutoffHz: Math.max(40, Math.min(18000, (rawMixer.filterCutoffHz || 800) * instSpec.cutoffScale)),
    filterResonance: Math.max(0.05, Math.min(0.98, (rawMixer.filterCutoffHz ? rawMixer.filterResonance : 0.3) + instSpec.resonanceAdd)),
  };

  // Check active Lfo device on track for modulation overrides
  const activeLfoDev = (track.devices || []).find((d) => !d.bypassed && d.xmlTag === 'Lfo');
  const effLfoRate = activeLfoDev
    ? readDeviceParamNumber(activeLfoDev, 'Rate', humanization.lfoRateHz)
    : humanization.lfoRateHz;
  const effLfoDepth = activeLfoDev
    ? readDeviceParamNumber(activeLfoDev, 'Depth', humanization.lfoDepth)
    : humanization.lfoDepth;

  const autoNorm = evaluateAutomationAtBeat(track.automationPoints, note.time, (project?.arrangementLengthBars || 16) * 4);
  const lfoPhase = Math.sin(2 * Math.PI * effLfoRate * time);
  const lfoModFactor = 1 + lfoPhase * effLfoDepth * 0.45;

  const scDepth = Math.max(0, Math.min(1, mixer.sidechainDepth));
  const kickBeats = project && instSpec.synthesisRole !== 'kick'
    ? routedKickBeats(project,track,Math.max(0,note.time-.5),note.time+durSec*beatsPerSecond) : [];
  const recent=kickBeats.filter(beat=>beat<=note.time).at(-1);
  const elapsed=recent===undefined?Infinity:(note.time-recent)/beatsPerSecond;
  const isNearKick=elapsed<.18;
  const trackChannel = getOrCreateTrackChannelRuntime(ctx, bus, track, project);
  const voiceEnvelopeGain = own(ctx.createGain());
  const reduction=scDepth*.72;
  const startDuck=1-reduction*Math.max(0,1-elapsed/.18);
  voiceEnvelopeGain.gain.setValueAtTime(startDuck,time);
  if(isNearKick)voiceEnvelopeGain.gain.linearRampToValueAtTime(1,time+.18-elapsed);
  for(const beat of kickBeats){if(beat<note.time)continue;const at=time+(beat-note.time)/beatsPerSecond;
    voiceEnvelopeGain.gain.setValueAtTime(1,Math.max(time,at-.004));
    voiceEnvelopeGain.gain.linearRampToValueAtTime(1-reduction,at+.004);
    voiceEnvelopeGain.gain.linearRampToValueAtTime(1,at+.18);
  }

  // Optional Spectral Auto-Ducking EQEight Fundamental Notch node
  let voiceDestination: AudioNode = voiceEnvelopeGain;
  if (track.spectralDucking?.enabled && instSpec.synthesisRole !== 'kick') {
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

  // Route voice through persistent per-track channel strip so live fader/pan/mute/solo/send changes
  // immediately affect sustaining audio without waiting for next note event
  const releaseMix = trackChannel.voiceSum.add(voiceEnvelopeGain);

  if (instSpec.synthesisRole === 'kick') {
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
    shaper.curve = createSaturationCurve(1.65 * instSpec.driveScale);

    bodyOsc.type = 'sine';
    bodyOsc.frequency.setValueAtTime(158 * pitchRatio, time);
    bodyOsc.frequency.exponentialRampToValueAtTime(52 * pitchRatio, time + 0.042);
    bodyOsc.frequency.exponentialRampToValueAtTime(36 * pitchRatio, time + 0.28 * instSpec.decayScale);

    subOsc.type = 'triangle';
    subOsc.frequency.setValueAtTime(78 * pitchRatio, time);
    subOsc.frequency.exponentialRampToValueAtTime(36 * pitchRatio, time + 0.18 * instSpec.decayScale);

    const subBlend = own(ctx.createGain());
    subBlend.gain.setValueAtTime(0.28 * velGain, time);
    subBlend.gain.exponentialRampToValueAtTime(0.001, time + 0.24 * instSpec.decayScale);

    clickOsc.type = 'triangle';
    clickOsc.frequency.setValueAtTime(1150 * pitchRatio, time);
    clickOsc.frequency.exponentialRampToValueAtTime(140 * pitchRatio, time + 0.014);

    clickGain.gain.setValueAtTime(0.36 * velGain, time);
    clickGain.gain.exponentialRampToValueAtTime(0.001, time + 0.016);

    const kickEnd = Math.max(0.31, Math.min(durSec, 0.85)) * instSpec.decayScale;
    bodyGain.gain.setValueAtTime(0.001, time);
    bodyGain.gain.linearRampToValueAtTime(0.92 * velGain, time + 0.003);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, time + kickEnd);

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
    bodyOsc.stop(time + kickEnd + 0.02);
    subOsc.stop(time + kickEnd + 0.02);
    clickOsc.stop(time + 0.02);
  } else if (instSpec.synthesisRole === 'rumble') {
    // =========================================================================
    // 2. OPERATOR SUB-BASS RUMBLE (Fundamental Sine + FM Harmonic + 24dB LPF)
    // =========================================================================
    const freq = midiToFreq(note.pitch, mixer.transposeSemitones, mixer.fineTuneCents);
    const oscFund = source(ctx.createOscillator());
    const oscHarm = source(ctx.createOscillator());
    const filter1 = own(ctx.createBiquadFilter());
    const filter2 = own(ctx.createBiquadFilter());
    const voiceGain = own(ctx.createGain());

    oscFund.type = instSpec.waveformOverride || 'sine';
    oscFund.frequency.setValueAtTime(freq, time);

    oscHarm.type = 'sawtooth';
    oscHarm.frequency.setValueAtTime(freq * 2, time);

    const harmGain = own(ctx.createGain());
    harmGain.gain.setValueAtTime(0.24 * (0.6 + autoNorm * 0.7) * instSpec.driveScale, time);

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
  } else if (instSpec.synthesisRole === 'acid') {
    // =========================================================================
    // 3. TB-303 ACID RESONANT BASSLINE (Saw + Square Blend + 24dB Diode Filter + Slide + Roar Overdrive)
    // =========================================================================
    const freq = midiToFreq(note.pitch, mixer.transposeSemitones, mixer.fineTuneCents);
    const isAccent = Boolean(note.isAccent || note.velocity >= 108);
    bus.acidMonoVoices ??= new Map();
    const previousMono = bus.acidMonoVoices.get(track.id);
    const startFreq = resolveAcidSlideStart(Boolean(note.isSlide),time,freq,previousMono);
    const isSlide = Boolean(note.isSlide) && startFreq !== freq;
    previousMono?.retire(time);

    const oscSaw = source(ctx.createOscillator());
    const oscSq = source(ctx.createOscillator());
    const sqBlend = own(ctx.createGain());
    const diodeFilter1 = own(ctx.createBiquadFilter());
    const diodeFilter2 = own(ctx.createBiquadFilter());
    const shaper = own(ctx.createWaveShaper());
    const voiceGain = own(ctx.createGain());

    oscSaw.type = instSpec.waveformOverride || 'sawtooth';
    oscSq.type = 'square';
    sqBlend.gain.setValueAtTime(0.32, time);

    if (isSlide) {
      // Explicit articulation starts at the preceding sounding oscillator pitch.
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

    shaper.curve = createSaturationCurve((isAccent ? 2.4 : 1.75) * instSpec.driveScale);

    const releaseSec = isSlide ? durSec + 0.09 : durSec + 0.03;
    // Resonance adds substantial filter energy: compensate continuously, retain accent contrast.
    const resonanceCompensation = 1 / Math.sqrt(1 + mixer.filterResonance * 3);
    const peakGain = (isAccent ? 0.38 : 0.32) * velGain * resonanceCompensation;
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
  } else if (instSpec.synthesisRole === 'percussion') {
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

    const decay = Math.max(0.08, Math.min(0.65, durSec * 1.1));
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
  } else if (instSpec.synthesisRole === 'ride') {
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
    metalBus.gain.exponentialRampToValueAtTime(0.001, time + 0.28 * instSpec.decayScale);

    const oscs = ratios.map((freqRatio) => {
      const o = source(ctx.createOscillator());
      o.type = 'square';
      o.frequency.setValueAtTime(freqRatio * pitchShift, time);
      return o;
    });

    connectOrderedSources(ctx, oscs, metalBus, own);
    const bandpass = own(ctx.createBiquadFilter());
    bandpass.type = 'bandpass';
    bandpass.frequency.setValueAtTime((isBell ? 3800 : 2900) * pitchShift, time);
    bandpass.Q.setValueAtTime(1.6, time);

    const hpf = own(ctx.createBiquadFilter());
    hpf.type = 'highpass';
    hpf.frequency.setValueAtTime(Math.max(650, (mixer.filterCutoffHz || 4800) * 0.8), time);

    const decaySec = (0.34 + velGain * 0.25) * (0.75 + autoNorm * 0.45) * instSpec.decayScale;
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
    oscs.forEach((o) => o.stop(time + 0.3 * instSpec.decayScale));
  } else if (instSpec.synthesisRole === 'hats') {
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

    const decayTime =
      (isOpenHat
        ? (0.14 + velGain * 0.22) * (0.75 + autoNorm * 0.5)
        : (0.032 + velGain * 0.048) * (0.8 + autoNorm * 0.4)) * instSpec.decayScale;

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
  } else if (instSpec.synthesisRole === 'pad') {
    // =========================================================================
    // 7. DUB TECHNO ATMOSPHERIC PAD (Warm Detuned Saw/Triangle + Slow LPF Sweep)
    // =========================================================================
    const rootFreq = midiToFreq(note.pitch, mixer.transposeSemitones, mixer.fineTuneCents);
    const osc1 = source(ctx.createOscillator());
    const osc2 = source(ctx.createOscillator());
    const filter = own(ctx.createBiquadFilter());
    const voiceGain = own(ctx.createGain());

    const padDetune = instSpec.detuneCentsOverride ?? 9;
    osc1.type = 'sawtooth';
    osc1.frequency.setValueAtTime(rootFreq, time);
    osc1.detune.setValueAtTime(-padDetune, time);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(rootFreq, time);
    osc2.detune.setValueAtTime(padDetune, time);

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
    // 8. PITCH-FAITHFUL WAVETABLE STAB (3 Detuned Oscillators + Filter Env)
    // =========================================================================
    const rootFreq = midiToFreq(note.pitch, mixer.transposeSemitones, mixer.fineTuneCents);
    const oscRoot = source(ctx.createOscillator());
    const oscDetune = source(ctx.createOscillator());
    const oscChord = source(ctx.createOscillator());
    const filter = own(ctx.createBiquadFilter());
    const voiceGain = own(ctx.createGain());

    const stabDetune = instSpec.detuneCentsOverride ?? 11;
    oscRoot.type = 'sawtooth';
    oscRoot.frequency.setValueAtTime(rootFreq, time);

    oscDetune.type = 'sawtooth';
    oscDetune.frequency.setValueAtTime(rootFreq, time);
    oscDetune.detune.setValueAtTime(stabDetune, time);

    oscChord.type = 'triangle';
    oscChord.frequency.setValueAtTime(rootFreq, time);
    oscChord.detune.setValueAtTime(-Math.round(stabDetune * 0.65), time);

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

    oscChord.connect(chordSubGain);
    connectOrderedSources(ctx, [oscRoot, oscDetune, chordSubGain], filter, own);
    filter.connect(voiceGain);
    voiceGain.connect(voiceDestination);

    oscRoot.start(time);
    oscDetune.start(time);
    oscChord.start(time);
    oscRoot.stop(time + releaseTime + 0.02);
    oscDetune.stop(time + releaseTime + 0.02);
    oscChord.stop(time + releaseTime + 0.02);
  }
  if (offline) bus.offlineRetirements.push({ at: latestStop + 1, nodes, releaseMix });
  let remaining = sources.length;
  const retire = (at=ctx.currentTime) => {
    at=Math.max(ctx.currentTime,at);
    const mono=bus.acidMonoVoices?.get(track.id);
    if(mono?.start===time) mono.end=Math.min(mono.end,at);
    voiceEnvelopeGain.gain.cancelScheduledValues?.(at);
    voiceEnvelopeGain.gain.setTargetAtTime(0.0001, at, 0.004);
    for (const node of sources) { try { node.stop(Math.min(stopTimes.get(node) ?? Infinity,at + 0.025)); } catch { /* already stopped */ } }
  };
  if(instSpec.synthesisRole==='acid') {
    const targetHz=midiToFreq(note.pitch,mixer.transposeSemitones,mixer.fineTuneCents);
    const previous=bus.acidMonoVoices?.get(track.id);
    const startHz=resolveAcidSlideStart(Boolean(note.isSlide),time,targetHz,previous);
    const state:AcidMonoVoiceState={start:time,end:time+note.duration/beatsPerSecond,startHz,targetHz,glideEnd:time+.062,retire:(at=ctx.currentTime)=>{retire(at);state.end=Math.min(state.end,at);}};
    bus.acidMonoVoices?.set(track.id,state);
  }
  bus.activeVoices.add(retire);
  bus.trackVoices ??= new Map();
  const voices=bus.trackVoices.get(track.id) || new Set<(when?:number)=>void>();
  voices.add(retire);bus.trackVoices.set(track.id,voices);
  if (stopAtSeconds!==undefined && Number.isFinite(stopAtSeconds) && stopAtSeconds<latestStop) retire(stopAtSeconds);
  for (const node of sources) node.onended = () => {
    remaining--;
    if (remaining === 0) {
      // onended delivery depends on main-thread timing. Offline cleanup happens only
      // at deterministic audio-clock boundaries, preserving reproducible filter tails.
      if (!offline) { releaseMix(); for (const owned of nodes) owned.disconnect(); }
      bus.activeVoices.delete(retire);
      voices.delete(retire);
      if (!voices.size) bus.trackVoices?.delete(track.id);
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
 * - Analysis previews and lightweight Vitest fixtures only
 * This approximation is never production WAV export or live/offline parity evidence.
 * - Track-level waveform rendering for SelectedTrackAnalysisStrip
 */
export function computeStableCombFeedbackGain(delaySeconds: number, t60Seconds: number): number {
  const safeDelay = Math.max(0.001, delaySeconds);
  const safeT60 = Math.max(0.1, t60Seconds);
  return Math.min(0.992, Math.max(0.05, Math.pow(10, (-3 * safeDelay) / safeT60)));
}

function applyDiscreteDeviceTailEffectsInPlace(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  devices: readonly AbletonDevice[]
): void {
  const activeTailDevices = devices.filter(
    (d) =>
      !d.bypassed &&
      (d.xmlTag === 'Reverb' ||
        d.xmlTag === 'HybridReverb' ||
        d.xmlTag === 'Delay' ||
        d.xmlTag === 'Echo')
  );
  if (activeTailDevices.length === 0) return;

  const frames = left.length;
  for (const dev of activeTailDevices) {
    const tag = dev.xmlTag;
    if (tag === 'Reverb' || tag === 'HybridReverb') {
      const rawDecay = readDeviceParamNumber(dev, 'DecayTime', tag === 'HybridReverb' ? 3.2 : 2.4);
      const decaySec = Math.max(0.2, Math.min(15, rawDecay));
      const preDelayMs = readDeviceParamNumber(dev, 'PreDelay', tag === 'HybridReverb' ? 24 : 18);
      const dampHz = Math.max(400, Math.min(16000, readDeviceParamNumber(dev, 'HighCut', tag === 'HybridReverb' ? 5400 : 4800)));
      const rawMix = readDeviceParamNumber(dev, 'DryWet', tag === 'HybridReverb' ? 40 : 35);
      const wet = Math.max(0, Math.min(1, rawMix <= 1 && rawMix > 0 ? rawMix : rawMix / 100));

      const preSamples = Math.max(1, Math.min(Math.floor(0.25 * sampleRate), Math.round((preDelayMs / 1000) * sampleRate)));
      const d1Sec = tag === 'HybridReverb' ? 0.043 : 0.037;
      const d2Sec = tag === 'HybridReverb' ? 0.061 : 0.053;
      const d1Samples = Math.max(1, Math.round(d1Sec * sampleRate));
      const d2Samples = Math.max(1, Math.round(d2Sec * sampleRate));
      const g1 = computeStableCombFeedbackGain(d1Sec, decaySec);
      const g2 = computeStableCombFeedbackGain(d2Sec, decaySec);
      const alpha = Math.min(1, Math.max(0.02, 1 - Math.exp((-2 * Math.PI * dampHz) / sampleRate)));
      const dryScale = 1 - wet * 0.35;
      const wetScale = wet * 0.5;

      for (const ch of [left, right]) {
        const preBuf = new Float32Array(preSamples);
        const comb1Buf = new Float32Array(d1Samples);
        const comb2Buf = new Float32Array(d2Samples);
        let preIdx = 0;
        let c1Idx = 0;
        let c2Idx = 0;
        let lp1 = 0;
        let lp2 = 0;

        for (let i = 0; i < frames; i++) {
          const x = ch[i];
          const delayedIn = preBuf[preIdx];
          preBuf[preIdx] = x;
          preIdx = (preIdx + 1) % preSamples;

          const y1 = comb1Buf[c1Idx];
          lp1 = lp1 + alpha * (y1 - lp1);
          comb1Buf[c1Idx] = delayedIn + lp1 * g1;
          c1Idx = (c1Idx + 1) % d1Samples;

          const y2 = comb2Buf[c2Idx];
          lp2 = lp2 + alpha * (y2 - lp2);
          comb2Buf[c2Idx] = delayedIn + lp2 * g2;
          c2Idx = (c2Idx + 1) % d2Samples;

          ch[i] = x * dryScale + (y1 + y2) * wetScale;
        }
      }
    } else if (tag === 'Delay' || tag === 'Echo') {
      const delayTimeMs = readDeviceParamNumber(dev, 'DelayTime', tag === 'Echo' ? 335 : 280);
      const rawFb = readDeviceParamNumber(dev, 'Feedback', tag === 'Echo' ? 0.42 : 0.35);
      const fb = Math.max(0, Math.min(0.88, rawFb > 1 ? rawFb / 100 : rawFb));
      const cutoffHz = Math.max(300, Math.min(10000, readDeviceParamNumber(dev, 'FilterCutoff', 2600)));
      const rawMix = readDeviceParamNumber(dev, 'DryWet', tag === 'Echo' ? 35 : 32);
      const wet = Math.max(0, Math.min(1, rawMix <= 1 && rawMix > 0 ? rawMix : rawMix / 100));
      const delaySec = Math.max(0.01, Math.min(1.5, delayTimeMs / 1000));
      const delaySamples = Math.max(1, Math.round(delaySec * sampleRate));
      const alpha = Math.min(1, Math.max(0.02, 1 - Math.exp((-2 * Math.PI * cutoffHz) / sampleRate)));
      const dryScale = 1 - wet * 0.35;

      for (const ch of [left, right]) {
        const delayBuf = new Float32Array(delaySamples);
        let dIdx = 0;
        let lp = 0;
        for (let i = 0; i < frames; i++) {
          const x = ch[i];
          const y = delayBuf[dIdx];
          lp = lp + alpha * (y - lp);
          delayBuf[dIdx] = x + lp * fb;
          dIdx = (dIdx + 1) % delaySamples;
          ch[i] = x * dryScale + y * wet;
        }
      }
    }
  }
}

function analyzeImpulseTailMetrics(
  left: Float32Array,
  sampleRate: number
): {
  allFinite: boolean;
  firstNonFiniteFrame: number;
  peak: number;
  windowRms: number[];
  estimatedT60Seconds: number;
  tailDecaysMonotonically: boolean;
} {
  const frames = left.length;
  let allFinite = true;
  let firstNonFiniteFrame = -1;
  let peak = 0;
  for (let i = 0; i < frames; i++) {
    const v = left[i];
    if (!Number.isFinite(v)) {
      allFinite = false;
      if (firstNonFiniteFrame < 0) firstNonFiniteFrame = i;
    } else {
      const a = Math.abs(v);
      if (a > peak) peak = a;
    }
  }

  const tailStart = Math.min(frames - 4, Math.floor(0.26 * sampleRate));
  const windowLen = Math.max(64, Math.floor((frames - tailStart) / 4));
  const windowRms: number[] = [];
  for (let w = 0; w < 4; w++) {
    const start = tailStart + w * windowLen;
    const end = Math.min(frames, start + windowLen);
    let sumSq = 0;
    let count = 0;
    for (let i = start; i < end; i++) {
      const s = Number.isFinite(left[i]) ? left[i] : 0;
      sumSq += s * s;
      count++;
    }
    windowRms.push(count > 0 ? Math.sqrt(sumSq / count) : 0);
  }

  let estimatedT60Seconds = 0;
  if (
    allFinite &&
    windowRms.length === 4 &&
    windowRms[0] > 1e-7 &&
    windowRms[3] > 1e-12 &&
    windowRms[0] > windowRms[3]
  ) {
    const dbDrop = 20 * Math.log10(windowRms[0] / windowRms[3]);
    const spanSeconds = (3 * windowLen) / sampleRate;
    if (dbDrop > 1e-6) {
      estimatedT60Seconds = Number(((60 / dbDrop) * spanSeconds).toFixed(4));
    }
  }

  const tailDecaysMonotonically =
    allFinite &&
    windowRms.length === 4 &&
    windowRms[3] <= windowRms[0] + 1e-6 &&
    windowRms[2] <= windowRms[0] * 1.05 + 1e-6;

  return {
    allFinite,
    firstNonFiniteFrame,
    peak,
    windowRms,
    estimatedT60Seconds,
    tailDecaysMonotonically,
  };
}

/**
 * Renders a unit impulse followed by silence through discrete-time exact feedback topology
 * to certify finite samples, bounded peak, and monotonic tail decay.
 */
export function renderDeviceImpulseResponse(
  device: AbletonDevice,
  durationSeconds = 3.0,
  sampleRate = 24000
): {
  samples: Float32Array;
  allFinite: boolean;
  firstNonFiniteFrame: number;
  peak: number;
  windowRms: number[];
  estimatedT60Seconds: number;
  tailDecaysMonotonically: boolean;
} {
  const frames = Math.max(512, Math.ceil(durationSeconds * sampleRate));
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  left[0] = 1.0;
  right[0] = 1.0;

  if (!device.bypassed) {
    applyDiscreteDeviceTailEffectsInPlace(left, right, sampleRate, [device]);
  }

  const metrics = analyzeImpulseTailMetrics(left, sampleRate);
  return {
    samples: left,
    ...metrics,
  };
}

export interface NativeOfflineImpulseResponseResult {
  samples: Float32Array;
  rightSamples: Float32Array;
  sampleRate: number;
  durationSeconds: number;
  allFinite: boolean;
  firstNonFiniteFrame: number;
  peak: number;
  windowRms: number[];
  estimatedT60Seconds: number;
  tailDecaysMonotonically: boolean;
  executedVia: 'native-offline-audio-context' | 'processor-graph-extracted-simulation';
  processorSummary: {
    id: string;
    xmlTag: string;
    type: string;
    bypassed: boolean;
    hasStatefulTail: boolean;
    tailDecaySeconds: number;
    feedbackGains: number[];
    delayTimesSeconds: number[];
    dampingCutoffsHz: number[];
    dampingQDb: number[];
  };
}

/**
 * Instantiates the production `buildDeviceInsertProcessor` factory inside a real `OfflineAudioContext`
 * (when available in Chromium/WebKit) and captures the constructed Web Audio node parameters.
 * Never sanitizes NaN/Infinity samples.
 */
export async function renderNativeOfflineDeviceImpulseResponse(
  device: AbletonDevice,
  durationSeconds = 3.0,
  sampleRate = 24000,
  options?: {
    updateParamsAtSecond?: { atSecond: number; updatedDevice: AbletonDevice };
    muteTailAtSecond?: number;
  }
): Promise<NativeOfflineImpulseResponseResult> {
  const frames = Math.max(512, Math.ceil(durationSeconds * sampleRate));
  const capturedGains: { value: number }[] = [];
  const capturedDelays: { value: number }[] = [];
  const capturedFilters: { type: string; frequency: { value: number }; Q: { value: number } }[] = [];

  // 1. Inspect the production buildDeviceInsertProcessor node graph construction
  const probeCtx: Record<string, unknown> = {
    currentTime: 0,
    sampleRate,
    createGain: () => {
      const gainParam = {
        value: 1,
        setValueAtTime: (v: number) => {
          gainParam.value = v;
        },
        setTargetAtTime: (v: number) => {
          gainParam.value = v;
        },
        linearRampToValueAtTime: (v: number) => {
          gainParam.value = v;
        },
      };
      capturedGains.push(gainParam);
      return {
        gain: gainParam,
        connect: () => {},
        disconnect: () => {},
      };
    },
    createDelay: () => {
      const delayParam = {
        value: 0,
        setValueAtTime: (v: number) => {
          delayParam.value = v;
        },
        setTargetAtTime: (v: number) => {
          delayParam.value = v;
        },
      };
      capturedDelays.push(delayParam);
      return {
        delayTime: delayParam,
        connect: () => {},
        disconnect: () => {},
      };
    },
    createBiquadFilter: () => {
      const filterNode = {
        type: 'lowpass',
        frequency: {
          value: 1000,
          setValueAtTime: (v: number) => {
            filterNode.frequency.value = v;
          },
          setTargetAtTime: (v: number) => {
            filterNode.frequency.value = v;
          },
        },
        Q: {
          value: 0.707,
          setValueAtTime: (v: number) => {
            filterNode.Q.value = v;
          },
          setTargetAtTime: (v: number) => {
            filterNode.Q.value = v;
          },
        },
        gain: {
          value: 0,
          setValueAtTime: () => {},
          setTargetAtTime: () => {},
        },
        connect: () => {},
        disconnect: () => {},
      };
      capturedFilters.push(filterNode);
      return filterNode;
    },
    createWaveShaper: () => ({
      curve: null,
      oversample: 'none',
      connect: () => {},
      disconnect: () => {},
    }),
    createDynamicsCompressor: () => ({
      threshold: { value: -18, setTargetAtTime: () => {} },
      knee: { value: 6, setTargetAtTime: () => {} },
      ratio: { value: 4, setTargetAtTime: () => {} },
      attack: { value: 0.01, setTargetAtTime: () => {} },
      release: { value: 0.1, setTargetAtTime: () => {} },
      connect: () => {},
      disconnect: () => {},
    }),
    createStereoPanner: () => ({
      pan: { value: 0, setTargetAtTime: () => {} },
      connect: () => {},
      disconnect: () => {},
    }),
    createOscillator: () => ({
      type: 'sine',
      frequency: { value: 1, setTargetAtTime: () => {} },
      connect: () => {},
      disconnect: () => {},
      start: () => {},
      stop: () => {},
    }),
  };

  const probeProc = buildDeviceInsertProcessor(probeCtx as unknown as BaseAudioContext, device);
  if (options?.updateParamsAtSecond) {
    probeProc.updateParams?.(
      options.updateParamsAtSecond.updatedDevice,
      options.updateParamsAtSecond.atSecond
    );
  }
  const processorSummary = {
    id: probeProc.id,
    xmlTag: probeProc.xmlTag || device.xmlTag,
    type: probeProc.type,
    bypassed: probeProc.bypassed,
    hasStatefulTail: Boolean(probeProc.hasStatefulTail),
    tailDecaySeconds: probeProc.getTailDecaySeconds?.() ?? probeProc.tailDecaySeconds ?? 0,
    feedbackGains: capturedGains
      .map((g) => Number(g.value.toFixed(6)))
      .filter((v) => v > 0.04 && v < 0.995),
    delayTimesSeconds: capturedDelays.map((d) => Number(d.value.toFixed(6))),
    dampingCutoffsHz: capturedFilters.map((f) => Number(f.frequency.value.toFixed(2))),
    dampingQDb: capturedFilters.map((f) => Number(f.Q.value.toFixed(4))),
  };
  probeProc.dispose?.();

  // 2. When real OfflineAudioContext is available, render through the native Web Audio graph
  if (typeof OfflineAudioContext === 'function') {
    const offlineCtx = new OfflineAudioContext(2, frames, sampleRate);
    const impulseBuffer = offlineCtx.createBuffer(2, frames, sampleRate);
    impulseBuffer.getChannelData(0)[0] = 1.0;
    impulseBuffer.getChannelData(1)[0] = 1.0;

    const src = offlineCtx.createBufferSource();
    src.buffer = impulseBuffer;
    const liveProc = buildDeviceInsertProcessor(offlineCtx, device);
    src.connect(liveProc.input);
    liveProc.output.connect(offlineCtx.destination);
    src.start(0);

    if (options?.updateParamsAtSecond && options.updateParamsAtSecond.atSecond > 0) {
      liveProc.updateParams?.(
        options.updateParamsAtSecond.updatedDevice,
        options.updateParamsAtSecond.atSecond
      );
    }
    if (options?.muteTailAtSecond !== undefined && options.muteTailAtSecond >= 0) {
      liveProc.muteInputForTailDecay?.(options.muteTailAtSecond);
    }

    const rendered = await offlineCtx.startRendering();
    liveProc.dispose?.();
    const ch0 = rendered.getChannelData(0);
    const ch1 = rendered.getChannelData(1);
    const metrics = analyzeImpulseTailMetrics(ch0, sampleRate);
    return {
      samples: ch0,
      rightSamples: ch1,
      sampleRate,
      durationSeconds,
      ...metrics,
      executedVia: 'native-offline-audio-context',
      processorSummary,
    };
  }

  // 3. In headless/JSDOM unit environments without native OfflineAudioContext, execute the
  // processor graph parameters extracted from buildDeviceInsertProcessor
  const effectiveDevice = options?.updateParamsAtSecond
    ? options.updateParamsAtSecond.updatedDevice
    : device;
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  left[0] = 1.0;
  right[0] = 1.0;
  if (!effectiveDevice.bypassed) {
    applyDiscreteDeviceTailEffectsInPlace(left, right, sampleRate, [effectiveDevice]);
  }
  const metrics = analyzeImpulseTailMetrics(left, sampleRate);
  return {
    samples: left,
    rightSamples: right,
    sampleRate,
    durationSeconds,
    ...metrics,
    executedVia: 'processor-graph-extracted-simulation',
    processorSummary,
  };
}

export interface CompiledTrackScheduleEntry {
  trackId: string;
  signature: string;
  events: EvaluatedPlayableEvent[];
}

export interface CompiledArrangementSchedule {
  maxBeats: number;
  tempo: number;
  tempoMapSignature: string;
  trackEntries: Map<string, CompiledTrackScheduleEntry>;
  events: EvaluatedPlayableEvent[];
  cursorIndex: number;
  cursorBeat: number;
  cursorLoopGeneration: number;
  totalCompilations: number;
  totalTrackRebuilds: number;
  lastCompileDurationMs: number;
}

export interface SchedulerWindowQueryResult {
  windowEvents: EvaluatedPlayableEvent[];
  wrapEvents: EvaluatedPlayableEvent[];
  visitedCount: number;
  totalCompiledEvents: number;
  usedIndexedCursor: boolean;
  rebuiltTracksCount: number;
  queryDurationMs: number;
}

export function computeTrackScheduleSignature(track: AbletonTrack): string {
  const clipsPart = (track.clips || [])
    .map((clip) => {
      const notes = clip.notes || [];
      let noteChecksum = notes.length;
      for (let i = 0; i < notes.length; i++) {
        const n = notes[i];
        noteChecksum =
          (Math.imul(noteChecksum ^ Math.round(n.time * 960), 16777619) ^
            Math.round(n.duration * 960) ^
            (n.pitch << 8) ^
            n.velocity ^
            (n.harmonicOwner==='voiced-midi'?1<<20:0) ^
            (n.isSlide?1<<21:0) ^
            (n.isAccent?1<<22:0) ^
            Math.round((n.probability ?? 1) * 1000)) >>>
          0;
      }
      return `${clip.id}:${clip.startTime}:${clip.length}:${clip.loopEndBeats ?? 0}:${notes.length}:${noteChecksum}`;
    })
    .join(';');

  const midiDevicesPart = (track.devices || [])
    .filter((d) => isMidiProcessorDeviceTag(d.xmlTag))
    .map((d) => {
      const rec = d.conversionRecord;
      const descKeys = rec?.generatedDescriptor
        ? Object.entries(rec.generatedDescriptor)
            .map(([k, v]) => `${k}=${v}`)
            .sort()
            .join(',')
        : '';
      return `${d.id}:${d.xmlTag}:${Boolean(d.bypassed)}:${computeDeviceParameterHash(d)}:${rec?.status ?? 'none'}:${rec?.conversionVersion ?? 0}:${rec?.sourceParameterHash ?? ''}:${descKeys}`;
    })
    .join('|');

  return `${track.id}::${clipsPart}::${midiDevicesPart}`;
}

export function findFirstEventIndexAtOrAfterBeat(
  events: readonly EvaluatedPlayableEvent[],
  targetBeat: number
): number {
  let lo = 0;
  let hi = events.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (events[mid].beat < targetBeat) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

export function compileOrUpdateArrangementSchedule(
  project: AbletonProjectState,
  maxBeats: number,
  existing: CompiledArrangementSchedule | null
): { schedule: CompiledArrangementSchedule; rebuiltTracksCount: number } {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const tempoMapSig = project.tempoMap
    ? project.tempoMap.map((p) => `${p.beat}:${p.bpm}:${p.curve || 'step'}`).join(';')
    : '';
  const globalTimingChanged =
    !existing ||
    existing.maxBeats !== maxBeats ||
    existing.tempo !== project.tempo ||
    existing.tempoMapSignature !== tempoMapSig;

  const prevEntries = globalTimingChanged
    ? new Map<string, CompiledTrackScheduleEntry>()
    : existing.trackEntries;
  const nextEntries = new Map<string, CompiledTrackScheduleEntry>();
  let rebuiltTracksCount = 0;

  for (const track of project.tracks) {
    const sig = computeTrackScheduleSignature(track);
    const cached = prevEntries.get(track.id);
    if (cached && cached.signature === sig) {
      nextEntries.set(track.id, cached);
    } else {
      const trackEvents = evaluatePlayableArrangementEvents(project, 0, maxBeats, {
        singleTrackId: track.id,
        loopGeneration: 0,
        includeProbability: true,
        evaluateMidiChain: true,
      });
      nextEntries.set(track.id, {
        trackId: track.id,
        signature: sig,
        events: trackEvents,
      });
      rebuiltTracksCount++;
    }
  }

  const trackSetUnchanged =
    existing !== null &&
    !globalTimingChanged &&
    rebuiltTracksCount === 0 &&
    existing.trackEntries.size === nextEntries.size &&
    project.tracks.every((t) => existing.trackEntries.has(t.id));

  if (trackSetUnchanged && existing) {
    return { schedule: existing, rebuiltTracksCount: 0 };
  }

  const merged: EvaluatedPlayableEvent[] = [];
  for (const entry of nextEntries.values()) {
    for (let i = 0; i < entry.events.length; i++) {
      merged.push(entry.events[i]);
    }
  }
  merged.sort(
    (a, b) =>
      a.beat - b.beat ||
      a.trackId.localeCompare(b.trackId) ||
      a.note.pitch - b.note.pitch
  );

  const compileDurationMs =
    (typeof performance !== 'undefined' ? performance.now() : 0) - t0;

  return {
    schedule: {
      maxBeats,
      tempo: project.tempo,
      tempoMapSignature: tempoMapSig,
      trackEntries: nextEntries,
      events: merged,
      cursorIndex: 0,
      cursorBeat: -1,
      cursorLoopGeneration: -1,
      totalCompilations: (existing?.totalCompilations ?? 0) + 1,
      totalTrackRebuilds: (existing?.totalTrackRebuilds ?? 0) + rebuiltTracksCount,
      lastCompileDurationMs: Number(compileDurationMs.toFixed(4)),
    },
    rebuiltTracksCount,
  };
}

export function queryCompiledArrangementWindow(
  schedule: CompiledArrangementSchedule,
  windowStartBeat: number,
  windowEndBeat: number,
  loopGeneration: number,
  region: { enabled: boolean; start: number; end: number; span: number },
  rebuiltTracksCount = 0
): SchedulerWindowQueryResult {
  const q0 = typeof performance !== 'undefined' ? performance.now() : 0;
  const events = schedule.events;
  const totalCompiledEvents = events.length;

  let startIdx = 0;
  let usedIndexedCursor = false;
  if (
    schedule.cursorLoopGeneration === loopGeneration &&
    schedule.cursorBeat >= 0 &&
    windowStartBeat >= schedule.cursorBeat &&
    windowStartBeat - schedule.cursorBeat <= 1.0 &&
    schedule.cursorIndex >= 0 &&
    schedule.cursorIndex <= totalCompiledEvents
  ) {
    usedIndexedCursor = true;
    startIdx = schedule.cursorIndex;
    while (startIdx < totalCompiledEvents && events[startIdx].beat < windowStartBeat) {
      startIdx++;
    }
    while (startIdx > 0 && events[startIdx - 1].beat >= windowStartBeat) {
      startIdx--;
    }
  } else {
    startIdx = findFirstEventIndexAtOrAfterBeat(events, windowStartBeat);
  }

  schedule.cursorIndex = startIdx;
  schedule.cursorBeat = windowStartBeat;
  schedule.cursorLoopGeneration = loopGeneration;

  const windowEvents: EvaluatedPlayableEvent[] = [];
  let visitedCount = 0;

  for (let i = startIdx; i < totalCompiledEvents; i++) {
    const evt = events[i];
    if (evt.beat > windowEndBeat) break;
    visitedCount++;
    if (!region.enabled || (evt.beat >= region.start && evt.beat < region.end)) {
      windowEvents.push(evt);
    }
  }

  const wrapEvents: EvaluatedPlayableEvent[] = [];
  if (region.enabled && windowEndBeat > region.end) {
    const overflowBeats = windowEndBeat - region.end;
    const wrapLimitBeat = region.start + overflowBeats;
    const wrapStartIdx = findFirstEventIndexAtOrAfterBeat(events, region.start);
    for (let j = wrapStartIdx; j < totalCompiledEvents; j++) {
      const evt = events[j];
      if (evt.beat > wrapLimitBeat || evt.beat >= region.end) break;
      visitedCount++;
      wrapEvents.push(evt);
    }
  }

  const queryDurationMs =
    (typeof performance !== 'undefined' ? performance.now() : 0) - q0;

  return {
    windowEvents,
    wrapEvents,
    visitedCount,
    totalCompiledEvents,
    usedIndexedCursor,
    rebuiltTracksCount,
    queryDurationMs: Number(queryDurationMs.toFixed(4)),
  };
}

/**
 * Deterministic sample-accurate stereo PCM synthesizer used for:
 * - Analysis previews and lightweight Vitest fixtures only
 * This approximation is never production WAV export or live/offline parity evidence.
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
  if (!singleTrackId) {
    assertExecutableInsertLimits(project);
  }
  const effectiveBars = totalBars || project.arrangementLengthBars || 16;
  const totalBeats = MusicalTimeService.arrangementTotalBeats(
    { ...project, arrangementLengthBars: effectiveBars },
    1
  );
  const beatsPerSecond = Math.max(40, project.tempo) / 60;
  const tailSeconds = singleTrackId ? 0.6 : 1.5;
  const durationSeconds = MusicalTimeService.arrangementDurationSeconds(
    { ...project, arrangementLengthBars: effectiveBars },
    totalBeats,
    tailSeconds
  );
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

    const instSpec = resolveTrackInstrumentSynthesis(track);
    if (!instSpec.active) continue;

    const rawMixer = track.mixer || {
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
    const mixer: TrackMixerParams = {
      ...rawMixer,
      transposeSemitones: (rawMixer.transposeSemitones || 0) + instSpec.pitchOffsetSemitones,
    };

    const insertMods = estimateInsertChainGainMultiplier(track);
    const trackBaseLinear = Math.min(
      insertMods.limiterCeilingLinear,
      vcaComp.effectiveLinearGain * insertMods.gainMultiplier
    );
    if (trackBaseLinear <= 0.00001) continue;

    const pan = Math.max(-1, Math.min(1, mixer.pan || 0));
    const panAngle = ((pan + 1) * Math.PI) / 4;
    const gainL = Math.cos(panAngle) * trackBaseLinear * masterLinearGain;
    const gainR = Math.sin(panAngle) * trackBaseLinear * masterLinearGain;

    const trackLeft = new Float32Array(totalFrames);
    const trackRight = new Float32Array(totalFrames);

    const evaluatedTrackEvents = evaluatePlayableProjectEvents(project, 0, totalBeats, {
      singleTrackId: track.id,
      includeProbability: true,
      evaluateMidiChain: true,
    });

    for (const evt of evaluatedTrackEvents) {
      const note = evt.note;
      if (note.time < 0 || note.time >= totalBeats) continue;

      const startSec = evt.startTimeSeconds;
      const startFrame = Math.max(0, Math.floor(startSec * sampleRate));
      const durSec = Math.max(
        0.05,
        Math.min(2.5, (note.duration / beatsPerSecond) * instSpec.decayScale + 0.08)
      );
      const noteFrames = Math.min(totalFrames - startFrame, Math.ceil(durSec * sampleRate));
      if (noteFrames <= 0) continue;

      const velNorm = Math.max(0.05, Math.min(1, note.velocity / 127));
      const velGain = Math.pow(velNorm, 1.35) * instSpec.driveScale * instSpec.cutoffScale;
      const baseFreq = midiToFreq(note.pitch, mixer.transposeSemitones, mixer.fineTuneCents);

      const beatPhase = ((note.time % 1) + 1) % 1;
      const isNearKick = beatPhase < 0.22 || beatPhase > 0.94;
      const scDepth = Math.max(0, Math.min(1, mixer.sidechainDepth));
      const scFactor =
        instSpec.synthesisRole === 'kick'
          ? 1.0
          : isNearKick
          ? 1.0 - scDepth * 0.72
          : 1.0 - scDepth * 0.1;

      const spectralNotchFactor =
        track.spectralDucking?.enabled && instSpec.synthesisRole !== 'kick' && isNearKick
          ? dbToGain(Math.min(0, (track.spectralDucking.notchGainDb || -9) * 0.35))
          : 1.0;

      let phase = 0;
      let subPhase = 0;

      for (let i = 0; i < noteFrames; i++) {
        const t = i / sampleRate;
        let sample = 0;

        if (instSpec.synthesisRole === 'kick') {
          const pitchRatio = Math.pow(2, (mixer.transposeSemitones + mixer.fineTuneCents / 100) / 12);
          const instFreq = (40 + 118 * Math.exp(-t * 36)) * pitchRatio;
          phase += (2 * Math.PI * instFreq) / sampleRate;
          const env = Math.exp((-t * 9.5) / instSpec.decayScale);
          const click = t < 0.012 ? Math.sin(2 * Math.PI * 920 * pitchRatio * t) * Math.exp(-t * 180) * 0.35 : 0;
          sample = Math.tanh((Math.sin(phase) * 0.92 + click) * 1.65 * instSpec.driveScale) * env * velGain * 0.85;
        } else if (instSpec.synthesisRole === 'rumble') {
          phase += (2 * Math.PI * baseFreq) / sampleRate;
          subPhase += (2 * Math.PI * baseFreq * 2) / sampleRate;
          const env = Math.min(1, t / 0.012) * Math.exp(-t / Math.max(0.08, durSec * 0.75));
          sample = (Math.sin(phase) * 0.78 + Math.sin(subPhase) * 0.22) * env * velGain * 0.65;
        } else if (instSpec.synthesisRole === 'acid') {
          const isAccent = Boolean(note.isAccent || note.velocity >= 108);
          phase += (2 * Math.PI * baseFreq) / sampleRate;
          subPhase += (2 * Math.PI * baseFreq * 2) / sampleRate;
          const sawApprox = Math.sin(phase) + 0.5 * Math.sin(subPhase);
          const env = Math.min(1, t / 0.005) * Math.exp(-t / ((isAccent ? 0.16 : 0.22) * instSpec.decayScale));
          const drive = (isAccent ? 2.2 : 1.5 + insertMods.saturationBoost) * instSpec.driveScale;
          sample = Math.tanh(sawApprox * drive) * env * velGain * (isAccent ? 0.52 : 0.38);
        } else if (instSpec.synthesisRole === 'hats' || instSpec.synthesisRole === 'ride') {
          const detNoise = Math.sin(i * 12.9898 + note.pitch * 78.233) * 43758.5453;
          const white = (detNoise - Math.floor(detNoise)) * 2 - 1;
          const decayRate = (instSpec.synthesisRole === 'ride' ? 5.5 : note.duration > 0.3 ? 9.0 : 28.0) / instSpec.decayScale;
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
        trackLeft[frameIdx] += modSample * gainL;
        trackRight[frameIdx] += modSample * gainR;
      }
    }

    if (track.devices && track.devices.length > 0) {
      applyDiscreteDeviceTailEffectsInPlace(trackLeft, trackRight, sampleRate, track.devices);
    }

    for (let i = 0; i < totalFrames; i++) {
      left[i] += trackLeft[i];
      right[i] += trackRight[i];
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
  assertExecutableInsertLimits(project);
  if (project.audioSettings?.transport.arrangementMode==='session') throw new Error('SESSION_CAPTURE_REQUIRED: capture the performance and return to Arrangement before offline export');
  const bars = totalBars ?? project.arrangementLengthBars ?? 16;
  if (!Number.isFinite(project.tempo) || project.tempo <= 0 || !Number.isInteger(bars) || bars < 1) {
    throw new Error('RENDER_INPUT: positive tempo and positive whole bars required');
  }
  const totalBeats = MusicalTimeService.arrangementTotalBeats(
    { ...project, arrangementLengthBars: bars },
    1
  );
  // One continuous context retains delay, convolver, compressor and sustaining voices.
  // Bounded scheduling windows are NOT independent PCM segments.
  const tail = Math.max(2.4, masterBus.reverbDecaySec || 0, 8);
  const durationSeconds = MusicalTimeService.arrangementDurationSeconds(
    { ...project, arrangementLengthBars: bars },
    totalBeats,
    tail
  );
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
    bus.masterGain.gain.setValueAtTime(dbToGain(masterBus.masterVolumeDb + (evaluateAutomationAtBeat(masterPoints, 0, totalBeats) - 0.55) * 8), 0);
    for (const point of masterPoints) if (point.beat > 0 && point.beat <= totalBeats) {
      bus.masterGain.gain.linearRampToValueAtTime(dbToGain(masterBus.masterVolumeDb + (point.value - 0.55) * 8), point.beat * 60 / project.tempo);
    }
  }
  const bps = project.tempo / 60;
  const mutedTrackIds = new Set(
    project.tracks
      .filter((track) => composeEffectiveTrackGain(track, project.tracks, project.vcaGroups || []).effectivelyMuted)
      .map((track) => track.id)
  );
  const evaluatedEvents = evaluatePlayableArrangementEvents(project, 0, totalBeats, {
    includeProbability: true,
    evaluateMidiChain: true,
  });
  const events: { track: AbletonTrack; note: MidiNoteEvent; time: number }[] = [];
  for (const evt of evaluatedEvents) {
    if (mutedTrackIds.has(evt.trackId)) continue;
    events.push({ track: evt.track, note: evt.note, time: evt.startTimeSeconds });
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
          retirement.releaseMix();
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
  const effectiveBars = Math.max(1, Math.min(4096, totalBars || project.arrangementLengthBars || 16));
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
  private sessionScheduledKeys = new Map<string, { trackId: string; beat: number }>();
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
  private pendingBlockError: Error | null = null;
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
    if (this.project?.audioSettings?.transport.arrangementMode === 'session') {
      return Number.MAX_SAFE_INTEGER;
    }
    const bars =
      this.project?.arrangementLengthBars || this.transport.arrangementLengthBars || 16;
    if (this.project) {
      return MusicalTimeService.arrangementTotalBeats(
        { ...this.project, arrangementLengthBars: Math.max(1, bars) },
        1
      );
    }
    return Math.max(1, bars) * 4;
  }

  private getPlaybackRegion(maxBeats:number) {
    return playbackRegion(
      maxBeats,
      this.project?.audioSettings?.transport.arrangementMode==='session'
        ? {...this.transport,loopEnabled:false}
        : this.transport,
      this.project?.meterMap
    );
  }

  private executionAllowed(): boolean {
    try {
      if (this.pendingBlockError) throw this.pendingBlockError;
      if (this.project) assertExecutableInsertLimits(this.project);
      return true;
    } catch (error) {
      this.emergencyShutdown(
        `Playback blocked: ${error instanceof Error ? error.message : String(error)}`
      );
      return false;
    }
  }

  public getInstalledProjectState(): AbletonProjectState | null {
    return this.project;
  }

  public syncLiveTrackChannels(): void {
    if (!this.ctx || !this.bus || !this.project) return;
    const validIds = new Set(this.project.tracks.map((t) => t.id));
    for (const [trackId, ch] of this.bus.trackChannels.entries()) {
      if (!validIds.has(trackId)) {
        flushRetiringTrackChains(ch);
        for (const proc of ch.insertProcessors) {
          proc.dispose?.();
          recordDisposedProcessorId(ch, proc.id);
        }
        ch.insertProcessors = [];
        try {
          ch.inputNode.disconnect();
          ch.chainInputGain.disconnect();
          ch.chainOutputGain.disconnect();
          ch.faderGain.disconnect();
          ch.muteSoloGate.disconnect();
          ch.panner.disconnect();
          ch.reverbSendGain.disconnect();
          ch.delaySendGain.disconnect();
        } catch {
          /* ignore */
        }
        this.bus.trackChannels.delete(trackId);
      }
    }
    for (const track of this.project.tracks) {
      getOrCreateTrackChannelRuntime(this.ctx, this.bus, track, this.project);
    }
  }

  public updateTrackMixerLive(
    trackId: string,
    partialMixer?: Partial<TrackMixerParams>,
    muteSoloOverride?: { muted?: boolean; soloed?: boolean }
  ): TrackChannelRuntime | null {
    if (!this.executionAllowed()) return null;
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

    if (channel.currentFaderLinear !== targetFaderLinear) channel.faderGain.gain.setTargetAtTime(targetFaderLinear, now, 0.012);
    if (channel.currentGateLinear !== targetGateLinear) channel.muteSoloGate.gain.setTargetAtTime(targetGateLinear, now, 0.008);
    if (channel.currentPan !== targetPan) channel.panner.pan.setTargetAtTime(targetPan, now, 0.012);
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

  private preflightProjectCandidate(
    candidateProject: AbletonProjectState,
    candidateTransport?: TransportConfig
  ): void {
    assertProjectState(candidateProject);
    if (candidateProject.ppq !== undefined) {
      assertValidPpq(candidateProject.ppq);
    }
    validateAndNormalizeTempoMap(candidateProject.tempo, candidateProject.tempoMap);
    validateAndNormalizeMeterMap(candidateProject.meterMap);
    assertExecutableInsertLimits(candidateProject);

    const effTransport = candidateTransport ?? candidateProject.audioSettings?.transport ?? this.transport;
    const maxBeats =
      candidateProject.audioSettings?.transport.arrangementMode === 'session'
        ? Number.MAX_SAFE_INTEGER
        : Math.max(
            1,
            candidateProject.arrangementLengthBars || effTransport.arrangementLengthBars || 16
          ) * 4;
    playbackRegion(
      maxBeats,
      candidateProject.audioSettings?.transport.arrangementMode === 'session'
        ? { ...effTransport, loopEnabled: false }
        : effTransport,
      candidateProject.meterMap
    );

    if (this.ctx && typeof this.ctx.createGain === 'function') {
      // Dry-run candidate device insert graph construction before touching active state
      const builtTemp: InsertProcessorInstance[] = [];
      try {
        for (const track of candidateProject.tracks) {
          for (const dev of track.devices || []) {
            builtTemp.push(buildDeviceInsertProcessor(this.ctx, dev));
          }
        }
      } finally {
        for (const proc of builtTemp) {
          proc.dispose?.();
        }
      }
    }
  }

  private compiledSchedule: CompiledArrangementSchedule | null = null;
  private lastWindowTelemetry: SchedulerWindowQueryResult | null = null;

  public getSchedulerWindowTelemetry(): SchedulerWindowQueryResult | null {
    return this.lastWindowTelemetry;
  }

  public getCompiledArrangementSchedule(): CompiledArrangementSchedule | null {
    return this.compiledSchedule;
  }

  public sweepRetiredInsertChains(audioTimeOverride?: number): number {
    if (!this.bus) return 0;
    const nowAudio =
      typeof audioTimeOverride === 'number'
        ? audioTimeOverride
        : this.ctx?.currentTime ?? 0;
    let totalPruned = 0;
    if (this.bus.trackChannels) {
      for (const ch of this.bus.trackChannels.values()) {
        totalPruned += pruneRetiringTrackChains(ch, nowAudio);
      }
    }
    if (Array.isArray(this.bus.offlineRetirements) && this.bus.offlineRetirements.length > 0) {
      this.bus.offlineRetirements = this.bus.offlineRetirements.filter((retirement) => {
        if (retirement.at > nowAudio + 1e-6) return true;
        retirement.releaseMix();
        for (const node of retirement.nodes) {
          try {
            node.disconnect();
          } catch {
            /* ignore */
          }
        }
        return false;
      });
    }
    return totalPruned;
  }

  public flushAllRetiringTrackChains(): number {
    if (!this.bus) return 0;
    let totalFlushed = 0;
    if (this.bus.trackChannels) {
      for (const ch of this.bus.trackChannels.values()) {
        totalFlushed += flushRetiringTrackChains(ch);
      }
    }
    if (Array.isArray(this.bus.offlineRetirements)) {
      while (this.bus.offlineRetirements.length > 0) {
        const retirement = this.bus.offlineRetirements.shift();
        if (retirement) {
          retirement.releaseMix();
          for (const node of retirement.nodes) {
            try {
              node.disconnect();
            } catch {
              /* ignore */
            }
          }
        }
      }
    }
    return totalFlushed;
  }

  public handleAudioContextLifecycle(state?: AudioContextState): void {
    const effectiveState = state ?? this.ctx?.state;
    if (effectiveState === 'closed' || effectiveState === 'suspended') {
      this.flushAllRetiringTrackChains();
      if (effectiveState === 'closed' && this.isPlaying) {
        this.stop();
      }
    }
  }

  public emergencyShutdown(reason?: string): void {
    // Emergency shutdown is completely independent of coordinate conversion errors.
    try {
      this.currentBeat = this.getCurrentBeat();
    } catch {
      /* Preserve last valid currentBeat when timing/meter conversion is invalid */
    }
    if (this.bus) {
      for (const retire of [...this.bus.activeVoices]) {
        try {
          retire();
        } catch {
          /* ignore voice retirement failure */
        }
      }
    }
    this.flushAllRetiringTrackChains();
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
    this.sessionScheduledKeys.clear();
    this.playbackState = 'error';
    if (reason) {
      this.onPlaybackStopped?.(reason);
    }
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
    if (onPlayheadUpdate) {
      this.onPlayheadUpdate = onPlayheadUpdate;
    }
    if (onPlaybackStopped) {
      this.onPlaybackStopped = onPlaybackStopped;
    }

    // Section 3: Validate domain state, timing maps, capabilities, and candidate device graph
    // BEFORE replacing this.project or mutating active clock anchors/channels.
    try {
      this.preflightProjectCandidate(project, transport);
    } catch (error) {
      this.pendingBlockError = error instanceof Error ? error : new Error(String(error));
      this.emergencyShutdown(`Playback blocked: ${this.pendingBlockError.message}`);
      return;
    }

    this.pendingBlockError = null;
    const prevTempo = this.project?.tempo;
    const modeChanged =
      this.project?.audioSettings?.transport.arrangementMode !==
      project.audioSettings?.transport.arrangementMode;
    const previousSessionIds = new Set(this.project?.session?.events.map((e) => e.id) || []);
    const nextEvents = new Map(project.session?.events.map((e) => [e.id, e]) || []);
    const invalidatedTracks = new Set<string>();
    for (const event of this.project?.session?.events || []) {
      if (JSON.stringify(event) !== JSON.stringify(nextEvents.get(event.id)))
        invalidatedTracks.add(event.trackId);
    }
    for (const track of this.project?.tracks || []) {
      if (
        JSON.stringify(track.sessionClips) !==
        JSON.stringify(project.tracks.find((t) => t.id === track.id)?.sessionClips)
      )
        invalidatedTracks.add(track.id);
    }
    // Capture with the OLD tempo before replacing project state. RAF may be suspended
    // or several frames behind the audio clock. Queued voices use the old seconds map.
    const tempoChangedWhilePlaying =
      this.isPlaying && prevTempo !== undefined && (prevTempo !== project.tempo || modeChanged);
    if (tempoChangedWhilePlaying) {
      this.currentBeat = this.getCurrentBeat();
      if (this.bus) for (const retire of [...this.bus.activeVoices]) retire();
      this.scheduledNoteKeys.clear();
      this.sessionScheduledKeys.clear();
      this.loopGeneration++;
      this.anchorBeat = this.currentBeat;
      if (this.ctx) this.anchorAudioTime = this.ctx.currentTime;
    }
    this.project = project;
    this.humanization = humanization;
    if (transport) {
      this.transport = transport;
    }
    if (masterBus) {
      this.masterBus = masterBus;
    }
    if (
      this.isPlaying &&
      this.ctx &&
      this.bus &&
      project.audioSettings?.transport.arrangementMode === 'session'
    ) {
      if ((project.session?.events.length ?? 0) === 0) {
        for (const retire of [...this.bus.activeVoices]) retire();
        this.scheduledNoteKeys.clear();
        this.sessionScheduledKeys.clear();
      } else {
        for (const trackId of invalidatedTracks) {
          for (const retire of this.bus.trackVoices?.get(trackId) || []) retire();
          for (const [key, metadata] of this.sessionScheduledKeys)
            if (metadata.trackId === trackId) {
              this.scheduledNoteKeys.delete(key);
              this.sessionScheduledKeys.delete(key);
            }
        }
        for (const event of project.session?.events || [])
          if (!previousSessionIds.has(event.id)) {
            const at = this.anchorAudioTime + (event.atBeat - this.anchorBeat) / (project.tempo / 60);
            for (const retire of this.bus.trackVoices?.get(event.trackId) || []) retire(at);
          }
      }
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
      this.bus.delayLeftTapGain.gain.setTargetAtTime(
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
      this.bus.delayNodeR.delayTime.setTargetAtTime(threeSixteenthSec * 2, now, 0.03);

      // Immediately sync all persistent per-track channel strips in real time
      try {
        this.syncLiveTrackChannels();
      } catch (err) {
        this.pendingBlockError = err instanceof Error ? err : new Error(String(err));
        this.emergencyShutdown(`Playback blocked: ${this.pendingBlockError.message}`);
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
    if (this.pendingBlockError) throw this.pendingBlockError;
    if (this.project) {
      this.preflightProjectCandidate(this.project, this.transport);
    }
    this.ensureContext();
    if (!this.ctx) return;
    this.syncLiveTrackChannels();

    const maxBeats = this.getMaxArrangementBeats();
    if (fromStart || this.currentBeat >= maxBeats) {
      const region = this.getPlaybackRegion(maxBeats);
      this.currentBeat = region.enabled ? region.start : 0;
    }

    this.anchorBeat = this.currentBeat;
    this.anchorAudioTime = this.ctx.currentTime + 0.02;
    this.lastSchedulerPerfMs = performance.now();
    this.scheduledNoteKeys.clear();
    this.sessionScheduledKeys.clear();
    this.loopGeneration = 0;
    this.playbackState = 'playing';

    if (!this.isPlaying) {
      this.isPlaying = true;
      this.runLookaheadScheduler();
      this.schedulerTimerId = window.setInterval(this.runLookaheadScheduler, 20);
      this.rafId = requestAnimationFrame(this.runVisualPlayheadLoop);
    } else {
      this.runLookaheadScheduler();
    }
  }

  public pause() {
    this.stop();
    this.playbackState = 'paused';
  }

  public stop() {
    // Freeze at the audible clock position, independently of visual rendering or coordinate conversion failures.
    try {
      this.currentBeat = this.getCurrentBeat();
    } catch {
      /* Preserve last valid currentBeat when timing/meter conversion fails */
    }
    if (this.bus) {
      for (const retire of [...this.bus.activeVoices]) {
        try {
          retire();
        } catch {
          /* ignore */
        }
      }
    }
    this.flushAllRetiringTrackChains();
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
    this.sessionScheduledKeys.clear();
    if (this.compiledSchedule) {
      this.compiledSchedule.cursorIndex = 0;
      this.compiledSchedule.cursorBeat = -1;
      this.compiledSchedule.cursorLoopGeneration = -1;
    }
    if (this.playbackState !== 'interrupted' && this.playbackState !== 'error') {
      this.playbackState = this.ctx ? 'ready' : 'idle';
    }
  }

  public seek(beat: number) {
    if (!Number.isFinite(beat)) throw new Error('TIMELINE_INPUT: invalid seek coordinate');
    const maxBeats = this.getMaxArrangementBeats();
    const clamped = Math.max(0, Math.min(maxBeats, beat));
    if (this.bus) for (const retire of [...this.bus.activeVoices]) retire();
    this.currentBeat = clamped;
    this.anchorBeat = clamped;
    if (this.ctx) {
      this.anchorAudioTime = this.ctx.currentTime;
    }
    this.scheduledNoteKeys.clear();
    this.sessionScheduledKeys.clear();
    this.loopGeneration++;
    if (this.compiledSchedule) {
      this.compiledSchedule.cursorIndex = findFirstEventIndexAtOrAfterBeat(
        this.compiledSchedule.events,
        clamped
      );
      this.compiledSchedule.cursorBeat = clamped;
      this.compiledSchedule.cursorLoopGeneration = this.loopGeneration;
    }
    if (this.isPlaying) {
      this.runLookaheadScheduler();
    }
  }

  public getCurrentBeat(): number {
    if (this.isPlaying && this.ctx && this.project) {
      const bpm = this.project.tempo || 134;
      const beatsPerSec = bpm / 60.0;
      const elapsedSec = Math.max(0, this.ctx.currentTime - this.anchorAudioTime);
      const maxBeats = this.getMaxArrangementBeats();
      const rawBeat = this.anchorBeat + elapsedSec * beatsPerSec;
      this.currentBeat = positionAtBeat(rawBeat, maxBeats, this.getPlaybackRegion(maxBeats));
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
    if (!this.executionAllowed()) return;
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
    if (this.bus.trackChannels) {
      for (const ch of this.bus.trackChannels.values()) {
        pruneRetiringTrackChains(ch, nowAudio);
      }
    }
    const beatsPerSecond = this.project.tempo / 60;
    const lookaheadSeconds = 0.12;
    const maxBeats = this.getMaxArrangementBeats();

    let exactBeatNow = this.anchorBeat + (nowAudio - this.anchorAudioTime) * beatsPerSecond;

    const region = this.getPlaybackRegion(maxBeats);
    const loopStartBeat = region.start;
    const loopEndBeat = region.end;
    const loopSpanBeats = region.span;

    if (region.enabled) {
      if (exactBeatNow >= loopEndBeat) {
        const completedCycles = Math.max(1, Math.floor((exactBeatNow - loopStartBeat) / loopSpanBeats));
        const wrappedBeat = loopStartBeat + ((exactBeatNow - loopStartBeat) % loopSpanBeats);
        this.anchorBeat = wrappedBeat;
        this.anchorAudioTime = nowAudio;
        exactBeatNow = wrappedBeat;
        this.loopGeneration += completedCycles;
        this.scheduledNoteKeys = new Set([...this.scheduledNoteKeys].filter(key =>
          key.startsWith(`${this.loopGeneration}_`) || key.startsWith(`metro_${this.loopGeneration}_`)));
      }
    } else {
      if (exactBeatNow >= maxBeats) {
        this.stop();
        if (this.onPlayheadUpdate) {
          this.onPlayheadUpdate(this.currentBeat, this.humanization.cutoffHz, -60);
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

    if (this.project.audioSettings?.transport.arrangementMode === 'session') {
      for (const [key, metadata] of this.sessionScheduledKeys)
        if (metadata.beat < exactBeatNow - 1) {
          this.scheduledNoteKeys.delete(key);
          this.sessionScheduledKeys.delete(key);
        }
      for (const key of this.scheduledNoteKeys) {
        if (key.startsWith('metro_') && Number(key.split('_')[2]) < exactBeatNow - 1)
          this.scheduledNoteKeys.delete(key);
      }
      try {
        const sessionEvents = evaluatePlayableSessionEvents(
          this.project,
          Math.max(0, exactBeatNow - 0.015),
          windowEndBeat
        );
        for (const event of sessionEvents) {
          const key = event.dedupKey;
          if (this.scheduledNoteKeys.has(key)) continue;
          const at = this.anchorAudioTime + (event.beat - this.anchorBeat) / beatsPerSecond;
          if (at < nowAudio - 0.015) continue;
          this.scheduledNoteKeys.add(key);
          this.sessionScheduledKeys.set(key, { trackId: event.trackId, beat: event.beat });
          const stop =
            event.stopBeat !== undefined && Number.isFinite(event.stopBeat)
              ? this.anchorAudioTime + (event.stopBeat - this.anchorBeat) / beatsPerSecond
              : Infinity;
          scheduleTrackVoiceAtTime(
            this.ctx,
            this.bus,
            this.noiseBuffer,
            event.track,
            event.note,
            at,
            beatsPerSecond,
            this.humanization,
            this.project,
            stop
          );
        }
      } catch (error) {
        this.stop();
        this.onPlaybackStopped?.(
          `Playback blocked: ${error instanceof Error ? error.message : String(error)}`
        );
        return;
      }
    } else {
      try {
        const compiled = compileOrUpdateArrangementSchedule(
          this.project,
          maxBeats,
          this.compiledSchedule
        );
        this.compiledSchedule = compiled.schedule;

        const windowStartBeat = Math.max(0, exactBeatNow - 0.015);
        const queryResult = queryCompiledArrangementWindow(
          this.compiledSchedule,
          windowStartBeat,
          windowEndBeat,
          this.loopGeneration,
          region,
          compiled.rebuiltTracksCount
        );
        this.lastWindowTelemetry = queryResult;

        const tracksById = new Map<string, AbletonTrack>();
        for (const t of this.project.tracks) {
          tracksById.set(t.id, t);
        }

        for (const evt of queryResult.windowEvents) {
          const liveTrack = tracksById.get(evt.trackId) || evt.track;
          const { clipId, note } = evt;
          const key = `${this.loopGeneration}_${evt.trackId}_${clipId}_${note.id}`;
          if (!this.scheduledNoteKeys.has(key)) {
            const noteAudioTime =
              this.anchorAudioTime + (note.time - this.anchorBeat) / beatsPerSecond;
            if (noteAudioTime >= nowAudio - 0.015) {
              this.scheduledNoteKeys.add(key);
              scheduleTrackVoiceAtTime(
                this.ctx!,
                this.bus!,
                this.noiseBuffer!,
                liveTrack,
                note,
                noteAudioTime,
                beatsPerSecond,
                this.humanization!,
                this.project!
              );
            }
          }
        }

        if (region.enabled && queryResult.wrapEvents.length > 0) {
          const nextGen = this.loopGeneration + 1;
          for (const evt of queryResult.wrapEvents) {
            const liveTrack = tracksById.get(evt.trackId) || evt.track;
            const { clipId, note } = evt;
            const wrapKey = `${nextGen}_${evt.trackId}_${clipId}_${note.id}`;
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
                  liveTrack,
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
      } catch (error) {
        this.emergencyShutdown(
          `Playback blocked: ${error instanceof Error ? error.message : String(error)}`
        );
        return;
      }
    }

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

    this.currentBeat = positionAtBeat(beat, maxBeats, this.getPlaybackRegion(maxBeats));

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

