// 选择类控件的结构分类（任务单 C33，2026-11-15 用户确认“通用 → 控件库 → 兜底”）。
// 每家公司建库时，每个选择类控件记录：类型、展开类型、操作类型，以及四块定位——
// 字段外框、可交互的选择框（combobox）／点开它的按钮、弹出的候选菜单、选中后显示的结果。
// 第一层按网页通用标注（ARIA）分类；标注不够时按识别出的招聘系统控件库补；两层都认不出的
// 返回 unrecognized，由建库走 Agent 浏览器兜底。结果只记结构，不记任何个人值。
// 在页面内执行（自包含）：items=[{selector,container,action}]，container 为字段外框选择器，action 为当前采集的动作选择器。
export function controlAnatomyDOM(items){
 // 控件库识别表只在这里定义一处；本函数在页面内执行，不能引用模块外的常量。
 const LIBS=[
  {name:'feishu_ud',mark:/^ud__(?:select|treeSelect|tree-select|cascader)/,trigger:['ud__select__selector'],selected:[],search:[]},
  {name:'atsx',mark:/^atsx-(?:select|cascader)/,trigger:['atsx-select-selection','atsx-select-selector'],selected:['atsx-select-selection-selected-value','atsx-select-selection-item'],search:['atsx-select-search__field','atsx-select-selection-search-input']},
  {name:'ant',mark:/^ant-(?:select|cascader)/,trigger:['ant-select-selector','ant-select-selection'],selected:['ant-select-selection-item','ant-select-selection-selected-value'],search:['ant-select-selection-search-input','ant-select-search__field']},
  {name:'beisen_phoenix',mark:/^phoenix-select/,trigger:['phoenix-select'],selected:[],search:['phoenix-select__input']}
 ];
 const visible=n=>!!n&&!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
 const classes=n=>{const c=n.className;return String(c&&typeof c==='object'&&'baseVal' in c?c.baseVal:c||'').split(/\s+/).filter(Boolean);};
 const STATE=/(?:^|[-_])(?:open|opened|focus|focused|active|selected|disabled|hover|visible|show|shown|expanded|checked|loading|error|has-value|empty|placeholder)(?:$|[-_])/i;
 const stable=c=>!STATE.test(c)&&!/\d{3,}/.test(c)&&c.length<64;
 const popup=n=>{const v=n.getAttribute('aria-haspopup');return v&&v!=='false'?v:null;};
 const editable=n=>(n.tagName==='INPUT'||n.tagName==='TEXTAREA')&&!n.readOnly&&!n.disabled&&!['hidden','checkbox','radio','file'].includes(String(n.type||'').toLowerCase());
 const query=s=>{try{return [...document.querySelectorAll(s)];}catch{return null;}};
 // 外框内唯一的选择器：优先角色，其次稳定样式名，最后按层级位置。
 // 控件库已知的样式名优先（如“selected-value”里带 selected 字样，但不是状态样式）。
 const within=(root,rootSelector,target,preferred=[])=>{
  const all=[...root.querySelectorAll('*')],count=pred=>all.filter(pred).length,role=target.getAttribute('role');
  const roleAttr=role?'[role='+JSON.stringify(role)+']':'';
  if(role&&count(n=>n.getAttribute('role')===role)===1)return rootSelector+' '+roleAttr;
  const own=classes(target);
  for(const c of [...preferred.filter(c=>own.includes(c)),...own.filter(stable)])if(count(n=>classes(n).includes(c)&&(!role||n.getAttribute('role')===role))===1)return rootSelector+' .'+CSS.escape(c)+roleAttr;
  const steps=[];
  for(let n=target;n&&n!==root;n=n.parentElement){let i=1;for(let p=n.previousElementSibling;p;p=p.previousElementSibling)if(p.tagName===n.tagName)i++;steps.unshift(n.tagName.toLowerCase()+':nth-of-type('+i+')');}
  return rootSelector+' > '+steps.join(' > ');
 };
 return (items||[]).map(({selector,container,action})=>{
  const roots=query(container);
  if(!roots)return {selector,container,status:'invalid_selector'};
  if(roots.length!==1)return {selector,container,status:'container_not_unique',count:roots.length};
  const root=roots[0],all=[...root.querySelectorAll('*')],current=action?query(action)||[]:[];
  const candidates=all.filter(n=>n.getAttribute('role')==='combobox'||popup(n));
  const outer=candidates.filter(n=>!candidates.some(o=>o!==n&&o.contains(n))).filter(visible);
  const tokens=[root,...all].flatMap(classes);
  const library=LIBS.find(l=>tokens.some(c=>l.mark.test(c)))||null;
  let trigger=null,combobox=null,source=null;
  // 第一层：通用标注
  if(outer.length===1){trigger=outer[0];source='aria';const own=candidates.filter(n=>n.getAttribute('role')==='combobox'&&(n===trigger||trigger.contains(n)));combobox=trigger.getAttribute('role')==='combobox'?trigger:own.length===1?own[0]:null;}
  // 第二层：控件库
  if(!trigger&&library){
   const found=all.filter(n=>visible(n)&&classes(n).some(c=>library.trigger.includes(c)));
   if(found.length===1){trigger=found[0];source='library';const own=candidates.filter(n=>n.getAttribute('role')==='combobox'&&(n===trigger||trigger.contains(n)||n.contains(trigger)));combobox=own.length===1?own[0]:null;}
  }
  if(!trigger){
   const native=all.filter(n=>n.tagName==='SELECT'&&visible(n));
   if(native.length===1&&!outer.length)return {selector,container,status:'classified',source:'aria',library:null,expansion:'native_list',operation:'select',parts:{combobox:null,trigger:within(root,container,native[0]),search:null,selected:null},menuLink:null,currentActionMatches:current.length};
   return {selector,container,status:outer.length>1?'multiple_controls':'unrecognized',library:library?.name||null,comboboxCount:outer.length,currentActionMatches:current.length};
  }
  const searchNodes=editable(trigger)?[trigger]:[...trigger.querySelectorAll('input,textarea')].filter(n=>editable(n)&&visible(n));
  const librarySearch=library?all.filter(n=>editable(n)&&classes(n).some(c=>library.search.includes(c))):[];
  const search=searchNodes.length===1?searchNodes[0]:librarySearch.length===1?librarySearch[0]:null;
  const selectedNodes=library?all.filter(n=>classes(n).some(c=>library.selected.includes(c))):[];
  const selected=selectedNodes.length===1?selectedNodes[0]:null;
  const kind=[trigger,combobox,...candidates].filter(Boolean).map(popup).find(Boolean)||null;
  const autocomplete=[trigger,combobox].filter(Boolean).some(n=>['list','both'].includes(n.getAttribute('aria-autocomplete')));
  const multiLevel=kind==='tree'||tokens.some(c=>/treeSelect|tree-select|cascader/i.test(c));
  const expansion=multiLevel?'multi_level':search||autocomplete?'popup_search':'popup_list';
  const operation=multiLevel?(tokens.some(c=>/cascader/i.test(c))?'cascade_select':'tree_select'):expansion==='popup_search'?'search_select':'select';
  const menuLink=[trigger,combobox].filter(Boolean).some(n=>n.getAttribute('aria-controls')||n.getAttribute('aria-owns'))?'aria-controls':null;
  return {selector,container,status:'classified',source,library:library?.name||null,expansion,operation,popup:kind,
   parts:{combobox:combobox?within(root,container,combobox,library?.trigger):null,trigger:within(root,container,trigger,library?.trigger),search:search?within(root,container,search,library?.search):null,selected:selected?within(root,container,selected,library?.selected):null},
   menuLink,currentActionMatches:current.length,currentIsCombobox:current.length===1&&!!combobox&&current[0]===combobox};
 });
}

