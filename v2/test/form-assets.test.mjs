import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {assertSubmissionPrepared,formAssetStatus} from '../shared/form-assets.mjs';
import {CompanyDirectory,readHandoffBatch} from '../shared/company-directory.mjs';
import {handoffInput} from '../shared/queue-config.mjs';
import {RoleQueue} from '../shared/role-queue.mjs';
import {Store,hash} from '../shared/engine.mjs';
import {observedSeal} from './fixtures/observed-seal.mjs';
import {companyDoc,site,role,confirm,saveCompany,saveLogin,handoffWorkspace,login} from './fixtures/handoff.mjs';

const roleUrl='https://jobs.example.cn/campus/position/123456/detail',apply='https://jobs.example.cn/campus/apply/123456';
// 甲公司 C00001，一个站点 S0001，两个本批岗位 J000001（已有投递链接）/ J000002（投递链接为空）。
const jia=()=>companyDoc({code:'C00001',name:'甲公司',sites:[site('S0001','https://jobs.example.cn')],
 roles:[role('J000001','S0001','AI产品经理',roleUrl,{'官方岗位ID':'123456','投递链接':apply,'志愿顺序':1}),role('J000002','S0001','数据产品经理','https://jobs.example.cn/campus/position/778899/detail',{'官方岗位ID':'778899','志愿顺序':2})]});
async function workspace(doc=jia()){
 const dir=await handoffWorkspace([doc]),directory=new CompanyDirectory({handoffDir:dir});await directory.load();
 return {dir,directory};
}
const sealedFixture=()=>observedSeal({id:'jia-formal',version:1,evidence:{sourceUrl:apply,observedAt:'synthetic'},pages:[{pathPrefix:'/campus/apply/',fields:[{id:'name',source:'name',label:'Name',kind:'text',control:{type:'text',valueType:'string',readbackType:'string'},read:{selector:'#name',kind:'value'},actions:[{method:'fill',selector:'#name'}]}]}]},'S0001');
const sealedTemplate=()=>sealedFixture().template;

