import type { FiniteEntryObservation } from "../execution/finiteEntryObservation";
import { applicationFunctionEntryPublicationFrameV1 } from
  "@flarex/analysis/internal/application-publication-v1";
import { applicationFunctionEntryPublicationFrameV2 } from
  "@flarex/analysis/internal/application-publication-v2";
import {
  bytesEqualFullScan,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { isNonBlankString } from "@flarex/utils/strings";
import { and, eq } from "drizzle-orm";
import { Data, Effect, Result } from "effect";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
  type CanonicalApplicationMutationExecutionAuthorityV1,
  type ApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";

import {
  claimApplicationExecutableActiveSelection,
} from "./activation/selectionIdentity";
import {
  hasApplicationActivationPlanningComposition,
} from "./activation/bindingPreparation";
import {
  validateApplicationExecutableActiveSelectionInTransaction,
} from "./activation/bindingAcceptance";
import {
  prepareFiniteActiveApplication,
} from "./activation/repositoryIdentity";
import {
  readPreparedFiniteApplicationMutationConstruction,
  readPreparedFiniteActiveApplication,
  readPreparedFiniteApplicationAuthority,
} from "./activation/finiteIdentity";
import {
  withPreparedFiniteActiveApplicationInTransaction,
} from "./activation/finitePreparation";
import {
  type AcceptedApplicationBinding,
  type CurrentApplicationFiniteEntry,
  type PreparedFiniteActiveApplication,
  type ApplicationActiveSelection,
  type ApplicationBindingInput,
  type ApplicationActivationRepository,
  type ApplicationRelationActivationRepository,
  type ApplicationExecutableActiveSelection,
} from "./activation/contracts";
import {
  type ApplicationActivationError,
  type ValidateApplicationRelationActiveSelectionInTransactionError,
} from "./activation/errors";
import type { AppRowTransaction } from "../storage/documents/appRows";
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
} from "./relations/applicationRelationSchemaAuthority";
import type { FlarexMetadataDatabase } from "./deployments";
import type { ReadSchemaVersionArtifactError } from
  "../storage/catalog/schemaVersionArtifacts";
import {
  lockScopeClockForShareInTransactionEffect,
  type LockScopeClockForShareError,
  type ScopeClockRecord,
} from "../scope/scopeClock";
import {
  resolveLocatedTrustedScopeAuthorityByIdEffect,
  type ExactTrustedScopeAuthorityResolutionPorts,
  type TrustedScopeAuthority,
  type TrustedScopeAuthorityError,
  type TrustedScopeAuthorityResolutionPorts,
} from "../scope/scopeAuthorityResolution";
import {
  fxSystemApplicationFunctionsV1,
} from "../database/schema";
import { fxSystemApplicationFunctions } from "./relations/applicationRelationSchema";
import {
  LocatedReadCommittedTransactionFailureV1,
} from "../execution/readCommittedTransactionFailure";
import type {
  LocatedReadCommittedAttemptTargetV1,
} from "../database/locatedTransactionIdentity";
import { runLocatedReadCommittedEffect } from
  "../database/locatedReadCommittedEffect";
import { runApplicationAdmissionQuery } from "./applicationAdmissionQuery";
import {
  chargeHostPreparation,
  registerHostPreparationDisposal,
} from "../execution/preparation/preparedHostRuntime";
import { prepareFiniteApplicationSourceComposition } from "../storage/documents/logicalDocuments/sourceAdmission";
import type { LogicalParticipantSelection } from "../storage/documents/logicalDocuments/participantAdmission";

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
  readonly authority: ExactTrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  > & TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
}

declare const finiteMutationPreparationBrand: unique symbol;
export interface PreparedFiniteApplicationMutationAdmission {
  readonly [finiteMutationPreparationBrand]: true;
}
export type PreparedFiniteApplicationMutationInputs = Omit<ApplicationMutationAdmission, "selection"> & {
  readonly application: PreparedFiniteActiveApplication;
};
/** Exact immutable pins consumed by session activation. Executable manifest and
 * schema preparation remain with their original construction owners. */
