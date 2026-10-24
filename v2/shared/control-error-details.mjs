// Public diagnostic schema only. Never forward arbitrary driver exception data,
// raw values, URLs, selectors, source facts or model-provided additional keys.
const phases=new Set(['after_option_click','after_blur','independent_verify','candidate_resolution','restored_control_failure']);
const keys=['phase','expectedValueHash','observedValueHash','valueMatches','readbackAvailable'];
const countKeys=['candidateCount','exactCandidateCount','visibleTargetCount'];
const sha256=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function safeControlErrorDetails(value){
 try{
 if(!value||typeof value!=='object'||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))return null;
 const descriptors=Object.getOwnPropertyDescriptors(value),phase=descriptors.phase?.value;if(!phases.has(phase))return null;
 const restored=['originalValueHash','unchangedFromBefore','popupClosed','stableReadback','pageUnchanged'];
 const allowed=phase==='candidate_resolution'?[...keys,...countKeys]:phase==='restored_control_failure'?[...keys,...restored]:keys;
 const own=Reflect.ownKeys(value);if(own.length!==allowed.length||own.some(key=>!allowed.includes(key)))return null;
 if(allowed.some(key=>!Object.hasOwn(descriptors,key)||!Object.hasOwn(descriptors[key],'value')))return null;
 const read=key=>descriptors[key].value;
 if(!phases.has(read('phase'))||!sha256(read('expectedValueHash'))||typeof read('valueMatches')!=='boolean'||typeof read('readbackAvailable')!=='boolean')return null;
 if(read('readbackAvailable')?!sha256(read('observedValueHash')):read('observedValueHash')!==null)return null;
 if(phase==='candidate_resolution'&&countKeys.some(key=>!Number.isInteger(read(key))||read(key)<0||read(key)>1000))return null;
 if(phase==='restored_control_failure'&&(!sha256(read('originalValueHash'))||restored.slice(1).some(key=>typeof read(key)!=='boolean')))return null;
 return Object.fromEntries(allowed.map(key=>[key,read(key)]));
 }catch{return null;}
}
