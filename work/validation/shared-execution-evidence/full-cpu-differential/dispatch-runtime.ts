import { createHook } from 'node:async_hooks';
import { afterAll } from 'vitest';
import { createLaunchObserverWithContinuations } from './continuation-runtime';

/** Node callback observation adds no callback/Promise replacement or scheduling.
 * PROMISE resources stay with V8 hooks to avoid crossing hook-family stacks. */
export function createLaunchObserverWithDispatch(input: Parameters<typeof createLaunchObserverWithContinuations>[0]) {
  const observer = createLaunchObserverWithContinuations(input);
  const resources = new Map<number, string>();
  const frames = new Map<number, ReturnType<typeof observer.enter>>();
  const hook = createHook({
    init(id, type) { observer.bookkeeping(() => {
      if (type === 'PROMISE') return;
      if (resources.size >= 100_000) throw Error('Node resource observation bound');
      resources.set(id, type);
    }); },
    before(id) { observer.bookkeeping(() => {
      const type = resources.get(id); if (type === undefined) return;
      if (frames.has(id)) throw Error('Overlapping Node callback');
      const frame = observer.enter('Node.callback:' + type); if (frame !== undefined) frames.set(id, frame);
    }); },
    after(id) { observer.bookkeeping(() => {
      const frame = frames.get(id); frames.delete(id); observer.leave(frame);
    }); },
    destroy(id) { observer.bookkeeping(() => { resources.delete(id); }); },
  });
  if (process.env.FLAREX_DISPATCH_MODE !== 'control') hook.enable();
  afterAll(() => {
    hook.disable();
    if (frames.size !== 0) observer.faults.push('unsettled-node-callback');
    resources.clear(); frames.clear();
  });
  return observer;
}
