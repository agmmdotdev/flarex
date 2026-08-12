/// <reference types="@cloudflare/workers-types" />

import { and, asc, eq } from "drizzle-orm";
import { Cause, Effect, Exit, Fiber, Random, Result, Schema } from "effect";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import { canonicalizeApplicationMutationExecutionAuthorityV1 } from
  "flarex-protocol/internal/application-mutation-authority-v1";
import { canonicalizeApplicationRuntimeTargetV1 } from
  "flarex-protocol/internal/application-runtime-target-v1";
import {
  APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
  APP_UNIQUE_KEY_CODEC_VERSION_V1,
  decodeAppUniqueConstraintPhysicalSpecV1,
} from "flarex-protocol/app-unique-constraint-definition";
import {
  appDocumentIdV1FromRowIdentity,
  appRowIdHexV1ToBytes,
  decodeAppDocumentIdentityV1,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  decodeCatalogIndexDefinitionId,
  decodeCatalogIndexId,
  decodeCatalogTableId,
} from "flarex-protocol/catalog";
import {
  decodeOrderedIndexBoundHexV1,
  decodeOrderedIndexRowIdHexV1,
  encodeAppOrderedIndexKeyV1,
  ORDERED_INDEX_MISSING_V1,
  orderedIndexCreationTimeV1,
  orderedIndexValueFromFlarexValueV1,
  type OrderedIndexBoundsV1,
} from "flarex-protocol/ordered-index";
import {
  CanonicalSuccessfulResultBytesV1Schema,
  CommitEnvelopeV1Schema,
  CommitSyscallSequenceV1Schema,
  MAX_POINT_COMMIT_MATERIAL_ROWS_V1,
  SESSION_JOURNAL_FORMAT_V1,
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
} from "flarex-protocol/commit-protocol";
import {
  makeGrantRetentionPolicyV1Result,
} from "flarex-protocol/grant-retention-policy";
import {
  INDEX_BUILD_CURSOR_CODEC_VERSION_V1,
  IndexBuildAttemptFenceSchema,
} from "flarex-protocol/index-build-state";
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
  TransactionGrantDeploymentIdV1Schema,
} from "flarex-protocol/transaction-grant";
import {
  decodeActivePointMutationTargetMetadataV1,
  preparePointMutationStartEvidenceV1,
  type PointMutationTargetFunctionMetadataV1,
} from "flarex-protocol/point-mutation-start";
import {
  POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
  POINT_MUTATION_EXACT_RUNTIME_RESULT_VERSION_V1,
  type PointMutationExactRuntimeRequestV1,
} from "flarex-protocol/point-mutation-exact-runtime";
import {
  POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
  POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2,
  type PointMutationExactRuntimeHostResponseV2,
} from "flarex-protocol/point-mutation-exact-runtime-host";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  SchemaManifestAppIndexDescriptorSchema,
  type SchemaManifestAppTableDeclarationInputV1,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  FlarexDbV1StorageGenerationSchema,
  MAX_PERSISTED_SIGNED_INT64_V1,
  ScopeEpochSchema,
  SnapshotTokenSchema,
  StorageGenerationFenceSchema,
  decodeReplacementScopeIdV1,
  projectScopeEpochUuidV1,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";
import {
  TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
  TransactionAttemptFenceSchema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionFunctionPathV1Schema,
  TransactionRequestKeyV1Schema,
  type TransactionSessionLifecycleV1,
} from "flarex-protocol/transaction-session";
import {
  FLAREX_VALUE_CODEC_VERSION_V1,
  canonicalizeFlarexValueV1,
  isCanonicalFlarexRuntimeObjectV1,
} from "flarex-protocol/value";
import {
  beforeAll,
  describe,
  expect,
  expectTypeOf,
  it,
} from "vitest";

import {
  createPointMutationSessionActivationV1,
  createPointMutationSessionAttemptLoadingV1,
  createPointMutationSessionAttemptTerminalizationV1,
  inspectActivatedPointMutationSessionV1,
  type PointMutationSessionAttemptLoadingV1,
} from "../../executor/src/pointMutationSessionActivation";
import {
  createExecutorPointMutationStartPreparationV1,
  inspectExecutorPreparedPointMutationStartV1,
} from "../../executor/src/pointMutationStartPreparation";
import { createPointMutationSessionAttemptDispositionV1 } from
  "../../executor/src/pointMutationSessionAttemptDisposition";
import { createPointMutationAttemptRedeliveryV1 } from
  "../../executor/src/pointMutationAttemptRedelivery";
import {
  createPointMutationMultiScopeRedeliveryV1,
  type PointMutationMultiScopeRedeliveryV1,
} from
  "../../executor/src/pointMutationMultiScopeRedelivery";
import {
  createPointMutationRedeliverySchedulerRunV1,
  type PointMutationRedeliverySchedulerCheckpointPortV1,
} from "../../executor/src/pointMutationRedeliverySchedulerRun";
import { decodePointMutationSessionAttemptSelectorV1 } from
  "../../executor/src/pointMutationSessionAttemptSelector";
import { createPointMutationJournalV1 } from "../../executor/src/pointMutationJournal";
import { SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1 } from
  "./applicationRevisionSyscallValidatorTestSupport";
