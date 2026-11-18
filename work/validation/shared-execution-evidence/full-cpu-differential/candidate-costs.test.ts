import { it } from 'vitest';
import { Schema } from 'effect';
import { readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { decodeRaw, validateCampaign, decodeOperations, partitionOperations, readRetainedJson } from './evidence';
const Hash=Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Sources=Schema.Array(Schema.Struct({file:Schema.String,sha256:Hash}));
const Probe=Schema.Struct({before:Sources,after:Sources,sources:Schema.Array(Schema.Struct({file:Schema.String,sha256:Hash,
  sites:Schema.Array(Schema.Struct({name:Schema.String,mode:Schema.String,line:Schema.Natural}))})),
  blocks:Schema.Array(Schema.Struct({calls:Schema.Literal(38000),workflows:Schema.Literal(1000),threadMs:Schema.Finite,elapsedMs:Schema.Finite}))});
it('conserves CPU and cycles and joins all candidate scopes to original SDK roots',async()=>{
  const reports=[];
  const labels=process.env.FLAREX_CANDIDATE_CONTROL_ONLY==='on'?['control']:['control','profile-b','profile-c'];
  for(const label of labels){
    const folder=resolve(import.meta.dirname,'candidate-'+label),files=await readdir(folder);
    const ids=[...new Set(files.filter(f=>/^[a-f0-9-]{36}\.json(?:\.gz)?$/.test(f)).map(f=>f.replace(/\.gz$/,'')))];
    assert.equal(ids.length,1);assert(ids[0]);
    const raw=decodeRaw(await readRetainedJson(resolve(folder,ids[0])));
    validateCampaign(raw,label==='control'?'control':'profile-a');
    assert.equal(raw.execution,'complete');assert.equal(raw.cleanup,'completed');assert.equal(raw.sources.before,raw.sources.after);
    assert(raw.gates.length>0&&raw.gates.every(g=>g.passed)&&raw.samples.every(s=>s.outcome==='success'));
    const ledger=decodeOperations(await readRetainedJson(resolve(folder,'operations.json')));
    const probe=Schema.decodeUnknownSync(Probe)(await readRetainedJson(resolve(folder,'candidate-probe.json')));
    assert.deepEqual(ledger.before,ledger.after);assert.deepEqual(ledger.faults,[]);assert.deepEqual(probe.before,probe.after);
    assert.equal(probe.sources.length,2);assert.deepEqual(probe.sources.map(s=>s.sites.length).sort((a,b)=>a-b),[24,27]);
    assert.equal(probe.blocks.length,5);assert(probe.blocks.every(b=>b.threadMs>0&&b.elapsedMs>0));
    const used=new Set<number>();
    const roots=raw.samples.filter(s=>s.kind==='diagnostic').map(s=>{
      const counters=s.rootCounters;assert(counters?.callWindow&&counters.counters?.thread);
      const matches=ledger.roots.filter(r=>r.start.time>=counters.callWindow!.startMonotonicMs&&r.end!==null&&r.end.time<=counters.callWindow!.endMonotonicMs);
      assert.equal(matches.length,1);const root=matches[0];assert(root);assert(!used.has(root.ordinal));used.add(root.ordinal);
      const partition=partitionOperations(root),cpuMs=(counters.counters.thread.user+counters.counters.thread.system)/1000;
      assert(cpuMs>=partition.total.cpuMs);
      return {lane:s.lane,index:s.index,cpuMs,...partition};
    });
    assert.equal(used.size,80);assert.equal(ledger.roots.length,80);
    const flarex=roots.filter(r=>r.lane==='flarex'),sum=(xs:number[])=>xs.reduce((a,b)=>a+b,0);
    const cycles=sum(flarex.map(r=>r.total.cycles));
    const summarize=(rows:typeof flarex[number]['rows'])=>({calls:rows.length/40,
      inclusiveMs:sum(rows.map(r=>r.inclusive.cpuMs))/40,exclusiveMs:sum(rows.map(r=>r.exclusive.cpuMs))/40,
      inclusiveCyclePercent:100*sum(rows.map(r=>r.inclusive.cycles))/cycles,
      exclusiveCyclePercent:100*sum(rows.map(r=>r.exclusive.cycles))/cycles});
    const allRows=flarex.flatMap(r=>r.rows);
    const operations=[...new Set(allRows.map(r=>r.name))].map(name=>({name,...summarize(allRows.filter(r=>r.name===name))}))
      .sort((a,b)=>b.exclusiveCyclePercent-a.exclusiveCyclePercent);
    const familyRows=flarex.flatMap(root=>root.rows.flatMap(span=>{
      let ancestor:typeof span|undefined=span;
      while(ancestor!==undefined&&!['LogicalDocuments.readRelationalSelection','FiniteStorageCapture.run'].includes(ancestor.name))
        ancestor=ancestor.parent===null?undefined:root.rows[ancestor.parent];
      return ancestor===undefined?[]:[{family:ancestor.name,span}];
    }));
    const families=[...new Set(familyRows.map(r=>r.family))].map(family=>{
      const selected=familyRows.filter(r=>r.family===family);
      const buckets=[...new Set(selected.map(r=>r.span.name))].map(name=>({name,...summarize(selected.filter(r=>r.span.name===name).map(r=>r.span))}))
        .sort((a,b)=>b.exclusiveCyclePercent-a.exclusiveCyclePercent);
      return {family,exclusiveMs:sum(buckets.map(b=>b.exclusiveMs)),exclusiveCyclePercent:sum(buckets.map(b=>b.exclusiveCyclePercent)),buckets};
    });
    const candidateRows=flarex.flatMap(root=>root.rows.filter(span=>{
      const chain:string[]=[];let ancestor:typeof span|undefined=span;
      while(ancestor!==undefined){chain.push(ancestor.name);ancestor=ancestor.parent===null?undefined:root.rows[ancestor.parent];}
      return chain.includes('LogicalDocuments.readRelationalSelection')&&chain.includes('LogicalDocuments.withCandidateSelection')&&
        !chain.includes('FiniteStorageCapture.run');
    }));
    const candidateBuckets=[...new Set(candidateRows.map(r=>r.name))].map(name=>({name,...summarize(candidateRows.filter(r=>r.name===name))}))
      .sort((a,b)=>b.exclusiveCyclePercent-a.exclusiveCyclePercent);
    for(const root of flarex){
      assert.equal(root.rows.filter(r=>r.name==='PostgresPhysicalSession.implicitCommand').length,38);
      assert.equal(root.rows.filter(r=>r.name==='Candidate.cancellationClient').length,38);
    }
    reports.push({label,runId:raw.runId,sourceHash:raw.sources.before,readerSha256:ledger.readerSha256,
      instrumentation:ledger.before,probe,nativeMs:sum(roots.filter(r=>r.lane==='native').map(r=>r.cpuMs))/40,
      flarexMs:sum(flarex.map(r=>r.cpuMs))/40,operations,families,candidateSelection:{
        exclusiveMs:sum(candidateBuckets.map(b=>b.exclusiveMs)),exclusiveCyclePercent:sum(candidateBuckets.map(b=>b.exclusiveCyclePercent)),buckets:candidateBuckets},roots});
  }
  const first=reports[0];assert(first);
  for(const report of reports){assert.equal(report.sourceHash,first.sourceHash);assert.equal(report.readerSha256,first.readerSha256);
    assert.deepEqual(report.instrumentation,first.instrumentation);assert.deepEqual(report.probe.before,first.probe.before);
    assert.deepEqual(report.probe.sources,first.probe.sources);}
  await writeFile(resolve(import.meta.dirname,'candidate-costs.json'),JSON.stringify(reports,null,2));
  console.log(JSON.stringify(reports.map(({roots,probe,instrumentation,...r})=>({...r,replay:probe.blocks})),null,2));
});
