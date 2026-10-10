import { copyFiniteDate } from "@flarex/utils/dates";
import { bytesEqualFullScan, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { and, asc, eq, getTableColumns, gt, inArray, lte, type SQLWrapper } from "drizzle-orm";
import { Effect, Result, Schema } from "effect";
import {
  CatalogIndexDefinitionIdSchema,
  type CatalogIndexDefinitionId,
  type CatalogTableId,
} from "flarex-protocol/catalog";
import {
  IndexBuildAttemptFenceSchema,
  IndexBuildBackfillCursorV1Schema,
  IndexBuildCursorCodecVersionV1Schema,
  IndexBuildLifecycleV1Schema,
  type IndexBuildAttemptFence,
  type IndexBuildBackfillCursorV1,
  type IndexBuildLifecycleV1,
} from "flarex-protocol/index-build-state";
import {
  orderedIndexRowIdHexV1FromBytesResult,
} from "flarex-protocol/ordered-index";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  projectScopeIdUuidV1Result,
  type CommitSeq,
  type FlarexDbV1StorageGeneration,
  type ScopeEpoch,
  type ScopeId,
  type StorageGeneration,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";

import { readAppTableWriteFrontierInTransactionEffect, readAppTableWriteFrontiersInTransactionEffect,
  AppRowTableFrontierCorruptionError, type AppRowTransaction, type AppRowReadPersistenceError,
  type InvalidAppRowReadInputError } from "../documents/appRows";
import type { AppIndexDefinitionRecord } from "./appIndexDefinitions";
import type { FlarexMetadataDatabase } from "../../application/deployments";
import { runDrizzleStatementEffect } from "../../database/drizzleStatementEffect";
import { hasExactOwnDataKeys } from "../../values/exactOwnDataKeys";
import {
  decodeScopeClockRecordResult,
  scopeClockSelection,
  exactScopeWriteClockObservationIdentity,
  type ScopeClockRecord,
} from "../../scope/scopeClock";
import {
  readCoherentApplicationActiveHeadForShareInTransactionEffect,
  readApplicationSchemaForHeadForShareInTransactionEffect,
  readCheckedApplicationSchemaForHeadForShareInTransactionEffect,
} from "../../application/applicationActiveHeadRead";
import {
  readCheckedApplicationActiveHead,
} from "../../application/activeHead/identity";
import {
  type CheckedApplicationActiveHead,
  type CoherentApplicationActiveHead,
} from "../../application/activeHead/contracts";
import {
  decodeApplicationMaterializationObservation,
} from "../../application/applicationActiveHeadRead";
import {
  readRegisteredManagedMetadataPairFinalGuards,
} from "../../execution/preparation/preparedMetadataEpoch";
import {
  decodeIndexMaintenanceObligationResult,
  IndexMaintenanceError,
  type IndexMaintenanceObligation,
} from "./indexMaintenanceModel";
import {
  fxSystemIndexBuildStates,
  fxSystemIndexMaintenanceObligations,
  fxSystemCommitAppRowChanges,
  fxSystemScopeClocks,
  fxSystemScopeExecutionAuthorities,
} from "../../database/schema";

const READ_INPUT_KEYS = Object.freeze(["scopeId", "indexDefinitionId"]);
const decodeCatalogIndexDefinitionIdResult = Schema.decodeUnknownResult(
  Schema.toType(CatalogIndexDefinitionIdSchema),
);
const decodeIndexBuildAttemptFenceResult = Schema.decodeUnknownResult(
  Schema.toType(IndexBuildAttemptFenceSchema),
);
const decodeIndexBuildBackfillCursorResult = Schema.decodeUnknownResult(
  Schema.toType(IndexBuildBackfillCursorV1Schema),
);
const decodeIndexBuildCursorCodecVersionResult = Schema.decodeUnknownResult(
  Schema.toType(IndexBuildCursorCodecVersionV1Schema),
);
const decodeIndexBuildLifecycleResult = Schema.decodeUnknownResult(
  Schema.toType(IndexBuildLifecycleV1Schema),
);
const decodeCommitSeqResult = Schema.decodeUnknownResult(
  Schema.toType(CommitSeqSchema),
);

const decodeFlarexDbV1StorageGenerationResult = Schema.decodeUnknownResult(
  Schema.toType(FlarexDbV1StorageGenerationSchema),
);
const decodeScopeEpochResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeEpochSchema),
);
const decodeScopeIdResult = Schema.decodeUnknownResult(
  Schema.toType(ScopeIdSchema),
);
const decodeStorageGenerationFenceResult = Schema.decodeUnknownResult(
  Schema.toType(StorageGenerationFenceSchema),
);

export interface ReadFencedIndexBuildStateInput {
  readonly scopeId: ScopeId;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
}

export interface IndexBuildStorageAuthority {
  readonly scopeId: ScopeId;
  readonly storageGeneration: StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly epoch: ScopeEpoch;
}

