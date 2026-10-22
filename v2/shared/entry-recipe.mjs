// 岗位入口配方：站点差异只来自 JSON（catalog/entry-recipes.json 与公司 login.json 的 entry），代码不写任何域名或站点名。
import {readFileSync} from 'node:fs';
const CATALOG=JSON.parse(readFileSync(new URL('../catalog/entry-recipes.json',import.meta.url),'utf8'));
if(CATALOG.schemaVersion!==1||!Number.isInteger(CATALOG.readyTimeoutMs)||CATALOG.readyTimeoutMs<1000)throw Error('ENTRY_RECIPE_CATALOG_INVALID');
export const READY_TIMEOUT_MS=CATALOG.readyTimeoutMs;
const PARAM=/^[A-Za-z0-9_-]{1,80}$/;
const escape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
// 公司 entry: {kind:'resume_modal',...} 原样使用；或 {recipe:'<配方名>',params:{pathPrefix:'...'}}。
export function resolveEntry(c){
  const e=c?.entry;
  if(!e)return null;
  if(e.kind==='resume_modal')return e;
  if(typeof e.recipe!=='string')throw Error('ROLE_ENTRY_RECIPE_REQUIRED');
  const r=CATALOG.recipes[e.recipe];
  if(!r)throw Error('ROLE_ENTRY_RECIPE_UNKNOWN');
  const params=e.params||{};
  for(const v of Object.values(params))if(typeof v!=='string'||!PARAM.test(v))throw Error('ROLE_ENTRY_RECIPE_PARAM_INVALID');
  const sub=s=>s.replace(/\$\{(\w+)\}/g,(_,k)=>{if(!(k in params))throw Error('ROLE_ENTRY_RECIPE_PARAM_MISSING');return escape(params[k]);});
  if(params.pathPrefix&&!c.allowedPaths?.includes('/'+params.pathPrefix+'/'))throw Error('ROLE_ENTRY_RECIPE_SCOPE_MISMATCH');
  const out={...r,detailPathPattern:sub(r.detailPathPattern),formPathPattern:sub(r.formPathPattern),recipe:e.recipe,params,readyTimeoutMs:READY_TIMEOUT_MS};
  for(const k of ['detailPathPattern','formPathPattern','formPathTemplate','detailTitleSeparator','roleSelector'])if(typeof out[k]!=='string'||!out[k])throw Error('ROLE_ENTRY_RECIPE_INCOMPLETE');
  if(!out.entryButton?.role||!out.entryButton?.name)throw Error('ROLE_ENTRY_RECIPE_INCOMPLETE');
  return out;
}
export function fillPath(template,groups){return template.replace(/\{(\w+)\}/g,(_,k)=>{const v=groups?.[k];if(!v)throw Error('ROLE_ENTRY_PATH_GROUP_MISSING');return v;});}
export function matchEntryPath(entry,pathname){
  if(entry?.kind!=='detail_to_form')throw Error('ROLE_ENTRY_RECIPE_REQUIRED');
  const detail=pathname.match(new RegExp(entry.detailPathPattern)),form=pathname.match(new RegExp(entry.formPathPattern));
  const m=detail||form;
  return {detail:!!detail,form:!detail&&!!form,expectedApplyPath:m?fillPath(entry.formPathTemplate,m.groups):null};
}
