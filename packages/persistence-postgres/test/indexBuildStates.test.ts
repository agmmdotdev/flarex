import {
  CatalogIndexDefinitionIdSchema,
  type CatalogIndexDefinitionId,
} from "flarex-protocol/catalog";
import {
  INDEX_BUILD_CURSOR_CODEC_VERSION_V1,
  IndexBuildAttemptFenceSchema,
  type IndexBuildAttemptFence,
  type IndexBuildLifecycleV1,
} from "flarex-protocol/index-build-state";
import {
  decodeOrderedIndexRowIdHexV1,
  orderedIndexRowIdHexV1ToBytes,
} from "flarex-protocol/ordered-index";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  OutboxSeqSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  type CommitSeq,
  type ScopeEpoch,
  type ScopeId,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";
import { Cause, Effect, Exit, Fiber } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  IndexBuildStateClockNotFoundError,
  IndexBuildStateCorruptionError,
  IndexBuildStatePersistenceError,
  InvalidIndexBuildStateReadInputError,
  readFencedIndexBuildStateEffect,
  type FlarexPersistence,
  type IndexBuildStateRecord,
} from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { createPGlitePersistence } from "../src/pglite";
import {
  fxSystemIndexBuildStates,
  fxSystemScopeClocks,
} from "../src/schema";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

function readFencedIndexBuildState(
  db: FlarexMetadataDatabase,
  input: unknown,
) {
  return runEffect(readFencedIndexBuildStateEffect(db, input));
}

type PublicBuildMutationMethod = Extract<
  keyof FlarexPersistence,
  | "insertIndexBuildState"
  | "updateIndexBuildState"
  | "transitionIndexBuildState"
  | "claimIndexBuild"
  | "enableIndexBuild"
>;

type PublicBuildMutationExport = Extract<
  keyof typeof import("../src"),
  | "insertIndexBuildState"
  | "updateIndexBuildState"
  | "transitionIndexBuildState"
  | "claimIndexBuild"
  | "enableIndexBuild"
  | "isIndexBuildReady"
>;

type PreBackfillBuildState = Extract<
  IndexBuildStateRecord,
  { readonly lifecycle: "declared" | "building" }
>;
type ImpossibleDeclaredBuildCursor = Extract<
  IndexBuildStateRecord,
  {
    readonly lifecycle: "declared";
    readonly backfillCursor: { readonly afterRowId: string };
  }
>;

