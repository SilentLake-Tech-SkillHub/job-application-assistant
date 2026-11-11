// Repeat sections. A template holds the fields of the records it has seen and
// how to add one; how many records a section gets comes from the master profile
// each time a plan is compiled, never from a stored number.
import {createHash} from 'node:crypto';
import {recordParentsFromProfile} from './record-source-binding.mjs';
const INHERITED=['groups','after'];
const FAMILY=/^((education|employment|internship|projects|workProjects|awards|leadership|entrepreneurship|languages|certificates|portfolio)\.([^.]+))\./;
const fieldId=(selector,label)=>'field-'+createHash('sha256').update(JSON.stringify([selector,label])).digest('hex').slice(0,20);
const parseReference=selector=>{
 const m=/^(phoenixq|antq):(.*)$/s.exec(selector||'');if(!m)return null;
 try{return {kind:m[1],encoded:false,value:JSON.parse(m[2])};}catch{}
 try{return {kind:m[1],encoded:true,value:JSON.parse(decodeURIComponent(m[2]))};}catch{return null;}
};
const reference=selector=>parseReference(selector)?.value||null;
export function scopeOf(selector){
 const r=reference(selector);if(r?.section&&Number.isInteger(r.occurrence))return [r.section,r.occurrence];
 let m=/#formily-item-([A-Za-z0-9_]+)_list\s+\[class\^="apply-form-array-card__"\]:nth-child\((\d+)\)/.exec(selector||'');if(m)return [m[1],Number(m[2])];
 m=/(?:data-cy|id)="([A-Za-z]+)\[(\d+)\]/.exec(selector||'');return m?[m[1],Number(m[2])]:null;
}
function fieldScope(field){
 const scopes=[...new Set([...(field.inventorySelectors||[]),field.read?.selector].map(scopeOf).filter(Boolean).map(s=>JSON.stringify(s)))];
 return scopes.length===1?JSON.parse(scopes[0]):null;
}
export function excludedRepeatField(field,page,plan){
 const scope=fieldScope(field),owner=recordOwner([field],plan?.parents||{});
 return !!scope&&!!owner&&!!plan&&page.groups?.some(group=>groupSection(group)===scope[0]&&group.addSelector)&&!inProfile(owner,plan);
}
export function observedRepeatPrototype(field,page,controls){
 const scope=fieldScope(field);
 if(!scope||!page.groups?.some(group=>groupSection(group)===scope[0]&&group.addSelector))return false;
 const rendered=new Set(controls.map(control=>control.selector));
 const shown=controls.map(control=>scopeOf(control.selector)).filter(Boolean);
 if(shown.some(other=>other[0]===scope[0]&&other[1]===scope[1]))return false;
 const source=FAMILY.exec(field.source||'');if(!source)return false;
 return page.fields.some(prototype=>{
  const other=fieldScope(prototype),parent=FAMILY.exec(prototype.source||'');
  if(!other||other[0]!==scope[0]||!parent||parent[2]!==source[2]||prototype.source.slice(parent[0].length)!==field.source.slice(source[0].length))return false;
  if(!(prototype.inventorySelectors||[prototype.read.selector]).some(selector=>rendered.has(selector)))return false;
  const projected=moveField(prototype,scope[0],scope[1]);
  return projected.inventoryLabel===field.inventoryLabel&&projected.inventoryType===field.inventoryType&&!!projected.required===!!field.required&&projected.control?.type===field.control?.type&&projected.read.kind===field.read.kind&&projected.read.selector===field.read.selector&&projected.precision===field.precision&&JSON.stringify(projected.inventorySelectors)===JSON.stringify(field.inventorySelectors)&&JSON.stringify(projected.actions)===JSON.stringify(field.actions);
 });
}
function moveSelector(selector,section,occurrence){
 const parsed=parseReference(selector);
 if(parsed?.value.section===section&&Number.isInteger(parsed.value.occurrence)){
  const body=JSON.stringify({...parsed.value,occurrence});
  return `${parsed.kind}:${parsed.encoded?encodeURIComponent(body):body}`;
 }
 return selector.replace(new RegExp(`(#formily-item-${section}_list\\s+\\[class\\^="apply-form-array-card__"\\]:nth-child\\()\\d+`,'g'),`$1${occurrence}`)
  .replace(new RegExp(`((?:data-cy|id)="${section}\\[)\\d+`,'g'),`$1${occurrence}`);
}
function moveField(field,section,occurrence){
 const walk=value=>typeof value==='string'?moveSelector(value,section,occurrence):Array.isArray(value)?value.map(walk):value&&typeof value==='object'?Object.fromEntries(Object.entries(value).map(([k,v])=>[k,walk(v)])):value;
 const moved=walk(structuredClone(field));
 moved.id=fieldId(moved.inventorySelectors?.[0]||moved.read?.selector,moved.label);
 return moved;
}
function renameRecord(field,fromPrefix,toPrefix,parents,ongoingSources){
 const rename=source=>{
  if(typeof source!=='string')return source;
  if(source.startsWith(fromPrefix+'.'))return toPrefix+source.slice(fromPrefix.length);
  const parent=parents[fromPrefix];
  if(parent&&source.startsWith(parent+'.'))return (parents[toPrefix]||toPrefix)+source.slice(parent.length);
  return source;
 };
 const next=structuredClone(field);next.source=rename(next.source);
 if(next.ongoingSource)next.ongoingSource=rename(next.ongoingSource);
 if(!next.ongoingSource&&next.kind==='date'&&next.actions?.some(action=>['ud_date','feishu_month'].includes(action.method))){
  const ongoing=next.source.replace(/\.(?:end|endDate|dateEnd|endMonth)$/u,'.ongoing');
  if(ongoing!==next.source&&ongoingSources?.includes(ongoing))next.ongoingSource=ongoing;
 }
 if(next.when?.source)next.when.source=rename(next.when.source);
 if(next.compose?.sources)next.compose.sources=next.compose.sources.map(rename);
 // What was resolved or searched for the sibling says nothing about this record.
 for(const key of ['choiceResolution','choiceGoal','choiceGoalRequired'])delete next[key];
 if(field.choiceResolution)delete next.enumMap;
 for(const action of next.actions||[])for(const key of ['query','expectedOptionPath','expectedOptionValue','expectedOptionValueAttribute'])delete action[key];
 return next;
}
function recordOwner(fields,parents){
 const counts=new Map();
 for(const f of fields){const m=FAMILY.exec(f.source||'');if(m)counts.set(m[1],(counts.get(m[1])||0)+1);}
 const owners=[...counts.keys()].filter(k=>![...counts.keys()].some(c=>parents[c]===k));
 const owner=owners.sort((a,b)=>counts.get(b)-counts.get(a))[0];
 if(!owner)return null;
 const [family,key]=owner.split('.');return {record:owner,family,key};
}
// Explicit entity lists retain their ordering and exclusions. Older profiles
// also contain repeat families whose records are declared only as facts.
export function recordPlanOf(profile){
 const entities={...profile?.entities},inferred=new Map();
 for(const source of Object.keys(profile?.facts||{})){
  const match=FAMILY.exec(source);
  if(!match||Array.isArray(entities[match[2]]))continue;
  if(!inferred.has(match[2]))inferred.set(match[2],new Set());
  inferred.get(match[2]).add(match[3]);
 }
 for(const [family,keys]of inferred)entities[family]=[...keys];
 const parents=recordParentsFromProfile(profile);
 const ongoingSources=Object.entries(profile?.facts||{})
  .filter(([key,fact])=>key.endsWith('.ongoing')&&fact?.status==='known'&&fact.value===true)
  .map(([key])=>key);
 return {entities,projects:profile?.applicationSelections?.projects?.projectIds||null,
  ...(Object.keys(parents).length?{parents}:{}),...(ongoingSources.length?{ongoingSources}:{})};
}
const inProfile=(owner,plan)=>{
 const listed=plan.entities[owner.family];
 if(!Array.isArray(listed))return true;
 return listed.includes(owner.key)&&(owner.family!=='projects'||!plan.projects||plan.projects.includes(owner.key));
};
export const groupSection=group=>group.sectionKey||reference(group.selector)?.section||reference(group.selector)?.title
 || /\.resumeEditForm-(?!item\b)([A-Za-z]+)\b/.exec(group.selector||'')?.[1]
 || /#formily-item-([A-Za-z0-9_]+)_list\b/.exec(group.selector||'')?.[1];
