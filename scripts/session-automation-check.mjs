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
      e.seek(6);e.start();await new Promise(resolve=>{setTimeout(resolve,90)});
      const beat=e.getCurrentBeat(),expected=10**(((beat/8-.55)*8)/20);
      const actual=e.bus.masterGain.gain.value;
      const error=Math.abs(actual-expected);
      cases.push({name:'actual-live-master-after-seek',beat,actual,expected,error,budget:2e-4,status:error<2e-4?'PASS':'FAIL'});
      const predicted=e.getSessionLaunchBeat();
      const launchError=Math.abs(predicted-(e.getCurrentBeat()+.3));
      cases.push({name:'actual-live-mapped-launch',launchError,budget:.01,status:launchError<.01?'PASS':'FAIL'});
    } finally {e.stop();await e.getAudioContext()?.close();}
    // Freeze JS scheduling before the seam. Native AudioParam events must apply
    // the restart tempo without waiting for another main-thread scheduler tick.
    p.tempoMap=[{beat:0,bpm:120},{beat:2,bpm:240}];
    const loopEngine=new ParametricWebAudioEngine();
    loopEngine.setState(p,DEFAULT_HUMANIZATION,{...DEFAULT_TRANSPORT,loopEnabled:true,loopStartBar:1,loopLengthBars:1},DEFAULT_MASTER_BUS);
    try {
      loopEngine.seek(3.8);loopEngine.start();clearInterval(loopEngine.schedulerTimerId);
      await new Promise(resolve=>{setTimeout(resolve,100)});
      const delay=loopEngine.bus.delayNodeL.delayTime.value;
      cases.push({name:'native-return-loop-seam-without-js-tick',delay,expected:.375,status:Math.abs(delay-.375)<1e-6?'PASS':'FAIL'});
      loopEngine.setState({...p,tempo:90,tempoMap:undefined},DEFAULT_HUMANIZATION,undefined,DEFAULT_MASTER_BUS);
      await new Promise(resolve=>{setTimeout(resolve,30)});
      const staticDelay=loopEngine.bus.delayNodeL.delayTime.value;
      cases.push({name:'native-return-map-removal',delay:staticDelay,expected:.5,status:Math.abs(staticDelay-.5)<1e-6?'PASS':'FAIL'});
    } finally {loopEngine.stop();await loopEngine.getAudioContext()?.close();}

    const {insertDeviceIntoChannelStrip}=await import('/src/engine/channelStripEngine.ts');
    const {storeArrangementClipInSession,queueSessionLaunch,captureSessionPerformance}=await import('/src/services/commandBus.ts');
    const {evaluatePlayableSessionEvents}=await import('/src/engine/timelineCoordinates.ts');
    const {synthesizeProjectToStereoFloatBuffers}=await import('/src/engine/webAudioSynth.ts');
    let session=parseAlsXmlString(buildStarterAbletonXml('berghain-134',777,4).xml);
    session.tracks=session.tracks.slice(0,1);session.tempo=120;
    const track=session.tracks[0],template=track.clips[0].notes[0];
    track.devices=track.devices.filter(d=>!['MidiChord','MidiArpeggiator'].includes(d.xmlTag));
    track.clips=[{...track.clips[0],length:4,endTime:4,notes:[
      {...template,id:'pass',time:0,quantizedTime:0,duration:3,probability:1},
      {...template,id:'fail',time:1,quantizedTime:1,duration:1,probability:0},
    ]}];
    track.mixer={...track.mixer,sidechainDepth:0,reverbSend:0,delaySend:0};track.automationPoints=[];
    session=insertDeviceIntoChannelStrip(session,track.id,'MidiArpeggiator').project;
    session=storeArrangementClipInSession(session,track.id,0,track.clips[0].id);
    session=queueSessionLaunch(session,track.id,0,0,1);session.tracks[0].clips=[];
    const expectedEvents=evaluatePlayableSessionEvents(session,0,4);
    const captured=captureSessionPerformance(session,0,4,0);
    captured.audioSettings.transport.arrangementMode='arrangement';
    const reference=structuredClone(captured);
    reference.tracks[0].devices=reference.tracks[0].devices.filter(d=>d.xmlTag!=='MidiArpeggiator');
    reference.tracks[0].clips=[{id:'expected',name:'Expected performed MIDI',startTime:0,length:4,endTime:4,
      notes:expectedEvents.map((e,i)=>({...e.note,id:`expected-${i}`,probability:1}))}];
    const dry={...DEFAULT_MASTER_BUS,masterAutomationPoints:[],reverbReturnLevel:0,delayReturnLevel:0};
    const h={...DEFAULT_HUMANIZATION,lfoDepth:0};
    const actualPcm=await synthesizeProjectToStereoFloatBuffers(captured,h,dry,44100,1);
    const expectedPcm=await synthesizeProjectToStereoFloatBuffers(reference,h,dry,44100,1);
    let maxError=0,squares=0;
    for(const channel of ['left','right'])for(let i=0;i<actualPcm[channel].length;i++){
      const delta=actualPcm[channel][i]-expectedPcm[channel][i];maxError=Math.max(maxError,Math.abs(delta));squares+=delta*delta;
    }
    const rmsError=Math.sqrt(squares/(2*actualPcm.left.length));
    cases.push({name:'session-capture-probability-pcm',events:expectedEvents.length,maxError,rmsError,
      status:expectedEvents.length>4&&actualPcm.left.length===expectedPcm.left.length&&maxError<.001&&rmsError<.0001?'PASS':'FAIL'});
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
