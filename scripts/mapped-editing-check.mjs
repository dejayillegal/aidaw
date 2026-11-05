import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'vite';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const output=process.env.MAPPED_EDITING_OUTPUT || '/tmp/aidaw-mapped-editing';
await fs.mkdir(output,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:0}});
let browser;
const report={scope:'Visible mixed-meter Spot placement and ruler/piano synchronization; browser touch geometry only, not hardware qualification',cases:[],errors:[]};
try {
  await server.listen();
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
  report.browser=browser.version();
  const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
  for(const viewport of [{width:1440,height:1000},{width:390,height:844}]) {
    const context=await browser.newContext({viewport});
    await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.fulfill({status:200,body:''}));
    const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
    await page.goto(`${origin}/tests/recovery-browser.html`);
    const snapshot=await page.evaluate(async()=>{
      const {buildStarterAbletonXml,parseAlsXmlString}=await import('/src/engine/alsXmlEngine.ts');
      const {encodeProjectSnapshot}=await import('/src/services/projectSnapshotService.ts');
      const {projectAudioSettings}=await import('/src/engine/projectDefaults.ts');
      const p=parseAlsXmlString(buildStarterAbletonXml('berghain-134',777,4).xml);
      p.fileName='Mapped_Meter';p.meterMap=[{bar:1,beat:0,numerator:3,denominator:4},{bar:3,beat:6,numerator:7,denominator:8}];
      p.tracks=p.tracks.slice(0,1);const c=p.tracks[0].clips[0],n=c.notes[0];
      p.tracks[0].clips=[{...c,startTime:0,length:13,endTime:13,notes:[.25,6.25,12.25].map((time,i)=>({...n,id:`mapped-${i}`,time,quantizedTime:time}))}];
      p.audioSettings=projectAudioSettings(p);p.audioSettings.transport.followPlayhead=false;p.audioSettings.transport.loopEnabled=false;
      return encodeProjectSnapshot(p,p.audioSettings.humanization,p.audioSettings.masterBus,p.audioSettings.transport);
    });
    await page.goto(origin);
    await page.getByLabel('Open saved DAW project',{exact:true}).setInputFiles({name:'Mapped_Meter.aidaw.json',mimeType:'application/json',buffer:Buffer.from(snapshot)});
    await page.getByText(/^Opened Mapped_Meter/).filter({visible:true}).waitFor();
    if(viewport.width<768) {
      for(const title of ['Close Right Dock','Close Left Dock']) {
        const close=page.getByTitle(title,{exact:true});
        if(await close.isVisible())await close.click();
      }
    }
    await page.getByTitle('Spot Mode: Exact numeric Bar.Beat.16th coordinate placement',{exact:true}).click();
    await page.getByTitle('Target Bar (1-4)',{exact:true}).fill('3');
    const beat=page.getByTitle('Target Beat (1-7)',{exact:true});
    assert.equal(await beat.getAttribute('max'),'7');await beat.fill('7');
    const sub=page.getByTitle('Target 16th (1-2)',{exact:true});
    assert.equal(await sub.getAttribute('max'),'2');await sub.fill('2');
    await page.getByRole('button',{name:'Jump',exact:true}).click();
    await page.waitForFunction(async()=>{const {synthEngine}=await import('/src/engine/webAudioSynth.ts');return Math.abs(synthEngine.getCurrentBeat()-9.25)<1e-8;});
    assert((await page.getByTestId('playhead-midi-grid-sync').innerText()).includes('9.25B'));
    assert.equal(await page.getByTestId('transport-position').innerText(),'003.7.2');
    const stored=await page.evaluate(async()=>{
      const {projectQueueService:q}=await import('/src/services/projectQueueService.ts');
      const p=q.getActiveItem().workingProjectState;
      return {bars:p.arrangementLengthBars,meters:p.meterMap,noteTimes:p.tracks[0].clips[0].notes.map(n=>n.time)};
    });
    assert.equal(stored.bars,4);assert.deepEqual(stored.noteTimes,[.25,6.25,12.25]);
    await page.screenshot({path:path.join(output,`mapped-${viewport.width}.png`)});
    report.cases.push({viewport,spotBeat:9.25,beatMaximum:7,sixteenthMaximum:2,scorePreserved:true,status:'PASS'});
    await context.close();
  }
  assert.deepEqual(report.errors,[]);report.status='PASS';
}catch(error){report.status='FAIL';report.error=String(error);process.exitCode=1;}
finally{await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser?.close();await server.close();}
console.log(JSON.stringify(report));
