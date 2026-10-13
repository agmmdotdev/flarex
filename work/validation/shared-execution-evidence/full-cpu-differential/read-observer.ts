import { Result } from 'effect';
export function createReadProbe(operation: () => Pick<typeof globalThis.__operationCpu, 'current' | 'sync'> | undefined) {
const objects = new WeakMap<object, number>(); let next = 0;
const identity = (value: unknown): string => {
  if (value !== null && (typeof value === 'object' || typeof value === 'function')) {
    let id = objects.get(value); if (id === undefined) { id = ++next; objects.set(value,id); }
    return 'ref:' + id;
  }
  return typeof value + ':' + (Object.is(value,-0) ? '-0' : String(value));
};
// Traverse only successful, owned query/bounds/snapshot preparation inputs.
// Preserve key order; reject accessors/exotic prototypes without invoking them.
const dataKey = (value: unknown, seen = new Set<object>()): string => {
  if (value === null || typeof value !== 'object') return identity(value);
  if (seen.has(value)) throw Error('Cyclic diagnostic key');
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null && prototype !== Array.prototype) throw Error('Exotic diagnostic key');
  seen.add(value);
  const result = JSON.stringify(Object.entries(Object.getOwnPropertyDescriptors(value)).map(([key,descriptor]) => {
    if (!('value' in descriptor)) throw Error('Accessor diagnostic key');
    return [key,dataKey(descriptor.value,seen)];
  }));
  seen.delete(value); return (Array.isArray(value) ? 'array:' : 'object:') + result;
};
type Fact = { root: number; ordinal: number; name: string; site: string; identities: string[]; key: string; elapsedMs: number; outcome: 'returned' | 'threw' };
const facts: Fact[] = [], faults: string[] = [];
type Replay = {root:number;ordinal:number;key:string;name:string;run:()=>unknown;expected:string};
let replayRoot=-1;
const replayKeys=new Set<string>(), replay:Replay[]=[];
const replayValue=(name:string,value:unknown):string => {
  if(name==='compileAppOrderedIndexBoundsV1')return dataKey(value);
  if(value===null||typeof value!=='object')throw Error('Missing preparation result');
  if(!Result.isResult(value))throw Error('Preparation replay failed');
  return Result.match(value,{
    onFailure:()=>{throw Error('Preparation replay failed');},
    onSuccess:success=>{
      if(success===null||typeof success!=='object')throw Error('Preparation replay failed');
      return dataKey(Reflect.get(success,'demand'));
    },
  });
};
const sources: { file: string; sites: {name:string;site:string}[]; sha256: string }[] = [];
const probe = {
  sources, facts, faults, replay,
  call<A, Args extends unknown[]>(name: string, site: string, fn: (...args: Args) => A, args: Args): A {
    const current = operation()?.current();
    if (current === undefined) return Reflect.apply(fn,undefined,args);
    const identities = args.map(identity);
    // Identity is merely repetition evidence. Structural query equivalence is
    // additionally scoped to the exact table, capability, error and mechanics.
    let key = JSON.stringify(identities);
    let elapsedMs = 0, outcome: Fact['outcome'] = 'threw';
    try {
      const returned = operation()!.sync('ReadSync.' + name, () => {
        const start = performance.now();
        try { const result = Reflect.apply(fn,undefined,args); outcome = 'returned'; return result; }
        finally { elapsedMs = performance.now() - start; }
      });
    try {
      if (name === 'prepareLogicalRelationalRead' && Result.isResult(returned) && Result.isSuccess(returned)) key = JSON.stringify([identities[0],identities[1],dataKey(args[2]),...identities.slice(3)]);
      if (name === 'compileAppOrderedIndexBoundsV1') key = dataKey(args[0]);
      if (name === 'prepareAppRowsSnapshotReadResult' && Result.isResult(returned) && Result.isSuccess(returned)) key = dataKey(args[0]);
      if (name === 'prepareAppIndexSnapshotReadResult' && Result.isResult(returned) && Result.isSuccess(returned)) {
        const input=args[0];if(input===null||typeof input!=='object')throw Error('Missing snapshot input');
        const descriptors=Object.getOwnPropertyDescriptors(input);
        const own=(field:string):unknown=>{const descriptor=descriptors[field];if(descriptor===undefined)return undefined;
          if(!('value' in descriptor))throw Error('Accessor snapshot input');return descriptor.value;};
        key=JSON.stringify([identity(own('definition')),dataKey(Object.fromEntries(
          ['scopeId','snapshotCommitSeq','bounds','after','limit'].map(field=>[field,own(field)])))]);
      }
    } catch { faults.push('key:' + name); }
      if(current.inReadFamily && (name==='compileAppOrderedIndexBoundsV1'||name==='prepareLogicalRelationalRead' && Result.isResult(returned) && Result.isSuccess(returned))) {
        try {
        if(replayRoot!==current.root){replayRoot=current.root;replayKeys.clear();replay.length=0;}
        const full=name+'|'+key;
        if(replayKeys.has(full)) replay.push({root:current.root,ordinal:current.next,key,name,run:()=>Reflect.apply(fn,undefined,args),expected:replayValue(name,returned)});
        replayKeys.add(full);
        } catch { faults.push("replay-record:"+name); }
      }
      return returned;
    } finally { facts.push({root:current.root,ordinal:current.next,name,site,identities,key,elapsedMs,outcome}); }
  },
};

return {...probe,replayValue};
}
