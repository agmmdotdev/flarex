import {
  claimApplicationExecutableActiveSelection,
} from "../../application/activation/selectionIdentity";
import type {
  ApplicationMutationActivationBasis,
} from "../../application/applicationMutationAdmission";
import {
  decodeTransactionExecutionClaimFenceV1,
  decodeTransactionExecutionClaimOwnerV1,
  type TransactionExecutionClaimObservationV1,
  type TransactionExecutionClaimOwnerV1,
} from "../claims/transactionExecutionClaimModel";
import type {
  PointMutationExecutionProfile,
  PointMutationSessionActivationResultV1,
  PointMutationSessionAnchorV1,
  PointMutationSessionAttemptAbortInputV1,
  PointMutationSessionAttemptSelectorV1,
  PreparedApplicationMutationSessionActivationV1,
  PreparedMutationSessionCommonEvidenceV1,
  PreparedPointMutationSessionActivationV1,
  PreparedStoredMutationSessionActivationV1,
} from "./contracts";
import {
  PointMutationSessionActivationConfigurationV1Error,
  PointMutationSessionActivationV1Error,
  activationError,
  attemptLoadError,
  attemptTerminalizationError,
  corruptionError,
  type PointMutationSessionAttemptLoadV1Error,
  type PointMutationSessionAttemptTerminalizationV1Error,
} from "./errors";
import { bytesEqual, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { copyFiniteDate } from "@flarex/utils/dates";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Effect, Result, Schema } from "effect";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
  type CanonicalApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import {
  inspectVerifiedApplicationMutationGrantV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import {
  isJsonArray,
  isJsonObject,
  isJsonObjectFromUnknown,
  jsonEqual,
  type Json,
  type JsonObject,
} from "flarex-protocol/json";
import { CatalogSchemaVersionIdSchema } from "flarex-protocol/schema-manifest";
import {
  ReplacementScopeIdV1Schema,
  SnapshotTokenSchema,
  decodeReplacementScopeIdV1,
  type ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
  type TransactionGrantDeploymentIdV1,
} from "flarex-protocol/transaction-grant";
import {
  CanonicalTransactionArgumentsBytesV1Schema,
  CanonicalTransactionAuthorizationGrantBytesV1Schema,
  TransactionArgumentsSha256V1Schema,
  TransactionAttemptFenceSchema,
  TransactionAuthorizationGrantSha256V1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionRequestSha256V1Schema,
  TransactionSessionIdV1Schema,
  type TransactionSessionIdV1,
} from "flarex-protocol/transaction-session";
import { canonicalizeFlarexValueJsonV1Effect } from "flarex-protocol/value";

const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const decodeAttemptDeploymentIdResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionGrantDeploymentIdV1Schema),
);

const decodeAttemptScopeIdResult = Schema.decodeUnknownResult(
  Schema.toType(ReplacementScopeIdV1Schema),
);

const decodeAttemptSessionIdResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionSessionIdV1Schema),
);

const decodeAttemptFenceResult = Schema.decodeUnknownResult(
  Schema.toType(TransactionAttemptFenceSchema),
);

const decodeAttemptSnapshotTokenResult = Schema.decodeUnknownResult(
  Schema.toType(SnapshotTokenSchema),
);

export const decodeCheckedSchemaVersionIdResult = Schema.decodeUnknownResult(CatalogSchemaVersionIdSchema);

export function nullableJsonEqual(
  actual: unknown | null,
  expected: unknown | null,
): boolean {
  if (actual === null || expected === null) return actual === expected;
  return isJsonObjectFromUnknown(actual) && isJsonObjectFromUnknown(expected) &&
    jsonEqual(actual, expected);
}

export function nullableBytesEqual(
  actual: Uint8Array | null,
  expected: Uint8Array | null,
): boolean {
  return actual === null || expected === null
    ? actual === expected
    : bytesEqual(actual, expected);
}

export function capturePreparedActivation(
  input: PreparedPointMutationSessionActivationV1,
): Result.Result<
  PreparedStoredMutationSessionActivationV1,
  PointMutationSessionActivationV1Error
