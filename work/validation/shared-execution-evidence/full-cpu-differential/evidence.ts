import { Schema } from 'effect';
import assert from 'node:assert/strict';
import { CpuEvidenceSchema } from '../../../../packages/executor/test/performance/measurement/cpu';
import { RootCounterEvidenceSchema, RootCounterPairSchema } from '../../../../packages/executor/test/performance/measurement/rootCounters';
const Hash=Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Source=Schema.Struct({file:Schema.String,sha256:Hash});
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
