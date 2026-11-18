import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { Schema } from 'effect';
import { beforeAll, afterAll, expect } from 'vitest';
import { createLaunchObserver } from './launch-observer';

const require=createRequire(import.meta.url),pgRequire=createRequire(resolve('packages/persistence-postgres/package.json'));
const readerPath=resolve('work/validation/shared-execution-evidence/engine-cpu-attribution/thread-cycles.node');
const native=Schema.decodeUnknownSync(Schema.Struct({readCycles:Schema.Unknown,threadId:Schema.Unknown}))(require(readerPath));
const read=native.readCycles,thread=native.threadId;
if(typeof read!=='function'||typeof thread!=='function')throw Error('Missing existing cycle reader');
const identity=()=>Schema.decodeUnknownSync(Schema.Natural)(thread());
const observer=createLaunchObserver({
  cycles:{read:()=>{const value:unknown=read();if(typeof value!=='bigint')throw Error('Invalid cycles');return value;},threadId:identity},
  cpu:{read:()=>{const cpu=process.threadCpuUsage();return BigInt(cpu.user+cpu.system);},threadId:identity},
  current:()=>globalThis.__operationCpu?.current(),reverse:process.env.FLAREX_LAUNCH_ORDER==='baab',
});
const sources:unknown[]=[];
const probe={...observer,sources};
declare global {var __launchCpu:typeof probe;}
globalThis.__launchCpu=probe;
const fileNames=['launch-probe.ts','launch-observer.ts','launch-transform.mjs','launch-profile.config.ts'];
const files=fileNames.map(name=>new URL(name,import.meta.url));
const enginePath=resolve(dirname(require.resolve('effect')),'internal/effect.js');
const pgPath=pgRequire.resolve('pg');
const parserPath=createRequire(pgPath).resolve('pg-protocol');
const drizzlePath=resolve(dirname(pgRequire.resolve('drizzle-orm/node-postgres/session')),'session.js');
const modulePaths=[enginePath,pgPath,resolve(dirname(pgPath),'client.js'),
  resolve(dirname(parserPath),'parser.js'),drizzlePath,readerPath];
const hash=async(path:string|URL)=>createHash('sha256').update(await readFile(path)).digest('hex');
const hashes=()=>Promise.all([...files,...modulePaths].map(async path=>({file:String(path),sha256:await hash(path)})));
const before=await hashes();
const restores:(()=>void)[]=[],patches:{name:string;method:string}[]=[];
let replayRoot:number|undefined;
const replay:(()=>unknown)[]=[];
const prototypeOf=(value:unknown):object=>{
  if(typeof value!=='function'||typeof value.prototype!=='object'||value.prototype===null)throw Error('Expected installed constructor');
  return value.prototype;
};
const patch=(prototype:object,method:string,name:string,retain=false)=>{
  const descriptor=Object.getOwnPropertyDescriptor(prototype,method),original:unknown=descriptor?.value;
  if(descriptor?.configurable!==true||typeof original!=='function')throw Error('Missing installed method '+name);
  const wrapper=function(this:unknown,...args:unknown[]):unknown{
    if(retain&&observer.inside()){
      const current=globalThis.__operationCpu.current();
      if(current!==undefined){if(replayRoot!==current.root){replayRoot=current.root;replay.length=0;}
        const receiver=this;replay.push(()=>Reflect.apply(original,receiver,args));}
    }
    return retain?Reflect.apply(original,this,args):observer.run(name,()=>Reflect.apply(original,this,args));
  };
  Object.defineProperty(prototype,method,{...descriptor,value:wrapper});patches.push({name,method});
  restores.push(()=>{if(Object.getOwnPropertyDescriptor(prototype,method)?.value!==wrapper)throw Error('Probe patch replaced '+name);
    Object.defineProperty(prototype,method,descriptor);});
};
beforeAll(async()=>{
  const engine:unknown=await import(/* @vite-ignore */pathToFileURL(enginePath).href);
  const drizzle:unknown=await import(/* @vite-ignore */pathToFileURL(drizzlePath).href);
  const Engine=Schema.decodeUnknownSync(Schema.Struct({FiberImpl:Schema.Unknown}))(engine);
  const Drizzle=Schema.decodeUnknownSync(Schema.Struct({NodePgSession:Schema.Unknown,NodePgPreparedQuery:Schema.Unknown}))(drizzle);
  const Pg=Schema.decodeUnknownSync(Schema.Struct({Client:Schema.Unknown}))(pgRequire('pg'));
  const Parser=Schema.decodeUnknownSync(Schema.Struct({Parser:Schema.Unknown}))(require(resolve(dirname(parserPath),'parser.js')));
  patch(prototypeOf(Engine.FiberImpl),'runLoop','Effect.runLoop');
  patch(prototypeOf(Drizzle.NodePgSession),'prepareQuery','prepare-replay',true);
  patch(prototypeOf(Drizzle.NodePgPreparedQuery),'execute','Driver.drizzleLaunch');
  patch(prototypeOf(Pg.Client),'query','Driver.pgLaunch');
  patch(prototypeOf(Parser.Parser),'parse','Driver.pgReceive');
});
afterAll(async()=>{
  for(const restore of restores.reverse())restore();
  const blocks=[];
  const retained:unknown[]=new Array(64);
  let consumed=0;
  if(replay.length>0)for(let block=0;block<5;block++){
    const cpu=process.threadCpuUsage(),start=performance.now();
    for(let iteration=0;iteration<50000;iteration++)for(const prepare of replay)retained[consumed++%64]=prepare();
    const elapsedMs=performance.now()-start,used=process.threadCpuUsage(cpu);
    if(retained.some(value=>typeof value!=='object'||value===null))throw Error('Preparation replay did not return objects');
    blocks.push({iterations:50000,calls:50000*replay.length,threadMs:(used.user+used.system)/1000,elapsedMs});
  }
  const after=await hashes(),directory=process.env.FLAREX_MEASUREMENT_REPORT_DIRECTORY;
  if(directory===undefined)throw Error('Missing report directory');await mkdir(directory,{recursive:true});
  await writeFile(resolve(directory,'launch-ledger.json'),JSON.stringify({before,after,sources,patches,
    order:process.env.FLAREX_LAUNCH_ORDER??'abba',records:observer.records,faults:observer.faults,
    replay:{root:replayRoot,callsPerWorkflow:replay.length,blocks},
    method:'Existing telescoping partition in separate thread-cycle and thread-CPU-microsecond units. Synchronous scopes seeded/cut at command boundaries. Alternating ABBA/BAAB blocks toggle detailed observation; no business work skipped. Unobserved continuation CPU is not assigned to Promise internals.'},null,2));
  Reflect.deleteProperty(globalThis,'__launchCpu');expect(after).toEqual(before);
  expect(observer.faults).toEqual([]);expect(observer.settled()).toBe(true);
});
