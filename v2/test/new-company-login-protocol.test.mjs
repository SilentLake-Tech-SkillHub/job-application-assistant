import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm,mkdir,readFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {companyDoc,site,role,confirm,saveCompany,saveLogin} from './fixtures/handoff.mjs';
test('new company entry reaches its browser without requiring an application template first',{timeout:10000},async()=>{
 const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),d=await mkdtemp(path.join(os.tmpdir(),'new-company-mcp-')),profile=path.join(d,'profile.json'),c=new Client({name:'new-company-regression',version:'1'});
 await writeFile(profile,JSON.stringify({schemaVersion:1,facts:{'contact.phone.cn':{status:'known',value:'13800001234',sourceIds:['synthetic']}},sources:{synthetic:{}},entities:{}}));
 // 交接区：公司宽表（用户已确认）；第 2 步前登录配置仍按域名放在公司文件夹（组件包内不携带公司目录）
 const handoff=path.join(d,'岗位交接'),url='https://arashivision.jobs.feishu.cn/campus/position/1/detail';
 await saveCompany(handoff,confirm(companyDoc({code:'C00003',name:'影石',batchId:'test',sites:[site('S0007','https://arashivision.jobs.feishu.cn')],roles:[role('J000009','S0007','Synthetic',url,{'官方岗位ID':'1'})]})));
 await saveLogin(handoff,'影石','登录.json',JSON.parse(await readFile(path.join(root,'test/fixtures/insta360.login.json'),'utf8')));
 try{
  await c.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'login/server.mjs')],env:{PATH:process.env.PATH,RECRUITING_BROWSER_MODE:'host',RECRUITING_PROFILE_JSON:profile,RECRUITING_PRIVATE_DIR:path.join(d,'application'),RECRUITING_LOGIN_PRIVATE_DIR:path.join(d,'login'),RECRUITING_BROWSER_SOCKET:path.join(d,'absent.sock'),RECRUITING_HANDOFF_DIR:handoff},stderr:'ignore'}));
  assert.ok((await c.listTools()).tools.some(t=>t.name==='role_advance'));
  const legacy=await c.callTool({name:'role_queue_import',arguments:{companyPlan:{schemaVersion:1}}});assert.equal(JSON.parse(legacy.content[0].text).error,'HANDOFF_BATCH_REQUIRED');
  const queue=await c.callTool({name:'role_queue_import',arguments:{}});
  await mkdir(path.join(d,'application','templates'),{recursive:true});await writeFile(path.join(d,'application','templates','company-bindings.json'),JSON.stringify({S0001:'other-company-form'}));
  await mkdir(path.join(d,'application','runs'),{recursive:true});await writeFile(path.join(d,'application','runs','browser-channel-bindings.json'),JSON.stringify({'https://arashivision.jobs.feishu.cn':{channel:'chrome',batchId:'test-confirmed-batch',companyId:'S0007'}}));
  const q=JSON.parse(queue.content[0].text);assert.deepEqual(q.tasks.map(t=>[t.companyId,t.companyCode,t.roleId]),[['C00003','C00003','J000009']]);const r=await c.callTool({name:'role_open',arguments:{queueId:q.queueId,queueHash:q.queueHash,taskId:q.tasks[0].taskId}},undefined,{timeout:3000});
  assert.equal(JSON.parse(r.content[0].text).error,'BROWSER_HOST_NOT_AVAILABLE');
 }finally{await c.callTool({name:"component_runtime",arguments:{action:"stop"}}).catch(()=>{});await c.close();await rm(d,{recursive:true,force:true});}
});
