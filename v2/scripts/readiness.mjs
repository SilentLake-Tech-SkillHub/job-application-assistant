#!/usr/bin/env node
// 就绪检查（只读）：开跑前逐层确认当前投递批次里每家公司能不能执行。
// 个人数据 → 批次 → 公司资产（入口、定位、表单模板、记录归属、栏目放置）→ 运行态（队列）→ 宿主接线。
// 用法：node scripts/readiness.mjs --workspace <工作区> [--host-config <宿主 MCP 配置文件> ...] [--json]
// 三个强制时点：门禁变更合并前、批次内容变化后、执行宿主开工前（见 docs/maintenance.md）。
import {readFile,readdir} from 'node:fs/promises';import path from 'node:path';
import {readHandoffBatch,CompanyDirectory,contentSha} from '../shared/company-directory.mjs';
import {Store,hash} from '../shared/engine.mjs';
import {FormRouter} from '../shared/form-route.mjs';
import {transitionLocationMatches} from '../shared/entry-transition.mjs';
import {unstableLocators} from '../shared/selector-stability.mjs';
import {recordSourceBindingIssues,recordParentsFromProfile} from '../shared/record-source-binding.mjs';
import {placementFindings,nonRecordMembers} from '../shared/record-placement.mjs';
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
const queues=[];if(handoff)for(const f of (await readdir(queueDir).catch(()=>[])).filter(f=>f.endsWith('.json'))){const q=await tryJson(path.join(queueDir,f));if(q?.input?.batchId===handoff.input.batchId)queues.push({id:f.replace(/\.json$/,''),current:q.source?.contentSha256===handoff.source.contentSha256});}
const outcomes=await tryJson(path.join(handoffDir,'投递回传.json'));report.layers.linkChanges=Object.values(outcomes?.linkChanges||{}).map(x=>`${x.roleTitle}：${x.roleUrl} → ${x.observedUrl}`);
report.layers.queues={current:queues.filter(q=>q.current).length,stale:queues.filter(q=>!q.current).map(q=>q.id)};
// 4 公司资产
const directory=new CompanyDirectory({handoffDir});const catalog=await directory.load();const store=new Store(privateDir);
let bindings={},roleBindings={};try{bindings=await store.get('templates','company-bindings');}catch{}try{roleBindings=await store.get('templates','role-bindings');}catch{}
const rules=target?.['履历栏目放置']?.['结构化']||[],parents=recordParentsFromProfile(profile);
const batchFile=await tryJson(path.join(handoffDir,'投递批次.json')),remaining=batchFile?.progress?.remainingRoleKeys?new Set(batchFile.progress.remainingRoleKeys):null;
for(const c of handoff?.input.companies||[]){
 const entry=catalog.find(e=>e.id===c.companyId)||catalog.find(e=>e.companyId===c.companyId);const row={company:c.name,companyId:c.companyId,roles:[],problems:[],notes:[]};
 if(!entry){row.problems.push('公司目录缺失');report.companies.push(row);continue;}
 const login=entry.loginFile?await tryJson(entry.loginFile):null;if(!login)row.problems.push('没有登录配置，需先建档');
 for(const u of unstableLocators(login||{}))row.notes.push(`定位依赖生成式样式类名：${u.where}（${u.token}），需重新采集`);
 for(const r of c.roles){
  const rr={role:r.title,verdict:null,reasons:[]};
  if(r.applicationStatus&&r.applicationStatus!=='岗位待投递'||remaining&&!remaining.has(c.companyId+'|'+r.roleId)){rr.verdict='已处理';rr.reasons.push(r.applicationStatus&&r.applicationStatus!=='岗位待投递'?r.applicationStatus:'批次进度显示已处理');row.roles.push(rr);continue;}
  const e=login?.entry;
  if(e?.kind==='declarative_transition'){
   const links=[r.url,r.applyUrl].filter(Boolean);
   if(!links.some(l=>['detail','form'].some(p=>transitionLocationMatches(e[p].location,l,r.roleId))))rr.reasons.push('岗位链接、投递链接都不被入口配置识别（网站可能已改链接：执行端进入后会提出链接变更，经你确认后用 relink 覆盖）');
  }
  const templateId=roleBindings[c.companyId]?.[String(r.roleId)]||bindings[c.companyId]||null;
  if(!templateId){rr.reasons.push('没有表单模板，需建库');}
  else{
   let template=null;try{template=await store.get('templates',templateId);}catch{}
   if(!template)rr.reasons.push('绑定的表单模板文件缺失');
   else{
    const pageUrl=r.applyUrl||template.evidence?.sourceUrl;
    const route=await new FormRouter({store,companies:[{id:c.companyId,origin:entry.origin,templateId}],validateTemplate:()=>true,loadProfile:async()=>profile}).resolve({companyId:c.companyId,roleId:r.roleId,pageUrl}).catch(err=>({route:'error',reason:err.message}));
    if(route.route!=='reuse')rr.reasons.push(`表单模板不可执行：${route.reason}${route.blockers?.length?'（'+route.blockers.slice(0,3).join(',')+'）':''}`);
    const binding=recordSourceBindingIssues({...template,evidence:{...template.evidence,recordParents:{...parents,...(template.evidence?.recordParents||{})}}});if(binding.length)rr.reasons.push(`记录归属错位 ${binding.length} 处`);
    const placement=placementFindings(template,rules,{...parents,...(template.evidence?.recordParents||{})});if(placement.length)rr.reasons.push('栏目放置不符合你的规则：'+placement.map(p=>`${p.section}#${p.index} 放了 ${p.family}`).join('；'));
    const undeclared=nonRecordMembers(template);if(undeclared.length)row.notes.push(`模板 ${templateId}：${undeclared.length} 个记录内字段不取自该记录，需在整条记录绑定时声明`);
   }
  }
  rr.verdict=rr.reasons.length?'不可执行':'可执行';row.roles.push(rr);
 }
 row.notes=[...new Set(row.notes)];
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
console.log(`待你确认的链接变更：${report.layers.linkChanges.length?report.layers.linkChanges.join('；'):'无'}`);
console.log(`队列：与当前批次一致 ${report.layers.queues.current} 个；已失效 ${report.layers.queues.stale.length} 个`);
for(const c of report.companies){console.log(`\n【${c.verdict}】${c.company}`);for(const p of c.problems)console.log('  ✗ '+p);for(const r of c.roles)console.log(`  ${r.verdict==='可执行'?'✓':r.verdict==='已处理'?'·':'✗'} ${r.role}${r.reasons.length?'：'+r.reasons.join('；'):''}`);for(const n of c.notes)console.log('  ! '+n);}
for(const h of report.host)console.log(`\n宿主配置 ${h.file}：${!h.readable?'不可读':`角色 ${h.hostRole}；交接目录 ${h.handoffDir?'有':'缺'}；REA 端点 ${h.reaEndpoint?'有':'缺'}${h.retiredKeys?'；含已取消的 RECRUITING_LOGIN_COMPANY_DIR':''}`}`);
