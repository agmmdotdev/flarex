import type { ApplicationManifestV1 } from
  "@flarex/analysis/application-analysis";
import { applicationFunctionEntryPublicationFrameV1 } from
  "@flarex/analysis/internal/application-publication-v1";
import {
  bytesEqualFullScan,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { and, eq } from "drizzle-orm";
import { Data, Effect, Result } from "effect";
import {
  canonicalizeApplicationActionExecutionAuthorityV1,
  type CanonicalApplicationActionExecutionAuthorityV1,
} from "flarex-protocol/internal/application-action-authority-v1";
import { canonicalizeApplicationRuntimeTargetV1 } from
  "flarex-protocol/internal/application-runtime-target-v1";

import {
  claimApplicationActiveSelection,
  validateApplicationActiveSelectionInTransaction,
  type ApplicationActiveSelection,
  type ApplicationActiveSelectionBasis,
  type ApplicationActivationError,
} from "./applicationActivation";
import type { AppRowTransaction } from "./appRows";
import {
  hasApplicationSchemaAuthorityComposition,
  type ApplicationSchemaAuthority,
  type ApplicationSchemaAuthorityError,
  type ApplicationSchemaAuthorityPublisher,
} from "./applicationSchemaAuthority";
import type { FlarexMetadataDatabase } from "./deployments";
import type { ReadSchemaVersionArtifactError } from "./schemaVersionArtifacts";
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
import { fxSystemApplicationFunctionsV1 } from "./schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";
import { runLocatedReadCommittedEffect } from "./locatedReadCommittedEffect";
import { runApplicationAdmissionQuery } from "./applicationAdmissionQuery";

export interface ApplicationActionAdmission {
  readonly selection: ApplicationActiveSelection;
  readonly basis: ApplicationActiveSelectionBasis;
  readonly executionAuthority: CanonicalApplicationActionExecutionAuthorityV1;
  readonly schema: ApplicationSchemaAuthority;
}

export interface ApplicationActionAdmissionContext {
  readonly deploymentId: string;
  readonly controlDb: FlarexMetadataDatabase;
  readonly schema: ApplicationSchemaAuthorityPublisher<unknown>;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >;
}

export class ApplicationActionAdmissionError extends Data.TaggedError(
  "ApplicationActionAdmissionError",
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

export type SelectApplicationActionAdmissionError =
  | ApplicationActionAdmissionError
  | ApplicationActivationError
  | ApplicationSchemaAuthorityError
  | ReadSchemaVersionArtifactError
  | TrustedScopeAuthorityError
  | LockScopeClockForShareError
  | LocatedReadCommittedTransactionFailureV1;

export const selectApplicationActionAdmission = Effect.fn(
  "ApplicationActionAdmission.select",
)(function* (
  selection: ApplicationActiveSelection,
  functionPath: string,
  context: ApplicationActionAdmissionContext,
): Effect.fn.Return<
  ApplicationActionAdmission,
  SelectApplicationActionAdmissionError
> {
  if (typeof functionPath !== "string" || functionPath.trim().length === 0) {
    return yield* failure("invalidFunction");
  }
  const basis = yield* Effect.fromResult(
    claimApplicationActiveSelection(selection),
  );
  if (
    basis.deploymentId !== context.deploymentId ||
    !hasApplicationSchemaAuthorityComposition(context.schema, context.controlDb)
  ) return yield* failure("invalidComposition");
  const fn = basis.manifest.functions.find(candidate =>
    candidate.path === functionPath
  );
  if (fn === undefined) return yield* failure("functionMissing");
  if (fn.kind !== "action" || fn.visibility !== "public") {
    return yield* failure("functionUnsupported");
  }
  const schema = yield* context.schema.readPublished({
    deploymentId: context.deploymentId,
    manifest: basis.manifest,
  });
  if (
    schema.schemaVersionId !== basis.schemaVersionId ||
    schema.applicationSchemaSha256 !==
      encodeBytesToLowercaseHex(basis.applicationSchemaSha256) ||
    schema.schemaManifestSha256 !==
      encodeBytesToLowercaseHex(basis.schemaManifestSha256)
  ) return yield* failure("invalidComposition");
  const actionFunction = Object.freeze({
    ...fn,
    kind: "action" as const,
    visibility: "public" as const,
  });
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    context.deploymentId,
    context.authority,
  );
  yield* requireSameAuthority(basis.authority, located.authority);
  const storedFunction = yield* runLocatedRead(
    located.target,
    tx => selectStoredFunction(tx, selection, basis, actionFunction),
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
      executionModulePath: basis.manifest.sourceArtifact.executionModulePath,
      function: storedFunction,
    }).pipe(Result.mapError(cause => failureValue(
      "invalidExecutionAuthority",
      false,
      cause,
    ))),
  );
  const runtimeTargetSha256 = yield* sha256Hex(runtimeTarget.canonicalBytes);
  const executionAuthority = yield*
    canonicalizeApplicationActionExecutionAuthorityV1({
      format: "flarex.application-action-execution-authority",
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

function selectStoredFunction(
  tx: AppRowTransaction,
  selection: ApplicationActiveSelection,
  basis: ApplicationActiveSelectionBasis,
  fn: ApplicationManifestV1["functions"][number] & {
    readonly kind: "action";
    readonly visibility: "public";
  },
) {
  return Effect.gen(function* () {
    const clock = yield* lockScopeClockForShareInTransactionEffect(
      tx,
      basis.authority.scopeId,
    );
    yield* validateApplicationActiveSelectionInTransaction(
      selection,
      tx,
      clock,
    );
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
        Result.mapError(cause => failureValue("storedFunction", false, cause)),
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
      kind: "action" as const,
      visibility: "public" as const,
      entrySha256: encodeBytesToLowercaseHex(entrySha256),
    });
  });
}

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
      left.databaseKey === right.databaseKey && left.schemaName === right.schemaName
    ? Effect.void
    : failure("authorityMismatch");
}

function runLocatedRead<Value, Failure>(
  target: LocatedReadCommittedAttemptTargetV1,
  body: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): Effect.Effect<
  Value,
  Failure | ApplicationActionAdmissionError |
    LocatedReadCommittedTransactionFailureV1
> {
  return runLocatedReadCommittedEffect(target, {
    rollbackMessage: "Application action admission transaction rolled back.",
    cleanupDefect: cause => failureValue("resourceFailure", false, cause),
  }, body);
}

function query<Row>(statement: PromiseLike<ReadonlyArray<Row>>) {
  return runApplicationAdmissionQuery(statement, cause => failureValue(
      "resourceFailure",
      isRetryableApplicationActionAdmissionCause(cause),
      cause,
    ));
}

export function isRetryableApplicationActionAdmissionCause(
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
  reason: ApplicationActionAdmissionError["reason"],
  retryable = false,
  cause?: unknown,
) {
  return Effect.fail(failureValue(reason, retryable, cause));
}

function failureValue(
  reason: ApplicationActionAdmissionError["reason"],
  retryable = false,
  cause?: unknown,
) {
  return new ApplicationActionAdmissionError({
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}
