import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { Effect, Result } from "effect";
import { encodeIndexKey } from "flarex-protocol/index-key";
import type { CorePersistenceIndexEntry } from "../../src/core/contracts";
import { CoreWriteLog, indexKeysFromWrites, indexTransitionsFromWrites, pointInterval } from "../../src/core/writeLog";
import { bootstrapCore } from "../../src/core/bootstrap";
import { makeCoreCommitter } from "../../src/core/committer";
import { CoreFinalizationVault, createCoreTransaction, prepareCoreTransactionIds } from "../../src/core/transaction";
import { createCorePGliteFixture } from "./fixture";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const index = Uint8Array.of(1);
const key = (value: number) => Uint8Array.of(value);
const write = (value: number, deleted: boolean, prev: bigint | null): CorePersistenceIndexEntry => ({
  mode: "scanComplete", ts: 1n, index: { id: index }, key: key(value),
  value: deleted ? null : { tableId: Uint8Array.of(2), documentId: Uint8Array.of(3) },
  prev: prev === null ? null : { ts: prev, documentId: Uint8Array.of(3) },
});
const append = (log: CoreWriteLog, timestamp: bigint, writes: readonly CorePersistenceIndexEntry[]) => {
  log.append(timestamp, indexKeysFromWrites(writes), 0, indexTransitionsFromWrites(writes));
};

describe("native retained key-transition certificates", () => {
  it("keeps Source same-key events while native certificates ignore unchanged membership", () => {
    const log = new CoreWriteLog(10n);
    append(log, 20n, [write(7, false, 5n)]);
    const snapshot = log.snapshot();
    expect(Result.getOrThrow(snapshot.conflict([{ indexId: index, intervals: [pointInterval(key(7))] }], 10n)))
      .toMatchObject({ timestamp: 20n });
    expect(Result.getOrThrow(snapshot.nativeKeyTransition(index, key(7), 10n))).toBeUndefined();
  });

  it("retains separate key-away/key-back transitions without netting their logical commits", () => {
    const log = new CoreWriteLog(10n);
    append(log, 20n, [write(7, true, 5n), write(8, false, null)]);
    append(log, 30n, [write(8, true, 20n), write(7, false, null)]);
    expect(Result.getOrThrow(log.snapshot().nativeKeyTransition(index, key(7), 10n)))
      .toMatchObject({ timestamp: 30n });
    expect(Result.getOrThrow(log.snapshot().nativeKeyTransition(index, key(8), 10n)))
      .toMatchObject({ timestamp: 30n });
  });

  it("freezes the upper frontier before a later event overwrites its key timestamp", () => {
    const log = new CoreWriteLog(10n);
    append(log, 20n, [write(7, false, null)]);
    const frozen = log.snapshot();
    append(log, 30n, [write(7, true, 20n)]);
    expect(Result.getOrThrow(frozen.nativeKeyTransition(index, key(7), 10n)))
      .toMatchObject({ timestamp: 20n });
    expect(Result.getOrThrow(log.snapshot().nativeKeyTransition(index, key(7), 10n)))
      .toMatchObject({ timestamp: 30n });
    expect(Result.isFailure(frozen.nativeKeyTransition(index, key(7), 21n))).toBe(true);
  });

  it("charges transition-only retention and never treats a pruned or pre-bootstrap key as proof", () => {
    const log = new CoreWriteLog(10n, { minRetentionNanoseconds: 0n, maxRetentionNanoseconds: 100n, softMaxBytes: 1 });
    append(log, 20n, [write(7, false, null)]);
    const frozen = log.snapshot();
    append(log, 30n, [write(8, false, null)]);
    expect(Result.isFailure(log.snapshot().nativeKeyTransition(index, key(7), 10n))).toBe(true);
    expect(Result.getOrThrow(log.snapshot().nativeKeyTransition(index, key(7), 20n))).toBeUndefined();
    expect(Result.getOrThrow(frozen.nativeKeyTransition(index, key(7), 10n)))
      .toMatchObject({ timestamp: 20n });
    expect(Result.isFailure(frozen.nativeKeyTransition(index, key(99), 9n))).toBe(true);
    expect(Result.getOrThrow(frozen.nativeKeyTransition(index, key(99), 10n))).toBeUndefined();
  });

  it("does not charge a second retention tree for Source-only event batches", () => {
    const log = new CoreWriteLog(10n, { minRetentionNanoseconds: 0n, maxRetentionNanoseconds: 100n, softMaxBytes: 1 });
    log.append(20n, indexKeysFromWrites([write(7, false, null)]), 0);
    log.append(30n, indexKeysFromWrites([write(8, false, null)]), 0);
    expect(log.snapshot().minimumTimestamp).toBe(10n);
    expect(Result.getOrThrow(log.snapshot().nativeKeyTransition(index, key(7), 10n))).toBeUndefined();
    expect(Result.getOrThrow(log.snapshot().conflict([{ indexId: index, intervals: [pointInterval(key(7))] }], 10n)))
      .toMatchObject({ timestamp: 20n });
  });

  it("publishes Source writes without native transition certificates through the actual committer", async () => {
    const fixture = await createCorePGliteFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const options = { now: Effect.succeed(1_000_000_000n), randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)),
        schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxBatchDelayMilliseconds: 0 };
      const lease = yield* fixture.persistence.acquireLease();
      const initial = yield* bootstrapCore(fixture.persistence, lease, options);
      const committer = yield* makeCoreCommitter(fixture.persistence, lease, initial.timestamp,
        initial.registry, initial.resident, options, initial.retention);
      const vault = new CoreFinalizationVault();
      const context = createCoreTransaction({ snapshot: yield* fixture.persistence.readSnapshot(initial.timestamp, initial.retention),
        registry: initial.registry, ...(yield* prepareCoreTransactionIds(options)), vault });
      const id = yield* context.transaction.insert("source_rows", { amount: 1 });
      const finalized = vault.take(yield* context.transaction.finalize());
      if (finalized === undefined) return yield* Effect.die(new Error("Missing Source finalization"));
      yield* committer.submit(finalized);
      const selected = yield* Effect.fromResult(committer.selectNativeSnapshot());
      const table = selected.registry.table("source_rows")?.definition;
      const byId = table?.indexes.find(candidate => candidate.name === "by_id");
      if (byId === undefined) return yield* Effect.die(new Error("Missing Source by-ID index"));
      const fullKey = yield* Effect.fromResult(encodeIndexKey([], id));
      expect(selected.writeLog.timestamp).toBe(selected.timestamp);
      expect(Result.getOrThrow(selected.writeLog.nativeKeyTransition(byId.ref.id, fullKey, initial.timestamp))).toBeUndefined();
      expect(Result.getOrThrow(selected.writeLog.conflict([{ indexId: byId.ref.id,
        intervals: [pointInterval(fullKey)] }], initial.timestamp))).toMatchObject({ timestamp: selected.timestamp });
    }))); } finally { await fixture.close(); }
  }, 30_000);
});