> {
  if (input.executionProfile !== undefined &&
    input.executionProfile !== "durableOperations" &&
    input.executionProfile !== "finiteRoot") {
    return Result.fail(activationError({ reason: "invalidPreparedEvidence" }));
  }
  const evidence = input.evidence;
  return capturePreparedCommonEvidence(
    input.deploymentId,
    input.scopeId,
    input.evidence,
  ).pipe(Result.map(common => Object.freeze({
    ...common,
    executionProfile: input.executionProfile ?? "durableOperations",
    evidence: Object.freeze({
      ...common.evidence,
      executionAuthorityGeneration:
        "legacy_dynamic_worker_v1" as const,
      applicationExecutionAuthorityJson: null,
      applicationExecutionAuthorityCanonicalBytes: null,
      applicationExecutionAuthoritySha256: null,
      packageId: evidence.packageId,
      artifactRuntime: evidence.artifactRuntime,
      artifactId: evidence.artifactId,
      sourcePackageHash: evidence.sourcePackageHash,
      executionModule: evidence.executionModule,
    }),
  }) satisfies PreparedStoredMutationSessionActivationV1));
}

function capturePreparedCommonEvidence(
  deploymentId: TransactionGrantDeploymentIdV1,
  scopeId: ReplacementScopeIdV1,
  evidence: PreparedMutationSessionCommonEvidenceV1,
): Result.Result<
  Readonly<{
    readonly deploymentId: TransactionGrantDeploymentIdV1;
    readonly scopeId: ReplacementScopeIdV1;
    readonly evidence: PreparedMutationSessionCommonEvidenceV1;
  }>,
  PointMutationSessionActivationV1Error
> {
  if (
    !isJsonObjectFromUnknown(evidence.validatedArgsJson) ||
    !isJsonObjectFromUnknown(evidence.authorizationGrantJson)
  ) return Result.fail(activationError({ reason: "invalidPreparedEvidence" }));
  return Result.try({
    try: () => Object.freeze({
      deploymentId,
      scopeId: decodeReplacementScopeIdV1(scopeId),
      evidence: Object.freeze({
        functionPath: evidence.functionPath,
        functionKind: evidence.functionKind,
        schemaVersionId: evidence.schemaVersionId,
        policyVersion: evidence.policyVersion,
        identityAccessPolicySha256:
          TransactionIdentityAccessPolicySha256V1Schema.make(
            new Uint8Array(evidence.identityAccessPolicySha256),
          ),
        validatedArgsJson: cloneJsonObject(evidence.validatedArgsJson),
        validatedArgsValueCodecVersion:
          evidence.validatedArgsValueCodecVersion,
        validatedArgsCanonicalBytes:
          CanonicalTransactionArgumentsBytesV1Schema.make(
            new Uint8Array(evidence.validatedArgsCanonicalBytes),
          ),
        validatedArgsSha256: TransactionArgumentsSha256V1Schema.make(
          new Uint8Array(evidence.validatedArgsSha256),
        ),
        authorizationGrantId: evidence.authorizationGrantId,
        authorizationGrantJson: cloneJsonObject(
          evidence.authorizationGrantJson,
        ),
        authorizationGrantValueCodecVersion:
          evidence.authorizationGrantValueCodecVersion,
        authorizationGrantCanonicalBytes:
          CanonicalTransactionAuthorizationGrantBytesV1Schema.make(
            new Uint8Array(evidence.authorizationGrantCanonicalBytes),
          ),
        authorizationGrantSha256:
          TransactionAuthorizationGrantSha256V1Schema.make(
            new Uint8Array(evidence.authorizationGrantSha256),
          ),
        authorizationRevocationEpoch:
          TransactionAuthorizationRevocationEpochSchema.make(
            evidence.authorizationRevocationEpoch,
          ),
        authorizationGrantExpiresAt: cloneValidDate(
          evidence.authorizationGrantExpiresAt,
        ),
        requestKey: evidence.requestKey,
        requestSha256: TransactionRequestSha256V1Schema.make(
          new Uint8Array(evidence.requestSha256),
        ),
      }),
    }),
    catch: () => activationError({ reason: "invalidPreparedEvidence" }),
  });
}