describe("fenced index build-state reads", () => {
  it("keeps lifecycle values branded and exposes no mutation/readiness API", () => {
    expectTypeOf<PublicBuildMutationMethod>().toEqualTypeOf<never>();
    expectTypeOf<PublicBuildMutationExport>().toEqualTypeOf<never>();
    expectTypeOf<IndexBuildStateRecord["indexDefinitionId"]>()
      .toEqualTypeOf<CatalogIndexDefinitionId>();
    expectTypeOf<IndexBuildStateRecord["storageGenerationFence"]>()
      .toEqualTypeOf<StorageGenerationFence>();
    expectTypeOf<IndexBuildStateRecord["startCommitSeq"]>()
      .toEqualTypeOf<CommitSeq>();
    expectTypeOf<IndexBuildStateRecord["lifecycle"]>()
      .toEqualTypeOf<IndexBuildLifecycleV1>();
    expectTypeOf<IndexBuildStateRecord["attemptFence"]>()
      .toEqualTypeOf<IndexBuildAttemptFence>();
    expectTypeOf<PreBackfillBuildState["backfillCursor"]["afterRowId"]>()
      .toEqualTypeOf<null>();
    expectTypeOf<ImpossibleDeclaredBuildCursor>().toEqualTypeOf<never>();
  });

  it("distinguishes absent, current, and every stale authority pin", async () => {
    const persistence = await migratedPersistence();
    const scopeId = ScopeIdSchema.make("scope_index_build_fencing");
    const definitionId = CatalogIndexDefinitionIdSchema.make(1);
    await insertClock(persistence.drizzle, {
      scopeId,
      epoch: ScopeEpochSchema.make("epoch-a"),
      fence: StorageGenerationFenceSchema.make(7n),
      lastCommitSeq: CommitSeqSchema.make(10n),
    });

    const absent = await readFencedIndexBuildState(persistence.drizzle, {
      scopeId,
      indexDefinitionId: definitionId,
    });
    expect(absent).toEqual({
      status: "absent",
      currentAuthority: {
        scopeId,
        storageGeneration: "flarexdb_v1",
        storageGenerationFence: 7n,
        epoch: "epoch-a",
      },
    });
    expect(Object.isFrozen(absent)).toBe(true);
    if (absent.status !== "absent") throw new Error("Expected absent state.");
    expect(Object.isFrozen(absent.currentAuthority)).toBe(true);

    await insertBuild(persistence.drizzle, {
      scopeId,
      indexDefinitionId: definitionId,
      epoch: ScopeEpochSchema.make("epoch-a"),
      fence: StorageGenerationFenceSchema.make(7n),
      startCommitSeq: CommitSeqSchema.make(5n),
      lifecycle: "declared",
      cursor: null,
      attemptFence: IndexBuildAttemptFenceSchema.make(
        9_007_199_254_740_993n,
      ),
    });

    const current = await readFencedIndexBuildState(persistence.drizzle, {
      scopeId,
      indexDefinitionId: definitionId,
    });
    expect(current).toMatchObject({
      status: "current",
      buildState: {
        scopeId,
        indexDefinitionId: definitionId,
        storageGeneration: "flarexdb_v1",
        storageGenerationFence: 7n,
        epoch: "epoch-a",
        startCommitSeq: 5n,
        lifecycle: "declared",
        backfillCursor: { codecVersion: 1, afterRowId: null },
        attemptFence: 9_007_199_254_740_993n,
      },
    });
    if (current.status !== "current") throw new Error("Expected current state.");
    expect(Object.isFrozen(current)).toBe(true);
    expect(Object.isFrozen(current.buildState)).toBe(true);
    expect(Object.isFrozen(current.buildState.backfillCursor)).toBe(true);

    await persistence.drizzle.update(fxSystemScopeClocks).set({
      storageGenerationFence: StorageGenerationFenceSchema.make(8n),
    });
    const fenceStale = await readFencedIndexBuildState(persistence.drizzle, {
      scopeId,
      indexDefinitionId: definitionId,
    });
    expect(fenceStale).toMatchObject({
      status: "stale",
      mismatches: ["storageGenerationFence"],
      currentAuthority: { storageGenerationFence: 8n },
    });

    await persistence.drizzle.update(fxSystemScopeClocks).set({
      epoch: ScopeEpochSchema.make("epoch-b"),
    });
    const epochStale = await readFencedIndexBuildState(persistence.drizzle, {
      scopeId,
      indexDefinitionId: definitionId,
    });
    expect(epochStale).toMatchObject({
      status: "stale",
      mismatches: ["storageGenerationFence", "epoch"],
    });
    if (epochStale.status !== "stale") throw new Error("Expected stale state.");
    expect(Object.isFrozen(epochStale.mismatches)).toBe(true);

    await persistence.query(
      `
        update fx_system_scope_clock
        set storage_generation = 'legacy_v1'
        where scope_id = $1
      `,
      [scopeId],
    );
    const generationStale = await readFencedIndexBuildState(
      persistence.drizzle,
      { scopeId, indexDefinitionId: definitionId },
    );
    expect(generationStale).toMatchObject({
      status: "stale",
      mismatches: ["storageGeneration", "storageGenerationFence", "epoch"],
    });
  });

  it("decodes every lifecycle and exact exclusive row cursor", async () => {
    const persistence = await migratedPersistence();
    const scopeId = ScopeIdSchema.make("scope_index_build_lifecycle");
    const epoch = ScopeEpochSchema.make("epoch-lifecycle");
    await insertClock(persistence.drizzle, {
      scopeId,
      epoch,
      fence: StorageGenerationFenceSchema.make(3n),
      lastCommitSeq: CommitSeqSchema.make(20n),
    });
    const cursor = orderedIndexRowIdHexV1ToBytes(
      decodeOrderedIndexRowIdHexV1("ab".repeat(16)),
    );
    const lifecycles = [
      "declared",
      "building",
      "backfilling",
      "validating",
      "enabled",
      "retiring",
    ] as const;

    for (const [offset, lifecycle] of lifecycles.entries()) {
      const definitionId = CatalogIndexDefinitionIdSchema.make(offset + 1);
      const storedCursor = lifecycle === "declared" || lifecycle === "building"
        ? null
        : cursor;
      await insertBuild(persistence.drizzle, {
        scopeId,
        indexDefinitionId: definitionId,
        epoch,
        fence: StorageGenerationFenceSchema.make(3n),
        startCommitSeq: CommitSeqSchema.make(10n),
        lifecycle,
        cursor: storedCursor,
        attemptFence: IndexBuildAttemptFenceSchema.make(1n),
      });
      const result = await readFencedIndexBuildState(persistence.drizzle, {
        scopeId,
        indexDefinitionId: definitionId,
      });
      expect(result).toMatchObject({
        status: "current",
        buildState: {
          lifecycle,
          backfillCursor: {
            codecVersion: 1,
            afterRowId: storedCursor === null ? null : "ab".repeat(16),
          },
        },
      });
    }
  });

  it("enforces scope isolation and split-compatible local ownership", async () => {
    const persistence = await migratedPersistence();
    const left = ScopeIdSchema.make("scope_index_build_left");
    const right = ScopeIdSchema.make("scope_index_build_right");
    const epoch = ScopeEpochSchema.make("epoch-isolation");
    for (const scopeId of [left, right]) {
      await insertClock(persistence.drizzle, {
        scopeId,
        epoch,
        fence: StorageGenerationFenceSchema.make(1n),
        lastCommitSeq: CommitSeqSchema.make(0n),
      });
      await insertBuild(persistence.drizzle, {
        scopeId,
        indexDefinitionId: CatalogIndexDefinitionIdSchema.make(99),
        epoch,
        fence: StorageGenerationFenceSchema.make(1n),
        startCommitSeq: CommitSeqSchema.make(0n),
        lifecycle: "declared",
        cursor: null,
        attemptFence: IndexBuildAttemptFenceSchema.make(1n),
      });
    }

    await expect(
      readFencedIndexBuildState(persistence.drizzle, {
        scopeId: left,
        indexDefinitionId: CatalogIndexDefinitionIdSchema.make(99),
      }),
    ).resolves.toMatchObject({ status: "current", buildState: { scopeId: left } });
    await expect(
      readFencedIndexBuildState(persistence.drizzle, {
        scopeId: left,
        indexDefinitionId: CatalogIndexDefinitionIdSchema.make(100),
      }),
    ).resolves.toMatchObject({ status: "absent" });

    await expect(
      insertRawBuild(persistence, {
        scopeId: "scope_without_local_clock",
        indexDefinitionId: 1,
      }),
    ).rejects.toThrow();
    await expect(
      insertRawBuild(persistence, {
        scopeId: left,
        indexDefinitionId: 99,
      }),
    ).rejects.toThrow();
  });

  it("rejects every malformed physical build-state shape", async () => {
    const persistence = await migratedPersistence();
    const scopeId = ScopeIdSchema.make("scope_index_build_constraints");
    await insertClock(persistence.drizzle, {
      scopeId,
      epoch: ScopeEpochSchema.make("epoch-constraints"),
      fence: StorageGenerationFenceSchema.make(2n),
      lastCommitSeq: CommitSeqSchema.make(10n),
    });
    const invalid: ReadonlyArray<RawBuildOverrides> = [
      { indexDefinitionId: 0 },
      { indexDefinitionId: 2, storageGeneration: "legacy_v1" },
      { indexDefinitionId: 3, storageGenerationFence: 0n },
      { indexDefinitionId: 4, epoch: " \t" },
      { indexDefinitionId: 5, startCommitSeq: -1n },
      { indexDefinitionId: 6, lifecycle: "failed" },
      { indexDefinitionId: 7, cursorCodecVersion: 2 },
      { indexDefinitionId: 8, backfillCursorRowId: new Uint8Array(15) },
      {
        indexDefinitionId: 9,
        lifecycle: "declared",
        backfillCursorRowId: new Uint8Array(16),
      },
      {
        indexDefinitionId: 10,
        lifecycle: "building",
        backfillCursorRowId: new Uint8Array(16),
      },
      { indexDefinitionId: 11, attemptFence: 0n },
      {
        indexDefinitionId: 12,
        createdAt: new Date("2026-07-12T00:00:01.000Z"),
        updatedAt: new Date("2026-07-12T00:00:00.000Z"),
      },
    ];

    for (const overrides of invalid) {
      await expect(
        insertRawBuild(persistence, { scopeId, ...overrides }),
      ).rejects.toThrow();
    }
  });

  it("fails closed on an ahead-of-clock snapshot and stored corruption", async () => {
    const persistence = await migratedPersistence();
    const scopeId = ScopeIdSchema.make("scope_index_build_corruption");
    const epoch = ScopeEpochSchema.make("epoch-corruption");
    await insertClock(persistence.drizzle, {
      scopeId,
      epoch,
      fence: StorageGenerationFenceSchema.make(1n),
      lastCommitSeq: CommitSeqSchema.make(5n),
    });
    await insertBuild(persistence.drizzle, {
      scopeId,
      indexDefinitionId: CatalogIndexDefinitionIdSchema.make(1),
      epoch,
      fence: StorageGenerationFenceSchema.make(1n),
      startCommitSeq: CommitSeqSchema.make(6n),
      lifecycle: "declared",
      cursor: null,
      attemptFence: IndexBuildAttemptFenceSchema.make(1n),
    });
    await expect(
      readFencedIndexBuildState(persistence.drizzle, {
        scopeId,
        indexDefinitionId: CatalogIndexDefinitionIdSchema.make(1),
      }),
    ).rejects.toBeInstanceOf(IndexBuildStateCorruptionError);

    await persistence.query(
      `
        alter table fx_system_index_build_state
          drop constraint fx_system_index_build_lifecycle_check
      `,
    );
    await persistence.query(
      `
        update fx_system_index_build_state
        set lifecycle = 'failed', start_commit_seq = 5
        where scope_id = $1 and index_definition_id = 1
      `,
      [scopeId],
    );
    await expect(
      readFencedIndexBuildState(persistence.drizzle, {
        scopeId,
        indexDefinitionId: CatalogIndexDefinitionIdSchema.make(1),
      }),
    ).rejects.toBeInstanceOf(IndexBuildStateCorruptionError);
  });

  it("rejects malformed reads and missing clock authority", async () => {
    const persistence = await migratedPersistence();
    const scopeId = ScopeIdSchema.make("scope_index_build_input");
    const definitionId = CatalogIndexDefinitionIdSchema.make(1);
    const invalid: ReadonlyArray<unknown> = [
      null,
      {},
      { scopeId, indexDefinitionId: definitionId, extra: true },
      { scopeId: "", indexDefinitionId: definitionId },
      { scopeId, indexDefinitionId: 0 },
      Object.create({ scopeId, indexDefinitionId: definitionId }),
    ];
    for (const input of invalid) {
      await expect(
        readFencedIndexBuildState(
          persistence.drizzle,
          input,
        ),
      ).rejects.toBeInstanceOf(InvalidIndexBuildStateReadInputError);
    }
    await expect(
      readFencedIndexBuildState(persistence.drizzle, {
        scopeId,
        indexDefinitionId: definitionId,
      }),
    ).rejects.toBeInstanceOf(IndexBuildStateClockNotFoundError);
  });

  it("maps the Drizzle read rejection at the persistence boundary", async () => {
    const persistence = await migratedPersistence();
    await persistence.query("drop table fx_system_scope_clock cascade");

    const failure = await runEffectFailure(readFencedIndexBuildStateEffect(
      persistence.drizzle,
      {
        scopeId: ScopeIdSchema.make("scope_index_build_sql_failure"),
        indexDefinitionId: CatalogIndexDefinitionIdSchema.make(1),
      },
    ));

    expect(failure).toBeInstanceOf(IndexBuildStatePersistenceError);
    expect(failure).toMatchObject({
      operation: "readFencedIndexBuildState",
    });
    expect(failure.cause).toBeDefined();
  });

  it("classifies malformed stored clock authority as typed corruption", async () => {
    const persistence = await migratedPersistence();
    const scopeId = ScopeIdSchema.make("scope_index_build_clock_corruption");
    const indexDefinitionId = CatalogIndexDefinitionIdSchema.make(1);
    await insertClock(persistence.drizzle, {
      scopeId,
      epoch: ScopeEpochSchema.make("epoch-clock-corruption"),
      fence: StorageGenerationFenceSchema.make(1n),
      lastCommitSeq: CommitSeqSchema.make(0n),
    });
    await persistence.query(`
      alter table fx_system_scope_clock
        drop constraint fx_system_scope_clock_epoch_non_empty_check
    `);
    await persistence.query(
      "update fx_system_scope_clock set epoch = '' where scope_id = $1",
      [scopeId],
    );

    const failure = await runEffectFailure(readFencedIndexBuildStateEffect(
      persistence.drizzle,
      { scopeId, indexDefinitionId },
    ));

    expect(failure).toBeInstanceOf(IndexBuildStateCorruptionError);
    expect(failure).toMatchObject({
      detail: "stored scope clock is invalid",
      cause: expect.objectContaining({
        _tag: "ScopeClockCorruptionError",
      }),
    });
  });

  it("waits for a pending Drizzle read to settle before interruption completes", async () => {
    const entered = deferredValue<void>();
    const query = deferredValue<readonly []>();
    const db = pendingIndexBuildReadDatabase(() => {
      entered.resolve();
      return query.promise;
    });
    const fiber = Effect.runFork(readFencedIndexBuildStateEffect(db, {
      scopeId: ScopeIdSchema.make("scope_index_build_interruption"),
      indexDefinitionId: CatalogIndexDefinitionIdSchema.make(1),
    }));

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
    expect(interruptionSettled).toBe(true);
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true);
    }
  });

  it("preserves unexpected input accessor failures as defects", async () => {
    const persistence = await migratedPersistence();
    const defect = new Error("unexpected index-build input accessor defect");
    const input = new Proxy(
      {
        scopeId: "scope_index_build_input_defect",
        indexDefinitionId: 1,
      },
      {
        get(target, property, receiver) {
          if (property === "indexDefinitionId") throw defect;
          return Reflect.get(target, property, receiver);
        },
      },
    );

    const exit = await Effect.runPromiseExit(readFencedIndexBuildStateEffect(
      persistence.drizzle,
      input,
    ));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.hasFails(exit.cause)).toBe(false);
      expect(exit.cause.toString()).toContain(defect.message);
    }
  });
});

