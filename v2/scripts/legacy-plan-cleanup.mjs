#!/usr/bin/env node
// Preview first. Only original standalone execution plans with no runtime or
// handoff references are candidates; evidence, current task slots and imports
// are outside this operation.
import {createHash} from 'node:crypto';
import {readFile,readdir,unlink} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const digest=data=>createHash('sha256').update(data).digest('hex');
const uuid=/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}/g;
async function* jsonFiles(dir){
 let entries;
 try{entries=await readdir(dir,{withFileTypes:true});}
 catch(error){if(error.code==='ENOENT')return;throw error;}
 for(const entry of entries){
  const file=path.join(dir,entry.name);
  if(entry.isDirectory())yield* jsonFiles(file);
  else if(entry.isFile()&&entry.name.endsWith('.json'))yield file;
 }
}
export async function previewLegacyPlans(workspace){
 const runtime=path.join(workspace,'.runtime'),dir=path.join(runtime,'application','plans');
 const candidates=new Map(),referenced=new Set();
 for await(const file of jsonFiles(dir)){
  if(path.dirname(file)!==dir)continue;
  const id=path.basename(file,'.json');
  if(!id.match(uuid)?.includes(id))continue;
  const bytes=await readFile(file),plan=JSON.parse(bytes);
  if(plan.id===id&&Number.isInteger(plan.compilerVersion))candidates.set(id,{file:path.relative(workspace,file),bytes:bytes.length,sha256:digest(bytes)});
 }
 for(const directory of ['application/plans','application/runs','application/templates','role-queue','login'].map(name=>path.join(runtime,name)).concat(path.join(workspace,'岗位交接'))){
  for await(const file of jsonFiles(directory)){
   const own=path.dirname(file)===dir?path.basename(file,'.json'):null;
   for(const id of (await readFile(file,'utf8')).matchAll(uuid)){
    if(id[0]!==own&&candidates.has(id[0]))referenced.add(id[0]);
   }
  }
 }
 const files=[...candidates].filter(([id])=>!referenced.has(id)).map(([,file])=>file).sort((a,b)=>a.file.localeCompare(b.file));
 return {workspace,files,retainedReferences:referenced.size,previewHash:digest(JSON.stringify(files))};
}
async function requirePaused(workspace){
 const scope=await readFile(path.join(workspace,'.codex','hooks','scope.json'),'utf8').then(JSON.parse).catch(error=>{if(error.code==='ENOENT')return {};throw error;});
 if((scope.session_ids||[]).some(id=>!(scope.sessions?.[id]?.expiresAt<=Date.now()/1000)))throw Error('PLAN_CLEANUP_REQUIRES_PAUSED_EXECUTION');
}
export async function removeLegacyPlans(workspace,{expectedHash,quote}){
 if(!quote?.trim()||!/^[a-f0-9]{64}$/.test(expectedHash||''))throw Error('PLAN_CLEANUP_REQUIRES_CONFIRMED_PREVIEW');
 await requirePaused(workspace);
 const result=await previewLegacyPlans(workspace);
 if(result.previewHash!==expectedHash)throw Error('PLAN_CLEANUP_PREVIEW_CHANGED');
 let removed=0;
 for(const entry of result.files){
  const file=path.join(workspace,entry.file);
  if(digest(await readFile(file))!==entry.sha256)throw Error('PLAN_CLEANUP_FILE_CHANGED');
  await unlink(file);
  removed++;
 }
 return {removed,previewHash:result.previewHash};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const [target,...args]=process.argv.slice(2);
 if(!target||!path.isAbsolute(target))throw Error('PLAN_CLEANUP_ABSOLUTE_WORKSPACE_REQUIRED');
 const flag=name=>args.includes(name)?args[args.indexOf(name)+1]:undefined;
 const result=args[0]==='--apply'?await removeLegacyPlans(target,{expectedHash:flag('--expect-sha'),quote:flag('--quote')}):await previewLegacyPlans(target);
 console.log(JSON.stringify(result,null,2));
}
