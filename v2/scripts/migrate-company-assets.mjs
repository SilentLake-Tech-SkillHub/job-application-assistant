#!/usr/bin/env node
// One-time company-identity migration. Preview is read-only. Delete this script
// and its dedicated tests after deployment and final acceptance.
import {readFile,readdir,mkdir,writeFile,rename,unlink,open} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {updateProfile} from '../shared/profile.mjs';
import {acquireLease,leasePath,defaultLeaseRoot} from '../shared/leases.mjs';
import {readCompanyFiles} from '../shared/company-directory.mjs';
import {validateFormIdentities} from '../shared/form-identity.mjs';
import {wasBuilt,sealedContractHash,unsealedTemplate} from '../shared/form-seal.mjs';
import {acquisitionContractHash,captureContentHash} from '../shared/acquisition-chain.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const bytesHash=value=>createHash('sha256').update(value).digest('hex');
const identityFields=new Set(['companyId','companyCode','formId','templateId']);
const referenceFields=new Set(['id','captureId','structureId','choicesId','draftId','runId','probeRunId','sourceRunId','baselineCaptureId','targetCaptureId','reboundFrom']);
const preserve=new Set(['facts','sources','entities','rawEvidence','nativeStructure','scriptInventory','controls','actions','read','control','enumMap','policy','policies','applicationSelections','files']);
const prefixes=['capture-','form-structure-','choices-','acquisition-','form-draft-','definition-','seal-','sealed-probe-','draft-probe-'];
const json=async file=>JSON.parse(await readFile(file,'utf8'));
const optional=async file=>{try{return await json(file);}catch(e){if(e.code==='ENOENT')return null;throw e;}};

export function identityTransform(value,{identities,assets},key=''){
 if(preserve.has(key))return structuredClone(value);
 if(typeof value==='string'){
  if(identityFields.has(key))return identities.get(value)||value;
  if(referenceFields.has(key))return assets.get(value)||identities.get(value)||value;
  return value;
 }
 if(Array.isArray(value))return value.map(v=>identityTransform(v,{identities,assets}));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,identityTransform(v,{identities,assets},k)]));
 return value;
}
function rewriteHashes(value,hashes,key=''){
 if(preserve.has(key))return value;
 if(typeof value==='string')return /(?:Hash|hash|sha256)$/.test(key)?hashes.get(value)||value:value;
 if(Array.isArray(value))return value.map(v=>rewriteHashes(v,hashes));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,rewriteHashes(v,hashes,k)]));
 return value;
}
function collectHashes(before,after,hashes,key=''){
 if(preserve.has(key)||!before||typeof before!=='object'||!after||typeof after!=='object')return;
 hashes.set(digest(before),digest(after));
 if(before.pages&&before.evidence){
  hashes.set(acquisitionContractHash(before),acquisitionContractHash(after));
  hashes.set(sealedContractHash(before),sealedContractHash(after));
  hashes.set(digest(unsealedTemplate(before)),digest(unsealedTemplate(after)));
 }
 if(before.companyId&&before.pageUrl&&Array.isArray(before.controls))hashes.set(captureContentHash(before),captureContentHash(after));
 for(const [k,v]of Object.entries(before))if(Object.hasOwn(after,k))collectHashes(v,after[k],hashes,k);
}
export function mergeCompanyForms(profile,bound,identities,assets){
 const groups=new Map();
 for(const [id,form]of Object.entries(profile.companyForms||{})){
  if(!/^(?:F\d{6}|C\d{5})$/.test(id))throw Error('MIGRATION_UNSUPPORTED_FORM_KEY:'+id);
  const code=form.companyCode||identities.get(form.companyId);
  if(!/^C\d{5}$/.test(code||''))throw Error('MIGRATION_COMPANY_OWNER_MISSING:'+id);
  if(!groups.has(code))groups.set(code,[]);groups.get(code).push([id,form]);
 }
 const result=identityTransform(profile,{identities,assets}),primary=new Map();result.companyForms={};delete result.formCodeSequence;
 if(profile.applicationDispositions){
  result.applicationDispositions={};
  for(const [key,value]of Object.entries(profile.applicationDispositions)){
   const code=identities.get(key)||key,next=identityTransform(value,{identities,assets});
   if(result.applicationDispositions[code]){
    const old=result.applicationDispositions[code];
    for(const [recordId,record]of Object.entries(next.roleMaterials||{})){
     if(old.roleMaterials?.[recordId]&&digest(old.roleMaterials[recordId])!==digest(record))throw Error('MIGRATION_MATERIAL_DECISION_CONFLICT:'+code);
    }
    result.applicationDispositions[code]={...old,...next,roleMaterials:{...old.roleMaterials,...next.roleMaterials}};
   }else result.applicationDispositions[code]=next;
  }
 }
 for(const [code,rows]of groups){
  const candidates=bound.has(code)?rows.filter(([id])=>id===bound.get(code)):rows.filter(([,f])=>f.executionContract);
  if(candidates.length>1||!candidates.length&&rows.length>1)throw Error('MIGRATION_FORM_OWNER_AMBIGUOUS:'+code);
  const selected=candidates[0]||rows[0],base=identityTransform(selected[1],{identities,assets});primary.set(code,selected[0]);
  const observational=new Set(['formId','companyId','companyCode','siteId','pageUrl','observedAt','inventoryHash','mappings','executionContract','draftExecutionContract']);
  for(const [id,f]of rows)if(id!==selected[0])for(const [key,value]of Object.entries(f)){
   if(observational.has(key))continue;
   const converted=identityTransform(value,{identities,assets},key);
   if(base[key]===undefined)base[key]=converted;
   else if(digest(base[key])!==digest(converted))throw Error('MIGRATION_FORM_PROPERTY_CONFLICT:'+code+':'+key);
  }
  const mappings={};
  for(const [id,f]of rows)if(id!==selected[0])for(const [key,m]of Object.entries(f.mappings||{}))mappings[key]={...identityTransform(m,{identities,assets}),active:false,coverageRequired:false};
  Object.assign(mappings,base.mappings||{});
  result.companyForms[code]={...base,formId:code,companyId:code,companyCode:code,mappings};
 }
 if(profile.loginForms){
  result.loginForms={};
  for(const [key,value]of Object.entries(profile.loginForms)){
   const code=identities.get(key)||identities.get(value.companyId)||key,next=identityTransform(value,{identities,assets});
   if(!result.loginForms[code]||String(next.observedAt||'')>=String(result.loginForms[code].observedAt||''))result.loginForms[code]=next;
  }
 }
 validateFormIdentities(result);
 for(const key of ['facts','sources','entities'])if(digest(result[key])!==digest(profile[key]))throw Error('MIGRATION_CHANGED_PERSONAL_DATA:'+key);
 return {profile:result,primary};
}

