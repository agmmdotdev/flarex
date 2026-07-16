import { Effect, Schema } from "effect";

import type { JsonObject } from "flarex-protocol/json";
import {
  CatalogSchemaVersionIdSchema,
  decodeSchemaManifestAppSchemaV1,
  type SchemaManifestAppSchemaV1,
} from "flarex-protocol/schema-manifest";
import {
  PointMutationTargetSelectionV1Error,
  PointMutationTargetFunctionMetadataV1Schema,
  requirePointMutationArgumentSemanticSizeV1,
  type PointMutationTargetFunctionMetadataV1,
} from "flarex-protocol/point-mutation-start";
import {
  ReplacementScopeIdV1Schema,
} from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
  transactionGrantIdentityAccessPolicySha256HexV1FromBytes,
  transactionGrantRequestSha256HexV1FromBytes,
  transactionGrantValidatedArgsSha256HexV1FromBytes,
} from "flarex-protocol/transaction-grant";
import {
  TransactionArtifactIdV1Schema,
  TransactionArtifactRuntimeV1Schema,
  TransactionArgumentsSha256V1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionExecutionModuleV1Schema,
  TransactionFunctionKindV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionPackageIdV1Schema,
  TransactionRequestKeyV1Schema,
  TransactionRequestSha256V1Schema,
  TransactionSourcePackageSha256HexV1Schema,
} from "flarex-protocol/transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  canonicalizeFlarexValueJsonV1,
  decodeFlarexValueCodecVersion,
  normalizeFlarexValueJsonV1,
} from "flarex-protocol/value";

import type {
  AuthenticatedStoredAttemptStateV1,
  StoredAttemptSessionScalarsPortV1,
} from "../storedAttemptAuthentication";
import type {
  TransactionGrantVerificationKernelV1,
  VerifiedTransactionGrantInspectionV1,
} from "../transactionGrantVerificationKernel";
import {
  StoredCommitAuthorityCorruptionV1Error,
  StoredCommitAuthorityMismatchV1Error,
  StoredCommitAuthorityNotPlannableV1Error,
  type PinnedPointMutationFunctionMetadataSelectorV1,
  type StoredCommitAuthorityCorruptionReasonV1,
  type StoredCommitAuthorityEvidenceLoadResultPortV1,
  type StoredCommitAuthorityEvidencePortV1,
  type StoredCommitAuthoritySchemaEvidencePortV1,
  type StoredCommitAuthoritySessionEvidencePortV1,
} from "./commitAuthorityModel";
import {
  bytesEqual,
  canonicalJson,
  detachVerifiedGrant,
  isJsonObject,
} from "./canonicalEvidence";

const StrictStructOptions: {
  readonly parseOptions: { readonly onExcessProperty: "error" };
} = { parseOptions: { onExcessProperty: "error" } };

const PinnedPointMutationFunctionMetadataSnapshotV1Schema = Schema.Struct({
  deploymentId: TransactionGrantDeploymentIdV1Schema,
  scopeId: ReplacementScopeIdV1Schema,
  packageId: TransactionPackageIdV1Schema,
  artifactRuntime: TransactionArtifactRuntimeV1Schema,
  artifactId: TransactionArtifactIdV1Schema,
  sourcePackageHash: TransactionSourcePackageSha256HexV1Schema,
  executionModule: TransactionExecutionModuleV1Schema,
  functionPath: TransactionFunctionPathV1Schema,
  functionKind: TransactionFunctionKindV1Schema,
  schemaVersionId: CatalogSchemaVersionIdSchema,
  functionMetadata: PointMutationTargetFunctionMetadataV1Schema,
}).annotate(StrictStructOptions);

type PinnedPointMutationFunctionMetadataSnapshotV1 =
  typeof PinnedPointMutationFunctionMetadataSnapshotV1Schema.Type;

const decodePinnedPointMutationFunctionMetadataSnapshotV1 =
  Schema.decodeUnknownSync(PinnedPointMutationFunctionMetadataSnapshotV1Schema, {
    onExcessProperty: "error",
  });

export interface VerifiedCommitAuthorityEvidenceV1 {
  readonly databaseNowMilliseconds: number;
  readonly argumentsJson: JsonObject;
  readonly argumentArraySemanticBytes: number;
  readonly verifiedGrant: VerifiedTransactionGrantInspectionV1;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
  readonly stableBindings: StoredCommitAuthoritySchemaEvidencePortV1[
    "stableBindings"
  ];
}

