import { it, expect } from 'vitest';
import { Effect, Exit, Cause } from 'effect';
import { createContinuationObserver } from './continuation-observer';
import { createLaunchObserverWithContinuations } from './continuation-runtime';
const fixture=()=>{let raw=100n,gc=0n,collections=0n;const probe=createContinuationObserver({
  snapshot:()=>({raw:++raw,gc,collections}),threadId:()=>1,current:()=>({root:0,next:1}),reverse:false,plain:false});
  return {probe,work:(n:bigint)=>{raw+=n;},collect:(n:bigint)=>{raw+=n;gc+=n;collections++;}};};
let liveRoot:{root:number;next:number}|undefined;
const reader={read:()=>0n,threadId:()=>1};
const liveProbe=createLaunchObserverWithContinuations({cycles:reader,cpu:reader,current:()=>liveRoot,reverse:false});
it('separates nested Promise work, GC and bookkeeping with exact conservation',()=>{
  const {probe,work,collect}=fixture();
  const value=probe.run('VM.promiseReaction',()=>Effect.runSync(probe.command(Effect.sync(()=>{
    probe.bookkeeping(()=>work(100n));probe.run('Driver',()=>{work(50n);collect(25n);});work(10n);return 42;
  }))));
  expect(value).toBe(42);expect(probe.faults).toEqual([]);expect(probe.settled()).toBe(true);
  const record=probe.records[0];expect(record).toBeDefined();if(!record)throw Error('Missing record');
  expect(record.cycles.complete).toBe(true);expect(record.gcCycles).toBe(25);expect(record.gcCollections).toBe(1);
  expect(record.probeCycles).toBeGreaterThanOrEqual(100);expect(record.cycles.totalCycles!+record.gcCycles+record.probeCycles).toBe(record.totalCycles);
  expect(record.cycles.buckets.find(b=>b.site==='Driver')?.cycles).toBe(51);
  expect(record.cycles.buckets.some(b=>b.site==='VM.promiseReaction')).toBe(true);
});
it('retains ordered arguments, receiver, return Promise and throw identity',()=>{
  const {probe}=fixture(),receiver={},promise=Promise.resolve(1),failure={first:true};
  const fn=probe.fn('original',function(this:unknown,a:number,b:number){expect(this).toBe(receiver);expect([a,b]).toEqual([1,2]);return promise;});
  expect(fn.call(receiver,1,2)).toBe(promise);const bad=probe.fn('bad',()=>{throw failure;});
  try{bad();throw Error('Expected failure');}catch(cause){expect(cause).toBe(failure);}expect(probe.settled()).toBe(true);
});
it('keeps failures, defects, interruption and later work ordering',async()=>{
  for(const work of [Effect.fail('first'),Effect.die('defect'),Effect.interrupt,Effect.failCause(Cause.combine(Cause.fail('first'),Cause.die('second'))) ]){
    const {probe}=fixture(),events:string[]=[];
    const actual=await Effect.runPromiseExit(probe.command(work.pipe(Effect.andThen(()=>Effect.sync(()=>events.push('later'))))));
    if(work===Effect.interrupt)expect(Exit.isFailure(actual)&&Cause.hasInterrupts(actual.cause)).toBe(true);
    else expect(actual).toEqual(await Effect.runPromiseExit(work));
    expect(events).toEqual([]);expect(probe.faults).toEqual([]);expect(probe.settled()).toBe(true);
  }
});
it('observes real Promise reactions through rejection without changing the native error',async()=>{
  liveRoot={root:0,next:1};const probe=liveProbe;
  const failure={first:true},events:string[]=[];
  const work=Effect.tryPromise({try:()=>Promise.resolve().then(()=>{events.push('first');throw failure;})
    .then(()=>{events.push('later');}),catch:cause=>cause});
  const actual=await Effect.runPromiseExit(probe.command(work));
  liveRoot=undefined;await new Promise<void>(resolve=>setImmediate(resolve));
  expect(actual).toEqual(await Effect.runPromiseExit(Effect.fail(failure)));expect(events).toEqual(['first']);
  expect(probe.faults).toEqual([]);expect(probe.settled()).toBe(true);
  expect(probe.records[0]?.cycles.complete).toBe(true);
  expect(probe.records[0]?.cycles.buckets.some(b=>b.site.startsWith('VM.promiseReaction:'))).toBe(true);
});
