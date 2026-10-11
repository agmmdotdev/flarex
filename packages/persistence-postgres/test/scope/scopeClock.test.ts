import { MetadataSequenceSchema, type MetadataSequence } from "flarex-protocol/commit-protocol";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  LegacyV1StorageGenerationSchema,
  MAX_PERSISTED_SIGNED_INT64_V1,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  type CommitSeq,
  type ScopeEpoch,
  type ScopeId,
  type StorageGeneration,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import {
  MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH,
  TransactionAuthorizationRevocationEpochSchema,
  type TransactionAuthorizationRevocationEpoch,
} from "flarex-protocol/transaction-session";
import { describe, expect, expectTypeOf, it, vi } from "vitest";

import {
  ScopeClockCorruptionError,
  type FlarexPersistence,
  type ScopeClockRecord,
} from "../../src";
import type { FlarexMetadataDatabase } from "../../src/application/deployments";
import type { FlarexMetadataTransaction } from "../../src/database/metadataTransaction";
import { createPGlitePersistence } from "../../src/database/pglite";
import {
  advanceScopeAuthorizationRevocationEpochInTransactionEffect,
  decodeScopeClockRecord,
  decodeScopeClockRecordResult,
  getScopeClockResult,
  selectScopeClockRows,
  lockScopeClockForUpdateInTransactionEffect,
  requireScopeAuthorizationRevocationEpochInTransactionEffect,
  type LockScopeClockForUpdateError,
  type AdvanceScopeAuthorizationRevocationEpochError,
  type AdvanceScopeAuthorizationRevocationEpochResult,
  type ScopeAuthorizationRevocationEpochReadError,
  ScopeAuthorizationRevocationEpochExhaustedError,
  ScopeAuthorizationRevocationEpochPersistenceError,
  openExactAttemptScopeClockObservation,
  closeExactAttemptScopeClockObservation,
  lockScopeClockForShareInTransactionEffect,
  lockScopeClockForSnapshotReadInTransactionEffect,
  lockScopeClockForOrdinaryWriteInTransactionEffect,
  readProtectedScopeReadIdentity, requireProtectedScopeReadIdentity,
  readExactScopeWriteClockObservation, readProtectedScopeTransactionTimestamp, protectedScopeTransactionTimestampObservationIdentity,
  hasProtectedScopeTransactionTimestampIssuer,
} from "../../src/scope/scopeClock";
import {
  ScopeClockNotFoundError,
} from "../../src/scope/scopeClockErrors";
import {
  insertInitialScopeClockInTransactionResult,
  type InsertInitialScopeClockError,
  type InsertInitialScopeClockResult,
  ScopeClockInitializationCorruptionError,
} from "../../src/scope/scopeClockInitialization";
import { flarexSchema, fxSystemScopeClocks, fxSystemScopeExecutionAuthorities } from "../../src/database/schema";
import { runEffect, runEffectFailure } from "../support/effectTestRuntime";
import { newTestPGlite } from "../support/pgliteSearchExtensions";

type ForbiddenScopeClockMethod = Extract<
  keyof FlarexPersistence,
  | "advanceScopeClock"
  | "advanceScopeAuthorizationRevocationEpoch"
  | "advanceScopeAuthorizationRevocationEpochInTransaction"
  | "allocateCommitSeq"
  | "lockScopeClock"
  | "nextCommitSeq"
  | "requireScopeAuthorizationRevocationEpochInTransaction"
  | "setScopeClock"
  | "updateScopeClock"
>;

