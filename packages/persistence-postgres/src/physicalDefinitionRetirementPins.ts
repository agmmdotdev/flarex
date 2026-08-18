import {
  decodeApplicationTaskRunCreationAuthorityPreimageV1,
  encodeApplicationTaskRuntimeTargetPreimageV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import type { TaskRunIdV1 } from
  "@flarex/durable-task/internal/run-attempt-v1";
import {
  bytesEqualFullScan,
  copyBytesToArrayBuffer,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import { and, asc, eq, gt, inArray, sql } from "drizzle-orm";
import { Data, Effect, Result, Schema } from "effect";
import {
  AppSchemaCandidateValidationOperationV1Error,
} from "flarex-protocol/internal/app-schema-candidate-validation-v1";
import {
  canonicalizeApplicationActionExecutionAuthorityV1,
} from "flarex-protocol/internal/application-action-authority-v1";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import {
  TransactionArtifactIdV1Schema,
  TransactionArtifactRuntimeV1Schema,
  TransactionExecutionModuleV1Schema,
  TransactionPackageIdV1Schema,
  TransactionSourcePackageSha256HexV1Schema,
  type TransactionSessionIdV1,
} from "flarex-protocol/transaction-session";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import {
  projectScopeIdUuidV1Result,
  type ScopeId,
  type ScopeUuidV1,
} from "flarex-protocol/storage-authority";

import {
  readAppSchemaCandidateValidationHeadForShareInTransactionEffect,
} from "./appSchemaCandidateValidation";
import type { AppRowTransaction } from "./appRows";
import {
  readApplicationActiveRevisionForShareInTransactionEffect,
} from "./applicationActiveHeadRead";
import {
  fxSystemApplicationActionInvocationsV1,
  fxSystemApplicationRevisionSchemasV1,
  fxSystemDurableTaskRunsV1,
  fxSystemSnapshotLeases,
  fxSystemTransactionSessions,
} from "./schema";
import type { TrustedScopeAuthority } from "./scopeAuthorityResolution";
import {
  decodeAndCorrelateTaskSystemRunRowV1,
} from "./taskSystemRunRowV1";

const NONTERMINAL_MUTATION_LIFECYCLES = Object.freeze([
  "created",
  "running",
  "finishing",
  "committing",
  "retrying",
] as const);
const NONTERMINAL_ACTION_LIFECYCLES = Object.freeze([
  "admitted",
  "executing",
] as const);
const taskAggregatePhaseExpression =
  sql<string>`(${fxSystemDurableTaskRunsV1.aggregateJson} #>> '{aggregate,phase}')`;
const MAX_RUNTIME_PIN_CANDIDATES_PER_OWNER = 32;
const decodeLegacyMutationSessionAuthorityResult = Schema.decodeUnknownResult(
  Schema.Struct({
    artifactId: TransactionArtifactIdV1Schema,
    artifactRuntime: TransactionArtifactRuntimeV1Schema,
    executionModule: TransactionExecutionModuleV1Schema,
    packageId: TransactionPackageIdV1Schema,
    sourcePackageHash: TransactionSourcePackageSha256HexV1Schema,
  }),
);

type ValidatedMutationSession =
  | Readonly<{ readonly generation: "legacy_dynamic_worker_v1" }>
  | Readonly<{
      readonly generation: "application_v1";
      readonly schemaVersionId: CatalogSchemaVersionId;
    }>;

export type PhysicalDefinitionRetirementPinOwner =
  | "active_application"
  | "candidate_validation"
  | "mutation_session"
  | "direct_action"
  | "durable_task"
  | "snapshot_lease";

export interface PhysicalDefinitionRetirementPin {
  readonly owner: PhysicalDefinitionRetirementPinOwner;
  readonly identity: string;
  readonly schemaVersionId: CatalogSchemaVersionId;
}

export type PhysicalDefinitionRetirementPinInspectionResult =
  | Readonly<{ readonly status: "clear" }>
  | Readonly<{
      readonly status: "pinned";
      readonly pin: PhysicalDefinitionRetirementPin;
    }>;

export class PhysicalDefinitionRetirementPinPersistenceError
  extends Data.TaggedError("PhysicalDefinitionRetirementPinPersistenceError")<{
    readonly operation:
      | "readActive"
      | "readCandidate"
      | "readMutationSession"
      | "readAction"
      | "readTask"
      | "readSnapshotLease"
      | "readRevisionSchema";
    readonly cause: unknown;
  }> {}

export class PhysicalDefinitionRetirementPinCorruptionError
  extends Data.TaggedError("PhysicalDefinitionRetirementPinCorruptionError")<{
    readonly owner: PhysicalDefinitionRetirementPinOwner;
    readonly identity: string;
    readonly cause?: unknown;
  }> {}

export class PhysicalDefinitionRetirementPinCryptoError
  extends Data.TaggedError("PhysicalDefinitionRetirementPinCryptoError")<{
  readonly cause: unknown;
}> {}

export class PhysicalDefinitionRetirementPinDirectoryLimitError
  extends Data.TaggedError("PhysicalDefinitionRetirementPinDirectoryLimitError")<{
    readonly owner: Exclude<
      PhysicalDefinitionRetirementPinOwner,
      "active_application" | "candidate_validation"
    >;
    readonly observed: number;
    readonly maximum: number;
  }> {}

export type InspectPhysicalDefinitionRetirementPinsError =
  | PhysicalDefinitionRetirementPinPersistenceError
  | PhysicalDefinitionRetirementPinCorruptionError
  | PhysicalDefinitionRetirementPinCryptoError
  | PhysicalDefinitionRetirementPinDirectoryLimitError;

export const inspectPhysicalDefinitionRetirementPinsInTransactionEffect =
  Effect.fn("PhysicalDefinitionRetirementPins.inspectInTransaction")(
    function* (
      tx: AppRowTransaction,
      authority: TrustedScopeAuthority,
      deploymentId: string,
      schemaVersionIds: ReadonlyArray<CatalogSchemaVersionId>,
    ): Effect.fn.Return<
      PhysicalDefinitionRetirementPinInspectionResult,
      InspectPhysicalDefinitionRetirementPinsError
    > {
      const schemaVersions = new Set(schemaVersionIds);
      const active = yield* readApplicationActiveRevisionForShareInTransactionEffect(
        tx,
        authority.scopeId,
      ).pipe(Effect.mapError(cause =>
        cause.reason === "storedState"
          ? pinCorruptionValue(
            "active_application",
            cause.revisionId ?? authority.scopeId,
            cause,
          )
          : pinPersistence("readActive", cause)
      ));
      if (active !== null) {
        if (active.deploymentId !== deploymentId) {
          return yield* pinCorruption("active_application", active.revisionId);
        }
        if (schemaVersions.has(active.schemaVersionId)) {
          return pinned(
            "active_application",
            active.revisionId,
            active.schemaVersionId,
          );
        }
      }

      const candidate = yield*
        readAppSchemaCandidateValidationHeadForShareInTransactionEffect(
          tx,
          authority.scopeId,
          "load",
        ).pipe(Effect.mapError(cause =>
          cause instanceof AppSchemaCandidateValidationOperationV1Error
            ? pinCorruptionValue(
              "candidate_validation",
              authority.scopeId,
              cause,
            )
            : pinPersistence("readCandidate", cause)
        ));
      if (candidate !== null) {
        if (candidate.deploymentId !== deploymentId) {
          return yield* pinCorruption(
            "candidate_validation",
            candidate.schemaVersionId,
          );
        }
        if (schemaVersions.has(candidate.schemaVersionId)) {
          return pinned(
            "candidate_validation",
            candidate.schemaVersionId,
            candidate.schemaVersionId,
          );
        }
      }

      const scopeUuid = yield* Effect.fromResult(
        projectScopeIdUuidV1Result(authority.scopeId).pipe(
          Result.mapError(cause => new PhysicalDefinitionRetirementPinCorruptionError({
            owner: "mutation_session",
            identity: authority.scopeId,
            cause,
          })),
        ),
      );
      const sessionDirectory = yield* queryEffect(
        "readMutationSession",
        () => tx.select({
          sessionId: fxSystemTransactionSessions.sessionId,
        }).from(fxSystemTransactionSessions).where(and(
          eq(fxSystemTransactionSessions.scopeUuid, scopeUuid.scopeUuid),
          eq(
            fxSystemTransactionSessions.executionAuthorityGeneration,
            "application_v1",
          ),
          inArray(
            fxSystemTransactionSessions.lifecycle,
            NONTERMINAL_MUTATION_LIFECYCLES,
          ),
        )).orderBy(asc(fxSystemTransactionSessions.sessionId))
          .limit(MAX_RUNTIME_PIN_CANDIDATES_PER_OWNER + 1).for("share"),
      );
      yield* requireDirectoryWithinLimit(
        "mutation_session",
        sessionDirectory.length,
      );
      for (const { sessionId } of sessionDirectory) {
        const session = yield* loadAndValidateMutationSessionEffect(
          tx,
          authority.scopeId,
          scopeUuid.scopeUuid,
          deploymentId,
          sessionId,
          "mutation_session",
        );
        if (session.generation !== "application_v1") {
          return yield* pinCorruption("mutation_session", sessionId);
        }
        if (schemaVersions.has(session.schemaVersionId)) {
          return pinned("mutation_session", sessionId, session.schemaVersionId);
        }
      }

      const actionDirectory = yield* queryEffect(
        "readAction",
        () => tx.select({
          requestKey: fxSystemApplicationActionInvocationsV1.requestKey,
        }).from(fxSystemApplicationActionInvocationsV1).where(and(
          eq(fxSystemApplicationActionInvocationsV1.scopeId, authority.scopeId),
          eq(
            fxSystemApplicationActionInvocationsV1.executionAuthorityGeneration,
            "application_v1",
          ),
          inArray(
            fxSystemApplicationActionInvocationsV1.lifecycle,
            NONTERMINAL_ACTION_LIFECYCLES,
          ),
        )).orderBy(asc(fxSystemApplicationActionInvocationsV1.requestKey))
          .limit(MAX_RUNTIME_PIN_CANDIDATES_PER_OWNER + 1).for("share"),
      );
      yield* requireDirectoryWithinLimit("direct_action", actionDirectory.length);
      for (const { requestKey: actionRequestKey } of actionDirectory) {
        const action = yield* loadAndValidateActionEffect(
          tx,
          authority.scopeId,
          deploymentId,
          actionRequestKey,
        );
        if (schemaVersions.has(action.schemaVersionId)) {
          return pinned("direct_action", actionRequestKey, action.schemaVersionId);
        }
      }

      const taskDirectory = yield* queryEffect(
        "readTask",
        () => tx.select({
          runId: fxSystemDurableTaskRunsV1.runId,
        }).from(fxSystemDurableTaskRunsV1).where(and(
          eq(fxSystemDurableTaskRunsV1.scopeId, authority.scopeId),
          eq(fxSystemDurableTaskRunsV1.definitionGeneration, "application_v1"),
          sql`${taskAggregatePhaseExpression} is distinct from 'terminal'`,
        )).orderBy(asc(fxSystemDurableTaskRunsV1.runId))
          .limit(MAX_RUNTIME_PIN_CANDIDATES_PER_OWNER + 1).for("share"),
      );
      yield* requireDirectoryWithinLimit("durable_task", taskDirectory.length);
      for (const { runId } of taskDirectory) {
        const task = yield* loadAndValidateTaskEffect(
          tx,
          authority.scopeId,
          deploymentId,
          runId,
        );
        if (schemaVersions.has(task.schemaVersionId)) {
          return pinned("durable_task", runId, task.schemaVersionId);
        }
      }

      const leaseDirectory = yield* queryEffect(
        "readSnapshotLease",
        () => tx.select({
          sessionId: fxSystemSnapshotLeases.sessionId,
        }).from(fxSystemSnapshotLeases).where(and(
          eq(fxSystemSnapshotLeases.scopeUuid, scopeUuid.scopeUuid),
          gt(fxSystemSnapshotLeases.leaseExpiresAt, sql`clock_timestamp()`),
        )).orderBy(
          asc(fxSystemSnapshotLeases.leaseExpiresAt),
          asc(fxSystemSnapshotLeases.sessionId),
        )
          .limit(MAX_RUNTIME_PIN_CANDIDATES_PER_OWNER + 1).for("share"),
      );
      yield* requireDirectoryWithinLimit("snapshot_lease", leaseDirectory.length);
      for (const { sessionId: leasedSessionId } of leaseDirectory) {
        const session = yield* loadAndValidateMutationSessionEffect(
          tx,
          authority.scopeId,
          scopeUuid.scopeUuid,
          deploymentId,
          leasedSessionId,
          "snapshot_lease",
        );
        if (
          session.generation === "application_v1" &&
          schemaVersions.has(session.schemaVersionId)
        ) {
          return pinned(
            "snapshot_lease",
            leasedSessionId,
            session.schemaVersionId,
          );
        }
      }
      return Object.freeze({ status: "clear" as const });
    },
  );

const loadAndValidateMutationSessionEffect = Effect.fn(
  "PhysicalDefinitionRetirementPins.loadMutationSession",
)(function* (
  tx: AppRowTransaction,
  scopeId: ScopeId,
  scopeUuid: ScopeUuidV1,
  deploymentId: string,
  sessionId: TransactionSessionIdV1,
  owner: "mutation_session" | "snapshot_lease",
): Effect.fn.Return<
  ValidatedMutationSession,
  InspectPhysicalDefinitionRetirementPinsError
> {
  const rows = yield* queryEffect("readMutationSession", () =>
    tx.select().from(fxSystemTransactionSessions).where(and(
      eq(fxSystemTransactionSessions.scopeUuid, scopeUuid),
      eq(fxSystemTransactionSessions.sessionId, sessionId),
    )).limit(1).for("share")
  );
  const row = rows[0];
  if (row === undefined) return yield* pinCorruption(owner, sessionId);
  if (row.executionAuthorityGeneration === "legacy_dynamic_worker_v1") {
    if (!legacyMutationSessionAuthorityIsValid(row)) {
      return yield* pinCorruption(owner, sessionId);
    }
    return Object.freeze({
      generation: "legacy_dynamic_worker_v1" as const,
    });
  }
  if (
    row.executionAuthorityGeneration !== "application_v1" ||
    row.applicationExecutionAuthorityJson === null ||
    !isUint8ArrayWithByteLength(
      row.applicationExecutionAuthoritySha256,
      32,
    ) ||
    row.applicationExecutionAuthorityCanonicalBytes === null
  ) return yield* pinCorruption(owner, sessionId);
  const canonical = yield* canonicalizeApplicationMutationExecutionAuthorityV1(
    row.applicationExecutionAuthorityJson,
  ).pipe(Effect.mapError(cause =>
    new PhysicalDefinitionRetirementPinCorruptionError({
      owner,
      identity: sessionId,
      cause,
    })
  ));
  if (
    canonical.authority.schemaVersionId !== row.schemaVersionId ||
    canonical.authority.runtimeTarget.scopeId !== scopeId ||
    canonical.authority.runtimeTarget.function.path !== row.functionPath ||
    canonical.authority.runtimeTarget.function.kind !== row.functionKind ||
    !bytesEqualFullScan(
      canonical.canonicalBytes,
      row.applicationExecutionAuthorityCanonicalBytes,
    ) ||
    !bytesEqualFullScan(canonical.sha256, row.applicationExecutionAuthoritySha256)
  ) return yield* pinCorruption(owner, sessionId);
  yield* validateRevisionSchemaEffect(
    tx,
    scopeId,
    deploymentId,
    canonical.authority.runtimeTarget.revisionId,
    row.schemaVersionId,
    owner,
    sessionId,
  );
  return Object.freeze({
    generation: "application_v1" as const,
    schemaVersionId: row.schemaVersionId,
  });
});

function legacyMutationSessionAuthorityIsValid(
  row: typeof fxSystemTransactionSessions.$inferSelect,
): boolean {
  if (
    row.applicationExecutionAuthorityJson !== null ||
    row.applicationExecutionAuthorityCanonicalBytes !== null ||
    row.applicationExecutionAuthoritySha256 !== null
  ) return false;
  return decodeLegacyMutationSessionAuthorityResult({
    artifactId: row.artifactId,
    artifactRuntime: row.artifactRuntime,
    executionModule: row.executionModule,
    packageId: row.packageId,
    sourcePackageHash: row.sourcePackageHash,
  }).pipe(Result.match({
    onFailure: () => false,
    onSuccess: authority => authority.artifactId ===
      `artifact_${authority.sourcePackageHash.slice(0, 32)}`,
  }));
}

const loadAndValidateActionEffect = Effect.fn(
  "PhysicalDefinitionRetirementPins.loadAction",
)(function* (
  tx: AppRowTransaction,
  scopeId: ScopeId,
  deploymentId: string,
  requestKey: string,
): Effect.fn.Return<
  Readonly<{ readonly schemaVersionId: CatalogSchemaVersionId }>,
  InspectPhysicalDefinitionRetirementPinsError
> {
  const rows = yield* queryEffect("readAction", () =>
    tx.select().from(fxSystemApplicationActionInvocationsV1).where(and(
      eq(fxSystemApplicationActionInvocationsV1.scopeId, scopeId),
      eq(fxSystemApplicationActionInvocationsV1.requestKey, requestKey),
    )).limit(1).for("share")
  );
  const row = rows[0];
  if (
    row === undefined ||
    row.executionAuthorityGeneration !== "application_v1" ||
    row.applicationExecutionAuthorityJson === null ||
    row.applicationExecutionAuthorityCanonicalBytes === null ||
    !isUint8ArrayWithByteLength(row.applicationExecutionAuthoritySha256, 32)
  ) return yield* pinCorruption("direct_action", requestKey);
  const canonical = yield* canonicalizeApplicationActionExecutionAuthorityV1(
    row.applicationExecutionAuthorityJson,
  ).pipe(Effect.mapError(cause =>
    new PhysicalDefinitionRetirementPinCorruptionError({
      owner: "direct_action",
      identity: requestKey,
      cause,
    })
  ));
  if (
    canonical.authority.runtimeTarget.scopeId !== scopeId ||
    canonical.authority.runtimeTarget.function.path !== row.actionFunctionPath ||
    !bytesEqualFullScan(
      canonical.canonicalBytes,
      row.applicationExecutionAuthorityCanonicalBytes,
    ) ||
    !bytesEqualFullScan(canonical.sha256, row.applicationExecutionAuthoritySha256)
  ) return yield* pinCorruption("direct_action", requestKey);
  const schemaVersionId = yield* validateRevisionSchemaEffect(
    tx,
    scopeId,
    deploymentId,
    canonical.authority.runtimeTarget.revisionId,
    undefined,
    "direct_action",
    requestKey,
  );
  if (schemaVersionId !== canonical.authority.schemaVersionId) {
    return yield* pinCorruption("direct_action", requestKey);
  }
  return Object.freeze({ schemaVersionId });
});

const loadAndValidateTaskEffect = Effect.fn(
  "PhysicalDefinitionRetirementPins.loadTask",
)(function* (
  tx: AppRowTransaction,
  scopeId: ScopeId,
  deploymentId: string,
  runId: TaskRunIdV1,
): Effect.fn.Return<
  Readonly<{ readonly schemaVersionId: CatalogSchemaVersionId }>,
  InspectPhysicalDefinitionRetirementPinsError
> {
  const rows = yield* queryEffect("readTask", () =>
    tx.select().from(fxSystemDurableTaskRunsV1).where(and(
      eq(fxSystemDurableTaskRunsV1.scopeId, scopeId),
      eq(fxSystemDurableTaskRunsV1.runId, runId),
    )).limit(1).for("share")
  );
  const row = rows[0];
  if (row === undefined || row.applicationRevisionId === null) {
    return yield* pinCorruption("durable_task", runId);
  }
  const decoded = yield* Effect.fromResult(
    decodeAndCorrelateTaskSystemRunRowV1(row).pipe(Result.mapError(cause =>
      new PhysicalDefinitionRetirementPinCorruptionError({
        owner: "durable_task",
        identity: runId,
        cause,
      })
    )),
  );
  const creationAuthority = yield* Effect.fromResult(
    decodeApplicationTaskRunCreationAuthorityPreimageV1(
      row.creationAuthorityBytes,
    ).pipe(Result.mapError(cause =>
      new PhysicalDefinitionRetirementPinCorruptionError({
        owner: "durable_task",
        identity: runId,
        cause,
      })
    )),
  );
  const targetBytes = yield* Effect.fromResult(
    encodeApplicationTaskRuntimeTargetPreimageV1(
      creationAuthority.runtimeTarget,
    ).pipe(Result.mapError(cause =>
      new PhysicalDefinitionRetirementPinCorruptionError({
        owner: "durable_task",
        identity: runId,
        cause,
      })
    )),
  );
  const [creationSha256, targetSha256] = yield* Effect.all([
    sha256Effect(row.creationAuthorityBytes),
    sha256Effect(targetBytes),
  ]);
  if (
    decoded.generation !== "application_v1" ||
    creationAuthority.scopeId !== scopeId ||
    creationAuthority.runtimeTarget.scopeId !== scopeId ||
    creationAuthority.runtimeTarget.revisionId !== row.applicationRevisionId ||
    !bytesEqualFullScan(creationSha256, row.creationAuthoritySha256) ||
    row.applicationTaskRuntimeTargetSha256 === null ||
    !bytesEqualFullScan(
      targetSha256,
      row.applicationTaskRuntimeTargetSha256,
    ) ||
    !bytesEqualFullScan(
      targetSha256,
      creationAuthority.applicationTaskRuntimeTargetSha256,
    )
  ) return yield* pinCorruption("durable_task", runId);
  const schemaVersionId = yield* validateRevisionSchemaEffect(
    tx,
    scopeId,
    deploymentId,
    row.applicationRevisionId,
    undefined,
    "durable_task",
    runId,
  );
  return Object.freeze({ schemaVersionId });
});

const validateRevisionSchemaEffect = Effect.fn(
  "PhysicalDefinitionRetirementPins.validateRevisionSchema",
)(function* (
  tx: AppRowTransaction,
  scopeId: ScopeId,
  deploymentId: string,
  revisionId: string,
  expectedSchemaVersionId: CatalogSchemaVersionId | undefined,
  owner: PhysicalDefinitionRetirementPinOwner,
  identity: string,
): Effect.fn.Return<
  CatalogSchemaVersionId,
  PhysicalDefinitionRetirementPinPersistenceError |
    PhysicalDefinitionRetirementPinCorruptionError
> {
  const rows = yield* queryEffect("readRevisionSchema", () =>
    tx.select({
      deploymentId: fxSystemApplicationRevisionSchemasV1.deploymentId,
      schemaVersionId: fxSystemApplicationRevisionSchemasV1.schemaVersionId,
    }).from(fxSystemApplicationRevisionSchemasV1).where(and(
      eq(fxSystemApplicationRevisionSchemasV1.scopeId, scopeId),
      eq(fxSystemApplicationRevisionSchemasV1.revisionId, revisionId),
    )).limit(2).for("share")
  );
  const row = rows[0];
  if (
    rows.length !== 1 ||
    row === undefined ||
    row.deploymentId !== deploymentId ||
    (expectedSchemaVersionId !== undefined &&
      row.schemaVersionId !== expectedSchemaVersionId)
  ) return yield* pinCorruption(owner, identity);
  return row.schemaVersionId;
});

function pinned(
  owner: PhysicalDefinitionRetirementPinOwner,
  identity: string,
  schemaVersionId: CatalogSchemaVersionId,
): PhysicalDefinitionRetirementPinInspectionResult {
  return Object.freeze({
    status: "pinned" as const,
    pin: Object.freeze({ owner, identity, schemaVersionId }),
  });
}

function pinCorruption(
  owner: PhysicalDefinitionRetirementPinOwner,
  identity: string,
): Effect.Effect<never, PhysicalDefinitionRetirementPinCorruptionError> {
  return Effect.fail(pinCorruptionValue(owner, identity));
}

function pinCorruptionValue(
  owner: PhysicalDefinitionRetirementPinOwner,
  identity: string,
  cause?: unknown,
): PhysicalDefinitionRetirementPinCorruptionError {
  return new PhysicalDefinitionRetirementPinCorruptionError({
    owner,
    identity,
    ...(cause === undefined ? {} : { cause }),
  });
}

function requireDirectoryWithinLimit(
  owner: Exclude<
    PhysicalDefinitionRetirementPinOwner,
    "active_application" | "candidate_validation"
  >,
  observed: number,
): Effect.Effect<void, PhysicalDefinitionRetirementPinDirectoryLimitError> {
  return observed <= MAX_RUNTIME_PIN_CANDIDATES_PER_OWNER
    ? Effect.void
    : Effect.fail(new PhysicalDefinitionRetirementPinDirectoryLimitError({
      owner,
      observed,
      maximum: MAX_RUNTIME_PIN_CANDIDATES_PER_OWNER,
    }));
}

function pinPersistence(
  operation: PhysicalDefinitionRetirementPinPersistenceError["operation"],
  cause: unknown,
): PhysicalDefinitionRetirementPinPersistenceError {
  return new PhysicalDefinitionRetirementPinPersistenceError({
    operation,
    cause,
  });
}

function queryEffect<Row>(
  operation: PhysicalDefinitionRetirementPinPersistenceError["operation"],
  query: () => PromiseLike<ReadonlyArray<Row>>,
): Effect.Effect<ReadonlyArray<Row>, PhysicalDefinitionRetirementPinPersistenceError> {
  return Effect.uninterruptible(Effect.tryPromise({
    try: query,
    catch: cause => pinPersistence(operation, cause),
  }));
}

const sha256Effect = Effect.fn("PhysicalDefinitionRetirementPins.sha256")((
  bytes: Uint8Array,
): Effect.Effect<Uint8Array, PhysicalDefinitionRetirementPinCryptoError> =>
  Effect.tryPromise({
    try: async () => new Uint8Array(
      await crypto.subtle.digest("SHA-256", copyBytesToArrayBuffer(bytes)),
    ),
    catch: cause => new PhysicalDefinitionRetirementPinCryptoError({ cause }),
  }));
