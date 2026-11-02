// Report-only checks over a form template (no gate): which kind of experience
// sits in which section, judged by the user's own placement rules, and which
// record members do not come from the record itself (they need a declaration).
const FAMILY=/^(education|employment|internship|projects|workProjects|awards|leadership|entrepreneurship)\.[^.]+\./;
const CATEGORY=[['教育',/教育|学历|education/i],['实习',/实习|intern/i],['工作',/工作经历|工作|职业|work|career|employ/i],['创业',/创业|entrepreneur/i],['学生干部',/学生干部|社团|leadership/i],['校园',/校园|campus/i],['项目',/项目|project/i],['荣誉',/荣誉|获奖|奖项|award|honou?r/i]];
export const sectionCategory=title=>CATEGORY.find(([,re])=>re.test(String(title||'')))?.[0]||null;
const scopeOf=s=>{let m=/^(?:phoenixq|antq):(.*)$/.exec(s||'');if(m){try{const q=JSON.parse(m[1]);if(q.section&&Number.isInteger(q.occurrence))return [q.section,q.occurrence];}catch{}}
 m=/#formily-item-([A-Za-z0-9_]+)_list\s+\[class\^="apply-form-array-card__"\]:nth-child\((\d+)\)/.exec(s||'');if(m)return [m[1],Number(m[2])];
 m=/data-cy="([A-Za-z]+)\[(\d+)\]/.exec(s||'');if(m)return [m[1],Number(m[2])];return null;};
export function recordGroups(template){
 const groups=new Map();
 for(const page of template.pages||[])for(const field of page.fields||[]){
  const scopes=[...new Set([...(field.inventorySelectors||[]),field.read?.selector].map(scopeOf).filter(Boolean).map(s=>JSON.stringify(s)))];
  if(scopes.length!==1)continue;const key=scopes[0];if(!groups.has(key))groups.set(key,{section:JSON.parse(key)[0],index:JSON.parse(key)[1],fields:[]});groups.get(key).fields.push(field);
 }
 return [...groups.values()];
}
export function placementFindings(template,rules,parents=template?.evidence?.recordParents||{}){
 const groups=recordGroups(template),present=new Set(groups.map(g=>sectionCategory(g.section)).filter(Boolean)),findings=[];
 for(const g of groups){
  const category=sectionCategory(g.section);if(!category)continue;
  const records=[...new Set(g.fields.map(f=>/^((?:education|employment|internship|projects|workProjects|awards|leadership|entrepreneurship)\.[^.]+)\./.exec(f.source||'')?.[1]).filter(Boolean))];
  // A parent record's members inherited by a derived record (a job's project) count as the child's kind.
  const kept=records.filter(r=>!records.some(c=>parents[c]===r));
  const families=[...new Set(kept.map(r=>r.split('.')[0]))];
  for(const fam of families){
   const rule=(rules||[]).find(r=>r['经历']===fam);if(!rule)continue;
   const primary=rule['栏目']||[],fallback=rule['没有这些栏目时']||[];
   const ok=primary.includes(category)||fallback.includes(category)&&!primary.some(c=>present.has(c));
   if(!ok)findings.push({section:g.section,index:g.index,family:fam,category,reason:fallback.includes(category)?'PREFERRED_SECTION_EXISTS':'SECTION_NOT_ALLOWED_FOR_EXPERIENCE'});
  }
 }
 return findings;
}
export function nonRecordMembers(template){
 const out=[];
 for(const g of recordGroups(template)){
  if(!sectionCategory(g.section))continue;
  for(const f of g.fields)if(!FAMILY.test(f.source||''))out.push({section:g.section,index:g.index,fieldId:f.id,label:f.inventoryLabel||f.label,source:f.source});
 }
 return out;
}
