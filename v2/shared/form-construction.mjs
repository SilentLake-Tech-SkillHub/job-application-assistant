import {resolveDateRepresentation} from './date-representation.mjs';
import {readRoleIdentity} from './role-identity.mjs';
import {materialKey,MATERIAL_SOURCES} from './business-materials.mjs';
import {applyChoiceResolution} from './choice-resolution.mjs';
import {evaluateChoiceGoals} from './choice-goal-contract.mjs';
import {createHash} from 'node:crypto';
import {CONTROL_TYPES} from './control-registry.mjs';
import {humanActionReason,classifyPending,templateConstructionIssues} from './field-policy.mjs';
const digest=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const key=s=>(s||'').normalize('NFKC').replace(/[\s＊*：:]/gu,'').toLowerCase();
export function mappingCandidates(controls,profile){
 return controls.map(c=>({selector:c.selector,label:c.label,section:c.section||c.group||null,repeatIndex:c.repeatIndex??null,owner:'agent',candidates:[...(materialKey(c)?[{factKey:MATERIAL_SOURCES[materialKey(c)],status:'confirmed_handoff_material'}]:[]),...Object.entries(profile.fieldRegistry||{}).filter(([k,r])=>!k.startsWith('unmapped.')&&!r.neverStoreValue&&[r.label,r.question,...(r.aliases||[])].some(x=>key(x)&&key(x)===key(c.label))).map(([factKey])=>({factKey,status:profile.facts[factKey]?.status||'missing'}))],automaticMapping:false}));
}
export function inferControl(c){
 if(c.multiple&&(c.renderer==='ant_select'||c.tag==='select'))return 'multiselect';
 if(c.contextProvider==='.atsx-form-item'){
  const type={month:'month_picker',year:'year_picker',choice:'dropdown',radio_group:'radio',readonly:'readonly_text',school_text:'dropdown'}[c.type];if(type)return type;
 }
 if(c.type==='password')return 'text';
 if(c.renderer==='phoenix_autocomplete')return 'searchable_text';
 if(c.renderer==='phoenix_date_picker')return null; // Precision comes from its captured calendar panel.
 if(c.renderer==='phoenix_radio'||c.type==='radio')return 'radio';
 if(c.type==='file')return 'file_upload';
 if(c.type==='checkbox')return 'checkbox';
 if(c.renderer==='ant_select'||c.type==='combobox'||c.tag==='select'||c.type==='select'||c.type==='search'&&c.contextProvider==='.ud-formily-item')return 'dropdown';
 if(c.renderer==='ant_date'||['date','month'].includes(c.type)||c.placeholder&&/^YYYY(?:[-/]MM)?(?:[-/]DD)?$/.test(c.placeholder)){
  if(c.placeholder==='YYYY'||c.precision==='year')return 'year_picker';
  if(c.type==='month'||c.placeholder==='YYYY-MM'||c.precision==='month')return 'month_picker';
  return 'day_picker';
 }
 if(c.readonly)return 'readonly_text';
 if(['text','email','tel','number','url','textarea','search'].includes(c.type)||c.tag==='textarea')return 'text';
 return null;
}
function fieldFromControl(c,m,choice){
 const type=c.renderer==='phoenix_date_picker'&&choice?.dateOptions?.precision==='month'?'month_picker':inferControl(c),contract=CONTROL_TYPES[type],human=humanActionReason({inventoryLabel:c.label,inventoryType:c.type,inventoryRenderer:c.renderer,role:c.role});
 const f={id:'field-'+digest([c.selector,c.label]).slice(0,20),source:m?.factKey||'unmapped.pending',label:c.label||'未识别题目',required:!!c.required,inventorySelectors:c.inventorySelectors||[c.selector],inventoryLabel:c.label,inventoryType:c.type,inventoryReadonly:c.readonly===true||c.type==='readonly',inventoryDisabled:!!c.disabled,inventoryRenderer:c.renderer||null,read:{selector:c.selector,kind:'value'},actions:[],constructionBlockers:[]};
 if(!c.label)f.constructionBlockers.push('QUESTION_LABEL_NOT_CAPTURED');
 if(!m?.factKey||m.factKey.startsWith('unmapped.'))f.constructionBlockers.push('SEMANTIC_MAPPING_REQUIRED');
 if(!type){f.constructionBlockers.push('CONTROL_DRIVER_REQUIRED');return f;}
 f.kind=contract.kind;f.control={type,valueType:contract.valueType,readbackType:contract.readbackType};
 if(human){f.userOnly=true;f.userOnlyReason=human;f.constructionBlockers=f.constructionBlockers.filter(x=>x!=='SEMANTIC_MAPPING_REQUIRED');}
 const action=method=>({method,selector:c.actionSelector||c.selector});
 const framework=c.contextProvider;
 if(c.readSelector)f.read.selector=c.readSelector;
 if(c.documentTypePrefix)f.documentTypePrefix=c.documentTypePrefix;
 if(type==='readonly_text'){f.readonly=true;f.read.kind=framework==='.atsx-form-item'?'text':'value';}
 else if(type==='searchable_text'){if(c.renderer==='phoenix_autocomplete'&&choice?.restored===true&&(choice.options?.length||choice.customValueEvidence)){f.control.options=choice.options||[];f.actions=[{...action('phoenix_autocomplete'),labelSelector:c.labelSelector,options:choice.options||[],customValueEvidence:choice.customValueEvidence||null}];}else f.constructionBlockers.push('SEARCHABLE_TEXT_COMMIT_CONTRACT_REQUIRED');}
 else if(type==='text'){if(!human)f.actions=[action('fill')];}
 else if(type==='checkbox'){f.read.kind='checked';if(!human)f.actions=[action('check')];}
 else if(type==='dropdown'||type==='radio'||type==='multiselect'){
  const options=choice?.restored&&choice.status==='captured'?choice.options:c.tag==='select'||c.type==='select'||type==='radio'?c.options:null;
  f.control.options=options||[];
  if(!options?.length)f.constructionBlockers.push('OPTIONS_NOT_CAPTURED');
  f.read.selectedSelector=c.selectedSelector||c.questionSelector||c.selector;
  if(type==='multiselect'){f.read={selector:c.tag==='select'?c.selector:c.questionSelector||c.selector,kind:'selected_values',selectedSelector:c.selectedSelector||c.selector,...(c.tag==='select'?{nativeSelect:true}:{itemSelector:'.ant-select-selection-item-content, .ant-select-selection__choice__content'})};f.actions=[{...action(c.tag==='select'?'select_multiple':'ant_multiselect'),labelSelector:c.labelSelector,options:options||[],queryMap:choice?.optionQueries||{}}];}
  else if(type==='radio'){f.read={...f.read,selector:c.questionSelector||c.selector,kind:'radio'};if(!human)f.actions=[{method:c.renderer==='phoenix_radio'?'phoenix_radio':'radio',selector:c.questionSelector||c.selector,options:options||[]}];}
  else if(c.tag==='select'||c.type==='select'){f.read.nativeSelect=true;f.actions=[{...action('select'),options:options||[]}];}
  else if(c.renderer==='phoenix_select'){
   f.read.kind='text';f.read.selector=c.selectedSelector;f.read.selectedSelector=c.selectedSelector;
   if(!human)f.actions=[{...action('phoenix_dropdown'),labelSelector:c.labelSelector,options:options||[]}];
  }
  else if(framework==='.ant-form-item'||framework==='.ud-formily-item'){
   const method=framework==='.ant-form-item'?'ant_dropdown':'ud_dropdown';
   f.read.kind='text';f.read.selector=c.selectedSelector||c.questionSelector||c.selector;
   if(!human)f.actions=[{...action(method),labelSelector:c.labelSelector,options:options||[]}];
  }else if(c.role==='combobox'&&c.selectedSelector){f.read.kind='text';f.read.selector=c.selectedSelector;f.actions=[{...action('dropdown'),options:options||[]}];}
  else f.constructionBlockers.push('CONTROL_DRIVER_REQUIRED');
 }else if(f.kind==='date'){
  f.precision=type==='year_picker'?'year':type==='month_picker'?'month':'day';f.read.selectedSelector=c.selector;
  if(c.renderer==='phoenix_date_picker'&&choice?.dateOptions?.precision==='month'){f.read.kind='text';f.read.selector=c.selectedSelector||c.selector;f.actions=human?[]:[{...action('phoenix_date'),labelSelector:c.labelSelector}];}
  else if(framework==='.atsx-form-item'&&type!=='day_picker'){f.read.kind=type==='month_picker'?'month':'text';f.actions=human?[]:[action(type==='month_picker'?'feishu_month':'feishu_year')];}
  else if(['date','month'].includes(c.type)&&c.tag==='input'&&!c.readonly)f.actions=human?[]:[action('native_date')];
  else if(type==='day_picker'&&framework==='.ant-form-item'&&c.renderer==='ant_date')f.actions=human?[]:[{...action('ant_day'),openSelector:c.selector,openLabel:c.label,openKind:'captured_date_input',...(c.rangePeerSelector?{rangePeerSelector:c.rangePeerSelector,rangeIndex:c.rangeIndex}:{})}];
  else if(type!=='day_picker'&&framework==='.ud-formily-item')f.actions=human?[]:[action('ud_date')];
  else f.constructionBlockers.push('DATE_DRIVER_CONTRACT_REQUIRED');
 }else if(type==='file_upload'){
  f.read.kind='files';
  if(c.uploadContainerSelector&&c.filenameSelector&&c.uploadedSelector){f.read.selector=c.uploadContainerSelector;f.read.filenameSelector=c.filenameSelector;f.read.uploadedSelector=c.uploadedSelector;if(!human)f.actions=[action('upload')];}
  else f.constructionBlockers.push('UPLOAD_SITE_READBACK_REQUIRED');
 }
 if(c.disabled&&!c.when&&!human){
  if(choice?.status==='captured_locked_value'&&choice.restored===true&&choice.lockedControl?.disabled===true&&choice.lockedControl.selected===true&&choice.options?.length===1){
   f.readonly=true;f.actions=[];f.control.options=choice.options;f.read.requireDisabled=true;f.lockedControl=choice.lockedControl;
   f.constructionBlockers=f.constructionBlockers.filter(reason=>reason!=='OPTIONS_NOT_CAPTURED');
  }else f.constructionBlockers.push('DISABLED_CONTROL_DEPENDENCY_REQUIRED');
 }
 if(c.when)f.when=c.when;
 if(c.multiple&&type!=='multiselect')f.constructionBlockers.push('MULTISELECT_DRIVER_CONTRACT_REQUIRED');
 if(c.constructionBlockers?.length)f.constructionBlockers.push(...c.constructionBlockers.filter(reason=>!((c.renderer==='phoenix_date_picker'&&choice?.dateOptions?.precision==='month'||c.renderer==='phoenix_autocomplete'&&choice?.restored===true&&(choice.options?.length||choice.customValueEvidence))&&reason==='PHOENIX_OPTIONS_AND_DRIVER_REQUIRED')));
 if(m?.enumMap)f.enumMap=m.enumMap;
 f.constructionBlockers=[...new Set(f.constructionBlockers)];
 return f;
}
// One generator for every company. Company identities occur only in private input.
export function buildFormTemplate({capture,profile,mappings=[],choices=[],page,templateId,version=1,reaStructure,reaReconciliation=[]}){
 if(!capture?.controls?.length||!capture.pageUrl||!capture.observedAt)throw Error('CURRENT_CONTROL_CAPTURE_REQUIRED');
 if(!page?.roleTitle||!page.readySelector||!page.sections?.length||!page.sectionDiscovery)throw Error('OBSERVED_PAGE_CONTRACT_REQUIRED');
 if(reaStructure&&(reaStructure.pageUrl!==capture.pageUrl||reaStructure.companyId!==capture.companyId))throw Error('REA_CONTROL_CAPTURE_SCOPE_MISMATCH');
 if(page.provider&&capture.provider&&page.provider!==capture.provider)throw Error('FORM_PROVIDER_EVIDENCE_MISMATCH');
 page={...page,sections:page.sections.map(section=>typeof section==='string'?{title:section}:section),...(capture.provider?{provider:capture.provider}:{})};
 if(page.sections.some(section=>!section?.title))throw Error('OBSERVED_SECTION_TITLE_REQUIRED');
 const sectionSelectors=[...new Set(capture.controls.map(c=>c.sectionSelector).filter(Boolean))];
 if(capture.provider==='ant'&&sectionSelectors.length)page.sectionDiscovery={...page.sectionDiscovery,selectors:sectionSelectors};
 const groups=new Map();
 for(const c of capture.controls){const identity=c.type==='radio'&&c.questionSelector?c.questionSelector:c.selector;const prior=groups.get(identity);if(prior&&c.type!=='radio')throw Error('DUPLICATE_CAPTURED_SELECTOR');if(prior)prior.inventorySelectors.push(c.selector);else groups.set(identity,{...c,inventorySelectors:[c.selector]});}
 let fields=[...groups.values()].map(c=>{
  const f=fieldFromControl(c,mappings.find(m=>m.active!==false&&c.inventorySelectors.includes(m.selector)),choices.find(x=>x.selector===c.selector));
  const ongoing=f.source.replace(/\.(?:end|endDate|dateEnd|endMonth)$/u,'.ongoing');
  if(f.kind==='date'&&ongoing!==f.source&&profile.facts?.[ongoing]?.status==='known'&&typeof profile.facts[ongoing].value==='boolean')f.ongoingSource=ongoing;
  if(f.ongoingSource&&profile.facts[ongoing].value===true){
   const choice=choices.find(x=>x.selector===c.selector);
   const representation=resolveDateRepresentation(profile,{companyId:capture.companyId,pageUrl:capture.pageUrl,roleId:readRoleIdentity(page.roleIdentity,capture.pageUrl)?.value},f);
   if(representation)f.dateRepresentation={mode:representation.mode,source:representation.source};
   else if(c.renderer==='ant_date'&&choice?.status==='captured_date_options'&&choice.restored&&choice.dateOptions?.ongoingLabel)f.actions=f.actions.map(a=>({...a,ongoingLabel:choice.dateOptions.ongoingLabel}));
   else if(c.renderer==='phoenix_date_picker'&&choice?.dateOptions?.ongoingLabel)f.actions=f.actions.map(a=>({...a,ongoingLabel:choice.dateOptions.ongoingLabel}));
   else if(['ant_date','phoenix_date_picker'].includes(c.renderer))f.constructionBlockers.push('ONGOING_DATE_OPTION_REQUIRED');
  }
  return f;
 });
 const choiceGoals=evaluateChoiceGoals({capture,profile,fields,choices});
 fields=fields.map(f=>{
  const goal=choiceGoals.goals.find(g=>g.fieldId===f.id);
  if(goal){f.choiceGoal=goal;f.choiceGoalRequired=true;}
  f.constructionBlockers.push(...choiceGoals.blockers.filter(b=>b.fieldId===f.id).map(b=>b.reason));
  return applyChoiceResolution(f,choiceGoals.choices.find(c=>f.inventorySelectors.includes(c.selector)),profile);
 });
 const template={id:templateId,version,evidence:{sourceUrl:capture.pageUrl,observedAt:capture.observedAt,captureId:capture.captureId,choiceGoalContract:1,...(reaStructure?{reaEvidenceId:reaStructure.reaEvidenceId,reaEvidenceHash:reaStructure.reaEvidenceHash}: {})},pages:[{...page,pathPrefix:page.pathPrefix||new URL(capture.pageUrl).pathname,fields}],coverage:{allControlsMapped:false,allDriversSupported:false,allConditionalBranchesVerified:false}};
 const blockers=templateConstructionIssues(template);
 if(reaStructure){
  const unresolved=reaStructure.uncorrelatedControls||[];
  if(reaReconciliation.some(r=>!r.evidence?.trim()||!unresolved.some(n=>n.nodeId===r.nodeId)||r.selector&&!capture.controls.some(c=>c.selector===r.selector)||!r.selector&&!['outside_application_form','duplicate_accessibility_node'].includes(r.exclusion)))throw Error('REA_RECONCILIATION_EVIDENCE_REQUIRED');
  for(const n of unresolved)if(!reaReconciliation.some(r=>r.nodeId===n.nodeId))blockers.push({id:n.nodeId,label:n.label,reason:'REA_CONTROL_RECONCILIATION_REQUIRED'});
  template.evidence.reaReconciliation=reaReconciliation;
  template.acquisitionBlockers=blockers.filter(x=>x.reason==='REA_CONTROL_RECONCILIATION_REQUIRED');
 }
 const pending=fields.map(f=>({id:f.id,label:f.label,source:f.source,...classifyPending(f,profile)}));
 return {template,blockers,pending,choiceGoals:choiceGoals.goals,nextGoals:choiceGoals.nextGoals,choices:choiceGoals.choices,readyToRegister:blockers.length===0,nextTools:blockers.length?[...new Set([...choiceGoals.nextGoals.map(g=>g.nextTool),'capture_choice_options','profile_map_questions','form_build_template'])]:['template_register','probe_conditions','template_finalize','prepare_plan'],requiresUser:false};
}
