// 测试用交接区：岗位交接/公司/<公司编码>.json（schemaVersion 3），与搜索端 company_store.py 写出的结构一致。
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import {contentSha} from '../../shared/company-directory.mjs';

const sha=s=>createHash('sha256').update(s).digest('hex');
export const materials=(roleCode,{status='available',value='SampleCode17'}={})=>{
 const raw=status==='available'?value:'';
 return {schemaVersion:2,items:[{key:'referralCode',status,value:status==='available'?value:null,raw,requireWhenAvailable:true,evidence:{'岗位编码':roleCode,column:'内推码',cellSha256:sha(raw)}}]};
};
export const site=(code,origin,extra={})=>({'站点编码':code,'站点':origin,'登录链接':null,'账号核对页':null,'状态':'在用',...extra});
export const role=(code,siteCode,title,url,extra={})=>({'岗位编码':code,'地区':'中国大陆','站点编码':siteCode,'岗位名称':title,'岗位链接':url,'投递链接':null,'官方岗位ID':null,'BU':null,
 '志愿分组':'公司','志愿顺序':null,'城市选项':[],'投递状态':'岗位待投递','链接说明':null,'材料':materials(code),...extra});
export function companyDoc({code,name,sites,roles,selected=roles.map(r=>r['岗位编码']),batchId='B1',state='等待正向评审',order=1}){
 return {schemaVersion:3,'公司编码':code,'公司名称':name,'志愿分组依据':null,'生成自':'test',
  '站点':sites,'岗位':roles,
  '批次':{'批次编号':batchId,'状态':state,'公司顺序':order,'选中岗位':selected,'排除':[],'执行':null,'确认':null,'进度':null,'更新时间':'t'}};
}
// 用户在正向评审页确认（与 company_store.py set_confirmation 一致）。
export function confirm(doc,{quote='确认交接',state='已交接',scope='selection'}={}){
 const d=structuredClone(doc);d['批次']['状态']=state;
 const current=contentSha(d);
 d['批次']['确认']={userQuote:quote,confirmedAt:'t',contentSha256:current,scope,scopes:{selection:{userQuote:quote,confirmedAt:'t',contentSha256:current}}};
 return d;
}
export async function saveCompany(dir,doc){await mkdir(path.join(dir,'公司'),{recursive:true});await writeFile(path.join(dir,'公司',doc['公司编码']+'.json'),JSON.stringify(doc,null,2));}
// 第 2 步前登录配置仍在 公司/<地区>/<公司>/登录[@域名].json。
export async function saveLogin(dir,firm,file,login){const d=path.join(dir,'公司','中国大陆',firm);await mkdir(d,{recursive:true});await writeFile(path.join(d,file),JSON.stringify(login));}
export async function handoffWorkspace(docs=[]){const dir=await mkdtemp(path.join(os.tmpdir(),'handoff-'));for(const d of docs)await saveCompany(dir,d);return dir;}
export const login=(companyId,origin,extra={})=>({schemaVersion:1,companyId,version:1,origin,loginPath:'/login',allowedPaths:['/'],account:{selector:'.a',source:'phone',countryCode:'+86',mask:'first4_last3'},fields:{},...extra});
