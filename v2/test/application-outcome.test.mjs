import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,readdir,mkdir,open} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';import {createHash,randomUUID} from 'node:crypto';
import {recordApplicationOutcome} from '../shared/application-outcome.mjs';
import {closeApplication} from '../shared/application-closeout.mjs';
import {contentSha,CompanyDirectory} from '../shared/company-directory.mjs';
import {handoffInput} from '../shared/queue-config.mjs';
import {RoleQueue} from '../shared/role-queue.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
const role={'岗位ID':'A','岗位名称':'Role A','岗位链接':'https://example.com/campus/position/1'};

async function fixture(fn){
 const dir=await mkdtemp(path.join(os.tmpdir(),'outcome-')),firm=path.join(dir,'公司','中国大陆','样例');await mkdir(firm,{recursive:true});
 await writeFile(path.join(firm,'公司.json'),JSON.stringify({schemaVersion:2,companyId:'sample','公司':'样例','地区':'中国大陆',origins:['https://example.com'],roles:[]}));
 const batch={schemaVersion:2,batchId:'B1',state:'已交接',updatedAt:'t',masterDataSha256:'m',companies:[{companyId:'sample','公司':'样例','地区':'中国大陆','公司文件':'x',stage:'待建档','岗位':[role]}],excluded:[],confirmation:null};
 batch.confirmation={userQuote:'确认交接',confirmedAt:'t',contentSha256:contentSha(batch)};
 const batchFile=path.join(dir,'投递批次.json');await writeFile(batchFile,JSON.stringify(batch));
 const art=path.join(dir,'receipt.png');await writeFile(art,'synthetic receipt image');
 const ev={schemaVersion:1,event:'submission_confirmed',batchId:'B1',companyId:'sample',roleId:'A',roleUrl:role['岗位链接'],roleTitle:role['岗位名称'],observedAt:new Date().toISOString(),sourceUrl:'https://example.com/campus/delivered',result:'official_receipt_confirmed',reviewer:'user',artifacts:[{file:art,sha256:sha(await readFile(art))}]};
 const evFile=path.join(dir,'evidence.json');
 const event=async(over={},evOver={})=>{const e={...ev,...evOver};await writeFile(evFile,JSON.stringify(e));return {schemaVersion:1,eventId:randomUUID(),event:e.event,batchId:'B1',companyId:'sample',roleId:'A',roleUrl:role['岗位链接'],roleTitle:role['岗位名称'],evidence:{file:evFile,sha256:sha(await readFile(evFile))},...over};};
 await fn({dir,batchFile,event,art});
}
const outcomes=async dir=>JSON.parse(await readFile(path.join(dir,'投递回传.json'),'utf8')).roles;

test('receipt is written once per role to the handoff outcome file; replay idempotent; no backups or history',()=>fixture(async({dir,batchFile,event})=>{
 const before=await readFile(batchFile,'utf8'),outcome=await event();
 const r=await recordApplicationOutcome({outcome,handoffDir:dir});assert.equal(r.status,'recorded');assert.equal(r.businessStatus,'unchanged_until_user_review');
 assert.equal((await recordApplicationOutcome({outcome,handoffDir:dir})).status,'already_recorded');
 assert.deepEqual(Object.keys(await outcomes(dir)),['sample|A']);
 assert.equal(await readFile(batchFile,'utf8'),before);
 assert.deepEqual((await readdir(dir)).filter(f=>/backup|before|\.lock|\.tmp/.test(f)),[]);
}));

test('newer result replaces the older one for the same role; submitted cannot downgrade; event ID cannot be reused',()=>fixture(async({dir,event})=>{
 await recordApplicationOutcome({outcome:await event({event:'submission_uncertain'},{event:'submission_uncertain',result:'clicked_without_receipt'}),handoffDir:dir});
 const confirmed=await event();await recordApplicationOutcome({outcome:confirmed,handoffDir:dir});
 const roles=await outcomes(dir);assert.equal(Object.keys(roles).length,1);assert.equal(roles['sample|A'].event,'submission_confirmed');
 await assert.rejects(recordApplicationOutcome({outcome:await event({event:'user_skipped'},{event:'user_skipped',result:'user_skipped'}),handoffDir:dir}),/OUTCOME_SUBMITTED_DOWNGRADE_FORBIDDEN/);
 await assert.rejects(recordApplicationOutcome({outcome:{...confirmed,evidence:{...confirmed.evidence,sha256:'0'.repeat(64)}},handoffDir:dir}),/OUTCOME_EVENT_ID_CONFLICT/);
}));

test('unknown event, wrong role, clicked-only receipt, unproven closure and altered artifacts reject',()=>fixture(async({dir,event,art})=>{
 await assert.rejects(recordApplicationOutcome({outcome:{...(await event()),event:'submitted'},handoffDir:dir}));
 await assert.rejects(recordApplicationOutcome({outcome:await event({roleId:'B'}),handoffDir:dir}),/OUTCOME_ROLE_IDENTITY_MISMATCH/);
 await assert.rejects(recordApplicationOutcome({outcome:await event({},{result:'clicked'}),handoffDir:dir}),/OUTCOME_RECEIPT_REQUIRED/);
 await assert.rejects(recordApplicationOutcome({outcome:await event({event:'role_closed'},{event:'role_closed',result:'page_missing'}),handoffDir:dir}),/OUTCOME_ROLE_CLOSED_EVIDENCE_REQUIRED/);
 const o=await event();await writeFile(art,'changed');await assert.rejects(recordApplicationOutcome({outcome:o,handoffDir:dir}),/OUTCOME_EVIDENCE_HASH_MISMATCH/);
}));

test('unconfirmed or edited batch and concurrent writers reject',()=>fixture(async({dir,batchFile,event})=>{
 const b=JSON.parse(await readFile(batchFile,'utf8'));
 await writeFile(batchFile,JSON.stringify({...b,companies:[{...b.companies[0],'岗位':[{...role,'岗位名称':'Role A edited'}]}]}));
 await assert.rejects(recordApplicationOutcome({outcome:await event(),handoffDir:dir}),/HANDOFF_NOT_CONFIRMED/);
 await writeFile(batchFile,JSON.stringify(b));
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
