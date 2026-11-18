// Agent 浏览器兜底（C33，2026-11-13／14 用户要求与决定）。
// 哪些 Agent、哪些浏览器可用，只读组件外表单（默认 <工作区>/产品管理/Agent浏览器兜底登记.json，可用 RECRUITING_AGENT_FALLBACK_REGISTRY 指定）；
// 组件内不登记、不做能力检测，改登记不改组件。按执行端 RECRUITING_HOST_ID 对应 hostId；
// 页面在分身 Chrome（chrome:）对应“分身插件”，在内置浏览器（iab:）对应“内置浏览器”；兜底只在任务绑定的同一张标签上做。
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {validateRecordedSteps} from './control-operations.mjs';
export const SURFACE_BY_CHANNEL=Object.freeze({chrome:'chrome_clone_extension',main:'chrome_main_extension',iab:'builtin_browser'});
export const STEP_KINDS=['click_field','click_text','type_value','type_text','press'];
export function fallbackRegistryFile(env=process.env){
 return env.RECRUITING_AGENT_FALLBACK_REGISTRY||(env.RECRUITING_WORKSPACE_ROOT?path.join(env.RECRUITING_WORKSPACE_ROOT,'产品管理','Agent浏览器兜底登记.json'):null);
}
export async function loadFallbackRegistry(file){
 if(!file)return null;let data;
 try{data=JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return null;if(error instanceof SyntaxError)throw Error('AGENT_FALLBACK_REGISTRY_INVALID');throw error;}
 if(data?.schemaVersion!==1||!Array.isArray(data.agents)||data.agents.some(a=>typeof a?.hostId!=='string'||!Array.isArray(a['浏览器'])))throw Error('AGENT_FALLBACK_REGISTRY_INVALID');
 return data;
}
// 第三种方式“组件代点”（C41，2026-11-16 用户选择“A 作为第三种方式”“入口和表单控件都加”）：Agent 看页面决定怎么点，
// 组件用自己已经连着分身的浏览器通道（Playwright）执行；Agent 不另起浏览器工具。登记在同一张组件外表单里。
export const COMPONENT_SURFACE='component_playwright';
// componentClick：登记了组件代点。surface：页面所在浏览器也登记给了本 Agent（Agent 用自己的浏览器操作）；只登记了组件代点时为 null。
export function fallbackSurface({registry,hostId,pageId}){
 const channel=String(pageId||'').split(':')[0],surface=SURFACE_BY_CHANNEL[channel]||null;
 if(!registry)return {allowed:false,reason:'AGENT_FALLBACK_REGISTRY_MISSING'};
 const entry=registry.agents.find(a=>a.hostId===hostId);
 if(!entry)return {allowed:false,reason:'HOST_NOT_IN_FALLBACK_REGISTRY',hostId:hostId||null};
 const own=!!surface&&entry['浏览器'].includes(surface),componentClick=channel!=='main'&&entry['浏览器'].includes(COMPONENT_SURFACE);
 if(!own&&!componentClick)return {allowed:false,reason:'PAGE_BROWSER_NOT_IN_FALLBACK_REGISTRY',agent:entry.agent,hostId,surface};
 return {allowed:true,agent:entry.agent,hostId,surface:own?surface:null,surfaceLabel:own?registry['浏览器']?.[surface]||surface:null,componentClick,...(componentClick?{componentLabel:registry['浏览器']?.[COMPONENT_SURFACE]||COMPONENT_SURFACE}:{}),pageId};
}
// 这次兜底由谁执行：Agent 自己的浏览器（report）或组件代点（component）；对应方式没有登记就拒绝。
export function fallbackOperator(surface,mode){
 if(mode==='component'){if(!surface?.componentClick)throw Error('GUI_FALLBACK_SURFACE_CHANGED');return COMPONENT_SURFACE;}
 if(!surface?.surface)throw Error('GUI_FALLBACK_SURFACE_CHANGED');return surface.surface;
}
// 本人操作项（证件、验证码等）与没有可操作目标的字段不交给 Agent 兜底。
export function fallbackEligible(field){return !!field&&!field.userOnly&&!field.readonly;}
export function fieldTarget(field){
 return field.actions?.find(a=>a.selector&&a.method!=='scroll')?.selector||field.read?.selector||field.inventorySelectors?.[0]||null;
}
// Agent 回报的步骤 → 正式模板里该控件的操作定义；保留原有的滚动动作，其余替换为记录的序列。
export function recordedDefinition(field,steps,{agent,hostId,surface,at=new Date().toISOString()}){
 validateRecordedSteps(steps);
 const selector=fieldTarget(field);if(!selector)throw Error('FALLBACK_FIELD_TARGET_REQUIRED');
 const scroll=(field.actions||[]).filter(a=>a.method==='scroll');
 return [...scroll,{method:'recorded_sequence',selector,label:field.label||field.inventoryLabel||null,steps:structuredClone(steps),source:'agent_gui_fallback',recordedBy:{agent,hostId,surface,at}}];
}
export const FALLBACK_INSTRUCTION='只在这张已绑定的申请页上，用鼠标点击、键盘输入完成下列控件；不点提交、不改其他控件，不另开标签。完成后调用 form_gui_fallback（mode=report）逐个回报操作步骤：click_field 点本控件，click_text 点页面上的选项文字（text 写完整文字），type_value 输入本控件的值，type_text 输入其他文字（text），press 按键（Enter/Escape/Tab/ArrowDown/ArrowUp）。组件写回正式模板后会用同一步骤回放并独立读回。';
// 组件代点（表单控件）：Agent 只看截图写步骤，不自己操作页面；组件按步骤操作、回放测试并独立读回。
export const COMPONENT_FALLBACK_INSTRUCTION='组件代点：先用 role_screenshot 看这张已绑定的申请页，不要自己操作页面；按下列控件写出操作步骤（格式同 report：click_field、click_text 加完整文字、type_value、type_text、press），调用 form_gui_fallback（mode=component）交组件执行。组件用自己连着分身的浏览器通道按步骤操作、写回正式公司模板的操作定义并回放测试、独立读回。不提交。';
// 两种方式都登记时：先用 Agent 自己的浏览器；点不了（例如插件没连上、宿主不给点击）再用组件代点。
export function fallbackInstruction(surface){
 if(!surface?.surface)return COMPONENT_FALLBACK_INSTRUCTION;
 return surface.componentClick?FALLBACK_INSTRUCTION+' 你用自己的浏览器操作不了这张页面时（例如插件没连上、宿主不给点击），改用'+COMPONENT_FALLBACK_INSTRUCTION:FALLBACK_INSTRUCTION;
}
