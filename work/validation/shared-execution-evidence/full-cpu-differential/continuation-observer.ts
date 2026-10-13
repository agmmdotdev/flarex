import { Effect } from 'effect';
import { createCyclePartition, type CycleReader, type CycleEvidence } from '../../../../packages/executor/test/performance/measurement/cycleAttribution';
type Partition=ReturnType<typeof createCyclePartition>;
type Frame={name:string;token?:ReturnType<Partition['enter']>};
export type Snapshot={raw:bigint;gc:bigint;collections:bigint};
export type ContinuationRecord={root:number;ordinal:number;observed:boolean;cycles:CycleEvidence;
  rawFirst:string;rawLast:string;gcCycles:number;gcCollections:number;probeCycles:number;totalCycles:number};
/** A virtual cycle clock pauses during GC and measured probe bookkeeping.
 * It never converts cycles to time. Native snapshot acquisition and VM hook
 * dispatch outside these brackets remain unpriced observer overhead. */
export function createContinuationObserver(input:{snapshot:()=>Snapshot;threadId:()=>number;
  current:()=>{root:number;next:number}|undefined;reverse:boolean;plain:boolean}){
  const records:ContinuationRecord[]=[],faults:string[]=[],stack:Frame[]=[];
  let active:{root:number;ordinal:number;observed:boolean;first:Snapshot;probeFirst:bigint;partition:Partition}|undefined;
  let probe=0n,frozen:Snapshot|undefined;
  const snapshot=()=>input.snapshot();
  const bookkeeping=<A>(body:()=>A):A=>{
    if(frozen!==undefined)return body();
    const start=snapshot();frozen=start;
    try{return body();}finally{
      const end=snapshot();probe+=end.raw-start.raw-(end.gc-start.gc);frozen=undefined;
    }
  };
  const reader:CycleReader={threadId:input.threadId,read:()=>{
    const now=frozen??snapshot();return now.raw-now.gc-probe;
  }};
  const observed=(root:number)=>!input.plain&&[true,false,false,true][Math.floor(Math.floor(root/2)/5)%4]!==input.reverse;
  const enter=(name:string):Frame|undefined=>bookkeeping(()=>{
    if(input.plain||input.current()===undefined)return;
    const frame:Frame={name};stack.push(frame);frame.token=active?.partition.enter(name);return frame;
  });
  const leave=(frame:Frame|undefined)=>{if(frame===undefined)return;bookkeeping(()=>{
    if(frame.token!==undefined)active?.partition.leave(frame.token);
    if(stack.pop()!==frame)faults.push('nesting');
  });};
  const begin=()=>bookkeeping(()=>{
    const current=input.current();if(current===undefined)return;
    if(active!==undefined){faults.push('overlap');return;}
    const enabled=observed(current.root),partition=createCyclePartition(reader,'engine',enabled);
    const first=frozen; if(first===undefined)throw Error('Missing frozen boundary');
    active={root:current.root,ordinal:current.next-1,observed:enabled,first,probeFirst:probe,partition};
    partition.begin();for(const frame of stack)frame.token=partition.enter(frame.name);
  });
  const end=()=>bookkeeping(()=>{
    const context=active;if(context===undefined)return;
    for(const frame of [...stack].reverse()){if(frame.token!==undefined)context.partition.leave(frame.token);frame.token=undefined;}
    context.partition.end();const last=frozen;if(last===undefined)throw Error('Missing frozen boundary');
    records.push({root:context.root,ordinal:context.ordinal,observed:context.observed,cycles:context.partition.evidence(),
      rawFirst:String(context.first.raw),rawLast:String(last.raw),gcCycles:Number(last.gc-context.first.gc),
      gcCollections:Number(last.collections-context.first.collections),probeCycles:Number(probe-context.probeFirst),
      totalCycles:Number(last.raw-context.first.raw)});active=undefined;
  });
  const run=<A>(name:string,body:()=>A):A=>{const frame=enter(name);try{return body();}finally{leave(frame);}};
  return {records,faults,observed,enter,leave,bookkeeping,run,inside:()=>active?.observed===true,
    owner:()=>active?.observed===true?(stack.at(-1)?.name??'outside'):undefined,
    fn<T extends(...args:never[])=>unknown>(name:string,body:T):T{
      return bookkeeping(()=>new Proxy(body,{apply:(target,receiver,args:unknown[])=>run(name,()=>Reflect.apply(target,receiver,args))}));
    },
    // Diagnostic boundary: no extra function tracing/generator under measurement.
    command<A,E,R>(work:Effect.Effect<A,E,R>):Effect.Effect<A,E,R>{
      return Effect.suspend(()=>{begin();return Effect.onExit(work,()=>Effect.sync(end));});
    },
    settled:()=>active===undefined&&stack.length===0,
  };
}
