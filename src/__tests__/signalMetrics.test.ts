import {expect, it} from 'vitest';
import {measureAudioSignalMetrics,applyTwoPassMasteringToBuffers,BUILTIN_MASTER_EXPORT_PRESETS} from '../engine/masteringEngine';
import {measurePcmSignalMetrics,measurePcmSignalMetricsAsync} from '../engine/signalMetrics';

const tone = (rate:number, frequency:number, amplitude:number, seconds=1, phase=0) =>
  Float32Array.from({length:Math.round(rate*seconds)},(_,i)=>amplitude*Math.sin(2*Math.PI*frequency*i/rate+phase));

it('finds inter-sample peaks even below the old 0.05 amplitude shortcut',()=>{
  const signal=tone(48000,12000,.04,1,Math.PI/4);
  const result=measureAudioSignalMetrics(signal,signal,48000);
  expect(result.samplePeakDbfs).toBeCloseTo(-30.97,1);
  expect(result.truePeakDbtp).toBeGreaterThan(result.samplePeakDbfs+2.5);
});

it('rejects nonfinite audio and unequal channels rather than reporting plausible levels',()=>{
  expect(()=>measureAudioSignalMetrics(new Float32Array([NaN]),new Float32Array([0]),48000)).toThrow(/nonfinite/i);
  expect(()=>measureAudioSignalMetrics(new Float32Array(2),new Float32Array(1),48000)).toThrow(/length/i);
});

it('preserves over-unity peaks and stereo energy without downmix cancellation',()=>{
  const signal=tone(48000,997,1.5);
  const inverse=signal.map(x=>-x);
  const stereo=measureAudioSignalMetrics(signal,signal,48000);
  const antiphase=measureAudioSignalMetrics(signal,inverse,48000);
  expect(stereo.samplePeakDbfs).toBeCloseTo(3.52,1);
  expect(antiphase.integratedLufs).toBe(stereo.integratedLufs);
});

it('calibrates mono and stereo 997 Hz with the correct channel energy sum',()=>{
  const signal=tone(48000,997,.1,3), silent=new Float32Array(signal.length);
  expect(measurePcmSignalMetrics([signal],48000).integratedLufs).toBeCloseTo(-23.01,1);
  expect(measurePcmSignalMetrics([silent,signal],48000).integratedLufs).toBeCloseTo(-23.01,1);
  expect(measurePcmSignalMetrics([signal,signal],48000).integratedLufs).toBeCloseTo(-20,1);
});

it('does not invent integrated loudness for short material or absolute-gated silence',()=>{
  const short=measurePcmSignalMetrics([tone(48000,997,.1,.1)],48000);
  expect(short.integratedLufsAvailable).toBe(false);
  expect(short.loudnessUnavailableReason).toBe('insufficient-duration');
  expect(short.samplePeakDbfs).toBeCloseTo(-20,1);
  const silence=measurePcmSignalMetrics([new Float32Array(48000)],48000);
  expect(silence.integratedLufsAvailable).toBe(false);
  expect(silence.loudnessUnavailableReason).toBe('below-absolute-gate');
  expect(measurePcmSignalMetrics([tone(48000,997,.00001)],48000).integratedLufsAvailable).toBe(false);
});

it('uses sufficient oversampling and rejects unsupported rates/layouts explicitly',()=>{
  expect(measurePcmSignalMetrics([new Float32Array(0)],44100).truePeakOversample).toBe(8);
  expect(measurePcmSignalMetrics([new Float32Array(0)],48000).truePeakOversample).toBe(4);
  expect(()=>measurePcmSignalMetrics([],48000)).toThrow(/channels/i);
  expect(()=>measurePcmSignalMetrics([new Float32Array(0)],NaN)).toThrow(/sample_rate/i);
  expect(()=>measurePcmSignalMetrics([new Float32Array(0)],0)).toThrow(/sample_rate/i);
});

it('counts clipped frames once and retains peaks at both file boundaries without changing PCM',()=>{
  const input=new Float32Array([1.5,0,0,0,-2]), before=input.slice();
  const result=measureAudioSignalMetrics(input,input,48000);
  expect(result.clippingSampleCount).toBe(2);
  expect(result.samplePeakDbfs).toBeCloseTo(6.02,1);
  expect(result.truePeakDbtp).toBeGreaterThanOrEqual(result.samplePeakDbfs);
  expect(input).toEqual(before);
});

it('keeps async chunk-boundary results identical while allowing timers and cancellation',async()=>{
  const signal=tone(44100,11025,.04,1.7,Math.PI/4);
  let heartbeat=false;
  const timer=setTimeout(()=>{heartbeat=true;},0);
  const asyncResult=await measurePcmSignalMetricsAsync([signal,signal],44100);
  clearTimeout(timer);
  expect(heartbeat).toBe(true);
  expect(asyncResult).toEqual(measurePcmSignalMetrics([signal,signal],44100));
  const cancel=new AbortController();
  const pending=measurePcmSignalMetricsAsync([signal],44100,cancel.signal);
  cancel.abort();
  await expect(pending).rejects.toMatchObject({name:'AbortError'});
  await expect(measurePcmSignalMetricsAsync([signal],44100,cancel.signal)).rejects.toMatchObject({name:'AbortError'});
});

it('does not certify an unavailable loudness target and enforces the measured inter-sample ceiling',()=>{
  const preset={...BUILTIN_MASTER_EXPORT_PRESETS[1],targetIntegratedLufs:-8,truePeakCeilingDbtp:-1};
  const silent=new Float32Array(4800);
  const unavailable=applyTwoPassMasteringToBuffers(silent,silent,48000,preset);
  expect(unavailable.targetCompliant).toBe(false);
  expect(unavailable.conflictWarning).toContain('not verified');
  const high=tone(48000,12000,.8,1,Math.PI/4);
  const result=applyTwoPassMasteringToBuffers(high,high,48000,preset);
  expect(result.pass2Metrics.truePeakDbtp).toBeLessThanOrEqual(-1);
  expect(result.masteredLeft.length).toBe(high.length);
});
