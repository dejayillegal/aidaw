import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const output=process.env.WORKSPACE_FLOW_OUTPUT||'/tmp/aidaw-workspace-flow';await fs.mkdir(output,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:0,hmr:false,watch:null}});let browser;
const report={scope:'Native browser workspace navigation, canonical track/device insertion, undo/save/reopen and responsive geometry; no Android hardware qualification',cases:[],errors:[]};
try{
 await server.listen();browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});report.browser=browser.version();
 const context=await browser.newContext();await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.abort());const page=await context.newPage();page.on('pageerror',e=>report.errors.push(String(e)));page.setDefaultTimeout(20000);
 const origin=`http://127.0.0.1:${server.httpServer.address().port}`;await page.goto(origin);await page.getByTestId('arrangement-clips-canvas').waitFor();
 const fixture=await page.evaluate(async()=>{const{createEditableFullTrack}=await import('/src/services/projectCreationService.ts');const{encodeProjectSnapshot}=await import('/src/services/projectSnapshotService.ts');const{projectAudioSettings}=await import('/src/engine/projectDefaults.ts');const p=createEditableFullTrack({title:'Workspace_Mapped',subgenreId:'raw_warehouse',bpm:128,durationBars:64,layerDensity:'standard',seed:777});const s=projectAudioSettings(p);return encodeProjectSnapshot(p,s.humanization,s.masterBus,s.transport);});
 await page.getByLabel('Open saved DAW project',{exact:true}).setInputFiles({name:'Workspace_Mapped.aidaw.json',mimeType:'application/json',buffer:Buffer.from(fixture)});await page.getByText(/^Opened Workspace_Mapped/).filter({visible:true}).waitFor();
 const state=()=>page.evaluate(async()=>{const{projectQueueService:q}=await import('/src/services/projectQueueService.ts');const p=q.getActiveItem().workingProjectState;return {id:q.getActiveQueueId(),tracks:p.tracks.map(t=>({id:t.id,name:t.name,devices:t.devices.map(d=>d.name)}))};});
 const before=await state();
 for(const viewport of [{width:390,height:844},{width:800,height:360},{width:900,height:720},{width:1440,height:1000}]){
  await page.setViewportSize(viewport);const nav=page.getByRole('navigation',{name:'Studio workspaces'});
  for(const label of ['Arrange','Session','Mixer','Devices','Browser']){
   const button=nav.getByRole('button',{name:label,exact:true});const box=await button.boundingBox();assert(box&&box.width>=44&&box.height>=44);assert(box.x>=0&&box.x+box.width<=viewport.width+1&&box.y>=0&&box.y+box.height<=viewport.height+1);await button.click();assert.equal(await button.getAttribute('aria-current'),'page');
  }
  await nav.getByRole('button',{name:'Arrange',exact:true}).click();
  assert.equal(await page.getByTitle('Close Left Dock',{exact:true}).isVisible(),false);
  assert.equal(await page.getByTestId('timeline-settings').getAttribute('open'),null);
  const settings=page.getByTitle('Open DAW Workstation Settings',{exact:true});await settings.click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Shift+Tab');assert.equal(await page.getByRole('button',{name:'Close settings',exact:true}).last().evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'Close settings',exact:true}).first().evaluate(el=>el===document.activeElement),true);await page.keyboard.press('Escape');assert.equal(await settings.evaluate(el=>el===document.activeElement),true);
  if(viewport.width<768){const click=page.getByRole('button',{name:'Metronome',exact:true});const initial=await click.getAttribute('aria-pressed');await click.click();assert.notEqual(await click.getAttribute('aria-pressed'),initial);assert.equal(await page.evaluate(async()=>{const{projectQueueService:q}=await import('/src/services/projectQueueService.ts');return q.getActiveItem().workingProjectState.audioSettings.transport.metronomeEnabled;}),initial!=='true');await click.click();}
  const after=await state();assert.deepEqual(after,before,'Navigation must not mutate or replace the project');
  await page.screenshot({path:path.join(output,`arrange-${viewport.width}.png`)});report.cases.push({viewport,navigation:'PASS',settings:'PASS',projectPreserved:true});
 }
 const nav=page.getByRole('navigation',{name:'Studio workspaces'});await nav.getByRole('button',{name:'Browser',exact:true}).click();
 await page.getByRole('button',{name:'Track roles',exact:true}).click();await page.getByLabel('Search browser',{exact:true}).fill('Primary Sub Kick');await page.getByRole('button',{name:'Add track',exact:true}).click();
 let after=await state();assert.equal(after.tracks.length,before.tracks.length+1);const added=after.tracks.at(-1);
 await page.getByRole('button',{name:'Devices',exact:true}).last().click();await page.getByLabel('Search browser',{exact:true}).fill('Saturator');
 await page.getByLabel('Browser target track',{exact:true}).selectOption(added.id);await page.getByRole('article').filter({has:page.getByRole('heading',{name:/^Saturator/})}).getByRole('button',{name:'Add device',exact:true}).click();
 after=await state();assert.equal(after.tracks.at(-1).devices.length,added.devices.length+1);
 await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('button',{name:'Undo Cmd+Z',exact:true}).click();assert.deepEqual((await state()).tracks.at(-1).devices,added.devices);
 await page.getByRole('button',{name:'Edit',exact:true}).click();await page.getByRole('button',{name:'Redo Cmd+Y',exact:true}).click();
 const committed=await state();await page.evaluate(async()=>{const{projectQueueService:q}=await import('/src/services/projectQueueService.ts');await q.flushPersistence();});await page.reload();await page.getByTestId('arrangement-clips-canvas').waitFor();
// The canvas also renders the initial project while IndexedDB recovery is pending.
// Wait for the same saved queue item; a missing/different project still times out.
await page.waitForFunction(async expectedId=>{
 const {projectQueueService:q}=await import('/src/services/projectQueueService.ts');
 await q.restorePersistedProjects();
 return q.getActiveQueueId()===expectedId && !!q.getActiveItem()?.workingProjectState;
},committed.id);
assert.deepEqual(await state(),committed);
 report.cases.push({name:'browser-edit-undo-redo-save-reopen',status:'PASS',trackAdded:true,deviceAdded:true});
 const readTempo=()=>page.evaluate(async()=>{const{projectQueueService:q}=await import('/src/services/projectQueueService.ts');const p=q.getActiveItem().workingProjectState;return {tempo:p.tempo,map:p.tempoMap};});
 const originalTempo=await readTempo();await page.getByLabel('Tempo BPM',{exact:true}).fill('143.25');await page.keyboard.press('Tab');
 const changedTempo=await readTempo();assert.equal(changedTempo.tempo,143.25);assert.equal(changedTempo.map.find(p=>p.beat===0).bpm,143.25,'BPM input must update the canonical tempo map used for audio');
 await page.getByLabel('Tempo BPM',{exact:true}).fill('999');await page.keyboard.press('Tab');assert.deepEqual(await readTempo(),changedTempo);
 await page.keyboard.press('Control+z');assert.deepEqual(await readTempo(),originalTempo);
 report.cases.push({name:'tempo-control-map-and-undo',status:'PASS',bpm:143.25});assert.deepEqual(report.errors,[]);report.status='PASS';
}catch(e){report.status='FAIL';report.error=String(e);process.exitCode=1;}
finally{await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser?.close();await server.close();}
console.log(JSON.stringify(report));
