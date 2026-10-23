import {createHash} from 'node:crypto';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
export const choiceKey=s=>String(s??'').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
function similarity(a,b){a=choiceKey(a);b=choiceKey(b);if(!a||!b)return 0;if(a===b)return 1;const grams=s=>new Set(Array.from(s).slice(0,-1).map((_,i)=>s.slice(i,i+2))),x=grams(a),y=grams(b);return x.size+y.size?2*[...x].filter(v=>y.has(v)).length/(x.size+y.size):0;}
export function factChoiceAliases(profile,factKey){
 const value=profile.facts?.[factKey]?.value,aliases=[value];
 const school=factKey.match(/^(education\.[^.]+\.school)\.(?:name\.(?:zh|en)|abbreviation)$/);
 if(school)for(const suffix of ['name.zh','name.en','abbreviation']){const f=profile.facts?.[school[1]+'.'+suffix];if(f?.status==='known')aliases.push(f.value);}
 const major=factKey.match(/^education\.([^.]+)\.major\.(?:zh|en|canonical)$/),policy=profile.policies?.majorDropdownResolution||profile.policy?.majorDropdownResolution;
 // Related disciplines require the user's standing policy; they are not aliases
 // simply because a model considers them close.
 if(major&&policy?.autoSelect===true&&typeof policy[major[1]]==='string')aliases.push(policy[major[1]]);
 return [...new Set(aliases.filter(x=>typeof x==='string'&&x.trim()))];
}
export function rankChoices(profile,factKey,options){
 const aliases=factChoiceAliases(profile,factKey),candidates=[...new Set(options)].map(option=>({option,score:Math.max(0,...aliases.map(alias=>similarity(alias,option))),knownAlias:aliases.some(alias=>choiceKey(alias)===choiceKey(option))})).sort((a,b)=>Number(b.knownAlias)-Number(a.knownAlias)||b.score-a.score);
 const exact=candidates.filter(c=>c.knownAlias);
 return {factKey,aliases,candidates,selection:exact.length===1?exact[0].option:null,status:exact.length===1?'resolved_known_alias':exact.length>1?'ambiguous_alias':'semantic_review_required',automaticFuzzySelection:false};
}
export function resolveObservedChoice({profile,factKey,choice,selectedOption,evidence}){
 if(choice.status!=='captured'||choice.restored!==true||!choice.options?.length)throw Error('RESTORED_OPTION_EVIDENCE_REQUIRED');
 const ranked=rankChoices(profile,factKey,choice.options),option=selectedOption??ranked.selection;
 if(!choice.options.includes(option))throw Error('ACTUAL_CAPTURED_OPTION_REQUIRED');
 const automatic=ranked.selection===option;
 if(!automatic&&!evidence?.trim())throw Error('CHOICE_SEMANTIC_REVIEW_REQUIRED');
 return {factKey,sourceValue:profile.facts[factKey]?.value,selectedOption:option,optionsHash:digest(choice.options),method:automatic?'known_alias':'agent_semantic_review',evidence:automatic?'same confirmed fact or approved profile alias':evidence,query:choice.optionQueries?.[option]||option};
}
export function applyChoiceResolution(field,choice,profile){
 if(!choice?.options?.length||!['dropdown','radio'].includes(field.control?.type))return field;
 let resolution=choice.resolutions?.[field.source];
 if(resolution&&(resolution.optionsHash!==digest(choice.options)||resolution.sourceValue!==profile.facts[field.source]?.value))throw Error('CHOICE_RESOLUTION_STALE');
 const ranked=rankChoices(profile,field.source,choice.options);
 if(!resolution&&ranked.selection)resolution=resolveObservedChoice({profile,factKey:field.source,choice});
 if(!resolution){if(profile.facts[field.source]?.status==='known')field.constructionBlockers.push('CHOICE_SEMANTIC_RESOLUTION_REQUIRED');return field;}
 field.enumMap={...(field.enumMap||{}),[resolution.sourceValue]:resolution.selectedOption};field.choiceResolution=resolution;
 field.actions=field.actions.map(a=>({...a,query:resolution.query}));return field;
}

export function mergeObservedChoices(previous=[],updates=[]){
 const merged=new Map(previous.map(c=>[c.selector,c]));
 for(const item of updates){const old=merged.get(item.selector);
  const optionQueries={...(old?.optionQueries||Object.fromEntries((old?.options||[]).map(o=>[o,old.query||o]))),...(item.optionQueries||Object.fromEntries((item.options||[]).map(o=>[o,item.query||o])))};
  if(old?.status==='captured'&&old.restored&&item.status==='captured'&&item.restored)merged.set(item.selector,{...old,...item,options:[...new Set([...old.options,...item.options])],optionQueries,scope:'observed_option_union',coverage:{complete:old.coverage?.complete===true||item.coverage?.complete===true}});
  else merged.set(item.selector,{...item,optionQueries});
 }return [...merged.values()];
}
