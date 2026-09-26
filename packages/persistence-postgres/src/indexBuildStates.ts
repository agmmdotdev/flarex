import { copyFiniteDate } from "@flarex/utils/dates";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { and, asc, eq, gt, inArray, lte } from "drizzle-orm";
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

import { readAppTableWriteFrontierInTransactionEffect, type AppRowTransaction, type AppRowReadPersistenceError, type AppRowTableFrontierCorruptionError, type InvalidAppRowReadInputError } from "./appRows";
import type { AppIndexDefinitionRecord } from "./appIndexDefinitions";
import type { FlarexMetadataDatabase } from "./deployments";
import { runDrizzleStatementEffect } from "./drizzleStatementEffect";
import { hasExactOwnDataKeys } from "./exactOwnDataKeys";
import { decodeScopeClockRecordResult, type ScopeClockRecord } from "./scopeClock";
import { readCoherentApplicationActiveHeadForShareInTransactionEffect, readApplicationSchemaForHeadForShareInTransactionEffect, type CoherentApplicationActiveHead } from "./applicationActiveHeadRead";
import { decodeIndexMaintenanceEvidenceResult, verifyIndexMaintenanceEvidence, IndexMaintenanceError, type IndexMaintenanceEvidence } from "./indexMaintenanceEvidence";
import {
  fxSystemIndexBuildStates,
  fxSystemCommitAppRowChanges,
  fxSystemScopeClocks,
} from "./schema";

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
  readonly maintenance: IndexMaintenanceEvidence | null;
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

export const MAX_REQUIRED_INDEX_BUILDS = 256;

/** Shared structural gate under the caller's locked clock. The caller supplies
 * its authenticated complete requirement set. Enabled state alone is not a
 * serving grant or proof of coverage at an arbitrary read snapshot. */
