import {
  bytesEqualFullScan,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1, MAX_APPLICATION_TASK_BINDING_EVIDENCE_BYTES_V1 }
  from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import { MAX_TASK_DEFINITION_CANONICAL_BYTES_V1 }
  from "@flarex/standard-application-definition/internal/task-definition-v1";
import { and, eq, getTableColumns, sql } from "drizzle-orm";
import { Effect } from "effect";

import type { AppRowTransaction } from "./appRows";
import type { ApplicationAnalysisAuthority } from
  "./applicationAnalysisRegistration";
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
import { detachDriverRows } from "./detachDriverRows";
import type { FlarexMetadataDatabase } from "./deployments";
import { runEffectTransaction } from "./effectTransaction";
import {
  fxSystemApplicationCandidatesV1,
  fxSystemApplicationPublicationsV1,
  fxSystemApplicationTaskCatalogsV1,
  fxSystemApplicationTaskDefinitionsV1,
  fxSystemScopeClocks,
} from "./schema";

export {
  ApplicationTaskBindingPersistenceError,
  ApplicationTaskCatalogSnapshotError,
} from "./applicationTaskBindingModel";
export type {
  ApplicationTaskBindingRegistration,
  ApplicationTaskCatalogSnapshot,
  RegisterApplicationTaskBindingsInput,
} from "./applicationTaskBindingModel";

export interface ApplicationTaskBindingRepository {
  readonly register: (
    input: RegisterApplicationTaskBindingsInput,
  ) => Effect.Effect<
    ApplicationTaskBindingRegistration,
    ApplicationTaskBindingPersistenceError
  >;
}

export interface ApplicationTaskCatalogSnapshotPort {
  readonly loadInTransaction: (
    tx: AppRowTransaction,
    authority: ApplicationAnalysisAuthority,
    revisionId: string,
  ) => Effect.Effect<
    ApplicationTaskCatalogSnapshot | null,
    ApplicationTaskCatalogSnapshotError
  >;
}

const taskCatalogSnapshotPorts = new WeakSet<ApplicationTaskCatalogSnapshotPort>();

/** Detached rows, never a current task admission verdict. */
export interface CapturedApplicationTaskCatalogRows {
  readonly catalog: typeof fxSystemApplicationTaskCatalogsV1.$inferSelect;
  readonly definitions: ReadonlyArray<typeof fxSystemApplicationTaskDefinitionsV1.$inferSelect>;
}

