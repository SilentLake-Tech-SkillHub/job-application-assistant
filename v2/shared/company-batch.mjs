import {randomUUID,createHash} from 'node:crypto';
import {acquireLease,leasePath,defaultLeaseRoot} from './leases.mjs';
import {resolveBatchChannels} from './channel-policy.mjs';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const active=new Set(['dispatched','running','waiting_for_user']);
// 批次运行记录只存任务引用（taskId、岗位编码）；链接、标题、材料一律经队列现读交接宽表，不复制保存。
// MCP acquires companies and splits channels. Dispatch is never browser success.
const remainingTasks=(company,live)=>company.tasks.map(task=>live.get(task.taskId)).filter(task=>task&&!task.protectedReason);
export class CompanyBatch{
 constructor({store,queues,catalog,browser,loginRecords=null,clock=()=>Date.now(),leaseRoot=defaultLeaseRoot()}){Object.assign(this,{store,queues,catalog,browser,loginRecords,clock,leaseRoot});}
 async assertCapabilities(channels){const report=await this.browser?.executionCapabilities?.();const missing=channels.filter(ch=>!report?.channels?.[ch]?.available);if(missing.length){const error=Error(missing.includes('iab')?'IAB_HOST_BRIDGE_REQUIRED':'CHROME_EXECUTOR_REQUIRED');error.details={phase:'browser_initialization',requestedChannels:channels,missingChannels:missing,browserExecuted:false};throw error;}return report;}
 async create(args){
  const release=await acquireLease(leasePath(this.leaseRoot,'company-dispatch:'+this.store.root),{waitMs:30000,busyCode:'COMPANY_BATCH_BUSY'});
  try{return await this.createUnlocked(args);}finally{await release();}
 }
 async createUnlocked({rolesFile,companyPlan,companyOrder,authorizationRef,companiesPerChannel=10,parallelRoles=false,browserChannels}){
  if(!authorizationRef?.trim())throw Error('BATCH_AUTHORIZATION_REQUIRED');
  if(!Number.isInteger(companiesPerChannel)||companiesPerChannel<1||companiesPerChannel>10)throw Error('INVALID_COMPANY_CHANNEL_CAPACITY');
  const {input}=await this.queues.inputAdapter({rolesFile,companyPlan,companyOrder});
  let index;try{index=await this.store.get('runs','company-batch-by-queue');}catch(e){if(e.code!=='ENOENT')throw e;index={};}
  let storedPolicy;try{storedPolicy=await this.store.get('runs','batch-browser-policy');}catch(e){if(e.code!=='ENOENT')throw e;}
  const requested=browserChannels||(storedPolicy?.batchId===input.batchId?storedPolicy.browserChannels||undefined:undefined);
  const initialization=await this.browser?.executionCapabilities?.(),channelSelection=resolveBatchChannels(initialization,requested),channels=channelSelection.channels;
  await this.store.put('runs','batch-browser-policy',{batchId:input.batchId,browserChannels:channelSelection.requestedChannels,authorizationRef:browserChannels?authorizationRef:storedPolicy?.authorizationRef||authorizationRef});
  const queue=await this.queues.import({rolesFile,companyPlan,companyOrder,batchPolicy:{mode:'parallel_companies',authorizationRef,companiesPerChannel,parallelRoles:!!parallelRoles}}),companies=[];
  // Reordering or changing browser preferences never recreates task records.
  if(queue.reused&&index[queue.queueId]){try{const existing=await this.store.get('runs',index[queue.queueId]);if(!existing.closedAt){
   if(existing.queueHash!==queue.queueHash){
    existing.queueHash=queue.queueHash;
    existing.companies.sort((a,b)=>queue.tasks.findIndex(t=>t.companyId===a.companyId)-queue.tasks.findIndex(t=>t.companyId===b.companyId));
    for(const c of existing.companies)c.tasks=queue.tasks.filter(t=>t.companyId===c.companyId).map(t=>({taskId:t.taskId,roleId:t.roleId}));
    existing.revision++;
   }
   existing.sourceBatchId=input.batchId;existing.companiesPerChannel=companiesPerChannel;
   await this.applyChannelSelection(existing,channelSelection);
   return {...await this.status({batchId:existing.id,batchHash:existing.batchHash}),batchHash:existing.batchHash,queue,reused:true,submission:'forbidden'};
  }}catch(e){if(e.code!=='ENOENT')throw e;}}
  // 新队列取代了旧队列：旧批次运行随之作废，释放它占着的公司登录范围，否则新批次领不到这些公司。
  if(queue.supersededQueues?.length){
   // 旧批次运行：索引里登记的，加上公司登录范围占用记录里指向的（索引上线前创建的运行不在索引里）。
   const owners=await this.owners(),gone=new Set(queue.supersededQueues),runIds=new Set(queue.supersededQueues.map(q=>index[q]).filter(Boolean));
   for(const o of Object.values(owners))if(o?.batchId)runIds.add(o.batchId);
   for(const runId of runIds){let run;try{run=await this.store.get('runs',runId);}catch(e){if(e.code!=='ENOENT'&&e.message!=='INVALID_STORAGE_KEY')throw e;continue;}
    if(!gone.has(run.queueId))continue;
    for(const [scope,o] of Object.entries(owners))if(o.batchId===run.id)delete owners[scope];
    const oldTaskIds=run.companies.flatMap(c=>c.tasks.map(t=>t.taskId));await this.store.clearTaskRecords?.(oldTaskIds);await this.loginRecords?.clear(oldTaskIds);await this.store.remove?.('runs','batch-prepare-'+run.queueId);await this.store.remove?.('runs',run.id);}
   for(const q of gone)delete index[q];
   await this.store.put('runs','company-channel-owners',owners);}
  for(const task of queue.tasks){let c=companies.find(x=>x.companyId===task.companyId);if(!c){const entry=this.catalog.find(x=>x.id===task.companyId);c={companyId:task.companyId,loginScope:entry.loginScope||entry.origin||entry.id,tasks:[],status:'pending',channel:null,allowedChannels:channels};companies.push(c);}c.tasks.push({taskId:task.taskId,roleId:task.roleId});}
  const body={schemaVersion:1,id:randomUUID(),queueId:queue.queueId,queueHash:queue.queueHash,authorizationRef,companiesPerChannel,parallelRoles:queue.parallelRoles,channels,sourceBatchId:input.batchId,channelSelection,initialization,companies,createdAt:new Date(this.clock()).toISOString(),submission:'forbidden'};
  const batchHash=digest(body);await this.store.put('runs',body.id,{...body,batchHash,revision:0});index[queue.queueId]=body.id;await this.store.put('runs','company-batch-by-queue',index);
  return {batchId:body.id,batchHash,queue,channelSelection,companies:companies.map(({tasks,...c})=>({...c,roleCount:tasks.length})),companiesPerChannel,parallelRoles:queue.parallelRoles,submission:'forbidden'};
 }
 async applyChannelSelection(b,selection){
  const owners=await this.owners();let bindings;try{bindings=await this.store.get('runs','browser-channel-bindings');}catch(e){if(e.code!=='ENOENT')throw e;bindings={};}
  for(const c of b.companies){
   c.allowedChannels=selection.channels;
   if(!c.channel||selection.channels.includes(c.channel)||!active.has(c.status))continue;
   const previousChannel=c.channel;
   for(const ref of c.tasks){let state;try{state=await this.queues.read(ref.taskId);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(state){const {pageId,applicationUrl,returnUrl,browserBinding,...rest}=state;await this.queues.put(ref.taskId,{...rest,status:'channel_changed_require_role_open',previousBrowserBinding:{channel:previousChannel,pageId,applicationUrl,returnUrl,browserBinding},channelChangeReason:selection.reason});}
   }
   if(owners[c.loginScope]?.batchId===b.id)delete owners[c.loginScope];
   for(const [origin,binding] of Object.entries(bindings))if(binding.batchId===b.id&&binding.companyId===c.companyId)delete bindings[origin];
   Object.assign(c,{previousChannel,channel:null,status:'pending',reason:selection.reason});delete c.leaseToken;delete c.leaseExpiresAt;
  }
  b.channels=selection.channels;b.channelSelection=selection;
  await this.store.put('runs','company-channel-owners',owners);await this.store.put('runs','browser-channel-bindings',bindings);await this.store.put('runs',b.id,b);
 }
 async get({batchId,batchHash}){const b=await this.store.get('runs',batchId);if(b.batchHash!==batchHash)throw Error('BATCH_HASH_MISMATCH');await this.queues.get({queueId:b.queueId,queueHash:b.queueHash});return b;}
 async locked(args,fn){const release=await acquireLease(leasePath(this.leaseRoot,'company-dispatch:'+this.store.root),{waitMs:30000,busyCode:'COMPANY_BATCH_BUSY'});try{return await fn(await this.get(args));}finally{await release();}}
 async owners(){try{return await this.store.get('runs','company-channel-owners');}catch(e){if(e.code!=='ENOENT')throw e;return {};}}
 async refreshMaterials(args){
  const release=await acquireLease(leasePath(this.leaseRoot,'company-dispatch:'+this.store.root),{waitMs:30000,busyCode:'COMPANY_BATCH_BUSY'});
  try{
   const b=await this.store.get('runs',args.batchId);if(b.batchHash!==args.batchHash)throw Error('BATCH_HASH_MISMATCH');
   const queue=await this.queues.refreshMaterials({queueId:b.queueId,queueHash:b.queueHash,authorizationRef:args.authorizationRef});
   const changed=new Set((queue.refreshedCompanies||[]).map(x=>x.companyCode));
   b.queueHash=queue.queueHash;for(const c of b.companies){const code=this.catalog.find(x=>x.id===c.companyId)?.companyId;if(c.status==='ready_for_user_review'||changed.has(code)&&c.status==='blocked'&&c.reason==='confirmed_input_changed')Object.assign(c,{status:'pending',reason:null});}
   b.revision++;await this.store.put('runs',b.id,b);
   return {batchId:b.id,batchHash:b.batchHash,queue,pagesPreserved:true,submission:'not_performed'};
  }finally{await release();}
 }
 async closePreparation(args){
  // An explicitly superseded preparation may need closure after its source
  // plan changes. Preserve normal freshness checks for status/take/resume;
  // closure only releases scheduling leases and does not touch pages or forms.
  const release=await acquireLease(leasePath(this.leaseRoot,'company-dispatch:'+this.store.root),{waitMs:30000,busyCode:'COMPANY_BATCH_BUSY'});
  try{
   const b=await this.store.get('runs',args.batchId);
   if(b.batchHash!==args.batchHash)throw Error('BATCH_HASH_MISMATCH');
   if(!args.authorizationRef?.trim()||!args.reason?.trim()||b.submission!=='forbidden')throw Error('PREPARATION_CLOSE_AUTHORIZATION_REQUIRED');
   const owners=await this.owners();
   for(const c of b.companies){if(owners[c.loginScope]?.batchId===b.id)delete owners[c.loginScope];if(c.status!=='ready_for_user_review')Object.assign(c,{previousStatus:c.status,status:'closed_preparation',reason:args.reason});}
   b.closedAt=new Date(this.clock()).toISOString();b.closeAuthorizationRef=args.authorizationRef;b.revision++;
   const taskIds=b.companies.flatMap(c=>c.tasks.map(t=>t.taskId));await this.store.clearTaskRecords?.(taskIds);await this.loginRecords?.clear(taskIds);
   let bindings;try{bindings=await this.store.get('runs','browser-channel-bindings');}catch(e){if(e.code!=='ENOENT')throw e;bindings={};}for(const [origin,binding] of Object.entries(bindings))if(binding.batchId===b.id)delete bindings[origin];await this.store.put('runs','browser-channel-bindings',bindings);
   for(const c of b.companies)for(const task of c.tasks){let state;try{state=await this.queues.read(task.taskId);}catch(e){if(e.code!=='ENOENT')throw e;}if(!state)continue;for(const key of ['fillRunId','verifyRunId','selectedFieldRunId','planId','planHash','verifiedAt'])delete state[key];state.status=state.pageId?'rebind_required':'pending';await this.queues.put(task.taskId,state);}
   await this.store.put('runs','company-channel-owners',owners);let index;try{index=await this.store.get('runs','company-batch-by-queue');}catch(e){if(e.code!=='ENOENT')throw e;index={};}delete index[b.queueId];await this.store.put('runs','company-batch-by-queue',index);await this.store.remove?.('runs','batch-prepare-'+b.queueId);await this.store.remove?.('runs',b.id);
   return {batchId:b.id,status:'closed_preparation',pagesClosed:false,browserRestarted:false,submission:'not_performed'};
  }finally{await release();}
 }
 async take(args){return this.locked(args,async b=>{
  const policy=await this.store.get('runs','batch-browser-policy');if(policy.batchId!==b.sourceBatchId)throw Error('BATCH_BROWSER_POLICY_CHANGED');
  await this.applyChannelSelection(b,resolveBatchChannels(await this.browser?.executionCapabilities?.(),policy.browserChannels));
  const now=this.clock();for(const c of b.companies)if(active.has(c.status)&&Date.parse(c.leaseExpiresAt)<=now){c.status='blocked';c.reason='lease_expired_requires_explicit_recovery';}
  const live=await this.queues.hydratedTasks(b.queueId);
  // 某家公司的交接内容在导入后变了：这一家先停下，等用户确认后 refresh 再继续；别家照常。
  for(const c of b.companies)if(c.status==='pending'&&c.tasks.some(t=>live.get(t.taskId)?.inputChanged))Object.assign(c,{status:'blocked',reason:'confirmed_input_changed'});
  const owners=await this.owners(),assignments=[];
  for(const c of b.companies){
   if(c.tasks.length&&remainingTasks(c,live).length===0){
    c.status='protected';
    c.reason='all_roles_protected';
    if(owners[c.loginScope]?.batchId===b.id&&!b.companies.some(other=>other.loginScope===c.loginScope&&remainingTasks(other,live).length&&active.has(other.status)))delete owners[c.loginScope];
   }
  }
  const counts=Object.fromEntries(b.channels.map(ch=>[ch,b.companies.filter(c=>c.channel===ch&&active.has(c.status)).length]));
  const affinity=new Map(b.companies.filter(c=>c.channel).map(c=>[c.loginScope,c.channel]));
  for(const c of b.companies.filter(c=>c.status==='pending')){
   if(owners[c.loginScope]&&owners[c.loginScope].batchId!==b.id)continue;
   if(b.companies.some(other=>other.loginScope===c.loginScope&&other.status==='blocked'))continue;
   const allowed=c.allowedChannels||b.channels,pinned=affinity.get(c.loginScope);if(pinned&&!allowed.includes(pinned))throw Error('LOGIN_SCOPE_CHANNEL_POLICY_CONFLICT');
   const channel=pinned||b.channels.filter(ch=>allowed.includes(ch)&&counts[ch]<b.companiesPerChannel).sort((a,z)=>counts[a]-counts[z])[0];if(!channel||counts[channel]>=b.companiesPerChannel)continue;
   Object.assign(c,{channel,status:'dispatched',leaseToken:randomUUID(),leaseExpiresAt:new Date(now+30*60*1000).toISOString()});counts[channel]++;affinity.set(c.loginScope,channel);
   owners[c.loginScope]={batchId:b.id,channel};
   assignments.push({companyId:c.companyId,channel,loginScope:c.loginScope,leaseToken:c.leaseToken,leaseExpiresAt:c.leaseExpiresAt,tasks:remainingTasks(c,live),queueId:b.queueId,queueHash:b.queueHash,firstAction:'open_confirmed_role_url',loginOncePerScope:true});
  }
  let bindings;try{bindings=await this.store.get('runs','browser-channel-bindings');}catch(e){if(e.code!=='ENOENT')throw e;bindings={};}
  for(const a of b.companies.filter(c=>c.channel))for(const ref of a.tasks){const t=live.get(ref.taskId);if(t&&!t.inputChanged&&!t.protectedReason)bindings[new URL(t.url).origin]={channel:a.channel,batchId:b.id,companyId:a.companyId};}
  b.revision++;await this.store.put('runs','company-channel-owners',owners);await this.store.put('runs','browser-channel-bindings',bindings);await this.store.put('runs',b.id,b);return {batchId:b.id,revision:b.revision,assignments,activeCompanies:counts,pendingCompanies:b.companies.filter(c=>c.status==='pending').length,browserExecuted:false,submission:'forbidden'};
 });}
 async resume(args){return this.locked(args,async b=>{
  const c=b.companies.find(c=>c.companyId===args.companyId);
  if(!c||c.channel!==args.channel||c.leaseToken!==args.leaseToken||!args.recoveryRef?.trim()||!['dispatched','running','waiting_for_user','blocked'].includes(c.status))throw Error('COMPANY_RECOVERY_EVIDENCE_REQUIRED');
  const owners=await this.owners();if(owners[c.loginScope]&&owners[c.loginScope].batchId!==b.id)throw Error('COMPANY_SCOPE_OWNED_BY_OTHER_BATCH');
  const oldStatus=c.status;Object.assign(c,{status:'dispatched',reason:null,leaseToken:randomUUID(),leaseExpiresAt:new Date(this.clock()+30*60*1000).toISOString(),recoveryRef:args.recoveryRef});
  owners[c.loginScope]={batchId:b.id,channel:c.channel};b.revision++;await this.store.put('runs','company-channel-owners',owners);await this.store.put('runs',b.id,b);
  return {companyId:c.companyId,channel:c.channel,leaseToken:c.leaseToken,leaseExpiresAt:c.leaseExpiresAt,previousStatus:oldStatus,browserExecuted:false,loginRepeated:false,submission:'not_performed'};
 });}
 async record(args){return this.locked(args,async b=>{
  const c=b.companies.find(c=>c.companyId===args.companyId);if(!c||!active.has(c.status)||c.leaseToken!==args.leaseToken||c.channel!==args.channel||Date.parse(c.leaseExpiresAt)<=this.clock())throw Error('COMPANY_BATCH_LEASE_MISMATCH');
  if(!['running','waiting_for_user','ready_for_user_review','blocked'].includes(args.status))throw Error('INVALID_COMPANY_BATCH_STATUS');
  if(args.status==='ready_for_user_review'){
   if(!Array.isArray(args.runIds)||!args.runIds.length)throw Error('APPLICATION_RUN_EVIDENCE_REQUIRED');const runs=await Promise.all(args.runIds.map(id=>this.store.get('runs',id)));
   const live=await this.queues.hydratedTasks(b.queueId);
   for(const task of remainingTasks(c,live)){if(task.inputChanged)throw Error('ROLE_INPUT_CHANGED');let state;try{state=await this.queues.read(task.taskId);}catch{}
    if(state?.status!=='ready_for_user_review'||!state.verifyRunId)throw Error('FULL_ROLE_VERIFICATION_REQUIRED');
    const expected=state.applicationUrl||state.returnUrl||task.applyUrl||task.url,verify=await this.store.get('runs',state.verifyRunId);
    if(verify.operation!=='verify_current'||verify.companyId!==c.companyId||verify.pageUrl!==expected||verify.status!=='verified'||!verify.checks?.length||!verify.checks.every(check=>['match','confirmed_omission'].includes(check.status))||!runs.some(run=>run.id===state.verifyRunId||run.id===state.fillRunId))throw Error('FULL_ROLE_VERIFICATION_REQUIRED');
    if(task.materials&&(!verify.materialCoverage?.enabled||!verify.materialCoverage.complete||verify.materialCoverage.materialsHash!==digest(task.materials)))throw Error('ROLE_MATERIAL_VERIFICATION_REQUIRED');
   }
  }
  if(args.status==='waiting_for_user'){
   let userWait=false;for(const task of c.tasks){let state;try{state=await this.queues.read(task.taskId);}catch{}
    if(state?.status==='needs_login'&&state.loginPlan)userWait=true;
    if(state?.verifyRunId){const run=await this.store.get('runs',state.verifyRunId),pending=(run.checks||[]).filter(check=>!['match','confirmed_omission'].includes(check.status));if(run.companyId===c.companyId&&pending.length&&pending.every(check=>['needs_user','missing_input'].includes(check.status)))userWait=true;}
   }if(!userWait)throw Error('USER_WAIT_EVIDENCE_REQUIRED');
  }
  if(args.status==='blocked'){
   const receipts=await Promise.all((args.runIds||[]).map(id=>this.store.get('runs',id)));
   if(!receipts.some(receipt=>receipt.status==='blocked_for_supervisor'&&receipt.continuation?.handoffVerified===true&&(!receipt.companyId||receipt.companyId===c.companyId)))throw Error('VERIFIED_BLOCK_HANDOFF_REQUIRED');
  }
  if(args.status==='blocked'&&!args.reason?.trim())throw Error('BLOCK_REASON_REQUIRED');Object.assign(c,{status:args.status,reason:args.reason||null,runIds:args.runIds||[],updatedAt:new Date(this.clock()).toISOString(),leaseExpiresAt:new Date(this.clock()+30*60*1000).toISOString()});b.revision++;await this.store.put('runs',b.id,b);if(c.status==='ready_for_user_review'&&!b.companies.some(x=>x.loginScope===c.loginScope&&active.has(x.status))){const owners=await this.owners();delete owners[c.loginScope];await this.store.put('runs','company-channel-owners',owners);}const remainingAgentWork=b.companies.filter(company=>['pending','dispatched','running'].includes(company.status)).length;return {companyId:c.companyId,channel:c.channel,status:c.status,remainingAgentWork,batchPreparationComplete:b.companies.every(company=>company.status==='ready_for_user_review'),continuation:remainingAgentWork?{state:'prepare',owner:'agent',requiresUser:false,shouldContinue:true,nextTools:['company_batch_take','workflow_advance']}:c.status==='blocked'?{state:'technical_block',owner:'supervisor',requiresUser:false,shouldContinue:false,handoffVerified:true,nextTools:[]}:{state:c.status==='waiting_for_user'?'user_input':'review',owner:'user',requiresUser:true,shouldContinue:false,nextTools:[]},submission:'not_performed'};
 });}
 async status(args){
  const b=await this.get(args),live=await this.queues.hydratedTasks(b.queueId);
  const companies=b.companies.map(({leaseToken,tasks,...company})=>{
   const protectedRoles=tasks.flatMap(task=>{
    const reason=live.get(task.taskId)?.protectedReason;
    return reason?[{roleId:task.roleId,reason}]:[];
   });
   const roleCount=remainingTasks({tasks},live).length;
   if(tasks.length&&protectedRoles.length===tasks.length&&company.status!=='closed_preparation'){
    company.status='protected';
    company.reason='all_roles_protected';
   }
   return {...company,roleCount,protectedRoles};
  });
  return {batchId:b.id,revision:b.revision,companiesPerChannel:b.companiesPerChannel,channels:b.channels,channelSelection:b.channelSelection,companies,submission:'not_performed'};
 }
}
