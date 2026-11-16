// 多级选择控件（地点树、级联选择等）逐级展开（任务单 C33）。逻辑与控件库无关：view 提供
// rows()（按“父行后紧跟子行”顺序的可见行 {index,text,depth,leaf,expanded?,active?}）和 expand(row)。
// 页面结构按种类描述（treeKind），读取时作为参数传进页面函数 treeRowsDOM。

// 各类多级控件的页面结构描述。aria：通用标注的树形；indent：按缩进排的平铺树（飞书树形、Ant 树形下拉）；
// columns：一列一级、点开往右出下一列的级联选择（Ant 级联）。p 为控件库样式前缀（ant、atsx）。
export const treeKind={
 aria:()=>({kind:'aria'}),
 ud:()=>({kind:'indent',row:'.ud__tree__node',label:'.ud__tree__node__label',indent:':scope > .ud__tree__node__indent',leaf:'button.ud__expandButton-as-placeholder',toggle:'button[class*="expandButton"]:not([class*="as-placeholder"])'}),
 antTree:p=>({kind:'indent',row:`.${p}-select-tree-treenode`,label:`.${p}-select-tree-title`,indent:`.${p}-select-tree-indent-unit`,leaf:`.${p}-select-tree-switcher-noop`,toggle:`.${p}-select-tree-switcher:not(.${p}-select-tree-switcher-noop)`}),
 cascader:p=>({kind:'columns',column:`.${p}-cascader-menu`,item:`.${p}-cascader-menu-item`,label:`.${p}-cascader-menu-item-content`,expand:`${p}-cascader-menu-item-expand`,active:`${p}-cascader-menu-item-active`})
};
// 平铺树里可直接点选的末级选项。
export const leafOptionSelector=spec=>spec.kind==='aria'?'[role="treeitem"]:not([aria-expanded])':spec.kind==='indent'?`${spec.row}:has(${spec.leaf}) ${spec.label}`:null;

// 在页面内执行（自包含）：读取菜单里的多级行。index 为该行在同类全部行中的序号，供定位点击。
export function treeRowsDOM(menu,spec={kind:'aria'}){
 const visible=n=>!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden';
 const read=n=>(n?.innerText||n?.textContent||'').trim();
 if(spec.kind==='columns'){
  const items=[...menu.querySelectorAll(spec.item)],columns=[...menu.querySelectorAll(spec.column)].filter(visible),out=[];
  const walk=c=>{
   if(c>=columns.length)return;
   for(const item of columns[c].querySelectorAll(spec.item)){
    if(!visible(item))continue;
    const active=item.classList.contains(spec.active),leaf=!item.classList.contains(spec.expand),expanded=active&&!leaf&&c+1<columns.length;
    out.push({index:items.indexOf(item),text:read(item.querySelector(spec.label)||item),depth:c,leaf,expanded,active});
    if(expanded)walk(c+1);
   }
  };
  walk(0);return out;
 }
 const aria=spec.kind==='aria',rows=[...menu.querySelectorAll(aria?'[role="treeitem"]':spec.row)],out=[];
 rows.forEach((row,index)=>{
  if(!visible(row))return;
  if(aria){
   const own=[...row.childNodes].filter(n=>n.nodeType===3||n.nodeType===1&&!n.matches('[role="group"],[role="treeitem"]')&&!n.querySelector('[role="treeitem"]'));
   let depth=Number(row.getAttribute('aria-level'))-1;
   if(!(depth>=0)){depth=0;for(let p=row.parentElement;p&&p!==menu;p=p.parentElement)if(p.getAttribute('role')==='treeitem')depth++;}
   out.push({index,text:(row.getAttribute('aria-label')||own.map(n=>n.textContent).join('')).trim(),depth,leaf:!row.hasAttribute('aria-expanded'),expanded:row.getAttribute('aria-expanded')==='true'});
  }else{
   const label=row.querySelector(spec.label);if(!label)return;
   out.push({index,text:read(label),depth:row.querySelectorAll(spec.indent).length,leaf:!!row.querySelector(spec.leaf)});
  }
 });
 return out;
}

// 按层级还原每一行的完整路径；没有明确展开标记的，按下一行是否更深判断是否已展开。
export function treePaths(rows){
 const stack=[];
 return rows.map((row,i)=>{
  stack.length=row.depth;stack[row.depth]=row.text;
  // 虚拟列表可能只渲染了一段，祖先行不在时不拼出路径（数组空位不能当作已有祖先）。
  const complete=Array.from({length:row.depth+1},(_,i)=>typeof stack[i]==='string').every(Boolean);
  return {...row,path:complete?[...stack]:null,expanded:row.expanded??(rows[i+1]?.depth>row.depth)};
 });
}
const samePath=(a,b)=>a&&b&&a.length===b.length&&a.every((x,i)=>x===b[i]);

// 找到文字等于 target 的末级选项的路径：先看已显示的，没有就按文档顺序逐个展开未展开的分支，
// 最多展开 maxExpansions 次；按展开顺序先出现的那一个即返回路径，找不到返回 null；同时显示多个同名末级时报错，不猜。
export async function findTreePath(view,target,{maxExpansions=60}={}){
 const tried=new Set();let expansions=0;
 for(;;){
  const rows=treePaths(await view.rows());
  const hits=rows.filter(r=>r.leaf&&r.text===target&&r.path);
  if(hits.length>1)throw Error('TREE_TARGET_NOT_UNIQUE');
  if(hits.length===1)return hits[0].path;
  const next=rows.find(r=>!r.leaf&&!r.expanded&&r.path&&!tried.has(r.path.join('\u0000')));
  if(!next)return null;
  if(++expansions>maxExpansions)throw Error('TREE_SEARCH_LIMIT_REACHED');
  tried.add(next.path.join('\u0000'));
  await view.expand(next);
 }
}

// 按已记录的路径逐级展开，返回末级行（不点选）。
export async function expandTreePath(view,path){
 if(!Array.isArray(path)||!path.length||path.some(x=>typeof x!=='string'||!x))throw Error('TREE_PATH_INVALID');
 for(let level=0;level<path.length-1;level++){
  const rows=treePaths(await view.rows()),node=rows.find(r=>samePath(r.path,path.slice(0,level+1)));
  if(!node)throw Error('TREE_PATH_NODE_NOT_FOUND');
  if(node.leaf)throw Error('TREE_PATH_NODE_IS_LEAF');
  if(!node.expanded)await view.expand(node);
 }
 const leaf=treePaths(await view.rows()).find(r=>samePath(r.path,path));
 if(!leaf||!leaf.leaf)throw Error('TREE_PATH_LEAF_NOT_FOUND');
 return leaf;
}

// 级联选择的显示值与选项值：各级文字以“ / ”连接（Ant 级联默认显示方式）。
export const CASCADE_SEPARATOR=' / ';
export const cascadeLabel=path=>path.join(CASCADE_SEPARATOR);
