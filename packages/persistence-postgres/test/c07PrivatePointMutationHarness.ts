/// <reference types="@cloudflare/workers-types" />

import { decodeAppCreationTimeV1 } from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import {
  makeGrantRetentionPolicyV1Result,
} from "flarex-protocol/grant-retention-policy";
import {
  decodeActivePointMutationTargetMetadataV1,
  type ActivePointMutationTargetMetadataV1,
  type PointMutationTargetFunctionMetadataV1,
} from "flarex-protocol/point-mutation-start";
import {
  POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
  POINT_MUTATION_EXACT_RUNTIME_RESULT_VERSION_V1,
  type PointMutationExactRuntimeRequestV1,
} from "flarex-protocol/point-mutation-exact-runtime";
import {
  POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
  POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V1,
  type PointMutationExactRuntimeHostResponseV1,
} from "flarex-protocol/point-mutation-exact-runtime-host";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import {
  projectScopeIdUuidV1,
  type ReplacementScopeIdV1,
} from "flarex-protocol/storage-authority";
import {
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  TransactionGrantKeyIdV1Schema,
  canonicalizeTransactionGrantIdentityAccessPolicyV1,
  canonicalizeTransactionGrantPayloadV1,
  canonicalizeTransactionGrantProtectedHeaderV1,
  deriveInertTransactionGrantEvidenceV1,
  encodeTransactionGrantEd25519SignatureV1,
  transactionGrantIdentityAccessPolicySha256BytesV1FromHex,
  transactionGrantRequestSha256BytesV1FromHex,
  TransactionGrantDeploymentIdV1Schema,
  type TransactionGrantDeploymentIdV1,
} from "flarex-protocol/transaction-grant";
import {
  TransactionAuthorizationRevocationEpochSchema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
  type TransactionFunctionPathV1,
  type TransactionRequestKeyV1,
} from "flarex-protocol/transaction-session";
import {
  Effect,
  Result,
} from "effect";

import {
  createPointMutationSessionActivationV1,
  createPointMutationSessionAttemptLoadingV1,
  createPointMutationSessionAttemptTerminalizationV1,
  inspectActivatedPointMutationSessionV1,
} from "../../executor/src/pointMutationSessionActivation";
import {
  createExecutorPointMutationStartPreparationV1,
  inspectExecutorPreparedPointMutationStartV1,
} from "../../executor/src/pointMutationStartPreparation";
import { createPointMutationJournalV1 } from
  "../../executor/src/pointMutationJournal";
import {
  makePointMutationExactRuntimeBindingRunnerV1,
  type PointMutationExactRuntimeArtifactHostBindingV1,
} from "../../executor/src/pointMutationExactRuntimeBinding";
import {
  createPointMutationExecutionClaimVaultV1,
} from "../../executor/src/pointMutationExecutionClaim";
import {
  createPointMutationInitialExecutionV1,
  type PointMutationInitialExecutionV1Error,
  type PointMutationOccRuntimeNeutralRunnerV1,
} from "../../executor/src/storedAttemptAuthentication";
import {
  createPointMutationStartAdmissionV1,
  createTransactionGrantVerificationKeyNamespaceV1,
  createTransactionGrantVerifierV1,
} from "../../executor/src/transactionGrant";
import type { FlarexPersistence } from "../src";
import type { FlarexMetadataDatabase } from "../src/deployments";
import type { LocatedScopeClockReader } from
  "../src/scopeAuthorityResolution";
