import {readFile} from 'node:fs/promises';
// The profile marks an execution contract as requires_rebuild when the form's
// observed questions or the user's major policy change. A template whose hash
// is still bound to such a contract must not run until it is rebuilt.
export function contractRebuildRequired(profile,templateHash){
 if(!profile||!templateHash)return false;
 return Object.values(profile.companyForms||{}).some(form=>{const c=form?.executionContract;return c&&c.templateHash===templateHash&&(c.status==='requires_rebuild'||c.validForCurrentInventory===false);});
}
export async function readProfileFile(file){if(!file)return null;try{return JSON.parse(await readFile(file,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}}
