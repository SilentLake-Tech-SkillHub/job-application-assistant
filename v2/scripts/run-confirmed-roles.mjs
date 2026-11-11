import {readFile} from 'node:fs/promises';
import {createInterface} from 'node:readline';
import {createConfirmedRunner} from '../shared/confirmed-runner.mjs';
const file=process.env.RECRUITING_RUN_AUTHORIZATION_FILE;if(!file)throw Error('RUN_AUTHORIZATION_FILE_REQUIRED');
const runner=await createConfirmedRunner({authorization:await readFile(file,'utf8'),startedAt:process.env.RECRUITING_RUN_STARTED_AT,emit:line=>console.log(line)});
await runner.start();
if(process.stdin.isTTY)process.stdin.setRawMode(true);
for await(const line of createInterface({input:process.stdin,terminal:false})){if(line.trim()==='close')break;if(line.trim()==='resume')await runner.resume();}
