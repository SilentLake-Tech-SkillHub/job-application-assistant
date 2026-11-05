#!/usr/bin/env node
// 主数据站点入口配置的写入入口。校验、预览、核对用户原话后交给主表固定脚本。
// 入口配置决定流程怎么走（认哪个页面、点哪个按钮、在哪张标签进入），AI 不得用编辑工具直接改这个文件。
// 用法：
//   node scripts/site-entry.mjs --workspace <工作区> --site <站点编码> --input <改动.json>            # 预览（只读）
//   node scripts/site-entry.mjs --workspace <工作区> --site <站点编码> --input <改动.json> --quote "<用户原话>" --expected-sha <预览给出的指纹>
// 改动.json 只能含 entry、loginPath 两个键（整体替换）；其余字段（账号核对、登录方式等）不在本命令范围。
import {readFile,writeFile,rename} from 'node:fs/promises';import path from 'node:path';import {pathToFileURL} from 'node:url';import {createHash,randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {CompanyDirectory,pyJson} from '../shared/company-directory.mjs';
import {validateCompany} from '../login/contracts.mjs';
import {resolveEntry} from '../shared/entry-recipe.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
// 登录入口路径也对本站所有岗位通用：不能带某个岗位的编号。
const PATH_ID=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|\d{9,}/i,QUERY_ID=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|\d{5,}/i;
export function checkLoginPath(p){if(typeof p!=='string'||!p.startsWith('/'))throw Error('INVALID_LOGIN_PATH');const u=new URL('https://x.invalid'+p);if(PATH_ID.test(u.pathname)||[...u.searchParams.values(),u.hash].some(v=>QUERY_ID.test(v)))throw Error('LOGIN_PATH_ROLE_ID_LITERAL');return p;}
const show=v=>v===undefined?'（无）':JSON.stringify(v);
// 只列出真正变了的字段（按路径逐项），不整段倒出配置。
const leaves=(v,p,out)=>{if(v&&typeof v==='object'&&!Array.isArray(v)){for(const k of Object.keys(v))leaves(v[k],p+'.'+k,out);}else out.set(p,v);return out;};
export function changedFields(current,patch){const lines=[];for(const k of Object.keys(patch)){const a=leaves(current[k],k,new Map()),b=leaves(patch[k],k,new Map());for(const p of new Set([...a.keys(),...b.keys()]))if(JSON.stringify(a.get(p))!==JSON.stringify(b.get(p)))lines.push(`${p}：当前 ${show(a.get(p))} → 更新 ${show(b.get(p))}`);}return lines;}
function writeMasterConfig(workspace,{company,site,config,quote,expectedSha}){
 const script=path.join(workspace,'.agents','skills','campus-job-application','scripts','json_excel_sync.py');
 const python=path.join(workspace,'tools','.venv-search-mcp','bin','python');
 return new Promise((resolve,reject)=>{
  const process=spawn(python,[script,'--workspace',workspace,'set-site-login-config','--quote',quote,'--expect-sha',expectedSha],{stdio:['pipe','ignore','ignore']});
  process.stdin.on('error',reject);
  process.once('error',reject);
  process.once('close',code=>code===0?resolve():reject(Error('SITE_ENTRY_MASTER_WRITE_FAILED')));
  process.stdin.end(JSON.stringify({company,site,config}));
 });
}
export async function siteEntry({workspace,site,patch,quote=null,expectedSha=null,now=()=>new Date().toISOString()}){
 const keys=Object.keys(patch||{});if(!keys.length||keys.some(k=>!['entry','loginPath'].includes(k)))throw Error('SITE_ENTRY_PATCH_KEYS: 只能改 entry、loginPath');
 const directory=new CompanyDirectory({handoffDir:path.join(workspace,'岗位交接')});const catalog=await directory.load();
 const e=catalog.flatMap(c=>(c.sites||[c]).map(s=>({...c,...s,id:c.id,companyId:c.companyId}))).find(x=>x.siteId===site);if(!e)throw Error('UNKNOWN_SITE');
 const raw=e.loginFile?await readFile(e.loginFile,'utf8'):null;
 const current=raw===null?await directory.loginConfig(e.companyId,{siteId:site}):JSON.parse(raw);
 const location=e.loginFile||directory.masterFile;
 const fingerprint=sha(raw??pyJson(current));
 if(!e.loginFile&&current.companyId!==e.companyId)throw Error('COMPANY_LOGIN_CONFIG_SCOPE_MISMATCH');
 const next={...current,...patch};
 if('loginPath' in patch)checkLoginPath(patch.loginPath);
 validateCompany(next);if(next.entry)resolveEntry(next);
 if(next.entry?.evidence&&new URL(next.entry.evidence.detailUrl).origin!==current.origin)throw Error('ENTRY_EVIDENCE_ORIGIN_MISMATCH');
 const lines=[`站点 ${site}（${e.name}，${current.origin}）的入口配置：${path.relative(workspace,location)}`,...changedFields(current,patch)];if(lines.length===1)throw Error('SITE_ENTRY_NO_CHANGE');
 if(quote===null)return {show_user_exactly:lines,expectedSha:fingerprint,rule:'原样展示给用户并取得明确确认后，带 --quote "<用户原话>" --expected-sha 执行'};
 if(!String(quote).trim())throw Error('USER_QUOTE_REQUIRED');if(expectedSha!==fingerprint)throw Error('SITE_ENTRY_CHANGED_SINCE_PREVIEW');
 next.version=(current.version||1)+1;next.confirmation={userQuote:String(quote).trim(),confirmedAt:now(),fields:keys};
 if(e.loginFile){
  const tmp=e.loginFile+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(next,null,1)+'\n');await rename(tmp,e.loginFile);
 }else await writeMasterConfig(workspace,{company:e.companyId,site,config:next,quote:String(quote).trim(),expectedSha:fingerprint});
 return {written:path.relative(workspace,location),version:next.version,show_user_exactly:lines};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 const argv=process.argv.slice(2),one=k=>{const i=argv.indexOf(k);return i<0?null:argv[i+1];};
 try{const workspace=path.resolve(one('--workspace')||'.'),patch=JSON.parse(await readFile(one('--input'),'utf8'));
  console.log(JSON.stringify(await siteEntry({workspace,site:one('--site'),patch,quote:one('--quote'),expectedSha:one('--expected-sha')}),null,1));}
 catch(e){console.log(JSON.stringify({error:e.message}));process.exitCode=1;}
}