export type ApplicationMutationActivationBasis = Pick<ApplicationMutationAdmission["basis"],
  "deploymentId" | "authority" | "revisionId" | "candidateId" | "analysisId" | "sourceArtifactRootSha256" |
  "manifestSha256" | "applicationSchemaSha256" | "functionCatalogSha256" | "publicationSha256" |
  "activationSequence" | "headSha256" | "schemaVersionId">;
export type PreparedFiniteApplicationMutationActivationInputs = Readonly<{
  basis: ApplicationMutationActivationBasis;
  executionAuthority: CanonicalApplicationMutationExecutionAuthorityV1;
  application: PreparedFiniteActiveApplication;
}>;
const finiteMutationPreparations = new WeakMap<PreparedFiniteApplicationMutationAdmission, {
  readonly active: PreparedFiniteActiveApplication;
  readonly context: ApplicationMutationAdmissionContext;
  readonly inputs: Omit<PreparedFiniteApplicationMutationInputs, "schema">;
}>();

/** Private finite constructor; captures one target bundle, then authenticates while target SQL is closed. */
export const prepareFiniteApplicationMutationAdmission = Effect.fn(
  "ApplicationMutationAdmission.prepareFinite",
)(function* (activationRepository: ApplicationActivationRepository<unknown, unknown> | ApplicationRelationActivationRepository<unknown, unknown>, functionPath: string,
  context: ApplicationMutationAdmissionContext, originalGenerationBinding?: ApplicationBindingInput) {
  if (!isNonBlankString(functionPath)) return yield* failure("invalidFunction");
  if (!hasApplicationActivationPlanningComposition(activationRepository, context.controlDb,
    context.schema, context.authority)) return yield* failure("invalidComposition");
  const active = yield* prepareFiniteActiveApplication(activationRepository, originalGenerationBinding);
  const { basis, schema } = yield* Effect.fromResult(readPreparedFiniteApplicationMutationConstruction(active));
  if (basis.deploymentId !== context.deploymentId ||
    !hasApplicationSchemaAuthorityComposition(context.schema, context.controlDb) ||
    schema.schemaVersionId !== basis.schemaVersionId || schema.applicationSchemaSha256 !==
      encodeBytesToLowercaseHex(basis.applicationSchemaSha256) || schema.schemaManifestSha256 !==
      encodeBytesToLowercaseHex(basis.schemaManifestSha256)) return yield* failure("invalidComposition");
  const fn = basis.manifest.functions.find(candidate => candidate.path === functionPath);
  if (fn === undefined) return yield* failure("functionMissing");
  if (fn.kind !== "mutation" || fn.visibility !== "public") return yield* failure("functionUnsupported");
  const entryBytes = basis.manifest.version === 1
    ? yield* Effect.fromResult(applicationFunctionEntryPublicationFrameV1(fn).pipe(
        Result.mapError(cause => failureValue("storedFunction", false, cause))))
    : yield* Effect.fromResult(applicationFunctionEntryPublicationFrameV2(fn).pipe(
        Result.mapError(cause => failureValue("storedFunction", false, cause))));
  const entrySha256 = encodeBytesToLowercaseHex(yield* sha256(entryBytes));
  const executionAuthority = yield* prepareMutationExecutionAuthority(basis, Object.freeze({ ...fn,
    kind: "mutation" as const, visibility: "public" as const, entrySha256 }));
  const inputs = Object.freeze({ basis, executionAuthority, application: active });
  // The active Application issuer already charged its complete retained basis.
  // Function selection contributes only its additional immutable authority.
  yield* chargeHostPreparation({ executionAuthority: { ...executionAuthority } }).pipe(
    Effect.mapError(cause => failureValue("resourceFailure", false, cause)));
  // SAFETY: only the issuing owner registry authenticates this inert nominal handle.
  const result = Object.freeze({}) as PreparedFiniteApplicationMutationAdmission;
  finiteMutationPreparations.set(result, Object.freeze({ active, context, inputs }));
  yield* registerHostPreparationDisposal(() => { finiteMutationPreparations.delete(result); }).pipe(
    Effect.mapError(cause => failureValue("resourceFailure", false, cause)));
  return result;
});

