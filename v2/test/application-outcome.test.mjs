import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,mkdir,open} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {recordApplicationOutcome} from '../shared/application-outcome.mjs';
import {closeApplication} from '../shared/application-closeout.mjs';
import {contentSha,CompanyDirectory} from '../shared/company-directory.mjs';
import {handoffInput} from '../shared/queue-config.mjs';
import {RoleQueue} from '../shared/role-queue.mjs';
import {companyDoc,site,role as roleRow,confirm,saveCompany,handoffWorkspace} from './fixtures/handoff.mjs';
import {recordObservation,readOutcomes} from '../shared/application-outcome.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const role={'岗位编码':'J000001','岗位名称':'Role A','岗位链接':'https://example.com/campus/position/1'};
const doc=()=>confirm(companyDoc({code:'C00001',name:'样例',sites:[site('S0001','https://example.com')],roles:[roleRow('J000001','S0001',role['岗位名称'],role['岗位链接'])]}));

async function fixture(fn){
 const dir=await handoffWorkspace([doc()]),companyFile=path.join(dir,'公司','C00001.json');
 const art=path.join(dir,'receipt.png');await writeFile(art,'synthetic receipt image');
 const ev={schemaVersion:1,event:'submission_confirmed',batchId:'B1',companyId:'S0001',roleId:'J000001',roleUrl:role['岗位链接'],roleTitle:role['岗位名称'],observedAt:new Date().toISOString(),sourceUrl:'https://example.com/campus/delivered',result:'official_receipt_confirmed',reviewer:'user',artifacts:[{file:art,sha256:sha(await readFile(art))}]};
 const evFile=path.join(dir,'evidence.json');
 const event=async(over={},evOver={})=>{const e={...ev,...evOver};await writeFile(evFile,JSON.stringify(e));return {schemaVersion:1,eventId:randomUUID(),event:e.event,batchId:'B1',companyId:'S0001',roleId:'J000001',roleUrl:role['岗位链接'],roleTitle:role['岗位名称'],evidence:{file:evFile,sha256:sha(await readFile(evFile))},...over};};
 await fn({dir,companyFile,event,art});
}
const outcomes=async dir=>JSON.parse(await readFile(path.join(dir,'投递回传.json'),'utf8')).roles;

test('receipt is written once per role code to the handoff outcome file; replay idempotent; no backups or history',()=>fixture(async({dir,companyFile,event})=>{
 const before=await readFile(companyFile,'utf8'),outcome=await event();
 const r=await recordApplicationOutcome({outcome,handoffDir:dir});assert.equal(r.status,'recorded');assert.equal(r.businessStatus,'unchanged_until_user_review');
 assert.equal((await recordApplicationOutcome({outcome,handoffDir:dir})).status,'already_recorded');
 assert.deepEqual(Object.keys(await outcomes(dir)),['J000001']);
 assert.deepEqual([(await outcomes(dir)).J000001.companyCode,(await outcomes(dir)).J000001.siteId],['C00001','S0001']);
 assert.equal(await readFile(companyFile,'utf8'),before);
 assert.deepEqual((await readdir(dir)).filter(f=>/backup|before|\.lock|\.tmp/.test(f)),[]);
}));

test('newer result replaces the older one for the same role; submitted cannot downgrade; event ID cannot be reused',()=>fixture(async({dir,event})=>{
 await recordApplicationOutcome({outcome:await event({event:'submission_uncertain'},{event:'submission_uncertain',result:'clicked_without_receipt'}),handoffDir:dir});
 const confirmed=await event();await recordApplicationOutcome({outcome:confirmed,handoffDir:dir});
 const roles=await outcomes(dir);assert.equal(Object.keys(roles).length,1);assert.equal(roles.J000001.event,'submission_confirmed');
 await assert.rejects(recordApplicationOutcome({outcome:await event({event:'user_skipped'},{event:'user_skipped',result:'user_skipped'}),handoffDir:dir}),/OUTCOME_SUBMITTED_DOWNGRADE_FORBIDDEN/);
 await assert.rejects(recordApplicationOutcome({outcome:{...confirmed,evidence:{...confirmed.evidence,sha256:'0'.repeat(64)}},handoffDir:dir}),/OUTCOME_EVENT_ID_CONFLICT/);
}));

