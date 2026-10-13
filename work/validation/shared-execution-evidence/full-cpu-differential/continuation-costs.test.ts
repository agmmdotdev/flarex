import { it } from 'vitest';
import { Schema } from 'effect';
import { readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { CycleEvidenceSchema } from '../../../../packages/executor/test/performance/measurement/cycleAttribution';
import { decodeRaw, validateCampaign, decodeOperations, partitionOperations, readRetainedJson } from './evidence';
import type { ContinuationRecord } from './continuation-observer';
const Hash=Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Sources=Schema.Array(Schema.Struct({file:Schema.String,sha256:Hash}));
const Count=Schema.Number.check(Schema.isInt(),Schema.isBetween({minimum:0,maximum:Number.MAX_SAFE_INTEGER}));
const Decimal=Schema.String.check(Schema.isPattern(/^\d+$/));
const Record=Schema.Struct({root:Schema.Natural,ordinal:Schema.Natural,
  observed:Schema.Boolean,cycles:CycleEvidenceSchema,rawFirst:Decimal,rawLast:Decimal,gcCycles:Count,
  gcCollections:Count,probeCycles:Count,totalCycles:Count});
// The frozen captured probe keeps its trusted in-process DTO. Prove exact key
// and bidirectional value agreement with this authoritative serialized boundary.
type Same<A,B>=[A] extends [B]?([B] extends [A]?true:false):false;
const recordContract:Same<ContinuationRecord,typeof Record.Type>&Same<keyof ContinuationRecord,keyof typeof Record.Type>=true;
const Ledger=Schema.Struct({before:Sources,after:Sources,sources:Schema.Array(Schema.Struct({file:Schema.String,sha256:Hash,
  sites:Schema.Array(Schema.Struct({name:Schema.String,mode:Schema.String,line:Schema.Natural}))})),
  patches:Schema.Array(Schema.Struct({name:Schema.String,method:Schema.String})),order:Schema.Literals(['abba','baab']),
  mode:Schema.Literals(['plain','detailed']),records:Schema.Array(Record),faults:Schema.Array(Schema.String)});
const sum=(xs:readonly number[])=>xs.reduce((a,b)=>a+b,0);
const group=(site:string)=>site.startsWith('Driver.')?'driver':site.startsWith('Promise.')?'explicit-bridge':
  site.startsWith('VM.')?'promise-reactions-exclusive':site==='Effect.runLoop'?'effect-execution':site;
it('conserves raw command cycles into GC, measured observer body and remaining execution',async()=>{
  assert.equal(recordContract,true);
  const reports=[];
  for(const label of ['plain-a','detail-a','detail-b','plain-b']){
    const folder=resolve(import.meta.dirname,'continuation-'+label),files=await readdir(folder);
    const ids=[...new Set(files.filter(f=>/^[a-f0-9-]{36}\.json(?:\.gz)?$/.test(f)).map(f=>f.replace(/\.gz$/,'')))];
    assert.equal(ids.length,1);assert(ids[0]);const raw=decodeRaw(await readRetainedJson(resolve(folder,ids[0])));
    validateCampaign(raw,'control');assert.equal(raw.execution,'complete');assert.equal(raw.cleanup,'completed');
    assert.equal(raw.sources.before,raw.sources.after);assert(raw.gates.length&&raw.gates.every(g=>g.passed));
    assert(raw.samples.every(s=>s.outcome==='success'));
    const operations=decodeOperations(await readRetainedJson(resolve(folder,'operations.json')));
    const ledger=Schema.decodeUnknownSync(Ledger)(await readRetainedJson(resolve(folder,'launch-ledger.json')));
    assert.deepEqual(operations.before,operations.after);assert.deepEqual(operations.faults,[]);
    assert.deepEqual(ledger.before,ledger.after);assert.deepEqual(ledger.faults,[]);
    assert.equal(ledger.mode,label.startsWith('plain')?'plain':'detailed');
    assert.equal(ledger.order,label.endsWith('a')?'abba':'baab');assert.equal(ledger.patches.length,4);
    const used=new Set<number>(),commandsUsed=new Set<string>();
    const roots=raw.samples.filter(s=>s.kind==='diagnostic').map(s=>{
      const counters=s.rootCounters;assert(counters?.callWindow&&counters.counters?.thread);
      const matches=operations.roots.filter(r=>r.start.time>=counters.callWindow!.startMonotonicMs&&r.end!==null&&r.end.time<=counters.callWindow!.endMonotonicMs);
      assert.equal(matches.length,1);const root=matches[0];assert(root);assert(!used.has(root.ordinal));used.add(root.ordinal);
      const partition=partitionOperations(root),cpuMs=(counters.counters.thread.user+counters.counters.thread.system)/1000;
      const observed=ledger.mode==='detailed'&&([true,false,false,true][Math.floor(Math.floor(root.ordinal/2)/5)%4]!== (ledger.order==='baab'));
      const commands=ledger.records.filter(r=>r.root===root.ordinal),spans=partition.rows.filter(r=>r.name==='Launch.command');
      assert.equal(commands.length,s.lane==='flarex'?38:0);assert.equal(spans.length,commands.length);
      for(const c of commands){
        const key=root.ordinal+':'+c.ordinal;assert(!commandsUsed.has(key));commandsUsed.add(key);
        assert.equal(c.observed,observed);assert(c.cycles.complete&&c.cycles.totalCycles!==null);
        assert.equal(c.cycles.threadId,root.threadId);assert.equal(c.cycles.observed,observed);assert.deepEqual(c.cycles.failures,[]);
        assert.equal(Number(BigInt(c.rawLast)-BigInt(c.rawFirst)),c.totalCycles);
        assert.equal(c.cycles.totalCycles+c.gcCycles+c.probeCycles,c.totalCycles);
        const span=spans.find(r=>r.ordinal===c.ordinal);assert(span);assert(c.totalCycles<=span.inclusive.cycles);
        const interval=root.intervals[c.ordinal];assert(interval?.end);
        assert(BigInt(c.rawFirst)>=BigInt(interval.start.cycles)&&BigInt(c.rawLast)<=BigInt(interval.end.cycles));
        if(observed){
          for(const site of ['Driver.prepare','Driver.drizzleLaunch','Driver.pgLaunch','Driver.mapResult','Promise.bridgeStart','Promise.queryFence','Promise.resume'])
            assert.equal(c.cycles.buckets.find(b=>b.site===site)?.calls,1,site);
          for(const site of ['Promise.register','Promise.trackerSettle'])assert.equal(c.cycles.buckets.find(b=>b.site===site)?.calls,2,site);
          assert(c.cycles.buckets.some(b=>b.site.startsWith('VM.promiseReaction:')&&b.calls>0));
          const origins=[['Driver.drizzleLaunch',4],['Driver.pgLaunch',1],['Promise.register',2],['reaction-created',1],['Promise.bridgeStart',1]] as const;
          for(const [origin,count] of origins)assert.equal(c.cycles.buckets.find(b=>b.site==='VM.promiseReaction:'+origin)?.calls,count);
          assert.equal(sum(c.cycles.buckets.filter(b=>b.site.startsWith('VM.promiseReaction:')).map(b=>b.calls)),9);
        }else assert(c.cycles.buckets.every(b=>b.site==='outside-observed-execution'));
      }
      const buckets=commands.flatMap(c=>c.cycles.buckets),sites=[...new Set(buckets.map(b=>b.site))].map(site=>({site,
        cycles:sum(buckets.filter(b=>b.site===site).map(b=>b.cycles)),calls:sum(buckets.filter(b=>b.site===site).map(b=>b.calls))}));
      return {lane:s.lane,index:s.index,ordinal:root.ordinal,observed,cpuMs,commandCycles:sum(commands.map(c=>c.totalCycles)),
        gcCycles:sum(commands.map(c=>c.gcCycles)),gcCollections:sum(commands.map(c=>c.gcCollections)),
        probeCycles:sum(commands.map(c=>c.probeCycles)),sites};
    });
    assert.equal(used.size,80);assert.equal(operations.roots.length,80);assert.equal(commandsUsed.size,1520);assert.equal(ledger.records.length,1520);
    const states=[false,true].flatMap(observed=>{
      const selected=roots.filter(r=>r.lane==='flarex'&&r.observed===observed),native=roots.filter(r=>r.lane==='native'&&r.observed===observed);
      if(!selected.length)return [];const n=selected.length;assert.equal(n,ledger.mode==='plain'?40:20);assert.equal(native.length,n);
      const total=sum(selected.map(r=>r.commandCycles)),buckets=selected.flatMap(r=>r.sites);
      const sites=[...new Set(buckets.map(b=>b.site))].map(site=>({site,calls:sum(buckets.filter(b=>b.site===site).map(b=>b.calls))/n,
        cyclePercent:100*sum(buckets.filter(b=>b.site===site).map(b=>b.cycles))/total}));
      const groups=[...new Set(sites.map(s=>group(s.site)))].map(name=>({name,cyclePercent:sum(sites.filter(s=>group(s.site)===name).map(s=>s.cyclePercent))}));
      groups.push({name:'GC',cyclePercent:100*sum(selected.map(r=>r.gcCycles))/total},
        {name:'measured-probe-body',cyclePercent:100*sum(selected.map(r=>r.probeCycles))/total});
      assert(Math.abs(sum(groups.map(g=>g.cyclePercent))-100)<1e-8);
      return [{observed,n,flarexMs:sum(selected.map(r=>r.cpuMs))/n,nativeMs:sum(native.map(r=>r.cpuMs))/n,
        rawCommandCycles:total/n,gcCollections:sum(selected.map(r=>r.gcCollections)),groups,sites}];
    });
    reports.push({label,runId:raw.runId,sourceHash:raw.sources.before,probe:ledger.before,sources:ledger.sources,
      operations:operations.before,readerSha256:operations.readerSha256,states,roots});
  }
  const first=reports[0];assert(first);
  for(const report of reports){assert.equal(report.sourceHash,first.sourceHash);assert.equal(report.readerSha256,first.readerSha256);
    assert.deepEqual(report.probe,first.probe);assert.deepEqual(report.sources,first.sources);assert.deepEqual(report.operations,first.operations);}
  await writeFile(resolve(import.meta.dirname,'continuation-costs.json'),JSON.stringify(reports,null,2));
});