/** Detached inspection boundary retained for complete executable evidence.
 * Runtime activation consumes its narrower authenticated projection below. */
export function readPreparedFiniteApplicationMutationInputs(prepared: PreparedFiniteApplicationMutationAdmission,
  context: ApplicationMutationAdmissionContext): Result.Result<PreparedFiniteApplicationMutationInputs,
    ApplicationMutationAdmissionError | ApplicationActivationError> {
  const state = finiteMutationPreparations.get(prepared);
  if (state === undefined || state.context !== context) return Result.fail(failureValue("invalidComposition"));
  return readPreparedFiniteApplicationAuthority(state.active, context.controlDb).pipe(
    Result.flatMap(() => readPreparedFiniteActiveApplication(state.active)),
    Result.map(({ claimed, schema }) =>
      Object.freeze({ basis: claimed.basis, schema, executionAuthority: structuredClone(state.inputs.executionAuthority),
        application: state.active })));
}

/** Original current-generation composition only. This lends no live binding,
 * root, transaction, write allowance or settlement capability. */
export const prepareFiniteApplicationMutationSourceComposition = Effect.fn("ApplicationMutationAdmission.prepareSourceComposition")(function* (
  prepared: PreparedFiniteApplicationMutationAdmission, sources: readonly LogicalParticipantSelection[],
) {
  const state = finiteMutationPreparations.get(prepared);
  if (state === undefined) return yield* failure("invalidComposition");
  yield* Effect.fromResult(readPreparedFiniteApplicationAuthority(state.active, state.context.controlDb));
  yield* prepareFiniteApplicationSourceComposition(state.active, sources);
});

export function readPreparedFiniteApplicationMutationActivationInputs(prepared: PreparedFiniteApplicationMutationAdmission,
  context: ApplicationMutationAdmissionContext): Result.Result<PreparedFiniteApplicationMutationActivationInputs,
    ApplicationMutationAdmissionError | ApplicationActivationError> {
  const state = finiteMutationPreparations.get(prepared);
  if (state === undefined || state.context !== context) return Result.fail(failureValue("invalidComposition"));
  return readPreparedFiniteApplicationAuthority(state.active, context.controlDb).pipe(Result.map(authority => {
    const basis = state.inputs.basis;
    return Object.freeze({ basis: Object.freeze({ deploymentId: basis.deploymentId, authority,
      revisionId: basis.revisionId, candidateId: basis.candidateId, analysisId: basis.analysisId,
      sourceArtifactRootSha256: copyBytes(basis.sourceArtifactRootSha256), manifestSha256: copyBytes(basis.manifestSha256),
      applicationSchemaSha256: copyBytes(basis.applicationSchemaSha256), functionCatalogSha256: copyBytes(basis.functionCatalogSha256),
      publicationSha256: copyBytes(basis.publicationSha256), activationSequence: basis.activationSequence,
      headSha256: copyBytes(basis.headSha256), schemaVersionId: basis.schemaVersionId }),
      executionAuthority: structuredClone(state.inputs.executionAuthority), application: state.active });
  }));
}

export function readPreparedFiniteApplicationMutationAuthority(prepared: PreparedFiniteApplicationMutationAdmission,
  context: ApplicationMutationAdmissionContext): Result.Result<Result.Result.Success<ReturnType<typeof readPreparedFiniteApplicationAuthority>>,
    ApplicationMutationAdmissionError | ApplicationActivationError> {
  const state = finiteMutationPreparations.get(prepared);
  return state === undefined || state.context !== context ? Result.fail(failureValue("invalidComposition")) :
    readPreparedFiniteApplicationAuthority(state.active, context.controlDb);
}

export type PreparedFiniteApplicationMutationAdmissionAcceptanceError = ApplicationMutationAdmissionError |
  Effect.Error<ReturnType<typeof withPreparedFiniteActiveApplicationInTransaction>>;

