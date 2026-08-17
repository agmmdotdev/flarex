import { eq } from "drizzle-orm";
import { Cause, Effect, Exit, Fiber, Result } from "effect";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  LegacyV1StorageGenerationSchema,
  MAX_PERSISTED_SIGNED_INT64_V1,
  OutboxSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  type CommitSeq,
  type OutboxSeq,
  type ScopeEpoch,
  type ScopeId,
  type StorageGeneration,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import {
  MAX_TRANSACTION_AUTHORIZATION_REVOCATION_EPOCH,
  type TransactionAuthorizationRevocationEpoch,
} from "flarex-protocol/transaction-session";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  ScopeClockCorruptionError,
  type FlarexPersistence,
  type ScopeClockRecord,
} from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import type { FlarexMetadataTransaction } from "../src/metadataTransaction";
import { createPGlitePersistence } from "../src/pglite";
import {
  advanceScopeAuthorizationRevocationEpochInTransactionEffect,
  decodeScopeClockRecord,
  decodeScopeClockRecordResult,
  getScopeClockResult,
  lockScopeClockForUpdateInTransactionEffect,
  requireScopeAuthorizationRevocationEpochInTransactionEffect,
  type LockScopeClockForUpdateError,
  type AdvanceScopeAuthorizationRevocationEpochError,
  type AdvanceScopeAuthorizationRevocationEpochResult,
  type ScopeAuthorizationRevocationEpochReadError,
  ScopeAuthorizationRevocationEpochExhaustedError,
  ScopeAuthorizationRevocationEpochPersistenceError,
  ScopeClockNotFoundError,
} from "../src/scopeClock";
import {
  insertInitialScopeClockInTransactionResult,
  type InsertInitialScopeClockError,
  type InsertInitialScopeClockResult,
  ScopeClockInitializationCorruptionError,
} from "../src/scopeClockInitialization";
import { fxSystemScopeClocks } from "../src/schema";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

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
    expectTypeOf<ScopeClockRecord["oldestAvailableCommitSeq"]>()
      .toEqualTypeOf<CommitSeq>();
    expectTypeOf<ScopeClockRecord["lastOutboxSeq"]>()
      .toEqualTypeOf<OutboxSeq>();
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
      oldestAvailableCommitSeq: CommitSeqSchema.make(0n),
      lastOutboxSeq: OutboxSeqSchema.make(0n),
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
        row: { ...valid, lastOutboxSeq: 1 },
        reason: "last outbox sequence is invalid",
      },
      {
        row: {
          ...valid,
          lastOutboxSeq: MAX_PERSISTED_SIGNED_INT64_V1 + 1n,
        },
        reason: "last outbox sequence is outside the signed-bigint range",
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
      lastOutboxSeq: OutboxSeqSchema.make(9_007_199_254_740_994n),
      epoch: ScopeEpochSchema.make("epoch-large"),
      updatedAt: new Date("2026-07-10T00:00:00.000Z"),
    });

    await expect(persistence.getScopeClock(emptyScopeId)).resolves.toMatchObject({
      scopeId: emptyScopeId,
      storageGeneration: "legacy_v1",
      storageGenerationFence: 1n,
      lastCommitSeq: 0n,
      lastOutboxSeq: 0n,
      epoch: "epoch-empty",
    });
    const largeClock = await persistence.getScopeClock(largeScopeId);
    expect(largeClock).toEqual({
      scopeId: largeScopeId,
      storageGeneration: "flarexdb_v1",
      storageGenerationFence: 9_007_199_254_740_993n,
      lastCommitSeq: 9_007_199_254_740_993n,
      oldestAvailableCommitSeq: 0n,
      lastOutboxSeq: 9_007_199_254_740_994n,
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
        `insert into fx_system_scope_clock (scope_id, epoch) values ($1, $2)`,
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
        outboxSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "generation",
        scopeId: "scope_invalid_generation",
        storageGeneration: "unknown_v1",
        fence: "1",
        commitSeq: "0",
        outboxSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "fence",
        scopeId: "scope_invalid_fence",
        storageGeneration: "legacy_v1",
        fence: "0",
        commitSeq: "0",
        outboxSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "commit",
        scopeId: "scope_invalid_commit",
        storageGeneration: "legacy_v1",
        fence: "1",
        commitSeq: "-1",
        outboxSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "outbox",
        scopeId: "scope_invalid_outbox",
        storageGeneration: "legacy_v1",
        fence: "1",
        commitSeq: "0",
        outboxSeq: "-1",
        epoch: "epoch-a",
      },
      {
        suffix: "epoch",
        scopeId: "scope_invalid_epoch",
        storageGeneration: "legacy_v1",
        fence: "1",
        commitSeq: "0",
        outboxSeq: "0",
        epoch: "\u00a0\ufeff",
      },
    ] as const;

    for (const row of invalidRows) {
      await expect(
        persistence.query(
          `
            insert into fx_system_scope_clock (
              scope_id,
              storage_generation,
              storage_generation_fence,
              last_commit_seq,
              last_outbox_seq,
              epoch
            ) values ($1, $2, $3, $4, $5, $6)
          `,
          [
            row.scopeId,
            row.storageGeneration,
            row.fence,
            row.commitSeq,
            row.outboxSeq,
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
          insert into fx_system_scope_clock (
            scope_id,
            storage_generation,
            authorization_revocation_epoch,
            epoch
          ) values ($1, 'legacy_v1', -1, $2)
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
      alter table fx_system_scope_clock
        drop constraint fx_system_scope_clock_authorization_revocation_epoch_non_negative_check
    `);
    const scopeId = ScopeIdSchema.make("scope_authorization_corrupt");
    await persistence.query(
      `
        insert into fx_system_scope_clock (
          scope_id,
          storage_generation,
          authorization_revocation_epoch,
          epoch
        ) values ($1, 'legacy_v1', -1, $2)
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
      operation: "readForShare",
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
      lastOutboxSeq: OutboxSeqSchema.make(0n),
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
        lastOutboxSeq: OutboxSeqSchema.make(0n),
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
      alter table fx_system_scope_clock
        drop constraint fx_system_scope_clock_storage_generation_check,
        drop constraint fx_system_scope_clock_storage_generation_fence_positive_check,
        drop constraint fx_system_scope_clock_last_commit_seq_non_negative_check,
        drop constraint fx_system_scope_clock_oldest_available_commit_seq_check,
        drop constraint fx_system_scope_clock_last_outbox_seq_non_negative_check,
        drop constraint fx_system_scope_clock_epoch_non_empty_check
    `);

    const corruptRows = [
      {
        suffix: "generation",
        storageGeneration: "unknown_v1",
        fence: "1",
        commitSeq: "0",
        outboxSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "fence",
        storageGeneration: "legacy_v1",
        fence: "0",
        commitSeq: "0",
        outboxSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "commit",
        storageGeneration: "legacy_v1",
        fence: "1",
        commitSeq: "-1",
        outboxSeq: "0",
        epoch: "epoch-a",
      },
      {
        suffix: "outbox",
        storageGeneration: "legacy_v1",
        fence: "1",
        commitSeq: "0",
        outboxSeq: "-1",
        epoch: "epoch-a",
      },
      {
        suffix: "epoch",
        storageGeneration: "legacy_v1",
        fence: "1",
        commitSeq: "0",
        outboxSeq: "0",
        epoch: "\t\n",
      },
    ] as const;

    for (const row of corruptRows) {
      const scopeId = ScopeIdSchema.make(`scope_corrupt_clock_${row.suffix}`);
      await persistence.query(
        `
          insert into fx_system_scope_clock (
            scope_id,
            storage_generation,
            storage_generation_fence,
            last_commit_seq,
            last_outbox_seq,
            epoch
          ) values ($1, $2, $3, $4, $5, $6)
        `,
        [
          scopeId,
          row.storageGeneration,
          row.fence,
          row.commitSeq,
          row.outboxSeq,
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
    const scopeId = ScopeIdSchema.make("scope_clock_rollback");
    await insertDefaultScopeClock(persistence, {
      scopeId,
      storageGeneration: LegacyV1StorageGenerationSchema.make("legacy_v1"),
      epoch: ScopeEpochSchema.make("epoch-before"),
    });
    const before = await persistence.getScopeClock(scopeId);

    await expect(
      persistence.drizzle.transaction(async (tx) => {
        const locked = await runEffect(
          lockScopeClockForUpdateInTransactionEffect(tx, scopeId),
        );
        expect(locked).toEqual(before);
        await tx
          .update(fxSystemScopeClocks)
          .set({
            storageGeneration:
              FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
            storageGenerationFence: StorageGenerationFenceSchema.make(2n),
            lastCommitSeq: CommitSeqSchema.make(1n),
            lastOutboxSeq: OutboxSeqSchema.make(1n),
            epoch: ScopeEpochSchema.make("epoch-after"),
            updatedAt: new Date("2026-07-11T00:00:00.000Z"),
          })
          .where(eq(fxSystemScopeClocks.scopeId, scopeId));
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
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: 1n,
    lastCommitSeq: 0n,
    oldestAvailableCommitSeq: 0n,
    lastOutboxSeq: 0n,
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
      insert into fx_system_scope_clock (
        scope_id,
        storage_generation,
        epoch
      ) values ($1, $2, $3)
    `,
    [input.scopeId, input.storageGeneration, input.epoch],
  );
}

interface ScopeClockFixture extends DefaultScopeClockFixture {
  readonly storageGenerationFence: StorageGenerationFence;
  readonly lastCommitSeq: CommitSeq;
  readonly lastOutboxSeq: OutboxSeq;
  readonly updatedAt: Date;
}

async function insertScopeClockFixture(
  persistence: Pick<FlarexPersistence, "query">,
  input: ScopeClockFixture,
): Promise<void> {
  await persistence.query(
    `
      insert into fx_system_scope_clock (
        scope_id,
        storage_generation,
        storage_generation_fence,
        last_commit_seq,
        last_outbox_seq,
        epoch,
        updated_at
      ) values ($1, $2, $3, $4, $5, $6, $7::timestamptz)
    `,
    [
      input.scopeId,
      input.storageGeneration,
      input.storageGenerationFence.toString(),
      input.lastCommitSeq.toString(),
      input.lastOutboxSeq.toString(),
      input.epoch,
      input.updatedAt.toISOString(),
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
      update fx_system_scope_clock
      set authorization_revocation_epoch = $2
      where scope_id = $1
    `,
    [scopeId, value.toString()],
  );
}

interface ScopeClockReadQueryStub
  extends PromiseLike<ReadonlyArray<unknown>> {
  from(): ScopeClockReadQueryStub;
  where(): ScopeClockReadQueryStub;
  limit(): ScopeClockReadQueryStub;
  for(): ScopeClockReadQueryStub;
}

interface ScopeClockInitializationInsertQueryStub
  extends PromiseLike<ReadonlyArray<{ readonly scopeId: ScopeId }>> {
  values(): ScopeClockInitializationInsertQueryStub;
  onConflictDoNothing(): ScopeClockInitializationInsertQueryStub;
  returning(): ScopeClockInitializationInsertQueryStub;
}

function scopeClockInitializationDatabase(
  operations: Readonly<{
    insert(): Promise<ReadonlyArray<{ readonly scopeId: ScopeId }>>;
    read(): Promise<ReadonlyArray<unknown>>;
  }>,
): FlarexMetadataDatabase {
  return {
    insert() {
      const promise = operations.insert();
      const query: ScopeClockInitializationInsertQueryStub = {
        values: () => query,
        onConflictDoNothing: () => query,
        returning: () => query,
        then: (onFulfilled, onRejected) =>
          promise.then(onFulfilled, onRejected),
      };
      return query;
    },
    select() {
      const promise = operations.read();
      const query: ScopeClockReadQueryStub = {
        from: () => query,
        where: () => query,
        limit: () => query,
        for: () => query,
        then: (onFulfilled, onRejected) =>
          promise.then(onFulfilled, onRejected),
      };
      return query;
    },
  } as unknown as FlarexMetadataDatabase;
}

function scopeClockReadTransaction(
  run: () => Promise<ReadonlyArray<unknown>>,
): FlarexMetadataTransaction {
  return {
    select() {
      const promise = run();
      const query: ScopeClockReadQueryStub = {
        from: () => query,
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
