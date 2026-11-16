import test from 'node:test';import assert from 'node:assert/strict';
import {controlAnatomyDOM,withControlAnatomy,anatomyCandidate,controlSource,controlSources} from '../shared/control-anatomy.mjs';
import {findTreePath,expandTreePath,treePaths,treeRowsDOM,treeKind,leafOptionSelector,cascadeLabel} from '../shared/tree-expansion.mjs';
import {buildFormTemplate} from '../shared/form-construction.mjs';

// 最小页面模型：只实现分类函数用到的 DOM 接口。
class El{
 constructor(tag,attrs={},children=[]){
  Object.assign(this,{tagName:tag.toUpperCase(),attrs,className:attrs.class||'',children,parentElement:null,previousElementSibling:null,hidden:!!attrs.hidden,type:attrs.type,readOnly:!!attrs.readonly,disabled:false});
  children.forEach((c,i)=>{c.parentElement=this;c.previousElementSibling=children[i-1]||null;});
 }
 getAttribute(k){return k in this.attrs?String(this.attrs[k]):null;}
 hasAttribute(k){return k in this.attrs;}
 getClientRects(){return this.hidden?[]:[{}];}
 descendants(){return this.children.flatMap(c=>[c,...c.descendants()]);}
 querySelectorAll(s){const all=this.descendants();if(s==='*')return all;if(s==='input,textarea')return all.filter(n=>['INPUT','TEXTAREA'].includes(n.tagName));throw Error('unsupported selector '+s);}
 contains(n){for(let x=n;x;x=x.parentElement)if(x===this)return true;return false;}
}
const el=(tag,attrs,...children)=>new El(tag,attrs,children);
globalThis.getComputedStyle??=()=>({visibility:'visible'});
globalThis.CSS??={escape:s=>s};
const page=(map)=>{globalThis.document={querySelectorAll:s=>{if(!(s in map))return [];return map[s];}};};
const W='#q';

test('通用标注：外层选择框唯一时按 ARIA 分类，内层输入框记为搜索，原动作命中两个时可修复',()=>{
 const input=el('input',{role:'combobox',type:'text'});
 const box=el('div',{role:'combobox','aria-haspopup':'listbox','aria-controls':'menu-1',class:'x-select-selection x-select-open'},input);
 const root=el('div',{class:'field'},el('label',{}),box);
 page({[W]:[root],[W+' [role="combobox"]']:[box,input]});
 const [a]=controlAnatomyDOM([{selector:'#field',container:W,action:W+' [role="combobox"]'}]);
 assert.equal(a.status,'classified');assert.equal(a.source,'aria');assert.equal(a.expansion,'popup_search');assert.equal(a.operation,'search_select');
 assert.equal(a.parts.combobox,W+' .x-select-selection[role="combobox"]');
 assert.equal(a.parts.search,W+' > div:nth-of-type(1) > input:nth-of-type(1)');
 assert.equal(a.menuLink,'aria-controls');assert.equal(a.currentActionMatches,2);
 const view=withControlAnatomy({selector:'#field',contextProvider:'.atsx-form-item',type:'choice',actionSelector:W+' [role="combobox"]'},a);
 assert.equal(view.actionSelector,a.parts.combobox);assert.equal(view.anatomy.repairedAction,true);assert.equal(view.genericChoice,undefined);assert.equal(view.type,'choice');
});

test('标注不够时按控件库：两个独立选择框只有一个是控件库的选择框',()=>{
 const sel=el('div',{class:'atsx-select-selection',role:'combobox'},el('div',{class:'atsx-select-selection-selected-value'}));
 const other=el('span',{'aria-haspopup':'menu'});
 const root=el('div',{class:'atsx-form-item'},el('div',{class:'atsx-select'},sel),other);
 page({[W]:[root]});
 const [a]=controlAnatomyDOM([{selector:'#f',container:W,action:W+' [role="combobox"]'}]);
 assert.equal(a.source,'library');assert.equal(a.library,'atsx');assert.equal(a.parts.combobox,W+' [role="combobox"]');
 assert.equal(a.parts.selected,W+' .atsx-select-selection-selected-value');assert.equal(a.expansion,'popup_list');
});

