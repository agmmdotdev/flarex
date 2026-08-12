import {
  bytesEqualFullScan as bytesEqual,
  copyBytes,
} from "@flarex/utils/bytes";
import { isPositiveSafeInteger } from "@flarex/utils/numbers";
import { Result, Schema } from "effect";

import {
  PointCommitCorruptionV1Error,
  type PointCommitAttemptScalarCommandV1,
  type PointCommitAuthorityPinsV1,
  type PointCommitDependencyV1,
  type PointCommitFinishingTransitionCommandV1,
  type PointCommitFinishingTransitionResultV1,
  type PointCommitConflictEvidenceV1,
  type PointCommitPublicationCommandV1,
  type PointCommitRowIntentV1,
  type PointCommitSealIdentityV1,
  type PointCommitSuccessfulResultV1,
  type PointCommitTransactionCommandV1,
  type PointMutationAttemptReplacementCommandV1,
} from "@flarex/persistence-postgres/point-commit-transaction";
import type { PointMutationSessionAttemptSelectorV1 } from
  "@flarex/persistence-postgres/transaction-session-activation";
import {
  CanonicalSuccessfulResultBytesV1Schema,
} from "flarex-protocol/commit-protocol";
import { jsonEqual } from "flarex-protocol/json";
import { CatalogSchemaVersionIdSchema } from
  "flarex-protocol/schema-manifest";
import {
  ReplacementScopeIdV1Schema,
} from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  TransactionArtifactIdV1Schema,
  TransactionArtifactRuntimeV1Schema,
  TransactionAuthorizationGrantIdV1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionExecutionModuleV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionPackageIdV1Schema,
  TransactionPolicyVersionV1Schema,
  TransactionRequestKeyV1Schema,
  TransactionSourcePackageSha256HexV1Schema,
  storedTransactionSessionScalarsEqualV1,
} from "flarex-protocol/transaction-session";
import {
  flarexValueToJsonV1,
  normalizeFlarexValueV1,
} from "flarex-protocol/value";

import { dependenciesEqual } from "./authenticationVerification";
import type {
  PointCommitScalarProvenanceV1,
  PreparedPointCommitCapabilityStateV1,
} from "./capabilityState";
import type {
  PreparedPointCommitStateV1,
} from "./pointCommitPlanning";

const decodeTransactionArtifactRuntimeV1 = Schema.decodeUnknownSync(
  TransactionArtifactRuntimeV1Schema,
);

export function rebaseFinishingPreparedPointCommitState(
  state: PreparedPointCommitCapabilityStateV1,
  result: PointCommitFinishingTransitionResultV1,
): Result.Result<
  PreparedPointCommitCapabilityStateV1,
  PointCommitCorruptionV1Error
