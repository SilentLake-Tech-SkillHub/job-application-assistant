// Live broker-owned observation of an actual dictionary-option click. No
// persisted receipt alone can recreate this evidence after a page/broker reload.
const pages=new WeakMap();
const validScope=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function observeChoiceNode(node){
 if(node.tagName!=='INPUT'||typeof MutationObserver!=='function')throw Error('LIVE_CHOICE_OBSERVATION_UNAVAILABLE');
 let revision=0;const changed=()=>{revision++;};node.addEventListener('input',changed,true);node.addEventListener('change',changed,true);
 const observer=new MutationObserver(records=>{if(records.some(record=>record.oldValue!==record.target.getAttribute(record.attributeName)))changed();});observer.observe(node,{attributes:true,attributeOldValue:true,attributeFilter:['value','data-school-id','data-entity-id','data-value','data-id']});
 const read=()=>{let websiteId=null;for(const target of [node,node.closest('.phoenix-auto-complete-container')])for(const attribute of ['data-school-id','data-entity-id','data-value','data-id']){const value=target?.getAttribute?.(attribute);if(typeof value==='string'&&value.trim()&&!websiteId)websiteId={value,attribute};}return {connected:node.isConnected===true,value:node.value,revision,websiteId};};
 return {node,read,dispose:()=>{observer.disconnect();node.removeEventListener('input',changed,true);node.removeEventListener('change',changed,true);}};
}
export async function beginChoiceWitness(page,input,scope){
 if(!validScope(scope)||typeof input.evaluateHandle!=='function')return false;
 let entries=pages.get(page);if(!entries){entries=new Map();pages.set(page,entries);}
 const previous=entries.get(scope);if(previous){await previous.handle.evaluate(w=>w.dispose()).catch(()=>{});await previous.handle.dispose().catch(()=>{});entries.delete(scope);}
 const handle=await input.evaluateHandle(observeChoiceNode);entries.set(scope,{handle,pageUrl:page.url(),sealed:null});return true;
}
export async function sealChoiceWitness(page,input,scope,candidate){
 const entry=pages.get(page)?.get(scope);if(!entry||page.url()!==entry.pageUrl)return false;
 const node=await input.elementHandle();try{
  const state=await entry.handle.evaluate((w,n)=>({...w.read(),sameNode:w.node===n}),node);
  if(!state.connected||!state.sameNode||state.value!==candidate.label)return false;
  if(candidate.value!=null?state.websiteId?.value!==candidate.value:state.websiteId!=null)return false;
  entry.sealed={revision:state.revision,label:candidate.label,value:candidate.value??null};return true;
 }finally{await node?.dispose();}
}
export async function verifyChoiceWitness(page,input,scope,label,expectedId){
 const entry=pages.get(page)?.get(scope);if(!entry?.sealed||page.url()!==entry.pageUrl||entry.sealed.label!==label)return null;
 const node=await input.elementHandle();try{
  const state=await entry.handle.evaluate((w,n)=>({...w.read(),sameNode:w.node===n}),node),sealed=entry.sealed;
  if(!state.connected||!state.sameNode||state.value!==label||state.revision!==sealed.revision)return null;
  if(expectedId!=null?(state.websiteId?.value!==expectedId||sealed.value!==expectedId):state.websiteId!=null)return null;
  return {verified:true,kind:'live_observed_choice',label,value:sealed.value,liveWitness:{source:'broker_live_event_observer',scope,revision:state.revision,sameNode:true,eventsUnchanged:true}};
 }catch{return null;}finally{await node?.dispose();}
}