async function planConfigurationOwners(root,companies){
 const base=path.join(root,'岗位交接/公司'),updates=[];
 for(const region of await readdir(base,{withFileTypes:true}))if(region.isDirectory()){
  for(const firm of await readdir(path.join(base,region.name),{withFileTypes:true}))if(firm.isDirectory()){
   for(const name of await readdir(path.join(base,region.name,firm.name))){
    if(!/^(?:登录|表单定义)(?:@[^/]+)?\.json$/.test(name))continue;
    const file=path.join(base,region.name,firm.name,name),raw=await readFile(file),before=JSON.parse(raw);
    const origin=before.origin&&new URL(before.origin).origin;
    const owners=companies.filter(({code,doc})=>(/^C\d{5}$/.test(before.companyId||'')?code===before.companyId:doc['公司名称']===firm.name)&&(doc['站点']||[]).some(s=>new URL(s['站点']).origin===origin));
    if(owners.length!==1)throw Error('MIGRATION_CONFIG_OWNER_NOT_UNIQUE:'+path.relative(base,file));
    const after={...before,companyId:owners[0].code};
    if(digest(after)!==digest(before))updates.push({file,before,after,originalSha256:bytesHash(raw)});
   }
  }
 }
 return updates;
}
export async function previewCompanyMigration(workspace,{baselineSource=null}={}){
 const root=path.resolve(workspace),privateDir=path.join(root,'.runtime/application'),profileFile=path.join(root,'产品管理/网申个人信息主档.json');
 const profile=await json(profileFile),companies=await readCompanyFiles(path.join(root,'岗位交接')),identities=new Map(),assets=new Map(),bound=new Map();
 const configurationUpdates=await planConfigurationOwners(root,companies);
 for(const {code,doc}of companies)for(const site of doc['站点']||[])identities.set(site['站点编码'],code);
 const aliases=await optional(path.join(privateDir,'templates/site-asset-keys.json'))||{};
 for(const [site,alias]of Object.entries(aliases))if(identities.has(site))identities.set(alias,identities.get(site));
 for(const [id,f]of Object.entries(profile.companyForms||{})){identities.set(id,f.companyCode);for(const prefix of prefixes)assets.set(prefix+id,prefix+f.companyCode);}
 for(const [name,isRole]of [['company-bindings',false],['role-bindings',true]]){
  const bindings=await optional(path.join(privateDir,'templates',name+'.json'))||{};
  for(const [site,value]of Object.entries(bindings))for(const formId of isRole?Object.values(value):[value]){
   const code=identities.get(site)||site;if(bound.has(code)&&bound.get(code)!==formId)throw Error('MIGRATION_MULTIPLE_BOUND_TEMPLATES:'+code);bound.set(code,formId);
  }
 }
 for(const [code,id]of bound){
  const template=await optional(path.join(privateDir,'templates',id+'.json')),proof=template?.coverage?.proof?.runId;
  if(proof&&/^[A-Za-z0-9_-]+$/.test(proof)&&await optional(path.join(privateDir,'runs',proof+'.json')))assets.set(proof,'sealed-probe-'+code);
 }
 const merged=mergeCompanyForms(profile,bound,identities,assets),items=[],seen=new Set();
 const add=async(relative,target=relative)=>{
  if(!/^(?:runs|templates)\/[A-Za-z0-9_-]+\.json$/.test(relative)||!/^(?:runs|templates)\/[A-Za-z0-9_-]+\.json$/.test(target))throw Error('MIGRATION_ASSET_PATH_INVALID');
  if(seen.has(relative))return;const file=path.join(privateDir,relative);let bytes;try{bytes=await readFile(file);}catch(e){if(e.code==='ENOENT')return;throw e;}
  const before=JSON.parse(bytes),after=identityTransform(before,{identities,assets});seen.add(relative);items.push({relative,target,before,initial:after,after,originalSha256:bytesHash(bytes)});
 };
 for(const [code,id]of merged.primary){
  await add('templates/'+id+'.json','templates/'+code+'.json');
  await add('templates/'+id+'-conditions.json','templates/'+code+'-conditions.json');
  for(const prefix of prefixes)await add('runs/'+prefix+id+'.json','runs/'+prefix+code+'.json');
 }
 for(const item of [...items]){
  const proof=item.before.coverage?.proof?.runId;if(proof)await add('runs/'+proof+'.json','runs/'+(assets.get(proof)||proof)+'.json');
 }
 let hashes=new Map(),finalProfile=merged.profile,previous=null,rounds=0;
 for(;rounds<16;rounds++){
  for(const item of items)item.after=rewriteHashes(item.initial,hashes);
  finalProfile=rewriteHashes(merged.profile,hashes);
  const next=new Map(hashes);
  for(const item of items){
   collectHashes(item.before,item.after,next);
   next.set(item.originalSha256,bytesHash(JSON.stringify(item.after,null,2)));
  }
  const signature=digest([items.map(i=>digest(i.after)),digest(finalProfile)]);
  hashes=next;if(signature===previous)break;previous=signature;
 }
 if(rounds===16)throw Error('MIGRATION_HASH_REFERENCES_DID_NOT_CONVERGE');
 const templates=items.filter(i=>/^templates\/F\d{6}\.json$/.test(i.relative));
 const states=templates.map(i=>({companyId:i.after.id,before:wasBuilt(i.before),after:wasBuilt(i.after),oldKey:i.before.id,newKey:i.after.id}));
 if(states.some(s=>s.before!==s.after))throw Error('MIGRATION_CHANGED_COMPANY_AVAILABILITY');
 const queueDir=path.join(root,'.runtime/role-queue'),queues=[],statesWithPlan=[];
 for(const name of (await readdir(queueDir)).filter(n=>n.endsWith('.json'))){const q=await json(path.join(queueDir,name));if(q.tasks)queues.push({id:q.id,roles:q.tasks.map(t=>t.roleId),companies:q.tasks.map(t=>identities.get(t.companyId)||t.companyId)});else if(q.planId||q.status==='ready_for_user_review'||q.loginPlan&&['waiting_user_otp','needs_user_verification'].includes(q.status))statesWithPlan.push(name);}
 const compilation=await compareCompilation({root,privateDir,profile,convertedProfile:finalProfile,items,bound,companies,identities,baselineSource});
 const assetStatusComparison=await compareAssetStatus({root,privateDir,profile,convertedProfile:finalProfile,items,bound,baselineSource,configurationUpdates});
 return {report:{mode:'preview_only',profileFormsBefore:Object.keys(profile.companyForms||{}).length,profileFormsAfter:Object.keys(finalProfile.companyForms).length,companyAssets:states,filesToMigrate:items.length,configurationOwnersToUpdate:configurationUpdates.length,hashRounds:rounds+1,personalFactsPreserved:digest(profile.facts)===digest(finalProfile.facts),sourceEvidencePreserved:digest(profile.sources)===digest(finalProfile.sources),queues,activePlanStates:statesWithPlan,compilation,assetStatusComparison,applied:false},profile:finalProfile,originalProfile:profile,items,identities,assets,hashes,configurationUpdates};
}
async function compareAssetStatus({root,privateDir,profile,convertedProfile,items,bound,baselineSource,configurationUpdates=[]}){
 const beforeRoot=baselineSource||path.join(root,'.agents/skills/job-application-assistant-v2');
 const load=file=>import(pathToFileURL(path.join(beforeRoot,'shared',file+'.mjs')).href);
 const beforeDirectory=await load('company-directory'),beforeAssets=await load('form-assets'),beforeEngine=await load('engine');
 const {CompanyDirectory}=await import('../shared/company-directory.mjs'),{formAssetStatus}=await import('../shared/form-assets.mjs');
 const handoffDir=path.join(root,'岗位交接'),oldStore=new beforeEngine.Store(privateDir),oldCatalog=await new beforeDirectory.CompanyDirectory({handoffDir}).load();
 const defaults=await optional(path.join(privateDir,'templates/company-bindings.json'))||{},roles=await optional(path.join(privateDir,'templates/role-bindings.json'))||{};
 for(const c of oldCatalog){c.templateId=defaults[c.id]||null;c.roleTemplates=roles[c.id]||{};}
 const configs=new Map(configurationUpdates.map(c=>[c.file,c.after]));
 const catalog=await new CompanyDirectory({handoffDir,readAsset:async file=>configs.get(file)||json(file)}).load();
 for(const c of catalog)c.templateId=items.some(i=>i.target==='templates/'+c.id+'.json')?c.id:null;
 const memory={get:async(group,id)=>{const item=items.find(i=>i.target===group+'/'+id+'.json');return item?item.after:oldStore.get(group,id);}};
 const ids=[...bound.keys()];
 const a=await beforeAssets.formAssetStatus({handoffDir,catalog:oldCatalog,store:oldStore,companyIds:ids,profile});
 const b=await formAssetStatus({handoffDir,catalog,store:memory,companyIds:ids,profile:convertedProfile});
 const rows=[];
 for(const c of a.detail)for(const site of c.sites||[])for(const asset of site.roleAssets||[]){
  if(!asset.templateId)continue;
  const after=b.detail.find(x=>x.companyId===c.companyId)?.sites?.find(x=>x.siteId===site.siteId)?.roleAssets?.find(x=>x.roleId===asset.roleId);
  rows.push({companyId:c.companyId,roleId:asset.roleId,beforeStatus:asset.status,afterStatus:after?.status||'missing',beforeReason:asset.reasonCode||asset.reason,afterReason:after?.reasonCode||after?.reason,unchanged:asset.status===after?.status&&asset.reason===after?.reason});
 }
 return rows;
}
async function compareCompilation({root,privateDir,profile,convertedProfile,items,bound,companies,identities,baselineSource}){
 const beforeRoot=baselineSource||path.join(root,'.agents/skills/job-application-assistant-v2');
 const load=(source,file)=>import(pathToFileURL(path.join(source,'shared',file+'.mjs')).href);
 const before={profile:await load(beforeRoot,'profile'),repeat:await load(beforeRoot,'repeat-groups'),material:await load(beforeRoot,'material-disposition'),compiler:await load(beforeRoot,'execution-plan')};
 const after={profile:await import('../shared/profile.mjs'),repeat:await import('../shared/repeat-groups.mjs'),material:await import('../shared/material-disposition.mjs'),compiler:await import('../shared/execution-plan.mjs')};
 const rows=[];
 for(const {code,doc}of companies){
  if(!bound.has(code))continue;
  const item=items.find(i=>i.target==='templates/'+code+'.json');if(!item||!wasBuilt(item.before))continue;
  for(const role of (doc['岗位']||[]).filter(r=>(doc['批次']?.['选中岗位']||[]).includes(r['岗位编码']))){
   const run=async(api,personal,template,companyId)=>{
    const recordPlan=api.repeat.recordPlanOf(personal),context=api.material.withMaterialDispositions(personal,{batchId:doc['批次']['批次编号'],contentSha256:'migration-audit',companyId,roleId:role['岗位编码'],officialId:role['官方岗位ID'],roleUrl:role['岗位链接'],materials:role['材料']});
    const resolved=api.profile.resolveProfile(personal,api.repeat.withProfileRecords(template,recordPlan),{},companyId,context);
    const plan=await api.compiler.compileExecutionPlan(template,{...resolved,recordPlan,companyId,roleId:role['岗位编码'],pageUrl:role['投递链接']||template.evidence.sourceUrl,templateHash:digest(template)});
    return {counts:plan.counts,blockers:plan.constructionBlockers};
   };
   let a,b;
   try{a=await run(before,profile,item.before,role['站点编码']);}catch(e){a={error:e.message};}
   try{b=await run(after,convertedProfile,item.after,code);}catch(e){b={error:e.message};}
   rows.push({companyId:code,roleId:role['岗位编码'],before:a,after:b,unchanged:digest(a)===digest(b)});
  }
 }
 return rows;
}
async function atomicBytes(file,bytes){
 await mkdir(path.dirname(file),{recursive:true,mode:0o700});const temporary=file+'.'+randomUUID()+'.tmp';let handle;
 try{handle=await open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;await rename(temporary,file);}
 finally{if(handle)await handle.close();await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
const encoded=value=>Buffer.from(JSON.stringify(value,null,2));
export async function applyCompanyMigration(workspace,options={}){
 const root=path.resolve(workspace),release=await acquireLease(leasePath(defaultLeaseRoot(),'company-identity-migration:'+root),{waitMs:30000,busyCode:'COMPANY_MIGRATION_BUSY'});
 try{return await applyCompanyMigrationUnlocked(root,options);}finally{await release();}
}
async function applyCompanyMigrationUnlocked(workspace,{journalDir,baselineSource=null}={}){
 const root=path.resolve(workspace);
 if(!journalDir||path.resolve(journalDir)===root||path.resolve(journalDir).startsWith(root+path.sep))throw Error('EXTERNAL_MIGRATION_JOURNAL_REQUIRED');
 const scope=await optional(path.join(root,'.codex/hooks/scope.json'));
 const active=record=>{const value=record?.expiresAt,expiry=typeof value==='number'?(value<1e12?value*1000:value):Date.parse(value);return !Number.isFinite(expiry)||expiry>Date.now();};
 if((scope?.session_ids||[]).some(id=>active(scope?.sessions?.[id]))||Object.values(scope?.sessions||{}).some(active))throw Error('MIGRATION_REQUIRES_PAUSED_EXECUTION');
 const preview=await previewCompanyMigration(root,{baselineSource});
 if(preview.report.activePlanStates.length)throw Error('MIGRATION_ACTIVE_FROZEN_PLAN_REQUIRES_HANDLING');
 if(preview.report.compilation.some(c=>!c.unchanged))throw Error('MIGRATION_COMPILATION_CHANGED');
 if(preview.report.assetStatusComparison.some(c=>!c.unchanged))throw Error('MIGRATION_ASSET_STATUS_CHANGED');
 const privateDir=path.join(root,'.runtime/application'),profileFile=path.join(root,'产品管理/网申个人信息主档.json'),journalFile=path.join(path.resolve(journalDir),'transaction.json');
 if(await optional(journalFile))throw Error('MIGRATION_JOURNAL_ALREADY_EXISTS');
 const writes=[],byFile=new Map(),queueHashes=new Map(preview.hashes),queueDir=path.join(root,'.runtime/role-queue');
 const stage=async(file,value,{expectedSource=null,newTarget=false}={})=>{
  const bytes=encoded(value);let before=null;try{before=await readFile(file);}catch(e){if(e.code!=='ENOENT')throw e;}
  if(newTarget&&before&&!before.equals(bytes))throw Error('MIGRATION_TARGET_ALREADY_EXISTS:'+path.basename(file));
  if(expectedSource&&(!before||bytesHash(before)!==expectedSource))throw Error('MIGRATION_SOURCE_CHANGED:'+path.basename(file));
  if(before?.equals(bytes))return;
  if(byFile.has(file)){if(!byFile.get(file).after.equals(bytes))throw Error('MIGRATION_TARGET_COLLISION:'+path.basename(file));return;}
  const item={file,before,after:bytes};writes.push(item);byFile.set(file,item);
 };
 for(const item of preview.items){
  const original=await readFile(path.join(privateDir,item.relative));
  if(bytesHash(original)!==item.originalSha256)throw Error('MIGRATION_SOURCE_CHANGED:'+item.relative);
  await stage(path.join(privateDir,item.target),item.after,{newTarget:item.relative!==item.target,expectedSource:item.relative===item.target?item.originalSha256:null});
 }
 const queueRecords=[];
 for(const name of (await readdir(queueDir)).filter(n=>n.endsWith('.json'))){const file=path.join(queueDir,name),before=await json(file);let after=identityTransform(before,preview);
  if(before.tasks){const {queueHash,...body}=before;if(digest(body)!==queueHash)throw Error('MIGRATION_QUEUE_HASH_INVALID');delete after.queueHash;after.queueHash=digest(after);queueHashes.set(queueHash,after.queueHash);}
  queueRecords.push({file,before,after});
 }
 for(const item of queueRecords)await stage(item.file,rewriteHashes(item.after,queueHashes));
 const taskIds=queueRecords.filter(q=>q.before.tasks).flatMap(q=>q.before.tasks.map(t=>t.taskId));
 for(const base of [privateDir,path.join(root,'.runtime/login')]){
  for(const id of taskIds){const file=path.join(base,'runs','task-'+id+'.json'),value=await optional(file);if(value)await stage(file,rewriteHashes(identityTransform(value,preview),queueHashes));}
 }
 for(const name of ['browser-channel-bindings','company-channel-owners']){const file=path.join(privateDir,'runs',name+'.json'),value=await optional(file);if(value)await stage(file,rewriteHashes(identityTransform(value,preview),queueHashes));}
 const index=await optional(path.join(privateDir,'runs/company-batch-by-queue.json'))||{};
 for(const q of queueRecords.filter(q=>q.before.tasks))if(index[q.before.id]){const file=path.join(privateDir,'runs',index[q.before.id]+'.json'),value=await optional(file);if(value)await stage(file,rewriteHashes(identityTransform(value,preview),queueHashes));}
 for(const config of preview.configurationUpdates)await stage(config.file,config.after,{expectedSource:config.originalSha256});
 const originalProfileBytes=await readFile(profileFile);
 if(digest(JSON.parse(originalProfileBytes))!==digest(preview.originalProfile))throw Error('MIGRATION_PROFILE_CHANGED');
 const journal={schemaVersion:1,status:'prepared',workspace:root,report:preview.report,profileBefore:originalProfileBytes.toString('base64'),profileAfterHash:digest(preview.profile),files:writes.map(w=>({file:w.file,before:w.before?.toString('base64')??null,afterSha256:bytesHash(w.after)}))};
 await atomicBytes(journalFile,encoded(journal));let profileWritten=false;const completed=[];
 try{
  for(const w of writes){
   let current=null;try{current=await readFile(w.file);}catch(e){if(e.code!=='ENOENT')throw e;}
   if(w.before?!current||!current.equals(w.before):current!==null)throw Error('MIGRATION_TARGET_CHANGED:'+path.basename(w.file));
   await atomicBytes(w.file,w.after);completed.push(w);
  }
  await updateProfile(profileFile,current=>{
   if(digest(current)!==digest(preview.originalProfile))throw Error('MIGRATION_PROFILE_CHANGED');
   for(const key of Object.keys(current))delete current[key];Object.assign(current,preview.profile);
  });profileWritten=true;
  for(const w of writes)if(bytesHash(await readFile(w.file))!==bytesHash(w.after))throw Error('MIGRATION_FILE_READBACK_FAILED');
  const saved=await json(profileFile);validateFormIdentities(saved);
  if(digest(saved)!==digest(preview.profile))throw Error('MIGRATION_PROFILE_READBACK_FAILED');
  journal.status='applied_pending_final_acceptance';await atomicBytes(journalFile,encoded(journal));
  return {...preview.report,mode:'applied',applied:true,filesWritten:writes.length,oldAssetsDeleted:false,journalFile,personalFactsPreserved:digest(saved.facts)===digest(preview.originalProfile.facts)};
 }catch(error){
  try{
   if(profileWritten)await updateProfile(profileFile,current=>{if(digest(current)!==digest(preview.profile))throw Error('MIGRATION_ROLLBACK_PROFILE_CHANGED');for(const key of Object.keys(current))delete current[key];Object.assign(current,preview.originalProfile);});
   for(const w of completed.reverse()){
    const current=await readFile(w.file);if(!current.equals(w.after))throw Error('MIGRATION_ROLLBACK_TARGET_CHANGED:'+path.basename(w.file));
    if(w.before)await atomicBytes(w.file,w.before);else await unlink(w.file);
   }
   journal.status='rolled_back';
  }catch(rollback){journal.status='needs_recovery';journal.rollbackError=rollback.message;}
  journal.error=error.message;await atomicBytes(journalFile,encoded(journal));throw error;
 }
}
export async function rollbackCompanyMigration(workspace,options={}){
 const root=path.resolve(workspace),release=await acquireLease(leasePath(defaultLeaseRoot(),'company-identity-migration:'+root),{waitMs:30000,busyCode:'COMPANY_MIGRATION_BUSY'});
 try{return await rollbackCompanyMigrationUnlocked(root,options);}finally{await release();}
}
async function rollbackCompanyMigrationUnlocked(workspace,{journalDir}={}){
 const root=path.resolve(workspace),file=path.join(path.resolve(journalDir||''),'transaction.json');
 const journal=await json(file);if(journal.workspace!==root||!['prepared','applied_pending_final_acceptance','needs_recovery'].includes(journal.status))throw Error('MIGRATION_ROLLBACK_NOT_APPLICABLE');
 const profileFile=path.join(root,'产品管理/网申个人信息主档.json'),original=JSON.parse(Buffer.from(journal.profileBefore,'base64')),currentProfile=await json(profileFile);
 const beforeHash=digest(original),currentHash=digest(currentProfile);
 if(currentHash!==journal.profileAfterHash&&currentHash!==beforeHash)throw Error('MIGRATION_ROLLBACK_PROFILE_CHANGED');
 const restore=[];
 for(const item of journal.files){
  let current=null;try{current=await readFile(item.file);}catch(e){if(e.code!=='ENOENT')throw e;}
  const before=item.before===null?null:Buffer.from(item.before,'base64');
  if(current===null&&before===null||current&&before&&current.equals(before))continue;
  if(!current||bytesHash(current)!==item.afterSha256)throw Error('MIGRATION_ROLLBACK_TARGET_CHANGED:'+path.basename(item.file));
  restore.push({...item,before});
 }
 if(currentHash!==beforeHash)await updateProfile(profileFile,current=>{if(digest(current)!==journal.profileAfterHash)throw Error('MIGRATION_ROLLBACK_PROFILE_CHANGED');for(const key of Object.keys(current))delete current[key];Object.assign(current,original);});
 for(const item of restore.reverse()){if(item.before===null)await unlink(item.file);else await atomicBytes(item.file,item.before);}
 journal.status='rolled_back';await atomicBytes(file,encoded(journal));return {rolledBack:true,files:restore.length};
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const args=process.argv.slice(2),flag=name=>{const i=args.indexOf('--'+name);return i<0?null:args[i+1];},workspace=flag('workspace');
 if(!workspace)throw Error('--workspace <workspace> required');
 const result=args.includes('--rollback')?await rollbackCompanyMigration(workspace,{journalDir:flag('journal-dir')}):args.includes('--apply')?await applyCompanyMigration(workspace,{journalDir:flag('journal-dir')}):(await previewCompanyMigration(workspace)).report;
 console.log(JSON.stringify(result,null,2));
}