describe("scope clock", () => {
  it("keeps authority values branded and exposes no production allocator", () => {
    expectTypeOf<ScopeClockRecord["scopeId"]>().toEqualTypeOf<ScopeId>();
    expectTypeOf<ScopeClockRecord["epoch"]>().toEqualTypeOf<ScopeEpoch>();
    expectTypeOf<ScopeClockRecord["storageGeneration"]>()
      .toEqualTypeOf<StorageGeneration>();
    expectTypeOf<ScopeClockRecord["storageGenerationFence"]>()
      .toEqualTypeOf<StorageGenerationFence>();
    expectTypeOf<ScopeClockRecord["lastCommitSeq"]>()
      .toEqualTypeOf<CommitSeq>();
    expectTypeOf<ScopeClockRecord["lastMetadataSequence"]>()
      .toEqualTypeOf<MetadataSequence>();
    expectTypeOf<ScopeClockRecord["oldestAvailableCommitSeq"]>()
      .toEqualTypeOf<CommitSeq>();
    expectTypeOf<ForbiddenScopeClockMethod>().toEqualTypeOf<never>();
    expectTypeOf<
      ReturnType<
        typeof requireScopeAuthorizationRevocationEpochInTransactionEffect
      >
    >().toEqualTypeOf<Effect.Effect<
      TransactionAuthorizationRevocationEpoch,
      ScopeAuthorizationRevocationEpochReadError
    >>();
    expectTypeOf<
      ReturnType<
        typeof advanceScopeAuthorizationRevocationEpochInTransactionEffect
      >
    >().toEqualTypeOf<Effect.Effect<
      AdvanceScopeAuthorizationRevocationEpochResult,
      AdvanceScopeAuthorizationRevocationEpochError
    >>();
    expectTypeOf<
      ReturnType<typeof lockScopeClockForUpdateInTransactionEffect>
    >().toEqualTypeOf<Effect.Effect<
      ScopeClockRecord,
      LockScopeClockForUpdateError
    >>();
    expectTypeOf<FlarexMetadataDatabase>()
      .not.toMatchTypeOf<
        Parameters<typeof lockScopeClockForUpdateInTransactionEffect>[0]
      >();
    expectTypeOf<FlarexMetadataDatabase>()
      .not.toMatchTypeOf<
        Parameters<
          typeof advanceScopeAuthorizationRevocationEpochInTransactionEffect
        >[0]
      >();
  });

  it("reuses only the held exact clock, owns its Date, and refreshes after revocation", async () => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    await persistence.migrate();
    const scopeId = ScopeIdSchema.make("scope_exact_clock_observation");
    const independent = ScopeIdSchema.make("scope_exact_clock_independent");
    try {
      for (const selectedScope of [scopeId, independent]) await insertDefaultScopeClock(persistence, {
        scopeId: selectedScope,
        storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1"),
        epoch: ScopeEpochSchema.make(`epoch-${selectedScope}`),
      });
      await persistence.drizzle.transaction(async tx => {
        const held = await runEffect(lockScopeClockForShareInTransactionEffect(tx, scopeId));
        const originalTime = held.updatedAt.getTime();
        openExactAttemptScopeClockObservation(tx, held, TransactionAuthorizationRevocationEpochSchema.make(0n), "share");
        try {
          held.updatedAt.setTime(0);
          const first = await runEffect(lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId));
          expect(first.updatedAt.getTime()).toBe(originalTime);
          first.updatedAt.setTime(1);
          const next = await runEffect(lockScopeClockForShareInTransactionEffect(tx, scopeId));
          expect(next.updatedAt.getTime()).toBe(originalTime);
          expect(await runEffect(lockScopeClockForSnapshotReadInTransactionEffect(tx, independent)))
            .toMatchObject({ scopeId: independent });
          expect(await runEffect(requireScopeAuthorizationRevocationEpochInTransactionEffect(tx, scopeId))).toBe(0n);
          await runEffect(advanceScopeAuthorizationRevocationEpochInTransactionEffect(tx, scopeId));
          expect(await runEffect(requireScopeAuthorizationRevocationEpochInTransactionEffect(tx, scopeId))).toBe(1n);
          expect((await runEffect(lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId))).updatedAt.getTime())
            .toBeGreaterThanOrEqual(originalTime);
        } finally {
          closeExactAttemptScopeClockObservation(tx);
        }
      });
      await persistence.drizzle.transaction(async tx => {
        expect(await runEffect(requireScopeAuthorizationRevocationEpochInTransactionEffect(tx, scopeId))).toBe(1n);
      });
    } finally {
      await db.close();
    }
  });

  it.each(["snapshot", "share", "attempt"] as const)("lends native identity only for the current protected %s lifetime", async lock => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    await persistence.migrate();
    const ordinal = lock === "snapshot" ? "1" : lock === "share" ? "2" : "3";
    const scopeId = ScopeIdSchema.make(`scope_5b000000-0000-0000-0000-00000000000${ordinal}`);
    try {
      await persistence.drizzle.transaction(async tx => {
        Result.getOrThrow(await insertInitialScopeClockInTransactionResult(tx, {
          scopeId, initialEpoch: ScopeEpochSchema.make("epoch-protected-read"),
        }));
        const clock = await runEffect(lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId));
        const priorIdentity = readProtectedScopeReadIdentity(tx, scopeId);
        if (priorIdentity === undefined) throw new Error("Native identity loan was not issued");
        const priorTime = Result.getOrThrow(protectedScopeTransactionTimestampObservationIdentity(tx, scopeId));
        openExactAttemptScopeClockObservation(tx, clock, TransactionAuthorizationRevocationEpochSchema.make(0n), lock);
        expect(Result.isFailure(requireProtectedScopeReadIdentity(tx, priorIdentity))).toBe(true);
        expect(Result.isFailure(readProtectedScopeTransactionTimestamp(tx, scopeId, priorTime))).toBe(true);
        expect(Result.isFailure(readProtectedScopeTransactionTimestamp(tx, scopeId))).toBe(true);
        expect(() => openExactAttemptScopeClockObservation(tx, clock, TransactionAuthorizationRevocationEpochSchema.make(0n), lock))
          .toThrow("Exact attempt clock scope already opened");
        const identity = readProtectedScopeReadIdentity(tx, scopeId);
        if (identity === undefined) throw new Error("Native identity was not issued");
        expect(Object.isFrozen(identity)).toBe(true);
        expect(Result.getOrThrow(requireProtectedScopeReadIdentity(tx, identity))).toBe(identity);
        expect(Result.isFailure(requireProtectedScopeReadIdentity(scopeClockReadTransaction(async () => []), identity))).toBe(true);
        expect(Result.isFailure(requireProtectedScopeReadIdentity(tx, { ...identity }))).toBe(true);
        expect(readProtectedScopeReadIdentity(tx, ScopeIdSchema.make("scope_other_identity"))).toBeUndefined();
        if (lock !== "attempt") expect(readExactScopeWriteClockObservation(tx, scopeId)).toBeUndefined();
        closeExactAttemptScopeClockObservation(tx);
        expect(Result.isFailure(requireProtectedScopeReadIdentity(tx, identity))).toBe(true);
        openExactAttemptScopeClockObservation(tx, clock, TransactionAuthorizationRevocationEpochSchema.make(0n), lock);
        expect(Result.isFailure(requireProtectedScopeReadIdentity(tx, identity))).toBe(true);
        expect(readProtectedScopeReadIdentity(tx, scopeId)).not.toBe(identity);
        closeExactAttemptScopeClockObservation(tx);
      });
    } finally { await db.close(); }
  });

  it("retains actual native transaction time only through its snapshot admission lifetime", async () => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    await persistence.migrate();
    const scopeId = ScopeIdSchema.make("scope_native_transaction_time");
    try {
      await persistence.drizzle.transaction(async tx => {
        Result.getOrThrow(await insertInitialScopeClockInTransactionResult(tx, {
          scopeId, initialEpoch: ScopeEpochSchema.make("epoch-native-time"),
        }));
        const clock = await runEffect(lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId));
        const rows = await tx.select({ timestamp: sql<unknown>`current_timestamp::text` }).from(fxSystemScopeClocks)
          .where(eq(fxSystemScopeClocks.scopeId, scopeId)).limit(1);
        const timestamp = rows[0]?.timestamp;
        closeExactAttemptScopeClockObservation(tx);
        openExactAttemptScopeClockObservation(tx, clock, TransactionAuthorizationRevocationEpochSchema.make(0n), "snapshot", { timestamp });
        const identity = Result.getOrThrow(protectedScopeTransactionTimestampObservationIdentity(tx, scopeId));
        const prepare = vi.spyOn(tx._.session, "prepareQuery");
        try {
          expect(Result.getOrThrow(readProtectedScopeTransactionTimestamp(tx, scopeId, identity))).toBe(timestamp);
          expect(Result.isFailure(readProtectedScopeTransactionTimestamp(tx, ScopeIdSchema.make("scope_foreign_time"), identity))).toBe(true);
          const foreign = scopeClockReadTransaction(async () => []);
          openExactAttemptScopeClockObservation(foreign, clock, TransactionAuthorizationRevocationEpochSchema.make(0n), "snapshot", { timestamp });
          expect(Result.getOrThrow(readProtectedScopeTransactionTimestamp(foreign, scopeId))).toBe(timestamp);
          expect(Result.isFailure(readProtectedScopeTransactionTimestamp(foreign, scopeId, identity))).toBe(true);
          closeExactAttemptScopeClockObservation(foreign);
          closeExactAttemptScopeClockObservation(tx);
          expect(Result.isFailure(readProtectedScopeTransactionTimestamp(tx, scopeId, identity))).toBe(true);
          openExactAttemptScopeClockObservation(tx, clock, TransactionAuthorizationRevocationEpochSchema.make(0n), "snapshot", { timestamp });
          expect(Result.getOrThrow(readProtectedScopeTransactionTimestamp(tx, scopeId))).toBe(timestamp);
          expect(Result.isFailure(readProtectedScopeTransactionTimestamp(tx, scopeId, identity))).toBe(true);
          closeExactAttemptScopeClockObservation(tx);
          expect(() => openExactAttemptScopeClockObservation(tx, clock, TransactionAuthorizationRevocationEpochSchema.make(0n), "share", { timestamp }))
            .toThrow("Native transaction time requires protected native admission");
          openExactAttemptScopeClockObservation(tx, clock, TransactionAuthorizationRevocationEpochSchema.make(0n), "snapshot");
          expect(Result.isFailure(readProtectedScopeTransactionTimestamp(tx, scopeId))).toBe(true);
          expect(prepare).not.toHaveBeenCalled();
        } finally { prepare.mockRestore(); closeExactAttemptScopeClockObservation(tx); }
      });
    } finally { await db.close(); }
  });

  it("refreshes native clocks while lending only immutable identity and transaction time", async () => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    await persistence.migrate();
    const scopeId = ScopeIdSchema.make("scope_5b000000-0000-0000-0000-000000000005");
    try {
      await persistence.drizzle.transaction(async tx => {
        Result.getOrThrow(await insertInitialScopeClockInTransactionResult(tx, {
          scopeId, initialEpoch: ScopeEpochSchema.make("epoch_5b000000-0000-0000-0000-000000000005"),
        }));
        try {
          const first = await runEffect(lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId));
          const identity = readProtectedScopeReadIdentity(tx, scopeId);
          if (identity === undefined) throw new Error("Native identity was not issued");
          const lifetime = Result.getOrThrow(protectedScopeTransactionTimestampObservationIdentity(tx, scopeId));
          const timestamp = Result.getOrThrow(readProtectedScopeTransactionTimestamp(tx, scopeId, lifetime));
          expect(typeof timestamp).toBe("string");
          expect(first.lastCommitSeq).toBe(0n);
          expect(Object.isFrozen(identity)).toBe(true);
          expect(readExactScopeWriteClockObservation(tx, scopeId)).toBeUndefined();
          const foreign = scopeClockReadTransaction(async () => []);
          expect(Result.isFailure(requireProtectedScopeReadIdentity(foreign, identity))).toBe(true);
          expect(Result.isFailure(requireProtectedScopeReadIdentity(tx, { ...identity }))).toBe(true);
          expect(Result.isFailure(readProtectedScopeTransactionTimestamp(foreign, scopeId, lifetime))).toBe(true);
          expect(Result.isFailure(readProtectedScopeTransactionTimestamp(tx, ScopeIdSchema.make("scope_other"), lifetime))).toBe(true);
          // PGlite has one backend; this real row update proves fresh SQL without
          // claiming the independent-writer concurrency proof in the PG lane.
          await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(1n) })
            .where(eq(fxSystemScopeClocks.scopeId, scopeId));
          await tx.update(fxSystemScopeExecutionAuthorities)
            .set({ authorizationRevocationEpoch: TransactionAuthorizationRevocationEpochSchema.make(1n) })
            .where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId));
          const prepare = vi.spyOn(tx._.session, "prepareQuery");
          try {
            expect((await runEffect(lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId))).lastCommitSeq).toBe(1n);
            expect(readProtectedScopeReadIdentity(tx, scopeId)).toBe(identity);
            expect(Result.getOrThrow(protectedScopeTransactionTimestampObservationIdentity(tx, scopeId))).toBe(lifetime);
            expect(Result.getOrThrow(readProtectedScopeTransactionTimestamp(tx, scopeId, lifetime))).toBe(timestamp);
            expect(prepare).toHaveBeenCalledTimes(2);
            expect(await runEffect(requireScopeAuthorizationRevocationEpochInTransactionEffect(tx, scopeId))).toBe(1n);
            expect(prepare).toHaveBeenCalledTimes(3);
          } finally { prepare.mockRestore(); }
          // Strong publication acquisition replaces the loan, even though the
          // database's transaction timestamp itself remains stable.
          expect((await runEffect(lockScopeClockForOrdinaryWriteInTransactionEffect(tx, scopeId))).lastCommitSeq).toBe(1n);
          expect(Result.isFailure(requireProtectedScopeReadIdentity(tx, identity))).toBe(true);
          expect(Result.isFailure(readProtectedScopeTransactionTimestamp(tx, scopeId, lifetime))).toBe(true);
          expect(readExactScopeWriteClockObservation(tx, scopeId)?.lastCommitSeq).toBe(1n);
          closeExactAttemptScopeClockObservation(tx);
          expect(hasProtectedScopeTransactionTimestampIssuer(tx)).toBe(true);
          expect(Result.isFailure(readProtectedScopeTransactionTimestamp(tx, scopeId))).toBe(true);
        } finally { closeExactAttemptScopeClockObservation(tx); }
      }, { isolationLevel: "read committed" });
    } finally { await db.close(); }
  });

  it("revokes the native identity and time loan when a fresh snapshot read fails", async () => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    await persistence.migrate();
    const scopeId = ScopeIdSchema.make("scope_5b000000-0000-0000-0000-000000000006");
    try {
      await persistence.drizzle.transaction(async tx => {
        Result.getOrThrow(await insertInitialScopeClockInTransactionResult(tx, {
          scopeId, initialEpoch: ScopeEpochSchema.make("epoch_5b000000-0000-0000-0000-000000000006"),
        }));
        try {
          await runEffect(lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId));
          const identity = readProtectedScopeReadIdentity(tx, scopeId);
          if (identity === undefined) throw new Error("Native identity was not issued");
          const lifetime = Result.getOrThrow(protectedScopeTransactionTimestampObservationIdentity(tx, scopeId));
          expect(await runEffectFailure(lockScopeClockForSnapshotReadInTransactionEffect(tx,
            ScopeIdSchema.make("scope_5b000000-0000-0000-0000-000000000007")))).toBeInstanceOf(ScopeClockNotFoundError);
          expect(Result.isFailure(requireProtectedScopeReadIdentity(tx, identity))).toBe(true);
          expect(Result.isFailure(readProtectedScopeTransactionTimestamp(tx, scopeId, lifetime))).toBe(true);
          expect(hasProtectedScopeTransactionTimestampIssuer(tx)).toBe(true);
          await runEffect(lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId));
          expect(readProtectedScopeReadIdentity(tx, scopeId)).not.toBe(identity);
          expect(Result.isFailure(readProtectedScopeTransactionTimestamp(tx, scopeId, lifetime))).toBe(true);
          closeExactAttemptScopeClockObservation(tx);
        } finally { closeExactAttemptScopeClockObservation(tx); }
      });
    } finally { await db.close(); }
  });

  it("retains the native timestamp undecoded and never accesses it before a refused clock", async () => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    await persistence.migrate();
    const scopeId = ScopeIdSchema.make("scope_5b000000-0000-0000-0000-00000000000a");
    try {
      await persistence.drizzle.transaction(async tx => {
        Result.getOrThrow(await insertInitialScopeClockInTransactionResult(tx, {
          scopeId, initialEpoch: ScopeEpochSchema.make("epoch_5b000000-0000-0000-0000-00000000000a"),
        }));
        const rows = await selectScopeClockRows(tx).where(eq(fxSystemScopeClocks.scopeId, scopeId));
        const row = rows[0];
        if (row === undefined) throw new Error("Native clock fixture is missing");
        let timestampReads = 0;
        let refuseClock = false;
        const rawTimestamp = "invalid managed timestamp";
        const captured = {
          ...row,
          get lastCommitSeq() { return refuseClock ? -1n : row.lastCommitSeq; },
          get transactionTimestamp() { timestampReads++; return rawTimestamp; },
        };
        const nativePrepare = tx._.session.prepareQuery.bind(tx._.session);
        const prepare = vi.spyOn(tx._.session, "prepareQuery").mockImplementation((...args) => {
          const query = nativePrepare(...args);
          // Deliberate foreign row outputs exercise ordering after native query
          // construction. Other witnesses execute both real native row codecs.
          vi.spyOn(query, "execute").mockResolvedValue([captured]);
          return query;
        });
        try {
          await runEffect(lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId));
          expect(timestampReads).toBe(1);
          expect(Result.getOrThrow(readProtectedScopeTransactionTimestamp(tx, scopeId))).toBe(rawTimestamp);
          await runEffect(lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId));
          expect(timestampReads).toBe(1);
          refuseClock = true;
          expect(await runEffectFailure(lockScopeClockForSnapshotReadInTransactionEffect(tx, scopeId))).toBeInstanceOf(ScopeClockCorruptionError);
          expect(timestampReads).toBe(1);
          expect(Result.isFailure(readProtectedScopeTransactionTimestamp(tx, scopeId))).toBe(true);
          expect(hasProtectedScopeTransactionTimestampIssuer(tx)).toBe(true);
        } finally { prepare.mockRestore(); closeExactAttemptScopeClockObservation(tx); }
      });
    } finally { await db.close(); }
  });

  it("returns an owned Date without invoking stateful time methods", () => {
    class StatefulDate extends Date {
      calls = 0;

      override getTime(): number {
        this.calls += 1;
        return this.calls === 1 ? 0 : Number.NaN;
      }
    }

    const source = new StatefulDate(0);
    const decoded = decodeScopeClockRecord({
      scopeId: ScopeIdSchema.make("scope_clock_stateful_date"),
      storageGeneration:
        LegacyV1StorageGenerationSchema.make("legacy_v1"),
      storageGenerationFence: StorageGenerationFenceSchema.make(1n),
      lastCommitSeq: CommitSeqSchema.make(0n),
    lastMetadataSequence: MetadataSequenceSchema.make(0n),
      oldestAvailableCommitSeq: CommitSeqSchema.make(0n),
      epoch: ScopeEpochSchema.make("epoch-stateful-date"),
      updatedAt: source,
    });

    expect(decoded.updatedAt).toEqual(new Date(0));
    expect(decoded.updatedAt).not.toBe(source);
    expect(Object.getPrototypeOf(decoded.updatedAt)).toBe(Date.prototype);
    expect(source.calls).toBe(0);
  });

  it("returns typed corruption for malformed stored clock fields", () => {
    const valid = validScopeClockRow();
    const invalid = [
      {
        row: { ...valid, scopeId: 42 },
        reason: "scope ID is invalid",
      },
      {
        row: { ...valid, epoch: 42 },
        reason: "epoch is invalid",
      },
      {
        row: { ...valid, storageGeneration: "unknown_v1" },
        reason: "storage generation is unsupported",
      },
      {
        row: { ...valid, storageGenerationFence: 1 },
        reason: "storage generation fence is invalid",
      },
      {
        row: {
          ...valid,
          storageGenerationFence: MAX_PERSISTED_SIGNED_INT64_V1 + 1n,
        },
        reason: "storage generation fence is outside the signed-bigint range",
      },
      {
        row: { ...valid, lastCommitSeq: 1 },
        reason: "last commit sequence is invalid",
      },
      {
        row: {
          ...valid,
          lastCommitSeq: MAX_PERSISTED_SIGNED_INT64_V1 + 1n,
        },
        reason: "last commit sequence is outside the signed-bigint range",
      },
      {
        row: { ...valid, lastMetadataSequence: "0" },
        reason: "metadata sequence is invalid",
      },
      {
        row: { ...valid, lastMetadataSequence: -1n },
        reason: "metadata sequence is invalid",
      },
      {
        row: { ...valid, lastMetadataSequence: MAX_PERSISTED_SIGNED_INT64_V1 + 1n },
        reason: "metadata sequence is invalid",
      },
      {
        row: { ...valid, oldestAvailableCommitSeq: 1 },
        reason: "oldest available commit sequence is invalid",
      },
      {
        row: { ...valid, oldestAvailableCommitSeq: -1n },
        reason: "oldest available commit sequence is outside the retained range",
      },
      {
        row: { ...valid, oldestAvailableCommitSeq: 1n },
        reason: "oldest available commit sequence is outside the retained range",
      },
      {
        row: { ...valid, updatedAt: new Date(Number.NaN) },
        reason: "updated timestamp is invalid",
      },
    ] as const;

    for (const { row, reason } of invalid) {
      const result = decodeScopeClockRecordResult(row);
      expect(Result.isFailure(result)).toBe(true);
      if (Result.isFailure(result)) {
        expect(result.failure).toBeInstanceOf(ScopeClockCorruptionError);
        expect(result.failure).toMatchObject({ reason });
      }
      expect(() => decodeScopeClockRecord(row)).toThrow(
        ScopeClockCorruptionError,
      );
    }
  });

  it("short-circuits typed clock corruption and preserves accessor defects", () => {
    const laterDefect = new Error("later scope-clock epoch accessor defect");
    const invalidScope = {
      ...validScopeClockRow(),
      scopeId: "\t\n",
    };
    Object.defineProperty(invalidScope, "epoch", {
      enumerable: true,
      get() {
        throw laterDefect;
      },
    });

    const earlyFailure = decodeScopeClockRecordResult(invalidScope);
    expect(Result.isFailure(earlyFailure)).toBe(true);
    if (Result.isFailure(earlyFailure)) {
      expect(earlyFailure.failure).toMatchObject({
        reason: "scope ID is empty",
      });
    }

    const accessorDefect = new Error("scope-clock row accessor defect");
    const defectiveRow = new Proxy(validScopeClockRow(), {
      get(target, property, receiver) {
        if (property === "epoch") throw accessorDefect;
        return Reflect.get(target, property, receiver);
      },
    });
    expect(() => decodeScopeClockRecordResult(defectiveRow)).toThrow(
      accessorDefect,
    );
  });

  it("keeps initialization decisions typed and foreign query rejection intact", async () => {
    const scopeId = ScopeIdSchema.make("scope_clock_initialization_result");
    const initialEpoch = ScopeEpochSchema.make("epoch-initialization-result");
    const success = await insertInitialScopeClockInTransactionResult(
      scopeClockInitializationDatabase({
        insert: () => Promise.resolve([{ scopeId }]),
        read: () => Promise.resolve([{
          ...validScopeClockRow(),
          scopeId,
          storageGeneration: "legacy_v1",
          epoch: initialEpoch,
        }]),
      }),
      { scopeId, initialEpoch },
    );

    expectTypeOf(success).toEqualTypeOf<Result.Result<
      InsertInitialScopeClockResult,
      InsertInitialScopeClockError
    >>();
    expect(Result.isSuccess(success)).toBe(true);
    if (Result.isSuccess(success)) {
      expect(success.success).toMatchObject({
        created: true,
        clock: { scopeId, epoch: initialEpoch },
      });
    }

    const missing = await insertInitialScopeClockInTransactionResult(
      scopeClockInitializationDatabase({
        insert: () => Promise.resolve([{ scopeId }]),
        read: () => Promise.resolve([]),
      }),
      { scopeId, initialEpoch },
    );
    expect(Result.isFailure(missing)).toBe(true);
    if (Result.isFailure(missing)) {
      expect(missing.failure).toBeInstanceOf(
        ScopeClockInitializationCorruptionError,
      );
      expect(missing.failure).toMatchObject({
        _tag: "ScopeClockInitializationCorruptionError",
        scopeId,
        message: `Scope clock disappeared during initialization: ${scopeId}`,
      });
    }

    const malformed = await insertInitialScopeClockInTransactionResult(
      scopeClockInitializationDatabase({
        insert: () => Promise.resolve([]),
        read: () => Promise.resolve([{
          ...validScopeClockRow(),
          scopeId: 42,
        }]),
      }),
      { scopeId, initialEpoch },
    );
    expect(Result.isFailure(malformed)).toBe(true);
    if (Result.isFailure(malformed)) {
      expect(malformed.failure).toBeInstanceOf(ScopeClockCorruptionError);
      expect(malformed.failure).toMatchObject({
        reason: "scope ID is invalid",
      });
    }

    const insertDriverFailure = new Error("scope clock insert driver failure");
    let readCalls = 0;
    await expect(insertInitialScopeClockInTransactionResult(
      scopeClockInitializationDatabase({
        insert: () => Promise.reject(insertDriverFailure),
        read: () => {
          readCalls += 1;
          return Promise.resolve([]);
        },
      }),
      { scopeId, initialEpoch },
    )).rejects.toBe(insertDriverFailure);
    expect(readCalls).toBe(0);

    const readDriverFailure = new Error("scope clock read driver failure");
    await expect(insertInitialScopeClockInTransactionResult(
      scopeClockInitializationDatabase({
        insert: () => Promise.resolve([]),
        read: () => Promise.reject(readDriverFailure),
      }),
      { scopeId, initialEpoch },
    )).rejects.toBe(readDriverFailure);

    expectTypeOf(getScopeClockResult).returns.toEqualTypeOf<Promise<
      Result.Result<ScopeClockRecord | null, ScopeClockCorruptionError>
    >>();
  });

  it("reads independent scope clocks with exact bigint values", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const emptyScopeId = ScopeIdSchema.make("scope_clock_empty");
    const largeScopeId = ScopeIdSchema.make("scope_clock_large");

    await insertDefaultScopeClock(persistence, {
      scopeId: emptyScopeId,
      storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1"),
      epoch: ScopeEpochSchema.make("epoch-empty"),
    });
    await insertScopeClockFixture(persistence, {
      scopeId: largeScopeId,
      storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: StorageGenerationFenceSchema.make(
        9_007_199_254_740_993n,
      ),
      lastCommitSeq: CommitSeqSchema.make(9_007_199_254_740_993n),
    lastMetadataSequence: MetadataSequenceSchema.make(0n),
      epoch: ScopeEpochSchema.make("epoch-large"),
      updatedAt: new Date("2026-07-10T00:00:00.000Z"),
    });

    await expect(persistence.getScopeClock(emptyScopeId)).resolves.toMatchObject({
      scopeId: emptyScopeId,
      storageGeneration: "legacy_v1",
      storageGenerationFence: 1n,
      lastCommitSeq: 0n,
    lastMetadataSequence: MetadataSequenceSchema.make(0n),
      epoch: "epoch-empty",
    });
    const largeClock = await persistence.getScopeClock(largeScopeId);
    expect(largeClock).toEqual({
      scopeId: largeScopeId,
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 9_007_199_254_740_993n,
      lastCommitSeq: 9_007_199_254_740_993n,
      lastMetadataSequence: MetadataSequenceSchema.make(0n),
      oldestAvailableCommitSeq: 0n,
      epoch: "epoch-large",
      updatedAt: new Date("2026-07-10T00:00:00.000Z"),
    });
    expect(largeClock?.updatedAt).toBeInstanceOf(Date);
    await expect(
      persistence.getScopeClock(ScopeIdSchema.make("scope_clock_missing")),
    ).resolves.toBeNull();
  });

  it("requires explicit generation and enforces clock constraints", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

    await expect(
      persistence.query(
        `with sequencer as (insert into fx_system_scope_clock (scope_id)
        values ($1) returning scope_id)
      insert into fx_system_scope_execution_authority (scope_id,epoch)
      select sequencer.scope_id,$2 from sequencer`,
        ["scope_missing_generation", "epoch-a"],
      ),
    ).rejects.toThrow();

    const invalidRows = [
      {
        suffix: "scope",
        scopeId: "\t\n",
        storageGeneration: "legacy_v1",
        fence: "1",
        commitSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "generation",
        scopeId: "scope_invalid_generation",
        storageGeneration: "unknown_v1",
        fence: "1",
        commitSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "fence",
        scopeId: "scope_invalid_fence",
        storageGeneration: "legacy_v1",
        fence: "0",
        commitSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "commit",
        scopeId: "scope_invalid_commit",
        storageGeneration: "legacy_v1",
        fence: "1",
        commitSeq: "-1",
        epoch: "epoch-a",
      },
      {
        suffix: "epoch",
        scopeId: "scope_invalid_epoch",
        storageGeneration: "legacy_v1",
        fence: "1",
        commitSeq: "0",
        epoch: "\u00a0\ufeff",
      },
    ] as const;

    for (const row of invalidRows) {
      await expect(
        persistence.query(
          `
            with sequencer as (insert into fx_system_scope_clock (scope_id,last_commit_seq)
        values ($1,$4) returning scope_id)
      insert into fx_system_scope_execution_authority (scope_id,storage_generation,storage_generation_fence,epoch)
      select sequencer.scope_id,$2,$3,$5 from sequencer
          `,
          [
            row.scopeId,
            row.storageGeneration,
            row.fence,
            row.commitSeq,
            row.epoch,
          ],
        ),
      ).rejects.toThrow();
    }

    const scopeId = ScopeIdSchema.make("scope_clock_unique");
    await insertDefaultScopeClock(persistence, {
      scopeId,
      storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1"),
      epoch: ScopeEpochSchema.make("epoch-unique"),
    });
    await expect(
      insertDefaultScopeClock(persistence, {
        scopeId,
        storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1"),
        epoch: ScopeEpochSchema.make("epoch-duplicate"),
      }),
    ).rejects.toThrow();

    await expect(
      persistence.query(
        `
          with sequencer as (insert into fx_system_scope_clock (scope_id)
        values ($1) returning scope_id)
      insert into fx_system_scope_execution_authority (scope_id,storage_generation,authorization_revocation_epoch,epoch)
      select sequencer.scope_id,'legacy_v1',-1,$2 from sequencer
        `,
        ["scope_invalid_authorization_epoch", "epoch-a"],
      ),
    ).rejects.toThrow();
  });

  it("reads exact private authorization epochs without widening the public clock", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const defaultScopeId = ScopeIdSchema.make("scope_authorization_default");
    const maximumScopeId = ScopeIdSchema.make("scope_authorization_maximum");
    await insertDefaultScopeClock(persistence, {
      scopeId: defaultScopeId,
      storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1"),
      epoch: ScopeEpochSchema.make("epoch-authorization-default"),
    });
    await insertDefaultScopeClock(persistence, {
      scopeId: maximumScopeId,
      storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1"),
      epoch: ScopeEpochSchema.make("epoch-authorization-maximum"),
    });
    await setScopeAuthorizationEpoch(
      persistence,
      maximumScopeId,
      MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH,
    );

    await expect(
      persistence.drizzle.transaction((tx) =>
        requireScopeAuthorizationRevocationEpochInTransaction(
          tx,
          defaultScopeId,
        ),
      ),
    ).resolves.toBe(0n);
    await expect(
      persistence.drizzle.transaction((tx) =>
        requireScopeAuthorizationRevocationEpochInTransaction(
          tx,
          maximumScopeId,
        ),
      ),
    ).resolves.toBe(MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH);
    await expect(persistence.getScopeClock(defaultScopeId)).resolves.not.toHaveProperty(
      "authorizationRevocationEpoch",
    );
    await expect(
      persistence.drizzle.transaction((tx) =>
        requireScopeAuthorizationRevocationEpochInTransaction(
          tx,
          ScopeIdSchema.make("scope_authorization_missing"),
        )
      ),
    ).rejects.toBeInstanceOf(ScopeClockNotFoundError);
  });

  it("fails closed on a corrupt persisted authorization epoch", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await persistence.exec(`
      alter table fx_system_scope_execution_authority
        drop constraint fx_scope_execution_authority_revocation_check
    `);
    const scopeId = ScopeIdSchema.make("scope_authorization_corrupt");
    await persistence.query(
      `
        with sequencer as (insert into fx_system_scope_clock (scope_id)
        values ($1) returning scope_id)
      insert into fx_system_scope_execution_authority (scope_id,storage_generation,authorization_revocation_epoch,epoch)
      select sequencer.scope_id,'legacy_v1',-1,$2 from sequencer
      `,
      [scopeId, "epoch-authorization-corrupt"],
    );

    await expect(
      persistence.drizzle.transaction((tx) =>
        requireScopeAuthorizationRevocationEpochInTransaction(tx, scopeId)
      ),
    ).rejects.toBeInstanceOf(ScopeClockCorruptionError);
  });

  it("maps rejected private epoch reads at the exact SQL edge", async () => {
    const rejection = new Error("authorization epoch read rejected");
    const scopeId = ScopeIdSchema.make("scope_authorization_read_rejection");
    const failure = await runEffectFailure(
      requireScopeAuthorizationRevocationEpochInTransactionEffect(
        scopeClockReadTransaction(() => Promise.reject(rejection)),
        scopeId,
      ),
    );

    expect(failure).toBeInstanceOf(
      ScopeAuthorizationRevocationEpochPersistenceError,
    );
    expect(failure).toMatchObject({
      _tag: "ScopeAuthorizationRevocationEpochPersistenceError",
      operation: "readForKeyShare",
      cause: rejection,
    });
  });

  it("preserves private epoch query construction failures as defects", async () => {
    const defect = new Error("authorization epoch query construction defect");
    const transaction = {
      select() {
        throw defect;
      },
    } as unknown as FlarexMetadataTransaction;
    const exit = await Effect.runPromiseExit(
      requireScopeAuthorizationRevocationEpochInTransactionEffect(
        transaction,
        ScopeIdSchema.make("scope_authorization_read_defect"),
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
  });

  it("waits for a pending private epoch read before interruption completes", async () => {
    const entered = deferredValue<void>();
    const query = deferredValue<ReadonlyArray<unknown>>();
    const transaction = scopeClockReadTransaction(() => {
      entered.resolve(undefined);
      return query.promise;
    });
    const fiber = Effect.runFork(
      requireScopeAuthorizationRevocationEpochInTransactionEffect(
        transaction,
        ScopeIdSchema.make("scope_authorization_read_interruption"),
      ),
    );

    await entered.promise;
    const completion = runEffect(Fiber.await(fiber));
    let interruptionSettled = false;
    const interruption = runEffect(Fiber.interrupt(fiber)).then(() => {
      interruptionSettled = true;
    });
    try {
      await delay(25);
      expect(interruptionSettled).toBe(false);
    } finally {
      query.resolve([]);
    }

    await interruption;
    const exit = await completion;
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });

  it("checked-increments only one scope with database time", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const scopeId = ScopeIdSchema.make("scope_authorization_advance");
    const independentScopeId = ScopeIdSchema.make(
      "scope_authorization_independent",
    );
    const oldUpdatedAt = new Date("2026-01-01T00:00:00.000Z");
    await insertScopeClockFixture(persistence, {
      scopeId,
      storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1"),
      storageGenerationFence: StorageGenerationFenceSchema.make(1n),
      lastCommitSeq: CommitSeqSchema.make(0n),
    lastMetadataSequence: MetadataSequenceSchema.make(0n),
      epoch: ScopeEpochSchema.make("epoch-authorization-advance"),
      updatedAt: oldUpdatedAt,
    });
    await insertDefaultScopeClock(persistence, {
      scopeId: independentScopeId,
      storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1"),
      epoch: ScopeEpochSchema.make("epoch-authorization-independent"),
    });

    await expect(
      persistence.drizzle.transaction((tx) =>
        advanceScopeAuthorizationRevocationEpochInTransaction(tx, scopeId),
      ),
    ).resolves.toEqual({ previous: 0n, current: 1n });
    await expect(
      persistence.drizzle.transaction((tx) =>
        requireScopeAuthorizationRevocationEpochInTransaction(tx, scopeId),
      ),
    ).resolves.toBe(1n);
    await expect(
      persistence.drizzle.transaction((tx) =>
        requireScopeAuthorizationRevocationEpochInTransaction(
          tx,
          independentScopeId,
        ),
      ),
    ).resolves.toBe(0n);
    const updated = await persistence.getScopeClock(scopeId);
    expect(updated?.updatedAt.getTime()).toBeGreaterThan(oldUpdatedAt.getTime());
  });

  it("rolls back increments and rejects signed-bigint exhaustion", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const rollbackScopeId = ScopeIdSchema.make("scope_authorization_rollback");
    const exhaustedScopeId = ScopeIdSchema.make("scope_authorization_exhausted");
    const oldUpdatedAt = new Date("2026-01-01T00:00:00.000Z");
    for (const [scopeId, epoch] of [
      [rollbackScopeId, "epoch-authorization-rollback"],
      [exhaustedScopeId, "epoch-authorization-exhausted"],
    ] as const) {
      await insertScopeClockFixture(persistence, {
        scopeId,
        storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1"),
        storageGenerationFence: StorageGenerationFenceSchema.make(1n),
        lastCommitSeq: CommitSeqSchema.make(0n),
    lastMetadataSequence: MetadataSequenceSchema.make(0n),
        epoch: ScopeEpochSchema.make(epoch),
        updatedAt: oldUpdatedAt,
      });
    }
    await setScopeAuthorizationEpoch(
      persistence,
      exhaustedScopeId,
      MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH,
    );

    await expect(
      persistence.drizzle.transaction(async (tx) => {
        await advanceScopeAuthorizationRevocationEpochInTransaction(
          tx,
          rollbackScopeId,
        );
        throw new Error("authorization-epoch-rollback-probe");
      }),
    ).rejects.toThrow("authorization-epoch-rollback-probe");
    await expect(
      persistence.drizzle.transaction((tx) =>
        requireScopeAuthorizationRevocationEpochInTransaction(
          tx,
          rollbackScopeId,
        ),
      ),
    ).resolves.toBe(0n);
    await expect(persistence.getScopeClock(rollbackScopeId)).resolves.toMatchObject(
      { updatedAt: oldUpdatedAt },
    );
    await expect(
      persistence.drizzle.transaction((tx) =>
        advanceScopeAuthorizationRevocationEpochInTransaction(
          tx,
          exhaustedScopeId,
        ),
      ),
    ).rejects.toBeInstanceOf(
      ScopeAuthorizationRevocationEpochExhaustedError,
    );
    await expect(
      persistence.drizzle.transaction((tx) =>
        requireScopeAuthorizationRevocationEpochInTransaction(
          tx,
          exhaustedScopeId,
        ),
      ),
    ).resolves.toBe(MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH);
  });

  it("fails closed when persisted authority is corrupt", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    await persistence.exec(`
      alter table fx_system_scope_execution_authority
        drop constraint fx_scope_execution_authority_generation_check,
        drop constraint fx_scope_execution_authority_fence_check,
        drop constraint fx_scope_execution_authority_floor_check,
        drop constraint fx_scope_execution_authority_epoch_check;
      alter table fx_system_scope_clock drop constraint fx_system_scope_clock_last_commit_seq_non_negative_check;
      alter table fx_system_scope_clock disable trigger fx_scope_authority_pair_integrity;
      alter table fx_system_scope_execution_authority disable trigger fx_scope_authority_pair_integrity
    `);

    const corruptRows = [
      {
        suffix: "generation",
        storageGeneration: "unknown_v1",
        fence: "1",
        commitSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "fence",
        storageGeneration: "legacy_v1",
        fence: "0",
        commitSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "commit",
        storageGeneration: "legacy_v1",
        fence: "1",
        commitSeq: "-1",
        epoch: "epoch-a",
      },
      {
        suffix: "epoch",
        storageGeneration: "legacy_v1",
        fence: "1",
        commitSeq: "0",
        epoch: "\t\n",
      },
    ] as const;

    for (const row of corruptRows) {
      const scopeId = ScopeIdSchema.make(`scope_corrupt_clock_${row.suffix}`);
      await persistence.query(
        `
          with sequencer as (insert into fx_system_scope_clock (scope_id,last_commit_seq)
        values ($1,$4) returning scope_id)
      insert into fx_system_scope_execution_authority (scope_id,storage_generation,storage_generation_fence,epoch)
      select sequencer.scope_id,$2,$3,$5 from sequencer
        `,
        [
          scopeId,
          row.storageGeneration,
          row.fence,
          row.commitSeq,
          row.epoch,
        ],
      );
      await expect(persistence.getScopeClock(scopeId)).rejects.toMatchObject({
        name: "ScopeClockCorruptionError",
        scopeId,
      });
      await expect(persistence.getScopeClock(scopeId)).rejects.toBeInstanceOf(
        ScopeClockCorruptionError,
      );
    }
  });

  it("locks only inside a transaction and rolls test mutations back", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();
    const scopeId = ScopeIdSchema.make("scope_00000000-0000-5000-8000-000000000071");
    await insertDefaultScopeClock(persistence, {
      scopeId,
      storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1"),
      epoch: ScopeEpochSchema.make("epoch_00000000-0000-5000-8000-000000000072"),
    });
    const before = await persistence.getScopeClock(scopeId);

    await expect(
      persistence.drizzle.transaction(async (tx) => {
        const locked = await runEffect(
          lockScopeClockForUpdateInTransactionEffect(tx, scopeId),
        );
        expect(locked).toEqual(before);
        await tx
          .update(fxSystemScopeExecutionAuthorities)
          .set({
            storageGeneration:
              FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
            storageGenerationFence: StorageGenerationFenceSchema.make(2n),
            epoch: ScopeEpochSchema.make("epoch_00000000-0000-5000-8000-000000000073"),
            updatedAt: new Date("2026-07-11T00:00:00.000Z"),
          })
          .where(eq(fxSystemScopeExecutionAuthorities.scopeId, scopeId));
        await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(1n),
          updatedAt: new Date("2026-07-11T00:00:00.000Z") }).where(eq(fxSystemScopeClocks.scopeId, scopeId));
        throw new Error("scope-clock-rollback-probe");
      }),
    ).rejects.toThrow("scope-clock-rollback-probe");

    await expect(persistence.getScopeClock(scopeId)).resolves.toEqual(before);
    await expect(
      persistence.drizzle.transaction((tx) =>
        runEffect(
          lockScopeClockForUpdateInTransactionEffect(
            tx,
            ScopeIdSchema.make("scope_clock_missing"),
          ),
        ),
      ),
    ).rejects.toBeInstanceOf(ScopeClockNotFoundError);
  });
});

