import {treePaths,treeKind,leafOptionSelector} from './tree-expansion.mjs';
// 飞书树形控件的末级选项：缩进与占位展开按钮区分同名的国家、地区与可选城市，不按首个匹配文字选择。
// 行的读取统一用 tree-expansion.mjs 的 treeRowsDOM（C33），这里只把行整理成证据。
export const UD_TREE_LEAF_LABEL=leafOptionSelector(treeKind.ud());
export function treeEvidence(rows){
 const nodes=treePaths(rows).map(({text,depth,leaf,path})=>({text,depth,leaf,path}));
 return {nodes,leafPaths:nodes.filter(n=>n.leaf&&n.path).map(n=>[...n.path])};
}
