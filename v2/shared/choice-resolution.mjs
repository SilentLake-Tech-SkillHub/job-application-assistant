import {createHash} from 'node:crypto';
import {majorFacts} from './major-policy.mjs';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const optionHash=c=>digest({options:c.options,identities:(c.optionRecords||[]).map(({label,value,valueAttribute,disabled})=>({label,value,valueAttribute,disabled:!!disabled}))});
const lockedChoice=c=>c?.status==='captured_locked_value'&&c.restored===true&&c.lockedControl?.disabled===true&&c.lockedControl.selected===true&&c.options?.length===1&&c.options[0]===c.lockedControl.value;
const majorPolicyHash=(profile,key)=>{const major=majorFacts(profile,key);return major?.application?digest({real:major.real,application:major.application,policy:profile.policies?.majorDropdownResolution||profile.policy?.majorDropdownResolution}):null;};
export const choiceKey=s=>String(s??'').normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
function similarity(a,b){a=choiceKey(a);b=choiceKey(b);if(!a||!b)return 0;if(a===b)return 1;const grams=s=>new Set(Array.from(s).slice(0,-1).map((_,i)=>s.slice(i,i+2))),x=grams(a),y=grams(b);return x.size+y.size?2*[...x].filter(v=>y.has(v)).length/(x.size+y.size):0;}
export function factChoiceAliases(profile,factKey){
 const value=profile.facts?.[factKey]?.value,aliases=[value];
 const school=factKey.match(/^(education\.[^.]+\.school)\.(?:name\.(?:zh|en)|abbreviation)$/);
 if(school)for(const suffix of ['name.zh','name.en','abbreviation']){const f=profile.facts?.[school[1]+'.'+suffix];if(f?.status==='known')aliases.push(f.value);}
 const major=factKey.match(/^education\.([^.]+)\.major\.(?:zh|en|canonical|application)$/),policy=profile.policies?.majorDropdownResolution||profile.policy?.majorDropdownResolution,majors=majorFacts(profile,factKey);
 // Related disciplines require the user's standing policy; they are not aliases
 // simply because a model considers them close.
 if(major&&policy?.autoSelect===true){if(majors?.real)aliases.push(majors.real);if(majors?.application)aliases.push(majors.application);else if(typeof policy[major[1]]==='string')aliases.push(policy[major[1]]);}
 return [...new Set(aliases.filter(x=>typeof x==='string'&&x.trim()))];
}
export function rankChoices(profile,factKey,options){
 const aliases=factChoiceAliases(profile,factKey),candidates=[...new Set(options)].map(option=>({option,score:Math.max(0,...aliases.map(alias=>similarity(alias,option))),knownAlias:aliases.some(alias=>choiceKey(alias)===choiceKey(option))})).sort((a,b)=>Number(b.knownAlias)-Number(a.knownAlias)||b.score-a.score);
 // A related-discipline fallback cannot override an available exact original.
 const major=majorFacts(profile,factKey),policy=profile.policies?.majorDropdownResolution||profile.policy?.majorDropdownResolution;
 const original=major&&(policy?.whenOriginalUnavailable===true||major.application)?major.real:null;
 const originals=original?candidates.filter(c=>choiceKey(c.option)===choiceKey(original)):[];
 const exact=originals.length?originals:candidates.filter(c=>c.knownAlias);
 return {factKey,aliases,candidates,selection:exact.length===1?exact[0].option:null,status:exact.length===1?'resolved_known_alias':exact.length>1?'ambiguous_alias':'semantic_review_required',automaticFuzzySelection:false};
}
export function resolveObservedChoice({profile,factKey,choice,selectedOption,evidence}){
 const locked=lockedChoice(choice);
 if(choice.status!=='captured'&&!locked||choice.restored!==true||!choice.options?.length)throw Error('RESTORED_OPTION_EVIDENCE_REQUIRED');
 const ranked=rankChoices(profile,factKey,choice.options),option=selectedOption??ranked.selection;
 if(!choice.options.includes(option))throw Error('ACTUAL_CAPTURED_OPTION_REQUIRED');
 const automatic=ranked.selection===option;
 const major=majorFacts(profile,factKey);
 if(major?.real&&major.application&&choice.options.some(v=>choiceKey(v)===choiceKey(major.real))&&choiceKey(option)!==choiceKey(major.real))throw Error('MAJOR_REAL_OPTION_REQUIRED');
 if(major?.real&&major.application&&option===major.application&&!choice.options.some(v=>choiceKey(v)===choiceKey(major.real))){
  const complete=choice.scope==='all_menu_options'&&choice.coverage?.complete===true;
  const searched=(choice.searches||[]).some(s=>choiceKey(s.query)===choiceKey(major.real)&&s.restored===true&&!s.options.some(v=>choiceKey(v)===choiceKey(major.real)));
  if(!complete&&!searched)throw Error('MAJOR_ORIGINAL_OPTION_SEARCH_REQUIRED');
 }
 if(!automatic&&!evidence?.trim())throw Error('CHOICE_SEMANTIC_REVIEW_REQUIRED');
 const observed=choice.optionRecords?.filter(r=>r.label===option)||[];if(observed.length>1)throw Error('CHOICE_OPTION_NOT_UNIQUE');if(observed[0]?.disabled&&!locked)throw Error('CHOICE_OPTION_DISABLED');
 return {...(choice.choicesId?{choicesId:choice.choicesId,captureId:choice.captureId,selector:choice.selector}:{}),optionValue:observed[0]?.value??null,optionValueAttribute:observed[0]?.valueAttribute??null,factKey,majorPolicyHash:majorPolicyHash(profile,factKey),sourceValue:profile.facts[factKey]?.value,selectedOption:option,optionsHash:optionHash(choice),method:automatic?'known_alias':'agent_semantic_review',evidence:automatic?'same confirmed fact or approved profile alias':evidence,query:choice.optionQueries?.[option]||option};
}
export function applyChoiceResolution(field,choice,profile){
 if(!choice?.options?.length||!['dropdown','radio','multiselect'].includes(field.control?.type))return field;
 if(field.control.type==='multiselect'){const fact=profile.facts[field.source];if(fact?.status==='known'&&(!Array.isArray(fact.value)||fact.value.some(v=>!choice.options.includes(v))))field.constructionBlockers.push('MULTISELECT_ARRAY_SOURCE_REQUIRES_OBSERVED_LABELS');return field;}
 let resolution=choice.resolutions?.[field.source];
 if(resolution&&majorPolicyHash(profile,field.source)!==null&&resolution.majorPolicyHash!==majorPolicyHash(profile,field.source))throw Error('CHOICE_RESOLUTION_STALE');
 if(resolution&&(resolution.optionsHash!==optionHash(choice)||resolution.sourceValue!==profile.facts[field.source]?.value))throw Error('CHOICE_RESOLUTION_STALE');
 const ranked=rankChoices(profile,field.source,choice.options);
 if(!resolution&&ranked.selection)resolution=resolveObservedChoice({profile,factKey:field.source,choice});
 if(!resolution){if(profile.facts[field.source]?.status==='known')field.constructionBlockers.push('CHOICE_SEMANTIC_RESOLUTION_REQUIRED');return field;}
 field.enumMap={...(field.enumMap||{}),[resolution.sourceValue]:resolution.selectedOption};field.choiceResolution=resolution;
 field.actions=field.actions.map(a=>({...a,query:resolution.query,...(resolution.optionValue!==null?{expectedOptionValue:resolution.optionValue}:{})}));return field;
}

