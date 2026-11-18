import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
const base=path.dirname(fileURLToPath(import.meta.url));
const summary=JSON.parse(fs.readFileSync(path.join(base,'summary.json'),'utf8'));
const runs=summary.runs;
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const add=(m,k,n)=>m.set(k,(m.get(k)??0)+n);
const ranked=(m,total)=>[...m].sort((a,b)=>b[1]-a[1]).map(([name,value])=>({name,value,percent:100*value/total}));
let seed=137;
const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
function bootstrap(strata){
  const values=Array.from({length:20000},()=>mean(strata.flatMap(s=>Array.from({length:s.length},()=>s[Math.floor(random()*s.length)])))).sort((a,b)=>a-b);
  return [values[499],values[19499]];
}
const blockDifferences=r=>{
  assert(r.rows.length>0&&r.rows.length%4===0,'Observer bootstrap requires complete four-pair blocks');
  return Array.from({length:r.rows.length/4},(_,i)=>{
  const b=r.rows.slice(i*4,i*4+4);return mean(b.filter(x=>x.observed).map(x=>x.added))-mean(b.filter(x=>!x.observed).map(x=>x.added));
  });
};
const cycles=runs.filter(r=>r.cycles?.metadata.detail==='generators');
const cycleCategories=new Map(),cycleSites=new Map();let totalCycles=0,bodyCalls=0,engineCalls=0,observedRoots=0;
const profileCategories=new Map(),profileFrames=new Map(),specialCallers=new Map();let nonIdle=0,inside=0,boundary=0,outside=0,nativeInside=0,nativeBoundary=0,nativeOutside=0;
for(const r of runs){
  const raw=JSON.parse(fs.readFileSync(path.join(base,r.directory,r.runId+'.json'),'utf8'));
  for(const s of raw.samples.filter(s=>s.kind==='diagnostic')){
    if(r.cycles?.metadata.detail==='generators'&&s.cycleEvidence?.observed){
      observedRoots++;totalCycles+=s.cycleEvidence.totalCycles;
      for(const b of s.cycleEvidence.buckets){add(cycleSites,b.site,b.cycles);add(cycleCategories,b.site.startsWith('packages/')?b.site.split('/').slice(0,2).join('/'):b.site,b.cycles);
        if(b.site.startsWith('packages/'))bodyCalls+=b.calls;else if(b.site.startsWith('effect-engine'))engineCalls+=b.calls;}
    }
    const a=s.cpuAnalysis;if(!a)continue;
    if(s.lane==='native'){nativeInside+=a.definitelyInsideSamples;nativeBoundary+=a.boundaryAmbiguousSamples;nativeOutside+=a.outsideSamples;continue;}
    inside+=a.definitelyInsideSamples;boundary+=a.boundaryAmbiguousSamples;outside+=a.outsideSamples;
    for(const l of a.selfLocations){add(profileCategories,l.category,l.selfSamples);if(l.category!=='idle')nonIdle+=l.selfSamples;}
    const nodes=s.cpuEvidence.cpuProfile.nodes,parents=new Map(),byId=new Map(nodes.map(n=>[n.id,n]));
    for(const n of nodes)for(const c of n.children)parents.set(c,n.id);
    for(const f of a.sampledFrames){if(!f.selfSamples)continue;
      const location=f.callFrame.url+':'+(f.callFrame.lineNumber+1)+' '+f.callFrame.functionName;add(profileFrames,location,f.selfSamples);
      if(f.callFrame.functionName==='structuredClone'||f.callFrame.url.endsWith('/privateJsonData.ts')||f.callFrame.url.endsWith('/internal/effect.js')&&f.callFrame.lineNumber===853){
        const callers=[];for(let id=parents.get(f.nodeId);id!==undefined;id=parents.get(id)){const frame=byId.get(id).callFrame;
          if(frame.url.includes('/packages/')&&frame.url.includes('/src/'))callers.push(frame.url+':'+(frame.lineNumber+1)+' '+frame.functionName);if(callers.length===3)break;}
        add(specialCallers,location+' <- '+(callers.join(' <- ')||'no authored caller'),f.selfSamples);
      }
    }
  }
}
const controls=runs.filter(r=>r.mode==='root-counters'&&!r.cycles);
assert.equal(controls.length,1,'Select exactly one untransformed control cohort');
assert(observedRoots>0&&nonIdle>0,'Generator and CPU profile cohorts are required');
const control=controls[0];
assert(control.rows.length>0&&control.rows.length%4===0,'Control bootstrap requires complete four-pair blocks');
const controlBlocks=Array.from({length:control.rows.length/4},(_,i)=>mean(control.rows.slice(i*4,i*4+4).map(r=>r.added)));
const details={
  method:'20,000-draw stratified four-pair block bootstrap, seed 137; retained original samples, no outlier removal. Categories use disjoint conservatively admitted self samples. Percentages are not owner CPU milliseconds or savings.',
  control:{meanAddedCpu:control.addedCpu.mean,mean95IntervalMs:bootstrap([controlBlocks])},
  observer: runs.filter(r=>r.cycles).map(r=>({run:r.directory,onMinusOffMs:r.cycles.onMinusOffAddedCpu,interval95Ms:bootstrap([blockDifferences(r)])})),
  generatorObserver:{onMinusOffMs:mean(cycles.flatMap(blockDifferences)),interval95Ms:bootstrap(cycles.map(blockDifferences))},
  cyclePartition:{observedRoots,totalCycles,bodyCalls,engineCalls,bodyCallsPerRoot:bodyCalls/observedRoots,engineCallsPerRoot:engineCalls/observedRoots,categories:ranked(cycleCategories,totalCycles),sites:ranked(cycleSites,totalCycles).slice(0,60)},
  profiles:{inside,boundary,outside,nonIdle,idle:profileCategories.get('idle')??0,nativeInside,nativeBoundary,nativeOutside,categories:ranked(new Map([...profileCategories].filter(([name])=>name!=='idle')),nonIdle),frames:ranked(new Map([...profileFrames].filter(([name])=>!name.endsWith(' (idle)'))),nonIdle).slice(0,100),specialCallers:ranked(specialCallers,nonIdle).slice(0,70)}
};
fs.writeFileSync(path.join(base,'details.json'),JSON.stringify(details,null,2));
console.log(JSON.stringify({...details,cyclePartition:{...details.cyclePartition,sites:details.cyclePartition.sites.slice(0,12)},profiles:{...details.profiles,frames:details.profiles.frames.slice(0,25),specialCallers:details.profiles.specialCallers.slice(0,24)}},null,2));
