// 首版入口配置（C39）。站点还没有入口配置时，组件按固定规则从一次真实点击生成第一版，经主表固定脚本写入、
// 读回核对后，原岗位任务在同一次调用里按新配置进入申请页。2026-11-16 用户决定（“2.同意 3A”）：
// 和首版登录配置一样，组件读出岗位标题和投递按钮，直接写入第一版，接着点一次入口，事后在结果里列出写了哪几家；
// 点进去落的不是申请表或登录页，就按原来的报错处理。浏览器侧观察见 first-entry.mjs。
import {AsyncLocalStorage} from 'node:async_hooks';
import {createHash} from 'node:crypto';
import {pyJson} from './company-directory.mjs';
import {validateCompany} from '../login/contracts.mjs';
import {resolveEntry} from './entry-recipe.mjs';
import {transitionLocationMatches} from './entry-transition.mjs';
import {firstLevelScope} from './login-config-supplement.mjs';
import {acquireLease,leasePath,defaultLeaseRoot} from './leases.mjs';

export const FIRST_ENTRY_MODE='component_first_entry';
export const FIRST_ENTRY_RULE='首版入口配置由组件按固定规则写入：在已确认岗位页读出与岗位名完全一致的标题、点一次唯一的投递按钮，按实际落地的申请页记录岗位页与申请页的位置规则（岗位编号只写 $roleId）；申请页不在允许路径内时，允许路径按首版登录配置同一规则重算。';
// 同一首版入口失败两次后交 Agent 浏览器兜底（2026-11-16 用户：“按B。推进”），按 Agent 的点击写入时用这条规则。
export const FALLBACK_ENTRY_RULE='首版入口配置按 Agent 浏览器兜底记录写入：同一首版入口失败两次后，由登记的 Agent 在本任务岗位页用鼠标点进本岗位申请表；组件核对落地页是本岗位申请表后，按 Agent 点的按钮文字（同文字多个时记一共几个、点第几个）和实际落地页记录位置规则（岗位编号只写 $roleId）；申请页不在允许路径内时，允许路径按首版登录配置同一规则重算。';
const sha=s=>createHash('sha256').update(s,'utf8').digest('hex');
const esc=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
const originOf=u=>{try{return new URL(u).origin;}catch{return null;}};
const fail=(code,details)=>{const e=Error(code);if(details)e.details=details;throw e;};

// 岗位编号在一段路径里只出现一次、前后不是字母数字时，才把它写成命名捕获组 roleId。
function idPattern(path,id){
 const hits=[...path.matchAll(new RegExp('(?<![A-Za-z0-9])'+esc(id)+'(?![A-Za-z0-9])','g'))];
 if(hits.length!==1)return null;const at=hits[0].index;
 return '^'+esc(path.slice(0,at))+'(?<roleId>[^/?#]+?)'+esc(path.slice(at+id.length))+'$';
}
const idParameter=(params,id)=>{const keys=[...new Set(params.keys())].filter(k=>params.getAll(k).length===1&&params.get(k)===id);return keys.length===1?keys[0]:null;};
// 一个实际地址的位置规则：岗位编号所在处按 查询参数 → 路径 → 锚点路径 → 锚点参数 的次序认，写成 $roleId 或命名捕获组；
// 其余路径原样首尾锚定，其他查询参数不写入（跟踪参数等不进规则）。地址里没有岗位编号时 identity 为 null。
export function locationFor(url,roleId){
 const u=new URL(url),id=String(roleId),hash=u.hash.slice(1),i=hash.indexOf('?');
 const hashPath=i<0?hash:hash.slice(0,i),hashQuery=new URLSearchParams(i<0?'':hash.slice(i+1));
 const location={pathnamePattern:'^'+esc(u.pathname)+'$',...(hashPath?{hashPathPattern:'^'+esc(hashPath)+'$'}:{})};
 const q=idParameter(u.searchParams,id);
 if(q)return {location:{...location,query:{[q]:'$roleId'}},identity:{source:'query',parameter:q}};
 const p=idPattern(u.pathname,id);
 if(p)return {location:{...location,pathnamePattern:p},identity:{source:'pathname',parameter:'roleId',pattern:p}};
 const h=hashPath?idPattern(hashPath,id):null;
 if(h)return {location:{...location,hashPathPattern:h},identity:{source:'hashPath',parameter:'roleId',pattern:h}};
 const hq=idParameter(hashQuery,id);
 if(hq)return {location:{...location,hashQuery:{[hq]:'$roleId'}},identity:{source:'hashQuery',parameter:hq}};
 return {location,identity:null};
}

