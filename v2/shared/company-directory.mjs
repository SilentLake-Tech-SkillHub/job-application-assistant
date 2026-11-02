import {validateMaterials} from './business-materials.mjs';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {keyOK} from './ids.mjs';

// 交接区 岗位交接/ 由搜索组件生成，投递组件只读：
//   公司/<公司编码>.json   每家公司一份宽表：「站点」「岗位」是主表投影，「批次」是本轮选岗、确认与进度
//   投递回传.json          投递组件唯一写入的文件（结果与链接观察）
// 身份一律用固定编码：公司 C00001、站点 S0001、岗位 J000001。链接、名称都是值，执行时现读宽表，不复制保存。
// 第 2 步完成前，各站点的登录配置仍在原公司文件夹 公司/<地区>/<公司>/登录[@域名].json，按站点域名对应。
export const CODE={company:/^C\d{5}$/,site:/^S\d{4}$/,role:/^J\d{6}$/};
const ASSET=/^(登录|表单定义)(?:@([^/\\]+))?\.json$/;
const HANDED=['已交接','进行中'];
// 内容指纹覆盖的执行字段（搜索端 company_store.py 的 EXEC_* 同一清单）
const EXEC_ROLE_FIELDS=['岗位编码','站点编码','岗位名称','岗位链接','投递链接','官方岗位ID','BU','志愿分组','志愿顺序','城市选项','链接说明','材料'];
const EXEC_SITE_FIELDS=['站点编码','站点','登录链接','账号核对页'];

export function handoffDirFromEnv(){
 if(process.env.RECRUITING_HANDOFF_DIR)return path.resolve(process.env.RECRUITING_HANDOFF_DIR);
 // 默认：组件安装在 <工作区>/.agents/skills/<组件>/，交接区在 <工作区>/岗位交接/
 return path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../../岗位交接');
}

async function entries(dir){try{return await readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return [];throw e;}}

// 与 Python json.dumps(obj, ensure_ascii=False, sort_keys=True) 逐字节一致，用于核对正向评审时登记的内容指纹。
export function pyJson(v){
 if(v===null||v===undefined)return 'null';
 if(typeof v==='boolean')return v?'true':'false';
 if(typeof v==='number'){if(!Number.isFinite(v))throw Error('NON_FINITE_NUMBER');return String(v);}
 if(typeof v==='string')return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(pyJson).join(', ')+']';
 const keys=Object.keys(v).sort((a,b)=>{const x=[...a].map(c=>c.codePointAt(0)),y=[...b].map(c=>c.codePointAt(0));for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;});
 return '{'+keys.map(k=>JSON.stringify(k)+': '+pyJson(v[k])).join(', ')+'}';
}
const pick=(o,fields)=>Object.fromEntries(fields.map(f=>[f,o[f]??null]));
const byKey=k=>(a,b)=>a[k]<b[k]?-1:a[k]>b[k]?1:0;
// 内容指纹的范围：本批选中岗位的执行字段 + 它们所在站点（与搜索端 handoff_view 一致）。
export function handoffView(doc){
 const batch=doc['批次']||{},chosen=new Set(batch['选中岗位']||[]);
 const roles=(doc['岗位']||[]).filter(r=>chosen.has(r['岗位编码'])).map(r=>pick(r,EXEC_ROLE_FIELDS)).sort(byKey('岗位编码'));
 const used=new Set(roles.map(r=>r['站点编码']));
 const sites=(doc['站点']||[]).filter(s=>used.has(s['站点编码'])).map(s=>pick(s,EXEC_SITE_FIELDS)).sort(byKey('站点编码'));
 return {'公司编码':doc['公司编码'],'批次编号':batch['批次编号']??null,'执行':batch['执行']??null,'岗位':roles,'站点':sites};
}
export const contentSha=doc=>createHash('sha256').update(pyJson(handoffView(doc)),'utf8').digest('hex');
export const combinedSha=files=>createHash('sha256').update(pyJson(Object.keys(files).sort().map(c=>[c,files[c].contentSha256])),'utf8').digest('hex');

export async function readCompanyFile(handoffDir,code){
 if(!CODE.company.test(code))throw Error('INVALID_COMPANY_CODE');
 const file=path.join(path.resolve(handoffDir),'公司',code+'.json');
 return {file,doc:JSON.parse(await readFile(file,'utf8'))};
}
export async function readCompanyFiles(handoffDir=handoffDirFromEnv()){
 const out=[];
 for(const f of (await entries(path.join(path.resolve(handoffDir),'公司'))).filter(f=>f.isFile()&&/^C\d{5}\.json$/.test(f.name))){
  const code=f.name.slice(0,-5);out.push({code,...await readCompanyFile(handoffDir,code)});
 }
 return out;
}