export const capturePreparedApplicationActivation = Effect.fn(
  "ApplicationMutationSessionActivation.capture",
)(function* (input: PreparedApplicationMutationSessionActivationV1) {
  if (input.executionProfile !== undefined &&
    input.executionProfile !== "durableOperations")
    return yield* Effect.fail(activationError({ reason: "invalidPreparedEvidence" }));
  const claimedSelection = yield* Effect.fromResult(
    claimApplicationExecutableActiveSelection(input.activeSelection),
  );
  const prepared = yield* capturePreparedApplicationActivationFromBasis(input, claimedSelection.basis);
  return Object.freeze({ ...prepared, selection: input.activeSelection });
});

export const capturePreparedApplicationActivationFromBasis = Effect.fn("ApplicationMutationSessionActivation.captureBasis")(
function* (input: Omit<PreparedApplicationMutationSessionActivationV1, "activeSelection" | "executionProfile"> &
  Readonly<{ executionProfile?: PointMutationExecutionProfile }>,
  selectionBasis: ApplicationMutationActivationBasis, original?: CanonicalApplicationMutationExecutionAuthorityV1) {
  const executionAuthority = original ?? (yield* canonicalizeApplicationMutationExecutionAuthorityV1(input.evidence.executionAuthority));
  if (original !== undefined && !nullableJsonEqual(input.evidence.executionAuthority, original.authority))
    return yield* Effect.fail(activationError({ reason: "invalidPreparedEvidence" }));
  const grant = yield* Effect.try({
    try: () => inspectVerifiedApplicationMutationGrantV1(
      input.evidence.verifiedGrant,
    ),
    catch: () => activationError({ reason: "invalidPreparedEvidence" }),
  });
  const authority = executionAuthority.authority;
  const grantPayload = grant.payload;
  const canonicalArgs = yield* canonicalizeFlarexValueJsonV1Effect(
    input.evidence.validatedArgsJson,
  ).pipe(Effect.mapError(() =>
    activationError({ reason: "invalidPreparedEvidence" })
  ));
  if (
    input.deploymentId !== selectionBasis.deploymentId ||
    input.scopeId !== selectionBasis.authority.scopeId ||
    authority.runtimeTarget.scopeId !== input.scopeId ||
    authority.runtimeTarget.revisionId !== selectionBasis.revisionId ||
    authority.runtimeTarget.candidateId !== selectionBasis.candidateId ||
    authority.runtimeTarget.analysisId !== selectionBasis.analysisId ||
    authority.runtimeTarget.sourceArtifactRootSha256 !==
      encodeBytesToLowercaseHex(selectionBasis.sourceArtifactRootSha256) ||
    authority.runtimeTarget.manifestSha256 !==
      encodeBytesToLowercaseHex(selectionBasis.manifestSha256) ||
    authority.runtimeTarget.schemaSha256 !==
      encodeBytesToLowercaseHex(selectionBasis.applicationSchemaSha256) ||
    authority.runtimeTarget.functionCatalogSha256 !==
      encodeBytesToLowercaseHex(selectionBasis.functionCatalogSha256) ||
    authority.runtimeTarget.publicationSha256 !==
      encodeBytesToLowercaseHex(selectionBasis.publicationSha256) ||
    authority.activationSequence !== selectionBasis.activationSequence.toString() ||
    authority.activeHeadSha256 !==
      encodeBytesToLowercaseHex(selectionBasis.headSha256) ||
    authority.schemaVersionId !== selectionBasis.schemaVersionId ||
    grantPayload.deploymentId !== input.deploymentId ||
    grantPayload.scopeId !== input.scopeId ||
    grantPayload.executionAuthoritySha256 !==
      encodeBytesToLowercaseHex(executionAuthority.sha256) ||
    grantPayload.activationSequence !== authority.activationSequence ||
    grantPayload.activeHeadSha256 !== authority.activeHeadSha256 ||
    grantPayload.schemaVersionId !== authority.schemaVersionId ||
    grantPayload.functionPath !== authority.runtimeTarget.function.path ||
    grantPayload.functionKind !== authority.runtimeTarget.function.kind ||
    input.evidence.functionPath !== grantPayload.functionPath ||
    input.evidence.functionKind !== grantPayload.functionKind ||
    input.evidence.schemaVersionId !== grantPayload.schemaVersionId ||
    grantPayload.policyVersion !== input.evidence.policyVersion ||
    grantPayload.identityAccessPolicySha256 !==
      encodeBytesToLowercaseHex(input.evidence.identityAccessPolicySha256) ||
    grantPayload.validatedArgsValueCodecVersion !==
      input.evidence.validatedArgsValueCodecVersion ||
    grantPayload.validatedArgsSha256 !==
      encodeBytesToLowercaseHex(input.evidence.validatedArgsSha256) ||
    !bytesEqual(
      canonicalArgs.canonicalBytes,
      input.evidence.validatedArgsCanonicalBytes,
    ) ||
    !bytesEqual(canonicalArgs.sha256, input.evidence.validatedArgsSha256) ||
    grantPayload.requestKey !== input.evidence.requestKey ||
    grantPayload.requestSha256 !==
      encodeBytesToLowercaseHex(input.evidence.requestSha256)
  ) return yield* Effect.fail(
    activationError({ reason: "invalidPreparedEvidence" }),
  );
  const common = yield* Effect.fromResult(capturePreparedCommonEvidence(
    input.deploymentId,
    input.scopeId,
    {
      ...input.evidence,
      authorizationGrantId: grant.authorizationGrantId,
      authorizationGrantJson: grant.authorizationGrantJson,
      authorizationGrantValueCodecVersion:
        grant.authorizationGrantValueCodecVersion,
      authorizationGrantCanonicalBytes:
        grant.authorizationGrantCanonicalBytes,
      authorizationGrantSha256: grant.authorizationGrantSha256,
      authorizationRevocationEpoch:
        grant.authorizationRevocationEpoch,
      authorizationGrantExpiresAt: new Date(
        grant.authorizationGrantExpiresAt,
      ),
    },
  ));
  return Object.freeze({
    activation: Object.freeze({
      deploymentId: common.deploymentId,
      scopeId: common.scopeId,
      executionProfile: input.executionProfile ?? "durableOperations",
      evidence: Object.freeze({
        ...common.evidence,
        executionAuthorityGeneration: "application_v1" as const,
        applicationExecutionAuthorityJson:
          executionAuthority.authority,
        applicationExecutionAuthorityCanonicalBytes:
          executionAuthority.canonicalBytes,
        applicationExecutionAuthoritySha256: executionAuthority.sha256,
        packageId: null,
        artifactRuntime: null,
        artifactId: null,
        sourcePackageHash: null,
        executionModule: null,
      }),
    }) satisfies PreparedStoredMutationSessionActivationV1,
  });
});

