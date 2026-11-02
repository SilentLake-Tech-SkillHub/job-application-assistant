import {evaluateBusinessAuthorization} from './business-authorization.mjs';
export {PROTECTED_IDENTITY_SOURCE} from './business-authorization.mjs';
// Compatibility projection. Classification and execution use the same durable
// business permission; no value or action is written into a company template.
export function authorizedProfileField(profile,field,{fields=[]}={}){
 const decision=evaluateBusinessAuthorization(profile,{operation:'identity_fill',phase:'classify',field,fields});
 if(decision.decision!=='allow')return null;
 const {source,sourceHash,documentTypeGuard}=decision;return {source,sourceHash,documentTypeGuard};
}
