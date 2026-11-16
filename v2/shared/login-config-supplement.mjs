// 登录配置存在性判断与首版补充（C31，2026-11-13 用户决定：“组件直接写入，接着投递原岗位，事后在结果里告诉你写了哪几家”）。
// 先查公司／站点有没有登录配置：有就直接读；没有就按固定规则生成首版最小配置（只有本人登录契约），
// 经主表固定脚本写入、读回核对后返回，调用方随即继续原公司、原岗位任务。写了哪几家随本次工具结果返回。
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {pyJson,companyContext} from './company-directory.mjs';
import {validateCompany} from '../login/contracts.mjs';
import {acquireLease,leasePath,defaultLeaseRoot} from './leases.mjs';

export const FIRST_CONFIG_MODE='component_first_config';
export const FIRST_CONFIG_RULE='首版登录配置由组件按固定规则写入：登录页取本站点第一个岗位链接，允许路径取本站点全部岗位链接与投递链接共同的第一级目录（不一致时为整个域名）；只含本人登录契约，不含自动登录与入口配方。';
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
export const firstConfigFingerprint=({company,site,config})=>sha(pyJson({company,site,config}));

// 本站点全部岗位链接与投递链接共同的第一级目录；没有共同目录时为整个域名。
export function firstLevelScope(urls){
 const heads=urls.map(u=>{const parts=new URL(u).pathname.split('/');return parts.length>2&&parts[1]?parts[1]:null;});
 return heads.length&&heads[0]&&heads.every(h=>h===heads[0])?['/'+heads[0]+'/']:['/'];
}

// 固定规则：只用公司宽表里该站点的岗位行（按文件顺序），不读页面、不猜测。
export function firstLoginConfig({companyId,siteId,origin,roles,now=()=>new Date().toISOString()}){
 const own=roles.filter(r=>r.siteId===siteId&&r.url&&new URL(r.url).origin===origin);
 if(!own.length)throw Error('LOGIN_CONFIG_SOURCE_ROLE_REQUIRED');
 const first=new URL(own[0].url),at=now();
 const scopeUrls=[...own.map(r=>r.url),...own.map(r=>r.applyUrl).filter(u=>u&&new URL(u).origin===origin)];
 return {schemaVersion:1,companyId,version:1,origin,loginPath:first.pathname+first.search+first.hash,allowedPaths:firstLevelScope(scopeUrls),loginMethod:'user_operated',
  success:{noApplicationSubmission:true,requiresLoginFormAbsent:true},
  evidence:{sourceUrl:first.href,capturedAt:at,method:'confirmed_role_links'},
  confirmation:{mode:FIRST_CONFIG_MODE,rule:FIRST_CONFIG_RULE,confirmedAt:at}};
}

const reports=new AsyncLocalStorage();
// 每次工具调用一份清单：本次调用里组件写入的首版登录配置。
export async function collectLoginConfigReports(fn){
 const created=[],result=await reports.run(created,fn);
 if(!created.length||!result||typeof result!=='object'||Array.isArray(result))return result;
 return {...result,loginConfigsCreated:created};
}

// write({company,site,config,quote,expectedSha})：主表固定脚本写入（json_excel_sync.py set-site-login-config）。
export class LoginConfigs{
 constructor({directory,write,leaseRoot=defaultLeaseRoot(),now}){Object.assign(this,{directory,write,leaseRoot,now});}
 site(companyId,context={}){
  const entry=companyContext(this.directory.entry(companyId),context);
  if(!entry?.siteId||!entry.origin)throw Error('LOGIN_CONFIG_SITE_REQUIRED');
  return entry;
 }
 async exists(companyId,context={}){
  const entry=this.site(companyId,context),configs=await this.directory.loginConfigs();
  if(configs===undefined)return !!entry.loginFile;
  return !!configs?.[companyId]?.[entry.siteId];
 }
 // 先判断存在，存在才读取；缺失则写入首版配置并读回，再按原样读取返回。
 async ensure(companyId,context={}){
  if(await this.exists(companyId,context))return this.directory.loginConfig(companyId,context);
  const entry=this.site(companyId,context);
  const release=await acquireLease(leasePath(this.leaseRoot,'login-config:'+companyId+':'+entry.siteId),{waitMs:30000,busyCode:'LOGIN_CONFIG_BEING_WRITTEN'});
  try{
   if(await this.exists(companyId,context))return this.directory.loginConfig(companyId,context);
   const config=validateCompany(firstLoginConfig({companyId,siteId:entry.siteId,origin:entry.origin,roles:await this.directory.roles(companyId),...(this.now?{now:this.now}:{})}));
   const item={company:companyId,site:entry.siteId,config};
   await this.write({...item,quote:FIRST_CONFIG_RULE,expectedSha:firstConfigFingerprint(item)});
   const stored=await this.directory.loginConfig(companyId,{siteId:entry.siteId});
   if(pyJson(stored)!==pyJson(config))throw Error('LOGIN_CONFIG_READBACK_FAILED');
   reports.getStore()?.push({companyId,siteId:entry.siteId,origin:config.origin,loginPath:config.loginPath,allowedPaths:config.allowedPaths,loginMethod:config.loginMethod,writtenAt:config.confirmation.confirmedAt});
   return stored;
  }finally{await release();}
 }
}
