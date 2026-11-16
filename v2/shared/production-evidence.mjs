// 生产证据（闭环方案 C，2026-11-14 用户决定）：组件按岗位留一份最新的生产证据，每个岗位一个记录、覆盖写，不留历史。
// 工作区固定脚本在状态确认后读它和【用户确认】（证据最高）更新任务单「生产验收台账」；组件不读也不写任务单。
// 只存运行编号、状态与时间，不存个人值。
export const productionEvidenceId=roleId=>{if(!/^J\d{6}$/.test(String(roleId||'')))throw Error('ROLE_CODE_REQUIRED');return 'production-'+roleId;};
export async function recordProductionEvidence(store,{roleId,companyId,stage,data,at=new Date().toISOString()}){
 if(!['fill','submission'].includes(stage))throw Error('PRODUCTION_STAGE_INVALID');
 const id=productionEvidenceId(roleId);
 let current=null;try{current=await store.get('runs',id);}catch(error){if(error.code!=='ENOENT')throw error;}
 const next={schemaVersion:1,id,operation:'production_evidence',roleId,companyId,...(current||{}),[stage]:{...data,at},updatedAt:at};
 next.roleId=roleId;next.companyId=companyId;
 await store.put('runs',id,next);return next;
}
