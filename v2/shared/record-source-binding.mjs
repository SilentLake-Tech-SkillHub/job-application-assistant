const family=source=>typeof source==='string'?source.match(/^(?:education|employment|internship|projects|workProjects|awards|leadership|entrepreneurship)\.[^.]+(?=\.)/)?.[0]||null:null;
const naming=/^(?:学校名称|院校名称|学校|单位名称|公司名称|雇主名称|项目名称|经历名称|获奖项|获奖名称|奖项名称|school(?: name)?|company(?: name)?|employer|project(?: name)?|award(?: name)?)$/i;
function recordScope(field){
 const scopes=[];
 for(const selector of field.inventorySelectors||[field.read?.selector]){
  if(!selector?.startsWith('phoenixq:'))continue;
  try{const q=JSON.parse(selector.slice(9));if(q.section&&Number.isInteger(q.occurrence))scopes.push(JSON.stringify([q.section,q.occurrence]));}catch{}
 }
 const unique=[...new Set(scopes)];return unique.length===1?unique[0]:null;
}
// Compare dates and other record members against the independently mapped
// naming anchor in the same observed section/record. A source value matching
// its own wrong mapping is not proof of semantic correctness.
export function recordSourceBindingIssues(template){
 const issues=[];
 for(const page of template.pages||[]){
  const groups=new Map();
  for(const field of page.fields||[]){const scope=recordScope(field);if(scope){if(!groups.has(scope))groups.set(scope,[]);groups.get(scope).push(field);}}
  for(const fields of groups.values()){
   const anchors=fields.filter(f=>naming.test((f.inventoryLabel||f.label||'').replace(/[＊*：:\s]+$/gu,''))&&family(f.source));
   const owners=[...new Set(anchors.map(f=>family(f.source)))];
   if(!owners.length)continue;
   for(const field of fields){const own=family(field.source);if(!own)continue;
    if(owners.length!==1||own!==owners[0])issues.push({id:field.id,label:field.inventoryLabel||field.label,reason:owners.length===1?'RECORD_SOURCE_FAMILY_MISMATCH':'RECORD_NAMING_ANCHOR_AMBIGUOUS'});
   }
  }
 }
 return issues;
}
export function assertRecordSourceBindings(template){if(recordSourceBindingIssues(template).length)throw Error('FORM_RECORD_SOURCE_BINDING_MISMATCH');}
