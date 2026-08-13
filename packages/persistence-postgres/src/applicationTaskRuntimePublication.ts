import {
  decodeTaskRuntimePublicationReceipt,
  hashTaskRuntimePublicationReceipt,
  makeLiveStandardApplicationTaskSha256V1,
  type PreparedTaskRuntimePublicationReceipt,
  type TaskRuntimePublicationReceiptAuthority,
  type TaskRuntimePublicationReceipt,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  bytesEqualFullScan,
  copyBytes,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { and, eq } from "drizzle-orm";
import { Data, Effect, Result } from "effect";

import type { AppRowTransaction } from "./appRows";
import type { ApplicationAnalysisAuthority } from
  "./applicationAnalysisRegistration";
import { databaseTimestampFromUnknown } from "./databaseTimestamp";
import type { FlarexMetadataDatabase } from "./deployments";
import { runEffectTransaction } from "./effectTransaction";
import {
  fxSystemApplicationTaskRuntimeObjectsV1,
  fxSystemApplicationTaskRuntimePublicationsV1,
  fxSystemApplicationTaskCatalogsV1,
  fxSystemApplicationCandidatesV1,
  fxSystemScopeClocks,
} from "./schema";

export interface PublishApplicationTaskRuntimeInput {
  readonly authority: ApplicationAnalysisAuthority;
  readonly publication: PreparedTaskRuntimePublicationReceipt;
}

export interface ApplicationTaskRuntimePublicationResult {
  readonly disposition: "published" | "replayed";
  readonly scopeId: ApplicationAnalysisAuthority["scopeId"];
  readonly revisionId: string;
  readonly candidateId: string;
  readonly receiptSha256: string;
  readonly objectCount: number;
  readonly publishedAt: Date;
  readonly readReceipt: () => TaskRuntimePublicationReceipt;
  readonly readCanonicalBytes: () => Uint8Array;
}

export class ApplicationTaskRuntimePublicationError extends Data.TaggedError(
  "ApplicationTaskRuntimePublicationError",
)<{
  readonly operation: "publish";
  readonly reason:
    | "invalidInput"
    | "authorityChanged"
    | "taskCatalogMissing"
    | "taskCatalogMismatch"
    | "conflictingReplay"
    | "storedState"
    | "settlementUncertain"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

export interface ApplicationTaskRuntimePublicationRepository {
  readonly publish: (
    input: PublishApplicationTaskRuntimeInput,
  ) => Effect.Effect<
    ApplicationTaskRuntimePublicationResult,
    ApplicationTaskRuntimePublicationError
  >;
}

interface PreparedPublication {
  readonly authority: ApplicationAnalysisAuthority;
  readonly receipt: TaskRuntimePublicationReceipt;
  readonly receiptBytes: Uint8Array;
  readonly receiptSha256: Uint8Array;
}

const receiptSha256 = makeLiveStandardApplicationTaskSha256V1();

export function makeApplicationTaskRuntimePublicationRepository(
  db: FlarexMetadataDatabase,
  receiptAuthority: Pick<
    TaskRuntimePublicationReceiptAuthority,
    "captureReceipt"
  >,
): ApplicationTaskRuntimePublicationRepository {
  return Object.freeze({
    publish: Effect.fn("ApplicationTaskRuntimePublication.publish")(
      function* (input: PublishApplicationTaskRuntimeInput) {
        const prepared = yield* prepare(input, receiptAuthority);
        return yield* runTransaction(db, tx => publishInTransaction(
          tx,
          prepared,
        ));
      },
    ),
  });
}

const prepare = Effect.fn("ApplicationTaskRuntimePublication.prepare")(
  function* (
    input: PublishApplicationTaskRuntimeInput,
    receiptAuthority: Pick<
      TaskRuntimePublicationReceiptAuthority,
      "captureReceipt"
    >,
  ): Effect.fn.Return<PreparedPublication, ApplicationTaskRuntimePublicationError> {
    const inputValues = yield* Effect.fromResult(Result.try({
      try: () => ({
        authority: input.authority,
        publication: input.publication,
      }),
      catch: cause => failureValue("invalidInput", false, cause),
    }));
    const captured = yield* Effect.fromResult(
      Result.try({
        try: () => receiptAuthority.captureReceipt(
          inputValues.publication,
        ),
        catch: cause => failureValue("invalidInput", false, cause),
      }).pipe(
        Result.flatMap(result => result.pipe(
          Result.mapError(cause => failureValue("invalidInput", false, cause)),
        )),
      ),
    );
    const authority = captureAuthority(inputValues.authority);
    if (authority === undefined || captured.receipt.scopeId !== authority.scopeId) {
      return yield* failure("invalidInput");
    }
    return Object.freeze({
      authority,
      receipt: captured.receipt,
      receiptBytes: copyBytes(captured.canonicalBytes),
      receiptSha256: copyBytes(captured.sha256),
    });
  },
);

const publishInTransaction = Effect.fn(
  "ApplicationTaskRuntimePublication.publishInTransaction",
)(function* (
  tx: AppRowTransaction,
  prepared: PreparedPublication,
): Effect.fn.Return<
  ApplicationTaskRuntimePublicationResult,
  ApplicationTaskRuntimePublicationError
> {
    const clocks = yield* query(
      tx.select().from(fxSystemScopeClocks).where(eq(
        fxSystemScopeClocks.scopeId,
        prepared.authority.scopeId,
      )).limit(1).for("update"),
    );
    const clock = clocks[0];
    if (clock === undefined ||
      clock.storageGeneration !== prepared.authority.storageGeneration ||
      clock.storageGenerationFence !==
        prepared.authority.storageGenerationFence ||
      clock.epoch !== prepared.authority.epoch) {
      return yield* failure("authorityChanged");
    }
    const candidates = yield* query(
      tx.select().from(fxSystemApplicationCandidatesV1).where(and(
        eq(fxSystemApplicationCandidatesV1.scopeId,
          prepared.authority.scopeId),
        eq(fxSystemApplicationCandidatesV1.candidateId,
          prepared.receipt.candidateId),
      )).limit(1).for("update"),
    );
    const candidate = candidates[0];
    if (candidate === undefined ||
      candidate.storageGeneration !== prepared.authority.storageGeneration ||
      candidate.storageGenerationFence !==
        prepared.authority.storageGenerationFence ||
      candidate.epoch !== prepared.authority.epoch ||
      !bytesEqualFullScan(
        candidate.sourceArtifactRootSha256,
        prepared.receipt.sourceArtifactRootSha256,
      )) {
      return yield* failure("authorityChanged");
    }
    const catalogRows = yield* query(
      tx.select().from(fxSystemApplicationTaskCatalogsV1).where(and(
        eq(fxSystemApplicationTaskCatalogsV1.scopeId,
          prepared.authority.scopeId),
        eq(fxSystemApplicationTaskCatalogsV1.revisionId,
          prepared.receipt.applicationRevisionId),
      )).limit(1).for("update"),
    );
    const catalog = catalogRows[0];
    if (catalog === undefined) return yield* failure("taskCatalogMissing");
    if (!catalogMatches(catalog, prepared.receipt)) {
      return yield* failure("taskCatalogMismatch");
    }
    const existing = yield* query(
      tx.select().from(fxSystemApplicationTaskRuntimePublicationsV1).where(and(
        eq(fxSystemApplicationTaskRuntimePublicationsV1.scopeId,
          prepared.authority.scopeId),
        eq(fxSystemApplicationTaskRuntimePublicationsV1.revisionId,
          prepared.receipt.applicationRevisionId),
      )).limit(1).for("update"),
    );
    if (existing[0] !== undefined) {
      return yield* loadExisting(tx, prepared, existing[0]);
    }
    const inserted = yield* query(
      tx.insert(fxSystemApplicationTaskRuntimePublicationsV1).values({
        scopeId: prepared.authority.scopeId,
        revisionId: prepared.receipt.applicationRevisionId,
        candidateId: prepared.receipt.candidateId,
        analysisId: prepared.receipt.analysisId,
        applicationPublicationSha256:
          prepared.receipt.applicationPublicationSha256,
        sourceArtifactRootSha256:
          prepared.receipt.sourceArtifactRootSha256,
        taskCatalogSha256: prepared.receipt.taskCatalogSha256,
        applicationTaskCatalogBindingSha256:
          prepared.receipt.applicationTaskCatalogBindingSha256,
        applicationRevisionTaskBindingSha256:
          prepared.receipt.applicationRevisionTaskBindingSha256,
        taskEntryRootSha256: prepared.receipt.taskEntryRootSha256,
        taskRuntimeProjectionSha256:
          prepared.receipt.taskRuntimeProjectionSha256,
        taskRuntimeGroupManifestSha256:
          prepared.receipt.taskRuntimeGroupManifestSha256,
        taskRuntimeMaterializationSpecSha256:
          prepared.receipt.taskRuntimeMaterializationSpecSha256,
        objectCount: prepared.receipt.runtimeObjects.length,
        receiptSha256: prepared.receiptSha256,
        receiptBytes: prepared.receiptBytes,
      }).onConflictDoNothing().returning({
        publishedAt: fxSystemApplicationTaskRuntimePublicationsV1.publishedAt,
      }),
    );
    const created = inserted[0];
    if (created === undefined) {
      const raced = yield* query(
        tx.select().from(fxSystemApplicationTaskRuntimePublicationsV1).where(and(
          eq(fxSystemApplicationTaskRuntimePublicationsV1.scopeId,
            prepared.authority.scopeId),
          eq(fxSystemApplicationTaskRuntimePublicationsV1.revisionId,
            prepared.receipt.applicationRevisionId),
        )).limit(1).for("update"),
      );
      return raced[0] === undefined
        ? yield* failure("storedState")
        : yield* loadExisting(tx, prepared, raced[0]);
    }
    if (prepared.receipt.runtimeObjects.length > 0) {
      yield* execute(tx.insert(fxSystemApplicationTaskRuntimeObjectsV1).values(
        prepared.receipt.runtimeObjects.map(item => ({
          scopeId: prepared.authority.scopeId,
          revisionId: prepared.receipt.applicationRevisionId,
          receiptSha256: prepared.receiptSha256,
          role: item.reference.role,
          ordinal: item.ordinal,
          storeIdentity: item.reference.storeIdentity,
          codecIdentity: item.codecIdentity,
          objectKey: item.reference.objectKey,
          byteLength: item.reference.byteLength,
          sha256: item.reference.sha256,
        })),
      ));
    }
    const publishedAt = databaseTimestampFromUnknown(created.publishedAt);
    return publishedAt === null
      ? yield* failure("storedState")
      : result(prepared, "published", publishedAt);
});

const loadExisting = Effect.fn(
  "ApplicationTaskRuntimePublication.loadExisting",
)(function* (
  tx: AppRowTransaction,
  requested: PreparedPublication,
  row: typeof fxSystemApplicationTaskRuntimePublicationsV1.$inferSelect,
): Effect.fn.Return<
  ApplicationTaskRuntimePublicationResult,
  ApplicationTaskRuntimePublicationError
> {
    const decoded = yield* Effect.fromResult(
      decodeTaskRuntimePublicationReceipt(row.receiptBytes).pipe(
        Result.mapError(cause => failureValue("storedState", false, cause)),
      ),
    );
    const verifiedSha256 = yield* hashTaskRuntimePublicationReceipt(
      decoded,
      receiptSha256,
    ).pipe(
      Effect.catchTag("InvalidTaskRuntimePublicationError", cause =>
        Effect.fail(failureValue("storedState", false, cause))
      ),
      Effect.catchTag("StandardApplicationTaskSha256InputV1Error", cause =>
        Effect.die(cause)
      ),
      Effect.catchTag("StandardApplicationTaskSha256ResourceV1Error", cause =>
        Effect.fail(failureValue("resourceFailure", true, cause))
      ),
    );
    if (!bytesEqualFullScan(row.receiptSha256, verifiedSha256)) {
      return yield* failure("storedState");
    }
    const children = yield* query(
      tx.select().from(fxSystemApplicationTaskRuntimeObjectsV1).where(and(
        eq(fxSystemApplicationTaskRuntimeObjectsV1.scopeId, row.scopeId),
        eq(fxSystemApplicationTaskRuntimeObjectsV1.revisionId, row.revisionId),
      )),
    );
    if (!storedPublicationMatches(row, children, decoded)) {
      return yield* failure("storedState");
    }
    if (
      !bytesEqualFullScan(row.receiptBytes, requested.receiptBytes) ||
      !bytesEqualFullScan(row.receiptSha256, requested.receiptSha256)
    ) return yield* failure("conflictingReplay");
    const publishedAt = databaseTimestampFromUnknown(row.publishedAt);
    return publishedAt === null
      ? yield* failure("storedState")
      : result(requested, "replayed", publishedAt);
});

function storedPublicationMatches(
  row: typeof fxSystemApplicationTaskRuntimePublicationsV1.$inferSelect,
  rows: ReadonlyArray<typeof fxSystemApplicationTaskRuntimeObjectsV1.$inferSelect>,
  receipt: TaskRuntimePublicationReceipt,
): boolean {
  if (
    row.scopeId !== receipt.scopeId ||
    row.revisionId !== receipt.applicationRevisionId ||
    row.candidateId !== receipt.candidateId ||
    row.analysisId !== receipt.analysisId ||
    row.objectCount !== receipt.runtimeObjects.length ||
    !digestFieldsMatch(row, receipt) || rows.length !== receipt.runtimeObjects.length
  ) return false;
  const byIdentity = new Map(rows.map(item => [
    `${item.role}\u0000${item.ordinal.toString(10)}`,
    item,
  ]));
  return receipt.runtimeObjects.every(expected => {
    const stored = byIdentity.get(
      `${expected.reference.role}\u0000${expected.ordinal.toString(10)}`,
    );
    return stored !== undefined &&
      bytesEqualFullScan(stored.receiptSha256, row.receiptSha256) &&
      stored.storeIdentity === expected.reference.storeIdentity &&
      stored.codecIdentity === expected.codecIdentity &&
      stored.objectKey === expected.reference.objectKey &&
      stored.byteLength === expected.reference.byteLength &&
      bytesEqualFullScan(stored.sha256, expected.reference.sha256);
  });
}

function digestFieldsMatch(
  row: typeof fxSystemApplicationTaskRuntimePublicationsV1.$inferSelect,
  receipt: TaskRuntimePublicationReceipt,
): boolean {
  const pairs: ReadonlyArray<readonly [Uint8Array | null, Uint8Array | null]> = [
    [row.taskCatalogSha256, receipt.taskCatalogSha256],
    [row.applicationTaskCatalogBindingSha256,
      receipt.applicationTaskCatalogBindingSha256],
    [row.applicationPublicationSha256,
      receipt.applicationPublicationSha256],
    [row.sourceArtifactRootSha256, receipt.sourceArtifactRootSha256],
    [row.applicationRevisionTaskBindingSha256,
      receipt.applicationRevisionTaskBindingSha256],
    [row.taskEntryRootSha256, receipt.taskEntryRootSha256],
    [row.taskRuntimeProjectionSha256, receipt.taskRuntimeProjectionSha256],
    [row.taskRuntimeGroupManifestSha256,
      receipt.taskRuntimeGroupManifestSha256],
    [row.taskRuntimeMaterializationSpecSha256,
      receipt.taskRuntimeMaterializationSpecSha256],
  ];
  return pairs.every(([left, right]) => left === null || right === null
    ? left === right
    : bytesEqualFullScan(left, right));
}

function catalogMatches(
  catalog: typeof fxSystemApplicationTaskCatalogsV1.$inferSelect,
  receipt: TaskRuntimePublicationReceipt,
): boolean {
  return catalog.revisionId === receipt.applicationRevisionId &&
    catalog.candidateId === receipt.candidateId &&
    catalog.analysisId === receipt.analysisId &&
    catalog.taskCount === receipt.runtimeObjects.filter(
      item => item.reference.role === "task_runtime_entry",
    ).length &&
    bytesEqualFullScan(
      catalog.publicationSha256,
      receipt.applicationPublicationSha256,
    ) &&
    bytesEqualFullScan(
      catalog.sourceArtifactRootSha256,
      receipt.sourceArtifactRootSha256,
    ) &&
    bytesEqualFullScan(catalog.taskCatalogSha256, receipt.taskCatalogSha256) &&
    bytesEqualFullScan(
      catalog.taskCatalogBindingSha256,
      receipt.applicationTaskCatalogBindingSha256,
    );
}

function result(
  prepared: PreparedPublication,
  disposition: ApplicationTaskRuntimePublicationResult["disposition"],
  publishedAt: Date,
): ApplicationTaskRuntimePublicationResult {
  return Object.freeze({
    disposition,
    scopeId: prepared.authority.scopeId,
    revisionId: prepared.receipt.applicationRevisionId,
    candidateId: prepared.receipt.candidateId,
    receiptSha256: encodeBytesToLowercaseHex(prepared.receiptSha256),
    objectCount: prepared.receipt.runtimeObjects.length,
    publishedAt: new Date(publishedAt.getTime()),
    readReceipt: () => decodeOwnedReceipt(prepared.receiptBytes),
    readCanonicalBytes: () => copyBytes(prepared.receiptBytes),
  });
}

function decodeOwnedReceipt(bytes: Uint8Array): TaskRuntimePublicationReceipt {
  return Result.getOrThrow(decodeTaskRuntimePublicationReceipt(bytes));
}

function captureAuthority(
  input: ApplicationAnalysisAuthority,
): ApplicationAnalysisAuthority | undefined {
  try {
    return typeof input === "object" && input !== null
      ? Object.freeze({
        scopeId: input.scopeId,
        storageGeneration: input.storageGeneration,
        storageGenerationFence: input.storageGenerationFence,
        epoch: input.epoch,
      })
      : undefined;
  } catch {
    return undefined;
  }
}

function query<Row>(statement: PromiseLike<ReadonlyArray<Row>>): Effect.Effect<ReadonlyArray<Row>, ApplicationTaskRuntimePublicationError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => failureValue("resourceFailure", retryableCause(cause), cause),
  });
}

