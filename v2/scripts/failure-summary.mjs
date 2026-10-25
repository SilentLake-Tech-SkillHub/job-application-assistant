#!/usr/bin/env node
// 维护端只读工具：把执行端落盘的失败按“失败码 × 控件类型”跨公司聚合，
// 供维护端一次修一类，而不是一次修一个现场。不输出任何填写值（expected/actual）。
// 用法：node scripts/failure-summary.mjs [--private-dir <dir>] [--since <ISO时间>] [--json]
import {readdir,readFile} from 'node:fs/promises';import path from 'node:path';
import {isTechnicalFailure} from '../shared/workflow-contract.mjs';
const argv=process.argv.slice(2),opt=k=>{const i=argv.indexOf(k);return i>=0?argv[i+1]:null;};
const privateDir=opt('--private-dir')||process.env.RECRUITING_PRIVATE_DIR;
if(!privateDir){console.error('需要 --private-dir 或 RECRUITING_PRIVATE_DIR');process.exit(2);}
const since=opt('--since')?Date.parse(opt('--since')):null,asJson=argv.includes('--json');
const readJsonDir=async dir=>{let names=[];try{names=await readdir(dir);}catch{return [];}
 const out=[];for(const n of names.filter(n=>n.endsWith('.json'))){try{out.push({file:n,data:JSON.parse(await readFile(path.join(dir,n),'utf8'))});}catch{}}return out;};
const at=d=>Date.parse(d.readAt||d.observedAt||d.lastAt||d.startedAt||'')||null;
const classes=new Map(),latest=new Map();
const add=(reason,kind,run,field)=>{const key=reason+'|'+kind;let c=classes.get(key);
 if(!c)classes.set(key,c={reason,kind,count:0,companies:new Set(),labels:new Set(),evidence:[]});
 c.count++;if(run.companyId)c.companies.add(run.companyId);if(field?.label)c.labels.add(field.label);
 if(c.evidence.length<3)c.evidence.push(field?.id?run.id+'#'+field.id:run.id);};
for(const {data:d} of await readJsonDir(path.join(privateDir,'runs'))){
 if(since&&(at(d)||0)<since)continue;
 if(d.operation==='mcp_error'&&d.error)add(d.error,'mcp_error',{...d,id:d.id},null);
 if(d.operation==='verify_current'){
  const key=(d.companyId||'?')+'|'+(d.roleId||d.pageUrl||'?'),t=at(d)||0;
  if(!latest.has(key)||latest.get(key).t<t)latest.set(key,{t,status:d.status,companyId:d.companyId,id:d.id,failed:(d.checks||[]).filter(c=>['mismatch','unverified'].includes(c.status)).length});
  for(const c of d.checks||[])if(['mismatch','unverified'].includes(c.status)&&c.reason)add(c.reason,c.kind||'field',d,c);
 }
}
const stopLoss=(await readJsonDir(path.join(privateDir,'stop-loss'))).map(x=>x.data).filter(e=>e.count>=2);
const rows=[...classes.values()].sort((a,b)=>b.count-a.count||b.companies.size-a.companies.size).map(c=>({reason:c.reason,kind:c.kind,count:c.count,companies:[...c.companies].sort(),technical:isTechnicalFailure([c.reason]),sampleLabels:[...c.labels].slice(0,5),evidence:c.evidence}));
const stillFailing=[...latest.values()].filter(v=>v.status!=='verified').map(({t,...v})=>v);
const metrics=(await readJsonDir(path.join(privateDir,'metrics'))).map(x=>x.data).sort((a,b)=>b.resultBytes-a.resultBytes);
const report={privateDir,since:since?new Date(since).toISOString():null,classes:rows,latestVerificationStillFailing:stillFailing,callVolume:metrics.slice(0,30).map(m=>({scope:m.scope,tool:m.tool,calls:m.calls,errors:m.errors,elapsedMs:m.elapsedMs,resultBytes:m.resultBytes,maxResultBytes:m.maxResultBytes})),activeStopLoss:stopLoss.map(e=>({scope:e.scope,tool:e.tool,count:e.count,reasons:e.reasons,evidenceIds:e.evidenceIds}))};
if(asJson){console.log(JSON.stringify(report,null,2));process.exit(0);}
console.log(`失败聚合（${report.since?'自 '+report.since:'全部记录'}）——按出现次数排序，跨公司同类问题优先一次修复`);
for(const r of rows.slice(0,30))console.log(`${String(r.count).padStart(5)}  ${r.technical?'驱动/宿主':'取值/映射'}  ${r.reason}  [${r.kind}]  公司${r.companies.length}家：${r.companies.slice(0,6).join('、')}${r.companies.length>6?'…':''}  证据：${r.evidence.join(' ')}`);
console.log(`\n最新一次核验仍未通过的岗位：${stillFailing.length} 个`);for(const v of stillFailing)console.log(`  ${v.companyId}  未通过 ${v.failed} 项  ${v.id}`);
console.log(`\n当前止损中的调用：${stopLoss.length} 个`);for(const e of stopLoss)console.log(`  ${e.scope}  ${e.tool}  ×${e.count}  ${e.reasons.join(',')}`);
console.log(`\n返回量最大的调用（返回字节≈进入模型上下文的量；自启用计量起）：`);for(const m of report.callVolume.slice(0,15))console.log(`  ${(m.resultBytes/1024).toFixed(0).padStart(7)}KB  ${String(m.calls).padStart(4)}次  失败${m.errors}  ${(m.elapsedMs/1000).toFixed(0)}s  ${m.scope}  ${m.tool}`);
