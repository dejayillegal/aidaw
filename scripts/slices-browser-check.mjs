import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright') : 'playwright');
const output = process.env.SLICES_OUTPUT || '/tmp/aidaw-slices-browser.json';
const server = await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
const report = {status:'FAIL',scope:'Native browser signal-key compressor, sustained parameter automation and shared full-project WAV render; not physical Android or producer qualification',errors:[]};
let browser;
try {
  await server.listen();
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  report.browser=browser.version(); const page=await browser.newPage();
  page.on('pageerror',e=>report.errors.push(String(e)));
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/recovery-browser.html`);
  report.audio=await page.evaluate(async()=>{
    const {prepareSidechainModule}=await import('/src/engine/sidechainGraph.ts');
    const {scheduleParameterLane}=await import('/src/engine/parameterAutomation.ts');
    const rms=(data,from,to)=>{let sum=0;for(let i=from;i<to;i++)sum+=data[i]*data[i];return Math.sqrt(sum/(to-from));};
    const compress=async(keyAmplitude)=>{
      const rate=48000,ctx=new OfflineAudioContext(2,rate*2,rate);await prepareSidechainModule(ctx);
      const node=new AudioWorkletNode(ctx,'aidaw-sidechain-v1',{numberOfInputs:2,numberOfOutputs:1,outputChannelCount:[2]});
      node.parameters.get('thresholdDb').value=-20;node.parameters.get('ratio').value=4;node.parameters.get('attackMs').value=1;
      const target=ctx.createOscillator(),targetGain=ctx.createGain();target.frequency.value=200;targetGain.gain.value=.25;
      target.connect(targetGain);targetGain.connect(node,0,0);
      const key=ctx.createOscillator(),keyGain=ctx.createGain();key.frequency.value=1000;keyGain.gain.value=keyAmplitude;
      key.connect(keyGain);keyGain.connect(node,0,1);node.connect(ctx.destination);target.start();key.start();
      const rendered=await ctx.startRendering(),data=rendered.getChannelData(0);node.port.close();node.disconnect();
      return {rms:rms(data,rate,rate*2),finite:data.every(Number.isFinite)};
    };
    const dry=await compress(0),ducked=await compress(1);
    const rate=48000,ctx=new OfflineAudioContext(1,rate*2,rate),tone=ctx.createOscillator(),gain=ctx.createGain();
    tone.frequency.value=1000;tone.connect(gain);gain.connect(ctx.destination);
    scheduleParameterLane(gain.gain,{version:1,id:'gain',target:'volumeDb',enabled:true,points:[{beat:0,value:-24,curve:'linear'},{beat:4,value:0}]},{tempo:120},0,4,0);
    tone.start();const swept=await ctx.startRendering(),data=swept.getChannelData(0);
    return {dry,ducked,reductionDb:20*Math.log10(dry.rms/ducked.rms),sweepStartRms:rms(data,4800,9600),sweepEndRms:rms(data,86400,91200)};
  });
  assert(report.audio.dry.finite&&report.audio.ducked.finite);
  assert(report.audio.reductionDb>10&&report.audio.reductionDb<18,`Measured GR outside expected transfer range: ${report.audio.reductionDb}`);
  assert(report.audio.sweepEndRms>report.audio.sweepStartRms*5,'Sustained-note channel automation must change real PCM');
  report.project=await page.evaluate(async()=>{
    const {createEditableFullTrack}=await import('/src/services/projectCreationService.ts');
    const {projectAudioSettings}=await import('/src/engine/projectDefaults.ts');
    const {renderArrangementToWavBlob}=await import('/src/engine/webAudioSynth.ts');
    const {parseAlsXmlString}=await import('/src/engine/alsXmlEngine.ts');
    const p=createEditableFullTrack({title:'Native slices',subgenreId:'hardgroove',bpm:142,durationBars:8,layerDensity:'full_reference',seed:778});
    const settings=projectAudioSettings(p),result=await renderArrangementToWavBlob(p,settings.humanization,settings.masterBus,8,24);
    const decode=new AudioContext(),audio=await decode.decodeAudioData(await result.blob.arrayBuffer());let peak=0,energy=0;
    for(const sample of audio.getChannelData(0)){if(!Number.isFinite(sample))throw new Error('Nonfinite rendered audio');peak=Math.max(peak,Math.abs(sample));energy+=sample*sample;}
    const stems=[];
    for(const track of p.tracks.slice(0,2)) {
      const stem=await renderArrangementToWavBlob(p,settings.humanization,settings.masterBus,8,24,undefined,undefined,{trackIds:[track.id],includeReturns:false,includeMaster:false});
      const decoded=await decode.decodeAudioData(await stem.blob.arrayBuffer());
      let sum=0;for(const v of decoded.getChannelData(0)){if(!Number.isFinite(v))throw new Error('Nonfinite stem');sum+=v*v;}
      stems.push({id:track.id,frames:decoded.length,rms:Math.sqrt(sum/decoded.length)});
    }
    const reimport=parseAlsXmlString(p.rawXmlModified);
    const reopenedWav=await renderArrangementToWavBlob(reimport,settings.humanization,settings.masterBus,8,24);
    const reopenedAudio=await decode.decodeAudioData(await reopenedWav.blob.arrayBuffer());
    let maxDifference=0,errorEnergy=0;
    if(reopenedAudio.length!==audio.length)throw new Error('Reopen changed render extent');
    for(let ch=0;ch<2;ch++){const before=audio.getChannelData(ch),after=reopenedAudio.getChannelData(ch);for(let i=0;i<before.length;i++){const diff=before[i]-after[i];maxDifference=Math.max(maxDifference,Math.abs(diff));errorEnergy+=diff*diff;}}
    await decode.close();
    return {tracks:p.tracks.length,atoms:p.tracks.filter(t=>['riser','impact','downlifter'].includes(t.layer?.variant)).length,
      compressors:p.tracks.filter(t=>t.sidechainCompressor?.enabled).length,bytes:result.blob.size,frames:audio.length,peak,rms:Math.sqrt(energy/audio.length),stems,reopenMaxDifference:maxDifference,reopenRmsDifference:Math.sqrt(errorEnergy/(audio.length*2)),roundtrip:JSON.stringify(reimport.tracks.map(t=>[t.layer,t.parameterAutomation,t.sidechainCompressor]))===JSON.stringify(p.tracks.map(t=>[t.layer,t.parameterAutomation,t.sidechainCompressor]))};
  });
  assert(report.project.tracks>8);assert(report.project.atoms>=2);assert(report.project.compressors>=2);
  assert(report.project.peak>.001&&report.project.rms>.0001);assert(report.project.roundtrip);
  assert(report.project.stems.every(stem=>stem.frames===report.project.frames&&stem.rms>.0001),'Stems must be audible and exactly time-aligned to the full render');
  assert(report.project.reopenMaxDifference<.001&&report.project.reopenRmsDifference<.0001,'Save/reopen must preserve rendered audio within existing parity tolerances');
  assert.deepEqual(report.errors,[]);report.status='PASS';
} catch(error){report.error=String(error);process.exitCode=1;}
finally{await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2));await browser?.close();await server.close();}
console.log(JSON.stringify(report));
