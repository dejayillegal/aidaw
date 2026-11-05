/**
 * Offline mono/stereo metering. BS.1770 Annex 1 K weighting and gates;
 * Annex 2 oversampling/FIR true peak (at least 192 kHz). No audio downmix or amplitude shortcut.
 * Source: https://www.itu.int/rec/R-REC-BS.1770-5-202311-I
 * This implementation is not a claim of full BS.2217 meter certification.
 */
export interface SignalMetrics {
  integratedLufs: number;
  integratedLufsAvailable: boolean;
  loudnessUnavailableReason: 'insufficient-duration' | 'below-absolute-gate' | null;
  samplePeakDbfs: number;
  truePeakDbtp: number;
  rmsDb: number;
  crestFactorDb: number;
  headroomDb: number;
  /** Frames with at least one channel at or above full scale. */
  clippingSampleCount: number;
  truePeakOversample: number;
}

function getBs1770FilterCoeffs(sampleRate: number) {
  // Stage 1: High shelf
  const f0Shelf = 1681.974450955533;
  const gainDb = 3.999843853973347;
  const qShelf = 0.7071752369554196;
  const K1 = Math.tan((Math.PI * f0Shelf) / sampleRate);
  const Vh = Math.pow(10, gainDb / 20);
  const Vb = Math.pow(Vh, 0.4996667741545416);
  const a0_1 = 1 + K1 / qShelf + K1 * K1;
  const b0_1 = (Vh + (Vb * K1) / qShelf + K1 * K1) / a0_1;
  const b1_1 = (2 * (K1 * K1 - Vh)) / a0_1;
  const b2_1 = (Vh - (Vb * K1) / qShelf + K1 * K1) / a0_1;
  const a1_1 = (2 * (K1 * K1 - 1)) / a0_1;
  const a2_1 = (1 - K1 / qShelf + K1 * K1) / a0_1;

  // Stage 2: RLB High-pass
  const f0Hp = 38.13547087602444;
  const qHp = 0.5003270373238773;
  const K2 = Math.tan((Math.PI * f0Hp) / sampleRate);
  const a0_2 = 1 + K2 / qHp + K2 * K2;
  const b0_2 = 1;
  const b1_2 = -2;
  const b2_2 = 1;
  const a1_2 = (2 * (K2 * K2 - 1)) / a0_2;
  const a2_2 = (1 - K2 / qHp + K2 * K2) / a0_2;

  return {
    shelf: { b0: b0_1, b1: b1_1, b2: b2_1, a1: a1_1, a2: a2_1 },
    hp: { b0: b0_2, b1: b1_2, b2: b2_2, a1: a1_2, a2: a2_2 },
  };
}

type BiquadCoefficients = ReturnType<typeof getBs1770FilterCoeffs>['shelf'];
class Biquad {
  private z1 = 0;
  private z2 = 0;
  constructor(private readonly c: BiquadCoefficients) {}
  process(x: number): number {
    const y = this.c.b0 * x + this.z1;
    this.z1 = this.c.b1 * x - this.c.a1 * y + this.z2;
    this.z2 = this.c.b2 * x - this.c.a2 * y;
    return y;
  }
}

// Band-limited reconstruction: 48 source-sample taps per fractional phase.
// Blackman-windowed sinc, normalized for unity DC gain. Unlike cubic interpolation,
// this reconstructs above-sample peaks; 4x minimum, with higher ratios below 48kHz.
// Annex 2 permits filters with similar or superior results to its example table.
const TAPS = 48;
function peakPhases(oversample: number): number[][] {
  return Array.from({length:oversample-1},(_,phase)=>{
    const delay = TAPS / 2 + (phase+1) / oversample;
    const taps = Array.from({length:TAPS},(_,k)=>{
      const d = k-delay, radius = TAPS/2;
      if(Math.abs(d)>=radius) return 0;
      const sinc = Math.abs(d)<1e-12 ? 1 : Math.sin(Math.PI*d)/(Math.PI*d);
      return sinc*(.42+.5*Math.cos(Math.PI*d/radius)+.08*Math.cos(2*Math.PI*d/radius));
    });
    const gain = taps.reduce((a,b)=>a+b,0);
    return taps.map(t=>t/gain);
  });
}

class TruePeak {
  private history = new Float64Array(TAPS*2);
  private position = 0;
  peak = 0;
  constructor(private readonly phases: readonly number[][]) {}
  process(value: number): void {
    const start = this.position + TAPS;
    this.history[this.position] = value;
    this.history[start] = value;
    this.peak = Math.max(this.peak, Math.abs(value));
    for (const phase of this.phases) {
      let y = 0;
      for (let k = 0; k < TAPS; k++) y += phase[k] * this.history[start - k];
      this.peak = Math.max(this.peak, Math.abs(y));
    }
    this.position = (this.position + 1) % TAPS;
  }
  finish(): number {
    for (let i = 0; i < TAPS-1; i++) this.process(0);
    return this.peak;
  }
}

