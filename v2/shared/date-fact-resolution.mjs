import {validDate} from './value-contract.mjs';
const precision=value=>['day','month','year'].find(unit=>validDate(value,unit));
// Follow only an explicit date family on this same record. Never borrow a
// neighbouring award's date, infer a month from a quarter or default January.
export function resolveDateFact(profile,key){
 const original=profile?.facts?.[key];
 if(original&&['not_applicable','conflict'].includes(original.status))return {fact:original,derivedFrom:[]};
 const siblings=key?.endsWith('.date')?key.slice(0,-5):null;
 const candidates=[key,...(siblings?[siblings+'.yearMonth',siblings+'.year']:[])].flatMap(source=>{
  const fact=profile?.facts?.[source];return fact?.status==='known'&&precision(fact.value)?[{source,fact}]:[];
 }).sort((a,b)=>b.fact.value.length-a.fact.value.length);
 if(!candidates.length)return {fact:original,derivedFrom:[]};
 const best=candidates[0],fact={...best.fact},derivedFrom=[best.source];
 if(siblings&&precision(fact.value)==='year'){
  const month=profile.facts[siblings+'.month'];
  if(month?.status==='known'&&/^(?:0?[1-9]|1[0-2])$/.test(String(month.value))){fact.value+='-'+String(month.value).padStart(2,'0');fact.precision='month';fact.sourceIds=[...new Set([...fact.sourceIds,...month.sourceIds])];derivedFrom.push(siblings+'.month');}
 }
 const defaults=profile?.policy?.applicationDateDefaults,approvedDefault=defaults?.missingDay==='01'&&/^user_/.test(profile.sources?.[defaults.sourceId]?.kind||'');
 const sourcePrecision=precision(fact.value);
 if(sourcePrecision==='month'&&approvedDefault){fact.value+='-01';fact.precision='day';fact.sourceIds=[...new Set([...fact.sourceIds,defaults.sourceId])];fact.dateNormalization={sourcePrecision:'month',dayRule:'first_day_of_month',sourceId:defaults.sourceId};}
 const context=siblings&&profile.facts[siblings+'.description'];
 return {fact,derivedFrom,sourcePrecision,dayDefault:approvedDefault?'01':null,...(context?.status==='known'&&/季度/.test(context.value)?{knownContext:context.value}:{})};
}

export function datePrecisionGap(profile,key,requiredPrecision){
 const resolution=resolveDateFact(profile,key),fact=resolution.fact,units=['year','month','day'];
 if(fact?.status!=='known')return null;
 const sourcePrecision=precision(fact.value);
 if(!sourcePrecision||!units.includes(requiredPrecision)||units.indexOf(sourcePrecision)>=units.indexOf(requiredPrecision))return null;
 const missingComponents=units.slice(units.indexOf(sourcePrecision)+1,units.indexOf(requiredPrecision)+1).filter(component=>component!=='day'||!resolution.dayDefault);
 return {sourcePrecision,requiredPrecision,knownValue:fact.value,sourceIds:fact.sourceIds,derivedFrom:resolution.derivedFrom,missingComponents,...(resolution.dayDefault?{approvedDayDefault:resolution.dayDefault}:{}),...(resolution.knownContext?{knownContext:resolution.knownContext}:{})};
}
