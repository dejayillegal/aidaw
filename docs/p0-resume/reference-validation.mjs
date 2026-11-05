// Read-only structural checks of repository ALS files. This does not prove audible output.
import fs from 'node:fs';
import path from 'node:path';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {JSDOM} from 'jsdom';
import {parseAbletonXmlDom,synchronizeProjectStateToXml} from '../../src/engine/alsXmlEngine.ts';
import {assertProjectState,assertStructuralProjectState} from '../../src/engine/projectStateContracts.ts';
const dom=new JSDOM();globalThis.DOMParser=dom.window.DOMParser;globalThis.XMLSerializer=dom.window.XMLSerializer;
const results=[];
for(const name of fs.readdirSync('Sample als').filter(n=>n.endsWith('.als') && (!process.argv[2] || n===process.argv[2]))) {
  const file=path.join('Sample als',name),bytes=fs.readFileSync(file),hash=createHash('sha256').update(bytes).digest('hex');
  try {
    const xml=bytes[0]===31?gunzipSync(bytes).toString('utf8'):bytes.toString('utf8');
    const project=parseAbletonXmlDom(xml,name);assertStructuralProjectState(project);assertProjectState(project);
    const serialized=synchronizeProjectStateToXml(project);const doc=new DOMParser().parseFromString(serialized,'application/xml');
    if(doc.querySelector('parsererror'))throw new Error('EXPORT_XML_PARSE');
    results.push({file,sha256:hash,status:'PASS',tracks:project.tracks.length,notes:project.tracks.reduce((s,t)=>s+t.clips.reduce((c,x)=>c+x.notes.length,0),0),scope:'Structural import and XML serialization only; audio and licensed Live reopen NOT RUN'});
  } catch(e) {results.push({file,sha256:hash,status:'FAIL',error:String(e)});process.exitCode=1;}
  if(createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==hash)throw new Error('REFERENCE_MUTATED');
}
console.log(JSON.stringify({source:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),synthetic:false,results},null,2));