/** The sole live Application frontier owns its observation through the exact entry/source union. */
export const withPreparedFiniteApplicationMutationAdmissionInTransaction = Effect.fn(
  "ApplicationMutationAdmission.acceptPreparedFinite",
)(function* <Value, Failure, Requirements>(prepared: PreparedFiniteApplicationMutationAdmission,
  context: ApplicationMutationAdmissionContext, tx: AppRowTransaction, clock: ScopeClockRecord,
  work: (accepted: Omit<ApplicationMutationAdmission, "schema">, binding: AcceptedApplicationBinding) => Effect.Effect<Value, Failure, Requirements>,
  finiteEntry?: FiniteEntryObservation, currentEntry?: CurrentApplicationFiniteEntry) {
  const state = finiteMutationPreparations.get(prepared);
  if (state === undefined || state.context !== context) return yield* failure("invalidComposition");
  return yield* withPreparedFiniteActiveApplicationInTransaction(state.active, tx, clock,
    (accepted, binding) => work(Object.freeze({ basis: accepted.basis, selection: accepted.selection,
      executionAuthority: structuredClone(state.inputs.executionAuthority) }), binding), finiteEntry, currentEntry);
});

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
    !isNonBlankString(functionPath)
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
  const located = yield* resolveLocatedTrustedScopeAuthorityByIdEffect(
    { deploymentId: context.deploymentId, scopeId: basis.authority.scopeId },
    context.authority,
  );
  yield* requireSameAuthority(basis.authority, located.authority);
  const storedFunction = yield* runLocatedRead(
    located.target,
    tx => selectStoredFunction(tx, selection, claimed, mutationFunction),
  );
  const executionAuthority = yield* prepareMutationExecutionAuthority(basis, storedFunction);
  return Object.freeze({ selection, basis, executionAuthority, schema });
});

/** A fresh entry may select a new head, but must execute the original signed program. */
export const requireFiniteReplacementApplicationExecutionAuthority = Effect.fn(
  "ApplicationMutationAdmission.requireFiniteReplacementExecutionAuthority",
)(function* (basis: ApplicationExecutableActiveSelection["basis"], expected: ApplicationMutationExecutionAuthorityV1) {
  const fn = basis.manifest.functions.find(candidate => candidate.path === expected.runtimeTarget.function.path);
  if (fn === undefined) return yield* failure("functionMissing");
  if (fn.kind !== "mutation" || (fn.visibility !== "public" && fn.visibility !== "internal"))
    return yield* failure("functionUnsupported");
  const entryBytes = basis.manifest.version === 1
    ? yield* Effect.fromResult(applicationFunctionEntryPublicationFrameV1(fn).pipe(
        Result.mapError(cause => failureValue("storedFunction", false, cause))))
    : yield* Effect.fromResult(applicationFunctionEntryPublicationFrameV2(fn).pipe(
        Result.mapError(cause => failureValue("storedFunction", false, cause))));
  const entrySha256 = encodeBytesToLowercaseHex(yield* sha256(entryBytes));
  const current = yield* prepareMutationExecutionAuthority(basis, Object.freeze({ ...fn,
    kind: "mutation" as const, visibility: fn.visibility, entrySha256 }));
  if (current.authority.runtimeTargetSha256 !== expected.runtimeTargetSha256 ||
    current.authority.schemaVersionId !== expected.schemaVersionId)
    return yield* failure("invalidExecutionAuthority");
});

const prepareMutationExecutionAuthority = Effect.fn('ApplicationMutationAdmission.prepareExecutionAuthority')(
function* (basis: ApplicationExecutableActiveSelection['basis'],
  storedFunction: ApplicationExecutableActiveSelection['basis']['manifest']['functions'][number] & {
    readonly kind: 'mutation'; readonly visibility: 'public' | 'internal'; readonly entrySha256: string;
  }) {
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
  return executionAuthority;
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
    }).pipe(Effect.map(published => published.schema));
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