export function captureAttemptSelector(
  input: PointMutationSessionAttemptSelectorV1,
): Result.Result<
  PointMutationSessionAttemptSelectorV1,
  PointMutationSessionAttemptLoadV1Error
> {
  return decodeAttemptSelectorResult(input).pipe(
    Result.mapError(invalidAttemptSelector),
  );
}

function decodeAttemptSelectorResult(
  input: PointMutationSessionAttemptSelectorV1,
): Result.Result<PointMutationSessionAttemptSelectorV1, unknown> {
  return Result.gen(function* () {
    const deploymentIdInput = yield* readAttemptSelectorInput(
      () => input.deploymentId,
    );
    const deploymentId = yield* decodeAttemptDeploymentIdResult(
      deploymentIdInput,
    );
    const scopeIdInput = yield* readAttemptSelectorInput(() => input.scopeId);
    const scopeId = yield* decodeAttemptScopeIdResult(scopeIdInput);
    const sessionIdInput = yield* readAttemptSelectorInput(
      () => input.sessionId,
    );
    const sessionId = yield* decodeAttemptSessionIdResult(sessionIdInput);
    const attemptFenceInput = yield* readAttemptSelectorInput(
      () => input.attemptFence,
    );
    const attemptFence = yield* decodeAttemptFenceResult(attemptFenceInput);
    return Object.freeze({
      deploymentId,
      scopeId,
      sessionId,
      attemptFence,
    } satisfies PointMutationSessionAttemptSelectorV1);
  });
}

function readAttemptSelectorInput<A>(
  read: () => A,
): Result.Result<A, unknown> {
  return Result.try({ try: read, catch: (cause) => cause });
}

function invalidAttemptSelector(
  cause: unknown,
): PointMutationSessionAttemptLoadV1Error {
  return attemptLoadError({ reason: "invalidSelector", cause });
}

