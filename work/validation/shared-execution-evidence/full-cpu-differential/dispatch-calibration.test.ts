import { it, expect } from 'vitest';
import { Effect } from 'effect';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createLaunchObserverWithDispatch } from './dispatch-runtime';

let current: { root: number; next: number } | undefined;
const reader = { read: () => 0n, threadId: () => 1 };
const observer = createLaunchObserverWithDispatch({ cycles: reader, cpu: reader, current: () => current, reverse: false });
it('prices empty diagnostic boundaries without assigning their replay price to production', async () => {
  const files = ['dispatch-calibration.test.ts', 'dispatch-calibration.config.ts', 'dispatch-profile.config.ts',
    'dispatch-runtime.ts', 'dispatch-partition.ts', 'continuation-runtime.ts', 'continuation-observer.ts',
    'continuation-native/gc-cycles.node'];
  const hashes = () => Promise.all(files.map(async file => ({ file,
    sha256: createHash('sha256').update(await readFile(new URL(file, import.meta.url))).digest('hex') })));
  const before = await hashes(), blocks = [], iterations = 10000;
  const empty = () => 1;
  // Both warm-up and accepted blocks use the exact factory and actual native reader.
  for (let block = -2; block < 10; block++) {
    for (const observed of block % 2 === 0 ? [false, true] : [true, false]) {
      current = { root: 0, next: 1 }; const start = process.threadCpuUsage();
      const value = Effect.runSync(observer.command(Effect.sync(() => {
        let consumed = 0;
        for (let i = 0; i < iterations; i++) consumed += observed ? observer.run('Empty.boundary', empty) : empty();
        return consumed;
      })));
      const used = process.threadCpuUsage(start); current = undefined;
      expect(value).toBe(iterations);
      const record = observer.records.at(-1); if (!record) throw Error('Missing calibration record');
      expect(record.cycles.complete).toBe(true);
      expect(record.totalCycles).toBe(record.cycles.totalCycles! + record.probeCycles + record.gcCycles);
      if (block >= 0) blocks.push({ block, observed, iterations, threadMs: (used.user + used.system) / 1000, record });
    }
  }
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(observer.faults).toEqual([]); expect(observer.settled()).toBe(true);
  const after = await hashes(); expect(after).toEqual(before);
  await writeFile(new URL('dispatch-calibration.json', import.meta.url), JSON.stringify({ before, after, blocks,
    node: process.version, v8: process.versions.v8,
    method: 'Empty synchronous bodies and outside gaps contain probe edges, loop and dispatch overhead only. Replay calibration is not an in-workflow correction, production CPU attribution or saving.' }, null, 2));
});