interface DefaultScopeClockFixture {
  readonly scopeId: ScopeId;
  readonly storageGeneration: StorageGeneration;
  readonly epoch: ScopeEpoch;
}

function validScopeClockRow() {
  return {
    scopeId: "scope_clock_result_decoder",
    scopeUuid: null,
    epochUuid: null,
    authorizationRevocationEpoch: 0n,
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: 1n,
    lastCommitSeq: 0n,
    lastMetadataSequence: MetadataSequenceSchema.make(0n),
    oldestAvailableCommitSeq: 0n,
    epoch: "epoch-clock-result-decoder",
    updatedAt: new Date("2026-07-10T00:00:00.000Z"),
  } as const;
}

async function insertDefaultScopeClock(
  persistence: Pick<FlarexPersistence, "query">,
  input: DefaultScopeClockFixture,
): Promise<void> {
  await persistence.query(
    `
      with sequencer as (insert into fx_system_scope_clock (scope_id)
        values ($1) returning scope_id)
      insert into fx_system_scope_execution_authority (scope_id,storage_generation,epoch)
      select sequencer.scope_id,$2,$3 from sequencer
    `,
    [input.scopeId, input.storageGeneration, input.epoch],
  );
}

interface ScopeClockFixture extends DefaultScopeClockFixture {
  readonly storageGenerationFence: StorageGenerationFence;
  readonly lastCommitSeq: CommitSeq;
  readonly lastMetadataSequence: typeof MetadataSequenceSchema.Type;
  readonly updatedAt: Date;
}

