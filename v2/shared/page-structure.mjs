import {createHash} from 'node:crypto';
const attributes=new Set(['id','class','name','type','role','for','placeholder','aria-label','aria-labelledby','aria-describedby','aria-controls','aria-owns','aria-expanded','aria-haspopup','aria-activedescendant','aria-selected','aria-checked','aria-required','aria-disabled','aria-readonly','required','disabled','readonly','multiple','accept','autocomplete','data-testid','data-field','data-question-id','src']);
export function observedScriptOrigins(tree,pageUrl){
 const origins=new Set([new URL(pageUrl).origin]);
 const visit=frame=>{for(const resource of frame?.resources||[])if(resource.type==='Script'){try{const u=new URL(resource.url);if(u.protocol==='https:'&&!u.username&&!u.password)origins.add(u.origin);}catch{}}for(const child of frame?.childFrames||[])visit(child);};
 visit(tree.frameTree);return [...origins].sort();
}
export function normalizeDOMSnapshot(snapshot){
 const strings=snapshot.strings||[];
 return (snapshot.documents||[]).map(doc=>{
  const nodes=doc.nodes,layout=doc.layout||{},positions=new Map((layout.nodeIndex||[]).map((index,i)=>[index,i]));
  return {frameId:doc.frameId,nodes:(nodes.nodeType||[]).map((nodeType,index)=>{
   const pairs=nodes.attributes?.[index]||[],kept={};for(let i=0;i<pairs.length;i+=2){const key=strings[pairs[i]];if(attributes.has(key))kept[key]=strings[pairs[i+1]];}
   const position=positions.get(index);
   return {index,parentIndex:nodes.parentIndex[index],backendNodeId:nodes.backendNodeId[index],nodeType,nodeName:strings[nodes.nodeName[index]],attributes:kept,...(position===undefined?{}:{layout:{bounds:layout.bounds?.[position],offsetRect:layout.offsetRects?.[position],clientRect:layout.clientRects?.[position],scrollRect:layout.scrollRects?.[position],paintOrder:layout.paintOrders?.[position]}})};
  })};
 });
}
// One passive acquisition on the original page. Sources remain private; only
// summaries enter model responses. Credentials/storage are outside this capture.
export async function captureNativePageStructure(cdp,{pageUrl,targetId}){
 const [snapshot,ax,tree]=await Promise.all([
  cdp.send('DOMSnapshot.captureSnapshot',{computedStyles:['display','visibility'],includeDOMRects:true,includePaintOrder:true}),
  cdp.send('Accessibility.getFullAXTree'),cdp.send('Page.getResourceTree')
 ]);
 const body={schemaVersion:1,pageUrl,targetId,attributeScope:{mode:'locator_and_control_state_allowlist',names:[...attributes],omittedAttributeIsNotAbsenceProof:true},documents:normalizeDOMSnapshot(snapshot),accessibility:(ax.nodes||[]).map(n=>({nodeId:n.nodeId,backendNodeId:n.backendDOMNodeId,parentId:n.parentId,childIds:n.childIds,role:n.role?.value,label:n.name?.value||'',ignored:!!n.ignored,properties:(n.properties||[]).filter(p=>['disabled','readonly','required','expanded','multiselectable','labelledby','describedby'].includes(p.name))})),scriptOrigins:observedScriptOrigins(tree,pageUrl)};
 return {...body,observedAt:new Date().toISOString(),structureHash:createHash('sha256').update(JSON.stringify(body)).digest('hex'),executableSelectors:false};
}

export function scriptCoverage(evidence){
 const items=evidence?.normalized_result?.scripts?.items||[];
 const included=items.filter(s=>s.source?.included===true);
 for(const s of included){const a=s.source.artifact;if(typeof a?.text!=='string'||Buffer.byteLength(a.text)!==a.bytes||createHash('sha256').update(a.text).digest('hex')!==a.sha256)throw Error('SCRIPT_ARTIFACT_HASH_MISMATCH');}
 return {total:items.length,included:included.length,excluded:items.length-included.length,bytes:included.reduce((n,s)=>n+s.source.artifact.bytes,0),scope:'scripts_observed_in_loaded_resource_origins',limitations:evidence?.normalized_result?.completeness?.excluded?.filter(x=>['scripts','script_sources'].includes(x.section))||[]};
}

export function searchCapturedScripts(inventory,queries,{limit=12,radius=140}={}){
 const hits=[];
 // Fair first pass across queries and scripts. Generic library tokens must not
 // consume the entire budget before a business schema can be inspected.
 for(const query of queries)for(const script of inventory?.items||[]){
  const artifact=script.source?.included&&script.source.artifact;if(!artifact)continue;
  const offset=artifact.text.indexOf(query);if(offset<0)continue;
  hits.push({scriptKey:script.script_key,url:script.url,sha256:artifact.sha256,query,offset,excerpt:artifact.text.slice(Math.max(0,offset-radius),Math.min(artifact.text.length,offset+query.length+radius))});
 }
 return {matches:hits.slice(0,limit),truncated:hits.length>limit,scope:'first_occurrence_per_query_per_script'};
}
