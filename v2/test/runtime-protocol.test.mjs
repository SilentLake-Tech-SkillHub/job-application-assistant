import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
test('actual application MCP reports new runtime and missing company form routes offline to acquisition', {timeout:10000},async()=>{
 const d=await mkdtemp(path.join(os.tmpdir(),'application-protocol-'));const profile=path.join(d,'profile.json');await writeFile(profile,JSON.stringify({schemaVersion:1,facts:{},sources:{},entities:{}}));
 const c=new Client({name:'application-repair-regression',version:'1'});
 try{await c.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'application/server.mjs')],env:{PATH:process.env.PATH,RECRUITING_PROFILE_JSON:profile,RECRUITING_PRIVATE_DIR:path.join(d,'application'),RECRUITING_BROWSER_SOCKET:path.join(d,'absent.sock')},stderr:'pipe'}));
 const names=(await c.listTools()).tools.map(t=>t.name);for(const name of ['runtime_info','workflow_next','template_rebind_role','application_closeout'])assert.ok(names.includes(name));
 const call=async(name,args={})=>{const r=await c.callTool({name,arguments:args},undefined,{timeout:3000});assert.equal(r.isError,undefined);return JSON.parse(r.content[0].text);};
 const info=await call('runtime_info');assert.equal(info.version,'2.0.0-alpha.5');assert.equal(info.compilerVersion,3);
 const route=await call('workflow_next',{companyId:'anker',pageUrl:'https://anker-in.jobs.feishu.cn/campushirecn/resume/123/apply'});assert.equal(route.route,'acquire');assert.equal(route.browserAccess,false);assert.ok(route.nextTools.includes('capture_controls'));
 }finally{await c.close();await rm(d,{recursive:true,force:true});}
});
