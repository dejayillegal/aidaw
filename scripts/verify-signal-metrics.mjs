import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {performance} from 'node:perf_hooks';
import {measurePcmSignalMetrics} from '../src/engine/signalMetrics.ts';

// Independent decoded-PCM oracle. Neither the fixture nor FFmpeg calls our filters.
const output = process.env.SIGNAL_METRICS_OUTPUT || '/tmp/aidaw-signal-metrics.json';
const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'aidaw-meter-'));
const tone = (rate,hz,amplitude,seconds=3,phase=0) =>
  Float32Array.from({length:Math.round(rate*seconds)},(_,i)=>amplitude*Math.sin(2*Math.PI*hz*i/rate+phase));
const gated = tone(48000,997,.1,8);
for(let i=48000*2;i<gated.length;i++) gated[i]*=.001;
let noiseSeed=77;
const noise=Float32Array.from({length:48000*3},()=>{
  noiseSeed=(Math.imul(noiseSeed,1664525)+1013904223)>>>0;
  return (noiseSeed/2**32-.5)*.2;
});
const mixed=Float32Array.from({length:48000*3},(_,i)=>
  .12*Math.sin(2*Math.PI*40*i/48000)+.07*Math.sin(2*Math.PI*997*i/48000)+.03*Math.sin(2*Math.PI*12500*i/48000));
const edge=new Float32Array(48000);edge[0]=1.1;edge[edge.length-1]=-1.2;
const fixtures = [
  ...[44100,48000,96000].flatMap(rate=>{
    const a=tone(rate,997,.1), high=tone(rate,rate/4,.04,3,Math.PI/4);
    return [
      {name:`mono-${rate}`,rate,channels:[a]},
      {name:`stereo-${rate}`,rate,channels:[a,a]},
      {name:`right-only-${rate}`,rate,channels:[new Float32Array(a.length),a]},
      {name:`antiphase-${rate}`,rate,channels:[a,a.map(x=>-x)]},
      {name:`quiet-intersample-${rate}`,rate,channels:[high,high]},
      {name:`near-nyquist-${rate}`,rate,channels:[tone(rate,.45*rate,.1,3,.4)]},
    ];
  }),
  {name:'relative-gate',rate:48000,channels:[gated,gated]},
  {name:'over-unity',rate:48000,channels:[tone(48000,997,1.5)]},
  {name:'seeded-noise',rate:48000,channels:[noise,noise]},
  {name:'multitone',rate:48000,channels:[mixed,mixed]},
  {name:'file-edge-impulses',rate:48000,channels:[edge]},
];
const report = {scope:'Synthetic mono/stereo PCM against FFmpeg ebur128, with explicit 100ms zero guards at file boundaries; not full BS.2217 certification or output-device qualification',
  ffmpeg:execFileSync('ffmpeg',['-version'],{encoding:'utf8'}).split('\n')[0],
  node:process.version,budgets:{loudnessLu:.1,truePeakDb:.35},cases:[],status:'FAIL'};
try {
  for(const fixture of fixtures){
    const {name,rate}=fixture;
    // swresample extrapolates unguarded file edges. Both implementations receive
    // the same explicit zero boundary condition for the independent comparison.
    const guard=Math.round(rate*.1);
    const channels=fixture.channels.map(c=>{const padded=new Float32Array(c.length+2*guard);padded.set(c,guard);return padded;});
    const frames=channels[0].length;
    const pcm=Buffer.alloc(frames*channels.length*4);
    for(let i=0;i<frames;i++)for(let c=0;c<channels.length;c++)pcm.writeFloatLE(channels[c][i],4*(i*channels.length+c));
    const file=path.join(temporary,`${name}.f32`);fs.writeFileSync(file,pcm);
    const decoded=spawnSync('ffmpeg',['-hide_banner','-nostats','-f','f32le','-ar',String(rate),'-ac',String(channels.length),'-i',file,'-af','ebur128=peak=true','-f','null','-'],{encoding:'utf8',maxBuffer:8*1024*1024});
    assert.equal(decoded.status,0,decoded.error?.message || decoded.stderr);
    const summary=decoded.stderr.slice(decoded.stderr.lastIndexOf('Summary:'));
    const lufsMatch=summary.match(/I:\s*(-?[\d.]+) LUFS/), peakMatch=summary.match(/Peak:\s*(-?[\d.]+) dBFS/);
    assert(lufsMatch && peakMatch,`Missing independent meter results: ${summary}`);
    const expected={integratedLufs:Number(lufsMatch[1]),truePeakDbtp:Number(peakMatch[1])};
    const started=performance.now(), actual=measurePcmSignalMetrics(channels,rate), elapsedMs=performance.now()-started;
    const loudnessError=Math.abs(actual.integratedLufs-expected.integratedLufs), peakError=Math.abs(actual.truePeakDbtp-expected.truePeakDbtp);
    report.cases.push({name,sampleRate:rate,channels:channels.length,frames,actual,expected,loudnessError,peakError,elapsedMs});
    assert(loudnessError<=report.budgets.loudnessLu,`${name}: loudness error ${loudnessError} LU`);
    assert(peakError<=report.budgets.truePeakDb,`${name}: peak error ${peakError} dB`);
  }
  // Silence and short material must never be advertised as integrated measurements.
  for(const [name,channels] of [
    ['silence',[new Float32Array(48000)]],
    ['short',[tone(48000,997,.1,.1)]],
  ]) {
    const actual=measurePcmSignalMetrics(channels,48000);
    assert.equal(actual.integratedLufsAvailable,false,name);
    report.cases.push({name,actual});
  }
  report.status='PASS';
} catch(error) {
  report.error=String(error);process.exitCode=1;
} finally {
  fs.rmSync(temporary,{recursive:true,force:true});
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(report,null,2));
}
console.log(JSON.stringify(report));
