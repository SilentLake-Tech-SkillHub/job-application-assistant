// Declarative, evidence-bound navigation shared by every browser executor.
// This module never builds an application URL and never clicks on a form page.
import {READY_TIMEOUT_MS} from './entry-recipe.mjs';
import {entrySelectors,unstableClassTokens,ruleApplies} from './selector-stability.mjs';
const fail=code=>{throw Error(code);};
// 像岗位编号的字面值：UUID、连续 5 位以上数字、或 16 位以上带数字的字母数字串。
const ROLE_ID_LITERAL=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|\d{5,}|(?=[A-Za-z0-9]*\d)[A-Za-z0-9]{16,}/i;
// 路径里允许出现站点租户号等短数字（如 /051736/），只拦 UUID 和 9 位以上的数字。
const PATH_ROLE_ID_LITERAL=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}|\d{9,}/i;
const pattern=(value)=>{if(typeof value!=='string'||!value.startsWith('^')||!value.endsWith('$')||value.length>500)fail('ENTRY_LOCATION_PATTERN_REQUIRED');try{return new RegExp(value);}catch{fail('ENTRY_LOCATION_PATTERN_INVALID');}};
export function validateTransition(entry){
 if(entry?.kind!=='declarative_transition')fail('ROLE_ENTRY_RECIPE_REQUIRED');
 if(ruleApplies(entry.evidence)&&entrySelectors(entry).some(([,s])=>unstableClassTokens(s).length))fail('ENTRY_SELECTOR_UNSTABLE');
 for(const phase of ['detail','form']){
  const p=entry[phase],l=p?.location;if(!l||!l.pathnamePattern)fail('ENTRY_LOCATION_PATTERN_REQUIRED');pattern(l.pathnamePattern);if(l.hashPathPattern)pattern(l.hashPathPattern);
  for(const map of [l.query,l.hashQuery])if(map&&(typeof map!=='object'||Array.isArray(map)||Object.entries(map).some(([k,v])=>!k||typeof v!=='string'||!v)))fail('ENTRY_LOCATION_QUERY_INVALID');
  // 站点入口配置对本站所有岗位通用：岗位编号只能写 $roleId，不能写死某一个岗位的编号。
  for(const map of [l.query,l.hashQuery])for(const v of Object.values(map||{}))if(v!=='$roleId'&&ROLE_ID_LITERAL.test(v))fail('ENTRY_ROLE_ID_LITERAL');
  for(const pat of [l.pathnamePattern,l.hashPathPattern])if(pat&&PATH_ROLE_ID_LITERAL.test(pat))fail('ENTRY_ROLE_ID_LITERAL');
  if(p.rolePrefix!==undefined&&(typeof p.rolePrefix!=='string'||!p.rolePrefix.trim()||!p.roleSelector))fail('ENTRY_ROLE_EVIDENCE_REQUIRED');
  if(!p.roleSelector&&!p.roleIdentity&&entry.allowProvenanceIdentity!==true)fail('ENTRY_ROLE_EVIDENCE_REQUIRED');if(p.roleSelector&&(typeof p.roleSelector!=='string'||!p.roleSelector.trim()))fail('ENTRY_ROLE_EVIDENCE_REQUIRED');
  if(p.roleIdentity){const r=p.roleIdentity;if(!['query','hashQuery','pathname','hashPath'].includes(r.source)||!r.parameter)fail('ENTRY_ROLE_IDENTITY_INVALID');if(r.source==='pathname'||r.source==='hashPath')pattern(r.pattern);}
 }
 if(entry.allowProvenanceIdentity!==undefined&&typeof entry.allowProvenanceIdentity!=='boolean')fail('ENTRY_PROVENANCE_FLAG_INVALID');
 const c=entry.entryLocator;if(!c||typeof c.label!=='string'||!c.label.trim()||[!!c.selector,!!(c.role&&c.name),!!c.text].filter(Boolean).length!==1)fail('ENTRY_CTA_CONTRACT_REQUIRED');
 if(c.selector&&typeof c.selector!=='string'||c.role&&typeof c.role!=='string'||c.name&&c.name!==c.label||c.text&&c.text!==c.label)fail('ENTRY_CTA_CONTRACT_REQUIRED');
 if(entry.preActions!==undefined){
  if(!Array.isArray(entry.preActions)||entry.preActions.length>5)fail('ENTRY_PREACTIONS_INVALID');
  for(const a of entry.preActions){if(!a||!['check','click'].includes(a.method)||typeof a.selector!=='string'||!a.selector.trim())fail('ENTRY_PREACTIONS_INVALID');if(a.label!==undefined&&typeof a.label!=='string')fail('ENTRY_PREACTIONS_INVALID');}
 }
 if(typeof entry.form.readySelector!=='string'||!entry.form.readySelector.trim())fail('ENTRY_FORM_READY_REQUIRED');
 if(!['same','new','same_or_new'].includes(entry.target))fail('ENTRY_TARGET_REQUIRED');
 const e=entry.evidence;for(const key of ['detailUrl','formUrl']){let u;try{u=new URL(e?.[key]);}catch{fail('ENTRY_NAVIGATION_EVIDENCE_REQUIRED');}if(u.protocol!=='https:')fail('ENTRY_NAVIGATION_EVIDENCE_REQUIRED');}
 if(new URL(e.detailUrl).origin!==new URL(e.formUrl).origin||!e.capturedAt||!e.method)fail('ENTRY_NAVIGATION_EVIDENCE_REQUIRED');
 return entry;
}
const hashParts=u=>{const hash=u.hash.slice(1),i=hash.indexOf('?');return {path:i<0?hash:hash.slice(0,i),query:new URLSearchParams(i<0?'':hash.slice(i+1))};};
export function transitionLocationMatches(spec,url,roleId){
 let u;try{u=new URL(url);}catch{return false;}const h=hashParts(u);
 if(!pattern(spec.pathnamePattern).test(u.pathname)||spec.hashPathPattern&&!pattern(spec.hashPathPattern).test(h.path))return false;
 for(const [map,params]of[[spec.query,u.searchParams],[spec.hashQuery,h.query]])for(const [k,v]of Object.entries(map||{})){const values=params.getAll(k);if(values.length!==1||values[0]!== (v==='$roleId'?roleId:v))return false;}
 return true;
}
// 把 $roleId 当作任意值匹配位置规则，返回地址里该位置的岗位编号；认不出返回 null。
export function transitionRoleIdFromLocation(spec,url){
 let u;try{u=new URL(url);}catch{return null;}const h=hashParts(u);
 if(!pattern(spec.pathnamePattern).test(u.pathname)||spec.hashPathPattern&&!pattern(spec.hashPathPattern).test(h.path))return null;
 let found=null;
 for(const [map,params]of[[spec.query,u.searchParams],[spec.hashQuery,h.query]])for(const [k,v]of Object.entries(map||{})){const values=params.getAll(k);if(values.length!==1)return null;if(v==='$roleId'){if(!values[0])return null;found=values[0];}else if(values[0]!==v)return null;}
 return found;
}
// 只保留位置规则里声明的参数（去掉账号编号等个人参数），用作岗位链接观察值。
export function canonicalLocationUrl(spec,url){
 const u=new URL(url),out=new URL(u.origin+u.pathname);
 for(const k of Object.keys(spec.query||{}))out.searchParams.set(k,u.searchParams.get(k));
 if(spec.hashPathPattern||spec.hashQuery){const h=hashParts(u),q=new URLSearchParams();for(const k of Object.keys(spec.hashQuery||{}))q.set(k,h.query.get(k));out.hash=h.path+(q.toString()?'?'+q:'');}
 return out.href;
}
export function transitionRoleIdentity(spec,url){
 if(!spec)return null;const u=new URL(url);let value;
 if(spec.source==='query')value=u.searchParams.getAll(spec.parameter).length===1?u.searchParams.get(spec.parameter):null;
 else if(spec.source==='hashQuery'){const p=hashParts(u).query;value=p.getAll(spec.parameter).length===1?p.get(spec.parameter):null;}
 else if(spec.source==='hashPath')value=pattern(spec.pattern).exec(hashParts(u).path)?.groups?.[spec.parameter]||null;
 else value=pattern(spec.pattern).exec(u.pathname)?.groups?.[spec.parameter]||null;
 return {parameter:spec.parameter,value,source:spec.source};
}
const digestText=async value=>{const {createHash}=await import('node:crypto');return createHash('sha256').update(String(value)).digest('hex');};
const normalizeTitle=value=>String(value).normalize('NFKC').replace(/\s+/g,'').toLowerCase();
async function roleFailure(code,{stage,check,selectorMatches,expected,observed,prefixMatched=null}){
 const error=Error(code);
 error.details={phase:'entry_role_identity',stage,check,selectorMatches,expectedValueHash:await digestText(expected),observedValueHash:observed==null?null:await digestText(observed),valueMatches:observed!=null&&observed===expected,readbackAvailable:observed!=null,normalizedMatch:observed==null?null:normalizeTitle(observed)===normalizeTitle(expected),prefixMatched};
 throw error;
}
async function readRole(page,spec,expectedTitle,expectedRoleId,stage,host){
 let roleTitle=null;if(spec.roleSelector){const l=page.locator(spec.roleSelector);await l.waitFor({state:'visible',timeout:READY_TIMEOUT_MS});const count=await l.count();
  if(count!==1)await roleFailure('APPLICATION_ENTRY_ROLE_CHANGED',{stage,check:'selector_count',selectorMatches:count,expected:expectedTitle,observed:null});
  let raw=(await l.innerText()).trim();const now=host.now||Date.now,deadline=now()+READY_TIMEOUT_MS;
  while(!raw||spec.rolePrefix&&raw===spec.rolePrefix){if(now()>=deadline){const error=Error('BROWSER_OPERATION_TIMEOUT');error.operationStep='entry_role_title_ready';error.operationLocator=spec.roleSelector;throw error;}await host.pause(50);raw=(await l.innerText()).trim();}
  roleTitle=raw;
  if(spec.rolePrefix){if(!raw.startsWith(spec.rolePrefix))await roleFailure('APPLICATION_ENTRY_ROLE_CHANGED',{stage,check:'prefix',selectorMatches:1,expected:expectedTitle,observed:raw,prefixMatched:false});roleTitle=raw.slice(spec.rolePrefix.length).trim();}
  if(roleTitle!==expectedTitle)await roleFailure('APPLICATION_ENTRY_ROLE_CHANGED',{stage,check:'title',selectorMatches:1,expected:expectedTitle,observed:roleTitle,prefixMatched:spec.rolePrefix?true:null});}
 const roleIdentity=transitionRoleIdentity(spec.roleIdentity,await page.url());if(roleIdentity&&roleIdentity.value!==expectedRoleId)await roleFailure('APPLICATION_ENTRY_RESULT_ROLE_CHANGED',{stage,check:'role_identity',selectorMatches:spec.roleSelector?1:0,expected:String(expectedRoleId),observed:roleIdentity.value==null?null:String(roleIdentity.value)});
 return {roleTitle,...(roleIdentity?{roleIdentity}:{})};
}
export async function executeTransition({entry,pageId,expectedTitle,expectedRoleId,accountSelector,excludePageIds=[]},host){
 validateTransition(entry);if(!expectedRoleId||!expectedTitle)fail('APPLICATION_ENTRY_IDENTITY_REQUIRED');
 const original=await host.getPage(pageId),before=new URL(await original.url()),origin=before.origin;
 if(origin!==new URL(entry.evidence.detailUrl).origin)fail('APPLICATION_ENTRY_ACCOUNT_SCOPE_CHANGED');
 let target=original,targetId=pageId,clicked=false;const excluded=new Set((excludePageIds||[]).map(String));
 const inDetail=transitionLocationMatches(entry.detail.location,before.href,expectedRoleId),inForm=transitionLocationMatches(entry.form.location,before.href,expectedRoleId);
 if(inDetail&&inForm)fail('ENTRY_DETAIL_FORM_AMBIGUOUS');if(!inDetail&&!inForm)fail('APPLICATION_ENTRY_PATH_REQUIRED');
 const candidates=async()=>{const pages=await host.listPages();return pages.filter(p=>{let u;try{u=new URL(p.url);}catch{return false;}return u.origin===origin&&transitionLocationMatches(entry.form.location,u.href,expectedRoleId)&&(entry.target==='same'?p.id===pageId:entry.target==='new'?p.id!==pageId:true)&&(p.id===pageId||!excluded.has(p.id));});};
 if(inDetail){
  await readRole(original,entry.detail,expectedTitle,expectedRoleId,'detail',host);
  for(const a of entry.preActions||[]){
   const l=original.locator(a.selector);await l.waitFor({state:'visible',timeout:READY_TIMEOUT_MS});
   if(await l.count()!==1)fail('APPLICATION_ENTRY_PREACTION_CHANGED');
   if(a.label!==undefined&&(await l.innerText()).trim()!==a.label)fail('APPLICATION_ENTRY_PREACTION_CHANGED');
   if(a.method==='check'){await l.check({timeout:10000});if(!(await l.isChecked()))fail('APPLICATION_ENTRY_PRECHECK_FAILED');}
   else await l.click({timeout:10000});
  }
  // A previous interrupted call may already have opened the actual form. Reuse
  // that uniquely evidenced page instead of triggering a second application.
  // 点击前就已存在的其他标签（excludePageIds，由任务在第一次点击前登记）一律不算本次进入的申请页。
  let matches=await candidates();if(matches.length>1)fail('AMBIGUOUS_ROLE_FORM');
  if(!matches.length){const c=entry.entryLocator,l=c.selector?original.locator(c.selector):c.text?original.getByText(c.text,{exact:true}):original.getByRole(c.role,{name:c.name,exact:true});try{await l.waitFor({state:'visible',timeout:READY_TIMEOUT_MS});}catch(error){error.operationStep='entry_locator_visible';error.operationLocator=c.selector||c.text||c.name;if(await l.count()===0){error.originalMessage=error.message;error.message='BROWSER_ELEMENT_NOT_FOUND';}throw error;}if(await l.count()!==1||(await l.innerText()).trim()!==c.label)fail('APPLICATION_ENTRY_BUTTON_CHANGED');try{await l.click({timeout:10000});}catch(error){error.operationStep='entry_click';error.operationLocator=c.selector||c.text||c.name;throw error;}clicked=true;
   const now=host.now||Date.now,deadline=now()+READY_TIMEOUT_MS;do{matches=await candidates();if(matches.length)break;await host.pause(50);}while(now()<deadline);
  }
  if(!matches.length){const error=Error('BROWSER_OPERATION_TIMEOUT');error.operationStep='entry_form_navigation';error.operationLocator=entry.form.readySelector;throw error;}if(matches.length!==1)fail('AMBIGUOUS_ROLE_FORM');targetId=matches[0].id;target=await host.getPage(targetId);
 }
 const after=new URL(await target.url());if(after.origin!==origin||!transitionLocationMatches(entry.form.location,after.href,expectedRoleId))fail('APPLICATION_ENTRY_RESULT_ROLE_CHANGED');
 await target.locator(entry.form.readySelector).filter({visible:true}).first().waitFor({state:'visible',timeout:READY_TIMEOUT_MS});const actual=await readRole(target,entry.form,expectedTitle,expectedRoleId,'form',host);await host.preserve?.(pageId);await host.preserve?.(targetId);
 // The detail page actually observed (after any site redirect) is returned; when it
 // differs from the confirmed role link, a link change is proposed to the search side.
 return {pageId:targetId,pageUrl:after.href,...actual,...(inDetail?{detailUrl:before.href}:{}),entryClicked:clicked,submission:'not_performed'};
}
