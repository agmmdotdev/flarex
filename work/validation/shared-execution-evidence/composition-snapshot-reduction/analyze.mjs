import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory=dirname(fileURLToPath(import.meta.url));
const mean=a=>a.reduce((s,x)=>s+x,0)/a.length;
const quantile=(a,p)=>{const b=[...a].sort((x,y)=>x-y),i=(b.length-1)*p;return b[Math.floor(i)]+(b[Math.ceil(i)]-b[Math.floor(i)])*(i%1);};
const stats=a=>({count:a.length,mean:mean(a),median:quantile(a,.5),min:Math.min(...a),max:Math.max(...a)});
let seed=137;
function random(){seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;}
function interval(strata){const estimates=[];for(let trial=0;trial<20000;trial++){let sum=0,count=0;for(const blocks of strata)for(let i=0;i<blocks.length;i++){sum+=blocks[Math.floor(random()*blocks.length)];count++;}estimates.push(sum/count);}return [quantile(estimates,.025),quantile(estimates,.975)];}
const summary={method:'Actual matched Flarex-minus-native root CPU deltas; ABBA/BAAB four-pair blocks; stratified 20000-draw block bootstrap, seed 137. Positive reduction means lower CPU.',stages:{}};
for(const stage of ['composition','snapshot']){
  const processes=[];
  for(const lane of stage==='composition'?['a','b','c','d']:['a','b']){
    const assignment=JSON.parse(await readFile(resolve(directory,`${stage}-${lane}/assignment.json`),'utf8'));
    const raw=JSON.parse(await readFile(resolve(directory,`${stage}-${lane}`,win32.basename(assignment.report)),'utf8'));
    if(raw.cleanup!=='completed'||!raw.gates.every(g=>g.passed)||raw.cpuPairs.length!==40||!raw.samples.every(s=>s.outcome==='success'))throw Error('Incomplete '+stage+lane);
    const variant=new Map(assignment.assignments.map(a=>[a.index,a.variant]));
    const pairs=raw.cpuPairs.map(p=>({...p,variant:variant.get(p.index)}));
    if(pairs.some(p=>p.thread===null||p.variant===undefined))throw Error('Missing exact pair');
    processes.push({lane,runId:raw.runId,pairs,loaded:assignment.loaded,gates:raw.gates,sources:raw.sources});
  }
  const result={processes:processes.map(({pairs,...p})=>p),counters:{}};
  for(const counter of ['thread','process']){
    const variants={};
    for(const variant of ['before','after']){
      const pairs=processes.flatMap(p=>p.pairs).filter(p=>p.variant===variant);
      const total=(c,lane)=>(c[`${lane}UserMicroseconds`]+c[`${lane}SystemMicroseconds`])/1000;
      variants[variant]={addedMs:stats(pairs.map(p=>p[counter].addedTotalMicroseconds/1000)),flarexMs:stats(pairs.map(p=>total(p[counter],'flarex'))),nativeMs:stats(pairs.map(p=>total(p[counter],'native')))};
    }
    const strata=processes.map(process=>{
      const blocks=new Map();for(const pair of process.pairs){const id=Math.floor((pair.index-5)/4);if(!blocks.has(id))blocks.set(id,[]);blocks.get(id).push(pair);}
      return [...blocks.values()].map(block=>{if(block.length!==4||block.filter(p=>p.variant==='after').length!==2)throw Error('Unbalanced block');return mean(block.filter(p=>p.variant==='before').map(p=>p[counter].addedTotalMicroseconds/1000))-mean(block.filter(p=>p.variant==='after').map(p=>p[counter].addedTotalMicroseconds/1000));});
    });
    const warmedStrata=strata.map(blocks=>blocks.slice(1));
    result.counters[counter]={...variants,meanReductionMs:mean(strata.flat()),reduction95IntervalMs:interval(strata),blocks:strata,
      cohorts:strata.reduce((cohorts,blocks,index)=>{const key=['a','b'].includes(processes[index].lane)?'initial':'replication';(cohorts[key]??=[]).push(...blocks);return cohorts;},{}),
      warmSensitivity:{pairs:processes.length*36,meanReductionMs:mean(warmedStrata.flat()),reduction95IntervalMs:interval(warmedStrata)}};
  }
  summary.stages[stage]=result;
}
const finalAssignment=JSON.parse(await readFile(resolve(directory,'retained-control/assignment.json'),'utf8'));
{
  const raw=JSON.parse(await readFile(resolve(directory,'retained-control',win32.basename(finalAssignment.report)),'utf8'));
  if(raw.cleanup!=='completed'||!raw.gates.every(g=>g.passed)||raw.cpuPairs.length!==40||!raw.samples.every(s=>s.outcome==='success'))throw Error('Incomplete final control');
  summary.finalControl={runId:raw.runId,gates:raw.gates,sources:raw.sources,counters:{}};
  for(const name of ['thread','process'])summary.finalControl.counters[name]={addedMs:stats(raw.cpuPairs.map(p=>p[name].addedTotalMicroseconds/1000)),flarexMs:stats(raw.cpuPairs.map(p=>(p[name].flarexUserMicroseconds+p[name].flarexSystemMicroseconds)/1000)),nativeMs:stats(raw.cpuPairs.map(p=>(p[name].nativeUserMicroseconds+p[name].nativeSystemMicroseconds)/1000))};
}
await writeFile(resolve(directory,'summary.json'),JSON.stringify(summary,null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(summary.stages).map(([stage,s])=>[stage,Object.fromEntries(Object.entries(s.counters).map(([name,c])=>[name,{before:c.before.addedMs,after:c.after.addedMs,reduction:c.meanReductionMs,interval:c.reduction95IntervalMs,warmSensitivity:c.warmSensitivity}]))])),null,2));
if(summary.finalControl!==undefined)console.log(JSON.stringify({finalControl:summary.finalControl},null,2));
