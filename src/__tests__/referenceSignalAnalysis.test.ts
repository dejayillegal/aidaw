import {expect,it,vi} from 'vitest';
import {analyzeUploadedReferenceTrack} from '../engine/referenceTrackEngine';

async function analyze(channels:Float32Array[],rate=48000) {
  const close=vi.fn(async()=>{});
  class AudioContext {
    state='running';
    close=close;
    async decodeAudioData() {
      return {numberOfChannels:channels.length,sampleRate:rate,duration:channels[0].length/rate,
        getChannelData:(index:number)=>channels[index]};
    }
  }
  vi.stubGlobal('window',{AudioContext});
  try {
    return await analyzeUploadedReferenceTrack(new Blob(['synthetic decoded input']));
  } finally {
    expect(close).toHaveBeenCalledOnce();vi.unstubAllGlobals();
  }
}

it('measures right-channel audio instead of treating silent left as the complete reference',async()=>{
  const signal=Float32Array.from({length:48000},(_,i)=>.1*Math.sin(2*Math.PI*997*i/48000));
  const report=await analyze([new Float32Array(signal.length),signal]);
  expect(report.integratedLufs).toBeCloseTo(-23,1);
  expect(report.truePeakDbtp).toBeCloseTo(-20,1);
  expect(report.crestFactorDb).toBeCloseTo(6.02,1);
  expect(report.signalMeasurement).toMatchObject({integratedAvailable:true,channels:2,sampleRate:48000});
  expect(report.creativeRecommendations.join(' ')).toContain('not Loudness Range');
});

it('marks short-file loudness unavailable and rejects unweighted multichannel layouts',async()=>{
  const short=await analyze([new Float32Array(100)]);
  expect(short.signalMeasurement).toMatchObject({integratedAvailable:false,unavailableReason:'insufficient-duration'});
  await expect(analyze([new Float32Array(1),new Float32Array(1),new Float32Array(1)])).rejects.toThrow(/channels/i);
});
