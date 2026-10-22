import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// 公司目录与投递批次的唯一来源是工作区的 岗位交接/：
//   公司/<地区>/<公司>/公司.json            companyId、官网域名、官方岗位ID、志愿分组与用户给定的志愿顺序
//   公司/<地区>/<公司>/登录[@域名].json      各站点登录配置（一个站点一份）
//   公司/<地区>/<公司>/表单定义[@域名].json  官方表单定义
//   投递批次.json                            用户正向评审确认后的本批岗位
// 组件包里不再携带公司目录或公司资产，也不写死任何公司域名。
const ID=/^[a-z0-9][a-z0-9_-]{0,79}$/;
const slug=s=>s.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
const ASSET=/^(登录|表单定义)(?:@([^/\\]+))?\.json$/;

export function handoffDirFromEnv(){
 if(process.env.RECRUITING_HANDOFF_DIR)return path.resolve(process.env.RECRUITING_HANDOFF_DIR);
 // 默认：组件安装在 <工作区>/.agents/skills/<组件>/，交接区在 <工作区>/岗位交接/
 return path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../../../岗位交接');
}

async function entries(dir){try{return await readdir(dir,{withFileTypes:true});}catch(e){if(e.code==='ENOENT')return [];throw e;}}

export class CompanyDirectory{
 constructor({handoffDir=handoffDirFromEnv()}={}){this.handoffDir=path.resolve(handoffDir);this.base=path.join(this.handoffDir,'公司');}
 // 每家公司的每个站点（origin）是一个目录项：主站点用公司.json 的 companyId，其它站点用该站点登录配置里的 companyId，
 // 没有登录配置的站点用 <companyId>--<域名>。同一账号范围按站点区分，与引擎“一项一个 origin”的约定一致。
 async load(){
  const out=[],ids=new Set();
  for(const region of (await entries(this.base)).filter(d=>d.isDirectory()))
   for(const firm of (await entries(path.join(this.base,region.name))).filter(d=>d.isDirectory())){
    const dir=path.join(this.base,region.name,firm.name);let doc;
    try{doc=JSON.parse(await readFile(path.join(dir,'公司.json'),'utf8'));}catch(e){if(e.code==='ENOENT')continue;throw e;}
    if(!ID.test(doc.companyId||''))throw Error('INVALID_COMPANY_ID');
    const logins={},definitions={};let primary=null;
    for(const f of (await entries(dir)).filter(d=>d.isFile())){
     const m=ASSET.exec(f.name);if(!m)continue;
     const file=path.join(dir,f.name),asset=JSON.parse(await readFile(file,'utf8'));
     const origin=asset.origin?new URL(asset.origin).origin:(m[2]?'https://'+m[2]:null);
     if(m[2]&&origin&&new URL(origin).host!==m[2])throw Error('COMPANY_ASSET_HOST_MISMATCH');
     if(m[1]==='登录'){
      if(!origin)throw Error('LOGIN_ORIGIN_REQUIRED');
      if(!m[2]){primary=origin;if(asset.companyId!==doc.companyId)throw Error('LOGIN_COMPANY_ID_MISMATCH');}
      logins[origin]={file,id:asset.companyId};
     }else definitions[origin||'']=file;
    }
    const origins=[...new Set([primary,...(doc.origins||[]),...Object.keys(logins)].filter(Boolean))];
    if(!primary)primary=origins[0]||null;
    for(const origin of origins){
     let id=origin===primary?doc.companyId:(logins[origin]?.id&&ID.test(logins[origin].id)&&logins[origin].id!==doc.companyId?logins[origin].id:(doc.companyId+'--'+slug(new URL(origin).host)).slice(0,80));
     if(ids.has(id))throw Error('DUPLICATE_COMPANY_ENTRY:'+id);ids.add(id);
     out.push({id,companyId:doc.companyId,name:doc['公司'],region:doc['地区'],origin,channel:'campus',templateId:null,dir,
      loginFile:logins[origin]?.file||null,definitionFile:definitions[origin]||(origin===primary?definitions['']:null)||null});
    }
   }
  this.companies=out;return out;
 }
 entry(id){const e=(this.companies||[]).find(c=>c.id===id);if(!e)throw Error('UNKNOWN_COMPANY');return e;}
 loginFile(id){const f=this.entry(id).loginFile;if(!f)throw Error('COMPANY_LOGIN_NOT_CONFIGURED');return f;}
 definitionFile(id){return this.entry(id).definitionFile;}
}