export const requireLoadedCommitAuthorityEvidenceEffect = Effect.fn(
  "StoredAttemptAuthentication.requireLoadedCommitAuthorityEvidence",
)(function* (result: StoredCommitAuthorityEvidenceLoadResultPortV1) {
  switch (result.kind) {
    case "loaded":
      return result.evidence;
    case "notPlannable":
      return yield* Effect.fail(
        new StoredCommitAuthorityNotPlannableV1Error({
          reason: result.reason,
        }),
      );
    case "authorityMismatch":
      return yield* Effect.fail(new StoredCommitAuthorityMismatchV1Error({
        reason: result.reason,
      }));
    case "corrupt":
      return yield* Effect.fail(new StoredCommitAuthorityCorruptionV1Error({
        reason: result.reason,
        ...(result.cause === undefined ? {} : { cause: result.cause }),
      }));
  }
});

export const verifyCommitAuthorityEvidenceEffect = Effect.fn(
  "StoredAttemptAuthentication.verifyCommitAuthorityEvidence",
)(function* (
  storedAttempt: AuthenticatedStoredAttemptStateV1,
  evidence: StoredCommitAuthorityEvidencePortV1,
  grantKernel: TransactionGrantVerificationKernelV1,
) {
  if (
    evidence.currentAuthorizationRevocationEpoch !==
      storedAttempt.session.authorizationRevocationEpoch
  ) {
    return yield* commitAuthorityMismatchEffect(
      "revocationEpochChanged",
    );
  }
  if (!sameStoredSessionScalars(evidence.session, storedAttempt.session)) {
    return yield* commitAuthorityMismatchEffect("sealChanged");
  }

  const normalizedArguments = yield* Effect.try({
    try: () => normalizeFlarexValueJsonV1(evidence.session.validatedArgsJson),
    catch: (cause) => commitAuthorityCorruption(
      "validatedArgumentsInvalid",
      cause,
    ),
  });
  if (!isJsonObject(normalizedArguments.valueJson)) {
    return yield* commitAuthorityCorruptionEffect(
      "validatedArgumentsInvalid",
    );
  }
  const argumentArraySemanticBytes = yield* Effect.try({
    try: () => requirePointMutationArgumentSemanticSizeV1(
      normalizedArguments.semanticSizeBytes,
    ),
    catch: (cause) =>
      cause instanceof PointMutationTargetSelectionV1Error
        ? cause
        : commitAuthorityCorruption("validatedArgumentsInvalid", cause),
  });
  const canonicalArguments = yield* Effect.tryPromise({
    try: () => canonicalizeFlarexValueJsonV1(
      normalizedArguments.valueJson,
    ),
    catch: (cause) => commitAuthorityCorruption(
      "validatedArgumentsInvalid",
      cause,
    ),
  });
  if (
    evidence.session.validatedArgsValueCodecVersion !==
      FLAREX_VALUE_CODEC_VERSION_V1 ||
    evidence.session.validatedArgsCanonicalByteLength !==
      canonicalArguments.canonicalBytes.byteLength ||
    !bytesEqual(
      evidence.session.validatedArgsCanonicalBytes,
      canonicalArguments.canonicalBytes,
    ) ||
    !bytesEqual(
      evidence.session.validatedArgsSha256,
      canonicalArguments.sha256,
    )
  ) {
    return yield* commitAuthorityCorruptionEffect(
      "validatedArgumentsInvalid",
    );
  }

  const expectedLogicalPins = yield* Effect.try({
    try: () => buildExpectedTransactionGrantPins(storedAttempt),
    catch: (cause) => commitAuthorityCorruption(
      "sessionEvidenceInvalid",
      cause,
    ),
  });
  const verifiedGrant = yield* grantKernel.verify({
    jws: evidence.session.authorizationGrantJson,
    expectedLogicalPins,
    trustedNowEpochMilliseconds: Effect.succeed(
      evidence.databaseNowMilliseconds,
    ),
  });
  if (!sameStoredGrantEvidence(evidence.session, verifiedGrant)) {
    return yield* commitAuthorityCorruptionEffect(
      "authorizationGrantInvalid",
    );
  }

  if (
    evidence.schema.deploymentId !== storedAttempt.authority.deploymentId ||
    evidence.schema.schemaVersionId !==
      storedAttempt.authority.schemaVersionId
  ) {
    return yield* commitAuthorityMismatchEffect("schemaChanged");
  }
  const schemaManifest = yield* Effect.try({
    try: () => decodeSchemaManifestAppSchemaV1(evidence.schema.manifest),
    catch: (cause) => commitAuthorityCorruption(
      "schemaArtifactInvalid",
      cause,
    ),
  });
  if (!bindingsMatchManifest(schemaManifest, evidence.schema.stableBindings)) {
    return yield* commitAuthorityCorruptionEffect("stableBindingMismatch");
  }

  return Object.freeze({
    databaseNowMilliseconds: evidence.databaseNowMilliseconds,
    argumentsJson: Object.freeze(
      structuredClone(normalizedArguments.valueJson),
    ),
    argumentArraySemanticBytes,
    verifiedGrant: detachVerifiedGrant(verifiedGrant),
    schemaManifest: Object.freeze(structuredClone(schemaManifest)),
    stableBindings: Object.freeze(
      structuredClone(evidence.schema.stableBindings),
    ),
  } satisfies VerifiedCommitAuthorityEvidenceV1);
});

