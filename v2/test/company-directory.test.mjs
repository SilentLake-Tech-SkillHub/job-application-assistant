import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {CompanyDirectory,readHandoffBatch,contentSha,pyJson} from '../shared/company-directory.mjs';
import {handoffInput} from '../shared/queue-config.mjs';
import {RoleQueue} from '../shared/role-queue.mjs';

const login=(companyId,origin)=>({schemaVersion:1,companyId,version:1,origin,loginPath:'/login',allowedPaths:['/'],account:{selector:'.a',source:'phone',countryCode:'+86',mask:'first4_last3'},fields:{}});
const batch=()=>({schemaVersion:2,batchId:'B1',state:'已交接',updatedAt:'x',masterDataSha256:'m',
 companies:[{companyId:'netease','公司':'网易','地区':'中国大陆','公司文件':'岗位交接/公司/中国大陆/网易/公司.json',stage:'已建档',
  '岗位':[{'岗位ID':'4791','岗位名称':'游戏产品经理','岗位链接':'https://campus.game.163.com/job/4791','顺序':2},
         {'岗位ID':'88','岗位名称':'平台产品经理 “AI”','岗位链接':'https://campus.163.com/job/88','顺序':1}]}],
 excluded:[{'公司':'甲','地区':'中国大陆','岗位':'x','原因':'链接是列表页'}],confirmation:null});

async function workspace(){
 const dir=await mkdtemp(path.join(os.tmpdir(),'handoff-')),firm=path.join(dir,'公司','中国大陆','网易');
 await mkdir(firm,{recursive:true});
 await writeFile(path.join(firm,'公司.json'),JSON.stringify({schemaVersion:2,companyId:'netease','公司':'网易','地区':'中国大陆',origins:['https://campus.163.com','https://campus.game.163.com','https://leihuo.163.com'],roles:[]}));
 await writeFile(path.join(firm,'登录.json'),JSON.stringify(login('netease','https://campus.163.com')));
 await writeFile(path.join(firm,'登录@campus.game.163.com.json'),JSON.stringify(login('netease-game','https://campus.game.163.com')));
 return dir;
}
const save=async(dir,b)=>writeFile(path.join(dir,'投递批次.json'),JSON.stringify(b,null,2));
const confirm=b=>({...b,state:'已交接',confirmation:{userQuote:'确认交接',confirmedAt:'t',contentSha256:contentSha(b)}});

test('python-compatible digest matches company_store.py content_sha',()=>{
 assert.equal(contentSha(batch()),'0bf980a8751bca9c2e360b843b0367ff8646714f8818842e87bbce24b03f4424');
 assert.equal(contentSha({...batch(),progress:{processedOutcomeKeys:['company|role'],remainingRoleKeys:[]}}),contentSha(batch()));
 assert.equal(pyJson({b:[1,'中'],a:null}),'{"a": null, "b": [1, "中"]}');
});

test('one directory entry per company site; logins come from the company folder',async()=>{
 const dir=await workspace(),d=new CompanyDirectory({handoffDir:dir}),list=await d.load();
 assert.deepEqual(list.map(c=>[c.id,c.origin]),[['netease','https://campus.163.com'],['netease-game','https://campus.game.163.com'],['netease--leihuo-163-com','https://leihuo.163.com']]);
 assert.match(d.loginFile('netease-game'),/登录@campus\.game\.163\.com\.json$/);
 assert.throws(()=>d.loginFile('netease--leihuo-163-com'),/COMPANY_LOGIN_NOT_CONFIGURED/);
 assert.throws(()=>d.loginFile('unknown'),/UNKNOWN_COMPANY/);
 await writeFile(path.join(dir,'公司','中国大陆','网易','登录@leihuo.163.com.json'),JSON.stringify(login('x','https://campus.163.com')));
 await assert.rejects(new CompanyDirectory({handoffDir:dir}).load(),/COMPANY_ASSET_HOST_MISMATCH/);
});

test('only a user-confirmed, unchanged handoff batch is accepted',async()=>{
 const dir=await workspace();
 await save(dir,{...batch(),state:'等待正向评审'});
 await assert.rejects(readHandoffBatch({handoffDir:dir}),/HANDOFF_NOT_CONFIRMED/);
 const ok=confirm(batch());await save(dir,ok);
 const {input}=await readHandoffBatch({handoffDir:dir});
 assert.deepEqual(input.companies[0].roles.map(r=>[r.roleId,r.order,r.preference.rank]),[['88',1,1],['4791',2,2]]);
 const noOrder=JSON.parse(JSON.stringify(batch()));delete noOrder.companies[0]['岗位'][1]['顺序'];await save(dir,confirm(noOrder));
 await assert.rejects(readHandoffBatch({handoffDir:dir}),/INVALID_CONFIRMED_ROLE_ORDER/);
 const byBu=JSON.parse(JSON.stringify(batch()));byBu.companies[0]['岗位'][0]['志愿分组']='雷火';byBu.companies[0]['岗位'][0]['顺序']=1;await save(dir,confirm(byBu));
 assert.deepEqual((await readHandoffBatch({handoffDir:dir})).input.companies[0].roles.map(r=>[r.roleId,r.order,r.preference.group,r.preference.rank]),[['4791',1,'雷火',1],['88',2,'公司',1]]);
 const tampered=JSON.parse(JSON.stringify(ok));tampered.companies[0]['岗位'].push({'岗位ID':'9','岗位名称':'x','岗位链接':'https://campus.163.com/job/9'});
 await save(dir,tampered);
 await assert.rejects(readHandoffBatch({handoffDir:dir}),/HANDOFF_CHANGED_AFTER_CONFIRMATION/);
});

test('queue maps each role to the company site entry and survives stage updates but not content edits',async()=>{
 const dir=await workspace(),d=new CompanyDirectory({handoffDir:dir}),catalog=await d.load();
 const ok=confirm(batch());await save(dir,ok);
 const queues=new RoleQueue({root:path.join(dir,'queue'),catalog,inputAdapter:handoffInput(dir)});
 await assert.rejects(queues.import({rolesFile:'/old/公司方案.json'}),/HANDOFF_BATCH_REQUIRED/);
 const q=await queues.import({});
 assert.deepEqual(q.tasks.map(t=>[t.companyId,t.roleId]),[['netease','88'],['netease-game','4791']]);
 assert.equal(q.inputKind,'confirmed-handoff-batch');
 await save(dir,{...ok,state:'进行中',updatedAt:'later'});
 await queues.get(q);
 const edited=JSON.parse(JSON.stringify(ok));edited.companies[0]['岗位'][0]['岗位名称']='改过';await save(dir,edited);
 await assert.rejects(queues.get(q),/ROLE_INPUT_CHANGED/);
});
