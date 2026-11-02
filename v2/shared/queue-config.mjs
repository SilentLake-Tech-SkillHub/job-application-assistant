import path from 'node:path';
import {RoleQueue} from './role-queue.mjs';
import {readHandoffBatch,handoffDirFromEnv} from './company-directory.mjs';
// MCP 只接受用户正向评审确认后的各公司宽表 岗位交接/公司/<公司编码>.json；旧的公司方案文件或对象输入一律拒绝。
export const handoffInput=(handoffDir=handoffDirFromEnv())=>async args=>{
 if(args?.rolesFile||args?.companyPlan)throw Error('HANDOFF_BATCH_REQUIRED');
 return readHandoffBatch({handoffDir});
};
export function roleQueueDirectory(env=process.env){const base=env.RECRUITING_PRIVATE_DIR||env.RECRUITING_PROFILE_JSON;return env.RECRUITING_ROLE_QUEUE_DIR||(base?path.join(path.dirname(base),'.role-queue'):null);}
export const queueFromEnv=(catalog,{handoffDir}={})=>new RoleQueue({root:roleQueueDirectory(),catalog,inputAdapter:handoffInput(handoffDir)});
