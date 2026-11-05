import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'vite';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright') : 'playwright');
const output=process.env.SESSION_AUTOMATION_OUTPUT || '/tmp/aidaw-session-automation';
await fs.mkdir(output,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:0}});
let browser;
const report={scope:'Synthetic native Web Audio gain curves and the actual live master bus; not hardware output or complete DSP parity',cases:[],errors:[]};
try {
  await server.listen();
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,
    args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  report.browser=browser.version();
  const page=await browser.newPage();
  page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/recovery-browser.html`);
  report.cases=await page.evaluate(async()=>{
    const {scheduleMasterAutomation}=await import('/src/engine/masterAutomation.ts');
    const cases=[];
    const master={masterVolumeDb:0,masterAutomationPoints:[{beat:0,value:0},{beat:8,value:1}]};
    for(const profile of ['step','linear','loop']) {
      const project={tempo:60,tempoMap:[{beat:0,bpm:60,curve:profile==='linear'?'linear':'step'},{beat:profile==='linear'?8:4,bpm:120}]};
      const duration=profile==='linear'?8*Math.log(2):profile==='loop'?3:6;
      const ctx=new OfflineAudioContext(1,Math.ceil(duration*48000),48000);
      const gain=ctx.createGain(),source=ctx.createConstantSource();source.offset.value=1;
      source.connect(gain);gain.connect(ctx.destination);source.start(0);
      if(profile==='loop') {
        scheduleMasterAutomation(gain.gain,project,master,6,8,0);
        scheduleMasterAutomation(gain.gain,project,master,0,2,1,false);
      } else scheduleMasterAutomation(gain.gain,project,master,0,8,0);
      const pcm=(await ctx.startRendering()).getChannelData(0);
      let maxError=0,frame=0;
      for(let i=0;i<pcm.length;i++) {
        const t=i/48000;
        const beat=profile==='linear'?8*Math.expm1(t/8):profile==='loop'?(t<1?6+t*2:t-1):(t<=4?t:4+(t-4)*2);
        const expected=10**(((beat/8-.55)*8)/20);
        const error=Math.abs(pcm[i]-expected);
        if(error>maxError){maxError=error;frame=i;}
      }
      cases.push({name:`native-${profile}-gain`,maxError,frame,budget:2e-5,status:maxError<2e-5?'PASS':'FAIL'});
    }
    const {ParametricWebAudioEngine}=await import('/src/engine/webAudioSynth.ts');
    const {buildStarterAbletonXml,parseAlsXmlString}=await import('/src/engine/alsXmlEngine.ts');
    const {DEFAULT_HUMANIZATION,DEFAULT_MASTER_BUS,DEFAULT_TRANSPORT}=await import('/src/engine/projectDefaults.ts');
    const p=parseAlsXmlString(buildStarterAbletonXml('berghain-134',777,4).xml);
    p.tracks=[];p.tempo=60;p.tempoMap=[{beat:0,bpm:60},{beat:4,bpm:120}];
    const e=new ParametricWebAudioEngine();
    e.setState(p,DEFAULT_HUMANIZATION,{...DEFAULT_TRANSPORT,loopEnabled:false},{...DEFAULT_MASTER_BUS,...master});
    try {
      e.seek(6);e.start();await new Promise(resolve=>setTimeout(resolve,90));
      const beat=e.getCurrentBeat(),expected=10**(((beat/8-.55)*8)/20);
      const actual=e.bus.masterGain.gain.value;
      const error=Math.abs(actual-expected);
      cases.push({name:'actual-live-master-after-seek',beat,actual,expected,error,budget:2e-4,status:error<2e-4?'PASS':'FAIL'});
      const predicted=e.getSessionLaunchBeat();
      const launchError=Math.abs(predicted-(e.getCurrentBeat()+.3));
      cases.push({name:'actual-live-mapped-launch',launchError,budget:.01,status:launchError<.01?'PASS':'FAIL'});
    } finally {e.stop();await e.getAudioContext()?.close();}
    return cases;
  });
  assert.equal(report.errors.length,0);
  assert(report.cases.every(c=>c.status==='PASS'),JSON.stringify(report.cases));
  report.status='PASS';
} catch(error) {report.status='FAIL';report.error=String(error);process.exitCode=1;}
finally {
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  await browser?.close();await server.close();
}
console.log(JSON.stringify(report));
