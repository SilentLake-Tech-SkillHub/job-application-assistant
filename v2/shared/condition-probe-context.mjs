import {constructionTemplate} from './template-lifecycle.mjs';
// Derive page identity from the confirmed queue, never from agent assertions.
export async function runConditionProbe(args,{boundRole,engine,store,assertAcquisition,refreshBindings}){
 const {companyId,pageUrl,roleId,templateHash,authorization}=args;
 const task={companyId,pageUrl,templateHash,...(roleId?{roleId}:{})};
 const keys=['queueId','queueHash','taskId'],present=keys.filter(key=>args[key]!==undefined);
 if(present.length||roleId){
  if(present.length!==3)throw Error('ROLE_QUEUE_CONTEXT_REQUIRED');
  await refreshBindings?.();
  const queue=Object.fromEntries(keys.map(key=>[key,args[key]]));
  const {t,state}=await boundRole(queue);
  if(t.companyId!==companyId||state.returnUrl!==pageUrl||roleId&&t.roleId!==roleId)throw Error('ROLE_PROBE_SCOPE_MISMATCH');
  Object.assign(task,{roleId:t.roleId,taskId:t.taskId,pageId:state.pageId,browserBinding:state.browserBinding,roleQueueArgs:queue});
 }
 const company=engine.companyForTask(task);
 if(!company?.templateId)throw Error('COMPANY_NOT_COVERED');
 await assertAcquisition(await constructionTemplate(store,company.templateId,templateHash),{store,companyId});
 return {...await engine.probeCompany(task,authorization),operation:'internal_condition_probe'};
}