async function insertScopeClockFixture(
  persistence: Pick<FlarexPersistence, "query">,
  input: ScopeClockFixture,
): Promise<void> {
  await persistence.query(
    `
      with sequencer as (insert into fx_system_scope_clock (scope_id,last_commit_seq,updated_at,last_metadata_sequence)
        values ($1,$4,$6::timestamptz,$7) returning scope_id)
      insert into fx_system_scope_execution_authority (scope_id,storage_generation,storage_generation_fence,epoch,updated_at)
      select sequencer.scope_id,$2,$3,$5,$6::timestamptz from sequencer
    `,
    [
      input.scopeId,
      input.storageGeneration,
      input.storageGenerationFence.toString(),
      input.lastCommitSeq.toString(),
      input.epoch,
      input.updatedAt.toISOString(),
      input.lastMetadataSequence.toString(),
    ],
  );
}

async function setScopeAuthorizationEpoch(
  persistence: Pick<FlarexPersistence, "query">,
  scopeId: ScopeId,
  value: bigint,
): Promise<void> {
  await persistence.query(
    `
      update fx_system_scope_execution_authority
      set authorization_revocation_epoch = $2
      where scope_id = $1
    `,
    [scopeId, value.toString()],
  );
}

interface ScopeClockReadQueryStub
  extends PromiseLike<ReadonlyArray<unknown>> {
  from(): ScopeClockReadQueryStub;
  innerJoin(): ScopeClockReadQueryStub;
  leftJoin(): ScopeClockReadQueryStub;
  where(): ScopeClockReadQueryStub;
  limit(): ScopeClockReadQueryStub;
  for(): ScopeClockReadQueryStub;
}