export function captureTerminalizationAttemptSelector(
  input: PointMutationSessionAttemptSelectorV1,
): Result.Result<
  PointMutationSessionAttemptSelectorV1,
  PointMutationSessionAttemptTerminalizationV1Error
> {
  return decodeAttemptSelectorResult(input).pipe(
    Result.mapError(invalidTerminalizationAttemptSelector),
  );
}

export function captureAttemptAbortInput(
  input: PointMutationSessionAttemptAbortInputV1,
): Result.Result<
  PointMutationSessionAttemptAbortInputV1,
  PointMutationSessionAttemptTerminalizationV1Error
> {
  return Result.gen(function* () {
    const selectorInput = yield* readAttemptTerminalizationInput(
      () => input.selector,
      invalidTerminalizationAttemptSelector,
    );
    const selector = yield* captureTerminalizationAttemptSelector(selectorInput);
    const expectedSnapshotTokenInput = yield* readAttemptTerminalizationInput(
      () => input.expectedSnapshotToken,
      invalidAbortSnapshot,
    );
    const expectedSnapshotToken = yield* decodeAttemptSnapshotTokenResult(
      expectedSnapshotTokenInput,
    ).pipe(Result.mapError(invalidAbortSnapshot));
    if (expectedSnapshotToken.scopeId !== selector.scopeId) {
      return yield* Result.fail(invalidAbortSnapshot(
        new Error("Abort snapshot scope does not match its selector."),
      ));
    }
    const claimInput = yield* readAttemptTerminalizationInput(
      () => input.executionClaim,
      invalidAbortExecutionClaim,
    );
    const claimOwnerInput = yield* readAttemptTerminalizationInput(
      () => claimInput.claimOwner,
      invalidAbortExecutionClaim,
    );
    const claimOwner = decodeTransactionExecutionClaimOwnerV1(claimOwnerInput);
    const claimFenceInput = yield* readAttemptTerminalizationInput(
      () => claimInput.claimFence,
      invalidAbortExecutionClaim,
    );
    const claimFence = decodeTransactionExecutionClaimFenceV1(claimFenceInput);
    const executionClaim = yield* Result.all({ claimOwner, claimFence }).pipe(
      Result.mapError(() => invalidAbortExecutionClaim(
        new Error("Abort execution claim is invalid."),
      )),
    );
    return Object.freeze({
      selector,
      expectedSnapshotToken: Object.freeze(expectedSnapshotToken),
      executionClaim: Object.freeze(executionClaim),
    });
  });
}

function readAttemptTerminalizationInput<A>(
  read: () => A,
  onFailure: (cause: unknown) => PointMutationSessionAttemptTerminalizationV1Error,
): Result.Result<A, PointMutationSessionAttemptTerminalizationV1Error> {
  return Result.try({ try: read, catch: onFailure });
}

function invalidTerminalizationAttemptSelector(
  cause: unknown,
): PointMutationSessionAttemptTerminalizationV1Error {
  return attemptTerminalizationError({ reason: "invalidSelector", cause });
}

function invalidAbortSnapshot(
  cause: unknown,
): PointMutationSessionAttemptTerminalizationV1Error {
  return attemptTerminalizationError({
    reason: "invalidAbortSnapshot",
    cause,
  });
}

function invalidAbortExecutionClaim(
  cause: unknown,
): PointMutationSessionAttemptTerminalizationV1Error {
  return attemptTerminalizationError({
    reason: "invalidAbortExecutionClaim",
    cause,
  });
}

export function requireLeaseDuration(value: number): number {
  if (!isPositiveSafeInteger(value)) {
    throw new PointMutationSessionActivationConfigurationV1Error({
      reason: "invalidLeaseDuration",
    });
  }
  return value;
}

export function requireActivationExecutionClaimDuration(value: number): number {
  if (!isPositiveSafeInteger(value)) {
    throw new PointMutationSessionActivationConfigurationV1Error({
      reason: "invalidExecutionClaimDuration",
    });
  }
  return value;
}

