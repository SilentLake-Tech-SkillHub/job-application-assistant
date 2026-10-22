// Official metadata and a visible-control scan are independent evidence. A DOM
// template cannot silently drop empty sections or never-expanded questions.
import {readRoleIdentity} from './role-identity.mjs';
export function assertDefinitionMapped(profile,companyId,template){
 const definition=profile.companyDefinitions?.[companyId];if(!definition)return;
 if(template.coverage?.officialDefinitionHash!==definition.definitionHash)throw Error('OFFICIAL_DEFINITION_VERSION_NOT_BOUND');
 const fields=template.pages.flatMap(p=>p.fields),ids=new Set(fields.map(f=>f.schemaQuestionId).filter(Boolean));
 if(definition.fieldIds.some(id=>!ids.has(id)))throw Error('OFFICIAL_DEFINITION_HAS_UNMAPPED_QUESTIONS');
 if([...ids].some(id=>!definition.fieldIds.includes(id)))throw Error('UNKNOWN_OFFICIAL_QUESTION_ID');
}
export function matchesPageIdentity(page,pageUrl){
 const u=new URL(pageUrl);if(!u.pathname.startsWith(page.pathPrefix))return false;
 return !page.roleIdentity||readRoleIdentity(page.roleIdentity,pageUrl)?.value===page.roleIdentity.value;
}
