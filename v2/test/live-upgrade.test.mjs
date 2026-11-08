import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';import path from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';import {upgradeLiveInterface} from '../scripts/upgrade-live-interface.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
test('legacy MCP becomes current in original host pipe without restarting client or process',{timeout:30000},async()=>{
 const d=await mkdtemp('/tmp/live-mcp-'),fixture=path.join(d,'legacy.mjs');await mkdir(path.join(d,'产品管理'));await writeFile(path.join(d,'产品管理/网申个人信息主档.json'),JSON.stringify({schemaVersion:1,facts:{},sources:{},entities:{}}));
 const sdk=part=>pathToFileURL(path.join(root,'node_modules/@modelcontextprotocol/sdk/dist/esm',part)).href;
 await writeFile(fixture,`import {McpServer} from '${sdk('server/mcp.js')}';import {StdioServerTransport} from '${sdk('server/stdio.js')}';const server=new McpServer({name:'recruiting-form-batch',version:'legacy'});server.registerTool('hold',{},async()=>{await new Promise(r=>setTimeout(r,2000));return {content:[{type:'text',text:'done'}]};});server.registerTool('runtime_info',{},async()=>({content:[{type:'text',text:JSON.stringify({version:'legacy',pid:process.pid})}]}));await server.connect(new StdioServerTransport());await new Promise(()=>{});`);
 const c=new Client({name:'original-host-client',version:'1'});let endpoint;
 const transport=new StdioClientTransport({command:process.execPath,args:['--inspect=127.0.0.1:0','--import',fixture,path.join(root,'scripts/start.mjs'),'application'],env:{PATH:process.env.PATH,RECRUITING_WORKSPACE_ROOT:d,RECRUITING_HOST_ROLE:'maintainer'},stderr:'pipe'});
 transport.stderr.on('data',chunk=>{endpoint??=chunk.toString().match(/ws:\/\/127\.0\.0\.1:\d+\/[^\s]+/)?.[0];});
 try{
  await c.connect(transport);const before=JSON.parse((await c.callTool({name:'runtime_info',arguments:{}})).content[0].text);assert.equal(before.version,'legacy');assert.ok(endpoint);
  const busy=c.callTool({name:'hold',arguments:{}});await new Promise(r=>setTimeout(r,50));await assert.rejects(upgradeLiveInterface({pid:before.pid,mode:'application',endpoint}),/LIVE_INTERFACE_BUSY/);await busy;
  const upgraded=await upgradeLiveInterface({pid:before.pid,mode:'application',endpoint});assert.equal(upgraded.status,'upgraded');assert.equal(upgraded.pid,before.pid);
  const after=JSON.parse((await c.callTool({name:'runtime_info',arguments:{}})).content[0].text);assert.notEqual(after.version,'legacy');assert.equal(after.runtime.hostRole,'maintainer');
  const tools=await c.listTools();assert.ok(tools.tools.some(t=>t.name==='component_runtime'));
  const state=JSON.parse((await c.callTool({name:'component_runtime',arguments:{action:'update'}})).content[0].text);assert.equal(state.adapterPid,before.pid);assert.equal(state.verified,true);
  const repeated=await upgradeLiveInterface({pid:before.pid,mode:'application',endpoint});assert.equal(repeated.status,'updated');assert.equal(repeated.verified,true);
  const refused=await c.callTool({name:'workflow_next',arguments:{companyId:'C00001',pageUrl:'https://example.test/role'}});assert.equal(JSON.parse(refused.content[0].text).error,'HOST_ROLE_MAINTAINER_READ_ONLY');
 }finally{await c.callTool({name:'component_runtime',arguments:{action:'stop'}}).catch(()=>{});await c.close();await rm(d,{recursive:true,force:true});}
});
