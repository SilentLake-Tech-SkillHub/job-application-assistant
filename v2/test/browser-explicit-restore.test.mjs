import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {BrowserAdapter} from '../shared/browser.mjs';
test('manual Chrome restore reuses only the existing configured profile and exact local CDP port',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'chrome-explicit-restore-'));await writeFile(path.join(dir,'Local State'),'{}');let launches=0,closed;
 const b=new BrowserAdapter('http://127.0.0.1:9345',{profileDir:dir,endpointProbe:async()=>false,launcher:async(profile,opts)=>{launches++;assert.equal(profile,dir);assert.ok(opts.args.includes('--remote-debugging-port=9345'));assert.ok(opts.args.includes('--restore-last-session'));return {on:(_,fn)=>{closed=fn;}};}});b.state='disconnected';
 try{await assert.rejects(b.connect(),/NO_AUTOMATIC_RECONNECT/);await assert.rejects(b.restoreConfiguredChrome(),/USER_AUTHORIZATION_REQUIRED/);assert.equal(launches,0);
  const r=await b.restoreConfiguredChrome({authorization:{restore:true,evidence:'Human approved restoring the original dedicated Chrome'}});assert.equal(r.profileReused,true);assert.equal(launches,1);assert.equal(r.automaticRetries,0);closed();await assert.rejects(b.restoreConfiguredChrome({authorization:{restore:true,evidence:'same request'}}),/ALREADY_ATTEMPTED/);assert.equal(launches,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('restore never creates a new empty profile or attaches the everyday Chrome directory',async()=>{
 let launches=0;for(const profileDir of [path.join(os.homedir(),'Library/Application Support/Google/Chrome'),'/synthetic/missing-profile']){
  const b=new BrowserAdapter('http://127.0.0.1:9345',{profileDir,launcher:async()=>{launches++;}});
  await assert.rejects(b.restoreConfiguredChrome({authorization:{restore:true,evidence:'Human approved original profile only'}}));
 }assert.equal(launches,0);
});
test('an available original CDP endpoint is reattached once without launching another Chrome',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'chrome-explicit-reattach-'));await writeFile(path.join(dir,'Local State'),'{}');let launches=0,connections=0;
 const b=new BrowserAdapter('http://127.0.0.1:9345',{profileDir:dir,endpointProbe:async()=>true,connector:async url=>{connections++;assert.equal(url,'http://127.0.0.1:9345/');return {on(){}};},launcher:async()=>{launches++;}});b.state='disconnected';
 try{await b.restoreConfiguredChrome({authorization:{restore:true,evidence:'Human approved original Chrome recovery'}});assert.equal(connections,1);assert.equal(launches,0);}finally{await rm(dir,{recursive:true,force:true});}
});
