import { it, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compare } from '../../../../packages/executor/test/performance/measurement/index';
it('retains the final authored-source complete root CPU control',async()=>{
  const outputDirectory=resolve(process.env.FLAREX_EVIDENCE_OUTPUT);
  const result=await compare({selection:{scenario:'mixed-workflow'},mode:'root-counters',size:'small',warmups:5,samples:40,outputDirectory});
  const raw=JSON.parse(await readFile(result.reports.raw,'utf8'));
  expect(result.execution).toBe('complete');expect(raw.cleanup).toBe('completed');expect(raw.cpuPairs).toHaveLength(40);
  expect(raw.gates.every(g=>g.passed)).toBe(true);expect(raw.samples.every(s=>s.outcome==='success')).toBe(true);
  await writeFile(resolve(outputDirectory,'assignment.json'),JSON.stringify({report:result.reports.raw},null,2));
},600000);
