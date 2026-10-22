// This descriptor reads only rendered tree rows. Indent spans and the explicit
// placeholder expand button distinguish leaf cities from identically named
// country/region branches without choosing the first matching text.
export const UD_TREE_LEAF_LABEL='.ud__tree__node:has(button.ud__expandButton-as-placeholder) .ud__tree__node__label';
export function treeChoiceDOM(root){
 const stack=[],nodes=[];
 for(const row of root.querySelectorAll('.ud__tree__node')){
  const label=row.querySelector('.ud__tree__node__label');if(!label)continue;
  const text=(label.innerText||label.textContent||'').trim(),depth=row.querySelectorAll(':scope > .ud__tree__node__indent').length;
  const leaf=!!row.querySelector('button.ud__expandButton-as-placeholder');
  stack.length=depth;stack[depth]=text;
  const ancestorsPresent=stack.length===depth+1&&Array.from({length:depth+1},(_,i)=>typeof stack[i]==='string').every(Boolean);
  nodes.push({text,depth,leaf,path:ancestorsPresent?[...stack]:null});
 }
 return {nodes,leafPaths:nodes.filter(n=>n.leaf&&n.path).map(n=>[...n.path])};
}
