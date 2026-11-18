import { it, expect } from 'vitest';
import { Schema, Result } from 'effect';
import { readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { decodeRaw, validateCampaign, decodeOperations, partitionOperations, readRetainedJson } from './evidence';
import { transformRead } from './read-transform.mjs';
import { createReadProbe } from './read-observer';
const Hash=Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/));
const Sources=Schema.Array(Schema.Struct({file:Schema.String,sha256:Hash}));
const Nonnegative=Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0));
const Replays=Schema.Array(Schema.Struct({name:Schema.Literals(['prepareLogicalRelationalRead','compileAppOrderedIndexBoundsV1']),root:Schema.Natural,
  ordinals:Schema.Array(Schema.Natural),keys:Schema.Array(Schema.String),callsPerWorkflow:Schema.Natural,
  blocks:Schema.Array(Schema.Struct({iterations:Schema.Literal(2000),calls:Schema.Natural,threadMs:Nonnegative,elapsedMs:Nonnegative}))}));
const Facts=Schema.Struct({before:Sources,after:Sources,replays:Replays,sources:Schema.Array(Schema.Struct({file:Schema.String,sha256:Hash,
  sites:Schema.Array(Schema.Struct({name:Schema.String,site:Schema.String}))})),faults:Schema.Array(Schema.String),
  facts:Schema.Array(Schema.Struct({root:Schema.Natural,ordinal:Schema.Natural,name:Schema.String,site:Schema.String,
    identities:Schema.Array(Schema.String),key:Schema.String,elapsedMs:Schema.Finite.check(Schema.isGreaterThanOrEqualTo(0)),outcome:Schema.Literals(['returned','threw'])}))});
it('preserves call arguments and thrown identity in the diagnostic transform',()=>{
  const events:string[]=[],failure={failure:true};
  const call=(name:unknown,site:unknown,fn:(...args:unknown[])=>unknown,args:unknown[])=>{events.push('observe');return Reflect.apply(fn,undefined,args);};
  const source='function prepareLogicalRelationalRead(a,b){events.push("body");throw failure;} prepareLogicalRelationalRead((events.push("a"),1),(events.push("b"),2));';
  const transformed=transformRead(source,'/packages/example/src/reader.ts');assert(transformed);
  expect(()=>new Function('globalThis','events','failure',transformed)({__readCpu:{call,sources:[]}},events,failure)).toThrow();
  expect(events).toEqual(['a','b','observe','body']);
  try{new Function('globalThis','events','failure',transformed)({__readCpu:{call,sources:[]}},[],failure);}catch(cause){expect(cause).toBe(failure);}
});
it('real read observer preserves repeated Result failures and thrown identity',()=>{
  let next=0;
  const probe=createReadProbe(()=>({current:()=>({root:0,next:next++,inReadFamily:true}),sync:(_name,run)=>run()}));
  const refused=Result.fail({reason:'invalidInput'}),throws={defect:true};
  const original=()=>refused;
  expect(probe.call('prepareLogicalRelationalRead','witness',original,[])).toBe(refused);
  expect(probe.call('prepareLogicalRelationalRead','witness',original,[])).toBe(refused);
  expect(()=>probe.call('compileAppOrderedIndexBoundsV1','witness',()=>{throw throws;},[])).toThrow();
  try{probe.call('compileAppOrderedIndexBoundsV1','witness',()=>{throw throws;},[]);}catch(cause){expect(cause).toBe(throws);}
  expect(probe.replay).toHaveLength(0);expect(probe.faults).toEqual([]);
});
it('snapshot repetition keys use definition identity without traversing catalog dates',()=>{
  let next=0;const probe=createReadProbe(()=>({current:()=>({root:0,next:next++,inReadFamily:true}),sync:(_name,run)=>run()}));
  const definition={createdAt:new Date()},input={definition,scopeId:'s',snapshotCommitSeq:1n,bounds:{startInclusive:'00'},limit:10};
  const prepared=Result.succeed({}),run=(_input:typeof input)=>prepared;
  expect(probe.call('prepareAppIndexSnapshotReadResult','witness',run,[input])).toBe(prepared);
  expect(probe.call('prepareAppIndexSnapshotReadResult','witness',run,[{...input}])).toBe(prepared);
  expect(probe.facts[0]?.key).toBe(probe.facts[1]?.key);expect(probe.faults).toEqual([]);
  probe.call('prepareAppIndexSnapshotReadResult','witness',run,[{...input,definition:{createdAt:new Date()}}]);
  expect(probe.facts[2]?.key).not.toBe(probe.facts[0]?.key);
});