// 站点资产键：投递组件私有表单资产（模板、采集/结构/选项记录、主档表单记录与题目键）在编码迁移前按旧站点标识存放，
// 且不少记录编号把该标识算进了指纹。迁移时一次性存下“站点编码 → 现有资产键”的固定绑定（私有 templates/site-asset-keys.json），
// 之后只读绑定，不再按名称或域名推算；没有绑定的站点（新站点）资产键就是站点编码。第 3 步表单编码上线后删除此绑定。
export async function readSiteAssetKeys(store){
 if(!store)return {};
 let keys;try{keys=await store.get('templates','site-asset-keys');}catch(e){if(e.code==='ENOENT')return {};throw e;}
 if(!keys||typeof keys!=='object'||Array.isArray(keys))throw Error('INVALID_SITE_ASSET_KEYS');
 const seen=new Set();
 for(const [s,k] of Object.entries(keys)){if(!CODE.site.test(s)||!keyOK(k)||seen.has(k))throw Error('INVALID_SITE_ASSET_KEYS');seen.add(k);}
 return keys;
}

export class CompanyDirectory{
 constructor({handoffDir=handoffDirFromEnv(),store=null}={}){this.handoffDir=path.resolve(handoffDir);this.base=path.join(this.handoffDir,'公司');this.store=store;}
 // 目录项 = 站点：id 是该站点的资产键（见 readSiteAssetKeys），siteId 是站点编码，companyId 是公司编码；登录链接、账号核对页来自宽表。
 async load(){
  const assetKeys=await readSiteAssetKeys(this.store);
  const logins={},definitions={};
  for(const region of (await entries(this.base)).filter(d=>d.isDirectory()))
   for(const firm of (await entries(path.join(this.base,region.name))).filter(d=>d.isDirectory())){
    const dir=path.join(this.base,region.name,firm.name);
    for(const f of (await entries(dir)).filter(d=>d.isFile())){
     const m=ASSET.exec(f.name);if(!m)continue;
     const file=path.join(dir,f.name),asset=JSON.parse(await readFile(file,'utf8'));
     const origin=asset.origin?new URL(asset.origin).origin:(m[2]?'https://'+m[2]:null);
     if(m[2]&&origin&&new URL(origin).host!==m[2])throw Error('COMPANY_ASSET_HOST_MISMATCH');
     if(!origin)throw Error(m[1]==='登录'?'LOGIN_ORIGIN_REQUIRED':'DEFINITION_ORIGIN_REQUIRED');
     const target=m[1]==='登录'?logins:definitions;if(target[origin])throw Error('DUPLICATE_SITE_ASSET:'+origin);target[origin]=file;
    }
   }
  const out=[],ids=new Set();
  for(const {code,file,doc} of await readCompanyFiles(this.handoffDir)){
   if(doc['公司编码']!==code)throw Error('COMPANY_FILE_CODE_MISMATCH');
   for(const s of doc['站点']||[]){
    if(!CODE.site.test(s['站点编码']))throw Error('INVALID_SITE_CODE');
    if(ids.has(s['站点编码']))throw Error('DUPLICATE_SITE_CODE:'+s['站点编码']);ids.add(s['站点编码']);
    const origin=new URL(s['站点']).origin;
    const id=assetKeys[s['站点编码']]||s['站点编码'];
    if(out.some(e=>e.id===id))throw Error('DUPLICATE_SITE_ASSET_KEY:'+id);
    out.push({id,siteId:s['站点编码'],companyId:code,name:doc['公司名称'],origin,status:s['状态']||'在用',loginUrl:s['登录链接']||null,accountPageUrl:s['账号核对页']||null,
     channel:'campus',templateId:null,file,loginFile:logins[origin]||null,definitionFile:definitions[origin]||null});
   }
  }
  this.companies=out;return out;
 }
 entry(id){const e=(this.companies||[]).find(c=>c.id===id);if(!e)throw Error('UNKNOWN_COMPANY');return e;}
 loginFile(id){const f=this.entry(id).loginFile;if(!f)throw Error('COMPANY_LOGIN_NOT_CONFIGURED');return f;}
 definitionFile(id){return this.entry(id).definitionFile;}
}

// 本轮已确认交接的公司文件（每家各自核对：确认后被改动的那一家才拒绝）。
export async function readHandoffCompanies({handoffDir=handoffDirFromEnv(),states=HANDED}={}){
 const files=(await readCompanyFiles(handoffDir)).filter(f=>states.includes(f.doc['批次']?.['状态'])&&(f.doc['批次']['选中岗位']||[]).length);
 const ids=new Set(files.map(f=>f.doc['批次']['批次编号']));
 if(!files.length)throw Error('HANDOFF_NOT_CONFIRMED');
 if(ids.size!==1)throw Error('HANDOFF_MULTIPLE_BATCHES');
 for(const f of files){const c=f.doc['批次']['确认'];if(!c?.userQuote||c.contentSha256!==contentSha(f.doc))throw Error('HANDOFF_CHANGED_AFTER_CONFIRMATION');}
 return {batchId:[...ids][0],files};
}

