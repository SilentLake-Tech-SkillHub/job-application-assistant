import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,readdir,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {Store} from '../shared/engine.mjs';import {withTaskRecords} from '../shared/task-records.mjs';
test('task writes replace their current operation, keep independent operations and retire old run references',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'task-records-')),store=new Store(root);
 try{
  await withTaskRecords({taskId:'task-a',tool:'role_verify'},async()=>{
   await store.put('runs','old',{id:'old',operation:'verify_current',status:'needs_attention'});
   await store.put('runs','current',{id:'current',operation:'verify_current',status:'verified'});
   await store.put('runs','observation',{operation:'live_observation',observation:{pageUrl:'https://example.test/form'}});
  });
  assert.deepEqual((await readdir(path.join(root,'runs'))).sort(),['task-record-index.json','task-task-a.json']);
  await assert.rejects(store.get('runs','old'),{code:'ENOENT'});assert.equal((await store.get('runs','current')).status,'verified');
  assert.equal((await store.get('runs','observation')).operation,'live_observation');
  await store.clearTaskRecords(['task-a']);await assert.rejects(store.get('runs','current'),{code:'ENOENT'});
  assert.deepEqual(await readdir(path.join(root,'runs')),['task-record-index.json']);
 }finally{await rm(root,{recursive:true,force:true});}
});
