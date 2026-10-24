import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,writeFile,rm,mkdir,readFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {contentSha} from '../shared/company-directory.mjs';
test('new company entry reaches its browser without requiring an application template first',{timeout:10000},async()=>{
 const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),d=await mkdtemp(path.join(os.tmpdir(),'new-company-mcp-')),profile=path.join(d,'profile.json'),c=new Client({name:'new-company-regression',version:'1'});
 await writeFile(profile,JSON.stringify({schemaVersion:1,facts:{'contact.phone.cn':{status:'known',value:'13800001234',sourceIds:['synthetic']}},sources:{synthetic:{}},entities:{}}));
 // 交接区：公司文件夹 + 用户确认的投递批次（组件包内不再携带公司目录）
 const handoff=path.join(d,'岗位交接'),firm=path.join(handoff,'公司','中国大陆','影石');await mkdir(firm,{recursive:true});
 await writeFile(path.join(firm,'公司.json'),JSON.stringify({schemaVersion:2,companyId:'insta360','公司':'影石','地区':'中国大陆',origins:['https://arashivision.jobs.feishu.cn'],roles:[]}));
 await writeFile(path.join(firm,'登录.json'),await readFile(path.join(root,'test/fixtures/insta360.login.json')));
 const batch={schemaVersion:2,batchId:'test',state:'已交接',updatedAt:'t',masterDataSha256:'m',companies:[{companyId:'insta360','公司':'影石','地区':'中国大陆','公司文件':'x',stage:'已建档','岗位':[{'岗位ID':'1','岗位名称':'Synthetic','岗位链接':'https://arashivision.jobs.feishu.cn/campus/position/1/detail'}]}],excluded:[],confirmation:null};
 batch.confirmation={userQuote:'synthetic',confirmedAt:'t',contentSha256:contentSha(batch)};await writeFile(path.join(handoff,'投递批次.json'),JSON.stringify(batch));
 try{
  await c.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'login/server.mjs')],env:{PATH:process.env.PATH,RECRUITING_PROFILE_JSON:profile,RECRUITING_PRIVATE_DIR:path.join(d,'application'),RECRUITING_LOGIN_PRIVATE_DIR:path.join(d,'login'),RECRUITING_BROWSER_SOCKET:path.join(d,'absent.sock'),RECRUITING_HANDOFF_DIR:handoff},stderr:'ignore'}));
  assert.ok((await c.listTools()).tools.some(t=>t.name==='login_open_identity'));
  const identity=await c.callTool({name:'login_open_identity',arguments:{companyId:'insta360'}});assert.equal(JSON.parse(identity.content[0].text).error,'USER_OPERATED_SESSION_IDENTITY_REQUIRED');
  const legacy=await c.callTool({name:'role_queue_import',arguments:{companyPlan:{schemaVersion:1}}});assert.equal(JSON.parse(legacy.content[0].text).error,'HANDOFF_BATCH_REQUIRED');
  const queue=await c.callTool({name:'role_queue_import',arguments:{}});
  await mkdir(path.join(d,'application','templates'),{recursive:true});await writeFile(path.join(d,'application','templates','company-bindings.json'),JSON.stringify({anker:'other-company-form'}));
  const q=JSON.parse(queue.content[0].text),r=await c.callTool({name:'role_open',arguments:{queueId:q.queueId,queueHash:q.queueHash,taskId:q.tasks[0].taskId}},undefined,{timeout:3000});
  assert.equal(JSON.parse(r.content[0].text).error,'BROWSER_HOST_NOT_AVAILABLE');
 }finally{await c.close();await rm(d,{recursive:true,force:true});}
});