export function mergeObservedChoices(previous=[],updates=[]){
 const merged=new Map(previous.map(c=>[c.selector,c]));
 for(const item of updates){const old=merged.get(item.selector);
  const recordMap=new Map([...(old?.optionRecords||[]),...(item.optionRecords||[])].map(r=>[r.label,r]));const optionRecords=[...recordMap.values()];
  const searches=[...(old?.searches||[]),...(item.searches||[]),...(item.queryApplied&&item.query?[{query:item.query,options:item.options||[],restored:item.restored===true}]:[])];
  const optionQueries={...(old?.optionQueries||Object.fromEntries((old?.options||[]).map(o=>[o,old.query||o]))),...(item.optionQueries||Object.fromEntries((item.options||[]).map(o=>[o,item.query||o])))};
  if(old?.status==='captured'&&old.restored&&item.restored&&['captured','captured_empty_search'].includes(item.status))merged.set(item.selector,{...old,...item,status:'captured',options:[...new Set([...old.options,...(item.options||[])])],optionRecords,optionQueries,searches,scope:'observed_option_union',coverage:{complete:old.coverage?.complete===true||item.coverage?.complete===true}});
  else merged.set(item.selector,{...item,optionQueries,searches});
 }return [...merged.values()];
}

export async function assertStoredChoiceResolutions(template,{store,companyId,profile}){
 for(const f of template.pages.flatMap(p=>p.fields)){
  if(f.kind!=='choice'||(!f.enumMap&&!f.actions?.some(a=>a.optionTextMap)))continue;
  const r=f.choiceResolution;if(!r?.choicesId||!r.captureId||!r.selector)throw Error('STORED_CHOICE_CONFIRMATION_REQUIRED');
  const asset=await store.get('runs',r.choicesId),choice=asset.choices?.find(c=>c.selector===r.selector);
  const locked=f.readonly&&f.lockedControl&&lockedChoice(choice)&&f.lockedControl.value===choice.lockedControl.value;
  if(asset.companyId!==companyId||asset.pageUrl!==template.evidence.sourceUrl||asset.captureId!==r.captureId||!f.inventorySelectors?.includes(r.selector)||!choice||choice.restored!==true||choice.status!=='captured'&&!locked||optionHash(choice)!==r.optionsHash||!choice.options.includes(r.selectedOption))throw Error('STORED_CHOICE_CONFIRMATION_CHANGED');
  if(profile?.facts?.[f.source]?.status==='known'&&JSON.stringify(profile.facts[f.source].value)!==JSON.stringify(r.sourceValue))throw Error('CHOICE_RESOLUTION_STALE');
  if(profile&&majorPolicyHash(profile,f.source)!==null&&r.majorPolicyHash!==majorPolicyHash(profile,f.source))throw Error('CHOICE_RESOLUTION_STALE');
  if(f.enumMap?.[r.sourceValue]!==r.selectedOption)throw Error('CHOICE_MAPPING_DIFFERS_FROM_CONFIRMATION');
 }
 return true;
}
