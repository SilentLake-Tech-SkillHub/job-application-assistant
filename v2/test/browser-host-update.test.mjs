import test from 'node:test';import assert from 'node:assert/strict';
import http from 'node:http';import {mkdtemp,rm} from 'node:fs/promises';import {spawn} from 'node:child_process';
import {stopBroker} from '../shared/bootstrap.mjs';
import {BrokerBrowserAdapter} from '../shared/browser-rpc.mjs';
import {workflowEnvelope} from '../shared/workflow-contract.mjs';
// C43（2026-11-16，用户：“改吧”）：代码更新后浏览器主控随 reload 换新；旧主控不能悄悄照跑旧代码。
const healthOf=socket=>()=>new Promise(resolve=>{const r=http.get({socketPath:socket,path:'/health'},res=>{const c=[];res.on('data',x=>c.push(x));res.on('end',()=>{try{resolve(JSON.parse(Buffer.concat(c)));}catch{resolve(null);}});});r.on('error',()=>resolve(null));});
async function fakeBroker(onRpc,status={sourceFingerprint:'old',brokerPid:4242,activeOperations:0}){
 const dir=await mkdtemp('/tmp/c43-'),socket=dir+'/b.sock';
 const server=http.createServer(async(req,res)=>{if(req.url==='/health'){res.end(JSON.stringify(status));return;}const c=[];for await(const x of req)c.push(x);res.end(JSON.stringify(await onRpc(JSON.parse(Buffer.concat(c)),server)));});
 await new Promise(r=>server.listen(socket,r));
 return {socket,server,status,close:async()=>{await new Promise(r=>server.close(()=>r()));await rm(dir,{recursive:true,force:true});}};
}
test('reload stops an idle stale broker itself; a busy one is left alone; an old broker without the stop operation gets SIGTERM by its own pid',async()=>{
 let b=await fakeBroker(async(body,server)=>{if(body.method==='shutdown'){setImmediate(()=>server.close());return {data:{stopping:true}};}});
 try{assert.equal(await stopBroker(b.socket,b.status,healthOf(b.socket),{wait:async()=>{}}),true);}finally{await b.close().catch(()=>{});}
 b=await fakeBroker(async()=>({error:'BROWSER_HOST_BUSY'}));
 try{assert.equal(await stopBroker(b.socket,b.status,healthOf(b.socket),{wait:async()=>{}}),false);}finally{await b.close();}
 let killed=null;b=await fakeBroker(async()=>({error:'UNKNOWN_BROWSER_HOST_METHOD'}),{sourceFingerprint:'old',brokerPid:4242});
 try{assert.equal(await stopBroker(b.socket,b.status,healthOf(b.socket),{wait:async()=>{},kill:(pid,signal)=>{killed=[pid,signal];b.server.close();}}),true);assert.deepEqual(killed,['4242'*1,'SIGTERM']);}finally{await b.close().catch(()=>{});}
});
test('requests to a broker running other code are refused with a pointer to reload; matching or unfingerprinted brokers pass',async()=>{
 const b=await fakeBroker(async()=>({data:{ok:true}}),{sourceFingerprint:'old'});
 try{
  const a=new BrokerBrowserAdapter(b.socket);
  await assert.rejects(a.assertCurrentHost('tabs',{expected:'new'}),/BROWSER_HOST_VERSION_MISMATCH/);
  await a.assertCurrentHost('status',{expected:'new'});
  await a.assertCurrentHost('tabs',{expected:'old'});
  delete b.status.sourceFingerprint;await new BrokerBrowserAdapter(b.socket).assertCurrentHost('tabs',{expected:'new'});
 }finally{await b.close();}
 const routed=workflowEnvelope({error:'BROWSER_HOST_VERSION_MISMATCH'});
 assert.deepEqual(routed.continuation.nextTools,['component_runtime']);assert.equal(routed.continuation.owner,'agent');
 assert.deepEqual(workflowEnvelope({error:'BROWSER_HOST_RESTART_REQUIRED'}).continuation.nextTools,['component_runtime']);
});
test('the native broker reports its active operations and stops itself only when idle, without touching the browser',{timeout:12000},async()=>{
 const dir=await mkdtemp('/tmp/c43-host-'),socket=dir+'/b.sock';
 const child=spawn(process.execPath,['shared/browser-host.mjs',socket],{env:{PATH:process.env.PATH,HOME:process.env.HOME,RECRUITING_BROWSER_MODE:'cdp',RECRUITING_CDP_URL:'http://127.0.0.1:9'},stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{child.once('error',reject);child.stdout.once('data',resolve);child.once('exit',code=>reject(Error('broker exited '+code)));});
  const health=await healthOf(socket)();assert.equal(health.activeOperations,0);assert.ok(health.sourceFingerprint);
  const exited=new Promise(resolve=>child.once('exit',resolve));
  assert.equal(await stopBroker(socket,health,healthOf(socket)),true);
  assert.equal(await exited,0);assert.equal(await healthOf(socket)(),null);
 }finally{if(child.exitCode===null)child.kill('SIGTERM');await rm(dir,{recursive:true,force:true});}
});
