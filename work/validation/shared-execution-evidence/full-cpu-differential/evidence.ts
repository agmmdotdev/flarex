import { Schema } from 'effect';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { CpuEvidenceSchema } from '../../../../packages/executor/test/performance/measurement/cpu';
import { RootCounterEvidenceSchema, RootCounterPairSchema } from '../../../../packages/executor/test/performance/measurement/rootCounters';
const Hash=Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Source=Schema.Struct({file:Schema.String,sha256:Hash});
export async function readRetainedJson(path:string):Promise<unknown>{
  // Prefer the version retained in Git; only an absent gzip permits raw fallback.
  let bytes:Buffer;
  try{bytes=await readFile(path+'.gz');}
  catch(cause){if(!(cause instanceof Error)||!('code' in cause)||cause.code!=='ENOENT')throw cause;return JSON.parse(await readFile(path,'utf8'));}
  return JSON.parse(gunzipSync(bytes).toString('utf8'));
}
export const MarkerLedgerSchema=Schema.Struct({before:Schema.Array(Source),after:Schema.Array(Source),
  markers:Schema.Array(Schema.Struct({name:Schema.Literals(['clockMarkerA','clockMarkerB']),start:Schema.Finite,end:Schema.Finite}))});
export const RawSchema=Schema.Struct({runId:Schema.String,mode:Schema.Literals(['cpu','root-counters']),execution:Schema.String,cleanup:Schema.String,
  operation:Schema.Literal('compare'),
  sampling:Schema.Struct({requestedSamples:Schema.Literal(40),warmups:Schema.Literal(5),size:Schema.Literal('small'),
    scenario:Schema.Literal('mixed-workflow'),driver:Schema.Literal('postgres'),pairOrder:Schema.Literal('alternating')}),
  sources:Schema.Struct({before:Hash,after:Hash}),
  gates:Schema.Array(Schema.Struct({name:Schema.String,passed:Schema.Boolean})),
  cpuPairs:Schema.Array(RootCounterPairSchema),samples:Schema.Array(Schema.Struct({id:Schema.String,index:Schema.Natural,
    kind:Schema.Literals(['warmup','quiet','diagnostic','calibration']),lane:Schema.Literals(['native','flarex']),outcome:Schema.String,
    rootCounters:Schema.optionalKey(RootCounterEvidenceSchema),cpuEvidence:Schema.optionalKey(CpuEvidenceSchema)}))});
export const decodeRaw=Schema.decodeUnknownSync(RawSchema);
export const decodeMarkers=Schema.decodeUnknownSync(MarkerLedgerSchema);
const OperationReading=Schema.Struct({time:Schema.Finite,cycles:Schema.String.check(Schema.isPattern(/^\d+$/)),user:Schema.Natural,system:Schema.Natural});
const OperationInterval=Schema.Struct({ordinal:Schema.Natural,name:Schema.String,parent:Schema.NullOr(Schema.Natural),start:OperationReading,end:Schema.NullOr(OperationReading)});
export const OperationLedgerSchema=Schema.Struct({before:Schema.Array(Source),after:Schema.Array(Source),readerSha256:Hash,
  roots:Schema.Array(Schema.Struct({ordinal:Schema.Natural,start:OperationReading,end:Schema.NullOr(OperationReading),threadId:Schema.Natural,intervals:Schema.Array(OperationInterval)})),
  faults:Schema.Array(Schema.String),method:Schema.String});
export const decodeOperations=Schema.decodeUnknownSync(OperationLedgerSchema);

/** This retained campaign has exactly one matched pair per diagnostic index.
 * Reject substitutions before allocating CPU or forming bootstrap blocks. */