export const occurrenceBase=selector=>/#formily-item-[A-Za-z0-9_]+_list\s+\[class\^="apply-form-array-card__"\]:nth-child/.test(selector||'')?1:0;
function recordsByPage(page,parents){
 const sections=new Map();
 for(const field of page.fields||[]){
  const scope=fieldScope(field);if(!scope)continue;
  const [section,occurrence]=scope;
  if(!sections.has(section))sections.set(section,new Map());
  const records=sections.get(section);
  if(!records.has(occurrence))records.set(occurrence,[]);
  records.get(occurrence).push(field);
 }
 return [...sections].map(([section,records])=>({section,records:[...records].sort(([a],[b])=>a-b).map(([occurrence,fields])=>({occurrence,fields,owner:recordOwner(fields,parents)}))}));
}
// The form to fill for this profile. No plan means no profile in reach: the
// template is returned untouched, as it is when nothing changed.
export function withProfileRecords(template,plan){
 if(!plan)return template;
 const parents={...template.evidence?.recordParents,...plan.parents},used=new Set();
 for(const page of template.pages||[])for(const {records}of recordsByPage(page,parents))for(const r of records)if(r.owner)used.add(r.owner.record);
 let changed=false;
 const pages=(template.pages||[]).map(page=>{
  const groups=(page.groups||[]).map(group=>({...group}));
  const replaced=new Map(),appended=new Map();
  let pageChanged=false;
  for(const {section,records}of recordsByPage(page,parents)){
   const group=groups.find(g=>groupSection(g)===section);
   if(!group&&records.length<2)continue;
   const kept=records.filter(r=>!r.owner||inProfile(r.owner,plan));
   const additions=[];
   if(group||page.provider==='ant'&&records.length>1)for(const family of new Set(records.map(r=>r.owner?.family).filter(Boolean))){
    const listed=plan.entities[family];if(!Array.isArray(listed))continue;
    for(const key of listed){
     const owner={family,key,record:`${family}.${key}`};
     if(used.has(owner.record)||!inProfile(owner,plan))continue;
     const pattern=[...records].reverse().find(r=>r.owner?.family===family);
     additions.push({owner,pattern});used.add(owner.record);
    }
   }
   const base=occurrenceBase(records[0].fields[0].inventorySelectors?.[0]||records[0].fields[0].read?.selector);
   kept.forEach((record,index)=>{
    const occurrence=base+index;
    for(const field of record.fields)replaced.set(field,occurrence===record.occurrence?field:moveField(field,section,occurrence));
   });
   for(const record of records)if(!kept.includes(record))for(const field of record.fields)replaced.set(field,null);
   const fresh=additions.flatMap(({owner,pattern},index)=>pattern.fields.map(field=>moveField(renameRecord(field,pattern.owner.record,owner.record,parents,plan.ongoingSources),section,base+kept.length+index)));
   if(fresh.length){const last=records.at(-1).fields.at(-1);appended.set(last,fresh);}
   if(kept.length!==records.length||kept.some((r,i)=>r.occurrence!==base+i)||fresh.length)pageChanged=true;
   if(group&&group.count!==kept.length+additions.length){group.count=kept.length+additions.length;pageChanged=true;}
  }
  if(!pageChanged)return page;
  changed=true;
  const fields=[];
  for(const field of page.fields){
   const next=replaced.has(field)?replaced.get(field):field;
   if(next)fields.push(next);
   if(appended.has(field))fields.push(...appended.get(field));
  }
  return {...page,fields,...(page.groups?{groups}:{})};
 });
 return changed?{...template,pages}:template;
}
// Sections whose planned records are not on the page and that have no way to add one yet.
export function sectionsWithoutAdd(page,liveControls,recordPlan){
 const contracted=new Set((page.groups||[]).filter(group=>group.addSelector).map(groupSection)),rendered=new Map(),planned=new Map();
 const note=(map,selector)=>{
  const scope=scopeOf(selector);if(!scope)return;
  const [section,occurrence]=scope;map.set(section,Math.max(map.get(section)||0,occurrence+1-occurrenceBase(selector)));
 };
 for(const control of liveControls||[])note(rendered,control.selector);
 for(const field of page.fields||[])for(const selector of field.inventorySelectors||[field.read?.selector])note(planned,selector);
 const missing=new Set([...planned].filter(([section,count])=>count>1&&!contracted.has(section)&&(rendered.get(section)||0)<count).map(([section])=>section));
 // A single captured row cannot establish a repeat contract. Ask the live
 // reader to look only when the master actually has another mapped record.
 if(recordPlan&&page.provider==='ant')for(const {section,records}of recordsByPage(page,recordPlan.parents||{})){
  if(contracted.has(section)||records.length!==1)continue;
  const owner=records[0].owner;
  if(owner&&recordPlan.entities[owner.family]?.some(key=>key!==owner.key&&inProfile({...owner,key},recordPlan)))missing.add(section);
 }
 return [...missing];
}
export function groupFromDiscovery(found){
 if(found.selector&&found.addSelector)return {id:found.sectionKey||found.title,sectionKey:found.sectionKey||found.title,selector:found.selector,addSelector:found.addSelector,addLabel:found.addLabel};
 const scope={title:found.title,headingSelector:found.headingSelector,containerSelector:found.containerSelector,recordSelector:found.recordSelector,addSelector:found.addSelector,addLabel:found.addLabel};
 return {id:`repeat-${createHash('sha256').update(found.title).digest('hex').slice(0,12)}`,selector:'phoenixq:'+JSON.stringify({...scope,part:'repeatRecords'}),addSelector:'phoenixq:'+JSON.stringify({...scope,part:'repeatAdd'}),addLabel:found.addLabel};
}
// A rebuild keeps what the form already has: the page contract, then every field
// the fresh capture did not show or left without a mapping or captured options.
export function inheritPageContract(page,previous=[]){
 const result={...page},prior=previous.flatMap(t=>t?.pages||[]).filter(p=>p.pathPrefix===page.pathPrefix);
 for(const key of INHERITED){
  if(Array.isArray(page[key])?page[key].length:page[key]!==undefined)continue;
  const found=prior.find(p=>Array.isArray(p[key])?p[key].length:p[key]!==undefined);
  if(found)result[key]=structuredClone(found[key]);
 }
 return result;
}
const UNMAPPED='unmapped.pending';
export function inheritFields(fields,previous=[],pathPrefix,{preserveObservedBlockers=false,mappings=[]}={}){
 const prior=previous.flatMap(t=>t?.pages||[]).filter(p=>p.pathPrefix===pathPrefix).flatMap(p=>p.fields||[]);
 if(!prior.length)return fields;
 const key=f=>f.inventorySelectors?.[0]||f.read?.selector,seen=new Set(fields.map(key));
 const merged=fields.map(field=>{
  const old=prior.find(p=>key(p)===key(field));
  if(!old)return field;
  const next={...field};
  if(next.source===UNMAPPED&&old.source&&old.source!==UNMAPPED){next.source=old.source;if(old.enumMap)next.enumMap=old.enumMap;if(old.ongoingSource)next.ongoingSource=old.ongoingSource;}
  if(!preserveObservedBlockers&&next.constructionBlockers?.length&&!old.constructionBlockers?.length&&next.control?.type===old.control?.type){next.control=old.control;next.actions=old.actions;next.read=old.read;next.constructionBlockers=[];for(const k of ['choiceResolution','choiceGoal','choiceGoalRequired'])if(old[k])next[k]=old[k];}
  return next;
 });
 // A record this capture never showed, or a condition not active now, says nothing
 // about the company. A control gone from a record the capture did show is the company's change.
 const shown=new Set(fields.map(fieldScope).filter(Boolean).map(scope=>JSON.stringify(scope)));
 const unseen=[];
 for(const old of prior){
  if(seen.has(key(old)))continue;
  const scope=fieldScope(old);
  if(!old.when&&(!scope||shown.has(JSON.stringify(scope))))continue;
  let retained={constructionBlockers:[],...structuredClone(old)};
  const owner=FAMILY.exec(old.source||'');
  if(scope&&owner&&!old.userOnly&&!['dropdown','radio','multiselect','searchable_text'].includes(old.control?.type)){
   const prototypes=merged.filter(field=>{
    const observed=fieldScope(field),parent=FAMILY.exec(field.source||'');
    return observed?.[0]===scope[0]&&parent?.[2]===owner[2]&&field.source.slice(parent[0].length)===old.source.slice(owner[0].length)&&field.inventoryLabel===old.inventoryLabel&&!field.userOnly;
   }).map(field=>moveField(field,scope[0],scope[1]));
   const signature=field=>JSON.stringify({selectors:field.inventorySelectors,type:field.control?.type,kind:field.read.kind,precision:field.precision,methods:field.actions?.map(action=>action.method)});
   if(prototypes.length&&prototypes.every(field=>signature(field)===signature(prototypes[0]))){
    retained={...prototypes[0],id:old.id,source:old.source};
    for(const property of ['when','ongoingSource','dateRepresentation','compose']){delete retained[property];if(old[property]!==undefined)retained[property]=structuredClone(old[property]);}
   }
  }
  const mapped=[...new Set(mappings.filter(mapping=>mapping.status==='mapped'&&!mapping.factKey.startsWith('unmapped.')&&retained.inventorySelectors?.includes(mapping.selector)).map(mapping=>mapping.factKey))];
  if(mapped.length===1){if(mapped[0]!==retained.source){const from=FAMILY.exec(retained.source||''),to=FAMILY.exec(mapped[0]);if(from&&to)retained=renameRecord(retained,from[1],to[1],{},[]);retained.source=mapped[0];}retained.constructionBlockers=(retained.constructionBlockers||[]).filter(reason=>reason!=='SEMANTIC_MAPPING_REQUIRED');}
  seen.add(key(old));seen.add(key(retained));unseen.push(retained);
 }
 return [...merged,...unseen];
}
