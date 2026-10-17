// A partial preparation stays reviewable and resumable. It must never be routed
// back through login solely because some profile answers remain unresolved.
export function assertBoundRoleState(queue,task,state){
 const ready=['ready_to_fill','ready_for_user_review'].includes(state.status);
 const partial=state.status==='needs_attention'&&state.accountMatched===true&&typeof state.fillRunId==='string'&&typeof state.applicationUrl==='string';
 if(state.queueId!==queue.id||(!ready&&!partial)||state.returnUrl!==(state.applicationUrl||task.applyUrl||task.url)||state.expectedTitle!==task.title)throw Error('ROLE_NOT_READY_FOR_FILL');
 return state;
}
