import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';
import {BrowserAdapter} from '../shared/browser.mjs';
test('managed Chrome launches once across concurrent clients without CDP',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'managed-browser-'));let launches=0,cdp=0;const handlers={};
 const context={pages:()=>[],on:(e,fn)=>{handlers[e]=fn;}};
 const adapter=new BrowserAdapter('managed-chrome',{profileDir:dir,connector:()=>{cdp++;throw Error('CDP_FORBIDDEN');},launcher:async(profile,options)=>{launches++;assert.equal(profile,dir);assert.equal(options.channel,'chrome');assert.equal(options.headless,false);return context;}});
 try{const [a,b]=await Promise.all([adapter.connect(),adapter.connect()]);assert.equal(a,b);assert.equal(launches,1);assert.equal(cdp,0);assert.equal(adapter.status().mode,'managed');handlers.close();await assert.rejects(adapter.connect(),/NO_AUTOMATIC_RECONNECT/);assert.equal(launches,1);}finally{await rm(dir,{recursive:true,force:true});}
});
test('managed mode refuses the daily Chrome profile and never falls back to CDP',async()=>{
 let called=false;const adapter=new BrowserAdapter('managed-chrome',{profileDir:path.join(os.homedir(),'Library/Application Support/Google/Chrome/Default'),connector:()=>{called=true;},launcher:()=>{called=true;}});
 await assert.rejects(adapter.connect(),/PRIVATE_AUTOMATION_PROFILE_REQUIRED/);assert.equal(called,false);
});
