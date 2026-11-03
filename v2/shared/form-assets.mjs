import {storedSeal} from './seal-state.mjs';
import {contractRebuildRequired} from './rebuild-mark.mjs';
import {assertStoredChoiceResolutions} from './choice-resolution.mjs';
import {assertAcquisitionChain} from './acquisition-chain.mjs';
// 公司表单资产：记录“已投递”前核对表单模板与核验记录、按批次汇报资产缺口（按站点编码）。
// 投递链接不在这里写：第一次进入申请页的地址由 role-flow 记为观察（投递回传.json），用户确认后写主表。
// 表单模板存投递组件私有目录 templates（按站点编码/岗位编码绑定）。
import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {hash} from './engine.mjs';
import {assertSealContract} from './form-seal.mjs';
import {readCompanyFiles} from './company-directory.mjs';

function boundTemplateId(catalog,companyId,roleId){
 const c=catalog.find(x=>x.id===companyId);return c?.roleTemplates?.[roleId]||c?.templateId||null;
}
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
  // 交接队列的材料、链接现读公司宽表：核对该公司文件仍是导入时确认的那一版。
  if(typeof queues.hydratedTasks!=='function')throw Error('CURRENT_MATERIAL_QUEUE_REQUIRED');
  const list=[...(await queues.hydratedTasks(q.id)).values()];
  for(const t of list)if(String(t.roleId)===String(outcome.roleId)&&sameCompany(t.companyId)){if(t.inputChanged)throw Error('ROLE_INPUT_CHANGED');tasks.push(t);}}
 if(!tasks.length)throw Error('SUBMISSION_ROLE_NOT_IN_MCP_QUEUE');
 for(const t of tasks){
  let state;try{state=await queues.read(t.taskId);}catch(e){if(e.code==='ENOENT')continue;throw e;}
  if(state.status!=='ready_for_user_review'||!state.verifyRunId)continue;
  let run;try{run=await store.get('runs',state.verifyRunId);}catch{continue;}
  if(run.operation!=='verify_current'||run.status!=='verified')continue;
  if(t.materials&&(!run.materialCoverage?.enabled||!run.materialCoverage.complete||run.materialCoverage.materialsHash!==hash(t.materials)))throw Error('ROLE_MATERIAL_VERIFICATION_REQUIRED');
  const templateId=boundTemplateId(catalog,t.companyId,t.roleId);if(!templateId)throw Error('SUBMISSION_COMPANY_TEMPLATE_MISSING');
  const template=await store.get('templates',templateId);
  if((await storedSeal(store,template,t.companyId)).status!=='sealed')throw Error('SUBMISSION_COMPANY_TEMPLATE_NOT_SEALED');
  if(hash(template)!==run.templateHash)throw Error('SUBMISSION_TEMPLATE_CHANGED_AFTER_VERIFY');
  return {taskId:t.taskId,verifyRunId:run.id,templateId};
 }
 throw Error('SUBMISSION_REQUIRES_VERIFIED_TEMPLATE_FILL');
}

// 只读：按本轮批次（或指定公司编码）列出每家公司各站点的登录配置、表单模板（是否封存）和各岗位投递链接是否齐全。
// 资产缺口按站点编码报；公司文件只读，不写。
export async function formAssetStatus({handoffDir,catalog,store,companyIds,profile=null}){
 const files=await readCompanyFiles(handoffDir),byCode=new Map(files.map(f=>[f.code,f]));
 const batch=files.filter(f=>(f.doc['批次']?.['选中岗位']||[]).length&&!['已回写','不交接'].includes(f.doc['批次']['状态']));
 const wanted=companyIds?.length?[...new Set(companyIds)]:batch.map(f=>f.code);
 const rows=[];
 for(const id of wanted){
  const file=byCode.get(id);if(!file){rows.push({companyId:id,status:'unknown_company'});continue;}
  const doc=file.doc,selected=new Set(doc['批次']?.['选中岗位']||[]);
  const roles=(doc['岗位']||[]).filter(r=>!selected.size||selected.has(r['岗位编码'])).map(r=>({roleId:r['岗位编码'],siteId:r['站点编码'],applicationUrl:r['投递链接']||null}));
  const used=new Set(roles.map(r=>r.siteId)),entries=catalog.filter(c=>c.companyId===id&&(!roles.length||used.has(c.siteId)));
  const sites=[];
  for(const e of entries){const required=roles.length?roles.filter(r=>r.siteId===e.siteId).map(r=>({roleId:r.roleId,templateId:e.roleTemplates?.[r.roleId]||e.templateId||null})):[{roleId:null,templateId:e.templateId||null}],assets=[];
   for(const requiredRole of required){let template=null;try{if(requiredRole.templateId)template=await store.get('templates',requiredRole.templateId);}catch{}
    const seal=await storedSeal(store,template,e.id);assets.push({...requiredRole,...seal,status:template?(contractRebuildRequired(profile,hash(template))?'requires_rebuild':seal.status):'missing',reasonCode:seal.reason});}
   const template=!assets.length?'not_applicable':assets.every(a=>a.status==='sealed')?'sealed':assets.some(a=>a.status==='requires_rebuild')?'requires_rebuild':assets.some(a=>a.status==='unsealed')?'unsealed':'missing';
   const noUrl=roles.filter(r=>r.siteId===e.siteId&&!r.applicationUrl).length,gaps=[];
   if(!e.loginFile)gaps.push('登录配置');
   if(template!=='sealed'&&template!=='not_applicable')gaps.push(template==='unsealed'?`表单模板：${[...new Set(assets.map(a=>a.reasonCode))].join('、')}`:template==='requires_rebuild'?'表单模板需重建':'表单模板');
   if(noUrl)gaps.push(`投递链接（${noUrl} 个岗位缺）`);
   sites.push({siteId:e.siteId,assetKey:e.id,origin:e.origin,login:!!e.loginFile,template,reasonCodes:[...new Set(assets.map(a=>a.reasonCode))],routes:[...new Set(assets.map(a=>a.route))],roleTemplates:Object.keys(e.roleTemplates||{}).length,roleAssets:assets,gaps});}
  const missingSites=[...used].filter(s=>!entries.some(e=>e.siteId===s));
  const gaps=[...missingSites.map(s=>`${s}：站点不在目录`),...sites.filter(s=>s.gaps.length).map(s=>`${s.siteId}：${s.gaps.join('、')}`)];
  rows.push({companyId:id,name:doc['公司名称'],status:gaps.length?'incomplete':'ready',gaps,sites,roles});
 }
 return {companies:rows.length,ready:rows.filter(r=>r.status==='ready').length,incomplete:rows.filter(r=>r.status!=='ready').map(r=>({companyId:r.companyId,name:r.name,gaps:r.gaps||[r.status]})),detail:rows};
}
