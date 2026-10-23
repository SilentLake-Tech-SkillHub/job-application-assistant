export async function performAttachmentRemoval(adapter,action){
 if(action.authorized!==true||!action.expectedFilename||!action.selector?.startsWith('uploadq:')||!action.removeSelector?.startsWith('uploadq:'))throw Error('ATTACHMENT_REMOVAL_AUTHORIZATION_REQUIRED');
 const input=JSON.parse(action.selector.slice(8)),remove=JSON.parse(action.removeSelector.slice(8));
 if(remove.part!=='remove'||remove.label!==input.label||remove.occurrence!==input.occurrence||remove.filename!==action.expectedFilename)throw Error('ATTACHMENT_REMOVAL_SCOPE_MISMATCH');
 const container=await adapter.resolveSelector(action.containerSelector),root=adapter.page.locator(container);
 if(await root.count()!==1)throw Error('ATTACHMENT_CONTAINER_NOT_UNIQUE');
 const names=async()=>root.locator(await adapter.resolveSelector(action.filenameSelector)).filter({visible:true}).allTextContents();
 const before=(await names()).map(s=>s.trim());
 if(before.filter(x=>x===action.expectedFilename).length!==1)throw Error('ATTACHMENT_PREVIOUS_FILE_CHANGED');
 const button=adapter.page.locator(await adapter.resolveSelector(action.removeSelector)).filter({visible:true});
 if(await button.count()!==1)throw Error('ATTACHMENT_REMOVE_ACTION_NOT_UNIQUE');
 await button.click({timeout:10000});
 const expected=before.filter(x=>x!==action.expectedFilename),until=Date.now()+3000;
 do{const after=(await names()).map(s=>s.trim());if(JSON.stringify(after)===JSON.stringify(expected))return {status:'removed_verified',remaining:after.length};if(Date.now()>=until)break;await new Promise(r=>setTimeout(r,20));}while(true);
 throw Error('ATTACHMENT_REMOVAL_NOT_VERIFIED');
}
