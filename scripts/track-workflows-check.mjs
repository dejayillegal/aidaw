#!/usr/bin/env node
/** Real UI controls, canonical queue/history inspection, browser file download/reopen. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createServer } from 'vite';

async function poll(read,predicate,message) {
  const end=Date.now()+10000;
  while(Date.now()<end) { const result=await read(); if(predicate(result)) return result; await new Promise(resolve=>{setTimeout(resolve,30)}); }
  throw new Error(message);
}

export async function runSessionWorkflows(page,origin,output) {
  await page.goto(`${origin}/tests/recovery-browser.html`);
  const fixture=await page.evaluate(async()=>{
    const {buildStarterAbletonXml,parseAlsXmlString}=await import('/src/engine/alsXmlEngine.ts');
    const {encodeProjectSnapshot}=await import('/src/services/projectSnapshotService.ts');
    const {DEFAULT_HUMANIZATION,DEFAULT_MASTER_BUS,DEFAULT_TRANSPORT}=await import('/src/engine/projectDefaults.ts');
    const p=parseAlsXmlString(buildStarterAbletonXml('berghain-134',777,4).xml);p.tempo=120;p.arrangementLengthBars=1;p.tracks=p.tracks.slice(0,2);
    p.tracks.forEach((t,i)=>{t.devices=[];t.mixer.reverbSend=0;t.mixer.delaySend=0;t.mixer.sidechainDepth=0;
      t.clips=[{...t.clips[0],id:`arr-${i}`,startTime:0,endTime:1,length:1,notes:[{...t.clips[0].notes[0],id:`note-${i}`,time:0.125,quantizedTime:0.125,duration:2,probability:1}]}];});
    return encodeProjectSnapshot(p,DEFAULT_HUMANIZATION,DEFAULT_MASTER_BUS,DEFAULT_TRANSPORT);
  });
  await page.goto(origin);
  await page.getByLabel('Open saved DAW project',{exact:true}).setInputFiles({name:'session-fixture.aidaw.json',mimeType:'application/json',buffer:Buffer.from(fixture)});
  const read=()=>page.evaluate(async()=>{
    const {projectQueueService:q}=await import('/src/services/projectQueueService.ts');
    const {synthEngine}=await import('/src/engine/webAudioSynth.ts');
    const p=q.getItem(q.getActiveQueueId()).workingProjectState;
    return {project:p,playing:synthEngine.getIsPlaying(),beat:synthEngine.getCurrentBeat(),meters:p.tracks.map(t=>synthEngine.getTrackMeterLevels(t.id))};
  });
  const initial=await poll(read,v=>v.project.tracks.length===2 && v.project.tempo===120,'Session fixture not installed');
  await page.getByRole('button',{name:'SESSION MATRIX',exact:true}).click();
  for(const track of initial.project.tracks) await page.getByRole('button',{name:`Copy ${track.name} first clip to slot A`,exact:true}).click();
  await page.getByLabel('Session launch quantization',{exact:true}).selectOption('1');
  await page.getByRole('button',{name:'Launch Scene A',exact:true}).click();
  const live=await poll(read,v=>v.playing&&v.beat>0.5,'Session launch did not advance real audio clock');
  assert.deepEqual(live.project.tracks.map(t=>t.clips),initial.project.tracks.map(t=>t.clips),'Session launch modified Arrangement');
  assert.equal(live.project.session.events.length,2);
  assert(live.project.session.events.every(e=>e.atBeat===0));
  let audible=[false,false];
  const audibleUntil=Date.now()+1300;
  while(Date.now()<audibleUntil) {const v=await read();v.meters.forEach((m,i)=>{if(m.peakDb>-55)audible[i]=true;});await new Promise(r=>{setTimeout(r,20)});}
  assert(audible.every(Boolean),'Both launched Session tracks must produce native meter activity');
  await poll(read,v=>v.playing&&v.beat>4.5,'Session incorrectly stopped at the one-bar Arrangement end');
  await page.getByLabel('Capture from beat',{exact:true}).fill('0');
  await page.getByLabel('Capture to beat',{exact:true}).fill('4');
  await page.getByLabel('Capture destination beat',{exact:true}).fill('8');
  await page.getByRole('button',{name:'Append Session capture',exact:true}).click();
  const captured=await poll(read,v=>v.project.tracks.every(t=>t.clips.length===5),'Explicit capture did not append four cycles');
  assert.deepEqual(captured.project.tracks.map(t=>t.clips[0]),initial.project.tracks.map(t=>t.clips[0]));
  await page.getByRole('button',{name:`Stop Session track ${initial.project.tracks[0].name}`,exact:true}).click();
  const stopped=await poll(read,v=>v.project.session.events.length===3,'Track stop not recorded');
  const stopAt=stopped.project.session.events.at(-1).atBeat;
  await poll(read,v=>v.beat>stopAt+1,'Quantized track stop boundary not reached');
  let stoppedPeak=-60,otherPeak=-60;
  const silenceUntil=Date.now()+800;
  while(Date.now()<silenceUntil){const v=await read();stoppedPeak=Math.max(stoppedPeak,v.meters[0].peakDb);otherPeak=Math.max(otherPeak,v.meters[1].peakDb);await new Promise(r=>{setTimeout(r,20)});}
  assert(stoppedPeak<=-55 && otherPeak>-55,`Independent stop failed: ${JSON.stringify({stoppedPeak,otherPeak})}`);
  await page.getByRole('button',{name:'Return to Arrangement',exact:true}).click();
  const returned=await poll(read,v=>!v.playing&&v.beat===0&&v.project.audioSettings.transport.arrangementMode==='arrangement','Return did not reset ownership');
  await page.keyboard.press('Control+z');
  await poll(read,v=>v.project.audioSettings.transport.arrangementMode==='session','Return to Arrangement must be undoable');
  await page.keyboard.press('Control+Shift+z');
  await poll(read,v=>v.project.audioSettings.transport.arrangementMode==='arrangement','Return redo failed');
  await page.getByRole('button',{name:'File',exact:true}).click();const downloading=page.waitForEvent('download');
  await page.getByRole('button',{name:'Save Project (.aidaw.json)…',exact:true}).click();
  const downloaded=await downloading;const file=path.join(output,'session-performance.aidaw.json');await downloaded.saveAs(file);
  assert.equal(JSON.parse(await fs.readFile(file,'utf8')).version,3,'Session state must require the new native reader');
  const recoveredSession=await page.evaluate(async()=>{
    const {projectQueueService,ProjectQueueService}=await import('/src/services/projectQueueService.ts');
    await projectQueueService.flushPersistence();
    const reader=new ProjectQueueService();const restored=await reader.restorePersistedProjects();
    return restored?.session;
  });
  assert.deepEqual(recoveredSession,returned.project.session,'Real IndexedDB must restore Session journal state');
  await page.reload();await page.getByLabel('Open saved DAW project',{exact:true}).setInputFiles(file);
  const reopened=await poll(read,v=>v.project.session?.events.length===3,'Session performance not reopened');
  assert.deepEqual(reopened.project.tracks,returned.project.tracks);assert.deepEqual(reopened.project.session,returned.project.session);
  await page.getByRole('button',{name:'SESSION MATRIX',exact:true}).click();
  for(const viewport of [{width:360,height:640},{width:900,height:720},{width:800,height:360},{width:1440,height:900}]){
    await page.setViewportSize(viewport);const button=page.getByRole('button',{name:'Return to Arrangement',exact:true});await button.scrollIntoViewIfNeeded();
    const box=await button.boundingBox();assert(box&&box.x>=0&&box.x+box.width<=viewport.width+1&&box.y>=0&&box.y+box.height<=viewport.height+1,'Session ownership control clipped');
    await page.screenshot({path:path.join(output,`session-${viewport.width}x${viewport.height}.png`)});
  }
  await page.getByRole('button',{name:'Launch Scene A',exact:true}).click();
  await poll(read,v=>v.playing&&v.beat>0.25&&v.meters.some(m=>m.peakDb>-50),'Sustaining Session test did not produce audio');
  await page.getByRole('button',{name:'Clear performance',exact:true}).click();
  await poll(read,v=>v.project.session.events.length===0,'Performance was not cleared');
  await new Promise(resolve=>{setTimeout(resolve,120)});
  const cleared=await read();assert(cleared.meters.every(m=>m.peakDb<=-55),`Cleared Session retained scheduled voices: ${JSON.stringify(cleared.meters)}`);
  const overLimit=JSON.parse(fixture);const t=overLimit.project.tracks[0];
  t.devices=Array.from({length:11},(_,i)=>({id:`over-${i}`,xmlTag:'Utility',displayName:'Utility',category:'audio_effect',parameters:[]}));
  await page.getByLabel('Open saved DAW project',{exact:true}).setInputFiles({name:'over-limit.aidaw.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(overLimit))});
  await page.getByTitle('Start Playback (Space)',{exact:true}).click();
  await page.getByRole('alert').filter({hasText:/Playback blocked: INSERT_LIMIT/}).waitFor();
  assert.equal((await read()).playing,false,'Over-limit import must not start playback');
  return {status:'PASS',scope:'Visible Session slots/launch/capture/stop/return, native track meters, undo/redo, save/reopen and insert-limit error',
    audibleTracks:audible,stoppedPeak,otherPeak,stopAt,capturedCyclesPerTrack:4,nativeProjectVersion:3,realJournalRecovery:true,deviceQualification:false,liveOfflineCaptureParity:false};
}

export async function runTrackWorkflows(page, origin, output) {
  await page.goto(`${origin}/tests/recovery-browser.html`);
  const fixture = await page.evaluate(async () => {
    const { buildStarterAbletonXml, parseAlsXmlString } = await import('/src/engine/alsXmlEngine.ts');
    const { encodeProjectSnapshot } = await import('/src/services/projectSnapshotService.ts');
    const { DEFAULT_HUMANIZATION, DEFAULT_MASTER_BUS, DEFAULT_TRANSPORT } = await import('/src/engine/projectDefaults.ts');
    const project = parseAlsXmlString(buildStarterAbletonXml('berghain-134',777,4).xml);
    project.tracks = project.tracks.slice(0,2);
    const track = project.tracks[0];
    track.clips = [0,8].map((start,index) => ({ ...track.clips[0], id:`test-clip-${index}`,
      startTime:start, endTime:start+1, length:1,
      notes:[{ ...track.clips[0].notes[0], id:`test-note-${index}`, time:start+0.13,
        quantizedTime:start+0.13, velocity:80, isAccent:false, probability:0.6 }] }));
    return encodeProjectSnapshot(project,DEFAULT_HUMANIZATION,DEFAULT_MASTER_BUS,DEFAULT_TRANSPORT);
  });
  await page.goto(origin);
  await page.getByTitle('Open DAW Workstation Settings').waitFor();
  await page.getByLabel('Open saved DAW project', { exact:true }).setInputFiles({ name:'independent-clips.aidaw.json', mimeType:'application/json', buffer:Buffer.from(fixture) });
  await page.getByText(/^Opened independent-clips\.aidaw\.json\./).filter({visible:true}).waitFor();
  const state = () => page.evaluate(async () => {
    const { projectQueueService } = await import('/src/services/projectQueueService.ts');
    return projectQueueService.getItem(projectQueueService.getActiveQueueId()).workingProjectState;
  });
  const history = () => page.evaluate(async () => {
    const { projectQueueService } = await import('/src/services/projectQueueService.ts');
    const { studioCommandBus } = await import('/src/services/commandBus.ts');
    return studioCommandBus.getHistory(projectQueueService.getActiveQueueId()).map(tx=>tx.label);
  });
  const before = await state();
  await page.getByRole('button',{name:'AI COMPOSER',exact:true}).click();
  await page.getByRole('button',{name:/^Randomize Velocities on/}).click();
  await page.waitForFunction(async () => {
    const {projectQueueService:q} = await import('/src/services/projectQueueService.ts');
    return q.getItem(q.getActiveQueueId()).workingProjectState.tracks[0].clips.every(c=>c.notes[0].velocity!==80);
  });
  const randomized = await state();
  assert.equal(randomized.tracks[0].clips.length,2);
  assert.deepEqual(randomized.tracks[1],before.tracks[1]);
  assert.deepEqual(randomized.tracks[0].clips.map(c=>[c.id,c.startTime,c.length,c.notes[0].probability]),
    before.tracks[0].clips.map(c=>[c.id,c.startTime,c.length,c.notes[0].probability]));
  await page.getByRole('button',{name:'100%',exact:true}).click();
  await page.getByRole('button',{name:/^Apply 100% Quantize/}).click();
  await page.waitForFunction(async () => {
    const {projectQueueService:q} = await import('/src/services/projectQueueService.ts');
    return q.getItem(q.getActiveQueueId()).workingProjectState.tracks[0].clips[1].notes[0].time===8.25;
  },null,{timeout:10000});
  const quantized = await state();
  assert.deepEqual(quantized.tracks[0].clips.map(c=>c.notes[0].time),[0.25,8.25]);
  assert.equal((await history()).length,2,'one transaction per visible action');
  await page.keyboard.press('Control+z');
  assert.deepEqual((await state()).tracks,randomized.tracks);
  await page.keyboard.press('Control+Shift+z');
  assert.deepEqual((await state()).tracks,quantized.tracks);
  await page.getByRole('button',{name:'File',exact:true}).click();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button',{name:'Save Project (.aidaw.json)…',exact:true}).click();
  const download = await downloadPromise;
  const destination = path.join(output,'independent-clips.aidaw.json');
  await download.saveAs(destination);
  const saved = JSON.parse(await fs.readFile(destination,'utf8'));
  assert.deepEqual(saved.project.tracks,quantized.tracks);
  await page.getByTitle('Start Playback (Space)',{exact:true}).click();
  const transportState = () => page.evaluate(async()=>{
    const {synthEngine}=await import('/src/engine/webAudioSynth.ts');
    return {playing:synthEngine.getIsPlaying(),beat:synthEngine.getCurrentBeat()};
  });
  let started = false;
  for (let count=0;count<50;count++) {
    const current = await transportState();
    if(current.playing && current.beat>0.25) { started=true; break; }
    await new Promise(resolve=>{setTimeout(resolve,50)});
  }
  assert(started,'visible Play control must advance the real audio clock');
  await page.getByLabel('Open saved DAW project',{exact:true}).setInputFiles(destination);
  await page.getByText(/^Opened .*aidaw\.json\./).filter({visible:true}).waitFor();
  assert.deepEqual(await transportState(),{playing:false,beat:0},'opening a project resets audio-clock ownership, not only the displayed cursor');
  await page.reload();
  await page.getByLabel('Open saved DAW project',{exact:true}).setInputFiles(destination);
  await page.getByText(/^Opened .*aidaw\.json\./).filter({visible:true}).waitFor();
  assert.deepEqual((await state()).tracks,quantized.tracks);
  const viewports = [{width:360,height:640},{width:900,height:720},{width:800,height:360},{width:1440,height:900}];
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    await page.getByRole('button',{name:'AI COMPOSER',exact:true}).click();
    const button = page.getByRole('button',{name:/^Apply 75% Quantize/});
    await button.scrollIntoViewIfNeeded();
    const box = await button.boundingBox();
    await page.screenshot({path:path.join(output,`track-tools-${viewport.width}x${viewport.height}.png`)});
    const layout = await button.evaluate(el=>{
      const rows=[]; for(let n=el;n;n=n.parentElement) {
        const c=getComputedStyle(n),r=n.getBoundingClientRect();
        rows.push({tag:n.tagName,class:n.className,x:r.x,width:r.width,minWidth:c.minWidth,display:c.display,whiteSpace:c.whiteSpace,overflow:c.overflowX});
      } return rows;
    });
    assert(box && box.x>=0 && box.x+box.width<=viewport.width+1 && box.y>=0 && box.y+box.height<=viewport.height+1,`quantize action is clipped: ${JSON.stringify({viewport,box,layout})}`);
  }
  return {status:'PASS', scope:'track velocity/quantize, undo/redo, native save/reload, action reachability',
    transactions:2, arrangementClips:2, restoredTracks:quantized.tracks.length, viewports,
    deviceQualification:false, fullUiCoverage:false};
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const require = createRequire(import.meta.url);
  let chromium;
  try { ({chromium}=require('playwright')); }
  catch { ({chromium}=require(path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'))); }
  const output = process.env.RECOVERY_BROWSER_OUTPUT || '.recovery-evidence/track-workflows';
  await fs.mkdir(output,{recursive:true});
  const server = await createServer({server:{host:'127.0.0.1',port:0}});
  let browser; const errors=[]; let result;
  try {
    await server.listen();
    browser = await chromium.launch({headless:true, executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,
      args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
    const page = await browser.newPage();
    page.on('pageerror',e=>errors.push(e.message));
    await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,route=>route.fulfill({status:200,contentType:'text/css',body:''}));
    const origin=`http://127.0.0.1:${server.httpServer.address().port}`;
    result = process.env.SESSION_WORKFLOW_ONLY==='1' ? await runSessionWorkflows(page,origin,output) : await runTrackWorkflows(page,origin,output);
    assert.deepEqual(errors,[]);
    result.browser=browser.version();
  } catch(error) { result={status:'FAIL',error:error.stack,errors}; process.exitCode=1; }
  finally {
    await fs.writeFile(path.join(output,'track-workflows.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result));
    await browser?.close(); await server.close();
  }
}
