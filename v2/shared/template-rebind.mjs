import {compareControlStructures} from './control-structure.mjs';
const key=c=>JSON.stringify([c.group||null,c.repeatIndex??null,c.fieldKey||null,c.controlIndex??null,c.type,c.label]);
// Offline only: same company, verified role and actual control correspondence.
export function rebindTemplate({template,baseline,current,roleId,confirmedTitle}){
 if(!roleId||current.companyId!==baseline.companyId||new URL(current.pageUrl).origin!==new URL(baseline.pageUrl).origin)throw Error('REBIND_COMPANY_SCOPE_CHANGED');
 if(!confirmedTitle||current.roleTitle!==confirmedTitle)throw Error('REBIND_ROLE_NOT_VERIFIED');
 // Earlier captures lost renderer metadata during label enrichment. fieldKey
 // is emitted only by the UD wrapper extractor; restore that captured identity,
 // never infer a renderer from company/platform naming.
 const normalize=c=>({...c,contextProvider:c.contextProvider||(c.fieldKey&&c.questionSelector?'.ud-formily-item':null)});
 const comparison=compareControlStructures(current.controls.map(normalize),baseline.controls.map(normalize));
 if(comparison.added.length||comparison.removed.length||current.controls.length!==baseline.controls.length)throw Error('REBIND_STRUCTURE_DELTA_REQUIRES_MAPPING');
 const byKey=new Map();for(const c of current.controls){const k=key(c);if(byKey.has(k))throw Error('REBIND_AMBIGUOUS_CONTROL');byKey.set(k,c);}
 const replacements=new Map();
 for(const c of baseline.controls){const n=byKey.get(key(c));if(!n||n.locatorStrategy!=='anchored_unique')throw Error('REBIND_STABLE_CONTROL_REQUIRED');for(const prop of ['selector','questionSelector','rowSelector','groupSelector'])if(c[prop]&&n[prop]){if(replacements.has(c[prop])&&replacements.get(c[prop])!==n[prop])throw Error('REBIND_AMBIGUOUS_CONTAINER');replacements.set(c[prop],n[prop]);}}
 const pairs=[...replacements].sort((a,b)=>b[0].length-a[0].length);
 const replace=v=>typeof v==='string'?pairs.reduce((s,[a,b])=>s.includes(a)?s.split(a).join(b):s,v):Array.isArray(v)?v.map(replace):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,replace(x)])):v;
 const result=replace(structuredClone(template));
 result.id=(template.id.slice(0,40)+'-'+roleId.replace(/[^a-z0-9_-]/g,'').slice(0,30)).slice(0,79);result.version=template.version+1;
 result.evidence={...result.evidence,sourceUrl:current.pageUrl,observedAt:current.observedAt,reboundFrom:template.id,baselineCaptureId:baseline.captureId,targetCaptureId:current.captureId};
 result.pages=result.pages.map(p=>({...p,pathPrefix:new URL(current.pageUrl).pathname,roleTitle:confirmedTitle,fields:p.fields.map(f=>({...f,prepareBeforeGroups:false}))}));result.validation={livePassed:false};
 return {template:result,comparison,requiresLiveVerification:true};
}