export const captureApplicationTaskCatalogRowsInTransaction = Effect.fn(
  "ApplicationTaskCatalogSnapshot.captureRows",
)(function* (port: ApplicationTaskCatalogSnapshotPort, tx: AppRowTransaction,
  authority: ApplicationAnalysisAuthority, revisionId: string) {
  if (!isApplicationTaskCatalogSnapshotPort(port) || revisionId.trim().length === 0 || revisionId.includes("\0"))
    return yield* taskSnapshotFailure("invalidInput", false);
  const clockRows = yield* taskSnapshotQuery(tx.select().from(fxSystemScopeClocks).where(eq(
    fxSystemScopeClocks.scopeId, authority.scopeId,
  )).limit(1));
  const clock = clockRows[0];
  if (clock === undefined || clock.storageGeneration !== authority.storageGeneration ||
    clock.storageGenerationFence !== authority.storageGenerationFence || clock.epoch !== authority.epoch)
    return yield* taskSnapshotFailure("authorityChanged", false);
  const catalogRows = yield* taskSnapshotQuery(tx.select({ ...getTableColumns(fxSystemApplicationTaskCatalogsV1),
    bindingBytes: sql<Uint8Array>`case when octet_length(${fxSystemApplicationTaskCatalogsV1.bindingBytes}) between 1 and ${MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1}
      then ${fxSystemApplicationTaskCatalogsV1.bindingBytes} else ''::bytea end`,
  }).from(fxSystemApplicationTaskCatalogsV1).where(and(
    eq(fxSystemApplicationTaskCatalogsV1.scopeId, authority.scopeId),
    eq(fxSystemApplicationTaskCatalogsV1.revisionId, revisionId),
  )).limit(1).for("share"));
  const catalog = catalogRows[0];
  if (catalog === undefined) return null;
  if (!Number.isSafeInteger(catalog.taskCount) || catalog.taskCount < 0 || catalog.taskCount > 4_096 ||
    catalog.bindingBytes.byteLength < 1 || catalog.bindingBytes.byteLength > MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1)
    return yield* taskSnapshotFailure("storedState", false);
  const definitionBytesAdmitted = sql<boolean>`(select coalesce(sum(
    octet_length(${fxSystemApplicationTaskDefinitionsV1.bindingBytes}) +
    octet_length(${fxSystemApplicationTaskDefinitionsV1.manifestBytes})), 0)
      + ${catalog.bindingBytes.byteLength} <= ${MAX_APPLICATION_TASK_BINDING_EVIDENCE_BYTES_V1}
      and count(*) <= ${catalog.taskCount}
    from ${fxSystemApplicationTaskDefinitionsV1}
    where ${fxSystemApplicationTaskDefinitionsV1.scopeId} = ${authority.scopeId}
      and ${fxSystemApplicationTaskDefinitionsV1.revisionId} = ${revisionId})`;
  const definitions = yield* taskSnapshotQuery(tx.select({ ...getTableColumns(fxSystemApplicationTaskDefinitionsV1),
    bindingBytes: sql<Uint8Array>`case when ${definitionBytesAdmitted} and octet_length(${fxSystemApplicationTaskDefinitionsV1.bindingBytes}) between 1 and ${MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1}
      then ${fxSystemApplicationTaskDefinitionsV1.bindingBytes} else ''::bytea end`,
    manifestBytes: sql<Uint8Array>`case when ${definitionBytesAdmitted} and octet_length(${fxSystemApplicationTaskDefinitionsV1.manifestBytes}) between 1 and ${MAX_TASK_DEFINITION_CANONICAL_BYTES_V1}
      then ${fxSystemApplicationTaskDefinitionsV1.manifestBytes} else ''::bytea end`,
  }).from(fxSystemApplicationTaskDefinitionsV1).where(and(
    eq(fxSystemApplicationTaskDefinitionsV1.scopeId, authority.scopeId),
    eq(fxSystemApplicationTaskDefinitionsV1.revisionId, revisionId),
  )).limit(catalog.taskCount + 1).for("share"));
  let totalBytes = catalog.bindingBytes.byteLength;
  for (const definition of definitions) {
    if (definition.bindingBytes.byteLength < 1 || definition.bindingBytes.byteLength > MAX_APPLICATION_TASK_BINDING_CANONICAL_BYTES_V1 ||
      definition.manifestBytes.byteLength < 1 || definition.manifestBytes.byteLength > MAX_TASK_DEFINITION_CANONICAL_BYTES_V1)
      return yield* taskSnapshotFailure("storedState", false);
    totalBytes += definition.bindingBytes.byteLength + definition.manifestBytes.byteLength;
    if (totalBytes > MAX_APPLICATION_TASK_BINDING_EVIDENCE_BYTES_V1)
      return yield* taskSnapshotFailure("storedState", false);
  }
  const ownedCatalog = detachDriverRows([catalog])[0];
  if (ownedCatalog === undefined) return yield* taskSnapshotFailure("storedState", false);
  return Object.freeze({ catalog: ownedCatalog, definitions: detachDriverRows(definitions) });
});

export const authenticateCapturedApplicationTaskCatalogRows = Effect.fn(
  "ApplicationTaskCatalogSnapshot.authenticateCapturedRows",
)((rows: CapturedApplicationTaskCatalogRows) => reconstructApplicationTaskCatalogSnapshotEffect(
  rows.catalog, rows.definitions,
));

export function createApplicationTaskCatalogSnapshotPort():
ApplicationTaskCatalogSnapshotPort {
  const loadInTransaction = Effect.fn(
    "ApplicationTaskCatalogSnapshot.loadInTransaction",
  )(function* (
    tx: AppRowTransaction,
    authority: ApplicationAnalysisAuthority,
    revisionId: string,
  ): Effect.fn.Return<
    ApplicationTaskCatalogSnapshot | null,
    ApplicationTaskCatalogSnapshotError
  > {
    const captured = yield* captureApplicationTaskCatalogRowsInTransaction(port, tx, authority, revisionId);
    return captured === null ? null : yield* authenticateCapturedApplicationTaskCatalogRows(captured);
  });
  const port = Object.freeze({ loadInTransaction });
  taskCatalogSnapshotPorts.add(port);
  return port;
}

