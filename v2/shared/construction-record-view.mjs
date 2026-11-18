// Read saved construction evidence in bounded slices; raw scripts stay behind
// the existing form_script_search interface, not in model responses.
export function constructionRecordView(value,{offset=0,limit=30,fieldId,section}={}){
 if(!offset&&!fieldId&&!section&&JSON.stringify(value).length<64000)return {value,pagination:{offset:0,limit},recordReferences:[]};
 const refs=[];
 const match=row=>(!fieldId||[row.id,row.selector,row.reaId].includes(fieldId))&&(!section||[row.section,row.group,row.title].includes(section));
 const visit=(node,key='')=>{
  if(['rawEvidence','scriptInventory','nativeStructure'].includes(key)){refs.push(key);return {recordReference:key,detailTool:key==='scriptInventory'?'form_script_search':'form_construction_records'};}
  if(Array.isArray(node)){
   const rows=['fields','controls','primaryCandidates','rows','findings','choices'].includes(key)?node.filter(match):node;
   const page=['fields','controls','primaryCandidates','rows','findings','choices','nodes','accessibility','documents'].includes(key);
   return (page?rows.slice(offset,offset+limit):rows).map(row=>visit(row));
  }
  if(node&&typeof node==='object')return Object.fromEntries(Object.entries(node).map(([k,v])=>[k,visit(v,k)]));
  return typeof node==='string'&&node.length>4000?node.slice(0,4000)+'…':node;
 };
 const out=visit(value);
 if(JSON.stringify(out).length>64000&&limit>1)return constructionRecordView(value,{offset,limit:Math.floor(limit/2),fieldId,section});
 return {value:out,pagination:{offset,limit,fieldId:fieldId||null,section:section||null},recordReferences:[...new Set(refs)]};
}
