import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,access} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
import {BrowserAdapter} from '../shared/browser.mjs';import {BrokerBrowserAdapter} from '../shared/browser-rpc.mjs';import {RoutedBrowserAdapter} from '../shared/routed-browser.mjs';
const approved={authorization:{initialize:true,evidence:'User explicitly approved initializing this configured dedicated Chrome'}};
test('passive status and unauthorized initialization launch zero browsers; concurrent authorized initialization launches exactly once',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'chrome-init-'));let launches=0;
 const b=new BrowserAdapter('managed-chrome',{hostEnvironment:{RECRUITING_HOST_ROLE:'executor'},profileDir:dir,launcher:async()=>{launches++;return {on(){},pages:()=>[]};}});
 try{assert.equal(b.status().connectionAttempts,0);assert.equal(launches,0);
 for(const authorization of [undefined,{initialize:false,evidence:'wrong'},{initialize:true,evidence:''}])await assert.rejects(b.initializeConfiguredChrome({authorization}),/USER_AUTHORIZATION_REQUIRED/);
 assert.equal(launches,0);const result=await Promise.all([b.initializeConfiguredChrome(approved),b.initializeConfiguredChrome(approved)]);assert.equal(launches,1);assert.equal(result[0].executor.verified,true);assert.equal(result[0].initialized,true);
 const again=await b.initializeConfiguredChrome(approved);assert.equal(again.initialized,false);assert.equal(launches,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('initialization never selects everyday Chrome, an implicit profile, or a maintainer browser',async()=>{
 let launches=0,connections=0;const common={hostEnvironment:{RECRUITING_HOST_ROLE:'executor'},launcher:async()=>{launches++;},connector:async()=>{connections++;}};
 for(const profileDir of [undefined,path.join(os.homedir(),'Library/Application Support/Google/Chrome'),path.join(os.homedir(),'.config/google-chrome')]){
 const b=new BrowserAdapter('managed-chrome',{...common,profileDir});await assert.rejects(b.initializeConfiguredChrome(approved),/PRIVATE_AUTOMATION_PROFILE_REQUIRED/);}
 const b=new BrowserAdapter('managed-chrome',{...common,profileDir:'/private/selected',hostEnvironment:{RECRUITING_HOST_ROLE:'maintainer'}});await assert.rejects(b.initializeConfiguredChrome(approved),/MAINTAINER_READ_ONLY/);assert.equal(launches,0);assert.equal(connections,0);
});
test('initialized sessions that disconnect require distinct restore authorization rather than automatic relaunch',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'chrome-init-lost-'));let launches=0;const b=new BrowserAdapter('managed-chrome',{hostEnvironment:{RECRUITING_HOST_ROLE:'executor'},profileDir:dir,launcher:async()=>{launches++;return {on(){},pages:()=>[]};}});b.state='disconnected';
 try{await assert.rejects(b.initializeConfiguredChrome(approved),/RESTORE_USER_AUTHORIZATION_REQUIRED/);assert.equal(launches,0);}finally{await rm(dir,{recursive:true,force:true});}
});
test('router can reach the explicit initialization RPC before executor verification without permitting ordinary page access',async()=>{
 const calls=[],b=new RoutedBrowserAdapter({chromeSocket:'dormant',store:{get:async()=>({})},brokerFactory:()=>({status:async()=>({state:'new',mode:'managed',executor:{verified:false}}),request:async(method,args)=>{calls.push({method,args});return {initialized:true};}})});
 assert.equal((await b.request('initializeConfiguredChrome',approved)).initialized,true);assert.equal(calls[0].method,'initializeConfiguredChrome');await assert.rejects(b.request('openPage',{channel:'chrome',pageUrl:'https://example.test/'}),/IDENTITY_REQUIRED/);assert.equal(calls.length,1);
});
test('real broker starts dormant and rejects unauthorized initialize without creating a Chrome profile',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'dormant-broker-')),socket=path.join(dir,'b.sock'),profileDir=path.join(dir,'not-created-profile');
 const child=spawn(process.execPath,[fileURLToPath(new URL('../shared/browser-host.mjs',import.meta.url)),socket],{env:{PATH:process.env.PATH,HOME:process.env.HOME,RECRUITING_BROWSER_MODE:'managed',RECRUITING_BROWSER_PROFILE_DIR:profileDir},stdio:['ignore','pipe','pipe']});
 try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('broker did not start')),10000);child.stdout.once('data',()=>{clearTimeout(timer);resolve();});child.once('exit',code=>{clearTimeout(timer);reject(Error('broker exited '+code));});});
 const rpc=new BrokerBrowserAdapter(socket),status=await rpc.status();assert.equal(status.connectionAttempts,0);assert.equal(status.executor.verified,false);assert.equal(status.state,'new');await assert.rejects(access(profileDir),{code:'ENOENT'});
 await assert.rejects(rpc.request('initializeConfiguredChrome',{}),/USER_AUTHORIZATION_REQUIRED/);assert.equal((await rpc.status()).connectionAttempts,0);await assert.rejects(access(profileDir),{code:'ENOENT'});
 }finally{child.kill('SIGTERM');await new Promise(resolve=>child.exitCode!==null?resolve():child.once('exit',resolve));await rm(dir,{recursive:true,force:true});}
});
