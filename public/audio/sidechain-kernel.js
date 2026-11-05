/** Original stereo-linked peak detector. No allocation or message passing in process(). */
export function compressionGainDb(levelDb, thresholdDb, ratio, kneeDb) {
  const over = levelDb - thresholdDb;
  if (kneeDb > 0 && over > -kneeDb / 2 && over < kneeDb / 2)
    return (1 / ratio - 1) * (over + kneeDb / 2) ** 2 / (2 * kneeDb);
  return over > 0 ? (1 / ratio - 1) * over : 0;
}
export class SidechainKernel {
  constructor(rate) {
    if (!Number.isFinite(rate) || rate < 8000 || rate > 384000) throw new Error('SIDECHAIN_RATE');
    this.rate = rate; this.envelope = 0; this.hold = 0; this.gainReductionDb = 0;
    this.previousInput = new Float64Array(2); this.previousOutput = new Float64Array(2);
  }
  process(target, key, output, settings) {
    const attack = Math.exp(-1 / (Math.max(.1, settings.attackMs) * .001 * this.rate));
    const release = Math.exp(-1 / (Math.max(10, settings.releaseMs) * .001 * this.rate));
    const hp = 1 / (1 + 2 * Math.PI * settings.keyHighpassHz / this.rate);
    const holdFrames = Math.round(settings.holdMs * .001 * this.rate);
    const count = output[0]?.length || 0;
    let maxReduction = 0;
    for (let i = 0; i < count; i++) {
      let detector = 0;
      for (let ch = 0; ch < 2; ch++) {
        const input = key[ch]?.[i] || 0;
        const filtered = hp * (this.previousOutput[ch] + input - this.previousInput[ch]);
        this.previousInput[ch] = input; this.previousOutput[ch] = filtered;
        detector = Math.max(detector, Math.abs(filtered));
      }
      let coefficient;
      if (detector > this.envelope) { coefficient = attack; this.hold = holdFrames; }
      else if (this.hold > 0) { coefficient = 1; this.hold--; }
      else coefficient = release;
      this.envelope = coefficient * this.envelope + (1 - coefficient) * detector;
      const gainDb = compressionGainDb(20 * Math.log10(Math.max(1e-12, this.envelope)), settings.thresholdDb, settings.ratio, settings.kneeDb);
      maxReduction = Math.max(maxReduction, -gainDb);
      const gain = 1 - settings.mix + settings.mix * 10 ** (gainDb / 20);
      for (let ch = 0; ch < output.length; ch++) output[ch][i] = (target[ch]?.[i] ?? target[0]?.[i] ?? 0) * gain;
    }
    this.gainReductionDb = maxReduction;
  }
}
