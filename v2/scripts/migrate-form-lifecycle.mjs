// One-time migration. Remove after verified execution; git retains the script.
import {readFile,readdir,writeFile,mkdir,stat,unlink,copyFile} from 'node:fs/promises';
import path from 'node:path';import {createHash} from 'node:crypto';
import {Store} from '../shared/engine.mjs';
import {storedSeal,certifySeal,recertifyContract} from '../shared/seal-state.mjs';
import {bindControlChoices,compatibleInventory} from '../shared/control-choice-store.mjs';
import {originalStructureCapture,captureContentHash} from '../shared/acquisition-chain.mjs';
const hash=v=>createHash('sha256').update(v).digest('hex');
const args=process.argv.slice(2),option=k=>args[args.indexOf(k)+1],root=option('--private-dir');
if(!args.includes('--private-dir'))throw Error('PRIVATE_DIR_REQUIRED');
const store=new Store(path.resolve(root)),templateDir=path.join(root,'templates'),runs=path.join(root,'runs');
const read=async file=>JSON.parse(await readFile(file,'utf8'));
const templates=(await readdir(templateDir)).filter(f=>/^F\d{6}\.json$/.test(f)).sort();
const before=[],writes=[],referenced=new Set(),visit=v=>{if(typeof v==='string')referenced.add(v);else if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object')Object.values(v).forEach(visit);};
const protectedStates=[];
for(const name of templates){
 const t=await read(path.join(templateDir,name)),id=t.id,companyId=(await read(path.join(runs,'capture-'+id+'.json')).catch(()=>({}))).companyId;
 visit(t);const state=await storedSeal(store,t,companyId);before.push({templateId:id,companyId,...state});
 if(state.reason==='valid')protectedStates.push(id);
 let capture;try{capture=await store.get('runs','capture-'+id);const structure=await store.get('runs','form-structure-'+id);const original=originalStructureCapture(structure,capture);if(compatibleInventory(original,capture))capture=original;}catch{}
 const file=path.join(runs,'choices-'+id+'.json');let choices;try{choices=await read(file);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(capture&&choices){
  const current=choices.choices.filter(c=>capture.controls.some(x=>x.selector===c.selector));
  const bound={...choices,...bindControlChoices({capture,choices:current,previous:choices}),captureHash:captureContentHash(capture)};
  writes.push({file,value:bound});visit(bound);
 }
}
// Current task records and canonical assets are references; superseded old keys
// are not allowed to keep each other alive forever.
for(const name of await readdir(runs))if(/^(?:task-|seal-|capture-F\d{6}|form-structure-F\d{6}|acquisition-F\d{6}|form-draft-F\d{6}|definition-F\d{6})/.test(name)&&name.endsWith('.json'))visit(await read(path.join(runs,name)));
for(const name of ['company-bindings.json','role-bindings.json'])try{visit(await read(path.join(templateDir,name)));}catch(e){if(e.code!=='ENOENT')throw e;}
const removals=[];
for(const [dir,names]of [[runs,await readdir(runs)],[templateDir,await readdir(templateDir)]])for(const name of names){
 const id=name.replace(/\.json$/,'');if(!name.endsWith('.json')||referenced.has(id))continue;
 const oldRun=dir===runs&&/^(?:capture-|form-structure-|choices-|acquisition-|form-draft-)/.test(id)&&!/^(?:capture-|form-structure-|choices-|acquisition-|form-draft-)F\d{6}$/.test(id);
 const oldTemplate=dir===templateDir&&!/^F\d{6}(?:-conditions|-live)?\.json$/.test(name)&&!['company-bindings.json','role-bindings.json'].includes(name);
 if(oldRun||oldTemplate){const file=path.join(dir,name),meta=await stat(file);removals.push({file,size:meta.size,mtimeMs:meta.mtimeMs});}
}
const critical=[];for(const dir of [templateDir,runs])for(const name of await readdir(dir))if(/^F\d{6}\.json$/.test(name)||/^(?:capture-|form-structure-|choices-|acquisition-|form-draft-|seal-)F\d{6}\.json$/.test(name)){const file=path.join(dir,name);critical.push({file,sha256:hash(await readFile(file))});}
critical.sort((a,b)=>a.file.localeCompare(b.file));
const previewHash=hash(JSON.stringify({critical,removals}));
const retainOldFiles=args.includes('--retain-old-files');
const preview={previewHash,before,certify:protectedStates,choiceObjects:writes.length,retainOldFiles,removeFiles:removals.length,removeBytes:removals.reduce((n,r)=>n+r.size,0)};
if(!args.includes('--apply')){console.log(JSON.stringify(preview,null,2));process.exit(0);}
if(option('--expected-hash')!==previewHash)throw Error('MIGRATION_PREVIEW_CHANGED');
const rollback=option('--rollback-dir');if(!args.includes('--rollback-dir'))throw Error('ROLLBACK_DIR_REQUIRED');
await mkdir(rollback,{recursive:true,mode:0o700});
const touched=new Map();
async function preserve(file){if(touched.has(file))return;const rel=path.relative(root,file);if(rel.startsWith('..'))throw Error('MIGRATION_PATH_ESCAPE');const backup=path.join(rollback,rel);try{await mkdir(path.dirname(backup),{recursive:true,mode:0o700});await copyFile(file,backup);touched.set(file,backup);}catch(e){if(e.code==='ENOENT')touched.set(file,null);else throw e;}}
try{
 for(const item of critical)if(hash(await readFile(item.file))!==item.sha256)throw Error('MIGRATION_SOURCE_CHANGED');
 for(const {file,value}of writes){await preserve(file);await store.put('runs',path.basename(file,'.json'),value);}
 for(const row of before)if(['valid','contract_upgrade'].includes(row.reason)){
  await preserve(path.join(runs,'seal-'+row.templateId+'.json'));
  const t=await store.get('templates',row.templateId);
  if(row.reason==='valid')await certifySeal(store,t,row.companyId);
  else {await preserve(path.join(templateDir,row.templateId+'.json'));await recertifyContract(store,t,row.companyId);}
 }
 const after=[];
 for(const row of before){const t=await store.get('templates',row.templateId),state=await storedSeal(store,t,row.companyId);after.push({templateId:t.id,companyId:row.companyId,...state});if(protectedStates.includes(t.id)&&state.reason!=='valid')throw Error('SEALED_ASSET_REGRESSION');}
 for(const item of retainOldFiles?[]:removals){const meta=await stat(item.file);if(meta.size!==item.size||meta.mtimeMs!==item.mtimeMs)throw Error('MIGRATION_CLEANUP_SOURCE_CHANGED');await preserve(item.file);await unlink(item.file);}
 const report={...preview,after,deletedFiles:retainOldFiles?0:removals.length,deletedBytes:retainOldFiles?0:preview.removeBytes,storageReadback:'verified',rollbackRetained:true,rollbackDir:rollback};
 await writeFile(path.join(rollback,'manifest.json'),JSON.stringify({touched:[...touched],report},null,2),{mode:0o600});
 console.log(JSON.stringify(report,null,2));
}catch(error){for(const[file,backup]of [...touched].reverse())if(backup)await copyFile(backup,file);else await unlink(file).catch(e=>{if(e.code!=='ENOENT')throw e;});throw error;}
