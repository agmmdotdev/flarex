import {
  decodeTaskRuntimePublicationReceipt,
  hashTaskRuntimePublicationReceipt,
  makeLiveStandardApplicationTaskSha256V1,
  type TaskDefinitionSha256V1,
  type TaskRuntimePublicationReceipt,
  type TaskRuntimeReadinessExpectedEvidence,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { bytesEqualFullScan, copyBytes } from "@flarex/utils/bytes";
import { and, eq } from "drizzle-orm";
import { Data, Effect, Result } from "effect";

import type { AppRowTransaction } from "./appRows";
import type { ApplicationAnalysisAuthority } from
  "./applicationAnalysisRegistration";
import {
  isApplicationTaskCatalogSnapshotPort,
  type ApplicationTaskCatalogSnapshot,
  type ApplicationTaskCatalogSnapshotError,
  type ApplicationTaskCatalogSnapshotPort,
} from "./applicationTaskBindings";
import {
  storedApplicationTaskRuntimePublicationMatches,
} from "./applicationTaskRuntimePublicationStoredState";
import {
  fxSystemApplicationCandidatesV1,
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationRevisionsV2,
  fxSystemApplicationTaskRuntimeObjectsV1,
  fxSystemApplicationTaskRuntimePublicationsV1,
  fxSystemScopeClocks,
} from "./schema";

export type ApplicationTaskRuntimeReadinessParentEvidence = Omit<
  TaskRuntimeReadinessExpectedEvidence,
  "materializationPolicy"
>;

export interface ApplicationTaskRuntimeReadinessSnapshot {
  readonly scopeId: ApplicationAnalysisAuthority["scopeId"];
  readonly revisionId: string;
  readonly candidateId: string;
  readonly receiptObjectCount: number;
  readonly readReceiptCanonicalBytes: () => Uint8Array;
  readonly readReceiptSha256: () => TaskDefinitionSha256V1;
  readonly readParentEvidence: () =>
    ApplicationTaskRuntimeReadinessParentEvidence;
}

export class ApplicationTaskRuntimeReadinessSnapshotError
  extends Data.TaggedError("ApplicationTaskRuntimeReadinessSnapshotError")<{
    readonly operation: "load";
    readonly reason:
      | "invalidInput"
      | "authorityChanged"
      | "authorityMismatch"
      | "storedState"
      | "resourceFailure";
    readonly retryable: boolean;
    readonly cause?: unknown;
  }> {}

export type LoadApplicationTaskRuntimeReadinessSnapshotError =
  | ApplicationTaskRuntimeReadinessSnapshotError
  | ApplicationTaskCatalogSnapshotError;

export interface ApplicationTaskRuntimeReadinessSnapshotPort {
  readonly loadInTransaction: (
    tx: AppRowTransaction,
    authority: ApplicationAnalysisAuthority,
    revisionId: string,
  ) => Effect.Effect<
    ApplicationTaskRuntimeReadinessSnapshot | null,
    LoadApplicationTaskRuntimeReadinessSnapshotError
  >;
}

const receiptSha256 = makeLiveStandardApplicationTaskSha256V1();
const readinessSnapshotPorts =
  new WeakSet<ApplicationTaskRuntimeReadinessSnapshotPort>();

export function createApplicationTaskRuntimeReadinessSnapshotPort(
  taskCatalog: ApplicationTaskCatalogSnapshotPort,
): ApplicationTaskRuntimeReadinessSnapshotPort {
  const capturedTaskCatalog = taskCatalog;
  const validTaskCatalog = isApplicationTaskCatalogSnapshotPort(taskCatalog);
  const loadInTransaction = Effect.fn(
    "ApplicationTaskRuntimeReadinessSnapshot.loadInTransaction",
  )(function* (
    tx: AppRowTransaction,
    authority: ApplicationAnalysisAuthority,
    revisionId: string,
  ): Effect.fn.Return<
    ApplicationTaskRuntimeReadinessSnapshot | null,
    LoadApplicationTaskRuntimeReadinessSnapshotError
  > {
    if (!validTaskCatalog || revisionId.trim().length === 0 ||
      revisionId.includes("\0")) {
      return yield* snapshotFailure("invalidInput");
    }

    const clocks = yield* snapshotQuery(
      tx.select().from(fxSystemScopeClocks).where(eq(
        fxSystemScopeClocks.scopeId,
        authority.scopeId,
      )).limit(1).for("share"),
    );
    const clock = clocks[0];
    if (clock === undefined ||
      clock.storageGeneration !== authority.storageGeneration ||
      clock.storageGenerationFence !== authority.storageGenerationFence ||
      clock.epoch !== authority.epoch) {
      return yield* snapshotFailure("authorityChanged");
    }

    const revisions = yield* snapshotQuery(
      tx.select().from(fxSystemApplicationRevisionsV2).where(and(
        eq(fxSystemApplicationRevisionsV2.scopeId, authority.scopeId),
        eq(fxSystemApplicationRevisionsV2.revisionId, revisionId),
      )).limit(1).for("share"),
    );
    const revision = revisions[0];
    if (revision === undefined) return null;

    const candidates = yield* snapshotQuery(
      tx.select().from(fxSystemApplicationCandidatesV1).where(and(
        eq(fxSystemApplicationCandidatesV1.scopeId, authority.scopeId),
        eq(fxSystemApplicationCandidatesV1.candidateId, revision.candidateId),
      )).limit(1).for("share"),
    );
    const candidate = candidates[0];
    if (candidate === undefined) return yield* snapshotFailure("storedState");
    if (candidate.storageGeneration !== authority.storageGeneration ||
      candidate.storageGenerationFence !== authority.storageGenerationFence ||
      candidate.epoch !== authority.epoch) {
      return yield* snapshotFailure("authorityChanged");
    }
    if (revision.status !== "inactive" ||
      revision.analysisStatus !== "analyzed" ||
      !bytesEqualFullScan(
        revision.sourceArtifactRootSha256,
        candidate.sourceArtifactRootSha256,
      )) return yield* snapshotFailure("authorityMismatch");

    const publications = yield* snapshotQuery(
      tx.select().from(fxSystemApplicationPublicationsV1).where(and(
        eq(fxSystemApplicationPublicationsV1.scopeId, authority.scopeId),
        eq(fxSystemApplicationPublicationsV1.revisionId, revisionId),
      )).limit(1).for("share"),
    );
    const publication = publications[0];
    if (publication === undefined) return null;
    if (publication.candidateId !== revision.candidateId ||
      publication.analysisId !== revision.analysisId ||
      publication.revisionStatus !== revision.status ||
      !bytesEqualFullScan(
        publication.sourceArtifactRootSha256,
        revision.sourceArtifactRootSha256,
      ) || !bytesEqualFullScan(
        publication.manifestSha256,
        revision.manifestSha256,
      )) return yield* snapshotFailure("authorityMismatch");

    const catalog = yield* capturedTaskCatalog.loadInTransaction(
      tx,
      authority,
      revisionId,
    );
    if (catalog === null) return null;
    if (!catalogMatchesParents(catalog, revision, publication)) {
      return yield* snapshotFailure("authorityMismatch");
    }

    const runtimePublications = yield* snapshotQuery(
      tx.select().from(fxSystemApplicationTaskRuntimePublicationsV1).where(and(
        eq(fxSystemApplicationTaskRuntimePublicationsV1.scopeId,
          authority.scopeId),
        eq(fxSystemApplicationTaskRuntimePublicationsV1.revisionId,
          revisionId),
      )).limit(1).for("share"),
    );
    const runtimePublication = runtimePublications[0];
    if (runtimePublication === undefined) return null;

    const receipt = yield* Effect.fromResult(
      decodeTaskRuntimePublicationReceipt(runtimePublication.receiptBytes).pipe(
        Result.mapError(cause => snapshotFailureValue(
          "storedState",
          false,
          cause,
        )),
      ),
    );
    const verifiedReceiptSha256 = yield* hashTaskRuntimePublicationReceipt(
      receipt,
      receiptSha256,
    ).pipe(
      Effect.catchTag("InvalidTaskRuntimePublicationError", cause =>
        Effect.fail(snapshotFailureValue("storedState", false, cause))
      ),
      Effect.catchTag("StandardApplicationTaskSha256InputV1Error", cause =>
        Effect.die(cause)
      ),
      Effect.catchTag("StandardApplicationTaskSha256ResourceV1Error", cause =>
        Effect.fail(snapshotFailureValue("resourceFailure", true, cause))
      ),
    );
    if (!bytesEqualFullScan(
      runtimePublication.receiptSha256,
      verifiedReceiptSha256,
    )) return yield* snapshotFailure("storedState");

    const runtimeObjects = yield* snapshotQuery(
      tx.select().from(fxSystemApplicationTaskRuntimeObjectsV1).where(and(
        eq(fxSystemApplicationTaskRuntimeObjectsV1.scopeId,
          authority.scopeId),
        eq(fxSystemApplicationTaskRuntimeObjectsV1.revisionId,
          revisionId),
      )).for("share"),
    );
    if (!storedApplicationTaskRuntimePublicationMatches(
      runtimePublication,
      runtimeObjects,
      receipt,
    )) return yield* snapshotFailure("storedState");
    if (!receiptMatchesParents(receipt, catalog)) {
      return yield* snapshotFailure("authorityMismatch");
    }

    return makeSnapshot(
      catalog,
      receipt,
      runtimePublication.receiptBytes,
      verifiedReceiptSha256,
    );
  });
  const port = Object.freeze({ loadInTransaction });
  readinessSnapshotPorts.add(port);
  return port;
}

export function isApplicationTaskRuntimeReadinessSnapshotPort(
  value: unknown,
): value is ApplicationTaskRuntimeReadinessSnapshotPort {
  return typeof value === "object" && value !== null &&
    readinessSnapshotPorts.has(
      value as ApplicationTaskRuntimeReadinessSnapshotPort,
    );
}

function catalogMatchesParents(
  catalog: ApplicationTaskCatalogSnapshot,
  revision: typeof fxSystemApplicationRevisionsV2.$inferSelect,
  publication: typeof fxSystemApplicationPublicationsV1.$inferSelect,
): boolean {
  return catalog.scopeId === revision.scopeId &&
    catalog.revisionId === revision.revisionId &&
    catalog.candidateId === revision.candidateId &&
    catalog.analysisId === revision.analysisId &&
    publication.candidateId === catalog.candidateId &&
    publication.analysisId === catalog.analysisId &&
    bytesEqualFullScan(
      catalog.sourceArtifactRootSha256,
      revision.sourceArtifactRootSha256,
    ) && bytesEqualFullScan(
      catalog.sourceArtifactRootSha256,
      publication.sourceArtifactRootSha256,
    ) && bytesEqualFullScan(
      catalog.publicationSha256,
      publication.publicationSha256,
    );
}

function receiptMatchesParents(
  receipt: TaskRuntimePublicationReceipt,
  catalog: ApplicationTaskCatalogSnapshot,
): boolean {
  const taskEntryCount = receipt.runtimeObjects.filter(
    item => item.reference.role === "task_runtime_entry",
  ).length;
  return receipt.scopeId === catalog.scopeId &&
    receipt.applicationRevisionId === catalog.revisionId &&
    receipt.candidateId === catalog.candidateId &&
    receipt.analysisId === catalog.analysisId &&
    taskEntryCount === catalog.taskCount &&
    bytesEqualFullScan(
      receipt.applicationPublicationSha256,
      catalog.publicationSha256,
    ) && bytesEqualFullScan(
      receipt.sourceArtifactRootSha256,
      catalog.sourceArtifactRootSha256,
    ) && bytesEqualFullScan(
      receipt.taskCatalogSha256,
      catalog.taskCatalogSha256,
    ) && bytesEqualFullScan(
      receipt.applicationTaskCatalogBindingSha256,
      catalog.taskCatalogBindingSha256,
    );
}

function makeSnapshot(
  catalog: ApplicationTaskCatalogSnapshot,
  receipt: TaskRuntimePublicationReceipt,
  receiptBytes: Uint8Array,
  verifiedReceiptSha256: TaskDefinitionSha256V1,
): ApplicationTaskRuntimeReadinessSnapshot {
  const ownedReceiptBytes = copyBytes(receiptBytes);
  const ownedReceiptSha256 = copyBytes(verifiedReceiptSha256) as
    TaskDefinitionSha256V1;
  const parent = Object.freeze({
    scopeId: catalog.scopeId,
    candidateId: catalog.candidateId,
    analysisId: catalog.analysisId,
    applicationRevisionId: catalog.revisionId,
    applicationPublicationSha256:
      copyBytes(catalog.publicationSha256) as TaskDefinitionSha256V1,
    sourceArtifactRootSha256:
      copyBytes(catalog.sourceArtifactRootSha256) as TaskDefinitionSha256V1,
    applicationTaskCatalogBindingSha256:
      copyBytes(catalog.taskCatalogBindingSha256) as TaskDefinitionSha256V1,
    taskCatalog: catalog.readTaskCatalog(),
  });
  return Object.freeze({
    scopeId: catalog.scopeId,
    revisionId: catalog.revisionId,
    candidateId: catalog.candidateId,
    receiptObjectCount: receipt.runtimeObjects.length,
    readReceiptCanonicalBytes: () => copyBytes(ownedReceiptBytes),
    readReceiptSha256: () =>
      copyBytes(ownedReceiptSha256) as TaskDefinitionSha256V1,
    readParentEvidence: () => copyParentEvidence(parent),
  });
}

function copyParentEvidence(
  parent: ApplicationTaskRuntimeReadinessParentEvidence,
): ApplicationTaskRuntimeReadinessParentEvidence {
  const taskCatalog = parent.taskCatalog;
  return Object.freeze({
    scopeId: parent.scopeId,
    candidateId: parent.candidateId,
    analysisId: parent.analysisId,
    applicationRevisionId: parent.applicationRevisionId,
    applicationPublicationSha256:
      copyBytes(parent.applicationPublicationSha256) as TaskDefinitionSha256V1,
    sourceArtifactRootSha256:
      copyBytes(parent.sourceArtifactRootSha256) as TaskDefinitionSha256V1,
    applicationTaskCatalogBindingSha256:
      copyBytes(parent.applicationTaskCatalogBindingSha256) as
        TaskDefinitionSha256V1,
    taskCatalog: Object.freeze({
      version: 1 as const,
      entries: Object.freeze(taskCatalog.entries.map(entry => Object.freeze({
        taskId: entry.taskId,
        manifest: entry.manifest,
        canonicalTaskManifestSha256:
          copyBytes(entry.canonicalTaskManifestSha256) as
            TaskDefinitionSha256V1,
      }))),
      taskCatalogSha256:
        copyBytes(taskCatalog.taskCatalogSha256) as TaskDefinitionSha256V1,
    }),
  });
}

function snapshotQuery<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<
  ReadonlyArray<Row>,
  ApplicationTaskRuntimeReadinessSnapshotError
> {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => snapshotFailureValue(
      "resourceFailure",
      retryableCause(cause),
      cause,
    ),
  });
}

function snapshotFailure(
  reason: ApplicationTaskRuntimeReadinessSnapshotError["reason"],
): Effect.Effect<never, ApplicationTaskRuntimeReadinessSnapshotError> {
  return Effect.fail(snapshotFailureValue(reason));
}

function snapshotFailureValue(
  reason: ApplicationTaskRuntimeReadinessSnapshotError["reason"],
  retryable = false,
  cause?: unknown,
): ApplicationTaskRuntimeReadinessSnapshotError {
  return new ApplicationTaskRuntimeReadinessSnapshotError({
    operation: "load",
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
