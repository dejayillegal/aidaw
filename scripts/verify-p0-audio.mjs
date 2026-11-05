#!/usr/bin/env node
// Real Web Audio + independent FFmpeg decode. Never substitutes for physical Android.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createServer} from 'vite';
const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'docs/p0-resume/evidence/audio');await fs.mkdir(output,{recursive:true});
const require=createRequire(import.meta.url);
const {chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES||path.join(root,'node_modules'),'playwright'));
const report={source:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),fixture:'SYNTHETIC',status:'BLOCKED',cases:[]};
let browser,server;
try {
  browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  server=await createServer({root,server:{host:'127.0.0.1',port:0,watch:null,hmr:false}});await server.listen();
  const page=await browser.newPage();page.setDefaultTimeout(60000);
  let wave;
  await page.exposeFunction('saveP0Wav',bytes=>{wave=Buffer.from(bytes);});
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/p0-audio-browser.html`);
  await page.waitForFunction(()=>typeof window.runP0Audio==='function');
  for(const [replacement,role] of [['Operator','instrument'],['Analog','instrument'],['Wavetable','instrument'],['EQEight','audio_effect'],['Reverb','audio_effect'],['Compressor2','audio_effect']]) {
    const result=await page.evaluate(([replacement,role])=>window.runP0Audio(replacement,role),[replacement,role]);
    const file=path.join(output,`${replacement}.wav`);await fs.writeFile(file,wave);
    const pcm=execFileSync('ffmpeg',['-v','error','-i',file,'-f','f32le','-acodec','pcm_f32le','-'],{maxBuffer:128*1024*1024});
    let energy=0,peak=0;for(let i=0;i<pcm.length;i+=4){const x=pcm.readFloatLE(i);if(!Number.isFinite(x))throw new Error('NONFINITE_DECODE');energy+=x*x;peak=Math.max(peak,Math.abs(x));}
    const rms=Math.sqrt(energy/(pcm.length/4));if(!(rms>1e-6))throw new Error('SILENT_INDEPENDENT_DECODE');
    report.cases.push({...result,wav:{file:path.basename(file),sha256:createHash('sha256').update(wave).digest('hex'),decodedSamples:pcm.length/4,rms,peak,decoder:'FFmpeg f32le'}});
  }
  report.status='PASS';
} catch(e) {report.error=String(e);process.exitCode=1;}
finally {await browser?.close();await server?.close();await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));}
