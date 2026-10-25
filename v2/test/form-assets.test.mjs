import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {recordApplicationUrl,assertSubmissionPrepared,formAssetStatus,readBatchFile} from '../shared/form-assets.mjs';
import {CompanyDirectory,readHandoffBatch,contentSha} from '../shared/company-directory.mjs';
import {Store,hash} from '../shared/engine.mjs';
import {observedSeal} from './fixtures/observed-seal.mjs';

const roleUrl='https://jobs.example.cn/campus/position/123456/detail',apply='https://jobs.example.cn/campus/apply/123456';
async function workspace(){
 const dir=await mkdtemp(path.join(os.tmpdir(),'form-assets-')),firm=path.join(dir,'公司','中国大陆','甲公司');
 await mkdir(firm,{recursive:true});
 await writeFile(path.join(firm,'公司.json'),JSON.stringify({schemaVersion:2,companyId:'jia','公司':'甲公司','地区':'中国大陆',origins:['https://jobs.example.cn'],
  roles:[{'岗位ID':'123456','主表行身份':{}},{'岗位ID':'778899','主表行身份':{}}]}));
 const directory=new CompanyDirectory({handoffDir:dir});await directory.load();
 return {dir,firm,directory};
}
const sealedFixture=()=>observedSeal({id:'jia-formal',version:1,evidence:{sourceUrl:apply,observedAt:'synthetic'},pages:[{pathPrefix:'/campus/apply/',fields:[{id:'name',source:'name',label:'Name',kind:'text',control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#name',kind:'value'},actions:[{method:'fill',selector:'#name'}]}]}]},'jia');
const sealedTemplate=()=>sealedFixture().template;

test('application URL is written back to the company folder by official role ID, same site only',async()=>{
 const {firm,directory}=await workspace(),file=path.join(firm,'公司.json');
 assert.equal((await recordApplicationUrl({directory,entryId:'jia',roleId:'123456',roleUrl,applicationUrl:apply})).status,'recorded');
 assert.equal(JSON.parse(await readFile(file,'utf8')).roles[0]['投递链接'],apply);
 assert.equal((await recordApplicationUrl({directory,entryId:'jia',roleId:'123456',roleUrl,applicationUrl:apply})).status,'unchanged');
 assert.equal((await recordApplicationUrl({directory,entryId:'jia',roleId:'778899',roleUrl,applicationUrl:'https://other.example.cn/apply'})).status,'skipped_cross_origin');
 assert.equal((await recordApplicationUrl({directory,entryId:'jia',roleId:'778899',roleUrl,applicationUrl:roleUrl})).status,'skipped_same_as_role_url');
 assert.equal((await recordApplicationUrl({directory,entryId:'jia',roleId:'000',roleUrl,applicationUrl:apply})).status,'skipped_role_not_unique');
 assert.throws(()=>directory.entry('nobody'),/UNKNOWN_COMPANY/);
});

test('handoff batch carries the stored application URL to the queue',async()=>{
 const {dir}=await workspace();
 const b={schemaVersion:2,batchId:'B1',state:'已交接',updatedAt:'x',masterDataSha256:'m',companies:[{companyId:'jia','公司':'甲公司','地区':'中国大陆','公司文件':'x',stage:'已建档',
  '岗位':[{'岗位ID':'123456','岗位名称':'AI产品经理','岗位链接':roleUrl,'投递链接':apply,'志愿分组':'公司'}]}],excluded:[],confirmation:null};
 b.confirmation={userQuote:'确认',confirmedAt:'t',contentSha256:contentSha(b)};await writeFile(path.join(dir,'投递批次.json'),JSON.stringify(b));
 const {input}=await readHandoffBatch({handoffDir:dir});assert.equal(input.companies[0].roles[0].applyUrl,apply);
 assert.equal((await readBatchFile(dir)).batchId,'B1');assert.equal(await readBatchFile(path.join(dir,'none')),null);
});

test('submission is recorded only for a role filled from a sealed company template and verified by the MCP',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'form-gate-')),store=new Store(path.join(root,'private')),qdir=path.join(root,'queue');await mkdir(qdir,{recursive:true});
 const catalog=[{id:'jia',companyId:'jia',templateId:'jia-formal',roleTemplates:{}}];
 const queues={root:qdir,read:async id=>JSON.parse(await readFile(path.join(qdir,id+'.json'),'utf8'))};
 const outcome={event:'submission_confirmed',batchId:'B1',companyId:'jia',roleId:'123456'};
 const check=()=>assertSubmissionPrepared({queues,store,catalog,outcome});
 assert.equal(await assertSubmissionPrepared({queues,store,catalog,outcome:{...outcome,event:'role_closed'}}),null);
 await assert.rejects(check(),/SUBMISSION_ROLE_NOT_IN_MCP_QUEUE/);
 const taskId='11111111-1111-4111-8111-111111111111';
 await writeFile(path.join(qdir,'q1.json'),JSON.stringify({id:'q1',batchId:'B1',tasks:[{taskId,companyId:'jia',roleId:'123456'}]}));
 await assert.rejects(check(),/SUBMISSION_REQUIRES_VERIFIED_TEMPLATE_FILL/);  // 没有 MCP 填写核验记录（手工填写）
 const fixture=sealedFixture(),template=fixture.template;await store.put('templates','jia-formal',template);await fixture.persist(store);await store.put('runs',fixture.probe.id,fixture.probe);
 const runId='22222222-2222-4222-8222-222222222222';
 await store.put('runs',runId,{id:runId,operation:'verify_current',status:'needs_attention',templateHash:hash(template)});
 await writeFile(path.join(qdir,taskId+'.json'),JSON.stringify({status:'ready_for_user_review',verifyRunId:runId}));
 await assert.rejects(check(),/SUBMISSION_REQUIRES_VERIFIED_TEMPLATE_FILL/);  // 核验未通过
 await store.put('runs',runId,{id:runId,operation:'verify_current',status:'verified',templateHash:hash(template)});
 assert.equal((await check()).verifyRunId,runId);
 await store.put('templates','jia-formal',{...template,coverage:{allControlsMapped:true}});
 await assert.rejects(check(),/SUBMISSION_COMPANY_TEMPLATE_NOT_SEALED/);
 await store.put('templates','jia-formal',{...template,pages:[]});
 await assert.rejects(check(),/SUBMISSION_COMPANY_TEMPLATE_NOT_SEALED/);
});

test('form asset status lists login, sealed template and application URL gaps per batch company',async()=>{
 const {firm,directory}=await workspace(),store=new Store(path.join(firm,'..','..','..','private'));
 const catalog=await directory.load();
 const batch={companies:[{companyId:'jia','岗位':[{'岗位ID':'123456'},{'岗位ID':'778899'}]}]};
 let s=await formAssetStatus({directory,catalog,store,batch});
 assert.deepEqual(s.incomplete[0].gaps,['登录配置','表单模板','申请页链接（2/2 个岗位缺）']);
 catalog[0].templateId='jia-formal';await store.put('templates','jia-formal',{...sealedTemplate(),coverage:{}});
 await recordApplicationUrl({directory,entryId:'jia',roleId:'123456',roleUrl,applicationUrl:apply});
 s=await formAssetStatus({directory,catalog,store,batch});
 assert.deepEqual(s.incomplete[0].gaps,['登录配置','表单模板未封存','申请页链接（1/2 个岗位缺）']);
});

test('a template bound to a profile contract marked requires_rebuild is never reused',async()=>{
 const {contractRebuildRequired}=await import('../shared/rebuild-mark.mjs');
 const profile={companyForms:{a:{executionContract:{templateHash:'h1',status:'requires_rebuild',validForCurrentInventory:false}},b:{executionContract:{templateHash:'h2',status:'registered',validForCurrentInventory:true}}}};
 assert.equal(contractRebuildRequired(profile,'h1'),true);assert.equal(contractRebuildRequired(profile,'h2'),false);assert.equal(contractRebuildRequired(profile,'h3'),false);assert.equal(contractRebuildRequired(null,'h1'),false);
 const {FormRouter}=await import('../shared/form-route.mjs'),{hash}=await import('../shared/engine.mjs');
 const t=sealedTemplate(),companies=[{id:'jia',origin:new URL(apply).origin,templateId:'jia-formal'}];
 const store={get:async(kind,id)=>{if(kind==='templates')return t;throw Object.assign(Error('missing'),{code:'ENOENT'});}};
 const marked={companyForms:{x:{executionContract:{templateHash:hash(t),status:'requires_rebuild',validForCurrentInventory:false}}}};
 const route=await new FormRouter({store,companies,validateTemplate:()=>true,loadProfile:async()=>marked}).resolve({companyId:'jia',pageUrl:apply});
 const plain=await new FormRouter({store,companies,validateTemplate:()=>true,loadProfile:async()=>null}).resolve({companyId:'jia',pageUrl:apply});
 // The rebuild mark is checked last, so it only changes the outcome of an otherwise reusable asset.
 if(plain.route==='reuse')assert.equal(route.reason,'COMPANY_FORM_CONTRACT_REQUIRES_REBUILD');else assert.equal(route.reason,plain.reason);
 assert.equal(route.route,'acquire');
});

test('a redirected role link becomes one proposal for the search side, without personal query values or a second stored link',async()=>{
 const {recordLinkChange,readOutcomes,canonicalRoleUrl}=await import('../shared/application-outcome.mjs');
 const {dir,firm}=await workspace(),origin=new URL(roleUrl).origin,observed=origin+'/job/detail?jobAdId=G-1&userId=4096';
 assert.equal(canonicalRoleUrl(observed),origin+'/job/detail?jobAdId=G-1');
 const base={companyId:'jia',roleId:'123456',roleUrl,roleTitle:'AI产品经理',handoffDir:dir};
 assert.equal((await recordLinkChange({...base,observedUrl:roleUrl})).status,'unchanged');
 assert.equal((await recordLinkChange({...base,observedUrl:'https://elsewhere.example/job'})).status,'skipped_cross_origin');
 assert.equal((await recordLinkChange({...base,observedUrl:observed})).status,'proposed');
 assert.equal((await recordLinkChange({...base,observedUrl:observed})).status,'already_proposed');
 const out=await readOutcomes(dir);assert.deepEqual(Object.keys(out.linkChanges),['jia|123456']);assert.equal(out.linkChanges['jia|123456'].observedUrl,origin+'/job/detail?jobAdId=G-1');assert.deepEqual(out.roles,{});
 const company=JSON.parse(await readFile(path.join(firm,'公司.json'),'utf8'));assert.equal(JSON.stringify(company).includes('G-1'),false);
});