interface IndexBuildStateRecordBase {
  readonly maintenance: IndexMaintenanceObligation | null;
  readonly scopeId: ScopeId;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly epoch: ScopeEpoch;
  readonly startCommitSeq: CommitSeq;
  readonly coveredThroughCommitSeq: CommitSeq | null;
  readonly firstReadableCommitSeq: CommitSeq | null;
  readonly attemptFence: IndexBuildAttemptFence;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

type IndexBuildPreBackfillLifecycleV1 = Extract<
  IndexBuildLifecycleV1,
  "declared" | "building"
>;
type IndexBuildCursorCapableLifecycleV1 = Exclude<
  IndexBuildLifecycleV1,
  IndexBuildPreBackfillLifecycleV1
>;
type IndexBuildPreBackfillCursorV1 = Readonly<{
  codecVersion: IndexBuildBackfillCursorV1["codecVersion"];
  afterRowId: null;
}>;

interface IndexBuildPreBackfillStateRecord
  extends IndexBuildStateRecordBase {
  readonly lifecycle: IndexBuildPreBackfillLifecycleV1;
  readonly backfillCursor: IndexBuildPreBackfillCursorV1;
}

interface IndexBuildCursorCapableStateRecord
  extends IndexBuildStateRecordBase {
  readonly lifecycle: IndexBuildCursorCapableLifecycleV1;
  readonly backfillCursor: IndexBuildBackfillCursorV1;
}

export type IndexBuildStateRecord =
  | IndexBuildPreBackfillStateRecord
  | IndexBuildCursorCapableStateRecord;

export type IndexBuildAuthorityMismatch =
  | "storageGeneration"
  | "storageGenerationFence"
  | "epoch";
export type IndexBuildAuthorityMismatches = readonly [
  IndexBuildAuthorityMismatch,
  ...IndexBuildAuthorityMismatch[],
];

export type FencedIndexBuildStateReadResult =
  | {
      readonly status: "absent";
      readonly currentAuthority: IndexBuildStorageAuthority;
    }
  | {
      readonly status: "current";
      readonly buildState: IndexBuildStateRecord;
    }
  | {
      readonly status: "stale";
      readonly buildState: IndexBuildStateRecord;
      readonly currentAuthority: IndexBuildStorageAuthority;
      readonly mismatches: IndexBuildAuthorityMismatches;
    };

export type InvalidIndexBuildStateReadInputIssue =
  | { readonly reason: "invalidInputShape" }
  | { readonly reason: "invalidScopeId" }
  | { readonly reason: "invalidIndexDefinitionId" };

export class InvalidIndexBuildStateReadInputError extends Error {
  readonly _tag = "InvalidIndexBuildStateReadInputError" as const;

  constructor(
    readonly issue: InvalidIndexBuildStateReadInputIssue,
    options?: ErrorOptions,
  ) {
    super(invalidInputMessage(issue), options);
    this.name = "InvalidIndexBuildStateReadInputError";
  }
}

export class IndexBuildStateCorruptionError extends Error {
  readonly _tag = "IndexBuildStateCorruptionError" as const;

  constructor(
    readonly scopeId: string,
    readonly indexDefinitionId: CatalogIndexDefinitionId,
    readonly detail: string,
    options?: ErrorOptions,
  ) {
    super(
      `Index build state ${scopeId}/${indexDefinitionId} is corrupt: ${detail}`,
      options,
    );
    this.name = "IndexBuildStateCorruptionError";
  }
}

export class IndexBuildStateClockNotFoundError extends Error {
  readonly _tag = "IndexBuildStateClockNotFoundError" as const;

  constructor(
    readonly scopeId: ScopeId,
    readonly indexDefinitionId: CatalogIndexDefinitionId,
  ) {
    super(
      `Index build-state read has no local scope clock: ${scopeId}/${indexDefinitionId}`,
    );
    this.name = "IndexBuildStateClockNotFoundError";
  }
}

export class IndexBuildStatePersistenceError extends Error {
  readonly _tag = "IndexBuildStatePersistenceError" as const;

