import {MATERIAL_SOURCES} from './business-materials.mjs';
import {recordSourceBindingIssues} from './record-source-binding.mjs';
import {resolveDateFact,datePrecisionGap} from './date-fact-resolution.mjs';
import {projectDateValue,validDate} from './value-contract.mjs';
import {authorizedProfileField} from './authorized-profile-field.mjs';
import {evaluateBusinessAuthorization} from './business-authorization.mjs';
// Technical construction gaps are not human-only actions.
export function humanActionReason(field) {
 const label=field.inventoryLabel||field.label||'';
 const choice=['choice','combobox','radio_group','radio','select','select-one'].includes(field.inventoryType||field.type)||['dropdown','radio'].includes(field.control?.type)||['ant_select','phoenix_select','phoenix_autocomplete'].includes(field.inventoryRenderer||field.renderer)||field.role==='combobox';
 if(choice&&/^(?:身份证件|身份证|证件|护照)(?:类型|类别)?$|^document\s*type$/i.test(label.trim()))return null;
 if(/验证码|captcha|one.time.code|\botp\b/i.test(label)||field.inventoryType==='password'||/密码|password/i.test(label))return 'authentication';
 if(/身份证|证件号码|身份证件|护照|银行卡|passport|national.id/i.test(label))return 'sensitive_identity';
 // Agreement/declaration checkboxes the business switch covers. Preference questions such as
 // accepting reassignment are real answers from the profile, never agreements.
 if(/调剂|调配|转岗|服从.{0,4}分配|接受.{0,6}调整/.test(label))return null;
 if(/签名|签署|signature|同意.*(?:协议|条款|政策|声明|须知|告知|授权书|承诺书)|已阅读|阅读并同意|已知悉|知情同意|承诺.{0,12}(?:真实|属实|准确|有效)|(?:信息|资料)(?:真实|属实)|consent|agreement|terms.of.service|privacy policy|declaration|I (?:have read|agree|confirm|certify)/i.test(label))return 'agreement';
 return null;
}
// Only a real checkbox whose label is an agreement/declaration is covered by the business switch.
export function isAgreementCheckbox(field){
 if(humanActionReason(field)!=='agreement')return false;
 const type=field.inventoryType||field.type;
 return field.kind==='boolean'||type==='checkbox'||field.control?.type==='checkbox'||field.read?.kind==='checked';
}
export function normalizeControlPolicy(controls){
 return controls.map(c=>{const reason=humanActionReason(c),documentChoice=!reason&&/身份证|证件|护照|document/i.test(c.label||'')&&(['choice','combobox','radio_group','radio','select','select-one'].includes(c.type)||c.renderer==='ant_select'||c.role==='combobox');return {...c,userOnly:documentChoice?false:!!c.userOnly||!!reason};});
}
export function fieldConstructionIssues(field) {
 const issues=[];
 if(/^education\.[^.]+\.major\.(canonical|application)$/.test(field.source||''))issues.push('MAJOR_REAL_SOURCE_REQUIRES_REBUILD');
 if(field.userOnly&&!humanActionReason(field))issues.push('ORDINARY_FIELD_MARKED_USER_ONLY');
 if(['school_text','choice','combobox','radio_group'].includes(field.inventoryType)&&field.kind==='text'&&field.control?.type!=='searchable_text')issues.push('INTERACTIVE_WIDGET_REQUIRES_SELECTION_CONTRACT');
 if(field.control?.type==='searchable_text'&&!field.userOnly&&(!field.actions?.some(a=>a.method==='phoenix_autocomplete')||field.actions.some(a=>a.method==='fill')))issues.push('SEARCHABLE_TEXT_COMMIT_CONTRACT_REQUIRED');
 if(field.readonly&&field.inventoryReadonly!==true&&field.inventoryDisabled!==true&&field.inventoryType!=='readonly')issues.push('READONLY_STATE_NOT_CAPTURED');
 if(field.constructionBlockers?.length)issues.push(...field.constructionBlockers);
 if(field.choiceGoalRequired===true&&!field.choiceGoal)issues.push('CHOICE_GOAL_REQUIRED');
 if(field.choiceGoal&&field.choiceGoal.status!=='resolved')issues.push('CHOICE_GOAL_INCOMPLETE');
 if(field.control?.options?.some(x=>/^(待补充|默认选项|暂无数据|placeholder)$/i.test(x)))issues.push('PLACEHOLDER_OPTIONS_NOT_EVIDENCE');
 return [...new Set(issues)];
}
export function templateConstructionIssues(template) {
 return [...recordSourceBindingIssues(template),...(template.acquisitionBlockers||[]),(template.pages||[]).flatMap(p=>(p.fields||[]).flatMap(f=>{
  const issues=fieldConstructionIssues(f),goal=f.choiceGoal;
  if(template.evidence?.choiceGoalContract===1&&!f.userOnly&&!f.readonly&&['dropdown','radio','multiselect','searchable_text'].includes(f.control?.type)){
   if(!goal&&(f.choiceGoalRequired===true||f.choiceResolution||f.enumMap))issues.push('CHOICE_GOAL_REQUIRED');
   if(goal&&(goal.fieldId!==f.id||goal.factKey!==f.source||goal.captureId!==template.evidence.captureId||
      typeof goal.choicesId!=='string'||!goal.choicesId.trim()||typeof goal.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(goal.sourceHash)||
      !f.inventorySelectors?.includes(goal.selector)||goal.executionVerified!==false))issues.push('CHOICE_GOAL_BINDING_INVALID');
  }
  return [...new Set(issues)].map(reason=>({id:f.id,label:f.inventoryLabel||f.label,reason}));
 }))].flat();
}
export function classifyPending(field,profile,{fields=[]}={}) {
 const issues=fieldConstructionIssues(field);
 if(issues.length)return {kind:'construction',reasons:issues,owner:'agent'};
 if(authorizedProfileField(profile,field,{fields}))return {kind:'ready',owner:'agent',resolution:'authorized_profile'};
 const reason=humanActionReason(field);
 if(isAgreementCheckbox(field)){const grant=evaluateBusinessAuthorization(profile,{operation:'recruiting_privacy',phase:'classify',field});if(grant.decision==='allow')return {kind:'ready',owner:'agent',resolution:'authorized_privacy',authorizationRef:grant.authorizationRef};if(grant.decision==='technical_pending')return {kind:'construction',owner:'agent',reasons:[grant.reason]};}
 if(reason==='sensitive_identity'){const grant=evaluateBusinessAuthorization(profile,{operation:'identity_fill',phase:'classify',field,fields});if(grant.decision==='technical_pending')return {kind:grant.requiresUserInput?'answer':'construction',owner:grant.requiresUserInput?'user':'agent',reasons:[grant.reason],authorizationStillValid:true};}
 if(field.userOnly)return {kind:'human_action',reason,owner:'user'};
 if(field.source?.startsWith('unmapped.'))return {kind:'mapping',reason:'SEMANTIC_MAPPING_REQUIRED',owner:'agent'};
 if(Object.values(MATERIAL_SOURCES).includes(field.source))return {kind:'ready',owner:'agent',resolution:'confirmed_role_material_required_at_preflight'};
 if(field.ongoingSource&&profile?.facts?.[field.ongoingSource]?.status==='known'&&profile.facts[field.ongoingSource].value===true)return {kind:'ready',owner:'agent',resolution:'sourced_same_record_ongoing'};
 const fact=field.kind==='date'?resolveDateFact(profile,field.source).fact:profile?.facts?.[field.source];
 if(!fact)return {kind:'mapping',reason:'SOURCE_NOT_REGISTERED',owner:'agent'};
 if(fact.status==='missing')return {kind:'answer',reason:'CANONICAL_ANSWER_MISSING',owner:'user'};
 if(fact.status==='conflict')return {kind:'answer',reason:'CANONICAL_ANSWER_CONFLICT',owner:'user'};
 if(field.kind==='date'&&fact.status==='known'){
  const gap=datePrecisionGap(profile,field.source,field.precision);if(gap){const {sourcePrecision,requiredPrecision,missingComponents}=gap;return {kind:'answer',reason:'DATE_SOURCE_PRECISION_INSUFFICIENT',owner:'user',sourcePrecision,requiredPrecision,missingComponents,...(gap.derivedFrom.some(source=>source!==field.source)?{knownDateEvidence:gap}:{})};}
  const units=['year','month','day'],sourcePrecision=units.find(precision=>validDate(fact.value,precision)),requiredPrecision=field.precision;
  if(sourcePrecision&&units.includes(requiredPrecision)&&!validDate(projectDateValue(fact.value,requiredPrecision),requiredPrecision)&&units.indexOf(sourcePrecision)<units.indexOf(requiredPrecision))return {kind:'answer',reason:'DATE_SOURCE_PRECISION_INSUFFICIENT',owner:'user',sourcePrecision,requiredPrecision,missingComponents:units.slice(units.indexOf(sourcePrecision)+1,units.indexOf(requiredPrecision)+1)};
 }
 return {kind:'ready',owner:'agent'};
}
export function verificationSummary(checks=[],fieldIds=[]) {
 const ids=new Set(fieldIds),fields={},structure={};
 for(const c of checks){const out=ids.has(c.id)?fields:structure;out[c.status]=(out[c.status]||0)+1;}
 return {fields,structure,fieldCount:fieldIds.length,checkCount:checks.length};
}
