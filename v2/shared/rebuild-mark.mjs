import {readFile} from 'node:fs/promises';
// The profile marks an execution contract as requires_rebuild when the form's
// questions or the user's major policy change. A template whose hash is still
// bound to such a contract must not run until it is rebuilt. Marks without a
// reason come from the earlier rule that fired on any page change (including
// the changes filling itself makes) and are not honoured.
export const REBUILD_REASONS=new Set(['question_definition_changed','major_policy_changed']);
export function contractRebuildRequired(profile,templateHash){
 if(!profile||!templateHash)return false;
 return Object.values(profile.companyForms||{}).some(form=>{const c=form?.executionContract;return c&&c.templateHash===templateHash&&REBUILD_REASONS.has(c.rebuildReason)&&(c.status==='requires_rebuild'||c.validForCurrentInventory===false);});
}
export async function readProfileFile(file){if(!file)return null;try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
