// Batch preferences are runtime settings. They never grant a browser capability
// and never form part of the upstream role/material confirmation fingerprint.
export function resolveBatchChannels(report, requestedChannels){
 const recorded=report?.capability;
 if(recorded?.status!=='detected')throw Error('BROWSER_CAPABILITY_DETECTION_REQUIRED');
 const recordedChannels=recorded.applicationChannels||recorded.channels||[];
 const availableChannels=['chrome','iab'].filter(ch=>recordedChannels.includes(ch)&&report.channels?.[ch]?.available===true);
 if(!availableChannels.length){const error=Error('NO_USABLE_BROWSER_CHANNEL');error.details={phase:'browser_initialization',browserExecuted:false,nextStep:'inspect runtime_info and node scripts/chrome-clone.mjs status; restore the recorded executor before continuing'};throw error;}
 if(requestedChannels!==undefined&&(!Array.isArray(requestedChannels)||!requestedChannels.length||new Set(requestedChannels).size!==requestedChannels.length||requestedChannels.some(ch=>!['chrome','iab'].includes(ch))))throw Error('INVALID_BATCH_BROWSER_CHANNELS');
 const requested=requestedChannels||availableChannels,intersection=requested.filter(ch=>availableChannels.includes(ch));
 const automaticFallback=intersection.length===0;
 return {requestedChannels:[...requested],availableChannels,channels:automaticFallback?availableChannels:intersection,
  automaticFallback,unavailableRequestedChannels:requested.filter(ch=>!availableChannels.includes(ch)),
  reason:automaticFallback?'requested_channels_unavailable_using_available_channels':intersection.length<requested.length?'using_available_requested_channels':'requested_channels_available'};
}
