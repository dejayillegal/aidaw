#!/usr/bin/env node
/** Native DSP experiment runner. Counterfactuals never change the product renderer. */
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repeats=Number(process.env.DSP_REPEATS || 20);
if(!Number.isSafeInteger(repeats)||repeats<2)throw new Error('DSP_REPEATS must be an integer >=2');
const profiles=(process.env.DSP_PROFILES || 'full').split(',');
const allowed=['full','orderedFanIn','fixedPcmCompressor','dryReturns','noDelayReturn','noReverbReturn','noInsertDelays'];
if(profiles.some(p=>!allowed.includes(p)))throw new Error('Unknown diagnostic profile');
const output=process.env.DSP_OUTPUT || path.join(os.tmpdir(),'aidaw-render-probe.json');
const require=createRequire(root+'/package.json');
let chromium;try{({chromium}=require('playwright'));}catch(error){if(!process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES)throw error;({chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright')));}
const {createServer}=await import(pathToFileURL(root+'/node_modules/vite/dist/node/index.js'));
const server=await createServer({root,server:{host:'127.0.0.1',port:0}});await server.listen();
const browser=await chromium.launch({...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{}),headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
const page=await browser.newPage();await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/recovery-browser.html`);
const report={browser:await browser.version(),scope:'Same-fixture repeatability only. Counterfactual profiles and fixed PCM are diagnostic controls, not product fidelity certification',profiles:[]};
try {
for(const profile of profiles) {
 const result=await page.evaluate(async({profile,repeats})=>{
  const {buildStarterAbletonXml,parseAlsXmlString}=await import('/src/engine/alsXmlEngine.ts');
  const {synthesizeProjectToStereoFloatBuffers}=await import('/src/engine/webAudioSynth.ts');
  const project=parseAlsXmlString(buildStarterAbletonXml('berghain-134',777,4).xml);
  const humanization={microTimingMaxShiftBeats:.015,swingStrength:0,velocityVariancePct:.08,ghostVelocityMin:20,ghostVelocityMax:45,lfoRateHz:.1,lfoDepth:.4,cutoffHz:145,macroTransition:42};
  const master={masterVolumeDb:0,glueCompressionDrive:.35,reverbDecaySec:3.2,reverbReturnLevel:.45,delayFeedback:.42,delayReturnLevel:.4,subBassMonoCutoffHz:120};
  if(profile==='dryReturns'||profile==='noDelayReturn')master.delayReturnLevel=0;
  if(profile==='dryReturns'||profile==='noReverbReturn')master.reverbReturnLevel=0;
  if(profile==='noInsertDelays')project.tracks.forEach(t=>t.devices=t.devices.filter(d=>!/(delay|echo)/i.test(d.xmlTag||d.type||'')));
  const restore=[];
  if(profile==='orderedFanIn') {
    const connect=AudioNode.prototype.connect, disconnect=AudioNode.prototype.disconnect, sums=new WeakMap();
    AudioNode.prototype.connect=function(destination,output=0,input=0){
      if(!(destination instanceof AudioNode)||input!==0)return connect.call(this,destination,output,...(destination instanceof AudioNode?[input]:[]));
      let entries=sums.get(destination);if(!entries){entries=[];sums.set(destination,entries);}
      if(entries.some(e=>e.source===this&&e.output===output))return destination;
      if(entries.length===2){
        const sum=this.context.createGain();
        for(const entry of entries){try{disconnect.call(entry.source,destination,entry.output,0);}catch{}connect.call(entry.source,sum,entry.output,0);}
        connect.call(sum,destination);entries.splice(0,2,{source:sum,output:0});
      }
      connect.call(this,destination,output,input);entries.push({source:this,output});return destination;
    };
    restore.push(()=>{AudioNode.prototype.connect=connect;});
  }

  if(profile==='unityCompression') {
    const original=OfflineAudioContext.prototype.createDynamicsCompressor;
    OfflineAudioContext.prototype.createDynamicsCompressor=function(){const node=original.call(this);node.ratio.value=1;Object.defineProperty(node.ratio,'value',{get:()=>1,set:()=>{}});return node;};
    restore.push(()=>{OfflineAudioContext.prototype.createDynamicsCompressor=original;});
  }
  if(profile==='noOversampling') {
    const original=OfflineAudioContext.prototype.createWaveShaper;
    OfflineAudioContext.prototype.createWaveShaper=function(){const node=original.call(this);Object.defineProperty(node,'oversample',{get:()=> 'none',set:()=>{}});return node;};
    restore.push(()=>{OfflineAudioContext.prototype.createWaveShaper=original;});
  }
  if(profile==='noRetirementDisconnect') {const original=AudioNode.prototype.disconnect;AudioNode.prototype.disconnect=function(){};restore.push(()=>{AudioNode.prototype.disconnect=original;});}
  if(profile==='noInserts')project.tracks.forEach(t=>t.devices=[]);
  if(profile==='firstWindowNotes')project.tracks.forEach(t=>t.clips.forEach(c=>c.notes=c.notes.filter(n=>n.time<4)));

  let render=()=>synthesizeProjectToStereoFloatBuffers(project,humanization,master,44100,4);
  if(profile==='fixedPcmCompressor'){
  const sampleRate=44100, frames=661822; const input=[new Float32Array(frames),new Float32Array(frames)];
  let seed=777;
  for(let i=0;i<frames;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;const noise=(seed/4294967296-.5)*.1;const phase=i/sampleRate;const envelope=Math.exp(-(phase%(.438))*15);input[0][i]=Math.sin(2*Math.PI*80*phase)*envelope+noise;input[1][i]=Math.sin(2*Math.PI*83*phase)*envelope+noise;}
  render=async()=>{
    const ctx=new OfflineAudioContext(2,frames,sampleRate), buffer=ctx.createBuffer(2,frames,sampleRate);buffer.copyToChannel(input[0],0);buffer.copyToChannel(input[1],1);
    const source=ctx.createBufferSource(), compressor=ctx.createDynamicsCompressor();source.buffer=buffer;
    compressor.threshold.value=-20.1;compressor.knee.value=10;compressor.ratio.value=2.525;compressor.attack.value=.03;compressor.release.value=.1;
    source.connect(compressor);compressor.connect(ctx.destination);source.start(0);
    const pcm=await ctx.startRendering();return{left:pcm.getChannelData(0),right:pcm.getChannelData(1)};
  };
  }
  let previous;const runs=[]; const started=performance.now();
  for(let run=0;run<repeats;run++) {
   const pcm=await render();
   let max=0,squares=0,frame=0,channel='left',peak=0;
   if(previous)for(const key of ['left','right'])for(let i=0;i<pcm[key].length;i++){
    const d=pcm[key][i]-previous[key][i];squares+=d*d;peak=Math.max(peak,Math.abs(pcm[key][i]));if(Math.abs(d)>max){max=Math.abs(d);frame=i;channel=key;}
   }
   const result={run,max,rms:Math.sqrt(squares/(pcm.left.length*2)),frame,channel,peak};
   if(max>=.001) result.window={reference:Array.from(previous[channel].slice(Math.max(0,frame-64),frame+65)),actual:Array.from(pcm[channel].slice(Math.max(0,frame-64),frame+65))};
   runs.push(result);previous={left:new Float32Array(pcm.left),right:new Float32Array(pcm.right)};
  }
  restore.forEach(fn=>fn());
  return {profile,wallTimeMs:performance.now()-started,runs};
 },{profile,repeats});
 report.profiles.push(result);await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2));
 console.log(JSON.stringify({profile,wallTimeMs:result.wallTimeMs,max:Math.max(...result.runs.map(r=>r.max)),rms:Math.max(...result.runs.map(r=>r.rms)),violations:result.runs.filter(r=>r.max>=.001).map(({window,...r})=>r)}));
}
const full=report.profiles.find(p=>p.profile==='full');report.status=full?(full.runs.every(r=>r.max<.001&&r.rms<.0001)?'PASS':'FAIL'):'NOT TESTED';if(report.status==='FAIL')process.exitCode=1;await fs.writeFile(output,JSON.stringify(report,null,2));console.log(`Diagnostic evidence: ${output}`);
}finally{await browser.close();await server.close();}