  constructor(
    readonly operation: "readFencedIndexBuildState" | "readRequiredIndexBuildStates",
    readonly cause: unknown,
  ) {
    super("Failed to read index build state.", { cause });
    this.name = "IndexBuildStatePersistenceError";
  }
}

export const MAX_REQUIRED_INDEX_BUILDS = 512;

/** Shared structural gate under the caller's locked clock. The caller supplies
 * its authenticated complete requirement set. Enabled state alone is not a
 * serving grant or proof of coverage at an arbitrary read snapshot. */
export const readRequiredEnabledIndexBuildsInTransactionEffect = Effect.fn("IndexBuildState.readRequiredEnabled")(
  function* (tx: AppRowTransaction, clock: IndexBuildStorageAuthority, definitionIds: readonly CatalogIndexDefinitionId[], lock: "key share" | "share" | "update") {
    if (definitionIds.length > MAX_REQUIRED_INDEX_BUILDS || new Set(definitionIds).size !== definitionIds.length)
      return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    const rows = definitionIds.length === 0 ? [] : yield* Effect.uninterruptible(runDrizzleStatementEffect(
      tx.select(indexBuildStateSelection()).from(fxSystemIndexBuildStates)
        .leftJoin(fxSystemIndexMaintenanceObligations, indexMaintenanceBindingPredicate()).where(and(
        eq(fxSystemIndexBuildStates.scopeId, clock.scopeId), inArray(fxSystemIndexBuildStates.indexDefinitionId, [...definitionIds]),
      )).orderBy(asc(fxSystemIndexBuildStates.indexDefinitionId)).for(lock, { of: fxSystemIndexBuildStates }),
      cause => new IndexBuildStatePersistenceError("readRequiredIndexBuildStates", cause),
    ));
    const rowsByDefinitionId = new Map(rows.map(row => [row.indexDefinitionId, row]));
    for (const indexDefinitionId of definitionIds) {
      const build = rowsByDefinitionId.get(indexDefinitionId);
      if (build === undefined) return Object.freeze({ status: "not_ready" as const, reason: "missing" as const, indexDefinitionId });
      if (build.storageGeneration !== clock.storageGeneration || build.storageGenerationFence !== clock.storageGenerationFence || build.epoch !== clock.epoch)
        return Object.freeze({ status: "not_ready" as const, reason: "stale" as const, indexDefinitionId });
      if (build.lifecycle !== "enabled") return Object.freeze({ status: "not_ready" as const, reason: "notEnabled" as const, indexDefinitionId, lifecycle: build.lifecycle });
    }
    return Object.freeze({ status: "ready" as const, rows: Object.freeze(rows) });
  },
);

export type ReadFencedIndexBuildStateError =
  | InvalidIndexBuildStateReadInputError
  | IndexBuildStateClockNotFoundError
  | IndexBuildStateCorruptionError
  | IndexBuildStatePersistenceError;

/**
 * Read one build row and its current scope clock from one SQL statement.
 *
 * `current` means only that generation, fence, and epoch still match. It does
 * not mean the index is enabled or that a schema is activation-ready.
 */
export const readFencedIndexBuildStateEffect = Effect.fn(
  "IndexBuildState.readFenced",
)(function* (
  db: FlarexMetadataDatabase,
  input: unknown,
): Effect.fn.Return<
  FencedIndexBuildStateReadResult,
  ReadFencedIndexBuildStateError
> {
  const decoded = yield* Effect.fromResult(decodeReadInput(input));
  const rows = yield* Effect.uninterruptible(Effect.tryPromise({
    try: () => selectFencedIndexBuildStateRows(db, decoded),
    catch: (cause) => new IndexBuildStatePersistenceError(
      "readFencedIndexBuildState",
      cause,
    ),
  }));
  return yield* Effect.fromResult(materializeFencedIndexBuildState(
    rows,
    decoded,
  ));
});

function selectFencedIndexBuildStateRows(
  db: FlarexMetadataDatabase,
  input: ReadFencedIndexBuildStateInput,
) {
  return db
    .select({
      clock: scopeClockSelection(),
      buildState: getTableColumns(fxSystemIndexBuildStates),
      maintenanceObligation: getTableColumns(fxSystemIndexMaintenanceObligations),
    })
    .from(fxSystemScopeClocks)
    .innerJoin(fxSystemScopeExecutionAuthorities, eq(fxSystemScopeExecutionAuthorities.scopeId, fxSystemScopeClocks.scopeId))
    .leftJoin(
      fxSystemIndexBuildStates,
      and(
        eq(
          fxSystemIndexBuildStates.scopeId,
          fxSystemScopeClocks.scopeId,
        ),
        eq(
          fxSystemIndexBuildStates.indexDefinitionId,
          input.indexDefinitionId,
        ),
      ),
    )
    .leftJoin(fxSystemIndexMaintenanceObligations, indexMaintenanceBindingPredicate())
    .where(eq(fxSystemScopeClocks.scopeId, input.scopeId))
    .limit(1);
}

type FencedIndexBuildStateRows = Awaited<
  ReturnType<typeof selectFencedIndexBuildStateRows>
>;

function materializeFencedIndexBuildState(
  rows: FencedIndexBuildStateRows,
  input: ReadFencedIndexBuildStateInput,
): Result.Result<
  FencedIndexBuildStateReadResult,
  IndexBuildStateClockNotFoundError | IndexBuildStateCorruptionError
> {
  return Result.gen(function* () {
    const row = rows[0];
    if (row === undefined) {
      return yield* Result.fail(new IndexBuildStateClockNotFoundError(
        input.scopeId,
        input.indexDefinitionId,
      ));
    }
    const clock = yield* decodeScopeClockRecordResult(row.clock).pipe(
      Result.mapError((cause) => new IndexBuildStateCorruptionError(
        input.scopeId,
        input.indexDefinitionId,
        "stored scope clock is invalid",
        { cause },
      )),
    );
    const currentAuthority = freezeAuthority({
      scopeId: clock.scopeId,
      storageGeneration: clock.storageGeneration,
      storageGenerationFence: clock.storageGenerationFence,
      epoch: clock.epoch,
    });
    if (row.buildState === null) {
      return Object.freeze({
        status: "absent",
        currentAuthority,
      });
    }

    const buildState = yield* decodeIndexBuildStateRowResult(
      row.buildState,
      input.scopeId,
      input.indexDefinitionId,
      row.maintenanceObligation,
    );
    yield* validateIndexBuildStateFrontierResult(
      buildState,
      clock.lastCommitSeq,
    );
    const mismatches = collectAuthorityMismatches(
      buildState,
      currentAuthority,
    );
    if (mismatches !== null) {
      return Object.freeze({
        status: "stale",
        buildState,
        currentAuthority,
        mismatches,
      });
    }
    return Object.freeze({ status: "current", buildState });
  });
}

export type IndexBuildStateRow = typeof fxSystemIndexBuildStates.$inferSelect & {
  readonly maintenanceObligation: typeof fxSystemIndexMaintenanceObligations.$inferSelect | null;
};

/** Read the immutable opening binding with its build in the existing statement. */
export function indexBuildStateSelection() {
  return { ...getTableColumns(fxSystemIndexBuildStates),
    maintenanceObligation: getTableColumns(fxSystemIndexMaintenanceObligations) };
}

/** Also accepts a native observed build's real composite-column projections. */
export function indexMaintenanceBindingPredicate(
  scopeId: SQLWrapper = fxSystemIndexBuildStates.scopeId,
  definitionId: SQLWrapper = fxSystemIndexBuildStates.indexDefinitionId,
  activationSequence: SQLWrapper = fxSystemIndexBuildStates.maintenanceActivationSequence,
) {
  return and(eq(fxSystemIndexMaintenanceObligations.scopeId, scopeId),
    eq(fxSystemIndexMaintenanceObligations.indexDefinitionId, definitionId),
    eq(fxSystemIndexMaintenanceObligations.activationSequence, activationSequence));
}

/** Package-internal decoder shared by the C4 read and S03-D3 transaction. */
export function decodeIndexBuildStateRowResult(
  row: typeof fxSystemIndexBuildStates.$inferSelect,
  expectedScopeId: ScopeId,
  expectedIndexDefinitionId: CatalogIndexDefinitionId,
  maintenanceObligation: typeof fxSystemIndexMaintenanceObligations.$inferSelect | null,
): Result.Result<IndexBuildStateRecord, IndexBuildStateCorruptionError> {
  return Result.gen(function* () {
    const cursorCodecVersion = yield* decodeStoredBuildStateFieldResult(
      decodeIndexBuildCursorCodecVersionResult(row.cursorCodecVersion),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    const scopeId = yield* decodeStoredBuildStateFieldResult(
      decodeScopeIdResult(row.scopeId),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    const indexDefinitionId = yield* decodeStoredBuildStateFieldResult(
      decodeCatalogIndexDefinitionIdResult(row.indexDefinitionId),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    const storageGeneration = yield* decodeStoredBuildStateFieldResult(
      decodeFlarexDbV1StorageGenerationResult(row.storageGeneration),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    const storageGenerationFence = yield* decodeStoredBuildStateFieldResult(
      decodeStorageGenerationFenceResult(row.storageGenerationFence),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    const epoch = yield* decodeStoredBuildStateFieldResult(
      decodeScopeEpochResult(row.epoch),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    const startCommitSeq = yield* decodeStoredBuildStateFieldResult(
      decodeCommitSeqResult(row.startCommitSeq),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    const coveredThroughCommitSeq = row.coveredThroughCommitSeq === null ? null
      : yield* decodeStoredBuildStateFieldResult(
        decodeCommitSeqResult(row.coveredThroughCommitSeq), expectedScopeId, expectedIndexDefinitionId,
      );
    const firstReadableCommitSeq = row.firstReadableCommitSeq === null ? null
      : yield* decodeStoredBuildStateFieldResult(
        decodeCommitSeqResult(row.firstReadableCommitSeq), expectedScopeId, expectedIndexDefinitionId,
      );
    if (firstReadableCommitSeq !== null &&
      (coveredThroughCommitSeq === null || firstReadableCommitSeq > coveredThroughCommitSeq)) {
      return yield* Result.fail(new IndexBuildStateCorruptionError(
        scopeId, indexDefinitionId, "readable frontier exceeds completed coverage",
      ));
    }
    const lifecycle = yield* decodeStoredBuildStateFieldResult(
      decodeIndexBuildLifecycleResult(row.lifecycle),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    const rawBackfillCursorRowId = row.backfillCursorRowId;
    const afterRowId = rawBackfillCursorRowId === null
      ? null
      : yield* decodeStoredBuildStateFieldResult(
        orderedIndexRowIdHexV1FromBytesResult(rawBackfillCursorRowId),
        expectedScopeId,
        expectedIndexDefinitionId,
      );
    const decodedBackfillCursor = yield* decodeStoredBuildStateFieldResult(
      decodeIndexBuildBackfillCursorResult({
        codecVersion: cursorCodecVersion,
        afterRowId,
      }),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    const backfillCursor = Object.freeze({
      codecVersion: decodedBackfillCursor.codecVersion,
      afterRowId: decodedBackfillCursor.afterRowId,
    });
    const attemptFence = yield* decodeStoredBuildStateFieldResult(
      decodeIndexBuildAttemptFenceResult(row.attemptFence),
      expectedScopeId,
      expectedIndexDefinitionId,
    );
    if (
      scopeId !== expectedScopeId ||
      indexDefinitionId !== expectedIndexDefinitionId
    ) {
      return yield* Result.fail(new IndexBuildStateCorruptionError(
        expectedScopeId,
        expectedIndexDefinitionId,
        "point query returned another build identity",
      ));
    }
    if (
      (lifecycle === "declared" || lifecycle === "building") &&
      backfillCursor.afterRowId !== null
    ) {
      return yield* Result.fail(new IndexBuildStateCorruptionError(
        scopeId,
        indexDefinitionId,
        `${lifecycle} build unexpectedly carries a backfill cursor`,
      ));
    }
    const createdAt = yield* decodeTimestamp(
      row.createdAt,
      scopeId,
      indexDefinitionId,
      "created",
    );
    const updatedAt = yield* decodeTimestamp(
      row.updatedAt,
      scopeId,
      indexDefinitionId,
      "updated",
    );
    if (updatedAt < createdAt) {
      return yield* Result.fail(new IndexBuildStateCorruptionError(
        scopeId,
        indexDefinitionId,
        "updated timestamp precedes creation",
      ));
    }

    if ((row.maintenanceActivationSequence === null) !== (maintenanceObligation === null)) {
      return yield* Result.fail(storedBuildStateCorruption(scopeId, indexDefinitionId,
        "Maintenance binding and obligation presence disagree"));
    }
    const maintenance = maintenanceObligation === null ? null : yield* decodeIndexMaintenanceObligationResult(
      maintenanceObligation,
    ).pipe(Result.mapError(cause => storedBuildStateCorruption(scopeId, indexDefinitionId, cause)));
    if (maintenance !== null && (lifecycle !== "enabled" ||
      maintenance.activationSequence !== row.maintenanceActivationSequence || maintenance.scopeId !== scopeId ||
      maintenance.indexDefinitionId !== indexDefinitionId || maintenance.storageGeneration !== storageGeneration ||
      maintenance.storageGenerationFence !== storageGenerationFence || maintenance.epoch !== epoch ||
      maintenance.attemptFence !== attemptFence || maintenance.firstReadableCommitSeq !== firstReadableCommitSeq ||
      maintenance.openedCommitSeq !== coveredThroughCommitSeq)) {
      return yield* Result.fail(storedBuildStateCorruption(scopeId, indexDefinitionId,
        "Maintenance obligation does not match build opening"));
    }
    const common = {
      maintenance,
      scopeId,
      indexDefinitionId,
      storageGeneration,
      storageGenerationFence,
      epoch,
      startCommitSeq,
      coveredThroughCommitSeq,
      firstReadableCommitSeq,
      attemptFence,
      createdAt,
      updatedAt,
    } satisfies IndexBuildStateRecordBase;
    if (lifecycle === "declared" || lifecycle === "building") {
      const preBackfillCursor: IndexBuildPreBackfillCursorV1 = Object.freeze({
        codecVersion: backfillCursor.codecVersion,
        afterRowId: null,
      });
      return Object.freeze({
        ...common,
        lifecycle,
        backfillCursor: preBackfillCursor,
      });
    }
    return Object.freeze({ ...common, lifecycle, backfillCursor });
  });
}

/** Package-internal frontier invariant shared by fenced reads and readiness. */
export function validateIndexBuildStateFrontierResult(
  state: IndexBuildStateRecord,
  lastCommitSeq: CommitSeq,
): Result.Result<void, IndexBuildStateCorruptionError> {
  for (const [name, frontier] of [
    ["start", state.startCommitSeq],
    ["coverage", state.coveredThroughCommitSeq],
  ] as const) {
    if (frontier !== null && frontier > lastCommitSeq) {
      return Result.fail(new IndexBuildStateCorruptionError(
        state.scopeId, state.indexDefinitionId,
        `${name} commit sequence ${frontier} is ahead of scope clock ${lastCommitSeq}`,
      ));
    }
  }
  return Result.succeed(undefined);
}

type IndexCoverageDefinition = Pick<AppIndexDefinitionRecord, "indexDefinitionId" | "physicalSpecSha256Hex"> & {
  readonly tableId: AppIndexDefinitionRecord["access"]["tableId"];
};

export interface IndexCoverageContext {
  readonly clock: ScopeClockRecord;
  readonly active: (CoherentApplicationActiveHead & { readonly schema: { readonly deploymentId: string; readonly schemaVersionId: string; readonly schemaManifestSha256: string } }) | null;
}

const coverageTableFrontiers = new WeakMap<IndexCoverageContext, Readonly<{
  tx: AppRowTransaction;
  frontiers: ReadonlyMap<CatalogTableId, Result.Result<CommitSeq | null, AppRowTableFrontierCorruptionError>>;
}>>();
const coverageContextTransactions = new WeakMap<IndexCoverageContext, Readonly<{
  tx: AppRowTransaction; clock: ScopeClockRecord; active: IndexCoverageContext["active"];
}>>();
const registerCoverageContext = (context: IndexCoverageContext, tx: AppRowTransaction, clock: ScopeClockRecord): void => {
  coverageContextTransactions.set(context, { tx, clock: { ...clock, updatedAt: new Date(clock.updatedAt.getTime()) },
    active: context.active === null ? null : structuredClone(context.active) });
};

/** Only an exact, still-current snapshot can lend a coverage observation to another owner. */
export function matchIndexCoverageContextInTransaction(
  tx: AppRowTransaction, clock: ScopeClockRecord, context: IndexCoverageContext,
): Result.Result<boolean, IndexMaintenanceError> {
  const issued = coverageContextTransactions.get(context);
  if (issued === undefined || issued.tx !== tx) return Result.fail(new IndexMaintenanceError({ reason: "storedState" }));
  const observed = issued.clock;
  if (context.clock.scopeId !== observed.scopeId ||
    context.clock.storageGeneration !== observed.storageGeneration ||
    context.clock.storageGenerationFence !== observed.storageGenerationFence ||
    context.clock.epoch !== observed.epoch ||
    context.clock.lastCommitSeq !== observed.lastCommitSeq ||
    context.clock.oldestAvailableCommitSeq !== observed.oldestAvailableCommitSeq ||
    context.clock.updatedAt.getTime() !== observed.updatedAt.getTime() ||
    observed.scopeId !== clock.scopeId ||
    observed.storageGeneration !== clock.storageGeneration ||
    observed.storageGenerationFence !== clock.storageGenerationFence || observed.epoch !== clock.epoch ||
    clock.lastCommitSeq < observed.lastCommitSeq ||
    clock.oldestAvailableCommitSeq < observed.oldestAvailableCommitSeq)
    return Result.fail(new IndexMaintenanceError({ reason: "storedState" }));
  return Result.succeed(observed.lastCommitSeq === clock.lastCommitSeq &&
    observed.oldestAvailableCommitSeq === clock.oldestAvailableCommitSeq &&
    observed.updatedAt.getTime() === clock.updatedAt.getTime());
}

/** Cross-owner reuse receives a fresh projection from the issuer-held evidence, never the caller's mutable context. */
export function borrowIndexCoverageContextInTransaction(
  tx: AppRowTransaction, clock: ScopeClockRecord, context: IndexCoverageContext,
): Result.Result<IndexCoverageContext | null, IndexMaintenanceError> {
  return Result.gen(function* () {
    if (!(yield* matchIndexCoverageContextInTransaction(tx, clock, context))) return null;
    const issued = coverageContextTransactions.get(context);
    if (issued === undefined) return yield* Result.fail(new IndexMaintenanceError({ reason: "storedState" }));
    const borrowed = Object.freeze({ clock: { ...issued.clock, updatedAt: new Date(issued.clock.updatedAt.getTime()) },
      active: issued.active === null ? null : structuredClone(issued.active) });
    registerCoverageContext(borrowed, tx, clock);
    return borrowed;
  });
}

/** Borrow only the exact selected table frontiers already read under this clock. */
export function readPreparedIndexCoverageTableFrontiers(
  tx: AppRowTransaction, clock: ScopeClockRecord, context: IndexCoverageContext,
  tableIds: ReadonlyArray<CatalogTableId>,
): Result.Result<ReadonlyMap<CatalogTableId,
  Result.Result<CommitSeq | null, AppRowTableFrontierCorruptionError>> | null, IndexMaintenanceError> {
  return Result.gen(function* () {
    const matched = yield* matchIndexCoverageContextInTransaction(tx, clock, context);
    if (!matched) return null;
    const cached = coverageTableFrontiers.get(context);
    if (cached === undefined || cached.tx !== tx || tableIds.some(tableId => !cached.frontiers.has(tableId)))
      return null;
    const detached = new Map<CatalogTableId,
      Result.Result<CommitSeq | null, AppRowTableFrontierCorruptionError>>();
    for (const tableId of tableIds) {
      const result = cached.frontiers.get(tableId);
      if (result === undefined) return yield* Result.fail(new IndexMaintenanceError({ reason: "storedState" }));
      const detachedResult = Result.match(result, {
        onSuccess: frontier => Result.succeed(frontier),
        onFailure: error => Result.fail(new AppRowTableFrontierCorruptionError(
          error.scopeId, error.tableId, error)),
      });
      detached.set(tableId, detachedResult);
    }
    return detached;
  });
}

/** Application activation owns a maintained suffix. A separately admitted
 * logical source requires explicit build progress and cannot borrow that suffix.
 * A joint command names exactly which selected tables retain Application
 * maintenance; framework-owned tables still require source-bound coverage. */
export type IndexPublicationProfile = "activeApplication" | "sourceBound" |
  Readonly<{ kind: "mixedSelectedSources"; activeApplicationTables: ReadonlySet<CatalogTableId>;
    activeApplicationDeveloperIndexDefinitionIds: ReadonlySet<CatalogIndexDefinitionId> }>;
export const publicationModeForTable = (profile: IndexPublicationProfile, tableId: CatalogTableId) =>
  typeof profile === "string" ? profile : profile.activeApplicationTables.has(tableId) ? "activeApplication" : "sourceBound";
export const publicationModeForIndex = (profile: IndexPublicationProfile, definition: AppIndexDefinitionRecord) =>
  typeof profile === "string" ? profile : definition.access.kind === "by_creation_time"
    ? publicationModeForTable(profile, definition.access.tableId)
    : profile.activeApplicationDeveloperIndexDefinitionIds.has(definition.indexDefinitionId) ? "activeApplication" : "sourceBound";

type MaterializationObservation = Parameters<typeof decodeApplicationMaterializationObservation>[2];
const materializationCaptureBrand: unique symbol = Symbol("MaterializationCoverageCapture");
export interface CapturedApplicationMaterializationCoverage { readonly [materializationCaptureBrand]: true }
class CapturedMaterializationCoverage implements CapturedApplicationMaterializationCoverage {
  readonly [materializationCaptureBrand] = true;
  #tx: AppRowTransaction;
  #clockIdentity: NonNullable<ReturnType<typeof exactScopeWriteClockObservationIdentity>>;
  #observation: MaterializationObservation;
  constructor(tx: AppRowTransaction, clockIdentity: NonNullable<ReturnType<typeof exactScopeWriteClockObservationIdentity>>, observation: MaterializationObservation) {
    this.#tx = tx; this.#clockIdentity = clockIdentity; this.#observation = observation;
  }
  read(tx: AppRowTransaction, clock: ScopeClockRecord) {
    return this.#tx === tx && this.#clockIdentity === exactScopeWriteClockObservationIdentity(tx, clock.scopeId)
      ? Result.succeed(this.#observation) : Result.fail(new IndexMaintenanceError({ reason: "storedState" }));
  }
}
/** The fixed publication stage lends its observation to this original issuer.
 * Only the current accepting clock and genuine registered protection choose
 * the observation profile; callers cannot manufacture a snapshot verdict. */
export interface ApplicationMaterializationCoverageCapture {
  readonly snapshot: boolean;
  readonly capture: (observation: Omit<MaterializationObservation, "snapshot">) => Result.Result<CapturedApplicationMaterializationCoverage, IndexMaintenanceError>;
}
export function prepareApplicationMaterializationCoverageCapture(tx: AppRowTransaction, clock: ScopeClockRecord): Result.Result<ApplicationMaterializationCoverageCapture, IndexMaintenanceError> {
  return Result.gen(function* () {
    const pair = yield* readRegisteredManagedMetadataPairFinalGuards(tx).pipe(Result.mapError(cause =>
      new IndexMaintenanceError({ reason: "storedState", cause })));
    const identity = exactScopeWriteClockObservationIdentity(tx, clock.scopeId);
    if (identity === undefined) return yield* Result.fail(new IndexMaintenanceError({ reason: "storedState" }));
    const snapshot = pair !== null;
    return Object.freeze({ snapshot,
      capture(observation: Omit<MaterializationObservation, "snapshot">) {
        return exactScopeWriteClockObservationIdentity(tx, clock.scopeId) === identity
          ? Result.succeed(new CapturedMaterializationCoverage(tx, identity, { ...observation, snapshot }))
          : Result.fail(new IndexMaintenanceError({ reason: "storedState" }));
      },
    });
  });
}


/** Keep this value within the guarded transaction that produced it. */
export const readIndexCoverageContextInTransactionEffect = Effect.fn("IndexBuildState.readCoverageContext")(
  function* (tx: AppRowTransaction, clock: ScopeClockRecord,
    checkedActive?: CheckedApplicationActiveHead,
    capturedCoverage?: CapturedApplicationMaterializationCoverage): Effect.fn.Return<IndexCoverageContext, IndexMaintenanceError> {
    return yield* Effect.gen(function* () {
      if (capturedCoverage !== undefined) {
        if (!(capturedCoverage instanceof CapturedMaterializationCoverage))
          return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
        const observation = yield* Effect.fromResult(capturedCoverage.read(tx, clock));
        const active = yield* decodeApplicationMaterializationObservation(tx, clock.scopeId, observation);
        const context = Object.freeze({ clock, active });
        registerCoverageContext(context, tx, clock);
        return context;
      }
      const checked = checkedActive === undefined ? "refresh" as const
        : yield* Effect.fromResult(readCheckedApplicationActiveHead(checkedActive, tx, clock));
      const active = checked === "refresh"
        ? yield* readCoherentApplicationActiveHeadForShareInTransactionEffect(tx, clock.scopeId)
        : checked;
      if (active === null) {
        const context = Object.freeze({ clock, active: null });
        registerCoverageContext(context, tx, clock);
        return context;
      }
      const checkedSchema = checkedActive === undefined || checked === "refresh" ? "refresh" as const
        : yield* readCheckedApplicationSchemaForHeadForShareInTransactionEffect(checkedActive, tx, clock);
      const schema = checkedSchema === "refresh"
        ? yield* readApplicationSchemaForHeadForShareInTransactionEffect(tx, active.head)
        : checkedSchema;
      const context = Object.freeze({ clock, active: Object.freeze({ ...active, schema }) });
      registerCoverageContext(context, tx, clock);
      return context;
    }).pipe(Effect.mapError(cause => cause instanceof IndexMaintenanceError ? cause :
      new IndexMaintenanceError({ reason: cause.reason, retryable: cause.retryable, cause: cause.cause })));
  },
);

/** Prepare only selected, uncovered source-table pointers in the accepting
 * transaction. The context is the sole holder of the batch result; callers
 * cannot supply a substitute frontier to the coverage decision. */
export const readIndexCoverageTableFrontiersInTransactionEffect = Effect.fn(
  "IndexBuildState.readCoverageTableFrontiers",
)(function* (tx: AppRowTransaction, context: IndexCoverageContext,
  tableIds: ReadonlyArray<CatalogTableId>): Effect.fn.Return<void,
    InvalidAppRowReadInputError | AppRowReadPersistenceError | IndexMaintenanceError> {
  if (coverageContextTransactions.get(context)?.tx !== tx)
    return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  const frontiers = yield* readAppTableWriteFrontiersInTransactionEffect(tx, context.clock.scopeId, tableIds);
  coverageTableFrontiers.set(context, { tx, frontiers });
});

/** Call under the caller's scope-clock/snapshot transaction before admitting a read. */
export const isIndexBuildSnapshotCoveredInTransactionEffect = Effect.fn(
  "IndexBuildState.isSnapshotCovered",
)(function* (
  tx: AppRowTransaction,
  state: IndexBuildStateRecord,
  definition: IndexCoverageDefinition,
  snapshotCommitSeq: CommitSeq,
  context: IndexCoverageContext,
  pendingPublicationCommitSeq?: CommitSeq,
): Effect.fn.Return<
  boolean,
  AppRowReadPersistenceError | InvalidAppRowReadInputError | AppRowTableFrontierCorruptionError | IndexMaintenanceError
> {
  if (state.indexDefinitionId !== definition.indexDefinitionId || state.scopeId !== context.clock.scopeId || state.storageGeneration !== context.clock.storageGeneration ||
    state.storageGenerationFence !== context.clock.storageGenerationFence || state.epoch !== context.clock.epoch ||
    snapshotCommitSeq > context.clock.lastCommitSeq ||
    (state.coveredThroughCommitSeq !== null && state.coveredThroughCommitSeq > context.clock.lastCommitSeq)) {
    return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  }
  const covered = state.coveredThroughCommitSeq;
  if (
    state.lifecycle !== "enabled" ||
    covered === null ||
    state.firstReadableCommitSeq === null ||
    state.firstReadableCommitSeq > snapshotCommitSeq
  )
    return false;
  if (state.maintenance !== null) {
    const obligation = state.maintenance;
    if (obligation.tableId !== definition.tableId || encodeBytesToLowercaseHex(obligation.physicalSpecSha256) !== definition.physicalSpecSha256Hex || context.active === null ||
      obligation.deploymentId !== context.active.schema.deploymentId || obligation.schemaVersionId !== context.active.schema.schemaVersionId ||
      encodeBytesToLowercaseHex(obligation.schemaManifestSha256) !== context.active.schema.schemaManifestSha256 ||
      obligation.activationSequence !== context.active.head.activationSequence ||
      !bytesEqualFullScan(obligation.activationSha256, context.active.head.activationSha256) ||
      encodeBytesToLowercaseHex(obligation.headSha256) !== encodeBytesToLowercaseHex(context.active.head.headSha256)) {
      return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    }
    return true;
  }
  if (covered >= snapshotCommitSeq) return true;
  if (pendingPublicationCommitSeq !== undefined) {
    if (pendingPublicationCommitSeq !== context.clock.lastCommitSeq + 1n ||
      snapshotCommitSeq !== context.clock.lastCommitSeq)
      return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    const scope = yield* Effect.fromResult(projectScopeIdUuidV1Result(state.scopeId))
      .pipe(Effect.mapError(cause => new IndexMaintenanceError({ reason: "storedState", cause })));
    // Current pointers already include this transaction's writes. The
    // immutable published fact prefix is the indexed proof of whether an
    // older build missed any committed source-table write before this one.
    const published = yield* Effect.uninterruptible(runDrizzleStatementEffect(
      tx.select({ commitSeq: fxSystemCommitAppRowChanges.commitSeq })
        .from(fxSystemCommitAppRowChanges).where(and(
          eq(fxSystemCommitAppRowChanges.scopeUuid, scope.scopeUuid),
          eq(fxSystemCommitAppRowChanges.tableId, definition.tableId),
          gt(fxSystemCommitAppRowChanges.commitSeq, covered),
          lte(fxSystemCommitAppRowChanges.commitSeq, snapshotCommitSeq),
        )).limit(1), cause => new IndexMaintenanceError({ reason: "resourceFailure", cause })));
    return published.length === 0;
  }
  const batch = coverageTableFrontiers.get(context);
  if (batch !== undefined && batch.tx !== tx)
    return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
  const batched = batch?.frontiers.get(definition.tableId);
  const latest = batch === undefined
    ? yield* readAppTableWriteFrontierInTransactionEffect(tx, state.scopeId, definition.tableId)
    : batched === undefined
      ? yield* Effect.die("Selected index table frontier missing from transaction batch")
      : yield* Effect.fromResult(batched);
  return latest === null || latest <= covered;
});

function decodeReadInput(
  value: unknown,
): Result.Result<
  ReadFencedIndexBuildStateInput,
  InvalidIndexBuildStateReadInputError
> {
  return Result.gen(function* () {
    if (!hasExactOwnDataKeys(value, READ_INPUT_KEYS)) {
      return yield* Result.fail(new InvalidIndexBuildStateReadInputError({
        reason: "invalidInputShape",
      }));
    }
    if (typeof value.scopeId !== "string") {
      return yield* Result.fail(new InvalidIndexBuildStateReadInputError({
        reason: "invalidScopeId",
      }));
    }
    const rawScopeId = value.scopeId;
    const scopeId = yield* decodeReadInputFieldResult(
      decodeScopeIdResult(rawScopeId),
      "invalidScopeId",
    );
    const indexDefinitionId = yield* decodeReadInputFieldResult(
      decodeCatalogIndexDefinitionIdResult(value.indexDefinitionId),
      "invalidIndexDefinitionId",
    );
    return Object.freeze({ scopeId, indexDefinitionId });
  });
}

function decodeReadInputFieldResult<Value>(
  result: Result.Result<Value, unknown>,
  reason: Extract<
    InvalidIndexBuildStateReadInputIssue["reason"],
    "invalidScopeId" | "invalidIndexDefinitionId"
  >,
): Result.Result<Value, InvalidIndexBuildStateReadInputError> {
  return result.pipe(Result.mapError((cause) =>
    new InvalidIndexBuildStateReadInputError({ reason }, { cause })
  ));
}

function decodeStoredBuildStateFieldResult<Value>(
  result: Result.Result<Value, unknown>,
  expectedScopeId: ScopeId,
  expectedIndexDefinitionId: CatalogIndexDefinitionId,
): Result.Result<Value, IndexBuildStateCorruptionError> {
  return result.pipe(Result.mapError((cause) => storedBuildStateCorruption(
    expectedScopeId,
    expectedIndexDefinitionId,
    cause,
  )));
}

function storedBuildStateCorruption(
  expectedScopeId: ScopeId,
  expectedIndexDefinitionId: CatalogIndexDefinitionId,
  cause: unknown,
): IndexBuildStateCorruptionError {
  return new IndexBuildStateCorruptionError(
    expectedScopeId,
    expectedIndexDefinitionId,
    "stored identity, authority pin, lifecycle, or cursor is invalid",
    { cause },
  );
}

function freezeAuthority(
  authority: IndexBuildStorageAuthority,
): IndexBuildStorageAuthority {
  return Object.freeze({
    scopeId: authority.scopeId,
    storageGeneration: authority.storageGeneration,
    storageGenerationFence: authority.storageGenerationFence,
    epoch: authority.epoch,
  });
}

function collectAuthorityMismatches(
  buildState: IndexBuildStateRecord,
  currentAuthority: IndexBuildStorageAuthority,
): IndexBuildAuthorityMismatches | null {
  const mismatches: IndexBuildAuthorityMismatch[] = [];
  if (buildState.storageGeneration !== currentAuthority.storageGeneration) {
    mismatches.push("storageGeneration");
  }
  if (
    buildState.storageGenerationFence !==
      currentAuthority.storageGenerationFence
  ) {
    mismatches.push("storageGenerationFence");
  }
  if (buildState.epoch !== currentAuthority.epoch) {
    mismatches.push("epoch");
  }
  const first = mismatches[0];
  if (first === undefined) return null;
  const nonEmpty: [
    IndexBuildAuthorityMismatch,
    ...IndexBuildAuthorityMismatch[],
  ] = [first, ...mismatches.slice(1)];
  return Object.freeze(nonEmpty);
}

function decodeTimestamp(
  value: unknown,
  scopeId: ScopeId,
  indexDefinitionId: CatalogIndexDefinitionId,
  field: "created" | "updated",
): Result.Result<Date, IndexBuildStateCorruptionError> {
  const timestamp = copyFiniteDate(value);
  if (timestamp === undefined) {
    return Result.fail(new IndexBuildStateCorruptionError(
      scopeId,
      indexDefinitionId,
      `${field} timestamp is invalid`,
    ));
  }
  return Result.succeed(timestamp);
}

function invalidInputMessage(
  issue: InvalidIndexBuildStateReadInputIssue,
): string {
  switch (issue.reason) {
    case "invalidInputShape":
      return "Index build-state read input must contain only scopeId and indexDefinitionId.";
    case "invalidScopeId":
      return "Index build-state scope ID is invalid.";
    case "invalidIndexDefinitionId":
      return "Index build-state physical definition ID is invalid.";
  }
}
