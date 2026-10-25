import {createHash} from 'node:crypto';import {readFileSync} from 'node:fs';

// Role materials are owned by the confirmed handoff, never by personal facts.
// Definitions live only in catalog/role-materials.json (one entry per material).
export const MATERIAL_DEFINITIONS=Object.freeze(JSON.parse(readFileSync(new URL('../catalog/role-materials.json',import.meta.url),'utf8')).materials.map(d=>Object.freeze({...d,labels:Object.freeze([...d.labels])})));
export const MATERIAL_SOURCES = Object.freeze(Object.fromEntries(MATERIAL_DEFINITIONS.map(d=>[d.key,d.source])));
const definitionOf=key=>MATERIAL_DEFINITIONS.find(d=>d.key===key);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/请输入|请填写|选填|非必填|optional/gu,'').replace(/[\s*＊:：()（）]/gu,'');
export function materialKey(field){
 const bySource=MATERIAL_DEFINITIONS.find(d=>d.source===field.source);if(bySource)return bySource.key;
 const labels=[field.label,field.inventoryLabel,field.placeholder];
 // Only an explicitly observed placeholder can supplement a missing label.
 for(const selector of [field.selector,field.read?.selector,...(field.inventorySelectors||[])]){
  const match=typeof selector==='string'&&selector.match(/\[placeholder=["']([^"']+)["']\]/);if(match)labels.push(match[1]);
 }
 const normalized=labels.map(normalize);
 return MATERIAL_DEFINITIONS.find(d=>d.labels.some(label=>normalized.includes(label)))?.key||null;
}
export function validateMaterials(materials){
 if(!materials||materials.schemaVersion!==1||!Array.isArray(materials.items))throw Error('ROLE_MATERIALS_REQUIRED');
 const keys=new Set();
 for(const item of materials.items){
  if(!Object.hasOwn(MATERIAL_SOURCES,item.key)||keys.has(item.key)||!['available','absent','unresolved'].includes(item.status)||item.requireWhenAvailable!==true||!item.evidence?.masterDataSha256||!item.evidence?.roleUrl||typeof item.raw!=='string')throw Error('INVALID_ROLE_MATERIALS');
  if(item.status==='available'&&(typeof item.value!=='string'||!new RegExp(definitionOf(item.key).value).test(item.value)))throw Error('INVALID_ROLE_MATERIAL_VALUE');
  if(item.status!=='available'&&item.value!=null)throw Error('INVALID_ROLE_MATERIAL_VALUE');
  keys.add(item.key);
 }
 if(MATERIAL_DEFINITIONS.some(d=>d.requiredInInventory&&!keys.has(d.key)))throw Error('ROLE_MATERIAL_INVENTORY_INCOMPLETE');
 return materials;
}
export function resolveMaterialValues(context){
 if(!context?.batchId||!context?.contentSha256||!context.companyId||!context.roleId)throw Error('CONFIRMED_MATERIAL_CONTEXT_REQUIRED');
 validateMaterials(context.materials);
 const values={},sources={},omissions={};
 for(const item of context.materials.items){
  const source=MATERIAL_SOURCES[item.key];values[source]=item.status==='available'?item.value:undefined;
  sources[source]={kind:'confirmed_role_material',batchId:context.batchId,contentSha256:context.contentSha256,evidence:item.evidence};
  if(item.status==='absent')omissions[source]={kind:'confirmed_absent',evidence:JSON.stringify(sources[source])};
 }
 return {values,sources,omissions,materialContext:context};
}
export function materialDispositionApplies(context,record,key){
 const scope=context.dispositionScope;
 return !!scope&&record?.kind==='user_confirmed_no_destination'&&record.revoked!==true&&record.key===key&&!!record.captureId&&!!record.inventoryHash&&!!record.sourceId&&!!record.recordedAt&&
  scope.companyId===context.companyId&&scope.roleId===String(context.roleId)&&scope.roleUrl===context.roleUrl&&scope.batchId===context.batchId&&scope.contentSha256===context.contentSha256&&scope.materialsHash===digest(context.materials)&&
  typeof scope.pageUrl==='string'&&new URL(scope.pageUrl).origin===new URL(context.roleUrl).origin&&typeof scope.templateHash==='string'&&/^[a-f0-9]{64}$/.test(scope.templateHash)&&
  ['companyId','roleId','roleUrl','batchId','contentSha256','materialsHash','pageUrl','templateHash'].every(k=>record[k]===scope[k]);
}
export function materialAudit(fields,task){
 const context=task.materialContext;if(!context)return {enabled:false,complete:true,requirements:[],blockers:[]};
 validateMaterials(context.materials);
 if(context.companyId!==task.companyId||task.roleId&&String(context.roleId)!==String(task.roleId))throw Error('ROLE_MATERIAL_SCOPE_MISMATCH');
 const requirements=[],blockers=[],exceptions=[];
 for(const item of context.materials.items){
  const source=MATERIAL_SOURCES[item.key],matches=fields.filter(f=>materialKey(f)===item.key);
  if(item.status==='unresolved'){blockers.push('ROLE_MATERIAL_REQUIRES_RESOLUTION');continue;}
  if(item.status!=='available')continue;
  if(!matches.length){
   const record=context.dispositions?.[item.key];
   if(materialDispositionApplies(context,record,item.key)&&context.dispositionScope.pageUrl===task.pageUrl&&context.dispositionScope.templateHash===task.templateHash)exceptions.push({key:item.key,kind:record.kind,sourceId:record.sourceId,captureId:record.captureId,inventoryHash:record.inventoryHash});
   else blockers.push('ROLE_MATERIAL_DESTINATION_REQUIRED');
  }
  for(const field of matches){
   if(field.source!==source)blockers.push('ROLE_MATERIAL_MAPPING_REQUIRED');
   if(field.userOnly||field.when&&task.values?.[field.when.source]!==field.when.equals)blockers.push('REQUIRED_MATERIAL_NOT_EXECUTABLE');
   if(task.values?.[source]!==item.value)blockers.push('ROLE_MATERIAL_VALUE_NOT_RESOLVED');
   if(task.omissions?.[field.id])blockers.push('REQUIRED_MATERIAL_CANNOT_BE_OMITTED');
   requirements.push({key:item.key,fieldId:field.id,source,value:item.value,required:true});
  }
 }
 return {enabled:true,contextHash:digest(context),materialsHash:digest(context.materials),complete:blockers.length===0,requirements,exceptions,blockers:[...new Set(blockers)]};
}
export function assertMaterialDestinationsRemainAbsent(audit,inventory){
 if(!audit?.exceptions?.length)return;
 if(!Array.isArray(inventory))throw Error('MATERIAL_DESTINATION_INVENTORY_REQUIRED');
 if(inventory.some(control=>audit.exceptions.some(exception=>materialKey(control)===exception.key)))throw Error('MATERIAL_DESTINATION_APPEARED_EXCEPTION_INVALID');
}
export function effectiveRequired(field,task){
 const key=materialKey(field);
 return !!field.required||!!key&&task.materialContext?.materials?.items.some(item=>item.key===key&&item.status==='available'&&item.requireWhenAvailable);
}
export function verifyMaterialCoverage(expected,observed){
 const audit=expected.materialAudit;if(!audit?.enabled)return {enabled:false,complete:true,checks:[]};
 const checks=audit.blockers.map(reason=>({id:'material:contract',status:'invalid',reason}));
 for(const exception of audit.exceptions||[]){
  const captured=Array.isArray(observed.materialDestinationKeys),exists=captured&&observed.materialDestinationKeys.includes(exception.key);
  checks.push({id:'material:'+exception.key,status:captured&&!exists?'confirmed_omission':'invalid',reason:!captured?'MATERIAL_DESTINATION_INVENTORY_REQUIRED':exists?'MATERIAL_DESTINATION_APPEARED_EXCEPTION_INVALID':'USER_CONFIRMED_NO_DESTINATION',sourceId:exception.sourceId});
 }
 for(const requirement of audit.requirements){
  const field=expected.fields.find(f=>f.id===requirement.fieldId),actual=observed.fields?.[requirement.fieldId];
  const ok=field?.value===requirement.value&&actual?.present===true&&actual.value===requirement.value&&!actual.errors?.length;
  checks.push({id:'material:'+requirement.key+':'+requirement.fieldId,status:ok?'match':'mismatch',reason:ok?null:'REQUIRED_MATERIAL_READBACK_FAILED'});
 }
 return {enabled:true,contextHash:audit.contextHash,materialsHash:audit.materialsHash,complete:checks.every(c=>['match','confirmed_omission'].includes(c.status)),checks};
}
