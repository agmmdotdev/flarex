import { it, expect } from 'vitest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const assignments=[];
globalThis.__validationTrial={selected:true,loaded:[],async request(sample,run){
  const slot=((sample.index-5)%4+4)%4;
  this.selected=sample.kind==='diagnostic' ? ((slot===0||slot===3) !== (process.env.VALIDATION_REVERSE==='1')) : sample.index%2===0;
  if(sample.kind==='diagnostic')assignments.push({...sample,variant:this.selected?'after':'before'});
  return run();
}};
it('measures separate balanced changes with complete native business graphs',async()=>{
  const { compare } = await import('../../../../packages/executor/test/performance/measurement/index');
  const outputDirectory=resolve(process.env.FLAREX_EVIDENCE_OUTPUT);
  const result=await compare({selection:{scenario:'mixed-workflow'},mode:'root-counters',size:'small',warmups:5,samples:40,outputDirectory});
  const raw=JSON.parse(await readFile(result.reports.raw,'utf8'));
  expect(result.execution).toBe('complete');expect(raw.cleanup).toBe('completed');
  expect(raw.gates.every(g=>g.passed)).toBe(true);expect(raw.samples.every(s=>s.outcome==='success')).toBe(true);
  expect(raw.cpuPairs).toHaveLength(40);expect(assignments).toHaveLength(40);
  expect(assignments.filter(a=>a.variant==='before')).toHaveLength(20);
  expect(globalThis.__validationTrial.loaded).toHaveLength(process.env.VALIDATION_STAGE==='composition'?4:1);
  await mkdir(outputDirectory,{recursive:true});
  await writeFile(resolve(outputDirectory,'assignment.json'),JSON.stringify({stage:process.env.VALIDATION_STAGE,reverse:process.env.VALIDATION_REVERSE,assignments,loaded:globalThis.__validationTrial.loaded,report:result.reports.raw},null,2));
},600000);
