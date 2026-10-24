import {createHash} from 'node:crypto';
import {materialKey,materialDispositionApplies} from './business-materials.mjs';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const recordKey=(context,pageUrl,key)=>digest([context.companyId,String(context.roleId),pageUrl,key]);
const scopeFor=(context,pageUrl,templateHash)=>({companyId:context.companyId,roleId:String(context.roleId),roleUrl:context.roleUrl,batchId:context.batchId,contentSha256:context.contentSha256,materialsHash:digest(context.materials),pageUrl,templateHash});

export function recordMaterialDestinationException(profile,{context,pageUrl,template,templateHash,capture,controls,key,evidence,recordedAt=new Date().toISOString()}){
 if(!evidence?.trim())throw Error('USER_MATERIAL_EXCEPTION_CONFIRMATION_REQUIRED');
 if(!context.materials.items.some(item=>item.key===key&&item.status==='available'))throw Error('AVAILABLE_ROLE_MATERIAL_REQUIRED');
 if(capture.companyId!==context.companyId||capture.pageUrl!==pageUrl||!capture.captureId||!Array.isArray(capture.controls)||!capture.controls.length||!Array.isArray(controls)||!controls.length||template.evidence.sourceUrl!==pageUrl)throw Error('MATERIAL_EXCEPTION_CAPTURE_SCOPE_MISMATCH');
 if([...capture.controls,...controls,...template.pages.flatMap(p=>p.fields)].some(field=>materialKey(field)===key))throw Error('MATERIAL_DESTINATION_EXISTS_CANNOT_EXEMPT');
 const id=recordKey(context,pageUrl,key),sourceId='material-exception-'+id;
 profile.sources??={};profile.sources[sourceId]={kind:'user_reply',evidence,recordedAt};
 profile.applicationDispositions??={};profile.applicationDispositions[context.companyId]??={};
 const records=profile.applicationDispositions[context.companyId].roleMaterials??={};
 const record={kind:'user_confirmed_no_destination',key,...scopeFor(context,pageUrl,templateHash),captureId:capture.captureId,inventoryHash:digest(controls.map(c=>({selector:c.selector,label:c.label,type:c.type}))),sourceId,recordedAt};
 records[id]=record;
 return {sourceId,key,scope:record.kind,recordId:id,submission:'not_performed'};
}

export function withMaterialDispositions(profile,context,{pageUrl,templateHash}){
 const scoped={...context,dispositionScope:scopeFor(context,pageUrl,templateHash)},dispositions={};
 for(const item of context.materials.items){
  const record=profile.applicationDispositions?.[context.companyId]?.roleMaterials?.[recordKey(context,pageUrl,item.key)],source=profile.sources?.[record?.sourceId];
  if(source?.kind==='user_reply'&&source.revoked!==true&&!source.revokedAt&&source.evidence?.trim()&&materialDispositionApplies(scoped,record,item.key))dispositions[item.key]=record;
 }
 return Object.keys(dispositions).length?{...scoped,dispositions}:context;
}

export function revokeMaterialDestinationException(profile,{context,pageUrl,key,evidence,recordedAt=new Date().toISOString()}){
 if(!evidence?.trim())throw Error('USER_MATERIAL_EXCEPTION_CONFIRMATION_REQUIRED');
 const id=recordKey(context,pageUrl,key),record=profile.applicationDispositions?.[context.companyId]?.roleMaterials?.[id];
 if(!record)throw Error('MATERIAL_EXCEPTION_NOT_FOUND');
 record.revoked=true;record.recordedAt=recordedAt;
 profile.sources[record.sourceId]={kind:'user_reply',evidence,recordedAt,revoked:true};
 return {sourceId:record.sourceId,key,scope:'revoked',recordId:id,submission:'not_performed'};
}
