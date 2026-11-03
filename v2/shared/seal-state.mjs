import {createHash} from 'node:crypto';
import {assertAcquisitionChain,assertAcquiredStructure,originalStructureCapture} from './acquisition-chain.mjs';
import {assertSealContract,sealedContractHash} from './form-seal.mjs';
import {optionHash,assertStoredChoiceResolutions} from './choice-resolution.mjs';
import {templateConstructionIssues} from './field-policy.mjs';
import {formAssetKeys} from './form-identity.mjs';
import {controlInventoryHash,compatibleInventory,formScope} from './control-choice-store.mjs';
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const choiceDigest=asset=>hash((asset?.choices||[]).map(c=>({selector:c.selector,optionsHash:optionHash(c),restored:c.restored,status:c.status})));
export const sealKey=t=>'seal-'+t.id;
const result=(reason,blockers=[])=>({status:reason==='valid'?'sealed':'unsealed',reason,route:({valid:'reuse',contract_upgrade:'migrate',page_changed:'incremental',not_built_or_evidence_missing:'acquire'})[reason],blockers});
const read=async(store,group,id)=>{try{return await store.get(group,id);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
export const structureBaseline=(structure,capture)=>structure.baselineCapture||capture;
export async function certifySeal(store,template,companyId){
 await assertAcquisitionChain(template,{store,companyId});
 const probe=await store.get('runs',template.coverage?.proof?.runId);
 assertSealContract(template,probe,companyId);await assertStoredChoiceResolutions(template,{store,companyId});
 if(!['allConditionalBranchesVerified','allControlsMapped','allDriversSupported'].every(k=>template.coverage?.[k]===true))throw Error('SEAL_COVERAGE_REQUIRED');
 const keys=formAssetKeys(template.evidence.formId),latestCapture=await store.get('runs',keys.capture);
 const rawStructure=await store.get('runs',keys.structure),previous=await read(store,'runs',sealKey(template));
 const original=previous?.certifiedCapture||originalStructureCapture(rawStructure,latestCapture),capture=compatibleInventory(original,latestCapture)&&template.evidence.pipeline.captureHash===hash({companyId:original.companyId,pageUrl:original.pageUrl,provider:original.provider??null,controls:original.controls})?original:latestCapture;
 const structure=await store.get('runs',keys.structure),receipt=await store.get('runs',keys.receipt);let choiceAsset;try{choiceAsset=await store.get('runs',keys.choices);}catch(e){if(e.code!=='ENOENT')throw e;}
 const record={contractRevision:7,structureHash:hash(structure),acquisitionReceipt:receipt,receiptHash:hash(receipt),choicesHash:choiceDigest(choiceAsset),id:sealKey(template),operation:'form_seal',formId:template.id,companyId,templateHash:hash(template),contractHash:sealedContractHash(template),proofRunId:probe.id,proofHash:hash(probe),sealedAt:new Date().toISOString(),inventoryHash:controlInventoryHash(capture),certifiedCapture:capture,baselineCapture:previous?.baselineCapture||originalStructureCapture(rawStructure,latestCapture)};
 await store.put('runs',record.id,record);return record;
}
// Read-only classification: format drift must never be reported as a page edit.
export async function storedSeal(store,template,companyId){
 if(!template)return result('not_built_or_evidence_missing',['COMPANY_FORM_ASSET_MISSING']);
 const fields=template.pages?.flatMap(p=>p.fields)||[];if(fields.filter(f=>!f.userOnly&&!f.readonly).some(f=>[f.read?.selector,...(f.inventorySelectors||[]),...(f.actions||[]).flatMap(a=>[a.selector,a.labelSelector,a.openSelector])].some(s=>/^\s*(?:html\s*>\s*)?body\s*>/i.test(s||'')&&/:nth-(?:of-type|child)\(/.test(s))))return result('not_built_or_evidence_missing',['PAGE_GLOBAL_POSITIONAL_LOCATORS']);
 const issues=templateConstructionIssues(template);if(issues.length)return result('not_built_or_evidence_missing',[...new Set(issues.map(i=>i.reason))]);
 const formId=template.evidence?.formId||template.id;
 let keys;try{keys=formAssetKeys(formId);}catch{return result('not_built_or_evidence_missing',['FORM_CODE_REQUIRED']);}
 const [capture,structure,latestReceipt,proof,record]=await Promise.all([
  read(store,'runs',keys.capture),read(store,'runs',keys.structure),read(store,'runs',keys.receipt),template.coverage?.proof?.runId?read(store,'runs',template.coverage.proof.runId):null,read(store,'runs',sealKey(template))
 ]);
 const receipt=record?.operation==='form_seal'&&record.templateHash===hash(template)?record.acquisitionReceipt||latestReceipt:latestReceipt;
 if(!capture||!structure||!receipt||!proof)return result('not_built_or_evidence_missing',[!proof?'SEAL_PROBE_EVIDENCE_MISSING':'ACQUISITION_EVIDENCE_MISSING']);
 if(capture.companyId!==companyId||capture.formId!==formId||formScope(capture.pageUrl)!==formScope(template.evidence.sourceUrl))return result('not_built_or_evidence_missing',['FORM_EVIDENCE_SCOPE_CHANGED']);
 const certificate=record?.operation==='form_seal'?record:null;
 let baseline;try{baseline=structure.baselineCapture||certificate?.baselineCapture||originalStructureCapture(structure,capture);}catch(e){return result('not_built_or_evidence_missing',[e.message]);}
 const oldInventory=certificate?.inventoryHash||controlInventoryHash({controls:structure.controls});
 if(oldInventory!==controlInventoryHash(capture)&&!compatibleInventory(certificate?.certifiedCapture||baseline,capture))return result('page_changed',['CONTROL_DEFINITION_CHANGED']);
 if(certificate?.contractRevision===7&&certificate.templateHash===hash(template)&&certificate.contractHash===sealedContractHash(template)&&certificate.proofRunId===proof.id&&certificate.proofHash===hash(proof)&&certificate.structureHash===hash(structure)&&certificate.receiptHash===hash(receipt)){
  const choices=await read(store,'runs',keys.choices);if(certificate.choicesHash===choiceDigest(choices))return {...result('valid'),certification:'persisted'};
 }
 try{assertAcquiredStructure(structure,baseline,companyId);}catch(error){
  // Original raw evidence is intact only if its recorded baseline validates.
  return result('not_built_or_evidence_missing',[error.message]);
 }
 const errors=[];
 try{await assertAcquisitionChain(template,{store,companyId});}catch(e){errors.push(e.message);}
 try{assertSealContract(template,proof,companyId);}catch(e){errors.push(e.message);}
 try{await assertStoredChoiceResolutions(template,{store,companyId});}catch(e){errors.push(e.code==='ENOENT'?'CHOICE_EVIDENCE_MISSING':e.message);}
 if(!['allConditionalBranchesVerified','allControlsMapped','allDriversSupported'].every(k=>template.coverage?.[k]===true))errors.push('SEAL_COVERAGE_REQUIRED');
 if(errors.some(e=>/MISSING|REQUIRED/.test(e)&&!/COMPLETE_EXECUTION_CONTRACT_REQUIRED|MCP_ACQUISITION_CHAIN_REQUIRED/.test(e)))return result('not_built_or_evidence_missing',errors);
 if(errors.length)return result('contract_upgrade',errors);
 if(certificate&&(certificate.templateHash!==hash(template)||certificate.contractHash!==sealedContractHash(template)||certificate.proofRunId!==proof.id||certificate.proofHash!==hash(proof)))return result('contract_upgrade',['SEAL_CERTIFICATION_CHANGED']);
 return {...result('valid'),certification:certificate?'persisted':'legacy_verified'};
}
export async function assertReaRequired({store,template,companyId,formId}){
 if(template){const state=await storedSeal(store,template,companyId);if(state.reason!=='not_built_or_evidence_missing')throw Object.assign(Error('REA_NOT_REQUIRED'),{details:state});}
 if(formId){const keys=formAssetKeys(formId),s=await read(store,'runs',keys.structure),c=await read(store,'runs',keys.capture);if(s&&c){try{assertAcquiredStructure(s,s.baselineCapture||(await read(store,'runs','seal-'+formId))?.baselineCapture||originalStructureCapture(s,c),companyId);}catch{return;}throw Object.assign(Error('REA_NOT_REQUIRED'),{details:{route:'incremental',nextTools:['capture_controls','form_build_template'],structureId:keys.structure}});}}
}

export async function recertifyContract(store,template,companyId){
 const before=await storedSeal(store,template,companyId);
 if(!['valid','contract_upgrade'].includes(before.reason))throw Object.assign(Error('OFFLINE_RECERTIFICATION_EVIDENCE_REQUIRED'),{details:before});
 const candidate=structuredClone(template),keys=formAssetKeys(candidate.evidence.formId||candidate.id);
 if(!candidate.evidence.pipeline){
  const [structure,capture,receipt]=await Promise.all([store.get('runs',keys.structure),store.get('runs',keys.capture),store.get('runs',keys.receipt)]);
  candidate.evidence.pipeline={version:receipt.version,formId:capture.formId,structureHash:hash(structure),captureHash:receipt.captureHash};
 }
 // The original receipt and original actual probe must certify this exact contract.
 // No synthetic live proof, relaxed checksum or guessed field conversion is allowed.
 await certifySeal(store,candidate,companyId);
 if(hash(candidate)!==hash(template))await store.put('templates',candidate.id,candidate);
 return {templateId:candidate.id,templateHash:hash(candidate),before:before.reason,...await storedSeal(store,candidate,companyId),browserAccess:false};
}
