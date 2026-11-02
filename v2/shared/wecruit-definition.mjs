import {createHash} from 'node:crypto';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export function normalizeWecruitDefinition(template,dictionary){
 if(!Array.isArray(template)||!dictionary||typeof dictionary!=='object')throw Error('INVALID_OFFICIAL_FORM_DEFINITION');
 const sections=[],fields=[],ids=new Set();
 for(const section of template){
  if(!Number.isInteger(section.setId)||!section.name||!Array.isArray(section.infoItemList))throw Error('INCOMPLETE_OFFICIAL_FORM_SECTION');
  sections.push({id:String(section.setId),title:section.name,required:section.isNeed===0,repeated:section.mutiRecordBool===true});
  const visit=(items,when=null)=>{for(const item of items){
   const id=section.setId+'-'+item.itemId;if(ids.has(id)||!Number.isInteger(item.itemId)||!item.name)throw Error('DUPLICATE_OR_INVALID_SCHEMA_QUESTION');ids.add(id);
   const kind={1:'text',2:'date',3:'radio',4:'dropdown',6:'textarea',8:'file',9:'cascade'}[item.fillType];if(!kind)throw Error('UNSUPPORTED_OFFICIAL_FIELD_TYPE');
   const options=dictionary[item.dataSource]||[];
   fields.push({id,sectionId:String(section.setId),section:section.name,itemId:item.itemId,label:item.name,kind,required:item.isNeed===0,repeated:section.mutiRecordBool===true,dataSource:item.dataSource||null,customDataSource:item.customDataSource||null,options,when,remark:item.remark||'',datePrecision:kind==='date'?'day':null});
   for(const [code,children] of Object.entries(item.beRelationItems||{})){
    const choice=options.find(v=>v.code===code);if(!choice||!Array.isArray(children))throw Error('UNRESOLVED_OFFICIAL_CONDITION');visit(children,{parentId:id,optionCode:code,optionLabel:choice.name});
   }
  }};visit(section.infoItemList);
 }
 return {schemaVersion:1,provider:'wecruit',sourceDefinitionHash:digest({template,dictionary}),sections,fields,conditionalFieldCount:fields.filter(f=>f.when).length,containsCandidateValues:false};
}
export function registerDefinitionQuestions(profile,{companyId,definition,sourceId,evidenceRef}){
 profile.sources[sourceId]={kind:'official_company_form_definition',reference:evidenceRef,definitionHash:definition.sourceDefinitionHash};profile.fieldRegistry??={};profile.facts??={};profile.companyDefinitions??={};
 const added=[];
 for(const f of definition.fields){const key='unmapped.'+companyId+'.schema_'+f.id;
  const userOnly=/证件号码|身份证|护照号|验证码|密码/.test(f.label);
  profile.fieldRegistry[key]={...(profile.fieldRegistry[key]||{}),companyId,label:f.label,question:f.label,...(userOnly?{neverStoreValue:true}:{}),section:f.section,schemaQuestionId:f.id,type:f.kind,required:f.required,when:f.when,definitionHash:definition.sourceDefinitionHash,sourceIds:[sourceId],status:profile.fieldRegistry[key]?.status||'needs_semantic_mapping'};
  if(!profile.facts[key]){profile.facts[key]={status:'missing',value:null,sourceIds:[],reason:'官网完整模板中发现的问题；未提供答案前不可忽略或编造'};added.push(key);}
 }
 profile.companyDefinitions[companyId]={definitionHash:definition.sourceDefinitionHash,sourceId,evidenceRef,sections:definition.sections,fieldIds:definition.fields.map(f=>f.id),conditionalFieldCount:definition.conditionalFieldCount};return {companyId,sectionCount:definition.sections.length,fieldCount:definition.fields.length,conditionalFields:definition.conditionalFieldCount,added};
}
