import path from 'node:path';
import {RoleQueue} from './role-queue.mjs';
import {readHandoffBatch,handoffDirFromEnv} from './company-directory.mjs';
// MCP 只接受用户正向评审确认后的 岗位交接/投递批次.json；旧的公司方案文件或对象输入一律拒绝。
export const handoffInput=(handoffDir=handoffDirFromEnv())=>async args=>{
 if(args?.rolesFile||args?.companyPlan)throw Error('HANDOFF_BATCH_REQUIRED');
 return readHandoffBatch({handoffDir});
};
export const queueFromEnv=(catalog,{handoffDir}={})=>new RoleQueue({root:process.env.RECRUITING_ROLE_QUEUE_DIR||path.join(path.dirname(process.env.RECRUITING_PRIVATE_DIR||process.env.RECRUITING_PROFILE_JSON),'.role-queue'),catalog,inputAdapter:handoffInput(handoffDir)});
