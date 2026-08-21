import {
  decodeApplicationTaskCatalogBindingV1,
  decodeApplicationTaskDefinitionBindingV1,
  decodeApplicationTaskRuntimeTargetV1,
  encodeApplicationTaskCatalogBindingPreimageV1,
  encodeApplicationTaskDefinitionBindingPreimageV1,
  encodeApplicationTaskRuntimeTargetPreimageV1,
  type ApplicationTaskRuntimeTargetV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import {
  decodeCanonicalTaskManifestPreimageV1,
  decodeCanonicalTaskManifestV1,
  decodeTaskIdV1,
  encodeCanonicalTaskManifestPreimageV1,
  type CanonicalTaskManifestV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  bytesEqualFullScan,
  copyBytes,
  copyBytesToArrayBuffer,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { and, eq } from "drizzle-orm";
import { Data, Effect, Result } from "effect";

import {
  claimApplicationActiveSelection,
  validateApplicationActiveSelectionInTransaction,
  type ApplicationActiveSelection,
  type ApplicationActiveSelectionBasis,
  type ApplicationActivationError,
} from "./applicationActivation";
import type { AppRowTransaction } from "./appRows";
import { runApplicationAdmissionQuery } from "./applicationAdmissionQuery";
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
  fxSystemApplicationTaskCatalogsV1,
  fxSystemApplicationTaskDefinitionsV1,
} from "./schema";
import {
  LocatedReadCommittedTransactionFailureV1,
  type LocatedReadCommittedAttemptTargetV1,
} from "./transactionSessionAttemptKernel";
import { runLocatedReadCommittedEffect } from "./locatedReadCommittedEffect";

declare const applicationTaskSelectionBrand: unique symbol;
export interface ApplicationTaskSelection {
  readonly [applicationTaskSelectionBrand]: true;
}

export interface ApplicationTaskSelectionMetadata {
  readonly basis: ApplicationActiveSelectionBasis;
  readonly target: ApplicationTaskRuntimeTargetV1;
  readonly runtimeTargetSha256: Uint8Array;
  readonly manifest: CanonicalTaskManifestV1;
}

export interface SelectedApplicationTask {
  readonly selection: ApplicationTaskSelection;
  readonly metadata: ApplicationTaskSelectionMetadata;
}

export interface ApplicationTaskSelectionContext {
  readonly deploymentId: string;
  readonly runtimeHostIdentity: string;
  readonly compatibilityDate: string;
  readonly authority: TrustedScopeAuthorityResolutionPorts<
    LocatedReadCommittedAttemptTargetV1
  >;
}

export class ApplicationTaskSelectionError extends Data.TaggedError(
  "ApplicationTaskSelectionError",
)<{
  readonly operation: "select" | "claim" | "validate";
  readonly reason:
    | "invalidComposition"
    | "invalidTaskId"
    | "taskMissing"
    | "storedTask"
    | "authorityMismatch"
    | "runtimeHostMismatch"
    | "resourceFailure";
  readonly retryable: boolean;
  readonly cause?: unknown;
}> {}

export type SelectApplicationTaskError =
  | ApplicationTaskSelectionError
  | ApplicationActivationError
  | TrustedScopeAuthorityError
  | LockScopeClockForShareError
  | LocatedReadCommittedTransactionFailureV1;

interface SelectionState {
  readonly applicationSelection: ApplicationActiveSelection;
  readonly target: LocatedReadCommittedAttemptTargetV1;
  readonly metadata: ApplicationTaskSelectionMetadata;
}

const states = new WeakMap<ApplicationTaskSelection, SelectionState>();

export const selectApplicationTask = Effect.fn(
  "ApplicationTaskSelection.select",
)(function* (
  applicationSelection: ApplicationActiveSelection,
  suppliedTaskId: unknown,
  context: ApplicationTaskSelectionContext,
): Effect.fn.Return<SelectedApplicationTask, SelectApplicationTaskError> {
  const taskId = yield* Effect.fromResult(
    decodeTaskIdV1(suppliedTaskId).pipe(
      Result.mapError(cause => failureValue(
        "select",
        "invalidTaskId",
        false,
        cause,
      )),
    ),
  );
  const basis = yield* Effect.fromResult(
    claimApplicationActiveSelection(applicationSelection),
  );
  if (basis.deploymentId !== context.deploymentId) {
    return yield* failure("select", "invalidComposition");
  }
  if (
    basis.runtimeHostIdentity !== context.runtimeHostIdentity
    || basis.compatibilityDate !== context.compatibilityDate
  ) return yield* failure("select", "runtimeHostMismatch");
  const located = yield* resolveLocatedTrustedScopeAuthorityEffect(
    context.deploymentId,
    context.authority,
  );
  yield* requireSameAuthority("select", basis.authority, located.authority);
  const metadata = yield* runLocatedRead(
    "select",
    located.target,
    tx => selectInTransaction(
      "select",
      tx,
      applicationSelection,
      basis,
      taskId,
    ),
  );
  // SAFETY: the selection is an inert identity token; all state lives in
  // the module-local WeakMap keyed by this object identity.
  const selection = Object.freeze({}) as ApplicationTaskSelection;
  states.set(selection, Object.freeze({
    applicationSelection,
    target: located.target,
    metadata: copyMetadata(metadata),
  }));
  return Object.freeze({ selection, metadata: copyMetadata(metadata) });
});

export function claimApplicationTaskSelection(
  selection: unknown,
): Result.Result<
  ApplicationTaskSelectionMetadata,
  ApplicationTaskSelectionError
> {
  if (typeof selection !== "object" || selection === null) {
    return Result.fail(failureValue("claim", "invalidComposition", false));
  }
  // SAFETY: the typeof guard above proved the value is a non-null object;
  // the cast only narrows it to the WeakMap's registered brand.
  const state = states.get(selection as ApplicationTaskSelection);
  return state === undefined
    ? Result.fail(failureValue("claim", "invalidComposition", false))
    : Result.succeed(copyMetadata(state.metadata));
}

export const validateApplicationTaskSelection = Effect.fn(
  "ApplicationTaskSelection.validate",
)(function* (
  selection: ApplicationTaskSelection,
): Effect.fn.Return<ApplicationTaskSelectionMetadata, SelectApplicationTaskError> {
  const state = states.get(selection);
  if (state === undefined) {
    return yield* failure("validate", "invalidComposition");
  }
  const metadata = yield* runLocatedRead(
    "validate",
    state.target,
    tx => selectInTransaction(
      "validate",
      tx,
      state.applicationSelection,
      state.metadata.basis,
      state.metadata.target.taskId,
    ),
  );
  if (
    !bytesEqualFullScan(
      metadata.runtimeTargetSha256,
      state.metadata.runtimeTargetSha256,
    )
  ) return yield* failure("validate", "storedTask");
  return copyMetadata(state.metadata);
});

/** Revalidates an authentic selection inside the caller-owned transaction. */
export const validateApplicationTaskSelectionInTransaction = Effect.fn(
  "ApplicationTaskSelection.validateInTransaction",
)(function* (
  selection: ApplicationTaskSelection,
  tx: AppRowTransaction,
  authority: TrustedScopeAuthority,
): Effect.fn.Return<ApplicationTaskSelectionMetadata, SelectApplicationTaskError> {
  const state = states.get(selection);
  if (state === undefined) {
    return yield* failure("validate", "invalidComposition");
  }
  yield* requireSameAuthority(
    "validate",
    state.metadata.basis.authority,
    authority,
  );
  const metadata = yield* selectInTransaction(
    "validate",
    tx,
    state.applicationSelection,
    state.metadata.basis,
    state.metadata.target.taskId,
  );
  if (!bytesEqualFullScan(
    metadata.runtimeTargetSha256,
    state.metadata.runtimeTargetSha256,
  )) return yield* failure("validate", "storedTask");
  return copyMetadata(state.metadata);
});

function selectInTransaction(
  operation: "select" | "validate",
  tx: AppRowTransaction,
  applicationSelection: ApplicationActiveSelection,
  basis: ApplicationActiveSelectionBasis,
  taskId: ApplicationTaskRuntimeTargetV1["taskId"],
) {
  return Effect.gen(function* () {
    const clock = yield* lockScopeClockForShareInTransactionEffect(
      tx,
      basis.authority.scopeId,
    );
    yield* validateApplicationActiveSelectionInTransaction(
      applicationSelection,
      tx,
      clock,
    );
    const catalogRows = yield* query(operation,
      tx.select().from(fxSystemApplicationTaskCatalogsV1).where(and(
        eq(fxSystemApplicationTaskCatalogsV1.scopeId, basis.authority.scopeId),
        eq(fxSystemApplicationTaskCatalogsV1.revisionId, basis.revisionId),
      )).limit(2).for("share"),
    );
    const definitionRows = yield* query(operation,
      tx.select().from(fxSystemApplicationTaskDefinitionsV1).where(and(
        eq(fxSystemApplicationTaskDefinitionsV1.scopeId, basis.authority.scopeId),
        eq(fxSystemApplicationTaskDefinitionsV1.revisionId, basis.revisionId),
        eq(fxSystemApplicationTaskDefinitionsV1.taskId, taskId),
      )).limit(2).for("share"),
    );
    if (catalogRows.length !== 1) return yield* failure(operation, "storedTask");
    if (definitionRows.length === 0) return yield* failure(operation, "taskMissing");
    if (definitionRows.length !== 1) return yield* failure(operation, "storedTask");
    const catalog = catalogRows[0]!;
    const definition = definitionRows[0]!;
    const catalogBinding = yield* Effect.fromResult(
      decodeApplicationTaskCatalogBindingV1({
        version: 1,
        scopeId: catalog.scopeId,
        revisionId: catalog.revisionId,
        candidateId: catalog.candidateId,
        analysisId: catalog.analysisId,
        sourceArtifactRootSha256: encodeBytesToLowercaseHex(
          catalog.sourceArtifactRootSha256,
        ),
        publicationSha256: encodeBytesToLowercaseHex(catalog.publicationSha256),
        taskCatalogSha256: copyBytes(catalog.taskCatalogSha256),
        taskCount: catalog.taskCount,
        runtimeHostIdentity: catalog.runtimeHostIdentity,
        compatibilityDate: catalog.compatibilityDate,
      }).pipe(Result.mapError(cause => failureValue(
        operation,
        "storedTask",
        false,
        cause,
      ))),
    );
    const catalogBytes = yield* Effect.fromResult(
      encodeApplicationTaskCatalogBindingPreimageV1(catalogBinding).pipe(
        Result.mapError(cause => failureValue(
          operation,
          "storedTask",
          false,
          cause,
        )),
      ),
    );
    const catalogSha256 = yield* sha256(operation, catalogBytes);
    if (
      catalogBinding.scopeId !== basis.authority.scopeId
      || catalogBinding.revisionId !== basis.revisionId
      || catalogBinding.candidateId !== basis.candidateId
      || catalogBinding.analysisId !== basis.analysisId
      || catalogBinding.sourceArtifactRootSha256 !== encodeBytesToLowercaseHex(
        basis.sourceArtifactRootSha256,
      )
      || catalogBinding.publicationSha256 !== encodeBytesToLowercaseHex(
        basis.publicationSha256,
      )
      || !bytesEqualFullScan(catalogBytes, catalog.bindingBytes)
      || !bytesEqualFullScan(catalogSha256, catalog.taskCatalogBindingSha256)
      || !bytesEqualFullScan(
        catalog.taskCatalogSha256,
        basis.taskCatalogSha256,
      )
      || !bytesEqualFullScan(
        catalog.taskCatalogBindingSha256,
        basis.taskCatalogBindingSha256,
      )
    ) return yield* failure(operation, "storedTask");
    if (
      catalog.runtimeHostIdentity !== basis.runtimeHostIdentity
      || catalog.compatibilityDate !== basis.compatibilityDate
    ) return yield* failure(operation, "runtimeHostMismatch");
    const manifest = yield* Effect.fromResult(
      decodeCanonicalTaskManifestPreimageV1(definition.manifestBytes).pipe(
        Result.mapError(cause => failureValue(
          operation,
          "storedTask",
          false,
          cause,
        )),
      ),
    );
    const manifestBytes = yield* Effect.fromResult(
      encodeCanonicalTaskManifestPreimageV1(manifest).pipe(
        Result.mapError(cause => failureValue(
          operation,
          "storedTask",
          false,
          cause,
        )),
      ),
    );
    const manifestSha256 = yield* sha256(operation, manifestBytes);
    const definitionBinding = yield* Effect.fromResult(
      decodeApplicationTaskDefinitionBindingV1({
        version: 1,
        applicationTaskCatalogBindingSha256: copyBytes(
          definition.taskCatalogBindingSha256,
        ),
        canonicalTaskManifestSha256: copyBytes(
          definition.canonicalTaskManifestSha256,
        ),
        taskId: definition.taskId,
        handler: {
          logicalModulePath: definition.logicalModulePath,
          sourceModulePath: definition.sourceModulePath,
          exportName: definition.exportName,
        },
      }).pipe(Result.mapError(cause => failureValue(
        operation,
        "storedTask",
        false,
        cause,
      ))),
    );
    const definitionBytes = yield* Effect.fromResult(
      encodeApplicationTaskDefinitionBindingPreimageV1(definitionBinding).pipe(
        Result.mapError(cause => failureValue(
          operation,
          "storedTask",
          false,
          cause,
        )),
      ),
    );
    const definitionSha256 = yield* sha256(operation, definitionBytes);
    if (
      manifest.taskId !== taskId
      || manifest.handler.logicalModulePath !== definition.logicalModulePath
      || manifest.handler.artifactModulePath !== definition.sourceModulePath
      || manifest.handler.exportName !== definition.exportName
      || !bytesEqualFullScan(manifestBytes, definition.manifestBytes)
      || !bytesEqualFullScan(
        manifestSha256,
        definition.canonicalTaskManifestSha256,
      )
      || !bytesEqualFullScan(definitionBytes, definition.bindingBytes)
      || !bytesEqualFullScan(
        definitionSha256,
        definition.taskDefinitionBindingSha256,
      )
      || !bytesEqualFullScan(
        definition.taskCatalogBindingSha256,
        catalogSha256,
      )
    ) return yield* failure(operation, "storedTask");
    const target = yield* Effect.fromResult(
      decodeApplicationTaskRuntimeTargetV1({
        version: 1,
        scopeId: basis.authority.scopeId,
        revisionId: basis.revisionId,
        candidateId: basis.candidateId,
        analysisId: basis.analysisId,
        sourceArtifactRootSha256: encodeBytesToLowercaseHex(
          basis.sourceArtifactRootSha256,
        ),
        publicationSha256: encodeBytesToLowercaseHex(basis.publicationSha256),
        applicationTaskCatalogBindingSha256: copyBytes(catalogSha256),
        applicationTaskDefinitionBindingSha256: copyBytes(definitionSha256),
        taskCatalogSha256: copyBytes(catalog.taskCatalogSha256),
        taskId,
        canonicalTaskManifestSha256: copyBytes(manifestSha256),
        handler: definitionBinding.handler,
        runtimeHostIdentity: basis.runtimeHostIdentity,
        compatibilityDate: basis.compatibilityDate,
      }).pipe(Result.mapError(cause => failureValue(
        operation,
        "storedTask",
        false,
        cause,
      ))),
    );
    const targetBytes = yield* Effect.fromResult(
      encodeApplicationTaskRuntimeTargetPreimageV1(target).pipe(
        Result.mapError(cause => failureValue(
          operation,
          "storedTask",
          false,
          cause,
        )),
      ),
    );
    return copyMetadata({
      basis,
      target,
      runtimeTargetSha256: yield* sha256(operation, targetBytes),
      manifest,
    });
  });
}

function requireSameAuthority(
  operation: "select" | "validate",
  expected: TrustedScopeAuthority,
  actual: TrustedScopeAuthority,
) {
  const left = expected.physicalLocator;
  const right = actual.physicalLocator;
  return expected.deploymentId === actual.deploymentId
      && expected.scopeId === actual.scopeId
      && expected.storageGeneration === actual.storageGeneration
      && expected.storageGenerationFence === actual.storageGenerationFence
      && expected.epoch === actual.epoch
      && left.kind === right.kind
      && left.databaseKey === right.databaseKey
      && left.schemaName === right.schemaName
    ? Effect.void
    : failure(operation, "authorityMismatch");
}

function runLocatedRead<Value, Failure>(
  operation: "select" | "validate",
  target: LocatedReadCommittedAttemptTargetV1,
  body: (tx: AppRowTransaction) => Effect.Effect<Value, Failure>,
): Effect.Effect<
  Value,
  Failure | ApplicationTaskSelectionError
    | LocatedReadCommittedTransactionFailureV1
> {
  return runLocatedReadCommittedEffect(target, {
    rollbackMessage: "Application task selection transaction rolled back.",
    cleanupDefect: cause => failureValue(
      operation,
      "resourceFailure",
      false,
      cause,
    ),
  }, body);
}

function query<Row>(
  operation: "select" | "validate",
  statement: PromiseLike<ReadonlyArray<Row>>,
) {
  return runApplicationAdmissionQuery(statement, cause => failureValue(
    operation,
    "resourceFailure",
    isRetryableCause(cause),
    cause,
  ));
}

function sha256(
  operation: "select" | "validate",
  bytes: Uint8Array,
) {
  return Effect.tryPromise({
    try: () => crypto.subtle.digest(
      "SHA-256",
      copyBytesToArrayBuffer(bytes),
    ).then(buffer => new Uint8Array(buffer)),
    catch: cause => failureValue(
      operation,
      "resourceFailure",
      false,
      cause,
    ),
  });
}

function copyMetadata(
  metadata: ApplicationTaskSelectionMetadata,
): ApplicationTaskSelectionMetadata {
  return Object.freeze({
    basis: copyBasis(metadata.basis),
    target: Result.getOrThrow(
      decodeApplicationTaskRuntimeTargetV1(metadata.target),
    ),
    runtimeTargetSha256: copyBytes(metadata.runtimeTargetSha256),
    manifest: Result.getOrThrow(
      decodeCanonicalTaskManifestV1(metadata.manifest),
    ),
  });
}

function copyBasis(
  basis: ApplicationActiveSelectionBasis,
): ApplicationActiveSelectionBasis {
  return Object.freeze({
    ...basis,
    authority: Object.freeze({
      ...basis.authority,
      physicalLocator: Object.freeze({ ...basis.authority.physicalLocator }),
    }),
    sourceArtifactRootSha256: copyBytes(basis.sourceArtifactRootSha256),
    manifestSha256: copyBytes(basis.manifestSha256),
    publicationSha256: copyBytes(basis.publicationSha256),
    functionCatalogSha256: copyBytes(basis.functionCatalogSha256),
    applicationSchemaSha256: copyBytes(basis.applicationSchemaSha256),
    schemaManifestSha256: copyBytes(basis.schemaManifestSha256),
    schemaBindingSha256: copyBytes(basis.schemaBindingSha256),
    taskCatalogSha256: copyBytes(basis.taskCatalogSha256),
    taskCatalogBindingSha256: copyBytes(basis.taskCatalogBindingSha256),
    readinessSha256: copyBytes(basis.readinessSha256),
    activationSha256: copyBytes(basis.activationSha256),
    headSha256: copyBytes(basis.headSha256),
  });
}

function isRetryableCause(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null) return false;
  const code = Reflect.get(cause, "code");
  return code === "40001" || code === "40P01" || code === "55P03";
}

function failure(
  operation: ApplicationTaskSelectionError["operation"],
  reason: ApplicationTaskSelectionError["reason"],
  retryable = false,
  cause?: unknown,
) {
  return Effect.fail(failureValue(operation, reason, retryable, cause));
}

function failureValue(
  operation: ApplicationTaskSelectionError["operation"],
  reason: ApplicationTaskSelectionError["reason"],
  retryable: boolean,
  cause?: unknown,
) {
  return new ApplicationTaskSelectionError({
    operation,
    reason,
    retryable,
    ...(cause === undefined ? {} : { cause }),
  });
}
