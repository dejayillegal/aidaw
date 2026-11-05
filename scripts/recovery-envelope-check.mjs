import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createServer} from 'vite';

const input=process.env.RECOVERY_ENVELOPE_INPUT;
if(!input) throw new Error('RECOVERY_ENVELOPE_INPUT must point to the original exported envelope');
const bytes=await fs.readFile(input),envelope=JSON.parse(bytes);
const output=process.env.RECOVERY_ENVELOPE_OUTPUT || '/tmp/aidaw-original-envelope';
await fs.mkdir(output,{recursive:true});
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
  ? path.join(process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES,'playwright') : 'playwright');
const server=await createServer({server:{host:'127.0.0.1',port:0}});
let browser;
const report={scope:'Original exported envelope in an isolated IndexedDB profile; raw project data is never written to this report',
  inputSha256:createHash('sha256').update(bytes).digest('hex'),inputBytes:bytes.length,queueId:envelope.queueId};
try {
  await server.listen();
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE_PATH,
    args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
  report.browser=browser.version();
  const page=await browser.newPage();
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/tests/recovery-browser.html`);
  report.recovery=await page.evaluate(async envelope=>{
    const {ProjectQueueService,RECOVERY_IDB_NAME,RECOVERY_IDB_STORE}=await import('/src/services/projectQueueService.ts');
    await new Promise((resolve,reject)=>{
      const req=indexedDB.open(RECOVERY_IDB_NAME,1);
      req.onupgradeneeded=()=>req.result.createObjectStore(RECOVERY_IDB_STORE,{keyPath:'queueId'});
      req.onerror=()=>reject(req.error);
      req.onsuccess=()=>{
        const db=req.result,tx=db.transaction(RECOVERY_IDB_STORE,'readwrite');
        tx.objectStore(RECOVERY_IDB_STORE).put(envelope);
        tx.oncomplete=()=>{db.close();resolve(null);};tx.onabort=()=>reject(tx.error);
      };
    });
    const q=new ProjectQueueService();
    const restored=await q.restorePersistedProjects();
    let acceptance;
    if(restored) {
      const check=(condition,message)=>{if(!condition)throw new Error(message);};
      check(JSON.stringify(restored.tracks.map(t=>t.clips))===JSON.stringify(envelope.record.workingProjectState.tracks.map(t=>t.clips)),'RECOVERY_SCORE_CHANGED');
      const rows=await new Promise((resolve,reject)=>{
        const req=indexedDB.open(RECOVERY_IDB_NAME,1);
        req.onsuccess=()=>{const db=req.result,tx=db.transaction(RECOVERY_IDB_STORE,'readonly'),read=tx.objectStore(RECOVERY_IDB_STORE).getAll();read.onsuccess=()=>{resolve(read.result);db.close();};read.onerror=()=>reject(read.error);};req.onerror=()=>reject(req.error);
      });
      check(rows.some(row=>row.queueId.startsWith('archive:') && row.rawEnvelopeJson===JSON.stringify(envelope)),'ORIGINAL_ARCHIVE_MISSING');
      const again=await new ProjectQueueService().restorePersistedProjects();
      check(again?.projectRevision===restored.projectRevision,'REPEATED_MIGRATION');
      const {StudioCommandBus}=await import('/src/services/commandBus.ts');
      const bus=new StudioCommandBus();
      const edited=bus.executeMutation(envelope.queueId,'Recovery edit','clip_edit',restored,d=>{
        d.tracks[0].clips[0].notes[0].velocity=100;return d;
      });
      q.updateWorkingProjectState(envelope.queueId,edited);await q.flushPersistence();
      const reopened=await new ProjectQueueService().restorePersistedProjects();
      check(reopened?.tracks[0].clips[0].notes[0].velocity===100,'RECOVERY_EDIT_REOPEN_FAILED');
      const {encodeProjectSnapshot,decodeProjectSnapshot}=await import('/src/services/projectSnapshotService.ts');
      const {projectAudioSettings}=await import('/src/engine/projectDefaults.ts');
      const settings=projectAudioSettings(reopened);
      const saved=decodeProjectSnapshot(encodeProjectSnapshot(reopened,settings.humanization,settings.masterBus,settings.transport));
      check(JSON.stringify(saved.project.tracks.map(t=>t.clips))===JSON.stringify(reopened.tracks.map(t=>t.clips)),'RECOVERY_NATIVE_ROUNDTRIP_FAILED');
      const {synthesizeProjectToStereoFloatBuffers}=await import('/src/engine/webAudioSynth.ts');
      const pcm=await synthesizeProjectToStereoFloatBuffers(reopened,settings.humanization,settings.masterBus,44100,4);
      let peak=0;for(const channel of [pcm.left,pcm.right])for(const sample of channel){check(Number.isFinite(sample),'RECOVERY_NONFINITE_AUDIO');peak=Math.max(peak,Math.abs(sample));}
      check(peak>1e-6,'RECOVERY_SILENT_AUDIO');
      acceptance={originalScorePreserved:true,originalEnvelopeArchived:true,idempotentReopen:true,editSaveReopen:true,nativeSnapshotRoundTrip:true,
        renderedBars:4,renderedFrames:pcm.left.length,peak,full128BarAudioQualified:false};
    }
    let diagnostic;
    if(!restored) {
      let stage='note-identity';
      try {
        const contracts=await import('/src/engine/projectStateContracts.ts');
        const conversion=await import('/src/engine/abletonCapabilityMatrix.ts');
        const xml=await import('/src/engine/alsXmlEngine.ts');
        let p=contracts.migrateLegacyRecoveryNoteIdentities(envelope.record.workingProjectState,envelope.record.sourceXmlSnapshot,true).project;
        stage='conversion';p=conversion.migrateCompatibleProjectUnitConversions(p).project;
        const eligibility=conversion.determineLegacyConversionMigrationEligibility(p,{envelopeConversionSchemaVersion:envelope.conversionSchemaVersion});
        if(eligibility.eligible)p=conversion.migrateMissingLegacyProjectConversions(p).project;
        stage='strict-state';contracts.assertProjectState(p);
        stage='xml-sync';xml.synchronizeProjectStateToXml(p);
      }catch(error){diagnostic={stage,message:String(error),stack:error.stack};}
    }
    return {restored:!!restored,tracks:restored?.tracks.length,bars:restored?.arrangementLengthBars,
      diagnostic,acceptance,
      blocked:q.getBlockedRecoveryRecords().map(({error,eligibilityCode,canRepairLegacyConversions})=>({error,eligibilityCode,canRepairLegacyConversions}))};
  },envelope);
  assert(report.recovery.restored,JSON.stringify(report.recovery));
  report.status='PASS';
} catch(error){report.status='FAIL';report.error=String(error);process.exitCode=1;}
finally{await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));await browser?.close();await server.close();}
console.log(JSON.stringify(report));
