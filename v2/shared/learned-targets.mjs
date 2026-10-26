import {readFile,writeFile,rename} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {unstableClassTokens} from './selector-stability.mjs';

// Click targets learned from real pages. When a driver's built-in target is
// missing on a site, the driver reports the row's clickable candidates; the
// maintainer shows them to the user and, on the user's confirmation, records
// one here (scripts/learned-targets.mjs). Executors only read this file. Every
// use still has to pass the driver's own post-click proof, so a wrong entry
// fails closed instead of filling a wrong value.
export const LEARNED_TARGETS_FILE=new URL('../catalog/learned-targets.json',import.meta.url);
export const DRIVERS=new Set(['phoenix_list_popup.selection','phoenix_area.selection']);
const MAX_CANDIDATES=12;

export function validTargetSelector(selector){
 return typeof selector==='string'&&selector.length<=300&&/^:scope > [A-Za-z0-9_.\-> \\]+$/.test(selector)&&!/\s>\s*$/.test(selector)&&!unstableClassTokens(selector).length;
}
function validEntry(entry){
 return entry&&DRIVERS.has(entry.driver)&&/^lt-[a-f0-9]{12}$/.test(entry.id||'')&&validTargetSelector(entry.selector);
}
export async function loadLearnedTargets(file=LEARNED_TARGETS_FILE){
 let data;try{data=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return {revision:1,targets:[]};throw error;}
 if(data?.revision!==1||!Array.isArray(data.targets)||data.targets.some(entry=>!validEntry(entry)))throw Error('LEARNED_TARGETS_INVALID');
 return data;
}
export const learnedTargetId=(driver,selector)=>'lt-'+createHash('sha256').update(driver+'\n'+selector).digest('hex').slice(0,12);

// Browser-side: the row's visible clickable candidates, described only by tag,
// role, public classes and a row-relative structural selector. No text, no
// build-generated classes, nothing outside the row.
export function targetCandidatesDOM(row){
 const visible=n=>!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
 const hashed=c=>/(?:^|__)sc-[A-Za-z0-9]{5,10}(?:-\d+)?$/.test(c)&&/[0-9]|[a-z][A-Z]/.test(c.replace(/^.*sc-/,''))||/^css-[a-z0-9]*[0-9][a-z0-9]*$/.test(c)||/___[A-Za-z0-9_-]{5}$/.test(c);
 const classes=n=>[...(n.classList||[])].filter(c=>/^[A-Za-z][\w-]*$/.test(c)&&!hashed(c)).slice(0,4);
 const step=n=>n.tagName.toLowerCase()+classes(n).map(c=>'.'+c).join('');
 const nodes=[...row.querySelectorAll('svg,button,input[type="checkbox"],input[type="radio"],[role="checkbox"],[role="radio"],[role="button"]')].filter(visible).slice(0,12);
 return nodes.map(node=>{
  const chain=[];for(let n=node;n&&n!==row;n=n.parentElement)chain.unshift(step(n));
  const selector=':scope > '+chain.join(' > ');let matches=0;try{matches=[...row.querySelectorAll(selector)].filter(visible).length;}catch{}
  return {tag:node.tagName.toLowerCase(),role:node.getAttribute('role'),classes:classes(node),checked:node.getAttribute('aria-checked')==='true'||node.checked===true,selector,matches};
 });
}
export function safeTargetCandidates(value){
 if(!Array.isArray(value))return [];
 return value.slice(0,MAX_CANDIDATES).filter(c=>c&&typeof c==='object'&&/^[a-z][a-z0-9-]*$/.test(c.tag||'')&&(c.role===null||/^[a-z]+$/.test(c.role||''))&&Array.isArray(c.classes)&&c.classes.length<=4&&c.classes.every(x=>typeof x==='string'&&/^[A-Za-z][\w-]*$/.test(x)&&!unstableClassTokens('.'+x).length)&&typeof c.checked==='boolean'&&validTargetSelector(c.selector)&&Number.isInteger(c.matches)&&c.matches>=0&&c.matches<=1000)
  .map(c=>({tag:c.tag,role:c.role,classes:[...c.classes],checked:c.checked,selector:c.selector,matches:c.matches}));
}

// Driver-side: the built-in target first, then targets learned for this
// driver. None unique → the row's candidates go back to the Agent.
export async function resolveTarget(row,{driver,builtIn,code},{load=loadLearnedTargets}={}){
 if(!DRIVERS.has(driver))throw Error('LEARNED_TARGET_DRIVER_UNKNOWN');
 const learned=(await load()).targets.filter(entry=>entry.driver===driver);
 for(const [selector,id] of [[builtIn,null],...learned.map(entry=>[entry.selector,entry.id])]){
  const locator=row.locator(selector).filter({visible:true});
  if(await locator.count()===1)return {locator,source:id?'learned':'built_in',...(id?{learnedTargetId:id}:{})};
 }
 let candidates=[];try{candidates=safeTargetCandidates(await row.evaluate(targetCandidatesDOM));}catch{}
 const error=Error(code);error.details={phase:'driver_target_gap',driver,candidates};throw error;
}

// Maintainer-side, after the user's confirmation only.
export async function addLearnedTarget({driver,selector,evidence,quote},file=LEARNED_TARGETS_FILE){
 if(!DRIVERS.has(driver)||!validTargetSelector(selector))throw Error('LEARNED_TARGET_INVALID');
 if(typeof quote!=='string'||!quote.trim())throw Error('USER_CONFIRMATION_QUOTE_REQUIRED');
 if(!/^[\w.:-]{1,80}$/.test(evidence?.runId||'')||!/^[\w-]{1,60}$/.test(evidence?.companyId||''))throw Error('LEARNED_TARGET_EVIDENCE_REQUIRED');
 const data=await loadLearnedTargets(file),id=learnedTargetId(driver,selector);
 const entry={id,driver,selector,evidence:{runId:evidence.runId,companyId:evidence.companyId},approval:{at:new Date().toISOString(),quoteSha256:createHash('sha256').update(quote.trim()).digest('hex')}};
 data.targets=[...data.targets.filter(t=>t.id!==id),entry];
 const tmp=new URL(file.href+'.tmp');await writeFile(tmp,JSON.stringify(data,null,1)+'\n');await rename(tmp,file);
 return entry;
}
export async function removeLearnedTarget(id,file=LEARNED_TARGETS_FILE){
 const data=await loadLearnedTargets(file),before=data.targets.length;data.targets=data.targets.filter(t=>t.id!==id);
 if(data.targets.length===before)throw Error('LEARNED_TARGET_NOT_FOUND');
 const tmp=new URL(file.href+'.tmp');await writeFile(tmp,JSON.stringify(data,null,1)+'\n');await rename(tmp,file);
}
