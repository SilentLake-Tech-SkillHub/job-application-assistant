import test from 'node:test';import assert from 'node:assert/strict';
import {writeFile,readFile} from 'node:fs/promises';import path from 'node:path';
import {CompanyDirectory,readHandoffBatch,contentSha,pyJson,assertHandoffUnchanged} from '../shared/company-directory.mjs';
import {handoffInput} from '../shared/queue-config.mjs';
import {RoleQueue} from '../shared/role-queue.mjs';
import {companyDoc,site,role,confirm,saveCompany,saveLogin,handoffWorkspace,login} from './fixtures/handoff.mjs';

const netease=(extra={})=>companyDoc({code:'C00007',name:'网易',sites:[site('S0003','https://campus.163.com'),site('S0004','https://campus.game.163.com',{'登录链接':'https://campus.game.163.com/login'}),site('S0005','https://leihuo.163.com')],
 roles:[role('J000011','S0004','游戏产品经理','https://campus.game.163.com/job/4791',{'官方岗位ID':'4791','志愿顺序':2,'城市选项':['杭州','广州']}),
        role('J000012','S0003','平台产品经理 “AI”','https://campus.163.com/job/88',{'官方岗位ID':'88','志愿顺序':1}),
        role('J000013','S0005','美术','https://leihuo.163.com/j/1')],selected:['J000012','J000011'],...extra});
async function workspace(doc=netease()){
 const dir=await handoffWorkspace([doc]);
 await saveLogin(dir,'网易','登录.json',login('netease','https://campus.163.com'));
 await saveLogin(dir,'网易','登录@campus.game.163.com.json',login('netease-game','https://campus.game.163.com'));
 return dir;
}

test('python-compatible digest matches company_store.py content_sha',()=>{
 // 期望值由搜索端 company_store.content_sha 对同一份宽表算得
 const d=companyDoc({...{code:'C00007',name:'网易'},sites:netease()['站点'],roles:netease()['岗位'],selected:['J000011','J000012']});
 assert.equal(contentSha(d),'7ca793793dab099ae5b6e3a2d15207e2fb2d7fe501949a8944deadbc53b8c467');
 // 只覆盖本批选中岗位的执行字段与其站点：未选岗位、投递状态、进度变化不影响指纹
 const other=structuredClone(d);other['岗位'][2]['岗位名称']='改了';other['岗位'][0]['投递状态']='岗位已投递';other['批次']['进度']={'已处理':['J000011']};other['站点'][2]['登录链接']='https://leihuo.163.com/login';
 assert.equal(contentSha(other),contentSha(d));
 const changed=structuredClone(d);changed['站点'][1]['登录链接']=null;assert.notEqual(contentSha(changed),contentSha(d));
 assert.equal(pyJson({b:[1,'中'],a:null}),'{"a": null, "b": [1, "中"]}');
});

test('one directory entry per site code; transitional logins are matched by origin',async()=>{
 const dir=await workspace(),d=new CompanyDirectory({handoffDir:dir}),list=await d.load();
 assert.deepEqual(list.map(c=>[c.id,c.companyId,c.origin,c.loginUrl]),[['S0003','C00007','https://campus.163.com',null],['S0004','C00007','https://campus.game.163.com','https://campus.game.163.com/login'],['S0005','C00007','https://leihuo.163.com',null]]);
 assert.match(d.loginFile('S0004'),/登录@campus\.game\.163\.com\.json$/);
 assert.throws(()=>d.loginFile('S0005'),/COMPANY_LOGIN_NOT_CONFIGURED/);
 assert.throws(()=>d.loginFile('netease'),/UNKNOWN_COMPANY/);
 await saveLogin(dir,'网易','登录@leihuo.163.com.json',login('x','https://campus.163.com'));
 await assert.rejects(new CompanyDirectory({handoffDir:dir}).load(),/COMPANY_ASSET_HOST_MISMATCH/);
 const dup=await handoffWorkspace([netease(),companyDoc({code:'C00008',name:'另一家',sites:[site('S0003','https://x.test')],roles:[]})]);
 await assert.rejects(new CompanyDirectory({handoffDir:dup}).load(),/DUPLICATE_SITE_CODE/);
 const wrong=await handoffWorkspace([]);await saveCompany(wrong,netease());const f=path.join(wrong,'公司','C00007.json'),doc=JSON.parse(await readFile(f,'utf8'));doc['公司编码']='C00009';await writeFile(f,JSON.stringify(doc));
 await assert.rejects(new CompanyDirectory({handoffDir:wrong}).load(),/COMPANY_FILE_CODE_MISMATCH/);
});

