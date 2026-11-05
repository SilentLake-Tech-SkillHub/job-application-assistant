#!/usr/bin/env node
// 就绪检查（只读）：开跑前逐层确认本轮交接的每家公司（岗位交接/公司/<公司编码>.json）能不能执行。
// 个人数据 → 批次 → 公司资产（入口、定位、表单模板、记录归属、栏目放置）→ 运行态（队列）→ 宿主接线。
// 用法：node scripts/readiness.mjs --workspace <工作区> [--host-config <宿主 MCP 配置文件> ...] [--json]
// 三个强制时点：门禁变更合并前、批次内容变化后、执行宿主开工前（见 docs/maintenance.md）。
import {readFile,readdir} from 'node:fs/promises';import path from 'node:path';
import {readHandoffBatch,readCompanyFiles,CompanyDirectory,companyContext} from '../shared/company-directory.mjs';
import {Store,hash} from '../shared/engine.mjs';
import {FormRouter} from '../shared/form-route.mjs';
import {unstableLocators} from '../shared/selector-stability.mjs';
import {resolveEntry} from '../shared/entry-recipe.mjs';
import {recordSourceBindingIssues,recordParentsFromProfile} from '../shared/record-source-binding.mjs';
import {placementFindings,nonRecordMembers} from '../shared/record-placement.mjs';
import {recordPlanOf,withProfileRecords} from '../shared/repeat-groups.mjs';
import {withMaterialDispositions} from '../shared/material-disposition.mjs';
import {resolveProfile} from '../shared/profile.mjs';
import {compileExecutionPlan} from '../shared/execution-plan.mjs';
const argv=process.argv.slice(2),all=k=>argv.flatMap((a,i)=>a===k?[argv[i+1]]:[]),one=k=>all(k)[0];
const W=path.resolve(one('--workspace')||process.env.RECRUITING_WORKSPACE_ROOT||'.'),asJson=argv.includes('--json');
const handoffDir=path.join(W,'岗位交接'),privateDir=path.join(W,'.runtime/application'),queueDir=path.join(W,'.runtime/role-queue');
const json=async f=>JSON.parse(await readFile(f,'utf8'));const tryJson=async f=>{try{return await json(f);}catch{return null;}};
const report={workspace:W,layers:{},companies:[],host:[]};
// 1 个人数据
const profile=await tryJson(path.join(W,'产品管理/网申个人信息主档.json'));const target=await tryJson(path.join(W,'产品管理/求职目标.json'));
report.layers.profile={ok:!!profile,placementRules:!!target?.['履历栏目放置']?.['结构化']};
// 2 批次
let handoff=null;try{handoff=await readHandoffBatch({handoffDir});report.layers.batch={ok:true,batchId:handoff.input.batchId,contentSha256:handoff.source.contentSha256};}catch(e){report.layers.batch={ok:false,error:e.message};}
// 3 运行态：本批队列
const queues=[];if(handoff)for(const f of (await readdir(queueDir).catch(()=>[])).filter(f=>f.endsWith('.json'))){const q=await tryJson(path.join(queueDir,f));if(q?.batchId===handoff.input.batchId)queues.push({id:f.replace(/\.json$/,''),current:q.source?.contentSha256===handoff.source.contentSha256});}
// 链接观察：投递端按编码记下、等搜索端 apply-observations 由你确认的条目（值为空 = 打不开）。
const outcomes=await tryJson(path.join(handoffDir,'投递回传.json'));report.layers.observations=(outcomes?.observations||[]).map(o=>`${o.code} ${o.field}：${o.value===null?'打不开':o.value}`);
report.layers.queues={current:queues.filter(q=>q.current).length,stale:queues.filter(q=>!q.current).map(q=>q.id)};
// 4 公司资产
const store=new Store(privateDir);const directory=new CompanyDirectory({handoffDir,store});const catalog=await directory.load();

