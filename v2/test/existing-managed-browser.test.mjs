import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {BrowserAdapter} from '../shared/browser.mjs';
test('explicit recovery attaches the same local managed browser without launching or closing it',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'existing-browser-'));let launches=0,connections=0,disconnected;
 const connection={contexts:()=>[],on:(_,fn)=>{disconnected=fn;}};
 try{
  const b=new BrowserAdapter('managed-chrome',{profileDir:root,existingEndpoint:'http://127.0.0.1:9223',connector:async url=>{assert.equal(url,'http://127.0.0.1:9223/');connections++;return connection;},launcher:async()=>{launches++;}});
  assert.equal(await b.connect(),connection);assert.equal(await b.connect(),connection);assert.equal(launches,0);assert.equal(connections,1);assert.equal(b.status().mode,'managed');
  disconnected();await assert.rejects(b.connect(),/NO_AUTOMATIC_RECONNECT/);assert.equal(connections,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('explicit managed attachment rejects remote or credential-bearing endpoints before connection',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'existing-browser-'));let connections=0;
 try{for(const endpoint of ['https://remote.example','http://user:secret@127.0.0.1:9223']){
  const b=new BrowserAdapter('managed-chrome',{profileDir:root,existingEndpoint:endpoint,connector:async()=>{connections++;}});await assert.rejects(b.connect(),/LOCAL_BROWSER_ENDPOINT_REQUIRED/);
 }assert.equal(connections,0);}finally{await rm(root,{recursive:true,force:true});}
});