function scopeClockInitializationDatabase(
  operations: Readonly<{
    insert(): Promise<ReadonlyArray<{ readonly scopeId: ScopeId }>>;
    read(): Promise<ReadonlyArray<unknown>>;
  }>,
): FlarexMetadataDatabase {
  const database = drizzle.mock({ schema: flarexSchema });
  const prepare = database._.session.prepareQuery.bind(database._.session);
  vi.spyOn(database._.session, "prepareQuery").mockImplementation((...args) => {
    const query = prepare(...args);
    // This witness owns foreign prepared-query outputs, including malformed
    // rows. Native transport/codec mapping has separate driver proofs.
    vi.spyOn(query, "execute").mockImplementation(() => args[5]?.type === "insert" ? operations.insert() : operations.read());
    return query;
  });
  return database;
}

function scopeClockReadTransaction(
  run: () => Promise<ReadonlyArray<unknown>>,
): FlarexMetadataTransaction {
  return {
    select() {
      const promise = run();
      const query: ScopeClockReadQueryStub = {
        from: () => query,
        innerJoin: () => query,
        leftJoin: () => query,
        where: () => query,
        limit: () => query,
        for: () => query,
        then: (onFulfilled, onRejected) =>
          promise.then(onFulfilled, onRejected),
      };
      return query;
    },
  } as unknown as FlarexMetadataTransaction;
}

