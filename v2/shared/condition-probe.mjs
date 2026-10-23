import {matchesRole} from './role-identity.mjs';
import {liveControls} from './control-context.mjs';
// Internal maintenance only. Traverse captured branch choices through real UI
// controls, persist every discovery, then restore and read back the initial form.
const signature=f=>JSON.stringify({selector:f.selector,label:f.label,type:f.type,required:!!f.required});
const state=o=>({pageUrl:o.pageUrl,roleTitle:o.roleTitle,roleIdentity:o.roleIdentity,groups:o.groups,sections:o.sections,
  fields:Object.fromEntries(Object.entries(o.fields||{}).map(([id,f])=>[id,{present:f.present,value:f.value??null,selected:f.selected??null,uploadState:f.uploadState??null,userOnly:!!f.userOnly}]))});
const mapped=(f,plan)=>plan.fields.some(p=>(p.inventorySelectors||[p.read.selector]).includes(f.selector)&&p.inventoryLabel===f.label&&p.inventoryType===f.type&&!!p.required===!!f.required);

export async function probeConditions({page,plan,pageUrl,origin,onInventory,checkpoint=async()=>{},settleMs=2000}){
 const inventory=()=>liveControls(page,plan);
 const branches=[],dependencies=[...new Set(plan.fields.map(f=>f.when?.source).filter(Boolean))];
 const parents=dependencies.map(source=>{
  const matches=plan.fields.filter(f=>f.source===source);
  if(matches.length!==1)throw Error('AMBIGUOUS_CONDITION_DEPENDENCY');
  const f=matches[0];
  if(f.kind!=='choice'||f.userOnly||f.sensitive||f.readonly||f.actions?.length!==1||!['radio','dropdown','ud_dropdown','ant_dropdown'].includes(f.actions[0].method)||!f.control?.options?.length)throw Error('UNSUPPORTED_CONDITION_PROBE');
  return f;
 });
 await page.assertLocation(origin,plan.pathPrefix);await page.wait(plan.readySelector);
 const baselineInventory=await inventory();await onInventory(baselineInventory);
 if(baselineInventory.some(f=>!mapped(f,plan)))throw Error('BASELINE_HAS_UNMAPPED_QUESTIONS');
 const baseline=await page.observe(plan);
 if(baseline.pageUrl!==pageUrl||!matchesRole(plan,baseline))throw Error('PAGE_OR_ROLE_IDENTITY_CHANGED');
 if(!parents.length){
  const finalInventory=await inventory();await onInventory(finalInventory);const restored=await page.observe(plan);
  const same=JSON.stringify(finalInventory.map(signature).sort())===JSON.stringify(baselineInventory.map(signature).sort())&&JSON.stringify(state(restored))===JSON.stringify(state(baseline));
  const branch={source:'__baseline__',value:null,status:same?'verified':'needs_attention',inventory:finalInventory,newQuestions:finalInventory.filter(f=>!mapped(f,plan)).length,selected:true,conditionFieldsMatched:true,roleMatched:restored.pageUrl===pageUrl&&matchesRole(plan,restored)};
  return {status:same&&branch.roleMatched&&!branch.newQuestions?'verified':'needs_attention',branches:[branch],restoration:same?'verified':'failed',baseline,restored,scope:'declared_conditions_none_readonly_baseline'};
 }

 for(const f of parents){
  const actual=baseline.fields?.[f.id];
  if(!actual?.present||actual.selected!==true||!f.control.options.includes(actual.value))throw Error('CONDITION_INITIAL_SELECTION_NOT_RESTORABLE');
 }
 const conditional=plan.fields.filter(f=>f.when),originalFields=conditional.filter(f=>baseline.fields?.[f.id]?.present);
 // Refuse a probe rather than lose an existing attachment, authenticated secret,
 // or unsupported conditional input while toggling its parent control.
 for(const f of originalFields)if(f.kind!=='text'||f.userOnly||f.actions?.some(a=>a.method!=='fill'))throw Error('CONDITIONAL_VALUE_NOT_RESTORABLE');
 let errorCode=null,restoration='not_attempted',restored,changed=false;
 try{
  for(const parent of parents)for(const value of parent.control.options){
   await page.assertLocation(origin,plan.pathPrefix);changed=true;
   await page.act(parent.actions[0],value,{});
   const expected=conditional.filter(f=>f.when.source===parent.source&&f.when.equals===value);
   for(const f of expected)await page.wait(f.read.presenceSelector||f.read.selector);
   let controls,matched=false;const deadline=Date.now()+settleMs;
   do{
    controls=await inventory();await onInventory(controls);
    const wanted=conditional.filter(f=>f.when.source===parent.source);
    matched=wanted.every(f=>{
     const present=controls.some(i=>(f.inventorySelectors||[f.read.selector]).includes(i.selector));
     return present===(f.when.equals===value);
    });
    if(matched||Date.now()>=deadline)break;
    await new Promise(resolve=>setTimeout(resolve,40));
   }while(true);
   const observation=await page.observe({...plan,fields:[parent]});
   const unknown=controls.filter(f=>!mapped(f,plan));
   const branch={source:parent.source,value,inventory:controls,selected:observation.fields?.[parent.id]?.selected===true&&observation.fields?.[parent.id]?.value===value,
    expectedFieldIds:expected.map(f=>f.id),newQuestions:unknown.length,conditionFieldsMatched:matched,roleMatched:observation.pageUrl===pageUrl&&matchesRole(plan,observation)};
   branch.status=branch.selected&&branch.roleMatched&&matched&&!unknown.length?'verified':'needs_attention';
   branches.push(branch);await checkpoint({branches,restoration:'pending'});
  }
 }catch(error){errorCode=/^[A-Z_]+$/.test(error.message)?error.message:'CONDITION_PROBE_FAILED';}
 finally{
  if(changed){
   try{
    for(const parent of parents){await page.assertLocation(origin,plan.pathPrefix);await page.act(parent.actions[0],baseline.fields[parent.id].value,{});}
    await inventory(); // Refresh logical row selectors before restoring.
    for(const f of originalFields){await page.wait(f.read.presenceSelector||f.read.selector);for(const action of f.actions)await page.act(action,baseline.fields[f.id].value??'',{});}
    const finalInventory=await inventory();await onInventory(finalInventory);restored=await page.observe(plan);
    const sameInventory=JSON.stringify(finalInventory.map(signature).sort())===JSON.stringify(baselineInventory.map(signature).sort());
    restoration=sameInventory&&JSON.stringify(state(restored))===JSON.stringify(state(baseline))?'verified':'failed';
   }catch{restoration='failed';}
  }else restoration='not_needed';
 }
 return {status:!errorCode&&branches.length===parents.reduce((n,f)=>n+f.control.options.length,0)&&branches.every(b=>b.status==='verified')&&restoration==='verified'?'verified':'needs_attention',branches,restoration,errorCode,baseline,restored};
}
