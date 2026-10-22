// Some ATS résumé editors omit the job title. The independently read actual
// URL job ID remains usable; never manufacture a DOM title from the plan.
export function readRoleIdentity(spec,url){
 if(!spec)return null;const u=new URL(url),source=spec.source||'query',fragment=u.hash.slice(1),split=fragment.indexOf('?');let value=null;
 if(source==='query'||source==='hashQuery'){const q=source==='query'?u.searchParams:new URLSearchParams(split<0?'':fragment.slice(split+1));value=q.getAll(spec.parameter).length===1?q.get(spec.parameter):null;}
 else if(source==='path'||source==='hashPath'){
  if(typeof spec.pattern!=='string'||!spec.pattern.startsWith('^')||!spec.pattern.endsWith('$')||spec.pattern.length>500)throw Error('ROLE_IDENTITY_PATTERN_REQUIRED');
  value=new RegExp(spec.pattern).exec(source==='path'?u.pathname:split<0?fragment:fragment.slice(0,split))?.groups?.[spec.parameter]||null;
 }else throw Error('ROLE_IDENTITY_SOURCE_REQUIRED');
 return {parameter:spec.parameter,value,source};
}
export function matchesRole(plan,observed){
 if(plan.roleIdentity){
  const r=plan.roleIdentity,actual=observed.roleIdentity;
  return !!r.value&&actual?.parameter===r.parameter&&actual.value===r.value&&(!observed.roleTitle||observed.roleTitle===plan.roleTitle);
 }
 return !!plan.roleTitle&&observed.roleTitle===plan.roleTitle;
}