test('unknown event, wrong role, clicked-only receipt, unproven closure and altered artifacts reject',()=>fixture(async({dir,event,art})=>{
 await assert.rejects(recordApplicationOutcome({outcome:{...(await event()),event:'submitted'},handoffDir:dir}));
 await assert.rejects(recordApplicationOutcome({outcome:await event({roleId:'J000002'}),handoffDir:dir}),/OUTCOME_ROLE_IDENTITY_MISMATCH/);
 await assert.rejects(recordApplicationOutcome({outcome:await event({companyId:'S0002'}),handoffDir:dir}),/OUTCOME_ROLE_IDENTITY_MISMATCH/);
 await assert.rejects(recordApplicationOutcome({outcome:await event({roleId:'A'}),handoffDir:dir}));
 await assert.rejects(recordApplicationOutcome({outcome:await event({batchId:'B0'},{batchId:'B0'}),handoffDir:dir}),/OUTCOME_BATCH_MISMATCH/);
 await assert.rejects(recordApplicationOutcome({outcome:await event({},{result:'clicked'}),handoffDir:dir}),/OUTCOME_RECEIPT_REQUIRED/);
 await assert.rejects(recordApplicationOutcome({outcome:await event({event:'role_closed'},{event:'role_closed',result:'page_missing'}),handoffDir:dir}),/OUTCOME_ROLE_CLOSED_EVIDENCE_REQUIRED/);
 const o=await event();await writeFile(art,'changed');await assert.rejects(recordApplicationOutcome({outcome:o,handoffDir:dir}),/OUTCOME_EVIDENCE_HASH_MISMATCH/);
}));

test('unconfirmed or edited company file and concurrent writers reject',()=>fixture(async({dir,event})=>{
 const b=doc();const edited=structuredClone(b);edited['岗位'][0]['岗位名称']='Role A edited';await saveCompany(dir,edited);
 await assert.rejects(recordApplicationOutcome({outcome:await event(),handoffDir:dir}),/HANDOFF_CHANGED_AFTER_CONFIRMATION/);
 await saveCompany(dir,{...b,'批次':{...b['批次'],'状态':'等待正向评审','确认':null}});
 await assert.rejects(recordApplicationOutcome({outcome:await event(),handoffDir:dir}),/HANDOFF_NOT_CONFIRMED/);
 await saveCompany(dir,b);
 const h=await open(path.join(dir,'投递回传.json.lock'),'wx');
 await assert.rejects(recordApplicationOutcome({outcome:await event(),handoffDir:dir}),/OUTCOME_WRITE_LOCKED/);await h.close();
}));

test('recorded outcomes protect roles from rerun until the user reviews them',()=>fixture(async({dir,event})=>{
 const catalog=await new CompanyDirectory({handoffDir:dir}).load(),queues=new RoleQueue({root:path.join(dir,'q'),catalog,inputAdapter:handoffInput(dir)});
 await recordApplicationOutcome({outcome:await event({event:'submission_uncertain'},{event:'submission_uncertain',result:'clicked_without_receipt'}),handoffDir:dir});
 let q=await queues.import({});assert.deepEqual(q.protectedRoles.map(p=>p.reason),['outcome_requires_resolution']);
 await recordApplicationOutcome({outcome:await event(),handoffDir:dir});
 q=await queues.import({});assert.deepEqual(q.protectedRoles.map(p=>p.reason),['already_submitted']);assert.equal(q.tasks.length,0);
}));

test('closeout needs no tracker configuration and never touches the website',()=>fixture(async({dir,event})=>{
 const r=await closeApplication({outcome:await event(),handoffDir:dir});assert.equal(r.status,'closed');assert.equal(r.websiteAction,'none');
}));

