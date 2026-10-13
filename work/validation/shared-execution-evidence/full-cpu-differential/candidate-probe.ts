import { afterAll } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';

const files=['candidate-transform.mjs','candidate-profile.config.ts','candidate-probe.ts'];
const hashSources=()=>Promise.all(files.map(async file=>({file,
  sha256:createHash('sha256').update(await readFile(new URL(file,import.meta.url))).digest('hex')})));
const before=await hashSources();
let lastConstructor:(()=>unknown)|undefined;
const sources:unknown[]=[];
const probe={sources,construct<A>(run:()=>A):A {
  const value=globalThis.__operationCpu.sync('Candidate.cancellationClient',run);
  // Retain only a callable closure, never serialize connection configuration.
  if(globalThis.__operationCpu.current()!==undefined)lastConstructor=run;
  return value;
}};
declare global {var __candidateCpu:typeof probe;}
globalThis.__candidateCpu=probe;
afterAll(async()=>{
  const blocks=[];
  if(lastConstructor!==undefined)for(let block=0;block<5;block++) {
    const start=process.threadCpuUsage(),time=performance.now();
    for(let i=0;i<38000;i++)lastConstructor();
    const elapsedMs=performance.now()-time,cpu=process.threadCpuUsage(start);
    blocks.push({calls:38000,workflows:1000,threadMs:(cpu.user+cpu.system)/1000,elapsedMs});
  }
  const after=await hashSources(),directory=process.env.FLAREX_MEASUREMENT_REPORT_DIRECTORY;
  if(directory===undefined)throw Error('Missing report directory');
  await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,'candidate-probe.json'),JSON.stringify({before,after,sources,blocks},null,2));
  Reflect.deleteProperty(globalThis,'__candidateCpu');
});