function deferredValue<Value>(): Readonly<{
  promise: Promise<Value>;
  resolve(value: Value): void;
}> {
  let resolvePromise: ((value: Value) => void) | undefined;
  const promise = new Promise<Value>((resolve) => {
    resolvePromise = resolve;
  });
  return Object.freeze({
    promise,
    resolve(value: Value) {
      if (resolvePromise === undefined) {
        throw new Error("Deferred value was not initialized.");
      }
      resolvePromise(value);
    },
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function advanceScopeAuthorizationRevocationEpochInTransaction(
  db: Parameters<
    typeof advanceScopeAuthorizationRevocationEpochInTransactionEffect
  >[0],
  scopeId: ScopeId,
): Promise<AdvanceScopeAuthorizationRevocationEpochResult> {
  return runEffect(
    advanceScopeAuthorizationRevocationEpochInTransactionEffect(db, scopeId),
  );
}

async function requireScopeAuthorizationRevocationEpochInTransaction(
  db: Parameters<
    typeof requireScopeAuthorizationRevocationEpochInTransactionEffect
  >[0],
  scopeId: ScopeId,
): Promise<TransactionAuthorizationRevocationEpoch> {
  return runEffect(
    requireScopeAuthorizationRevocationEpochInTransactionEffect(db, scopeId),
  );
}