import {
  makePointMutationExactRuntimeBindingRunnerV1,
  type PointMutationExactRuntimeArtifactHostBindingV1,
} from "../../executor/src/pointMutationExactRuntimeBinding";
import {
  createPointMutationExecutionClaimVaultV1,
  type PointMutationExecutionClaimVaultV1,
  type PointMutationExecutionScopeV1,
} from "../../executor/src/pointMutationExecutionClaim";
import {
  createPointMutationExecutionClaimDispatchAcquisitionV1,
  type PointMutationExecutionClaimDispatchAcquisitionV1,
} from "../../executor/src/pointMutationExecutionClaimAcquisition";
import {
  createStoredPointCommitExecutorV1,
  createStoredPointCommitFinishingTransitionV1,
  createPointMutationInitialExecutionV1,
  createStoredPointMutationCrashRedispatchV1,
  createStoredPointMutationOccRerunExecutionV1,
  PointCommitKnownSettledSqlRetryExhaustedV1Error,
  PointCommitUncertainOutcomeUnresolvedV1Error,
  PointMutationOccUserCodeV1Error,
  type PointMutationOccExecutionContextFactoryV1,
  type PointMutationOccRuntimeNeutralRunnerV1,
  type StoredAttemptEvidenceLoaderPortV1,
} from "../../executor/src/storedAttemptAuthentication";
import {
  createPointMutationStartAdmissionV1,
  createTransactionGrantVerificationKeyNamespaceV1,
  createTransactionGrantVerifierV1,
} from "../../executor/src/transactionGrant";
import * as persistenceRoot from "../src";
import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
  type AppRowTransaction,
} from "../src/appRows";
import {
  createAppSchemaCandidateValidationPortForPointCommitAuthority,
  createAppSchemaCandidateWriteGuardPort,
  installAppSchemaCandidateValidationEffect,
  loadAppSchemaCandidateValidationEffect,
} from "../src/appSchemaCandidateValidation";
import {
  createPGliteLocatedIndexBuildReconciliationTargetV1,
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "../src/pglite";
import {
  buildAppDeveloperOrderedIndexV1Effect,
  buildIntrinsicCreationTimeIndexV1Effect,
  createIntrinsicCreationTimeIndexDefinitionPortV1,
  type BuildAppDeveloperOrderedIndexV1Input,
} from "../src/intrinsicCreationTimeIndexBuildV1";
import { reconcilePublishedIndexBuildsV1Effect } from
  "../src/indexBuildReconciliation";
import { createPointMutationAttemptDiscoveryV1 } from
  "../src/pointMutationAttemptDiscovery";
import {
  PointMutationRedeliverySchedulerConfirmedRollbackV1Error,
  PointMutationRedeliverySchedulerConfigurationV1Error,
  createPointMutationRedeliverySchedulerCheckpointV1,
  isPointMutationRedeliverySchedulerAcquireConfirmedRollbackV1Error,
  isPointMutationRedeliverySchedulerCheckpointConfirmedRollbackV1Error,
  isPointMutationRedeliverySchedulerReleaseConfirmedRollbackV1Error,
  isPointMutationRedeliverySchedulerRenewConfirmedRollbackV1Error,
  type PointMutationRedeliverySchedulerAcquireV1Error,
  type PointMutationRedeliverySchedulerCheckpointV1,
  type PointMutationRedeliverySchedulerCheckpointV1Error,
  type PointMutationRedeliverySchedulerReleaseV1Error,
  type PointMutationRedeliverySchedulerRenewV1Error,
  type PointMutationRedeliverySchedulerRunV1,
} from "../src/pointMutationRedeliverySchedulerCheckpoint";
import type { LocatedScopeClockReader } from "../src/scopeAuthorityResolution";
import type {
  ScopePhysicalLocator,
  SharedDatabaseScopePhysicalLocator,
} from "../src/scopeMetadataTypes";
import {
  appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult,
} from "../src/appIndexEntries";
import {
  createAppDeveloperIndexDefinitionPortV1,
  lowerAppDeveloperIndexKeyV1,
} from "../src/appDeveloperIndexCommitV1";
import {
  createAppUniqueConstraintDefinitionPortV1,
  lowerAppUniqueConstraintProjectionV1Result,
} from "../src/appUniqueConstraintCommitV1";
import {
  ensureAppUniqueConstraintDefinitionBindingV1InTransaction,
  prepareAppUniqueConstraintDefinitionBindingV1Effect,
} from "../src/appUniqueConstraintDefinitions";
import {
  MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1,
  advanceAppUniqueConstraintSetBackfillV1Effect,
  createAppUniqueConstraintSetEligibilityPortV1,
  createLocatedAppUniqueConstraintSetBuildTargetV1,
  reconcileAppUniqueConstraintSetBuildV1Effect,
} from "../src/appUniqueConstraintSetBuildV1";
import {
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
} from "../src/appUniqueConstraintSetClosureV1";
import {
  applyAppUniqueKeyMutationInTransactionEffect,
  AppUniqueKeyConflictError,
} from "../src/appUniqueKeys";
import {
  createAppDeveloperIndexQueryPortV1,
  createSessionJournalStorePersistenceV1,
  type PinnedPointTableV1,
  type SessionJournalAttemptV1,
  type SessionJournalStorePersistenceV1,
} from "../src/sessionJournalStore";
import {
  createStoredCommitAuthorityEvidenceLoaderV1,
  MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1,
  StoredCommitAuthorityEvidencePersistenceV1Error,
  type StoredCommitAuthorityEvidenceAuthorityV1,
  type StoredCommitAuthorityEvidenceQueryV1,
} from "../src/storedCommitAuthorityEvidence";
import { createStoredOccExecutionEvidenceLoaderV1 } from "../src/storedOccExecution";
import {
  createStoredAttemptEvidenceLoaderV1,
  StoredAttemptEvidencePersistenceV1Error,
  type StoredAttemptEvidenceAuthorityV1,
  type StoredAttemptEvidenceLoadResultV1,
  type StoredAttemptEvidenceLoaderV1,
  type StoredAttemptFinishingEvidenceLoaderV1,
} from "../src/storedAttemptEvidence";
import {
  createPointMutationExecutionClaimLivenessV1,
  type PointMutationExecutionClaimLivenessV1,
} from
  "../src/transactionExecutionClaimLiveness";
import {
  fxSystemCommitAppRowChanges,
  fxSystemCommits,
  fxSystemIndexBuildStates,
  fxSystemScopeClocks,
} from "../src/schema";
import {
  PointMutationExecutionClaimAcquisitionStaleV1Error,
  createPointMutationExecutionClaimAcquisitionV1,
  createPointMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
  type PointMutationSessionAnchorV1,
  type PointMutationSessionAttemptSelectorV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "../src/transactionSessionActivation";
import {
  TransactionExecutionClaimFenceV1Schema,
  TransactionExecutionClaimOwnerV1Schema,
} from "../src/transactionExecutionClaim";
import {
  LocatedReadCommittedTransactionFailureV1,
  RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1,
  RUN_LOCATED_READ_COMMITTED_V1,
  isLocatedPointCommitPublicationTargetV1,
  isLocatedReadCommittedAttemptTargetV1,
  type LocatedPointCommitPublicationTargetV1,
} from "../src/transactionSessionAttemptKernel";
import {
  createPointCommitFinishingTransitionPortV1,
  createPointCommitPublisherPortV1,
  createPointCommitRollbackProofPortV1,
  createPointMutationAttemptReplacementPortV1,
  MAX_INDEX_RANGE_OCC_COMMIT_SPAN_V1,
  hasPointCommitUniqueConstraintEligibilityV1,
  hasPointCommitUniqueConstraintMaintenanceV1,
  PointCommitConflictV1Error,
  PointCommitConfirmedPreDecisionRollbackV1Error,
  PointCommitCorruptionV1Error,
  PointCommitDecisionUncertainV1Error,
  PointCommitResourceExhaustionV1Error,
  PointCommitSqlErrorV1,
  PointCommitStaleAuthorityV1Error,
  type PointMutationAttemptReplacementOptionsV1,
  type PointCommitPublicationCommandV1,
  type PointCommitPublicationResultV1,
  type PointCommitFinishingTransitionCommandV1,
  type PointCommitTransactionCommandV1,
  type PointCommitTransactionProofOptionsV1,
  type PointCommitTransactionProofStepV1,
} from "../src/pointCommitTransaction";
import {
  CommittedPointOutcomeSqlErrorV1,
  CommittedPointOutcomeRequestKeyReuseErrorV1,
  type CommittedPointOutcomeResolutionV1,
  type ResolveCommittedPointOutcomeErrorV1,
  type ResolveCommittedPointOutcomeInputV1,
} from "../src/committedPointOutcome";
import {
  pointCommitCommandFromStoredAttemptV1,
  pointCommitFinishingCommandFromStoredAttemptV1,
} from "./pointCommitTransactionTestSupport";
import {
  completeSessionJournalSeal as completeSeal,
  prepareSessionJournalSeal as prepareSeal,
  runEffect,
  runEffectFailure as runFailure,
  runSessionJournalPointOperation as runPointOperation,
} from "./effectTestRuntime";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
  activatePointMutationSession,
  pointMutationSessionActivationFixture,
  setFlarexActivationClock,
} from "./transactionSessionActivationTestSupport";

const sharedLocator = Object.freeze({
  kind: "shared_database",
  databaseKey: "stored-attempt-evidence-primary",
  schemaName: "public",
}) satisfies SharedDatabaseScopePhysicalLocator;
const encodeEnvelope = Schema.encodeSync(CommitEnvelopeV1Schema);

interface Scenario {
  readonly persistence: PGliteFlarexPersistence;
  readonly anchor: PointMutationSessionAnchorV1;
  readonly executionClaims: PointMutationExecutionClaimVaultV1;
  readonly executionScope: PointMutationExecutionScopeV1;
  readonly schemaVersionId: ReturnType<
    typeof CatalogSchemaVersionIdSchema.make
  >;
  readonly store: SessionJournalStorePersistenceV1;
  readonly attempt: SessionJournalAttemptV1;
  readonly loader: StoredAttemptFinishingEvidenceLoaderV1;
  readonly authority: StoredAttemptEvidenceAuthorityV1;
}

describe("C04A bounded stored-attempt evidence loader", () => {
  let persistence: PGliteFlarexPersistence;
  let uuidCounter = 1;

  beforeAll(async () => {
    persistence = await createPGlitePersistence();
    await persistence.migrate();
  });

  it("loads running+sealed evidence through the test-only structural seam", async () => {
    type RootLeak = Extract<
      keyof typeof persistenceRoot,
      "createStoredAttemptEvidenceLoaderV1" | "StoredAttemptEvidenceV1"
    >;
    expectTypeOf<RootLeak>().toEqualTypeOf<never>();
    expect("createStoredAttemptEvidenceLoaderV1" in persistenceRoot).toBe(
      false,
    );

    let afterRepeatableRead = false;
    const current = await scenario("running_sealed", {
      afterRepeatableRead: () => {
        afterRepeatableRead = true;
      },
    });
    const envelope = await seal(current);
    const before = await timestamps(current.anchor.sessionId);

    const executorPort: StoredAttemptEvidenceLoaderPortV1 = current.loader;
    expectTypeOf(executorPort).toMatchTypeOf<
      StoredAttemptEvidenceLoaderPortV1
    >();
    const result = await runEffect(executorPort.loadEffect(current.authority));

    expect(afterRepeatableRead).toBe(true);
    expect(result.kind).toBe("loaded");
    if (result.kind !== "loaded") throw new Error("Expected loaded evidence.");
    expect(result.evidence.session.lifecycle).toBe("running");
    expect(result.evidence.root.journalBytes.byteLength).toBeGreaterThan(0);
    expect(bytesToHex(result.evidence.root.journalSha256)).toBe(
      envelope.journalSha256Hex,
    );
    expect(result.evidence.root.sealedFinalSyscallSequence).toBe(0n);
    expect(result.evidence.points).toEqual([]);
    expect(await timestamps(current.anchor.sessionId)).toEqual(before);
  });

  it("maps foreign authority failures into the typed persistence channel", async () => {
    const current = await scenario("typed_authority_failure");
    const cause = new Error("stored-attempt metadata unavailable");
    const basePorts = resolutionPorts(persistence);
    const loader = createStoredAttemptEvidenceLoaderV1({
      ...basePorts,
      scopeMetadata: {
        getScopeMetadataByDeploymentId: async () => {
          throw cause;
        },
      },
    });

    const failure = await runFailure(loader.loadEffect(current.authority));
    expect(failure).toBeInstanceOf(StoredAttemptEvidencePersistenceV1Error);
    expect(failure).toMatchObject({
      _tag: "StoredAttemptEvidencePersistenceV1Error",
      operation: "scopeMetadataRead",
      cause,
    });
  });

  it.each(["running", "committed", "aborted"] as const)(
    "returns typed corruption for an Application-authority %s session",
    async lifecycle => {
    const current = await scenario(`application_authority_${lifecycle}`);
    if (lifecycle === "running") await seal(current);
    await persistence.query(
      `update fx_system_tx_session
          set execution_authority_generation = 'application_v1',
              lifecycle = $1,
              package_id = null,
              artifact_runtime = null,
              artifact_id = null,
              source_package_hash = null,
              execution_module = null,
              application_execution_authority_json = '{}'::jsonb,
              application_execution_authority_canonical_bytes = $2,
              application_execution_authority_sha256 = $3
        where session_id = $4`,
      [lifecycle, new Uint8Array([1]), new Uint8Array(32), current.anchor.sessionId],
    );
    await expect(runEffect(current.loader.loadEffect(current.authority)))
      .resolves.toMatchObject({
        kind: "corrupt",
        reason: "sessionRecordInvalid",
      });
    },
  );

  it("loads an exact canonical Application-authority session", async () => {
    const current = await scenario("application_authority_exact");
    await seal(current);
    const authority = await applicationExecutionAuthority(
      current.anchor.scopeId,
      current.schemaVersionId,
    );
    await persistence.query(
      `update fx_system_tx_session
          set execution_authority_generation = 'application_v1',
              package_id = null,
              artifact_runtime = null,
              artifact_id = null,
              source_package_hash = null,
              execution_module = null,
              application_execution_authority_json = $1::jsonb,
              application_execution_authority_canonical_bytes = $2,
              application_execution_authority_sha256 = $3
        where session_id = $4`,
      [
        JSON.stringify(authority.authorityJson),
        authority.canonicalBytes,
        authority.sha256,
        current.anchor.sessionId,
      ],
    );
    const loaded = await runEffect(current.loader.loadEffect(current.authority));
    expect(loaded.kind).toBe("loaded");
    if (loaded.kind !== "loaded") throw new Error("Expected loaded evidence.");
    expect(loaded.evidence.session.executionAuthorityGeneration).toBe(
      "application_v1",
    );
    if (loaded.evidence.session.executionAuthorityGeneration !== "application_v1") {
      throw new Error("Expected Application authority.");
    }
    expect(bytesToHex(
      loaded.evidence.session.applicationExecutionAuthoritySha256,
    )).toBe(bytesToHex(authority.sha256));
    expect(Object.isFrozen(
      loaded.evidence.session.applicationExecutionAuthorityJson,
    )).toBe(true);
    expect(Object.isFrozen(
      loaded.evidence.session.applicationExecutionAuthorityJson.runtimeTarget,
    )).toBe(true);
  });

  it("enters finishing only for the exact stored Application authority", async () => {
    const current = await scenario("application_authority_finishing");
    await seal(current);
    const authority = await applicationExecutionAuthority(
      current.anchor.scopeId,
      current.schemaVersionId,
    );
    await persistence.query(
      `update fx_system_tx_session
          set execution_authority_generation = 'application_v1',
              package_id = null,
              artifact_runtime = null,
              artifact_id = null,
              source_package_hash = null,
              execution_module = null,
              application_execution_authority_json = $1::jsonb,
              application_execution_authority_canonical_bytes = $2,
              application_execution_authority_sha256 = $3
        where session_id = $4`,
      [
        JSON.stringify(authority.authorityJson),
        authority.canonicalBytes,
        authority.sha256,
        current.anchor.sessionId,
      ],
    );
    const loaded = await runEffect(current.loader.loadEffect(current.authority));
    if (loaded.kind !== "loaded") throw new Error("Expected loaded evidence.");
    const exact = await pointCommitFinishingCommandFromStoredAttemptV1(
      current.authority,
      loaded.evidence,
    );
    const port = createPointCommitFinishingTransitionPortV1(
      resolutionPorts(persistence),
    );

    const wrongDigest = Object.freeze({
      ...exact,
      authorityPins: Object.freeze({
        ...exact.authorityPins,
        applicationExecutionAuthoritySha256: new Uint8Array(32).fill(0xff),
      }),
    }) as PointCommitFinishingTransitionCommandV1;
    await expect(runFailure(port.enterFinishing(wrongDigest))).resolves
      .toMatchObject({
        _tag: "PointCommitCorruptionV1Error",
        reason: "commandInvalid",
      });

    const mixed = Object.freeze({
      ...exact,
      authorityPins: Object.freeze({
        ...exact.authorityPins,
        packageId: "legacy-substitution",
      }),
    }) as unknown as PointCommitFinishingTransitionCommandV1;
    await expect(runFailure(port.enterFinishing(mixed))).resolves
      .toMatchObject({
        _tag: "PointCommitCorruptionV1Error",
        reason: "commandInvalid",
      });

    const unknownPins = Object.freeze({
      ...exact,
      authorityPins: Object.freeze({
        ...exact.authorityPins,
        executionAuthorityGeneration: "unknown_v1",
      }),
    }) as unknown as PointCommitFinishingTransitionCommandV1;
    await expect(runFailure(port.enterFinishing(unknownPins))).resolves
      .toMatchObject({
        _tag: "PointCommitCorruptionV1Error",
        reason: "commandInvalid",
      });

    const unknownSession = Object.freeze({
      ...exact,
      session: Object.freeze({
        ...exact.session,
        executionAuthorityGeneration: "unknown_v1",
      }),
    }) as unknown as PointCommitFinishingTransitionCommandV1;
    await expect(runFailure(port.enterFinishing(unknownSession))).resolves
      .toMatchObject({
        _tag: "PointCommitCorruptionV1Error",
        reason: "commandInvalid",
      });

    const callerOwnedDigest =
      exact.authorityPins.applicationExecutionAuthoritySha256;
    if (callerOwnedDigest === undefined) {
      throw new Error("Expected Application authority digest.");
    }
    const detachedPort = createPointCommitFinishingTransitionPortV1(
      resolutionPorts(persistence),
      {
        afterTransactionStep: async ({ step }) => {
          if (step === "clockLocked") callerOwnedDigest.fill(0xee);
        },
      },
    );
    await expect(runEffect(detachedPort.enterFinishing(exact))).resolves
      .toMatchObject({ kind: "transitioned" });
    expect(callerOwnedDigest).toEqual(new Uint8Array(32).fill(0xee));
  });

  it("loads a sealed lease promoted to a hard expiry below the grant", async () => {
    const current = await scenario("hard_before_grant");
    const updated = await persistence.query<{ hard_expires_at: Date }>(
      `
        update fx_system_tx_session
        set hard_expires_at = clock_timestamp() + interval '30 minutes'
        where session_id = $1
        returning hard_expires_at
      `,
      [current.anchor.sessionId],
    );
    const hardExpiresAt = updated.rows[0]?.hard_expires_at;
    if (hardExpiresAt === undefined) {
      throw new Error("Expected the shortened hard expiry.");
    }
    await seal(current);

    const result = await runEffect(current.loader.loadEffect(current.authority));
    if (result.kind !== "loaded") throw new Error("Expected loaded evidence.");
    expect(result.evidence.lease.leaseExpiresAtMilliseconds).toBe(
      hardExpiresAt.getTime(),
    );
    expect(result.evidence.session.hardExpiresAtMilliseconds).toBe(
      hardExpiresAt.getTime(),
    );
    expect(
      result.evidence.session.authorizationGrantExpiresAtMilliseconds,
    ).toBeGreaterThan(hardExpiresAt.getTime());
  });

  it("does not observe interruption until the repeatable-read edge settles", async () => {
    const current = await scenario("repeatable_read_interruption");
    await seal(current);
    const entered = deferredSignal();
    const release = deferredSignal();
    let interruptionSettled = false;
    const loader = createStoredAttemptEvidenceLoaderV1(
      resolutionPorts(persistence),
      {
        beforeRepeatableReadClose: async () => {
          entered.resolve();
          await release.promise;
        },
      },
    );

    const fiber = Effect.runFork(loader.loadEffect(current.authority));
    await entered.promise;
    const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
      interruptionSettled = true;
      return exit;
    });
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      expect(interruptionSettled).toBe(false);
    } finally {
      release.resolve();
    }
    await interruption;
    expect(interruptionSettled).toBe(true);
    expect(Exit.hasInterrupts(await runEffect(Fiber.await(fiber)))).toBe(true);
  });

  it("accepts finishing+sealed for reconstruction but rejects every other lifecycle", async () => {
    const finishing = await scenario("finishing_sealed");
    await seal(finishing);
    const runningEvidence = await runEffect(
      finishing.loader.loadEffect(finishing.authority),
    );
    if (runningEvidence.kind !== "loaded") {
      throw new Error("Expected running evidence before C05-A transition.");
    }
    await runEffect(
      createPointCommitFinishingTransitionPortV1(
        resolutionPorts(persistence),
      ).enterFinishing(
        await pointCommitFinishingCommandFromStoredAttemptV1(
          finishing.authority,
          runningEvidence.evidence,
        ),
      ),
    );
    const finishingResult = await runEffect(
      finishing.loader.loadFinishingEffect(
        selectorFromAnchor(finishing.anchor),
      ),
    );
    expect(finishingResult).toMatchObject({
      kind: "loaded",
      evidence: { session: { lifecycle: "finishing" } },
    });

    const running = await scenario("running_recovery_rejected");
    await seal(running);
    await expect(runEffect(running.loader.loadFinishingEffect(
      selectorFromAnchor(running.anchor),
    ))).resolves.toMatchObject({
      kind: "notPlannable",
      reason: "lifecycle",
      lifecycle: "running",
    });

    const committed = await scenario("committed_observation");
    await seal(committed);
    await setLifecycle(committed.anchor.sessionId, "committed");
    await persistence.query(
      "delete from fx_system_snapshot_lease where session_id = $1",
      [committed.anchor.sessionId],
    );
    await expect(runEffect(committed.loader.loadFinishingEffect(
      selectorFromAnchor(committed.anchor),
    ))).resolves
      .toMatchObject({ kind: "alreadyCommitted" });

    const otherLifecycles: ReadonlyArray<TransactionSessionLifecycleV1> = [
      "created",
      "committing",
      "retrying",
      "aborted",
      "expired",
    ];
    for (const lifecycle of otherLifecycles) {
      const current = await scenario(`lifecycle_${lifecycle}`);
      await seal(current);
      await setLifecycle(current.anchor.sessionId, lifecycle);
      await persistence.query(
        "delete from fx_system_snapshot_lease where session_id = $1",
        [current.anchor.sessionId],
      );
      await expect(runEffect(current.loader.loadFinishingEffect(
        selectorFromAnchor(current.anchor),
      ))).resolves
        .toMatchObject({
          kind: "notPlannable",
          reason: "lifecycle",
          lifecycle,
        });
    }
  });

  it("rejects every open/failed root for both accepted active lifecycles", async () => {
    for (const lifecycle of ["running", "finishing"] as const) {
      for (const rootState of ["open", "failed"] as const) {
        const current = await scenario(`root_${lifecycle}_${rootState}`);
        if (lifecycle === "finishing") {
          await setLifecycle(current.anchor.sessionId, lifecycle);
          await persistence.query(
            "delete from fx_system_tx_execution_claim where session_id = $1",
            [current.anchor.sessionId],
          );
        }
        if (rootState === "failed") {
          await persistence.query(
            `
              update fx_system_tx_journal
              set state = 'failed',
                  failure_dimension = 'readDocuments',
                  updated_at = clock_timestamp()
              where session_id = $1
            `,
            [current.anchor.sessionId],
          );
        }
        const load = lifecycle === "running"
          ? current.loader.loadEffect(current.authority)
          : current.loader.loadFinishingEffect(
            selectorFromAnchor(current.anchor),
          );
        await expect(runEffect(load)).resolves
          .toMatchObject({
            kind: "notPlannable",
            reason: "rootNotSealed",
            rootState,
          });
      }
    }
  });

  it("fails closed when an active sealed attempt loses its lease or root", async () => {
    const missingLease = await scenario("missing_lease");
    await seal(missingLease);
    await persistence.query(
      "delete from fx_system_snapshot_lease where session_id = $1",
      [missingLease.anchor.sessionId],
    );
    await expect(runEffect(
      missingLease.loader.loadEffect(missingLease.authority),
    )).resolves
      .toMatchObject({
        kind: "corrupt",
        reason: "snapshotLeaseMissingOrDuplicate",
      });

    const missingRoot = await scenario("missing_root");
    await seal(missingRoot);
    await persistence.query(
      "delete from fx_system_tx_journal where session_id = $1",
      [missingRoot.anchor.sessionId],
    );
    await expect(runEffect(
      missingRoot.loader.loadEffect(missingRoot.authority),
    )).resolves
      .toMatchObject({
        kind: "corrupt",
        reason: "journalRootMissingOrDuplicate",
      });

    const nonTargetLease = await scenario("sealed_non_target_lease");
    await seal(nonTargetLease);
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set lease_expires_at = lease_expires_at - interval '1 second'
        where session_id = $1
      `,
      [nonTargetLease.anchor.sessionId],
    );
    await expect(runEffect(
      nonTargetLease.loader.loadEffect(nonTargetLease.authority),
    )).resolves.toMatchObject({
      kind: "corrupt",
      reason: "snapshotLeaseInvalid",
    });
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set lease_expires_at = clock_timestamp() - interval '1 second'
        where session_id = $1
      `,
      [nonTargetLease.anchor.sessionId],
    );
    await expect(runEffect(
      nonTargetLease.loader.loadEffect(nonTargetLease.authority),
    )).resolves.toMatchObject({
      kind: "corrupt",
      reason: "snapshotLeaseInvalid",
    });
  });

  it("uses database time and rejects expired or replaced exact attempts", async () => {
    const expired = await scenario("lease_expired");
    await seal(expired);
    await persistence.query(
      `
        update fx_system_tx_session
        set created_at = '1999-01-01T00:00:00.000Z',
            authorization_grant_expires_at = '2000-01-01T00:00:00.000Z',
            hard_expires_at = '2000-01-01T00:00:00.000Z'
        where session_id = $1
      `,
      [expired.anchor.sessionId],
    );
    await persistence.query(
      `
        update fx_system_snapshot_lease
        set lease_expires_at = '2000-01-01T00:00:00.000Z'
        where session_id = $1
      `,
      [expired.anchor.sessionId],
    );
    await expect(runEffect(expired.loader.loadEffect(expired.authority))).resolves
      .toMatchObject({ kind: "notPlannable", reason: "expired" });

    const replaced = await scenario("attempt_replaced");
    await seal(replaced);
    await expect(runEffect(replaced.loader.loadEffect({
      ...replaced.authority,
      attemptFence: TransactionAttemptFenceSchema.make(
        replaced.authority.attemptFence + 1n,
      ),
    }))).resolves.toMatchObject({
      kind: "authorityMismatch",
      reason: "attemptReplaced",
    });
  });

  it("rejects stale generation, epoch, snapshot, schema, and revocation pins", async () => {
    const current = await scenario("stale_pins");
    await seal(current);
    const staleAuthorities: ReadonlyArray<Readonly<{
      authority: StoredAttemptEvidenceAuthorityV1;
      reason: string;
    }>> = [
      {
        authority: {
          ...current.authority,
          storageGenerationFence: StorageGenerationFenceSchema.make(99n),
        },
        reason: "generationChanged",
      },
      {
        authority: {
          ...current.authority,
          snapshotToken: SnapshotTokenSchema.make({
            ...current.authority.snapshotToken,
            epoch: ScopeEpochSchema.make("epoch_stale_c04a"),
          }),
        },
        reason: "epochChanged",
      },
      {
        authority: {
          ...current.authority,
          snapshotToken: SnapshotTokenSchema.make({
            ...current.authority.snapshotToken,
            commitSeq: CommitSeqSchema.make(
              current.authority.snapshotToken.commitSeq + 1n,
            ),
          }),
        },
        reason: "snapshotChanged",
      },
      {
        authority: {
          ...current.authority,
          schemaVersionId: CatalogSchemaVersionIdSchema.make("schema_stale"),
        },
        reason: "schemaChanged",
      },
    ];
    for (const stale of staleAuthorities) {
      await expect(runEffect(
        current.loader.loadEffect(stale.authority),
      )).resolves
        .toMatchObject({ kind: "authorityMismatch", reason: stale.reason });
    }

    await setFlarexActivationClock(persistence, current.anchor.scopeId, {
      storageGenerationFence: current.anchor.storageGenerationFence,
      lastCommitSeq: current.anchor.snapshotToken.commitSeq,
      authorizationRevocationEpoch: 1n,
    });
    await expect(runEffect(
      current.loader.loadEffect(current.authority),
    )).resolves
      .toMatchObject({
        kind: "authorityMismatch",
        reason: "revocationEpochChanged",
      });
  });

  it("keeps malformed detached lease scalars in the corruption result", async () => {
    const current = await scenario("malformed_lease_commit_seq");
    await seal(current);
    await persistence.exec(`
      alter table fx_system_snapshot_lease
        drop constraint fx_system_snapshot_lease_commit_seq_check
    `);
    try {
      await persistence.query(
        `
          update fx_system_snapshot_lease
          set snapshot_commit_seq = -1
          where session_id = $1
        `,
        [current.anchor.sessionId],
      );
      const result = await runEffect(
        current.loader.loadEffect(current.authority),
      );
      expect(result).toMatchObject({
        kind: "corrupt",
        reason: "sessionRecordInvalid",
      });
      if (result.kind !== "corrupt") {
        throw new Error("Expected malformed lease corruption.");
      }
      expect(Schema.isSchemaError(result.cause)).toBe(true);
    } finally {
      await persistence.query(
        `
          update fx_system_snapshot_lease
          set snapshot_commit_seq = $1
          where session_id = $2
        `,
        [current.anchor.snapshotToken.commitSeq, current.anchor.sessionId],
      );
      await persistence.exec(`
        alter table fx_system_snapshot_lease
          add constraint fx_system_snapshot_lease_commit_seq_check
          check (snapshot_commit_seq >= 0)
      `);
    }
  });

  it("keeps malformed legacy execution authority in the corruption result", async () => {
    const current = await scenario("malformed_legacy_authority");
    await seal(current);
    const constraintRows = await persistence.query<Readonly<{
      definition: string;
    }>>(
      `select pg_get_constraintdef(oid) as definition
         from pg_constraint
        where conname = 'fx_system_tx_session_execution_authority_check'`,
    );
    const constraintDefinition = constraintRows.rows[0]?.definition;
    if (constraintDefinition === undefined) {
      throw new Error("Missing execution-authority constraint definition.");
    }
    await persistence.exec(`
      alter table fx_system_tx_session
        drop constraint fx_system_tx_session_execution_authority_check
    `);
    try {
      await persistence.query(
        `update fx_system_tx_session
            set package_id = ''
          where session_id = $1`,
        [current.anchor.sessionId],
      );
      await expect(runEffect(current.loader.loadEffect(current.authority)))
        .resolves.toMatchObject({
          kind: "corrupt",
          reason: "sessionRecordInvalid",
        });
    } finally {
      await persistence.query(
        `update fx_system_tx_session
            set package_id = $1
          where session_id = $2`,
        ["package_activation_v1", current.anchor.sessionId],
      );
      await persistence.exec(`
        alter table fx_system_tx_session
          add constraint fx_system_tx_session_execution_authority_check
          ${constraintDefinition}
      `);
    }
  });

  it("returns at most max+1 point rows and rejects overflow before decoding it", async () => {
    const current = await scenario("point_overflow");
    await seal(current);
    await persistence.query(
      `
        insert into fx_system_tx_journal_point (
          scope_uuid,
          session_id,
          attempt_fence,
          table_id,
          row_id,
          dependency_kind,
          dependency_revision_commit_seq,
          overlay_kind,
          created_at,
          updated_at
        )
        select
          scope_uuid,
          session_id,
          attempt_fence,
          generated_id,
          decode(lpad(to_hex(generated_id), 32, '0'), 'hex'),
          'missing_no_visible_revision',
          null,
          'none',
          created_at,
          updated_at
        from fx_system_tx_journal
        cross join generate_series(1, 4097) as generated_id
        where session_id = $1
      `,
      [current.anchor.sessionId],
    );

    await expect(runEffect(
      current.loader.loadEffect(current.authority),
    )).resolves
      .toMatchObject({ kind: "corrupt", reason: "pointEvidenceOverflow" });
  });

  it("detaches journal, result, and point bytes from driver-owned rows", async () => {
    const current = await scenario("detached_bytes");
    const table = await runEffect(
      current.store.resolvePointTableEffect(current.attempt, "users"),
    );
    await runPointOperation(current.store, table, {
      kind: "insert",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      fields: { name: "detached" },
    });
    await seal(current);
    const first = await runEffect(current.loader.loadEffect(current.authority));
    if (first.kind !== "loaded") throw new Error("Expected loaded evidence.");
    const firstPoint = first.evidence.points[0];
    if (firstPoint === undefined) throw new Error("Expected point evidence.");
    first.evidence.root.journalBytes.fill(0);
    first.evidence.root.resultBytes.fill(0);
    firstPoint.rowId.fill(0);
    firstPoint.overlayValueBytes?.fill(0);

    const second = await runEffect(
      current.loader.loadEffect(current.authority),
    );
    if (second.kind !== "loaded") throw new Error("Expected loaded evidence.");
    expect(second.evidence.root.journalBytes.some((byte) => byte !== 0)).toBe(
      true,
    );
    expect(second.evidence.root.resultBytes.some((byte) => byte !== 0)).toBe(
      true,
    );
    expect(second.evidence.points[0]?.rowId.some((byte) => byte !== 0)).toBe(
      true,
    );
    expect(
      second.evidence.points[0]?.overlayValueBytes?.some((byte) => byte !== 0),
    ).toBe(true);
  });

  it("size-projects C04B1 authority evidence before bounded payload transfer", async () => {
    const current = await scenario("commit_authority_capture");
    await seal(current);
    const authenticatedEvidence = await runEffect(
      current.loader.loadEffect(current.authority),
    );
    if (authenticatedEvidence.kind !== "loaded") {
      throw new Error("Expected C04A evidence.");
    }
    const authority = commitAuthorityFromStoredEvidence(
      current.authority,
      authenticatedEvidence.evidence,
    );
    const queries: StoredCommitAuthorityEvidenceQueryV1["name"][] = [];
    let transactionClosed = false;
    const loader = createStoredCommitAuthorityEvidenceLoaderV1(
      resolutionPorts(persistence),
      {
        observeQuery: (query) => queries.push(query.name),
        afterRepeatableRead: () => {
          transactionClosed = true;
        },
      },
    );
    const result = await runEffect(loader.loadEffect(authority));

    expect(transactionClosed).toBe(true);
    expect(result.kind).toBe("loaded");
    expect(queries.indexOf("authoritySizes")).toBeLessThan(
      queries.indexOf("authorityPayload"),
    );
    expect(queries.indexOf("schemaSizes")).toBeLessThan(
      queries.indexOf("schemaPayload"),
    );
    expect(queries).not.toContain("activePackageId");
    if (result.kind !== "loaded") throw new Error("Expected C04B1 evidence.");
    expect(result.evidence.schema.schemaVersionId).toBe(
      current.schemaVersionId,
    );
    expect(result.evidence.schema.stableBindings).toEqual([
      { logicalName: "users", tableId: 1 },
    ]);
    result.evidence.session.validatedArgsCanonicalBytes.fill(0);
    const second = await runEffect(loader.loadEffect(authority));
    if (second.kind !== "loaded") throw new Error("Expected detached reload.");
    expect(
      second.evidence.session.validatedArgsCanonicalBytes.some(
        (byte) => byte !== 0,
      ),
    ).toBe(true);
  });

  it("does not observe interruption until authority capture settles", async () => {
    const current = await scenario("commit_authority_interruption");
    await seal(current);
    const authenticatedEvidence = await runEffect(
      current.loader.loadEffect(current.authority),
    );
    if (authenticatedEvidence.kind !== "loaded") {
      throw new Error("Expected C04A evidence.");
    }
    const authority = commitAuthorityFromStoredEvidence(
      current.authority,
      authenticatedEvidence.evidence,
    );
    const entered = deferredSignal();
    const release = deferredSignal();
    let interruptionSettled = false;
    const loader = createStoredCommitAuthorityEvidenceLoaderV1(
      resolutionPorts(persistence),
      {
        afterSizeProjection: async () => {
          entered.resolve();
          await release.promise;
        },
      },
    );

    const fiber = Effect.runFork(loader.loadEffect(authority));
    await entered.promise;
    const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
      interruptionSettled = true;
      return exit;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(interruptionSettled).toBe(false);
    release.resolve();
    await interruption;
    expect(interruptionSettled).toBe(true);
    const exit = await runEffect(Fiber.await(fiber));
    expect(Exit.hasInterrupts(exit)).toBe(true);
  });

  it("rejects stored JSON text whose parsed value leaves the JSON domain", async () => {
    const current = await scenario("commit_authority_non_finite_json");
    await seal(current);
    const authenticatedEvidence = await runEffect(
      current.loader.loadEffect(current.authority),
    );
    if (authenticatedEvidence.kind !== "loaded") {
      throw new Error("Expected C04A evidence.");
    }
    const authority = commitAuthorityFromStoredEvidence(
      current.authority,
      authenticatedEvidence.evidence,
    );
    await persistence.query(
      `
        update fx_system_tx_session
        set validated_args_json = '{"nested": 1e400}'::jsonb
        where session_id = $1
      `,
      [current.anchor.sessionId],
    );

    const loader = createStoredCommitAuthorityEvidenceLoaderV1(
      resolutionPorts(persistence),
    );
    await expect(runEffect(loader.loadEffect(authority))).resolves.toMatchObject({
      kind: "corrupt",
      reason: "sessionEvidenceInvalid",
    });
  });

  it("composes C03 through private C04C1 after both SQL captures close", async () => {
    let storedSqlClosed = false;
    const current = await c04b2Scenario("commit_input_composition", {
      afterRepeatableRead: () => {
        storedSqlClosed = true;
      },
    });
    const table = await runEffect(
      current.store.resolvePointTableEffect(current.attempt, "users"),
    );
    const insertedThenDeleted = await runPointOperation(current.store, table, {
      kind: "insert",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      fields: { name: "transient" },
    });
    if (
      insertedThenDeleted.kind !== "completed" ||
      insertedThenDeleted.outcome.kind !== "inserted"
    ) {
      throw new Error("Expected the transient insert to complete.");
    }
    await expect(runPointOperation(current.store, table, {
      kind: "delete",
      syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
      documentId: insertedThenDeleted.outcome.documentId,
    })).resolves.toMatchObject({ kind: "completed" });
    await expect(runPointOperation(current.store, table, {
      kind: "insert",
      syscallSequence: CommitSyscallSequenceV1Schema.make(3n),
      fields: { name: "material" },
    })).resolves.toMatchObject({
      kind: "completed",
      outcome: { kind: "inserted" },
    });
    const envelope = await seal(current);
    const loadedAttempt = await runEffect(current.loading.load({
      deploymentId: current.anchor.deploymentId,
      scopeId: current.anchor.scopeId,
      sessionId: current.anchor.sessionId,
      attemptFence: current.anchor.attemptFence.toString(),
    }));
    const storedEvidence = await runEffect(
      current.loader.loadEffect(current.authority),
    );
    if (storedEvidence.kind !== "loaded") {
      throw new Error("Expected stored insert/delete evidence to load.");
    }
    expect(storedEvidence.evidence.points).toHaveLength(2);
    expect(storedEvidence.evidence.points).toEqual(expect.arrayContaining([
      expect.objectContaining({
        dependencyKind: "missing_no_visible_revision",
        overlayKind: "deleted",
      }),
      expect.objectContaining({
        dependencyKind: "missing_no_visible_revision",
        overlayKind: "live",
      }),
    ]));
    storedSqlClosed = false;
    let authoritySqlClosed = false;
    let schemaDecodeAfterSqlClose = false;
    let metadataAfterSqlClose = false;
    let authorityQueries = 0;
    let metadataLoads = 0;
    const authorityLoader = createStoredCommitAuthorityEvidenceLoaderV1(
      resolutionPorts(persistence),
      {
        observeQuery: () => {
          authorityQueries += 1;
        },
        afterRepeatableRead: () => {
          authoritySqlClosed = true;
        },
        beforeSchemaArtifactDecode: () => {
          schemaDecodeAfterSqlClose = authoritySqlClosed;
        },
      },
    );
    const pointCommitSteps: string[] = [];
    const authentication = createStoredPointCommitFinishingTransitionV1(
      current.loader,
      {
        evidenceLoader: authorityLoader,
        transactionGrantVerifier: current.verifier,
        functionMetadata: {
          load: () => {
            metadataLoads += 1;
            metadataAfterSqlClose = authoritySqlClosed;
            return Effect.succeed(structuredClone(current.functionSnapshot));
          },
        },
        pointCommit: createPointCommitPublisherPortV1(
          resolutionPorts(persistence),
          {
            afterTransactionStep: (event) => {
              pointCommitSteps.push(event.step);
              return Promise.resolve();
            },
          },
        ),
        pointCommitFinishing: createPointCommitFinishingTransitionPortV1(
          resolutionPorts(persistence),
        ),
      },
      current.executionClaims,
    );
    expect("reconstructPointCommitFinishing" in authentication).toBe(false);
    expect("finishPointCommit" in authentication).toBe(false);
    expect("resumePointCommit" in authentication).toBe(false);
    const authority = await runEffect(
      authentication.deriveAuthority(loadedAttempt, current.executionScope),
    );
    const stored = await runEffect(authentication.authenticate(
      authority,
      encodeEnvelope(envelope),
    ));
    const commitAuthority = await runEffect(
      authentication.authenticateCommitAuthority(stored),
    );
    const beforeVerification = { authorityQueries, metadataLoads };
    const verified = await runEffect(
      authentication.verifyCommitInput(commitAuthority),
    );
    const prepared = await runEffect(
      authentication.planPointCommit(verified),
    );
    const finishing = await runEffect(
      authentication.enterPointCommitFinishing(prepared),
    );
    const rollbackProof = await runEffect(
      authentication.provePointCommitRollback(finishing),
    );

    expect(storedSqlClosed).toBe(true);
    expect(authoritySqlClosed).toBe(true);
    expect(schemaDecodeAfterSqlClose).toBe(true);
    expect(metadataAfterSqlClose).toBe(true);
    expect(authentication.isCommitInputVerified(verified)).toBe(true);
    expect(authentication.isPointCommitPrepared(prepared)).toBe(true);
    expect({ authorityQueries, metadataLoads }).toEqual(beforeVerification);
    expect(rollbackProof).toEqual({ kind: "wouldCommit" });
    expect(pointCommitSteps).toContain("tentativeRowWritten");
    const durable = await persistence.query<{
      revisions: string;
      current_rows: string;
      last_commit_seq: string;
    }>(
      `
        select
          (select count(*)::text from fx_app_row_rev
            where scope_uuid = $1) as revisions,
          (select count(*)::text from fx_app_row_current
            where scope_uuid = $1) as current_rows,
          last_commit_seq::text
        from fx_system_scope_clock
        where scope_uuid = $1
      `,
      [storedEvidence.evidence.scopeUuid],
    );
    expect(durable.rows[0]).toEqual({
      revisions: "0",
      current_rows: "0",
      last_commit_seq: "0",
    });
  });

  it("publishes one point mutation atomically and replays it without authority", async () => {
    const prepared = await prepareO07BScenario(
      "o07b_publish_replay",
      async (current, table) => {
        await persistence.query(
          `
            with shortened_authority as (
              update fx_system_tx_session
              set hard_expires_at =
                authorization_grant_expires_at - interval '5 seconds'
              where session_id = $1
              returning scope_uuid, session_id, attempt_fence, hard_expires_at
            )
            update fx_system_snapshot_lease as lease
            set lease_expires_at =
              authority.hard_expires_at - interval '1 second'
            from shortened_authority as authority
            where lease.scope_uuid = authority.scope_uuid
              and lease.session_id = authority.session_id
              and lease.attempt_fence = authority.attempt_fence
          `,
          [current.anchor.sessionId],
        );
        await expect(runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "published" },
        })).resolves.toMatchObject({
          kind: "completed",
          outcome: { kind: "inserted" },
        });
      },
    );
    const promoted = await persistence.query<{
      authorization_grant_expires_at: Date;
      hard_expires_at: Date;
      lease_expires_at: Date;
    }>(
      `
        select
          session.authorization_grant_expires_at,
          session.hard_expires_at,
          lease.lease_expires_at
        from fx_system_tx_session as session
        join fx_system_snapshot_lease as lease
          on lease.scope_uuid = session.scope_uuid
         and lease.session_id = session.session_id
         and lease.attempt_fence = session.attempt_fence
        where session.session_id = $1
      `,
      [prepared.current.anchor.sessionId],
    );
    const promotedRow = promoted.rows[0];
    if (promotedRow === undefined) {
      throw new Error("Expected promoted O07-B seal authority.");
    }
    expect(promotedRow.lease_expires_at.getTime()).toBe(
      promotedRow.hard_expires_at.getTime(),
    );
    expect(promotedRow.authorization_grant_expires_at.getTime())
      .toBeGreaterThan(promotedRow.hard_expires_at.getTime());
    const published = await runEffect(
      prepared.authentication.publishPointCommit(prepared.plan),
    );
    expect(published).toMatchObject({
      kind: "published",
      token: { scopeUuid: prepared.scopeUuid, commitSeq: 1n },
      successfulResult: { valueJson: { ok: true } },
    });
    expect(await o06DurableState(prepared.scopeUuid)).toEqual({
      revisions: "1",
      current_rows: "1",
      commit_headers: "1",
      commit_changes: "1",
      outcomes: "1",
      wakes: "1",
      last_commit_seq: "1",
      last_outbox_seq: "1",
    });
    const terminal = await o07bTerminalState(
      prepared.scopeUuid,
      prepared.current.anchor.sessionId,
    );
    expect(terminal).toEqual({
      lifecycle: "committed",
      leases: "0",
      journals: "0",
      receipts: "0",
      points: "0",
      write_events: "0",
    });

    if (published.kind !== "published") {
      throw new Error("Expected the initial O07-B publication.");
    }
    const callerBytes = published.successfulResult.canonicalBytes;
    callerBytes.fill(0);
    const replayed = await runEffect(
      prepared.authentication.publishPointCommit(prepared.plan),
    );
    expect(replayed).toMatchObject({
      kind: "replayed",
      token: published.token,
      successfulResult: { valueJson: { ok: true } },
    });
    expect(replayed.kind === "replayed"
      ? replayed.successfulResult.canonicalBytes
      : new Uint8Array()).not.toEqual(callerBytes);
    expect(await o06DurableState(prepared.scopeUuid)).toMatchObject({
      revisions: "1",
      commit_headers: "1",
      outcomes: "1",
      wakes: "1",
      last_commit_seq: "1",
      last_outbox_seq: "1",
    });
  });

  it("composes a genuine O07-B OCC conflict through O08-A into one O08-B1 rerun authority", async () => {
    const current = await c04b2Scenario("o08b1_pglite");
    const table = await runEffect(
      current.store.resolvePointTableEffect(current.attempt, "users"),
    );
    await expect(runPointOperation(current.store, table, {
      kind: "insert",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      fields: { name: "conflicted" },
    })).resolves.toMatchObject({
      kind: "completed",
      outcome: { kind: "inserted" },
    });
    const envelope = await seal(current);
    const loadedAttempt = await runEffect(current.loading.load({
      deploymentId: current.anchor.deploymentId,
      scopeId: current.anchor.scopeId,
      sessionId: current.anchor.sessionId,
      attemptFence: current.anchor.attemptFence.toString(),
    }));
    const stored = await runEffect(current.loader.loadEffect(current.authority));
    if (stored.kind !== "loaded") {
      throw new Error("Expected stored O08-B1 evidence.");
    }
    const replacementExecutionClaim = Object.freeze({
      claimOwner: TransactionExecutionClaimOwnerV1Schema.make(
        "91000000-0000-4000-8000-000000000008",
      ),
      claimFence: TransactionExecutionClaimFenceV1Schema.make(1n),
    });
    const authentication = createO08B1Authentication(current, {}, {
      randomExecutionClaimOwner: () => replacementExecutionClaim.claimOwner,
    });
    const authority = await runEffect(authentication.deriveAuthority(
      loadedAttempt,
      current.executionScope,
    ));
    const authenticated = await runEffect(authentication.authenticate(
      authority,
      encodeEnvelope(envelope),
    ));
    const commitAuthority = await runEffect(
      authentication.authenticateCommitAuthority(authenticated),
    );
    const verified = await runEffect(
      authentication.verifyCommitInput(commitAuthority),
    );
    const running = await runEffect(authentication.planPointCommit(verified));
    const finishing = await runEffect(
      authentication.enterPointCommitFinishing(running),
    );
    const finishingStored = await runEffect(
      current.loader.loadFinishingEffect({
        deploymentId: current.anchor.deploymentId,
        scopeId: current.anchor.scopeId,
        sessionId: current.anchor.sessionId,
        attemptFence: current.anchor.attemptFence,
      }),
    );
    if (finishingStored.kind !== "loaded") {
      throw new Error("Expected finishing O08-B1 evidence.");
    }
    const competingCommand = await pointCommitCommandFromStoredAttemptV1(
      current.authority,
      finishingStored.evidence,
    );
    await commitCompetingPointRow(competingCommand);
    const conflict = await runFailure(
      authentication.publishPointCommit(finishing),
    );
    expect(conflict).toBeInstanceOf(PointCommitConflictV1Error);

    const result = await runEffect(
      authentication.authorizePointMutationOccRerun(conflict).pipe(
        Effect.provideService(Random.Random, {
          nextDoubleUnsafe: () => 0,
          nextIntUnsafe: () => 0,
        }),
      ),
    );
    expect(result).toMatchObject({
      kind: "authorized",
      backoffUpperBoundMilliseconds: 100,
      backoffMilliseconds: 0,
    });
    if (result.kind !== "authorized") {
      throw new Error("Expected the O08-B1 authorization result.");
    }
    const executionQueries: string[] = [];
    let executionCaptureClosed = false;
    const executionEvidence = await runEffect(
      createStoredOccExecutionEvidenceLoaderV1(resolutionPorts(persistence), {
        observeQuery: (query) => executionQueries.push(query.name),
        afterRepeatableRead: () => {
          executionCaptureClosed = true;
        },
      }).loadEffect({
        kind: "occRerun",
        deploymentId: current.anchor.deploymentId,
        scopeId: current.anchor.scopeId,
        scopeUuid: finishingStored.evidence.scopeUuid,
        sessionId: current.anchor.sessionId,
        attemptFence: TransactionAttemptFenceSchema.make(
          current.anchor.attemptFence + 1n,
        ),
        storageGeneration: current.authority.storageGeneration,
        storageGenerationFence: current.authority.storageGenerationFence,
        snapshotToken: SnapshotTokenSchema.make({
          scopeId: current.anchor.scopeId,
          epoch: current.anchor.snapshotToken.epoch,
          commitSeq: CommitSeqSchema.make(1n),
        }),
        schemaVersionId: current.schemaVersionId,
        executionClaim: replacementExecutionClaim,
        previousSession: finishingStored.evidence.session,
      }),
    );
    expect(executionCaptureClosed).toBe(true);
    expect(executionQueries).toContain("attemptChildren");
    expect(executionQueries.indexOf("authoritySizes")).toBeLessThan(
      executionQueries.indexOf("authorityPayload"),
    );
    expect(executionEvidence).toMatchObject({ kind: "loaded" });
    if (executionEvidence.kind !== "loaded") {
      throw new Error("Expected open O08-B2a execution evidence.");
    }
    expect(executionEvidence.evidence.creationTimeSeed).toBeGreaterThan(0);
    expect(executionEvidence.evidence.session.lifecycle).toBe("running");
    executionEvidence.evidence.session.validatedArgsCanonicalBytes.fill(0);
    const detachedReload = await runEffect(
      createStoredOccExecutionEvidenceLoaderV1(
        resolutionPorts(persistence),
      ).loadEffect({
        kind: "occRerun",
        deploymentId: current.anchor.deploymentId,
        scopeId: current.anchor.scopeId,
        scopeUuid: finishingStored.evidence.scopeUuid,
        sessionId: current.anchor.sessionId,
        attemptFence: TransactionAttemptFenceSchema.make(
          current.anchor.attemptFence + 1n,
        ),
        storageGeneration: current.authority.storageGeneration,
        storageGenerationFence: current.authority.storageGenerationFence,
        snapshotToken: SnapshotTokenSchema.make({
          scopeId: current.anchor.scopeId,
          epoch: current.anchor.snapshotToken.epoch,
          commitSeq: CommitSeqSchema.make(1n),
        }),
        schemaVersionId: current.schemaVersionId,
        executionClaim: replacementExecutionClaim,
        previousSession: finishingStored.evidence.session,
      }),
    );
    expect(
      detachedReload.kind === "loaded" &&
        detachedReload.evidence.session.validatedArgsCanonicalBytes.some(
          (byte) => byte !== 0,
        ),
    ).toBe(true);
    const inspection =
      authentication.consumeAuthorizedPointMutationOccRerunForTest(
        result.rerun,
      );
    expect(inspection).toMatchObject({
      previousAttemptFence: current.anchor.attemptFence,
      attemptFence: current.anchor.attemptFence + 1n,
      previousSnapshotToken: current.anchor.snapshotToken,
      snapshotToken: {
        epoch: current.anchor.snapshotToken.epoch,
        commitSeq: 1n,
      },
      conflictingCommitSeq: 1n,
    });
    const state = await persistence.query<{
      lifecycle: string;
      attempt_fence: string;
      lease_count: string;
      root_state: string;
      last_syscall_sequence: string;
      receipt_count: string;
      point_count: string;
      event_count: string;
    }>(
      `
        select session.lifecycle,
          session.attempt_fence::text,
          (select count(*)::text from fx_system_snapshot_lease lease
            where lease.scope_uuid = session.scope_uuid
              and lease.session_id = session.session_id
              and lease.attempt_fence = session.attempt_fence) as lease_count,
          journal.state as root_state,
          journal.last_syscall_sequence::text,
          (select count(*)::text from fx_system_tx_journal_latest_receipt receipt
            where receipt.scope_uuid = session.scope_uuid
              and receipt.session_id = session.session_id
              and receipt.attempt_fence = session.attempt_fence) as receipt_count,
          (select count(*)::text from fx_system_tx_journal_point point
            where point.scope_uuid = session.scope_uuid
              and point.session_id = session.session_id
              and point.attempt_fence = session.attempt_fence) as point_count,
          (select count(*)::text from fx_system_tx_journal_write_event event
            where event.scope_uuid = session.scope_uuid
              and event.session_id = session.session_id
              and event.attempt_fence = session.attempt_fence) as event_count
        from fx_system_tx_session session
        join fx_system_tx_journal journal
          on journal.scope_uuid = session.scope_uuid
          and journal.session_id = session.session_id
          and journal.attempt_fence = session.attempt_fence
        where session.scope_uuid = $1 and session.session_id = $2
      `,
      [stored.evidence.scopeUuid, current.anchor.sessionId],
    );
    expect(state.rows[0]).toEqual({
      lifecycle: "running",
      attempt_fence: "2",
      lease_count: "1",
      root_state: "open",
      last_syscall_sequence: "0",
      receipt_count: "0",
      point_count: "0",
      event_count: "0",
    });
  });

  it("consumes O08-B1 once and publishes through the same-process runtime-neutral B2a path", async () => {
    let runnerCalls = 0;
    const observedContexts: Array<
      Parameters<PointMutationOccRuntimeNeutralRunnerV1["run"]>[0]["context"]
    > = [];
    let prepared: Awaited<ReturnType<typeof prepareO08B1Conflict>>;
    const runner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
      run: (
        input: Parameters<PointMutationOccRuntimeNeutralRunnerV1["run"]>[0],
      ): ReturnType<PointMutationOccRuntimeNeutralRunnerV1["run"]> =>
        Effect.gen(function* () {
          runnerCalls += 1;
          observedContexts.push(input.context);
          const table = yield* input.journal.resolvePointTable("users");
          const inserted = yield* input.journal.runPointOperation(table, {
            kind: "insert",
            syscallSequence: "1",
            fields: { name: "retried" },
          });
          if (
            inserted.kind !== "completed" ||
            inserted.outcome.kind !== "inserted"
          ) {
            return yield* Effect.fail(
              new PointMutationOccUserCodeV1Error({
                cause: new Error("Expected the B2a retry insert to complete."),
              }),
            );
          }
          const insertedOutcome = inserted.outcome;
          if (!isCanonicalFlarexRuntimeObjectV1(insertedOutcome.document)) {
            return yield* Effect.fail(
              new PointMutationOccUserCodeV1Error({
                cause: new Error("Expected the B2a inserted app document."),
              }),
            );
          }
          const insertedDocument = insertedOutcome.document;
          if (runnerCalls === 1) {
            const identity = decodeAppDocumentIdentityV1(
              insertedOutcome.documentId,
            );
            yield* Effect.tryPromise({
              try: () =>
                commitCompetingLiveIntent(
                  prepared.current.anchor.scopeId,
                  prepared.current.schemaVersionId,
                  prepared.scopeUuid,
                  Object.freeze({
                    kind: "live" as const,
                    tableId: identity.tableId,
                    rowId: identity.rowId,
                    creationTime: decodeAppCreationTimeV1(
                      insertedDocument._creationTime,
                    ),
                    value: insertedDocument,
                  }),
                ),
              catch: (cause) => new PointMutationOccUserCodeV1Error({ cause }),
            });
          }
          return Object.freeze({ ok: true });
        }),
    });
    prepared = await prepareO08B1Conflict("o08b2a_pglite_success", {}, runner);
    const authorized = await runEffect(
      prepared.authentication
        .authorizePointMutationOccRerun(prepared.conflict)
        .pipe(
          Effect.provideService(Random.Random, {
            nextDoubleUnsafe: () => 0,
            nextIntUnsafe: () => 0,
          }),
        ),
    );
    if (authorized.kind !== "authorized") {
      throw new Error("Expected an authorized O08-B2a handoff.");
    }

    const published = await runEffect(
      prepared.authentication
        .executeAuthorizedPointMutationOccRerun(authorized.rerun)
        .pipe(
          Effect.provideService(Random.Random, {
            nextDoubleUnsafe: () => 0,
            nextIntUnsafe: () => 0,
          }),
        ),
    );
    expect(published).toMatchObject({
      kind: "published",
      token: { scopeUuid: prepared.scopeUuid, commitSeq: 3n },
      successfulResult: {
        valueJson: { ok: true },
      },
    });
    expect(runnerCalls).toBe(2);
    expect(observedContexts).toMatchObject([
      {
        executionId: "o08-b2a-1",
        logScopeId: "o08-b2a-log-1",
        attemptFence: 2n,
        snapshotToken: { commitSeq: 1n },
      },
      {
        executionId: "o08-b2a-2",
        logScopeId: "o08-b2a-log-2",
        attemptFence: 3n,
        snapshotToken: { commitSeq: 2n },
      },
    ]);
    for (const [index, context] of observedContexts.entries()) {
      expect(context.executionTime).toBe(context.initialCreationTimeCursor);
      expect(context.randomSeed).toEqual(new Uint8Array(32).fill(index + 1));
    }
    expect(await o06DurableState(prepared.scopeUuid)).toEqual({
      revisions: "3",
      current_rows: "3",
      commit_headers: "3",
      commit_changes: "3",
      outcomes: "1",
      wakes: "1",
      last_commit_seq: "3",
      last_outbox_seq: "1",
    });
    expect(
      await o07bTerminalState(
        prepared.scopeUuid,
        prepared.current.anchor.sessionId,
      ),
    ).toEqual({
      lifecycle: "committed",
      leases: "0",
      journals: "0",
      receipts: "0",
      points: "0",
      write_events: "0",
    });
    expect(
      await runFailure(
        prepared.authentication.executeAuthorizedPointMutationOccRerun(
          authorized.rerun,
        ),
      ),
    ).toMatchObject({
      _tag: "InvalidAuthorizedPointMutationOccRerunV1Error",
      reason: "alreadyConsumed",
    });
  });

  it("keeps the genuine B2a attempt live across runner and publication work", async () => {
    let renewals = 0;
    const runner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
      run: () => Effect.sleep("25 millis").pipe(
        Effect.as(Object.freeze({ ok: true })),
      ),
    });
    const prepared = await prepareO08B1Conflict(
      "o08b2a_pglite_liveness",
      {},
      runner,
      undefined,
      undefined,
      undefined,
      () => {
        renewals += 1;
      },
      5,
    );
    const authorized = await runEffect(
      prepared.authentication
        .authorizePointMutationOccRerun(prepared.conflict)
        .pipe(
          Effect.provideService(Random.Random, {
            nextDoubleUnsafe: () => 0,
            nextIntUnsafe: () => 0,
          }),
        ),
    );
    if (authorized.kind !== "authorized") {
      throw new Error("Expected an authorized liveness handoff.");
    }
    await expect(runEffect(
      prepared.authentication.executeAuthorizedPointMutationOccRerun(
        authorized.rerun,
      ),
    )).resolves.toMatchObject({ kind: "published" });
    expect(renewals).toBeGreaterThanOrEqual(2);
  });

  it("fails before the B2a runner when current open-attempt authority is no longer exact", async () => {
    const cases = [
      Object.freeze({
        label: "advanced_root",
        mutate: (prepared: Awaited<ReturnType<typeof prepareO08B1Conflict>>) =>
          persistence.query(
            `
              update fx_system_tx_journal
              set last_syscall_sequence = 1
              where scope_uuid = $1 and session_id = $2
                and attempt_fence = 2
            `,
            [prepared.scopeUuid, prepared.current.anchor.sessionId],
          ),
        expected: Object.freeze({
          _tag: "PointMutationOccExecutionNotRunnableV1Error",
          reason: "notPristine",
        }),
      }),
      Object.freeze({
        label: "journal_children",
        mutate: (prepared: Awaited<ReturnType<typeof prepareO08B1Conflict>>) =>
          persistence.query(
            `
              insert into fx_system_tx_journal_point (
                scope_uuid, session_id, attempt_fence, table_id, row_id,
                dependency_kind, dependency_revision_commit_seq,
                overlay_kind, created_at, updated_at
              )
              select scope_uuid, session_id, attempt_fence, 1,
                decode(repeat('01', 16), 'hex'),
                'missing_no_visible_revision', null, 'none',
                created_at, updated_at
              from fx_system_tx_journal
              where scope_uuid = $1 and session_id = $2
                and attempt_fence = 2
            `,
            [prepared.scopeUuid, prepared.current.anchor.sessionId],
          ),
        expected: Object.freeze({
          _tag: "PointMutationOccExecutionAuthorityCorruptionV1Error",
          reason: "journalChildrenPresent",
        }),
      }),
      Object.freeze({
        label: "durable_retrying",
        mutate: (prepared: Awaited<ReturnType<typeof prepareO08B1Conflict>>) =>
          persistence.query(
            `
              update fx_system_tx_session
              set lifecycle = 'retrying'
              where scope_uuid = $1 and session_id = $2
                and attempt_fence = 2
            `,
            [prepared.scopeUuid, prepared.current.anchor.sessionId],
          ),
        expected: Object.freeze({
          _tag: "PointMutationExecutionClaimLivenessStaleV1Error",
          reason: "lifecycleChanged",
        }),
      }),
      Object.freeze({
        label: "future_root",
        mutate: (prepared: Awaited<ReturnType<typeof prepareO08B1Conflict>>) =>
          persistence.query(
            `
              update fx_system_tx_journal
              set created_at = created_at + interval '30 seconds',
                updated_at = updated_at + interval '30 seconds'
              where scope_uuid = $1 and session_id = $2
                and attempt_fence = 2
            `,
            [prepared.scopeUuid, prepared.current.anchor.sessionId],
          ),
        expected: Object.freeze({
          _tag: "PointMutationOccExecutionAuthorityCorruptionV1Error",
          reason: "journalRootInvalid",
        }),
      }),
      Object.freeze({
        label: "future_session",
        mutate: (prepared: Awaited<ReturnType<typeof prepareO08B1Conflict>>) =>
          persistence.query(
            `
              update fx_system_tx_session
              set updated_at = updated_at + interval '30 seconds'
              where scope_uuid = $1 and session_id = $2
                and attempt_fence = 2
            `,
            [prepared.scopeUuid, prepared.current.anchor.sessionId],
          ),
        expected: Object.freeze({
          _tag: "PointMutationOccExecutionAuthorityCorruptionV1Error",
          reason: "sessionEvidenceInvalid",
        }),
      }),
      Object.freeze({
        label: "prior_session",
        mutate: (prepared: Awaited<ReturnType<typeof prepareO08B1Conflict>>) =>
          persistence.query(
            `
              update fx_system_tx_session
              set function_path = 'users:changed'
              where scope_uuid = $1 and session_id = $2
                and attempt_fence = 2
            `,
            [prepared.scopeUuid, prepared.current.anchor.sessionId],
          ),
        expected: Object.freeze({
          _tag: "PointMutationOccExecutionAuthorityMismatchV1Error",
          reason: "sessionChanged",
        }),
      }),
      Object.freeze({
        label: "canonical_arguments",
        mutate: (prepared: Awaited<ReturnType<typeof prepareO08B1Conflict>>) =>
          persistence.query(
            `
              update fx_system_tx_session
              set validated_args_json = '{"tampered": true}'::jsonb
              where scope_uuid = $1 and session_id = $2
            `,
            [prepared.scopeUuid, prepared.current.anchor.sessionId],
          ),
        expected: Object.freeze({
          _tag: "StoredCommitAuthorityCorruptionV1Error",
          reason: "validatedArgumentsInvalid",
        }),
      }),
      Object.freeze({
        label: "revocation_epoch",
        mutate: (prepared: Awaited<ReturnType<typeof prepareO08B1Conflict>>) =>
          persistence.query(
            `
              update fx_system_scope_clock
              set authorization_revocation_epoch =
                authorization_revocation_epoch + 1
              where scope_uuid = $1
            `,
            [prepared.scopeUuid],
          ),
        expected: Object.freeze({
          _tag: "PointMutationExecutionClaimLivenessStaleV1Error",
          reason: "revocationEpochChanged",
        }),
      }),
    ] as const;

    for (const currentCase of cases) {
      let runnerCalls = 0;
      const runner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
        run: () => {
          runnerCalls += 1;
          return Effect.succeed(Object.freeze({ ok: true }));
        },
      });
      const prepared = await prepareO08B1Conflict(
        `o08b2a_${currentCase.label}`,
        {},
        runner,
      );
      const authorized = await runEffect(
        prepared.authentication
          .authorizePointMutationOccRerun(prepared.conflict)
          .pipe(
            Effect.provideService(Random.Random, {
              nextDoubleUnsafe: () => 0,
              nextIntUnsafe: () => 0,
            }),
          ),
      );
      if (authorized.kind !== "authorized") {
        throw new Error("Expected an authorized B2a negative fixture.");
      }
      await currentCase.mutate(prepared);
      const failure = await runFailure(
        prepared.authentication.executeAuthorizedPointMutationOccRerun(
          authorized.rerun,
        ),
      );
      expect(failure).toMatchObject(currentCase.expected);
      expect(runnerCalls).toBe(0);
      expect(
        await runFailure(
          prepared.authentication.executeAuthorizedPointMutationOccRerun(
            authorized.rerun,
          ),
        ),
      ).toMatchObject({
        _tag: "InvalidAuthorizedPointMutationOccRerunV1Error",
        reason: "alreadyConsumed",
      });
    }
  });

  it("normalizes a no-return B2a success to null and publishes a zero-row commit", async () => {
    const runner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
      run: () => Effect.succeed(undefined),
    });
    const prepared = await prepareO08B1Conflict(
      "o08b2a_undefined_result",
      {},
      runner,
      undefined,
      { type: "any" },
    );
    const authorized = await runEffect(
      prepared.authentication
        .authorizePointMutationOccRerun(prepared.conflict)
        .pipe(
          Effect.provideService(Random.Random, {
            nextDoubleUnsafe: () => 0,
            nextIntUnsafe: () => 0,
          }),
        ),
    );
    if (authorized.kind !== "authorized") {
      throw new Error("Expected the zero-row B2a fixture to authorize.");
    }

    const published = await runEffect(
      prepared.authentication.executeAuthorizedPointMutationOccRerun(
        authorized.rerun,
      ),
    );
    expect(published).toMatchObject({
      kind: "published",
      token: { scopeUuid: prepared.scopeUuid, commitSeq: 2n },
      successfulResult: { valueJson: null },
    });
    expect(await o06DurableState(prepared.scopeUuid)).toEqual({
      revisions: "1",
      current_rows: "1",
      commit_headers: "2",
      commit_changes: "1",
      outcomes: "1",
      wakes: "1",
      last_commit_seq: "2",
      last_outbox_seq: "1",
    });
  });

  it("rejects forged and cross-factory B2a handles without consuming genuine authority", async () => {
    const runner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
      run: () => Effect.succeed(Object.freeze({ ok: true })),
    });
    const prepared = await prepareO08B1Conflict(
      "o08b2a_handle_authority",
      {},
      runner,
    );
    const authorized = await runEffect(
      prepared.authentication
        .authorizePointMutationOccRerun(prepared.conflict)
        .pipe(
          Effect.provideService(Random.Random, {
            nextDoubleUnsafe: () => 0,
            nextIntUnsafe: () => 0,
          }),
        ),
    );
    if (authorized.kind !== "authorized") {
      throw new Error("Expected the B2a handle fixture to authorize.");
    }

    expect(
      await runFailure(
        Reflect.apply(
          prepared.authentication.executeAuthorizedPointMutationOccRerun,
          prepared.authentication,
          [Object.freeze({})],
        ),
      ),
    ).toMatchObject({
      _tag: "InvalidAuthorizedPointMutationOccRerunV1Error",
      reason: "notSameFactory",
    });
    const crossFactory = createO08B1Authentication(
      prepared.current,
      {},
      {},
      runner,
    );
    expect(
      await runFailure(
        crossFactory.executeAuthorizedPointMutationOccRerun(authorized.rerun),
      ),
    ).toMatchObject({
      _tag: "InvalidAuthorizedPointMutationOccRerunV1Error",
      reason: "notSameFactory",
    });

    await expect(
      runEffect(
        prepared.authentication.executeAuthorizedPointMutationOccRerun(
          authorized.rerun,
        ),
      ),
    ).resolves.toMatchObject({ kind: "published" });
  });

  it("closes on an authoritative replay or expiry that appears after B1 replacement", async () => {
    for (const outcomeKind of ["available", "expired"] as const) {
      let runnerCalls = 0;
      const runner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
        run: () => {
          runnerCalls += 1;
          return Effect.succeed(Object.freeze({ ok: true }));
        },
      });
      const prepared = await prepareO08B1Conflict(
        `o08b2a_outcome_${outcomeKind}`,
        {},
        runner,
      );
      const authorized = await runEffect(
        prepared.authentication
          .authorizePointMutationOccRerun(prepared.conflict)
          .pipe(
            Effect.provideService(Random.Random, {
              nextDoubleUnsafe: () => 0,
              nextIntUnsafe: () => 0,
            }),
          ),
      );
      if (authorized.kind !== "authorized") {
        throw new Error("Expected the outcome-race fixture to authorize.");
      }
      await injectB2aOutcome(prepared, outcomeKind);

      await expect(
        runEffect(
          prepared.authentication.executeAuthorizedPointMutationOccRerun(
            authorized.rerun,
          ),
        ),
      ).resolves.toMatchObject({
        kind: outcomeKind === "available" ? "replayed" : "expired",
        token: { scopeUuid: prepared.scopeUuid, commitSeq: 1n },
      });
      expect(runnerCalls).toBe(0);
    }
  });

  it("terminalizes the exact fresh attempt when B2a user code fails before finishing", async () => {
    const prepared = await prepareO08B1Conflict("o08b2a_user_failure");
    const authorized = await runEffect(
      prepared.authentication
        .authorizePointMutationOccRerun(prepared.conflict)
        .pipe(
          Effect.provideService(Random.Random, {
            nextDoubleUnsafe: () => 0,
            nextIntUnsafe: () => 0,
          }),
        ),
    );
    if (authorized.kind !== "authorized") {
      throw new Error("Expected the failed B2a fixture to authorize.");
    }
    expect(
      await runFailure(
        prepared.authentication.executeAuthorizedPointMutationOccRerun(
          authorized.rerun,
        ),
      ),
    ).toBeInstanceOf(PointMutationOccUserCodeV1Error);
    expect(
      await o07bTerminalState(
        prepared.scopeUuid,
        prepared.current.anchor.sessionId,
      ),
    ).toEqual({
      lifecycle: "aborted",
      leases: "0",
      journals: "0",
      receipts: "0",
      points: "0",
      write_events: "0",
    });
    expect(await o06DurableState(prepared.scopeUuid)).toEqual({
      revisions: "1",
      current_rows: "1",
      commit_headers: "1",
      commit_changes: "1",
      outcomes: "0",
      wakes: "0",
      last_commit_seq: "1",
      last_outbox_seq: "0",
    });
  });

  it("preserves journal boundary failures and terminalizes before finishing", async () => {
    const runner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
      run: (
        input: Parameters<PointMutationOccRuntimeNeutralRunnerV1["run"]>[0],
      ): ReturnType<PointMutationOccRuntimeNeutralRunnerV1["run"]> =>
        Effect.gen(function* () {
          const table = yield* input.journal.resolvePointTable("users");
          return yield* input.journal.runPointOperation(table, {
            kind: "scan",
          });
        }),
    });
    const prepared = await prepareO08B1Conflict(
      "o08b2a_journal_failure",
      {},
      runner,
    );
    const authorized = await runEffect(
      prepared.authentication
        .authorizePointMutationOccRerun(prepared.conflict)
        .pipe(
          Effect.provideService(Random.Random, {
            nextDoubleUnsafe: () => 0,
            nextIntUnsafe: () => 0,
          }),
        ),
    );
    if (authorized.kind !== "authorized") {
      throw new Error("Expected the journal-failure fixture to authorize.");
    }

    expect(
      await runFailure(
        prepared.authentication.executeAuthorizedPointMutationOccRerun(
          authorized.rerun,
        ),
      ),
    ).toMatchObject({
      _tag: "UnsupportedPointMutationJournalOperationV1Error",
      reason: "invalidKind",
      operationKind: "scan",
    });
    expect(
      await o07bTerminalState(
        prepared.scopeUuid,
        prepared.current.anchor.sessionId,
      ),
    ).toEqual({
      lifecycle: "aborted",
      leases: "0",
      journals: "0",
      receipts: "0",
      points: "0",
      write_events: "0",
    });
  });

  it("redispatches one expired pristine initial attempt and then closes on replay or expiry", async () => {
    const current = await c04b2Scenario("o08_b2b2a_initial_execute");
    const seedRows = await persistence.query<{ creation_time_seed: number }>(
      `select creation_time_seed
       from fx_system_tx_journal
       where session_id = $1 and attempt_fence = $2`,
      [current.anchor.sessionId, current.anchor.attemptFence],
    );
    const persistedCreationTimeSeed = seedRows.rows[0]?.creation_time_seed;
    if (persistedCreationTimeSeed === undefined) {
      throw new Error("Expected the initial persisted creation-time seed.");
    }
    await expireExactExecutionClaim(current.anchor.sessionId);

    const freshClaims = createPointMutationExecutionClaimVaultV1();
    const contexts: Array<
      Parameters<PointMutationOccRuntimeNeutralRunnerV1["run"]>[0]["context"]
    > = [];
    let executionCaptureClosed = false;
    let runnerCalls = 0;
    const authentication = createB2b2aRedispatchAuthentication(
      current,
      freshClaims,
      Object.freeze({
        run: (
          input: Parameters<PointMutationOccRuntimeNeutralRunnerV1["run"]>[0],
        ) => {
          expect(executionCaptureClosed).toBe(true);
          runnerCalls += 1;
          contexts.push(input.context);
          return Effect.succeed(Object.freeze({ ok: true }));
        },
      }),
      {
        randomOwner: () => "92000000-0000-4000-8000-000000000001",
        afterExecutionEvidenceRepeatableRead: () => {
          executionCaptureClosed = true;
        },
      },
    );
    const selector = selectorInputFromAnchor(current.anchor);

    await expect(runEffect(
      authentication.redispatchExactPointMutationAttempt(selector),
    )).resolves.toMatchObject({
      kind: "published",
      token: { commitSeq: 1n },
      successfulResult: { valueJson: { ok: true } },
    });
    expect(runnerCalls).toBe(1);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]).toMatchObject({
      executionId: "o08-b2b2a-1",
      logScopeId: "o08-b2b2a-log-1",
      attemptFence: 1n,
      snapshotToken: { commitSeq: 0n },
      executionTime: persistedCreationTimeSeed,
      initialCreationTimeCursor: persistedCreationTimeSeed,
    });
    expect(contexts[0]?.randomSeed).toEqual(new Uint8Array(32).fill(1));

    await expect(runEffect(
      authentication.redispatchExactPointMutationAttempt(selector),
    )).resolves.toMatchObject({
      kind: "replayed",
      token: { commitSeq: 1n },
    });
    expect(runnerCalls).toBe(1);

    await persistence.query(
      `update fx_system_idempotency
       set result_state = 'expired',
         result_value_codec_version = null,
         result_semantic_bytes = null,
         result_bytes = null,
         result_sha256 = null,
         result_expired_at = clock_timestamp()
       where scope_uuid = $1`,
      [projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid],
    );
    await expect(runEffect(
      authentication.redispatchExactPointMutationAttempt(selector),
    )).resolves.toMatchObject({
      kind: "expired",
      token: { commitSeq: 1n },
    });
    expect(runnerCalls).toBe(1);
    expect(await o06DurableState(
      projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid,
    )).toEqual({
      revisions: "0",
      current_rows: "0",
      commit_headers: "1",
      commit_changes: "0",
      outcomes: "1",
      wakes: "1",
      last_commit_seq: "1",
      last_outbox_seq: "1",
    });
  });

  it("composes initial-shaped and redelivery-shaped execution through one private exact-runtime binding runner", async () => {
    const bindingRequests: PointMutationExactRuntimeRequestV1[] = [];
    const journalTargets: unknown[] = [];
    let disposedResponses = 0;
    let ordinaryInvokeCalls = 0;
    const binding = Object.freeze({
      run: async (
        request: PointMutationExactRuntimeRequestV1,
        journal: Parameters<
          PointMutationExactRuntimeArtifactHostBindingV1["run"]
        >[1],
      ) => {
        bindingRequests.push(request);
        journalTargets.push(journal);
        return disposableExactRuntimeSuccessResponse(() => {
          disposedResponses += 1;
        });
      },
      fetch: async () => {
        ordinaryInvokeCalls += 1;
        throw new Error("The exact-runtime binding must not use Fetch.");
      },
    }) satisfies PointMutationExactRuntimeArtifactHostBindingV1 & Readonly<{
      readonly fetch: () => Promise<never>;
    }>;
    const runner = makePointMutationExactRuntimeBindingRunnerV1(binding);

    const initial = await prepareO08B1Conflict(
      "p02c3_initial_shaped",
      {},
      runner,
    );
    const authorized = await runEffect(
      initial.authentication
        .authorizePointMutationOccRerun(initial.conflict)
        .pipe(
          Effect.provideService(Random.Random, {
            nextDoubleUnsafe: () => 0,
            nextIntUnsafe: () => 0,
          }),
        ),
    );
    if (authorized.kind !== "authorized") {
      throw new Error("Expected the P02c.3 initial-shaped handoff to authorize.");
    }
    await expect(runEffect(
      initial.authentication.executeAuthorizedPointMutationOccRerun(
        authorized.rerun,
      ),
    )).resolves.toMatchObject({
      kind: "published",
      successfulResult: { valueJson: { ok: true } },
    });

    const redelivery = await c04b2Scenario("p02c3_redelivery_shaped");
    await expireExactExecutionClaim(redelivery.anchor.sessionId);
    const redeliveryGraph = createB2b2aRedispatchAuthentication(
      redelivery,
      createPointMutationExecutionClaimVaultV1(),
      runner,
      {
        randomOwner: () => "92000000-0000-4000-8000-000000000020",
      },
    );
    await expect(runEffect(
      redeliveryGraph.redispatchExactPointMutationAttempt(
        selectorInputFromAnchor(redelivery.anchor),
      ),
    )).resolves.toMatchObject({
      kind: "published",
      successfulResult: { valueJson: { ok: true } },
    });

    expect(bindingRequests).toHaveLength(2);
    expect(journalTargets).toHaveLength(2);
    expect(journalTargets[0]).not.toBe(journalTargets[1]);
    for (const journal of journalTargets) {
      expect(journal).toMatchObject({
        resolvePointTable: expect.any(Function),
      });
    }
    for (const request of bindingRequests) {
      expect(request).toMatchObject({
        artifact: { runtime: "dynamic-worker" },
        function: { path: "users:create", kind: "mutation" },
        auth: { kind: "anonymous" },
      });
      expect(request).not.toHaveProperty("session");
      expect(request).not.toHaveProperty("journal");
      expect(request).not.toHaveProperty("database");
      expect(request).not.toHaveProperty("retry");
    }
    for (const current of [initial.current, redelivery]) {
      const sessions = await persistence.query<{ session_count: string }>(
        `select count(*)::text as session_count
         from fx_system_tx_session
         where scope_uuid = $1`,
        [projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid],
      );
      expect(sessions.rows).toEqual([{ session_count: "1" }]);
    }
    expect(ordinaryInvokeCalls).toBe(0);
    expect(disposedResponses).toBe(2);
  });

  it("executes the original activated attempt through the private exact-runtime binding runner", async () => {
    const bindingRequests: PointMutationExactRuntimeRequestV1[] = [];
    const journalTargets: unknown[] = [];
    let disposedResponses = 0;
    let current:
      | Awaited<ReturnType<typeof c04b2ActivatedInitialScenario>>
      | undefined;
    const binding = Object.freeze({
      run: async (
        request: PointMutationExactRuntimeRequestV1,
        journal: Parameters<
          PointMutationExactRuntimeArtifactHostBindingV1["run"]
        >[1],
      ) => {
        bindingRequests.push(request);
        journalTargets.push(journal);
        const table = await journal.resolvePointTable("users");
        const inserted = await table.runPointOperation({
          kind: "insert",
          syscallSequence: "1",
          fields: { name: `initial-${bindingRequests.length}` },
        });
        if (inserted.kind !== "inserted") {
          throw new Error("Expected the exact-runtime insert to complete.");
        }
        if (bindingRequests.length === 1) {
          if (current === undefined) {
            throw new Error("Missing the initial exact-runtime scenario.");
          }
          if (!isCanonicalFlarexRuntimeObjectV1(inserted.document)) {
            throw new Error("Expected the inserted document projection.");
          }
          const identity = decodeAppDocumentIdentityV1(
            inserted.documentId,
          );
          await commitCompetingLiveIntent(
            current.anchor.scopeId,
            current.schemaVersionId,
            projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid,
            Object.freeze({
              kind: "live" as const,
              tableId: identity.tableId,
              rowId: identity.rowId,
              creationTime: decodeAppCreationTimeV1(
                inserted.document._creationTime,
              ),
              value: inserted.document,
            }),
          );
        }
        return disposableExactRuntimeSuccessResponse(() => {
          disposedResponses += 1;
        });
      },
    }) satisfies PointMutationExactRuntimeArtifactHostBindingV1;
    const runner = makePointMutationExactRuntimeBindingRunnerV1(binding);
    current = await c04b2ActivatedInitialScenario("p02c4b_initial_exact");
    const execution = createInitialPointMutationExecution(
      current,
      runner,
    );

    await expect(runFailure(
      execution.executeInitialPointMutationAttempt(
        Object.freeze({ ...current.activated }),
      ),
    )).resolves.toMatchObject({
      _tag: "InvalidActivatedPointMutationSessionV1Error",
    });
    expect(bindingRequests).toHaveLength(0);

    await expect(runEffect(
      execution.executeInitialPointMutationAttempt(current.activated),
    )).resolves.toMatchObject({
      kind: "published",
      successfulResult: { valueJson: { ok: true } },
    });

    expect(bindingRequests).toHaveLength(2);
    expect(journalTargets).toHaveLength(2);
    expect(journalTargets[0]).not.toBe(journalTargets[1]);
    for (const journal of journalTargets) {
      expect(journal).toMatchObject({
        resolvePointTable: expect.any(Function),
      });
    }
    for (const request of bindingRequests) {
      expect(request).toMatchObject({
        artifact: { runtime: "dynamic-worker" },
        function: { path: "users:create", kind: "mutation" },
        auth: { kind: "anonymous" },
      });
      expect(request).not.toHaveProperty("session");
      expect(request).not.toHaveProperty("journal");
      expect(request).not.toHaveProperty("database");
      expect(request).not.toHaveProperty("retry");
    }
    expect(disposedResponses).toBe(2);

    const sessions = await persistence.query<{ session_count: string }>(
      `select count(*)::text as session_count
       from fx_system_tx_session
       where scope_uuid = $1`,
      [projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid],
    );
    expect(sessions.rows).toEqual([{ session_count: "1" }]);
    await expect(runFailure(
      execution.executeInitialPointMutationAttempt(current.activated),
    )).resolves.toMatchObject({
      _tag: "InvalidPointMutationExecutionClaimV1Error",
      reason: "consumed",
    });
    expect(bindingRequests).toHaveLength(2);
  });

  it("discovers and redispatches one bounded page without returning result payloads", async () => {
    const current = await c04b2Scenario("o08_b2b2b2b1b2a_page");
    await expireExactExecutionClaim(current.anchor.sessionId);
    let runnerCalls = 0;
    const authentication = createB2b2aRedispatchAuthentication(
      current,
      createPointMutationExecutionClaimVaultV1(),
      Object.freeze({
        run: () => {
          runnerCalls += 1;
          return Effect.succeed(Object.freeze({ ok: true }));
        },
      }),
    );
    const redelivery = createPointMutationAttemptRedeliveryV1(
      pointMutationAttemptDiscovery(persistence),
      authentication,
    );

    const page = await runEffect(redelivery.sweepEffect({
      deploymentId: current.anchor.deploymentId,
      scopeId: current.anchor.scopeId,
      limit: 100,
    }));
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      candidate: {
        selector: selectorFromAnchor(current.anchor),
        source: "expiredClaim",
      },
      disposition: {
        kind: "published",
        token: { commitSeq: 1n },
      },
    });
    expect(page.items[0]?.disposition).not.toHaveProperty("successfulResult");
    expect(runnerCalls).toBe(1);

    await expect(runEffect(redelivery.sweepEffect({
      deploymentId: current.anchor.deploymentId,
      scopeId: current.anchor.scopeId,
      limit: 100,
    }))).resolves.toMatchObject({ items: [], continuation: null });
    expect(runnerCalls).toBe(1);
  });

  it("continues independent scopes after one typed failure and safely replays a fresh sweep", async () => {
    const first = await c04b2Scenario("o08_multi_scope_first");
    const second = await c04b2Scenario("o08_multi_scope_second");
    for (const current of [first, second]) {
      await expireExactExecutionClaim(current.anchor.sessionId);
    }
    let firstRunnerCalls = 0;
    let secondRunnerCalls = 0;
    const firstAuthentication = createB2b2aRedispatchAuthentication(
      first,
      createPointMutationExecutionClaimVaultV1(),
      Object.freeze({
        run: () => {
          firstRunnerCalls += 1;
          return Effect.succeed(Object.freeze({ ok: true }));
        },
      }),
    );
    const secondAuthentication = createB2b2aRedispatchAuthentication(
      second,
      createPointMutationExecutionClaimVaultV1(),
      Object.freeze({
        run: () => {
          secondRunnerCalls += 1;
          return Effect.succeed(Object.freeze({ ok: true }));
        },
      }),
    );
    const injectedFailure =
      new PointMutationExecutionClaimAcquisitionStaleV1Error({
        reason: "attemptReplaced",
      });
    let failSecond = true;
    const redelivery = createPointMutationAttemptRedeliveryV1(
      pointMutationAttemptDiscovery(persistence),
      Object.freeze({
        redispatchExactPointMutationAttempt: (input: unknown) => {
          const selector = decodePointMutationSessionAttemptSelectorV1(input);
          if (selector.scopeId === first.anchor.scopeId) {
            return firstAuthentication.redispatchExactPointMutationAttempt(
              input,
            );
          }
          if (failSecond) return Effect.fail(injectedFailure);
          return secondAuthentication.redispatchExactPointMutationAttempt(
            input,
          );
        },
      }),
    );
    const scopeCandidates = Object.freeze([first, second].map((current) =>
      Object.freeze({
        deploymentId: current.anchor.deploymentId,
        scopeId: current.anchor.scopeId,
      })
    ));
    const multiScope = createPointMutationMultiScopeRedeliveryV1(
      Object.freeze({
        discoverEffect: () => Effect.succeed(Object.freeze({
          candidates: scopeCandidates,
          continuation: null,
        })),
      }),
      redelivery,
    );
    const sweepInput = Object.freeze({
      scopeLimit: 100,
      maxAttemptPages: 2,
      maxCandidateAttempts: 2,
    });

    const firstScheduler = schedulerRun(
      persistence,
      "96000000-0000-4000-8000-000000000001",
      multiScope,
      sweepInput,
    );
    const partialRun = await runEffect(firstScheduler.runEffect());
    expect(partialRun.kind).toBe("completed");
    if (partialRun.kind !== "completed") {
      throw new Error("Expected the first scheduler run to complete.");
    }
    const partial = partialRun.batches[0]!;
    expect(partial.scopes.map((scope) => scope.kind)).toEqual([
      "processed",
      "failed",
    ]);
    expect(partial.scopes[1]).toMatchObject({
      kind: "failed",
      error: injectedFailure,
    });
    expect(partial.scopes[1]?.kind === "failed"
      ? partial.scopes[1].error
      : undefined).toBe(injectedFailure);
    expect(partial.continuation).toBeNull();
    expect(firstRunnerCalls).toBe(1);
    expect(secondRunnerCalls).toBe(0);

    failSecond = false;
    const recoveredScheduler = schedulerRun(
      persistence,
      "96000000-0000-4000-8000-000000000002",
      multiScope,
      sweepInput,
    );
    const recoveredRun = await runEffect(recoveredScheduler.runEffect());
    expect(recoveredRun.kind).toBe("completed");
    if (recoveredRun.kind !== "completed") {
      throw new Error("Expected the restarted scheduler run to complete.");
    }
    const recovered = recoveredRun.batches[0]!;
    expect(recovered.scopes.map((scope) =>
      scope.kind === "processed"
        ? scope.page.items[0]?.disposition.kind
        : scope.kind
    )).toEqual([undefined, "published"]);
    expect(firstRunnerCalls).toBe(1);
    expect(secondRunnerCalls).toBe(1);
    for (const current of [first, second]) {
      await expect(o06DurableState(
        projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid,
      )).resolves.toEqual({
        revisions: "0",
        current_rows: "0",
        commit_headers: "1",
        commit_changes: "0",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });
    }
  });

  it("keeps live claims busy and durably closes dirty-open and failed roots", async () => {
    let runnerCalls = 0;
    const runner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
      run: () => {
        runnerCalls += 1;
        return Effect.succeed(Object.freeze({ ok: true }));
      },
    });

    const live = await c04b2Scenario("o08_b2b2a_busy");
    const liveAuthentication = createB2b2aRedispatchAuthentication(
      live,
      createPointMutationExecutionClaimVaultV1(),
      runner,
    );
    await expect(runEffect(
      liveAuthentication.redispatchExactPointMutationAttempt(
        selectorInputFromAnchor(live.anchor),
      ),
    )).resolves.toEqual({ kind: "busy" });

    for (const state of ["dirtyOpen", "failedRoot"] as const) {
      const current = await c04b2Scenario(`o08_b2b2a_${state}`);
      const table = await runEffect(
        current.store.resolvePointTableEffect(current.attempt, "users"),
      );
      await runPointOperation(current.store, table, {
        kind: "insert",
        syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
        fields: { state },
      });
      if (state === "failedRoot") {
        await persistence.query(
          `update fx_system_tx_journal
           set state = 'failed', failure_dimension = 'readDocuments',
             updated_at = clock_timestamp()
           where session_id = $1`,
          [current.anchor.sessionId],
        );
      }
      await expireExactExecutionClaim(current.anchor.sessionId);
      const executionClaims = createPointMutationExecutionClaimVaultV1();
      let admittedBeforeAttemptLoad = false;
      let capturedAbortOnlyClaim: unknown;
      const baseAcquisition =
        createPointMutationExecutionClaimDispatchAcquisitionV1(
          createPointMutationExecutionClaimAcquisitionV1(
            resolutionPorts(persistence),
            {
              durationMilliseconds: 60_000,
              randomOwner: () => state === "dirtyOpen"
                ? "92000000-0000-4000-8000-000000000021"
                : "92000000-0000-4000-8000-000000000022",
            },
          ),
          executionClaims.issuer,
        );
      const acquisition = Object.freeze({
        acquireEffect: Effect.fn("Test.captureAbortOnlyClaim")((input) =>
          baseAcquisition.acquireEffect(input).pipe(
            Effect.tap((result) => Effect.sync(() => {
              if (result.kind === "acquired" && result.mode === "abortOnly") {
                capturedAbortOnlyClaim = result.executionClaim;
              }
            })),
          )
        ),
      } satisfies PointMutationExecutionClaimDispatchAcquisitionV1);
      const attemptLoading: PointMutationSessionAttemptLoadingV1 =
        Object.freeze({
          load: Effect.fn("Test.requireSynchronousAbortOnlyAdmission")((input) =>
            Effect.sync(() => {
              expect(capturedAbortOnlyClaim).toBeDefined();
              expect(executionClaims.abortOnlyAdmission.admit(
                capturedAbortOnlyClaim,
              )).toMatchObject({
                _tag: "Failure",
                failure: { reason: "consumed" },
              });
              admittedBeforeAttemptLoad = true;
            }).pipe(Effect.flatMap(() => current.loading.load(input)))
          ),
        });
      const authentication = createB2b2aRedispatchAuthentication(
        current,
        executionClaims,
        runner,
        {
          acquisition,
          attemptLoading,
        },
      );
      const closed = await runEffect(
        authentication.redispatchExactPointMutationAttempt(
          selectorInputFromAnchor(current.anchor),
        ),
      );
      expect(closed).toMatchObject({
        kind: "closed",
        reason: state,
        lifecycle: "aborted",
      });
      if (closed.kind !== "closed") {
        throw new Error("Expected durable non-dispatchable closure.");
      }
      expect(Date.parse(closed.terminalizedAt)).not.toBeNaN();
      expect(admittedBeforeAttemptLoad).toBe(true);
      await expect(o08DispositionState(
        projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid,
        current.anchor.sessionId,
      )).resolves.toEqual({
        lifecycle: "aborted",
        leases: "0",
        journals: "0",
        receipts: "0",
        points: "0",
        write_events: "0",
        claims: "0",
      });
      await expect(o06DurableState(
        projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid,
      )).resolves.toEqual({
        revisions: "0",
        current_rows: "0",
        commit_headers: "0",
        commit_changes: "0",
        outcomes: "0",
        wakes: "0",
        last_commit_seq: "0",
        last_outbox_seq: "0",
      });
      await expect(runEffect(
        pointMutationAttemptDiscovery(persistence).discoverEffect({
          deploymentId: current.anchor.deploymentId,
          scopeId: current.anchor.scopeId,
          limit: 100,
        }),
      )).resolves.toMatchObject({ candidates: [] });
      await expect(runFailure(
        authentication.redispatchExactPointMutationAttempt(
          selectorInputFromAnchor(current.anchor),
        ),
      )).resolves.toMatchObject({
        _tag: "PointMutationExecutionClaimAcquisitionStaleV1Error",
        reason: "lifecycle",
      });
    }
    expect(runnerCalls).toBe(0);
  });

  it("routes directly proven lease or authorization expiry through durable expiry", async () => {
    for (const expiry of ["lease", "authorization"] as const) {
      const current = await c04b2Scenario(
        `o08_b2b2a_${expiry}_expiry`,
      );
      if (expiry === "lease") {
        await persistence.query(
          `update fx_system_snapshot_lease as lease
           set lease_expires_at = session.created_at + interval '1 millisecond'
           from fx_system_tx_session as session
           where lease.scope_uuid = session.scope_uuid
             and lease.session_id = session.session_id
             and lease.session_id = $1`,
          [current.anchor.sessionId],
        );
      } else {
        await persistence.query(
          `update fx_system_tx_session
           set authorization_grant_expires_at =
               created_at + interval '1 millisecond',
             hard_expires_at = created_at + interval '1 millisecond'
           where session_id = $1`,
          [current.anchor.sessionId],
        );
        await persistence.query(
          `update fx_system_snapshot_lease as lease
           set lease_expires_at = session.hard_expires_at
           from fx_system_tx_session as session
           where lease.scope_uuid = session.scope_uuid
             and lease.session_id = session.session_id
             and lease.session_id = $1`,
          [current.anchor.sessionId],
        );
      }
      const authentication = createB2b2aRedispatchAuthentication(
        current,
        createPointMutationExecutionClaimVaultV1(),
        Object.freeze({
          run: () => Effect.die(new Error("expired attempts must not run")),
        }),
      );
      await expect(runEffect(
        authentication.redispatchExactPointMutationAttempt(
          selectorInputFromAnchor(current.anchor),
        ),
      )).resolves.toMatchObject({
        kind: "closed",
        reason: "authorityExpired",
        lifecycle: "expired",
      });
      await expect(o08DispositionState(
        projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid,
        current.anchor.sessionId,
      )).resolves.toEqual({
        lifecycle: "expired",
        leases: "0",
        journals: "0",
        receipts: "0",
        points: "0",
        write_events: "0",
        claims: "0",
      });
    }
  });

  it("preserves sealed evidence when an expired lease was not promoted", async () => {
    const current = await c04b2Scenario(
      "o08_b2b2a_expired_non_target_sealed_lease",
    );
    await seal(current);
    await persistence.query(
      `update fx_system_snapshot_lease
       set lease_expires_at = clock_timestamp() - interval '1 minute'
       where scope_uuid = $1 and session_id = $2`,
      [
        projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid,
        current.anchor.sessionId,
      ],
    );
    const scopeUuid = projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid;
    const dispositionBefore = await o08DispositionState(
      scopeUuid,
      current.anchor.sessionId,
    );
    const claimBefore = await executionClaimState(current.anchor.sessionId);
    let runnerCalls = 0;
    const authentication = createB2b2aRedispatchAuthentication(
      current,
      createPointMutationExecutionClaimVaultV1(),
      Object.freeze({
        run: () => {
          runnerCalls += 1;
          return Effect.succeed(Object.freeze({ ok: true }));
        },
      }),
    );

    await expect(runFailure(
      authentication.redispatchExactPointMutationAttempt(
        selectorInputFromAnchor(current.anchor),
      ),
    )).resolves.toMatchObject({
      _tag: "PointMutationExecutionClaimAcquisitionCorruptionV1Error",
      reason: "leaseInvalid",
    });
    expect(runnerCalls).toBe(0);
    await expect(o08DispositionState(
      scopeUuid,
      current.anchor.sessionId,
    )).resolves.toEqual(dispositionBefore);
    await expect(executionClaimState(current.anchor.sessionId)).resolves
      .toEqual(claimBefore);
  });

  it("finishes sealed running and durable finishing attempts without rerunning user code", async () => {
    let runnerCalls = 0;
    const runner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
      run: () => {
        runnerCalls += 1;
        return Effect.succeed(Object.freeze({ ok: true }));
      },
    });

    const sealed = await c04b2Scenario("o08_b2b2a_finish_only");
    await seal(sealed);
    await expireExactExecutionClaim(sealed.anchor.sessionId);
    const sealedAuthentication = createB2b2aRedispatchAuthentication(
      sealed,
      createPointMutationExecutionClaimVaultV1(),
      runner,
      { randomOwner: () => "92000000-0000-4000-8000-000000000002" },
    );
    await expect(runEffect(
      sealedAuthentication.redispatchExactPointMutationAttempt(
        selectorInputFromAnchor(sealed.anchor),
      ),
    )).resolves.toMatchObject({
      kind: "published",
      token: { commitSeq: 1n },
    });

    const finishing = await prepareO07BRunningScenario(
      "o08_b2b2a_finishing",
    );
    await runEffect(
      finishing.authentication.enterPointCommitFinishing(
        finishing.runningPlan,
      ),
    );
    const finishingAuthentication = createB2b2aRedispatchAuthentication(
      finishing.current,
      createPointMutationExecutionClaimVaultV1(),
      runner,
    );
    await expect(runEffect(
      finishingAuthentication.redispatchExactPointMutationAttempt(
        selectorInputFromAnchor(finishing.current.anchor),
      ),
    )).resolves.toMatchObject({
      kind: "published",
      token: { commitSeq: 1n },
    });

    expect(runnerCalls).toBe(0);
    for (const current of [sealed, finishing.current]) {
      expect(
        await o07bTerminalState(
          projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid,
          current.anchor.sessionId,
        ),
      ).toEqual({
        lifecycle: "committed",
        leases: "0",
        journals: "0",
        receipts: "0",
        points: "0",
        write_events: "0",
      });
      await expect(executionClaimState(current.anchor.sessionId)).resolves
        .toBeNull();
    }
  });

  it("reacquires the outcome once when finishing recovery crosses a concurrent commit", async () => {
    const finishing = await prepareO07BRunningScenario(
      "o08_b2b2a_finishing_race",
    );
    await runEffect(
      finishing.authentication.enterPointCommitFinishing(
        finishing.runningPlan,
      ),
    );
    const claims = createPointMutationExecutionClaimVaultV1();
    const baseAcquisition = createPointMutationExecutionClaimDispatchAcquisitionV1(
      createPointMutationExecutionClaimAcquisitionV1(
        resolutionPorts(persistence),
        { durationMilliseconds: 60_000 },
      ),
      claims.issuer,
    );
    const competingRecovery = createO07BAuthentication(finishing.current);
    const callerSelector = {
      ...selectorInputFromAnchor(finishing.current.anchor),
    };
    const acquisition: PointMutationExecutionClaimDispatchAcquisitionV1 =
      Object.freeze({
        acquireEffect: Effect.fn(
          "TestB2b2a.finishRecoveryRaceAcquisition",
          )((input: unknown) =>
            baseAcquisition.acquireEffect(input).pipe(
              Effect.tap((result) =>
                result.kind === "finishing"
                  ? Effect.gen(function* () {
                      callerSelector.sessionId =
                        "42000000-0000-4000-8000-000000008099";
                      yield* competingRecovery.resumePointCommit(input).pipe(
                        Effect.orDie,
                      );
                    })
                  : Effect.void,
              ),
            )),
      });
    let runnerCalls = 0;
    const authentication = createB2b2aRedispatchAuthentication(
      finishing.current,
      claims,
      Object.freeze({
        run: () => {
          runnerCalls += 1;
          return Effect.succeed(Object.freeze({ ok: true }));
        },
      }),
      { acquisition },
    );

    await expect(runEffect(
      authentication.redispatchExactPointMutationAttempt(
        callerSelector,
      ),
    )).resolves.toMatchObject({
      kind: "replayed",
      token: { commitSeq: 1n },
    });
    expect(callerSelector.sessionId).toBe(
      "42000000-0000-4000-8000-000000008099",
    );
    expect(runnerCalls).toBe(0);
    expect(
      await o07bTerminalState(
        finishing.scopeUuid,
        finishing.current.anchor.sessionId,
      ),
    ).toMatchObject({ lifecycle: "committed", journals: "0", leases: "0" });
  });

  it("rechecks attempt liveness after asynchronous context entropy allocation", async () => {
    let runnerCalls = 0;
    let prepared: Awaited<ReturnType<typeof prepareO08B1Conflict>>;
    const contextFactory: PointMutationOccExecutionContextFactoryV1 = {
      make: () =>
        Effect.promise(async () => {
          await persistence.query(
            `
            update fx_system_snapshot_lease
            set lease_expires_at = '2000-01-01T00:00:00.000Z'
            where scope_uuid = $1 and session_id = $2
              and attempt_fence = 2
          `,
            [prepared.scopeUuid, prepared.current.anchor.sessionId],
          );
          return Object.freeze({
            executionId: "o08-b2a-delayed-context",
            logScopeId: "o08-b2a-delayed-context-log",
            randomSeed: new Uint8Array(32).fill(7),
          });
        }),
    };
    const runner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
      run: () => {
        runnerCalls += 1;
        return Effect.succeed(Object.freeze({ ok: true }));
      },
    });
    prepared = await prepareO08B1Conflict(
      "o08b2a_context_liveness",
      {},
      runner,
      undefined,
      undefined,
      contextFactory,
    );
    const authorized = await runEffect(
      prepared.authentication
        .authorizePointMutationOccRerun(prepared.conflict)
        .pipe(
          Effect.provideService(Random.Random, {
            nextDoubleUnsafe: () => 0,
            nextIntUnsafe: () => 0,
          }),
        ),
    );
    if (authorized.kind !== "authorized") {
      throw new Error("Expected the delayed-context fixture to authorize.");
    }

    expect(
      await runFailure(
        prepared.authentication.executeAuthorizedPointMutationOccRerun(
          authorized.rerun,
        ),
      ),
    ).toMatchObject({
      _tag: "PointMutationSessionAttemptLoadV1Error",
      issue: { reason: "activeAttemptExpired" },
    });
    expect(runnerCalls).toBe(0);
  });

  it("keeps B2a runner execution interruptible and waits for exact abort settlement", async () => {
    const entered = deferredSignal();
    const abortEntered = deferredSignal();
    const runner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
      run: () =>
        Effect.sync(() => entered.resolve()).pipe(
          Effect.flatMap(() => Effect.never),
        ),
    });
    const prepared = await prepareO08B1Conflict(
      "o08b2a_runner_interrupt",
      {},
      runner,
      abortEntered.resolve,
    );
    const authorized = await runEffect(
      prepared.authentication
        .authorizePointMutationOccRerun(prepared.conflict)
        .pipe(
          Effect.provideService(Random.Random, {
            nextDoubleUnsafe: () => 0,
            nextIntUnsafe: () => 0,
          }),
        ),
    );
    if (authorized.kind !== "authorized") {
      throw new Error("Expected the interrupted B2a fixture to authorize.");
    }
    const fiber = Effect.runFork(
      prepared.authentication.executeAuthorizedPointMutationOccRerun(
        authorized.rerun,
      ),
    );
    const runnerOrExit = await Promise.race([
      entered.promise.then(() => Object.freeze({ kind: "entered" as const })),
      runEffect(Fiber.await(fiber)).then((exit) =>
        Object.freeze({ kind: "exit" as const, exit }),
      ),
    ]);
    if (runnerOrExit.kind === "exit") {
      throw new Error(
        Exit.isFailure(runnerOrExit.exit)
          ? Cause.pretty(runnerOrExit.exit.cause)
          : "B2a exited before invoking the runner.",
      );
    }
    const interruption = runEffect(Fiber.interrupt(fiber));
    await Promise.race([
      abortEntered.promise,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("B2a interruption never entered abort.")),
          500,
        ),
      ),
    ]);
    await Promise.race([
      interruption,
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("B2a abort did not settle interruption.")),
          1_000,
        ),
      ),
    ]);
    expect(Exit.hasInterrupts(await runEffect(Fiber.await(fiber)))).toBe(true);
    expect(
      await runFailure(
        prepared.authentication.executeAuthorizedPointMutationOccRerun(
          authorized.rerun,
        ),
      ),
    ).toMatchObject({
      _tag: "InvalidAuthorizedPointMutationOccRerunV1Error",
      reason: "alreadyConsumed",
    });
    expect(
      await o07bTerminalState(
        prepared.scopeUuid,
        prepared.current.anchor.sessionId,
      ),
    ).toMatchObject({
      lifecycle: "aborted",
      leases: "0",
      journals: "0",
    });
  });

  it("leaves a pristine non-authorizing attempt when interrupted after replacement settlement", async () => {
    const entered = deferredSignal();
    const release = deferredSignal();
    const prepared = await prepareO08B1Conflict(
      "o08b1_post_replace_interrupt",
      {
        afterReplacementStep: async (event) => {
          if (event.step !== "beforeCommit") return;
          entered.resolve();
          await release.promise;
        },
      },
    );
    const fiber = Effect.runFork(
      prepared.authentication.authorizePointMutationOccRerun(
        prepared.conflict,
      ).pipe(Effect.provideService(Random.Random, {
        nextDoubleUnsafe: () => 0,
        nextIntUnsafe: () => 0,
      })),
    );
    await entered.promise;
    let interruptionSettled = false;
    const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
      interruptionSettled = true;
      return exit;
    });
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 25));
      expect(interruptionSettled).toBe(false);
    } finally {
      release.resolve();
    }
    await interruption;
    expect(interruptionSettled).toBe(true);
    expect(Exit.hasInterrupts(await runEffect(Fiber.await(fiber)))).toBe(true);
    expect(await o08B1AttemptState(
      prepared.scopeUuid,
      prepared.current.anchor.sessionId,
    )).toEqual({
      lifecycle: "running",
      attempt_fence: "2",
      lease_count: "1",
      root_state: "open",
      last_syscall_sequence: "0",
      receipt_count: "0",
      point_count: "0",
      event_count: "0",
    });
    expect(await runFailure(
      prepared.authentication.authorizePointMutationOccRerun(
        prepared.conflict,
      ),
    )).toMatchObject({
      _tag: "InvalidPointMutationOccConflictV1Error",
      reason: "alreadyConsumed",
    });
  });

  it("reconstructs finishing evidence in fresh factories and converges on one publication", async () => {
    const prepared = await prepareO07BScenario("c05b_fresh_recovery");
    const createRecoveryExecutor = () =>
      createO07BAuthentication(prepared.current);
    const selector = {
      deploymentId: prepared.current.anchor.deploymentId,
      scopeId: prepared.current.anchor.scopeId,
      sessionId: prepared.current.anchor.sessionId,
      attemptFence: prepared.current.anchor.attemptFence.toString(),
    };
    const second = createRecoveryExecutor();
    const secondHandle = await runEffect(
      second.reconstructPointCommitFinishing(selector),
    );
    const first = createRecoveryExecutor();
    const firstHandle = await runEffect(
      first.reconstructPointCommitFinishing(selector),
    );
    const outcomes = await Promise.all([
      runEffect(first.publishPointCommit(firstHandle)),
      runEffect(second.publishPointCommit(secondHandle)),
    ]);
    expect(outcomes.map(({ kind }) => kind).sort()).toEqual([
      "published",
      "replayed",
    ]);
    expect(outcomes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        kind: "published",
        token: expect.objectContaining({
          scopeUuid: prepared.scopeUuid,
          commitSeq: 1n,
        }),
      }),
      expect.objectContaining({
        kind: "replayed",
        token: expect.objectContaining({
          scopeUuid: prepared.scopeUuid,
          commitSeq: 1n,
        }),
      }),
    ]));
    expect(await runFailure(
      createRecoveryExecutor().resumePointCommit(selector),
    )).toMatchObject({
      _tag: "StoredAttemptAlreadyCommittedV1Error",
    });
    expect(await o06DurableState(prepared.scopeUuid)).toEqual({
      revisions: "0",
      current_rows: "0",
      commit_headers: "1",
      commit_changes: "0",
      outcomes: "1",
      wakes: "1",
      last_commit_seq: "1",
      last_outbox_seq: "1",
    });
  });

  it("recovers one not-forwarded uncertain publication through C05-B and publishes once", async () => {
    let publicationTransactions = 0;
    const publisherPorts = portsWithReadCommittedOverride(
      async (target, work) => {
        publicationTransactions += 1;
        if (publicationTransactions === 1) {
          throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
            kind: "decisionUncertain",
            settlementCause: new Error("O08-D COMMIT was not forwarded"),
          }));
        }
        return target[RUN_LOCATED_READ_COMMITTED_V1](work);
      },
    );
    const prepared = await prepareO07BRunningScenario(
      "o08d_pglite_not_forwarded",
      undefined,
      {},
      publisherPorts,
    );
    const result = await runEffect(
      prepared.authentication.finishPointCommit(prepared.runningPlan),
    );
    expect(result).toMatchObject({
      kind: "published",
      token: { scopeUuid: prepared.scopeUuid, commitSeq: 1n },
    });
    expect(publicationTransactions).toBe(2);
    expect(await o06DurableState(prepared.scopeUuid)).toEqual({
      revisions: "0",
      current_rows: "0",
      commit_headers: "1",
      commit_changes: "0",
      outcomes: "1",
      wakes: "1",
      last_commit_seq: "1",
      last_outbox_seq: "1",
    });
    expect(await o07bTerminalState(
      prepared.scopeUuid,
      prepared.current.anchor.sessionId,
    )).toMatchObject({ lifecycle: "committed", leases: "0", journals: "0" });
  });

  it("replays a forwarded lost response and terminates a second not-forwarded response without duplicate evidence", async () => {
    let forwardedTransactions = 0;
    const forwarded = await prepareO07BRunningScenario(
      "o08d_pglite_forwarded",
      undefined,
      {},
      portsWithReadCommittedOverride(async (target, work) => {
        forwardedTransactions += 1;
        await target[RUN_LOCATED_READ_COMMITTED_V1](work);
        throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
          kind: "decisionUncertain",
          settlementCause: new Error("O08-D forwarded COMMIT response lost"),
        }));
      }),
    );
    await expect(runEffect(
      forwarded.authentication.finishPointCommit(forwarded.runningPlan),
    )).resolves.toMatchObject({
      kind: "replayed",
      token: { commitSeq: 1n },
    });
    expect(forwardedTransactions).toBe(1);
    expect(await o06DurableState(forwarded.scopeUuid)).toMatchObject({
      commit_headers: "1",
      outcomes: "1",
      wakes: "1",
      last_commit_seq: "1",
      last_outbox_seq: "1",
    });

    let missingTransactions = 0;
    const missing = await prepareO07BRunningScenario(
      "o08d_pglite_second_uncertain",
      undefined,
      {},
      portsWithReadCommittedOverride(async () => {
        missingTransactions += 1;
        throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
          kind: "decisionUncertain",
          settlementCause: new Error(
            `O08-D not-forwarded response ${missingTransactions}`,
          ),
        }));
      }),
    );
    const failure = await runFailure(
      missing.authentication.finishPointCommit(missing.runningPlan),
    );
    expect(failure).toBeInstanceOf(
      PointCommitUncertainOutcomeUnresolvedV1Error,
    );
    expect(failure).toMatchObject({
      stage: "guardedPublication",
      secondary: { kind: "secondDecisionUncertain" },
    });
    expect(missingTransactions).toBe(2);
    expect(await o06DurableState(missing.scopeUuid)).toEqual({
      revisions: "0",
      current_rows: "0",
      commit_headers: "0",
      commit_changes: "0",
      outcomes: "0",
      wakes: "0",
      last_commit_seq: "0",
      last_outbox_seq: "0",
    });
    expect(await o07bTerminalState(
      missing.scopeUuid,
      missing.current.anchor.sessionId,
    )).toMatchObject({ lifecycle: "finishing", leases: "1", journals: "1" });
  });

  it("uses the final O07-A lookup when a concurrent recovery commits after the stale missing observation", async () => {
    let prepared:
      | Awaited<ReturnType<typeof prepareO07BRunningScenario>>
      | undefined;
    let resolutionCalls = 0;
    let competitorResult: PointCommitPublicationResultV1 | undefined;
    const publisherPorts = portsWithReadCommittedOverride(
      async () => {
        throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
          kind: "decisionUncertain",
          settlementCause: new Error("O08-D stale missing response"),
        }));
      },
      (target, input) => target[
        RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1
      ](input).pipe(Effect.flatMap((observed) => {
        resolutionCalls += 1;
        if (resolutionCalls !== 2) return Effect.succeed(observed);
        if (prepared === undefined) {
          return Effect.die(new Error("O08-D scenario was not initialized."));
        }
        const selector = {
          deploymentId: prepared.current.anchor.deploymentId,
          scopeId: prepared.current.anchor.scopeId,
          sessionId: prepared.current.anchor.sessionId,
          attemptFence: prepared.current.anchor.attemptFence.toString(),
        };
        return Effect.promise(async () => {
          competitorResult = await runEffect(
            createO07BAuthentication(prepared!.current).resumePointCommit(
              selector,
            ),
          );
          return observed;
        });
      })),
    );
    prepared = await prepareO07BRunningScenario(
      "o08d_pglite_concurrent_recovery",
      undefined,
      {},
      publisherPorts,
    );
    const result = await runEffect(
      prepared.authentication.finishPointCommit(prepared.runningPlan),
    );
    expect(competitorResult).toMatchObject({
      kind: "published",
      token: { commitSeq: 1n },
    });
    expect(result).toMatchObject({
      kind: "replayed",
      token: { commitSeq: 1n },
    });
    expect(resolutionCalls).toBe(3);
    expect(await o06DurableState(prepared.scopeUuid)).toMatchObject({
      commit_headers: "1",
      outcomes: "1",
      wakes: "1",
      last_commit_seq: "1",
      last_outbox_seq: "1",
    });
  });

  it("keeps resolver failure uncertain and treats expired, mismatched, corrupt, or absent committed outcomes authoritatively", async () => {
    const lookupFailure = new CommittedPointOutcomeSqlErrorV1({
      operation: "resolve",
      cause: new Error("O08-D PGlite outcome resolver unavailable"),
    });
    let lookupCalls = 0;
    const lookupFailed = await prepareO07BRunningScenario(
      "o08d_pglite_lookup_failed",
      undefined,
      {},
      portsWithReadCommittedOverride(
        async () => {
          throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
            kind: "decisionUncertain",
            settlementCause: new Error("O08-D lookup response lost"),
          }));
        },
        (target, input) => {
          lookupCalls += 1;
          return lookupCalls === 2
            ? Effect.fail(lookupFailure)
            : target[RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1](input);
        },
      ),
    );
    expect(await runFailure(
      lookupFailed.authentication.finishPointCommit(
        lookupFailed.runningPlan,
      ),
    )).toMatchObject({
      _tag: "PointCommitUncertainOutcomeUnresolvedV1Error",
      stage: "postSettlementOutcomeLookup",
      secondary: { kind: "outcomeLookupFailed", error: lookupFailure },
    });
    expect(await o07bTerminalState(
      lookupFailed.scopeUuid,
      lookupFailed.current.anchor.sessionId,
    )).toMatchObject({ lifecycle: "finishing", leases: "1", journals: "1" });

    const runCommittedMutationCase = async (
      label: string,
      mutation: "expired" | "mismatch" | "corrupt" | "missing",
    ) => {
      let prepared:
        | Awaited<ReturnType<typeof prepareO07BRunningScenario>>
        | undefined;
      let resolutionCalls = 0;
      const publisherPorts = portsWithReadCommittedOverride(
        async () => {
          throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
            kind: "decisionUncertain",
            settlementCause: new Error(`O08-D ${mutation} stale missing`),
          }));
        },
        (target, input) => target[
          RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1
        ](input).pipe(Effect.flatMap((observed) => {
          resolutionCalls += 1;
          if (resolutionCalls !== 2) return Effect.succeed(observed);
          if (prepared === undefined) {
            return Effect.die(new Error("O08-D case was not initialized."));
          }
          const selector = {
            deploymentId: prepared.current.anchor.deploymentId,
            scopeId: prepared.current.anchor.scopeId,
            sessionId: prepared.current.anchor.sessionId,
            attemptFence: prepared.current.anchor.attemptFence.toString(),
          };
          return Effect.promise(async () => {
            await runEffect(
              createO07BAuthentication(prepared!.current).resumePointCommit(
                selector,
              ),
            );
            if (mutation === "expired") {
              await persistence.query(
                `
                  update fx_system_idempotency
                  set result_state = 'expired',
                    result_value_codec_version = null,
                    result_semantic_bytes = null,
                    result_bytes = null,
                    result_sha256 = null,
                    result_expired_at = clock_timestamp()
                  where scope_uuid = $1
                `,
                [prepared!.scopeUuid],
              );
            } else if (mutation === "mismatch") {
              await persistence.query(
                `
                  update fx_system_idempotency
                  set identity_access_policy_sha256 =
                    decode(repeat('aa', 32), 'hex')
                  where scope_uuid = $1
                `,
                [prepared!.scopeUuid],
              );
            } else if (mutation === "corrupt") {
              await persistence.query(
                `
                  update fx_system_idempotency
                  set result_sha256 = decode(repeat('00', 32), 'hex')
                  where scope_uuid = $1
                `,
                [prepared!.scopeUuid],
              );
            } else {
              await persistence.query(
                `delete from fx_system_idempotency where scope_uuid = $1`,
                [prepared!.scopeUuid],
              );
            }
            return observed;
          });
        })),
      );
      prepared = await prepareO07BRunningScenario(
        label,
        undefined,
        {},
        publisherPorts,
      );
      return {
        prepared,
        publication: prepared.authentication.finishPointCommit(
          prepared.runningPlan,
        ),
        resolutionCalls: () => resolutionCalls,
      };
    };

    const expired = await runCommittedMutationCase(
      "o08d_pglite_expired",
      "expired",
    );
    expect(await runEffect(expired.publication)).toMatchObject({
      kind: "expired",
      token: { commitSeq: 1n },
    });
    expect(expired.resolutionCalls()).toBe(3);

    const mismatch = await runCommittedMutationCase(
      "o08d_pglite_mismatch",
      "mismatch",
    );
    expect(await runFailure(mismatch.publication)).toMatchObject({
      _tag: "CommittedPointOutcomeRequestKeyReuseErrorV1",
    });

    const corrupt = await runCommittedMutationCase(
      "o08d_pglite_corrupt",
      "corrupt",
    );
    expect(await runFailure(corrupt.publication)).toMatchObject({
      _tag: "CommittedPointOutcomeCorruptionErrorV1",
    });

    const missing = await runCommittedMutationCase(
      "o08d_pglite_committed_missing",
      "missing",
    );
    expect(await runFailure(missing.publication)).toMatchObject({
      _tag: "PointCommitCorruptionV1Error",
      reason: "committedOutcomeMissing",
    });
  });

  it("publishes a successful zero-row mutation as one zero-change commit", async () => {
    const prepared = await prepareO07BRunningScenario("o07b_zero_row");
    const published = await runEffect(
      prepared.authentication.finishPointCommit(prepared.runningPlan),
    );
    expect(published).toMatchObject({
      kind: "published",
      token: { scopeUuid: prepared.scopeUuid, commitSeq: 1n },
    });
    expect(await o06DurableState(prepared.scopeUuid)).toEqual({
      revisions: "0",
      current_rows: "0",
      commit_headers: "1",
      commit_changes: "0",
      outcomes: "1",
      wakes: "1",
      last_commit_seq: "1",
      last_outbox_seq: "1",
    });
    const header = await persistence.query<{
      change_count: number;
      delivery_state: string;
      attempt_count: string;
      claim_fence: string;
      same_initial_time: boolean;
    }>(
      `
        select commit.change_count, wake.delivery_state,
          wake.attempt_count::text, wake.claim_fence::text,
          wake.created_at = wake.next_attempt_at as same_initial_time
        from fx_system_commit as commit
        join fx_system_outbox as wake
          on wake.scope_uuid = commit.scope_uuid
          and wake.commit_seq = commit.commit_seq
        where commit.scope_uuid = $1
      `,
      [prepared.scopeUuid],
    );
    expect(header.rows[0]).toEqual({
      change_count: 0,
      delivery_state: "pending",
      attempt_count: "0",
      claim_fence: "0",
      same_initial_time: true,
    });
  });

  it("keeps candidate failure in the real point-commit transaction", async () => {
    let candidateValidation:
      ReturnType<
        typeof createAppSchemaCandidateValidationPortForPointCommitAuthority
      > | undefined;
    let candidateSchemaVersionId:
      ReturnType<typeof CatalogSchemaVersionIdSchema.make> | undefined;
    const pointCommitAuthority = resolutionPorts(persistence);
    const running = await prepareO07BRunningScenario(
      "m03_b_candidate_guard",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "candidate-invalid-active-valid" },
        });
      },
      async (current) => {
        candidateSchemaVersionId = CatalogSchemaVersionIdSchema.make(
          "m03_b_candidate_guard_empty",
        );
        await persistence.publishAppSchemaV1({
          deploymentId: current.anchor.deploymentId,
          schemaVersionId: candidateSchemaVersionId,
          version: CatalogSchemaVersionSchema.make(2),
          tables: [],
          indexes: [],
        });
        candidateValidation =
          createAppSchemaCandidateValidationPortForPointCommitAuthority(
            persistence.drizzle,
            pointCommitAuthority,
          );
        await runEffect(installAppSchemaCandidateValidationEffect(
          candidateValidation,
          {
            deploymentId: current.anchor.deploymentId,
            schemaVersionId: candidateSchemaVersionId,
          },
        ));
        return Object.freeze({
          candidateSchemaWriteGuard: createAppSchemaCandidateWriteGuardPort({
            candidateValidation,
            pointCommitAuthority,
          }),
        });
      },
      pointCommitAuthority,
    );
    const plan = await runEffect(
      running.authentication.enterPointCommitFinishing(running.runningPlan),
    );
    const prepared = Object.freeze({ ...running, plan });
    if (candidateValidation === undefined || candidateSchemaVersionId === undefined) {
      throw new Error("Candidate guard fixture was not prepared.");
    }
    await expect(runEffect(loadAppSchemaCandidateValidationEffect(
      candidateValidation,
      {
        deploymentId: prepared.current.anchor.deploymentId,
        schemaVersionId: candidateSchemaVersionId,
      },
    ))).resolves.toMatchObject({
      status: "present",
      head: { frame: {
        kind: "app_schema_candidate_validation_progress",
      } },
    });

    await expect(runEffect(
      prepared.authentication.publishPointCommit(prepared.plan),
    )).resolves.toMatchObject({ kind: "published", token: { commitSeq: 1n } });
    await expect(runEffect(loadAppSchemaCandidateValidationEffect(
      candidateValidation,
      {
        deploymentId: prepared.current.anchor.deploymentId,
        schemaVersionId: candidateSchemaVersionId,
      },
    ))).resolves.toMatchObject({
      status: "present",
      head: { frame: {
        kind: "app_schema_candidate_validation_failure_evidence",
        observedFailureCount: 1n,
        entries: [{
          source: "pointCommit",
          reason: "candidateTableRemoved",
          observedCommitSeq: 1n,
        }],
      } },
    });
    expect(await o06DurableState(prepared.scopeUuid)).toMatchObject({
      revisions: "1",
      current_rows: "1",
      commit_headers: "1",
      commit_changes: "1",
      outcomes: "1",
      last_commit_seq: "1",
    });
  });

  it("recovers candidate failure with the committed publication after uncertainty", async () => {
    let loseCommittedResponse = false;
    let injected = false;
    const pointCommitAuthority = portsWithReadCommittedOverride(
      async (target, work) => {
        const result = await target[RUN_LOCATED_READ_COMMITTED_V1](work);
        if (loseCommittedResponse) {
          loseCommittedResponse = false;
          injected = true;
          throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
            kind: "decisionUncertain",
            settlementCause: new Error("lost M03-B commit response"),
          }));
        }
        return result;
      },
    );
    let candidateValidation:
      ReturnType<
        typeof createAppSchemaCandidateValidationPortForPointCommitAuthority
      > | undefined;
    let candidateSchemaVersionId:
      ReturnType<typeof CatalogSchemaVersionIdSchema.make> | undefined;
    const running = await prepareO07BRunningScenario(
      "m03_b_candidate_uncertain",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "candidate-uncertain" },
        });
      },
      async (current) => {
        candidateSchemaVersionId = CatalogSchemaVersionIdSchema.make(
          "m03_b_candidate_uncertain_empty",
        );
        await persistence.publishAppSchemaV1({
          deploymentId: current.anchor.deploymentId,
          schemaVersionId: candidateSchemaVersionId,
          version: CatalogSchemaVersionSchema.make(2),
          tables: [],
          indexes: [],
        });
        candidateValidation =
          createAppSchemaCandidateValidationPortForPointCommitAuthority(
            persistence.drizzle,
            pointCommitAuthority,
          );
        await runEffect(installAppSchemaCandidateValidationEffect(
          candidateValidation,
          {
            deploymentId: current.anchor.deploymentId,
            schemaVersionId: candidateSchemaVersionId,
          },
        ));
        return Object.freeze({
          candidateSchemaWriteGuard: createAppSchemaCandidateWriteGuardPort({
            candidateValidation,
            pointCommitAuthority,
          }),
          afterTransactionStep: (event: Readonly<{
            readonly step: PointCommitTransactionProofStepV1;
          }>) => {
            if (event.step === "beforeCommit") loseCommittedResponse = true;
            return Promise.resolve();
          },
        });
      },
      pointCommitAuthority,
    );
    const plan = await runEffect(
      running.authentication.enterPointCommitFinishing(running.runningPlan),
    );
    await expect(runEffect(running.authentication.publishPointCommit(plan)))
      .resolves.toMatchObject({ kind: "replayed", token: { commitSeq: 1n } });
    expect(injected).toBe(true);
    if (candidateValidation === undefined || candidateSchemaVersionId === undefined) {
      throw new Error("Candidate uncertainty fixture was not prepared.");
    }
    await expect(runEffect(loadAppSchemaCandidateValidationEffect(
      candidateValidation,
      {
        deploymentId: running.current.anchor.deploymentId,
        schemaVersionId: candidateSchemaVersionId,
      },
    ))).resolves.toMatchObject({
      head: { frame: {
        kind: "app_schema_candidate_validation_failure_evidence",
        entries: [{ source: "pointCommit", observedCommitSeq: 1n }],
      } },
    });
    expect(await o06DurableState(running.scopeUuid)).toMatchObject({
      revisions: "1",
      current_rows: "1",
      outcomes: "1",
      last_commit_seq: "1",
    });
  });

  it("rejects malformed successful-result evidence before database I/O", async () => {
    const prepared = await prepareO06Scenario(
      "o07b_result_evidence",
      () => Promise.resolve(),
    );
    const result = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    const observedQueries: string[] = [];
    const publisher = createPointCommitPublisherPortV1(
      resolutionPorts(persistence),
      { observeQuery: (query) => observedQueries.push(query.name) },
    );
    const failure = await runFailure(publisher.publish(Object.freeze({
      ...prepared.command,
      successfulResult: Object.freeze({
        valueCodecVersion: result.evidence.valueCodecVersion,
        value: result.valueJson,
        canonicalBytes: CanonicalSuccessfulResultBytesV1Schema.make(
          new Uint8Array(result.canonicalBytes.byteLength + 1),
        ),
        semanticSizeBytes: result.semanticSizeBytes,
        sha256Hex: result.evidence.sha256Hex,
      }),
    })));
    expect(failure).toBeInstanceOf(PointCommitCorruptionV1Error);
    expect(failure).toMatchObject({ reason: "successfulResultInvalid" });
    expect(observedQueries).toEqual([]);
    expect(await o06DurableState(prepared.evidence.scopeUuid)).toEqual({
      revisions: "0",
      current_rows: "0",
      commit_headers: "0",
      commit_changes: "0",
      outcomes: "0",
      wakes: "0",
      last_commit_seq: "0",
      last_outbox_seq: "0",
    });
  });

  it("captures result insertion bytes once before locking the scope clock", async () => {
    const prepared = await prepareO06Scenario(
      "o07b_result_capture",
      () => Promise.resolve(),
    );
    const result = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    let clockLocked = false;
    let byteReads = 0;
    const publisher = createPointCommitPublisherPortV1(
      resolutionPorts(persistence),
      {
        afterTransactionStep: (event) => {
          if (event.step === "clockLocked") clockLocked = true;
          return Promise.resolve();
        },
      },
    );
    const published = await runEffect(publisher.publish(Object.freeze({
      ...prepared.command,
      successfulResult: Object.freeze({
        valueCodecVersion: result.evidence.valueCodecVersion,
        value: result.valueJson,
        get canonicalBytes() {
          if (clockLocked) {
            throw new Error("Result bytes were read after the scope lock.");
          }
          byteReads += 1;
          return CanonicalSuccessfulResultBytesV1Schema.make(
            new Uint8Array(result.canonicalBytes),
          );
        },
        semanticSizeBytes: result.semanticSizeBytes,
        sha256Hex: result.evidence.sha256Hex,
      }),
    })));
    expect(published.kind).toBe("published");
    expect(clockLocked).toBe(true);
    expect(byteReads).toBe(1);
  });

  it("classifies only a rolled-back in-transaction SQLSTATE as confirmed", async () => {
    const prepared = await prepareO06Scenario(
      "o08_cd0_confirmed_rollback",
      () => Promise.resolve(),
    );
    const command = await publicationCommand(prepared.command);
    await persistence.query(
      `
        create or replace function fx_test_o08_cd0_40001()
        returns trigger
        language plpgsql
        as $$
        begin
          if new.scope_uuid = '${prepared.evidence.scopeUuid}'::uuid then
            raise exception 'forced O08-CD0 serialization failure'
              using errcode = '40001';
          end if;
          return new;
        end
        $$
      `,
    );
    await persistence.query(
      `
        create trigger fx_test_o08_cd0_40001_trigger
        before insert on fx_system_commit
        for each row execute function fx_test_o08_cd0_40001()
      `,
    );
    try {
      const failure = await runFailure(
        createPointCommitPublisherPortV1(
          resolutionPorts(persistence),
        ).publish(command),
      );
      expect(failure).toBeInstanceOf(
        PointCommitConfirmedPreDecisionRollbackV1Error,
      );
      expect(failure).toMatchObject({
        operation: "writeCommitHeader",
        sqlState: "40001",
      });
      expect(await o06DurableState(prepared.evidence.scopeUuid)).toEqual({
        revisions: "0",
        current_rows: "0",
        commit_headers: "0",
        commit_changes: "0",
        outcomes: "0",
        wakes: "0",
        last_commit_seq: "0",
        last_outbox_seq: "0",
      });
    } finally {
      await persistence.query(
        "drop trigger fx_test_o08_cd0_40001_trigger on fx_system_commit",
      );
      await persistence.query("drop function fx_test_o08_cd0_40001() ");
    }
  });

  it("recovers only uncertain publication decisions through O07-A", async () => {
    const available = await prepareO06Scenario(
      "o08_cd0_uncertain_available",
      () => Promise.resolve(),
    );
    const availableCause = new Error("lost commit response");
    const availablePublisher = createPointCommitPublisherPortV1(
      portsWithReadCommittedOverride(async (target, work) => {
        await target[RUN_LOCATED_READ_COMMITTED_V1](work);
        throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
          kind: "decisionUncertain",
          settlementCause: availableCause,
        }));
      }),
    );
    await expect(runEffect(availablePublisher.publish(
      await publicationCommand(available.command),
    ))).resolves.toMatchObject({
      kind: "replayed",
      token: { commitSeq: 1n },
    });

    const expired = await prepareO06Scenario(
      "o08_cd0_uncertain_expired",
      () => Promise.resolve(),
    );
    const expiredPublisher = createPointCommitPublisherPortV1(
      portsWithReadCommittedOverride(async (target, work) => {
        await target[RUN_LOCATED_READ_COMMITTED_V1](work);
        await persistence.query(
          `
            update fx_system_idempotency
            set result_state = 'expired',
              result_value_codec_version = null,
              result_semantic_bytes = null,
              result_bytes = null,
              result_sha256 = null,
              result_expired_at = clock_timestamp()
            where scope_uuid = $1
          `,
          [expired.evidence.scopeUuid],
        );
        throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
          kind: "decisionUncertain",
          settlementCause: new Error("lost response after result expiry"),
        }));
      }),
    );
    await expect(runEffect(expiredPublisher.publish(
      await publicationCommand(expired.command),
    ))).resolves.toMatchObject({
      kind: "expired",
      token: { commitSeq: 1n },
    });

    const missing = await prepareO06Scenario(
      "o08_cd0_uncertain_missing",
      () => Promise.resolve(),
    );
    const missingCause = new Error("commit response missing before send");
    const missingFailure = await runFailure(
      createPointCommitPublisherPortV1(
        portsWithReadCommittedOverride(async () => {
          throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
            kind: "decisionUncertain",
            settlementCause: missingCause,
          }));
        }),
      ).publish(await publicationCommand(missing.command)),
    );
    expect(missingFailure).toBeInstanceOf(
      PointCommitDecisionUncertainV1Error,
    );
    expect(missingFailure).toMatchObject({
      phase: "commitOrRelease",
      outcomeCheck: { kind: "missing" },
    });

    const lookupFailed = await prepareO06Scenario(
      "o08_cd0_uncertain_lookup_failed",
      () => Promise.resolve(),
    );
    const lookupFailure = new CommittedPointOutcomeSqlErrorV1({
      operation: "resolve",
      cause: new Error("outcome lookup unavailable"),
    });
    let lookupCount = 0;
    const lookupFailureResult = await runFailure(
      createPointCommitPublisherPortV1(
        portsWithReadCommittedOverride(
          async () => {
            throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
              kind: "decisionUncertain",
              settlementCause: new Error("commit settlement unknown"),
            }));
          },
          (target, input) => {
            lookupCount += 1;
            return lookupCount === 1
              ? target[RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1](input)
              : Effect.fail(lookupFailure);
          },
        ),
      ).publish(await publicationCommand(lookupFailed.command)),
    );
    expect(lookupFailureResult).toBeInstanceOf(
      PointCommitDecisionUncertainV1Error,
    );
    expect(lookupFailureResult).toMatchObject({
      outcomeCheck: { kind: "lookupFailed", error: lookupFailure },
    });
  });

  it("keeps cleanup and pre-transaction SQLSTATE failures ordinary", async () => {
    const cleanup = await prepareO06Scenario(
      "o08_cd0_cleanup_ordinary",
      () => Promise.resolve(),
    );
    const callbackCause = Object.assign(new Error("callback failed"), {
      code: "40001",
    });
    const rollbackCause = new Error("rollback failed");
    const cleanupFailure = await runFailure(
      createPointCommitPublisherPortV1(
        portsWithReadCommittedOverride(async () => {
          throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
            kind: "callbackCleanupFailed",
            callbackCause,
            transactionCause: rollbackCause,
          }));
        }),
      ).publish(await publicationCommand(cleanup.command)),
    );
    expect(cleanupFailure).toBeInstanceOf(PointCommitSqlErrorV1);
    expect(cleanupFailure).toMatchObject({ operation: "beginOrRollback" });
    expect(cleanupFailure).not.toHaveProperty("retryable");

    const preTransaction = await prepareO06Scenario(
      "o08_cd0_pre_transaction_ordinary",
      () => Promise.resolve(),
    );
    const synthetic = Object.assign(new Error("authority lookup failed"), {
      code: "40001",
    });
    const preTransactionFailure = await runFailure(
      createPointCommitPublisherPortV1({
        ...resolutionPorts(persistence),
        scopeSessionTargets: {
          resolve: async () => {
            throw synthetic;
          },
        },
      }).publish(await publicationCommand(preTransaction.command)),
    );
    expect(preTransactionFailure).toBeInstanceOf(PointCommitSqlErrorV1);
    expect(preTransactionFailure).toMatchObject({
      operation: "resolveAuthority",
      sqlState: "40001",
      cause: synthetic,
    });
    expect(preTransactionFailure).not.toHaveProperty("retryable");
  });

  it("retries two actual rolled-back 40001 publications and commits one dense result", async () => {
    const prepared = await prepareO07BRunningScenario(
      "o08c_pglite_success",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "o08c pglite success" },
        });
      },
    );
    const trigger = await installO08CSerializationTrigger(
      prepared.scopeUuid,
      "success",
      2,
    );
    try {
      const published = await runEffect(
        prepared.authentication.finishPointCommit(prepared.runningPlan).pipe(
          Effect.provideService(Random.Random, {
            nextDoubleUnsafe: () => 0,
            nextIntUnsafe: () => 0,
          }),
        ),
      );
      expect(published).toMatchObject({
        kind: "published",
        token: { commitSeq: 1n },
      });
      expect(await trigger.attempts()).toBe("3");
      expect(await o06DurableState(prepared.scopeUuid)).toEqual({
        revisions: "1",
        current_rows: "1",
        commit_headers: "1",
        commit_changes: "1",
        outcomes: "1",
        wakes: "1",
        last_commit_seq: "1",
        last_outbox_seq: "1",
      });
      expect(await o07bTerminalState(
        prepared.scopeUuid,
        prepared.current.anchor.sessionId,
      )).toMatchObject({
        lifecycle: "committed",
        leases: "0",
        journals: "0",
      });
    } finally {
      await trigger.drop();
    }
  });

  it("exhausts three actual rolled-back 40001 publications without residue", async () => {
    const prepared = await prepareO07BRunningScenario(
      "o08c_pglite_exhaustion",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "o08c pglite exhaustion" },
        });
      },
    );
    const trigger = await installO08CSerializationTrigger(
      prepared.scopeUuid,
      "exhaustion",
      3,
    );
    try {
      const failure = await runFailure(
        prepared.authentication.finishPointCommit(prepared.runningPlan).pipe(
          Effect.provideService(Random.Random, {
            nextDoubleUnsafe: () => 0,
            nextIntUnsafe: () => 0,
          }),
        ),
      );
      expect(failure).toBeInstanceOf(
        PointCommitKnownSettledSqlRetryExhaustedV1Error,
      );
      expect(failure).toMatchObject({ attempts: 3, maximumAttempts: 3 });
      expect(await trigger.attempts()).toBe("3");
      expect(await o06DurableState(prepared.scopeUuid)).toEqual({
        revisions: "0",
        current_rows: "0",
        commit_headers: "0",
        commit_changes: "0",
        outcomes: "0",
        wakes: "0",
        last_commit_seq: "0",
        last_outbox_seq: "0",
      });
      expect(await o07bTerminalState(
        prepared.scopeUuid,
        prepared.current.anchor.sessionId,
      )).toMatchObject({
        lifecycle: "finishing",
        leases: "1",
        journals: "1",
        receipts: "1",
        points: "1",
        write_events: "1",
      });
    } finally {
      await trigger.drop();
    }
  });

  it("replays across epoch rollover, but a missing old receipt is stale", async () => {
    const prepared = await prepareO07BScenario("o07b_epoch_replay");
    const published = await runEffect(
      prepared.authentication.publishPointCommit(prepared.plan),
    );
    expect(published.kind).toBe("published");
    const nextEpoch = ScopeEpochSchema.make(
      "epoch_94000000-0000-4000-8000-000000000001",
    );
    await persistence.query(
      `
        update fx_system_scope_clock
        set epoch = $2, updated_at = clock_timestamp()
        where scope_uuid = $1
      `,
      [
        prepared.scopeUuid,
        nextEpoch,
      ],
    );
    await expect(runEffect(
      prepared.authentication.publishPointCommit(prepared.plan),
    )).resolves.toMatchObject({ kind: "replayed", token: { commitSeq: 1n } });

    await persistence.query(
      `delete from fx_system_idempotency where scope_uuid = $1`,
      [prepared.scopeUuid],
    );
    const missingFailure = await runFailure(
      prepared.authentication.publishPointCommit(prepared.plan),
    );
    expect(missingFailure).toBeInstanceOf(PointCommitStaleAuthorityV1Error);
    expect(missingFailure).toMatchObject({ reason: "epochChanged" });
  });

  it("rolls back every publication atom when a late invariant fails", async () => {
    const prepared = await prepareO07BScenario(
      "o07b_late_rollback",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "rolled back" },
        });
      },
      {
        afterTransactionStep: (event) => {
          if (event.step === "wakeWritten") {
            throw new PointCommitCorruptionV1Error({
              reason: "publicationInvariantInvalid",
            });
          }
          return Promise.resolve();
        },
      },
    );
    const failure = await runFailure(
      prepared.authentication.publishPointCommit(prepared.plan),
    );
    expect(failure).toBeInstanceOf(PointCommitCorruptionV1Error);
    expect(await o06DurableState(prepared.scopeUuid)).toEqual({
      revisions: "0",
      current_rows: "0",
      commit_headers: "0",
      commit_changes: "0",
      outcomes: "0",
      wakes: "0",
      last_commit_seq: "0",
      last_outbox_seq: "0",
    });
    expect(await o07bTerminalState(
      prepared.scopeUuid,
      prepared.current.anchor.sessionId,
    )).toMatchObject({
      lifecycle: "finishing",
      leases: "1",
      journals: "1",
    });

    const recovered = createO07BAuthentication(prepared.current);
    const published = await runEffect(recovered.resumePointCommit({
      deploymentId: prepared.current.anchor.deploymentId,
      scopeId: prepared.current.anchor.scopeId,
      sessionId: prepared.current.anchor.sessionId,
      attemptFence: prepared.current.anchor.attemptFence.toString(),
    }));
    expect(published).toMatchObject({
      kind: "published",
      token: { scopeUuid: prepared.scopeUuid, commitSeq: 1n },
    });
    expect(await o06DurableState(prepared.scopeUuid)).toMatchObject({
      revisions: "1",
      commit_headers: "1",
      outcomes: "1",
      wakes: "1",
      last_commit_seq: "1",
      last_outbox_seq: "1",
    });
  });

  it("publishes mixed multi-row sidecars atomically and rolls them back together", async () => {
    let insertedDocumentId: string | null = null;
    let intrinsicWrites = 0;
    const prepared = await prepareO07BScenario(
      "o09a_multi_row_atomicity",
      async (current, table) => {
        if (current.seededDocumentId === null) {
          throw new Error("Expected the O09-A seeded delete document.");
        }
        await expect(runPointOperation(current.store, table, {
          kind: "delete",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          documentId: current.seededDocumentId,
        })).resolves.toMatchObject({
          kind: "completed",
          outcome: { kind: "unit" },
        });
        const inserted = await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
          fields: { name: "replacement" },
        });
        if (
          inserted.kind !== "completed" ||
          inserted.outcome.kind !== "inserted"
        ) {
          throw new Error("Expected an O09-A inserted document.");
        }
        insertedDocumentId = inserted.outcome.documentId;
      },
      async (current) => ({
        ...await enableIntrinsicIndexForO06(current),
        afterTransactionStep: (event) => {
          if (event.step === "intrinsicIndexEntryWritten") {
            intrinsicWrites += 1;
            if (intrinsicWrites === 2) {
              throw new PointCommitCorruptionV1Error({
                reason: "publicationInvariantInvalid",
              });
            }
          }
          return Promise.resolve();
        },
      }),
      true,
    );
    if (
      prepared.current.seededDocumentId === null ||
      insertedDocumentId === null
    ) {
      throw new Error("Expected both O09-A mixed-transition document IDs.");
    }
    const before = await intrinsicIndexState(prepared.scopeUuid);
    expect(before).toEqual({
      revisions: [{
        tableId: "1",
        rowIdHex: pointRowIdHex(prepared.current.seededDocumentId),
        commitSeq: "1",
        isTombstone: false,
      }],
      current: [{
        tableId: "1",
        rowIdHex: pointRowIdHex(prepared.current.seededDocumentId),
        commitSeq: "1",
      }],
    });
    expect(await runFailure(
      prepared.authentication.publishPointCommit(prepared.plan),
    )).toBeInstanceOf(PointCommitCorruptionV1Error);
    expect(intrinsicWrites).toBe(2);
    expect(await intrinsicIndexState(prepared.scopeUuid)).toEqual(before);
    expect(await o06DurableState(prepared.scopeUuid)).toEqual({
      revisions: "1",
      current_rows: "1",
      commit_headers: "0",
      commit_changes: "0",
      outcomes: "0",
      wakes: "0",
      last_commit_seq: "1",
      last_outbox_seq: "0",
    });

    const recovered = createO07BAuthentication(
      prepared.current,
      prepared.proofOptions,
    );
    const published = await runEffect(recovered.resumePointCommit({
      deploymentId: prepared.current.anchor.deploymentId,
      scopeId: prepared.current.anchor.scopeId,
      sessionId: prepared.current.anchor.sessionId,
      attemptFence: prepared.current.anchor.attemptFence.toString(),
    }));
    expect(published).toMatchObject({
      kind: "published",
      token: { scopeUuid: prepared.scopeUuid, commitSeq: 2n },
    });
    expect(await o06DurableState(prepared.scopeUuid)).toEqual({
      revisions: "3",
      current_rows: "2",
      commit_headers: "1",
      commit_changes: "2",
      outcomes: "1",
      wakes: "1",
      last_commit_seq: "2",
      last_outbox_seq: "1",
    });
    const expectedRevisions = [{
      tableId: "1",
      rowIdHex: pointRowIdHex(prepared.current.seededDocumentId),
      commitSeq: "1",
      isTombstone: false,
    }, {
      tableId: "1",
      rowIdHex: pointRowIdHex(prepared.current.seededDocumentId),
      commitSeq: "2",
      isTombstone: true,
    }, {
      tableId: "1",
      rowIdHex: pointRowIdHex(insertedDocumentId),
      commitSeq: "2",
      isTombstone: false,
    }].sort(compareIntrinsicIndexRows);
    expect(await intrinsicIndexState(prepared.scopeUuid)).toEqual({
      revisions: expectedRevisions,
      current: [{
        tableId: "1",
        rowIdHex: pointRowIdHex(insertedDocumentId),
        commitSeq: "2",
      }],
    });
    const changes = await persistence.drizzle.select({
      changeOrdinal: fxSystemCommitAppRowChanges.changeOrdinal,
      rowId: fxSystemCommitAppRowChanges.rowId,
    }).from(fxSystemCommitAppRowChanges).where(eq(
      fxSystemCommitAppRowChanges.scopeUuid,
      prepared.scopeUuid,
    )).orderBy(asc(fxSystemCommitAppRowChanges.changeOrdinal));
    const expectedRowIds = [
      pointRowIdHex(prepared.current.seededDocumentId),
      pointRowIdHex(insertedDocumentId),
    ].sort();
    expect(changes.map(({ changeOrdinal, rowId }) => ({
      changeOrdinal,
      rowIdHex: Buffer.from(rowId).toString("hex"),
    }))).toEqual(expectedRowIds.map((rowIdHex, changeOrdinal) => ({
      changeOrdinal,
      rowIdHex,
    })));
  });

  it("maintains developer-index insert, key move, delete, and atomic rollback", async () => {
    let insertedDocumentId: string | null = null;
    const inserted = await prepareO07BScenario(
      "c08a_developer_index_insert",
      async (current, table) => {
        const result = await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "inserted" },
        });
        if (result.kind !== "completed" || result.outcome.kind !== "inserted") {
          throw new Error("Expected a C08-A inserted document.");
        }
        insertedDocumentId = result.outcome.documentId;
      },
      (current) => prepareDeveloperIndexForO06(current),
      false,
      true,
    );
    await runEffect(
      inserted.authentication.publishPointCommit(inserted.plan),
    );
    if (insertedDocumentId === null) {
      throw new Error("Missing C08-A inserted document ID.");
    }
    const insertedIndexState = await developerIndexState(inserted.scopeUuid);
    expect(insertedIndexState).toMatchObject({
      revisions: [{ commitSeq: "1", isTombstone: false }],
      current: [{ commitSeq: "1" }],
    });
    const insertedRow = await persistence.query<{ creation_time: string }>(
      `select creation_time::text
       from fx_app_row_rev
       where scope_uuid = $1 and table_id = 1 and row_id = decode($2, 'hex')
       order by commit_seq desc limit 1`,
      [inserted.scopeUuid, pointRowIdHex(insertedDocumentId)],
    );
    const insertedCreationTime = decodeAppCreationTimeV1(
      Number(insertedRow.rows[0]?.creation_time),
    );
    const insertedDefinitions = await runEffect(
      createAppDeveloperIndexDefinitionPortV1(persistence.drizzle).locate({
        deploymentId: inserted.current.anchor.deploymentId,
        scopeId: inserted.current.anchor.scopeId,
        schemaVersionId: inserted.current.schemaVersionId,
        tableIds: Object.freeze([decodeCatalogTableId(1)]),
        maximumDefinitions: 256,
      }),
    );
    const insertedDefinition = insertedDefinitions?.[0];
    if (insertedDefinition === undefined) {
      throw new Error("Missing C08-A inserted developer definition.");
    }
    expect(insertedIndexState.current[0]?.encodedKeyHex).toBe(
      encodeAppOrderedIndexKeyV1({
        spec: insertedDefinition.physicalSpec,
        values: Object.freeze([
          orderedIndexValueFromFlarexValueV1("inserted"),
          ORDERED_INDEX_MISSING_V1,
          orderedIndexCreationTimeV1(insertedCreationTime),
        ]),
      }),
    );

    let developerWrites = 0;
    const moved = await prepareO07BScenario(
      "c08a_developer_index_move",
      async (current, table) => {
        if (current.seededDocumentId === null) {
          throw new Error("Expected a C08-A seeded move document.");
        }
        const unrelatedDocumentId = appDocumentIdV1FromRowIdentity({
          tableId: decodeCatalogTableId(1),
          rowId: decodeAppRowIdHexV1("00".repeat(16)),
        });
        await expect(runPointOperation(current.store, table, {
          kind: "get",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          documentId: unrelatedDocumentId,
        })).resolves.toMatchObject({
          kind: "completed",
          outcome: { kind: "missing" },
        });
        await expect(runPointOperation(current.store, table, {
          kind: "patch",
          syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
          documentId: current.seededDocumentId,
          patch: { name: "moved" },
        })).resolves.toMatchObject({
          kind: "completed",
          outcome: { kind: "unit" },
        });
      },
      async (current) => ({
        ...await prepareDeveloperIndexForO06(current, true),
        afterTransactionStep: (event) => {
          if (event.step === "developerIndexEntryWritten") {
            developerWrites += 1;
            if (developerWrites === 2) {
              throw new PointCommitCorruptionV1Error({
                reason: "publicationInvariantInvalid",
              });
            }
          }
          return Promise.resolve();
        },
      }),
      true,
      true,
    );
    const beforeMove = await developerIndexState(moved.scopeUuid);
    expect(beforeMove).toMatchObject({
      revisions: [{ commitSeq: "1", isTombstone: false }],
      current: [{ commitSeq: "1" }],
    });
    expect(await runFailure(
      moved.authentication.publishPointCommit(moved.plan),
    )).toBeInstanceOf(PointCommitCorruptionV1Error);
    expect(developerWrites).toBe(2);
    expect(await developerIndexState(moved.scopeUuid)).toEqual(beforeMove);

    const recovered = createO07BAuthentication(
      moved.current,
      moved.proofOptions,
    );
    await runEffect(recovered.resumePointCommit({
      deploymentId: moved.current.anchor.deploymentId,
      scopeId: moved.current.anchor.scopeId,
      sessionId: moved.current.anchor.sessionId,
      attemptFence: moved.current.anchor.attemptFence.toString(),
    }));
    const afterMove = await developerIndexState(moved.scopeUuid);
    expect(afterMove.revisions).toHaveLength(3);
    expect(afterMove.revisions.filter((row) => row.isTombstone)).toHaveLength(1);
    expect(afterMove.current).toHaveLength(1);
    expect(afterMove.current[0]?.commitSeq).toBe("2");
    expect(afterMove.current[0]?.encodedKeyHex).not.toBe(
      beforeMove.current[0]?.encodedKeyHex,
    );

    const deleted = await prepareO07BScenario(
      "c08a_developer_index_delete",
      async (current, table) => {
        if (current.seededDocumentId === null) {
          throw new Error("Expected a C08-A seeded delete document.");
        }
        await expect(runPointOperation(current.store, table, {
          kind: "delete",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          documentId: current.seededDocumentId,
        })).resolves.toMatchObject({
          kind: "completed",
          outcome: { kind: "unit" },
        });
      },
      (current) => prepareDeveloperIndexForO06(current, true),
      true,
      true,
    );
    await runEffect(deleted.authentication.publishPointCommit(deleted.plan));
    const afterDelete = await developerIndexState(deleted.scopeUuid);
    expect(afterDelete.revisions).toHaveLength(2);
    expect(afterDelete.revisions.filter((row) => row.isTombstone)).toHaveLength(1);
    expect(afterDelete.current).toEqual([]);
  });

  it("resets a developer validation cursor in the real point commit and revalidates exactly", async () => {
    let buildPorts: Parameters<
      typeof buildAppDeveloperOrderedIndexV1Effect
    >[0] | undefined;
    let buildInput: BuildAppDeveloperOrderedIndexV1Input | undefined;
    const prepared = await prepareO07BScenario(
      "c08_developer_build_validation_reset",
      async (current, table) => {
        if (current.seededDocumentId === null) {
          throw new Error("Missing developer validation-reset document.");
        }
        await runPointOperation(current.store, table, {
          kind: "patch",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          documentId: current.seededDocumentId,
          patch: { name: "changed-behind-validation-cursor" },
        });
      },
      async (current) => {
        const proofOptions = await prepareDeveloperIndexForO06(current, true);
        await seedSecondDeveloperBuildRowAtCommitOne(current);
        const developerIndexes = proofOptions.developerIndexes;
        if (developerIndexes === undefined) {
          throw new Error("Missing developer validation-reset locator.");
        }
        const definitions = await runEffect(developerIndexes.locate({
          deploymentId: current.anchor.deploymentId,
          scopeId: current.anchor.scopeId,
          schemaVersionId: current.schemaVersionId,
          tableIds: Object.freeze([decodeCatalogTableId(1)]),
          maximumDefinitions: 1,
        }));
        const definition = definitions?.[0];
        if (definitions?.length !== 1 || definition === undefined) {
          throw new Error("Missing developer validation-reset definition.");
        }
        const target = createPGliteLocatedIndexBuildReconciliationTargetV1(
          persistence,
          sharedLocator,
        );
        buildPorts = {
          controlDb: persistence.drizzle,
          authority: {
            scopeMetadata: {
              getScopeMetadataByDeploymentId: (deploymentId: string) =>
                persistence.getScopeMetadataByDeploymentId(deploymentId),
            },
            provisioningReceipts: {
              getScopeAuthorityProvisioningReceipt: async () => null,
            },
            scopeClockTargets: { resolve: async () => target },
          },
        };
        buildInput = {
          deploymentId: current.anchor.deploymentId,
          indexDefinitionId: definition.indexDefinitionId,
          pageSize: 1,
        };
        for (let step = 0; step < 8; step += 1) {
          const result = await runEffect(buildAppDeveloperOrderedIndexV1Effect(
            buildPorts,
            buildInput,
          ));
          if (result.lifecycle === "validating" && result.cursorRowId !== null) {
            return proofOptions;
          }
        }
        throw new Error("Developer build did not reach a non-null validation cursor.");
      },
      true,
      true,
    );
    if (buildPorts === undefined || buildInput === undefined) {
      throw new Error("Developer validation-reset build inputs were not captured.");
    }
    expect(await developerBuildCursor(prepared.current, buildInput)).not.toBeNull();

    await runEffect(prepared.authentication.publishPointCommit(prepared.plan));
    expect(await developerBuildCursor(prepared.current, buildInput)).toBeNull();

    let enabled = false;
    for (let step = 0; step < 8; step += 1) {
      const result = await runEffect(buildAppDeveloperOrderedIndexV1Effect(
        buildPorts,
        buildInput,
      ));
      if (result.lifecycle === "enabled") {
        enabled = true;
        break;
      }
    }
    expect(enabled).toBe(true);
    expect(await developerIndexState(prepared.scopeUuid)).toMatchObject({
      current: [{}, {}],
    });
  });

  it("derives indexed planning from the exact publisher and keeps same-key updates linear", async () => {
    await expect(prepareO07BScenario(
      "c08a_unfaceted_publisher",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "unfaceted" },
        });
      },
      {},
      false,
      true,
    )).rejects.toMatchObject({
      issue: { reason: "developerIndexMaintenance", tableId: 1 },
    });

    let developerIndexOptionReads = 0;
    const captured = await prepareO07BScenario(
      "c08a_captured_publisher_options",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "captured" },
        });
      },
      async (current) => {
        const { developerIndexes } = await prepareDeveloperIndexForO06(current);
        if (developerIndexes === undefined) {
          throw new Error("Missing captured C08-A developer-index locator.");
        }
        const unavailableDeveloperIndexes = Object.freeze({
          locate: () => Effect.succeed(null),
        });
        return {
          get developerIndexes() {
            developerIndexOptionReads += 1;
            return developerIndexOptionReads <= 2
              ? developerIndexes
              : unavailableDeveloperIndexes;
          },
        };
      },
      false,
      true,
    );
    expect(developerIndexOptionReads).toBe(1);
    await runEffect(captured.authentication.publishPointCommit(captured.plan));
    expect(developerIndexOptionReads).toBe(1);
    expect(await developerIndexState(captured.scopeUuid)).toMatchObject({
      revisions: [{ commitSeq: "1", isTombstone: false }],
      current: [{ commitSeq: "1" }],
    });

    const sameKey = await prepareO07BScenario(
      "c08a_developer_index_same_key",
      async (current, table) => {
        if (current.seededDocumentId === null) {
          throw new Error("Expected a seeded C08-A same-key document.");
        }
        await runPointOperation(current.store, table, {
          kind: "patch",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          documentId: current.seededDocumentId,
          patch: { category: "non-indexed-change" },
        });
      },
      (current) => prepareDeveloperIndexForO06(current, true),
      true,
      true,
    );
    const before = await developerIndexState(sameKey.scopeUuid);
    await runEffect(sameKey.authentication.publishPointCommit(sameKey.plan));
    const after = await developerIndexState(sameKey.scopeUuid);
    expect(after.revisions).toHaveLength(2);
    expect(after.revisions.filter((row) => row.isTombstone)).toEqual([]);
    expect(after.current).toHaveLength(1);
    expect(after.current[0]).toMatchObject({
      encodedKeyHex: before.current[0]?.encodedKeyHex,
      commitSeq: "2",
    });
  });

  it("refuses oversized developer keys and PGlite fan-out before durable writes", async () => {
    const oversized = await prepareO07BScenario(
      "c08a_developer_index_oversized_key",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "x".repeat(3_000) },
        });
      },
      (current) => prepareDeveloperIndexForO06(current),
      false,
      true,
    );
    await expect(runEffect(
      oversized.authentication.publishPointCommit(oversized.plan),
    )).rejects.toMatchObject({
      reason: "entryKeyLimitExceeded",
      maximum: 2_048,
    });
    expect(await o06DurableState(oversized.scopeUuid)).toMatchObject({
      revisions: "0",
      current_rows: "0",
      commit_headers: "0",
      outcomes: "0",
      last_commit_seq: "0",
    });

    const ceiling = await prepareO07BScenario(
      "c08a_developer_index_pglite_ceiling",
      async (current, table) => {
        for (let index = 0; index < 86; index += 1) {
          await runPointOperation(current.store, table, {
            kind: "insert",
            syscallSequence: CommitSyscallSequenceV1Schema.make(BigInt(index + 1)),
            fields: { name: `name-${index}` },
          });
        }
      },
      (current) => prepareDeveloperIndexForO06(current),
      false,
      3,
    );
    await expect(runEffect(
      ceiling.authentication.publishPointCommit(ceiling.plan),
    )).rejects.toMatchObject({
      reason: "entryRevisionLimitExceeded",
      observed: 258,
      maximum: 256,
    });
    expect(await o06DurableState(ceiling.scopeUuid)).toMatchObject({
      revisions: "0",
      current_rows: "0",
      commit_headers: "0",
      outcomes: "0",
      last_commit_seq: "0",
    });
  });

  it("captures the exact unique-maintenance capability and claims inserts", async () => {
    let optionReads = 0;
    let eligibilityOptionReads = 0;
    let insertedDocumentId: string | null = null;
    const prepared = await prepareO07BScenario(
      "c08b2_unique_insert",
      async (current, table) => {
        const result = await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "claimed" },
        });
        if (result.kind !== "completed" || result.outcome.kind !== "inserted") {
          throw new Error("Expected a C08-B2 inserted document.");
        }
        insertedDocumentId = result.outcome.documentId;
      },
      async (current) => {
        const {
          uniqueConstraints,
          uniqueConstraintEligibility,
        } = await prepareUniqueConstraintForO06(current);
        return {
          get uniqueConstraints() {
            optionReads += 1;
            return uniqueConstraints;
          },
          get uniqueConstraintEligibility() {
            eligibilityOptionReads += 1;
            return uniqueConstraintEligibility;
          },
        };
      },
    );
    expect(optionReads).toBe(1);
    expect(eligibilityOptionReads).toBe(1);
    const exactPort = createPointCommitPublisherPortV1(
      resolutionPorts(persistence),
      prepared.proofOptions,
    );
    expect(hasPointCommitUniqueConstraintMaintenanceV1(exactPort)).toBe(true);
    expect(hasPointCommitUniqueConstraintEligibilityV1(exactPort)).toBe(true);
    expect(hasPointCommitUniqueConstraintMaintenanceV1({ ...exactPort })).toBe(
      false,
    );
    expect(hasPointCommitUniqueConstraintEligibilityV1({ ...exactPort })).toBe(
      false,
    );
    expect(optionReads).toBe(2);
    expect(eligibilityOptionReads).toBe(2);

    await runEffect(prepared.authentication.publishPointCommit(prepared.plan));
    expect(optionReads).toBe(2);
    expect(eligibilityOptionReads).toBe(2);
    if (insertedDocumentId === null) {
      throw new Error("Missing the C08-B2 inserted document ID.");
    }
    expect(await uniqueKeyState(prepared.scopeUuid)).toMatchObject([{
      rowIdHex: pointRowIdHex(insertedDocumentId),
      commitSeq: "1",
    }]);
  });

  it("rejects a B2-only point-commit composition before durable writes", async () => {
    let currentScopeUuid: string | null = null;
    await expect(prepareO07BScenario(
      "c08b1_unique_eligibility_missing",
      async (current, table) => {
        currentScopeUuid = projectScopeIdUuidV1(
          current.anchor.scopeId,
        ).scopeUuid;
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "missing-eligibility" },
        });
      },
      async (current) => {
        const prepared = await prepareUniqueConstraintForO06(current);
        return Object.freeze({
          uniqueConstraints: prepared.uniqueConstraints,
        });
      },
    )).rejects.toMatchObject({
      issue: { reason: "uniqueConstraintEligibilityUnavailable", tableId: 1 },
    });
    if (currentScopeUuid === null) {
      throw new Error("Missing the B2-only test scope.");
    }
    expect(await o06DurableState(currentScopeUuid)).toMatchObject({
      revisions: "0",
      current_rows: "0",
      commit_headers: "0",
      outcomes: "0",
      last_commit_seq: "0",
    });
  });

  it("does not load unique eligibility for a plan without material rows", async () => {
    const noMaterial = await prepareO07BScenario(
      "c08b1_unique_eligibility_no_material",
      undefined,
      (current) => prepareUniqueConstraintForO06(
        current,
        false,
        false,
        true,
      ),
    );
    await expect(runEffect(
      noMaterial.authentication.publishPointCommit(noMaterial.plan),
    )).resolves.toMatchObject({ kind: "published" });
  });

  it("resets validating unique-set progress in point commit and rolls it back with the commit", async () => {
    const reset = await prepareO07BScenario(
      "c08b1c_unique_validation_reset",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "behind-validation-cursor" },
        });
      },
      async (current) => {
        await insertValidatingUniqueSetBuild(current);
        await insertValidatingUniqueSetBuild(
          current,
          `${current.schemaVersionId}_candidate`,
        );
        return {};
      },
    );
    expect(await uniqueSetBuildCursors(reset.current)).toEqual([
      {
        schemaVersionId: reset.current.schemaVersionId,
        lifecycle: "validating",
        cursorDefinitionId: 1,
        cursorRowHex: "ff".repeat(16),
      },
      {
        schemaVersionId: `${reset.current.schemaVersionId}_candidate`,
        lifecycle: "validating",
        cursorDefinitionId: 1,
        cursorRowHex: "ff".repeat(16),
      },
    ]);
    await runEffect(reset.authentication.publishPointCommit(reset.plan));
    expect(await uniqueSetBuildCursors(reset.current)).toEqual([
      {
        schemaVersionId: reset.current.schemaVersionId,
        lifecycle: "validating",
        cursorDefinitionId: null,
        cursorRowHex: null,
      },
      {
        schemaVersionId: `${reset.current.schemaVersionId}_candidate`,
        lifecycle: "validating",
        cursorDefinitionId: null,
        cursorRowHex: null,
      },
    ]);

    const rolledBack = await prepareO07BScenario(
      "c08b1c_unique_validation_reset_rollback",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "rollback-validation-reset" },
        });
      },
      async (current) => {
        await insertValidatingUniqueSetBuild(current);
        return {
          afterTransactionStep: (event) => {
            if (event.step === "uniqueConstraintValidationReset") {
              throw new PointCommitCorruptionV1Error({
                reason: "publicationInvariantInvalid",
              });
            }
            return Promise.resolve();
          },
        };
      },
    );
    expect(await runFailure(
      rolledBack.authentication.publishPointCommit(rolledBack.plan),
    )).toBeInstanceOf(PointCommitCorruptionV1Error);
    expect(await uniqueSetBuildCursor(rolledBack.current)).toEqual({
      lifecycle: "validating",
      cursorDefinitionId: 1,
      cursorRowHex: "ff".repeat(16),
    });
    expect(await o06DurableState(rolledBack.scopeUuid)).toMatchObject({
      revisions: "0",
      current_rows: "0",
      commit_headers: "0",
      outcomes: "0",
      last_commit_seq: "0",
    });
  });

  it("fails closed before commit when the scope build directory ceiling is exceeded", async () => {
    const prepared = await prepareO07BScenario(
      "c08b1c_unique_validation_reset_ceiling",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "validation-reset-ceiling" },
        });
      },
      async (current) => {
        for (
          let ordinal = 0;
          ordinal <= MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1;
          ordinal += 1
        ) {
          await insertValidatingUniqueSetBuild(
            current,
            `${current.schemaVersionId}_candidate_${ordinal}`,
          );
        }
        await persistence.query(
          `update fx_system_unique_constraint_set_build
              set lifecycle = 'enabled', cursor_definition_id = null,
                  cursor_row_id = null
            where scope_id = $1 and schema_version_id <> $2`,
          [
            current.anchor.scopeId,
            `${current.schemaVersionId}_candidate_${
              MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1
            }`,
          ],
        );
        return {};
      },
    );
    expect(await runFailure(
      prepared.authentication.publishPointCommit(prepared.plan),
    )).toMatchObject({
      _tag: "PointCommitCorruptionV1Error",
      reason: "uniqueConstraintBuildInvalid",
    });
    const cursors = await uniqueSetBuildCursors(prepared.current);
    expect(cursors).toHaveLength(
      MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1 + 1,
    );
    expect(cursors.filter((row) => row.cursorRowHex === null)).toHaveLength(
      MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1,
    );
    expect(cursors.filter((row) =>
      row.cursorRowHex === "ff".repeat(16)
    )).toHaveLength(1);
    expect(await o06DurableState(prepared.scopeUuid)).toMatchObject({
      revisions: "0",
      current_rows: "0",
      commit_headers: "0",
      outcomes: "0",
      last_commit_seq: "0",
    });
  });

  it("publishes at the exact scope build directory ceiling", async () => {
    const prepared = await prepareO07BScenario(
      "c08b1c_unique_validation_reset_exact_ceiling",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "validation-reset-exact-ceiling" },
        });
      },
      async (current) => {
        for (
          let ordinal = 0;
          ordinal < MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1;
          ordinal += 1
        ) {
          await insertValidatingUniqueSetBuild(
            current,
            `${current.schemaVersionId}_history_${ordinal}`,
          );
        }
        await persistence.query(
          `update fx_system_unique_constraint_set_build
              set lifecycle = 'enabled', cursor_definition_id = null,
                  cursor_row_id = null
            where scope_id = $1`,
          [current.anchor.scopeId],
        );
        return {};
      },
    );
    await runEffect(prepared.authentication.publishPointCommit(prepared.plan));
    expect(await uniqueSetBuildCursors(prepared.current)).toHaveLength(
      MAX_APP_UNIQUE_CONSTRAINT_SET_BUILDS_PER_SCOPE_V1,
    );
    expect(await o06DurableState(prepared.scopeUuid)).toMatchObject({
      revisions: "1",
      current_rows: "1",
      commit_headers: "1",
      outcomes: "1",
      last_commit_seq: "1",
    });
  });

  it("rejects structurally copied unique locator authority before transaction", async () => {
    const prepared = await prepareO07BScenario(
      "c08b2_forged_unique_definition",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "forged-definition" },
        });
      },
      async (current) => {
        const exact = await prepareUniqueConstraintForO06(current);
        const definitions = await runEffect(exact.uniqueConstraints.locate({
          deploymentId: current.anchor.deploymentId,
          scopeId: current.anchor.scopeId,
          schemaVersionId: current.schemaVersionId,
          tableIds: Object.freeze([decodeCatalogTableId(1)]),
          maximumDefinitions: 32,
        }));
        if (definitions === null) {
          throw new Error("Missing exact C08-B2 definitions.");
        }
        const copied = Object.freeze(definitions.map((definition) =>
          Object.freeze({ ...definition })
        ));
        return Object.freeze({
          uniqueConstraints: Object.freeze({
            locate: () => Effect.succeed(copied),
          }),
        });
      },
    );
    await expect(runEffect(
      prepared.authentication.publishPointCommit(prepared.plan),
    )).rejects.toMatchObject({
      reason: "definitionPortInvalid",
    });
    expect(await uniqueKeyState(prepared.scopeUuid)).toEqual([]);
    expect(await o06DurableState(prepared.scopeUuid)).toMatchObject({
      revisions: "0",
      current_rows: "0",
      commit_headers: "0",
      outcomes: "0",
      last_commit_seq: "0",
    });
  });

  it("rejects duplicate unique claims and rolls back every commit write", async () => {
    const prepared = await prepareO07BScenario(
      "c08b2_unique_conflict",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "duplicate" },
        });
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
          fields: { name: "duplicate" },
        });
      },
      (current) => prepareUniqueConstraintForO06(current),
    );

    expect(await runFailure(
      prepared.authentication.publishPointCommit(prepared.plan),
    )).toBeInstanceOf(AppUniqueKeyConflictError);
    expect(await uniqueKeyState(prepared.scopeUuid)).toEqual([]);
    expect(await o06DurableState(prepared.scopeUuid)).toMatchObject({
      revisions: "0",
      current_rows: "0",
      commit_headers: "0",
      commit_changes: "0",
      outcomes: "0",
      wakes: "0",
      last_commit_seq: "0",
    });
  });

  it("rolls back a moved unique claim and resumes the exact transition", async () => {
    let uniqueWrites = 0;
    const prepared = await prepareO07BScenario(
      "c08b2_unique_move_rollback",
      async (current, table) => {
        if (current.seededDocumentId === null) {
          throw new Error("Expected a seeded C08-B2 document.");
        }
        await runPointOperation(current.store, table, {
          kind: "patch",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          documentId: current.seededDocumentId,
          patch: { name: "moved" },
        });
      },
      async (current) => ({
        ...await prepareUniqueConstraintForO06(current, true),
        afterTransactionStep: (event) => {
          if (event.step === "uniqueKeyWritten") {
            uniqueWrites += 1;
            if (uniqueWrites === 2) {
              throw new PointCommitCorruptionV1Error({
                reason: "publicationInvariantInvalid",
              });
            }
          }
          return Promise.resolve();
        },
      }),
      true,
    );
    const before = await uniqueKeyState(prepared.scopeUuid);
    expect(before).toMatchObject([{ commitSeq: "1" }]);

    expect(await runFailure(
      prepared.authentication.publishPointCommit(prepared.plan),
    )).toBeInstanceOf(PointCommitCorruptionV1Error);
    expect(uniqueWrites).toBe(2);
    expect(await uniqueKeyState(prepared.scopeUuid)).toEqual(before);

    const recovered = createO07BAuthentication(
      prepared.current,
      prepared.proofOptions,
    );
    await runEffect(recovered.resumePointCommit({
      deploymentId: prepared.current.anchor.deploymentId,
      scopeId: prepared.current.anchor.scopeId,
      sessionId: prepared.current.anchor.sessionId,
      attemptFence: prepared.current.anchor.attemptFence.toString(),
    }));
    const after = await uniqueKeyState(prepared.scopeUuid);
    expect(after).toMatchObject([{ commitSeq: "2" }]);
    expect(after[0]?.encodedKeyHex).not.toBe(before[0]?.encodedKeyHex);
  });

  it("orders developer-index and unique sidecars and rolls both back together", async () => {
    const sidecarSteps: PointCommitTransactionProofStepV1[] = [];
    let uniqueWrites = 0;
    const prepared = await prepareO07BScenario(
      "o09b_combined_sidecar_rollback",
      async (current, table) => {
        if (current.seededDocumentId === null) {
          throw new Error("Expected an O09-B seeded document.");
        }
        await runPointOperation(current.store, table, {
          kind: "patch",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          documentId: current.seededDocumentId,
          patch: { name: "o09b-moved" },
        });
      },
      async (current) => ({
        ...await prepareDeveloperIndexForO06(current, true),
        ...await prepareUniqueConstraintForO06(current, true),
        afterTransactionStep: (event) => {
          if (
            event.step === "developerIndexEntryWritten" ||
            event.step === "uniqueKeyWritten"
          ) {
            sidecarSteps.push(event.step);
          }
          if (event.step === "uniqueKeyWritten") {
            uniqueWrites += 1;
            if (uniqueWrites === 2) {
              throw new PointCommitCorruptionV1Error({
                reason: "publicationInvariantInvalid",
              });
            }
          }
          return Promise.resolve();
        },
      }),
      true,
      true,
    );
    const beforeDeveloper = await developerIndexState(prepared.scopeUuid);
    const beforeUnique = await uniqueKeyState(prepared.scopeUuid);
    const beforeDurable = await o06DurableState(prepared.scopeUuid);

    expect(await runFailure(
      prepared.authentication.publishPointCommit(prepared.plan),
    )).toBeInstanceOf(PointCommitCorruptionV1Error);
    expect(sidecarSteps).toEqual([
      "developerIndexEntryWritten",
      "developerIndexEntryWritten",
      "uniqueKeyWritten",
      "uniqueKeyWritten",
    ]);
    expect(await developerIndexState(prepared.scopeUuid)).toEqual(
      beforeDeveloper,
    );
    expect(await uniqueKeyState(prepared.scopeUuid)).toEqual(beforeUnique);
    expect(await o06DurableState(prepared.scopeUuid)).toEqual(beforeDurable);

    const recovered = createO07BAuthentication(
      prepared.current,
      prepared.proofOptions,
    );
    await runEffect(recovered.resumePointCommit({
      deploymentId: prepared.current.anchor.deploymentId,
      scopeId: prepared.current.anchor.scopeId,
      sessionId: prepared.current.anchor.sessionId,
      attemptFence: prepared.current.anchor.attemptFence.toString(),
    }));
    const afterDeveloper = await developerIndexState(prepared.scopeUuid);
    const afterUnique = await uniqueKeyState(prepared.scopeUuid);
    expect(afterDeveloper.revisions).toHaveLength(3);
    expect(afterDeveloper.current).toMatchObject([{ commitSeq: "2" }]);
    expect(afterUnique).toMatchObject([{ commitSeq: "2" }]);
    expect(afterDeveloper.current[0]?.encodedKeyHex).not.toBe(
      beforeDeveloper.current[0]?.encodedKeyHex,
    );
    expect(afterUnique[0]?.encodedKeyHex).not.toBe(
      beforeUnique[0]?.encodedKeyHex,
    );
    expect(await o06DurableState(prepared.scopeUuid)).toMatchObject({
      revisions: "2",
      current_rows: "1",
      commit_headers: "1",
      commit_changes: "1",
      outcomes: "1",
      wakes: "1",
      last_commit_seq: "2",
      last_outbox_seq: "1",
    });
  });

  it("advances same-key claims, releases deletes, and omits sparse keys", async () => {
    const sameKey = await prepareO07BScenario(
      "c08b2_unique_same_key",
      async (current, table) => {
        if (current.seededDocumentId === null) {
          throw new Error("Expected a seeded same-key C08-B2 document.");
        }
        await runPointOperation(current.store, table, {
          kind: "patch",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          documentId: current.seededDocumentId,
          patch: { category: "non-unique-change" },
        });
      },
      (current) => prepareUniqueConstraintForO06(current, true),
      true,
    );
    const sameKeyBefore = await uniqueKeyState(sameKey.scopeUuid);
    await runEffect(sameKey.authentication.publishPointCommit(sameKey.plan));
    const sameKeyAfter = await uniqueKeyState(sameKey.scopeUuid);
    expect(sameKeyAfter).toMatchObject([{ commitSeq: "2" }]);
    expect(sameKeyAfter[0]?.encodedKeyHex).toBe(
      sameKeyBefore[0]?.encodedKeyHex,
    );

    const deleted = await prepareO07BScenario(
      "c08b2_unique_delete",
      async (current, table) => {
        if (current.seededDocumentId === null) {
          throw new Error("Expected a seeded delete C08-B2 document.");
        }
        await runPointOperation(current.store, table, {
          kind: "delete",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          documentId: current.seededDocumentId,
        });
      },
      (current) => prepareUniqueConstraintForO06(current, true),
      true,
    );
    await runEffect(deleted.authentication.publishPointCommit(deleted.plan));
    expect(await uniqueKeyState(deleted.scopeUuid)).toEqual([]);

    const sparse = await prepareO07BScenario(
      "c08b2_unique_sparse",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { category: "without-name" },
        });
      },
      (current) => prepareUniqueConstraintForO06(current, false, true),
    );
    await runEffect(sparse.authentication.publishPointCommit(sparse.plan));
    expect(await uniqueKeyState(sparse.scopeUuid)).toEqual([]);
    expect(await o06DurableState(sparse.scopeUuid)).toMatchObject({
      revisions: "1",
      current_rows: "1",
      commit_headers: "1",
      outcomes: "1",
    });
  });

  it("releases before claiming so two rows can swap unique keys", async () => {
    let secondDocumentId: ReturnType<
      typeof appDocumentIdV1FromRowIdentity
    > | null = null;
    let uniqueOptions: Required<Pick<
      PointCommitTransactionProofOptionsV1,
      "uniqueConstraints"
    >> | null = null;
    const prepared = await prepareO07BScenario(
      "c08b2_unique_swap",
      async (current, table) => {
        if (current.seededDocumentId === null) {
          throw new Error("Expected the first seeded C08-B2 swap document.");
        }
        uniqueOptions = await prepareUniqueConstraintForO06(current, true);
        secondDocumentId = await seedSecondUniqueUser(
          current,
          uniqueOptions.uniqueConstraints,
        );
        await runPointOperation(current.store, table, {
          kind: "patch",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          documentId: current.seededDocumentId,
          patch: { name: "other" },
        });
        await runPointOperation(current.store, table, {
          kind: "patch",
          syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
          documentId: secondDocumentId,
          patch: { name: "seeded" },
        });
      },
      async () => {
        if (uniqueOptions === null) {
          throw new Error("Missing the C08-B2 swap capability.");
        }
        return uniqueOptions;
      },
      true,
    );
    if (
      prepared.current.seededDocumentId === null ||
      secondDocumentId === null
    ) throw new Error("Missing C08-B2 swap document identities.");
    const before = await uniqueKeyState(prepared.scopeUuid);
    expect(before).toHaveLength(2);
    const beforeByRow = new Map(before.map((row) => [
      row.rowIdHex,
      row.encodedKeyHex,
    ]));

    await runEffect(prepared.authentication.publishPointCommit(prepared.plan));
    const after = await uniqueKeyState(prepared.scopeUuid);
    expect(after).toHaveLength(2);
    expect(after.every((row) => row.commitSeq === "2")).toBe(true);
    const firstRowId = pointRowIdHex(prepared.current.seededDocumentId);
    const secondRowId = pointRowIdHex(secondDocumentId);
    expect(after.find((row) => row.rowIdHex === firstRowId)?.encodedKeyHex).toBe(
      beforeByRow.get(secondRowId),
    );
    expect(after.find((row) => row.rowIdHex === secondRowId)?.encodedKeyHex).toBe(
      beforeByRow.get(firstRowId),
    );
  });

  it("refuses oversized unique keys and fan-out above the private ceiling", async () => {
    const oversized = await prepareO07BScenario(
      "c08b2_unique_oversized_key",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "x".repeat(3_000) },
        });
      },
      (current) => prepareUniqueConstraintForO06(current),
    );
    await expect(runEffect(
      oversized.authentication.publishPointCommit(oversized.plan),
    )).rejects.toMatchObject({ reason: "keyInvalid" });
    expect(await uniqueKeyState(oversized.scopeUuid)).toEqual([]);
    expect(await o06DurableState(oversized.scopeUuid)).toMatchObject({
      revisions: "0",
      current_rows: "0",
      commit_headers: "0",
      outcomes: "0",
      last_commit_seq: "0",
    });

    const prepared = await prepareO07BScenario(
      "c08b2_unique_ceiling",
      async (current, table) => {
        for (let index = 0; index < 33; index += 1) {
          await runPointOperation(current.store, table, {
            kind: "insert",
            syscallSequence: CommitSyscallSequenceV1Schema.make(BigInt(index + 1)),
            fields: { name: `unique-${index}` },
          });
        }
      },
      (current) => prepareUniqueConstraintForO06(current),
    );
    await expect(runEffect(
      prepared.authentication.publishPointCommit(prepared.plan),
    )).rejects.toMatchObject({
      reason: "mutationLimitExceeded",
      observed: 33,
      maximum: 32,
    });
    expect(await uniqueKeyState(prepared.scopeUuid)).toEqual([]);
    expect(await o06DurableState(prepared.scopeUuid)).toMatchObject({
      revisions: "0",
      current_rows: "0",
      commit_headers: "0",
      outcomes: "0",
      last_commit_seq: "0",
    });
  });

  it("reports exact request-key evidence reuse before stale session checks", async () => {
    const prepared = await prepareO07BScenario("o07b_reuse_conflict");
    await runEffect(prepared.authentication.publishPointCommit(prepared.plan));
    await persistence.query(
      `
        update fx_system_idempotency
        set identity_access_policy_sha256 = decode(repeat('aa', 32), 'hex')
        where scope_uuid = $1
      `,
      [prepared.scopeUuid],
    );
    const failure = await runFailure(
      prepared.authentication.publishPointCommit(prepared.plan),
    );
    expect(failure).toBeInstanceOf(
      CommittedPointOutcomeRequestKeyReuseErrorV1,
    );
    expect(failure).toMatchObject({
      mismatches: ["identityAccessPolicySha256"],
    });
    expect(await o06DurableState(prepared.scopeUuid)).toMatchObject({
      commit_headers: "1",
      outcomes: "1",
      wakes: "1",
    });
  });

  it("rolls back live, delete, and insert-delete point lowering", async () => {
    const live = await prepareO06Scenario(
      "o06_live_rollback",
      async (current, table) => {
        await expect(runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "live" },
        })).resolves.toMatchObject({
          kind: "completed",
          outcome: { kind: "inserted" },
        });
      },
    );
    const liveBefore = await o06DurableState(live.evidence.scopeUuid);
    const liveSteps: string[] = [];
    const liveIndexOptions = await enableIntrinsicIndexForO06(live.current);
    const liveResult = await runEffect(
      createPointCommitRollbackProofPortV1(resolutionPorts(persistence), {
        ...liveIndexOptions,
        afterTransactionStep: (event) => {
          liveSteps.push(event.step);
          return Promise.resolve();
        },
      }).prove(live.command),
    );
    expect(liveResult).toEqual({ kind: "wouldCommit" });
    expect(Object.isFrozen(liveResult)).toBe(true);
    expect(liveSteps).toEqual([
      "clockLocked",
      "intrinsicIndexBuildLocked",
      "sessionLocked",
      "leaseLocked",
      "journalRootLocked",
      "dependenciesValidated",
      "tentativeRowWritten",
      "intrinsicIndexEntryWritten",
      "beforeRollback",
    ]);
    expect(await o06DurableState(live.evidence.scopeUuid)).toEqual(liveBefore);

    const deleted = await prepareO06Scenario(
      "o06_delete_rollback",
      async (current, table) => {
        if (current.seededDocumentId === null) {
          throw new Error("Missing seeded delete document.");
        }
        await expect(runPointOperation(current.store, table, {
          kind: "delete",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          documentId: current.seededDocumentId,
        })).resolves.toMatchObject({
          kind: "completed",
          outcome: { kind: "unit" },
        });
      },
      true,
    );
    const deleteBefore = await o06DurableState(deleted.evidence.scopeUuid);
    const deleteSteps: string[] = [];
    const deleteIndexOptions = await enableIntrinsicIndexForO06(
      deleted.current,
    );
    await runEffect(
      createPointCommitRollbackProofPortV1(resolutionPorts(persistence), {
        ...deleteIndexOptions,
        afterTransactionStep: (event) => {
          deleteSteps.push(event.step);
          return Promise.resolve();
        },
      }).prove(deleted.command),
    );
    expect(deleteSteps).toContain("tentativeRowWritten");
    expect(deleteSteps).toContain("intrinsicIndexEntryWritten");
    expect(await o06DurableState(deleted.evidence.scopeUuid)).toEqual(
      deleteBefore,
    );
    await persistence.query(
      "delete from fx_app_index_entry_current where scope_uuid = $1",
      [deleted.evidence.scopeUuid],
    );
    await persistence.query(
      "delete from fx_app_index_entry_rev where scope_uuid = $1",
      [deleted.evidence.scopeUuid],
    );
    const missingEnabledHead = await runFailure(
      createPointCommitRollbackProofPortV1(
        resolutionPorts(persistence),
        deleteIndexOptions,
      ).prove(deleted.command),
    );
    expect(missingEnabledHead).toBeInstanceOf(PointCommitCorruptionV1Error);
    expect(missingEnabledHead).toMatchObject({
      reason: "intrinsicIndexTransitionInvalid",
    });
    expect(await o06DurableState(deleted.evidence.scopeUuid)).toEqual(
      deleteBefore,
    );

    const noMaterial = await prepareO06Scenario(
      "o06_insert_delete_rollback",
      async (current, table) => {
        const inserted = await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "transient" },
        });
        if (
          inserted.kind !== "completed" ||
          inserted.outcome.kind !== "inserted"
        ) {
          throw new Error("Expected transient O06 insert.");
        }
        await runPointOperation(current.store, table, {
          kind: "delete",
          syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
          documentId: inserted.outcome.documentId,
        });
      },
    );
    const noMaterialSteps: string[] = [];
    await runEffect(
      createPointCommitRollbackProofPortV1(resolutionPorts(persistence), {
        afterTransactionStep: (event) => {
          noMaterialSteps.push(event.step);
          return Promise.resolve();
        },
      }).prove(noMaterial.command),
    );
    expect(noMaterial.command.dependencies).toHaveLength(1);
    expect(noMaterial.command.rowIntents).toEqual([]);
    expect(noMaterialSteps).not.toContain("tentativeRowWritten");
    expect(noMaterialSteps.at(-1)).toBe("beforeRollback");
  });

  it("keeps lifecycle, preliminary authority, and target failures typed", async () => {
    const current = await prepareO06Scenario(
      "o06_typed_authority",
      async (scenario, table) => {
        await runPointOperation(scenario.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "typed" },
        });
      },
    );
    let authorityReads = 0;
    const runningFailure = await runFailure(
      createPointCommitRollbackProofPortV1({
        ...resolutionPorts(persistence),
        scopeMetadata: {
          getScopeMetadataByDeploymentId: async () => {
            authorityReads += 1;
            throw new Error("Running input must fail before authority I/O.");
          },
        },
      }).prove(Object.freeze({
        ...current.command,
        session: Object.freeze({
          ...current.command.session,
          lifecycle: "running",
        }),
        sealIdentity: Object.freeze({
          ...current.command.sealIdentity,
          lifecycle: "running",
        }),
      })),
    );
    expect(runningFailure).toMatchObject({
      _tag: "PointCommitStaleAuthorityV1Error",
      reason: "lifecycleChanged",
    });
    expect(authorityReads).toBe(0);

    await persistence.query(
      `
        update fx_system_scope_clock
        set storage_generation_fence = storage_generation_fence + 1
        where scope_uuid = $1
      `,
      [current.evidence.scopeUuid],
    );
    const generationFailure = await runFailure(
      createPointCommitRollbackProofPortV1(
        resolutionPorts(persistence),
      ).prove(current.command),
    );
    expect(generationFailure).toBeInstanceOf(
      PointCommitStaleAuthorityV1Error,
    );
    expect(generationFailure).toMatchObject({ reason: "generationChanged" });

    const mismatchedScopeId = decodeReplacementScopeIdV1(
      "scope_99000000-0000-4000-8000-000000000001",
    );
    const invalidClockFailure = await runFailure(
      createPointCommitRollbackProofPortV1({
        ...resolutionPorts(persistence),
        scopeSessionTargets: {
          resolve: async (physicalLocator) => {
            const target =
              createPGliteLocatedPointMutationSessionActivationTargetV1(
                persistence,
                physicalLocator,
              );
            return Object.freeze({
              physicalLocator: target.physicalLocator,
              getCurrentClock: async (
                scopeId: Parameters<
                  LocatedScopeClockReader["getCurrentClock"]
                >[0],
              ) => {
                const clock = await target.getCurrentClock(scopeId);
                if (clock === null) return null;
                return Object.freeze({
                  ...clock,
                  scopeId: mismatchedScopeId,
                });
              },
            } satisfies LocatedScopeClockReader);
          },
        },
      }).prove(current.command),
    );
    expect(invalidClockFailure).toBeInstanceOf(
      PointCommitCorruptionV1Error,
    );
    expect(invalidClockFailure).toMatchObject({ reason: "scopeClockInvalid" });

    const targetFailure = Object.assign(new Error("target offline"), {
      code: "57P01",
    });
    const sqlFailure = await runFailure(
      createPointCommitRollbackProofPortV1({
        ...resolutionPorts(persistence),
        scopeSessionTargets: {
          resolve: async () => {
            throw targetFailure;
          },
        },
      }).prove(current.command),
    );
    expect(sqlFailure).toBeInstanceOf(PointCommitSqlErrorV1);
    expect(sqlFailure).toMatchObject({
      operation: "resolveAuthority",
      sqlState: "57P01",
    });
  });

  it("validates point-commit command capture before authority I/O without swallowing defects", async () => {
    const prepared = await prepareO06Scenario(
      "o06_command_capture",
      async (scenario, table) => {
        await runPointOperation(scenario.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "capture" },
        });
      },
    );
    let authorityReads = 0;
    const proof = createPointCommitRollbackProofPortV1({
      ...resolutionPorts(persistence),
      scopeMetadata: {
        getScopeMetadataByDeploymentId: async () => {
          authorityReads += 1;
          throw new Error("Invalid command reached authority I/O.");
        },
      },
    });

    let nextCreationTimeReads = 0;
    const orderedSealIdentity = { ...prepared.command.sealIdentity };
    Object.defineProperty(orderedSealIdentity, "creationTimeSeed", {
      enumerable: true,
      get: () => Number.NaN,
    });
    Object.defineProperty(orderedSealIdentity, "nextCreationTime", {
      enumerable: true,
      get: () => {
        nextCreationTimeReads += 1;
        throw new Error("Later seal field must not be read.");
      },
    });
    const invalidSeal = Object.freeze({
      ...prepared.command,
      sealIdentity: Object.freeze(orderedSealIdentity),
    }) as unknown as PointCommitTransactionCommandV1;
    await expect(runFailure(proof.prove(invalidSeal))).resolves.toMatchObject({
      _tag: "PointCommitCorruptionV1Error",
      reason: "commandInvalid",
    });
    expect(nextCreationTimeReads).toBe(0);

    const dependency = prepared.command.dependencies[0];
    if (dependency === undefined) {
      throw new Error("Expected one captured command dependency.");
    }
    let rowIdReads = 0;
    const orderedDependency = { ...dependency };
    Object.defineProperty(orderedDependency, "tableId", {
      enumerable: true,
      get: () => 0,
    });
    Object.defineProperty(orderedDependency, "rowId", {
      enumerable: true,
      get: () => {
        rowIdReads += 1;
        throw new Error("Later dependency field must not be read.");
      },
    });
    const invalidDependency = Object.freeze({
      ...prepared.command,
      dependencies: Object.freeze([
        Object.freeze(orderedDependency),
      ]),
    }) as unknown as PointCommitTransactionCommandV1;
    await expect(
      runFailure(proof.prove(invalidDependency)),
    ).resolves.toMatchObject({
      _tag: "PointCommitCorruptionV1Error",
      reason: "commandInvalid",
    });
    expect(rowIdReads).toBe(0);

    for (const observed of [
      Object.freeze({ kind: "unknown" }),
      Object.freeze({
        kind: "missing",
        basis: Object.freeze({ kind: "unknown" }),
      }),
    ]) {
      const invalidDiscriminant = Object.freeze({
        ...prepared.command,
        dependencies: Object.freeze([
          Object.freeze({
            ...dependency,
            dependency: Object.freeze({
              ...dependency.dependency,
              observed,
            }),
          }),
        ]),
      }) as unknown as PointCommitTransactionCommandV1;
      await expect(
        runFailure(proof.prove(invalidDiscriminant)),
      ).resolves.toMatchObject({
        _tag: "PointCommitCorruptionV1Error",
        reason: "commandInvalid",
      });
    }

    const sparseDependencies = new Array(
      prepared.command.dependencies.length,
    );
    const sparseCommand = Object.freeze({
      ...prepared.command,
      dependencies: Object.freeze(sparseDependencies),
    }) as PointCommitTransactionCommandV1;
    await expect(runFailure(proof.prove(sparseCommand))).resolves.toMatchObject({
      _tag: "PointCommitCorruptionV1Error",
      reason: "commandInvalid",
    });

    const rowIntent = prepared.command.rowIntents[0];
    if (rowIntent?.kind !== "live") {
      throw new Error("Expected one live captured row intent.");
    }
    const duplicateRowIntents = Object.freeze({
      ...prepared.command,
      rowIntents: Object.freeze([rowIntent, rowIntent]),
    });
    await expect(
      runFailure(proof.prove(duplicateRowIntents)),
    ).resolves.toMatchObject({
      _tag: "PointCommitCorruptionV1Error",
      reason: "commandInvalid",
    });

    const mixedLegacyPins = Object.freeze({
      ...prepared.command,
      authorityPins: Object.freeze({
        ...prepared.command.authorityPins,
        applicationExecutionAuthoritySha256: new Uint8Array(32),
      }),
    }) as unknown as PointCommitTransactionCommandV1;
    await expect(runFailure(proof.prove(mixedLegacyPins))).resolves
      .toMatchObject({
        _tag: "PointCommitCorruptionV1Error",
        reason: "commandInvalid",
      });

    const mixedLegacySession = Object.freeze({
      ...prepared.command,
      session: Object.freeze({
        ...prepared.command.session,
        applicationExecutionAuthorityJson: Object.freeze({}),
        applicationExecutionAuthorityCanonicalBytes: new Uint8Array(),
        applicationExecutionAuthoritySha256: new Uint8Array(32),
      }),
    }) as unknown as PointCommitTransactionCommandV1;
    await expect(runFailure(proof.prove(mixedLegacySession))).resolves
      .toMatchObject({
        _tag: "PointCommitCorruptionV1Error",
        reason: "commandInvalid",
      });
    const oversizedRowIntents = Object.freeze({
      ...prepared.command,
      rowIntents: Object.freeze(Array.from(
        { length: MAX_POINT_COMMIT_MATERIAL_ROWS_V1 + 1 },
        () => rowIntent,
      )),
    });
    await expect(
      runFailure(proof.prove(oversizedRowIntents)),
    ).resolves.toMatchObject({
      _tag: "PointCommitCorruptionV1Error",
      reason: "commandInvalid",
    });
    const sparseRowIntents = new Array(1);
    await expect(runFailure(proof.prove(Object.freeze({
      ...prepared.command,
      rowIntents: Object.freeze(sparseRowIntents),
    })))).resolves.toMatchObject({
      _tag: "PointCommitCorruptionV1Error",
      reason: "commandInvalid",
    });
    const invalidCanonicalValue = Object.freeze({
      ...prepared.command,
      rowIntents: Object.freeze([Object.freeze({
        ...rowIntent,
        value: Object.freeze({ invalid: 1n << 70n }),
      })]),
    }) as PointCommitTransactionCommandV1;
    await expect(
      runFailure(proof.prove(invalidCanonicalValue)),
    ).resolves.toMatchObject({
      _tag: "PointCommitCorruptionV1Error",
      reason: "commandInvalid",
    });

    const invalidCanonicalBytes = Object.freeze({
      ...prepared.command,
      rowIntents: Object.freeze([Object.freeze({
        ...rowIntent,
        canonicalBytes: Object.create(Uint8Array.prototype) as Uint8Array,
      })]),
    });
    await expect(
      runFailure(proof.prove(invalidCanonicalBytes)),
    ).resolves.toMatchObject({
      _tag: "PointCommitCorruptionV1Error",
      reason: "commandInvalid",
    });

    const iteratorDependencies = Array.from(prepared.command.dependencies);
    Object.defineProperty(iteratorDependencies, Symbol.iterator, {
      value: function* () {},
    });
    const overriddenIterator = Object.freeze({
      ...prepared.command,
      dependencies: Object.freeze(iteratorDependencies),
    });
    await expect(runEffect(
      createPointCommitRollbackProofPortV1(
        resolutionPorts(persistence),
      ).prove(overriddenIterator),
    )).resolves.toEqual({ kind: "wouldCommit" });

    const lengthMutatingDependencies = Array.from(
      prepared.command.dependencies,
    );
    Object.defineProperty(lengthMutatingDependencies, 0, {
      configurable: true,
      enumerable: true,
      get: () => {
        lengthMutatingDependencies.length = 0;
        return dependency;
      },
    });
    const lengthMutatingCommand = Object.freeze({
      ...prepared.command,
      dependencies: lengthMutatingDependencies,
    });
    await expect(runEffect(
      createPointCommitRollbackProofPortV1(
        resolutionPorts(persistence),
      ).prove(lengthMutatingCommand),
    )).resolves.toEqual({ kind: "wouldCommit" });

    const defect = new Error("command session getter defect");
    const defectiveCommand = { ...prepared.command };
    Object.defineProperty(defectiveCommand, "session", {
      enumerable: true,
      get: () => { throw defect; },
    });
    const exit = await Effect.runPromiseExit(
      proof.prove(defectiveCommand as PointCommitTransactionCommandV1),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.toString()).toContain(defect.message);
      expect(exit.cause.toString()).not.toContain(
        "PointCommitCorruptionV1Error",
      );
    }
    expect(authorityReads).toBe(0);
  });

  it("keeps malformed locked scope-clock scalars as corruption", async () => {
    const prepared = await prepareO06Scenario(
      "o06_corrupt_locked_clock",
      async () => undefined,
    );
    await persistence.exec(`
      alter table fx_system_scope_clock
        drop constraint fx_system_scope_clock_authorization_revocation_epoch_non_negative_check
    `);
    try {
      await persistence.query(
        `
          update fx_system_scope_clock
          set authorization_revocation_epoch = -1
          where scope_uuid = $1
        `,
        [prepared.evidence.scopeUuid],
      );
      const failure = await runFailure(
        createPointCommitRollbackProofPortV1(
          resolutionPorts(persistence),
        ).prove(prepared.command),
      );
      expect(failure).toBeInstanceOf(PointCommitCorruptionV1Error);
      expect(failure).toMatchObject({ reason: "scopeClockInvalid" });
    } finally {
      await persistence.query(
        `
          update fx_system_scope_clock
          set authorization_revocation_epoch = $1
          where scope_uuid = $2
        `,
        [
          prepared.evidence.session.authorizationRevocationEpoch,
          prepared.evidence.scopeUuid,
        ],
      );
      await persistence.exec(`
        alter table fx_system_scope_clock
          add constraint fx_system_scope_clock_authorization_revocation_epoch_non_negative_check
          check (authorization_revocation_epoch >= 0)
      `);
    }
  });

  it("classifies OCC conflicts and commit-sequence exhaustion without writes", async () => {
    const conflict = await prepareO06Scenario(
      "o06_occ_conflict",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "planned" },
        });
      },
    );
    await commitCompetingPointRow(conflict.command);
    const conflictBefore = await o06DurableState(conflict.evidence.scopeUuid);
    const conflictFailure = await runFailure(
      createPointCommitRollbackProofPortV1(
        resolutionPorts(persistence),
      ).prove(conflict.command),
    );
    expect(conflictFailure).toBeInstanceOf(PointCommitConflictV1Error);
    expect(await o06DurableState(conflict.evidence.scopeUuid)).toEqual(
      conflictBefore,
    );

    const exhausted = await prepareO06Scenario(
      "o06_sequence_exhaustion",
      async (current, table) => {
        await runPointOperation(current.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "exhausted" },
        });
      },
    );
    await persistence.query(
      `
        update fx_system_scope_clock
        set last_commit_seq = $2
        where scope_uuid = $1
      `,
      [exhausted.evidence.scopeUuid, MAX_PERSISTED_SIGNED_INT64_V1],
    );
    const exhaustedFailure = await runFailure(
      createPointCommitRollbackProofPortV1(
        resolutionPorts(persistence),
      ).prove(exhausted.command),
    );
    expect(exhaustedFailure).toBeInstanceOf(
      PointCommitResourceExhaustionV1Error,
    );
    expect(exhaustedFailure).toMatchObject({ dimension: "commitSequence" });
  });

  it("detects an indexed phantom and permits a commit outside the captured range", async () => {
    const conflict = await prepareO08B1Scenario(
      "o10b_range_overlap",
      (current, table) => runO10IndexedQuery(current, table),
      (current) => prepareDeveloperIndexForO06(current),
    );
    const inserted = await commitCompetingIndexedUserForO10(
      conflict.current,
      "phantom",
      "22".repeat(16),
    );
    const conflictBefore = await o06DurableState(conflict.scopeUuid);
    const failure = await runFailure(
      conflict.authentication.publishPointCommit(conflict.plan),
    );
    expect(failure).toBeInstanceOf(PointCommitConflictV1Error);
    expect(failure).toMatchObject({
      conflict: {
        kind: "appIndexRange",
        reason: "overlap",
        dependencyOrdinal: 0,
        tableId: decodeCatalogTableId(1),
        encodedKey: inserted.encodedKey,
        rowId: decodeOrderedIndexRowIdHexV1("22".repeat(16)),
      },
      snapshotCommitSeq: CommitSeqSchema.make(0n),
      currentCommitSeq: CommitSeqSchema.make(1n),
    });
    expect(await o06DurableState(conflict.scopeUuid)).toEqual(conflictBefore);
    const rerun = await runEffect(
      conflict.authentication.authorizePointMutationOccRerun(failure).pipe(
        Effect.provideService(Random.Random, {
          nextDoubleUnsafe: () => 0,
          nextIntUnsafe: () => 0,
        }),
      ),
    );
    expect(rerun).toMatchObject({
      kind: "authorized",
      backoffUpperBoundMilliseconds: 100,
      backoffMilliseconds: 0,
    });

    const overflow = await prepareO08B1Scenario(
      "o10b_range_window_overflow",
      (current, table) => runO10IndexedQuery(current, table),
      (current) => prepareDeveloperIndexForO06(current),
    );
    const overflowCommitSeq = MAX_INDEX_RANGE_OCC_COMMIT_SPAN_V1 + 1n;
    await persistence.query(
      `update fx_system_scope_clock
          set last_commit_seq = $2
        where scope_uuid = $1`,
      [overflow.scopeUuid, overflowCommitSeq],
    );
    const overflowBefore = await o06DurableState(overflow.scopeUuid);
    const overflowFailure = await runFailure(
      overflow.authentication.publishPointCommit(overflow.plan),
    );
    expect(overflowFailure).toBeInstanceOf(PointCommitConflictV1Error);
    expect(overflowFailure).toMatchObject({
      conflict: {
        kind: "appIndexRange",
        reason: "validationWindowExceeded",
        dependencyOrdinal: 0,
        tableId: decodeCatalogTableId(1),
      },
      snapshotCommitSeq: CommitSeqSchema.make(0n),
      currentCommitSeq: CommitSeqSchema.make(overflowCommitSeq),
    });
    expect(await o06DurableState(overflow.scopeUuid)).toEqual(overflowBefore);
    await expect(runEffect(
      overflow.authentication.authorizePointMutationOccRerun(
        overflowFailure,
      ).pipe(
        Effect.provideService(Random.Random, {
          nextDoubleUnsafe: () => 0,
          nextIntUnsafe: () => 0,
        }),
      ),
    )).resolves.toMatchObject({
      kind: "authorized",
      backoffUpperBoundMilliseconds: 100,
      backoffMilliseconds: 0,
    });

    const outside = await prepareO07BScenario(
      "o10b_range_no_overlap",
      async (current, table) => {
        await prepareDeveloperIndexForO06(current);
        const definition = await locateDeveloperIndexDefinitionForO10(current);
        const boundaryRowId = decodeAppRowIdHexV1("33".repeat(16));
        const boundaryCreationTime = decodeAppCreationTimeV1(3);
        const boundaryDocument = await canonicalizeAppDocumentV1({
          tableId: decodeCatalogTableId(1),
          rowId: boundaryRowId,
          creationTime: boundaryCreationTime,
          fields: { name: "middle" },
        });
        const endExclusive = decodeOrderedIndexBoundHexV1(
          Result.getOrThrow(lowerAppDeveloperIndexKeyV1(
            definition,
            boundaryDocument,
            boundaryCreationTime,
          )),
        );
        await runO10IndexedQuery(
          current,
          table,
          Object.freeze({ endExclusive }),
        );
      },
      (current) => prepareDeveloperIndexForO06(current),
      false,
      true,
    );
    await commitCompetingIndexedUserForO10(
      outside.current,
      "zulu",
      "44".repeat(16),
    );
    await expect(runEffect(
      outside.authentication.publishPointCommit(outside.plan),
    )).resolves.toMatchObject({ kind: "published" });
    expect(await o06DurableState(outside.scopeUuid)).toMatchObject({
      revisions: "1",
      commit_headers: "2",
      outcomes: "1",
      last_commit_seq: "2",
    });
  });

  it("does not observe interruption until forced rollback settles", async () => {
    const current = await prepareO06Scenario(
      "o06_interruption",
      async (scenario, table) => {
        await runPointOperation(scenario.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "interrupt" },
        });
      },
    );
    const entered = deferredSignal();
    const release = deferredSignal();
    let interruptionSettled = false;
    const port = createPointCommitRollbackProofPortV1(
      resolutionPorts(persistence),
      {
        afterTransactionStep: async (event) => {
          if (event.step !== "beforeRollback") return;
          entered.resolve();
          await release.promise;
        },
      },
    );
    const fiber = Effect.runFork(port.prove(current.command));
    await entered.promise;
    const interruption = runEffect(Fiber.interrupt(fiber)).then((exit) => {
      interruptionSettled = true;
      return exit;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
    expect(interruptionSettled).toBe(false);
    release.resolve();
    await interruption;
    expect(interruptionSettled).toBe(true);
    expect(await o06DurableState(current.evidence.scopeUuid)).toMatchObject({
      revisions: "0",
      current_rows: "0",
      last_commit_seq: "0",
    });
  });

  it("fails closed when rollback infrastructure or its sentinel contract fails", async () => {
    const current = await prepareO06Scenario(
      "o06_rollback_contract_failures",
      async (scenario, table) => {
        await runPointOperation(scenario.store, table, {
          kind: "insert",
          syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
          fields: { name: "rollback-contract" },
        });
      },
    );
    const before = await o06DurableState(current.evidence.scopeUuid);
    const rollbackCause = new Error("rollback infrastructure failed");
    const rollbackFailure = await runFailure(
      createPointCommitRollbackProofPortV1({
        ...resolutionPorts(persistence),
        scopeSessionTargets: {
          resolve: async (physicalLocator) => {
            const target =
              createPGliteLocatedPointMutationSessionActivationTargetV1(
                persistence,
                physicalLocator,
              );
            if (!isLocatedReadCommittedAttemptTargetV1(target)) {
              throw new Error("Expected the PGlite READ COMMITTED target.");
            }
            const proxyBase = Object.freeze({
              physicalLocator: target.physicalLocator,
              getCurrentClock: target.getCurrentClock,
            }) satisfies LocatedScopeClockReader;
            return new Proxy(proxyBase, {
              get: (subject, property, receiver) => {
                if (property !== RUN_LOCATED_READ_COMMITTED_V1) {
                  return Reflect.get(subject, property, receiver);
                }
                return async (
                  work: (tx: AppRowTransaction) => Promise<unknown>,
                ) => {
                  try {
                    return await target[RUN_LOCATED_READ_COMMITTED_V1](work);
                  } catch (callbackCause) {
                    const originalCallbackCause =
                      callbackCause instanceof
                          LocatedReadCommittedTransactionFailureV1 &&
                        callbackCause.issue.kind === "callbackRolledBack"
                        ? callbackCause.issue.callbackCause
                        : callbackCause;
                    throw new LocatedReadCommittedTransactionFailureV1(
                      Object.freeze({
                        kind: "callbackCleanupFailed",
                        callbackCause: originalCallbackCause,
                        transactionCause: rollbackCause,
                      }),
                    );
                  }
                };
              },
            });
          },
        },
      }).prove(current.command),
    );
    expect(rollbackFailure).toBeInstanceOf(PointCommitSqlErrorV1);
    if (!(rollbackFailure instanceof PointCommitSqlErrorV1)) {
      throw new Error("Expected the rollback infrastructure SQL failure.");
    }
    expect(rollbackFailure).toMatchObject({ operation: "beginOrRollback" });
    expect(rollbackFailure.cause).toBeInstanceOf(
      LocatedReadCommittedTransactionFailureV1,
    );
    if (
      !(rollbackFailure.cause instanceof
        LocatedReadCommittedTransactionFailureV1)
    ) {
      throw new Error("Expected the located transaction failure wrapper.");
    }
    expect(rollbackFailure.cause.issue).toMatchObject({
      kind: "callbackCleanupFailed",
      transactionCause: rollbackCause,
    });
    if (rollbackFailure.cause.issue.kind !== "callbackCleanupFailed") {
      throw new Error("Expected callback cleanup failure evidence.");
    }
    expect(rollbackFailure.cause.issue.callbackCause).toMatchObject({
      kind: "pointCommitRollbackSentinel",
    });
    expect(await o06DurableState(current.evidence.scopeUuid)).toEqual(before);

    const missingSentinelFailure = await runFailure(
      createPointCommitRollbackProofPortV1({
        ...resolutionPorts(persistence),
        scopeSessionTargets: {
          resolve: async (physicalLocator) => {
            const target =
              createPGliteLocatedPointMutationSessionActivationTargetV1(
                persistence,
                physicalLocator,
              );
            if (!isLocatedReadCommittedAttemptTargetV1(target)) {
              throw new Error("Expected the PGlite READ COMMITTED target.");
            }
            const proxyBase = Object.freeze({
              physicalLocator: target.physicalLocator,
              getCurrentClock: target.getCurrentClock,
            }) satisfies LocatedScopeClockReader;
            return new Proxy(proxyBase, {
              get: (subject, property, receiver) =>
                property === RUN_LOCATED_READ_COMMITTED_V1
                  ? async () => undefined
                  : Reflect.get(subject, property, receiver),
            });
          },
        },
      }).prove(current.command),
    );
    expect(missingSentinelFailure).toBeInstanceOf(
      PointCommitCorruptionV1Error,
    );
    expect(missingSentinelFailure).toMatchObject({
      reason: "rollbackSentinelMissing",
    });
    expect(await o06DurableState(current.evidence.scopeUuid)).toEqual(before);
  });

  it("decodes malformed schema evidence only after repeatable read closes", async () => {
    const current = await scenario("commit_authority_malformed_schema");
    await seal(current);
    const authenticatedEvidence = await runEffect(
      current.loader.loadEffect(current.authority),
    );
    if (authenticatedEvidence.kind !== "loaded") {
      throw new Error("Expected C04A evidence.");
    }
    const authority = commitAuthorityFromStoredEvidence(
      current.authority,
      authenticatedEvidence.evidence,
    );
    await persistence.query(
      `
        update fx_control_schema_version
        set manifest_bytes = convert_to('x', 'UTF8')
        where deployment_id = $1
          and schema_version_id = $2
      `,
      [current.anchor.deploymentId, current.schemaVersionId],
    );

    let transactionClosed = false;
    let decodeObservedAfterClose = false;
    const loader = createStoredCommitAuthorityEvidenceLoaderV1(
      resolutionPorts(persistence),
      {
        afterRepeatableRead: () => {
          transactionClosed = true;
        },
        beforeSchemaArtifactDecode: () => {
          decodeObservedAfterClose = transactionClosed;
        },
      },
    );

    await expect(runEffect(loader.loadEffect(authority))).resolves.toMatchObject({
      kind: "corrupt",
      reason: "schemaArtifactInvalid",
    });
    expect(transactionClosed).toBe(true);
    expect(decodeObservedAfterClose).toBe(true);
  });

  it("does not disguise unexpected detached materialization defects as corruption", async () => {
    const current = await scenario("commit_authority_materialization_defect");
    await seal(current);
    const authenticatedEvidence = await runEffect(
      current.loader.loadEffect(current.authority),
    );
    if (authenticatedEvidence.kind !== "loaded") {
      throw new Error("Expected C04A evidence.");
    }
    const authority = commitAuthorityFromStoredEvidence(
      current.authority,
      authenticatedEvidence.evidence,
    );
    const defect = new Error("materialization defect sentinel");
    const loader = createStoredCommitAuthorityEvidenceLoaderV1(
      resolutionPorts(persistence),
      {
        beforeSchemaArtifactDecode: () => {
          throw defect;
        },
      },
    );

    const failure = await runFailure(loader.loadEffect(authority));
    expect(failure).toBeInstanceOf(
      StoredCommitAuthorityEvidencePersistenceV1Error,
    );
    expect(failure).toMatchObject({
      operation: "beforeSchemaArtifactDecode",
      cause: defect,
    });
  });

  it("accepts the exact 64 MiB aggregate and skips every payload at +1", async () => {
    const current = await scenario("commit_authority_limit");
    await seal(current);
    const authenticatedEvidence = await runEffect(
      current.loader.loadEffect(current.authority),
    );
    if (authenticatedEvidence.kind !== "loaded") {
      throw new Error("Expected C04A evidence.");
    }
    const baseAuthority = commitAuthorityFromStoredEvidence(
      current.authority,
      authenticatedEvidence.evidence,
    );
    const measured = await persistence.query<{
      total: string;
      args_bytes: string;
    }>(
      `
        select
          (
            octet_length(session.validated_args_json::text)
            + octet_length(session.validated_args_canonical_bytes)
            + octet_length(session.authorization_grant_json::text)
            + octet_length(session.authorization_grant_canonical_bytes)
            + octet_length(schema_version.manifest_json::text)
            + octet_length(schema_version.manifest_bytes)
          )::bigint::text as total,
          octet_length(session.validated_args_canonical_bytes)::bigint::text
            as args_bytes
        from fx_system_tx_session as session
        join fx_control_schema_version as schema_version
          on schema_version.deployment_id = $2
          and schema_version.schema_version_id = session.schema_version_id
        where session.session_id = $1
      `,
      [current.anchor.sessionId, current.anchor.deploymentId],
    );
    const measurement = measured.rows[0];
    if (measurement === undefined) throw new Error("Missing size measurement.");
    const exactArgsBytes = Number(measurement.args_bytes) +
      MAX_STORED_COMMIT_AUTHORITY_MATERIALIZATION_BYTES_V1 -
      Number(measurement.total);
    await persistence.query(
      `
        update fx_system_tx_session
        set validated_args_canonical_bytes =
          convert_to(repeat('x', $2), 'UTF8')
        where session_id = $1
      `,
      [current.anchor.sessionId, exactArgsBytes],
    );
    const exactAuthority = Object.freeze({
      ...baseAuthority,
      session: Object.freeze({
        ...baseAuthority.session,
        validatedArgsCanonicalByteLength: exactArgsBytes,
      }),
    });
    const exactQueries: string[] = [];
    const exactLoader = createStoredCommitAuthorityEvidenceLoaderV1(
      resolutionPorts(persistence),
      { observeQuery: (query) => exactQueries.push(query.name) },
    );
    await expect(runEffect(exactLoader.loadEffect(exactAuthority))).resolves
      .toMatchObject({
      kind: "loaded",
    });
    expect(exactQueries).toContain("authorityPayload");

    await persistence.query(
      `
        update fx_system_tx_session
        set validated_args_canonical_bytes =
          validated_args_canonical_bytes || decode('00', 'hex')
        where session_id = $1
      `,
      [current.anchor.sessionId],
    );
    const overflowAuthority = Object.freeze({
      ...baseAuthority,
      session: Object.freeze({
        ...baseAuthority.session,
        validatedArgsCanonicalByteLength: exactArgsBytes + 1,
      }),
    });
    const overflowQueries: string[] = [];
    const overflowLoader = createStoredCommitAuthorityEvidenceLoaderV1(
      resolutionPorts(persistence),
      { observeQuery: (query) => overflowQueries.push(query.name) },
    );
    await expect(runEffect(overflowLoader.loadEffect(overflowAuthority))).resolves
      .toMatchObject({ kind: "corrupt", reason: "evidenceLimitExceeded" });
    expect(overflowQueries).not.toContain("authorityPayload");
    expect(overflowQueries).not.toContain("schemaPayload");
    expect(overflowQueries).not.toContain("stableBindings");
  }, 120_000);

  interface ScenarioOptions {
    readonly afterRepeatableRead?: () => void | Promise<void>;
  }

  async function scenario(
    label: string,
    options: ScenarioOptions = {},
  ): Promise<Scenario> {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      `deployment_stored_attempt_${label}`,
    );
    const schemaVersionId = CatalogSchemaVersionIdSchema.make(
      `schema_stored_attempt_${label}`,
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: nextUuid,
      },
    ).ensure({
      deploymentId,
      projectId: `project_stored_attempt_${label}`,
    });
    const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
    await setFlarexActivationClock(persistence, scopeId);
    await persistence.publishAppSchemaV1({
      deploymentId,
      schemaVersionId,
      version: CatalogSchemaVersionSchema.make(1),
      tables: [appTable("users")],
      indexes: [],
    });
    const ports = resolutionPorts(persistence);
    const activation = await activatePointMutationSession(
      createPointMutationSessionActivationPersistenceV1(
        ports,
        { leaseDurationMilliseconds: 60_000, randomUuid: nextUuid },
      ),
      pointMutationSessionActivationFixture(
        deploymentId,
        scopeId,
        { evidence: { schemaVersionId } },
      ),
    );
    if (activation.status !== "created") {
      throw new Error("Expected a newly created stored-attempt scenario.");
    }
    const executionClaims = createPointMutationExecutionClaimVaultV1();
    const executionScope = await runEffect(Effect.fromResult(
      executionClaims.admission.admit(executionClaims.issuer.mint({
        selector: selectorFromAnchor(activation.anchor),
        observation: activation.executionClaim,
        mode: "execute",
      }), "execute"),
    ));
    const store = createSessionJournalStorePersistenceV1(ports, {
      grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      randomUuid: nextUuid,
    });
    const authority = authorityFromAnchor(
      activation.anchor,
      schemaVersionId,
      activation.executionClaim,
    );
    const attempt = await runEffect(
      store.openAttemptEffect({
        selector: selectorFromAnchor(activation.anchor),
        executionClaim: activation.executionClaim,
        snapshotToken: activation.anchor.snapshotToken,
        schemaVersionId,
      }),
    );
    const loader = createStoredAttemptEvidenceLoaderV1(ports, options);
    return Object.freeze({
      persistence,
      anchor: activation.anchor,
      executionClaims,
      executionScope,
      schemaVersionId,
      store,
      attempt,
      loader,
      authority,
    });
  }

  async function c04b2ActivatedInitialScenario(
    label: string,
    loaderOptions: ScenarioOptions = {},
    seedRow = false,
    returnsValidator: PointMutationTargetFunctionMetadataV1["returnsValidator"] = {
      type: "object",
      value: {
        ok: { optional: false, fieldType: { type: "boolean" } },
      },
    },
    developerIndex: boolean | number = false,
  ) {
    const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
      `deployment_stored_attempt_${label}`,
    );
    const schemaVersionId = CatalogSchemaVersionIdSchema.make(
      `schema_stored_attempt_${label}`,
    );
    const provisioned = await createPGliteSharedScopeAuthorityProvisioner(
      persistence,
      {
        physicalLocator: sharedLocator,
        randomUuid: nextUuid,
      },
    ).ensure({
      deploymentId,
      projectId: `project_stored_attempt_${label}`,
    });
    const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
    await setFlarexActivationClock(persistence, scopeId);
    const usersTable = appTable("users");
    const developerIndexCount = developerIndex === true
      ? 1
      : developerIndex === false
        ? 0
        : developerIndex;
    const developerIndexFields = [
      ["name", "profile.alias"],
      ["alias"],
      ["category"],
    ] as const;
    await persistence.publishAppSchemaV1({
      deploymentId,
      schemaVersionId,
      version: CatalogSchemaVersionSchema.make(1),
      tables: [usersTable],
      indexes: Array.from({ length: developerIndexCount }, (_, index) => ({
          tableLogicalName: "users",
          descriptor: `byDeveloperField${index}`,
          fields: developerIndexFields[index] ?? ["name"],
        })),
    });
    const seededDocumentId = seedRow
      ? await seedCommittedUser(scopeId, schemaVersionId)
      : null;
    const target = decodeActivePointMutationTargetMetadataV1({
      format: "flarex.point-mutation-target-metadata",
      version: 1,
      deploymentId,
      scopeId,
      packageId: "package_c04b2_pglite",
      artifactRuntime: "dynamic-worker",
      artifactId: `artifact_${"b".repeat(32)}`,
      sourcePackageHash: "b".repeat(64),
      schemaVersionId,
      functions: [
        {
          path: "users:create",
          executionModule: "flarex/users.ts",
          kind: "mutation",
          visibility: "public",
          argsValidator: { type: "object", value: {} },
          returnsValidator,
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
          indexes: Array.from({ length: developerIndexCount }, (_, index) => ({
              logicalIndexId: decodeCatalogIndexId(index + 1),
              tableId: 1,
              namespace: "app",
              descriptor: `byDeveloperField${index}`,
              spec: {
                kind: "developerOrdered",
                specVersion: 1,
                fields: [...(developerIndexFields[index] ?? ["name"])],
              },
            })),
        },
      },
    });
    const requestKey = TransactionRequestKeyV1Schema.make(`request:${label}`);
    const revocationEpoch =
      TransactionAuthorizationRevocationEpochSchema.make(0n);
    const preparedHandle = await createExecutorPointMutationStartPreparationV1({
      loadActiveTargetMetadata: async () => structuredClone(target),
      loadCurrentScopeAuthority: async () => ({
        deploymentId,
        scopeId,
        authorizationRevocationEpoch: revocationEpoch,
      }),
    }).prepare({
      deploymentId,
      functionPath: TransactionFunctionPathV1Schema.make("users:create"),
      args: {},
      requestKey,
    });
    const prepared = inspectExecutorPreparedPointMutationStartV1(
      preparedHandle,
    );
    const policy = await canonicalizeTransactionGrantIdentityAccessPolicyV1({
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
      auth: { kind: "anonymous" },
      capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
    });
    const issuedAtMilliseconds = Date.now() - 1_000;
    const expiresAtMilliseconds = Date.now() + 60_000;
    const payload = await canonicalizeTransactionGrantPayloadV1({
      format: "flarex.transaction-grant",
      version: 1,
      grantId: `grant_${label}`,
      ...prepared.logicalPins,
      policyVersion: TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
      identityAccessPolicySha256: policy.sha256Hex,
      capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
      auth: { kind: "anonymous" },
      issuedAt: new Date(issuedAtMilliseconds).toISOString(),
      expiresAt: new Date(expiresAtMilliseconds).toISOString(),
      authorizationRevocationEpoch: revocationEpoch.toString(),
    });
    const kid = TransactionGrantKeyIdV1Schema.make(`key_${label}`);
    const header = canonicalizeTransactionGrantProtectedHeaderV1({
      alg: "Ed25519",
      kid,
      typ: "flarex-transaction-grant+jws",
    });
    const grant = await deriveInertTransactionGrantEvidenceV1({
      protected: header.base64url,
      payload: payload.base64url,
      signature: encodeTransactionGrantEd25519SignatureV1(new Uint8Array(64)),
    });
    const ports = resolutionPorts(persistence);
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
              issuedAtInclusiveEpochMilliseconds:
                issuedAtMilliseconds - 1_000,
              verificationEndsAtExclusiveEpochMilliseconds:
                expiresAtMilliseconds + 1_000,
              verify: async () => true,
            },
          ],
        }),
      grantRetentionPolicy: Result.getOrThrow(
        makeGrantRetentionPolicyV1Result({
          maximumGrantLifetimeMilliseconds: 120_000,
          maximumFutureIssuedAtSkewMilliseconds: 0,
          maximumLiveSnapshotRetentionMilliseconds: 120_000,
        }),
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
    const activated = await runEffect(createPointMutationSessionActivationV1(
      createPointMutationSessionActivationPersistenceV1(ports, {
        leaseDurationMilliseconds: 60_000,
        randomUuid: nextUuid,
      }),
      executionClaims.issuer,
    ).activate(admitted));
    const activation = inspectActivatedPointMutationSessionV1(activated);
    if (activation.status !== "created") {
      throw new Error("Expected a newly created C04B2 scenario.");
    }
    const store = createSessionJournalStorePersistenceV1(ports, {
      grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      randomUuid: nextUuid,
      ...(developerIndexCount > 0
        ? {
            indexedQueries: createAppDeveloperIndexQueryPortV1(
              persistence.drizzle,
              ports,
              createAppDeveloperIndexDefinitionPortV1(persistence.drizzle),
            ),
          }
        : {}),
    });
    const functionMetadata = target.functions[0];
    if (functionMetadata === undefined) {
      throw new Error("Missing C04B2 function metadata fixture.");
    }
    return Object.freeze({
      persistence,
      anchor: activation.anchor,
      executionClaims,
      activated,
      storedExecutionClaim: activation.executionClaim,
      schemaVersionId,
      store,
      loader: createStoredAttemptEvidenceLoaderV1(ports, loaderOptions),
      loading: createPointMutationSessionAttemptLoadingV1(
        createPointMutationSessionAttemptLoadPersistenceV1(ports),
      ),
      verifier,
      functionSnapshot: Object.freeze({
        deploymentId,
        scopeId,
        packageId: prepared.logicalPins.packageId,
        artifactRuntime: prepared.logicalPins.artifactRuntime,
        artifactId: prepared.logicalPins.artifactId,
        sourcePackageHash: prepared.logicalPins.sourcePackageHash,
        executionModule: prepared.logicalPins.executionModule,
        functionPath: prepared.logicalPins.functionPath,
        functionKind: prepared.logicalPins.functionKind,
        schemaVersionId,
        functionMetadata: structuredClone(functionMetadata),
      }),
      seededDocumentId,
    });
  }

  async function c04b2Scenario(
    label: string,
    loaderOptions: ScenarioOptions = {},
    seedRow = false,
    returnsValidator: PointMutationTargetFunctionMetadataV1["returnsValidator"] = {
      type: "object",
      value: {
        ok: { optional: false, fieldType: { type: "boolean" } },
      },
    },
    developerIndex: boolean | number = false,
  ) {
    const current = await c04b2ActivatedInitialScenario(
      label,
      loaderOptions,
      seedRow,
      returnsValidator,
      developerIndex,
    );
    const executionScope = await runEffect(Effect.fromResult(
      current.executionClaims.admission.admit(
        current.executionClaims.issuer.mint({
          selector: selectorFromAnchor(current.anchor),
          observation: current.storedExecutionClaim,
          mode: "execute",
        }),
        "execute",
      ),
    ));
    return Object.freeze({
      ...current,
      executionScope,
      attempt: await runEffect(
        current.store.openAttemptEffect({
          selector: selectorFromAnchor(current.anchor),
          executionClaim: current.storedExecutionClaim,
          snapshotToken: current.anchor.snapshotToken,
          schemaVersionId: current.schemaVersionId,
        }),
      ),
      authority: authorityFromAnchor(
        current.anchor,
        current.schemaVersionId,
        current.storedExecutionClaim,
      ),
    });
  }

  async function seedCommittedUser(
    scopeId: ReturnType<typeof decodeReplacementScopeIdV1>,
    schemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>,
  ) {
    const tableId = decodeCatalogTableId(1);
    const rowId = decodeAppRowIdHexV1("11".repeat(16));
    const creationTime = decodeAppCreationTimeV1(1);
    const clock = await persistence.getScopeClock(scopeId);
    if (clock === null) throw new Error("Missing O06 seed scope clock.");
    const document = await canonicalizeAppDocumentV1({
      tableId,
      rowId,
      creationTime,
      fields: { name: "seeded" },
    });
    await persistence.drizzle.transaction((tx) =>
      appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "live",
        scopeId,
        tableId,
        rowId,
        writeEpoch: clock.epoch,
        commitSeq: CommitSeqSchema.make(1n),
        prevCommitSeq: null,
        schemaVersionId,
        creationTime,
        value: {
          codecVersion: document.codecVersion,
          valueJson: document.valueJson,
          canonicalBytes: document.canonicalBytes,
          sha256: document.sha256,
        },
      })
    );
    await persistence.query(
      `
        update fx_system_scope_clock
        set last_commit_seq = 1
        where scope_id = $1
      `,
      [scopeId],
    );
    return appDocumentIdV1FromRowIdentity({ tableId, rowId });
  }

  async function seedSecondDeveloperBuildRowAtCommitOne(
    current: Awaited<ReturnType<typeof c04b2Scenario>>,
  ): Promise<void> {
    const tableId = decodeCatalogTableId(1);
    const rowId = decodeAppRowIdHexV1("22".repeat(16));
    const creationTime = decodeAppCreationTimeV1(2);
    const clock = await persistence.getScopeClock(current.anchor.scopeId);
    if (clock === null || clock.lastCommitSeq !== 1n) {
      throw new Error("Unexpected developer validation-reset scope frontier.");
    }
    const document = await canonicalizeAppDocumentV1({
      tableId,
      rowId,
      creationTime,
      fields: { name: "second-validation-row" },
    });
    await persistence.drizzle.transaction((tx) =>
      appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "live",
        scopeId: current.anchor.scopeId,
        tableId,
        rowId,
        writeEpoch: clock.epoch,
        commitSeq: CommitSeqSchema.make(1n),
        prevCommitSeq: null,
        schemaVersionId: current.schemaVersionId,
        creationTime,
        value: {
          codecVersion: document.codecVersion,
          valueJson: document.valueJson,
          canonicalBytes: document.canonicalBytes,
          sha256: document.sha256,
        },
      })
    );
  }

  async function developerBuildCursor(
    current: Awaited<ReturnType<typeof c04b2Scenario>>,
    input: BuildAppDeveloperOrderedIndexV1Input,
  ): Promise<string | null> {
    const result = await persistence.query<{ cursor_row_hex: string | null }>(
      `select encode(backfill_cursor_row_id, 'hex') as cursor_row_hex
         from fx_system_index_build_state
        where scope_id = $1 and index_definition_id = $2`,
      [current.anchor.scopeId, input.indexDefinitionId],
    );
    return result.rows[0]?.cursor_row_hex ?? null;
  }

  async function prepareO06Scenario(
    label: string,
    operation: (
      current: Awaited<ReturnType<typeof c04b2Scenario>>,
      table: PinnedPointTableV1,
    ) => Promise<void>,
    seedRow = false,
  ) {
    const current = await c04b2Scenario(label, {}, seedRow);
    const table = await runEffect(
      current.store.resolvePointTableEffect(current.attempt, "users"),
    );
    await operation(current, table);
    await seal(current);
    const running = await runEffect(
      current.loader.loadEffect(current.authority),
    );
    if (running.kind !== "loaded") {
      throw new Error(`Expected running O06 evidence, received ${running.kind}.`);
    }
    await runEffect(
      createPointCommitFinishingTransitionPortV1(
        resolutionPorts(persistence),
      ).enterFinishing(
        await pointCommitFinishingCommandFromStoredAttemptV1(
          current.authority,
          running.evidence,
        ),
      ),
    );
    const loaded = await runEffect(current.loader.loadFinishingEffect(
      selectorFromAnchor(current.anchor),
    ));
    if (loaded.kind !== "loaded") {
      throw new Error(`Expected O06 evidence, received ${loaded.kind}.`);
    }
    return Object.freeze({
      current,
      evidence: loaded.evidence,
      command: await pointCommitCommandFromStoredAttemptV1(
        current.authority,
        loaded.evidence,
      ),
    });
  }

  async function enableIntrinsicIndexForO06(
    current: Awaited<ReturnType<typeof c04b2Scenario>>,
  ): Promise<Pick<
    PointCommitTransactionProofOptionsV1,
    "intrinsicCreationTimeIndexes"
  >> {
    const target = createPGliteLocatedIndexBuildReconciliationTargetV1(
      persistence,
      sharedLocator,
    );
    const ports = {
      controlDb: persistence.drizzle,
      authority: {
        scopeMetadata: {
          getScopeMetadataByDeploymentId: (deploymentId: string) =>
            persistence.getScopeMetadataByDeploymentId(deploymentId),
        },
        provisioningReceipts: {
          getScopeAuthorityProvisioningReceipt: async () => null,
        },
        scopeClockTargets: { resolve: async () => target },
      },
    } as const;
    await runEffect(reconcilePublishedIndexBuildsV1Effect(ports, {
      deploymentId: current.anchor.deploymentId,
      schemaVersionId: current.schemaVersionId,
    }));
    for (let step = 0; step < 8; step += 1) {
      const advanced = await runEffect(
        buildIntrinsicCreationTimeIndexV1Effect(ports, {
          deploymentId: current.anchor.deploymentId,
          indexDefinitionId: decodeCatalogIndexDefinitionId(1),
          pageSize: 8,
        }),
      );
      if (advanced.lifecycle === "enabled") break;
    }
    return Object.freeze({
      intrinsicCreationTimeIndexes:
        createIntrinsicCreationTimeIndexDefinitionPortV1(
          persistence.drizzle,
        ),
    });
  }

  async function prepareDeveloperIndexForO06(
    current: Awaited<ReturnType<typeof c04b2Scenario>>,
    seedExistingRow = false,
  ): Promise<Pick<
    PointCommitTransactionProofOptionsV1,
    "developerIndexes"
  >> {
    const target = createPGliteLocatedIndexBuildReconciliationTargetV1(
      persistence,
      sharedLocator,
    );
    await runEffect(reconcilePublishedIndexBuildsV1Effect({
      controlDb: persistence.drizzle,
      authority: {
        scopeMetadata: {
          getScopeMetadataByDeploymentId: (deploymentId: string) =>
            persistence.getScopeMetadataByDeploymentId(deploymentId),
        },
        provisioningReceipts: {
          getScopeAuthorityProvisioningReceipt: async () => null,
        },
        scopeClockTargets: { resolve: async () => target },
      },
    }, {
      deploymentId: current.anchor.deploymentId,
      schemaVersionId: current.schemaVersionId,
    }));
    const developerIndexes = createAppDeveloperIndexDefinitionPortV1(
      persistence.drizzle,
    );
    if (seedExistingRow) {
      if (current.seededDocumentId === null) {
        throw new Error("Missing C08-A seeded developer-index document.");
      }
      const definitions = await runEffect(developerIndexes.locate({
        deploymentId: current.anchor.deploymentId,
        scopeId: current.anchor.scopeId,
        schemaVersionId: current.schemaVersionId,
        tableIds: Object.freeze([decodeCatalogTableId(1)]),
        maximumDefinitions: 256,
      }));
      const definition = definitions?.[0];
      if (definitions?.length !== 1 || definition === undefined) {
        throw new Error("Missing C08-A developer-index definition.");
      }
      const rowId = decodeAppRowIdHexV1("11".repeat(16));
      const creationTime = decodeAppCreationTimeV1(1);
      const document = await canonicalizeAppDocumentV1({
        tableId: decodeCatalogTableId(1),
        rowId,
        creationTime,
        fields: { name: "seeded" },
      });
      const clock = await persistence.getScopeClock(current.anchor.scopeId);
      if (clock === null) {
        throw new Error("Missing C08-A seeded scope clock.");
      }
      await persistence.drizzle.transaction(async (tx) => {
        Result.getOrThrow(
          await appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(
            tx,
            {
              kind: "live",
              scopeId: current.anchor.scopeId,
              definition,
              encodedKey: Result.getOrThrow(lowerAppDeveloperIndexKeyV1(
                definition,
                document,
                creationTime,
              )),
              rowId: decodeOrderedIndexRowIdHexV1(rowId),
              writeEpoch: clock.epoch,
              commitSeq: CommitSeqSchema.make(1n),
              prevCommitSeq: null,
            },
          ),
        );
      });
    }
    return Object.freeze({ developerIndexes });
  }

  async function locateDeveloperIndexDefinitionForO10(
    current: Awaited<ReturnType<typeof c04b2Scenario>>,
  ) {
    const developerIndexes = createAppDeveloperIndexDefinitionPortV1(
      persistence.drizzle,
    );
    const definitions = await runEffect(developerIndexes.locate({
      deploymentId: current.anchor.deploymentId,
      scopeId: current.anchor.scopeId,
      schemaVersionId: current.schemaVersionId,
      tableIds: Object.freeze([decodeCatalogTableId(1)]),
      maximumDefinitions: 256,
    }));
    const definition = definitions?.[0];
    if (definitions?.length !== 1 || definition === undefined) {
      throw new Error("Missing O10 developer-index definition.");
    }
    return definition;
  }

  async function runO10IndexedQuery(
    current: Awaited<ReturnType<typeof c04b2Scenario>>,
    table: PinnedPointTableV1,
    bounds: OrderedIndexBoundsV1 = Object.freeze({}),
  ): Promise<void> {
    await prepareDeveloperIndexForO06(current);
    const definition = await locateDeveloperIndexDefinitionForO10(current);
    const clock = await persistence.getScopeClock(current.anchor.scopeId);
    if (clock === null) throw new Error("Missing O10 indexed-query clock.");
    await persistence.drizzle.insert(fxSystemIndexBuildStates).values({
      scopeId: current.anchor.scopeId,
      indexDefinitionId: definition.indexDefinitionId,
      storageGeneration:
        FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: clock.storageGenerationFence,
      epoch: clock.epoch,
      startCommitSeq: CommitSeqSchema.make(0n),
      lifecycle: "enabled",
      cursorCodecVersion: INDEX_BUILD_CURSOR_CODEC_VERSION_V1,
      backfillCursorRowId: null,
      attemptFence: IndexBuildAttemptFenceSchema.make(1n),
    }).onConflictDoNothing();
    await persistence.drizzle.update(fxSystemIndexBuildStates).set({
      storageGeneration:
        FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
      storageGenerationFence: clock.storageGenerationFence,
      epoch: clock.epoch,
      startCommitSeq: CommitSeqSchema.make(0n),
      lifecycle: "enabled",
      cursorCodecVersion: INDEX_BUILD_CURSOR_CODEC_VERSION_V1,
      backfillCursorRowId: null,
      attemptFence: IndexBuildAttemptFenceSchema.make(1n),
    }).where(and(
      eq(fxSystemIndexBuildStates.scopeId, current.anchor.scopeId),
      eq(
        fxSystemIndexBuildStates.indexDefinitionId,
        definition.indexDefinitionId,
      ),
    ));
    const index = await runEffect(current.store.resolveDeveloperIndexEffect(
      table,
      "byDeveloperField0",
    ));
    await expect(runEffect(current.store.runIndexedQueryEffect(index, {
      kind: "indexRange",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      bounds,
      limit: 16,
    }))).resolves.toMatchObject({
      kind: "completed",
      outcome: { kind: "indexRangePage", isDone: true },
    });
  }

  async function commitCompetingIndexedUserForO10(
    current: Awaited<ReturnType<typeof c04b2Scenario>>,
    name: string,
    rowIdHex: string,
  ): Promise<Readonly<{ readonly encodedKey: string }>> {
    const definition = await locateDeveloperIndexDefinitionForO10(current);
    const tableId = decodeCatalogTableId(1);
    const rowId = decodeAppRowIdHexV1(rowIdHex);
    const creationTime = decodeAppCreationTimeV1(2);
    const document = await canonicalizeAppDocumentV1({
      tableId,
      rowId,
      creationTime,
      fields: { name },
    });
    const clock = await persistence.getScopeClock(current.anchor.scopeId);
    if (clock === null) throw new Error("Missing O10 conflict scope clock.");
    const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
    const epochUuid = projectScopeEpochUuidV1(clock.epoch).epochUuid;
    const scopeUuid = projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid;
    const encodedKey = Result.getOrThrow(lowerAppDeveloperIndexKeyV1(
      definition,
      document,
      creationTime,
    ));
    await persistence.drizzle.transaction(async (tx) => {
      await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "live",
        scopeId: current.anchor.scopeId,
        tableId,
        rowId,
        writeEpoch: clock.epoch,
        commitSeq,
        prevCommitSeq: null,
        schemaVersionId: current.schemaVersionId,
        creationTime,
        value: {
          codecVersion: document.codecVersion,
          valueJson: document.valueJson,
          canonicalBytes: document.canonicalBytes,
          sha256: document.sha256,
        },
      });
      Result.getOrThrow(
        await appendAppIndexEntryRevisionAndAdvanceCurrentInTransactionResult(
          tx,
          {
            kind: "live",
            scopeId: current.anchor.scopeId,
            definition,
            encodedKey,
            rowId: decodeOrderedIndexRowIdHexV1(rowId),
            writeEpoch: clock.epoch,
            commitSeq,
            prevCommitSeq: null,
          },
        ),
      );
      await tx.insert(fxSystemCommits).values({
        scopeUuid,
        epochUuid,
        commitSeq,
        changeCount: 1,
      });
      await tx.insert(fxSystemCommitAppRowChanges).values({
        scopeUuid,
        epochUuid,
        commitSeq,
        changeOrdinal: 0,
        tableId,
        rowId: appRowIdHexV1ToBytes(rowId),
      });
      await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq })
        .where(eq(fxSystemScopeClocks.scopeUuid, scopeUuid));
    });
    return Object.freeze({ encodedKey });
  }

  async function prepareUniqueConstraintForO06(
    current: Awaited<ReturnType<typeof c04b2Scenario>>,
    seedExistingRow = false,
    sparse = false,
    eligibilityAuthorityUnavailable = false,
  ): Promise<Required<Pick<
    PointCommitTransactionProofOptionsV1,
    "uniqueConstraints" | "uniqueConstraintEligibility"
  >>> {
    const tableId = decodeCatalogTableId(1);
    const prepared = await runEffect(
      prepareAppUniqueConstraintDefinitionBindingV1Effect(
        persistence.drizzle,
        {
          deploymentId: current.anchor.deploymentId,
          schemaVersionId: current.schemaVersionId,
          tableId,
          descriptor: SchemaManifestAppIndexDescriptorSchema.make(
            "unique_name",
          ),
          physicalSpec: decodeAppUniqueConstraintPhysicalSpecV1({
            kind: "appUniqueConstraint",
            specVersion: 1,
            orderedFields: ["name"],
            sparse,
            localePolicy: { kind: "none" },
            keyCodecIdentity: APP_UNIQUE_KEY_CODEC_IDENTITY_V1,
            keyCodecVersion: APP_UNIQUE_KEY_CODEC_VERSION_V1,
          }),
        },
      ),
    );
    await persistence.drizzle.transaction((tx) =>
      runEffect(
        ensureAppUniqueConstraintDefinitionBindingV1InTransaction(
          tx,
          prepared,
        ),
      )
    );
    const uniqueConstraints = createAppUniqueConstraintDefinitionPortV1(
      persistence.drizzle,
    );
    if (seedExistingRow) {
      if (current.seededDocumentId === null) {
        throw new Error("Missing C08-B2 seeded unique document.");
      }
      const definitions = await runEffect(uniqueConstraints.locate({
        deploymentId: current.anchor.deploymentId,
        scopeId: current.anchor.scopeId,
        schemaVersionId: current.schemaVersionId,
        tableIds: Object.freeze([tableId]),
        maximumDefinitions: 32,
      }));
      const definition = definitions?.[0];
      if (definitions?.length !== 1 || definition === undefined) {
        throw new Error("Missing C08-B2 unique definition.");
      }
      const rowId = decodeAppRowIdHexV1("11".repeat(16));
      const creationTime = decodeAppCreationTimeV1(1);
      const document = await canonicalizeAppDocumentV1({
        tableId,
        rowId,
        creationTime,
        fields: { name: "seeded" },
      });
      const clock = await persistence.getScopeClock(current.anchor.scopeId);
      if (clock === null) {
        throw new Error("Missing C08-B2 seeded scope clock.");
      }
      await persistence.drizzle.transaction((tx) =>
        runEffect(applyAppUniqueKeyMutationInTransactionEffect(tx, {
          scopeId: current.anchor.scopeId,
          constraintId: definition.uniqueConstraintDefinitionId,
          tableId,
          rowId,
          writeEpoch: clock.epoch,
          commitSeq: CommitSeqSchema.make(1n),
          rowPrevCommitSeq: null,
          previousClaimCommitSeq: null,
          previous: null,
          next: Result.getOrThrow(
            lowerAppUniqueConstraintProjectionV1Result(definition, document),
          ),
        }))
      );
    }
    const buildPorts = {
      controlDb: persistence.drizzle,
      authority: {
        scopeMetadata: persistence,
        provisioningReceipts: {
          getScopeAuthorityProvisioningReceipt: async () => {
            throw new Error("Shared placement must not read split receipts.");
          },
        },
        scopeClockTargets: {
          resolve: async (physicalLocator: ScopePhysicalLocator) =>
            createLocatedAppUniqueConstraintSetBuildTargetV1(
              persistence.drizzle,
              physicalLocator,
            ),
        },
      },
    } as const;
    const closure = await runEffect(
      prepareAppUniqueConstraintSetClosureV1Effect(
        persistence.drizzle,
        {
          deploymentId: current.anchor.deploymentId,
          schemaVersionId: current.schemaVersionId,
        },
      ),
    );
    await persistence.drizzle.transaction((tx) =>
      runEffect(closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure))
    );
    await runEffect(reconcileAppUniqueConstraintSetBuildV1Effect(
      buildPorts,
      {
        deploymentId: current.anchor.deploymentId,
        schemaVersionId: current.schemaVersionId,
      },
    ));
    let enabled = false;
    for (let step = 0; step < 16; step += 1) {
      const advanced = await runEffect(
        advanceAppUniqueConstraintSetBackfillV1Effect(
          buildPorts,
          {
            deploymentId: current.anchor.deploymentId,
            schemaVersionId: current.schemaVersionId,
            pageSize: 16,
          },
        ),
      );
      if (advanced.lifecycle === "enabled") {
        enabled = true;
        break;
      }
    }
    if (!enabled) throw new Error("C08-B1 eligibility build did not enable.");
    const eligibilityPorts = eligibilityAuthorityUnavailable
      ? Object.freeze({
          controlDb: buildPorts.controlDb,
          authority: Object.freeze({
            scopeMetadata: Object.freeze({
              getScopeMetadataByDeploymentId: async () => null,
            }),
            provisioningReceipts: buildPorts.authority.provisioningReceipts,
            scopeClockTargets: buildPorts.authority.scopeClockTargets,
          }),
        })
      : buildPorts;
    return Object.freeze({
      uniqueConstraints,
      uniqueConstraintEligibility:
        createAppUniqueConstraintSetEligibilityPortV1(
          eligibilityPorts,
          uniqueConstraints,
        ),
    });
  }

  async function insertValidatingUniqueSetBuild(
    current: Awaited<ReturnType<typeof c04b2Scenario>>,
    schemaVersionId: string = current.schemaVersionId,
  ) {
    const clock = await persistence.getScopeClock(current.anchor.scopeId);
    if (clock === null) throw new Error("Missing C08-B1C scope clock.");
    await persistence.query(
      `insert into fx_system_unique_constraint_set_build
        (scope_id, schema_version_id, set_codec_version, definition_count,
         definition_set_sha256, storage_generation,
         storage_generation_fence, epoch, start_commit_seq, lifecycle,
         cursor_codec_version, cursor_definition_id, cursor_row_id,
         attempt_fence)
       values ($1, $2, 1, 1, decode(repeat('ab', 32), 'hex'),
               'flarexdb_v1', $3, $4, $5, 'validating', 1, 1,
               decode(repeat('ff', 16), 'hex'), 1)
       on conflict (scope_id, schema_version_id) do update
         set lifecycle = 'validating', cursor_definition_id = 1,
             cursor_row_id = decode(repeat('ff', 16), 'hex')`,
      [
        current.anchor.scopeId,
        schemaVersionId,
        clock.storageGenerationFence.toString(),
        clock.epoch,
        clock.lastCommitSeq.toString(),
      ],
    );
  }

  async function uniqueSetBuildCursor(
    current: Awaited<ReturnType<typeof c04b2Scenario>>,
  ) {
    const result = await persistence.query<{
      lifecycle: string;
      cursorDefinitionId: number | null;
      cursorRowHex: string | null;
    }>(
      `select lifecycle,
              cursor_definition_id "cursorDefinitionId",
              encode(cursor_row_id, 'hex') "cursorRowHex"
         from fx_system_unique_constraint_set_build
        where scope_id = $1 and schema_version_id = $2`,
      [current.anchor.scopeId, current.schemaVersionId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Missing C08-B1C build row.");
    return row;
  }

  async function uniqueSetBuildCursors(
    current: Awaited<ReturnType<typeof c04b2Scenario>>,
  ) {
    const result = await persistence.query<{
      schemaVersionId: string;
      lifecycle: string;
      cursorDefinitionId: number | null;
      cursorRowHex: string | null;
    }>(
      `select schema_version_id "schemaVersionId", lifecycle,
              cursor_definition_id "cursorDefinitionId",
              encode(cursor_row_id, 'hex') "cursorRowHex"
         from fx_system_unique_constraint_set_build
        where scope_id = $1
        order by schema_version_id asc`,
      [current.anchor.scopeId],
    );
    return result.rows;
  }

  async function seedSecondUniqueUser(
    current: Awaited<ReturnType<typeof c04b2Scenario>>,
    uniqueConstraints: NonNullable<
      PointCommitTransactionProofOptionsV1["uniqueConstraints"]
    >,
  ) {
    const tableId = decodeCatalogTableId(1);
    const rowId = decodeAppRowIdHexV1("22".repeat(16));
    const creationTime = decodeAppCreationTimeV1(2);
    const documentId = appDocumentIdV1FromRowIdentity({ tableId, rowId });
    const definitions = await runEffect(uniqueConstraints.locate({
      deploymentId: current.anchor.deploymentId,
      scopeId: current.anchor.scopeId,
      schemaVersionId: current.schemaVersionId,
      tableIds: Object.freeze([tableId]),
      maximumDefinitions: 32,
    }));
    const definition = definitions?.[0];
    if (definitions?.length !== 1 || definition === undefined) {
      throw new Error("Missing the second C08-B2 unique definition.");
    }
    const document = await canonicalizeAppDocumentV1({
      tableId,
      rowId,
      creationTime,
      fields: { name: "other" },
    });
    const clock = await persistence.getScopeClock(current.anchor.scopeId);
    if (clock === null || clock.lastCommitSeq !== 1n) {
      throw new Error("Missing the second C08-B2 seed authority.");
    }
    await persistence.drizzle.transaction(async (tx) => {
      await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "live",
        scopeId: current.anchor.scopeId,
        tableId,
        rowId,
        writeEpoch: clock.epoch,
        commitSeq: CommitSeqSchema.make(1n),
        prevCommitSeq: null,
        schemaVersionId: current.schemaVersionId,
        creationTime,
        value: {
          codecVersion: document.codecVersion,
          valueJson: document.valueJson,
          canonicalBytes: document.canonicalBytes,
          sha256: document.sha256,
        },
      });
      await runEffect(applyAppUniqueKeyMutationInTransactionEffect(tx, {
        scopeId: current.anchor.scopeId,
        constraintId: definition.uniqueConstraintDefinitionId,
        tableId,
        rowId,
        writeEpoch: clock.epoch,
        commitSeq: CommitSeqSchema.make(1n),
        rowPrevCommitSeq: null,
        previousClaimCommitSeq: null,
        previous: null,
        next: Result.getOrThrow(
          lowerAppUniqueConstraintProjectionV1Result(definition, document),
        ),
      }));
    });
    return documentId;
  }

  async function prepareO07BScenario(
    label: string,
    operation?: (
      current: Awaited<ReturnType<typeof c04b2Scenario>>,
      table: PinnedPointTableV1,
    ) => Promise<void>,
    options:
      | PointCommitTransactionProofOptionsV1
      | ((current: Awaited<ReturnType<typeof c04b2Scenario>>) =>
        Promise<PointCommitTransactionProofOptionsV1>) = {},
    seedRow = false,
    developerIndex: boolean | number = false,
  ) {
    const running = await prepareO07BRunningScenario(
      label,
      operation,
      options,
      undefined,
      seedRow,
      developerIndex,
    );
    const plan = await runEffect(
      running.authentication.enterPointCommitFinishing(running.runningPlan),
    );
    return Object.freeze({
      ...running,
      plan,
    });
  }

  async function prepareO08B1Scenario(
    label: string,
    operation: (
      current: Awaited<ReturnType<typeof c04b2Scenario>>,
      table: PinnedPointTableV1,
    ) => Promise<void>,
    options: (
      current: Awaited<ReturnType<typeof c04b2Scenario>>,
    ) => Promise<PointCommitTransactionProofOptionsV1>,
  ) {
    const current = await c04b2Scenario(
      label,
      {},
      false,
      undefined,
      true,
    );
    const table = await runEffect(
      current.store.resolvePointTableEffect(current.attempt, "users"),
    );
    await operation(current, table);
    const proofOptions = await options(current);
    const envelope = await seal(current);
    const loadedAttempt = await runEffect(current.loading.load({
      deploymentId: current.anchor.deploymentId,
      scopeId: current.anchor.scopeId,
      sessionId: current.anchor.sessionId,
      attemptFence: current.anchor.attemptFence.toString(),
    }));
    const authentication = createO08B1Authentication(current, proofOptions);
    const authority = await runEffect(authentication.deriveAuthority(
      loadedAttempt,
      current.executionScope,
    ));
    const stored = await runEffect(authentication.authenticate(
      authority,
      encodeEnvelope(envelope),
    ));
    const commitAuthority = await runEffect(
      authentication.authenticateCommitAuthority(stored),
    );
    const verified = await runEffect(
      authentication.verifyCommitInput(commitAuthority),
    );
    const runningPlan = await runEffect(
      authentication.planPointCommit(verified),
    );
    const plan = await runEffect(
      authentication.enterPointCommitFinishing(runningPlan),
    );
    return Object.freeze({
      current,
      authentication,
      proofOptions,
      plan,
      scopeUuid: projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid,
    });
  }

  async function prepareO07BRunningScenario(
    label: string,
    operation?: (
      current: Awaited<ReturnType<typeof c04b2Scenario>>,
      table: PinnedPointTableV1,
    ) => Promise<void>,
    options:
      | PointCommitTransactionProofOptionsV1
      | ((current: Awaited<ReturnType<typeof c04b2Scenario>>) =>
        Promise<PointCommitTransactionProofOptionsV1>) = {},
    publisherPorts: PointMutationSessionAuthorityResolutionPortsV1 =
      resolutionPorts(persistence),
    seedRow = false,
    developerIndex: boolean | number = false,
  ) {
    const current = await c04b2Scenario(
      label,
      {},
      seedRow,
      undefined,
      developerIndex,
    );
    const table = await runEffect(
      current.store.resolvePointTableEffect(current.attempt, "users"),
    );
    await operation?.(current, table);
    const proofOptions = typeof options === "function"
      ? await options(current)
      : options;
    const envelope = await seal(current);
    const loadedAttempt = await runEffect(current.loading.load({
      deploymentId: current.anchor.deploymentId,
      scopeId: current.anchor.scopeId,
      sessionId: current.anchor.sessionId,
      attemptFence: current.anchor.attemptFence.toString(),
    }));
    const authentication = createO07BAuthentication(
      current,
      proofOptions,
      publisherPorts,
    );
    const authority = await runEffect(
      authentication.deriveAuthority(loadedAttempt, current.executionScope),
    );
    const stored = await runEffect(authentication.authenticate(
      authority,
      encodeEnvelope(envelope),
    ));
    const commitAuthority = await runEffect(
      authentication.authenticateCommitAuthority(stored),
    );
    const verified = await runEffect(
      authentication.verifyCommitInput(commitAuthority),
    );
    const runningPlan = await runEffect(
      authentication.planPointCommit(verified),
    );
    return Object.freeze({
      current,
      authentication,
      proofOptions,
      runningPlan,
      scopeUuid: projectScopeIdUuidV1(current.anchor.scopeId).scopeUuid,
    });
  }

  function createO07BAuthentication(
    current: Awaited<ReturnType<typeof c04b2Scenario>>,
    options: PointCommitTransactionProofOptionsV1 = {},
    publisherPorts: PointMutationSessionAuthorityResolutionPortsV1 =
      resolutionPorts(persistence),
  ) {
    const ports = resolutionPorts(persistence);
    return createStoredPointCommitExecutorV1(
      current.loader,
      {
        evidenceLoader: createStoredCommitAuthorityEvidenceLoaderV1(
          ports,
        ),
        transactionGrantVerifier: current.verifier,
        functionMetadata: {
          load: () =>
            Effect.succeed(structuredClone(current.functionSnapshot)),
        },
        pointCommit: createPointCommitPublisherPortV1(
          publisherPorts,
          options,
        ),
        pointCommitFinishing: createPointCommitFinishingTransitionPortV1(
          ports,
        ),
      },
      current.executionClaims,
    );
  }

  function createO08B1Authentication(
    current: Awaited<ReturnType<typeof c04b2Scenario>>,
    options: PointCommitTransactionProofOptionsV1 = {},
    replacementOptions: Omit<
      PointMutationAttemptReplacementOptionsV1,
      "leaseDurationMilliseconds"
    > = {},
    runner: PointMutationOccRuntimeNeutralRunnerV1 = Object.freeze({
      run: () =>
        Effect.fail(
          new PointMutationOccUserCodeV1Error({
            cause: new Error(
              "The O08-B2a runner was not configured by this test.",
            ),
          }),
        ),
    }),
    onAbortStarted?: () => void,
    contextFactory?: PointMutationOccExecutionContextFactoryV1,
    livenessOverride?: PointMutationExecutionClaimLivenessV1,
    heartbeatIntervalMilliseconds = 20_000,
  ) {
    const ports = resolutionPorts(persistence);
    let executionSequence = 0;
    const terminalization = createPointMutationSessionAttemptTerminalizationV1(
      createPointMutationSessionAttemptTerminalizationPersistenceV1(ports),
      current.executionClaims.admission,
    );
    return createStoredPointMutationOccRerunExecutionV1(current.loader, {
      evidenceLoader: createStoredCommitAuthorityEvidenceLoaderV1(ports),
      transactionGrantVerifier: current.verifier,
      functionMetadata: {
        load: () => Effect.succeed(structuredClone(current.functionSnapshot)),
      },
      pointCommit: createPointCommitPublisherPortV1(ports, options),
      pointCommitFinishing: createPointCommitFinishingTransitionPortV1(ports),
      pointMutationAttemptReplacement:
        createPointMutationAttemptReplacementPortV1(ports, {
          leaseDurationMilliseconds: 60_000,
          ...replacementOptions,
        }),
      pointMutationOccRerun: {
        attemptLoading: current.loading,
        executionEvidence: createStoredOccExecutionEvidenceLoaderV1(ports),
        journal: createPointMutationJournalV1(
          current.store,
          current.executionClaims.admission,
          SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
        ),
        terminalization:
          onAbortStarted === undefined
            ? terminalization
            : Object.freeze({
                ...terminalization,
                abort: Effect.fn("TestO08B2a.observeAbort")((
                  attempt,
                  executionClaim,
                ) =>
                  Effect.sync(onAbortStarted).pipe(
                    Effect.flatMap(() =>
                      terminalization.abort(attempt, executionClaim)
                    ),
                  ),
                ),
              }),
        contextFactory: contextFactory ?? {
          make: () =>
            Effect.sync(() => {
              executionSequence += 1;
              return Object.freeze({
                executionId: `o08-b2a-${executionSequence}`,
                logScopeId: `o08-b2a-log-${executionSequence}`,
                randomSeed: new Uint8Array(32).fill(executionSequence),
              });
            }),
        },
        runner,
        liveness: livenessOverride ??
          createPointMutationExecutionClaimLivenessV1(ports, {
          claimDurationMilliseconds: 60_000,
          leaseRenewalDurationMilliseconds: 120_000,
          grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
          }),
        heartbeatIntervalMilliseconds,
      },
    }, current.executionClaims);
  }

  function createInitialPointMutationExecution(
    current: Awaited<ReturnType<typeof c04b2ActivatedInitialScenario>>,
    runner: PointMutationOccRuntimeNeutralRunnerV1,
  ) {
    const ports = resolutionPorts(persistence);
    let executionSequence = 0;
    const terminalization = createPointMutationSessionAttemptTerminalizationV1(
      createPointMutationSessionAttemptTerminalizationPersistenceV1(ports),
      current.executionClaims.admission,
    );
    return createPointMutationInitialExecutionV1(current.loader, {
      evidenceLoader: createStoredCommitAuthorityEvidenceLoaderV1(ports),
      transactionGrantVerifier: current.verifier,
      functionMetadata: {
        load: () => Effect.succeed(structuredClone(current.functionSnapshot)),
      },
      pointCommit: createPointCommitPublisherPortV1(ports),
      pointCommitFinishing: createPointCommitFinishingTransitionPortV1(ports),
      pointMutationAttemptReplacement:
        createPointMutationAttemptReplacementPortV1(ports, {
          leaseDurationMilliseconds: 60_000,
        }),
      pointMutationOccRerun: {
        attemptLoading: current.loading,
        executionEvidence: createStoredOccExecutionEvidenceLoaderV1(ports),
        journal: createPointMutationJournalV1(
          current.store,
          current.executionClaims.admission,
          SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
        ),
        terminalization,
        contextFactory: {
          make: () =>
            Effect.sync(() => {
              executionSequence += 1;
              return Object.freeze({
                executionId: `p02c4b-${executionSequence}`,
                logScopeId: `p02c4b-log-${executionSequence}`,
                randomSeed: new Uint8Array(32).fill(executionSequence),
              });
            }),
        },
        runner,
        liveness: createPointMutationExecutionClaimLivenessV1(ports, {
          claimDurationMilliseconds: 60_000,
          leaseRenewalDurationMilliseconds: 120_000,
          grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
        }),
        heartbeatIntervalMilliseconds: 20_000,
      },
    }, current.executionClaims);
  }

  function createB2b2aRedispatchAuthentication(
    current: Awaited<ReturnType<typeof c04b2Scenario>>,
    executionClaims: PointMutationExecutionClaimVaultV1,
    runner: PointMutationOccRuntimeNeutralRunnerV1,
    options: Readonly<{
      readonly randomOwner?: () => string;
      readonly contextFactory?: PointMutationOccExecutionContextFactoryV1;
      readonly afterExecutionEvidenceRepeatableRead?: () => void;
      readonly pointCommit?: PointCommitTransactionProofOptionsV1;
      readonly acquisition?: PointMutationExecutionClaimDispatchAcquisitionV1;
      readonly attemptLoading?: PointMutationSessionAttemptLoadingV1;
    }> = {},
  ) {
    const ports = resolutionPorts(persistence);
    let executionSequence = 0;
    const terminalizationPersistence =
      createPointMutationSessionAttemptTerminalizationPersistenceV1(ports);
    const terminalization = createPointMutationSessionAttemptTerminalizationV1(
      terminalizationPersistence,
      executionClaims.admission,
    );
    return createStoredPointMutationCrashRedispatchV1(current.loader, {
      evidenceLoader: createStoredCommitAuthorityEvidenceLoaderV1(ports),
      transactionGrantVerifier: current.verifier,
      functionMetadata: {
        load: () => Effect.succeed(structuredClone(current.functionSnapshot)),
      },
      pointCommit: createPointCommitPublisherPortV1(
        ports,
        options.pointCommit,
      ),
      pointCommitFinishing: createPointCommitFinishingTransitionPortV1(ports),
      pointMutationAttemptReplacement:
        createPointMutationAttemptReplacementPortV1(ports, {
          leaseDurationMilliseconds: 60_000,
        }),
      pointMutationOccRerun: {
        attemptLoading: options.attemptLoading ?? current.loading,
        executionEvidence: createStoredOccExecutionEvidenceLoaderV1(ports, {
          ...(options.afterExecutionEvidenceRepeatableRead === undefined
            ? {}
            : {
                afterRepeatableRead:
                  options.afterExecutionEvidenceRepeatableRead,
              }),
        }),
        journal: createPointMutationJournalV1(
          current.store,
          executionClaims.admission,
          SETUP_SEEDED_SYSCALL_VALIDATOR_PROOF_V1,
        ),
        terminalization,
        contextFactory: options.contextFactory ?? {
          make: () =>
            Effect.sync(() => {
              executionSequence += 1;
              return Object.freeze({
                executionId: `o08-b2b2a-${executionSequence}`,
                logScopeId: `o08-b2b2a-log-${executionSequence}`,
                randomSeed: new Uint8Array(32).fill(executionSequence),
              });
            }),
        },
        runner,
        liveness: createPointMutationExecutionClaimLivenessV1(ports, {
          claimDurationMilliseconds: 60_000,
          leaseRenewalDurationMilliseconds: 120_000,
          grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
        }),
        heartbeatIntervalMilliseconds: 20_000,
      },
      pointMutationRedispatch: {
        acquisition: options.acquisition ??
          createPointMutationExecutionClaimDispatchAcquisitionV1(
            createPointMutationExecutionClaimAcquisitionV1(ports, {
              durationMilliseconds: 60_000,
              ...(options.randomOwner === undefined
                ? {}
                : { randomOwner: options.randomOwner }),
            }),
            executionClaims.issuer,
          ),
        disposition: createPointMutationSessionAttemptDispositionV1(
          terminalizationPersistence,
          executionClaims.abortOnlyAdmission,
        ),
      },
    }, executionClaims);
  }

  async function prepareO08B1Conflict(
    label: string,
    replacementOptions: Omit<
      PointMutationAttemptReplacementOptionsV1,
      "leaseDurationMilliseconds"
    > = {},
    runner?: PointMutationOccRuntimeNeutralRunnerV1,
    onAbortStarted?: () => void,
    returnsValidator?: PointMutationTargetFunctionMetadataV1["returnsValidator"],
    contextFactory?: PointMutationOccExecutionContextFactoryV1,
    observeLivenessRenewal?: () => void,
    heartbeatIntervalMilliseconds?: number,
  ) {
    const current = await c04b2Scenario(label, {}, false, returnsValidator);
    const table = await runEffect(
      current.store.resolvePointTableEffect(current.attempt, "users"),
    );
    await runPointOperation(current.store, table, {
      kind: "insert",
      syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
      fields: { name: label },
    });
    const envelope = await seal(current);
    const loadedAttempt = await runEffect(current.loading.load({
      deploymentId: current.anchor.deploymentId,
      scopeId: current.anchor.scopeId,
      sessionId: current.anchor.sessionId,
      attemptFence: current.anchor.attemptFence.toString(),
    }));
    const actualLiveness = createPointMutationExecutionClaimLivenessV1(
      resolutionPorts(persistence),
      {
        claimDurationMilliseconds: 60_000,
        leaseRenewalDurationMilliseconds: 120_000,
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
      },
    );
    const liveness = observeLivenessRenewal === undefined
      ? actualLiveness
      : Object.freeze({
          configuration: actualLiveness.configuration,
          renewEffect: (
            input: Parameters<
              PointMutationExecutionClaimLivenessV1["renewEffect"]
            >[0],
          ) => Effect.sync(observeLivenessRenewal).pipe(
            Effect.andThen(actualLiveness.renewEffect(input)),
          ),
        });
    const authentication = createO08B1Authentication(
      current,
      {},
      replacementOptions,
      runner,
      onAbortStarted,
      contextFactory,
      liveness,
      heartbeatIntervalMilliseconds,
    );
    const authority = await runEffect(
      authentication.deriveAuthority(loadedAttempt, current.executionScope),
    );
    const authenticated = await runEffect(authentication.authenticate(
      authority,
      encodeEnvelope(envelope),
    ));
    const commitAuthority = await runEffect(
      authentication.authenticateCommitAuthority(authenticated),
    );
    const verified = await runEffect(
      authentication.verifyCommitInput(commitAuthority),
    );
    const running = await runEffect(authentication.planPointCommit(verified));
    const finishing = await runEffect(
      authentication.enterPointCommitFinishing(running),
    );
    const finishingStored = await runEffect(
      current.loader.loadFinishingEffect({
        deploymentId: current.anchor.deploymentId,
        scopeId: current.anchor.scopeId,
        sessionId: current.anchor.sessionId,
        attemptFence: current.anchor.attemptFence,
      }),
    );
    if (finishingStored.kind !== "loaded") {
      throw new Error("Expected finishing O08-B1 evidence.");
    }
    await commitCompetingPointRow(
      await pointCommitCommandFromStoredAttemptV1(
        current.authority,
        finishingStored.evidence,
      ),
    );
    const conflict = await runFailure(
      authentication.publishPointCommit(finishing),
    );
    if (!(conflict instanceof PointCommitConflictV1Error)) {
      throw new Error("Expected a genuine O08-B1 conflict.");
    }
    return Object.freeze({
      current,
      authentication,
      conflict,
      scopeUuid: finishingStored.evidence.scopeUuid,
    });
  }

  async function injectB2aOutcome(
    prepared: Awaited<ReturnType<typeof prepareO08B1Conflict>>,
    kind: "available" | "expired",
  ): Promise<void> {
    if (kind === "expired") {
      await persistence.query(
        `
          insert into fx_system_idempotency
            (scope_uuid, request_key, identity_access_policy_sha256,
             function_path, request_sha256, epoch_uuid, commit_seq,
             result_state, result_expired_at)
          select session.scope_uuid, session.request_key,
            session.identity_access_policy_sha256, session.function_path,
            session.request_sha256, clock.epoch_uuid, 1,
            'expired', clock_timestamp()
          from fx_system_tx_session as session
          join fx_system_scope_clock as clock
            on clock.scope_uuid = session.scope_uuid
          where session.scope_uuid = $1 and session.session_id = $2
        `,
        [prepared.scopeUuid, prepared.current.anchor.sessionId],
      );
      return;
    }

    const successfulResult = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ replayed: true }),
    );
    await persistence.query(
      `
        insert into fx_system_idempotency
          (scope_uuid, request_key, identity_access_policy_sha256,
           function_path, request_sha256, epoch_uuid, commit_seq,
           result_state, result_value_codec_version, result_semantic_bytes,
           result_bytes, result_sha256)
        select session.scope_uuid, session.request_key,
          session.identity_access_policy_sha256, session.function_path,
          session.request_sha256, clock.epoch_uuid, 1,
          'available', 1, $3, $4, decode($5, 'hex')
        from fx_system_tx_session as session
        join fx_system_scope_clock as clock
          on clock.scope_uuid = session.scope_uuid
        where session.scope_uuid = $1 and session.session_id = $2
      `,
      [
        prepared.scopeUuid,
        prepared.current.anchor.sessionId,
        successfulResult.semanticSizeBytes,
        successfulResult.canonicalBytes,
        successfulResult.evidence.sha256Hex,
      ],
    );
  }

  async function commitCompetingPointRow(
    command: PointCommitTransactionCommandV1,
  ): Promise<void> {
    const intent = command.rowIntents[0];
    if (intent?.kind !== "live") {
      throw new Error("O06 conflict fixture requires a live row intent.");
    }
    await commitCompetingLiveIntent(
      command.authorityPins.scopeId,
      command.authorityPins.schemaVersionId,
      command.sealIdentity.scopeUuid,
      intent,
    );
  }

  async function commitCompetingLiveIntent(
    scopeId: PointCommitTransactionCommandV1["authorityPins"]["scopeId"],
    schemaVersionId: PointCommitTransactionCommandV1["authorityPins"]["schemaVersionId"],
    scopeUuid: PointCommitTransactionCommandV1["sealIdentity"]["scopeUuid"],
    intent: Pick<
      Extract<
        PointCommitTransactionCommandV1["rowIntents"][number],
        { readonly kind: "live" }
      >,
      "tableId" | "rowId" | "creationTime" | "value"
    >,
  ): Promise<void> {
    const clock = await persistence.getScopeClock(scopeId);
    if (clock === null) throw new Error("Missing O06 conflict scope clock.");
    const commitSeq = CommitSeqSchema.make(clock.lastCommitSeq + 1n);
    const epochUuid = projectScopeEpochUuidV1(clock.epoch).epochUuid;
    const document = await canonicalizeFlarexValueV1(
      intent.value,
      "appDocument",
    );
    await persistence.drizzle.transaction(async (tx) => {
      await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
        kind: "live",
        scopeId,
        tableId: intent.tableId,
        rowId: intent.rowId,
        writeEpoch: clock.epoch,
        commitSeq,
        prevCommitSeq: null,
        schemaVersionId,
        creationTime: intent.creationTime,
        value: {
          codecVersion: document.codecVersion,
          valueJson: document.valueJson,
          canonicalBytes: document.canonicalBytes,
          sha256: document.sha256,
        },
      });
      await tx.insert(fxSystemCommits).values({
        scopeUuid,
        epochUuid,
        commitSeq,
        changeCount: 1,
      });
      await tx.insert(fxSystemCommitAppRowChanges).values({
        scopeUuid,
        epochUuid,
        commitSeq,
        changeOrdinal: 0,
        tableId: intent.tableId,
        rowId: appRowIdHexV1ToBytes(intent.rowId),
      });
      await tx
        .update(fxSystemScopeClocks)
        .set({ lastCommitSeq: commitSeq })
        .where(eq(fxSystemScopeClocks.scopeUuid, scopeUuid));
    });
  }

  async function o08B1AttemptState(
    scopeUuid: string,
    sessionId: PointMutationSessionAnchorV1["sessionId"],
  ) {
    const state = await persistence.query<{
      lifecycle: string;
      attempt_fence: string;
      lease_count: string;
      root_state: string;
      last_syscall_sequence: string;
      receipt_count: string;
      point_count: string;
      event_count: string;
    }>(
      `
        select session.lifecycle,
          session.attempt_fence::text,
          (select count(*)::text from fx_system_snapshot_lease lease
            where lease.scope_uuid = session.scope_uuid
              and lease.session_id = session.session_id
              and lease.attempt_fence = session.attempt_fence) as lease_count,
          journal.state as root_state,
          journal.last_syscall_sequence::text,
          (select count(*)::text
            from fx_system_tx_journal_latest_receipt receipt
            where receipt.scope_uuid = session.scope_uuid
              and receipt.session_id = session.session_id
              and receipt.attempt_fence = session.attempt_fence)
            as receipt_count,
          (select count(*)::text from fx_system_tx_journal_point point
            where point.scope_uuid = session.scope_uuid
              and point.session_id = session.session_id
              and point.attempt_fence = session.attempt_fence) as point_count,
          (select count(*)::text from fx_system_tx_journal_write_event event
            where event.scope_uuid = session.scope_uuid
              and event.session_id = session.session_id
              and event.attempt_fence = session.attempt_fence) as event_count
        from fx_system_tx_session session
        join fx_system_tx_journal journal
          on journal.scope_uuid = session.scope_uuid
          and journal.session_id = session.session_id
          and journal.attempt_fence = session.attempt_fence
        where session.scope_uuid = $1 and session.session_id = $2
      `,
      [scopeUuid, sessionId],
    );
    return state.rows[0];
  }

  async function expireExactExecutionClaim(sessionId: string): Promise<void> {
    await persistence.query(
      `update fx_system_tx_execution_claim
       set claimed_at = clock_timestamp() - interval '2 minutes',
         claim_expires_at = clock_timestamp() - interval '1 minute'
       where session_id = $1`,
      [sessionId],
    );
  }

  async function executionClaimState(sessionId: string) {
    const result = await persistence.query<{
      claim_owner: string;
      claim_fence: string;
      claimed_at: Date;
      claim_expires_at: Date;
    }>(
      `select claim_owner, claim_fence::text, claimed_at, claim_expires_at
       from fx_system_tx_execution_claim
       where session_id = $1`,
      [sessionId],
    );
    return result.rows[0] ?? null;
  }

  async function o06DurableState(scopeUuid: string) {
    const result = await persistence.query<{
      revisions: string;
      current_rows: string;
      commit_headers: string;
      commit_changes: string;
      outcomes: string;
      wakes: string;
      last_commit_seq: string;
      last_outbox_seq: string;
    }>(
      `
        select
          (select count(*)::text from fx_app_row_rev
            where scope_uuid = $1) as revisions,
          (select count(*)::text from fx_app_row_current
            where scope_uuid = $1) as current_rows,
          (select count(*)::text from fx_system_commit
            where scope_uuid = $1) as commit_headers,
          (select count(*)::text from fx_system_commit_app_row_change
            where scope_uuid = $1) as commit_changes,
          (select count(*)::text from fx_system_idempotency
            where scope_uuid = $1) as outcomes,
          (select count(*)::text from fx_system_outbox
            where scope_uuid = $1) as wakes,
          last_commit_seq::text,
          last_outbox_seq::text
        from fx_system_scope_clock
        where scope_uuid = $1
      `,
      [scopeUuid],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Missing O06 durable state.");
    return row;
  }

  async function intrinsicIndexState(scopeUuid: string) {
    const revisions = await persistence.query<{
      table_id: string;
      row_id_hex: string;
      commit_seq: string;
      is_tombstone: boolean;
    }>(
      `select table_id::text, encode(row_id, 'hex') as row_id_hex,
         commit_seq::text, is_tombstone
       from fx_app_index_entry_rev
       where scope_uuid = $1
       order by table_id, row_id, commit_seq`,
      [scopeUuid],
    );
    const current = await persistence.query<{
      table_id: string;
      row_id_hex: string;
      commit_seq: string;
    }>(
      `select revision.table_id::text,
         encode(current_entry.row_id, 'hex') as row_id_hex,
         current_entry.commit_seq::text
       from fx_app_index_entry_current as current_entry
       join fx_app_index_entry_rev as revision
         on revision.scope_uuid = current_entry.scope_uuid
        and revision.index_definition_id = current_entry.index_definition_id
        and revision.encoded_key = current_entry.encoded_key
        and revision.row_id = current_entry.row_id
        and revision.commit_seq = current_entry.commit_seq
       where current_entry.scope_uuid = $1
       order by revision.table_id, current_entry.row_id`,
      [scopeUuid],
    );
    return {
      revisions: revisions.rows.map((row) => ({
        tableId: row.table_id,
        rowIdHex: row.row_id_hex,
        commitSeq: row.commit_seq,
        isTombstone: row.is_tombstone,
      })),
      current: current.rows.map((row) => ({
        tableId: row.table_id,
        rowIdHex: row.row_id_hex,
        commitSeq: row.commit_seq,
      })),
    } as const;
  }

  async function developerIndexState(scopeUuid: string) {
    const revisions = await persistence.query<{
      index_definition_id: string;
      encoded_key_hex: string;
      row_id_hex: string;
      commit_seq: string;
      is_tombstone: boolean;
    }>(
      `select index_definition_id::text,
         encode(encoded_key, 'hex') as encoded_key_hex,
         encode(row_id, 'hex') as row_id_hex,
         commit_seq::text, is_tombstone
       from fx_app_index_entry_rev
       where scope_uuid = $1
       order by index_definition_id, encoded_key, row_id, commit_seq`,
      [scopeUuid],
    );
    const current = await persistence.query<{
      index_definition_id: string;
      encoded_key_hex: string;
      row_id_hex: string;
      commit_seq: string;
    }>(
      `select index_definition_id::text,
         encode(encoded_key, 'hex') as encoded_key_hex,
         encode(row_id, 'hex') as row_id_hex,
         commit_seq::text
       from fx_app_index_entry_current
       where scope_uuid = $1
       order by index_definition_id, encoded_key, row_id`,
      [scopeUuid],
    );
    return Object.freeze({
      revisions: Object.freeze(revisions.rows.map((row) => Object.freeze({
        indexDefinitionId: row.index_definition_id,
        encodedKeyHex: row.encoded_key_hex,
        rowIdHex: row.row_id_hex,
        commitSeq: row.commit_seq,
        isTombstone: row.is_tombstone,
      }))),
      current: Object.freeze(current.rows.map((row) => Object.freeze({
        indexDefinitionId: row.index_definition_id,
        encodedKeyHex: row.encoded_key_hex,
        rowIdHex: row.row_id_hex,
        commitSeq: row.commit_seq,
      }))),
    });
  }

  async function uniqueKeyState(scopeUuid: string) {
    const rows = await persistence.query<{
      constraint_id: string;
      encoded_key_hex: string;
      row_id_hex: string;
      commit_seq: string;
    }>(
      `select constraint_id::text,
         encode(encoded_key, 'hex') as encoded_key_hex,
         encode(row_id, 'hex') as row_id_hex,
         commit_seq::text
       from fx_app_unique_key
       where scope_uuid = $1
       order by constraint_id, encoded_key, row_id`,
      [scopeUuid],
    );
    return Object.freeze(rows.rows.map((row) => Object.freeze({
      constraintId: row.constraint_id,
      encodedKeyHex: row.encoded_key_hex,
      rowIdHex: row.row_id_hex,
      commitSeq: row.commit_seq,
    })));
  }

  function pointRowIdHex(documentId: string): string {
    return documentId.slice(documentId.indexOf(":") + 1).replaceAll("-", "");
  }

  function compareIntrinsicIndexRows(
    left: Readonly<{
      readonly tableId: string;
      readonly rowIdHex: string;
      readonly commitSeq: string;
    }>,
    right: Readonly<{
      readonly tableId: string;
      readonly rowIdHex: string;
      readonly commitSeq: string;
    }>,
  ): number {
    const identityOrder = left.tableId.localeCompare(right.tableId) ||
      left.rowIdHex.localeCompare(right.rowIdHex);
    if (identityOrder !== 0) return identityOrder;
    const leftCommitSeq = BigInt(left.commitSeq);
    const rightCommitSeq = BigInt(right.commitSeq);
    return leftCommitSeq < rightCommitSeq
      ? -1
      : leftCommitSeq > rightCommitSeq
        ? 1
        : 0;
  }

  async function o07bTerminalState(
    scopeUuid: string,
    sessionId: string,
  ) {
    const result = await persistence.query<{
      lifecycle: string;
      leases: string;
      journals: string;
      receipts: string;
      points: string;
      write_events: string;
    }>(
      `
        select session.lifecycle,
          (select count(*)::text from fx_system_snapshot_lease
            where scope_uuid = $1 and session_id = $2) as leases,
          (select count(*)::text from fx_system_tx_journal
            where scope_uuid = $1 and session_id = $2) as journals,
          (select count(*)::text from fx_system_tx_journal_latest_receipt
            where scope_uuid = $1 and session_id = $2) as receipts,
          (select count(*)::text from fx_system_tx_journal_point
            where scope_uuid = $1 and session_id = $2) as points,
          (select count(*)::text from fx_system_tx_journal_write_event
            where scope_uuid = $1 and session_id = $2) as write_events
        from fx_system_tx_session as session
        where session.scope_uuid = $1 and session.session_id = $2
      `,
      [scopeUuid, sessionId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Missing O07-B session state.");
    return row;
  }

  async function o08DispositionState(
    scopeUuid: string,
    sessionId: string,
  ) {
    const result = await persistence.query<{
      lifecycle: string;
      leases: string;
      journals: string;
      receipts: string;
      points: string;
      write_events: string;
      claims: string;
    }>(
      `
        select session.lifecycle,
          (select count(*)::text from fx_system_snapshot_lease
            where scope_uuid = $1 and session_id = $2) as leases,
          (select count(*)::text from fx_system_tx_journal
            where scope_uuid = $1 and session_id = $2) as journals,
          (select count(*)::text from fx_system_tx_journal_latest_receipt
            where scope_uuid = $1 and session_id = $2) as receipts,
          (select count(*)::text from fx_system_tx_journal_point
            where scope_uuid = $1 and session_id = $2) as points,
          (select count(*)::text from fx_system_tx_journal_write_event
            where scope_uuid = $1 and session_id = $2) as write_events,
          (select count(*)::text from fx_system_tx_execution_claim
            where scope_uuid = $1 and session_id = $2) as claims
        from fx_system_tx_session as session
        where session.scope_uuid = $1 and session.session_id = $2
      `,
      [scopeUuid, sessionId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Missing O08 disposition state.");
    return row;
  }

  async function installO08CSerializationTrigger(
    scopeUuid: string,
    label: "success" | "exhaustion",
    failuresBeforeSuccess: 2 | 3,
  ) {
    const sequenceName = `fx_test_o08c_${label}_attempts`;
    const functionName = `fx_test_o08c_${label}_40001`;
    const triggerName = `fx_test_o08c_${label}_40001_trigger`;
    await persistence.query(`create sequence ${sequenceName}`);
    await persistence.query(
      `
        create function ${functionName}()
        returns trigger
        language plpgsql
        as $$
        declare
          current_attempt bigint;
        begin
          if new.scope_uuid = '${scopeUuid}'::uuid then
            current_attempt := nextval('${sequenceName}');
            if current_attempt <= ${failuresBeforeSuccess} then
              raise exception 'forced O08-C serialization failure %',
                current_attempt using errcode = '40001';
            end if;
          end if;
          return new;
        end
        $$
      `,
    );
    await persistence.query(
      `
        create trigger ${triggerName}
        before insert on fx_system_commit
        for each row execute function ${functionName}()
      `,
    );
    return Object.freeze({
      attempts: async (): Promise<string> => {
        const result = await persistence.query<{ last_value: string }>(
          `select last_value::text from ${sequenceName}`,
        );
        const row = result.rows[0];
        if (row === undefined) {
          throw new Error("Missing O08-C attempt sequence state.");
        }
        return row.last_value;
      },
      drop: async (): Promise<void> => {
        await persistence.query(
          `drop trigger ${triggerName} on fx_system_commit`,
        );
        await persistence.query(`drop function ${functionName}()`);
        await persistence.query(`drop sequence ${sequenceName}`);
      },
    });
  }

  function nextUuid(): string {
    const suffix = uuidCounter.toString().padStart(12, "0");
    uuidCounter += 1;
    return `93000000-0000-4000-8000-${suffix}`;
  }

  function resolutionPorts(
    selected: PGliteFlarexPersistence,
  ): PointMutationSessionAuthorityResolutionPortsV1 {
    return {
      scopeMetadata: selected,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error("Shared placement must not read split receipts.");
        },
      },
      scopeSessionTargets: {
        resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
          createPGliteLocatedPointMutationSessionActivationTargetV1(
            selected,
            physicalLocator,
          ),
      },
    };
  }

  function pointMutationAttemptDiscovery(
    selected: PGliteFlarexPersistence,
  ) {
    return createPointMutationAttemptDiscoveryV1({
      scopeMetadata: selected,
      provisioningReceipts: {
        getScopeAuthorityProvisioningReceipt: async () => {
          throw new Error("Shared discovery must not read split receipts.");
        },
      },
      scopeDiscoveryTargets: {
        resolve: async (physicalLocator): Promise<LocatedScopeClockReader> =>
          createPGliteLocatedPointMutationSessionActivationTargetV1(
            selected,
            physicalLocator,
          ),
      },
    });
  }

  function portsWithReadCommittedOverride(
    run: <Result>(
      target: LocatedPointCommitPublicationTargetV1,
      work: (tx: AppRowTransaction) => Promise<Result>,
    ) => Promise<Result>,
    resolveOutcome?: (
      target: LocatedPointCommitPublicationTargetV1,
      input: ResolveCommittedPointOutcomeInputV1,
    ) => Effect.Effect<
      CommittedPointOutcomeResolutionV1,
      ResolveCommittedPointOutcomeErrorV1
    >,
  ): PointMutationSessionAuthorityResolutionPortsV1 {
    const base = resolutionPorts(persistence);
    return {
      ...base,
      scopeSessionTargets: {
        resolve: async (physicalLocator) => {
          const target =
            createPGliteLocatedPointMutationSessionActivationTargetV1(
              persistence,
              physicalLocator,
            );
          if (!isLocatedPointCommitPublicationTargetV1(target)) {
            throw new Error("Expected the PGlite publication target.");
          }
          return Object.freeze({
            ...target,
            [RUN_LOCATED_READ_COMMITTED_V1]: <Result>(
              work: (tx: AppRowTransaction) => Promise<Result>,
            ): Promise<Result> => run(target, work),
            [RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1]:
              resolveOutcome === undefined
                ? target[RESOLVE_LOCATED_COMMITTED_POINT_OUTCOME_V1]
                : (input: ResolveCommittedPointOutcomeInputV1) =>
                    resolveOutcome(target, input),
          } satisfies LocatedPointCommitPublicationTargetV1);
        },
      },
    };
  }

  async function publicationCommand(
    command: PointCommitTransactionCommandV1,
  ): Promise<PointCommitPublicationCommandV1> {
    const result = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    return Object.freeze({
      ...command,
      successfulResult: Object.freeze({
        valueCodecVersion: result.evidence.valueCodecVersion,
        value: result.valueJson,
        canonicalBytes: CanonicalSuccessfulResultBytesV1Schema.make(
          new Uint8Array(result.canonicalBytes),
        ),
        semanticSizeBytes: result.semanticSizeBytes,
        sha256Hex: result.evidence.sha256Hex,
      }),
    });
  }

  async function seal(current: Scenario) {
    const prepared = await prepareSeal(current.store, current.attempt);
    const journal = await runEffect(
      canonicalizeSessionJournalV1Effect(prepared.journal),
    );
    const result = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    return completeSeal(current.store, prepared.preparation, journal, result);
  }

  async function setLifecycle(
    sessionId: PointMutationSessionAnchorV1["sessionId"],
    lifecycle: TransactionSessionLifecycleV1,
  ): Promise<void> {
    await persistence.query(
      `
        update fx_system_tx_session
        set lifecycle = $2, updated_at = clock_timestamp()
        where session_id = $1
      `,
      [sessionId, lifecycle],
    );
  }

  async function timestamps(
    sessionId: PointMutationSessionAnchorV1["sessionId"],
  ): Promise<Readonly<Record<string, string>>> {
    const result = await persistence.query<Readonly<Record<string, string>>>(
      `
        select
          (select updated_at::text from fx_system_tx_session
            where session_id = $1) as session_updated_at,
          (select updated_at::text from fx_system_tx_journal
            where session_id = $1) as root_updated_at
      `,
      [sessionId],
    );
    const row = result.rows[0];
    if (row === undefined) throw new Error("Missing timestamp row.");
    return row;
  }
});

function commitAuthorityFromStoredEvidence(
  authority: StoredAttemptEvidenceAuthorityV1,
  evidence: Extract<
    StoredAttemptEvidenceLoadResultV1,
    { readonly kind: "loaded" }
  >["evidence"],
): StoredCommitAuthorityEvidenceAuthorityV1 {
  return Object.freeze({
    ...authority,
    session: Object.freeze(structuredClone(evidence.session)),
    sealIdentity: Object.freeze({
      scopeUuid: evidence.scopeUuid,
      lifecycle: evidence.session.lifecycle,
      sessionUpdatedAtMilliseconds: evidence.session.updatedAtMilliseconds,
      leaseExpiresAtMilliseconds: evidence.lease.leaseExpiresAtMilliseconds,
      rootCreatedAtMilliseconds: evidence.root.createdAtMilliseconds,
      rootUpdatedAtMilliseconds: evidence.root.updatedAtMilliseconds,
      sealedAtMilliseconds: evidence.root.sealedAtMilliseconds,
      finalSyscallSequence: evidence.root.sealedFinalSyscallSequence,
      creationTimeSeed: evidence.root.creationTimeSeed,
      nextCreationTime: evidence.root.nextCreationTime,
      journalFormat: SESSION_JOURNAL_FORMAT_V1,
      journalProtocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
      journalValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      journalByteLength: evidence.root.journalBytes.byteLength,
      journalSha256: new Uint8Array(evidence.root.journalSha256),
      resultValueCodecVersion: evidence.root.resultValueCodecVersion,
      resultSemanticBytes: evidence.root.resultSemanticBytes,
      resultByteLength: evidence.root.resultBytes.byteLength,
      resultSha256: new Uint8Array(evidence.root.resultSha256),
      readDocuments: evidence.root.readDocuments,
      readSemanticBytes: evidence.root.readSemanticBytes,
      pointDependencyCount: evidence.root.pointDependencyCount,
      indexedQuerySyscalls: evidence.root.indexedQuerySyscalls,
      indexRangeDependencyCount: evidence.root.indexRangeDependencyCount,
      indexRangeDependencyEvidenceBytes:
        evidence.root.indexRangeDependencyEvidenceBytes,
      writeOperations: evidence.root.writeOperations,
      writeSemanticBytes: evidence.root.writeSemanticBytes,
      materialWriteEventEvidenceBytes:
        evidence.root.materialWriteEventEvidenceBytes,
    }),
  });
}

function schedulerRun(
  persistence: PGliteFlarexPersistence,
  owner: string,
  multiScope: Pick<PointMutationMultiScopeRedeliveryV1, "sweepEffect">,
  budgets: Readonly<{
    readonly scopeLimit: number;
    readonly maxAttemptPages: number;
    readonly maxCandidateAttempts: number;
  }>,
) {
  const target = createPGliteLocatedPointMutationSessionActivationTargetV1(
    persistence,
    sharedLocator,
  );
  if (!isLocatedReadCommittedAttemptTargetV1(target)) {
    throw new Error("Expected a located scheduler transaction target.");
  }
  const repository = createPointMutationRedeliverySchedulerCheckpointV1(
    target,
    { claimDurationMilliseconds: 60_000, randomUuid: () => owner },
  );
  return Result.getOrThrow(createPointMutationRedeliverySchedulerRunV1(
    schedulerCheckpointPort(repository),
    multiScope,
    Object.freeze({
      maximumInvocations: 1,
      maximumAttemptPages: budgets.maxAttemptPages,
      maximumCandidateAttempts: budgets.maxCandidateAttempts,
      scopeLimitPerInvocation: budgets.scopeLimit,
      maximumRunMilliseconds: 10_000,
      maximumInvocationMilliseconds: 5_000,
      settlementReserveMilliseconds: 1_000,
    }),
  ));
}

function schedulerCheckpointPort(
  repository: PointMutationRedeliverySchedulerCheckpointV1,
): PointMutationRedeliverySchedulerCheckpointPortV1<
  PointMutationRedeliverySchedulerRunV1,
  PointMutationRedeliverySchedulerConfigurationV1Error,
  PointMutationRedeliverySchedulerAcquireV1Error,
  PointMutationRedeliverySchedulerRenewV1Error,
  PointMutationRedeliverySchedulerCheckpointV1Error,
  PointMutationRedeliverySchedulerReleaseV1Error,
  PointMutationRedeliverySchedulerConfirmedRollbackV1Error,
  PointMutationRedeliverySchedulerConfirmedRollbackV1Error,
  PointMutationRedeliverySchedulerConfirmedRollbackV1Error,
  PointMutationRedeliverySchedulerConfirmedRollbackV1Error
> {
  return Object.freeze({
    ...repository,
    isAcquireConfirmedRollback:
      isPointMutationRedeliverySchedulerAcquireConfirmedRollbackV1Error,
    isRenewConfirmedRollback:
      isPointMutationRedeliverySchedulerRenewConfirmedRollbackV1Error,
    isCheckpointConfirmedRollback:
      isPointMutationRedeliverySchedulerCheckpointConfirmedRollbackV1Error,
    isReleaseConfirmedRollback:
      isPointMutationRedeliverySchedulerReleaseConfirmedRollbackV1Error,
  });
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

async function applicationExecutionAuthority(
  scopeId: string,
  schemaVersionId: string,
) {
  const target = Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1({
    format: "flarex.application-runtime-target",
    version: 1,
    scopeId,
    revisionId: "revision-test",
    candidateId: "candidate-test",
    analysisId: "analysis-test",
    sourceArtifactRootSha256: "1".repeat(64),
    manifestSha256: "2".repeat(64),
    schemaSha256: "3".repeat(64),
    functionCatalogSha256: "4".repeat(64),
    publicationSha256: "5".repeat(64),
    executionModulePath: "_flarex/application.js",
    function: {
      path: "users:create",
      moduleName: "users",
      exportName: "create",
      kind: "mutation",
      visibility: "public",
      args: { type: "object", value: {} },
      returns: { type: "null" },
      partition: null,
      entrySha256: "6".repeat(64),
    },
  }));
  const ownedTargetBytes = new Uint8Array(target.canonicalBytes.byteLength);
  ownedTargetBytes.set(target.canonicalBytes);
  const targetDigest = new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    ownedTargetBytes.buffer,
  ));
  return runEffect(canonicalizeApplicationMutationExecutionAuthorityV1({
    format: "flarex.application-mutation-execution-authority",
    version: 1,
    runtimeTarget: target.target,
    runtimeTargetSha256: bytesToHex(targetDigest),
    activationSequence: "1",
    activeHeadSha256: "7".repeat(64),
    schemaVersionId,
  }));
}