// 需要分类的采集控件：可交互的选择类控件；引用式定位（antq:/phoenixq:/uploadq:）和原生 select 保持原驱动。
export function anatomyCandidate(c){
 if(!c||c.userOnly||c.tag==='select'||['radio','radio_group','checkbox','file','month','year','date','readonly'].includes(c.type))return false;
 if([c.selector,c.questionSelector,c.actionSelector].some(s=>typeof s==='string'&&/^(?:antq|phoenixq|uploadq):/.test(s)))return false;
 return c.role==='combobox'||['choice','school_text','combobox','search','select'].includes(c.type)||/combobox/.test(c.actionSelector||'');
}

const KNOWN_PROVIDERS=['.atsx-form-item','.ant-form-item','.ud-formily-item'];
// 建库读取的控件视图：分类结果不改采集记录（不影响采集哈希），只在建模板与选项采集时套用。
// 控件的 type 不改：填写前按现场采集核对控件契约时，题目类型仍与采集一致。
export function withControlAnatomy(control,anatomy){
 if(anatomy?.status!=='classified')return control;
 const out={...control,anatomy:anatomySummary(anatomy)};
 // 原动作选择器不唯一（找不到或多个）时，改用分类出的唯一选择框。
 if(anatomy.currentActionMatches!==1&&anatomy.parts.combobox){out.actionSelector=anatomy.parts.combobox;out.anatomy.repairedAction=true;}
 // 未识别表单框架的控件：按通用标注接入通用下拉驱动。
 const known=KNOWN_PROVIDERS.includes(control.contextProvider)||String(control.renderer||'').startsWith('phoenix');
 if(!known&&anatomy.source==='aria'&&anatomy.parts.combobox&&anatomy.expansion!=='native_list'){
  Object.assign(out,{role:'combobox',genericChoice:true,actionSelector:out.actionSelector&&anatomy.currentActionMatches===1&&anatomy.currentIsCombobox?out.actionSelector:anatomy.parts.combobox});
  if(!out.selectedSelector)out.selectedSelector=anatomy.parts.selected||anatomy.parts.trigger;
  if(anatomy.expansion==='multi_level'&&!anatomy.menuLink&&!out.menuSelector)out.menuSelector='[role="tree"]';
 }
 return out;
}
export const anatomyControls=capture=>(capture?.controls||[]).map(c=>withControlAnatomy(c,capture.controlAnatomy?.[c.selector]));
export function anatomySummary(a){
 return {source:a.source,library:a.library||null,expansion:a.expansion,operation:a.operation,parts:a.parts};
}

// 每个控件由哪一层做出来：通用（ARIA 或原生 HTML）、控件库、Agent 浏览器兜底。
const LIBRARY_METHOD=/^(?:ud_|ant_|phoenix_|feishu_)/;
export function controlSource(field){
 const actions=field.actions||[];
 if(actions.some(a=>a.method==='recorded_sequence'))return 'fallback';
 if(field.controlAnatomy?.source)return field.controlAnatomy.source==='aria'?'generic':'library';
 return actions.some(a=>LIBRARY_METHOD.test(a.method||''))?'library':'generic';
}
export function controlSources(template){
 const fields=(template?.pages||[]).flatMap(p=>p.fields||[]).filter(f=>!f.readonly&&!f.userOnly&&(f.actions||[]).length);
 const out={generic:0,library:0,fallback:0,fallbackFields:[]};
 for(const f of fields){const s=controlSource(f);out[s]++;if(s==='fallback')out.fallbackFields.push(f.label);}
 return out;
}
