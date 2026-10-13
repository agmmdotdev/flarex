import { beforeAll, afterAll, expect } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';

import { createReadProbe } from './read-observer';
const probe = createReadProbe(() => globalThis.__operationCpu);
declare global { var __readCpu: ReturnType<typeof createReadProbe>; }
const files = ['read-observer.ts','read-probe.ts','read-transform.mjs','read-profile.config.ts','operation-probe.ts','operation-profile.config.ts','profile.config.ts'];
const hashes = () => Promise.all(files.map(async file => ({file,sha256:createHash('sha256').update(await readFile(new URL(file,import.meta.url))).digest('hex')})));
let before: Awaited<ReturnType<typeof hashes>>;
// Setup module itself must install the transform capability before fixture imports.
globalThis.__readCpu = probe;
beforeAll(async () => { before = await hashes(); });
afterAll(async () => {
  const after = await hashes(), output = process.env.FLAREX_MEASUREMENT_REPORT_DIRECTORY;
  if (output === undefined) throw Error('Missing read diagnostic output');
  // Replay only the pure query/bounds preparation functions, after every live
  // workflow has settled. No SQL, result cache or runtime replacement is used.
  // These batch CPU measurements price repeated preparation, not a root saving.
  const replays=[];
  for(const name of ['prepareLogicalRelationalRead','compileAppOrderedIndexBoundsV1']) {
    const items=probe.replay.filter(r=>r.name===name);if(items.length===0)continue;
    for(const item of items)expect(probe.replayValue(name,item.run())).toBe(item.expected);
    const blocks=[];
    for(let block=0;block<5;block++) {
      const iterations=2000,start=process.threadCpuUsage(),time=performance.now();let outputValue:unknown;
      for(let i=0;i<iterations;i++)for(const item of items)outputValue=item.run();
      const elapsedMs=performance.now()-time,cpu=process.threadCpuUsage(start);
      const last=items.at(-1);if(last===undefined)throw Error('Missing replay item');
      expect(probe.replayValue(name,outputValue)).toBe(last.expected);
      blocks.push({iterations,calls:items.length*iterations,threadMs:(cpu.user+cpu.system)/1000,elapsedMs});
    }
    for(const item of items)expect(probe.replayValue(name,item.run())).toBe(item.expected);
    replays.push({name,root:items[0]!.root,ordinals:items.map(item=>item.ordinal),keys:items.map(item=>item.key),callsPerWorkflow:items.length,blocks});
  }
  await writeFile(resolve(output,'read-facts.json'),JSON.stringify({before,after,sources:probe.sources,facts:probe.facts,faults:probe.faults,replays}));
  expect(before).toEqual(after); expect(probe.faults).toEqual([]);
  Reflect.deleteProperty(globalThis,'__readCpu');
});
