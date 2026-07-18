import { copyFiniteDate } from "@flarex/utils/dates";
import { and, eq } from "drizzle-orm";
import { Effect, Result, Schema, SchemaIssue } from "effect";
import {
  decodeCatalogIndexDefinitionId,
  type CatalogIndexDefinitionId,
} from "flarex-protocol/catalog";
import {
  IndexBuildAttemptFenceSchema,
  decodeIndexBuildBackfillCursorV1,
  decodeIndexBuildCursorCodecVersionV1,
  decodeIndexBuildLifecycleV1,
  type IndexBuildAttemptFence,
  type IndexBuildBackfillCursorV1,
  type IndexBuildLifecycleV1,
} from "flarex-protocol/index-build-state";
import {
  OrderedIndexCodecV1InputError,
  orderedIndexRowIdHexV1FromBytes,
} from "flarex-protocol/ordered-index";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
  type CommitSeq,
  type FlarexDbV1StorageGeneration,
  type ScopeEpoch,
  type ScopeId,
  type StorageGeneration,
  type StorageGenerationFence,
} from "flarex-protocol/storage-authority";

import type { FlarexMetadataDatabase } from "./deployments";
import { hasExactOwnDataKeys } from "./exactOwnDataKeys";
import {
  decodeScopeClockRecord,
  ScopeClockCorruptionError,
} from "./scopeClock";
import {
  fxSystemIndexBuildStates,
  fxSystemScopeClocks,
} from "./schema";

const READ_INPUT_KEYS = Object.freeze(["scopeId", "indexDefinitionId"]);

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
  readonly scopeId: ScopeId;
  readonly indexDefinitionId: CatalogIndexDefinitionId;
  readonly storageGeneration: FlarexDbV1StorageGeneration;
  readonly storageGenerationFence: StorageGenerationFence;
  readonly epoch: ScopeEpoch;
  readonly startCommitSeq: CommitSeq;
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
    readonly operation: "readFencedIndexBuildState",
    readonly cause: unknown,
  ) {
    super("Failed to read fenced index build state.", { cause });
    this.name = "IndexBuildStatePersistenceError";
  }
}

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
        lastOutboxSeq: fxSystemScopeClocks.lastOutboxSeq,
        epoch: fxSystemScopeClocks.epoch,
        epochUuid: fxSystemScopeClocks.epochUuid,
        updatedAt: fxSystemScopeClocks.updatedAt,
      },
      buildState: {
        scopeId: fxSystemIndexBuildStates.scopeId,
        indexDefinitionId: fxSystemIndexBuildStates.indexDefinitionId,
        storageGeneration: fxSystemIndexBuildStates.storageGeneration,
        storageGenerationFence:
          fxSystemIndexBuildStates.storageGenerationFence,
        epoch: fxSystemIndexBuildStates.epoch,
        startCommitSeq: fxSystemIndexBuildStates.startCommitSeq,
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
    const clock = yield* Result.try({
      try: () => decodeScopeClockRecord(row.clock),
      catch: (cause) => {
        if (!(cause instanceof ScopeClockCorruptionError)) throw cause;
        return new IndexBuildStateCorruptionError(
          input.scopeId,
          input.indexDefinitionId,
          "stored scope clock is invalid",
          { cause },
        );
      },
    });
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

    const buildState = yield* decodeBuildStateRow(
      row.buildState,
      input.scopeId,
      input.indexDefinitionId,
    );
    if (buildState.startCommitSeq > clock.lastCommitSeq) {
      return yield* Result.fail(new IndexBuildStateCorruptionError(
        buildState.scopeId,
        buildState.indexDefinitionId,
        `start commit sequence ${buildState.startCommitSeq} is ahead of scope clock ${clock.lastCommitSeq}`,
      ));
    }
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

function decodeBuildStateRow(
  row: IndexBuildStateRow,
  expectedScopeId: ScopeId,
  expectedIndexDefinitionId: CatalogIndexDefinitionId,
): Result.Result<IndexBuildStateRecord, IndexBuildStateCorruptionError> {
  return Result.gen(function* () {
    const decoded = yield* Result.try({
      try: () => {
        const cursorCodecVersion = decodeIndexBuildCursorCodecVersionV1(
          row.cursorCodecVersion,
        );
        return {
          scopeId: ScopeIdSchema.make(row.scopeId),
          indexDefinitionId: decodeCatalogIndexDefinitionId(
            row.indexDefinitionId,
          ),
          storageGeneration: FlarexDbV1StorageGenerationSchema.make(
            row.storageGeneration,
          ),
          storageGenerationFence: StorageGenerationFenceSchema.make(
            row.storageGenerationFence,
          ),
          epoch: ScopeEpochSchema.make(row.epoch),
          startCommitSeq: CommitSeqSchema.make(row.startCommitSeq),
          lifecycle: decodeIndexBuildLifecycleV1(row.lifecycle),
          backfillCursor: decodeIndexBuildBackfillCursorV1({
            codecVersion: cursorCodecVersion,
            afterRowId: row.backfillCursorRowId === null
              ? null
              : orderedIndexRowIdHexV1FromBytes(row.backfillCursorRowId),
          }),
          attemptFence: IndexBuildAttemptFenceSchema.make(row.attemptFence),
        };
      },
      catch: (cause) => {
        if (
          !isSchemaValidationError(cause) &&
          !(cause instanceof OrderedIndexCodecV1InputError)
        ) {
          throw cause;
        }
        return new IndexBuildStateCorruptionError(
          expectedScopeId,
          expectedIndexDefinitionId,
          "stored identity, authority pin, lifecycle, or cursor is invalid",
          { cause },
        );
      },
    });
    const {
      scopeId,
      indexDefinitionId,
      storageGeneration,
      storageGenerationFence,
      epoch,
      startCommitSeq,
      lifecycle,
      backfillCursor,
      attemptFence,
    } = decoded;
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

    const common = {
      scopeId,
      indexDefinitionId,
      storageGeneration,
      storageGenerationFence,
      epoch,
      startCommitSeq,
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
    const scopeId = yield* Result.try({
      try: () => ScopeIdSchema.make(rawScopeId),
      catch: (cause) => {
        if (!isSchemaValidationError(cause)) throw cause;
        return new InvalidIndexBuildStateReadInputError(
          { reason: "invalidScopeId" },
          { cause },
        );
      },
    });
    const indexDefinitionId = yield* Result.try({
      try: () => decodeCatalogIndexDefinitionId(value.indexDefinitionId),
      catch: (cause) => {
        if (!isSchemaValidationError(cause)) throw cause;
        return new InvalidIndexBuildStateReadInputError(
          { reason: "invalidIndexDefinitionId" },
          { cause },
        );
      },
    });
    return Object.freeze({ scopeId, indexDefinitionId });
  });
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

function isSchemaValidationError(cause: unknown): boolean {
  return Schema.isSchemaError(cause) ||
    (cause instanceof Error && SchemaIssue.isIssue(cause.cause));
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