> {
  const session = state.provenance.session;
  const seal = state.plan.sealIdentity;
  const pins = state.plan.authorityPins;
  if (
    (result.kind !== "transitioned" && result.kind !== "observed") ||
    result.scopeUuid !== seal.scopeUuid ||
    result.sessionId !== pins.sessionId ||
    result.attemptFence !== pins.attemptFence ||
    result.priorSessionUpdatedAtMilliseconds !==
      session.updatedAtMilliseconds ||
    !isPositiveSafeInteger(result.finishingSessionUpdatedAtMilliseconds) ||
    result.finishingSessionUpdatedAtMilliseconds <
      result.priorSessionUpdatedAtMilliseconds ||
    result.finishingSessionUpdatedAtMilliseconds >=
      session.authorizationGrantExpiresAtMilliseconds ||
    result.finishingSessionUpdatedAtMilliseconds >=
      session.hardExpiresAtMilliseconds ||
    result.finishingSessionUpdatedAtMilliseconds >=
      seal.leaseExpiresAtMilliseconds ||
    session.lifecycle !== "running" ||
    seal.lifecycle !== "running" ||
    seal.sessionUpdatedAtMilliseconds !== session.updatedAtMilliseconds
  ) {
    return Result.fail(new PointCommitCorruptionV1Error({
      reason: "finishingTransitionInvalid",
    }));
  }
  const finishingUpdatedAtMilliseconds =
    result.finishingSessionUpdatedAtMilliseconds;
  const provenance = Object.freeze({
    authority: Object.freeze({
      ...state.provenance.authority,
      snapshotToken: Object.freeze({
        ...state.provenance.authority.snapshotToken,
      }),
    }),
    session: Object.freeze({
      ...session,
      lifecycle: "finishing" as const,
      updatedAtMilliseconds: finishingUpdatedAtMilliseconds,
      identityAccessPolicySha256:
        copyBytes(session.identityAccessPolicySha256),
      validatedArgsSha256: copyBytes(session.validatedArgsSha256),
      authorizationGrantSha256:
        copyBytes(session.authorizationGrantSha256),
      requestSha256: copyBytes(session.requestSha256),
    }),
    executionClaim: null,
  } satisfies PointCommitScalarProvenanceV1);
  const dependencies = Object.freeze(state.plan.dependencies.map(
    (dependency) => Object.freeze({
      documentId: dependency.documentId,
      tableId: dependency.tableId,
      rowId: dependency.rowId,
      dependency: Object.freeze(structuredClone(dependency.dependency)),
    }),
  ));
  const indexRangeDependencies = capturePointCommitIndexRangeDependencies(state);
  const rowIntents = Object.freeze(
    state.plan.rowIntents.map(capturePreparedPointRowIntent),
  );
  const successfulResult = state.plan.successfulResult;
  const plan = Object.freeze({
    authorityPins: Object.freeze({
      ...pins,
      snapshotToken: Object.freeze({ ...pins.snapshotToken }),
    }),
    sealIdentity: Object.freeze({
      ...seal,
      lifecycle: "finishing" as const,
      sessionUpdatedAtMilliseconds: finishingUpdatedAtMilliseconds,
      journalSha256: copyBytes(seal.journalSha256),
      resultSha256: copyBytes(seal.resultSha256),
    }),
    dependencies,
    indexRangeDependencies,
    rowIntents,
    successfulResult: Object.freeze({
      valueCodecVersion: successfulResult.valueCodecVersion,
      value: structuredClone(successfulResult.value),
      canonicalBytes: CanonicalSuccessfulResultBytesV1Schema.make(
        copyBytes(successfulResult.canonicalBytes),
      ),
      semanticSizeBytes: successfulResult.semanticSizeBytes,
      sha256Hex: successfulResult.sha256Hex,
    }),
  } satisfies PreparedPointCommitStateV1);
  return Result.succeed(Object.freeze({
    plan,
    provenance,
    executionAuthority: state.executionAuthority,
  }));
}

export function capturePointCommitFinishingTransitionCommand(
  state: PreparedPointCommitCapabilityStateV1,
): PointCommitFinishingTransitionCommandV1 {
  const scalar = capturePointCommitAttemptScalarCommand(state);
  if (
    scalar.session.lifecycle !== "running" ||
    scalar.sealIdentity.lifecycle !== "running"
  ) {
    throw new Error("C05-A requires running prepared point-commit authority.");
  }
  const executionClaim = state.provenance.authority.executionClaim;
  if (executionClaim === undefined) {
    throw new Error("C05-A execution claim is unavailable.");
  }
  return Object.freeze({
    authorityPins: scalar.authorityPins,
    session: Object.freeze({
      ...scalar.session,
      lifecycle: "running" as const,
    }),
    sealIdentity: Object.freeze({
      ...scalar.sealIdentity,
      lifecycle: "running" as const,
    }),
    executionClaim: Object.freeze({ ...executionClaim }),
  });
}

function capturePointCommitAttemptScalarCommand(
  state: PreparedPointCommitCapabilityStateV1,
): PointCommitAttemptScalarCommandV1 {
  const pins = state.plan.authorityPins;
  const session = state.provenance.session;
  const seal = state.plan.sealIdentity;
  if (pins.executionAuthorityGeneration !== session.executionAuthorityGeneration) {
    throw new Error("Point commit execution authority generations differ.");
  }
  return Object.freeze({
    authorityPins: capturePointCommitAuthorityPins(pins),
    session: capturePointCommitSessionScalars(session),
    sealIdentity: Object.freeze({
      ...seal,
      journalSha256: copyBytes(seal.journalSha256),
      resultSha256: copyBytes(seal.resultSha256),
    }),
  } satisfies PointCommitAttemptScalarCommandV1);
}

