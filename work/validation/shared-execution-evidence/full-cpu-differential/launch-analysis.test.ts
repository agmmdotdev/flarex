import { it, expect } from 'vitest';
import { Effect, Exit, Cause } from 'effect';
import ts from '@typescript/typescript6';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createLaunchObserver } from './launch-observer';
import { transformLaunch } from './launch-transform.mjs';
const fixture=()=>{let cycles=0n,cpu=0n;return createLaunchObserver({cycles:{read:()=>++cycles,threadId:()=>1},
  cpu:{read:()=>++cpu,threadId:()=>1},current:()=>({root:0,next:5}),reverse:false});};
it('cuts enclosing synchronous execution at command boundaries and conserves both units',()=>{
  const probe=fixture();
  const value=probe.run('Effect.runLoop',()=>Effect.runSync(probe.command(Effect.sync(()=>probe.run('Driver',()=>42)))));
  expect(value).toBe(42);expect(probe.settled()).toBe(true);expect(probe.faults).toEqual([]);
  const record=probe.records[0];assert(record);expect(record.ordinal).toBe(4);
  for(const partition of [record.cycles,record.cpuMicroseconds]){
    expect(partition.complete).toBe(true);expect(partition.buckets.map(b=>b.site)).toContain('Effect.runLoop');
    expect(partition.buckets.map(b=>b.site)).toContain('Driver');
    expect(partition.buckets.reduce((sum,b)=>sum+b.cycles,0)).toBe(partition.totalCycles);
  }
});
it('retains Promise identity, receiver, ordered arguments and original throws',()=>{
  const probe=fixture(),promise=Promise.resolve(1),receiver={},failure={reason:'first'},events:string[]=[];
  const fn=probe.fn('callback',function(this:unknown,a:number,b:number){expect(this).toBe(receiver);expect([a,b]).toEqual([1,2]);return promise;});
  expect(fn.call(receiver,(events.push('a'),1),(events.push('b'),2))).toBe(promise);expect(events).toEqual(['a','b']);
  const bad=probe.fn('bad',()=>{throw failure;});try{bad();assert.fail('Expected throw');}catch(cause){expect(cause).toBe(failure);}
  expect(probe.faults).toEqual([]);expect(probe.settled()).toBe(true);
});
it('balances opposite observation orders and records reader faults without replacing failure',async()=>{
  for(const reverse of [false,true]){
    const probe=createLaunchObserver({cycles:{read:()=>{throw Error('counter fault');},threadId:()=>1},
      cpu:{read:()=>1n,threadId:()=>1},current:()=>({root:reverse?10:0,next:1}),reverse});
    const enabled=Array.from({length:40},(_,i)=>probe.observed(2*i));
    expect(enabled.filter(Boolean)).toHaveLength(20);
    expect(enabled.slice(0,20)).toEqual(Array.from({length:20},(_,i)=>[true,false,false,true][Math.floor(i/5)]!==reverse));
    const actual=await Effect.runPromiseExit(probe.command(Effect.fail('original')));
    expect(actual).toEqual(await Effect.runPromiseExit(Effect.fail('original')));
    expect(probe.records[0]?.cycles.complete).toBe(false);expect(probe.settled()).toBe(true);
  }
});
it('forwards typed failure, defect, interruption and combined Cause without later work',async()=>{
  for(const work of [Effect.fail('first'),Effect.die('defect'),Effect.interrupt,
    Effect.failCause(Cause.combine(Cause.fail('first'),Cause.die('second'))) ]){
    const probe=fixture(),events:string[]=[];
    const original=await Effect.runPromiseExit(work);
    const actual=await Effect.runPromiseExit(probe.command(work.pipe(Effect.andThen(()=>Effect.sync(()=>events.push('later'))))));
    // Interruption carries a fresh runner fiber id, so compare its cause shape.
    if(work===Effect.interrupt)expect(Exit.isFailure(actual)&&Cause.hasInterrupts(actual.cause)).toBe(true);
    else expect(actual).toEqual(original);
    expect(events).toEqual([]);expect(probe.settled()).toBe(true);expect(probe.faults).toEqual([]);
  }
});
it('transforms only pinned physical-command sites with valid syntax',async()=>{
  for(const name of ['postgres','drizzle']){
    const file='packages/persistence-postgres/src/database/physicalSession/'+name+'.ts';
    const source=(await readFile(file,'utf8')).replaceAll('\r\n','\n');
    const result=transformLaunch(source,'/'+file);assert(result);
    expect(ts.transpileModule(result,{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ESNext,module:ts.ModuleKind.ESNext}})
      .diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error)??[]).toEqual([]);
    const sources:{sites:{name:string}[]}[]=[];new Function('globalThis',result.split('\n')[0]!)({__launchCpu:{sources}});
    expect(sources).toHaveLength(1);
    expect(sources[0]?.sites.filter(s=>s.name==='command')).toHaveLength(name==='postgres'?1:0);
    expect(sources[0]?.sites.filter(s=>s.name==='Driver.mapResult')).toHaveLength(name==='drizzle'?1:0);
  }
});
