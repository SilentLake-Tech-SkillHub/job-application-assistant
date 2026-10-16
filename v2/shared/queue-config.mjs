import path from 'node:path';
import {RoleQueue} from './role-queue.mjs';
export const queueFromEnv=catalog=>new RoleQueue({root:process.env.RECRUITING_ROLE_QUEUE_DIR||path.join(path.dirname(process.env.RECRUITING_PROFILE_JSON),'.role-queue'),catalog});
