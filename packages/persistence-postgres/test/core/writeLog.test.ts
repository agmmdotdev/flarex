import { describe, expect, it } from "vitest";
import { Result } from "effect";
import { CorePendingWrites, CoreReadSetBuilder, CoreWriteLog, pointInterval } from "../../src/core/writeLog";

const bytes = (...values: number[]) => Uint8Array.from(values);
const index = bytes(1);
const changes = (key: number) => [{ indexId: index, keys: [bytes(key)] }];
const reads = (key: number) => [{ indexId: index, intervals: [pointInterval(bytes(key))] }];

describe("translated indexed conflict history", () => {
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
