import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { CorePendingWrites, CoreReadSetBuilder, CoreWriteLog, pointInterval } from "../../src/core/writeLog";

const bytes = (...values: number[]) => Uint8Array.from(values);
const index = bytes(1);
const changes = (key: number) => [{ indexId: index, keys: [bytes(key)] }];
const reads = (key: number) => [{ indexId: index, intervals: [pointInterval(bytes(key))] }];

describe("translated indexed conflict history", () => {
  it("reuses a frozen snapshot until a publication advances the log", () => {
    const log = new CoreWriteLog(0n);
    const initial = log.snapshot();
    expect(Object.isFrozen(initial)).toBe(true);
    expect(log.snapshot()).toBe(initial);
    expect(new CoreWriteLog(0n).snapshot()).not.toBe(initial);
    expect(() => log.append(0n, changes(2))).toThrow("publication must be increasing");
    expect(log.snapshot()).toBe(initial);

    log.append(1n, []);
    const published = log.snapshot();
    expect(published).not.toBe(initial);
    expect(published.timestamp).toBe(1n);
    expect(log.snapshot()).toBe(published);
    expect(initial.timestamp).toBe(0n);
  });

  it("replaces only the current snapshot when retention prunes without publication", () => {
    const log = new CoreWriteLog(0n, { minRetentionNanoseconds: 1n, maxRetentionNanoseconds: 1n, softMaxBytes: 0 });
    log.append(1n, changes(2), undefined, changes(2));
    const held = log.snapshot();
    log.enforceRetention(2n);
    expect(log.snapshot()).toBe(held);

    log.enforceRetention(3n);
    const pruned = log.snapshot();
    expect(pruned).not.toBe(held);
    expect(pruned.timestamp).toBe(held.timestamp);
    expect(pruned.minimumTimestamp).toBe(1n);
    expect(Result.isFailure(pruned.conflict(reads(2), 0n))).toBe(true);
    expect(Result.isFailure(pruned.nativeKeyTransition(index, bytes(2), 0n))).toBe(true);
    expect(Result.getOrThrow(pruned.conflict(reads(2), 1n))).toBeUndefined();
    expect(Result.getOrThrow(pruned.nativeKeyTransition(index, bytes(2), 1n))).toBeUndefined();

    const transitionKey = Buffer.from([2]);
    const conflict = Result.getOrThrow(held.conflict(reads(2), 0n));
    const transition = Result.getOrThrow(held.nativeKeyTransition(index, transitionKey, 0n));
    if (conflict === undefined || transition === undefined) throw new Error("Held snapshot lost committed history");
    for (const found of [conflict, transition]) {
      found.indexId.fill(7);
      found.key.fill(7);
    }
    expect(transitionKey[0]).toBe(2);
    expect(held.minimumTimestamp).toBe(0n);
    expect(Result.getOrThrow(held.conflict(reads(2), 0n))).toEqual({ timestamp: 1n, indexId: index, key: bytes(2) });
    expect(Result.getOrThrow(held.nativeKeyTransition(index, bytes(2), 0n))).toEqual({ timestamp: 1n, indexId: index, key: bytes(2) });
  });

  it("keeps frozen prevalidation history and checks the later published suffix", () => {
    const log = new CoreWriteLog(0n);
    const prevalidated = log.snapshot();
    expect(Result.getOrThrow(prevalidated.conflict(reads(2), 0n))).toBeUndefined();
    log.append(1n, changes(2));
    expect(Result.getOrThrow(prevalidated.conflict(reads(2), 0n))).toBeUndefined();
    expect(Result.getOrThrow(log.snapshot().conflict(reads(2), prevalidated.timestamp)))
      .toMatchObject({ timestamp: 1n, key: bytes(2) });
    expect(Result.getOrThrow(log.snapshot().conflict(reads(3), 0n))).toBeUndefined();
  });

  it("checks accepted unsaved keys and removes them only in FIFO order", () => {
    const pending = new CorePendingWrites();
    pending.push(1n, changes(2));
    pending.push(2n, changes(4));
    expect(pending.conflict(reads(2))).toMatchObject({ timestamp: 1n });
    expect(pending.conflict(reads(3))).toBeUndefined();
    expect(() => pending.pop(2n)).toThrow("publication order");
    pending.pop(1n);
    expect(pending.conflict(reads(2))).toBeUndefined();
    expect(pending.conflict(reads(4))).toMatchObject({ timestamp: 2n });
    pending.pop(2n);
    expect(pending.size).toBe(0);
  });

  it("keeps every same-key pending writer until its own FIFO publication", () => {
    const pending = new CorePendingWrites();
    pending.push(1n, changes(2));
    pending.push(2n, changes(2));
    pending.push(3n, changes(2));
    expect(pending.conflict(reads(2))).toMatchObject({ timestamp: 3n });
    expect(pending.range(index, pointInterval(bytes(2)), 2)).toEqual([
      { indexId: index, key: bytes(2), timestamp: 3n },
    ]);
    pending.pop(1n);
    expect(pending.conflict(reads(2))).toMatchObject({ timestamp: 3n });
    pending.pop(2n);
    expect(pending.conflict(reads(2))).toMatchObject({ timestamp: 3n });
    pending.pop(3n);
    expect(pending.conflict(reads(2))).toBeUndefined();
    expect(pending.range(index, pointInterval(bytes(2)), 2)).toEqual([]);
  });

  it("preserves interval boundaries, unions coverage, and fails after history loss", () => {
    const builder = new CoreReadSetBuilder();
    builder.add(index, { start: bytes(2), end: bytes(4) });
    builder.add(index, { start: bytes(3), end: bytes(5) });
    const readSet = builder.snapshot();
    expect(readSet[0]?.intervals).toEqual([{ start: bytes(2), end: bytes(5) }]);
    const log = new CoreWriteLog(0n, { minRetentionNanoseconds: 0n, maxRetentionNanoseconds: 1n, softMaxBytes: 0 });
    log.append(1n, changes(4));
    expect(Result.getOrThrow(log.snapshot().conflict(readSet, 0n))).toMatchObject({ timestamp: 1n });
    expect(Result.getOrThrow(log.snapshot().conflict(reads(5), 0n))).toBeUndefined();
    log.append(2n, changes(7));
    expect(Result.isFailure(log.snapshot().conflict(readSet, 0n))).toBe(true);
  });
});
