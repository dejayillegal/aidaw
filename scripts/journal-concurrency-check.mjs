import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {createServer} from 'vite';

const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES?path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright'):'playwright');
const output=process.env.JOURNAL_CONCURRENCY_OUTPUT || '/tmp/aidaw-journal-concurrency';
await fs.mkdir(output,{recursive:true});
const server=await createServer({server:{host:'127.0.0.1',port:0}});
let browser;
const report={scope:'Two independent JS tabs sharing native IndexedDB; normal current-format writer conflicts, no cross-device/cloud merge claim',cases:[]};
try {
  await server.listen();browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
  report.browser=browser.version();const context=await browser.newContext();
  const a=await context.newPage(),b=await context.newPage();
  const url=`http://127.0.0.1:${server.httpServer.address().port}/tests/recovery-browser.html`;
  await a.goto(url);await b.goto(url);
  const ids=await a.evaluate(async()=>{
    const {ProjectQueueService}=await import('/src/services/projectQueueService.ts');
    const {buildStarterAbletonXml,parseAlsXmlString}=await import('/src/engine/alsXmlEngine.ts');
    const p=parseAlsXmlString(buildStarterAbletonXml('berghain-134',777,1).xml);
    window.q=new ProjectQueueService();
    const first=await window.q.enqueueProjectState(p);
    const second=await window.q.enqueueProjectState({...p,fileName:'Healthy_other_project'});
    await window.q.flushPersistence();return [first.queueId,second.queueId];
  });
  await b.evaluate(async()=>{const {ProjectQueueService}=await import('/src/services/projectQueueService.ts');window.q=new ProjectQueueService();await window.q.restorePersistedProjects();});
  const edit=async(page,id,velocity)=>page.evaluate(async({id,velocity})=>{
    const p=window.q.getItem(id).workingProjectState;p.tracks[0].clips[0].notes[0].velocity=velocity;
    window.q.updateWorkingProjectState(id,p);
    try{await window.q.flushPersistence(id);return {saved:true};}
    catch(error){return {saved:false,error:String(error),localVelocity:window.q.getItem(id).workingProjectState.tracks[0].clips[0].notes[0].velocity};}
  },{id,velocity});
  const readRow=async id=>a.evaluate(async id=>{
    const {RECOVERY_IDB_NAME,RECOVERY_IDB_STORE}=await import('/src/services/projectQueueService.ts');
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(RECOVERY_IDB_NAME,1);req.onerror=()=>reject(req.error);
      req.onsuccess=()=>{const db=req.result,tx=db.transaction(RECOVERY_IDB_STORE,'readonly'),read=tx.objectStore(RECOVERY_IDB_STORE).get(id);
        read.onsuccess=()=>{db.close();resolve(read.result || null);};read.onerror=()=>reject(read.error);};
    });
  },id);
  assert.equal((await edit(a,ids[0],80)).saved,true);
  const backupBefore=await readRow(`backup:${ids[0]}`);
  const conflict=await edit(b,ids[0],90);
  assert.equal(conflict.saved,false,'A stale tab must not overwrite a newer journal');
  assert.match(conflict.error,/RECOVERY_CONFLICT/);assert.equal(conflict.localVelocity,90);
  assert.deepEqual(await readRow(`backup:${ids[0]}`),backupBefore,'A rejected save must not alter the backup');
  const reopen=async()=>a.evaluate(async()=>{
    const {ProjectQueueService}=await import('/src/services/projectQueueService.ts');const q=new ProjectQueueService();await q.restorePersistedProjects();
    return q.getAllItems().map(r=>({id:r.queueId,velocity:r.workingProjectState.tracks[0].clips[0].notes[0].velocity}));
  });
  assert.equal((await reopen()).find(r=>r.id===ids[0]).velocity,80);
  assert.equal((await edit(a,ids[0],81)).saved,true,'Serial edits in the winning tab must still save');
  assert.equal((await edit(b,ids[1],72)).saved,true,'One conflicted project must not block a healthy project');
  const state=await reopen();assert.equal(state.find(r=>r.id===ids[0]).velocity,81);assert.equal(state.find(r=>r.id===ids[1]).velocity,72);
  report.cases.push({name:'stale-writer',conflictPreservesLocalCopy:true,winningPrimary:81,healthyProject:72,status:'PASS'});
  const copy=await b.evaluate(async id=>{
    const {encodeProjectSnapshot,decodeProjectSnapshot}=await import('/src/services/projectSnapshotService.ts');
    const {projectAudioSettings}=await import('/src/engine/projectDefaults.ts');
    const p=window.q.getItem(id).workingProjectState,s=projectAudioSettings(p);
    return decodeProjectSnapshot(encodeProjectSnapshot(p,s.humanization,s.masterBus,s.transport)).project.tracks[0].clips[0].notes[0].velocity;
  },ids[0]);assert.equal(copy,90);
  report.cases.push({name:'unsaved-local-snapshot',velocity:copy,status:'PASS'});
  const staleDelete=await b.evaluate(async id=>{
    await window.q.removeQueueItem(id);
    let error;try{await window.q.flushPersistence(id);}catch(e){error=String(e);}
    return {error,localRetained:!!window.q.getItem(id)};
  },ids[0]);
  assert.match(staleDelete.error || '',/RECOVERY_CONFLICT/);assert(staleDelete.localRetained);
  assert.equal((await reopen()).find(r=>r.id===ids[0]).velocity,81);
  report.cases.push({name:'stale-delete',newerPrimaryPreserved:true,localRetained:true,status:'PASS'});
  const bulk=await b.evaluate(async id=>{
    await window.q.clearQueue();
    let error;try{await window.q.flushPersistence(id);}catch(e){error=String(e);}
    return {error,retained:window.q.getAllItems().map(r=>r.queueId)};
  },ids[0]);
  assert.match(bulk.error || '',/RECOVERY_CONFLICT/);assert.deepEqual(bulk.retained,[ids[0]]);
  assert.equal(await readRow(ids[1]),null);assert.equal((await readRow(ids[0])).record.workingProjectState.tracks[0].clips[0].notes[0].velocity,81);
  report.cases.push({name:'bulk-clear',conflictedLocalRetained:true,healthyProjectRemoved:true,status:'PASS'});
  const c=await context.newPage();await c.goto(url);
  await c.evaluate(async()=>{const {ProjectQueueService}=await import('/src/services/projectQueueService.ts');window.q=new ProjectQueueService();await window.q.restorePersistedProjects();});
  const race=await Promise.all([edit(a,ids[0],82),edit(c,ids[0],83)]);
  assert.equal(race.filter(r=>r.saved).length,1);assert.equal(race.filter(r=>!r.saved).length,1);
  const winner=race[0].saved?a:c,velocity=race[0].saved?82:83;
  assert.equal((await reopen()).find(r=>r.id===ids[0]).velocity,velocity);
  report.cases.push({name:'simultaneous-writers',winners:1,losers:1,primaryMatchesWinner:true,status:'PASS'});
  await winner.evaluate(async id=>{
    const {RECOVERY_IDB_NAME,RECOVERY_IDB_STORE}=await import('/src/services/projectQueueService.ts');
    await new Promise((resolve,reject)=>{
      const req=indexedDB.open(RECOVERY_IDB_NAME,1);req.onerror=()=>reject(req.error);
      req.onsuccess=()=>{const db=req.result,tx=db.transaction(RECOVERY_IDB_STORE,'readwrite'),store=tx.objectStore(RECOVERY_IDB_STORE),read=store.get(id);
        read.onsuccess=()=>store.put({...read.result,recoveryVersion:99});
        tx.oncomplete=()=>{db.close();resolve(null);};tx.onabort=()=>reject(tx.error);};
    });
  },ids[0]);
  const futureWrite=await edit(winner,ids[0],86);assert.equal(futureWrite.saved,false);assert.match(futureWrite.error,/RECOVERY_CONFLICT/);
  const futureRow=await readRow(ids[0]);assert.equal(futureRow.recoveryVersion,99);assert.equal(futureRow.record.workingProjectState.tracks[0].clips[0].notes[0].velocity,velocity);
  report.cases.push({name:'future-envelope-replaced-externally',writeRejected:true,originalPreserved:true,status:'PASS'});
  const removed=await a.evaluate(async()=>{
    const p=window.q.getItem(window.q.getAllItems()[0].queueId).workingProjectState;
    const fresh=await window.q.enqueueProjectState({...p,fileName:'Delete_acknowledged'});
    await Promise.all([window.q.removeQueueItem(fresh.queueId),window.q.removeQueueItem(fresh.queueId)]);await window.q.flushPersistence(fresh.queueId);
    return {id:fresh.queueId,localRemoved:!window.q.getItem(fresh.queueId)};
  });
  assert(removed.localRemoved);assert.equal(await readRow(removed.id),null);assert.equal(await readRow(`backup:${removed.id}`),null);
  report.cases.push({name:'acknowledged-delete',memoryAndPrimaryRemoved:true,status:'PASS'});
  report.status='PASS';
}catch(error){report.status='FAIL';report.error=String(error);process.exitCode=1;}
finally{await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser?.close();await server.close();}
console.log(JSON.stringify(report));
