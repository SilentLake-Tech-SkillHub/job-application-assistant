import {withHostCapabilities,delegatedVisionReviewer} from './sampling-bridge.mjs';
import {bootstrapRuntime} from './bootstrap.mjs';
await bootstrapRuntime();
const mode=process.argv[2];if(!['login','application'].includes(mode))throw Error('INVALID_CORE_MODE');
const module=await import(mode==='login'?'../login/service.mjs':'./application-service.mjs');
const {service}=module;if(mode==='application'&&!process.env.RECRUITING_VISION_SOCKET)module.configureApplicationService({visionReviewer:delegatedVisionReviewer()});
process.on('message',async message=>{
 try{process.send?.({id:message.id,result:await withHostCapabilities(message.capabilities,()=>service.execute(message.operation,message.args||{}))});}
 catch(error){process.send?.({id:message.id,result:{isError:true,error:error.message}});}
});
process.on('disconnect',()=>process.exit(0));
process.send?.({ready:true,info:service.info,operations:service.listOperations()});
