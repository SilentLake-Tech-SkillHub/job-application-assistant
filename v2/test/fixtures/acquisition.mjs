// Explicit synthetic collector evidence for owned unit/protocol tests only.
import {hash} from '../../shared/engine.mjs';
import {scriptCoverage} from '../../shared/page-structure.mjs';
import {acquisitionReceiptId,acquisitionContractHash,acquisitionStructureId} from '../../shared/acquisition-chain.mjs';
export function acquisitionFixture(template,companyId){
 const pageUrl=template.evidence.sourceUrl,pageId='chrome:synthetic',targetId='synthetic-target',observedAt=new Date().toISOString();
 const captureId=template.evidence.captureId||'capture-'+template.id,structureId=acquisitionStructureId(companyId,pageUrl);
 const controls=template.pages.flatMap(page=>page.fields.flatMap(field=>(field.inventorySelectors||[field.read.selector]).map(selector=>({selector,label:field.inventoryLabel||field.label,type:field.inventoryType||field.kind,required:!!field.required}))));
 const capture={captureId,companyId,pageUrl,pageId,observedAt,controls};
 const rawEvidence={operation:'inspect_web_page',predicate_type:'rea.web-page-inspection',evidence_id:'synthetic-'+template.id,normalized_result:{scripts:{items:[]}}};
 const body={schemaVersion:1,pageUrl,targetId,documents:[{nodes:[{index:0,nodeName:'FORM'}]}],accessibility:[{nodeId:'1',role:'textbox'}]};
 const nativeStructure={...body,observedAt,structureHash:hash(body),executableSelectors:false};
 const reaEvidenceHash=hash(rawEvidence),structure={operation:'rea_form_structure',companyId,pageUrl,pageId,captureId,controlCaptureHash:hash(capture),reaEvidenceHash,rawEvidence,nativeStructure,structure:{provider:'rea',evidenceId:rawEvidence.evidence_id,evidenceHash:reaEvidenceHash,targetId,completeness:{truncated_sections:[],unavailable_sections:[]}},controls,uncorrelatedControls:[],scriptInventory:rawEvidence.normalized_result.scripts,scriptCoverage:scriptCoverage(rawEvidence)};
 template.evidence.captureId=captureId;
 template.evidence.pipeline={version:1,structureId,captureId,structureHash:hash(structure),captureHash:hash(capture)};
 const receipt={operation:'mcp_form_construction',companyId,pageUrl,...template.evidence.pipeline,contractHash:acquisitionContractHash(template)};
 const assets=new Map([[captureId,capture],[structureId,structure],[acquisitionReceiptId(companyId,pageUrl),receipt]]);
 return {capture,structure,receipt,assets,persist:store=>Promise.all([...assets].map(([id,data])=>store.put('runs',id,data)))};
}
