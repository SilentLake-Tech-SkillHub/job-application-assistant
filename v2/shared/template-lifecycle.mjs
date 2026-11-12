import {createHash} from 'node:crypto';
import {formAssetKeys} from './form-identity.mjs';
import {unverifiedTemplate,completeFormTemplate} from './template-validation.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
// Updates replace the sole official company asset. Construction progress stores
// metadata only; no consumer can select a second template from a draft file.
export async function updateCompanyTemplate(store,{companyId,template}){
 const t=unverifiedTemplate(template),keys=formAssetKeys(t.id);
 await store.put('templates',t.id,t);
 if(hash(await store.get('templates',t.id))!==hash(t))throw Error('TEMPLATE_STORAGE_READBACK_FAILED');
 await store.put('runs',keys.update,{id:keys.update,companyId,registered:true,readyToRegister:true,blockers:[],construction:{revision:1,stage:'agent_completeness'},updatedAt:new Date().toISOString()});
 await store.remove('runs','form-draft-'+t.id);
 return t;
}
export async function constructionTemplate(store,id,expectedHash){
 const official=await store.get('templates',id);
 if(expectedHash&&hash(official)!==expectedHash)throw Error('TEMPLATE_VERSION_CHANGED');
 return official;
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
