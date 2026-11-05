import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const output=process.env.SIGNAL_BROWSER_OUTPUT||'/tmp/aidaw-signal-browser.json';
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});
const report={scope:'Native decoded reference-file metrics, cooperative event-loop responsiveness and cancellation; not physical Android or full-session performance',status:'FAIL'};
let browser;
try {
  await server.listen();
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
  report.browser=browser.version();const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/recovery-browser.html`);
  const result=await page.evaluate(async()=>{
    const {analyzeUploadedReferenceTrack}=await import('/src/engine/referenceTrackEngine.ts');
    const {encodeAudioBufferToWavBlob}=await import('/src/engine/wavEncoding.ts');
    const {measurePcmSignalMetricsAsync}=await import('/src/engine/signalMetrics.ts');
    const rate=48000, length=rate*12;
    const left=new Float32Array(length),right=Float32Array.from({length},(_,i)=>.1*Math.sin(2*Math.PI*997*i/rate));
    const blob=await encodeAudioBufferToWavBlob({numberOfChannels:2,sampleRate:rate,length,getChannelData:c=>c?right:left},32);
    let ticks=0,last=performance.now(),maxGapMs=0;
    const timer=setInterval(()=>{const now=performance.now();maxGapMs=Math.max(maxGapMs,now-last);last=now;ticks++;},10);
    const start=performance.now();let analysis;
    try {
      analysis=await analyzeUploadedReferenceTrack(new File([blob],'right-only.wav',{type:'audio/wav'}));
      await new Promise(resolve=>{setTimeout(resolve,15);});
    } finally {clearInterval(timer);}
    const cancel=new AbortController();
    const pending=measurePcmSignalMetricsAsync([right],rate,cancel.signal);cancel.abort();
    let cancelled=false;try{await pending;}catch(error){cancelled=error.name==='AbortError';}
    const retry=await measurePcmSignalMetricsAsync([right.subarray(0,rate)],rate);
    return {analysis,ticks,maxGapMs,elapsedMs:performance.now()-start,cancelled,retryLufs:retry.integratedLufs};
  });
  report.result=result;
  assert(result.ticks>3,'Reference measurement must yield to the native event loop');
  assert(result.maxGapMs<100,`Reference measurement blocked timers for ${result.maxGapMs}ms`);
  assert(Math.abs(result.analysis.integratedLufs+23.01)<.1);
  assert(Math.abs(result.analysis.truePeakDbtp+20)<.1);
  assert(result.cancelled,'Meter cancellation did not abort');
  assert(Math.abs(result.retryLufs+23.01)<.1,'Cancellation poisoned the next measurement');
  report.status='PASS';
}catch(error){report.error=String(error);process.exitCode=1;}
finally{await fs.mkdir(path.dirname(output),{recursive:true});await fs.writeFile(output,JSON.stringify(report,null,2));await browser?.close();await server.close();}
console.log(JSON.stringify(report));