function capturePointCommitAuthorityPins(
  pins: PreparedPointCommitCapabilityStateV1["plan"]["authorityPins"],
): PointCommitAuthorityPinsV1 {
  const common = {
    deploymentId: TransactionGrantDeploymentIdV1Schema.make(pins.deploymentId),
    scopeId: ReplacementScopeIdV1Schema.make(pins.scopeId),
    sessionId: pins.sessionId,
    attemptFence: pins.attemptFence,
    storageGeneration: pins.storageGeneration,
    storageGenerationFence: pins.storageGenerationFence,
    snapshotToken: Object.freeze({ ...pins.snapshotToken }),
    schemaVersionId: CatalogSchemaVersionIdSchema.make(pins.schemaVersionId),
    functionPath: TransactionFunctionPathV1Schema.make(pins.functionPath),
    functionKind: pins.functionKind,
    policyVersion: TransactionPolicyVersionV1Schema.make(pins.policyVersion),
    authorizationRevocationEpoch:
      TransactionAuthorizationRevocationEpochSchema.make(
        pins.authorizationRevocationEpoch,
      ),
    requestKey: TransactionRequestKeyV1Schema.make(pins.requestKey),
  } as const;
  if (pins.executionAuthorityGeneration === "application_v1") {
    return Object.freeze({
      ...common,
      executionAuthorityGeneration: "application_v1" as const,
      applicationExecutionAuthoritySha256: copyBytes(
        pins.applicationExecutionAuthoritySha256,
      ),
    });
  }
  return Object.freeze({
    ...common,
    executionAuthorityGeneration: "legacy_dynamic_worker_v1" as const,
    packageId: TransactionPackageIdV1Schema.make(pins.packageId),
    artifactRuntime: decodeTransactionArtifactRuntimeV1(pins.artifactRuntime),
    artifactId: TransactionArtifactIdV1Schema.make(pins.artifactId),
    sourcePackageHash: TransactionSourcePackageSha256HexV1Schema.make(
      pins.sourcePackageHash,
    ),
    executionModule: TransactionExecutionModuleV1Schema.make(
      pins.executionModule,
    ),
  });
}

function capturePointCommitSessionScalars(
  session: PreparedPointCommitCapabilityStateV1["provenance"]["session"],
): PointCommitAttemptScalarCommandV1["session"] {
  if (session.executionAuthorityGeneration === "application_v1") {
    return Object.freeze({
      ...session,
      executionAuthorityGeneration: "application_v1" as const,
      authorizationGrantId: TransactionAuthorizationGrantIdV1Schema.make(
        session.authorizationGrantId,
      ),
      identityAccessPolicySha256: copyBytes(session.identityAccessPolicySha256),
      validatedArgsSha256: copyBytes(session.validatedArgsSha256),
      authorizationGrantSha256: copyBytes(session.authorizationGrantSha256),
      requestSha256: copyBytes(session.requestSha256),
      // Stored-attempt authentication already owns and recursively freezes
      // this canonical JSON graph. Preserve that authenticated snapshot by
      // identity instead of cloning it back into a shallow-mutable graph.
      applicationExecutionAuthorityJson:
        session.applicationExecutionAuthorityJson,
      applicationExecutionAuthorityCanonicalBytes: copyBytes(
        session.applicationExecutionAuthorityCanonicalBytes,
      ),
      applicationExecutionAuthoritySha256: copyBytes(
        session.applicationExecutionAuthoritySha256,
      ),
    });
  }
  return Object.freeze({
    ...session,
    executionAuthorityGeneration: "legacy_dynamic_worker_v1" as const,
    authorizationGrantId: TransactionAuthorizationGrantIdV1Schema.make(
      session.authorizationGrantId,
    ),
    identityAccessPolicySha256: copyBytes(session.identityAccessPolicySha256),
    validatedArgsSha256: copyBytes(session.validatedArgsSha256),
    authorizationGrantSha256: copyBytes(session.authorizationGrantSha256),
    requestSha256: copyBytes(session.requestSha256),
  });
}

