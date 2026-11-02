// Compatibility export. All transports execute the same shared operation.
export async function performUdChoice(page,action,value){return page.act(action,value,{});}