import {
  createSessionJournalStorePersistenceV1,
} from "../src/sessionJournalStore";
import {
  createStoredCommitAuthorityEvidenceLoaderV1,
} from "../src/storedCommitAuthorityEvidence";
import {
  createStoredOccExecutionEvidenceLoaderV1,
} from "../src/storedOccExecution";
import {
  createStoredAttemptEvidenceLoaderV1,
} from "../src/storedAttemptEvidence";
import {
  createPointMutationExecutionClaimLivenessV1,
} from "../src/transactionExecutionClaimLiveness";
import {
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../src/transactionSessionActivation";
import {
  createIntrinsicCreationTimeIndexDefinitionPortV1,
} from "../src/intrinsicCreationTimeIndexBuildV1";
import {
  RESOLVE_POINT_COMMIT_OUTCOME_V1,
  createPointCommitFinishingTransitionPortV1,
  createPointCommitPublisherPortV1,
  createPointMutationAttemptReplacementPortV1,
} from "../src/pointCommitTransaction";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";
import { issueSetupSeededSyscallValidatorProofV1 } from
  "./applicationRevisionSyscallValidatorTestSupport";
import {
  runEffect,
  runEffectFailure,
} from "./effectTestRuntime";

export interface C07SeedLiveRowV1 {
  readonly scopeId: ReplacementScopeIdV1;
  readonly schemaVersionId: ReturnType<
    typeof CatalogSchemaVersionIdSchema.make
  >;
  readonly tableId: ReturnType<typeof decodeCatalogTableId>;
  readonly rowId: ReturnType<typeof decodeAppRowIdHexV1>;
  readonly creationTime: number;
  readonly value: Readonly<Record<string, unknown>>;
}

export interface C07PrivatePointMutationLaneV1 {
  readonly name: "pglite" | "postgres";
  readonly persistence: FlarexPersistence;
  readonly controlDb: FlarexMetadataDatabase;
  readonly ensureScope: (
    deploymentId: TransactionGrantDeploymentIdV1,
    projectId: string,
    randomUuid: () => string,
  ) => Promise<Readonly<{ readonly scopeId: ReplacementScopeIdV1 }>>;
  readonly locateTarget: (
  ) => LocatedScopeClockReader;
  /**
   * Establishes only the pre-snapshot row at commit 1. Both same-snapshot C07
   * writers are later activated and published through the real execution graph.
   */
  readonly seedBaselineLiveRow: (
    input: C07SeedLiveRowV1,
  ) => Promise<void>;
  /** C08-only hook; absent in the accepted lower-level C07 proof. */
  readonly afterBaselineSeed?: (
    input: C07SeedLiveRowV1 & {
      readonly deploymentId: TransactionGrantDeploymentIdV1;
    },
  ) => Promise<void>;
}

export interface C07PrivatePointMutationProofV1 {
  readonly lane: C07PrivatePointMutationLaneV1["name"];
  readonly clonedActivationFailure: string;
  readonly firstResultKind: "published" | "replayed";
  readonly firstCommitSeq: string;
  readonly competingResultKind: "published" | "replayed";
  readonly competingCommitSeq: string;
  readonly runtimeExecutions: number;
  readonly competingRuntimeExecutions: number;
  readonly disposedRuntimeResponses: number;
  readonly consumedActivationFailure: string;
  readonly coldOutcomeKind: "available";
  readonly coldOutcomeCommitSeq: string;
  readonly coldOutcomeValue: unknown;
  readonly durable: C07DurableAgreementV1;
}

export interface C07DurableAgreementV1 {
  readonly sessionCount: string;
  readonly lifecycle: string;
  readonly revisions: string;
  readonly currentRows: string;
  readonly currentCommitSeq: string;
  readonly currentValue: unknown;
  readonly commitSeqs: ReadonlyArray<string>;
  readonly changeCommitSeqs: ReadonlyArray<string>;
  readonly outcomeCommitSeqs: ReadonlyArray<string>;
  readonly outboxSeqs: ReadonlyArray<string>;
  readonly outboxCommitSeqs: ReadonlyArray<string>;
  readonly lastCommitSeq: string;
  readonly lastOutboxSeq: string;
}

export interface C07PrivateRegisteredRevisionMutationInputV1 {
  readonly lane: C07PrivatePointMutationLaneV1;
  readonly target: ActivePointMutationTargetMetadataV1;
  readonly functionPath: TransactionFunctionPathV1;
  readonly args: unknown;
  readonly requestKey: TransactionRequestKeyV1;
  readonly runtimeRunner: PointMutationOccRuntimeNeutralRunnerV1;
  readonly randomUuid: () => string;
}

export interface C07PrivateRegisteredRevisionMutationProofV1 {
  readonly resultKind: "published" | "replayed";
  readonly commitSeq: string;
  readonly value: unknown;
  readonly coldOutcomeKind: "available";
  readonly coldOutcomeCommitSeq: string;
  readonly durable: C07DurableAgreementV1;
}

/**
 * Test-only adapter for FSV03. It accepts an explicitly selected immutable
 * revision target and then enters the accepted C07 activation/execution path.
 * It does not resolve an active revision and is intentionally not exported by
 * the persistence package.
 */
export async function executePrivateRegisteredRevisionPointMutationThroughC07V1(
  input: C07PrivateRegisteredRevisionMutationInputV1,
): Promise<C07PrivateRegisteredRevisionMutationProofV1> {
  const deploymentId = input.target.deploymentId;
  const scopeId = input.target.scopeId;
  const revocationEpoch =
    TransactionAuthorizationRevocationEpochSchema.make(0n);
  const preparation = createExecutorPointMutationStartPreparationV1({
    loadActiveTargetMetadata: async () => structuredClone(input.target),
    loadCurrentScopeAuthority: async () => ({
      deploymentId,
      scopeId,
      authorizationRevocationEpoch: revocationEpoch,
    }),
  });
  const policy = await canonicalizeTransactionGrantIdentityAccessPolicyV1({
    policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    auth: { kind: "anonymous" },
    capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  });
  const now = Date.now();
  const issuedAtMilliseconds = now - 1_000;
  const expiresAtMilliseconds = now + 300_000;
  const kid = TransactionGrantKeyIdV1Schema.make(
    `key_fsv03_${input.lane.name}`,
  );
  const verifier = createTransactionGrantVerifierV1({
    clock: { now: () => new Date() },
    verificationKeyNamespace:
      createTransactionGrantVerificationKeyNamespaceV1({
        deploymentId,
        keys: [{
          state: "active",
          kid,
          purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
          issuedAtInclusiveEpochMilliseconds: issuedAtMilliseconds - 1_000,
          verificationEndsAtExclusiveEpochMilliseconds:
            expiresAtMilliseconds + 1_000,
          verify: async () => true,
        }],
      }),
    grantRetentionPolicy: Result.getOrThrow(
      makeGrantRetentionPolicyV1Result({
        maximumGrantLifetimeMilliseconds: 600_000,
        maximumFutureIssuedAtSkewMilliseconds: 0,
        maximumLiveSnapshotRetentionMilliseconds: 600_000,
      }),
    ),
  });
  const preparedHandle = await preparation.prepare({
    deploymentId,
    functionPath: input.functionPath,
    args: input.args,
    requestKey: input.requestKey,
  });
  const prepared = inspectExecutorPreparedPointMutationStartV1(preparedHandle);
  const grantPayload = await canonicalizeTransactionGrantPayloadV1({
    format: "flarex.transaction-grant",
    version: 1,
    grantId: `grant_fsv03_${input.lane.name}_${input.requestKey}`,
    ...prepared.logicalPins,
    policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    identityAccessPolicySha256: policy.sha256Hex,
    capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
    auth: { kind: "anonymous" },
    issuedAt: new Date(issuedAtMilliseconds).toISOString(),
    expiresAt: new Date(expiresAtMilliseconds).toISOString(),
    authorizationRevocationEpoch: revocationEpoch.toString(),
  });
  const protectedHeader = canonicalizeTransactionGrantProtectedHeaderV1({
    alg: "Ed25519",
    kid,
    typ: "flarex-transaction-grant+jws",
  });
  const grant = await deriveInertTransactionGrantEvidenceV1({
    protected: protectedHeader.base64url,
    payload: grantPayload.base64url,
    signature: encodeTransactionGrantEd25519SignatureV1(new Uint8Array(64)),
  });
  const verified = await verifier.verify({
    jws: grant.jws,
    expectedStart: preparedHandle,
  });
  const ports = resolutionPorts(input.lane);
  const admitted = await runEffect(createPointMutationStartAdmissionV1({
    resolveCurrent: () => Effect.succeed({
      deploymentId,
      scopeId,
      authorizationRevocationEpoch: revocationEpoch,
    }),
  }).admit(verified));
  const executionClaims = createPointMutationExecutionClaimVaultV1();
  const activated = await runEffect(
    createPointMutationSessionActivationV1(
      createPointMutationSessionActivationPersistenceV1(ports, {
        leaseDurationMilliseconds: 600_000,
        randomUuid: input.randomUuid,
      }),
      executionClaims.issuer,
    ).activate(admitted),
  );
  if (inspectActivatedPointMutationSessionV1(activated).status !== "created") {
    throw new Error("FSV03 point mutation was not newly activated.");
  }
  const functionMetadata = input.target.functions.find(
    candidate => candidate.path === input.functionPath,
  );
  if (functionMetadata === undefined) {
    throw new Error("FSV03 selected revision omitted its mutation metadata.");
  }
  const store = createSessionJournalStorePersistenceV1(ports, {
    grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
    randomUuid: input.randomUuid,
  });
  const execution = createInitialExecution(
    ports,
    executionClaims,
    createStoredAttemptEvidenceLoaderV1(ports),
    createPointMutationSessionAttemptLoadingV1(
      createPointMutationSessionAttemptLoadPersistenceV1(ports),
    ),
    store,
    verifier,
    Object.freeze({
      deploymentId,
      scopeId,
      packageId: prepared.logicalPins.packageId,
      artifactRuntime: prepared.logicalPins.artifactRuntime,
      artifactId: prepared.logicalPins.artifactId,
      sourcePackageHash: prepared.logicalPins.sourcePackageHash,
      executionModule: prepared.logicalPins.executionModule,
      functionPath: prepared.logicalPins.functionPath,
      functionKind: prepared.logicalPins.functionKind,
      schemaVersionId: input.target.schemaVersionId,
      functionMetadata: structuredClone(functionMetadata),
    }),
    input.runtimeRunner,
    createIntrinsicCreationTimeIndexDefinitionPortV1(
      input.lane.controlDb,
    ),
  );
  const result = await runEffect(
    execution.executeInitialPointMutationAttempt(activated),
  );
  if (result.kind === "expired") {
    throw new Error("FSV03 point mutation unexpectedly expired.");
  }
  const scopeUuid = projectScopeIdUuidV1(scopeId).scopeUuid;
  const coldOutcome = await runEffect(
    createPointCommitPublisherPortV1(resolutionPorts(input.lane))[
      RESOLVE_POINT_COMMIT_OUTCOME_V1
    ](deploymentId, {
      scopeUuid,
      requestKey: input.requestKey,
      expectedIdentityAccessPolicySha256:
        transactionGrantIdentityAccessPolicySha256BytesV1FromHex(
          policy.sha256Hex,
        ),
      expectedFunctionPath: prepared.logicalPins.functionPath,
      expectedRequestSha256:
        transactionGrantRequestSha256BytesV1FromHex(
          prepared.logicalPins.requestSha256,
        ),
    }),
  );
  if (coldOutcome.kind !== "available") {
    throw new Error(`FSV03 cold outcome was ${coldOutcome.kind}.`);
  }
  return Object.freeze({
    resultKind: result.kind,
    commitSeq: result.token.commitSeq.toString(),
    value: structuredClone(result.successfulResult.valueJson),
    coldOutcomeKind: coldOutcome.kind,
    coldOutcomeCommitSeq: coldOutcome.token.commitSeq.toString(),
    durable: await loadPrivateC07DurableAgreementV1(
      input.lane.persistence,
      scopeUuid,
    ),
  });
}

/**
 * Test-owned C07 composition root. It deliberately has no production export:
 * callers must supply one already-migrated database lane and its exact located
 * target/provisioning owners.
 */
export async function proveC07PrivatePointMutationCorrectnessV1(
  lane: C07PrivatePointMutationLaneV1,
): Promise<C07PrivatePointMutationProofV1> {
  const randomUuid = uuidFactory(lane.name === "pglite" ? "c7000000" : "c7100000");
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    `deployment_c07_${lane.name}`,
  );
  const schemaVersionId = CatalogSchemaVersionIdSchema.make(
    `schema_c07_${lane.name}`,
  );
  const provisioned = await lane.ensureScope(
    deploymentId,
    `project_c07_${lane.name}`,
    randomUuid,
  );
  const scopeId = provisioned.scopeId;
  await setFlarexActivationClock(lane.persistence, scopeId);
  const usersTable = appTable("users");
  await lane.persistence.publishAppSchemaV1({
    deploymentId,
    schemaVersionId,
    version: CatalogSchemaVersionSchema.make(1),
    tables: [usersTable],
    indexes: [],
  });
  const tableId = decodeCatalogTableId(1);
  const rowId = decodeAppRowIdHexV1("17".repeat(16));
  const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
  const creationTime = decodeAppCreationTimeV1(1);
  await lane.seedBaselineLiveRow({
    scopeId,
    schemaVersionId,
    tableId,
    rowId,
    creationTime,
    value: Object.freeze({
      _id: documentId,
      _creationTime: creationTime,
      name: `c07-${lane.name}-seed`,
    }),
  });
  await lane.afterBaselineSeed?.({
    deploymentId,
    scopeId,
    schemaVersionId,
    tableId,
    rowId,
    creationTime,
    value: Object.freeze({
      _id: documentId,
      _creationTime: creationTime,
      name: `c07-${lane.name}-seed`,
    }),
  });

  const revocationEpoch =
    TransactionAuthorizationRevocationEpochSchema.make(0n);
  const target = decodeActivePointMutationTargetMetadataV1({
    format: "flarex.point-mutation-target-metadata",
    version: 1,
    deploymentId,
    scopeId,
    packageId: `package_c07_${lane.name}`,
    artifactRuntime: "dynamic-worker",
    artifactId: `artifact_${"c".repeat(32)}`,
    sourcePackageHash: "c".repeat(64),
    schemaVersionId,
    functions: [
      {
        path: "users:create",
        executionModule: "flarex/users.ts",
        kind: "mutation",
        visibility: "public",
        argsValidator: { type: "object", value: {} },
        returnsValidator: successValidator,
      },
    ],
    schemaManifest: {
      kind: "appSchema",
      manifestVersion: 1,
      tableDefinitions: {
        kind: "tableDefinitions",
        sectionVersion: 1,
        tables: [
          {
            tableId: 1,
            namespace: "app",
            logicalName: usersTable.logicalName,
            definition: usersTable.definition,
          },
        ],
      },
      indexBindings: {
        kind: "indexBindings",
        sectionVersion: 1,
        indexes: [],
      },
    },
  });
  const preparation = createExecutorPointMutationStartPreparationV1({
    loadActiveTargetMetadata: async () => structuredClone(target),
    loadCurrentScopeAuthority: async () => ({
      deploymentId,
      scopeId,
      authorizationRevocationEpoch: revocationEpoch,
    }),
  });
  const policy = await canonicalizeTransactionGrantIdentityAccessPolicyV1({
    policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
    auth: { kind: "anonymous" },
    capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  });
  const now = Date.now();
  const issuedAtMilliseconds = now - 1_000;
  const expiresAtMilliseconds = now + 300_000;
  const kid = TransactionGrantKeyIdV1Schema.make(`key_c07_${lane.name}`);
  const verifier = createTransactionGrantVerifierV1({
    clock: { now: () => new Date() },
    verificationKeyNamespace:
      createTransactionGrantVerificationKeyNamespaceV1({
        deploymentId,
        keys: [
          {
            state: "active",
            kid,
            purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
            issuedAtInclusiveEpochMilliseconds: issuedAtMilliseconds - 1_000,
            verificationEndsAtExclusiveEpochMilliseconds:
              expiresAtMilliseconds + 1_000,
            verify: async () => true,
          },
        ],
      }),
    grantRetentionPolicy: Result.getOrThrow(
      makeGrantRetentionPolicyV1Result({
        maximumGrantLifetimeMilliseconds: 600_000,
        maximumFutureIssuedAtSkewMilliseconds: 0,
        maximumLiveSnapshotRetentionMilliseconds: 600_000,
      }),
    ),
  });
  const ports = resolutionPorts(lane);
  const activateAttempt = async (role: "primary" | "competing") => {
    const requestKey = TransactionRequestKeyV1Schema.make(
      `request:c07:${lane.name}:${role}`,
    );
    const preparedHandle = await preparation.prepare({
      deploymentId,
      functionPath: TransactionFunctionPathV1Schema.make("users:create"),
      args: {},
      requestKey,
    });
    const prepared = inspectExecutorPreparedPointMutationStartV1(
      preparedHandle,
    );
    const grantPayload = await canonicalizeTransactionGrantPayloadV1({
      format: "flarex.transaction-grant",
      version: 1,
      grantId: `grant_c07_${lane.name}_${role}`,
      ...prepared.logicalPins,
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
      identityAccessPolicySha256: policy.sha256Hex,
      capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
      auth: { kind: "anonymous" },
      issuedAt: new Date(issuedAtMilliseconds).toISOString(),
      expiresAt: new Date(expiresAtMilliseconds).toISOString(),
      authorizationRevocationEpoch: revocationEpoch.toString(),
    });
    const protectedHeader = canonicalizeTransactionGrantProtectedHeaderV1({
      alg: "Ed25519",
      kid,
      typ: "flarex-transaction-grant+jws",
    });
    const grant = await deriveInertTransactionGrantEvidenceV1({
      protected: protectedHeader.base64url,
      payload: grantPayload.base64url,
      signature: encodeTransactionGrantEd25519SignatureV1(
        new Uint8Array(64),
      ),
    });
    const verified = await verifier.verify({
      jws: grant.jws,
      expectedStart: preparedHandle,
    });
    const admitted = await runEffect(createPointMutationStartAdmissionV1({
      resolveCurrent: () => Effect.succeed({
        deploymentId,
        scopeId,
        authorizationRevocationEpoch: revocationEpoch,
      }),
    }).admit(verified));
    const executionClaims = createPointMutationExecutionClaimVaultV1();
    const activated = await runEffect(
      createPointMutationSessionActivationV1(
        createPointMutationSessionActivationPersistenceV1(ports, {
          leaseDurationMilliseconds: 600_000,
          randomUuid,
        }),
        executionClaims.issuer,
      ).activate(admitted),
    );
    const activation = inspectActivatedPointMutationSessionV1(activated);
    if (activation.status !== "created") {
      throw new Error(`C07 ${role} attempt was not newly activated.`);
    }
    return Object.freeze({
      requestKey,
      prepared,
      executionClaims,
      activated,
    });
  };
  const primary = await activateAttempt("primary");
  const competing = await activateAttempt("competing");
  const requestKey = primary.requestKey;
  const prepared = primary.prepared;
  const executionClaims = primary.executionClaims;
  const activated = primary.activated;
  const functionMetadata = target.functions[0];
  if (functionMetadata === undefined) {
    throw new Error("C07 function metadata is missing.");
  }
  const store = createSessionJournalStorePersistenceV1(ports, {
    grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
    randomUuid,
  });
  const loading = createPointMutationSessionAttemptLoadingV1(
    createPointMutationSessionAttemptLoadPersistenceV1(ports),
  );
  const loader = createStoredAttemptEvidenceLoaderV1(ports);

  let runtimeExecutions = 0;
  let competingRuntimeExecutions = 0;
  let disposedRuntimeResponses = 0;
  let competingResultKind: "published" | "replayed" | undefined;
  let competingCommitSeq: string | undefined;
  const runtimeRequests: PointMutationExactRuntimeRequestV1[] = [];
  const functionSnapshot = (
    selected: typeof prepared,
  ) => Object.freeze({
    deploymentId,
    scopeId,
    packageId: selected.logicalPins.packageId,
    artifactRuntime: selected.logicalPins.artifactRuntime,
    artifactId: selected.logicalPins.artifactId,
    sourcePackageHash: selected.logicalPins.sourcePackageHash,
    executionModule: selected.logicalPins.executionModule,
    functionPath: selected.logicalPins.functionPath,
    functionKind: selected.logicalPins.functionKind,
    schemaVersionId,
    functionMetadata: structuredClone(functionMetadata),
  });
  const competingRuntimeBinding = Object.freeze({
    run: async (
      request: PointMutationExactRuntimeRequestV1,
      journal: Parameters<
        PointMutationExactRuntimeArtifactHostBindingV1["run"]
      >[1],
    ) => {
      competingRuntimeExecutions += 1;
      runtimeRequests.push(request);
      const table = await journal.resolvePointTable("users");
      const patched = await table.runPointOperation({
        kind: "patch",
        syscallSequence: "1",
        documentId,
        patch: { name: `c07-${lane.name}-competing` },
      });
      if (patched.kind !== "unit" || patched.operation !== "patch") {
        throw new Error("C07 competing runtime failed to patch its point row.");
      }
      return exactRuntimeSuccessResponse(() => {
        disposedRuntimeResponses += 1;
      });
    },
  }) satisfies PointMutationExactRuntimeArtifactHostBindingV1;
  const competingExecution = createInitialExecution(
    ports,
    competing.executionClaims,
    loader,
    loading,
    store,
    verifier,
    functionSnapshot(competing.prepared),
    makePointMutationExactRuntimeBindingRunnerV1(competingRuntimeBinding),
    createIntrinsicCreationTimeIndexDefinitionPortV1(
      lane.controlDb,
    ),
  );
  const runtimeBinding = Object.freeze({
    run: async (
      request: PointMutationExactRuntimeRequestV1,
      journal: Parameters<
        PointMutationExactRuntimeArtifactHostBindingV1["run"]
      >[1],
    ) => {
      runtimeExecutions += 1;
      runtimeRequests.push(request);
      const table = await journal.resolvePointTable("users");
      const patched = await table.runPointOperation({
        kind: "patch",
        syscallSequence: "1",
        documentId,
        patch: { name: `c07-${lane.name}-${runtimeExecutions}` },
      });
      if (patched.kind !== "unit" || patched.operation !== "patch") {
        throw new Error("C07 exact runtime failed to patch its point row.");
      }
      if (runtimeExecutions === 1) {
        const competingResult = await runEffect(
          competingExecution.executeInitialPointMutationAttempt(
            competing.activated,
          ),
        );
        if (competingResult.kind === "expired") {
          throw new Error("C07 competing result unexpectedly expired.");
        }
        competingResultKind = competingResult.kind;
        competingCommitSeq = competingResult.token.commitSeq.toString();
      }
      return exactRuntimeSuccessResponse(() => {
        disposedRuntimeResponses += 1;
      });
    },
  }) satisfies PointMutationExactRuntimeArtifactHostBindingV1;
  const runtimeRunner =
    makePointMutationExactRuntimeBindingRunnerV1(runtimeBinding);
  const execution = createInitialExecution(
    ports,
    executionClaims,
    loader,
    loading,
    store,
    verifier,
    functionSnapshot(prepared),
    runtimeRunner,
    createIntrinsicCreationTimeIndexDefinitionPortV1(
      lane.controlDb,
    ),
  );

  const clonedActivationFailure = await runEffectFailure(
    execution.executeInitialPointMutationAttempt(
      Object.freeze({ ...activated }),
    ),
  );
  const firstResult = await runEffect(
    execution.executeInitialPointMutationAttempt(activated),
  );
  if (firstResult.kind === "expired") {
    throw new Error("C07 unexpectedly expired its committed result.");
  }
  const consumedActivationFailure = await runEffectFailure(
    execution.executeInitialPointMutationAttempt(activated),
  );
  const scopeUuid = projectScopeIdUuidV1(scopeId).scopeUuid;
  const freshOutcomePort = createPointCommitPublisherPortV1(
    resolutionPorts(lane),
  );
  const coldOutcome = await runEffect(
    freshOutcomePort[RESOLVE_POINT_COMMIT_OUTCOME_V1](
      deploymentId,
      {
        scopeUuid,
        requestKey,
        expectedIdentityAccessPolicySha256:
          transactionGrantIdentityAccessPolicySha256BytesV1FromHex(
            policy.sha256Hex,
          ),
        expectedFunctionPath: prepared.logicalPins.functionPath,
        expectedRequestSha256:
          transactionGrantRequestSha256BytesV1FromHex(
            prepared.logicalPins.requestSha256,
          ),
      },
    ),
  );
  if (coldOutcome.kind !== "available") {
    throw new Error(`C07 cold outcome was ${coldOutcome.kind}.`);
  }
  if (
    competingResultKind === undefined ||
    competingCommitSeq === undefined
  ) {
    throw new Error("C07 competing publication did not settle.");
  }
  const durable = await loadPrivateC07DurableAgreementV1(
    lane.persistence,
    scopeUuid,
  );
  validateRuntimeRequests(runtimeRequests);

  return Object.freeze({
    lane: lane.name,
    clonedActivationFailure: failureName(clonedActivationFailure),
    firstResultKind: firstResult.kind,
    firstCommitSeq: firstResult.token.commitSeq.toString(),
    competingResultKind,
    competingCommitSeq,
    runtimeExecutions,
    competingRuntimeExecutions,
    disposedRuntimeResponses,
    consumedActivationFailure: failureName(consumedActivationFailure),
    coldOutcomeKind: coldOutcome.kind,
    coldOutcomeCommitSeq: coldOutcome.token.commitSeq.toString(),
    coldOutcomeValue: structuredClone(coldOutcome.successfulResult.valueJson),
    durable,
  });
}

