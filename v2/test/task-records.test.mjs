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

test('one current execution plan per company across tools and role tasks',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'task-plans-')),store=new Store(root);
 try{
  const first={id:'execution-plan-C00001',companyId:'C00001',compilerVersion:3,taskId:'role-a',planHash:'first'};
  const second={...first,taskId:'role-b',planHash:'second'};
  const other={...first,id:'execution-plan-C00002',companyId:'C00002'};
  await withTaskRecords({taskId:'role-a',tool:'prepare_plan'},()=>store.put('plans',first.id,first));
  await withTaskRecords({taskId:'role-b',tool:'workflow_next'},()=>store.put('plans',second.id,second));
  await store.put('plans',other.id,other);
  await store.put('plans','material',{captureId:'capture'});
  await assert.rejects(store.put('plans','extra-copy',first),/EXECUTION_PLAN_STORAGE_KEY_MISMATCH/);
  assert.deepEqual((await readdir(path.join(root,'plans'))).sort(),[first.id+'.json',other.id+'.json','material.json']);
  assert.deepEqual(await store.get('plans',first.id),second);
  assert.deepEqual(await store.get('plans',other.id),other);
 }finally{await rm(root,{recursive:true,force:true});}
});
