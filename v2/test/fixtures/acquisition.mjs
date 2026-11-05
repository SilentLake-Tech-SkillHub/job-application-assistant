// Explicit synthetic collector evidence for owned unit/protocol tests only.
import {hash} from '../../shared/engine.mjs';
import {scriptCoverage} from '../../shared/page-structure.mjs';
import {acquisitionReceiptId,acquisitionContractHash,acquisitionStructureId,captureContentHash} from '../../shared/acquisition-chain.mjs';
import {formAssetKeys} from '../../shared/form-identity.mjs';
export function acquisitionFixture(template,companyId){
 const pageUrl=template.evidence.sourceUrl,pageId='chrome:synthetic',targetId='synthetic-target',observedAt=new Date().toISOString();
 const formId=template.evidence.formId||companyId,keys=formAssetKeys(formId),captureId=keys.capture,structureId=keys.structure;
 const controls=template.pages.flatMap(page=>page.fields.flatMap(field=>(field.inventorySelectors||[field.read.selector]).map(selector=>({selector,label:field.inventoryLabel||field.label,type:field.inventoryType||field.kind,required:!!field.required}))));
 const capture={captureId,formId,companyId,pageUrl,pageId,provider:null,observedAt,controls};
 const rawEvidence={operation:'inspect_web_page',predicate_type:'rea.web-page-inspection',evidence_id:'synthetic-'+template.id,normalized_result:{scripts:{items:[]}}};
 const body={schemaVersion:1,pageUrl,targetId,documents:[{nodes:[{index:0,nodeName:'FORM'}]}],accessibility:[{nodeId:'1',role:'textbox'}]};
 const nativeStructure={...body,observedAt,structureHash:hash(body),executableSelectors:false};
 const reaEvidenceHash=hash(rawEvidence),structure={operation:'rea_form_structure',formId,companyId,pageUrl,pageId,captureId,controlCaptureHash:captureContentHash(capture),reaEvidenceHash,rawEvidence,nativeStructure,structure:{provider:'rea',evidenceId:rawEvidence.evidence_id,evidenceHash:reaEvidenceHash,targetId,completeness:{truncated_sections:[],unavailable_sections:[]}},controls,uncorrelatedControls:[],scriptInventory:rawEvidence.normalized_result.scripts,scriptCoverage:scriptCoverage(rawEvidence)};
 for(const field of template.pages.flatMap(page=>page.fields)){for(const key of ['choiceGoal','choiceResolution'])if(field[key]&&field[key].captureId===template.evidence.captureId)field[key].captureId=captureId;}
 template.evidence.captureId=captureId;template.evidence.formId=formId;
 template.evidence.pipeline={version:2,formId,structureHash:hash(structure),captureHash:captureContentHash(capture)};
 const receipt={operation:'mcp_form_construction',companyId,pageUrl,...template.evidence.pipeline,contractHash:acquisitionContractHash(template)};
 const assets=new Map([[captureId,capture],[structureId,structure],[keys.receipt,receipt]]);
 return {capture,structure,receipt,assets,persist:store=>Promise.all([...assets].map(([id,data])=>store.put('runs',id,data)))};
}
