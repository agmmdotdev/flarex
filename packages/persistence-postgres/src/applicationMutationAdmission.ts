import { applicationFunctionEntryPublicationFrameV1 } from
  "@flarex/analysis/internal/application-publication-v1";
import { applicationFunctionEntryPublicationFrameV2 } from
  "@flarex/analysis/internal/application-publication-v2";
import {
  bytesEqualFullScan,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { and, eq } from "drizzle-orm";
import { Data, Effect, Result } from "effect";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
  type CanonicalApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";

import {
  claimApplicationExecutableActiveSelection,
  validateApplicationExecutableActiveSelectionInTransaction,
  type ApplicationActiveSelection,
  type ApplicationActivationError,
  type ApplicationExecutableActiveSelection,
  type ValidateApplicationRelationActiveSelectionInTransactionError,
} from "./applicationActivation";
import type { AppRowTransaction } from "./appRows";
import {
  hasApplicationSchemaAuthorityComposition,
  type ApplicationSchemaAuthority,
  type ApplicationSchemaAuthorityError,
  type ApplicationSchemaAuthorityPublisher,
} from "./applicationSchemaAuthority";
import {
  hasApplicationRelationSchemaAuthorityComposition,
  type ApplicationRelationSchemaAuthority,
  type ApplicationRelationSchemaAuthorityPort,
  type ResolveApplicationRelationSchemaAuthorityError,
} from "./applicationRelationSchemaAuthority";
import type { FlarexMetadataDatabase } from "./deployments";
import type { ReadSchemaVersionArtifactError } from
  "./schemaVersionArtifacts";
import {
  lockScopeClockForShareInTransactionEffect,
  type LockScopeClockForShareError,
} from "./scopeClock";
import {
  resolveLocatedTrustedScopeAuthorityEffect,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "./scopeAuthorityResolution";
import {
  fxSystemApplicationFunctionsV1,
} from "./schema";
import { fxSystemApplicationFunctions } from "./applicationRelationSchema";
import {
  LocatedReadCommittedTransactionFailureV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";
import { runLocatedReadCommittedEffect } from
  "./locatedReadCommittedEffect";
import { runApplicationAdmissionQuery } from "./applicationAdmissionQuery";

export interface ApplicationMutationAdmission {
  readonly selection: ApplicationActiveSelection;
  readonly basis: ApplicationExecutableActiveSelection["basis"];
  readonly executionAuthority:
    CanonicalApplicationMutationExecutionAuthorityV1;
  readonly schema: ApplicationSchemaAuthority | ApplicationRelationSchemaAuthority;
}

export interface ApplicationMutationAdmissionContext {
  readonly deploymentId: string;
  readonly controlDb: FlarexMetadataDatabase;
  readonly schema: ApplicationSchemaAuthorityPublisher<unknown>;
  readonly relationSchema?: ApplicationRelationSchemaAuthorityPort;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >;
}

export class ApplicationMutationAdmissionError extends Data.TaggedError(
  "ApplicationMutationAdmissionError",
)<{
  readonly reason:
    | "invalidComposition"
    | "invalidFunction"
    | "functionMissing"
    | "functionUnsupported"
    | "storedFunction"
    | "authorityMismatch"
    | "invalidExecutionAuthority"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

export type SelectApplicationMutationAdmissionError =
  | ApplicationMutationAdmissionError
  | ApplicationActivationError
  | ApplicationSchemaAuthorityError
  | ResolveApplicationRelationSchemaAuthorityError
  | ValidateApplicationRelationActiveSelectionInTransactionError
  | ReadSchemaVersionArtifactError
  | TrustedScopeAuthorityError
  | LockScopeClockForShareError
  | LocatedReadCommittedTransactionFailureV1;

export const selectApplicationMutationAdmission = Effect.fn(
  "ApplicationMutationAdmission.select",
)(function (
  selection: ApplicationActiveSelection,
  functionPath: string,
  context: ApplicationMutationAdmissionContext,
): Effect.Effect<
  ApplicationMutationAdmission,
  SelectApplicationMutationAdmissionError
> {
  return selectApplicationMutationAdmissionForVisibility(
    selection,
    functionPath,
    context,
    "publicOnly",
  );
});

/**
 * Callback-only admission for an already-authenticated, selection-bound
 * invocation. External mutation roots must continue to use the public-only
 * selector above.
 */
export const selectApplicationMutationCallbackAdmission = Effect.fn(
  "ApplicationMutationAdmission.selectCallback",
)(function (
  selection: ApplicationActiveSelection,
  functionPath: string,
  context: ApplicationMutationAdmissionContext,
): Effect.Effect<
  ApplicationMutationAdmission,
  SelectApplicationMutationAdmissionError
> {
  return selectApplicationMutationAdmissionForVisibility(
    selection,
    functionPath,
    context,
    "publicOrInternal",
  );
});

const selectApplicationMutationAdmissionForVisibility = Effect.fn(
  "ApplicationMutationAdmission.selectForVisibility",
)(function* (
  selection: ApplicationActiveSelection,
  functionPath: string,
  context: ApplicationMutationAdmissionContext,
  visibility: "publicOnly" | "publicOrInternal",
): Effect.fn.Return<
  ApplicationMutationAdmission,
  SelectApplicationMutationAdmissionError
> {
  if (
    typeof functionPath !== "string" || functionPath.trim().length === 0
  ) return yield* failure("invalidFunction");
  const claimed = yield* Effect.fromResult(
    claimApplicationExecutableActiveSelection(selection),
  );
  const basis = claimed.basis;
  if (basis.deploymentId !== context.deploymentId) {
    return yield* failure("invalidComposition");
  }
  const fn = basis.manifest.functions.find(candidate =>
    candidate.path === functionPath
  );
  if (fn === undefined) return yield* failure("functionMissing");
  if (
    fn.kind !== "mutation" ||
    (
      fn.visibility !== "public" &&
      (visibility === "publicOnly" || fn.visibility !== "internal")
    )
  ) {
    return yield* failure("functionUnsupported");
  }
  const schema = yield* resolveApplicationMutationSchema(claimed, context);
  if (
    schema.schemaVersionId !== basis.schemaVersionId ||
    schema.applicationSchemaSha256 !==
      encodeBytesToLowercaseHex(basis.applicationSchemaSha256) ||
    schema.schemaManifestSha256 !==
      encodeBytesToLowercaseHex(basis.schemaManifestSha256)
  ) return yield* failure("invalidComposition");
  const mutationFunction = Object.freeze({
    ...fn,
    kind: "mutation" as const,
    visibility: fn.visibility,
  });
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    context.deploymentId,
    context.authority,
  );
  yield* requireSameAuthority(basis.authority, located.authority);
  const storedFunction = yield* runLocatedRead(
    located.target,
    tx => selectStoredFunction(tx, selection, claimed, mutationFunction),
  );
  const runtimeTarget = yield* Effect.fromResult(
    canonicalizeApplicationRuntimeTargetV1({
      format: "flarex.application-runtime-target",
      version: 1,
      scopeId: basis.authority.scopeId,
      revisionId: basis.revisionId,
      candidateId: basis.candidateId,
      analysisId: basis.analysisId,
      sourceArtifactRootSha256: encodeBytesToLowercaseHex(
        basis.sourceArtifactRootSha256,
      ),
      manifestSha256: encodeBytesToLowercaseHex(basis.manifestSha256),
      schemaSha256: encodeBytesToLowercaseHex(
        basis.applicationSchemaSha256,
      ),
      functionCatalogSha256: encodeBytesToLowercaseHex(
        basis.functionCatalogSha256,
      ),
      publicationSha256: encodeBytesToLowercaseHex(
        basis.publicationSha256,
      ),
      executionModulePath:
        basis.manifest.sourceArtifact.executionModulePath,
      function: storedFunction,
    }).pipe(Result.mapError(cause => failureValue(
      "invalidExecutionAuthority",
      false,
      cause,
    ))),
  );
  const runtimeTargetSha256 = yield* sha256Hex(runtimeTarget.canonicalBytes);
  const executionAuthority = yield*
    canonicalizeApplicationMutationExecutionAuthorityV1({
      format: "flarex.application-mutation-execution-authority",
      version: 1,
      runtimeTarget: runtimeTarget.target,
      runtimeTargetSha256,
      activationSequence: basis.activationSequence.toString(),
      activeHeadSha256: encodeBytesToLowercaseHex(basis.headSha256),
      schemaVersionId: basis.schemaVersionId,
    }).pipe(Effect.mapError(cause => failureValue(
      "invalidExecutionAuthority",
      false,
      cause,
    )));
  return Object.freeze({ selection, basis, executionAuthority, schema });
});

const resolveApplicationMutationSchema = Effect.fn(
  "ApplicationMutationAdmission.resolveSchema",
)(function* (
  claimed: ApplicationExecutableActiveSelection,
  context: ApplicationMutationAdmissionContext,
) {
  if (claimed.kind === "legacy") {
    if (!hasApplicationSchemaAuthorityComposition(
      context.schema,
      context.controlDb,
    )) return yield* failure("invalidComposition");
    return yield* context.schema.readPublished({
      deploymentId: context.deploymentId,
      manifest: claimed.basis.manifest,
    });
  }
  const relationSchema = context.relationSchema;
  if (!hasApplicationRelationSchemaAuthorityComposition(
    relationSchema,
    context.controlDb,
  )) return yield* failure("invalidComposition");
  return yield* relationSchema.resolve({
    deploymentId: context.deploymentId,
    applicationManifestSha256: encodeBytesToLowercaseHex(
      claimed.basis.manifestSha256,
    ),
    manifest: claimed.basis.manifest,
  });
});

const selectStoredFunction = Effect.fn(
  "ApplicationMutationAdmission.selectStoredFunction",
)(function* (
  tx: AppRowTransaction,
  selection: ApplicationActiveSelection,
  claimed: ApplicationExecutableActiveSelection,
  fn: ApplicationExecutableActiveSelection["basis"]["manifest"]["functions"][number] & {
    readonly kind: "mutation";
    readonly visibility: "public" | "internal";
  },
) {
  const basis = claimed.basis;
  const clock = yield* lockScopeClockForShareInTransactionEffect(
    tx,
    basis.authority.scopeId,
  );
  yield* validateApplicationExecutableActiveSelectionInTransaction(
    selection,
    tx,
    clock,
  );
  if (claimed.kind === "relation") {
    const rows = yield* query(
      tx.select().from(fxSystemApplicationFunctions).where(and(
        eq(fxSystemApplicationFunctions.scopeId, basis.authority.scopeId),
        eq(fxSystemApplicationFunctions.revisionId, basis.revisionId),
        eq(fxSystemApplicationFunctions.functionPath, fn.path),
      )).limit(2),
    );
    if (rows.length !== 1) return yield* failure("storedFunction");
    const row = rows[0]!;
    const entryBytes = yield* Effect.fromResult(
      applicationFunctionEntryPublicationFrameV2(fn).pipe(
        Result.mapError(cause => failureValue(
          "storedFunction",
          false,
          cause,
        )),
      ),
    );
    const entrySha256 = yield* sha256(entryBytes);
    if (
      row.functionPath !== fn.path || row.moduleName !== fn.moduleName ||
      row.exportName !== fn.exportName || row.functionKind !== fn.kind ||
      row.visibility !== fn.visibility ||
      !bytesEqualFullScan(
        row.functionCatalogSha256,
        basis.functionCatalogSha256,
      ) || !bytesEqualFullScan(row.entryBytes, entryBytes) ||
      !bytesEqualFullScan(row.entrySha256, entrySha256)
    ) return yield* failure("storedFunction");
    return Object.freeze({
      ...fn,
      kind: "mutation" as const,
      visibility: fn.visibility,
      entrySha256: encodeBytesToLowercaseHex(entrySha256),
    });
  }
  const rows = yield* query(
    tx.select().from(fxSystemApplicationFunctionsV1).where(and(
      eq(fxSystemApplicationFunctionsV1.scopeId, basis.authority.scopeId),
      eq(fxSystemApplicationFunctionsV1.revisionId, basis.revisionId),
      eq(fxSystemApplicationFunctionsV1.functionPath, fn.path),
    )).limit(2),
  );
  if (rows.length !== 1) return yield* failure("storedFunction");
  const row = rows[0]!;
  const entryBytes = yield* Effect.fromResult(
    applicationFunctionEntryPublicationFrameV1(fn).pipe(
      Result.mapError(cause => failureValue(
        "storedFunction",
        false,
        cause,
      )),
    ),
  );
  const entrySha256 = yield* sha256(entryBytes);
  if (
    row.functionPath !== fn.path || row.moduleName !== fn.moduleName ||
    row.exportName !== fn.exportName || row.functionKind !== fn.kind ||
    row.visibility !== fn.visibility ||
    !bytesEqualFullScan(
      row.functionCatalogSha256,
      basis.functionCatalogSha256,
    ) || !bytesEqualFullScan(row.entryBytes, entryBytes) ||
    !bytesEqualFullScan(row.entrySha256, entrySha256)
  ) return yield* failure("storedFunction");
  return Object.freeze({
    ...fn,
    kind: "mutation" as const,
    visibility: fn.visibility,
    entrySha256: encodeBytesToLowercaseHex(entrySha256),
  });
});

function requireSameAuthority(
  expected: TrustedScopeAuthority,
  actual: TrustedScopeAuthority,
) {
  const left = expected.physicalLocator;
  const right = actual.physicalLocator;
  return expected.deploymentId === actual.deploymentId &&
      expected.scopeId === actual.scopeId &&
      expected.storageGeneration === actual.storageGeneration &&
      expected.storageGenerationFence === actual.storageGenerationFence &&
      expected.epoch === actual.epoch && left.kind === right.kind &&
      left.databaseKey === right.databaseKey &&
      left.schemaName === right.schemaName
    ? Effect.void
    : failure("authorityMismatch");
}

function runLocatedRead<Value, Failure>(
  target: LocatedReadCommittedAttemptTargetV1,
  body: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): Effect.Effect<
  Value,
  Failure | ApplicationMutationAdmissionError |
    LocatedReadCommittedTransactionFailureV1
> {
  return runLocatedReadCommittedEffect(target, {
    rollbackMessage: "Application mutation admission transaction rolled back.",
    cleanupDefect: cause => failureValue("resourceFailure", false, cause),
  }, body);
}

function query<Row>(statement: PromiseLike<ReadonlyArray<Row>>) {
  return runApplicationAdmissionQuery(statement, cause => failureValue(
      "resourceFailure",
      isRetryableApplicationMutationAdmissionCause(cause),
      cause,
    ));
}

export function isRetryableApplicationMutationAdmissionCause(
  cause: unknown,
): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const code = Reflect.get(cause, "code");
  return code === "40001" || code === "40P01" || code === "55P03";
}

function sha256(bytes: Uint8Array) {
  return Effect.tryPromise({
    try: () => crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(bytes),
    ).then(buffer => new Uint8Array(buffer)),
    catch: cause => failureValue("resourceFailure", false, cause),
  });
}

function sha256Hex(bytes: Uint8Array) {
  return sha256(bytes).pipe(Effect.map(encodeBytesToLowercaseHex));
}

function failure(
  reason: ApplicationMutationAdmissionError["reason"],
  retryable = false,
  cause?: unknown,
) {
  return Effect.fail(failureValue(reason, retryable, cause));
}

function failureValue(
  reason: ApplicationMutationAdmissionError["reason"],
  retryable = false,
  cause?: unknown,
) {
  return new ApplicationMutationAdmissionError({
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}