function createInitialExecution(
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  executionClaims: ReturnType<
    typeof createPointMutationExecutionClaimVaultV1
  >,
  loader: ReturnType<typeof createStoredAttemptEvidenceLoaderV1>,
  loading: ReturnType<typeof createPointMutationSessionAttemptLoadingV1>,
  store: ReturnType<typeof createSessionJournalStorePersistenceV1>,
  verifier: ReturnType<typeof createTransactionGrantVerifierV1>,
  functionSnapshot: Readonly<{
    readonly deploymentId: TransactionGrantDeploymentIdV1;
    readonly scopeId: ReplacementScopeIdV1;
    readonly packageId: string;
    readonly artifactRuntime: string;
    readonly artifactId: string;
    readonly sourcePackageHash: string;
    readonly executionModule: string;
    readonly functionPath: string;
    readonly functionKind: "mutation";
    readonly schemaVersionId: ReturnType<
      typeof CatalogSchemaVersionIdSchema.make
    >;
    readonly functionMetadata: PointMutationTargetFunctionMetadataV1;
  }>,
  runner: PointMutationOccRuntimeNeutralRunnerV1,
  intrinsicCreationTimeIndexes:
    ReturnType<typeof createIntrinsicCreationTimeIndexDefinitionPortV1>,
) {
  let executionSequence = 0;
  const terminalization = createPointMutationSessionAttemptTerminalizationV1(
    createPointMutationSessionAttemptTerminalizationPersistenceV1(ports),
    executionClaims.admission,
  );
  return createPointMutationInitialExecutionV1(loader, {
    evidenceLoader: createStoredCommitAuthorityEvidenceLoaderV1(ports),
    transactionGrantVerifier: verifier,
    functionMetadata: {
      load: () => Effect.succeed(structuredClone(functionSnapshot)),
    },
    pointCommit: createPointCommitPublisherPortV1(ports, {
      intrinsicCreationTimeIndexes,
    }),
    pointCommitFinishing: createPointCommitFinishingTransitionPortV1(ports),
    pointMutationAttemptReplacement:
      createPointMutationAttemptReplacementPortV1(ports, {
        leaseDurationMilliseconds: 600_000,
      }),
    pointMutationOccRerun: {
      attemptLoading: loading,
      executionEvidence: createStoredOccExecutionEvidenceLoaderV1(ports),
      journal: createPointMutationJournalV1(
        store,
        executionClaims.admission,
        issueSetupSeededSyscallValidatorProofV1({
          scopeId: functionSnapshot.scopeId,
          schemaVersionId: functionSnapshot.schemaVersionId,
        }),
      ),
      terminalization,
      contextFactory: {
        make: () =>
          Effect.sync(() => {
            executionSequence += 1;
            return Object.freeze({
              executionId: `c07-${executionSequence}`,
              logScopeId: `c07-log-${executionSequence}`,
              randomSeed: new Uint8Array(32).fill(executionSequence),
            });
          }),
      },
      runner,
      liveness: createPointMutationExecutionClaimLivenessV1(ports, {
        claimDurationMilliseconds: 600_000,
        leaseRenewalDurationMilliseconds: 600_000,
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      }),
      heartbeatIntervalMilliseconds: 200_000,
    },
  }, executionClaims);
}