test('only a user-confirmed, unchanged company file is accepted; roles keep codes and user order',async()=>{
 const dir=await workspace();
 await assert.rejects(readHandoffBatch({handoffDir:dir}),/HANDOFF_NOT_CONFIRMED/);
 const ok=confirm(netease());await saveCompany(dir,ok);
 const {input,source}=await readHandoffBatch({handoffDir:dir});
 assert.equal(input.companies[0].companyId,'C00007');
 assert.deepEqual(input.companies[0].roles.map(r=>[r.roleId,r.siteId,r.officialId,r.order,r.preference.rank]),[['J000012','S0003','88',1,1],['J000011','S0004','4791',2,2]]);
 assert.equal(source.files.C00007.contentSha256,ok['批次']['确认'].contentSha256);
 const noOrder=netease();noOrder['岗位'][0]['志愿顺序']=null;await saveCompany(dir,confirm(noOrder));
 await assert.rejects(readHandoffBatch({handoffDir:dir}),/INVALID_CONFIRMED_ROLE_ORDER/);
 const tampered=structuredClone(ok);tampered['岗位'][0]['岗位链接']='https://campus.game.163.com/job/9';await saveCompany(dir,tampered);
 await assert.rejects(readHandoffBatch({handoffDir:dir}),/HANDOFF_CHANGED_AFTER_CONFIRMATION/);
 const badMaterial=structuredClone(netease());badMaterial['岗位'][1]['材料'].items[0].evidence['岗位编码']='J000011';await saveCompany(dir,confirm(badMaterial));
 await assert.rejects(readHandoffBatch({handoffDir:dir}),/ROLE_MATERIAL_SCOPE_MISMATCH/);
});

test('companies are isolated: an edit in one company invalidates only that company',async()=>{
 const other=companyDoc({code:'C00008',name:'米哈游',sites:[site('S0009','https://jobs.mihoyo.com')],roles:[role('J000020','S0009','策划','https://jobs.mihoyo.com/#/position/1')],order:2});
 const dir=await workspace();await saveCompany(dir,confirm(netease()));await saveCompany(dir,confirm(other));
 const {input,source}=await readHandoffBatch({handoffDir:dir});
 assert.deepEqual(input.companies.map(c=>[c.companyId,c.order]),[['C00007',1],['C00008',2]]);
 const edited=confirm(other);edited['岗位'][0]['岗位名称']='改过';await saveCompany(dir,edited);
 await assertHandoffUnchanged(source,'C00007');
 await assert.rejects(assertHandoffUnchanged(source,'C00008'),/HANDOFF_CHANGED_AFTER_CONFIRMATION|ROLE_INPUT_CHANGED/);
 const twoBatches=confirm(other);twoBatches['批次']['批次编号']='B2';await saveCompany(dir,confirm({...twoBatches,'批次':{...twoBatches['批次'],'确认':null}}));
 await assert.rejects(readHandoffBatch({handoffDir:dir}),/HANDOFF_MULTIPLE_BATCHES/);
});

