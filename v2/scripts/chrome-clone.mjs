#!/usr/bin/env node
// Chrome 分身（Chrome 通道）的唯一启动入口。分身 = 本机已安装的 Google Chrome + 固定私有资料目录
// （RECRUITING_BROWSER_PROFILE_DIR）+ 本机调试端口（RECRUITING_BROWSER_CDP_PORT，默认 9333）；可见窗口、允许扩展。
// 所有执行端连同一个分身；登录状态保存在资料目录里，用户或 computer use 可直接操作这个窗口。
// 日常 Chrome 不受影响：资料目录不能是日常 Chrome 的目录。
// 用法：
//   node scripts/chrome-clone.mjs status     # running / stopped / running_without_cdp / port_taken
//   node scripts/chrome-clone.mjs start      # 没在运行就启动；已在运行直接返回，不开第二个
import {pathToFileURL} from 'node:url';
import {cloneConfig,inspectClone,launchClone} from '../shared/chrome-clone.mjs';
if(import.meta.url===pathToFileURL(process.argv[1]||'').href){
 const cmd=process.argv[2];
 try{const config=cloneConfig();
  if(cmd==='status')console.log(JSON.stringify({...config,...await inspectClone({config})},null,1));
  else if(cmd==='start')console.log(JSON.stringify({...config,...await launchClone({config})},null,1));
  else throw Error('USAGE: status | start');
 }catch(error){console.error(error.message);process.exitCode=1;}
}
