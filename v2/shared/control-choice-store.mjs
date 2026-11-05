import {createHash} from 'node:crypto';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const formScope=url=>{const u=new URL(url);return u.origin+u.pathname;};
// Identity uses an allocated ordinal within the form, never a content hash.
// Values and live selected state are excluded from the control definition.
export function controlDefinition(control){
 const keys=['selector','label','type','tag','renderer','required','fieldKey','group','repeatIndex','questionSelector','options','optionRecords','inlineOngoing'];
 return Object.fromEntries(keys.filter(k=>control[k]!==undefined).map(k=>[k,k==='optionRecords'?control[k].map(({selected,...o})=>o):control[k]]));
}
export const controlDefinitionHash=c=>hash(controlDefinition(c));
export const controlInventoryHash=c=>hash((c.controls||[]).map(controlDefinition));
export function retainControlChoices(asset,capture){
 if(!asset||asset.companyId!==capture.companyId||asset.formId!==capture.formId)return [];
 return (asset.choices||[]).filter(choice=>{
  const field=capture.controls.find(c=>c.selector===choice.selector);
  return field?choice.definitionHash===controlDefinitionHash(field):Number.isInteger(choice.definition?.repeatIndex)&&choice.definition.repeatIndex>0&&!!choice.definition.group;
 });
}
export function bindControlChoices({capture,choices,previous}){
 let sequence=Math.max(previous?.controlSequence||0,0,...(previous?.choices||[]).map(c=>Number(c.controlId?.split('-').at(-1))||0));
 const prior=new Map((previous?.choices||[]).map(c=>[c.selector,c]));
 const unique=new Map();
 for(const choice of choices){
  const control=capture.controls.find(c=>c.selector===choice.selector)||prior.get(choice.selector)?.definition;if(!control)throw Error('CHOICE_SELECTOR_NOT_CAPTURED');
  const old=prior.get(choice.selector),controlId=old?.controlId||choice.controlId||'control-'+String(++sequence).padStart(6,'0');
  unique.set(controlId,{...choice,controlId,formId:capture.formId,scope:formScope(capture.pageUrl),definition:controlDefinition(control),definitionHash:controlDefinitionHash(control)});
 }
 return {id:'choices-'+capture.formId,companyId:capture.companyId,formId:capture.formId,pageUrl:capture.pageUrl,captureId:capture.captureId,captureHash:hash({companyId:capture.companyId,pageUrl:capture.pageUrl,provider:capture.provider??null,controls:capture.controls}),controlSequence:sequence,choices:[...unique.values()]};
}

// Missing extra repeat rows are recreated by the frozen page groups. Their
// absence is not a new question or changed definition. Other removals differ.
export function compatibleInventory(baseline,current){
 const prior=new Map((baseline.controls||[]).map(c=>[c.selector,c])),seen=new Set();
 for(const c of current.controls||[]){const old=prior.get(c.selector);if(!old||controlDefinitionHash(old)!==controlDefinitionHash(c))return false;seen.add(c.selector);}
 return (baseline.controls||[]).filter(c=>!seen.has(c.selector)).every(c=>Number.isInteger(c.repeatIndex)&&c.repeatIndex>0&&!!c.group);
}
