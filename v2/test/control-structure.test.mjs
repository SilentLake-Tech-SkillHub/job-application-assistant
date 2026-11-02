import test from 'node:test';import assert from 'node:assert/strict';
import {compareControlStructures} from '../shared/control-structure.mjs';
import {enrichControlContext} from '../shared/control-context.mjs';
test('repeated rows and locator movement do not force rebuilding the same control structure',()=>{
 const base={label:'项目名称',type:'text',tag:'input',contextProvider:'.ud-formily-item'};
 const r=compareControlStructures([{...base,selector:'#new1'},{...base,selector:'#new2'}],[{...base,selector:'#old'}]);
 assert.equal(r.rawControlCount,2);assert.equal(r.distinctStructureCount,1);assert.equal(r.structuralMatchRatio,1);assert.equal(r.executionVerified,false);assert.equal(r.added.length,0);
});
test('same label with a different control, renderer, required flag or options remains a difference',()=>{
 const b={label:'项目链接',type:'text',tag:'input'};
 for(const change of [{type:'file'},{contextProvider:'.ud-formily-item'},{required:true},{options:['A','B']}])assert.equal(compareControlStructures([{...b,...change}],[b]).added.length,1);
});
test('wrapper label wins over uploaded file name and sensitive identifiers remain user-only',async()=>{
 const page={observe:async()=>({fields:{'0-0':{value:'private-resume.pdf\n更新'},'0-0-label':{value:'简历附件*'},'1-1':{value:'证件号码*'}}})};
 const r=await enrichControlContext(page,[{selector:'#resume',type:'file'},{selector:'#id',type:'text'}]);
 assert.equal(r[0].label,'简历附件');assert.equal(r[0].required,true);assert.equal(r[1].userOnly,true);
});