export function validateCampaign(raw:typeof RawSchema.Type,label:'control'|'profile-a'|'profile-b') {
  assert.equal(raw.mode,label==='control'?'root-counters':'cpu');
  const roots=raw.samples.filter(s=>s.kind==='diagnostic');
  assert.equal(roots.length,80);assert.equal(raw.cpuPairs.length,40);
  const byId=new Map(roots.map(root=>[root.id,root]));assert.equal(byId.size,80);
  const used=new Set<string>();
  for(const [ordinal,pair] of raw.cpuPairs.entries()){
    assert.equal(pair.index,ordinal+5);
    const native=byId.get(pair.nativeRequestId),flarex=byId.get(pair.flarexRequestId);
    assert(native&&flarex);assert.equal(native.lane,'native');assert.equal(flarex.lane,'flarex');
    assert.equal(native.index,pair.index);assert.equal(flarex.index,pair.index);
    for(const root of [native,flarex]){
      assert(!used.has(root.id));used.add(root.id);
      assert(root.rootCounters?.complete&&root.rootCounters.counters?.thread);
    }
    const n=native.rootCounters?.counters,f=flarex.rootCounters?.counters;
    assert(n?.thread&&f?.thread);
    for(const key of ['thread','process'] as const){
      const nativeCounter: typeof n.process | null=n[key],flarexCounter: typeof f.process | null=f[key];assert(nativeCounter&&flarexCounter);
      const expected: NonNullable<typeof pair.thread>={nativeUserMicroseconds:nativeCounter.user,nativeSystemMicroseconds:nativeCounter.system,
        flarexUserMicroseconds:flarexCounter.user,flarexSystemMicroseconds:flarexCounter.system,
        addedUserMicroseconds:flarexCounter.user-nativeCounter.user,addedSystemMicroseconds:flarexCounter.system-nativeCounter.system,
        addedTotalMicroseconds:flarexCounter.user+flarexCounter.system-nativeCounter.user-nativeCounter.system};
      assert.deepEqual(pair[key],expected);
    }
  }
  assert.equal(used.size,80);
}

export type OperationRoot=typeof OperationLedgerSchema.Type.roots[number];
type Interval=OperationRoot['intervals'][number];
type Span=Pick<OperationRoot,'start'|'end'>;
const duration=(span:Span)=>{
  assert(span.end!==null);assert(span.end.time>=span.start.time);
  const cycles=Number(BigInt(span.end.cycles)-BigInt(span.start.cycles));
  const cpu=span.end.user+span.end.system-span.start.user-span.start.system;
  assert(Number.isSafeInteger(cycles)&&cycles>=0);assert(cpu>=0);
  return {cycles,cpuMs:cpu/1000};
};
export function partitionOperations(root:OperationRoot){
  const total=duration(root);
  const byId=new Map(root.intervals.map((span,index)=>{assert.equal(span.ordinal,index);return [span.ordinal,span];}));
  const children=(id:number|null)=>root.intervals.filter(s=>s.parent===id);
  const inside=(parent:Span,child:Span)=>{
    assert(parent.end&&child.end);assert(child.start.time>=parent.start.time&&child.end.time<=parent.end.time);
    assert(BigInt(child.start.cycles)>=BigInt(parent.start.cycles)&&BigInt(child.end.cycles)<=BigInt(parent.end.cycles));
  };
  const sum=(items:readonly Interval[])=>items.reduce((v,s)=>{const d=duration(s);return {cycles:v.cycles+d.cycles,cpuMs:v.cpuMs+d.cpuMs};},{cycles:0,cpuMs:0});
  const own=(parent:Span,id:number|null)=>{
    const subs=children(id),d=duration(parent),used=sum(subs);
    for(const [i,child] of subs.entries()){
      inside(parent,child);
      const prior=subs[i-1];if(prior){assert(prior.end);assert(prior.end.time<=child.start.time);assert(BigInt(prior.end.cycles)<=BigInt(child.start.cycles));}
    }
    assert(used.cycles<=d.cycles);assert(used.cpuMs<=d.cpuMs+1e-8);
    return {cycles:d.cycles-used.cycles,cpuMs:d.cpuMs-used.cpuMs};
  };
  const rows=root.intervals.map(span=>{
    const parent=span.parent===null?root:byId.get(span.parent);assert(parent);inside(parent,span);
    if(span.parent!==null)assert(span.parent<span.ordinal);
    return {name:span.name,ordinal:span.ordinal,parent:span.parent,inclusive:duration(span),exclusive:own(span,span.ordinal)};
  });
  const outside=own(root,null);
  assert.equal(rows.reduce((s,r)=>s+r.exclusive.cycles,0)+outside.cycles,total.cycles);
  assert(Math.abs(rows.reduce((s,r)=>s+r.exclusive.cpuMs,0)+outside.cpuMs-total.cpuMs)<1e-8);
  return {total,outside,rows};
}