it('joins read repetition facts to strict original operation partitions',async()=>{
  const reports=[];
  for(const label of ['read-final-b','read-final-c']) {
    const directory=resolve(import.meta.dirname,label),files=await readdir(directory);
    const ids=[...new Set(files.filter(f=>/^[a-f0-9-]{36}\.json(?:\.gz)?$/.test(f)).map(f=>f.replace(/\.gz$/,'')))];assert.equal(ids.length,1);assert(ids[0]);
    const raw=decodeRaw(await readRetainedJson(resolve(directory,ids[0])));validateCampaign(raw,'control');
    assert.equal(raw.sources.before,raw.sources.after);assert.equal(raw.cleanup,'completed');assert.equal(raw.execution,'complete');
    assert(raw.gates.every(g=>g.passed)&&raw.samples.every(s=>s.outcome==='success'));
    const ledger=decodeOperations(await readRetainedJson(resolve(directory,'operations.json')));
    const facts=Schema.decodeUnknownSync(Facts)(await readRetainedJson(resolve(directory,'read-facts.json')));
    assert.deepEqual(ledger.before,ledger.after);assert.deepEqual(ledger.faults,[]);assert.deepEqual(facts.before,facts.after);assert.deepEqual(facts.faults,[]);
    const used=new Set<number>(), joined=new Set<string>();
    const roots=raw.samples.filter(s=>s.kind==='diagnostic').map(sample=>{
      const counter=sample.rootCounters;assert(counter?.callWindow&&counter.counters?.thread);
      const matches=ledger.roots.filter(r=>r.start.time>=counter.callWindow!.startMonotonicMs&&r.end!==null&&r.end.time<=counter.callWindow!.endMonotonicMs);
      assert.equal(matches.length,1);const root=matches[0];assert(root);assert(!used.has(root.ordinal));used.add(root.ordinal);
      const partition=partitionOperations(root), seen=new Set<string>();
      const entries=facts.facts.filter(f=>f.root===root.ordinal).sort((a,b)=>a.ordinal-b.ordinal).map(f=>{
        const span=partition.rows[f.ordinal];assert(span);assert.equal(span.name,'ReadSync.'+f.name);
        assert.equal(f.outcome,'returned');const id=root.ordinal+':'+f.ordinal;assert(!joined.has(id));joined.add(id);
        const ancestry:string[]=[];let parent=span.parent;while(parent!==null){const ancestor=partition.rows[parent];assert(ancestor);ancestry.push(ancestor.name);parent=ancestor.parent;}
        const inRead=ancestry.includes('LogicalDocuments.readRelationalSelection'),inCapture=ancestry.includes('FiniteStorageCapture.run');
        const key=f.name+'|'+f.key,repeated=(inRead||inCapture)&&seen.has(key);if(inRead||inCapture)seen.add(key);
        return {...f,...span,repeated,inRead,inCapture};
      });
      return {lane:sample.lane,index:sample.index,sdkCpuMs:(counter.counters.thread.user+counter.counters.thread.system)/1000,...partition,entries};
    });
    assert.equal(used.size,80);assert.equal(joined.size,facts.facts.length);
    const flarex=roots.filter(r=>r.lane==='flarex');assert.equal(flarex.length,40);
    const sum=(xs:number[])=>xs.reduce((s,n)=>s+n,0),totalCycles=sum(flarex.map(r=>r.total.cycles));
    const operations=[...new Set(flarex.flatMap(r=>r.rows.map(s=>s.name)))].map(name=>{
      const rows=flarex.flatMap(r=>r.rows.filter(s=>s.name===name));return {name,calls:rows.length/40,
        inclusiveMs:sum(rows.map(r=>r.inclusive.cpuMs))/40,exclusiveMs:sum(rows.map(r=>r.exclusive.cpuMs))/40,
        cyclesPercent:100*sum(rows.map(r=>r.exclusive.cycles))/totalCycles};
    }).sort((a,b)=>b.cyclesPercent-a.cyclesPercent);
    const familyRows=flarex.flatMap(root=>root.rows.flatMap(span=>{
      let selected:typeof span|undefined=span;
      while(selected!==undefined&&!['LogicalDocuments.readRelationalSelection','FiniteStorageCapture.run'].includes(selected.name))
        selected=selected.parent===null?undefined:root.rows[selected.parent];
      return selected===undefined?[]:[{family:selected.name,span}];
    }));
    const families=[...new Set(familyRows.map(r=>r.family))].map(family=>{
      const selected=familyRows.filter(r=>r.family===family);
      const buckets=[...new Set(selected.map(r=>r.span.name))].map(name=>{
        const rows=selected.filter(r=>r.span.name===name);
        return {name,exclusiveMs:sum(rows.map(r=>r.span.exclusive.cpuMs))/40,
          cyclesPercent:100*sum(rows.map(r=>r.span.exclusive.cycles))/totalCycles};
      }).sort((a,b)=>b.cyclesPercent-a.cyclesPercent);
      return {family,cpuMs:sum(buckets.map(b=>b.exclusiveMs)),cyclesPercent:sum(buckets.map(b=>b.cyclesPercent)),buckets};
    });
    const entries=flarex.flatMap(r=>r.entries).filter(e=>e.inRead||e.inCapture);
    assert.deepEqual(facts.replays.map(r=>r.name).sort(),['compileAppOrderedIndexBoundsV1','prepareLogicalRelationalRead']);
    for(const replay of facts.replays) {
      assert(replay.callsPerWorkflow>0);
      assert.equal(replay.blocks.length,5);assert.equal(replay.ordinals.length,replay.callsPerWorkflow);assert.equal(replay.keys.length,replay.callsPerWorkflow);
      assert.equal(new Set(replay.ordinals).size,replay.callsPerWorkflow);
      const chosen=entries.filter(e=>e.root===replay.root&&e.name==='ReadSync.'+replay.name&&e.repeated);
      assert.deepEqual(replay.ordinals,chosen.map(e=>e.ordinal));assert.deepEqual(replay.keys,chosen.map(e=>e.key));
      for(const block of replay.blocks)assert.equal(block.calls,block.iterations*replay.callsPerWorkflow);
    }
    const functions=[...new Set(entries.map(e=>e.name))].map(name=>{
      const calls=entries.filter(e=>e.name===name),repeat=calls.filter(e=>e.repeated);
      return {name,calls:calls.length/40,repeated:repeat.length/40,
        inclusiveMs:sum(calls.map(e=>e.inclusive.cpuMs))/40,exclusiveMs:sum(calls.map(e=>e.exclusive.cpuMs))/40,
        repeatedInclusiveMs:sum(repeat.map(e=>e.inclusive.cpuMs))/40,
        elapsedMs:sum(calls.map(e=>e.elapsedMs))/40,repeatedElapsedMs:sum(repeat.map(e=>e.elapsedMs))/40,
        cyclesPercent:100*sum(calls.map(e=>e.exclusive.cycles))/totalCycles,
        repeatedCyclesPercent:100*sum(repeat.map(e=>e.exclusive.cycles))/totalCycles};
    });
    reports.push({label,runId:raw.runId,sourceHash:raw.sources.before,instrumentation:facts.before,transforms:facts.sources,reader:ledger.readerSha256,
      nativeMs:sum(roots.filter(r=>r.lane==='native').map(r=>r.sdkCpuMs))/40,
      flarexMs:sum(flarex.map(r=>r.sdkCpuMs))/40,replays:facts.replays,families,operations,functions,roots});
  }
  const [a,b]=reports;assert(a&&b);assert.equal(a.sourceHash,b.sourceHash);assert.equal(a.reader,b.reader);
  assert.deepEqual(a.instrumentation,b.instrumentation);assert.deepEqual([...a.transforms].sort((a,b)=>a.file.localeCompare(b.file)),[...b.transforms].sort((a,b)=>a.file.localeCompare(b.file)));
  // Full structural keys remain in the source facts; do not duplicate their
  // escaped trees in every derived row of this aggregate report.
  const retained=reports.map(report=>({...report,roots:report.roots.map(root=>({...root,
    entries:root.entries.map(({key: _key,identities: _identities,...entry})=>entry)}))}));
  await writeFile(resolve(import.meta.dirname,'read-costs.json'),JSON.stringify(retained,null,2));
  console.log(JSON.stringify(reports.map(({roots,transforms,instrumentation,...rest})=>rest)));
});