export function isApplicationTaskCatalogSnapshotPort(
  value: unknown,
): value is ApplicationTaskCatalogSnapshotPort {
  return typeof value === "object" && value !== null &&
    // SAFETY: the typeof guard above proved the value is a non-null
    // object; the cast only narrows it to the WeakSet's registered brand.
    taskCatalogSnapshotPorts.has(value as ApplicationTaskCatalogSnapshotPort);
}

export function makeApplicationTaskBindingRepository(
  db: FlarexMetadataDatabase,
): ApplicationTaskBindingRepository {
  const register = Effect.fn("ApplicationTaskBindingRepository.register")(
    function* (input: RegisterApplicationTaskBindingsInput): Effect.fn.Return<
      ApplicationTaskBindingRegistration,
      ApplicationTaskBindingPersistenceError
    > {
      const prepared = yield* prepareApplicationTaskBindingRegistrationEffect(
        input,
      );
      return yield* runTransaction(db, tx => registerInTransaction(tx, prepared));
    },
  );
  return Object.freeze({ register });
}

const registerInTransaction = Effect.fn(
  "ApplicationTaskBinding.registerInTransaction",
)(function* (
  tx: AppRowTransaction,
  prepared: PreparedApplicationTaskBindingRegistration,
): Effect.fn.Return<
  ApplicationTaskBindingRegistration,
  ApplicationTaskBindingPersistenceError
> {
    yield* requireExactAuthority(tx, prepared.authority);
    const candidateRows = yield* query(
      tx.select().from(fxSystemApplicationCandidatesV1).where(and(
        eq(fxSystemApplicationCandidatesV1.scopeId, prepared.authority.scopeId),
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
      tx.select().from(fxSystemApplicationPublicationsV1).where(and(
        eq(fxSystemApplicationPublicationsV1.scopeId, prepared.authority.scopeId),
        eq(fxSystemApplicationPublicationsV1.revisionId,
          prepared.binding.revisionId),
      )).limit(1).for("update"),
    );
    const publication = publicationRows[0];
    if (publication === undefined) return yield* failure("publicationMissing");
    if (
      publication.candidateId !== prepared.binding.candidateId ||
      publication.analysisId !== prepared.binding.analysisId ||
      !bytesEqualFullScan(
        publication.sourceArtifactRootSha256,
        prepared.sourceRootBytes,
      ) || !bytesEqualFullScan(
        publication.publicationSha256,
        prepared.publicationSha256Bytes,
      )
    ) return yield* failure("publicationMismatch");

    const registeredAt = yield* databaseTime(tx, prepared.authority.scopeId);
    const inserted = yield* query(
      tx.insert(fxSystemApplicationTaskCatalogsV1).values({
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
        revisionId: fxSystemApplicationTaskCatalogsV1.revisionId,
      }),
    );
    if (inserted.length === 1) {
      if (prepared.definitions.length > 0) {
        yield* execute(tx.insert(fxSystemApplicationTaskDefinitionsV1).values(
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
  "ApplicationTaskBinding.loadExactReplay",
)(function* (
  tx: AppRowTransaction,
  prepared: PreparedApplicationTaskBindingRegistration,
): Effect.fn.Return<
  ApplicationTaskBindingRegistration,
  ApplicationTaskBindingPersistenceError
> {
    const rows = yield* query(
      tx.select().from(fxSystemApplicationTaskCatalogsV1).where(and(
        eq(fxSystemApplicationTaskCatalogsV1.scopeId,
          prepared.authority.scopeId),
        eq(fxSystemApplicationTaskCatalogsV1.revisionId,
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
      !bytesEqualFullScan(row.sourceArtifactRootSha256, prepared.sourceRootBytes) ||
      !bytesEqualFullScan(row.publicationSha256,
        prepared.publicationSha256Bytes) ||
      !bytesEqualFullScan(row.taskCatalogSha256,
        prepared.taskCatalogSha256Bytes) ||
      !bytesEqualFullScan(row.taskCatalogBindingSha256,
        prepared.catalogBindingSha256Bytes) ||
      !bytesEqualFullScan(row.bindingBytes, prepared.catalogBindingBytes)
    ) return yield* failure("conflictingReplay");
    const definitionRows = yield* query(
      tx.select().from(fxSystemApplicationTaskDefinitionsV1).where(and(
        eq(fxSystemApplicationTaskDefinitionsV1.scopeId,
          prepared.authority.scopeId),
        eq(fxSystemApplicationTaskDefinitionsV1.revisionId,
          prepared.binding.revisionId),
      )).limit(prepared.definitions.length + 1),
    );
    const definitionsByTaskId = new Map(
      definitionRows.map(definition => [definition.taskId, definition]),
    );
    if (
      definitionRows.length !== prepared.definitions.length ||
      prepared.definitions.some(expected => {
        const stored = definitionsByTaskId.get(expected.taskId);
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

function taskSnapshotQuery<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<ReadonlyArray<Row>, ApplicationTaskCatalogSnapshotError> {
  return Effect.tryPromise({
    try: () => statement,
    catch: cause => taskSnapshotFailureValue(
      "resourceFailure",
      isRetryableTransactionCause(cause),
      cause,
    ),
  });
}

function taskSnapshotFailure(
  reason: ApplicationTaskCatalogSnapshotError["reason"],
  retryable: boolean,
  cause?: unknown,
): Effect.Effect<never, ApplicationTaskCatalogSnapshotError> {
  return Effect.fail(taskSnapshotFailureValue(reason, retryable, cause));
}

function taskSnapshotFailureValue(
  reason: ApplicationTaskCatalogSnapshotError["reason"],
  retryable: boolean,
  cause?: unknown,
): ApplicationTaskCatalogSnapshotError {
  return new ApplicationTaskCatalogSnapshotError({
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}

function requireExactAuthority(
  tx: AppRowTransaction,
  authority: ApplicationAnalysisAuthority,
): Effect.Effect<void, ApplicationTaskBindingPersistenceError> {
  return Effect.gen(function* () {
    const rows = yield* query(
      tx.select().from(fxSystemScopeClocks).where(
        eq(fxSystemScopeClocks.scopeId, authority.scopeId),
      ).limit(1).for("update"),
    );
    const clock = rows[0];
    if (
      clock === undefined ||
      clock.storageGeneration !== authority.storageGeneration ||
      clock.storageGenerationFence !== authority.storageGenerationFence ||
      clock.epoch !== authority.epoch
    ) return yield* failure("authorityChanged");
  });
}

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

function query<Row>(
  statement: PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<ReadonlyArray<Row>, ApplicationTaskBindingPersistenceError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => failureValue(
      "resourceFailure",
      isRetryableTransactionCause(cause),
      cause,
    ),
  });
}

function execute(
  statement: PromiseLike<unknown>,
): Effect.Effect<void, ApplicationTaskBindingPersistenceError> {
  return Effect.tryPromise({
    try: () => Promise.resolve(statement),
    catch: cause => failureValue(
      "resourceFailure",
      isRetryableTransactionCause(cause),
      cause,
    ),
  }).pipe(Effect.asVoid);
}

function runTransaction<A>(
  db: FlarexMetadataDatabase,
  body: (tx: AppRowTransaction) => Effect.Effect<
    A,
    ApplicationTaskBindingPersistenceError
  >,
): Effect.Effect<A, ApplicationTaskBindingPersistenceError> {
  return runEffectTransaction(
    callback => db.transaction(callback),
    "Application task-binding transaction rolled back.",
    body,
    cause => failureValue(
      "resourceFailure",
      isRetryableTransactionCause(cause),
      cause,
    ),
  );
}

function isRetryableTransactionCause(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  try {
    const code = Reflect.get(cause, "code");
    return code === "40001" || code === "40P01";
  } catch {
    return false;
  }
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
