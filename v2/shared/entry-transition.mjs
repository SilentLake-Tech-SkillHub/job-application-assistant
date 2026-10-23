// Declarative, evidence-bound navigation shared by every browser executor.
// This module never builds an application URL and never clicks on a form page.
import {READY_TIMEOUT_MS} from './entry-recipe.mjs';
const fail=code=>{throw Error(code);};
const pattern=(value)=>{if(typeof value!=='string'||!value.startsWith('^')||!value.endsWith('$')||value.length>500)fail('ENTRY_LOCATION_PATTERN_REQUIRED');try{return new RegExp(value);}catch{fail('ENTRY_LOCATION_PATTERN_INVALID');}};
export function validateTransition(entry){
 if(entry?.kind!=='declarative_transition')fail('ROLE_ENTRY_RECIPE_REQUIRED');
 for(const phase of ['detail','form']){
  const p=entry[phase],l=p?.location;if(!l||!l.pathnamePattern)fail('ENTRY_LOCATION_PATTERN_REQUIRED');pattern(l.pathnamePattern);if(l.hashPathPattern)pattern(l.hashPathPattern);
  for(const map of [l.query,l.hashQuery])if(map&&(typeof map!=='object'||Array.isArray(map)||Object.entries(map).some(([k,v])=>!k||typeof v!=='string'||!v)))fail('ENTRY_LOCATION_QUERY_INVALID');
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
export function transitionRoleIdentity(spec,url){
 if(!spec)return null;const u=new URL(url);let value;
 if(spec.source==='query')value=u.searchParams.getAll(spec.parameter).length===1?u.searchParams.get(spec.parameter):null;
 else if(spec.source==='hashQuery'){const p=hashParts(u).query;value=p.getAll(spec.parameter).length===1?p.get(spec.parameter):null;}
 else if(spec.source==='hashPath')value=pattern(spec.pattern).exec(hashParts(u).path)?.groups?.[spec.parameter]||null;
 else value=pattern(spec.pattern).exec(u.pathname)?.groups?.[spec.parameter]||null;
 return {parameter:spec.parameter,value,source:spec.source};
}
async function readRole(page,spec,expectedTitle,expectedRoleId){
 let roleTitle=null;if(spec.roleSelector){const l=page.locator(spec.roleSelector);await l.waitFor({state:'visible',timeout:READY_TIMEOUT_MS});if(await l.count()!==1)fail('APPLICATION_ENTRY_ROLE_CHANGED');roleTitle=(await l.innerText()).trim();if(spec.rolePrefix){if(!roleTitle.startsWith(spec.rolePrefix))fail('APPLICATION_ENTRY_ROLE_CHANGED');roleTitle=roleTitle.slice(spec.rolePrefix.length).trim();}if(roleTitle!==expectedTitle)fail('APPLICATION_ENTRY_ROLE_CHANGED');}
 const roleIdentity=transitionRoleIdentity(spec.roleIdentity,await page.url());if(roleIdentity&&roleIdentity.value!==expectedRoleId)fail('APPLICATION_ENTRY_RESULT_ROLE_CHANGED');
 return {roleTitle,...(roleIdentity?{roleIdentity}:{})};
}
export async function executeTransition({entry,pageId,expectedTitle,expectedRoleId,expectedAccount,accountSelector,sessionAccountPageUrl},host){
 validateTransition(entry);if(!expectedRoleId||!expectedTitle||!expectedAccount||!accountSelector)fail('APPLICATION_ENTRY_IDENTITY_REQUIRED');
 const original=await host.getPage(pageId),before=new URL(await original.url()),origin=before.origin;
 if(origin!==new URL(entry.evidence.detailUrl).origin||sessionAccountPageUrl&&new URL(sessionAccountPageUrl).origin!==origin)fail('APPLICATION_ENTRY_ACCOUNT_SCOPE_CHANGED');
 let target=original,targetId=pageId,clicked=false;
 const readAccount=async()=>{
  const current=target.locator(accountSelector).filter({visible:true}),currentCount=await current.count();if(currentCount>1)fail('APPLICATION_ENTRY_ACCOUNT_CHANGED');if(currentCount===1){if((await current.innerText()).trim()!==expectedAccount)fail('APPLICATION_ENTRY_ACCOUNT_CHANGED');return;}
  if(!sessionAccountPageUrl)fail('APPLICATION_ENTRY_ACCOUNT_CHANGED');
  if(new URL(sessionAccountPageUrl).origin!==origin)fail('APPLICATION_ENTRY_ACCOUNT_SCOPE_CHANGED');
  const matches=(await host.listPages()).filter(p=>p.url===sessionAccountPageUrl);if(matches.length!==1)fail('SESSION_IDENTITY_PAGE_NOT_UNIQUE');
  const proof=await host.getPage(matches[0].id),l=proof.locator(accountSelector).filter({visible:true});
  if(await l.count()!==1||(await l.innerText()).trim()!==expectedAccount)fail('APPLICATION_ENTRY_ACCOUNT_CHANGED');
 };
 await readAccount();
 const inDetail=transitionLocationMatches(entry.detail.location,before.href,expectedRoleId),inForm=transitionLocationMatches(entry.form.location,before.href,expectedRoleId);
 if(inDetail&&inForm)fail('ENTRY_DETAIL_FORM_AMBIGUOUS');if(!inDetail&&!inForm)fail('APPLICATION_ENTRY_PATH_REQUIRED');
 const candidates=async()=>{const pages=await host.listPages();return pages.filter(p=>{let u;try{u=new URL(p.url);}catch{return false;}return u.origin===origin&&transitionLocationMatches(entry.form.location,u.href,expectedRoleId)&&(entry.target==='same'?p.id===pageId:entry.target==='new'?p.id!==pageId:true);});};
 if(inDetail){
  await readRole(original,entry.detail,expectedTitle,expectedRoleId);
  for(const a of entry.preActions||[]){
   const l=original.locator(a.selector);await l.waitFor({state:'visible',timeout:READY_TIMEOUT_MS});
   if(await l.count()!==1)fail('APPLICATION_ENTRY_PREACTION_CHANGED');
   if(a.label!==undefined&&(await l.innerText()).trim()!==a.label)fail('APPLICATION_ENTRY_PREACTION_CHANGED');
   if(a.method==='check'){await l.check({timeout:10000});if(!(await l.isChecked()))fail('APPLICATION_ENTRY_PRECHECK_FAILED');}
   else await l.click({timeout:10000});
  }
  // A previous interrupted call may already have opened the actual form. Reuse
  // that uniquely evidenced page instead of triggering a second application.
  let matches=await candidates();if(matches.length>1)fail('AMBIGUOUS_ROLE_FORM');
  if(!matches.length){const c=entry.entryLocator,l=c.selector?original.locator(c.selector):c.text?original.getByText(c.text,{exact:true}):original.getByRole(c.role,{name:c.name,exact:true});await l.waitFor({state:'visible',timeout:READY_TIMEOUT_MS});if(await l.count()!==1||(await l.innerText()).trim()!==c.label)fail('APPLICATION_ENTRY_BUTTON_CHANGED');await l.click({timeout:10000});clicked=true;
   const deadline=Date.now()+READY_TIMEOUT_MS;do{matches=await candidates();if(matches.length)break;await host.pause(50);}while(Date.now()<deadline);
  }
  if(matches.length!==1)fail(matches.length?'AMBIGUOUS_ROLE_FORM':'ROLE_FORM_NOT_OPEN');targetId=matches[0].id;target=await host.getPage(targetId);
 }
 const after=new URL(await target.url());if(after.origin!==origin||!transitionLocationMatches(entry.form.location,after.href,expectedRoleId))fail('APPLICATION_ENTRY_RESULT_ROLE_CHANGED');
 await target.locator(entry.form.readySelector).filter({visible:true}).first().waitFor({state:'visible',timeout:READY_TIMEOUT_MS});const actual=await readRole(target,entry.form,expectedTitle,expectedRoleId);await readAccount();await host.preserve?.(pageId);await host.preserve?.(targetId);
 return {pageId:targetId,pageUrl:after.href,...actual,entryClicked:clicked,accountMatched:true,submission:'not_performed'};
}
