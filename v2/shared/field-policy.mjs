import {MATERIAL_SOURCES} from './business-materials.mjs';
// Technical construction gaps are not human-only actions.
export function humanActionReason(field) {
 const label=field.inventoryLabel||field.label||'';
 const choice=['choice','combobox','radio_group','radio','select','select-one'].includes(field.inventoryType||field.type)||['dropdown','radio'].includes(field.control?.type)||['ant_select','phoenix_select','phoenix_autocomplete'].includes(field.inventoryRenderer||field.renderer)||field.role==='combobox';
 if(choice&&/^(?:身份证件|身份证|证件|护照)(?:类型|类别)?$|^document\s*type$/i.test(label.trim()))return null;
 if(/验证码|captcha|one.time.code|\botp\b/i.test(label)||field.inventoryType==='password'||/密码|password/i.test(label))return 'authentication';
 if(/身份证|证件号码|身份证件|护照|银行卡|passport|national.id/i.test(label))return 'sensitive_identity';
 if(/签名|签署|signature|同意.*(?:协议|条款|政策)|consent|agreement|terms.of.service/i.test(label))return 'agreement';
 return null;
}
export function normalizeControlPolicy(controls){
 return controls.map(c=>{const reason=humanActionReason(c),documentChoice=!reason&&/身份证|证件|护照|document/i.test(c.label||'')&&(['choice','combobox','radio_group','radio','select','select-one'].includes(c.type)||c.renderer==='ant_select'||c.role==='combobox');return {...c,userOnly:documentChoice?false:!!c.userOnly||!!reason};});
}
export function fieldConstructionIssues(field) {
 const issues=[];
 if(/^education\.[^.]+\.major\.(canonical|application)$/.test(field.source||''))issues.push('MAJOR_REAL_SOURCE_REQUIRES_REBUILD');
 if(field.userOnly&&!humanActionReason(field))issues.push('ORDINARY_FIELD_MARKED_USER_ONLY');
 if(['school_text','choice','combobox','radio_group'].includes(field.inventoryType)&&field.kind==='text')issues.push('INTERACTIVE_WIDGET_REQUIRES_SELECTION_CONTRACT');
 if(field.readonly&&field.inventoryReadonly!==true&&field.inventoryDisabled!==true&&field.inventoryType!=='readonly')issues.push('READONLY_STATE_NOT_CAPTURED');
 if(field.constructionBlockers?.length)issues.push(...field.constructionBlockers);
 if(field.control?.options?.some(x=>/^(待补充|默认选项|暂无数据|placeholder)$/i.test(x)))issues.push('PLACEHOLDER_OPTIONS_NOT_EVIDENCE');
 return [...new Set(issues)];
}
export function templateConstructionIssues(template) {
 return [...(template.acquisitionBlockers||[]),(template.pages||[]).flatMap(p=>(p.fields||[]).flatMap(f=>fieldConstructionIssues(f).map(reason=>({id:f.id,label:f.inventoryLabel||f.label,reason}))))].flat();
}
export function classifyPending(field,profile) {
 const issues=fieldConstructionIssues(field);
 if(issues.length)return {kind:'construction',reasons:issues,owner:'agent'};
 if(field.userOnly)return {kind:'human_action',reason:humanActionReason(field),owner:'user'};
 if(field.source?.startsWith('unmapped.'))return {kind:'mapping',reason:'SEMANTIC_MAPPING_REQUIRED',owner:'agent'};
 if(Object.values(MATERIAL_SOURCES).includes(field.source))return {kind:'ready',owner:'agent',resolution:'confirmed_role_material_required_at_preflight'};
 if(field.ongoingSource&&profile?.facts?.[field.ongoingSource]?.status==='known'&&profile.facts[field.ongoingSource].value===true)return {kind:'ready',owner:'agent',resolution:'sourced_same_record_ongoing'};
 const fact=profile?.facts?.[field.source];
 if(!fact||fact.status==='missing')return {kind:'answer',reason:'CANONICAL_ANSWER_MISSING',owner:'user'};
 if(fact.status==='conflict')return {kind:'answer',reason:'CANONICAL_ANSWER_CONFLICT',owner:'user'};
 return {kind:'ready',owner:'agent'};
}
export function verificationSummary(checks=[],fieldIds=[]) {
 const ids=new Set(fieldIds),fields={},structure={};
 for(const c of checks){const out=ids.has(c.id)?fields:structure;out[c.status]=(out[c.status]||0)+1;}
 return {fields,structure,fieldCount:fieldIds.length,checkCount:checks.length};
}
