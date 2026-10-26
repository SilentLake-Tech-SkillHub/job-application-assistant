import {createHash} from 'node:crypto';
import {assertRecordSourceBindings} from './record-source-binding.mjs';
import {canonicalControlSpec} from './control-registry.mjs';
import {scriptCoverage} from './page-structure.mjs';
import {bindStructureControls} from './rea-structure.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const acquisitionReceiptId=(companyId,pageUrl)=>'acquisition-'+companyId+'-'+hash(pageUrl).slice(0,16);
// One structure record per REA inspection (capture + REA evidence): a later
// inspection of the same page, even with identical controls, must not replace
// the evidence a built template is bound to. The page-level id holds only a
// pointer to the latest record.
export const acquisitionStructureId=(companyId,pageUrl,inspectionKey)=>'form-structure-'+companyId+'-'+hash(inspectionKey?{pageUrl,inspection:inspectionKey}:pageUrl).slice(0,16);
export const latestStructurePointer=(companyId,pageUrl,structureId,captureId)=>({operation:'rea_form_structure_pointer',companyId,pageUrl,structureId,captureId});
// What a template is built from is the capture's control definition: company,
// page, provider and controls (the same fields as its content-addressed
// captureId). The observation part of the capture record (which tab, when,
// registration and diff) is refreshed by every later capture of the same page
// and is checked only when an inspection is recorded, never afterwards.
export const captureContentHash=capture=>hash({companyId:capture.companyId,pageUrl:capture.pageUrl,provider:capture.provider??null,controls:capture.controls});
// Records written before content hashing bound the whole capture record.
const captureBound=(recorded,capture)=>recorded===captureContentHash(capture)||recorded===hash(capture);
export const acquisitionContractHash=template=>hash(canonicalControlSpec({id:template.id,evidence:template.evidence,pages:template.pages}));

// A template cannot supply its own acquisition evidence. These records are
// created by the passive collector and checked again at every execution gate.
export function assertAcquiredStructure(structure,capture,companyId){
 if(structure?.operation!=='rea_form_structure'||structure.companyId!==companyId||capture?.companyId!==companyId||structure.captureId!==capture.captureId||structure.pageUrl!==capture.pageUrl||typeof structure.pageId!=='string'||!structure.pageId)throw Error('ACQUISITION_CAPTURE_SCOPE_CHANGED');
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

export async function assertCapturedAcquisition(store,{companyId,captureId,pageUrl}){
 const capture=captureId?await store.get('runs',captureId):null;
 const url=pageUrl||capture?.pageUrl;
 if(!url)throw Error('MCP_ACQUISITION_CHAIN_REQUIRED');
 const read=async id=>{try{return await store.get('runs',id);}catch(error){if(error.code==='ENOENT')return null;throw error;}};
 // The page-level record: a pointer to the latest inspection, or a full record
 // written before structures were stored per inspection.
 const latest=await read(acquisitionStructureId(companyId,url));
 const structure=latest?.operation==='rea_form_structure_pointer'&&latest.companyId===companyId&&latest.pageUrl===url?await read(latest.structureId):latest;
 if(!structure)throw Error('MCP_ACQUISITION_CHAIN_REQUIRED');
 const current=capture||await store.get('runs',structure.captureId);
 assertAcquiredStructure(structure,current,companyId);
 return {capture:current,structure};
}

// One REA inspection: the live REA structure and the capture taken with it
// must be the same page and close in time (checked here, once); the record is
// stored under its own id and the page pointer moves to it.
export async function recordReaInspection(store,{companyId,pageUrl,structure,capture,rawEvidence,nativeStructure=null}){
 const joined=bindStructureControls(structure,capture),id=acquisitionStructureId(companyId,pageUrl,capture.captureId+'|'+(structure.evidenceId||structure.observedAt));
 const asset={...joined,controlCaptureHash:captureContentHash(capture),structure,rawEvidence,nativeStructure,scriptInventory:rawEvidence.normalized_result?.scripts||null,scriptCoverage:scriptCoverage(rawEvidence),operation:'rea_form_structure',observedAt:structure.observedAt};
 assertAcquiredStructure(asset,capture,companyId);
 await store.put('runs',id,asset);await store.put('runs',acquisitionStructureId(companyId,pageUrl),latestStructurePointer(companyId,pageUrl,id,capture.captureId));
 return {id,asset,joined};
}

export async function recordAcquisitionChain(store,{companyId,structureId,structure,capture,template}){
 assertAcquiredStructure(structure,capture,companyId);
 template.evidence.pipeline={version:1,structureId,captureId:capture.captureId,structureHash:hash(structure),captureHash:captureContentHash(capture)};
 const receipt={operation:'mcp_form_construction',companyId,pageUrl:capture.pageUrl,...template.evidence.pipeline,contractHash:acquisitionContractHash(template)};
 await store.put('runs',acquisitionReceiptId(companyId,capture.pageUrl),receipt);
 return receipt;
}

export async function assertAcquisitionChain(template,{store,companyId,profile}={}){
 assertRecordSourceBindings(template);
 const binding=template?.evidence?.pipeline;
 if(binding?.version!==1||!binding.structureId||!binding.captureId)throw Error('MCP_ACQUISITION_CHAIN_REQUIRED');
 const [structure,capture,receipt]=await Promise.all([
  store.get('runs',binding.structureId),store.get('runs',binding.captureId),store.get('runs',acquisitionReceiptId(companyId,template.evidence.sourceUrl))
 ]).catch(error=>{if(error.code==='ENOENT')throw Error('ACQUISITION_EVIDENCE_MISSING');throw error;});
 assertAcquiredStructure(structure,capture,companyId);
 if(binding.structureHash!==hash(structure)||!captureBound(binding.captureHash,capture)||template.evidence.sourceUrl!==capture.pageUrl||template.evidence.captureId!==capture.captureId)throw Error('ACQUISITION_EVIDENCE_CHANGED');
 if(receipt.operation!=='mcp_form_construction'||receipt.companyId!==companyId||receipt.pageUrl!==capture.pageUrl||receipt.structureId!==binding.structureId||receipt.captureId!==binding.captureId||receipt.structureHash!==binding.structureHash||receipt.captureHash!==binding.captureHash||receipt.contractHash!==acquisitionContractHash(template))throw Error('MCP_CONSTRUCTION_RECEIPT_CHANGED');
 const fields=template.pages.flatMap(page=>page.fields);
 for(const control of capture.controls)if(!fields.some(field=>field.inventorySelectors?.includes(control.selector)))throw Error('ACQUISITION_CONTROL_NOT_MAPPED');
 if((structure.uncorrelatedControls||[]).some(node=>!template.evidence.reaReconciliation?.some(item=>item.nodeId===node.nodeId)))throw Error('ACQUISITION_RECONCILIATION_REQUIRED');
 if(profile){
  const forms=Object.values(profile.companyForms||{}).filter(form=>form.companyId===companyId&&form.pageUrl===capture.pageUrl);
  const mappings=forms.flatMap(form=>Object.values(form.mappings||{})).filter(mapping=>mapping.active!==false);
  for(const field of fields)if(!field.userOnly&&!mappings.some(mapping=>field.inventorySelectors?.includes(mapping.selector)&&mapping.factKey===field.source))throw Error('ACQUISITION_PROFILE_MAPPING_CHANGED');
 }
 return {version:1,structureId:binding.structureId,captureId:binding.captureId,contractHash:receipt.contractHash};
}