// 与 Python json.dumps(obj, ensure_ascii=False, sort_keys=True) 逐字节一致，用于核对正向评审时登记的内容摘要。
export function pyJson(v){
 if(v===null||v===undefined)return 'null';
 if(typeof v==='boolean')return v?'true':'false';
 if(typeof v==='number'){if(!Number.isFinite(v))throw Error('NON_FINITE_NUMBER');return Number.isInteger(v)?String(v):String(v);}
 if(typeof v==='string')return JSON.stringify(v);
 if(Array.isArray(v))return '['+v.map(pyJson).join(', ')+']';
 const keys=Object.keys(v).sort((a,b)=>{const x=[...a].map(c=>c.codePointAt(0)),y=[...b].map(c=>c.codePointAt(0));for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i];return x.length-y.length;});
 return '{'+keys.map(k=>JSON.stringify(k)+': '+pyJson(v[k])).join(', ')+'}';
}
export const contentSha=batch=>{const {confirmation,state,updatedAt,...body}=batch;return createHash('sha256').update(pyJson(body),'utf8').digest('hex');};

// 投递输入只来自用户正向评审确认后的 投递批次.json；确认后内容被改动即拒绝。
export async function readHandoffBatch({handoffDir=handoffDirFromEnv()}={}){
 const file=path.join(path.resolve(handoffDir),'投递批次.json'),bytes=await readFile(file),b=JSON.parse(bytes.toString('utf8'));
 if(!['已交接','进行中'].includes(b.state)||!b.confirmation?.userQuote)throw Error('HANDOFF_NOT_CONFIRMED');
 if(b.confirmation.contentSha256!==contentSha(b))throw Error('HANDOFF_CHANGED_AFTER_CONFIRMATION');
 // 已回传但尚未经用户反向评审的结果：已投递/已关闭的岗位受保护，不确定或受阻的岗位在用户处理前禁止重跑。
 let outcomes={};try{outcomes=JSON.parse(await readFile(path.join(path.resolve(handoffDir),'投递回传.json'),'utf8')).roles||{};}catch(e){if(e.code!=='ENOENT')throw e;}
 const statusOf=(cid,rid)=>{const o=outcomes[cid+'|'+rid];return o?.event==='submission_confirmed'?'岗位已投递':o?.event==='role_closed'?'岗位失效/关闭':'岗位待投递';};
 const companies=b.companies.map((c,i)=>{
  // 志愿顺序由用户给定，只在志愿分组（可平行投递的 BU，或整家公司）内排；分组内多个岗位时必须是不重复的正整数（前序志愿已投递时可不从1起）。执行顺序按分组、志愿依次排开。
  const groups=new Map();
  for(const r of c['岗位']){const g=r['志愿分组']||'公司';if(!groups.has(g))groups.set(g,[]);groups.get(g).push(r);}
  for(const list of groups.values()){
   const os=list.map(r=>r['顺序']);if(list.length===1&&os[0]==null)continue;
   if(!os.every(o=>Number.isInteger(o)&&o>0)||new Set(os).size!==os.length)throw Error('INVALID_CONFIRMED_ROLE_ORDER');
  }
  const ordered=[...groups.values()].flatMap(list=>[...list].sort((x,y)=>(x['顺序']||1)-(y['顺序']||1)));
  return {companyId:c.companyId,name:c['公司'],order:i+1,roles:ordered.map((r,j)=>({id:r['岗位ID'],roleId:r['岗位ID'],title:r['岗位名称'],url:r['岗位链接'],...(r['投递链接']?{applyUrl:r['投递链接']}:{}),order:j+1,preference:{group:r['志愿分组']||'公司',rank:r['顺序']||1,bu:r.BU||null},selected:true,applicationStatus:statusOf(c.companyId,r['岗位ID']),...(outcomes[c.companyId+'|'+r['岗位ID']]?{applicationOutcome:{event:outcomes[c.companyId+'|'+r['岗位ID']].event}}:{})}))};
 });
 const input={schemaVersion:1,batchId:b.batchId,version:1,confirmation:{status:'confirmed',reference:b.confirmation.userQuote},companies};
 // 批次文件之后会因阶段推进被覆盖写（状态、时间），所以冻结的是用户确认的内容摘要而不是文件字节。
 return {input,source:{kind:'handoff',file,contentSha256:b.confirmation.contentSha256}};
}

export async function assertHandoffUnchanged(source){
 const b=JSON.parse(await readFile(source.file,'utf8'));
 if(b.confirmation?.contentSha256!==source.contentSha256||contentSha(b)!==source.contentSha256)throw Error('ROLE_INPUT_CHANGED');
}