const db = (amplitude: number) => amplitude > 0 ? 20 * Math.log10(amplitude) : -90;
const rounded = (value: number) => Number(value.toFixed(2));

/** Complete PCM scan with O(400ms + gating blocks) auxiliary memory. */
function* scanSignalMetrics(channels: readonly Float32Array[], sampleRate: number): Generator<void, SignalMetrics, void> {
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 384000)
    throw new Error('METER_SAMPLE_RATE: expected an integer sample rate from 8000 to 384000 Hz');
  if (channels.length !== 1 && channels.length !== 2)
    throw new Error('METER_CHANNELS: only mono and stereo layouts are supported');
  const n = channels[0].length;
  if (channels.some(c => c.length !== n)) throw new Error('METER_LENGTH: channel lengths differ');
  const coeffs = getBs1770FilterCoeffs(sampleRate);
  const oversample = 2 ** Math.ceil(Math.log2(Math.max(4,192000/sampleRate)));
  const phases = peakPhases(oversample);
  const filters = channels.map(() => ({shelf:new Biquad(coeffs.shelf), hp:new Biquad(coeffs.hp), peak:new TruePeak(phases)}));
  const block = Math.round(.4 * sampleRate), step = Math.round(.1 * sampleRate);
  const energyWindow = new Float64Array(block);
  const blocks: number[] = [];
  let windowEnergy = 0, samplePeak = 0, sumSquares = 0, clipped = 0;
  for (let i = 0; i < n; i++) {
    let energy = 0, frameSquares = 0, frameClipped = false;
    for (let c = 0; c < channels.length; c++) {
      const value = channels[c][i];
      if (!Number.isFinite(value)) throw new Error(`METER_NONFINITE: channel ${c}, frame ${i}`);
      samplePeak = Math.max(samplePeak, Math.abs(value));
      frameClipped ||= Math.abs(value) >= 1;
      frameSquares += value * value;
      const f = filters[c];
      f.peak.process(value);
      const weighted = f.hp.process(f.shelf.process(value));
      energy += weighted * weighted;
    }
    sumSquares += frameSquares / channels.length;
    if (frameClipped) clipped++;
    const position = i % block;
    windowEnergy += energy - energyWindow[position];
    energyWindow[position] = energy;
    if (i + 1 >= block && (i + 1 - block) % step === 0)
      blocks.push(Math.max(0, windowEnergy / block));
    // Async callers can yield without copying or restarting filter/gate history.
    if ((i + 1) % 4096 === 0) yield;
  }
  const absoluteThreshold = 10 ** ((-70 + .691) / 10);
  const absolute = blocks.filter(e => e > absoluteThreshold);
  const relativeThreshold = absolute.length ? absolute.reduce((a,b)=>a+b,0) / absolute.length / 10 : Infinity;
  const gated = absolute.filter(e => e > relativeThreshold);
  const loudnessAvailable = gated.length > 0;
  const integrated = loudnessAvailable ? -.691 + 10 * Math.log10(gated.reduce((a,b)=>a+b,0) / gated.length) : -70;
  const peak = Math.max(samplePeak, ...filters.map(f=>f.peak.finish()));
  const peakDb = db(peak), rmsDb = db(n ? Math.sqrt(sumSquares / n) : 0);
  return {
    integratedLufs:rounded(integrated), integratedLufsAvailable:loudnessAvailable,
    loudnessUnavailableReason:loudnessAvailable ? null : n < block ? 'insufficient-duration' : 'below-absolute-gate',
    samplePeakDbfs:rounded(db(samplePeak)), truePeakDbtp:rounded(peakDb), rmsDb:rounded(rmsDb),
    crestFactorDb:rounded(Math.max(0,peakDb-rmsDb)), headroomDb:rounded(-peakDb), clippingSampleCount:clipped, truePeakOversample:oversample,
  };
}

/** Synchronous API for deterministic offline consumers. */
export function measurePcmSignalMetrics(channels: readonly Float32Array[], sampleRate: number): SignalMetrics {
  const scan = scanSignalMetrics(channels,sampleRate);
  let result = scan.next();
  while (!result.done) result = scan.next();
  return result.value;
}

/** Cooperative UI path. Each chunk preserves the same filters and gating window. */
export async function measurePcmSignalMetricsAsync(
  channels: readonly Float32Array[], sampleRate: number, signal?: AbortSignal,
): Promise<SignalMetrics> {
  const scan = scanSignalMetrics(channels,sampleRate);
  while (true) {
    signal?.throwIfAborted();
    const result = scan.next();
    if (result.done) return result.value;
    await new Promise<void>(resolve=>{setTimeout(resolve,0);});
  }
}

/** Backward-compatible stereo entry point used by export and calibration. */
export function measureAudioSignalMetrics(left: Float32Array, right: Float32Array, sampleRate: number): SignalMetrics {
  return measurePcmSignalMetrics([left,right], sampleRate);
}