export const verifyPinnedFunctionMetadataEffect = Effect.fn(
  "StoredAttemptAuthentication.verifyPinnedFunctionMetadata",
)(function* (
  storedAttempt: AuthenticatedStoredAttemptStateV1,
  input: unknown | null,
) {
  if (input === null) {
    return yield* commitAuthorityCorruptionEffect("functionMetadataMissing");
  }
  const snapshot = yield* Effect.try({
    try: () => decodePinnedPointMutationFunctionMetadataSnapshotV1(input),
    catch: (cause) => commitAuthorityCorruption(
      "functionMetadataInvalid",
      cause,
    ),
  });
  const expected = capturePinnedFunctionSelector(storedAttempt);
  if (
    snapshot.deploymentId !== expected.deploymentId ||
    snapshot.scopeId !== expected.scopeId ||
    snapshot.packageId !== expected.packageId ||
    snapshot.artifactRuntime !== expected.artifactRuntime ||
    snapshot.artifactId !== expected.artifactId ||
    snapshot.sourcePackageHash !== expected.sourcePackageHash ||
    snapshot.executionModule !== expected.executionModule ||
    snapshot.functionPath !== expected.functionPath ||
    snapshot.functionKind !== expected.functionKind ||
    snapshot.schemaVersionId !== expected.schemaVersionId ||
    snapshot.functionMetadata.path !== expected.functionPath ||
    snapshot.functionMetadata.executionModule !== expected.executionModule ||
    snapshot.functionMetadata.kind !== "mutation" ||
    snapshot.functionMetadata.visibility !== "public"
  ) {
    return yield* commitAuthorityCorruptionEffect("functionMetadataInvalid");
  }
  return Object.freeze(
    structuredClone(snapshot.functionMetadata),
  ) satisfies PointMutationTargetFunctionMetadataV1;
});

export function capturePinnedFunctionSelector(
  state: AuthenticatedStoredAttemptStateV1,
): PinnedPointMutationFunctionMetadataSelectorV1 {
  return Object.freeze({
    deploymentId: state.authority.deploymentId,
    scopeId: state.authority.scopeId,
    packageId: state.session.packageId,
    artifactRuntime: state.session.artifactRuntime,
    artifactId: state.session.artifactId,
    sourcePackageHash: state.session.sourcePackageHash,
    executionModule: state.session.executionModule,
    functionPath: state.session.functionPath,
    functionKind: "mutation",
    schemaVersionId: state.authority.schemaVersionId,
  });
}

function buildExpectedTransactionGrantPins(
  state: AuthenticatedStoredAttemptStateV1,
) {
  const session = state.session;
  return Object.freeze({
    deploymentId: state.authority.deploymentId,
    scopeId: state.authority.scopeId,
    packageId: TransactionPackageIdV1Schema.make(session.packageId),
    artifactRuntime: Schema.decodeUnknownSync(
      TransactionArtifactRuntimeV1Schema,
    )(session.artifactRuntime),
    artifactId: TransactionArtifactIdV1Schema.make(session.artifactId),
    sourcePackageHash: TransactionSourcePackageSha256HexV1Schema.make(
      session.sourcePackageHash,
    ),
    executionModule: TransactionExecutionModuleV1Schema.make(
      session.executionModule,
    ),
    functionPath: TransactionFunctionPathV1Schema.make(session.functionPath),
    functionKind: Schema.decodeUnknownSync(
      TransactionFunctionKindV1Schema,
    )(session.functionKind),
    schemaVersionId: CatalogSchemaVersionIdSchema.make(
      session.schemaVersionId,
    ),
    validatedArgsValueCodecVersion: decodeFlarexValueCodecVersion(
      session.validatedArgsValueCodecVersion,
    ),
    validatedArgsSha256:
      transactionGrantValidatedArgsSha256HexV1FromBytes(
        Schema.decodeUnknownSync(TransactionArgumentsSha256V1Schema)(
          session.validatedArgsSha256,
        ),
      ),
    requestKey: TransactionRequestKeyV1Schema.make(session.requestKey),
    requestSha256: transactionGrantRequestSha256HexV1FromBytes(
      Schema.decodeUnknownSync(TransactionRequestSha256V1Schema)(
        session.requestSha256,
      ),
    ),
    authorizationRevocationEpoch:
      TransactionAuthorizationRevocationEpochSchema.make(
        session.authorizationRevocationEpoch,
      ),
  });
}

