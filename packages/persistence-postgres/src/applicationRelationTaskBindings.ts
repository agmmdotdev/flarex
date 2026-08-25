import {
  bytesEqualFullScan,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";

import type { AppRowTransaction } from "./appRows";
import type { ApplicationAnalysisAuthority } from
  "./applicationAnalysisRegistration";
import {
  hasApplicationRelationPublicationAuthority,
  type ApplicationRelationPublication,
} from "./applicationRelationPublication";
import {
  fxSystemApplicationPublications,
  fxSystemApplicationTaskCatalogs,
  fxSystemApplicationTaskDefinitions,
} from "./applicationRelationSchema";
import {
  prepareApplicationTaskBindingRegistrationEffect,
  reconstructApplicationTaskCatalogSnapshotEffect,
  type PreparedApplicationTaskBindingRegistration,
} from "./applicationTaskBindingEvidence";
import {
  ApplicationTaskBindingPersistenceError,
  ApplicationTaskCatalogSnapshotError,
  type ApplicationTaskBindingRegistration,
  type ApplicationTaskCatalogSnapshot,
  type RegisterApplicationTaskBindingsInput,
} from "./applicationTaskBindingModel";
import { databaseTimestampFromUnknown } from "./databaseTimestamp";
import type { FlarexMetadataDatabase } from "./deployments";
import { runDrizzleStatementEffect } from "./drizzleStatementEffect";
import { runEffectTransaction } from "./effectTransaction";
import { isRetryableSqlTransactionCause } from
  "./locatedReadCommittedEffect";
import {
  fxSystemApplicationCandidatesV1,
  fxSystemScopeClocks,
} from "./schema";

export interface RegisterApplicationRelationTaskBindingsInput
  extends RegisterApplicationTaskBindingsInput {
  readonly publication: ApplicationRelationPublication;
}

export interface ApplicationRelationTaskBindingRepository {
  readonly register: (
    input: RegisterApplicationRelationTaskBindingsInput,
  ) => Effect.Effect<
    ApplicationTaskBindingRegistration,
    ApplicationTaskBindingPersistenceError
  >;
}

export interface ApplicationRelationTaskCatalogSnapshotPort {
  readonly loadInTransaction: (
    tx: AppRowTransaction,
    authority: ApplicationAnalysisAuthority,
    revisionId: string,
  ) => Effect.Effect<
    ApplicationTaskCatalogSnapshot | null,
    ApplicationTaskCatalogSnapshotError
  >;
}

const relationTaskCatalogSnapshotPorts = new WeakSet<object>();

export function createApplicationRelationTaskCatalogSnapshotPort():
ApplicationRelationTaskCatalogSnapshotPort {
  const loadInTransaction = Effect.fn(
    "ApplicationRelationTaskCatalogSnapshot.loadInTransaction",
  )(function* (
    tx: AppRowTransaction,
    authority: ApplicationAnalysisAuthority,
    revisionId: string,
  ): Effect.fn.Return<
    ApplicationTaskCatalogSnapshot | null,
    ApplicationTaskCatalogSnapshotError
  > {
    if (revisionId.trim().length === 0 || revisionId.includes("\0")) {
      return yield* snapshotFailure("invalidInput");
    }
    const clockRows = yield* snapshotQuery(
      tx.select().from(fxSystemScopeClocks).where(eq(
        fxSystemScopeClocks.scopeId,
        authority.scopeId,
      )).limit(1),
    );
    const clock = clockRows[0];
    if (
      clock === undefined ||
      clock.storageGeneration !== authority.storageGeneration ||
      clock.storageGenerationFence !== authority.storageGenerationFence ||
      clock.epoch !== authority.epoch
    ) return yield* snapshotFailure("authorityChanged");
    const catalogRows = yield* snapshotQuery(
      tx.select().from(fxSystemApplicationTaskCatalogs).where(and(
        eq(fxSystemApplicationTaskCatalogs.scopeId, authority.scopeId),
        eq(fxSystemApplicationTaskCatalogs.revisionId, revisionId),
      )).limit(1).for("share"),
    );
    const catalog = catalogRows[0];
    if (catalog === undefined) return null;
    const definitions = yield* snapshotQuery(
      tx.select().from(fxSystemApplicationTaskDefinitions).where(and(
        eq(fxSystemApplicationTaskDefinitions.scopeId, authority.scopeId),
        eq(fxSystemApplicationTaskDefinitions.revisionId, revisionId),
      )).limit(catalog.taskCount + 1).for("share"),
    );
    return yield* reconstructApplicationTaskCatalogSnapshotEffect(
      catalog,
      definitions,
    );
  });
  const port = Object.freeze({ loadInTransaction });
  relationTaskCatalogSnapshotPorts.add(port);
  return port;
}

export function isApplicationRelationTaskCatalogSnapshotPort(
  value: unknown,
): value is ApplicationRelationTaskCatalogSnapshotPort {
  return typeof value === "object" && value !== null &&
    relationTaskCatalogSnapshotPorts.has(value);
}

export function makeApplicationRelationTaskBindingRepository(
  targetDb: FlarexMetadataDatabase,
  controlDb: FlarexMetadataDatabase,
): ApplicationRelationTaskBindingRepository {
  const register = Effect.fn("ApplicationRelationTaskBinding.register")(
    function* (
      input: RegisterApplicationRelationTaskBindingsInput,
    ): Effect.fn.Return<
      ApplicationTaskBindingRegistration,
      ApplicationTaskBindingPersistenceError
    > {
      if (!hasApplicationRelationPublicationAuthority(
        targetDb,
        controlDb,
        input.publication,
      )) return yield* failure("invalidInput");
      const prepared = yield* prepareApplicationTaskBindingRegistrationEffect({
        authority: input.authority,
        bindings: input.bindings,
      });
      if (!publicationMatches(prepared, input.publication)) {
        return yield* failure("publicationMismatch");
      }
      return yield* runTransaction(
        targetDb,
        tx => registerInTransaction(tx, prepared, input.publication),
      );
    },
  );
  return Object.freeze({ register });
}

function publicationMatches(
  prepared: PreparedApplicationTaskBindingRegistration,
  publication: ApplicationRelationPublication,
): boolean {
  return prepared.authority.scopeId === publication.scopeId &&
    prepared.binding.revisionId === publication.revisionId &&
    prepared.binding.candidateId === publication.candidateId &&
    prepared.binding.analysisId === publication.analysisId &&
    prepared.binding.sourceArtifactRootSha256 ===
      publication.sourceArtifactRootSha256 &&
    prepared.binding.publicationSha256 === publication.publicationSha256;
}

const registerInTransaction = Effect.fn(
  "ApplicationRelationTaskBinding.registerInTransaction",
)(function* (
  tx: AppRowTransaction,
  prepared: PreparedApplicationTaskBindingRegistration,
  publication: ApplicationRelationPublication,
): Effect.fn.Return<
  ApplicationTaskBindingRegistration,
  ApplicationTaskBindingPersistenceError
> {
    yield* requireExactAuthority(tx, prepared.authority);
    const candidateRows = yield* query(
      tx.select().from(fxSystemApplicationCandidatesV1).where(and(
        eq(fxSystemApplicationCandidatesV1.scopeId,
          prepared.authority.scopeId),
        eq(fxSystemApplicationCandidatesV1.candidateId,
          prepared.binding.candidateId),
      )).limit(1).for("update"),
    );
    const candidate = candidateRows[0];
    if (
      candidate === undefined ||
      candidate.storageGeneration !== prepared.authority.storageGeneration ||
      candidate.storageGenerationFence !==
        prepared.authority.storageGenerationFence ||
      candidate.epoch !== prepared.authority.epoch
    ) return yield* failure("authorityChanged");
    const publicationRows = yield* query(
      tx.select().from(fxSystemApplicationPublications).where(and(
        eq(fxSystemApplicationPublications.scopeId,
          prepared.authority.scopeId),
        eq(fxSystemApplicationPublications.revisionId,
          prepared.binding.revisionId),
      )).limit(1).for("update"),
    );
    const storedPublication = publicationRows[0];
    if (storedPublication === undefined) {
      return yield* failure("publicationMissing");
    }
    const sourceRootBytes = yield* decodeSha256(
      publication.sourceArtifactRootSha256,
    );
    const publicationSha256Bytes = yield* decodeSha256(
      publication.publicationSha256,
    );
    if (
      storedPublication.candidateId !== prepared.binding.candidateId ||
      storedPublication.analysisId !== prepared.binding.analysisId ||
      !bytesEqualFullScan(
        storedPublication.sourceArtifactRootSha256,
        sourceRootBytes,
      ) ||
      !bytesEqualFullScan(
        storedPublication.publicationSha256,
        publicationSha256Bytes,
      )
    ) return yield* failure("publicationMismatch");

    const registeredAt = yield* databaseTime(tx, prepared.authority.scopeId);
    const inserted = yield* query(
      tx.insert(fxSystemApplicationTaskCatalogs).values({
        scopeId: prepared.authority.scopeId,
        revisionId: prepared.binding.revisionId,
        candidateId: prepared.binding.candidateId,
        analysisId: prepared.binding.analysisId,
        sourceArtifactRootSha256: prepared.sourceRootBytes,
        publicationSha256: prepared.publicationSha256Bytes,
        taskCatalogSha256: prepared.taskCatalogSha256Bytes,
        taskCatalogBindingSha256: prepared.catalogBindingSha256Bytes,
        taskCount: prepared.binding.taskCount,
        runtimeHostIdentity: prepared.binding.runtimeHostIdentity,
        compatibilityDate: prepared.binding.compatibilityDate,
        bindingBytes: prepared.catalogBindingBytes,
        registeredAt,
      }).onConflictDoNothing().returning({
        revisionId: fxSystemApplicationTaskCatalogs.revisionId,
      }),
    );
    if (inserted.length === 1) {
      if (prepared.definitions.length > 0) {
        yield* execute(tx.insert(fxSystemApplicationTaskDefinitions).values(
          prepared.definitions.map(definition => ({
            scopeId: prepared.authority.scopeId,
            revisionId: prepared.binding.revisionId,
            taskCatalogBindingSha256: prepared.catalogBindingSha256Bytes,
            taskDefinitionBindingSha256: definition.bindingSha256,
            taskId: definition.taskId,
            canonicalTaskManifestSha256:
              definition.canonicalTaskManifestSha256,
            logicalModulePath: definition.logicalModulePath,
            sourceModulePath: definition.sourceModulePath,
            exportName: definition.exportName,
            manifestBytes: definition.manifestBytes,
            bindingBytes: definition.bindingBytes,
          })),
        ));
      }
      return projection(prepared, registeredAt);
    }
    return yield* loadExactReplay(tx, prepared);
});

const loadExactReplay = Effect.fn(
  "ApplicationRelationTaskBinding.loadExactReplay",
)(function* (
  tx: AppRowTransaction,
  prepared: PreparedApplicationTaskBindingRegistration,
): Effect.fn.Return<
  ApplicationTaskBindingRegistration,
  ApplicationTaskBindingPersistenceError
> {
    const rows = yield* query(
      tx.select().from(fxSystemApplicationTaskCatalogs).where(and(
        eq(fxSystemApplicationTaskCatalogs.scopeId,
          prepared.authority.scopeId),
        eq(fxSystemApplicationTaskCatalogs.revisionId,
          prepared.binding.revisionId),
      )).limit(1),
    );
    const row = rows[0];
    if (
      row === undefined || row.candidateId !== prepared.binding.candidateId ||
      row.analysisId !== prepared.binding.analysisId ||
      row.taskCount !== prepared.binding.taskCount ||
      row.runtimeHostIdentity !== prepared.binding.runtimeHostIdentity ||
      row.compatibilityDate !== prepared.binding.compatibilityDate ||
      !bytesEqualFullScan(row.sourceArtifactRootSha256,
        prepared.sourceRootBytes) ||
      !bytesEqualFullScan(row.publicationSha256,
        prepared.publicationSha256Bytes) ||
      !bytesEqualFullScan(row.taskCatalogSha256,
        prepared.taskCatalogSha256Bytes) ||
      !bytesEqualFullScan(row.taskCatalogBindingSha256,
        prepared.catalogBindingSha256Bytes) ||
      !bytesEqualFullScan(row.bindingBytes, prepared.catalogBindingBytes)
    ) return yield* failure("conflictingReplay");
    const definitionRows = yield* query(
      tx.select().from(fxSystemApplicationTaskDefinitions).where(and(
        eq(fxSystemApplicationTaskDefinitions.scopeId,
          prepared.authority.scopeId),
        eq(fxSystemApplicationTaskDefinitions.revisionId,
          prepared.binding.revisionId),
      )).limit(prepared.definitions.length + 1),
    );
    const byTaskId = new Map(
      definitionRows.map(definition => [definition.taskId, definition]),
    );
    if (
      definitionRows.length !== prepared.definitions.length ||
      prepared.definitions.some(expected => {
        const stored = byTaskId.get(expected.taskId);
        return stored === undefined ||
          stored.logicalModulePath !== expected.logicalModulePath ||
          stored.sourceModulePath !== expected.sourceModulePath ||
          stored.exportName !== expected.exportName ||
          !bytesEqualFullScan(stored.taskCatalogBindingSha256,
            prepared.catalogBindingSha256Bytes) ||
          !bytesEqualFullScan(stored.taskDefinitionBindingSha256,
            expected.bindingSha256) ||
          !bytesEqualFullScan(stored.canonicalTaskManifestSha256,
            expected.canonicalTaskManifestSha256) ||
          !bytesEqualFullScan(stored.manifestBytes, expected.manifestBytes) ||
          !bytesEqualFullScan(stored.bindingBytes, expected.bindingBytes);
      })
    ) return yield* failure("conflictingReplay");
    const registeredAt = databaseTimestampFromUnknown(row.registeredAt);
    return registeredAt === null
      ? yield* failure("storedState")
      : projection(prepared, registeredAt);
});

function projection(
  prepared: PreparedApplicationTaskBindingRegistration,
  registeredAt: Date,
): ApplicationTaskBindingRegistration {
  return Object.freeze({
    scopeId: prepared.authority.scopeId,
    revisionId: prepared.binding.revisionId,
    candidateId: prepared.binding.candidateId,
    analysisId: prepared.binding.analysisId,
    sourceArtifactRootSha256: prepared.binding.sourceArtifactRootSha256,
    publicationSha256: prepared.binding.publicationSha256,
    taskCatalogSha256:
      encodeBytesToLowercaseHex(prepared.taskCatalogSha256Bytes),
    taskCatalogBindingSha256:
      encodeBytesToLowercaseHex(prepared.catalogBindingSha256Bytes),
    taskCount: prepared.binding.taskCount,
    runtimeHostIdentity: prepared.binding.runtimeHostIdentity,
    compatibilityDate: prepared.binding.compatibilityDate,
    registeredAt: new Date(registeredAt.getTime()),
  });
}

const requireExactAuthority = Effect.fn(
  "ApplicationRelationTaskBinding.requireExactAuthority",
)(function* (
  tx: AppRowTransaction,
  authority: ApplicationAnalysisAuthority,
): Effect.fn.Return<void, ApplicationTaskBindingPersistenceError> {
    const rows = yield* query(
      tx.select().from(fxSystemScopeClocks).where(eq(
        fxSystemScopeClocks.scopeId,
        authority.scopeId,
      )).limit(1).for("update"),
    );
    const clock = rows[0];
    if (
      clock === undefined ||
      clock.storageGeneration !== authority.storageGeneration ||
      clock.storageGenerationFence !== authority.storageGenerationFence ||
      clock.epoch !== authority.epoch
    ) return yield* failure("authorityChanged");
});

function databaseTime(
  tx: AppRowTransaction,
  scopeId: ApplicationAnalysisAuthority["scopeId"],
): Effect.Effect<Date, ApplicationTaskBindingPersistenceError> {
  return query(
    tx.select({ now: sql<Date>`current_timestamp` })
      .from(fxSystemScopeClocks)
      .where(eq(fxSystemScopeClocks.scopeId, scopeId))
      .limit(1),
  ).pipe(Effect.flatMap(rows => {
    const date = databaseTimestampFromUnknown(rows[0]?.now);
    return date === null ? failure("storedState") : Effect.succeed(date);
  }));
}

function decodeSha256(
  value: string,
): Effect.Effect<Uint8Array, ApplicationTaskBindingPersistenceError> {
  if (!/^[0-9a-f]{64}$/.test(value)) return failure("invalidInput");
  const bytes = new Uint8Array(32);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return Effect.succeed(bytes);
}

function runTransaction<Value>(
  db: FlarexMetadataDatabase,
  body: (tx: AppRowTransaction) => Effect.Effect<
    Value,
    ApplicationTaskBindingPersistenceError
  >,
): Effect.Effect<Value, ApplicationTaskBindingPersistenceError> {
  return runEffectTransaction(
    callback => db.transaction(callback),
    "Application relation task-binding transaction rolled back.",
    body,
    cause => failureValue(
      "resourceFailure",
      isRetryableSqlTransactionCause(cause),
      cause,
    ),
  );
}

function query<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<ReadonlyArray<Row>, ApplicationTaskBindingPersistenceError> {
  return runDrizzleStatementEffect(
    statement,
    cause => failureValue(
      "resourceFailure",
      isRetryableSqlTransactionCause(cause),
      cause,
    ),
  );
}

function execute(
  statement: PromiseLike<unknown>,
): Effect.Effect<void, ApplicationTaskBindingPersistenceError> {
  return runDrizzleStatementEffect(
    statement,
    cause => failureValue(
      "resourceFailure",
      isRetryableSqlTransactionCause(cause),
      cause,
    ),
  ).pipe(Effect.asVoid);
}

function snapshotQuery<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<ReadonlyArray<Row>, ApplicationTaskCatalogSnapshotError> {
  return runDrizzleStatementEffect(
    statement,
    cause => snapshotFailureValue("resourceFailure", cause),
  );
}

function snapshotFailure(
  reason: ApplicationTaskCatalogSnapshotError["reason"],
  cause?: unknown,
): Effect.Effect<never, ApplicationTaskCatalogSnapshotError> {
  return Effect.fail(snapshotFailureValue(reason, cause));
}

function snapshotFailureValue(
  reason: ApplicationTaskCatalogSnapshotError["reason"],
  cause?: unknown,
): ApplicationTaskCatalogSnapshotError {
  return new ApplicationTaskCatalogSnapshotError({
    reason,
    retryable: reason === "resourceFailure" &&
      isRetryableSqlTransactionCause(cause),
    ...(cause === undefined ? {} : { cause }),
  });
}

function failure(
  reason: ApplicationTaskBindingPersistenceError["reason"],
  retryable = false,
  cause?: unknown,
): Effect.Effect<never, ApplicationTaskBindingPersistenceError> {
  return Effect.fail(failureValue(reason, retryable, cause));
}

function failureValue(
  reason: ApplicationTaskBindingPersistenceError["reason"],
  retryable = false,
  cause?: unknown,
): ApplicationTaskBindingPersistenceError {
  return new ApplicationTaskBindingPersistenceError({
    operation: "register",
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}
