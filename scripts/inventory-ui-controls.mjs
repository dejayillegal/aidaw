#!/usr/bin/env node
/** Static reachability inventory. Presence in this file never constitutes a PASS. */
import { parse } from '@babel/parser';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const output = process.argv[2] || '.recovery-evidence/ui-control-inventory.json';
async function listTsxFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== '__tests__') results.push(...await listTsxFiles(full));
    } else if (entry.name.endsWith('.tsx')) {
      results.push(path.relative(root, full).replace(/\\/g, '/'));
    }
  }
  return results.sort();
}
let files;
try {
  files = execFileSync('rg',['--files','src'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim().split('\n').filter(file=>file.endsWith('.tsx')&&!file.includes('__tests__'));
} catch {
  files = await listTsxFiles(path.join(root, 'src'));
}
const controls=[]; const componentEdges=[];
for(const file of files) {
  const text=await fs.readFile(file,'utf8');
  const source=parse(text,{sourceType:'module',plugins:['typescript','jsx']});
  const visit=node=>{
    if(node.type==='JSXOpeningElement') {
      const tag=text.slice(node.name.start,node.name.end);
      const attributes=Object.fromEntries(node.attributes.filter(attr=>attr.type==='JSXAttribute').map(attr=>[text.slice(attr.name.start,attr.name.end),attr.value?text.slice(attr.value.start,attr.value.end):'true']));
      const handlers=Object.fromEntries(Object.entries(attributes).filter(([name])=>/^on[A-Z]/.test(name)));
      const line=node.loc.start.line;
      const entry={ownerModule:file,line,element:tag,handlers};
      if(/^[A-Z]/.test(tag)&&Object.keys(handlers).length) componentEdges.push(entry);
      if(['button','input','select','textarea','a'].includes(tag)||attributes.role==='"button"') {
        const controlText=text.slice(node.start,node.end);
        const label=attributes['aria-label']||attributes.title||controlText.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,160);
        controls.push({...entry,userFacingEntry:label,dependencyChain:Object.values(handlers),expectedBehavior:'Execute the advertised label through the supplied handler; inspect dynamic labels and caller props.',
          actualBehavior:'Static source presence only; per-control runtime qualification remains open.',
          evidence:`${file}:${line}`,testCoverage:'Not inferred from source presence; consult workflow evidence.',status:'NOT TESTED',
          migrationDisposition:'ACTIVE',obsoleteHandlerAudit:'NOT TESTED'});
      }
    }
    for(const child of Object.values(node)) {
      if(Array.isArray(child)) child.forEach(value=>{if(value?.type) visit(value);});
      else if(child?.type) visit(child);
    }
  }; visit(source);
}
let sourceCommit = process.env.GITHUB_SHA || 'b871b0de366e677d2f6ae5b2c1ab16df682edb88-integrated';
try {
  sourceCommit = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
} catch {
  // Non-git container workspace fallback
}
const result={schemaVersion:1,sourceCommit,
  workingTreeMayDiffer:true,scope:'Static source inventory, including conditional controls. Reachability, command ownership, persistence and audio require runtime evidence.',
  controls,componentEdges};
await fs.mkdir(path.dirname(path.resolve(root,output)),{recursive:true});
await fs.writeFile(output,JSON.stringify(result,null,2));
console.log(JSON.stringify({output,controls:controls.length,componentEdges:componentEdges.length,status:'NOT TESTED'}));
