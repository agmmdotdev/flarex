import { createCyclePartition, type CycleReader } from '../../../../packages/executor/test/performance/measurement/cycleAttribution';

/** Refine only the SDK partition's outside bucket using the SAME counter reads.
 * Boundary names locate intervals; they do not identify their instructions. */
export const createDispatchPartition: typeof createCyclePartition = (reader, detail, observed) => {
  let previous: bigint | undefined, boundary = 'begin', pending = 'begin';
  const stack: { site: string }[] = [];
  const gaps = new Map<string, { cycles: number; calls: number }>();
  const correlated: CycleReader = { threadId: reader.threadId, read: () => {
    const value = reader.read();
    if (observed && previous !== undefined && stack.length === 0) {
      const key = `Gap.${boundary} -> ${pending}`, delta = Number(value - previous);
      if (!Number.isSafeInteger(delta) || delta < 0) throw Error('Invalid dispatch gap');
      const entry = gaps.get(key) ?? { cycles: 0, calls: 0 };
      entry.cycles += delta; entry.calls++; gaps.set(key, entry);
    }
    previous = value; boundary = pending; return value;
  } };
  const partition = createCyclePartition(correlated, detail, observed);
  return { ...partition,
    enter(site) {
      pending = 'enter:' + site;
      const token = partition.enter(site); if (token !== undefined) stack.push(token); return token;
    },
    leave(token) {
      pending = 'leave:' + token.site; partition.leave(token);
      if (stack.pop() !== token) throw Error('Dispatch partition nesting');
    },
    end() { pending = 'end'; partition.end(); },
    evidence() {
      const evidence = partition.evidence(); if (!observed) return evidence;
      const outside = evidence.buckets.find(b => b.site === 'outside-observed-execution')?.cycles ?? 0;
      if ([...gaps.values()].reduce((sum, g) => sum + g.cycles, 0) !== outside) throw Error('Dispatch gap conservation');
      return { ...evidence, buckets: [...evidence.buckets.filter(b => b.site !== 'outside-observed-execution'),
        ...[...gaps].map(([site, value]) => ({ site, ...value }))] };
    },
  };
};
