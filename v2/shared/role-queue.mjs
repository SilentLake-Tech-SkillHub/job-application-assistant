import {readFile,writeFile,mkdir,rename} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
export const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fileHash=async file=>createHash('sha256').update(await readFile(file)).digest('hex');
// Upstream owns preparation and approval of the company plan. This adapter only
// consumes its JSON; it never reads, converts, checks or writes a workbook.
export async function readCompanyPlan({rolesFile,companyPlan}){
 if(!!rolesFile===!!companyPlan)throw Error('ONE_COMPANY_PLAN_INPUT_REQUIRED');
 if(companyPlan)return {input:structuredClone(companyPlan),source:{kind:'object',version:companyPlan.version||companyPlan.schema_version||1}};
 const file=path.resolve(rolesFile),bytes=await readFile(file);return {input:JSON.parse(bytes.toString('utf8')),source:{kind:'file',file,hash:createHash('sha256').update(bytes).digest('hex')}};
}
export class RoleQueue{
 constructor({root,catalog,inputAdapter=readCompanyPlan}){Object.assign(this,{root,catalog,inputAdapter});}
 file(id){if(!/^[a-z0-9-]{1,90}$/.test(id))throw Error('INVALID_ROLE_QUEUE_KEY');return path.join(this.root,id+'.json');}
 async put(id,value){await mkdir(this.root,{recursive:true,mode:0o700});const file=this.file(id),tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600});await rename(tmp,file);return value;}
 async read(id){return JSON.parse(await readFile(this.file(id),'utf8'));}
 async import(args){
  const {input,source}=await this.inputAdapter(args);let tasks=[],protectedRoles=[];
  const legacy=input.schema_version===1,native=input.schemaVersion===1;
  if((!legacy&&!native)||!Array.isArray(input.companies)||!(input.batchId||input.batch_id))throw Error('INVALID_COMPANY_PLAN_JSON');
  if(native&&(!input.version||input.confirmation?.status!=='confirmed'||!input.confirmation.reference))throw Error('COMPANY_PLAN_CONFIRMATION_REQUIRED');
  const selected=input.companies.filter(c=>Array.isArray(c.roles)&&c.roles.some(r=>r.selected===true));
  if(!selected.length)throw Error('NO_CONFIRMED_ROLES');
  const sequence=args.companyOrder||input.execution_order||null;
  if(sequence&&(sequence.length!==selected.length||new Set(sequence).size!==sequence.length||selected.some(c=>!sequence.includes(c.companyId||c.company_key))))throw Error('INVALID_CONFIRMED_COMPANY_ORDER');
  if(!sequence&&selected.length>1&&(selected.some(c=>!Number.isInteger(c.order)||c.order<1)||new Set(selected.map(c=>c.order)).size!==selected.length))throw Error('CONFIRMED_COMPANY_ORDER_REQUIRED');
  selected.sort((a,b)=>sequence?sequence.indexOf(a.companyId||a.company_key)-sequence.indexOf(b.companyId||b.company_key):(a.order||1)-(b.order||1));
  const identities=new Set(),urls=new Set();
  for(const c of selected){
   if(legacy&&(!c.version||!c.confirmed_at||!c.confirmation_ref||!c.confirmed_digest))throw Error('COMPANY_PLAN_CONFIRMATION_REQUIRED');
   const roles=c.roles.filter(r=>r.selected===true),orders=new Set();
   for(const r of roles){if(!Number.isInteger(r.order)||r.order<1||orders.has(r.order))throw Error('INVALID_CONFIRMED_ROLE_ORDER');orders.add(r.order);}
   for(const r of roles.sort((a,b)=>a.order-b.order)){
    const u=new URL(r.url);let companyId=c.companyId;
    if(!companyId){const match=this.catalog.filter(x=>x.origin===u.origin);if(match.length!==1)throw Error('ROLE_COMPANY_NOT_UNIQUE');companyId=match[0].id;}
    const company=this.catalog.find(x=>x.id===companyId),roleId=String(r.roleId||r.id||'');
    if(!roleId||!r.title||!company||u.protocol!=='https:'||u.origin!==company.origin||u.username||u.password||/\/(?:login|sign[-_]?in)\/?$/.test(u.pathname))throw Error('INVALID_CONFIRMED_ROLE_URL');
    const applyUrl=r.applyUrl||r.apply_url||null;if(applyUrl){const a=new URL(applyUrl);if(a.protocol!=='https:'||a.origin!==company.origin||a.username||a.password)throw Error('INVALID_ROLE_APPLICATION_URL');}
    const identity=companyId+':'+roleId;if(identities.has(identity)||urls.has(u.href))throw Error('DUPLICATE_CONFIRMED_ROLE');identities.add(identity);urls.add(u.href);
    const status=r.applicationStatus||c.existing_data?.find(x=>x.values?.['岗位链接']===r.url)?.values?.['投递状态'];
    if(['已提交','submitted','receipt_verified'].includes(status)){protectedRoles.push({companyId,roleId,reason:'already_submitted'});continue;}
    if(!['待投递','not_submitted'].includes(status))throw Error('ROLE_APPLICATION_STATE_UNRESOLVED');
    if(['submission_uncertain','application_blocked','user_skipped'].includes(r.applicationOutcome?.event)){protectedRoles.push({companyId,roleId,reason:'outcome_requires_resolution'});continue;}
    tasks.push({taskId:randomUUID(),companyId,roleId,title:r.title,url:u.href,applyUrl,order:tasks.length+1,companyOrder:sequence?sequence.indexOf(c.companyId||c.company_key)+1:c.order||1,roleOrder:r.order});
   }
  }
  const upstreamMode=input.execution?.mode||'sequential';if(!['sequential','parallel_roles'].includes(upstreamMode))throw Error('INVALID_EXECUTION_MODE');
  if(upstreamMode==='parallel_roles'&&!input.execution?.authorizationRef)throw Error('PARALLEL_ROLE_AUTHORIZATION_REQUIRED');
  if(args.batchPolicy&&(!args.batchPolicy.authorizationRef||args.batchPolicy.mode!=='parallel_companies'))throw Error('COMPANY_BATCH_POLICY_REQUIRED');
  const executionMode=args.batchPolicy?'parallel_companies':upstreamMode;
  const queue={executionMode,parallelRoles:upstreamMode==='parallel_roles',batchPolicy:args.batchPolicy||null,id:randomUUID(),createdAt:new Date().toISOString(),inputKind:legacy?'confirmed-company-plan-v1':'confirmed-company-plan',batchId:input.batchId||input.batch_id,version:input.version||1,source,inputHash:digest(input),input,tasks,protectedRoles,submission:'forbidden'};
  queue.queueHash=digest(queue);await this.put(queue.id,queue);return this.public(queue);
 }
 public(q){return {queueId:q.id,queueHash:q.queueHash,inputKind:q.inputKind,executionMode:q.executionMode,parallelRoles:q.parallelRoles,tasks:q.tasks,protectedRoles:q.protectedRoles,browserAccess:false,submission:'forbidden'};}
 async get({queueId,queueHash}){const q=await this.read(queueId),{queueHash:h,...payload}=q;if(h!==queueHash||digest(payload)!==h)throw Error('ROLE_QUEUE_HASH_MISMATCH');if(q.source.kind==='file'&&await fileHash(q.source.file)!==q.source.hash)throw Error('ROLE_INPUT_CHANGED');return q;}
 async task(args){const q=await this.get(args),index=q.tasks.findIndex(t=>t.taskId===args.taskId);if(index<0)throw Error('ROLE_NOT_IN_CONFIRMED_QUEUE');const target=q.tasks[index];const predecessors=q.tasks.slice(0,index).filter(t=>q.executionMode==='parallel_companies'?t.companyId===target.companyId&&!q.parallelRoles:q.executionMode!=='parallel_roles'||t.companyId!==target.companyId);for(const t of predecessors){let state;try{state=await this.read(t.taskId);}catch(e){if(e.code!=='ENOENT')throw e;}if(state?.status!=='ready_for_user_review')throw Error('CONFIRMED_ROLE_ORDER_BLOCKED');}return {q,t:target};}
}
