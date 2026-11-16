// 主数据登录配置的唯一写入通道：交给搜索组件的主表固定脚本（json_excel_sync.py set-site-login-config），组件不直接改主表。
import path from 'node:path';
import {spawn} from 'node:child_process';
export function writeMasterLoginConfig(workspace,{company,site,config,quote,expectedSha}){
 const script=path.join(workspace,'.agents','skills','campus-job-application','scripts','json_excel_sync.py');
 const python=path.join(workspace,'tools','.venv-search-mcp','bin','python');
 return new Promise((resolve,reject)=>{
  const child=spawn(python,[script,'--workspace',workspace,'set-site-login-config','--quote',quote,'--expect-sha',expectedSha],{stdio:['pipe','ignore','ignore']});
  child.stdin.on('error',reject);
  child.once('error',reject);
  child.once('close',code=>code===0?resolve():reject(Error('SITE_ENTRY_MASTER_WRITE_FAILED')));
  child.stdin.end(JSON.stringify({company,site,config}));
 });
}
