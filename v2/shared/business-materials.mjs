import {createHash} from 'node:crypto';

// Role materials are owned by the confirmed handoff, never by personal facts.
export const MATERIAL_SOURCES = Object.freeze({referralCode:'material:referralCode'});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const normalize=text=>String(text||'').normalize('NFKC').toLowerCase().replace(/请输入|请填写|选填|非必填|optional/gu,'').replace(/[\s*＊:：()（）]/gu,'');
export function materialKey(field){
 if(field.source===MATERIAL_SOURCES.referralCode)return 'referralCode';
 const labels=[field.label,field.inventoryLabel,field.placeholder];
 // Only an explicitly observed placeholder can supplement a missing label.
 for(const selector of [field.selector,field.read?.selector,...(field.inventorySelectors||[])]){
  const match=typeof selector==='string'&&selector.match(/\[placeholder=["']([^"']+)["']\]/);if(match)labels.push(match[1]);
 }
 return labels.some(label=>['推荐码','内推码','referralcode','employeereferralcode','referral code'].includes(normalize(label)))?'referralCode':null;
}
export function validateMaterials(materials){
 if(!materials||materials.schemaVersion!==1||!Array.isArray(materials.items))throw Error('ROLE_MATERIALS_REQUIRED');
 const keys=new Set();
 for(const item of materials.items){
  if(!Object.hasOwn(MATERIAL_SOURCES,item.key)||keys.has(item.key)||!['available','absent','unresolved'].includes(item.status)||item.requireWhenAvailable!==true||!item.evidence?.masterDataSha256||!item.evidence?.roleUrl||typeof item.raw!=='string')throw Error('INVALID_ROLE_MATERIALS');
  if(item.status==='available'&&(typeof item.value!=='string'||!/^[A-Za-z0-9_-]{3,64}$/.test(item.value)))throw Error('INVALID_ROLE_MATERIAL_VALUE');
  if(item.status!=='available'&&item.value!=null)throw Error('INVALID_ROLE_MATERIAL_VALUE');
  keys.add(item.key);
 }
 if(!keys.has('referralCode'))throw Error('ROLE_MATERIAL_INVENTORY_INCOMPLETE');
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
export function materialAudit(fields,task){
 const context=task.materialContext;if(!context)return {enabled:false,complete:true,requirements:[],blockers:[]};
 validateMaterials(context.materials);
 if(context.companyId!==task.companyId||task.roleId&&String(context.roleId)!==String(task.roleId))throw Error('ROLE_MATERIAL_SCOPE_MISMATCH');
 const requirements=[],blockers=[];
 for(const item of context.materials.items){
  const source=MATERIAL_SOURCES[item.key],matches=fields.filter(f=>materialKey(f)===item.key);
  if(item.status==='unresolved'){blockers.push('ROLE_MATERIAL_REQUIRES_RESOLUTION');continue;}
  if(item.status!=='available')continue;
  if(!matches.length)blockers.push('ROLE_MATERIAL_DESTINATION_REQUIRED');
  for(const field of matches){
   if(field.source!==source)blockers.push('ROLE_MATERIAL_MAPPING_REQUIRED');
   if(field.userOnly||field.when&&task.values?.[field.when.source]!==field.when.equals)blockers.push('REQUIRED_MATERIAL_NOT_EXECUTABLE');
   if(task.values?.[source]!==item.value)blockers.push('ROLE_MATERIAL_VALUE_NOT_RESOLVED');
   if(task.omissions?.[field.id])blockers.push('REQUIRED_MATERIAL_CANNOT_BE_OMITTED');
   requirements.push({key:item.key,fieldId:field.id,source,value:item.value,required:true});
  }
 }
 return {enabled:true,contextHash:digest(context),materialsHash:digest(context.materials),complete:blockers.length===0,requirements,blockers:[...new Set(blockers)]};
}
export function effectiveRequired(field,task){
 const key=materialKey(field);
 return !!field.required||!!key&&task.materialContext?.materials?.items.some(item=>item.key===key&&item.status==='available'&&item.requireWhenAvailable);
}
export function verifyMaterialCoverage(expected,observed){
 const audit=expected.materialAudit;if(!audit?.enabled)return {enabled:false,complete:true,checks:[]};
 const checks=audit.blockers.map(reason=>({id:'material:contract',status:'invalid',reason}));
 for(const requirement of audit.requirements){
  const field=expected.fields.find(f=>f.id===requirement.fieldId),actual=observed.fields?.[requirement.fieldId];
  const ok=field?.value===requirement.value&&actual?.present===true&&actual.value===requirement.value&&!actual.errors?.length;
  checks.push({id:'material:'+requirement.key+':'+requirement.fieldId,status:ok?'match':'mismatch',reason:ok?null:'REQUIRED_MATERIAL_READBACK_FAILED'});
 }
 return {enabled:true,contextHash:audit.contextHash,materialsHash:audit.materialsHash,complete:checks.every(c=>c.status==='match'),checks};
}
