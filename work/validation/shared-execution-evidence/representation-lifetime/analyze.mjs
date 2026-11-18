import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { decodeArtifact } from './evidence.ts';
import { decodeAnalysisRaw } from './analysisEvidence.ts';
const directory=dirname(fileURLToPath(import.meta.url));
const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
const stats=xs=>{const sorted=[...xs].sort((a,b)=>a-b);return {count:xs.length,mean:mean(xs),median:(sorted[Math.floor((xs.length-1)/2)]+sorted[Math.ceil((xs.length-1)/2)])/2,min:sorted[0],max:sorted.at(-1)};};
const roots=[],processes=[];
for(const label of ['a','b']) {
  const manifest=decodeArtifact(JSON.parse(gunzipSync(await readFile(resolve(directory,label,'representations.json.gz'))).toString('utf8')));
  assert.deepEqual(manifest.observerSources,manifest.observerSourcesAfter);
  assert.equal(typeof manifest.rawPath,'string');assert.equal(manifest.reverse,label==='b');
  const raw=decodeAnalysisRaw(JSON.parse(await readFile(resolve(directory,label,win32.basename(manifest.rawPath)),'utf8')));
  assert.equal(raw.execution,'complete');assert.equal(raw.cleanup,'completed');assert.equal(raw.cpuPairs.length,32);
  assert(raw.gates.every(g=>g.passed));assert(raw.samples.every(s=>s.outcome==='success'));
  const enabled=new Map(manifest.requests.map(r=>[r.id,r.enabled]));
  const pairs=raw.cpuPairs.map(p=>({...p,enabled:enabled.get(p.flarexRequestId)}));
  assert(pairs.every(p=>typeof p.enabled==='boolean'&&p.thread!==null));
  assert.equal(pairs.filter(p=>p.enabled).length,16);
  assert.deepEqual(pairs.map(p=>p.index),Array.from({length:32},(_,i)=>i+5));
  for(const p of pairs){const slot=(p.index-5)%4;assert.equal(p.enabled,(slot===0||slot===3)!==manifest.reverse);}
  for(const r of manifest.requests) {
    assert.deepEqual(r.faults,[]);assert(r.cycles.complete);
    assert.equal(r.cycles.buckets.reduce((a,b)=>a+b.cycles,0),r.cycles.totalCycles);
    if(r.enabled)roots.push({...r,label});
  }
  processes.push({label,runId:raw.runId,pairs,observerSources:manifest.observerSources,sources:manifest.sources,readerHash:manifest.readerHash});
}
assert.deepEqual(processes[0].observerSources,processes[1].observerSources);
assert.equal(processes[0].readerHash,processes[1].readerHash);
assert.deepEqual(processes[0].sources,processes[1].sources);
const bySite={};
for(const site of new Set(roots.flatMap(r=>r.edges.map(e=>e.site)))) {
  const counts=roots.map(r=>r.edges.filter(e=>e.site===site).length);
  const cycles=roots.map(r=>r.cycles.buckets.filter(b=>b.site.endsWith('|'+site)).reduce((s,b)=>s+b.cycles,0));
  const firstKinds={};
  for(const kind of new Set(roots.flatMap(r=>r.edges.filter(e=>e.site===site).map(e=>e.inputs[0]?.kind??'none')))) {
    const calls=[],distinctInputs=[],distinctTuples=[];
    for(const r of roots){const rows=r.edges.filter(e=>e.site===site&&(e.inputs[0]?.kind??'none')===kind);calls.push(rows.length);distinctInputs.push(new Set(rows.map(e=>JSON.stringify(e.inputs[0]))).size);distinctTuples.push(new Set(rows.map(e=>JSON.stringify(e.inputs))).size);}
    firstKinds[kind]={calls:stats(calls),distinctInputs:stats(distinctInputs),distinctTuples:stats(distinctTuples)};
  }
  bySite[site]={counts:stats(counts),exclusiveCycles:stats(cycles),meanRootCyclePercent:mean(cycles.map((c,i)=>100*c/roots[i].cycles.totalCycles)),firstKinds};
}
const encoders=roots.map(r=>r.edges.filter(e=>e.site.endsWith(':encodeCanonicalJson')));
const callers={};
for(const caller of new Set(encoders.flatMap(es=>es.map(e=>e.caller??'unlabelled')))){
  const selected=encoders.map(es=>es.filter(e=>(e.caller??'unlabelled')===caller));
  callers[caller]={calls:stats(selected.map(es=>es.length)),distinctOutputTexts:stats(selected.map(es=>new Set(es.map(e=>JSON.stringify(e.output))).size)),
    outputCharacters:stats(selected.map(es=>es.reduce((s,e)=>s+(e.output?.length??0),0))),
    phases:[...new Set(selected.flatMap(es=>es.map(e=>e.phase)))]};
}
const cyclesByPhase={};
for(const phase of new Set(roots.flatMap(r=>r.edges.map(e=>e.phase))))cyclesByPhase[phase]={
  percent:stats(roots.map(r=>100*r.cycles.buckets.filter(b=>b.site.startsWith(phase+'|')).reduce((s,b)=>s+b.cycles,0)/r.cycles.totalCycles))};
const partitions={};
for(const site of ['observer-bookkeeping','outside-observed-execution'])partitions[site]=stats(roots.map(r=>100*r.cycles.buckets.filter(b=>b.site===site).reduce((s,b)=>s+b.cycles,0)/r.cycles.totalCycles));
const counters={};
for(const counter of ['thread','process']) {
  const pairs=processes.flatMap(p=>p.pairs);
  const added=p=>p[counter].addedTotalMicroseconds/1000;
  const blocks=processes.map(p=>{
    const groups=new Map();for(const pair of p.pairs){const id=Math.floor((pair.index-5)/4);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(pair);}
    return [...groups.values()].map(g=>{assert.equal(g.length,4);assert.equal(g.filter(p=>p.enabled).length,2);return mean(g.filter(p=>p.enabled).map(added))-mean(g.filter(p=>!p.enabled).map(added));});
  });
  counters[counter]={observedAddedMs:stats(pairs.filter(p=>p.enabled).map(added)),disabledAddedMs:stats(pairs.filter(p=>!p.enabled).map(added)),incrementalObserverMs:stats(blocks.flat()),blocks};
}
const summary={scope:'Diagnostic transformed run, not production CPU or removable savings',pairs:64,observedRoots:roots.length,
  processes:processes.map(({pairs,...rest})=>rest),counters,partitions,cyclesByPhase,bySite,callers,
  encoding:{calls:stats(encoders.map(es=>es.length)),distinctInputs:stats(encoders.map(es=>new Set(es.map(e=>JSON.stringify(e.inputs[0]))).size)),distinctOutputTexts:stats(encoders.map(es=>new Set(es.map(e=>JSON.stringify(e.output))).size))},
  roots:roots.map(r=>({id:r.id,label:r.label,edges:r.edges.length,identities:r.identities,totalCycles:r.cycles.totalCycles}))};
await writeFile(resolve(directory,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify({counters,partitions,cyclesByPhase,encoding:summary.encoding,topSites:Object.entries(bySite).sort((a,b)=>b[1].meanRootCyclePercent-a[1].meanRootCyclePercent).slice(0,15).map(([site,s])=>({site,calls:s.counts.mean,percent:s.meanRootCyclePercent})),callers},null,2));
