import {createHash} from 'node:crypto';
import {formAssetKeys} from './form-identity.mjs';
import {assertRecordSourceBindings} from './record-source-binding.mjs';
import {canonicalControlSpec} from './control-registry.mjs';
import {scriptCoverage} from './page-structure.mjs';
import {bindStructureControls} from './rea-structure.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const acquisitionReceiptId=formId=>formAssetKeys(formId).receipt;
export const acquisitionStructureId=formId=>formAssetKeys(formId).structure;
export const captureContentHash=capture=>hash({companyId:capture.companyId,pageUrl:capture.pageUrl,provider:capture.provider??null,controls:capture.controls});
const captureBound=(recorded,capture)=>recorded===captureContentHash(capture);
export const acquisitionContractHash=template=>hash(canonicalControlSpec({id:template.id,evidence:template.evidence,pages:template.pages}));

// A template cannot supply its own acquisition evidence. These records are
// created by the passive collector and checked again at every execution gate.
export function assertAcquiredStructure(structure,capture,companyId){
 if(structure?.operation!=='rea_form_structure'||structure.companyId!==companyId||capture?.companyId!==companyId||structure.captureId!==capture.captureId||structure.pageUrl!==capture.pageUrl||structure.formId!==capture.formId||structure.pageId!==capture.pageId||typeof structure.pageId!=='string'||!structure.pageId)throw Error('ACQUISITION_CAPTURE_SCOPE_CHANGED');
 if(!captureBound(structure.controlCaptureHash,capture))throw Error('ACQUISITION_CONTROL_CAPTURE_CHANGED');
 const native=structure.nativeStructure,rea=structure.structure,raw=structure.rawEvidence;
 if(!raw||rea?.provider!=='rea'||!rea.evidenceId||rea.evidenceHash!==hash(raw)||structure.reaEvidenceHash!==rea.evidenceHash)throw Error('ACQUISITION_RAW_REA_EVIDENCE_REQUIRED');
 if(!native?.documents?.length||!native.accessibility?.length||!native.targetId||native.targetId!==rea.targetId||native.pageUrl!==capture.pageUrl)throw Error('ACQUISITION_NATIVE_STRUCTURE_REQUIRED');
 const {observedAt,structureHash,executableSelectors,...body}=native;
 if(structureHash!==hash(body))throw Error('ACQUISITION_NATIVE_STRUCTURE_CHANGED');
 const complete=rea.completeness;
 if(!complete||['truncated_sections','unavailable_sections'].some(key=>(complete[key]||[]).some(section=>/dom|accessibility/.test(typeof section==='string'?section:section.section))))throw Error('ACQUISITION_STRUCTURE_INCOMPLETE');
 if(!capture.controls?.length||!Array.isArray(structure.controls)||structure.controls.length!==capture.controls.length)throw Error('ACQUISITION_CONTROL_INVENTORY_INCOMPLETE');
 if(hash(scriptCoverage(raw))!==hash(structure.scriptCoverage)||hash(raw.normalized_result?.scripts||null)!==hash(structure.scriptInventory||null))throw Error('ACQUISITION_SCRIPT_EVIDENCE_CHANGED');
 return true;
}

export async function assertCapturedAcquisition(store,{companyId,captureId,pageUrl,formId}){
 if(!captureId&&!formId)throw Error('FORM_CODE_OR_CAPTURE_REQUIRED');
 const capture=await store.get('runs',captureId||formAssetKeys(formId).capture);
 if(!capture.formId)throw Error('MCP_ACQUISITION_CHAIN_REQUIRED');
 if(pageUrl&&capture.pageUrl!==pageUrl)throw Error('ACQUISITION_CAPTURE_SCOPE_CHANGED');
 const keys=formAssetKeys(capture.formId);let structure;
 try{structure=await store.get('runs',keys.structure);}catch(error){if(error.code==='ENOENT')throw Error('MCP_ACQUISITION_CHAIN_REQUIRED');throw error;}
 assertAcquiredStructure(structure,capture,companyId);
 return {capture,structure};
}

