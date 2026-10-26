// Two distinct private facts: the real major and the user's application fallback.
export function majorFacts(profile,factKey){
 const match=factKey?.match(/^education\.([^.]+)\.major\.(?:zh|en|application|canonical)$/);
 if(!match)return null;
 const prefix=`education.${match[1]}.major`,real=profile.facts?.[prefix+'.zh'],application=profile.facts?.[prefix+'.application'];
 return {prefix,entity:match[1],realKey:prefix+'.zh',applicationKey:prefix+'.application',real:real?.status==='known'?real.value:null,application:application?.status==='known'?application.value:null};
}
export function preferRealMajorMappings(profile,{evidence}){
 if(!evidence?.trim())throw Error('MAJOR_POLICY_EVIDENCE_REQUIRED');
 const moved=[];
 for(const key of Object.keys(profile.facts)){
  if(!/^education\.[^.]+\.major\.canonical$/.test(key))continue;
  const target=key.replace(/canonical$/,'application'),real=key.replace(/canonical$/,'zh');
  if(!profile.facts[target])profile.facts[target]=structuredClone(profile.facts[key]);
  profile.fieldRegistry??={};profile.fieldRegistry[target]={...(profile.fieldRegistry[key]||{}),semanticKey:target,label:'用户申请使用专业',canonicalType:'string'};
  if(profile.fieldRegistry[real])profile.fieldRegistry[real].label='用户完整真实专业';
  delete profile.facts[key];delete profile.fieldRegistry[key];moved.push({old:key,target,real});
 }
 for(const form of Object.values(profile.companyForms||{})){
  let changed=false;
  for(const m of Object.values(form.mappings||{})){const major=majorFacts(profile,m.factKey);if(major&&m.factKey!==major.realKey){m.factKey=major.realKey;m.mappingEvidence=evidence;changed=true;}}
  for(const field of form.executionContract?.fields||[]){const major=majorFacts(profile,field.source);if(major&&field.source!==major.realKey){field.source=major.realKey;delete field.enumMap;delete field.choiceResolution;changed=true;}}
  if(changed&&form.executionContract)Object.assign(form.executionContract,{validForCurrentInventory:false,status:'requires_rebuild',rebuildReason:'major_policy_changed'});
 }
 return {moved};
}