test('多级控件：aria-haspopup=tree 记为逐级展开；两层都认不出返回未识别；外框不唯一不分类',()=>{
 const tree=el('div',{role:'combobox','aria-haspopup':'tree'});
 page({[W]:[el('div',{},tree)]});
 const [a]=controlAnatomyDOM([{selector:'#t',container:W,action:W+' [role="combobox"]'}]);
 assert.equal(a.expansion,'multi_level');assert.equal(a.operation,'tree_select');assert.equal(a.menuLink,null);
 const view=withControlAnatomy({selector:'#t',type:'text',questionSelector:W},a);
 assert.equal(view.genericChoice,true);assert.equal(view.role,'combobox');assert.equal(view.menuSelector,'[role="tree"]');assert.equal(view.selectedSelector,a.parts.trigger);assert.equal(view.type,'text');
 page({[W]:[el('div',{},el('span',{class:'custom-picker'}))]});
 assert.equal(controlAnatomyDOM([{selector:'#u',container:W}])[0].status,'unrecognized');
 page({[W]:[el('div',{}),el('div',{})]});
 assert.equal(controlAnatomyDOM([{selector:'#u',container:W}])[0].status,'container_not_unique');
 assert.equal(withControlAnatomy({selector:'#u'},{status:'unrecognized'}).anatomy,undefined);
});

test('需要分类的控件只取可交互的选择类，引用式定位与原生 select 保持原驱动',()=>{
 assert.equal(anatomyCandidate({type:'choice',selector:'#a'}),true);
 assert.equal(anatomyCandidate({type:'text',role:'combobox',selector:'#a'}),true);
 assert.equal(anatomyCandidate({type:'choice',selector:'phoenixq:1'}),false);
 assert.equal(anatomyCandidate({type:'select',tag:'select',selector:'#a'}),false);
 assert.equal(anatomyCandidate({type:'file',selector:'#a'}),false);
});

// 懒加载的树：展开一个分支后才出现它的下一级。
const model={'中国大陆':{'北京市':{'朝阳区':null},'广东省':{'广州市':null,'深圳市':null}},'中国香港':{'香港岛':null}};
const lazyTree=(data=model)=>{
 const open=new Set(),expanded=[];
 const walk=(node,depth,prefix,out)=>{for(const [text,kids] of Object.entries(node)){const key=[...prefix,text].join('/');out.push({index:out.length,text,depth,leaf:kids===null,key});if(kids&&open.has(key))walk(kids,depth+1,[...prefix,text],out);}return out;};
 return {view:{rows:async()=>walk(data,0,[],[]).map(({key,...r})=>r),expand:async row=>{const r=walk(data,0,[],[])[row.index];open.add(r.key);expanded.push(r.key);}},expanded};
};
test('逐级展开：按顺序展开分支找到末级的完整路径，记录路径后可直接按路径展开',async()=>{
 const t=lazyTree();
 assert.deepEqual(await findTreePath(t.view,'深圳市'),['中国大陆','广东省','深圳市']);
 assert.deepEqual(t.expanded,['中国大陆','中国大陆/北京市','中国大陆/广东省']);
 const u=lazyTree(),leaf=await expandTreePath(u.view,['中国大陆','广东省','深圳市']);
 assert.equal(leaf.text,'深圳市');assert.deepEqual(u.expanded,['中国大陆','中国大陆/广东省']);
 await assert.rejects(expandTreePath(lazyTree().view,['中国大陆','江苏省','南京市']),/TREE_PATH_NODE_NOT_FOUND/);
 assert.equal(await findTreePath(lazyTree().view,'南京市'),null);
 await assert.rejects(findTreePath(lazyTree().view,'深圳市',{maxExpansions:2}),/TREE_SEARCH_LIMIT_REACHED/);
 // 同时显示的同名末级不猜：报不唯一。
 const both={rows:async()=>[{index:0,text:'甲',depth:0,leaf:false},{index:1,text:'同名',depth:1,leaf:true},{index:2,text:'乙',depth:0,leaf:false},{index:3,text:'同名',depth:1,leaf:true}],expand:async()=>{}};
 await assert.rejects(findTreePath(both,'同名'),/TREE_TARGET_NOT_UNIQUE/);
 assert.equal(treePaths([{text:'深圳市',depth:2,leaf:true}])[0].path,null);
});