export const readRequiredEnabledIndexBuildsInTransactionEffect = Effect.fn("IndexBuildState.readRequiredEnabled")(
  function* (tx: AppRowTransaction, clock: ScopeClockRecord, definitionIds: readonly CatalogIndexDefinitionId[], lock: "key share" | "share" | "update") {
    if (definitionIds.length > MAX_REQUIRED_INDEX_BUILDS || new Set(definitionIds).size !== definitionIds.length)
      return yield* Effect.fail(new IndexMaintenanceError({ reason: "storedState" }));
    const rows = definitionIds.length === 0 ? [] : yield* Effect.uninterruptible(runDrizzleStatementEffect(
      tx.select().from(fxSystemIndexBuildStates).where(and(
        eq(fxSystemIndexBuildStates.scopeId, clock.scopeId), inArray(fxSystemIndexBuildStates.indexDefinitionId, [...definitionIds]),
      )).orderBy(asc(fxSystemIndexBuildStates.indexDefinitionId)).for(lock),
      cause => new IndexBuildStatePersistenceError("readRequiredIndexBuildStates", cause),
    ));
    for (const indexDefinitionId of definitionIds) {
      const build = rows.find(row => row.indexDefinitionId === indexDefinitionId);
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
      clock: {
        scopeId: fxSystemScopeClocks.scopeId,
        scopeUuid: fxSystemScopeClocks.scopeUuid,
        storageGeneration: fxSystemScopeClocks.storageGeneration,
        storageGenerationFence:
          fxSystemScopeClocks.storageGenerationFence,
        lastCommitSeq: fxSystemScopeClocks.lastCommitSeq,
        oldestAvailableCommitSeq:
          fxSystemScopeClocks.oldestAvailableCommitSeq,
        epoch: fxSystemScopeClocks.epoch,
        epochUuid: fxSystemScopeClocks.epochUuid,
        updatedAt: fxSystemScopeClocks.updatedAt,
      },
      buildState: {
        scopeId: fxSystemIndexBuildStates.scopeId,
        maintenanceActivationSequence: fxSystemIndexBuildStates.maintenanceActivationSequence,
        maintenanceBytes: fxSystemIndexBuildStates.maintenanceBytes,
        maintenanceSha256: fxSystemIndexBuildStates.maintenanceSha256,
        indexDefinitionId: fxSystemIndexBuildStates.indexDefinitionId,
        storageGeneration: fxSystemIndexBuildStates.storageGeneration,
        storageGenerationFence:
          fxSystemIndexBuildStates.storageGenerationFence,
        epoch: fxSystemIndexBuildStates.epoch,
        startCommitSeq: fxSystemIndexBuildStates.startCommitSeq,
        coveredThroughCommitSeq: fxSystemIndexBuildStates.coveredThroughCommitSeq,
        firstReadableCommitSeq: fxSystemIndexBuildStates.firstReadableCommitSeq,
        lifecycle: fxSystemIndexBuildStates.lifecycle,
        cursorCodecVersion: fxSystemIndexBuildStates.cursorCodecVersion,
        backfillCursorRowId:
          fxSystemIndexBuildStates.backfillCursorRowId,
        attemptFence: fxSystemIndexBuildStates.attemptFence,
        createdAt: fxSystemIndexBuildStates.createdAt,
        updatedAt: fxSystemIndexBuildStates.updatedAt,
      },
    })
    .from(fxSystemScopeClocks)
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

type IndexBuildStateRow = typeof fxSystemIndexBuildStates.$inferSelect;

/** Package-internal decoder shared by the C4 read and S03-D3 transaction. */
export function decodeIndexBuildStateRowResult(
  row: IndexBuildStateRow,
  expectedScopeId: ScopeId,
  expectedIndexDefinitionId: CatalogIndexDefinitionId,
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

    const maintenance = yield* decodeIndexMaintenanceEvidenceResult(
      row.maintenanceActivationSequence, row.maintenanceBytes, row.maintenanceSha256,
    ).pipe(Result.mapError(cause => storedBuildStateCorruption(scopeId, indexDefinitionId, cause)));
    if (maintenance !== null) {
      const frame = maintenance.frame;
      if (lifecycle !== "enabled" || frame.scopeId !== scopeId || frame.indexDefinitionId !== indexDefinitionId ||
        frame.storageGeneration !== storageGeneration || frame.storageGenerationFence !== storageGenerationFence.toString() ||
        frame.epoch !== epoch || frame.attemptFence !== attemptFence.toString() ||
        frame.firstReadableCommitSeq !== firstReadableCommitSeq?.toString() || frame.openedCommitSeq !== coveredThroughCommitSeq?.toString()) {
        return yield* Result.fail(storedBuildStateCorruption(scopeId, indexDefinitionId, "Maintenance certificate does not match build state"));
      }
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

/** Application activation owns a maintained suffix. A separately admitted
 * logical source requires explicit build progress and cannot borrow that suffix.
 * A joint command names exactly which selected tables retain Application
 * maintenance; framework-owned tables still require source-bound coverage. */
export type IndexPublicationProfile = "activeApplication" | "sourceBound" |
  Readonly<{ kind: "mixedSelectedSources"; activeApplicationTables: ReadonlySet<CatalogTableId> }>;
export const publicationModeForTable = (profile: IndexPublicationProfile, tableId: CatalogTableId) =>
  typeof profile === "string" ? profile : profile.activeApplicationTables.has(tableId) ? "activeApplication" : "sourceBound";

/** Keep this value within the guarded transaction that produced it. */
export const readIndexCoverageContextInTransactionEffect = Effect.fn("IndexBuildState.readCoverageContext")(
  function* (tx: AppRowTransaction, clock: ScopeClockRecord): Effect.fn.Return<IndexCoverageContext, IndexMaintenanceError> {
    return yield* Effect.gen(function* () {
      const active = yield* readCoherentApplicationActiveHeadForShareInTransactionEffect(tx, clock.scopeId);
      if (active === null) return Object.freeze({ clock, active: null });
      const schema = yield* readApplicationSchemaForHeadForShareInTransactionEffect(tx, active.head);
      return Object.freeze({ clock, active: Object.freeze({ ...active, schema }) });
    }).pipe(Effect.mapError(cause => new IndexMaintenanceError({ reason: cause.reason, retryable: cause.retryable, cause: cause.cause })));
  },
);

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
    yield* verifyIndexMaintenanceEvidence(state.maintenance);
    const frame = state.maintenance.frame;
    if (frame.tableId !== definition.tableId || frame.physicalSpecSha256Hex !== definition.physicalSpecSha256Hex || context.active === null ||
      frame.deploymentId !== context.active.schema.deploymentId || frame.schemaVersionId !== context.active.schema.schemaVersionId ||
      frame.schemaManifestSha256 !== context.active.schema.schemaManifestSha256 ||
      frame.activationSequence !== context.active.head.activationSequence.toString() ||
      frame.headSha256 !== encodeBytesToLowercaseHex(context.active.head.headSha256)) {
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
  const latest = yield* readAppTableWriteFrontierInTransactionEffect(
    tx,
    state.scopeId,
    definition.tableId,
  );
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