export function capturePointCommitTransactionCommand(
  state: PreparedPointCommitCapabilityStateV1,
): PointCommitTransactionCommandV1 {
  const scalar = capturePointCommitAttemptScalarCommand(state);
  const dependencies = capturePointCommitDependencies(state);
  const rowIntents = Object.freeze(
    state.plan.rowIntents.map(capturePointCommitRowIntent),
  );
  return Object.freeze({
    ...scalar,
    dependencies,
    indexRangeDependencies: capturePointCommitIndexRangeDependencies(state),
    rowIntents,
  } satisfies PointCommitTransactionCommandV1);
}

export function capturePointMutationAttemptReplacementCommand(
  state: PreparedPointCommitCapabilityStateV1,
  expectedConflict: PointCommitConflictEvidenceV1,
): PointMutationAttemptReplacementCommandV1 {
  return Object.freeze({
    ...capturePointCommitAttemptScalarCommand(state),
    dependencies: capturePointCommitDependencies(state),
    indexRangeDependencies: capturePointCommitIndexRangeDependencies(state),
    expectedConflict: capturePointCommitConflictEvidence(expectedConflict),
  });
}

function capturePointCommitConflictEvidence(
  evidence: PointCommitConflictEvidenceV1,
): PointCommitConflictEvidenceV1 {
  const conflict = evidence.conflict.kind === "appRowPoint"
    ? Object.freeze({
        kind: "appRowPoint" as const,
        documentId: evidence.conflict.documentId,
      })
    : Object.freeze({
        kind: "appIndexRange" as const,
        reason: evidence.conflict.reason,
        dependencyOrdinal: evidence.conflict.dependencyOrdinal,
        tableId: evidence.conflict.tableId,
        indexDefinitionId: evidence.conflict.indexDefinitionId,
        ...(evidence.conflict.encodedKey === undefined
          ? {}
          : { encodedKey: evidence.conflict.encodedKey }),
        ...(evidence.conflict.rowId === undefined
          ? {}
          : { rowId: evidence.conflict.rowId }),
      });
  return Object.freeze({
    conflict,
    snapshotCommitSeq: evidence.snapshotCommitSeq,
    currentCommitSeq: evidence.currentCommitSeq,
  });
}

function capturePointCommitIndexRangeDependencies(
  state: PreparedPointCommitCapabilityStateV1,
): PointCommitTransactionCommandV1["indexRangeDependencies"] {
  return Object.freeze(state.plan.indexRangeDependencies.map((dependency) =>
    Object.freeze({
      ...dependency,
      lower: dependency.lower === null ? null : Object.freeze({ ...dependency.lower }),
      upper: dependency.upper === null ? null : Object.freeze({ ...dependency.upper }),
    })
  ));
}

function capturePointCommitDependencies(
  state: PreparedPointCommitCapabilityStateV1,
): PointCommitTransactionCommandV1["dependencies"] {
  return Object.freeze(state.plan.dependencies.map(
    (dependency) => Object.freeze({
      documentId: dependency.documentId,
      tableId: dependency.tableId,
      rowId: dependency.rowId,
      dependency: Object.freeze(structuredClone(dependency.dependency)),
    }),
  ));
}

export function capturePointCommitPublicationCommand(
  state: PreparedPointCommitCapabilityStateV1,
): PointCommitPublicationCommandV1 {
  const command = capturePointCommitTransactionCommand(state);
  const result = state.plan.successfulResult;
  const stableBytes = copyBytes(result.canonicalBytes);
  return Object.freeze({
    ...command,
    successfulResult: Object.freeze({
      valueCodecVersion: result.valueCodecVersion,
      value: structuredClone(result.value),
      get canonicalBytes(): PointCommitPublicationCommandV1[
        "successfulResult"
      ]["canonicalBytes"] {
        return CanonicalSuccessfulResultBytesV1Schema.make(
          copyBytes(stableBytes),
        );
      },
      semanticSizeBytes: result.semanticSizeBytes,
      sha256Hex: result.sha256Hex,
    }),
  } satisfies PointCommitPublicationCommandV1);
}

