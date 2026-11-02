import test from 'node:test';import assert from 'node:assert/strict';import os from 'node:os';import path from 'node:path';import {mkdtemp,rm,writeFile,stat} from 'node:fs/promises';
import {cloneConfig,cloneArgs,inspectClone,launchClone,cloneRecord} from '../shared/chrome-clone.mjs';
const daily=path.join(os.homedir(),'Library/Application Support/Google/Chrome');
test('the clone config is one fixed private profile and a local port; the daily Chrome directory is refused',()=>{
 const c=cloneConfig({RECRUITING_BROWSER_PROFILE_DIR:'/w/.runtime/chrome-profile'});
 assert.deepEqual(c,{executable:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',profileDir:'/w/.runtime/chrome-profile',port:9333,endpoint:'http://127.0.0.1:9333'});
 for(const dir of [undefined,'relative/profile',daily,path.join(daily,'Default')])assert.throws(()=>cloneConfig({RECRUITING_BROWSER_PROFILE_DIR:dir}),/PRIVATE_AUTOMATION_PROFILE_REQUIRED/);
 assert.throws(()=>cloneConfig({RECRUITING_BROWSER_PROFILE_DIR:'/p',RECRUITING_BROWSER_CDP_PORT:'80'}),/INVALID_CDP_PORT/);
});
test('the clone starts as a normal Chrome: visible, extensions allowed, local-only DevTools port',()=>{
 const args=cloneArgs({profileDir:'/p',port:9333});
 assert.ok(args.includes('--user-data-dir=/p'));assert.ok(args.includes('--remote-debugging-port=9333'));assert.ok(args.includes('--remote-debugging-address=127.0.0.1'));
 for(const banned of ['--disable-extensions','--headless','--enable-automation'])assert.equal(args.some(a=>a.startsWith(banned)),false);
 assert.ok(cloneArgs({profileDir:'/p',port:9333},{restoreLastSession:true}).includes('--restore-last-session'));
});
const config={executable:'/bin/sh',profileDir:'/p',port:9333,endpoint:'http://127.0.0.1:9333'};
const inv=list=>async()=>({available:true,processes:list});
test('clone state distinguishes running, stopped, opened by hand without the port, and a foreign port owner',async()=>{
 const v={Browser:'Chrome/156'};
 assert.equal((await inspectClone({config,processInventory:inv([{pid:5,profileDir:'/p',debugPort:9333}]),versionProbe:async()=>v})).state,'running');
 assert.equal((await inspectClone({config,processInventory:inv([]),versionProbe:async()=>null})).state,'stopped');
 assert.equal((await inspectClone({config,processInventory:inv([{pid:5,profileDir:'/p',debugPort:null}]),versionProbe:async()=>null})).state,'running_without_cdp');
 assert.equal((await inspectClone({config,processInventory:inv([{pid:6,profileDir:'/other',debugPort:9333}]),versionProbe:async()=>v})).state,'port_taken');
});
test('launch spawns one detached Chrome only when stopped, and reuses a running clone',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'clone-'));try{
  const c={...config,profileDir:path.join(dir,'profile')};let spawned=[],up=false;
  const spawn=(exe,args,opts)=>{spawned.push({exe,args,opts});up=true;return {unref(){}};};
  const processInventory=async()=>({available:true,processes:up?[{pid:7,profileDir:c.profileDir,debugPort:9333}]:[]}),versionProbe=async()=>up?{Browser:'Chrome/156'}:null;
  const r=await launchClone({config:c,spawn,processInventory,versionProbe,sleep:async()=>{}});
  assert.equal(r.launched,true);assert.equal(r.state,'running');assert.equal(spawned.length,1);assert.equal(spawned[0].opts.detached,true);assert.equal(spawned[0].opts.stdio,'ignore');assert.ok((await stat(c.profileDir)).isDirectory());
  const again=await launchClone({config:c,spawn,processInventory,versionProbe,sleep:async()=>{}});assert.equal(again.launched,false);assert.equal(spawned.length,1);
  await assert.rejects(launchClone({config:c,spawn,processInventory:inv([{pid:5,profileDir:c.profileDir,debugPort:null}]),versionProbe:async()=>null}),/QUIT_IT_FIRST/);
  await assert.rejects(launchClone({config:c,spawn,processInventory:inv([]),versionProbe:async()=>({Browser:'x'})}),/CDP_PORT_TAKEN/);
  await assert.rejects(launchClone({config:{...c,executable:path.join(dir,'missing')},spawn,processInventory:inv([]),versionProbe:async()=>null}),/CHROME_NOT_INSTALLED/);assert.equal(spawned.length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('the capability record names the launcher and the CDP call; it holds no account data',async()=>{
 const r=await cloneRecord({config,now:()=>'t',exists:async()=>true,versionReader:async()=>'<key>CFBundleShortVersionString</key><string>156.0</string>'});
 assert.equal(r.result,'usable');assert.equal(r.call.mode,'cdp');assert.equal(r.call.launcher,'scripts/chrome-clone.mjs start');assert.equal(r.profileDir,'/p');
 assert.equal((await cloneRecord({config,exists:async()=>false})).result,'not_installed');
});
