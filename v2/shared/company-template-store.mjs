import {ensureRoleBindings,selectCompanyRole,resolveCompanyRoleTemplate} from './company-role-template.mjs';

export async function loadCompanyTemplate(store,directory,companyId,roleId){
 let template=await store.get('templates',companyId);
 const roles=await directory.roles(companyId);
 if(roleId&&!roles.some(r=>r.roleId===roleId))throw Error('ROLE_NOT_IN_COMPANY');
 const indexed=ensureRoleBindings(template,roles);
 if(indexed!==template){
  template=await store.update('templates',companyId,current=>ensureRoleBindings(current,roles));
 }
 return template;
}
export async function companyRoleContext(task,directory,queues){
 let roleId=task.roleId;
 if(!roleId&&queues){
  const states=(await queues.entries()).filter(s=>!s.tasks&&s.taskId&&(task.pageId?s.pageId===task.pageId:s.returnUrl===task.pageUrl));
  const ids=new Set();
  for(const state of states){const queue=await queues.read(state.queueId),row=queue.tasks?.find(t=>t.taskId===state.taskId&&t.companyId===task.companyId);if(row)ids.add((await queues.hydrate(queue,row)).roleId);}
  if(ids.size===1)roleId=[...ids][0];
 }
 const config=await directory.loginConfig(task.companyId,{pageUrl:task.pageUrl});
 const role=selectCompanyRole(await directory.roles(task.companyId),{...task,roleId},config);
 return {role,config};
}
export async function resolveStoredCompanyRole(template,task,directory,queues){
 const {role,config}=await companyRoleContext(task,directory,queues);
 return {...resolveCompanyRoleTemplate(template,{companyId:task.companyId,role,pageUrl:task.pageUrl},config),executionRoleId:role.roleId};
}
