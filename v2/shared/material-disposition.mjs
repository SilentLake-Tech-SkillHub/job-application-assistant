import {createHash} from 'node:crypto';
import {materialKey,materialDispositionApplies} from './business-materials.mjs';
import {samePage} from './page-scope.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
// “这家公司的表单没有这个材料的位置”是公司表单的事实：换岗位、换批次、模板改动都不影响它。
// 表单上真的出现了这个位置时，填写前的现场检查会拦下来。
const recordKey=(context,key)=>digest([context.companyId,key]);
const recordsOf=(profile,context)=>Object.values(profile.applicationDispositions?.[context.companyId]?.roleMaterials||{});

export function recordMaterialDestinationException(profile,{context,pageUrl,template,templateHash,capture,controls,key,evidence,recordedAt=new Date().toISOString()}){
 if(!evidence?.trim())throw Error('USER_MATERIAL_EXCEPTION_CONFIRMATION_REQUIRED');
 if(!context.materials.items.some(item=>item.key===key&&item.status==='available'))throw Error('AVAILABLE_ROLE_MATERIAL_REQUIRED');
 if(capture.companyId!==context.companyId||!samePage(capture.pageUrl,pageUrl)||!capture.captureId||!Array.isArray(capture.controls)||!capture.controls.length||!Array.isArray(controls)||!controls.length)throw Error('MATERIAL_EXCEPTION_CAPTURE_SCOPE_MISMATCH');
 if([...capture.controls,...controls,...template.pages.flatMap(p=>p.fields)].some(field=>materialKey(field)===key))throw Error('MATERIAL_DESTINATION_EXISTS_CANNOT_EXEMPT');
 const id=recordKey(context,key),sourceId='material-exception-'+id;
 profile.sources??={};profile.sources[sourceId]={kind:'user_reply',evidence,recordedAt};
 profile.applicationDispositions??={};profile.applicationDispositions[context.companyId]??={};
 const records=profile.applicationDispositions[context.companyId].roleMaterials??={};
 const record={kind:'user_confirmed_no_destination',key,companyId:context.companyId,captureId:capture.captureId,inventoryHash:digest(controls.map(c=>({selector:c.selector,label:c.label,type:c.type}))),sourceId,recordedAt};
 records[id]=record;
 return {sourceId,key,scope:record.kind,recordId:id,submission:'not_performed'};
}

export function withMaterialDispositions(profile,context){
 const dispositions={};
 for(const item of context.materials.items){
  const record=recordsOf(profile,context).find(r=>{const source=profile.sources?.[r.sourceId];return source?.kind==='user_reply'&&source.revoked!==true&&!source.revokedAt&&source.evidence?.trim()&&materialDispositionApplies(context,r,item.key);});
  if(record)dispositions[item.key]=record;
 }
 return Object.keys(dispositions).length?{...context,dispositions}:context;
}

export function revokeMaterialDestinationException(profile,{context,key,evidence,recordedAt=new Date().toISOString()}){
 if(!evidence?.trim())throw Error('USER_MATERIAL_EXCEPTION_CONFIRMATION_REQUIRED');
 const records=recordsOf(profile,context).filter(r=>r.key===key&&r.revoked!==true);
 if(!records.length)throw Error('MATERIAL_EXCEPTION_NOT_FOUND');
 for(const record of records){record.revoked=true;record.recordedAt=recordedAt;profile.sources[record.sourceId]={kind:'user_reply',evidence,recordedAt,revoked:true};}
 return {sourceId:records[0].sourceId,key,scope:'revoked',recordId:recordKey(context,key),submission:'not_performed'};
}
