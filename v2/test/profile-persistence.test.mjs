import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,rename,mkdir,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {updateProfile} from '../shared/profile.mjs';

async function fixture(run){
 const dir=await mkdtemp(path.join(os.tmpdir(),'profile-persistence-'));
 const file=path.join(dir,'profile.json');
 const original=JSON.stringify({schemaVersion:1,facts:{},sources:{},entities:{}});
 await writeFile(file,original);
 try{await run({dir,file,original});}finally{await rm(dir,{recursive:true,force:true});}
}

test('profile writer preserves original bytes when mutation or validation fails',async()=>{
 await fixture(async({dir,file,original})=>{
  await assert.rejects(updateProfile(file,()=>{throw Error('mutation failed');}),/mutation failed/);
  await assert.rejects(updateProfile(file,p=>{p.schemaVersion=99;}),/INVALID_PROFILE/);
  assert.equal(await readFile(file,'utf8'),original);
  assert.deepEqual(await readdir(dir),['profile.json']);
 });
});

test('profile writer removes its pending file after an actual rename failure',async()=>{
 await fixture(async({dir,file,original})=>{
  const held=path.join(dir,'held.json');
  await assert.rejects(updateProfile(file,async p=>{
   p.updatedAt='test';
   await rename(file,held);await mkdir(file);
  }),e=>['EISDIR','ENOTDIR','EEXIST','EPERM'].includes(e.code));
  assert.deepEqual((await readdir(dir)).sort(),['held.json','profile.json']);
  assert.equal(await readFile(held,'utf8'),original);
  await rm(file,{recursive:true});await rename(held,file);
  await updateProfile(file,p=>{p.updatedAt='recovered';});
  assert.equal(JSON.parse(await readFile(file,'utf8')).updatedAt,'recovered');
  assert.deepEqual(await readdir(dir),['profile.json']);
 });
});

test('concurrent profile updates keep both changes and no temporary file',async()=>{
 await fixture(async({dir,file})=>{
  await Promise.all([updateProfile(file,p=>{p.first=true;}),updateProfile(file,p=>{p.second=true;})]);
  const saved=JSON.parse(await readFile(file,'utf8'));
  assert.equal(saved.first,true);assert.equal(saved.second,true);
  assert.deepEqual(await readdir(dir),['profile.json']);
 });
});