function selectorFromAnchor(
  anchor: PointMutationSessionAnchorV1,
): PointMutationSessionAttemptSelectorV1 {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
  });
}

function selectorInputFromAnchor(
  anchor: PointMutationSessionAnchorV1,
): Readonly<{
  readonly deploymentId: string;
  readonly scopeId: string;
  readonly sessionId: string;
  readonly attemptFence: string;
}> {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence.toString(),
  });
}

function authorityFromAnchor(
  anchor: PointMutationSessionAnchorV1,
  schemaVersionId: ReturnType<typeof CatalogSchemaVersionIdSchema.make>,
  executionClaim: NonNullable<
    StoredAttemptEvidenceAuthorityV1["executionClaim"]
  >,
): StoredAttemptEvidenceAuthorityV1 {
  return Object.freeze({
    deploymentId: anchor.deploymentId,
    scopeId: anchor.scopeId,
    sessionId: anchor.sessionId,
    attemptFence: anchor.attemptFence,
    storageGeneration: anchor.storageGeneration,
    storageGenerationFence: anchor.storageGenerationFence,
    snapshotToken: anchor.snapshotToken,
    schemaVersionId,
    executionClaim,
  });
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
          alias: {
            fieldType: { type: "string" },
            optional: true,
          },
          category: {
            fieldType: { type: "string" },
            optional: true,
          },
          profile: {
            fieldType: {
              type: "object",
              value: {
                alias: {
                  fieldType: { type: "string" },
                  optional: true,
                },
              },
            },
            optional: true,
          },
        },
      },
    },
  };
}

function deferredSignal(): Readonly<{
  readonly promise: Promise<void>;
  readonly resolve: () => void;
}> {
  let resolver: (() => void) | undefined;
  const promise = new Promise<void>((resolve) => {
    resolver = resolve;
  });
  return Object.freeze({
    promise,
    resolve: () => resolver?.(),
  });
}

function disposableExactRuntimeSuccessResponse(
  dispose: () => void,
): PointMutationExactRuntimeHostResponseV2 & Disposable {
  return {
    format: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_FORMAT_V2,
    version: POINT_MUTATION_EXACT_RUNTIME_HOST_RESPONSE_VERSION_V2,
    kind: "success",
    result: {
      format: POINT_MUTATION_EXACT_RUNTIME_RESULT_FORMAT_V1,
      version: POINT_MUTATION_EXACT_RUNTIME_RESULT_VERSION_V1,
      value: { ok: true },
    },
    [Symbol.dispose]: dispose,
  };
}
