import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {registerWorkflowTool} from '../shared/workflow-contract.mjs';import {hostRole} from '../shared/host-role.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const capture=(env)=>{let handler,calls=0;registerWorkflowTool({registerTool:(n,d,h)=>{handler=h;}},'role_prepare',{},async()=>{calls++;return {content:[{type:'text',text:JSON.stringify({status:'ok'})}]};},env);return {call:a=>handler(a||{}),calls:()=>calls};};
test('host role defaults to executor and rejects unknown values',()=>{
 assert.equal(hostRole({}),'executor');assert.equal(hostRole({RECRUITING_HOST_ROLE:'maintainer'}),'maintainer');
 assert.throws(()=>hostRole({RECRUITING_HOST_ROLE:'supervisor'}),/INVALID_RECRUITING_HOST_ROLE/);
});
test('maintainer host is refused before any stage handler runs and is told to stop',async()=>{
 const t=capture({RECRUITING_HOST_ROLE:'maintainer'}),r=await t.call();const data=JSON.parse(r.content[0].text);
 assert.equal(r.isError,true);assert.equal(t.calls(),0);assert.equal(data.error,'HOST_ROLE_MAINTAINER_READ_ONLY');
 assert.equal(data.continuation.shouldContinue,false);assert.equal(data.continuation.owner,'user');assert.deepEqual(data.continuation.nextTools,[]);assert.equal(data.workflowContract.tool,'role_prepare');
});
test('executor host keeps the normal stage path',async()=>{
 const t=capture({}),r=await t.call();assert.notEqual(r.isError,true);assert.equal(t.calls(),1);
});
test('maintainer MCP over stdio: inspections answer, website stages refuse, no browser is started',{timeout:30000},async()=>{
 const d=await mkdtemp(path.join(os.tmpdir(),'host-role-'));const profile=path.join(d,'profile.json');await writeFile(profile,JSON.stringify({schemaVersion:1,facts:{},sources:{},entities:{}}));
 const c=new Client({name:'host-role',version:'1'});
 try{
  await c.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'scripts/start.mjs'),'application'],cwd:d,env:{PATH:process.env.PATH,HOME:d,RECRUITING_HOST_ROLE:'maintainer',RECRUITING_IAB_AUTOSTART:'1',RECRUITING_HANDOFF_DIR:path.join(d,'handoff'),RECRUITING_PROFILE_JSON:profile,RECRUITING_PRIVATE_DIR:path.join(d,'application'),RECRUITING_ROLE_QUEUE_DIR:path.join(d,'queue'),RECRUITING_BROWSER_SOCKET:path.join(d,'absent.sock'),RECRUITING_IAB_SOCKET:path.join(d,'absent-iab.sock')},stderr:'pipe'}));
  const info=await c.callTool({name:'runtime_info',arguments:{}},undefined,{timeout:5000});assert.notEqual(info.isError,true);
  const stage=await c.callTool({name:'workflow_next',arguments:{companyId:'x',pageUrl:'https://example.test/apply'}},undefined,{timeout:5000});
  assert.equal(stage.isError,true);assert.equal(JSON.parse(stage.content[0].text).error,'HOST_ROLE_MAINTAINER_READ_ONLY');
 }finally{await c.close();}
});
