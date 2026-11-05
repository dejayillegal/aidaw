#!/usr/bin/env node
// Real Web Audio + independent FFmpeg decode. Never substitutes for physical Android.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
const root=path.resolve(import.meta.dirname,'..');
const output=process.env.P0_AUDIO_OUTPUT || path.join(root,'docs/p0-resume/evidence/audio');await fs.mkdir(output,{recursive:true});
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||path.join(root,'node_modules'),'playwright'));
let source = process.env.GITHUB_SHA || '1844666164b35a0a68b7ddb0ee31d1ab90765f23';
try {
  source = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
} catch {}
const report = { source, fixture: 'SYNTHETIC', status: 'BLOCKED', cases: [] };
let browser,server;
try {
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:null,hmr:false}});await server.listen();
  const page=await browser.newPage();page.setDefaultTimeout(60000);
  let wave;
  await page.exposeFunction('saveP0Wav',bytes=>{wave=Buffer.from(bytes);});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/p0-audio-browser.html`);
  await page.waitForFunction(()=>typeof window.runP0Audio==='function');
  for(const [replacement,role,dynamic=false] of [['Operator','instrument'],['Analog','instrument'],['Wavetable','instrument'],['EQEight','audio_effect'],['Reverb','audio_effect'],['Compressor2','audio_effect'],['Operator','instrument',true]]) {
    const result=await page.evaluate(([replacement,role,dynamic])=>window.runP0Audio(replacement,role,dynamic),[replacement,role,dynamic]);
    const file=path.join(output,`${replacement}${dynamic?'-tempo-map':''}.wav`);await fs.writeFile(file,wave);const wavSha256=createHash('sha256').update(wave).digest('hex');
    const pcm=execFileSync('ffmpeg',['-v','error','-i',file,'-f','f32le','-acodec','pcm_f32le','-'],{maxBuffer:128*1024*1024});
    let energy=0,peak=0;for(let i=0;i<pcm.length;i+=4){const x=pcm.readFloatLE(i);if(!Number.isFinite(x))throw new Error('NONFINITE_DECODE');energy+=x*x;peak=Math.max(peak,Math.abs(x));}
    if(dynamic && Math.abs(pcm.length/8-Math.ceil(result.expectedTotalSeconds*44100))>1)throw new Error('TEMPO_MAP_WAV_DURATION');
    const rms=Math.sqrt(energy/(pcm.length/4));if(!(rms>1e-6))throw new Error('SILENT_INDEPENDENT_DECODE');
    if(dynamic){
      await page.evaluate(()=>window.repeatP0Wav());
      const repeatFile=path.join(output,'Operator-tempo-map-repeat.wav');await fs.writeFile(repeatFile,wave);
      const repeated=execFileSync('ffmpeg',['-v','error','-i',repeatFile,'-f','f32le','-acodec','pcm_f32le','-'],{maxBuffer:128*1024*1024});
      if(repeated.length!==pcm.length)throw new Error('REPEAT_LENGTH');
      let maxError=0,squaredError=0;for(let i=0;i<pcm.length;i+=4){const delta=Math.abs(pcm.readFloatLE(i)-repeated.readFloatLE(i));maxError=Math.max(maxError,delta);squaredError+=delta*delta;}
      const rmsError=Math.sqrt(squaredError/(pcm.length/4));
      if(!(maxError<0.001&&rmsError<0.0001))throw new Error('REPEAT_TEMPO_MAP_PCM '+JSON.stringify({maxError,rmsError}));
      result.repeatedPcm={maxError,rmsError,maxTolerance:0.001,rmsTolerance:0.0001,repeatSha256:createHash('sha256').update(wave).digest('hex')};
    }
    report.cases.push({...result,wav:{file:path.basename(file),sha256:wavSha256,decodedSamples:pcm.length/4,rms,peak,decoder:'FFmpeg f32le'}});
  }
  report.status='PASS';
} catch(e) {report.error=String(e);process.exitCode=1;}
finally {await browser?.close();await server?.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