function pendingIndexBuildReadDatabase(
  run: () => Promise<readonly []>,
): FlarexMetadataDatabase {
  const query = {
    from: () => query,
    leftJoin: () => query,
    where: () => query,
    limit: () => run(),
  };
  return {
    select: () => query,
  } as unknown as FlarexMetadataDatabase;
}

function deferredValue<A>(): Readonly<{
  promise: Promise<A>;
  resolve(value: A): void;
}> {
  let resolvePromise: ((value: A) => void) | undefined;
  const promise = new Promise<A>((resolve) => {
    resolvePromise = resolve;
  });
  return Object.freeze({
    promise,
    resolve(value: A) {
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

type PGlitePersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

interface ClockFixture {
  readonly scopeId: ScopeId;
  readonly epoch: ScopeEpoch;
  readonly fence: StorageGenerationFence;
  readonly lastCommitSeq: CommitSeq;
}

interface BuildFixture {
  readonly scopeId: ScopeId;
  readonly epoch: ScopeEpoch;
  readonly fence: StorageGenerationFence;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly lifecycle: IndexBuildLifecycleV1;
  readonly cursor: Uint8Array | null;
  readonly attemptFence: IndexBuildAttemptFence;
  readonly startCommitSeq: CommitSeq;
}

interface RawBuildOverrides {
  readonly scopeId?: string;
  readonly indexDefinitionId?: number;
  readonly storageGeneration?: string;
  readonly storageGenerationFence?: bigint;
  readonly epoch?: string;
  readonly startCommitSeq?: bigint;
  readonly lifecycle?: string;
  readonly cursorCodecVersion?: number;
  readonly backfillCursorRowId?: Uint8Array | null;
  readonly attemptFence?: bigint;
  readonly createdAt?: Date;
  readonly updatedAt?: Date;
}

async function migratedPersistence(): Promise<PGlitePersistence> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  return persistence;
}

async function insertClock(
  db: FlarexMetadataDatabase,
  fixture: ClockFixture,
): Promise<void> {
  await db.insert(fxSystemScopeClocks).values({
    scopeId: fixture.scopeId,
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: fixture.fence,
    lastCommitSeq: fixture.lastCommitSeq,
    lastOutboxSeq: OutboxSeqSchema.make(0n),
    epoch: fixture.epoch,
  });
}

async function insertBuild(
  db: FlarexMetadataDatabase,
  fixture: BuildFixture,
): Promise<void> {
  await db.insert(fxSystemIndexBuildStates).values({
    scopeId: fixture.scopeId,
    indexDefinitionId: fixture.indexDefinitionId,
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: fixture.fence,
    epoch: fixture.epoch,
    startCommitSeq: fixture.startCommitSeq,
    lifecycle: fixture.lifecycle,
    cursorCodecVersion: INDEX_BUILD_CURSOR_CODEC_VERSION_V1,
    backfillCursorRowId: fixture.cursor,
    attemptFence: fixture.attemptFence,
  });
}

async function insertRawBuild(
  persistence: PGlitePersistence,
  overrides: RawBuildOverrides,
): Promise<void> {
  const createdAt = overrides.createdAt ?? new Date("2026-07-12T00:00:00.000Z");
  await persistence.query(
    `
      insert into fx_system_index_build_state
        (
          scope_id,
          index_definition_id,
          storage_generation,
          storage_generation_fence,
          epoch,
          start_commit_seq,
          lifecycle,
          cursor_codec_version,
          backfill_cursor_row_id,
          attempt_fence,
          created_at,
          updated_at
        )
      values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `,
    [
      overrides.scopeId ?? "scope_index_build_constraints",
      overrides.indexDefinitionId ?? 1,
      overrides.storageGeneration ?? "flarexdb_v1",
      overrides.storageGenerationFence ?? 2n,
      overrides.epoch ?? "epoch-constraints",
      overrides.startCommitSeq ?? 0n,
      overrides.lifecycle ?? "declared",
      overrides.cursorCodecVersion ?? 1,
      overrides.backfillCursorRowId ?? null,
      overrides.attemptFence ?? 1n,
      createdAt,
      overrides.updatedAt ?? createdAt,
    ],
  );
}
