import { it } from 'vitest';
import { Schema } from 'effect';
import { readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { CycleEvidenceSchema } from '../../../../packages/executor/test/performance/measurement/cycleAttribution';
import { decodeRaw, validateCampaign, decodeOperations, partitionOperations, readRetainedJson } from './evidence';
const Hash=Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Sources=Schema.Array(Schema.Struct({file:Schema.String,sha256:Hash}));
const Ledger=Schema.Struct({before:Sources,after:Sources,sources:Schema.Array(Schema.Struct({file:Schema.String,sha256:Hash,
  sites:Schema.Array(Schema.Struct({name:Schema.String,mode:Schema.String,line:Schema.Natural}))})),
  patches:Schema.Array(Schema.Struct({name:Schema.String,method:Schema.String})),order:Schema.Literals(['abba','baab']),
  records:Schema.Array(Schema.Struct({root:Schema.Natural,ordinal:Schema.Natural,observed:Schema.Boolean,
    cycles:CycleEvidenceSchema,cpuMicroseconds:CycleEvidenceSchema})),faults:Schema.Array(Schema.String),
  replay:Schema.Struct({root:Schema.Natural,callsPerWorkflow:Schema.Literal(38),blocks:Schema.Array(Schema.Struct({
    iterations:Schema.Literal(50000),calls:Schema.Literal(1900000),threadMs:Schema.Finite,elapsedMs:Schema.Finite}))})});
const sum=(values:readonly number[])=>values.reduce((a,b)=>a+b,0);
const group=(site:string)=>site.startsWith('Driver.')?'driver':site.startsWith('Promise.')?'explicit-promise-bridge':
  site==='Effect.runLoop'?'effect-run-loop-including-unobserved-command-code':'outside-observed-execution';
it('joins every launch to its SDK root and conserves separately labelled CPU and cycle partitions',async()=>{
  const reports=[];
  for(const label of ['abba','baab'] as const){
    const folder=resolve(import.meta.dirname,'launch-'+label),files=await readdir(folder);
    const ids=[...new Set(files.filter(f=>/^[a-f0-9-]{36}\.json(?:\.gz)?$/.test(f)).map(f=>f.replace(/\.gz$/,'')))];
    assert.equal(ids.length,1);assert(ids[0]);
    const raw=decodeRaw(await readRetainedJson(resolve(folder,ids[0])));validateCampaign(raw,'control');
    assert.equal(raw.execution,'complete');assert.equal(raw.cleanup,'completed');assert.equal(raw.sources.before,raw.sources.after);
    assert(raw.gates.length>0&&raw.gates.every(g=>g.passed)&&raw.samples.every(s=>s.outcome==='success'));
    const operations=decodeOperations(await readRetainedJson(resolve(folder,'operations.json')));
    const probe=Schema.decodeUnknownSync(Ledger)(await readRetainedJson(resolve(folder,'launch-ledger.json')));
    assert.deepEqual(operations.before,operations.after);assert.deepEqual(operations.faults,[]);
    assert.deepEqual(probe.before,probe.after);assert.deepEqual(probe.faults,[]);assert.equal(probe.order,label);
    assert.equal(probe.sources.length,2);assert.equal(probe.patches.length,5);
    assert.equal(probe.replay.blocks.length,5);assert(probe.replay.blocks.every(b=>b.threadMs>0&&b.elapsedMs>0));
    const used=new Set<number>(),usedCommands=new Set<string>();
    const roots=raw.samples.filter(s=>s.kind==='diagnostic').map(s=>{
      const counters=s.rootCounters;assert(counters?.callWindow&&counters.counters?.thread);
      const matches=operations.roots.filter(r=>r.start.time>=counters.callWindow!.startMonotonicMs&&r.end!==null&&r.end.time<=counters.callWindow!.endMonotonicMs);
      assert.equal(matches.length,1);const root=matches[0];assert(root);assert(!used.has(root.ordinal));used.add(root.ordinal);
      const partition=partitionOperations(root),cpuMs=(counters.counters.thread.user+counters.counters.thread.system)/1000;
      const observed=([true,false,false,true][Math.floor(Math.floor(root.ordinal/2)/5)%4]!== (label==='baab'));
      const commands=probe.records.filter(r=>r.root===root.ordinal);
      const spans=partition.rows.filter(r=>r.name==='Launch.command');
      assert.equal(commands.length,s.lane==='flarex'?38:0);assert.equal(commands.length,spans.length);
      for(const command of commands){
        const key=root.ordinal+':'+command.ordinal;assert(!usedCommands.has(key));usedCommands.add(key);
        assert.equal(command.observed,observed);
        const span=spans.find(r=>r.ordinal===command.ordinal);assert(span);
        for(const evidence of [command.cycles,command.cpuMicroseconds]){
          assert(evidence.complete&&evidence.totalCycles!==null);assert.deepEqual(evidence.failures,[]);
          assert.equal(evidence.observed,observed);assert.equal(evidence.threadId,root.threadId);
        }
        assert(command.cycles.totalCycles!==null&&command.cycles.totalCycles<=span.inclusive.cycles);
        assert(command.cpuMicroseconds.totalCycles!==null&&command.cpuMicroseconds.totalCycles/1000<=span.inclusive.cpuMs+1e-8);
        if(observed){
          for(const site of ['Driver.prepare','Driver.drizzleLaunch','Driver.pgLaunch','Driver.mapResult','Promise.bridgeStart','Promise.queryFence','Promise.resume'])
            assert.equal(command.cycles.buckets.find(b=>b.site===site)?.calls,1,site);
          for(const site of ['Promise.register','Promise.trackerSettle'])assert.equal(command.cycles.buckets.find(b=>b.site===site)?.calls,2,site);
          assert((command.cycles.buckets.find(b=>b.site==='Driver.pgReceive')?.calls??0)>=1);
        }else assert(command.cycles.buckets.every(b=>b.site==='outside-observed-execution'));
      }
      const names=[...new Set(commands.flatMap(c=>c.cycles.buckets.map(b=>b.site)))];
      const buckets=names.map(site=>({site,group:group(site),
        cycles:sum(commands.flatMap(c=>c.cycles.buckets.filter(b=>b.site===site).map(b=>b.cycles))),
        cpuMs:sum(commands.flatMap(c=>c.cpuMicroseconds.buckets.filter(b=>b.site===site).map(b=>b.cycles)))/1000,
        calls:sum(commands.flatMap(c=>c.cycles.buckets.filter(b=>b.site===site).map(b=>b.calls)))}));
      const commandMs=sum(commands.map(c=>c.cpuMicroseconds.totalCycles??0))/1000;
      const commandCycles=sum(commands.map(c=>c.cycles.totalCycles??0));
      assert(Math.abs(sum(buckets.map(b=>b.cpuMs))-commandMs)<1e-8);assert.equal(sum(buckets.map(b=>b.cycles)),commandCycles);
      assert(cpuMs>=partition.total.cpuMs);
      return {lane:s.lane,index:s.index,ordinal:root.ordinal,observed,cpuMs,commandMs,commandCycles,
        boundaryMs:sum(spans.map(s=>s.inclusive.cpuMs))-commandMs,buckets};
    });
    assert.equal(used.size,80);assert.equal(operations.roots.length,80);assert.equal(usedCommands.size,1520);assert.equal(probe.records.length,1520);
    const states=[false,true].map(observed=>{
      const flarex=roots.filter(r=>r.lane==='flarex'&&r.observed===observed),native=roots.filter(r=>r.lane==='native'&&r.observed===observed);
      assert.equal(flarex.length,20);assert.equal(native.length,20);
      const totalCycles=sum(flarex.map(r=>r.commandCycles)),buckets=flarex.flatMap(r=>r.buckets);
      const sites=[...new Set(buckets.map(b=>b.site))].map(site=>{
        const selected=buckets.filter(b=>b.site===site);return {site,group:group(site),calls:sum(selected.map(b=>b.calls))/20,
          cpuMs:sum(selected.map(b=>b.cpuMs))/20,cyclePercent:100*sum(selected.map(b=>b.cycles))/totalCycles};
      });
      const groups=[...new Set(sites.map(s=>s.group))].map(group=>({group,cpuMs:sum(sites.filter(s=>s.group===group).map(s=>s.cpuMs)),
        cyclePercent:sum(sites.filter(s=>s.group===group).map(s=>s.cyclePercent))}));
      return {observed,flarexMs:sum(flarex.map(r=>r.cpuMs))/20,nativeMs:sum(native.map(r=>r.cpuMs))/20,
        commandMs:sum(flarex.map(r=>r.commandMs))/20,boundaryMs:sum(flarex.map(r=>r.boundaryMs))/20,groups,sites};
    });
    reports.push({label,runId:raw.runId,sourceHash:raw.sources.before,readerSha256:operations.readerSha256,
      interpretation:{cyclePartitions:'Observed execution ownership, including probe overhead; not converted to milliseconds.',
        fineCpuPartitions:'Retained for audit but rejected for leaf attribution: coarse Windows thread-time updates charge active work to adjacent edges.',
        replay:'Warm preparation construction only; not an end-to-end saving or a bound on cold execution.'},
      instrumentation:operations.before,probe:{before:probe.before,sources:probe.sources,patches:probe.patches,replay:probe.replay},states,roots});
  }
  const first=reports[0];assert(first);
  for(const report of reports){assert.equal(report.sourceHash,first.sourceHash);assert.equal(report.readerSha256,first.readerSha256);
    assert.deepEqual(report.instrumentation,first.instrumentation);assert.deepEqual(report.probe.before,first.probe.before);
    assert.deepEqual(report.probe.sources,first.probe.sources);assert.deepEqual(report.probe.patches,first.probe.patches);}
  await writeFile(resolve(import.meta.dirname,'launch-costs.json'),JSON.stringify(reports,null,2));
  console.log(JSON.stringify(reports.map(({roots,instrumentation,probe,...r})=>({...r,replay:probe.replay.blocks})),null,2));
});
