// C31：登录配置先判断存在再读取；缺失时组件按固定规则写入首版最小配置、读回，原任务继续，结果里列出写了哪几家。
import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,chmod,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {firstLoginConfig,firstLevelScope,firstConfigFingerprint,LoginConfigs,collectLoginConfigReports,FIRST_CONFIG_RULE,FIRST_CONFIG_MODE} from '../shared/login-config-supplement.mjs';
import {CompanyDirectory} from '../shared/company-directory.mjs';
import {workflowEnvelope} from '../shared/workflow-contract.mjs';
import {companyDoc,site,role,confirm,saveCompany} from './fixtures/handoff.mjs';
const moka='https://app.ats-a.example',now=()=>'2026-11-13T15:30:00.000Z';

test('first config follows the fixed rule: first role link of the site, shared first-level directory, user-operated only',()=>{
 const roles=[{siteId:'S0039',url:moka+'/campus_apply/37/58016#/job/1'},{siteId:'S0099',url:'https://other.example/x/1'},{siteId:'S0039',url:moka+'/campus_apply/37/58017',applyUrl:moka+'/campus_apply/37/apply/58017'},{siteId:'S0039',url:moka+'/campus_apply/37/58018',applyUrl:'https://elsewhere.example/apply'}];
 const c=firstLoginConfig({companyId:'C00083',siteId:'S0039',origin:moka,roles,now});
 assert.equal(c.loginPath,'/campus_apply/37/58016#/job/1');assert.deepEqual(c.allowedPaths,['/campus_apply/']);
 assert.equal(c.loginMethod,'user_operated');assert.equal(c.version,1);assert.equal(c.evidence.sourceUrl,moka+'/campus_apply/37/58016#/job/1');
 assert.deepEqual(c.confirmation,{mode:FIRST_CONFIG_MODE,rule:FIRST_CONFIG_RULE,confirmedAt:now()});
 for(const key of ['entry','account','fields','popups','challenge'])assert.equal(key in c,false);
 assert.deepEqual(firstLevelScope([moka+'/campus/a/1',moka+'/jobs/2']),['/']);
 assert.deepEqual(firstLevelScope(['https://campus.jd.com/#/details?id=9085']),['/']);
 assert.deepEqual(firstLevelScope(['https://www.company-c.example/employ/campus/list.html?fromJob=1']),['/employ/']);
 assert.throws(()=>firstLoginConfig({companyId:'C00083',siteId:'S0039',origin:moka,roles:[{siteId:'S0099',url:'https://other.example/x'}],now}),/LOGIN_CONFIG_SOURCE_ROLE_REQUIRED/);
});

test('fingerprint equals the master write script fingerprint (Python json.dumps sort_keys, ensure_ascii=False)',()=>{
 const config=firstLoginConfig({companyId:'C00083',siteId:'S0039',origin:moka,roles:[{siteId:'S0039',url:moka+'/campus_apply/37/58016#/job/1'},{siteId:'S0039',url:moka+'/campus_apply/37/58017',applyUrl:moka+'/campus_apply/37/apply/58017'}],now});
 assert.equal(firstConfigFingerprint({company:'C00083',site:'S0039',config}),'e7856e9aaf70a1e6c4cf0fbe8fb975b83f023148ebfe9e7a741f1cd1f9afe35d');
});

async function fixture({configs={}}={}){
 // 每个用例一个独立工作区：岗位交接/ 在工作区之下，与真实布局一致。
 const workspace=await mkdtemp(path.join(os.tmpdir(),'first-login-ws-')),dir=path.join(workspace,'岗位交接');await mkdir(dir);
 for(const doc of [confirm(companyDoc({code:'C00083',name:'样例公司甲',sites:[site('S0039',moka)],roles:[role('J000202','S0039','产品经理',moka+'/campus_apply/37/58016')]})),confirm(companyDoc({code:'C00037',name:'样例公司乙',sites:[site('S0014','https://campus-b.ats-b.example')],roles:[role('J000001','S0014','产品','https://campus-b.ats-b.example/campus/detail?jobAdId=1')],order:2}))])await saveCompany(dir,doc);
 const master=path.join(dir,'工作簿全量.json');await writeFile(master,JSON.stringify({login_configs:configs}));
 const directory=new CompanyDirectory({handoffDir:dir});await directory.load();
 const writes=[];const write=async item=>{writes.push(item);const m=JSON.parse(await readFile(master,'utf8'));(m.login_configs[item.company]??={})[item.site]=item.config;await writeFile(master,JSON.stringify(m));};
 return {workspace,dir,master,directory,writes,write,leaseRoot:path.join(workspace,'.leases')};
}
const existing={schemaVersion:1,companyId:'C00037',version:3,origin:'https://campus-b.ats-b.example',loginPath:'/',allowedPaths:['/'],loginMethod:'user_operated',success:{noApplicationSubmission:true},evidence:{sourceUrl:'https://campus-b.ats-b.example/'}};

