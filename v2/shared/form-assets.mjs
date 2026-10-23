import {assertStoredChoiceResolutions} from './choice-resolution.mjs';
// 公司表单资产：申请页链接写回公司文件夹、记录“已投递”前核对表单模板与核验记录、按批次汇报资产缺口。
// 申请页链接存 岗位交接/公司/<地区>/<公司>/公司.json 的 roles[].投递链接（按官方岗位ID），下批直接从申请页进入；
// 表单模板存投递组件私有目录 templates（按公司/岗位绑定）。
import {readFile,writeFile,rename,readdir,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {hash} from './engine.mjs';
import {assertSealContract} from './form-seal.mjs';

async function writeJson(file,value){const tmp=file+'.'+randomUUID()+'.tmp';try{await writeFile(tmp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(tmp,file);}finally{await unlink(tmp).catch(()=>{});}}

// 进入申请页成功后调用：只写同站点、与岗位页不同的申请页；按官方岗位ID唯一匹配，覆盖写。
export async function recordApplicationUrl({directory,entryId,roleId,roleUrl,applicationUrl}){
 const entry=directory.entry(entryId),file=path.join(entry.dir,'公司.json');
 const apply=new URL(applicationUrl),role=new URL(roleUrl);
 if(apply.origin!==role.origin)return {status:'skipped_cross_origin'};
 if(apply.href===role.href)return {status:'skipped_same_as_role_url'};
 const doc=JSON.parse(await readFile(file,'utf8')),hits=(doc.roles||[]).filter(r=>String(r['岗位ID'])===String(roleId));
 if(hits.length!==1)return {status:'skipped_role_not_unique'};
 if(hits[0]['投递链接']===apply.href)return {status:'unchanged'};
 hits[0]['投递链接']=apply.href;await writeJson(file,doc);
 return {status:'recorded',file};
}

function boundTemplateId(catalog,companyId,roleId){
 const c=catalog.find(x=>x.id===companyId);return c?.roleTemplates?.[roleId]||c?.templateId||null;
}
const sealed=t=>{try{return !!(t?.coverage?.allConditionalBranchesVerified&&t.coverage.allControlsMapped&&t.coverage.allDriversSupported&&assertSealContract(t));}catch{return false;}};
async function storedSeal(store,template,companyId){if(!sealed(template))return false;try{assertSealContract(template,await store.get('runs',template.coverage.proof.runId),companyId);await assertStoredChoiceResolutions(template,{store,companyId});return true;}catch{return false;}}

// 记录“已投递”前：本岗位必须在本批队列里由 MCP 按已封存的公司表单模板填写，并有通过的独立核验记录。
// 手工在浏览器里填完提交的岗位，没有这条记录，拒绝记录为已投递。
export async function assertSubmissionPrepared({queues,store,catalog,outcome}){
 if(outcome.event!=='submission_confirmed')return null;
 if(!queues)throw Error('PRIVATE_PROFILE_REQUIRED');
 const sameCompany=id=>id===outcome.companyId||catalog.find(c=>c.id===id)?.companyId===outcome.companyId;
 let files=[];try{files=(await readdir(queues.root)).filter(f=>f.endsWith('.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
 const tasks=[];
 for(const f of files){let q;try{q=JSON.parse(await readFile(path.join(queues.root,f),'utf8'));}catch{continue;}
  if(!Array.isArray(q.tasks)||q.batchId!==outcome.batchId)continue;
  for(const t of q.tasks)if(String(t.roleId)===String(outcome.roleId)&&sameCompany(t.companyId))tasks.push(t);}
 if(!tasks.length)throw Error('SUBMISSION_ROLE_NOT_IN_MCP_QUEUE');
 for(const t of tasks){
  let state;try{state=await queues.read(t.taskId);}catch(e){if(e.code==='ENOENT')continue;throw e;}
  if(state.status!=='ready_for_user_review'||!state.verifyRunId)continue;
  let run;try{run=await store.get('runs',state.verifyRunId);}catch{continue;}
  if(run.operation!=='verify_current'||run.status!=='verified')continue;
  if(t.materials&&(!run.materialCoverage?.enabled||!run.materialCoverage.complete||run.materialCoverage.materialsHash!==hash(t.materials)))throw Error('ROLE_MATERIAL_VERIFICATION_REQUIRED');
  const templateId=boundTemplateId(catalog,t.companyId,t.roleId);if(!templateId)throw Error('SUBMISSION_COMPANY_TEMPLATE_MISSING');
  const template=await store.get('templates',templateId);
  if(!await storedSeal(store,template,t.companyId))throw Error('SUBMISSION_COMPANY_TEMPLATE_NOT_SEALED');
  if(hash(template)!==run.templateHash)throw Error('SUBMISSION_TEMPLATE_CHANGED_AFTER_VERIFY');
  return {taskId:t.taskId,verifyRunId:run.id,templateId};
 }
 throw Error('SUBMISSION_REQUIRES_VERIFIED_TEMPLATE_FILL');
}

// 只读：读取当前投递批次文件（含等待正向评审的批次），没有批次返回 null。
export async function readBatchFile(handoffDir){
 try{return JSON.parse(await readFile(path.join(handoffDir,'投递批次.json'),'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}
}

// 只读：按投递批次（或指定公司）列出每家公司的登录配置、表单模板（是否封存）和各岗位申请页链接是否齐全。
export async function formAssetStatus({directory,catalog,store,batch,companyIds}){
 const wanted=companyIds?.length?new Set(companyIds):new Set((batch?.companies||[]).map(c=>c.companyId));
 const rows=[];
 for(const id of wanted){
  const entries=catalog.filter(c=>c.companyId===id||c.id===id);
  if(!entries.length){rows.push({companyId:id,status:'unknown_company'});continue;}
  const doc=JSON.parse(await readFile(path.join(entries[0].dir,'公司.json'),'utf8'));
  const batchRoles=(batch?.companies||[]).find(c=>c.companyId===id)?.['岗位']||null;
  const roleIds=new Set((batchRoles||doc.roles||[]).map(r=>String(r['岗位ID'])));
  const roles=(doc.roles||[]).filter(r=>roleIds.has(String(r['岗位ID']))).map(r=>({roleId:r['岗位ID'],applicationUrl:r['投递链接']||null}));
  const sites=[];
  for(const e of entries){const required=roles.length?roles.filter(role=>!role.applicationUrl||new URL(role.applicationUrl).origin===e.origin).map(role=>({roleId:String(role.roleId),templateId:e.roleTemplates?.[String(role.roleId)]||e.templateId||null})):[{roleId:null,templateId:e.templateId||null}],assets=[];
   for(const requiredRole of required){let template=null;try{if(requiredRole.templateId)template=await store.get('templates',requiredRole.templateId);}catch{}
    assets.push({...requiredRole,status:template?(await storedSeal(store,template,e.id)?'sealed':'unsealed'):'missing'});}
   sites.push({siteId:e.id,origin:e.origin,login:!!e.loginFile,template:!assets.length?'not_applicable':assets.every(a=>a.status==='sealed')?'sealed':assets.some(a=>a.status==='unsealed')?'unsealed':'missing',roleTemplates:Object.keys(e.roleTemplates||{}).length,roleAssets:assets});}
  const gaps=[];
  if(!sites.some(s=>s.login))gaps.push('登录配置');
  const allRolesSealed=roles.length?roles.every(role=>sites.some(site=>site.roleAssets.some(asset=>asset.roleId===String(role.roleId)&&asset.status==='sealed'))):sites.some(s=>s.template==='sealed');
  if(!allRolesSealed)gaps.push(sites.some(s=>s.template==='unsealed')?'表单模板未封存':'表单模板');
  const noUrl=roles.filter(r=>!r.applicationUrl).length;if(noUrl)gaps.push(`申请页链接（${noUrl}/${roles.length} 个岗位缺）`);
  rows.push({companyId:id,name:doc['公司'],status:gaps.length?'incomplete':'ready',gaps,sites,roles});
 }
 return {companies:rows.length,ready:rows.filter(r=>r.status==='ready').length,incomplete:rows.filter(r=>r.status!=='ready').map(r=>({companyId:r.companyId,name:r.name,gaps:r.gaps||[r.status]})),detail:rows};
}
