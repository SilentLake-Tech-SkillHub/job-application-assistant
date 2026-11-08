import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {CoreClient} from '../shared/core-client.mjs';
import {resolveRuntimePaths} from '../shared/runtime-paths.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
test('same MCP connection survives core pause, reload and independent CLI access',{timeout:30000},async()=>{
 const d=await mkdtemp(path.join(os.tmpdir(),'core-lifecycle-'));
 await mkdir(path.join(d,'产品管理'));await writeFile(path.join(d,'产品管理/网申个人信息主档.json'),JSON.stringify({schemaVersion:1,facts:{},sources:{},entities:{}}));
 const env={PATH:process.env.PATH,RECRUITING_WORKSPACE_ROOT:d,RECRUITING_HOST_ROLE:'maintainer'};
 const c=new Client({name:'lifecycle-test',version:'1'}),core=new CoreClient('application',{env});
 const call=async(name,args={})=>{const r=await c.callTool({name,arguments:args});return {...JSON.parse(r.content[0].text),isError:r.isError};};
 try{
  await c.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'scripts/start.mjs'),'application'],env,stderr:'pipe'}));
  const before=await call('component_runtime',{action:'status'});
  assert.equal((await core.execute('runtime_info')).runtime.processId,before.workerPid);
  const persisted=path.join(d,'current-task.json');await writeFile(persisted,'{"stage":"review"}');
  await call('component_runtime',{action:'pause'});
  assert.equal((await call('runtime_info')).error,'CORE_PAUSED');
  const after=await call('component_runtime',{action:'reload'});
  assert.equal(after.adapterPid,before.adapterPid);assert.equal(after.hostPid,before.hostPid);assert.notEqual(after.workerPid,before.workerPid);
  assert.equal((await call('runtime_info')).runtime.processId,after.workerPid);
  assert.equal(await readFile(persisted,'utf8'),'{"stage":"review"}');
  const refused=await core.execute('workflow_next',{companyId:'C00001',pageUrl:'https://example.test/role'});
  assert.equal(refused.error,'HOST_ROLE_MAINTAINER_READ_ONLY');
  await c.close();
  assert.equal((await core.execute('runtime_info')).runtime.processId,after.workerPid);
 }finally{await core.control('stop').catch(()=>{});await c.close();await rm(d,{recursive:true,force:true});}
});
test('runtime paths resolve per workspace and reject component data roots',()=>{
 const a=resolveRuntimePaths({workspace:'/tmp/a',env:{}}),b=resolveRuntimePaths({workspace:'/tmp/b',env:{}});
 assert.notEqual(a.application,b.application);assert.equal(a.profile,'/tmp/a/产品管理/网申个人信息主档.json');
 assert.throws(()=>resolveRuntimePaths({workspace:'/tmp/a',env:{RECRUITING_PRIVATE_DIR:path.join(root,'private')}}),/USER_DATA_OUTSIDE_COMPONENT_REQUIRED/);
 assert.throws(()=>resolveRuntimePaths({workspace:'/tmp/a',env:{RECRUITING_PRIVATE_DIR:root+'/../'+path.basename(root)+'/private'}}),/USER_DATA_OUTSIDE_COMPONENT_REQUIRED/);
});
test('twenty repeated company observations overwrite one record without mixing roles',async()=>{
 const {Store}=await import('../shared/engine.mjs'),{randomUUID}=await import('node:crypto'),{readdir}=await import('node:fs/promises');
 const d=await mkdtemp(path.join(os.tmpdir(),'unique-record-')),store=new Store(d);let latest;
 try{for(let i=0;i<20;i++){latest=randomUUID();await store.put('runs',latest,{companyId:'C00001',roleId:'J000001',operation:'verify_current',value:i});}
 assert.equal((await store.get('runs',latest)).value,19);
 assert.equal((await readdir(path.join(d,'runs'))).length,2);
 const other=randomUUID();await store.put('runs',other,{companyId:'C00001',roleId:'J000002',operation:'verify_current',value:3});
 assert.equal((await store.get('runs',latest)).value,19);assert.equal((await store.get('runs',other)).value,3);
 }finally{await rm(d,{recursive:true,force:true});}
});
test('failed core update preserves prior worker and resumes without replaying requests',{timeout:15000},async()=>{
 const {spawn}=await import('node:child_process'),http=await import('node:http');
 const d=await mkdtemp('/tmp/core-update-'),socket=path.join(d,'core.sock');let host;
 const request=(route,body)=>new Promise((resolve,reject)=>{const q=http.request({socketPath:socket,path:route,method:'POST'},r=>{let text='';r.on('data',x=>text+=x);r.on('end',()=>resolve(JSON.parse(text)));});q.on('error',reject);q.end(JSON.stringify(body));});
 const worker=version=>`process.on('disconnect',()=>process.exit(0));process.on('message',m=>process.send({id:m.id,result:{version:${version}}}));process.send({ready:true,info:{version:String(${version})},operations:[]});`;
 try{
  await writeFile(path.join(d,'core-host.mjs'),await readFile(path.join(root,'shared/core-host.mjs')));await writeFile(path.join(d,'core-worker.mjs'),worker(1));
  host=spawn(process.execPath,[path.join(d,'core-host.mjs'),socket,'application'],{stdio:'ignore'});
  let before;for(let i=0;i<100&&!before;i++){before=await request('/control',{action:'status'}).catch(()=>null);if(!before)await new Promise(r=>setTimeout(r,20));}assert.ok(before);
  await writeFile(path.join(d,'core-worker.mjs'),'throw Error("synthetic startup failure");');
  const failed=await request('/control',{action:'reload'});assert.equal(failed.workerPid,before.workerPid);assert.equal(failed.paused,true);assert.equal(failed.lastError,'CORE_START_FAILED');
  await request('/control',{action:'resume'});assert.deepEqual(await request('/execute',{operation:'read'}),{version:1});
  await writeFile(path.join(d,'core-worker.mjs'),worker(2));const after=await request('/control',{action:'reload'});assert.notEqual(after.workerPid,before.workerPid);assert.equal(after.version,'2');
  assert.deepEqual(await request('/execute',{operation:'read'}),{version:2});
 }finally{await request('/control',{action:'stop'}).catch(()=>{});host?.kill();await rm(d,{recursive:true,force:true});}
});
