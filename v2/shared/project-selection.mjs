import {createHash} from 'node:crypto';
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export function selectApplicationProjects(profile,{projectIds,evidence}){
 if(!evidence?.trim()||!Array.isArray(projectIds)||!projectIds.length||new Set(projectIds).size!==projectIds.length||projectIds.some(id=>!profile.entities?.projects?.includes(id)))throw Error('KNOWN_PROJECT_SELECTION_REQUIRED');
 const sourceId='user-current-project-selection',selected={projectIds:[...projectIds],sourceId,recordedAt:new Date().toISOString()};
 profile.sources[sourceId]={kind:'user_reply',evidence,recordedAt:selected.recordedAt};profile.applicationSelections??={};profile.applicationSelections.projects=selected;
 const affected=[];
 for(const [key,form]of Object.entries(profile.companyForms||{})){
  const fields=form.executionContract?.fields||[],used=[...new Set(fields.flatMap(f=>{const id=f.source?.match(/^projects\.([^.]+)\./)?.[1];return id&&profile.entities.projects.includes(id)?[id]:[];}))],excluded=used.filter(id=>!projectIds.includes(id));
  if(used.length){form.projectRefresh={status:excluded.length?'requires_project_rebuild':'requires_project_readback',selectionHash:hash(projectIds),excludedProjectIds:excluded,futureApplicationsOnly:true};affected.push({companyId:form.companyId,pageKey:key,excludedProjectIds:excluded,status:form.projectRefresh.status});}
 }
 return {selectedProjectIds:projectIds,excludedProjectIds:profile.entities.projects.filter(id=>!projectIds.includes(id)),affectedForms:affected,originalFactsPreserved:true,nonProjectFactsChanged:false,browserAccess:false};
}
export function assertSelectedProjects(profile,template){
 const selected=profile.applicationSelections?.projects?.projectIds;if(!selected)return;
 const rejected=[...new Set(template.pages.flatMap(p=>p.fields).flatMap(f=>{const id=f.source?.match(/^projects\.([^.]+)\./)?.[1];return id&&profile.entities.projects.includes(id)&&!selected.includes(id)?[id]:[];}))];
 if(rejected.length){const error=Error('PROJECT_SELECTION_REQUIRES_TEMPLATE_REFRESH');error.details={excludedProjectIds:rejected,nextTool:'form_build_template'};throw error;}
}
