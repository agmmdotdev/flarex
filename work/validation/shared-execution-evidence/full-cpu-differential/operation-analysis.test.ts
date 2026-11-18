import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { it, expect } from 'vitest';
import { decodeRaw, decodeOperations, validateCampaign, partitionOperations, readRetainedJson, type OperationLedgerSchema } from './evidence';

const directory=import.meta.dirname;
const sameInstrumentation=(first:typeof OperationLedgerSchema.Type.before,next:typeof OperationLedgerSchema.Type.before)=>assert.deepEqual(next,first,'Operation instrumentation changed between campaigns');
type Root=typeof OperationLedgerSchema.Type.roots[number];
it('rejects overlapping operation intervals instead of double counting them',()=>{
  const at=(n:number)=>({time:n,cycles:String(n),user:n,system:0});
  const root:Root={ordinal:0,start:at(0),end:at(10),threadId:1,intervals:[
    {ordinal:0,name:'a',parent:null,start:at(1),end:at(6)},
    {ordinal:1,name:'b',parent:null,start:at(5),end:at(8)}]};
  expect(()=>partitionOperations(root)).toThrow();
  expect(()=>partitionOperations({...root,intervals:[root.intervals[0]!]})).not.toThrow();
});
it('rejects changed diagnostic sources across otherwise stable campaigns',()=>{
  const first=[{file:'operation-probe.ts',sha256:'a'.repeat(64)}];
  expect(()=>sameInstrumentation(first,[{file:'operation-probe.ts',sha256:'b'.repeat(64)}])).toThrow();
  expect(()=>sameInstrumentation(first,[...first])).not.toThrow();
});

it('correlates original request counters and disjoint operation cycle partitions',async()=>{
  const campaigns=[];
  for(const label of ['operation-profile-a','operation-profile-b','operation-counters']){
    const files=await readdir(resolve(directory,label));
    const originals=[...new Set(files.filter(f=>/^[a-f0-9-]{36}\.json(?:\.gz)?$/.test(f)).map(f=>f.replace(/\.gz$/,'')))];assert.equal(originals.length,1);
    const file=originals[0];assert(file);const gz=files.includes(file+'.gz');
    const bytes=await readFile(resolve(directory,label,file+(gz?'.gz':'')));
    const raw=decodeRaw(JSON.parse((gz?gunzipSync(bytes):bytes).toString('utf8')));
    validateCampaign(raw,label==='operation-counters'?'control':'profile-a');
    assert.equal(raw.sources.before,raw.sources.after);assert.equal(raw.execution,'complete');assert.equal(raw.cleanup,'completed');
    assert(raw.gates.every(g=>g.passed)&&raw.samples.every(s=>s.outcome==='success'));
    const ledger=decodeOperations(await readRetainedJson(resolve(directory,label,'operations.json')));
    assert.deepEqual(ledger.before,ledger.after);assert.deepEqual(ledger.faults,[]);assert.equal(ledger.roots.length,80);
    const used=new Set<number>();
    const roots=raw.samples.filter(s=>s.kind==='diagnostic').map(sample=>{
      const original=sample.rootCounters;assert(original?.complete&&original.callWindow&&original.counters?.thread);
      const window=original.callWindow;
      const candidates=ledger.roots.filter(r=>r.start.time>=window.startMonotonicMs&&r.end!==null&&r.end.time<=window.endMonotonicMs);
      assert.equal(candidates.length,1);const root=candidates[0];assert(root);assert(!used.has(root.ordinal));used.add(root.ordinal);
      const partition=partitionOperations(root);
      const sdkCpuMs=(original.counters.thread.user+original.counters.thread.system)/1000;
      assert(sdkCpuMs>=partition.total.cpuMs);
      return {id:sample.id,index:sample.index,lane:sample.lane,sdkCpuMs,probeBoundaryCpuMs:sdkCpuMs-partition.total.cpuMs,...partition};
    });
    assert.equal(used.size,80);
    const flarex=roots.filter(r=>r.lane==='flarex');assert.equal(flarex.length,40);
    for(const root of flarex){
      const top=(name:string)=>{const spans=root.rows.filter(r=>r.name===name);assert.equal(spans.length,1);assert.equal(spans[0]?.parent,null);return spans[0];};
      top('request admission');top('authoritative publication');
      const business=top('portable runtime execution');assert(business);
      for(const span of root.rows.filter(r=>['LogicalDocuments.readRelationalSelection','FiniteStorageCapture.run','native Medusa workflow'].includes(r.name))){
        let parent=span.parent;
        while(parent!==null&&parent!==business.ordinal){const ancestor=root.rows[parent];assert(ancestor);parent=ancestor.parent;}
        assert.equal(parent,business.ordinal,'Reported residual must not overlap whole admission/publication');
      }
    }
    const totalCycles=flarex.reduce((s,r)=>s+r.total.cycles,0);
    const names=[...new Set(flarex.flatMap(r=>r.rows.map(s=>s.name)))];
    const operations=names.map(name=>{
      const rows=flarex.flatMap(r=>r.rows.filter(s=>s.name===name));
      return {name,callsPerRoot:rows.length/40,inclusiveCpuMeanMs:rows.reduce((s,r)=>s+r.inclusive.cpuMs,0)/40,
        exclusiveCpuMeanMs:rows.reduce((s,r)=>s+r.exclusive.cpuMs,0)/40,
        inclusiveCyclesPercent:rows.reduce((s,r)=>s+r.inclusive.cycles,0)/totalCycles*100,
        exclusiveCyclesPercent:rows.reduce((s,r)=>s+r.exclusive.cycles,0)/totalCycles*100};
    }).sort((a,b)=>b.exclusiveCyclesPercent-a.exclusiveCyclesPercent);
    campaigns.push({label,runId:raw.runId,sourceHash:raw.sources.before,readerSha256:ledger.readerSha256,instrumentationSources:ledger.before,
      nativeCpuMeanMs:roots.filter(r=>r.lane==='native').reduce((s,r)=>s+r.sdkCpuMs,0)/40,
      flarexCpuMeanMs:flarex.reduce((s,r)=>s+r.sdkCpuMs,0)/40,
      addedCpuMeanMs:raw.cpuPairs.reduce((s,p)=>{assert(p.thread);return s+p.thread.addedTotalMicroseconds/1000;},0)/40,
      outsideCyclesPercent:flarex.reduce((s,r)=>s+r.outside.cycles,0)/totalCycles*100,operations,roots});
  }
  const firstCampaign=campaigns[0];assert(firstCampaign);
  assert(campaigns.every(c=>c.sourceHash===firstCampaign.sourceHash));
  assert(campaigns.every(c=>c.readerSha256===firstCampaign.readerSha256));
  for(const campaign of campaigns)sameInstrumentation(firstCampaign.instrumentationSources,campaign.instrumentationSources);
  await writeFile(resolve(directory,'operation-costs.json'),JSON.stringify(campaigns,null,2)+'\n');
  console.log(JSON.stringify(campaigns.map(({roots,...r})=>r)));
});
