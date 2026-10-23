// Synthetic UI evidence for unit fixtures. Production accepts only MCP probes.
import {hash} from '../../shared/engine.mjs';
import {sealFormTemplate,unsealedTemplate} from '../../shared/form-seal.mjs';
export function observedSeal(template,companyId){
 const source=unsealedTemplate(template);
 for(const field of source.pages.flatMap(p=>p.fields)){
  field.inventorySelectors??=[field.read.selector];field.inventoryLabel??=field.label;field.inventoryType??=field.kind==='text'?'text':field.kind;
 }
 const probe={id:source.id+'-probe',operation:'internal_condition_probe',companyId,templateHash:hash(source),status:'verified',restoration:'verified',branches:[{source:'__baseline__',value:null,status:'verified',selected:true,roleMatched:true,conditionFieldsMatched:true,newQuestions:0,inventory:source.pages.flatMap(p=>p.fields.flatMap(f=>f.inventorySelectors.map(selector=>({selector,label:f.inventoryLabel,type:f.inventoryType,required:!!f.required}))))}]};
 return {template:sealFormTemplate(source,probe,{companyId,profileMapped:true,channel:'chrome'}),probe};
}