function resolutionPorts(
  lane: C07PrivatePointMutationLaneV1,
): PointMutationSessionAuthorityResolutionPortsV1 {
  return {
    scopeMetadata: lane.persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => {
        throw new Error("C07 shared placement must not read split receipts.");
      },
    },
    scopeSessionTargets: {
      resolve: async (): Promise<LocatedScopeClockReader> =>
        lane.locateTarget(),
    },
  };
}

export async function loadPrivateC07DurableAgreementV1(
  persistence: FlarexPersistence,
  scopeUuid: string,
): Promise<C07DurableAgreementV1> {
  const scalar = await persistence.query<{
    session_count: string;
    lifecycle: string | null;
    revisions: string;
    current_rows: string;
    current_commit_seq: string | null;
    current_value: unknown;
    last_commit_seq: string;
    last_outbox_seq: string;
  }>(
    `
      select
        (select count(*)::text from fx_system_tx_session
          where scope_uuid = $1) as session_count,
        (select lifecycle from fx_system_tx_session
          where scope_uuid = $1 limit 1) as lifecycle,
        (select count(*)::text from fx_app_row_rev
          where scope_uuid = $1) as revisions,
        (select count(*)::text from fx_app_row_current
          where scope_uuid = $1) as current_rows,
        (select current_row.commit_seq::text
          from fx_app_row_current as current_row
          where current_row.scope_uuid = $1 limit 1) as current_commit_seq,
        (select revision.value_json
          from fx_app_row_current as current_row
          join fx_app_row_rev as revision
            on revision.scope_uuid = current_row.scope_uuid
            and revision.table_id = current_row.table_id
            and revision.row_id = current_row.row_id
            and revision.commit_seq = current_row.commit_seq
          where current_row.scope_uuid = $1 limit 1) as current_value,
        clock.last_commit_seq::text,
        clock.last_outbox_seq::text
      from fx_system_scope_clock as clock
      where clock.scope_uuid = $1
    `,
    [scopeUuid],
  );
  const row = scalar.rows[0];
  if (
    row === undefined ||
    row.lifecycle === null ||
    row.current_commit_seq === null ||
    row.current_value === null
  ) {
    throw new Error("C07 durable agreement is missing required state.");
  }
  const commits = await persistence.query<{ commit_seq: string }>(
    `select commit_seq::text from fx_system_commit
     where scope_uuid = $1 order by commit_seq`,
    [scopeUuid],
  );
  const changes = await persistence.query<{ commit_seq: string }>(
    `select commit_seq::text from fx_system_commit_app_row_change
     where scope_uuid = $1 order by commit_seq, change_ordinal`,
    [scopeUuid],
  );
  const outbox = await persistence.query<{
    outbox_seq: string;
    commit_seq: string;
  }>(
    `select outbox_seq::text, commit_seq::text from fx_system_outbox
     where scope_uuid = $1 order by outbox_seq`,
    [scopeUuid],
  );
  const outcomes = await persistence.query<{ commit_seq: string }>(
    `select commit_seq::text from fx_system_idempotency
     where scope_uuid = $1 order by commit_seq`,
    [scopeUuid],
  );
  return Object.freeze({
    sessionCount: row.session_count,
    lifecycle: row.lifecycle,
    revisions: row.revisions,
    currentRows: row.current_rows,
    currentCommitSeq: row.current_commit_seq,
    currentValue: structuredClone(row.current_value),
    commitSeqs: Object.freeze(commits.rows.map((item) => item.commit_seq)),
    changeCommitSeqs: Object.freeze(
      changes.rows.map((item) => item.commit_seq),
    ),
    outcomeCommitSeqs: Object.freeze(
      outcomes.rows.map((item) => item.commit_seq),
    ),
    outboxSeqs: Object.freeze(outbox.rows.map((item) => item.outbox_seq)),
    outboxCommitSeqs: Object.freeze(
      outbox.rows.map((item) => item.commit_seq),
    ),
    lastCommitSeq: row.last_commit_seq,
    lastOutboxSeq: row.last_outbox_seq,
  });
}

