#!/usr/bin/env node
// Use the same Cordis values for the DSH parent, native shell and Hooks.
import {readFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {dshRuntimeEnvironment} from './install-host.mjs';

const [profile,separator,command,...args]=process.argv.slice(2);
if(!profile||!path.isAbsolute(profile)||separator!=='--'||!command)throw Error('USAGE: launch-dsh.mjs <absolute Cordis patch> -- <DSH command> [args]');
const environment=dshRuntimeEnvironment(await readFile(profile,'utf8'));
const env={...process.env,...environment};
for(const name of ['CODEX_THREAD_ID','CODEX_SESSION_ID','DSH_SESSION_ID','DSH_PTY_SESSION_ID'])delete env[name];
const child=spawn(command,args,{env,stdio:'inherit'});
child.once('error',error=>{console.error(error.message);process.exitCode=1;});
child.once('exit',(code,signal)=>{process.exitCode=code??(signal?1:0);});