function sameStoredGrantEvidence(
  session: StoredCommitAuthoritySessionEvidencePortV1,
  verified: VerifiedTransactionGrantInspectionV1,
): boolean {
  const grant = verified.evidence;
  return session.authorizationGrantId === grant.authorizationGrantId &&
    session.authorizationGrantValueCodecVersion ===
      grant.authorizationGrantValueCodecVersion &&
    session.authorizationGrantCanonicalByteLength ===
      grant.authorizationGrantCanonicalBytes.byteLength &&
    canonicalCommitAuthorityJson(session.authorizationGrantJson) ===
      canonicalCommitAuthorityJson(grant.authorizationGrantJson) &&
    bytesEqual(
      session.authorizationGrantCanonicalBytes,
      grant.authorizationGrantCanonicalBytes,
    ) &&
    bytesEqual(
      session.authorizationGrantSha256,
      grant.authorizationGrantSha256,
    ) &&
    session.authorizationGrantExpiresAtMilliseconds ===
      Date.parse(grant.authorizationGrantExpiresAt) &&
    session.policyVersion === grant.payload.policyVersion &&
    transactionGrantIdentityAccessPolicySha256HexV1FromBytes(
      Schema.decodeUnknownSync(
        TransactionIdentityAccessPolicySha256V1Schema,
      )(session.identityAccessPolicySha256),
    ) === grant.payload.identityAccessPolicySha256;
}

function sameStoredSessionScalars(
  actual: StoredCommitAuthoritySessionEvidencePortV1,
  expected: StoredAttemptSessionScalarsPortV1,
): boolean {
  const scalarFields = [
    "lifecycle",
    "storageGeneration",
    "storageGenerationFence",
    "packageId",
    "artifactRuntime",
    "artifactId",
    "sourcePackageHash",
    "executionModule",
    "functionPath",
    "functionKind",
    "schemaVersionId",
    "policyVersion",
    "validatedArgsValueCodecVersion",
    "validatedArgsCanonicalByteLength",
    "authorizationGrantId",
    "authorizationGrantValueCodecVersion",
    "authorizationGrantCanonicalByteLength",
    "authorizationRevocationEpoch",
    "authorizationGrantExpiresAtMilliseconds",
    "requestKey",
    "protocolVersion",
    "hardExpiresAtMilliseconds",
    "createdAtMilliseconds",
    "updatedAtMilliseconds",
  ] as const;
  return scalarFields.every((field) => actual[field] === expected[field]) &&
    bytesEqual(
      actual.identityAccessPolicySha256,
      expected.identityAccessPolicySha256,
    ) &&
    bytesEqual(actual.validatedArgsSha256, expected.validatedArgsSha256) &&
    bytesEqual(
      actual.authorizationGrantSha256,
      expected.authorizationGrantSha256,
    ) &&
    bytesEqual(actual.requestSha256, expected.requestSha256);
}

function bindingsMatchManifest(
  manifest: SchemaManifestAppSchemaV1,
  bindings: StoredCommitAuthoritySchemaEvidencePortV1["stableBindings"],
): boolean {
  const tables = manifest.tableDefinitions.tables;
  return bindings.length === tables.length &&
    tables.every((table, index) => {
      const binding = bindings[index];
      return binding !== undefined &&
        binding.logicalName === table.logicalName &&
        binding.tableId === table.tableId;
    });
}

function canonicalCommitAuthorityJson(value: JsonObject): string {
  return canonicalJson(value, () => {
    throw commitAuthorityCorruption("authorizationGrantInvalid");
  });
}

function commitAuthorityCorruption(
  reason: StoredCommitAuthorityCorruptionReasonV1,
  cause?: unknown,
): StoredCommitAuthorityCorruptionV1Error {
  return new StoredCommitAuthorityCorruptionV1Error({
    reason,
    ...(cause === undefined ? {} : { cause }),
  });
}

function commitAuthorityCorruptionEffect(
  reason: StoredCommitAuthorityCorruptionReasonV1,
) {
  return Effect.fail(commitAuthorityCorruption(reason));
}

function commitAuthorityMismatchEffect(
  reason: StoredCommitAuthorityMismatchV1Error["reason"],
) {
  return Effect.fail(new StoredCommitAuthorityMismatchV1Error({ reason }));
}
