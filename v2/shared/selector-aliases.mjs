// Value-free DOM identity proof for alternate collector locators. Never infer
// equivalence from label similarity or mark an absent conditional field covered.
export function selectorAliasDOM({alternatives,references}){
 const query=s=>{try{return [...document.querySelectorAll(s)];}catch{return [];}};
 const visible=n=>n.getClientRects().length>0&&getComputedStyle(n).visibility!=='hidden';
 const nodes=references.map(query),pairs=[];
 for(const [alternativeIndex,selector]of alternatives.entries()){
  const matches=query(selector);if(matches.length!==1)continue;const n=matches[0];
  const eligible=visible(n)||!!n.closest('.ant-select,.ant-radio-group,.ant-checkbox-group')&&visible(n.closest('.ant-select,.ant-radio-group,.ant-checkbox-group'));
  if(!eligible)continue;
  let indices=nodes.flatMap((ref,index)=>ref.length===1&&ref[0]===n?[index]:[]);
  if(!indices.length&&n.matches('.ant-select,.ant-radio-group,.ant-checkbox-group,.ant-calendar-picker,.ant-picker')){
   const controls=[...n.querySelectorAll('input:not([type="hidden"]),textarea,select')];
   if(controls.length&&controls.every(control=>nodes.some(ref=>ref.length===1&&ref[0]===control)))indices=nodes.flatMap((ref,index)=>ref.length===1&&n.contains(ref[0])?[index]:[]);
  }
  for(const referenceIndex of indices)pairs.push({alternativeIndex,referenceIndex});
 }
 return {pairs,valuesRead:false};
}