// observed：first-entry.mjs observeFirstEntry 的结果。siteUrls：本站点全部岗位链接与投递链接（重算允许路径用）。
// 落地页是不是本岗位的申请表：有可见输入控件，且地址里有岗位编号或页面上有与岗位名完全一致的标题。
export function isRoleForm(observed,roleId){return observed?.formFieldsVisible===true&&!!(locationFor(observed.pageUrl,roleId).identity||observed.formTitle?.heading||observed.formTitle?.path);}
export function firstEntryConfig({current,observed,roleId,siteUrls=[],now=()=>new Date().toISOString(),rule=FIRST_ENTRY_RULE,method='component_first_entry_observed_click',recordedBy=null}){
 if(current.entry)fail('APPLICATION_ENTRY_FIRST_CONFIG_EXISTS');
 if(observed.formFieldsVisible!==true)fail('APPLICATION_ENTRY_FIRST_LANDING_NOT_FORM');
 if(originOf(observed.detailUrl)!==current.origin||originOf(observed.pageUrl)!==current.origin)fail('APPLICATION_ENTRY_FIRST_LANDING_SCOPE_CHANGED');
 if(!['same','new'].includes(observed.target))fail('APPLICATION_ENTRY_FIRST_CONFIG_INVALID',{reason:'ENTRY_TARGET_REQUIRED'});
 const detail=locationFor(observed.detailUrl,roleId),form=locationFor(observed.pageUrl,roleId);
 // 岗位编号从岗位链接读出，岗位页地址里必须能认出它；否则这份配置只对这一个岗位有效。
 if(!detail.identity)fail('APPLICATION_ENTRY_FIRST_ROLE_ID_NOT_IN_LINK');
 // 地址能核对岗位编号时，标题只用不随版式变的写法；申请页地址里没有岗位编号时，才退到结构路径。
 const detailTitle=observed.detailTitle?.heading||null,formTitle=observed.formTitle?.heading||(form.identity?null:observed.formTitle?.path||null);
 // 落地页要能认出是本岗位的申请表：地址里有岗位编号，或页面上有与岗位名完全一致的标题；否则不写（可能落到了首页、列表页等带搜索框的页面）。
 if(!form.identity&&!formTitle)fail('APPLICATION_ENTRY_FIRST_LANDING_NOT_FORM');
 const at=now();
 const entry={kind:'declarative_transition',target:observed.target,
  detail:{location:detail.location,...(detailTitle?{roleSelector:detailTitle}:{}),roleIdentity:detail.identity},
  entryLocator:observed.entryLocator,
  form:{location:form.location,readySelector:observed.formFieldSelector,...(formTitle?{roleSelector:formTitle}:{}),...(form.identity?{roleIdentity:form.identity}:{})},
  evidence:{detailUrl:observed.detailUrl,formUrl:observed.pageUrl,capturedAt:at,method,...(recordedBy?{recordedBy}:{})}};
 const formPath=new URL(observed.pageUrl).pathname,covered=current.allowedPaths.some(p=>formPath.startsWith(p));
 const next={...current,entry,...(covered?{}:{allowedPaths:firstLevelScope([...siteUrls,observed.pageUrl])}),version:(current.version||1)+1,confirmation:{mode:FIRST_ENTRY_MODE,rule,confirmedAt:at}};
 try{validateCompany(next);resolveEntry(next);}catch(error){fail('APPLICATION_ENTRY_FIRST_CONFIG_INVALID',{reason:/^[A-Z_]+$/.test(error.message)?error.message:'INVALID'});}
 // 岗位页和申请页的规则必须分得开，否则以后认不出标签在哪一步。
 if(transitionLocationMatches(entry.detail.location,observed.pageUrl,roleId)||transitionLocationMatches(entry.form.location,observed.detailUrl,roleId))fail('APPLICATION_ENTRY_FIRST_LOCATION_AMBIGUOUS');
 return next;
}

const reports=new AsyncLocalStorage();
// 每次工具调用一份清单：本次调用里组件写入的首版入口配置。
export async function collectEntryConfigReports(fn){
 const created=[],result=await reports.run(created,fn);
 if(!created.length||!result||typeof result!=='object'||Array.isArray(result))return result;
 return {...result,entryConfigsCreated:created};
}

// write({company,site,config,quote,expectedSha})：主表固定脚本写入（json_excel_sync.py set-site-login-config）。
export class EntryConfigs{
 constructor({directory,write,leaseRoot=defaultLeaseRoot(),now}){Object.assign(this,{directory,write,leaseRoot,now});}
 // rule／method／recordedBy：Agent 兜底写入时传 FALLBACK_ENTRY_RULE 与操作者，组件自己点击时用默认值。
 async create({companyId,siteId,roleId,observed,rule=FIRST_ENTRY_RULE,method,recordedBy}){
  const release=await acquireLease(leasePath(this.leaseRoot,'login-config:'+companyId+':'+siteId),{waitMs:30000,busyCode:'LOGIN_CONFIG_BEING_WRITTEN'});
  try{
   const current=await this.directory.loginConfig(companyId,{siteId});
   // 同站点另一个岗位刚写过：直接用已写入的那份，不重复写。
   if(current.entry)return {config:current,created:false};
   const roles=(await this.directory.roles(companyId)).filter(r=>r.siteId===siteId);
   const siteUrls=[...roles.map(r=>r.url),...roles.map(r=>r.applyUrl)].filter(u=>u&&originOf(u)===current.origin);
   const config=firstEntryConfig({current,observed,roleId,siteUrls,rule,...(method?{method}:{}),...(recordedBy?{recordedBy}:{}),...(this.now?{now:this.now}:{})});
   await this.write({company:companyId,site:siteId,config,quote:rule,expectedSha:sha(pyJson(current))});
   const stored=await this.directory.loginConfig(companyId,{siteId});
   if(pyJson(stored)!==pyJson(config))fail('APPLICATION_ENTRY_FIRST_CONFIG_READBACK_FAILED');
   const e=config.entry;
   reports.getStore()?.push({companyId,siteId,origin:config.origin,source:recordedBy?'agent_fallback':'component',target:e.target,entryLabel:e.entryLocator.label,...(e.entryLocator.count?{entryButtons:{count:e.entryLocator.count,index:e.entryLocator.index}}:{}),detailUrl:e.evidence.detailUrl,formUrl:e.evidence.formUrl,titleChecked:{detail:!!e.detail.roleSelector,form:!!e.form.roleSelector},roleIdInFormUrl:!!e.form.roleIdentity,...(config.allowedPaths!==current.allowedPaths?{allowedPaths:{from:current.allowedPaths,to:config.allowedPaths}}:{}),version:config.version,writtenAt:config.confirmation.confirmedAt});
   return {config:stored,created:true};
  }finally{await release();}
 }
}
