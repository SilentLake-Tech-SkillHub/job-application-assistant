import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {Store,hash} from '../shared/engine.mjs';
import {updateCompanyTemplate,constructionTemplate} from '../shared/template-lifecycle.mjs';
const template=version=>({id:'C00001',version,coverage:{},pages:[{fields:[]}]});
test('construction update replaces the sole official template before any consumer reads it, then deletes temporary draft',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'company-template-'));const store=new Store(dir);
 try{
  await store.put('templates','C00001',template(4));
  await store.put('runs','form-draft-C00001',{registered:true,template:template(6)});
  const current=await updateCompanyTemplate(store,{companyId:'C00001',template:template(7)});
  assert.equal((await store.get('templates','C00001')).version,7);
  assert.deepEqual(await constructionTemplate(store,'C00001',hash(current)),current);
  await assert.rejects(store.get('runs','form-draft-C00001'),{code:'ENOENT'});
  const update=await store.get('runs','form-update-C00001');assert.equal(update.template,undefined);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('a stale draft never overrides the official template even with a matching hash',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'company-template-'));const store=new Store(dir);
 try{
  await store.put('templates','C00001',template(7));await store.put('runs','form-draft-C00001',{registered:true,template:template(4)});
  assert.equal((await constructionTemplate(store,'C00001')).version,7);
  await assert.rejects(constructionTemplate(store,'C00001',hash(template(4))),/TEMPLATE_VERSION_CHANGED/);
 }finally{await rm(dir,{recursive:true,force:true});}
});
