import { it, expect } from 'vitest';
import { Effect, Cause, Exit } from 'effect';
import { createDispatchPartition } from './dispatch-partition';
import { createLaunchObserverWithDispatch } from './dispatch-runtime';

let current: { root: number; next: number } | undefined;
const reader = { read: () => 0n, threadId: () => 1 };
const observer = createLaunchObserverWithDispatch({ cycles: reader, cpu: reader, current: () => current, reverse: false });
it('refines only outside cycles with identical reads and exact nested boundary attribution', () => {
  let value = 0n, reads = 0;
  const p = createDispatchPartition({ read: () => { reads++; return value; }, threadId: () => 1 }, 'engine', true);
  p.begin(); value = 10n; const node = p.enter('Node.callback:TCPWRAP'); expect(node).toBeDefined();
  value = 30n; const driver = p.enter('Driver.pgReceive'); expect(driver).toBeDefined();
  value = 60n; if (driver) p.leave(driver); value = 65n; if (node) p.leave(node);
  value = 80n; const reaction = p.enter('VM.promiseReaction:test'); expect(reaction).toBeDefined();
  value = 90n; if (reaction) p.leave(reaction); value = 100n; p.end();
  const evidence = p.evidence(); expect(reads).toBe(8); expect(evidence.totalCycles).toBe(100);
  expect(evidence.buckets.find(b => b.site === 'Driver.pgReceive')?.cycles).toBe(30);
  expect(evidence.buckets.find(b => b.site === 'Node.callback:TCPWRAP')?.cycles).toBe(25);
  expect(evidence.buckets.filter(b => b.site.startsWith('Gap.')).reduce((n, b) => n + b.cycles, 0)).toBe(35);
  expect(evidence.buckets.find(b => b.site === 'Gap.leave:Node.callback:TCPWRAP -> enter:VM.promiseReaction:test')?.cycles).toBe(15);
});
it('observes a real Node callback and rejected Promise without changing first failure or later work', async () => {
  current = { root: 0, next: 1 };
  const failure = { first: true }, events: string[] = [];
  const work = Effect.tryPromise({ try: () => new Promise<void>((_, reject) => setImmediate(() => {
    events.push('first'); reject(failure);
  })).then(() => { events.push('later'); }), catch: cause => cause });
  const actual = await Effect.runPromiseExit(observer.command(work));
  current = undefined; await new Promise<void>(resolve => setImmediate(resolve));
  expect(actual).toEqual(await Effect.runPromiseExit(Effect.fail(failure))); expect(events).toEqual(['first']);
  expect(observer.faults).toEqual([]); expect(observer.settled()).toBe(true);
  expect(observer.records[0]?.cycles.buckets.some(b => b.site === 'Node.callback:Immediate')).toBe(true);
});
it('preserves full Causes and interruption with active dispatch observation', async () => {
  for (const work of [Effect.fail('first'), Effect.die('defect'), Effect.interrupt,
    Effect.failCause(Cause.combine(Cause.fail('first'), Cause.die('second')))]) {
    current = { root: 0, next: 1 }; const events: string[] = [];
    const actual = await Effect.runPromiseExit(observer.command(work.pipe(Effect.andThen(() => Effect.sync(() => events.push('later'))))));
    current = undefined; await new Promise<void>(resolve => setImmediate(resolve));
    if (work === Effect.interrupt) expect(Exit.isFailure(actual) && Cause.hasInterrupts(actual.cause)).toBe(true);
    else expect(actual).toEqual(await Effect.runPromiseExit(work));
    expect(events).toEqual([]); expect(observer.faults).toEqual([]); expect(observer.settled()).toBe(true);
  }
});
