import { readFile, writeFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { decodeRaw, decodeMarkers, decodeOperations, partitionOperations, readRetainedJson, validateCampaign } from './evidence.ts';
import { analyzeCpuEvidence } from '../../../../packages/executor/test/performance/measurement/cpu.ts';
const directory=dirname(fileURLToPath(import.meta.url));
const operationMode=process.env.FLAREX_PROFILE_OPERATION_CORRELATION==='on';
const timestampToleranceMs=Number(process.env.FLAREX_PROFILE_TIMESTAMP_TOLERANCE_MS??0.4);
assert(Number.isFinite(timestampToleranceMs)&&timestampToleranceMs>=0.4&&timestampToleranceMs<=2);
const mean=xs=>xs.reduce((s,n)=>s+n,0)/xs.length;
const stats=xs=>{assert(xs.length);const sorted=[...xs].sort((a,b)=>a-b);return {n:xs.length,mean:mean(xs),median:(sorted[Math.floor((xs.length-1)/2)]+sorted[Math.ceil((xs.length-1)/2)])/2,min:sorted[0],max:sorted.at(-1)};};
const add=(map,key,n=1)=>map.set(key,(map.get(key)??0)+n);
const category=f=>f.functionName==='(idle)'?'idle':f.functionName==='(garbage collector)'?'gc':f.functionName==='(program)'?'program-unattributed':
  f.url.includes('/effect/')?f.url.endsWith('/internal/effect.js')||f.url.endsWith('/internal/core.js')?'effect-runtime':/Schema|schema/.test(f.url)?'schema':'effect-data-and-other':
  f.url.includes('/measurement/')?'measurement':f.url.includes('/packages/persistence-postgres/src/')?'persistence':
  f.url.includes('/packages/flarex-protocol/src/')?'protocol':f.url.includes('/drizzle-orm/')?'sql-builder':
  /\/pg(?:-protocol|-pool)?\//.test(f.url)?'postgres-driver':f.url.includes('medusa')?'medusa':f.url.includes('payload')?'payload':
  f.url.startsWith('node:')?'node':f.url.includes('/packages/')?'other-authored':'unknown';
const location=f=>`${f.url}:${f.lineNumber+1}:${f.columnNumber+1} ${f.functionName}`;
const runs=[], profiles=[];
let operationSources;
for(const label of ['profile-a','control','profile-b']) {
  const folder=operationMode?(label==='control'?'owned-pipeline-baseline-a':'operation-'+label):label;
  const files=(await readdir(resolve(directory,folder))).filter(f=>/^[a-f0-9-]{36}\.json(?:\.gz)?$/.test(f));
  const originals=[...new Set(files.map(f=>f.replace(/\.gz$/,'')))];assert.equal(originals.length,1);
  const file=files.includes(originals[0]+'.gz')?originals[0]+'.gz':originals[0];
  const bytes=await readFile(resolve(directory,folder,file));
  const raw=decodeRaw(JSON.parse((file.endsWith('.gz')?gunzipSync(bytes):bytes).toString('utf8')));
  validateCampaign(raw,label);
  assert.equal(raw.execution,'complete');assert.equal(raw.cleanup,'completed');assert.equal(raw.cpuPairs.length,40);
  assert(raw.gates.length>0&&raw.gates.every(g=>g.passed));assert(raw.samples.every(s=>s.outcome==='success'));assert.equal(raw.sources.before,raw.sources.after);
  const diagnostic=raw.samples.filter(s=>s.kind==='diagnostic');assert.equal(diagnostic.length,80);
  for(const sample of diagnostic)assert(sample.rootCounters?.complete&&sample.rootCounters.counters?.thread!==null);
  runs.push({label,runId:raw.runId,sources:raw.sources,pairs:raw.cpuPairs,thread:stats(raw.cpuPairs.map(p=>p.thread.addedTotalMicroseconds/1000)),
    native:stats(raw.cpuPairs.map(p=>(p.thread.nativeUserMicroseconds+p.thread.nativeSystemMicroseconds)/1000)),flarex:stats(raw.cpuPairs.map(p=>(p.thread.flarexUserMicroseconds+p.thread.flarexSystemMicroseconds)/1000))});
  if(label==='control'){assert(diagnostic.every(s=>s.cpuEvidence===undefined));continue;}
  const ledger=decodeMarkers(await readRetainedJson(resolve(directory,folder,'markers.json')));assert.deepEqual(ledger.before,ledger.after);assert.equal(ledger.markers.length,160);
  const operationLedger=operationMode?decodeOperations(await readRetainedJson(resolve(directory,folder,'operations.json'))):null;
  if(operationLedger){assert.deepEqual(operationLedger.before,operationLedger.after);assert.deepEqual(operationLedger.faults,[]);assert.equal(operationLedger.roots.length,80);}
  if(operationLedger)for(const root of operationLedger.roots)partitionOperations(root);
  if(operationLedger){if(operationSources===undefined)operationSources=operationLedger.before;else assert.deepEqual(operationLedger.before,operationSources,'Operation instrumentation changed between profile processes');}
  const prepared=[];let sharedLow=-Infinity,sharedHigh=Infinity;
  for(const [i,s] of diagnostic.entries()) {
    const e=s.cpuEvidence;assert(e?.complete&&e.cpuProfile?.samples&&e.cpuProfile.timeDeltas&&e.callWindow&&e.cpuStartCommand&&e.cpuStopCommand);
    assert.equal(e.allocationSampling,'disabled');assert.deepEqual(e.failures,[]);
    assert.equal(e.cpuIntervalMicroseconds,1000);
    const root=s.rootCounters.callWindow;assert(root);
    const p=e.cpuProfile, nodes=new Map(p.nodes.map(n=>[n.id,n])),parents=new Map(p.nodes.flatMap(n=>n.children.map(c=>[c,n.id])));
    const stack=id=>{const out=[];while(id!==undefined){const n=nodes.get(id);assert(n);out.push(n.callFrame);id=parents.get(id);}return out;};
    let stamp=p.startTime/1000;
    const points=p.samples.map((id,j)=>{const previous=stamp;stamp+=p.timeDeltas[j]/1000;return{id,previous,stamp,chain:stack(id)};});
    let low=Math.max(e.cpuStartCommand.startMonotonicMs-p.startTime/1000,e.cpuStopCommand.startMonotonicMs-p.endTime/1000);
    let high=Math.min(e.cpuStartCommand.endMonotonicMs-p.startTime/1000,e.cpuStopCommand.endMonotonicMs-p.endTime/1000);
    const initialUncertainty=high-low, calibration=[];
    for(const [offset,name] of ['clockMarkerA','clockMarkerB'].entries()){
      const marker=ledger.markers[2*i+offset];assert.equal(marker.name,name);assert(marker.start<=marker.end);
      if(offset===0)assert(marker.end<=root.startMonotonicMs);else assert(marker.start>=root.endMonotonicMs);
      const observed=points.filter(x=>x.chain.some(f=>f.functionName===name));
      // V8 need not retain the landmark frame in every capture. Reuse the
      // existing probe's constant-offset fit across this process, never across
      // processes. Missing landmarks remain visible in calibration metadata.
      if(observed.length===0){calibration.push({name,samples:0});continue;}
      // Same +/-0.4 ms timestamp tolerance as the existing landmark analyzer.
      const l=marker.start-observed[0].stamp-timestampToleranceMs,h=marker.end-observed.at(-1).stamp+timestampToleranceMs;
      low=Math.max(low,l);high=Math.min(high,h);calibration.push({name,samples:observed.length,low:l,high:h});
    }
    assert(low<=high,'Clock landmarks disagree');
    sharedLow=Math.max(sharedLow,low);sharedHigh=Math.min(sharedHigh,high);
    prepared.push({s,e,root,points,initialUncertainty,calibration});
  }
  assert(sharedLow<=sharedHigh,'Process clock landmarks disagree');
  assert(prepared.flatMap(p=>p.calibration).filter(c=>c.samples>0).length>=4,'Too few process clock landmarks');
  for(const {s,e,root,points,initialUncertainty,calibration} of prepared){
    const low=sharedLow,high=sharedHigh;
    const groups=new Map(),frames=new Map(),callers=new Map(),modules=new Map(),contexts=new Map();let boundary=0,outside=0,inside=0;
    const operation=operationLedger?.roots.filter(r=>r.start.time>=root.startMonotonicMs&&r.end?.time<=root.endMonotonicMs);
    if(operationLedger)assert.equal(operation.length,1,'Unique original root join');
    const intervals=operation?.[0]?.intervals??[];
    const phaseSamples=new Map(),phaseCategories=new Map(),stacks=new Map(),coarsePhases=new Map(),coarseCategories=new Map(),businessPhases=new Map(),businessCategories=new Map(),businessFrames=new Map();
    for(const point of points){
      if(point.stamp+high<root.startMonotonicMs||point.stamp+low>root.endMonotonicMs){outside++;continue;}
      if(point.previous+low<root.startMonotonicMs||point.stamp+high>root.endMonotonicMs){boundary++;continue;}
      inside++;
      assert(!point.chain.some(f=>f.functionName==='clockMarkerA'||f.functionName==='clockMarkerB'),'Clock landmark entered business window');
      const f=point.chain[0],cat=category(f);add(groups,cat);add(frames,location(f));add(modules,cat+'|'+f.url);
      const authored=point.chain.filter(f=>f.url.includes('/packages/')&&f.url.includes('/src/'));
      const nearest=authored.slice(0,3).map(location).join(' <- ')||'no authored caller';add(callers,cat+'|'+nearest);
      const runner=point.chain.some(f=>f.functionName==='runLoop'&&f.url.endsWith('/internal/effect.js'));add(contexts,cat+'|'+(runner?'inside-runner':'outside-runner'));
      if(operationMode){
        const coarse=intervals.filter(p=>p.parent===null);
        const coarseOverlaps=coarse.filter(p=>point.stamp+high>=p.start.time&&point.previous+low<=p.end.time);
        const coarseWithin=coarseOverlaps.filter(p=>point.previous+low>=p.start.time&&point.stamp+high<=p.end.time);
        const coarseName=coarseOverlaps.length!==coarseWithin.length?'operation-boundary':coarseWithin[0]?.name??'outside-named-operations';
        const runtime=coarse.find(p=>p.name==='portable runtime execution');
        const business=intervals.filter(p=>p.parent===null&&p!==runtime||runtime&&p.parent===runtime.ordinal);
        const businessOverlaps=business.filter(p=>point.stamp+high>=p.start.time&&point.previous+low<=p.end.time);
        const businessWithin=businessOverlaps.filter(p=>point.previous+low>=p.start.time&&point.stamp+high<=p.end.time);
        const businessName=businessOverlaps.length!==businessWithin.length?'operation-boundary':businessWithin[0]?.name??coarseName;
        const overlapping=intervals.filter(p=>point.stamp+high>=p.start.time&&point.previous+low<=p.end.time);
        const within=overlapping.filter(p=>point.previous+low>=p.start.time&&point.stamp+high<=p.end.time);
        const selected=within.sort((a,b)=>b.start.time-a.start.time)[0];
        const phase=overlapping.length!==within.length?'operation-boundary':selected?.name??'outside-named-operations';
        if(cat!=='idle'){add(phaseSamples,phase);add(phaseCategories,phase+'|'+cat);add(stacks,phase+'|'+point.chain.map(location).join(' <- '));add(coarsePhases,coarseName);add(coarseCategories,coarseName+'|'+cat);}
        if(cat!=='idle'){add(businessPhases,businessName);add(businessCategories,businessName+'|'+cat);add(businessFrames,businessName+'|'+location(f));}
      }
    }
    assert.equal([...groups.values()].reduce((a,b)=>a+b,0),inside);
    const active=inside-(groups.get('idle')??0);assert(active>0,'No active samples for native comparison');
    const cpu=(s.rootCounters.counters.thread.user+s.rootCounters.counters.thread.system)/1000;
    const original=analyzeCpuEvidence(e,root);
    profiles.push({label,id:s.id,lane:s.lane,index:s.index,cpuMs:cpu,callMs:root.endMonotonicMs-root.startMonotonicMs,
      alignment:{initialUncertaintyMs:initialUncertainty,uncertaintyMs:high-low,low,high,calibration},inside,boundary,outside,active,
      previousAdmission:original.definitelyInsideSamples,groups:Object.fromEntries(groups),frames:Object.fromEntries(frames),callers:Object.fromEntries(callers),modules:Object.fromEntries(modules),contexts:Object.fromEntries(contexts),
      gcOverlapMs:e.gc.events.reduce((sum,g)=>sum+Math.max(0,Math.min(root.endMonotonicMs,g.startMonotonicMs+g.durationMs)-Math.max(root.startMonotonicMs,g.startMonotonicMs)),0),
      estimates:Object.fromEntries([...groups].filter(([cat])=>cat!=='idle').map(([cat,n])=>[cat,cpu*n/active])),
      ...(operationMode?{operation:operation[0],phaseSamples:Object.fromEntries(phaseSamples),phaseCategories:Object.fromEntries(phaseCategories),stacks:Object.fromEntries(stacks),coarsePhases:Object.fromEntries(coarsePhases),coarseCategories:Object.fromEntries(coarseCategories),businessPhases:Object.fromEntries(businessPhases),businessCategories:Object.fromEntries(businessCategories),businessFrames:Object.fromEntries(businessFrames)}:{})});
  }
}
assert(runs.every(r=>r.sources.before===runs[0].sources.before));
const categories=[...new Set(profiles.flatMap(p=>Object.keys(p.estimates)))].sort();
const lanes={};for(const lane of ['native','flarex']){
  const selected=profiles.filter(p=>p.lane===lane);const all=key=>{const out=new Map();for(const p of selected)for(const[k,v]of Object.entries(p[key]))add(out,k,v);return Object.fromEntries([...out].sort((a,b)=>b[1]-a[1]));};
  lanes[lane]={roots:selected.length,cpu:stats(selected.map(p=>p.cpuMs)),admittedSamples:selected.reduce((s,p)=>s+p.inside,0),activeSamples:selected.reduce((s,p)=>s+p.active,0),boundarySamples:selected.reduce((s,p)=>s+p.boundary,0),oldAdmittedSamples:selected.reduce((s,p)=>s+p.previousAdmission,0),
    alignmentUncertaintyMs:stats(selected.map(p=>p.alignment.uncertaintyMs)),groups:all('groups'),frames:all('frames'),modules:all('modules'),callers:all('callers'),contexts:all('contexts'),gcOverlapMs:stats(selected.map(p=>p.gcOverlapMs))};
}
const pairs=runs.filter(r=>r.label!=='control').flatMap(r=>r.pairs.map(pair=>{const f=profiles.find(p=>p.id===pair.flarexRequestId),n=profiles.find(p=>p.id===pair.nativeRequestId);assert(f&&n);return {label:r.label,index:pair.index,addedCpuMs:f.cpuMs-n.cpuMs,categories:Object.fromEntries(categories.map(c=>[c,(f.estimates[c]??0)-(n.estimates[c]??0)]))};}));
let seed=137;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};
const bootstrap=strata=>{const draws=[];for(let i=0;i<10000;i++){const values=strata.flatMap(s=>Array.from({length:s.length},()=>s[Math.floor(random()*s.length)]));draws.push(mean(values));}draws.sort((a,b)=>a-b);return [draws[249],draws[9749]];};
const differential=categories.map(c=>{
  const blocks=['profile-a','profile-b'].map(label=>{const rows=pairs.filter(p=>p.label===label);return Array.from({length:10},(_,i)=>mean(rows.slice(i*4,i*4+4).map(p=>p.categories[c])));});
  return {category:c,nativeEstimatedMs:mean(profiles.filter(p=>p.lane==='native').map(p=>p.estimates[c]??0)),flarexEstimatedMs:mean(profiles.filter(p=>p.lane==='flarex').map(p=>p.estimates[c]??0)),estimatedAddedMs:mean(pairs.map(p=>p.categories[c])),interval95:bootstrap(blocks),
    byProcess:Object.fromEntries(['profile-a','profile-b'].map(label=>[label,mean(pairs.filter(p=>p.label===label).map(p=>p.categories[c]))]))};
}).sort((a,b)=>b.estimatedAddedMs-a.estimatedAddedMs);
const estimatedTotal=differential.reduce((s,c)=>s+c.estimatedAddedMs,0);assert(Math.abs(estimatedTotal-mean(pairs.map(p=>p.addedCpuMs)))<1e-8);
// Module/frame locations are the profiler's generated locations, not authored
// TypeScript line numbers. These are terminal self samples, never inclusive sums.
const detailDifferential=key=>{
  const rows=new Map();
  for(const p of profiles)for(const [name,count] of Object.entries(p[key])){
    if((key==='frames'&&name.endsWith(' (idle)'))||(key!=='frames'&&name.startsWith('idle|')))continue;
    let row=rows.get(name);if(row===undefined){row={name,nativeSamples:0,flarexSamples:0,nativeEstimatedMs:0,flarexEstimatedMs:0};rows.set(name,row);}
    row[p.lane+'Samples']+=count;row[p.lane+'EstimatedMs']+=p.cpuMs*count/p.active/80;
  }
  return [...rows.values()].map(r=>({...r,estimatedAddedMs:r.flarexEstimatedMs-r.nativeEstimatedMs})).sort((a,b)=>b.estimatedAddedMs-a.estimatedAddedMs);
};
const details=Object.fromEntries(['modules','frames','callers','contexts',...(operationMode?['phaseSamples','phaseCategories','stacks','coarsePhases','coarseCategories','businessPhases','businessCategories','businessFrames']:[])].map(key=>[key,detailDifferential(key)]));
for(const rows of Object.values(details))assert(Math.abs(rows.reduce((s,r)=>s+r.estimatedAddedMs,0)-estimatedTotal)<1e-8);
const summary={method:'Complete matched SDK roots, unchanged business code. Six-ms pre/post profiler landmarks outside original CPU-counter windows; explicit timestampToleranceMs (default 0.4 as prior marker probe). Disjoint admitted non-idle self samples allocate each observed root thread counter statistically. Estimated category milliseconds sum by construction, are not exact owner timings, removable savings or independent causal proof. 10000 stratified four-pair block-bootstrap draws; intervals omit systematic profiler/classification bias. No elapsed sample weights converted to CPU.',
  timestampToleranceMs,runs:runs.map(({pairs,...r})=>r),profileAddedMs:stats(pairs.map(p=>p.addedCpuMs)),differential,details,lanes,profiles,pairs};
await writeFile(resolve(directory,(operationMode?'operation-':'')+(timestampToleranceMs===0.4?'summary.json':`summary-tolerance-${timestampToleranceMs}.json`)),JSON.stringify(summary,null,2));
console.log(JSON.stringify({runs:summary.runs,profileAddedMs:summary.profileAddedMs,differential,lanes:Object.fromEntries(Object.entries(lanes).map(([k,v])=>[k,{...v,frames:Object.entries(v.frames).slice(0,30),modules:Object.entries(v.modules).slice(0,25),callers:Object.entries(v.callers).slice(0,25),contexts:v.contexts}]))},null,2));
