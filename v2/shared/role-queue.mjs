import {readFile,writeFile,mkdir,rename,unlink,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {acquireLease,leasePath,defaultLeaseRoot} from './leases.mjs';
import {assertHandoffUnchanged,readHandoffCompanies,roleView,combinedSha} from './company-directory.mjs';
export const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// 任务编号固定：同一批次的同一岗位永远是同一个 taskId，重新导入时页面绑定按它延续。
export const stableTaskId=(batchId,roleId)=>{const h=createHash('sha256').update(String(batchId)+'|'+String(roleId)).digest('hex');return [h.slice(0,8),h.slice(8,12),'5'+h.slice(13,16),'8'+h.slice(17,20),h.slice(20,32)].join('-');};
const isQueue=v=>v&&Array.isArray(v.tasks)&&typeof v.batchId==='string';
// 队列只接受用户正向评审确认后的各公司宽表（inputAdapter = queue-config.mjs handoffInput）；旧的“公司方案”文件或对象输入已删除。
export class RoleQueue{
 constructor({root,catalog,inputAdapter}){if(typeof inputAdapter!=='function')throw Error('HANDOFF_INPUT_ADAPTER_REQUIRED');Object.assign(this,{root,catalog,inputAdapter});}
 file(id){if(!/^[a-z0-9-]{1,90}$/.test(id))throw Error('INVALID_ROLE_QUEUE_KEY');return path.join(this.root,id+'.json');}
 async put(id,value){await mkdir(this.root,{recursive:true,mode:0o700});const file=this.file(id),tmp=file+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(value,null,2),{mode:0o600});await rename(tmp,file);return value;}
 async read(id){return JSON.parse(await readFile(this.file(id),'utf8'));}
 async import(args){
  const release=await acquireLease(leasePath(defaultLeaseRoot(),'queue-import:'+path.resolve(this.root)),{waitMs:30000,busyCode:'ROLE_QUEUE_BUSY'});
  try{return await this.importUnlocked(args);}finally{await release();}
 }
 async importUnlocked(args){
  const {input,source}=await this.inputAdapter(args);let tasks=[],protectedRoles=[];
  if(source?.kind!=='handoff'||input.schemaVersion!==1||!Array.isArray(input.companies)||!input.batchId)throw Error('HANDOFF_BATCH_REQUIRED');
  if(input.confirmation?.status!=='confirmed'||!input.confirmation.reference)throw Error('COMPANY_PLAN_CONFIRMATION_REQUIRED');
  const selected=input.companies.filter(c=>Array.isArray(c.roles)&&c.roles.some(r=>r.selected===true));
  if(!selected.length)throw Error('NO_CONFIRMED_ROLES');
  // 公司次序默认取正向评审的公司顺序；companyOrder（公司编码）只能重排本批全部公司。
  const sequence=args.companyOrder||null;
  if(sequence&&(sequence.length!==selected.length||new Set(sequence).size!==sequence.length||selected.some(c=>!sequence.includes(c.companyId))))throw Error('INVALID_CONFIRMED_COMPANY_ORDER');
  selected.sort((a,b)=>sequence?sequence.indexOf(a.companyId)-sequence.indexOf(b.companyId):a.order-b.order);
  const identities=new Set();
  for(const c of selected){
   const roles=c.roles.filter(r=>r.selected===true),orders=new Set();
   for(const r of roles){if(!Number.isInteger(r.order)||r.order<1||orders.has(r.order))throw Error('INVALID_CONFIRMED_ROLE_ORDER');orders.add(r.order);}
   for(const r of roles.sort((a,b)=>a.order-b.order)){
    // 任务按公司编码归属；站点编码仅保留来源值，链接不进入队列。
    const company=this.catalog.find(x=>x.companyId===c.companyId),site=(company?.sites||[company]).find(x=>x?.siteId===r.siteId),u=new URL(r.url);
    if(!r.roleId||!r.title||!site||u.protocol!=='https:'||u.origin!==site.origin||u.username||u.password||/\/(?:login|sign[-_]?in)\/?$/.test(u.pathname))throw Error('INVALID_CONFIRMED_ROLE_URL');
    if(r.applyUrl){const a=new URL(r.applyUrl);if(a.protocol!=='https:'||a.origin!==site.origin||a.username||a.password)throw Error('INVALID_ROLE_APPLICATION_URL');}
    if(identities.has(r.roleId))throw Error('DUPLICATE_CONFIRMED_ROLE');identities.add(r.roleId);
    const companyId=company.id,roleId=r.roleId,status=r.applicationStatus;
    if(status==='岗位已投递'){protectedRoles.push({companyId,roleId,reason:'already_submitted'});continue;}
    if(status==='岗位失效/关闭'){protectedRoles.push({companyId,roleId,reason:'role_closed'});continue;}
    if(status!=='岗位待投递')throw Error('ROLE_APPLICATION_STATE_UNRESOLVED');
    if(['submission_uncertain','application_blocked','user_skipped'].includes(r.applicationOutcome?.event)){protectedRoles.push({companyId,roleId,reason:'outcome_requires_resolution'});continue;}
    // 任务只存编码与顺序；链接、标题、材料执行时现读该公司宽表（见 hydrate）。
    tasks.push({taskId:stableTaskId(input.batchId,roleId),companyId,siteId:r.siteId,companyCode:c.companyId,roleId,order:tasks.length+1,companyOrder:sequence?sequence.indexOf(c.companyId)+1:c.order,roleOrder:r.order});
   }
  }
  const upstreamMode=args.parallelRoles?'parallel_roles':'sequential';
  const parallelAuth=args.authorizationRef||args.batchPolicy?.authorizationRef;
  if(upstreamMode==='parallel_roles'&&!parallelAuth)throw Error('PARALLEL_ROLE_AUTHORIZATION_REQUIRED');
  if(args.batchPolicy&&(!args.batchPolicy.authorizationRef||args.batchPolicy.mode!=='parallel_companies'))throw Error('COMPANY_BATCH_POLICY_REQUIRED');
  const executionMode=args.batchPolicy?'parallel_companies':upstreamMode;
  const parallelRoles=upstreamMode==='parallel_roles'||Boolean(args.batchPolicy?.parallelRoles);
  const inputHash=digest(input),shape=q=>digest({executionMode:q.executionMode,parallelRoles:q.parallelRoles,companiesPerChannel:q.batchPolicy?.companiesPerChannel||null,tasks:q.tasks.map(t=>[t.taskId,t.companyId]).sort((a,b)=>a[0].localeCompare(b[0]))});
  // 按创建时间从旧到新处理：同一岗位在多个旧队列里都有绑定时，最新的那条生效。
  const previous=(await this.queues()).filter(q=>q.batchId===input.batchId).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt)));
  // 同一批次、确认内容和执行方式都没变：返回原队列，不新建（重复导入不产生新任务、新标签）。
  const same=previous.find(q=>q.inputHash===inputHash&&shape(q)===shape({executionMode,parallelRoles,batchPolicy:args.batchPolicy||null,tasks}));
  if(same){
   const reordered=!!sequence&&digest(same.tasks)!==digest(tasks);
   if(reordered){
    if(!String(args.authorizationRef||args.batchPolicy?.authorizationRef||'').trim())throw Error('QUEUE_REORDER_AUTHORIZATION_REQUIRED');
    same.tasks=tasks;same.orderAuthorization=args.authorizationRef||args.batchPolicy.authorizationRef;
    delete same.queueHash;same.queueHash=digest(same);await this.put(same.id,same);
   }
   return {...await this.public(same),reused:true,reordered};
  }
  const queue={executionMode,parallelRoles,batchPolicy:args.batchPolicy||null,id:randomUUID(),createdAt:new Date().toISOString(),inputKind:'confirmed-handoff-batch',batchId:input.batchId,version:input.version||1,source,inputHash,tasks,protectedRoles,submission:'forbidden'};
  queue.queueHash=digest(queue);await this.put(queue.id,queue);
  const carried=await this.supersede(previous,queue);
  return {...await this.public(queue),...(previous.length?{supersededQueues:previous.map(q=>q.id),carriedPageBindings:carried}:{})};
 }
 // 同一批次的新队列取代旧队列：旧队列与旧任务记录删除（记录唯一）；同一岗位已绑定的标签延续到新任务，
 // 新任务状态为 rebind_required，role_open 先核对这张标签再继续，不另开页面。
 async supersede(previous,queue){
  const byRole=new Map(queue.tasks.map(t=>[t.roleId,t]));let carried=0;
  for(const old of previous){
   for(const t of old.tasks){
    let state;try{state=await this.read(t.taskId);}catch(e){if(e.code!=='ENOENT')throw e;}
    const next=byRole.get(t.roleId);
    const carry=state&&next&&state.queueId!==queue.id&&(state.pageId||state.failedApplyUrl);
    if(!carry||t.taskId!==next.taskId)await unlink(this.file(t.taskId)).catch(e=>{if(e.code!=='ENOENT')throw e;});
    if(carry){await this.put(next.taskId,{queueId:queue.id,taskId:next.taskId,status:'rebind_required',...(state.pageId?{pageId:state.pageId}:{}),...(state.failedApplyUrl?{failedApplyUrl:state.failedApplyUrl}:{}),...(state.siteRoleId?{siteRoleId:state.siteRoleId}:{}),carriedFrom:{queueId:old.id,status:state.status||null,hadFill:!!(state.fillRunId||state.selectedFieldRunId),at:new Date().toISOString()}});carried++;}
   }
   if(old.id!==queue.id)await unlink(this.file(old.id)).catch(e=>{if(e.code!=='ENOENT')throw e;});
  }
  return carried;
 }
 async entries(){let names=[];try{names=await readdir(this.root);}catch(e){if(e.code!=='ENOENT')throw e;}const out=[];for(const n of names){if(!/^[a-z0-9-]{1,90}\.json$/.test(n))continue;try{out.push(JSON.parse(await readFile(path.join(this.root,n),'utf8')));}catch{}}return out;}
 async queues(){return (await this.entries()).filter(isQueue);}
 // 所有任务记录里已绑定的标签（pageId → taskId），用于“这张标签是不是别的任务的”。
 async boundPages(){const out=new Map();for(const s of await this.entries())if(!isQueue(s)&&typeof s.pageId==='string'&&s.taskId)out.set(s.pageId,s.taskId);return out;}
 // 交接任务的链接、标题、材料：核对该公司宽表仍是导入时确认的那一版后现读；别家变了不影响这一家。
 async hydrate(q,task){
  await assertHandoffUnchanged(q.source,task.companyCode);
  const doc=JSON.parse(await readFile(q.source.files[task.companyCode].file,'utf8'));
  const r=(doc['岗位']||[]).find(x=>x['岗位编码']===task.roleId);
  if(!r||r['站点编码']!==task.siteId)throw Error('ROLE_INPUT_CHANGED');
  const v=roleView(r,0);
  return {...task,title:v.title,url:v.url,applyUrl:v.applyUrl||null,officialId:v.officialId,materials:v.materials};
 }
 async hydrateAll(q){const out=[];for(const t of q.tasks){try{out.push(await this.hydrate(q,t));}catch(e){if(e.message!=='ROLE_INPUT_CHANGED')throw e;out.push({...t,inputChanged:true});}}return out;}
 async hydratedTasks(queueId){const q=await this.read(queueId);return new Map((await this.hydrateAll(q)).map(t=>[t.taskId,t]));}
 async public(q){return {queueId:q.id,queueHash:q.queueHash,inputKind:q.inputKind,executionMode:q.executionMode,parallelRoles:q.parallelRoles,tasks:await this.hydrateAll(q),protectedRoles:q.protectedRoles,browserAccess:false,submission:'forbidden'};}
 // 某家公司在导入后经用户确认补了材料或改了链接（确认作用域 materials_only / links_only，且由导入时那一版直接改来、选岗不变）：
 // 只换这一家的确认版本并重置这一家任务的核验状态；链接变了的任务回到重新打开岗位。其它公司不受影响。
 async refreshMaterials({queueId,queueHash,authorizationRef}){
  if(!authorizationRef?.trim())throw Error('MATERIAL_AMENDMENT_AUTHORIZATION_REQUIRED');
  const q=await this.read(queueId),{queueHash:h,...payload}=q;
  if(h!==queueHash||digest(payload)!==h)throw Error('ROLE_QUEUE_HASH_MISMATCH');
  const {batchId,files}=await readHandoffCompanies({handoffDir:path.dirname(path.dirname(Object.values(q.source.files)[0].file))});
  if(batchId!==q.source.batchId)throw Error('CONFIRMED_MATERIAL_AMENDMENT_REQUIRED');
  const refreshed=[];
  for(const [code,recorded] of Object.entries(q.source.files)){
   const f=files.find(x=>x.code===code);if(!f)throw Error('CONFIRMED_MATERIAL_AMENDMENT_REQUIRED');
   const c=f.doc['批次']['确认'];if(c.contentSha256===recorded.contentSha256)continue;
   if(!['materials_only','links_only'].includes(c.scope)||c.previousContentSha256!==recorded.contentSha256)throw Error('CONFIRMED_MATERIAL_AMENDMENT_REQUIRED');
   if(JSON.stringify(f.doc['批次']['选中岗位'])!==JSON.stringify(recorded.selection))throw Error('MATERIAL_AMENDMENT_CHANGED_SELECTION');
   q.source.files[code]={...recorded,contentSha256:c.contentSha256,scope:c.scope,previousContentSha256:c.previousContentSha256};
   for(const task of q.tasks.filter(t=>t.companyCode===code)){
    let state;try{state=await this.read(task.taskId);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(!state)continue;
    if(c.scope==='links_only'){
     const now=await this.hydrate(q,task);
     // 岗位链接换成了本任务打开时已经跳转到的那一页（跳转后编号变了、经用户确认）：同一张标签、同一份进度，原样保留。
     if(state.landedDetailUrl&&now.url===state.landedDetailUrl){const old=state.originalRoleUrl;state.originalRoleUrl=now.url;if(state.returnUrl===old)state.returnUrl=now.url;await this.put(task.taskId,state);}
     // 其他链接变化：填写与核验作废、从打开岗位重新开始，但已绑定的标签延续（不另开）。
     else if(state.pageId)await this.put(task.taskId,{queueId:q.id,taskId:task.taskId,pageId:state.pageId,status:'rebind_required',carriedFrom:{queueId:q.id,status:state.status||null,hadFill:!!(state.fillRunId||state.selectedFieldRunId),reason:'links_changed',at:new Date().toISOString()}});
     else await unlink(this.file(task.taskId));
    }
    else{delete state.verifyRunId;delete state.verifiedAt;delete state.planId;delete state.planHash;
     if(state.status==='ready_for_user_review')state.status='ready_to_fill';
     state.materialVerificationRequired=true;await this.put(task.taskId,state);}
   }
   refreshed.push({companyCode:code,scope:c.scope});
  }
  q.source.contentSha256=combinedSha(q.source.files);
  q.materialAmendmentAuthorization=authorizationRef;q.refreshedCompanies=refreshed;
  delete q.queueHash;q.queueHash=digest(q);await this.put(q.id,q);return {...await this.public(q),refreshedCompanies:refreshed};
 }
 async get({queueId,queueHash}){const q=await this.read(queueId),{queueHash:h,...payload}=q;if(h!==queueHash||digest(payload)!==h)throw Error('ROLE_QUEUE_HASH_MISMATCH');return q;}
 async task(args){const q=await this.get(args),index=q.tasks.findIndex(t=>t.taskId===args.taskId);if(index<0)throw Error('ROLE_NOT_IN_CONFIRMED_QUEUE');const target=q.tasks[index];const predecessors=q.tasks.slice(0,index).filter(t=>q.executionMode==='parallel_companies'?t.companyId===target.companyId&&!q.parallelRoles:q.executionMode!=='parallel_roles'||t.companyId!==target.companyId);for(const t of predecessors){let state;try{state=await this.read(t.taskId);}catch(e){if(e.code!=='ENOENT')throw e;}if(state?.status!=='ready_for_user_review')throw Error('CONFIRMED_ROLE_ORDER_BLOCKED');}return {q,t:await this.hydrate(q,target)};}
}
