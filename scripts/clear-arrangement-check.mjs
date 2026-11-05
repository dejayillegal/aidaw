import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createServer} from 'vite';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const output=process.env.CLEAR_OUTPUT||'/tmp/aidaw-clear-check';await fs.mkdir(output,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:0}});let browser;const report={cases:[],scope:'Visible clear/cancel/undo/redo/native reopen; performance qualification remains partial'};
try {
 await server.listen();browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});report.browser=browser.version();
 for(const viewport of [{width:1440,height:900},{width:360,height:640}]){
  const context=await browser.newContext({viewport,acceptDownloads:true});await context.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//,r=>r.fulfill({status:200,body:''}));
  const page=await context.newPage();page.on('pageerror',e=>{throw e});await page.goto(`http://127.0.0.1:${server.httpServer.address().port}`);
  await page.waitForFunction(async()=>{const{projectQueueService:q}=await import('/src/services/projectQueueService.ts');return Boolean(q.getActiveItem()?.workingProjectState)});
  const read=()=>page.evaluate(async()=>{const{projectQueueService:q}=await import('/src/services/projectQueueService.ts');return q.getActiveItem().workingProjectState});
  await page.evaluate(()=>{
    window.clearTimings=[];let start=null,pending=false;
    document.addEventListener('pointerdown',e=>{if(e.target.closest('button')?.textContent.trim()==='Clear Arrangement State...')start=performance.now()},true);
    new MutationObserver(()=>{if(start!==null&&!pending&&document.querySelector('dialog[open]')){pending=true;requestAnimationFrame(()=>{window.clearTimings.push(performance.now()-start);start=null;pending=false})}}).observe(document.body,{subtree:true,childList:true,attributes:true});
  });
  const before=await read();const show=async()=>{await page.getByRole('button',{name:'File',exact:true}).click();await page.getByRole('button',{name:'Clear Arrangement State...',exact:true}).click();await page.getByRole('dialog',{name:'Clear arrangement',exact:true}).waitFor()};
  for(let i=0;i<20;i++){await show();await page.getByRole('button',{name:'Cancel',exact:true}).click()}
  assert.deepEqual((await read()).tracks,before.tracks);
  await show();await page.getByRole('button',{name:'Clear selected content',exact:true}).click();await page.getByRole('dialog',{name:'Clear arrangement',exact:true}).waitFor({state:'hidden'});
  const cleared=await read();assert(cleared.tracks[0].clips.every(c=>!c.notes.length));assert.deepEqual(cleared.tracks.slice(1),before.tracks.slice(1));
  await page.keyboard.press('Control+z');assert.deepEqual((await read()).tracks,before.tracks);await page.keyboard.press('Control+Shift+z');assert.deepEqual((await read()).tracks,cleared.tracks);
  await page.getByRole('button',{name:'File',exact:true}).click();const [download]=await Promise.all([page.waitForEvent('download'),page.getByRole('button',{name:/^Save Project/}).click()]);const file=path.join(output,`cleared-${viewport.width}.aidaw.json`);await download.saveAs(file);
  await page.getByLabel('Open saved DAW project',{exact:true}).setInputFiles(file);await page.getByText(/^Opened .*aidaw\.json\./).filter({visible:true}).waitFor();assert.deepEqual((await read()).tracks,cleared.tracks);
  await page.screenshot({path:path.join(output,`clear-${viewport.width}.png`)});const timings=await page.evaluate(()=>window.clearTimings);timings.sort((a,b)=>a-b);const p95=timings[Math.ceil(timings.length*0.95)-1];report.cases.push({viewport,status:'PASS',cancel:true,undoRedo:true,nativeReopen:true,dialogTiming:{samples:timings.length,p95Ms:p95,budgetMs:100,status:p95<=100?'PASS':'FAIL',method:'pointerdown to next animation frame after native dialog opens; no audio or all-workstation latency claim'}});await context.close();
 }
 report.status='PASS';
}catch(e){report.status='FAIL';report.error=String(e);process.exitCode=1}
finally{await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser?.close();await server.close()}
console.log(JSON.stringify(report));
