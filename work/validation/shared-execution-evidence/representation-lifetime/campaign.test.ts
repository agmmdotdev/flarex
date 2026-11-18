import { it, expect } from 'vitest';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { Schema } from 'effect';
import { createRepresentationProbe } from './probe';
import { decodeArtifact, decodeRawProjection } from './evidence';
it('traces representations in complete matched business roots',async()=>{
  const hashObserver=()=>Promise.all(['probe.ts','evidence.ts','transform.mjs','campaign.test.ts','vitest.config.ts','run-campaign.ps1'].map(async file=>({file,
    sha256:createHash('sha256').update(await readFile(new URL(file,import.meta.url))).digest('hex')})));
  const observerSources=await hashObserver();
  const readerPath=resolve('work/validation/shared-execution-evidence/engine-cpu-attribution/thread-cycles.node');
  const native: unknown=createRequire(import.meta.url)(readerPath);
  const {readCycles,threadId}=Schema.decodeUnknownSync(Schema.Struct({readCycles:Schema.Unknown,threadId:Schema.Unknown}))(native);
  if(typeof readCycles!=='function'||typeof threadId!=='function')throw Error('Missing cycle reader');
  const observer=createRepresentationProbe({read:()=>{const n:unknown=readCycles();if(typeof n!=='bigint')throw Error('Invalid cycles');return n;},
    threadId:()=>{const n:unknown=threadId();if(typeof n!=='number')throw Error('Invalid thread');return n;}},process.env.REPRESENTATION_REVERSE==='1');
  globalThis.__representation=observer;
  const { compare }=await import('../../../../packages/executor/test/performance/measurement/index');
  const outputDirectory=resolve(process.env.FLAREX_EVIDENCE_OUTPUT!);
  await mkdir(outputDirectory,{recursive:true});
  let rawPath: string | undefined;
  try {
    const count=Number(process.env.REPRESENTATION_SAMPLES??32);
    const result=await compare({selection:{scenario:'mixed-workflow'},mode:'root-counters',size:'small',warmups:5,samples:count,outputDirectory});
    rawPath=result.reports.raw;
    const raw=decodeRawProjection(JSON.parse(await readFile(rawPath,'utf8')));
    expect(result.execution).toBe('complete');expect(raw.cleanup).toBe('completed');
    expect(raw.gates.every(g=>g.passed)).toBe(true);
    expect(raw.samples.every(s=>s.outcome==='success')).toBe(true);
    expect(raw.cpuPairs).toHaveLength(count);
    const records=observer.requests;
    expect(records.filter(r=>r.enabled)).toHaveLength(count/2);
    for(const record of records){expect(record.faults).toEqual([]);expect(record.cycles?.complete).toBe(true);if(record.enabled)expect(record.edges.length).toBeGreaterThan(100);}
    expect(await hashObserver()).toEqual(observerSources);
  }finally{
    const artifact={rawPath,readerHash:createHash('sha256').update(await readFile(readerPath)).digest('hex'),
      reverse:process.env.REPRESENTATION_REVERSE==='1',observerSources,observerSourcesAfter:await hashObserver(),sources:observer.sources,requests:observer.requests};
    const encoded=JSON.stringify(artifact);
    await writeFile(resolve(outputDirectory,'representations.json.gz'),gzipSync(encoded));
    decodeArtifact(JSON.parse(encoded));
  }
},600000);