export function capturePointMutationSessionAttemptSelector(
  state: PreparedPointCommitCapabilityStateV1,
): PointMutationSessionAttemptSelectorV1 {
  const pins = state.plan.authorityPins;
  return Object.freeze({
    deploymentId: pins.deploymentId,
    scopeId: pins.scopeId,
    sessionId: pins.sessionId,
    attemptFence: pins.attemptFence,
  });
}

const POINT_COMMIT_AUTHORITY_PIN_SCALAR_FIELDS = [
  "deploymentId",
  "scopeId",
  "sessionId",
  "attemptFence",
  "storageGeneration",
  "storageGenerationFence",
  "schemaVersionId",
  "executionAuthorityGeneration",
  "functionPath",
  "functionKind",
  "policyVersion",
  "authorizationRevocationEpoch",
  "requestKey",
] as const satisfies ReadonlyArray<
  Exclude<keyof PointCommitAuthorityPinsV1, "snapshotToken">
>;

const POINT_COMMIT_SEAL_IDENTITY_SCALAR_FIELDS = [
  "scopeUuid",
  "lifecycle",
  "sessionUpdatedAtMilliseconds",
  "leaseExpiresAtMilliseconds",
  "rootCreatedAtMilliseconds",
  "rootUpdatedAtMilliseconds",
  "sealedAtMilliseconds",
  "finalSyscallSequence",
  "creationTimeSeed",
  "nextCreationTime",
  "journalFormat",
  "journalProtocolVersion",
  "journalValueCodecVersion",
  "journalByteLength",
  "resultValueCodecVersion",
  "resultSemanticBytes",
  "resultByteLength",
  "readDocuments",
  "readSemanticBytes",
  "pointDependencyCount",
  "indexedQuerySyscalls",
  "indexRangeDependencyCount",
  "indexRangeDependencyEvidenceBytes",
  "writeOperations",
  "writeSemanticBytes",
  "materialWriteEventEvidenceBytes",
] as const satisfies ReadonlyArray<
  Exclude<
    keyof PointCommitSealIdentityV1,
    "journalSha256" | "resultSha256"
  >
>;

export function pointCommitPublicationCommandsEqual(
  left: PointCommitPublicationCommandV1,
  right: PointCommitPublicationCommandV1,
): boolean {
  const commandFieldsAreExhaustive: Exclude<
    keyof PointCommitPublicationCommandV1,
    | "authorityPins"
    | "session"
    | "sealIdentity"
    | "dependencies"
    | "indexRangeDependencies"
    | "rowIntents"
    | "successfulResult"
  > extends never ? true : never = true;
  void commandFieldsAreExhaustive;
  if (!pointCommitAuthorityPinsEqual(
    left.authorityPins,
    right.authorityPins,
  )) return false;
  if (!storedTransactionSessionScalarsEqualV1(
    left.session,
    right.session,
  )) return false;
  if (!pointCommitSealIdentitiesEqual(
    left.sealIdentity,
    right.sealIdentity,
  )) return false;
  if (left.dependencies.length !== right.dependencies.length) return false;
  for (let index = 0; index < left.dependencies.length; index += 1) {
    const leftDependency = left.dependencies[index];
    const rightDependency = right.dependencies[index];
    if (
      leftDependency === undefined ||
      rightDependency === undefined ||
      !pointCommitDependenciesEqual(leftDependency, rightDependency)
    ) return false;
  }
  if (!indexRangeDependencyArraysEqual(
    left.indexRangeDependencies,
    right.indexRangeDependencies,
  )) return false;
  return pointCommitRowIntentsEqual(left.rowIntents, right.rowIntents) &&
    pointCommitSuccessfulResultsEqual(
      left.successfulResult,
      right.successfulResult,
    );
}

