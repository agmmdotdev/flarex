import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const base = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const mean = a => a.reduce((s,v)=>s+v,0)/a.length;
const stats = a => { const b=[...a].sort((a,b)=>a-b); return {n:a.length,mean:mean(a),median:(b[Math.floor((b.length-1)/2)]+b[Math.floor(b.length/2)])/2,min:b[0],max:b.at(-1)}; };
const ranked = m => [...m].sort((a,b)=>b[1]-a[1]).map(([name,value])=>({name,value}));
const add = (m,key,n) => m.set(key,(m.get(key)??0)+n);
const retained = process.argv.slice(2);
const runs=[];
for (const directory of retained) {
  const files=fs.readdirSync(path.join(base,directory)).filter(file=>/^[a-f0-9-]{36}\.json$/.test(file));
  assert.equal(files.length,1,`${directory}: require exactly one raw report; select a fresh campaign directory`);
  const file=files[0];
  const raw=JSON.parse(fs.readFileSync(path.join(base,directory,file),'utf8'));
  assert.equal(raw.execution,'complete'); assert.equal(raw.cleanup,'completed');
  assert(raw.gates.every(g=>g.passed)); assert(raw.samples.every(s=>s.outcome==='success'));
  assert.equal(raw.sources.before,raw.sources.after);
  const samples=raw.samples.filter(s=>s.kind==='diagnostic');
  const cycleRows=samples.filter(s=>s.cycleEvidence?.observed);
  const categories=new Map(),sites=new Map(); let totalCycles=0;
  for(const sample of cycleRows){
    const e=sample.cycleEvidence; assert(e.complete);
    assert.equal(e.buckets.reduce((s,b)=>s+b.cycles,0),e.totalCycles);
    totalCycles+=e.totalCycles;
    for(const b of e.buckets){
      const category=b.site.startsWith('packages/') ? b.site.split('/').slice(0,2).join('/') : b.site;
      add(categories,category,b.cycles); add(sites,b.site,b.cycles);
    }
  }
  const rows=raw.cpuPairs.map(p=>({index:p.index,added:p.thread.addedTotalMicroseconds/1000,
    native:(p.thread.nativeUserMicroseconds+p.thread.nativeSystemMicroseconds)/1000,
    flarex:(p.thread.flarexUserMicroseconds+p.thread.flarexSystemMicroseconds)/1000,
    observed:raw.samples.find(s=>s.id===p.flarexRequestId).cycleEvidence?.observed??null}));
  const profiles={};
  for(const lane of ['native','flarex']){
    const groups=new Map(),contexts=new Map(),frames=new Map(),callers=new Map();
    let inside=0,boundary=0,outside=0,profileCount=0,gcMs=0;
    for(const sample of samples.filter(s=>s.lane===lane&&s.cpuAnalysis)){
      profileCount++; const a=sample.cpuAnalysis; assert(a.complete);
      inside+=a.definitelyInsideSamples; boundary+=a.boundaryAmbiguousSamples; outside+=a.outsideSamples;
      gcMs+=a.gc.summedRootOverlapMs??0;
      assert.equal(a.selfLocations.reduce((s,l)=>s+l.selfSamples,0),a.definitelyInsideSamples);
      for(const location of a.selfLocations){add(groups,location.category,location.selfSamples);add(contexts,location.executionContext+'/'+location.category,location.selfSamples);
        add(callers,location.category+'/'+(location.authoredCaller??'no authored caller'),location.selfSamples);}
      for(const frame of a.sampledFrames)if(frame.selfSamples)add(frames,frame.callFrame.url+':'+(frame.callFrame.lineNumber+1)+' '+frame.callFrame.functionName,frame.selfSamples);
    }
    if(profileCount)profiles[lane]={profileCount,inside,boundary,outside,gcOverlapMs:gcMs,categories:ranked(groups),contexts:ranked(contexts),frames:ranked(frames).slice(0,70),callers:ranked(callers).slice(0,70)};
  }
  const on=rows.filter(r=>r.observed),off=rows.filter(r=>r.observed===false);
  runs.push({directory,runId:raw.runId,mode:raw.mode,sources:raw.sources,gates:raw.gates,cleanup:raw.cleanup,
    addedCpu:stats(rows.map(r=>r.added)),nativeCpu:stats(rows.map(r=>r.native)),flarexCpu:stats(rows.map(r=>r.flarex)),
    ...(cycleRows.length?{cycles:{observedRoots:cycleRows.length,totalCycles,categories:ranked(categories),sites:ranked(sites).slice(0,60),
      onAddedCpu:stats(on.map(r=>r.added)),offAddedCpu:stats(off.map(r=>r.added)),onMinusOffAddedCpu:mean(on.map(r=>r.added))-mean(off.map(r=>r.added)),
      metadata:{...raw.cycleAttribution,sources:undefined,transformedFiles:raw.cycleAttribution.sources.length,transformedSites:raw.cycleAttribution.sources.reduce((n,s)=>n+s.sites.length,0)}}}:{}),
    profiles,rows});
}
fs.writeFileSync(path.join(base,'summary.json'),JSON.stringify({method:'Original SDK complete matched business graphs. Cycles are disjoint diagnostic CPU-cycle counts, not milliseconds or removable overhead. Profiles use conservatively admitted self samples, not elapsed weights. Observer assignment is balanced four-pair ABBA/BAAB. No outlier removal or observer subtraction.',runs},null,2));
console.log(JSON.stringify(runs.map(r=>({...r,rows:undefined,cycles:r.cycles?{...r.cycles,sites:r.cycles.sites.slice(0,12)}:undefined,
  profiles:Object.fromEntries(Object.entries(r.profiles).map(([k,p])=>[k,{...p,frames:p.frames.slice(0,18),callers:p.callers.slice(0,12)}]))})),null,2));
