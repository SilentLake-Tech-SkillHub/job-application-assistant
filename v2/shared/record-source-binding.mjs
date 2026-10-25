const FAMILY=/^(?:education|employment|internship|projects|workProjects|awards|leadership|entrepreneurship)\.[^.]+(?=\.)/;
const family=source=>typeof source==='string'?source.match(FAMILY)?.[0]||null:null;
const naming=/^(?:学校名称|院校名称|学校|单位名称|公司名称|雇主名称|项目名称|经历名称|获奖项|获奖名称|奖项名称|荣誉名称|school(?: name)?|company(?: name)?|employer|project(?: name)?|award(?: name)?)$/i;
// Record containers as each form framework exposes them. A new framework adds
// a recognizer here; no company names, no site domains.
const recognizers=[
 s=>{const m=/^(?:phoenixq|antq):(.*)$/.exec(s);if(!m)return null;try{const q=JSON.parse(m[1]);return q.section&&Number.isInteger(q.occurrence)?[q.section,q.occurrence]:null;}catch{return null;}},
 s=>{const m=/#formily-item-([A-Za-z0-9_]+_list)\s+\[class\^="apply-form-array-card__"\]:nth-child\((\d+)\)/.exec(s);return m?[m[1],Number(m[2])]:null;},
 s=>{const m=/data-cy="([A-Za-z]+)\[(\d+)\]/.exec(s);return m?[m[1],Number(m[2])]:null;},
];
function recordScope(field){
 const scopes=[];
 for(const selector of [...(field.inventorySelectors||[]),field.read?.selector])if(typeof selector==='string')for(const r of recognizers){const s=r(selector);if(s){scopes.push(JSON.stringify(s));break;}}
 const unique=[...new Set(scopes)];return unique.length===1?unique[0]:null;
}
// A record derived from another record (a work project inside a job) may take
// the parent's role, dates or duties. The relation comes from the profile's own
// derivation evidence and is frozen into the template, never guessed here.
export function recordParentsFromProfile(profile){
 const out={};
 for(const [key,fact] of Object.entries(profile?.facts||{})){const child=family(key),parent=family(fact?.derivation?.source);if(child&&parent&&child!==parent)out[child]=parent;}
 return out;
}
// Compare dates and other record members against the independently mapped
// naming anchor in the same observed section/record. A source value matching
// its own wrong mapping is not proof of semantic correctness.
export function recordSourceBindingIssues(template){
 const parents=template?.evidence?.recordParents||{},issues=[];
 for(const page of template.pages||[]){
  const groups=new Map();
  for(const field of page.fields||[]){const scope=recordScope(field);if(scope){if(!groups.has(scope))groups.set(scope,[]);groups.get(scope).push(field);}}
  for(const fields of groups.values()){
   const anchors=fields.filter(f=>naming.test((f.inventoryLabel||f.label||'').replace(/[＊*：:\s]+$/gu,''))&&family(f.source));
   const owners=[...new Set(anchors.map(f=>family(f.source)))];
   if(!owners.length)continue;
   for(const field of fields){const own=family(field.source);if(!own)continue;
    if(owners.length===1&&(own===owners[0]||parents[owners[0]]===own))continue;
    issues.push({id:field.id,label:field.inventoryLabel||field.label,reason:owners.length===1?'RECORD_SOURCE_FAMILY_MISMATCH':'RECORD_NAMING_ANCHOR_AMBIGUOUS'});
   }
  }
 }
 return issues;
}
export function assertRecordSourceBindings(template){if(recordSourceBindingIssues(template).length)throw Error('FORM_RECORD_SOURCE_BINDING_MISMATCH');}
