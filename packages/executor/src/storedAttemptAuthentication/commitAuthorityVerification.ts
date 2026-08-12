import {
  bytesEqualFullScan as bytesEqual,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { Effect, Schema } from "effect";

import {
  encodeCanonicalJson,
  isJsonObject,
  type JsonObject,
} from "flarex-protocol/json";
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
  storedTransactionSessionScalarsEqualV1,
} from "flarex-protocol/transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  canonicalizeFlarexValueJsonV1,
  decodeFlarexValueCodecVersion,
  normalizeFlarexValueJsonV1,
} from "flarex-protocol/value";
import {
  inspectVerifiedApplicationMutationGrantV1,
  verifyApplicationMutationGrantV1,
  type ApplicationMutationGrantVerifierNamespaceV1,
  type InertApplicationMutationGrantEvidenceV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
  type ApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";

import type {
  StoredAttemptAuthorityStateV1,
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
import { detachVerifiedGrant } from "./verifiedGrantEvidence";

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

interface VerifiedCommitAuthorityCommonEvidenceV1 {
  readonly databaseNowMilliseconds: number;
  readonly argumentsJson: JsonObject;
  readonly argumentArraySemanticBytes: number;
  readonly schemaManifest: SchemaManifestAppSchemaV1;
  readonly stableBindings: StoredCommitAuthoritySchemaEvidencePortV1[
    "stableBindings"
  ];
}

type VerifiedCommitAuthorityGenerationEvidenceV1 =
  | Readonly<{
      readonly executionAuthorityGeneration: "legacy_dynamic_worker_v1";
      readonly verifiedGrant: VerifiedTransactionGrantInspectionV1;
    }>
  | Readonly<{
      readonly executionAuthorityGeneration: "application_v1";
      readonly verifiedGrant: InertApplicationMutationGrantEvidenceV1;
      readonly applicationAuthority: ApplicationMutationExecutionAuthorityV1;
    }>;

export type VerifiedCommitAuthorityEvidenceV1 =
  VerifiedCommitAuthorityCommonEvidenceV1 &
  VerifiedCommitAuthorityGenerationEvidenceV1;

/** Narrow verification input shared by sealed C04B1 and open O08-B2a. */
export interface CommitAuthorityVerificationStateV1 {
  readonly authority: StoredAttemptAuthorityStateV1;
  readonly session: StoredAttemptSessionScalarsPortV1;
}

type LegacyCommitAuthorityVerificationStateV1 = Readonly<{
  readonly authority: StoredAttemptAuthorityStateV1;
  readonly session: Extract<StoredAttemptSessionScalarsPortV1, {
    readonly executionAuthorityGeneration: "legacy_dynamic_worker_v1";
  }>;
}>;

export function isLegacyCommitAuthorityVerificationStateV1(
  state: CommitAuthorityVerificationStateV1,
): state is LegacyCommitAuthorityVerificationStateV1 {
  return state.session.executionAuthorityGeneration ===
    "legacy_dynamic_worker_v1";
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
  storedAttempt: CommitAuthorityVerificationStateV1,
  evidence: StoredCommitAuthorityEvidencePortV1,
  grantKernel: TransactionGrantVerificationKernelV1,
  applicationGrantVerifier?: ApplicationMutationGrantVerifierNamespaceV1,
) {
  if (
    evidence.currentAuthorizationRevocationEpoch !==
      storedAttempt.session.authorizationRevocationEpoch
  ) {
    return yield* commitAuthorityMismatchEffect(
      "revocationEpochChanged",
    );
  }
  if (!storedTransactionSessionScalarsEqualV1(
    evidence.session,
    storedAttempt.session,
  )) {
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

  let generationEvidence: VerifiedCommitAuthorityGenerationEvidenceV1;
  if (isLegacyCommitAuthorityVerificationStateV1(storedAttempt)) {
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
    generationEvidence = Object.freeze({
      executionAuthorityGeneration: "legacy_dynamic_worker_v1" as const,
      verifiedGrant: detachVerifiedGrant(verifiedGrant),
    });
  } else {
    if (applicationGrantVerifier === undefined) {
      return yield* commitAuthorityCorruptionEffect(
        "authorizationGrantInvalid",
      );
    }
    if (storedAttempt.session.executionAuthorityGeneration !== "application_v1") {
      return yield* commitAuthorityCorruptionEffect("sessionEvidenceInvalid");
    }
    const applicationSession = storedAttempt.session;
    const canonicalAuthority = yield*
      canonicalizeApplicationMutationExecutionAuthorityV1(
        applicationSession.applicationExecutionAuthorityJson,
      ).pipe(Effect.mapError(cause => commitAuthorityCorruption(
        "sessionEvidenceInvalid",
        cause,
      )));
    if (
      !bytesEqual(
        canonicalAuthority.canonicalBytes,
        applicationSession.applicationExecutionAuthorityCanonicalBytes,
      ) ||
      !bytesEqual(
        canonicalAuthority.sha256,
        applicationSession.applicationExecutionAuthoritySha256,
      )
    ) return yield* commitAuthorityCorruptionEffect("sessionEvidenceInvalid");
    const verifiedGrantHandle = yield* verifyApplicationMutationGrantV1(
      evidence.session.authorizationGrantJson,
      applicationGrantVerifier,
    ).pipe(Effect.mapError(cause => commitAuthorityCorruption(
      "authorizationGrantInvalid",
      cause,
    )));
    const verifiedGrant = yield* Effect.try({
      try: () => inspectVerifiedApplicationMutationGrantV1(verifiedGrantHandle),
      catch: cause => commitAuthorityCorruption(
        "authorizationGrantInvalid",
        cause,
      ),
    });
    if (
      !sameStoredApplicationGrantEvidence(evidence.session, verifiedGrant) ||
      !applicationGrantPinsMatch(
        storedAttempt,
        canonicalAuthority.authority,
        verifiedGrant,
      )
    ) return yield* commitAuthorityCorruptionEffect("authorizationGrantInvalid");
    generationEvidence = Object.freeze({
      executionAuthorityGeneration: "application_v1" as const,
      verifiedGrant,
      applicationAuthority: canonicalAuthority.authority,
    });
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
  const common = Object.freeze({
    databaseNowMilliseconds: evidence.databaseNowMilliseconds,
    argumentsJson: Object.freeze(
      structuredClone(normalizedArguments.valueJson),
    ),
    argumentArraySemanticBytes,
    schemaManifest: Object.freeze(structuredClone(schemaManifest)),
    stableBindings: Object.freeze(
      structuredClone(evidence.schema.stableBindings),
    ),
  }) satisfies VerifiedCommitAuthorityCommonEvidenceV1;
  return Object.freeze({
    ...common,
    ...generationEvidence,
  }) satisfies VerifiedCommitAuthorityEvidenceV1;
});

export const verifyPinnedFunctionMetadataEffect = Effect.fn(
  "StoredAttemptAuthentication.verifyPinnedFunctionMetadata",
)(function* (
  storedAttempt: CommitAuthorityVerificationStateV1,
  input: unknown | null,
) {
  if (!isLegacyCommitAuthorityVerificationStateV1(storedAttempt)) {
    return yield* commitAuthorityCorruptionEffect("sessionEvidenceInvalid");
  }
  const legacyStoredAttempt = Object.freeze({
    authority: storedAttempt.authority,
    session: storedAttempt.session,
  }) satisfies LegacyCommitAuthorityVerificationStateV1;
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
  const expected = capturePinnedFunctionSelector(legacyStoredAttempt);
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
  state: LegacyCommitAuthorityVerificationStateV1,
): PinnedPointMutationFunctionMetadataSelectorV1 {
  const session = state.session;
  return Object.freeze({
    deploymentId: state.authority.deploymentId,
    scopeId: state.authority.scopeId,
    packageId: session.packageId,
    artifactRuntime: session.artifactRuntime,
    artifactId: session.artifactId,
    sourcePackageHash: session.sourcePackageHash,
    executionModule: session.executionModule,
    functionPath: session.functionPath,
    functionKind: "mutation",
    schemaVersionId: state.authority.schemaVersionId,
  });
}

function buildExpectedTransactionGrantPins(
  state: LegacyCommitAuthorityVerificationStateV1,
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

function sameStoredApplicationGrantEvidence(
  session: StoredCommitAuthoritySessionEvidencePortV1,
  grant: InertApplicationMutationGrantEvidenceV1,
): boolean {
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
    bytesEqual(session.authorizationGrantSha256, grant.authorizationGrantSha256) &&
    session.authorizationGrantExpiresAtMilliseconds ===
      Date.parse(grant.authorizationGrantExpiresAt) &&
    session.policyVersion === grant.payload.policyVersion &&
    transactionGrantIdentityAccessPolicySha256HexV1FromBytes(
      Schema.decodeUnknownSync(TransactionIdentityAccessPolicySha256V1Schema)(
        session.identityAccessPolicySha256,
      ),
    ) === grant.payload.identityAccessPolicySha256;
}

function applicationGrantPinsMatch(
  storedAttempt: CommitAuthorityVerificationStateV1,
  authority: ApplicationMutationExecutionAuthorityV1,
  grant: InertApplicationMutationGrantEvidenceV1,
): boolean {
  if (storedAttempt.session.executionAuthorityGeneration !== "application_v1") {
    return false;
  }
  const session = storedAttempt.session;
  const payload = grant.payload;
  return payload.deploymentId === storedAttempt.authority.deploymentId &&
    payload.scopeId === storedAttempt.authority.scopeId &&
    payload.executionAuthoritySha256 === encodeBytesToLowercaseHex(
      session.applicationExecutionAuthoritySha256,
    ) &&
    payload.activationSequence === authority.activationSequence &&
    payload.activeHeadSha256 === authority.activeHeadSha256 &&
    payload.schemaVersionId === session.schemaVersionId &&
    authority.schemaVersionId === session.schemaVersionId &&
    authority.runtimeTarget.scopeId === storedAttempt.authority.scopeId &&
    authority.runtimeTarget.function.path === session.functionPath &&
    authority.runtimeTarget.function.kind === "mutation" &&
    authority.runtimeTarget.function.visibility === "public" &&
    payload.functionPath === session.functionPath &&
    payload.functionKind === "mutation" &&
    payload.policyVersion === session.policyVersion &&
    payload.validatedArgsValueCodecVersion ===
      session.validatedArgsValueCodecVersion &&
    payload.validatedArgsSha256 === encodeBytesToLowercaseHex(
      session.validatedArgsSha256,
    ) &&
    payload.requestKey === session.requestKey &&
    payload.requestSha256 === encodeBytesToLowercaseHex(session.requestSha256) &&
    payload.authorizationRevocationEpoch ===
      session.authorizationRevocationEpoch;
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
  return encodeCanonicalJson(value, () => {
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