function indexRangeDependencyArraysEqual(
  left: PointCommitPublicationCommandV1["indexRangeDependencies"],
  right: PointCommitPublicationCommandV1["indexRangeDependencies"],
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftDependency = left[index];
    const rightDependency = right[index];
    if (leftDependency === undefined || rightDependency === undefined) {
      return false;
    }
    if (
      leftDependency.tableId !== rightDependency.tableId ||
      leftDependency.indexDefinitionId !== rightDependency.indexDefinitionId ||
      leftDependency.keyCodecVersion !== rightDependency.keyCodecVersion ||
      leftDependency.physicalSpecSha256Hex !==
        rightDependency.physicalSpecSha256Hex ||
      leftDependency.direction !== rightDependency.direction ||
      !indexRangeLowerBoundsEqual(leftDependency.lower, rightDependency.lower) ||
      !indexRangeUpperBoundsEqual(leftDependency.upper, rightDependency.upper)
    ) return false;
  }
  return true;
}

function indexRangeLowerBoundsEqual(
  left: PointCommitPublicationCommandV1["indexRangeDependencies"][number]["lower"],
  right: PointCommitPublicationCommandV1["indexRangeDependencies"][number]["lower"],
): boolean {
  return left === null
    ? right === null
    : right !== null && left.encodedKey === right.encodedKey;
}

function indexRangeUpperBoundsEqual(
  left: PointCommitPublicationCommandV1["indexRangeDependencies"][number]["upper"],
  right: PointCommitPublicationCommandV1["indexRangeDependencies"][number]["upper"],
): boolean {
  if (left === null) return right === null;
  if (right === null || left.kind !== right.kind) return false;
  if (left.encodedKey !== right.encodedKey) return false;
  return left.kind === "key" ||
    (right.kind === "position" && left.rowId === right.rowId);
}

function pointCommitAuthorityPinsEqual(
  left: PointCommitAuthorityPinsV1,
  right: PointCommitAuthorityPinsV1,
): boolean {
  const fieldsAreExhaustive: Exclude<
    keyof PointCommitAuthorityPinsV1,
    | typeof POINT_COMMIT_AUTHORITY_PIN_SCALAR_FIELDS[number]
    | "snapshotToken"
    | "packageId"
    | "artifactRuntime"
    | "artifactId"
    | "sourcePackageHash"
    | "executionModule"
    | "applicationExecutionAuthoritySha256"
  > extends never ? true : never = true;
  void fieldsAreExhaustive;
  for (const field of POINT_COMMIT_AUTHORITY_PIN_SCALAR_FIELDS) {
    if (left[field] !== right[field]) return false;
  }
  if (left.executionAuthorityGeneration !== right.executionAuthorityGeneration) {
    return false;
  }
  if (
    left.executionAuthorityGeneration === "legacy_dynamic_worker_v1" &&
    right.executionAuthorityGeneration === "legacy_dynamic_worker_v1" &&
    (left.packageId !== right.packageId ||
      left.artifactRuntime !== right.artifactRuntime ||
      left.artifactId !== right.artifactId ||
      left.sourcePackageHash !== right.sourcePackageHash ||
      left.executionModule !== right.executionModule)
  ) return false;
  if (
    left.executionAuthorityGeneration === "application_v1" &&
    right.executionAuthorityGeneration === "application_v1" &&
    !bytesEqual(
      left.applicationExecutionAuthoritySha256,
      right.applicationExecutionAuthoritySha256,
    )
  ) return false;
  return left.snapshotToken.scopeId === right.snapshotToken.scopeId &&
    left.snapshotToken.epoch === right.snapshotToken.epoch &&
    left.snapshotToken.commitSeq === right.snapshotToken.commitSeq;
}

function pointCommitSealIdentitiesEqual(
  left: PointCommitSealIdentityV1,
  right: PointCommitSealIdentityV1,
): boolean {
  const fieldsAreExhaustive: Exclude<
    keyof PointCommitSealIdentityV1,
    | typeof POINT_COMMIT_SEAL_IDENTITY_SCALAR_FIELDS[number]
    | "journalSha256"
    | "resultSha256"
  > extends never ? true : never = true;
  void fieldsAreExhaustive;
  for (const field of POINT_COMMIT_SEAL_IDENTITY_SCALAR_FIELDS) {
    if (left[field] !== right[field]) return false;
  }
  return bytesEqual(left.journalSha256, right.journalSha256) &&
    bytesEqual(left.resultSha256, right.resultSha256);
}