// A pending review is a workflow phase of this same confirmed batch, not permission to import a new batch.
test('same confirmed batch accepts additional verified outcomes while reverse review is pending',()=>fixture(async({dir,event})=>{
 const b=doc();b['批次']['状态']='等待反向评审';await saveCompany(dir,b);
 assert.equal((await recordApplicationOutcome({outcome:await event(),handoffDir:dir})).status,'recorded');
 b['岗位'][0]['岗位名称']='Changed';await saveCompany(dir,b);
 await assert.rejects(recordApplicationOutcome({outcome:await event(),handoffDir:dir}),/HANDOFF_CHANGED_AFTER_CONFIRMATION/);
}));

test('link observations: one per code and field, overwritten; only failures or first-seen links; never touches the company file',()=>fixture(async({dir,companyFile})=>{
 const before=await readFile(companyFile,'utf8');
 assert.deepEqual(await readOutcomes(dir),{schemaVersion:2,roles:{},observations:[]});
 assert.equal((await recordObservation({kind:'role',code:'J000001',field:'投递链接',value:'https://example.com/apply?id=1',evidence:'role_enter_application_verified',handoffDir:dir})).status,'observed');
 assert.equal((await recordObservation({kind:'role',code:'J000001',field:'投递链接',value:'https://example.com/apply?id=1',evidence:'again',handoffDir:dir})).status,'already_observed');
 await recordObservation({kind:'role',code:'J000001',field:'投递链接',value:null,evidence:'打开后到首页',handoffDir:dir});
 await recordObservation({kind:'role',code:'J000001',field:'岗位链接',value:null,evidence:'404 页面',handoffDir:dir});
 await recordObservation({kind:'site',code:'S0001',field:'登录链接',value:'https://example.com/login',evidence:'和用户一起登录时观察',handoffDir:dir});
 const out=await readOutcomes(dir);
 assert.deepEqual(out.observations.map(o=>[o.kind,o.code,o.field,o.value]),[['role','J000001','投递链接',null],['role','J000001','岗位链接',null],['site','S0001','登录链接','https://example.com/login']]);
 for(const bad of [{kind:'role',code:'J000001',field:'岗位链接',value:'http://example.com/new'},{kind:'role',code:'S0001',field:'投递链接',value:null},{kind:'site',code:'S0001',field:'账号核对页',value:null},{kind:'site',code:'S0001',field:'岗位链接',value:null},{kind:'role',code:'J000001',field:'投递链接',value:'http://example.com/a'}])
  await assert.rejects(recordObservation({...bad,evidence:'x',handoffDir:dir}),/INVALID_OBSERVATION/);
 await assert.rejects(recordObservation({kind:'role',code:'J000001',field:'投递链接',value:null,evidence:' ',handoffDir:dir}),/OBSERVATION_EVIDENCE_REQUIRED/);
 assert.equal(await readFile(companyFile,'utf8'),before);
}));

test('a role link observation may carry the redirected role page (changed role ID, title matched); it overwrites the same role/field entry',async()=>{
 const {mkdtemp,rm}=await import('node:fs/promises'),os=await import('node:os');const dir=await mkdtemp(path.join(os.tmpdir(),'obs-'));
 try{await recordObservation({kind:'role',code:'J000144',field:'岗位链接',value:null,evidence:'404',handoffDir:dir});
  await recordObservation({kind:'role',code:'J000144',field:'岗位链接',value:'https://jobs.example.test/job/detail?jobAdId=a1',evidence:'跳转后编号变化，岗位名一致',handoffDir:dir});
  assert.deepEqual((await readOutcomes(dir)).observations.map(o=>[o.code,o.field,o.value]),[['J000144','岗位链接','https://jobs.example.test/job/detail?jobAdId=a1']]);
 }finally{await rm(dir,{recursive:true,force:true});}
});