const rules=target?.['履历栏目放置']?.['结构化']||[],parents=recordParentsFromProfile(profile);
const progress=Object.fromEntries((await readCompanyFiles(handoffDir).catch(()=>[])).map(f=>[f.code,f.doc['批次']?.['进度']||null]));
for(const c of handoff?.input.companies||[]){
 const row={company:c.name,companyId:c.companyId,roles:[],problems:[],notes:[]},logins=new Map();
 const done=new Set(progress[c.companyId]?.['已处理']||[]);
 for(const r of c.roles){
  const rr={role:r.title,roleId:r.roleId,siteId:r.siteId,verdict:null,reasons:[]};
  if(r.applicationStatus&&r.applicationStatus!=='岗位待投递'||done.has(r.roleId)){rr.verdict='已处理';rr.reasons.push(r.applicationStatus&&r.applicationStatus!=='岗位待投递'?r.applicationStatus:'批次进度显示已处理');row.roles.push(rr);continue;}
  const entry=companyContext(catalog.find(e=>e.id===c.companyId),{siteId:r.siteId});
  if(!entry){rr.reasons.push(`站点 ${r.siteId} 不在目录`);rr.verdict='不可执行';row.roles.push(rr);continue;}
  if(!logins.has(entry.id)){const login=entry.loginFile?await tryJson(entry.loginFile):null;logins.set(entry.id,login);
   if(!login)row.problems.push(`${entry.id}（${entry.origin}）没有登录配置，需先建档`);
   for(const u of unstableLocators(login||{}))row.notes.push(`${entry.id} 定位依赖生成式样式类名：${u.where}（${u.token}），需重新采集`);
   // 入口配置必须对本站所有岗位通用（岗位编号只能写 $roleId）；不合格时该站点不能进入申请页，用 scripts/site-entry.mjs 修正。
   if(login?.entry)try{resolveEntry(login);}catch(err){row.problems.push(`${entry.id}（${entry.origin}）入口配置不可用：${err.message}，需用 scripts/site-entry.mjs 修正（预览 → 用户原话 → 写入）`);}}
  const templateId=await tryJson(path.join(privateDir,'templates',entry.id+'.json'))?entry.id:null;
  if(!templateId){rr.reasons.push('没有表单模板，需建库');}
  else{
   let template=null;try{template=await store.get('templates',templateId);}catch{}
   if(!template)rr.reasons.push('绑定的表单模板文件缺失');
   else{
    const pageUrl=r.applyUrl||template.evidence?.sourceUrl;
    const route=await new FormRouter({store,companies:[{id:entry.id,origin:entry.origin,templateId}],validateTemplate:()=>true,loadProfile:async()=>profile}).resolve({companyId:entry.id,roleId:r.roleId,pageUrl}).catch(err=>({route:'error',reason:err.message}));
    if(route.route!=='reuse')rr.reasons.push(`表单模板不可执行：${route.reason}${route.blockers?.length?'（'+route.blockers.slice(0,3).join(',')+'）':''}`);
    const binding=recordSourceBindingIssues({...template,evidence:{...template.evidence,recordParents:{...parents,...(template.evidence?.recordParents||{})}}});if(binding.length)rr.reasons.push(`记录归属错位 ${binding.length} 处`);
    const placement=placementFindings(template,rules,{...parents,...(template.evidence?.recordParents||{})});if(placement.length)rr.reasons.push('栏目放置不符合你的规则：'+placement.map(p=>`${p.section}#${p.index} 放了 ${p.family}`).join('；'));
    // 真编译一次本岗的计划（不开浏览器、不写文件）：能不能开工以这个为准。
    if(route.route==='reuse')try{
     const recordPlan=recordPlanOf(profile),materialContext=withMaterialDispositions(profile,{batchId:handoff.input.batchId,contentSha256:'readiness',companyId:entry.id,roleId:r.roleId,officialId:r.officialId,roleUrl:r.url,materials:r.materials});
     const resolved=resolveProfile(profile,withProfileRecords(template,recordPlan),{},entry.id,materialContext);
     const plan=await compileExecutionPlan(template,{...resolved,recordPlan,companyId:entry.id,roleId:r.roleId,pageUrl,templateHash:hash(template)});
     if(plan.constructionBlockers.length)rr.reasons.push('计划有阻塞项：'+plan.constructionBlockers.join('、'));
     if(plan.counts.needs_user)row.notes.push(`${r.title}：${plan.counts.needs_user} 个字段主档没有答案，开工时要问你`);
    }catch(err){rr.reasons.push(`计划编译失败：${err.message}`);}
    const undeclared=nonRecordMembers(template);if(undeclared.length)row.notes.push(`模板 ${templateId}：${undeclared.length} 个记录内字段不取自该记录，需在整条记录绑定时声明`);
   }
  }
  rr.verdict=rr.reasons.length?'不可执行':'可执行';row.roles.push(rr);
 }
 row.notes=[...new Set(row.notes)];row.problems=[...new Set(row.problems)];
 row.verdict=row.roles.every(r=>r.verdict==='已处理')?'已处理':row.problems.length?'不可执行':row.roles.every(r=>r.verdict!=='不可执行')?'可执行':'不可执行';
 report.companies.push(row);
}
// 5 宿主接线
for(const f of all('--host-config')){let text='';try{text=await readFile(path.resolve(W,f),'utf8');}catch{report.host.push({file:f,readable:false});continue;}
 report.host.push({file:f,readable:true,handoffDir:/RECRUITING_HANDOFF_DIR/.test(text),reaEndpoint:/RECRUITING_REA_ENDPOINT|RECRUITING_BROWSER_CDP_PORT/.test(text),retiredKeys:/RECRUITING_LOGIN_COMPANY_DIR/.test(text),hostRole:(text.match(/RECRUITING_HOST_ROLE\W+(\w+)/)||[])[1]||'executor(默认)'});}
if(asJson){console.log(JSON.stringify(report,null,2));process.exit(0);}
console.log(`就绪检查 ${new Date().toISOString()}  工作区 ${W}`);
console.log(`个人数据：${report.layers.profile.ok?'可读':'缺失'}；栏目放置规则：${report.layers.profile.placementRules?'已结构化':'缺失'}`);
console.log(`批次：${report.layers.batch.ok?report.layers.batch.batchId+' 已确认':'不可用 '+report.layers.batch.error}`);
console.log(`待你确认的链接观察：${report.layers.observations.length?report.layers.observations.join('；'):'无'}`);
console.log(`队列：与当前批次一致 ${report.layers.queues.current} 个；已失效 ${report.layers.queues.stale.length} 个`);
for(const c of report.companies){console.log(`\n【${c.verdict}】${c.company}（${c.companyId}）`);for(const p of c.problems)console.log('  ✗ '+p);for(const r of c.roles)console.log(`  ${r.verdict==='可执行'?'✓':r.verdict==='已处理'?'·':'✗'} ${r.role}（${r.roleId}）${r.reasons.length?'：'+r.reasons.join('；'):''}`);for(const n of c.notes)console.log('  ! '+n);}
for(const h of report.host)console.log(`\n宿主配置 ${h.file}：${!h.readable?'不可读':`角色 ${h.hostRole}；交接目录 ${h.handoffDir?'有':'缺'}；REA 端点 ${h.reaEndpoint?'有':'缺'}${h.retiredKeys?'；含已取消的 RECRUITING_LOGIN_COMPANY_DIR':''}`}`);
