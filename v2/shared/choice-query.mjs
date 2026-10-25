import {factChoiceAliases} from './choice-resolution.mjs';

// Retrieval terms are not identity aliases. Shortening only broadens the
// website search; it never authorizes selecting a returned candidate.
export function planChoiceQueries(profile,factKey){
 const aliases=factChoiceAliases(profile,factKey),steps=[],seen=new Set();
 const add=(query,source,transforms=[])=>{
  query=String(query||'').normalize('NFKC').replace(/\s+/gu,' ').trim();
  if(!query||seen.has(query))return;seen.add(query);
  steps.push({query,source,transforms,purpose:'candidate_retrieval',identityAlias:transforms.length===0});
 };
 const school=factKey.match(/^(education\.[^.]+)\.school\.(?:name\.(?:zh|en)|abbreviation)$/u);
 if(school){
  const country=profile.facts?.[school[1]+'.location.country'];
  for(const alias of aliases){
   let core=alias.normalize('NFKC').trim(),transforms=[];
   // Only a sourced location can be removed. Do not guess countries or cities
   // from a string, and never remove a distinctive campus/branch qualifier.
   if(country?.status==='known'&&typeof country.value==='string'&&country.value.length>1&&core.startsWith(country.value)){
    core=core.slice(country.value.length).trim();transforms.push('sourced_country_prefix');
   }
   const stem=core.replace(/(?:大学|学院)$/u,'').replace(/\s+(?:university|college)$/iu,'').trim();
   if(stem!==core&&Array.from(stem).length>=2){core=stem;transforms.push('institution_type_suffix');}
   if(transforms.length&&Array.from(core).length>=2)add(core,alias,transforms);
  }
 }
 for(const alias of aliases)add(alias,alias);
 return {revision:1,factKey,steps,automaticFuzzySelection:false};
}
