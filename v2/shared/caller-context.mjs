// Optional per-call context locates Hook receipts. It never changes business
// authority, execution identity, or another call's conversation.
export function callerContextSchema(tool){
 return {...tool,inputSchema:{...tool.inputSchema,properties:{...tool.inputSchema?.properties,conversationId:{type:'string',minLength:1,maxLength:200,description:'本次调用所在对话的真实会话ID；从宿主环境读取，仅用于关联本对话Hook回执。无法取得时省略，不借用其它对话ID。'}}}};
}
export function splitCallerContext(input={}){
 const {conversationId,...args}=input;
 return {args,capabilities:typeof conversationId==='string'&&conversationId.length>0&&conversationId.length<=200?{conversationId}:{}};
}
