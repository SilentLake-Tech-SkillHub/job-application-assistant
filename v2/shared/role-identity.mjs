// Some ATS résumé editors omit the job title. The independently read actual
// URL job ID remains usable; never manufacture a DOM title from the plan.
export function matchesRole(plan,observed){
 if(plan.roleIdentity){
  const r=plan.roleIdentity,actual=observed.roleIdentity;
  return !!r.value&&actual?.parameter===r.parameter&&actual.value===r.value&&(!observed.roleTitle||observed.roleTitle===plan.roleTitle);
 }
 return !!plan.roleTitle&&observed.roleTitle===plan.roleTitle;
}
