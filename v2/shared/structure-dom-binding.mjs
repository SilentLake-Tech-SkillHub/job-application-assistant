// Diagnostic DOM paths are evidence only. Execution still uses captured semantic locators.
const sameDocument=(a,b)=>{try{const x=new URL(a),y=new URL(b);x.hash='';y.hash='';return x.href===y.href;}catch{return false;}};
const cleanPath=s=>String(s||'').trim().replace(/\s*>\s*/g,' > ').replace(/^html(?::nth-of-type\(1\))? > /i,'').replace(/^body:nth-of-type\(1\)/i,'body');
const unescapeCss=s=>s.replace(/\\([0-9a-f]{1,6})(?:\s)?|\\([^\n\r\f])/gi,(_,hex,char)=>hex?String.fromCodePoint(parseInt(hex,16)):char);
const attr=(n,key)=>n?.attributes?.[key]||'';
export function bindNativeDom(structure,native,{maxAgeMs=120000}={}){
 if(!native)return structure.accessibility.map(n=>({...n,nativeBindingStatus:'native_structure_missing'}));
 if(native.targetId!==structure.targetId||!sameDocument(native.pageUrl,structure.pageUrl))throw Error('REA_NATIVE_SCOPE_MISMATCH');
 const delta=Math.abs(Date.parse(native.observedAt)-Date.parse(structure.observedAt));
 if(!Number.isFinite(delta)||delta>maxAgeMs)throw Error('REA_NATIVE_CAPTURE_TOO_FAR_APART');
 const domByBackend=new Map(),axById=new Map();
 for(const a of native.accessibility||[]){const k=String(a.nodeId);axById.set(k,axById.has(k)?null:a);}
 for(const [documentIndex,d] of (native.documents||[]).entries()){
  const byIndex=new Map(d.nodes.map(n=>[n.index,n])),children=new Map();
  for(const n of d.nodes){const list=children.get(n.parentIndex)||[];list.push(n);children.set(n.parentIndex,list);}
  const paths=new Map();
  const pathOf=n=>{if(paths.has(n.index))return paths.get(n.index);if(n.nodeType!==1)return null;const tag=String(n.nodeName).toLowerCase();const parent=byIndex.get(n.parentIndex);let path;if(tag==='html')path='html';else if(tag==='body'&&String(parent?.nodeName).toLowerCase()==='html')path='body';else{const siblings=(children.get(n.parentIndex)||[]).filter(x=>x.nodeType===1&&String(x.nodeName).toLowerCase()===tag);const head=parent&&pathOf(parent);path=head?head+' > '+tag+':nth-of-type('+(siblings.findIndex(x=>x.index===n.index)+1)+')':tag;}paths.set(n.index,path);return path;};
  for(const n of d.nodes){if(n.nodeType!==1||!n.backendNodeId)continue;const ancestors=[];let p=byIndex.get(n.parentIndex),seen=new Set();while(p&&!seen.has(p.index)){seen.add(p.index);if(p.nodeType===1)ancestors.push({index:p.index,backendNodeId:p.backendNodeId,tag:String(p.nodeName).toLowerCase(),id:attr(p,'id'),class:attr(p,'class'),role:attr(p,'role')});p=byIndex.get(p.parentIndex);}
   const entry={documentIndex,frameId:d.frameId,index:n.index,parentIndex:n.parentIndex,backendNodeId:n.backendNodeId,tag:String(n.nodeName).toLowerCase(),id:attr(n,'id'),class:attr(n,'class'),role:attr(n,'role'),path:cleanPath(pathOf(n)),ancestors};
   const k=String(n.backendNodeId);domByBackend.set(k,domByBackend.has(k)?null:entry);
  }
 }
 const idCounts=new Map();for(const d of domByBackend.values())if(d?.id)idCounts.set(d.id,(idCounts.get(d.id)||0)+1);
 for(const d of domByBackend.values())if(d){d.idUnique=!!d.id&&idCounts.get(d.id)===1;for(const a of d.ancestors)a.idUnique=!!a.id&&idCounts.get(a.id)===1;}
 return structure.accessibility.map(n=>{const ax=axById.get(String(n.nodeId));if(!ax||ax.ignored||ax.role!==n.role||String(ax.label||'')!==String(n.label||''))return {...n,nativeBindingStatus:'native_ax_identity_unproven'};
  const dom=domByBackend.get(String(ax.backendNodeId));if(!dom)return {...n,nativeBindingStatus:'native_dom_identity_unproven'};
  return {...n,backendNodeId:ax.backendNodeId,nativeDOM:dom,nativeBindingStatus:'bound_backend_dom'};
 });
}
export function correlateNativeControls(accessibility,controls){
 // Exact diagnostic path or a unique actual DOM id resolves a captured element.
 const refs=controls.map(c=>{const s=String(c.diagnosticSelector||'');return s.startsWith('#')&&!/[ >]/.test(s.replace(/\\[0-9a-f]{1,6}\s?/gi,''))?{id:unescapeCss(s.slice(1))}:{path:cleanPath(s)};});
 const available=accessibility.filter(n=>n.nativeDOM),doms=new Map();
 for(const n of available){const d=n.nativeDOM;doms.set(d.documentIndex+':'+d.index,d);for(const a of d.ancestors)doms.set(d.documentIndex+':'+a.index,{...a,documentIndex:d.documentIndex});}
 const ids=new Map();for(const d of doms.values())if(d.id){const list=ids.get(d.id)||[];list.push(d);ids.set(d.id,list);}
 const matched=controls.map(()=>[]),bindings=new Map();
 for(const n of available){const d=n.nativeDOM;if(d.documentIndex!==0)continue;const candidates=[];for(const [i,ref] of refs.entries()){
   if(!controls[i].diagnosticSelector)continue;
   let distance=Infinity;
   if(ref.id){const nodes=ids.get(ref.id)||[];if(nodes.length!==1||!nodes[0].idUnique)continue;const target=nodes[0];if(target.documentIndex!==d.documentIndex)continue;if(target.index===d.index)distance=0;else{const a=d.ancestors.findIndex(x=>x.index===target.index);if(a>=0)distance=a+1;}}
   else if(ref.path){if(ref.path===d.path)distance=0;else if(d.path.startsWith(ref.path+' > '))distance=d.path.slice(ref.path.length+3).split(' > ').length;}
   if(Number.isFinite(distance))candidates.push({i,distance});
  }
  candidates.sort((a,b)=>a.distance-b.distance);if(!candidates.length||candidates[1]?.distance===candidates[0].distance)continue;
  const i=candidates[0].i;matched[i].push(n.nodeId);bindings.set(String(n.nodeId),{method:'native_ax_backend_dom_path',backendNodeId:d.backendNodeId,documentIndex:d.documentIndex,frameId:d.frameId,diagnosticSelector:controls[i].diagnosticSelector,domPath:d.path,relationship:candidates[0].distance===0?'same_element':'descendant',distance:candidates[0].distance});
 }
 return {controls:controls.map((c,i)=>({...c,reaCandidates:matched[i],reaBindings:matched[i].map(id=>({nodeId:id,...bindings.get(String(id))}))})),bound:new Set(bindings.keys())};
}