function execute(statement: PromiseLike<unknown>): Effect.Effect<void, ApplicationTaskRuntimePublicationError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => failureValue("resourceFailure", retryableCause(cause), cause),
  }).pipe(Effect.asVoid);
}

function runTransaction<A>(
  db: FlarexMetadataDatabase,
  body: (tx: AppRowTransaction) => Effect.Effect<A, ApplicationTaskRuntimePublicationError>,
): Effect.Effect<A, ApplicationTaskRuntimePublicationError> {
  let bodySucceeded = false;
  return runEffectTransaction(
    callback => db.transaction(callback),
    "Application task-runtime publication transaction rolled back.",
    (tx: AppRowTransaction) => body(tx).pipe(Effect.tap(() => Effect.sync(() => {
      bodySucceeded = true;
    }))),
    cause => bodySucceeded
      ? failureValue("settlementUncertain", true, cause)
      : failureValue("resourceFailure", retryableCause(cause), cause),
  );
}

function failure(reason: ApplicationTaskRuntimePublicationError["reason"]): Effect.Effect<never, ApplicationTaskRuntimePublicationError> {
  return Effect.fail(failureValue(reason));
}

function failureValue(
  reason: ApplicationTaskRuntimePublicationError["reason"],
  retryable = false,
  cause?: unknown,
): ApplicationTaskRuntimePublicationError {
  return new ApplicationTaskRuntimePublicationError({
    operation: "publish",
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}

function retryableCause(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  let code: unknown;
  try {
    code = Reflect.get(cause, "code");
  } catch {
    return false;
  }
  return code === "40001" || code === "40P01" || code === "55P03" ||
    code === "57014" || code === "57P01" || code === "57P02" ||
    code === "57P03" || code === "08000" || code === "08001" ||
    code === "08003" || code === "08004" || code === "08006" ||
    code === "08007" || code === "08P01";
}