function validateRuntimeRequests(
  requests: ReadonlyArray<PointMutationExactRuntimeRequestV1>,
): void {
  if (requests.length !== 3) {
    throw new Error(`C07 expected three runtime executions, received ${
      requests.length
    }.`);
  }
  for (const request of requests) {
    if (
      request.artifact.runtime !== "dynamic-worker" ||
      request.function.path !== "users:create" ||
      request.function.kind !== "mutation" ||
      request.auth.kind !== "anonymous"
    ) {
      throw new Error("C07 exact runtime received incorrect authenticated pins.");
    }
    if (
      "session" in request ||
      "journal" in request ||
      "database" in request ||
      "retry" in request
    ) {
      throw new Error("C07 leaked executor authority into the runtime request.");
    }
  }
}

function appTable(
  logicalName: string,
): SchemaManifestAppTableDeclarationInputV1 {
  return {
    logicalName,
    definition: {
      kind: "appDocument",
      definitionVersion: 1,
      documentType: {
        type: "object",
        value: {
          name: {
            fieldType: { type: "string" },
            optional: true,
          },
        },
      },
    },
  };
}

function exactRuntimeSuccessResponse(
  dispose: () => void,
): PointMutationExactRuntimeHostResponseV1 & Disposable {
  return {
    format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V1,
    version: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V1,
    kind: "success",
    result: {
      format: POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
      version: POINT_MUTATION_EXACT_RUNTIME_RESULT_VERSION_V1,
      value: { ok: true },
    },
    [Symbol.dispose]: dispose,
  };
}

const successValidator: PointMutationTargetFunctionMetadataV1[
  "returnsValidator"
] = {
  type: "object",
  value: {
    ok: { optional: false, fieldType: { type: "boolean" } },
  },
};

function uuidFactory(prefix: "c7000000" | "c7100000"): () => string {
  let counter = 1;
  return () => {
    const suffix = counter.toString().padStart(12, "0");
    counter += 1;
    return `${prefix}-0000-4000-8000-${suffix}`;
  };
}

function failureName(error: PointMutationInitialExecutionV1Error): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "_tag" in error &&
    typeof error._tag === "string"
  ) {
    return error._tag;
  }
  return error instanceof Error ? error.name : "UnknownError";
}
