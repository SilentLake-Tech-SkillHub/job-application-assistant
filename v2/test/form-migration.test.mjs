import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';import {fileURLToPath} from 'node:url';
import {Store,hash} from '../shared/engine.mjs';import {observedSeal} from './fixtures/observed-seal.mjs';
const run=promisify(execFile),script=fileURLToPath(new URL('../scripts/migrate-form-lifecycle.mjs',import.meta.url));
const template=()=>({id:'F000001',version:1,evidence:{formId:'F000001',sourceUrl:'https://example.test/form',observedAt:'synthetic'},pages:[{pathPrefix:'/form',fields:[{id:'name',source:'name',label:'Name',kind:'text',control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#name',kind:'value'},actions:[{method:'fill',selector:'#name'}]}]}]});
test('one-time migration previews without writes, preserves sealed hashes and proofs, then removes only old unreferenced keys',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'form-migration-')),privateDir=path.join(root,'private'),rollback=path.join(root,'rollback'),store=new Store(privateDir);
 try{
  const fixture=observedSeal(template(),'S0001');await fixture.persist(store);await store.put('templates',fixture.template.id,fixture.template);await store.put('runs',fixture.probe.id,fixture.probe);
  await store.put('runs','capture-obsolete',{operation:'old_capture'});await store.put('templates','old-form',{id:'old-form'});
  const call=async extra=>JSON.parse((await run(process.execPath,[script,'--private-dir',privateDir,...extra])).stdout);
  const before=hash(await store.get('templates','F000001')),preview=await call([]);assert.deepEqual(preview.certify,['F000001']);assert.equal(preview.removeFiles,2);
  await assert.rejects(store.get('runs','seal-F000001'),{code:'ENOENT'});await assert.rejects(call(['--apply','--expected-hash','stale','--rollback-dir',rollback]),/MIGRATION_PREVIEW_CHANGED/);
  const retained=await call(['--retain-old-files','--apply','--expected-hash',preview.previewHash,'--rollback-dir',rollback]);assert.equal(retained.deletedFiles,0);assert.equal((await store.get('runs','capture-obsolete')).operation,'old_capture');
  const cleanup=await call([]);
  const applied=await call(['--apply','--expected-hash',cleanup.previewHash,'--rollback-dir',rollback]);assert.equal(applied.after[0].reason,'valid');assert.equal(hash(await store.get('templates','F000001')),before);
  assert.equal((await store.get('runs',fixture.probe.id)).status,'verified');await assert.rejects(store.get('runs','capture-obsolete'),{code:'ENOENT'});
  const manifest=JSON.parse(await readFile(path.join(rollback,'manifest.json'),'utf8'));assert.ok(manifest.touched.length>=3);
 }finally{await rm(root,{recursive:true,force:true});}
});