export const generateSessionIdEffect = Effect.fn(
  "PointMutationSessionActivation.generateSessionId",
)(function* (
  randomUuid: () => string,
): Effect.fn.Return<
  TransactionSessionIdV1,
  PointMutationSessionActivationConfigurationV1Error
> {
  const value = yield* Effect.try({
    try: randomUuid,
    catch: (cause) =>
      new PointMutationSessionActivationConfigurationV1Error({
        reason: "sessionIdGenerationFailed",
        cause,
      }),
  });
  return yield* Effect.fromResult(validateGeneratedSessionId(value));
});

function validateGeneratedSessionId(
  value: string,
): Result.Result<
  TransactionSessionIdV1,
  PointMutationSessionActivationConfigurationV1Error
> {
  if (!UUID_V4_PATTERN.test(value)) {
    return Result.fail(new PointMutationSessionActivationConfigurationV1Error({
      reason: "invalidGeneratedSessionId",
      value,
    }));
  }
  return Result.succeed(TransactionSessionIdV1Schema.make(value));
}

export const generateExecutionClaimOwnerEffect = Effect.fn(
  "PointMutationSessionActivation.generateExecutionClaimOwner",
)(function* (
  randomUuid: () => string,
): Effect.fn.Return<
  TransactionExecutionClaimOwnerV1,
  PointMutationSessionActivationConfigurationV1Error
> {
  const value = yield* Effect.try({
    try: randomUuid,
    catch: (cause) =>
      new PointMutationSessionActivationConfigurationV1Error({
        reason: "executionClaimOwnerGenerationFailed",
        cause,
      }),
  });
  return yield* Effect.fromResult(
    decodeTransactionExecutionClaimOwnerV1(value).pipe(Result.mapError(() =>
      new PointMutationSessionActivationConfigurationV1Error({
        reason: "invalidGeneratedExecutionClaimOwner",
        value,
      })
    )),
  );
});

export function activationResult(
  status: PointMutationSessionActivationResultV1["status"],
  anchor: PointMutationSessionAnchorV1,
  executionClaim?: TransactionExecutionClaimObservationV1,
): PointMutationSessionActivationResultV1 {
  const capturedAnchor = Object.freeze({
    ...anchor,
    snapshotToken: Object.freeze(
      SnapshotTokenSchema.make({
        scopeId: anchor.snapshotToken.scopeId,
        epoch: anchor.snapshotToken.epoch,
        commitSeq: anchor.snapshotToken.commitSeq,
      }),
    ),
  } satisfies PointMutationSessionAnchorV1);
  switch (status) {
    case "created":
      if (executionClaim === undefined) {
        throw corruptionError(anchor.scopeId, "executionClaimInvalid");
      }
      return Object.freeze({
        status: "created",
        anchor: capturedAnchor,
        executionClaim: Object.freeze({ ...executionClaim }),
      } satisfies PointMutationSessionActivationResultV1);
    case "busy":
      return Object.freeze({
        status: "busy",
        anchor: capturedAnchor,
      } satisfies PointMutationSessionActivationResultV1);
  }
}

export function captureSessionAnchor(
  anchor: PointMutationSessionAnchorV1,
): PointMutationSessionAnchorV1 {
  return Object.freeze({
    ...anchor,
    snapshotToken: Object.freeze(
      SnapshotTokenSchema.make({
        scopeId: anchor.snapshotToken.scopeId,
        epoch: anchor.snapshotToken.epoch,
        commitSeq: anchor.snapshotToken.commitSeq,
      }),
    ),
  } satisfies PointMutationSessionAnchorV1);
}

export function cloneValidDate(value: Date): Date {
  const cloned = copyFiniteDate(value);
  if (cloned === undefined) {
    throw new PointMutationSessionActivationV1Error({
      reason: "invalidPreparedEvidence",
    });
  }
  return cloned;
}

function cloneJsonObject(value: JsonObject): JsonObject {
  const result: Record<string, Json> = {};
  for (const key of Object.keys(value)) {
    const child = value[key];
    if (child === undefined) {
      throw new Error(`Missing JSON object value for key ${key}.`);
    }
    Object.defineProperty(result, key, {
      configurable: false,
      enumerable: true,
      value: cloneJson(child),
      writable: false,
    });
  }
  return Object.freeze(result);
}

function cloneJson(value: Json): Json {
  if (isJsonArray(value)) {
    return Object.freeze(value.map(cloneJson));
  }
  if (isJsonObject(value)) {
    return cloneJsonObject(value);
  }
  return value;
}
