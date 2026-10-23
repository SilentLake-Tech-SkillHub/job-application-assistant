// Construction may explicitly select a collector even when an obsolete template
// exists. Keep its page contract, but never let it override the requested reader.
export function acquisitionPlan(plan, provider) {
 return {...(plan || {}), ...(provider ? {provider} : {})};
}

export async function detectedAcquisitionPlan(page,plan,provider){
 const observed=await page.observe({fields:[],groups:[{id:'ant',selector:'form.ant-form .ant-form-item'},{id:'feishu',selector:'.atsx-form-item[data-cy]'},{id:'phoenix',selector:'.form-item--phoenix'}]});
 const found=['ant','feishu','phoenix'].filter(key=>observed.groups?.[key]>0);
 if(!provider&&found.length>1)throw Error('FORM_PROVIDER_AMBIGUOUS');
 if(provider&&found.length&&!found.includes(provider))throw Error('FORM_PROVIDER_EVIDENCE_MISMATCH');
 return acquisitionPlan(plan,provider||found[0]);
}
export async function assertCollectionProvider(page,plan){
 const actual=await detectedAcquisitionPlan(page,plan,plan?.provider);
 if(actual.provider&&actual.provider!==plan?.provider)throw Error('FORM_PROVIDER_REQUIRES_REBUILD');
 return true;
}

export function captureContentId(companyId,pageUrl,provider,controls,digest){
 return 'capture-'+companyId+'-'+digest({companyId,pageUrl,provider:provider||null,controls}).slice(0,24);
}

export function isChoiceControl(field) {
 return field.type === 'radio' || field.tag === 'select' || field.type === 'select' || field.renderer === 'ant_select' || field.renderer === 'phoenix_select' || field.renderer === 'phoenix_autocomplete' ||
  field.type === 'search' && field.contextProvider === '.ud-formily-item' ||
  field.type === 'combobox' && field.contextProvider === '.ant-form-item' ||
  ['choice','school_text'].includes(field.type) && field.contextProvider === '.atsx-form-item';
}
export const isDateControl=field=>['ant_date','phoenix_date_picker'].includes(field.renderer)||['date','month'].includes(field.type);

// These options came from rendered controls in the bound capture, not a model
// supplied list. Reading them needs no clicks and cannot alter the selection.
export function capturedChoiceOptions(field) {
 if(field.type !== 'radio' && field.tag !== 'select' && field.type !== 'select')return null;
 const options = (field.options || []).filter(x => typeof x === 'string' && x.trim());
 return {options,...(Array.isArray(field.optionRecords)?{optionRecords:structuredClone(field.optionRecords)}:{}),status: options.length ? 'captured' : 'options_not_observed', restored: true, source: 'rendered_control_capture'};
}

export function compactConstructionResult(built) {
 const pendingCounts = {};
 for(const field of built.pending)pendingCounts[field.kind]=(pendingCounts[field.kind]||0)+1;
 return {readyToRegister:built.readyToRegister,blockers:built.blockers,contentReady:built.contentReady,contentBlockers:built.contentBlockers,
  pending:built.pending.filter(field=>field.kind!=='ready'),pendingCounts,
  fieldCount:built.template.pages.reduce((n,page)=>n+page.fields.length,0),
  choiceGoals:built.choiceGoals,nextGoals:built.nextGoals,
  nextTools:built.nextTools,requiresUser:built.requiresUser};
}

export function templateFromDraft(draft, {companyId,draftHash}, digest) {
 if(draft.companyId!==companyId)throw Error('DRAFT_COMPANY_SCOPE_MISMATCH');
 if(!draftHash || digest(draft.template)!==draftHash)throw Error('DRAFT_TEMPLATE_HASH_CHANGED');
 if(!draft.readyToRegister || draft.blockers?.length)throw Error('DRAFT_CONSTRUCTION_INCOMPLETE');
 return draft.template;
}