// 投递输入只来自用户正向评审确认后的公司宽表；角色身份是岗位编码，链接、标题、材料都是现读的值。
export async function readHandoffBatch({handoffDir=handoffDirFromEnv()}={}){
 const {batchId,files}=await readHandoffCompanies({handoffDir});
 let outcomes={};try{outcomes=JSON.parse(await readFile(path.join(path.resolve(handoffDir),'投递回传.json'),'utf8')).roles||{};}catch(e){if(e.code!=='ENOENT')throw e;}
 files.sort((a,b)=>(a.doc['批次']['公司顺序']||0)-(b.doc['批次']['公司顺序']||0)||(a.code<b.code?-1:1));
 const companies=files.map(({code,doc},i)=>{
  const roles=new Map((doc['岗位']||[]).map(r=>[r['岗位编码'],r]));
  // 志愿顺序由用户给定，只在志愿分组内排；分组内多个岗位时必须是不重复的正整数。
  const chosen=doc['批次']['选中岗位'].map(j=>{const r=roles.get(j);if(!r)throw Error('HANDOFF_ROLE_MISSING');return r;});
  const groups=new Map();for(const r of chosen){const g=r['志愿分组']||'公司';if(!groups.has(g))groups.set(g,[]);groups.get(g).push(r);}
  for(const list of groups.values()){const os=list.map(r=>r['志愿顺序']);if(list.length===1&&os[0]==null)continue;
   if(!os.every(o=>Number.isInteger(o)&&o>0)||new Set(os).size!==os.length)throw Error('INVALID_CONFIRMED_ROLE_ORDER');}
  return {companyId:code,name:doc['公司名称'],order:i+1,execution:doc['批次']['执行']||null,roles:chosen.map((r,j)=>{validateMaterials(r['材料'],r['岗位编码']);return roleView(r,j,outcomes);})};
 });
 const sources=Object.fromEntries(files.map(({code,file,doc})=>[code,{file,contentSha256:doc['批次']['确认'].contentSha256,scope:doc['批次']['确认'].scope,previousContentSha256:doc['批次']['确认'].previousContentSha256||null,selection:[...doc['批次']['选中岗位']]}]));
 const input={schemaVersion:1,materialContractVersion:2,batchId,version:1,confirmation:{status:'confirmed',reference:files.map(f=>f.doc['批次']['确认'].userQuote).join(' / ')},companies};
 return {input,source:{kind:'handoff',batchId,files:sources,contentSha256:combinedSha(sources)}};
}
// outcomes：投递回传.json 的 roles（按岗位编码）；已投递/已关闭的岗位和待用户处理的结果在组队列时受保护。
export function roleView(r,j,outcomes={}){
 const o=outcomes[r['岗位编码']];
 return {id:r['岗位编码'],roleId:r['岗位编码'],siteId:r['站点编码'],officialId:r['官方岗位ID']??null,title:r['岗位名称'],url:r['岗位链接'],
  ...(r['投递链接']?{applyUrl:r['投递链接']}:{}),materials:r['材料'],order:j+1,
  preference:{group:r['志愿分组']||'公司',rank:r['志愿顺序']||1,bu:r.BU||null},selected:true,
  applicationStatus:o?.event==='submission_confirmed'?'岗位已投递':o?.event==='role_closed'?'岗位失效/关闭':'岗位待投递',...(o?{applicationOutcome:{event:o.event}}:{})};
}

// 核对某家（或全部）公司文件仍是导入时确认的那一版。
export async function assertHandoffUnchanged(source,code=null){
 for(const c of code?[code]:Object.keys(source.files||{})){
  const recorded=source.files?.[c];if(!recorded)throw Error('ROLE_INPUT_CHANGED');
  let doc;try{doc=JSON.parse(await readFile(recorded.file,'utf8'));}catch(e){if(e.code==='ENOENT')throw Error('ROLE_INPUT_CHANGED');throw e;}
  const b=doc['批次']||{};
  if(!HANDED.includes(b['状态'])&&b['状态']!=='等待反向评审'||b['批次编号']!==source.batchId||b['确认']?.contentSha256!==recorded.contentSha256||contentSha(doc)!==recorded.contentSha256)throw Error('ROLE_INPUT_CHANGED');
 }
}