test('an existing config is read as is; a missing one is written once, read back and reported with the call',async()=>{
 const f=await fixture({configs:{C00037:{S0014:existing}}}),configs=new LoginConfigs({directory:f.directory,write:f.write,leaseRoot:f.leaseRoot,now});
 assert.deepEqual(await configs.ensure('C00037',{siteId:'S0014'}),existing);assert.equal(f.writes.length,0);
 assert.equal(await configs.exists('C00083',{siteId:'S0039'}),false);
 const result=await collectLoginConfigReports(async()=>({status:'opened',config:await configs.ensure('C00083',{siteId:'S0039'})}));
 assert.equal(f.writes.length,1);const [w]=f.writes;
 assert.equal(w.quote,FIRST_CONFIG_RULE);assert.equal(w.expectedSha,firstConfigFingerprint({company:'C00083',site:'S0039',config:w.config}));
 assert.deepEqual(result.config,w.config);assert.equal(result.status,'opened');
 assert.deepEqual(result.loginConfigsCreated,[{companyId:'C00083',siteId:'S0039',origin:moka,loginPath:'/campus_apply/37/58016',allowedPaths:['/campus_apply/'],loginMethod:'user_operated',writtenAt:now()}]);
 const again=await collectLoginConfigReports(async()=>({status:'opened',config:await configs.ensure('C00083',{siteId:'S0039'})}));
 assert.equal(f.writes.length,1);assert.equal('loginConfigsCreated' in again,false);
 assert.equal(JSON.parse(await readFile(f.master,'utf8')).login_configs.C00037.S0014.version,3);
});

test('a failed or different write is not reported as written and the original task does not continue',async()=>{
 const f=await fixture();
 const failing=new LoginConfigs({directory:f.directory,write:async()=>{throw Error('SITE_ENTRY_MASTER_WRITE_FAILED');},leaseRoot:f.leaseRoot,now});
 const list=[];await assert.rejects(collectLoginConfigReports(async()=>{try{return await failing.ensure('C00083',{siteId:'S0039'});}finally{list.push('done');}}),/SITE_ENTRY_MASTER_WRITE_FAILED/);
 const altered=new LoginConfigs({directory:f.directory,write:async item=>f.write({...item,config:{...item.config,allowedPaths:['/']}}),leaseRoot:f.leaseRoot,now});
 await assert.rejects(altered.ensure('C00083',{siteId:'S0039'}),/LOGIN_CONFIG_READBACK_FAILED/);
});

test('a legacy missing-config error routes to the supplement stage, then back to the original task',()=>{
 const r=workflowEnvelope({error:'COMPANY_LOGIN_NOT_CONFIGURED'});
 assert.deepEqual(r.continuation.nextTools,['login_config_supplement','role_advance']);assert.equal(r.continuation.state,'login');assert.equal(r.continuation.requiresUser,false);assert.equal(r.completion.status,'login_config_required');
 assert.deepEqual(workflowEnvelope({error:'LOGIN_SESSION_REQUIRED'}).continuation.nextTools,['role_advance']);
});

test('login MCP: a role of a company without login config writes the first config and continues the same task',{timeout:20000},async()=>{
 const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),f=await fixture({configs:{}}),d=await mkdtemp(path.join(os.tmpdir(),'first-login-'));
 // 工作区 = 交接区上一级；主表固定脚本用测试替身，只做“写入 login_configs”这一件事。
 const workspace=f.workspace,script=path.join(workspace,'.agents','skills','campus-job-application','scripts'),python=path.join(workspace,'tools','.venv-search-mcp','bin');
 await mkdir(script,{recursive:true});await mkdir(python,{recursive:true});
 await writeFile(path.join(python,'python'),'#!/bin/sh\nexec python3 "$@"\n');await chmod(path.join(python,'python'),0o755);
 await writeFile(path.join(script,'json_excel_sync.py'),['import json,sys,os','args=sys.argv[1:];ws=args[args.index("--workspace")+1]','item=json.load(sys.stdin)','p=os.path.join(ws,"岗位交接","工作簿全量.json")','m=json.load(open(p))','m["login_configs"].setdefault(item["company"],{})[item["site"]]=item["config"]','json.dump(m,open(p,"w"),ensure_ascii=False)'].join('\n'));
 const profile=path.join(d,'profile.json');await writeFile(profile,JSON.stringify({schemaVersion:1,facts:{},sources:{},entities:{}}));
 const c=new Client({name:'first-login-config',version:'1'});
 try{
  await c.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,'login/server.mjs')],env:{PATH:process.env.PATH,RECRUITING_BROWSER_MODE:'host',RECRUITING_PROFILE_JSON:profile,RECRUITING_PRIVATE_DIR:path.join(d,'application'),RECRUITING_LOGIN_PRIVATE_DIR:path.join(d,'login'),RECRUITING_BROWSER_SOCKET:path.join(d,'absent.sock'),RECRUITING_HANDOFF_DIR:f.dir},stderr:'ignore'}));
  const q=JSON.parse((await c.callTool({name:'role_queue_import',arguments:{}})).content[0].text);
  const task=q.tasks.find(t=>t.companyId==='C00083');
  const r=JSON.parse((await c.callTool({name:'role_open',arguments:{queueId:q.queueId,queueHash:q.queueHash,taskId:task.taskId}},undefined,{timeout:5000})).content[0].text);
  // 首版配置写入并读回后，原任务继续走到浏览器这一步（测试环境没有浏览器）。
  assert.match(r.error,/^BROWSER_/);
  assert.deepEqual(r.loginConfigsCreated.map(x=>[x.companyId,x.siteId,x.loginPath,x.allowedPaths[0]]),[['C00083','S0039','/campus_apply/37/58016','/campus_apply/']]);
  const stored=JSON.parse(await readFile(f.master,'utf8')).login_configs.C00083.S0039;assert.equal(stored.confirmation.mode,FIRST_CONFIG_MODE);
  const s=JSON.parse((await c.callTool({name:'login_config_supplement',arguments:{companyId:'C00083',siteId:'S0039'}})).content[0].text);
  assert.equal(s.status,'login_config_ready');assert.equal(s.created,false);assert.equal('loginConfigsCreated' in s,false);assert.deepEqual(s.continuation.nextTools,['role_advance']);
 }finally{await c.callTool({name:'component_runtime',arguments:{action:'stop'}}).catch(()=>{});await c.close();await rm(d,{recursive:true,force:true});await rm(f.workspace,{recursive:true,force:true});}
});
