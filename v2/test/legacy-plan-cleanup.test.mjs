import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {previewLegacyPlans,removeLegacyPlans} from '../scripts/legacy-plan-cleanup.mjs';

test('cleanup removes only reviewed unreferenced execution plans and refuses a stale preview',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'legacy-plans-'));
 const one='00000000-0000-4000-8000-000000000001',two='00000000-0000-4000-8000-000000000002',three='00000000-0000-4000-8000-000000000003';
 const plans='.runtime/application/plans',runs='.runtime/application/runs';
 const put=async(name,data)=>{const file=path.join(root,name);await mkdir(path.dirname(file),{recursive:true});await writeFile(file,JSON.stringify(data));};
 try{
  await put(plans+'/'+one+'.json',{id:one,compilerVersion:3});
  await put(plans+'/'+two+'.json',{id:two,compilerVersion:3});
  await put(plans+'/'+three+'.json',{id:three,captureId:'capture'});
  await put(runs+'/proof.json',{planId:one});
  const preview=await previewLegacyPlans(root);
  assert.deepEqual(preview.files.map(file=>path.basename(file.file)),[two+'.json']);
  assert.equal(preview.retainedReferences,1);
  await assert.rejects(removeLegacyPlans(root,{expectedHash:preview.previewHash}),/CONFIRMED_PREVIEW/);
  await put(runs+'/current.json',{planId:two});
  await assert.rejects(removeLegacyPlans(root,{expectedHash:preview.previewHash,quote:'fixture approval'}),/PREVIEW_CHANGED/);
  await rm(path.join(root,runs,'current.json'));
  await put('.codex/hooks/scope.json',{session_ids:['fixture']});
  await assert.rejects(removeLegacyPlans(root,{expectedHash:preview.previewHash,quote:'fixture approval'}),/PAUSED_EXECUTION/);
  await put('.codex/hooks/scope.json',{session_ids:[]});
  assert.equal((await removeLegacyPlans(root,{expectedHash:preview.previewHash,quote:'fixture approval'})).removed,1);
  await assert.rejects(readFile(path.join(root,plans,two+'.json')),{code:'ENOENT'});
  for(const id of [one,three])assert.ok(await readFile(path.join(root,plans,id+'.json')));
 }finally{await rm(root,{recursive:true,force:true});}
});
