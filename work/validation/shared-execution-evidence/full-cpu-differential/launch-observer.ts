import { Effect } from 'effect';
import { createCyclePartition, type CycleReader, type CycleEvidence } from '../../../../packages/executor/test/performance/measurement/cycleAttribution';

type Partition=ReturnType<typeof createCyclePartition>;
type Token=ReturnType<Partition['enter']>;
type Frame={name:string; cycles?:Token; cpu?:Token};
type Context={root:number; ordinal:number; observed:boolean; cycles:Partition; cpu:Partition};
export type LaunchRecord={root:number;ordinal:number;observed:boolean;cycles:CycleEvidence;cpuMicroseconds:CycleEvidence};
/** Reuse the SDK's telescoping partition twice, with separately labelled units.
 * Synchronous frames never span awaits. Seed/cut them at the command boundary
 * because its enclosing Effect interpreter can start before or finish after it. */
export function createLaunchObserver(input:{cycles:CycleReader;cpu:CycleReader;
  current:()=>{root:number;next:number}|undefined;reverse:boolean}) {
  const records:LaunchRecord[]=[],faults:string[]=[],stack:Frame[]=[];
  let active:Context|undefined;
  const observed=(root:number)=>[true,false,false,true][Math.floor(Math.floor(root/2)/5)%4]!==input.reverse;
  const enter=(frame:Frame)=>{frame.cycles=active?.cycles.enter(frame.name);frame.cpu=active?.cpu.enter(frame.name);};
  const leave=(frame:Frame)=>{if(frame.cpu!==undefined)active?.cpu.leave(frame.cpu);if(frame.cycles!==undefined)active?.cycles.leave(frame.cycles);
    frame.cpu=undefined;frame.cycles=undefined;};
  const begin=()=>{
    const current=input.current();if(current===undefined)return;
    if(active!==undefined){faults.push('overlapping-command');return;}
    const enabled=observed(current.root);
    active={root:current.root,ordinal:current.next-1,observed:enabled,
      cycles:createCyclePartition(input.cycles,'engine',enabled),cpu:createCyclePartition(input.cpu,'engine',enabled)};
    active.cycles.begin();active.cpu.begin();for(const frame of stack)enter(frame);
  };
  const end=()=>{
    const context=active;if(context===undefined)return;
    try{
      for(const frame of [...stack].reverse())leave(frame);
      context.cpu.end();context.cycles.end();
      records.push({root:context.root,ordinal:context.ordinal,observed:context.observed,
        cycles:context.cycles.evidence(),cpuMicroseconds:context.cpu.evidence()});
    }catch{faults.push('partition');}finally{active=undefined;}
  };
  const run=<A>(name:string,body:()=>A):A=>{
    if(input.current()===undefined)return body();
    const frame:Frame={name};stack.push(frame);enter(frame);
    try{return body();}finally{leave(frame);if(stack.pop()!==frame)faults.push('synchronous-nesting');}
  };
  return {records,faults,run,observed,
    inside:()=>active?.observed===true,
    fn<T extends (...args:never[])=>unknown>(name:string,body:T):T {
      return new Proxy(body,{apply:(target,receiver,args:unknown[])=>run(name,()=>Reflect.apply(target,receiver,args))});
    },
    command<A,E,R>(work:Effect.Effect<A,E,R>):Effect.Effect<A,E,R> {
      return Effect.suspend(()=>{begin();return Effect.onExit(work,()=>Effect.sync(end));});
    },
    settled:()=>active===undefined&&stack.length===0,
  };
}
