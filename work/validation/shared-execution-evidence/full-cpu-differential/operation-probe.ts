import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Effect, Schema } from 'effect';
import { beforeAll, afterAll, expect } from 'vitest';

// Diagnostic-only operation correlation. Reuse the existing native cycle reader;
// never convert cycles to milliseconds or remove business work.
const selected = new Set([
  'LogicalDocuments.make', 'LogicalDocuments.get', 'LogicalDocuments.getMany',
  'LogicalDocuments.relationalFind', 'LogicalDocuments.relationalPage',
  'LogicalDocuments.relationalChange', 'LogicalDocuments.readRelationalSelection',
  'LogicalDocuments.validateWrite', 'LogicalDocuments.validateUnique',
  'LogicalDocuments.close', 'FiniteStorageCapture.run',
  'ApplicationDocument.acceptPublication', 'ApplicationDocument.materializeAcceptedPublication',
  'LogicalDocumentMaterialization.prepareDelta', 'LogicalDocumentMaterialization.lower',
]);
type Reading = { time: number; cycles: string; user: number; system: number };
type Interval = { ordinal: number; name: string; parent: number | null; start: Reading; end: Reading | null };
type Root = { ordinal: number; start: Reading; end: Reading | null; threadId: number; intervals: Interval[] };
const roots: Root[] = [], faults: string[] = [];
let active: Root | undefined;
const stack: Interval[] = [];
const require = createRequire(import.meta.url);
const readerPath = resolve('work/validation/shared-execution-evidence/engine-cpu-attribution/thread-cycles.node');
const native: unknown = require(readerPath);
const reader = Schema.decodeUnknownSync(Schema.Struct({ readCycles: Schema.Unknown, threadId: Schema.Unknown }))(native);
const readCycles = reader.readCycles, readThread = reader.threadId;
if (typeof readCycles !== 'function' || typeof readThread !== 'function') throw Error('Missing existing cycle reader');
const reading = (): Reading => {
  const cycles: unknown = readCycles();
  if (typeof cycles !== 'bigint' || cycles < 0n) throw Error('Invalid cycle counter');
  const cpu = process.threadCpuUsage();
  return { time: performance.now(), cycles: String(cycles), user: cpu.user, system: cpu.system };
};
const threadIdentity = () => Schema.decodeUnknownSync(Schema.Natural)(readThread());
const begin = (name: string): Interval | undefined => {
  if (active === undefined) return;
  try {
    const interval: Interval = { ordinal: active.intervals.length, name, parent: stack.at(-1)?.ordinal ?? null, start: reading(), end: null };
    active.intervals.push(interval); stack.push(interval); return interval;
  } catch { faults.push('begin'); return; }
};
const end = (interval: Interval | undefined) => {
  if (interval === undefined) return;
  try {
    interval.end = reading();
    if (stack.pop() !== interval) faults.push('overlapping-operation-scopes');
  } catch { faults.push('end'); }
};
const probe = {
  sync<A>(name: string, run: () => A): A {
    const token = begin(name);
    try { return run(); } finally { end(token); }
  },
  current() { return active === undefined ? undefined : { root: active.ordinal, next: active.intervals.length,
    inReadFamily: stack.some(span => span.name === 'LogicalDocuments.readRelationalSelection' || span.name === 'FiniteStorageCapture.run') }; },
  async root<A>(run: () => Promise<A>): Promise<A> {
    if (active !== undefined) throw Error('Overlapping diagnostic roots');
    const root: Root = { ordinal: roots.length, start: reading(), end: null, threadId: threadIdentity(), intervals: [] };
    roots.push(root); active = root;
    try { return await run(); }
    finally {
      root.end = reading();
      if (root.threadId !== threadIdentity() || stack.length !== 0) faults.push('unsettled-root');
      active = undefined;
    }
  },
  async phase<A>(name: string, run: () => Promise<A>): Promise<A> {
    const token = begin(name);
    try { return await run(); } finally { end(token); }
  },
  effect<A, E, R>(name: string, work: Effect.Effect<A, E, R>, restrict = false): Effect.Effect<A, E, R> {
    if (restrict && !selected.has(name)) return work;
    return Effect.suspend(() => {
      if (active === undefined) return work;
      const token = begin(name);
      return Effect.onExit(work, () => Effect.sync(() => end(token)));
    });
  },
};
declare global { var __operationCpu: typeof probe; }
const sourceFiles = ['operation-probe.ts', 'operation-profile.config.ts'];
const hashSources = () => Promise.all(sourceFiles.map(async file => ({ file,
  sha256: createHash('sha256').update(await readFile(new URL(file, import.meta.url))).digest('hex') })));
let before: Awaited<ReturnType<typeof hashSources>>;
beforeAll(async () => { before = await hashSources(); globalThis.__operationCpu = probe; });
afterAll(async () => {
  const after = await hashSources();
  const output = process.env.FLAREX_MEASUREMENT_REPORT_DIRECTORY;
  if (output === undefined) throw Error('Missing diagnostic output');
  await mkdir(output, { recursive: true });
  await writeFile(resolve(output, 'operations.json'), JSON.stringify({ before, after,
    readerSha256: createHash('sha256').update(await readFile(readerPath)).digest('hex'),
    roots, faults, method: 'Inclusive cycle/thread counter brackets at existing operation boundaries. Strict nesting required. Correlate by original root windows. Observer overhead remains; cycles are not milliseconds.' }, null, 2));
  Reflect.deleteProperty(globalThis, '__operationCpu');
  expect(after).toEqual(before); expect(faults).toEqual([]); expect(active).toBeUndefined();
});