function pointCommitDependenciesEqual(
  left: PointCommitDependencyV1,
  right: PointCommitDependencyV1,
): boolean {
  const fieldsAreExhaustive: Exclude<
    keyof PointCommitDependencyV1,
    "documentId" | "tableId" | "rowId" | "dependency"
  > extends never ? true : never = true;
  void fieldsAreExhaustive;
  return left.documentId === right.documentId &&
    left.tableId === right.tableId &&
    left.rowId === right.rowId &&
    dependenciesEqual(left.dependency, right.dependency);
}

function pointCommitRowIntentsEqual(
  left: ReadonlyArray<PointCommitRowIntentV1>,
  right: ReadonlyArray<PointCommitRowIntentV1>,
): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    const leftIntent = left[index];
    const rightIntent = right[index];
    if (
      leftIntent === undefined ||
      rightIntent === undefined ||
      !pointCommitRowIntentEqual(leftIntent, rightIntent)
    ) return false;
  }
  return true;
}

function pointCommitRowIntentEqual(
  left: PointCommitRowIntentV1,
  right: PointCommitRowIntentV1,
): boolean {
  if (
    left.kind !== right.kind ||
    !pointCommitDependenciesEqual(left, right)
  ) return false;
  if (left.kind === "deleted" && right.kind === "deleted") return true;
  if (left.kind !== "live" || right.kind !== "live") return false;
  const liveFieldsAreExhaustive: Exclude<
    keyof Extract<PointCommitRowIntentV1, { readonly kind: "live" }>,
    | keyof PointCommitDependencyV1
    | "kind"
    | "creationTime"
    | "value"
    | "canonicalBytes"
    | "semanticSizeBytes"
  > extends never ? true : never = true;
  void liveFieldsAreExhaustive;
  return left.creationTime === right.creationTime &&
    left.semanticSizeBytes === right.semanticSizeBytes &&
    bytesEqual(left.canonicalBytes, right.canonicalBytes) &&
    jsonEqual(
      flarexValueToJsonV1(left.value, "appDocument"),
      flarexValueToJsonV1(right.value, "appDocument"),
    );
}

function capturePreparedPointRowIntent(
  source: PreparedPointCommitStateV1["rowIntents"][number],
): PreparedPointCommitStateV1["rowIntents"][number] {
  return source.kind === "deleted"
    ? Object.freeze({
        documentId: source.documentId,
        tableId: source.tableId,
        rowId: source.rowId,
        dependency: Object.freeze(structuredClone(source.dependency)),
        kind: "deleted" as const,
      })
    : Object.freeze({
        documentId: source.documentId,
        tableId: source.tableId,
        rowId: source.rowId,
        dependency: Object.freeze(structuredClone(source.dependency)),
        kind: "live" as const,
        creationTime: source.creationTime,
        value: normalizeFlarexValueV1(source.value, "appDocument").value,
        canonicalBytes: copyBytes(source.canonicalBytes),
        semanticSizeBytes: source.semanticSizeBytes,
      });
}

function capturePointCommitRowIntent(
  source: PreparedPointCommitStateV1["rowIntents"][number],
): PointCommitRowIntentV1 {
  return capturePreparedPointRowIntent(source);
}

function pointCommitSuccessfulResultsEqual(
  left: PointCommitSuccessfulResultV1,
  right: PointCommitSuccessfulResultV1,
): boolean {
  const fieldsAreExhaustive: Exclude<
    keyof PointCommitSuccessfulResultV1,
    | "valueCodecVersion"
    | "value"
    | "canonicalBytes"
    | "semanticSizeBytes"
    | "sha256Hex"
  > extends never ? true : never = true;
  void fieldsAreExhaustive;
  const leftCanonicalBytes = left.canonicalBytes;
  const rightCanonicalBytes = right.canonicalBytes;
  return left.valueCodecVersion === right.valueCodecVersion &&
    left.semanticSizeBytes === right.semanticSizeBytes &&
    left.sha256Hex === right.sha256Hex &&
    bytesEqual(leftCanonicalBytes, rightCanonicalBytes) &&
    jsonEqual(
      flarexValueToJsonV1(left.value),
      flarexValueToJsonV1(right.value),
    );
}
