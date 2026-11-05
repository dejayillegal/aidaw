import { describe, expect, it } from 'vitest';
import { SidechainKernel, compressionGainDb } from '../../public/audio/sidechain-kernel.js';
describe('signal-driven dual-input sidechain compression', () => {
  it('implements threshold, ratio and continuous soft knee transfer', () => {
    expect(compressionGainDb(-30, -20, 4, 0)).toBe(0);
    expect(compressionGainDb(0, -20, 4, 0)).toBe(-15);
    expect(compressionGainDb(-20, -20, 4, 6)).toBeCloseTo(-.5625);
    expect(compressionGainDb(-17, -20, 4, 6)).toBeCloseTo(-2.25);
  });
  it('preserves no-key unity and links stereo detection without antiphase cancellation', () => {
    const kernel = new SidechainKernel(48000), n = 48000;
    const left = new Float32Array(n).fill(.25), right = new Float32Array(n).fill(-.25);
    const out = [new Float32Array(n), new Float32Array(n)];
    const settings = { thresholdDb:-20,ratio:4,kneeDb:0,attackMs:1,releaseMs:100,holdMs:0,keyHighpassHz:20,mix:1 };
    kernel.process([left,right],[],out,settings);
    expect(out[0]).toEqual(left); expect(out[1]).toEqual(right);
    const key = Float32Array.from({length:n},(_,i)=>Math.sin(2*Math.PI*1000*i/48000));
    kernel.process([left,right],[key,Float32Array.from(key,v=>-v)],out,settings);
    expect(Math.abs(out[0].at(-1)!)).toBeLessThan(.08);
    expect(out[0].at(-1)).toBe(-out[1].at(-1)!);
    expect(kernel.gainReductionDb).toBeGreaterThan(10);
    expect(out[0].every(Number.isFinite)).toBe(true);
  });
  it('rejects invalid initialization and provides dry output at zero mix', () => {
    expect(()=>new SidechainKernel(0)).toThrow();
    const kernel = new SidechainKernel(48000), input = new Float32Array(4096).fill(.2), output = [new Float32Array(4096)];
    kernel.process([input],[input],output,{thresholdDb:-40,ratio:20,kneeDb:6,attackMs:1,releaseMs:100,holdMs:0,keyHighpassHz:20,mix:0});
    expect(output[0]).toEqual(input);
  });
});