test('the confirmed company file carries the stored 投递链接 to the queue; no form-asset code writes company files',async()=>{
 const {dir}=await workspace(confirm(jia()));
 const {input}=await readHandoffBatch({handoffDir:dir});assert.equal(input.companies[0].roles[0].applyUrl,apply);assert.equal(input.companies[0].roles[1].applyUrl,undefined);
 const src=await readFile(new URL('../shared/form-assets.mjs',import.meta.url),'utf8');assert.equal(/writeFile|rename\(/.test(src),false);
});

test('submission is recorded only for a role filled from a sealed site template and verified by the MCP',async()=>{
 const {dir}=await workspace(confirm(jia()));const root=await mkdtemp(path.join(os.tmpdir(),'form-gate-')),store=new Store(path.join(root,'private'));
 const catalog=(await new CompanyDirectory({handoffDir:dir}).load()).map(c=>({...c,templateId:'jia-formal',roleTemplates:{}}));
 const queues=new RoleQueue({root:path.join(root,'queue'),catalog,inputAdapter:handoffInput(dir)});
 const outcome={event:'submission_confirmed',batchId:'B1',companyId:'S0001',roleId:'J000001'};
 const check=()=>assertSubmissionPrepared({queues,store,catalog,outcome});
 assert.equal(await assertSubmissionPrepared({queues,store,catalog,outcome:{...outcome,event:'role_closed'}}),null);
 await assert.rejects(check(),/SUBMISSION_ROLE_NOT_IN_MCP_QUEUE/);
 const q=await queues.import({}),taskId=q.tasks[0].taskId;
 await assert.rejects(check(),/SUBMISSION_REQUIRES_VERIFIED_TEMPLATE_FILL/);  // 没有 MCP 填写核验记录（手工填写）
 const fixture=sealedFixture(),template=fixture.template;await store.put('templates','jia-formal',template);await fixture.persist(store);await store.put('runs',fixture.probe.id,fixture.probe);
 const runId='22222222-2222-4222-8222-222222222222';
 await store.put('runs',runId,{id:runId,operation:'verify_current',status:'needs_attention',templateHash:hash(template)});
 await queues.put(taskId,{status:'ready_for_user_review',verifyRunId:runId});
 await assert.rejects(check(),/SUBMISSION_REQUIRES_VERIFIED_TEMPLATE_FILL/);  // 核验未通过
 const materialsHash=hash(confirm(jia())['岗位'][0]['材料']);
 await store.put('runs',runId,{id:runId,operation:'verify_current',status:'verified',templateHash:hash(template),materialCoverage:{enabled:true,complete:true,materialsHash}});
 assert.equal((await check()).verifyRunId,runId);
 // 交接后公司文件被改动：材料、链接不再是确认那一版，拒绝记录
 const edited=confirm(jia());edited['岗位'][0]['岗位名称']='改过';await saveCompany(dir,{...edited,'批次':{...edited['批次'],'确认':confirm(jia())['批次']['确认']}});
 await assert.rejects(check(),/ROLE_INPUT_CHANGED|HANDOFF_CHANGED_AFTER_CONFIRMATION/);
 await saveCompany(dir,confirm(jia()));
 await store.put('templates','jia-formal',{...template,coverage:{allControlsMapped:true}});
 await assert.rejects(check(),/SUBMISSION_COMPANY_TEMPLATE_NOT_SEALED/);
 await store.put('templates','jia-formal',{...template,pages:[]});
 await assert.rejects(check(),/SUBMISSION_COMPANY_TEMPLATE_NOT_SEALED/);
});

test('form asset status reports login, sealed template and 投递链接 gaps per site code for the batch companies',async()=>{
 const {dir}=await workspace(),store=new Store(path.join(dir,'..',path.basename(dir)+'-private'));
 let catalog=await new CompanyDirectory({handoffDir:dir}).load();
 let s=await formAssetStatus({handoffDir:dir,catalog,store});
 assert.equal(s.companies,1);assert.deepEqual(s.incomplete[0],{companyId:'C00001',name:'甲公司',gaps:['S0001：登录配置、表单模板、投递链接（1 个岗位缺）']});
 await saveLogin(dir,'甲公司','登录.json',login('jia','https://jobs.example.cn'));catalog=await new CompanyDirectory({handoffDir:dir}).load();
 catalog[0].templateId='jia-formal';await store.put('templates','jia-formal',{...sealedTemplate(),coverage:{}});
 s=await formAssetStatus({handoffDir:dir,catalog,store});
 assert.deepEqual(s.incomplete[0].gaps,['S0001：表单模板未封存、投递链接（1 个岗位缺）']);
 assert.deepEqual(s.detail[0].roles.map(r=>[r.roleId,r.siteId,!!r.applicationUrl]),[['J000001','S0001',true],['J000002','S0001',false]]);
 s=await formAssetStatus({handoffDir:dir,catalog,store,companyIds:['C00009']});assert.deepEqual(s.incomplete,[{companyId:'C00009',name:undefined,gaps:['unknown_company']}]);
});

test('a template bound to a profile contract marked requires_rebuild is never reused',async()=>{
 const {contractRebuildRequired}=await import('../shared/rebuild-mark.mjs');
 const profile={companyForms:{a:{executionContract:{templateHash:'h1',status:'requires_rebuild',validForCurrentInventory:false,rebuildReason:'question_definition_changed'}},legacy:{executionContract:{templateHash:'h4',status:'requires_rebuild',validForCurrentInventory:false}},b:{executionContract:{templateHash:'h2',status:'registered',validForCurrentInventory:true}}}};
 assert.equal(contractRebuildRequired(profile,'h1'),true);assert.equal(contractRebuildRequired(profile,'h2'),false);assert.equal(contractRebuildRequired(profile,'h3'),false);assert.equal(contractRebuildRequired(null,'h1'),false);assert.equal(contractRebuildRequired(profile,'h4'),false);
 const {FormRouter}=await import('../shared/form-route.mjs'),{hash}=await import('../shared/engine.mjs');
 const t=sealedTemplate(),companies=[{id:'S0001',origin:new URL(apply).origin,templateId:'jia-formal'}];
 const store={get:async(kind,id)=>{if(kind==='templates')return t;throw Object.assign(Error('missing'),{code:'ENOENT'});}};
 const marked={companyForms:{x:{executionContract:{templateHash:hash(t),status:'requires_rebuild',validForCurrentInventory:false,rebuildReason:'major_policy_changed'}}}};
 const route=await new FormRouter({store,companies,validateTemplate:()=>true,loadProfile:async()=>marked}).resolve({companyId:'S0001',pageUrl:apply});
 const plain=await new FormRouter({store,companies,validateTemplate:()=>true,loadProfile:async()=>null}).resolve({companyId:'S0001',pageUrl:apply});
 // The rebuild mark is checked last, so it only changes the outcome of an otherwise reusable asset.
 if(plain.route==='reuse')assert.equal(route.reason,'COMPANY_FORM_CONTRACT_REQUIRES_REBUILD');else assert.equal(route.reason,plain.reason);
 assert.equal(route.route,'acquire');
});

test('filling a form does not mark its contract for rebuild; a question the contract does not cover does',async()=>{
 const {registerObservedQuestions}=await import('../shared/profile.mjs');
 const q=(label,extra={})=>({selector:`phoenixq:{"section":"教育经历","label":"${label}","occurrence":${extra.occurrence||0}}`,label,section:'教育经历',type:'text',required:true,...extra});
 const field=(label,type='text',occurrences=[0])=>({id:label,label,inventoryLabel:label,inventoryType:type,inventorySelectors:occurrences.map(o=>q(label,{occurrence:o}).selector)});
 const contract={templateHash:'h',status:'registered',validForCurrentInventory:true,fields:[field('学校名称','text',[0,1]),field('学历','combobox',[0,1]),field('毕业论文题目')]};
 const fresh=[q('学校名称',{diagnosticSelector:'body > div:nth-of-type(3)'}),q('学历',{type:'combobox',options:['本科']})];
 // After upload and filling: parsed values, a second record, a revealed conditional question in the contract, new option lists, new layout paths.
 const filled=[...fresh.map(f=>({...f,diagnosticSelector:'body > div:nth-of-type(5)',value:'x',options:f.options?['本科','硕士研究生']:undefined,required:false})),q('学校名称',{occurrence:1}),q('学历',{occurrence:1,type:'combobox'}),q('毕业论文题目')];
 const at='2026-10-26T12:00:00.000Z',pageUrl='https://jobs.example.test/form';
 const observe=(...rounds)=>{const profile={companyForms:{},fieldRegistry:{},facts:{}};registerObservedQuestions(profile,{companyId:'jia',pageUrl,fields:rounds[0],observedAt:at});const form=()=>Object.values(profile.companyForms)[0];form().executionContract=structuredClone(contract);for(const r of rounds.slice(1))registerObservedQuestions(profile,{companyId:'jia',pageUrl,fields:r,observedAt:at});return form().executionContract;};
 assert.equal(observe(fresh,filled,fresh).status,'registered');
 const added=observe(fresh,[...fresh,q('期望薪资')]);assert.equal(added.status,'requires_rebuild');assert.equal(added.rebuildReason,'question_definition_changed');assert.deepEqual(added.rebuildEvidence,[{kind:'new_question',label:'期望薪资'}]);
 const retyped=observe(fresh,[fresh[0],{...fresh[1],type:'text'}]);assert.deepEqual(retyped.rebuildEvidence,[{kind:'type_changed',label:'学历'}]);
});