test('建模板：通用标注分类出的多级选择框接入通用下拉，路径随动作记录；建库结果按来源计数',()=>{
 const anatomy={status:'classified',source:'aria',library:null,expansion:'multi_level',operation:'tree_select',parts:{combobox:'#city-q [role="combobox"]',trigger:'#city-q [role="combobox"]',search:null,selected:null},menuLink:null,currentActionMatches:1,currentIsCombobox:false};
 const capture={companyId:'C1',pageUrl:'https://c1.example/form',observedAt:new Date().toISOString(),controls:[{selector:'#city',questionSelector:'#city-q',label:'所在城市',tag:'input',type:'text',required:true}],controlAnatomy:{'#city':anatomy}};
 const choices=[{selector:'#city',status:'captured',restored:true,options:['深圳市'],treePaths:{'深圳市':['中国大陆','广东省','深圳市']}}];
 const profile={facts:{city:{status:'known',value:'深圳市'}},fieldRegistry:{city:{label:'所在城市'}}};
 const page={roleTitle:'Product',roleSelector:'h1',readySelector:'form',sections:[{title:'基本信息'}],sectionDiscovery:{selector:'section',titleSelector:'h2'}};
 const t=buildFormTemplate({capture,profile,mappings:[{selector:'#city',factKey:'city'}],choices,page,templateId:'anatomy'}).template;
 const f=t.pages[0].fields.find(x=>x.label==='所在城市');
 assert.equal(f.inventoryType,'text');assert.equal(f.control.type,'dropdown');
 assert.deepEqual(f.actions[0],{method:'dropdown',selector:'#city-q [role="combobox"]',labelSelector:undefined,menuSelector:'[role="tree"]',options:['深圳市'],treePaths:{'深圳市':['中国大陆','广东省','深圳市']}});
 assert.equal(f.controlAnatomy.source,'aria');assert.equal(controlSource(f),'generic');
 assert.deepEqual(controlSources({pages:[{fields:[f,{label:'学校',actions:[{method:'recorded_sequence'}]},{label:'学历',actions:[{method:'ud_dropdown'}]},{label:'说明',readonly:true,actions:[]}]}]}),{generic:1,library:1,fallback:1,fallbackFields:['学校']});
});

// Ant 风格级联：一列一级，点开分支往右出下一列；用页面模型驱动 treeRowsDOM 的按列读取。
const cascadeMenu=(data,active)=>{
 const spec=treeKind.cascader('ant'),columns=[],items=[];
 let level=data;
 for(let c=0;level;c++){
  const col=[];
  for(const [text,kids] of Object.entries(level)){
   const cls=[spec.expand.replace(/-expand$/,''),...(kids?[spec.expand]:[]),...(active[c]===text?[spec.active]:[])];
   const item={text,classList:{contains:x=>cls.includes(x)},getClientRects:()=>[{}],querySelector:s=>s===spec.label?{textContent:text}:null};
   col.push(item);items.push(item);
  }
  columns.push({getClientRects:()=>[{}],querySelectorAll:s=>s===spec.item?col:[]});
  level=active[c]?level[active[c]]:null;
 }
 return {spec,menu:{querySelectorAll:s=>s===spec.column?columns:s===spec.item?items:[]}};
};
const cascadeView=data=>{
 const active=[],clicks=[];
 return {clicks,active,view:{rows:async()=>{const {spec,menu}=cascadeMenu(data,active);return treeRowsDOM(menu,spec);},expand:async row=>{active.length=row.depth;active[row.depth]=row.text;clicks.push(row.text);}}};
};
test('级联：按列读出“父项后紧跟子项”的行，逐列点开找到末级路径，选项值为“ / ”连接的完整路径',async()=>{
 const data={'北京市':{'朝阳区':null},'广东省':{'广州市':null,'深圳市':null}};
 const c=cascadeView(data);
 const path=await findTreePath(c.view,'深圳市');
 assert.deepEqual(path,['广东省','深圳市']);assert.deepEqual(c.clicks,['北京市','广东省']);
 assert.equal(cascadeLabel(path),'广东省 / 深圳市');
 const d=cascadeView(data),leaf=await expandTreePath(d.view,['广东省','深圳市']);
 assert.equal(leaf.text,'深圳市');assert.equal(leaf.depth,1);assert.deepEqual(d.clicks,['广东省']);
 const {spec,menu}=cascadeMenu(data,['广东省']);
 assert.deepEqual(treeRowsDOM(menu,spec).map(r=>[r.text,r.depth,r.leaf,r.expanded,r.active]),[['北京市',0,false,false,false],['广东省',0,false,true,true],['广州市',1,true,false,false],['深圳市',1,true,false,false]]);
});
test('Ant 树形下拉：按缩进单位算层级，无展开按钮（noop）的是末级；末级选项选择器按前缀生成',()=>{
 const spec=treeKind.antTree('atsx');
 const row=(text,depth,leaf)=>({getClientRects:()=>[{}],querySelector:s=>s===spec.label?{innerText:text}:s===spec.leaf&&leaf?{}:null,querySelectorAll:s=>s===spec.indent?Array(depth).fill({}):[]});
 const menu={querySelectorAll:s=>s===spec.row?[row('广东省',0,false),row('深圳市',1,true)]:[]};
 assert.deepEqual(treeRowsDOM(menu,spec).map(r=>[r.text,r.depth,r.leaf]),[['广东省',0,false],['深圳市',1,true]]);
 assert.equal(leafOptionSelector(spec),'.atsx-select-tree-treenode:has(.atsx-select-tree-switcher-noop) .atsx-select-tree-title');
 assert.equal(leafOptionSelector(treeKind.cascader('ant')),null);
});
