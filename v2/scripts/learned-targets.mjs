#!/usr/bin/env node
// Maintainer tool for learned click targets (catalog/learned-targets.json).
//   show --run <runId> --private-dir <dir>        list the candidates an executor reported
//   add  --run <runId> --private-dir <dir> --candidate <n> --quote "<user's words>"
//   remove --id <lt-...>
//   list
// Only a maintainer host may write, and only with the user's confirmation quote.
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {hostRole} from '../shared/host-role.mjs';
import {addLearnedTarget,removeLearnedTarget,loadLearnedTargets,safeTargetCandidates} from '../shared/learned-targets.mjs';
const args=process.argv.slice(2),command=args[0],opt=name=>{const i=args.indexOf('--'+name);return i>=0?args[i+1]:undefined;};
const fail=code=>{console.log(JSON.stringify({error:code}));process.exit(1);};
async function gap(){
 const runId=opt('run'),dir=opt('private-dir');if(!runId||!dir||!/^[\w.:-]{1,80}$/.test(runId))fail('RUN_AND_PRIVATE_DIR_REQUIRED');
 const run=JSON.parse(await readFile(path.join(dir,'runs',runId+'.json'),'utf8'));
 const found=[run,...(run.results||[])].find(r=>r?.errorDetails?.phase==='driver_target_gap');
 if(!found)fail('NO_DRIVER_TARGET_GAP_IN_RUN');
 return {runId,companyId:found.companyId||run.companyId||null,field:found.failedField?.label||null,errorCode:found.errorCode||run.errorCode||null,driver:found.errorDetails.driver,candidates:safeTargetCandidates(found.errorDetails.candidates)};
}
const describe=c=>`${c.tag}${c.role?`（role=${c.role}）`:''}${c.classes.length?' 类名 '+c.classes.join(' '):''}${c.checked?'，当前为选中':''}${c.matches===1?'':`，本行有 ${c.matches} 个同样的元素，不能用`}`;
if(command==='show'){
 const g=await gap();
 console.log(JSON.stringify({...g,show_user:[`${g.companyId} 的「${g.field}」执行时找不到点击目标（${g.errorCode}）。这一行里可点的元素有：`,...g.candidates.map((c,i)=>`  ${i}. ${describe(c)}`),'请确认用哪一个；确认后会写入组件，所有公司的同类控件都会先试这个点法，每次仍需通过点击后的核验。']},null,1));
}else if(command==='add'){
 if(hostRole()!=='maintainer')fail('MAINTAINER_HOST_REQUIRED');
 const g=await gap(),n=Number(opt('candidate')),c=g.candidates[n];
 if(!Number.isInteger(n)||!c)fail('CANDIDATE_REQUIRED');if(c.matches!==1)fail('CANDIDATE_NOT_UNIQUE_IN_ROW');
 const entry=await addLearnedTarget({driver:g.driver,selector:c.selector,evidence:{runId:g.runId,companyId:g.companyId},quote:opt('quote')});
 console.log(JSON.stringify({added:entry,next:'提交组件 catalog/learned-targets.json，然后让执行端在原页面重跑该字段'},null,1));
}else if(command==='remove'){
 if(hostRole()!=='maintainer')fail('MAINTAINER_HOST_REQUIRED');
 await removeLearnedTarget(opt('id'));console.log(JSON.stringify({removed:opt('id')}));
}else if(command==='list'){console.log(JSON.stringify(await loadLearnedTargets(),null,1));}
else fail('USAGE: show|add|remove|list');