test('queue stores only codes and order; links are read from the company file at execution',async()=>{
 const dir=await workspace();const ok=confirm(netease());await saveCompany(dir,ok);
 const catalog=await new CompanyDirectory({handoffDir:dir}).load();
 const queues=new RoleQueue({root:path.join(dir,'queue'),catalog,inputAdapter:handoffInput(dir)});
 await assert.rejects(queues.import({rolesFile:'/old/公司方案.json'}),/HANDOFF_BATCH_REQUIRED/);
 const q=await queues.import({});
 assert.equal(q.inputKind,'confirmed-handoff-batch');
 const stored=JSON.parse(await readFile(path.join(dir,'queue',q.queueId+'.json'),'utf8'));
 assert.deepEqual(stored.tasks.map(t=>[t.companyId,t.companyCode,t.roleId]),[['S0003','C00007','J000012'],['S0004','C00007','J000011']]);
 assert.ok(stored.tasks.every(t=>!('url' in t)&&!('title' in t)&&!('materials' in t)));assert.equal(stored.input,undefined);
 const {t}=await queues.task({...q,taskId:stored.tasks[0].taskId});
 assert.deepEqual([t.url,t.title,t.officialId],['https://campus.163.com/job/88','平台产品经理 “AI”','88']);
 // 进度、状态推进不影响；内容被改则拒绝
 await saveCompany(dir,{...ok,'批次':{...ok['批次'],'状态':'进行中','进度':{'已处理':[],'待投递':['J000011','J000012']}}});
 await queues.get(q);
 const edited=structuredClone(ok);edited['岗位'][1]['岗位名称']='改过';await saveCompany(dir,edited);
 await assert.rejects(queues.task({...q,taskId:stored.tasks[0].taskId}),/HANDOFF_CHANGED_AFTER_CONFIRMATION|ROLE_INPUT_CHANGED/);
});

test('existing form assets keep their stored asset key through a fixed site binding; unbound sites use the site code',async()=>{
 const {Store}=await import('../shared/engine.mjs'),{readSiteAssetKeys}=await import('../shared/company-directory.mjs');
 const {recordApplicationOutcome}=await import('../shared/application-outcome.mjs');
 const dir=await workspace(),store=new Store(path.join(dir,'private'));
 assert.deepEqual(await readSiteAssetKeys(store),{});
 await store.put('templates','site-asset-keys',{S0003:'netease',S0004:'netease-game'});
 const catalog=await new CompanyDirectory({handoffDir:dir,store}).load();
 assert.deepEqual(catalog.map(c=>[c.id,c.siteId,c.companyId]),[['netease','S0003','C00007'],['netease-game','S0004','C00007'],['S0005','S0005','C00007']]);
 await saveCompany(dir,confirm(netease()));
 const queues=new RoleQueue({root:path.join(dir,'queue'),catalog,inputAdapter:handoffInput(dir)}),q=await queues.import({});
 assert.deepEqual(q.tasks.map(t=>[t.companyId,t.siteId,t.roleId]),[['netease','S0003','J000012'],['netease-game','S0004','J000011']]);
 const {t}=await queues.task({...q,taskId:q.tasks[0].taskId});assert.equal(t.url,'https://campus.163.com/job/88');
 // 回传按资产键交来，按绑定对应到站点编码后核对
 const outcome={schemaVersion:1,eventId:'3b241101-e2bb-4255-8caf-4136c566a962',event:'submission_confirmed',batchId:'B1',companyId:'netease-game',roleId:'J000011',roleUrl:'https://campus.game.163.com/job/4791',roleTitle:'游戏产品经理',evidence:{file:'/nonexistent',sha256:'0'.repeat(64)}};
 await assert.rejects(recordApplicationOutcome({outcome,handoffDir:dir}),/OUTCOME_ROLE_IDENTITY_MISMATCH/);
 await assert.rejects(recordApplicationOutcome({outcome,handoffDir:dir,catalog}),/ENOENT/);  // 身份通过，才去读证据
 for(const bad of [{S0003:'Keep'},{X1:'a'},{S0003:'a',S0004:'a'}]){await store.put('templates','site-asset-keys',bad);await assert.rejects(new CompanyDirectory({handoffDir:dir,store}).load(),/INVALID_SITE_ASSET_KEYS/);}
 await store.put('templates','site-asset-keys',{S0003:'S0005'});
 await assert.rejects(new CompanyDirectory({handoffDir:dir,store}).load(),/DUPLICATE_SITE_ASSET_KEY/);
});
