import {randomUUID,createHash} from 'node:crypto';
import {acquireLease,leasePath,defaultLeaseRoot} from './leases.mjs';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const active=new Set(['dispatched','running','waiting_for_user']);
// MCP acquires companies and splits channels. Dispatch is never browser success.
export class CompanyBatch{
 constructor({store,queues,catalog,clock=()=>Date.now(),leaseRoot=defaultLeaseRoot()}){Object.assign(this,{store,queues,catalog,clock,leaseRoot});}
 async create({rolesFile,companyPlan,companyOrder,authorizationRef,companiesPerChannel=10,parallelRoles=false}){
  if(!authorizationRef?.trim())throw Error('BATCH_AUTHORIZATION_REQUIRED');
  if(!Number.isInteger(companiesPerChannel)||companiesPerChannel<1||companiesPerChannel>10)throw Error('INVALID_COMPANY_CHANNEL_CAPACITY');
  const queue=await this.queues.import({rolesFile,companyPlan,companyOrder,batchPolicy:{mode:'parallel_companies',authorizationRef,companiesPerChannel,channels:['chrome','iab'],parallelRoles:!!parallelRoles}}),companies=[];
  for(const task of queue.tasks){let c=companies.find(x=>x.companyId===task.companyId);if(!c){const entry=this.catalog.find(x=>x.id===task.companyId);c={companyId:task.companyId,loginScope:entry.loginScope||entry.origin,tasks:[],status:'pending',channel:null};companies.push(c);}c.tasks.push(task);}
  const body={schemaVersion:1,id:randomUUID(),queueId:queue.queueId,queueHash:queue.queueHash,authorizationRef,companiesPerChannel,parallelRoles:queue.parallelRoles,channels:['chrome','iab'],companies,createdAt:new Date(this.clock()).toISOString(),submission:'forbidden'};
  const batchHash=digest(body);await this.store.put('runs',body.id,{...body,batchHash,revision:0});
  return {batchId:body.id,batchHash,queue,companies:companies.map(({tasks,...c})=>({...c,roleCount:tasks.length})),companiesPerChannel,parallelRoles:queue.parallelRoles,submission:'forbidden'};
 }
 async get({batchId,batchHash}){const b=await this.store.get('runs',batchId);if(b.batchHash!==batchHash)throw Error('BATCH_HASH_MISMATCH');await this.queues.get({queueId:b.queueId,queueHash:b.queueHash});return b;}
 async locked(args,fn){const release=await acquireLease(leasePath(this.leaseRoot,'company-dispatch:'+this.store.root),{waitMs:30000,busyCode:'COMPANY_BATCH_BUSY'});try{return await fn(await this.get(args));}finally{await release();}}
 async owners(){try{return await this.store.get('runs','company-channel-owners');}catch(e){if(e.code!=='ENOENT')throw e;return {};}}
 async restrictChannels(args){return this.locked(args,async b=>{
  const channels=args.channels;if(!args.authorizationRef?.trim()||!Array.isArray(channels)||!channels.length||new Set(channels).size!==channels.length||channels.some(ch=>!b.channels.includes(ch)))throw Error('INVALID_CHANNEL_RESTRICTION');
  if(b.closedAt)throw Error('BATCH_ALREADY_CLOSED');
  const counts=Object.fromEntries(channels.map(ch=>[ch,b.companies.filter(c=>c.channel===ch&&active.has(c.status)).length])),owners=await this.owners();
  let bindings;try{bindings=await this.store.get('runs','browser-channel-bindings');}catch(e){if(e.code!=='ENOENT')throw e;bindings={};}
  const moved=[];
  for(const c of b.companies.filter(c=>c.channel&&!channels.includes(c.channel))){
   const channel=channels.find(ch=>counts[ch]<b.companiesPerChannel);if(!channel)throw Error('CHANNEL_RESTRICTION_CAPACITY_EXCEEDED');
   const previousChannel=c.channel;
   for(const t of c.tasks){let state;try{state=await this.queues.read(t.taskId);}catch(e){if(e.code!=='ENOENT')throw e;}
    if(state){const {pageId,applicationUrl,returnUrl,...rest}=state;await this.queues.put(t.taskId,{...rest,status:'channel_changed_require_role_open',returnUrl:t.url,previousBrowserBinding:{channel:previousChannel,pageId,applicationUrl,returnUrl},channelChangeAuthorization:args.authorizationRef});}
    bindings[new URL(t.url).origin]={channel,batchId:b.id,companyId:c.companyId};
   }
   Object.assign(c,{previousChannel,channel,status:'dispatched',leaseToken:randomUUID(),leaseExpiresAt:new Date(this.clock()+30*60*1000).toISOString(),reason:'user_restricted_browser_channels'});counts[channel]++;owners[c.loginScope]={batchId:b.id,channel};moved.push({companyId:c.companyId,previousChannel,channel,leaseToken:c.leaseToken});
  }
  b.channels=channels;b.channelRestriction={authorizationRef:args.authorizationRef,at:new Date(this.clock()).toISOString()};b.revision++;
  await this.store.put('runs','browser-channel-bindings',bindings);await this.store.put('runs','company-channel-owners',owners);await this.store.put('runs',b.id,b);
  return {batchId:b.id,channels,moved,browsersClosed:false,browserRestarted:false,submission:'not_performed'};
 });}
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
   await this.store.put('runs','company-channel-owners',owners);await this.store.put('runs',b.id,b);
   return {batchId:b.id,status:'closed_preparation',pagesClosed:false,browserRestarted:false,submission:'not_performed'};
  }finally{await release();}
 }
 async take(args){return this.locked(args,async b=>{
  const now=this.clock();for(const c of b.companies)if(active.has(c.status)&&Date.parse(c.leaseExpiresAt)<=now){c.status='blocked';c.reason='lease_expired_requires_explicit_recovery';}
  const owners=await this.owners(),assignments=[],counts=Object.fromEntries(b.channels.map(ch=>[ch,b.companies.filter(c=>c.channel===ch&&active.has(c.status)).length]));
  const affinity=new Map(b.companies.filter(c=>c.channel).map(c=>[c.loginScope,c.channel]));
  for(const c of b.companies.filter(c=>c.status==='pending')){
   if(owners[c.loginScope]&&owners[c.loginScope].batchId!==b.id)continue;
   if(b.companies.some(other=>other.loginScope===c.loginScope&&other.status==='blocked'))continue;
   const channel=affinity.get(c.loginScope)||b.channels.filter(ch=>counts[ch]<b.companiesPerChannel).sort((a,z)=>counts[a]-counts[z])[0];if(!channel||counts[channel]>=b.companiesPerChannel)continue;
   Object.assign(c,{channel,status:'dispatched',leaseToken:randomUUID(),leaseExpiresAt:new Date(now+30*60*1000).toISOString()});counts[channel]++;affinity.set(c.loginScope,channel);
   owners[c.loginScope]={batchId:b.id,channel};
   assignments.push({companyId:c.companyId,channel,loginScope:c.loginScope,leaseToken:c.leaseToken,leaseExpiresAt:c.leaseExpiresAt,tasks:c.tasks,queueId:b.queueId,queueHash:b.queueHash,firstAction:'open_confirmed_role_url',loginOncePerScope:true});
  }
  let bindings;try{bindings=await this.store.get('runs','browser-channel-bindings');}catch(e){if(e.code!=='ENOENT')throw e;bindings={};}
  for(const a of b.companies.filter(c=>c.channel))for(const t of a.tasks)bindings[new URL(t.url).origin]={channel:a.channel,batchId:b.id,companyId:a.companyId};
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
   for(const task of c.tasks)if(!runs.flatMap(r=>r.results||[]).some(r=>r.companyId===c.companyId&&r.pageUrl===(task.applyUrl||task.url)&&r.status==='verified'&&r.pageChecks?.length&&r.pageChecks.every(p=>p.verification?.status==='verified')))throw Error('FULL_ROLE_VERIFICATION_REQUIRED');
  }
  if(args.status==='blocked'&&!args.reason?.trim())throw Error('BLOCK_REASON_REQUIRED');Object.assign(c,{status:args.status,reason:args.reason||null,runIds:args.runIds||[],updatedAt:new Date(this.clock()).toISOString(),leaseExpiresAt:new Date(this.clock()+30*60*1000).toISOString()});b.revision++;await this.store.put('runs',b.id,b);if(c.status==='ready_for_user_review'&&!b.companies.some(x=>x.loginScope===c.loginScope&&active.has(x.status))){const owners=await this.owners();delete owners[c.loginScope];await this.store.put('runs','company-channel-owners',owners);}return {companyId:c.companyId,channel:c.channel,status:c.status,submission:'not_performed'};
 });}
 async status(args){const b=await this.get(args);return {batchId:b.id,revision:b.revision,companiesPerChannel:b.companiesPerChannel,channels:b.channels,companies:b.companies.map(({leaseToken,tasks,...c})=>({...c,roleCount:tasks.length})),submission:'not_performed'};}
}