// Replace the current observation for this fixed form. Any previous template
// must match this current record's hashes; superseded files are never read.
export async function recordReaInspection(store,{companyId,pageUrl,structure,capture,rawEvidence,nativeStructure=null}){
 const joined=bindStructureControls(structure,capture),id=acquisitionStructureId(capture.formId);
 const asset={...joined,formId:capture.formId,controlCaptureHash:captureContentHash(capture),structure,rawEvidence,nativeStructure,scriptInventory:rawEvidence.normalized_result?.scripts||null,scriptCoverage:scriptCoverage(rawEvidence),operation:'rea_form_structure',observedAt:structure.observedAt};
 assertAcquiredStructure(asset,capture,companyId);
 asset.contentHash=hash(asset);await store.put('runs',id,asset);
 return {id,asset,joined};
}

export async function recordAcquisitionChain(store,{companyId,structureId,structure,capture,template}){
 assertAcquiredStructure(structure,capture,companyId);
 template.evidence.formId=capture.formId;template.evidence.captureId=formAssetKeys(capture.formId).capture;
 template.evidence.pipeline={version:2,formId:capture.formId,structureHash:hash(structure),captureHash:captureContentHash(capture)};
 const receipt={operation:'mcp_form_construction',companyId,pageUrl:capture.pageUrl,...template.evidence.pipeline,contractHash:acquisitionContractHash(template)};
 await store.put('runs',acquisitionReceiptId(capture.formId),receipt);
 return receipt;
}

export async function assertAcquisitionChain(template,{store,companyId,profile}={}){
 assertRecordSourceBindings(template);
 const binding=template?.evidence?.pipeline;
 if(binding?.version!==2||!binding.formId)throw Error('MCP_ACQUISITION_CHAIN_REQUIRED');
 const keys=formAssetKeys(binding.formId);
 const [structure,capture,receipt]=await Promise.all([
  store.get('runs',keys.structure),store.get('runs',keys.capture),store.get('runs',keys.receipt)
 ]).catch(error=>{if(error.code==='ENOENT')throw Error('ACQUISITION_EVIDENCE_MISSING');throw error;});
 assertAcquiredStructure(structure,capture,companyId);
 if(binding.structureHash!==hash(structure)||!captureBound(binding.captureHash,capture)||template.evidence.sourceUrl!==capture.pageUrl||template.evidence.captureId!==capture.captureId)throw Error('ACQUISITION_EVIDENCE_CHANGED');
 if(receipt.operation!=='mcp_form_construction'||receipt.companyId!==companyId||receipt.pageUrl!==capture.pageUrl||receipt.formId!==binding.formId||receipt.structureHash!==binding.structureHash||receipt.captureHash!==binding.captureHash||receipt.contractHash!==acquisitionContractHash(template))throw Error('MCP_CONSTRUCTION_RECEIPT_CHANGED');
 const fields=template.pages.flatMap(page=>page.fields);
 for(const control of capture.controls)if(!fields.some(field=>field.inventorySelectors?.includes(control.selector)))throw Error('ACQUISITION_CONTROL_NOT_MAPPED');
 if((structure.uncorrelatedControls||[]).some(node=>!template.evidence.reaReconciliation?.some(item=>item.nodeId===node.nodeId)))throw Error('ACQUISITION_RECONCILIATION_REQUIRED');
 if(profile){
  const forms=Object.values(profile.companyForms||{}).filter(form=>form.companyId===companyId&&form.pageUrl===capture.pageUrl);
  const templateHash=hash(template);
  const mappings=forms.flatMap(form=>Object.values(form.mappings||{}).filter(mapping=>{
   if(mapping.active!==false)return true;
   // A fresh form may render one repeat record or hide a conditional field.
   // Its last mapped source remains required by the exact sealed contract;
   // the engine creates/reveals the field before independent verification.
   const contract=form.executionContract;
   return mapping.coverageRequired===true&&mapping.status==='mapped'&&
    contract?.status==='registered'&&contract.validForCurrentInventory!==false&&contract.templateHash===templateHash&&
    contract.fields?.some(field=>field.source===mapping.factKey&&field.inventorySelectors?.includes(mapping.selector));
  }));
  for(const field of fields)if(!field.userOnly&&!mappings.some(mapping=>field.inventorySelectors?.includes(mapping.selector)&&mapping.factKey===field.source))throw Error('ACQUISITION_PROFILE_MAPPING_CHANGED');
 }
 return {version:2,formId:binding.formId,structureId:keys.structure,captureId:keys.capture,contractHash:receipt.contractHash};
}
