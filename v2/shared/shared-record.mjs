import {createHash} from 'node:crypto';
// A distinct job URL does not imply a distinct draft. Detect only observed
// record identifiers; never infer a candidate record from the expected role.
export function sharedRecordKey(pageUrl){
 const u=new URL(pageUrl),record=u.searchParams.get('resumeId');
 if(!record)return null;
 return createHash('sha256').update(JSON.stringify([u.origin,u.pathname,record])).digest('hex');
}
export function assertIndependentDrafts(tasks){
 const seen=new Set();for(const task of tasks){const key=sharedRecordKey(task.pageUrl);if(!key)continue;if(seen.has(key))throw Error('SHARED_RESUME_REQUIRES_SINGLE_WRITER');seen.add(key);}
}
