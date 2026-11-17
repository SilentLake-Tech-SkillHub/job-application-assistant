import {configurePaths} from '../shared/runtime-paths.mjs';import {browserPreferences} from '../shared/browser-preferences.mjs';
const args=process.argv.slice(2),value=k=>{const i=args.indexOf(k);return i<0?undefined:args[i+1];};
configurePaths({workspace:value('--workspace')});
console.log(JSON.stringify(await browserPreferences({action:args[0]||'status',choice:value('--choice'),quote:value('--quote')})));
