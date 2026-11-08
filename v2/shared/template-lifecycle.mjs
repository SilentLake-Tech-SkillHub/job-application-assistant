import {createHash} from 'node:crypto';
import {formAssetKeys} from './form-identity.mjs';
import {draftTemplate,completeFormTemplate} from './template-validation.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export async function registerFormDraft(store,{companyId,template}){
 const t=draftTemplate(template),id=formAssetKeys(t.id).draft;
 let previous;try{previous=await store.get('runs',id);}catch(e){if(e.code!=='ENOENT')throw e;}
 const construction=previous?.construction?{revision:1,stage:'interaction_test',captureHash:previous.construction.captureHash}:undefined;
 await store.put('runs',id,{id,companyId,template:t,registered:true,readyToRegister:true,blockers:[],...(construction?{construction}:{}),registeredAt:new Date().toISOString()});
 if(hash((await store.get('runs',id)).template)!==hash(t))throw Error('TEMPLATE_STORAGE_READBACK_FAILED');
 return t;
}
export async function constructionTemplate(store,id,expectedHash){
 let draft;try{draft=await store.get('runs',formAssetKeys(id).draft);}catch(e){if(e.code!=='ENOENT')throw e;}
 if(draft?.registered&&(!expectedHash||hash(draft.template)===expectedHash))return draft.template;
 const official=await store.get('templates',id);if(expectedHash&&hash(official)!==expectedHash)throw Error('TEMPLATE_VERSION_CHANGED');return official;
}
export async function promoteSealedTemplate(store,{companyId,template,probe,profileMapped=true,channel='chrome',beforeCommit=async()=>{},validate=()=>{},confirmation=null}){
 const sealed=completeFormTemplate(template,probe,{companyId,profileMapped,channel});
 if(confirmation)sealed.construction=confirmation;
 const proof={...probe,id:'sealed-probe-'+sealed.id,sourceRunId:probe.id};sealed.coverage.proof.runId=proof.id;validate(sealed);
 let oldProof,oldTemplate;
 for(const [group,id,set]of [['runs',proof.id,v=>oldProof=v],['templates',sealed.id,v=>oldTemplate=v]])try{set(await store.get(group,id));}catch(e){if(e.code!=='ENOENT')throw e;}
 let undoProfile;
 try{
  // These evidence records and the final template are replaced while the
  // caller holds the company lease. A failed promotion restores old records.
  await store.put('runs',proof.id,proof,{sealPromotion:{template:sealed,companyId}});
  undoProfile=await beforeCommit(sealed);
  await store.put('templates',sealed.id,sealed);
 }catch(error){
  if(undoProfile)await undoProfile();
  if(oldProof)await store.put('runs',proof.id,oldProof,{sealPromotion:{template:oldTemplate,companyId}});else await store.remove('runs',proof.id);
  throw error;
 }
 return sealed;
}
