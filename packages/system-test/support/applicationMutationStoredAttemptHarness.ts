/// <reference types="@cloudflare/workers-types" />

import { webcrypto } from "node:crypto";
import { eq } from "drizzle-orm";
import { Effect, Encoding, Result } from "effect";

import {
  createApplicationMutationSessionActivationV1,
  createPointMutationSessionAttemptLoadingV1,
  createPointMutationSessionAttemptTerminalizationV1,
  inspectActivatedPointMutationSessionV1,
} from "@flarex/executor/point-mutation-session";
import { createPointMutationJournalV1 } from
  "@flarex/executor/point-mutation-journal";
import {
  createPointMutationExecutionClaimVaultV1,
} from "@flarex/executor/internal/point-mutation-execution-claim-v1";
import type {
  PointMutationOccRuntimeNeutralRunnerV1,
} from "@flarex/executor/internal/stored-attempt-authentication-v1";
import {
  createTransactionGrantVerificationKeyNamespaceV1,
  createTransactionGrantVerifierV1,
} from "@flarex/executor/transaction-grant";
import {
  makeApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
} from "@flarex/persistence-postgres/internal/system-test/applicationAnalysisRegistration";
import type { FlarexMetadataDatabase } from
  "@flarex/persistence-postgres/internal/system-test/deployments";
import {
  makeApplicationPublicationRepository,
  type ApplicationPublication,
} from "@flarex/persistence-postgres/internal/system-test/applicationPublication";
import {
  makeApplicationReadinessRepository,
  type ApplicationReadinessTaskRuntimeContext,
} from "@flarex/persistence-postgres/internal/application-readiness";
import {
  makeApplicationActivationRepository,
} from "@flarex/persistence-postgres/internal/application-activation";
import {
  makeApplicationSchemaAuthorityPublisher,
  hasApplicationSchemaAuthorityComposition,
} from "@flarex/persistence-postgres/internal/application-schema-authority";
import {
  createApplicationTaskCatalogSnapshotPort,
  isApplicationTaskCatalogSnapshotPort,
  makeApplicationTaskBindingRepository,
} from "@flarex/persistence-postgres/internal/application-task-bindings";
import {
  createApplicationTaskRuntimeReadinessSnapshotPort,
  makeApplicationTaskRuntimePublicationRepository,
} from "@flarex/persistence-postgres/internal/application-task-runtime-publication";
import {
  createAppSchemaCandidateReadinessPort,
  createAppSchemaCandidateValidationPort,
  hasAppSchemaCandidateReadinessComposition,
  installAppSchemaCandidateValidationEffect,
  advanceAppSchemaCandidateValidationEffect,
  settleAppSchemaCandidateValidationEffect,
} from "@flarex/persistence-postgres/internal/system-test/appSchemaCandidateValidation";
import {
  createAppUniqueConstraintDefinitionPortV1,
} from "@flarex/persistence-postgres/internal/app-unique-constraint-commit-v1";
import {
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
} from "@flarex/persistence-postgres/internal/app-unique-constraint-set-closure-v1";
import {
  createAppUniqueConstraintSetEligibilityPortV1,
} from "@flarex/persistence-postgres/internal/app-unique-constraint-set-build-v1";
import {
  createAppDeveloperIndexDefinitionPortV1,
} from "@flarex/persistence-postgres/internal/app-developer-index-commit-v1";
import {
  createIntrinsicCreationTimeIndexDefinitionPortV1,
  buildIntrinsicCreationTimeIndexV1Effect,
} from "@flarex/persistence-postgres/internal/system-test/intrinsicCreationTimeIndexBuildV1";
import {
  reconcilePublishedIndexBuildsV1Effect,
} from "@flarex/persistence-postgres/internal/system-test/indexBuildReconciliation";
import {
  locateAppIndexDefinitionByIdEffect,
} from "@flarex/persistence-postgres/internal/system-test/appIndexDefinitions";
import {
  createPointCommitFinishingTransitionPortV1,
  createPointCommitPublisherPortV1,
  createPointMutationAttemptReplacementPortV1,
  hasPointCommitAuthorityBindingV1,
} from "@flarex/persistence-postgres/internal/system-test/pointCommitTransaction";
import {
  createSessionJournalStorePersistenceV1,
  createAppDeveloperIndexQueryPortV1,
  hasAppDeveloperIndexQueryAuthorityV1,
  hasAppDeveloperIndexQuerySchemaAuthorityCompositionV1,
} from "@flarex/persistence-postgres/internal/system-test/sessionJournalStore";
import {
  createStoredAttemptEvidenceLoaderV1,
} from "@flarex/persistence-postgres/internal/system-test/storedAttemptEvidence";
import {
  createStoredOccExecutionEvidenceLoaderV1,
} from "@flarex/persistence-postgres/internal/system-test/storedOccExecution";
import {
  createPointMutationExecutionClaimLivenessV1,
} from "@flarex/persistence-postgres/internal/system-test/transactionExecutionClaimLiveness";
import {
  createApplicationMutationSessionActivationPersistenceV1,
  createPointMutationSessionAttemptLoadPersistenceV1,
  createPointMutationSessionAttemptTerminalizationPersistenceV1,
  type PointMutationSessionAuthorityResolutionPortsV1,
} from "@flarex/persistence-postgres/internal/system-test/transactionSessionActivation";
import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
} from "@flarex/persistence-postgres/internal/system-test/appRows";
import {
  fxSystemScopeClocks,
} from "@flarex/persistence-postgres/internal/system-test/schema";
import {
  createPGliteLocatedApplicationRevisionActivationTargetV1,
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGliteSharedScopeAuthorityProvisioner,
  type PGliteFlarexPersistence,
} from "@flarex/persistence-postgres/pglite";
import {
  createPostgresLocatedApplicationRevisionActivationTargetV1,
  createPostgresLocatedPointMutationSessionActivationTargetV1,
  createPostgresSharedScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "@flarex/persistence-postgres/postgres";
import type { FlarexPersistence } from "@flarex/persistence-postgres";
import {
  produceApplicationTaskBindingsV1,
  type PreparedApplicationTaskBindingsV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import {
  decodeTaskRuntimeMaterializationSpecV1,
  hashCanonicalTaskCatalogV1,
  makeTaskRuntimePublicationReceiptAuthority,
  makeStandardApplicationTaskSha256V1,
  prepareTaskRuntimePublication,
  TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  TASK_RUNTIME_CONTRACT_IDENTITY_V1,
  TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  TASK_RUNTIME_PROFILE_IDENTITY_V1,
  verifyTaskRuntimeReadiness,
  type HashedCanonicalTaskCatalogV1,
  type PreparedTaskRuntimeReadinessBasisV1,
  type TaskDefinitionSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { produceStandardApplicationSource } from
  "@flarex/standard-application-definition/application-source";
import {
  prepareStandardApplicationDefinitionV1,
  type PreparedStandardApplicationDefinitionV1,
} from
  "@flarex/standard-application-definition/v1";
import {
  makeApplicationMutationRuntimeNeutralRunner,
} from "@flarex/standard-application-invocation/internal/application-mutation-runner";
import {
  ApplicationMutationGrantIssuanceError,
  makeApplicationMutationSystemLayer,
  type ApplicationMutationGrantIssueInput,
} from "@flarex/standard-application-invocation/internal/application-mutation-system";
import {
  invokeStandardApplicationPointMutationV1,
} from "@flarex/standard-application-invocation/v1";
import {
  copyBytesToArrayBuffer,
  isUint8ArrayWithByteLength,
} from "@flarex/utils/bytes";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import {
  APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
  assembleApplicationMutationGrantJwsV1,
  createApplicationMutationGrantVerifierNamespaceV1,
  prepareApplicationMutationGrantV1,
  verifyApplicationMutationGrantV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import {
  canonicalizeApplicationRuntimeColdReceiptV1,
} from "flarex-protocol/internal/application-runtime-cold-receipt-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  appDocumentIdV1FromRowIdentity,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import { decodeCatalogTableId } from "flarex-protocol/catalog";
import { PointMutationTargetFunctionMetadataV1Schema } from
  "flarex-protocol/point-mutation-start";
import {
  CatalogSchemaVersionIdSchema,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
import {
  CommitSeqSchema,
  decodeReplacementScopeIdV1,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";
import {
  TRANSACTION_GRANT_KEY_PURPOSE_V1,
  TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  TransactionGrantDeploymentIdV1Schema,
  type TransactionGrantDeploymentIdV1,
  TransactionGrantKeyIdV1Schema,
  TransactionGrantTimestampV1Schema,
  canonicalizeTransactionGrantIdentityAccessPolicyV1,
} from "flarex-protocol/transaction-grant";
import {
  CanonicalTransactionArgumentsBytesV1Schema,
  TransactionArgumentsSha256V1Schema,
  TransactionAuthorizationGrantIdV1Schema,
  TransactionAuthorizationRevocationEpochSchema,
  TransactionFunctionKindV1Schema,
  TransactionFunctionPathV1Schema,
  TransactionExecutionModuleV1Schema,
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionPolicyVersionV1Schema,
  TransactionRequestKeyV1Schema,
  TransactionRequestSha256V1Schema,
} from "flarex-protocol/transaction-session";
import { canonicalizePointMutationRequestV1 } from
  "flarex-protocol/point-mutation-start";
import {
  canonicalizeFlarexValueJsonV1,
  FLAREX_VALUE_CODEC_VERSION_V1,
} from "flarex-protocol/value";
import type { ApplicationExecutionHost } from
  "flarex-backend/internal/application-execution-host";

import {
  analyzePreparedStandardApplicationFixture,
} from "./applicationAnalysisColdHarness";
import {
  C07_TEST_GRANT_RETENTION_POLICY_V1,
} from "./c07PointMutationFixtureV1";
import {
  createPrivatePointMutationInitialExecutionV1,
} from "./c07PrivatePointMutationHarness";
import {
  issueSetupSeededSyscallValidatorProofV1,
} from "./setupSeededSyscallValidatorProofV1";
import { runSystemTestEffectV1 } from "./systemTestEffectBoundaryV1";

const SOURCE = "export async function save() { return { ok: true }; }\n";
const LOCATOR = Object.freeze({
  kind: "shared_database",
  databaseKey: "application-mutation-stored-attempt",
  schemaName: "public",
} as const);
const RUNTIME_HOST_IDENTITY = "flarex.test/application-mutation-host";
const COMPATIBILITY_DATE = "2026-08-12";
const taskSha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);

export interface ApplicationMutationStoredAttemptProof {
  readonly firstResultKind: "published";
  readonly competingResultKind: "published";
  readonly runtimeExecutions: 2;
  readonly competingRuntimeExecutions: 1;
  readonly sourceLoads: 3;
  readonly distinctWorkerDefinitions: true;
  readonly primaryOutcomeCount: 1;
  readonly competingOutcomeCount: 1;
  readonly durableCommitCount: 2;
  readonly primaryAttemptFence: "2";
  readonly primaryCommitSeq: string;
  readonly competingCommitSeq: string;
  readonly finalName: string;
  readonly sessionGenerations: readonly ["application_v1", "application_v1"];
}

export interface StandardApplicationMutationProof {
  readonly firstDisposition: "published";
  readonly replayDisposition: "replayed";
  readonly runtimeExecutions: 1;
  readonly sourceLoads: 1;
  readonly grantIssuances: 1;
  readonly exactCompositionGuards: true;
  readonly conflictingRequestRejected: true;
  readonly admittedSessionSurvivedHeadRemoval: true;
  readonly staleHeadBeforeAdmissionRejected: true;
  readonly sessionCount: 1;
  readonly outcomeCount: 1;
  readonly commitCount: 1;
  readonly generation: "application_v1";
  readonly finalName: "standard-application";
}

export interface StandardApplicationMutationPostgresProof
  extends StandardApplicationMutationProof {
  readonly postgresVersion: string;
}

interface ApplicationMutationStoredAttemptLane {
  readonly persistence: FlarexPersistence;
  readonly controlDb: FlarexMetadataDatabase;
  readonly ensureScope: (
    deploymentId: TransactionGrantDeploymentIdV1,
    projectId: string,
    randomUuid: () => string,
  ) => Promise<Readonly<{ readonly scope: Readonly<{ readonly scopeId: string }> }>>;
  readonly makeActivationTarget: () => ReturnType<
    typeof createPGliteLocatedApplicationRevisionActivationTargetV1
  >;
  readonly makeSessionTarget: () => ReturnType<
    typeof createPGliteLocatedPointMutationSessionActivationTargetV1
  >;
}

type EnsureApplicationMutationScope =
  ApplicationMutationStoredAttemptLane["ensureScope"];

function pgliteApplicationMutationLane(
  persistence: PGliteFlarexPersistence,
): ApplicationMutationStoredAttemptLane {
  return Object.freeze({
    persistence,
    controlDb: persistence.drizzle,
    ensureScope: ((deploymentId, projectId, randomUuid) =>
      createPGliteSharedScopeAuthorityProvisioner(persistence, {
        physicalLocator: LOCATOR,
        randomUuid,
      }).ensure({ deploymentId, projectId })) satisfies EnsureApplicationMutationScope,
    makeActivationTarget: () =>
      createPGliteLocatedApplicationRevisionActivationTargetV1(
        persistence,
        LOCATOR,
      ),
    makeSessionTarget: () =>
      createPGliteLocatedPointMutationSessionActivationTargetV1(
        persistence,
        LOCATOR,
      ),
  });
}

function postgresApplicationMutationLane(
  persistence: PostgresFlarexPersistence,
): ApplicationMutationStoredAttemptLane {
  return Object.freeze({
    persistence,
    controlDb: persistence.drizzle,
    ensureScope: ((deploymentId, projectId, randomUuid) =>
      createPostgresSharedScopeAuthorityProvisioner(persistence, {
        physicalLocator: LOCATOR,
        randomUuid,
      }).ensure({ deploymentId, projectId })) satisfies EnsureApplicationMutationScope,
    makeActivationTarget: () =>
      createPostgresLocatedApplicationRevisionActivationTargetV1(
        persistence,
        LOCATOR,
      ),
    makeSessionTarget: () =>
      createPostgresLocatedPointMutationSessionActivationTargetV1(
        persistence,
        LOCATOR,
      ),
  });
}

export async function proveApplicationMutationStoredAttemptPGlite(
  persistence: PGliteFlarexPersistence,
): Promise<ApplicationMutationStoredAttemptProof> {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
  const lane = pgliteApplicationMutationLane(persistence);
  const fixture = await prepareApplicationFixture(lane);
  const ports = resolutionPorts(lane);
  const applicationVerifier = fixture.applicationVerifier;
  const activate = async (role: "primary" | "competing") => {
    const input = await applicationActivationInput(
      fixture,
      role,
    );
    const claims = createPointMutationExecutionClaimVaultV1();
    const activated = await runSystemTestEffectV1(
      createApplicationMutationSessionActivationV1(
        createApplicationMutationSessionActivationPersistenceV1(ports, {
          leaseDurationMilliseconds: 600_000,
          randomUuid: uuidSequence(role === "primary" ? 80 : 90),
        }),
        claims.issuer,
      ).activate(input),
    );
    const inspection = inspectActivatedPointMutationSessionV1(activated);
    if (inspection.status !== "created") {
      throw new Error(`Application ${role} session was not created.`);
    }
    return Object.freeze({ input, claims, activated });
  };
  const primary = await activate("primary");
  const competing = await activate("competing");
  const store = createSessionJournalStorePersistenceV1(ports, {
    grantRetentionPolicy: C07_TEST_GRANT_RETENTION_POLICY_V1,
    randomUuid: uuidSequence(100, 101, 102, 103, 104, 105),
  });
  const sourceDefinitions: object[] = [];
  let sourceLoads = 0;
  let runtimeExecutions = 0;
  let competingRuntimeExecutions = 0;
  let competingCommitSeq: string | undefined;
  const source = Object.freeze({
    read: (rootSha256: string) => Effect.sync(() => {
      sourceLoads += 1;
    }).pipe(Effect.andThen(fixture.source.read(rootSha256))),
  });
  let competingExecution: ReturnType<
    typeof createPrivatePointMutationInitialExecutionV1
  >;
  const competingRunner = await makeRunner(source, input =>
    Effect.promise(async () => {
      competingRuntimeExecutions += 1;
      sourceDefinitions.push(input.definition);
      const capability = applicationCapability(input);
      await capability.readPointDocument("recipes", fixture.documentId);
      await capability.patchPointDocument(fixture.documentId, {
        name: "competing",
      });
      return { ok: true };
    })
  );
  competingExecution = createExecution(
    fixture,
    ports,
    competing.claims,
    store,
    applicationVerifier,
    competingRunner,
  );
  const primaryRunner = await makeRunner(source, input =>
    Effect.promise(async () => {
      runtimeExecutions += 1;
      sourceDefinitions.push(input.definition);
      const capability = applicationCapability(input);
      await capability.readPointDocument("recipes", fixture.documentId);
      if (runtimeExecutions === 1) {
        const result = await runSystemTestEffectV1(
          competingExecution.executeInitialPointMutationAttempt(
            competing.activated,
          ),
        );
        if (result.kind !== "published") {
          throw new Error("Competing Application mutation did not publish.");
        }
        competingCommitSeq = result.token.commitSeq.toString();
      }
      await capability.patchPointDocument(fixture.documentId, {
        name: `primary-${runtimeExecutions}`,
      });
      return { ok: true };
    })
  );
  const primaryExecution = createExecution(
    fixture,
    ports,
    primary.claims,
    store,
    applicationVerifier,
    primaryRunner,
  );
  const first = await runSystemTestEffectV1(
    primaryExecution.executeInitialPointMutationAttempt(primary.activated),
  );
  if (first.kind !== "published") {
    throw new Error("Primary Application mutation did not publish.");
  }
  const scopeUuid = projectScopeIdUuidV1(fixture.scopeId).scopeUuid;
  const rows = await persistence.query<{
    name: string;
    primary_outcomes: string;
    competing_outcomes: string;
    durable_commits: string;
    primary_attempt_fence: string;
  }>(
    `select revision.value_json->>'name' as name,
            (select count(*)::text from fx_system_idempotency
              where request_key = $2) as primary_outcomes,
            (select count(*)::text from fx_system_idempotency
              where request_key = $3) as competing_outcomes,
            (select count(*)::text from fx_system_commit
              where scope_uuid = $1) as durable_commits,
            (select attempt_fence::text from fx_system_tx_session
              where scope_uuid = $1 and request_key = $2)
              as primary_attempt_fence
       from fx_app_row_current as current_row
       join fx_app_row_rev as revision
         on revision.scope_uuid = current_row.scope_uuid
        and revision.table_id = current_row.table_id
        and revision.row_id = current_row.row_id
        and revision.commit_seq = current_row.commit_seq
      where current_row.scope_uuid = $1
        and revision.is_tombstone = false`,
    [
      scopeUuid,
      primary.input.evidence.requestKey,
      competing.input.evidence.requestKey,
    ],
  );
  const row = rows.rows[0];
  if (row === undefined) throw new Error("Application result row is missing.");
  const sessions = await persistence.query<{ generation: string }>(
    `select execution_authority_generation as generation
       from fx_system_tx_session
      order by request_key`,
  );
  if (competingCommitSeq === undefined) {
    throw new Error("Competing Application commit token is missing.");
  }
  return Object.freeze({
    firstResultKind: first.kind,
    competingResultKind: "published",
    runtimeExecutions: requireLiteral(runtimeExecutions, 2),
    competingRuntimeExecutions: requireLiteral(competingRuntimeExecutions, 1),
    sourceLoads: requireLiteral(sourceLoads, 3),
    distinctWorkerDefinitions:
      sourceDefinitions.length === 3 &&
        new Set(sourceDefinitions).size === 3
        ? true
        : fail("Application Worker definitions were reused."),
    primaryOutcomeCount: requireLiteral(Number(row.primary_outcomes), 1),
    competingOutcomeCount: requireLiteral(Number(row.competing_outcomes), 1),
    durableCommitCount: requireLiteral(Number(row.durable_commits), 2),
    primaryAttemptFence: requireStringLiteral(row.primary_attempt_fence, "2"),
    primaryCommitSeq: first.token.commitSeq.toString(),
    competingCommitSeq,
    finalName: row.name,
    sessionGenerations: requireGenerations(sessions.rows),
  });
}

export async function proveStandardApplicationMutationPGlite(
  persistence: PGliteFlarexPersistence,
): Promise<StandardApplicationMutationProof> {
  return proveStandardApplicationMutation(
    pgliteApplicationMutationLane(persistence),
  );
}

export async function proveStandardApplicationMutationPostgres(
  persistence: PostgresFlarexPersistence,
): Promise<StandardApplicationMutationPostgresProof> {
  const proof = await proveStandardApplicationMutation(
    postgresApplicationMutationLane(persistence),
  );
  const version = await persistence.query<{ version: string }>(
    "select version() as version",
  );
  const postgresVersion = version.rows[0]?.version;
  if (postgresVersion === undefined) {
    throw new Error("Application mutation PostgreSQL version is missing.");
  }
  return Object.freeze({ ...proof, postgresVersion });
}

async function proveStandardApplicationMutation(
  lane: ApplicationMutationStoredAttemptLane,
): Promise<StandardApplicationMutationProof> {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
  const { persistence, controlDb } = lane;
  const fixture = await prepareApplicationFixture(lane);
  const developerIndexes = createAppDeveloperIndexDefinitionPortV1(
    controlDb,
  );
  const indexedQueries = createAppDeveloperIndexQueryPortV1(
    controlDb,
    fixture.authorityPorts,
    developerIndexes,
  );
  const copiedPointCommit = Object.freeze({ ...fixture.pointCommit });
  const copiedIndexedQueries = Object.freeze({ ...indexedQueries });
  if (
    !hasPointCommitAuthorityBindingV1(
      fixture.pointCommit,
      fixture.authorityPorts,
    ) ||
    hasPointCommitAuthorityBindingV1(
      copiedPointCommit,
      fixture.authorityPorts,
    ) ||
    !hasAppDeveloperIndexQueryAuthorityV1(
      indexedQueries,
      fixture.authorityPorts,
    ) ||
    hasAppDeveloperIndexQueryAuthorityV1(
      copiedIndexedQueries,
      fixture.authorityPorts,
    ) ||
    !hasAppDeveloperIndexQuerySchemaAuthorityCompositionV1(
      indexedQueries,
      fixture.schema,
    ) ||
    hasAppDeveloperIndexQuerySchemaAuthorityCompositionV1(
      copiedIndexedQueries,
      fixture.schema,
    )
  ) throw new Error("Application mutation composition guard was not exact.");
  let runtimeExecutions = 0;
  let sourceLoads = 0;
  let grantIssuances = 0;
  let executionSequence = 0;
  let headRemovedAfterAdmission = false;
  let removeHeadAfterSelection = false;
  const scopeUuid = projectScopeIdUuidV1(fixture.scopeId).scopeUuid;
  const activeHeads = await persistence.query<{
    scope_id: string;
    activation_sequence: bigint;
    revision_id: string;
    readiness_sha256: Uint8Array;
    activation_sha256: Uint8Array;
    head_sha256: Uint8Array;
    head_bytes: Uint8Array;
    created_at: Date;
    updated_at: Date;
  }>(
    `select scope_id, activation_sequence, revision_id, readiness_sha256,
            activation_sha256, head_sha256, head_bytes, created_at, updated_at
       from fx_system_application_active_head_v1
      where scope_id = $1`,
    [fixture.scopeId],
  );
  const admittedHead = activeHeads.rows[0];
  if (activeHeads.rows.length !== 1 || admittedHead === undefined) {
    throw new Error("Application mutation active head is missing.");
  }
  const deleteActiveHead = () => persistence.query(
    `delete from fx_system_application_active_head_v1 where scope_id = $1`,
    [fixture.scopeId],
  );
  const restoreActiveHead = () => persistence.query(
    `insert into fx_system_application_active_head_v1 (
       scope_id, activation_sequence, revision_id, readiness_sha256,
       activation_sha256, head_sha256, head_bytes, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      admittedHead.scope_id,
      admittedHead.activation_sequence,
      admittedHead.revision_id,
      admittedHead.readiness_sha256,
      admittedHead.activation_sha256,
      admittedHead.head_sha256,
      admittedHead.head_bytes,
      admittedHead.created_at,
      admittedHead.updated_at,
    ],
  );
  const layer = makeApplicationMutationSystemLayer({
    deploymentId: fixture.deploymentId,
    activation: Object.freeze({
      readActive: () => fixture.activation.readActive().pipe(
        Effect.tap(() => {
          if (!removeHeadAfterSelection) return Effect.void;
          removeHeadAfterSelection = false;
          return Effect.promise(deleteActiveHead);
        }),
      ),
    }),
    schema: fixture.schema,
    grantIssuer: Object.freeze({
      issue: (input: ApplicationMutationGrantIssueInput) => Effect.gen(function* () {
        if (input.requestKey === "request:application:standard") {
          grantIssuances += 1;
        }
        const segments = yield* prepareApplicationMutationGrantV1({
          kid: TransactionGrantKeyIdV1Schema.make("application-key-1"),
          grantId: TransactionAuthorizationGrantIdV1Schema.make(
            "grant_application_standard",
          ),
          deploymentId: input.deploymentId,
          executionAuthority: input.executionAuthority,
          policyVersion: TransactionPolicyVersionV1Schema.make(
            TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
          ),
          identityAccessPolicy: input.identityAccessPolicy,
          validatedArgsValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
          validatedArgsSha256: input.validatedArgsSha256,
          requestKey: input.requestKey,
          requestSha256: input.requestSha256,
          issuedAt: TransactionGrantTimestampV1Schema.make(
            new Date(fixture.now - 30_000).toISOString(),
          ),
          expiresAt: TransactionGrantTimestampV1Schema.make(
            new Date(fixture.now + 300_000).toISOString(),
          ),
          authorizationRevocationEpoch:
            TransactionAuthorizationRevocationEpochSchema.make(0n),
        }).pipe(Effect.mapError(cause =>
          new ApplicationMutationGrantIssuanceError({
            reason: "rejected",
            cause,
          })
        ));
        const signature = yield* Effect.tryPromise({
          try: async () => new Uint8Array(await globalThis.crypto.subtle.sign(
            "Ed25519",
            fixture.keyPair.privateKey,
            copyBytesToArrayBuffer(segments.signingInput),
          )),
          catch: cause => new ApplicationMutationGrantIssuanceError({
            reason: "unavailable",
            cause,
          }),
        });
        return yield* verifyApplicationMutationGrantV1(
          assembleApplicationMutationGrantJwsV1(segments, signature),
          fixture.applicationVerifier,
        ).pipe(Effect.mapError(cause =>
          new ApplicationMutationGrantIssuanceError({
            reason: "rejected",
            cause,
          })
        ));
      }),
    }),
    applicationGrantVerifier: fixture.applicationVerifier,
    legacyGrantVerifier: makeLegacyGrantVerifier(fixture),
    source: Object.freeze({
      read: (rootSha256: string) => Effect.sync(() => {
        sourceLoads += 1;
      }).pipe(Effect.andThen(fixture.source.read(rootSha256))),
    }),
    host: Object.freeze({
      runTransaction: input => Effect.promise(async () => {
        runtimeExecutions += 1;
        if (!headRemovedAfterAdmission) {
          await deleteActiveHead();
          headRemovedAfterAdmission = true;
        }
        const capability = applicationCapability(input);
        await capability.readPointDocument("recipes", fixture.documentId);
        await capability.patchPointDocument(fixture.documentId, {
          name: "standard-application",
        });
        return { ok: true };
      }),
    }),
    sessionAuthority: fixture.authorityPorts,
    pointCommit: fixture.pointCommit,
    indexedQueries,
    grantRetentionPolicy: C07_TEST_GRANT_RETENTION_POLICY_V1,
    randomUuid: uuidSequence(110, 111, 112, 113, 114, 115),
    executionContextFactory: Object.freeze({
      make: () => Effect.sync(() => {
        executionSequence += 1;
        return Object.freeze({
          executionId: `application-standard-${executionSequence}`,
          logScopeId: `application-standard-log-${executionSequence}`,
          randomSeed: new Uint8Array(32).fill(executionSequence),
        });
      }),
    }),
    leaseDurationMilliseconds: 600_000,
    claimDurationMilliseconds: 600_000,
    leaseRenewalDurationMilliseconds: 600_000,
    heartbeatIntervalMilliseconds: 200_000,
  });
  const invoke = () => runSystemTestEffectV1(Effect.scoped(
    invokeStandardApplicationPointMutationV1(
      TransactionFunctionPathV1Schema.make("recipes:save"),
      { role: "standard" },
      TransactionRequestKeyV1Schema.make("request:application:standard"),
    ).pipe(Effect.provide(layer)),
  ));
  const staleAdmissionRequestKey = TransactionRequestKeyV1Schema.make(
    "request:application:stale-admission",
  );
  removeHeadAfterSelection = true;
  let staleHeadBeforeAdmissionRejected = false;
  try {
    await runSystemTestEffectV1(Effect.scoped(
      invokeStandardApplicationPointMutationV1(
        TransactionFunctionPathV1Schema.make("recipes:save"),
        { role: "stale-admission" },
        staleAdmissionRequestKey,
      ).pipe(Effect.provide(layer)),
    ));
  } catch (cause: unknown) {
    staleHeadBeforeAdmissionRejected = isTaggedError(
      cause,
      "ApplicationActivationError",
    );
  } finally {
    await restoreActiveHead();
  }
  const staleState = await persistence.query<{
    sessions: string;
    outcomes: string;
    commits: string;
  }>(
    `select (select count(*)::text from fx_system_tx_session
              where scope_uuid = $1 and request_key = $2) as sessions,
            (select count(*)::text from fx_system_idempotency
              where scope_uuid = $1 and request_key = $2) as outcomes,
            (select count(*)::text from fx_system_commit
              where scope_uuid = $1) as commits`,
    [scopeUuid, staleAdmissionRequestKey],
  );
  const staleRow = staleState.rows[0];
  if (
    !staleHeadBeforeAdmissionRejected || runtimeExecutions !== 0 ||
    staleRow === undefined || staleRow.sessions !== "0" ||
    staleRow.outcomes !== "0" || staleRow.commits !== "0"
  ) {
    throw new Error("Application mutation did not reject stale admission head.");
  }
  const first = await invoke();
  if (!headRemovedAfterAdmission) {
    throw new Error("Application mutation did not exercise post-admission head removal.");
  }
  await restoreActiveHead();
  const replay = await invoke();
  let conflictingRequestRejected = false;
  try {
    await runSystemTestEffectV1(Effect.scoped(
      invokeStandardApplicationPointMutationV1(
        TransactionFunctionPathV1Schema.make("recipes:save"),
        { role: "different" },
        TransactionRequestKeyV1Schema.make("request:application:standard"),
      ).pipe(Effect.provide(layer)),
    ));
  } catch (cause: unknown) {
    conflictingRequestRejected = isTaggedError(
      cause,
      "CommittedPointOutcomeRequestKeyReuseErrorV1",
    );
  }
  if (!conflictingRequestRejected) {
    throw new Error("Application mutation accepted conflicting request reuse.");
  }
  const rows = await persistence.query<{
    name: string;
    session_count: string;
    outcome_count: string;
    commit_count: string;
    generation: string;
  }>(
    `select revision.value_json->>'name' as name,
            (select count(*)::text from fx_system_tx_session
              where scope_uuid = $1 and request_key = $2) as session_count,
            (select count(*)::text from fx_system_idempotency
              where scope_uuid = $1 and request_key = $2) as outcome_count,
            (select count(*)::text from fx_system_commit
              where scope_uuid = $1) as commit_count,
            (select execution_authority_generation
               from fx_system_tx_session
              where scope_uuid = $1 and request_key = $2) as generation
       from fx_app_row_current as current_row
       join fx_app_row_rev as revision
         on revision.scope_uuid = current_row.scope_uuid
        and revision.table_id = current_row.table_id
        and revision.row_id = current_row.row_id
        and revision.commit_seq = current_row.commit_seq
      where current_row.scope_uuid = $1
        and revision.is_tombstone = false`,
    [scopeUuid, TransactionRequestKeyV1Schema.make(
      "request:application:standard",
    )],
  );
  const row = rows.rows[0];
  if (row === undefined) throw new Error("Standard Application row is missing.");
  return Object.freeze({
    firstDisposition: requireStringLiteral(first.disposition, "published"),
    replayDisposition: requireStringLiteral(replay.disposition, "replayed"),
    runtimeExecutions: requireLiteral(runtimeExecutions, 1),
    sourceLoads: requireLiteral(sourceLoads, 1),
    grantIssuances: requireLiteral(grantIssuances, 1),
    exactCompositionGuards: true as const,
    conflictingRequestRejected: true as const,
    admittedSessionSurvivedHeadRemoval: true as const,
    staleHeadBeforeAdmissionRejected: true as const,
    sessionCount: requireLiteral(Number(row.session_count), 1),
    outcomeCount: requireLiteral(Number(row.outcome_count), 1),
    commitCount: requireLiteral(Number(row.commit_count), 1),
    generation: requireStringLiteral(row.generation, "application_v1"),
    finalName: requireStringLiteral(row.name, "standard-application"),
  });
}

async function prepareTaskRuntimeReadinessContext(input: {
  readonly db: FlarexMetadataDatabase;
  readonly authority: ApplicationAnalysisAuthority;
  readonly definition: PreparedStandardApplicationDefinitionV1;
  readonly catalog: HashedCanonicalTaskCatalogV1;
  readonly bindings: PreparedApplicationTaskBindingsV1;
  readonly publication: ApplicationPublication;
  readonly taskCatalog: ReturnType<
    typeof createApplicationTaskCatalogSnapshotPort
  >;
}): Promise<ApplicationReadinessTaskRuntimeContext<never>> {
  const source = Result.getOrThrow(
    produceStandardApplicationSource(input.definition),
  );
  const authenticatedModules = await Promise.all(source.modules.map(
    async (module, ordinal) => Object.freeze({
      ordinal,
      artifactModulePath: module.path,
      roles: module.roles,
      sourceByteLength: module.sourceBytes.byteLength,
      sourceSha256: brandTaskDefinitionSha256(
        await runSystemTestEffectV1(taskSha256(
          module.sourceBytes,
          { maximumInputBytes: module.sourceBytes.byteLength },
        )),
      ),
    }),
  ));
  const materialization = Result.getOrThrow(
    decodeTaskRuntimeMaterializationSpecV1({
      kind: "task_runtime_materialization_spec",
      runtimeContractIdentity: TASK_RUNTIME_CONTRACT_IDENTITY_V1,
      bridgeAbiIdentity: TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
      compatibilityDate: COMPATIBILITY_DATE,
      compatibilityFlags: ["nodejs_compat"],
      runtimeProfileIdentity: TASK_RUNTIME_PROFILE_IDENTITY_V1,
      runtimeImplementationVersion: "worker-loader-2026.08.13-aa-r7",
      supportedComputeProfiles: ["standard-1x"],
      moduleEntryPolicyIdentity: TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
    }),
  );
  const publicationSha256 = decodeTaskDefinitionSha256(
    input.publication.publicationSha256,
  );
  const sourceArtifactRootSha256 = decodeTaskDefinitionSha256(
    input.publication.sourceArtifactRootSha256,
  );
  const binding = input.bindings.catalog.binding;
  const plan = await runSystemTestEffectV1(prepareTaskRuntimePublication({
    source,
    catalog: input.catalog,
    taskBindings: input.bindings,
    authority: {
      scopeId: binding.scopeId,
      candidateId: binding.candidateId,
      analysisId: binding.analysisId,
      applicationRevisionId: binding.revisionId,
      applicationPublicationSha256: publicationSha256,
      sourceArtifactRootSha256,
      applicationTaskCatalogBindingSha256: input.bindings.catalog.sha256,
      authenticatedModules,
    },
    policy: {
      materialization,
      admittedCompatibilityDate: materialization.compatibilityDate,
      admittedCompatibilityFlags: materialization.compatibilityFlags,
      admittedRuntimeImplementationVersion:
        materialization.runtimeImplementationVersion,
      admittedComputeProfiles: materialization.supportedComputeProfiles,
    },
  }, taskSha256));
  const receiptAuthority = makeTaskRuntimePublicationReceiptAuthority(
    taskSha256,
  );
  const receipt = await runSystemTestEffectV1(receiptAuthority.prepareReceipt(
    plan,
    plan.objects.map(object => Result.getOrThrow(
      receiptAuthority.confirmPublishedObject(object, object.readReference()),
    )),
  ));
  await runSystemTestEffectV1(makeApplicationTaskRuntimePublicationRepository(
    input.db,
    receiptAuthority,
  ).publish({
    authority: input.authority,
    publication: receipt,
  }));
  const verified = await runSystemTestEffectV1(verifyTaskRuntimeReadiness({
    receiptCanonicalBytes: receipt.readCanonicalBytes(),
    receiptSha256: receipt.readSha256(),
    expected: {
      scopeId: binding.scopeId,
      candidateId: binding.candidateId,
      analysisId: binding.analysisId,
      applicationRevisionId: binding.revisionId,
      applicationPublicationSha256: publicationSha256,
      sourceArtifactRootSha256,
      applicationTaskCatalogBindingSha256: input.bindings.catalog.sha256,
      taskCatalog: input.catalog,
      materializationPolicy: materialization,
    },
    runtimeObjects: plan.objects.map(object => Object.freeze({
      reference: object.readReference(),
      canonicalBytes: object.readCanonicalBytes(),
    })),
  }, taskSha256));
  const proofs = new WeakMap<object, PreparedTaskRuntimeReadinessBasisV1>();
  const proof = Object.freeze({});
  proofs.set(proof, verified);
  return Object.freeze({
    connected: Object.freeze({
      verify: () => Effect.succeed(Object.freeze({
        status: "verified" as const,
        revisionId: input.publication.revisionId,
        proof,
      })),
      capture: (received: unknown) => {
        if (typeof received !== "object" || received === null) {
          return Result.fail(new Error("Missing task-runtime proof."));
        }
        const basis = proofs.get(received);
        return basis === undefined
          ? Result.fail(new Error("Foreign task-runtime proof."))
          : Result.succeed(Object.freeze({
              revisionId: input.publication.revisionId,
              readReceiptSha256: () => receipt.readSha256(),
              readCanonicalBytes: () => basis.readCanonicalBytes(),
              readSha256: () => basis.readSha256(),
            }));
      },
    }),
    snapshot: createApplicationTaskRuntimeReadinessSnapshotPort(
      input.taskCatalog,
    ),
  });
}

function decodeTaskDefinitionSha256(value: string): TaskDefinitionSha256V1 {
  return brandTaskDefinitionSha256(Result.getOrThrow(
    Encoding.decodeHex(value),
  ));
}

function brandTaskDefinitionSha256(value: Uint8Array): TaskDefinitionSha256V1 {
  if (!isUint8ArrayWithByteLength(value, 32)) {
    throw new Error("Expected a 32-byte task-runtime authority digest.");
  }
  // The protocol-owned brand is established by the exact byte-length check.
  return value as TaskDefinitionSha256V1;
}

async function prepareApplicationFixture(
  lane: ApplicationMutationStoredAttemptLane,
) {
  const { persistence, controlDb } = lane;
  const deploymentId = TransactionGrantDeploymentIdV1Schema.make(
    "deployment_application_mutation_stored_attempt",
  );
  const provisioned = await lane.ensureScope(
    deploymentId,
    "project_application_mutation",
    uuidSequence(1, 2, 3, 4, 5),
  );
  const scopeId = decodeReplacementScopeIdV1(provisioned.scope.scopeId);
  await persistence.query(
    `update fx_system_scope_clock
        set storage_generation = 'flarexdb_v1'
      where scope_id = $1`,
    [scopeId],
  );
  const clock = await persistence.getScopeClock(scopeId);
  if (clock === null || clock.storageGeneration !== "flarexdb_v1") {
    throw new Error("Application mutation scope clock is unavailable.");
  }
  const authority: ApplicationAnalysisAuthority = Object.freeze({
    scopeId,
    storageGeneration: clock.storageGeneration,
    storageGenerationFence: clock.storageGenerationFence,
    epoch: clock.epoch,
  });
  const analyses = makeApplicationAnalysisRepository(controlDb, {
    randomUuid: uuidSequence(10, 11, 12),
  });
  const definition = Result.getOrThrow(
    prepareStandardApplicationDefinitionV1(definitionInput()),
  );
  const analyzedFixture = await runSystemTestEffectV1(
    analyzePreparedStandardApplicationFixture({
      deploymentId,
      authority,
      repository: analyses,
      definition,
      requestKey: "request:application-analysis",
      uploadId: "30000000-0000-4000-8000-000000000013",
    }),
  );
  const analyzed = analyzedFixture.projection;
  const publication = await runSystemTestEffectV1(
    makeApplicationPublicationRepository(controlDb).publish({
      authority,
      revisionId: analyzed.revision.revisionId,
      candidateId: analyzed.candidateId,
      analysisId: analyzed.analysisId,
      manifestSha256: analyzed.manifestSha256,
      manifest: analyzed.manifest,
    }),
  );
  const catalog = await runSystemTestEffectV1(
    hashCanonicalTaskCatalogV1({ version: 1, tasks: [] }, taskSha256),
  );
  const bindings = await runSystemTestEffectV1(
    produceApplicationTaskBindingsV1({
      definition,
      catalog,
      authority: {
        scopeId: publication.scopeId,
        revisionId: publication.revisionId,
        candidateId: publication.candidateId,
        analysisId: publication.analysisId,
        sourceArtifactRootSha256: publication.sourceArtifactRootSha256,
        publicationSha256: publication.publicationSha256,
      },
      runtimePolicy: {
        runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
        compatibilityDate: COMPATIBILITY_DATE,
      },
    }, taskSha256),
  );
  await runSystemTestEffectV1(
    makeApplicationTaskBindingRepository(controlDb).register({
      authority,
      bindings,
    }),
  );
  const taskCatalog = createApplicationTaskCatalogSnapshotPort();
  const taskRuntime = await prepareTaskRuntimeReadinessContext({
    db: controlDb,
    authority,
    definition,
    catalog,
    bindings,
    publication,
    taskCatalog,
  });
  const located = lane.makeActivationTarget();
  const authorityPorts = Object.freeze({
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => null,
    },
    scopeClockTargets: { resolve: async () => located },
    scopeSessionTargets: {
      resolve: async () =>
        lane.makeSessionTarget(),
    },
  });
  const candidate = createAppSchemaCandidateValidationPort({
    controlDb,
    authority: authorityPorts,
  });
  const uniqueConstraints = createAppUniqueConstraintDefinitionPortV1(
    controlDb,
  );
  const uniqueConstraintEligibility =
    createAppUniqueConstraintSetEligibilityPortV1({
      controlDb,
      authority: authorityPorts,
    }, uniqueConstraints);
  const pointCommit = createPointCommitPublisherPortV1(authorityPorts, {
    intrinsicCreationTimeIndexes:
      createIntrinsicCreationTimeIndexDefinitionPortV1(controlDb),
    developerIndexes:
      createAppDeveloperIndexDefinitionPortV1(controlDb),
    uniqueConstraints,
    uniqueConstraintEligibility,
  });
  const schema = makeApplicationSchemaAuthorityPublisher({
    db: controlDb,
    runTransaction: run => controlDb.transaction(run),
  });
  const candidateReadiness = createAppSchemaCandidateReadinessPort(candidate);
  if (
    !hasApplicationSchemaAuthorityComposition(schema, controlDb) ||
    !isApplicationTaskCatalogSnapshotPort(taskCatalog) ||
    !hasAppSchemaCandidateReadinessComposition(
      candidateReadiness,
      controlDb,
      authorityPorts,
    )
  ) {
    throw new Error("Application readiness composition is not exact.");
  }
  const readiness = makeApplicationReadinessRepository({
    controlDb,
    authority: authorityPorts,
    schema,
    taskCatalog,
    taskRuntime,
    candidateValidation: candidateReadiness,
    pointCommit,
    cold: {
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
      materialize: input => Effect.gen(function* () {
        const canonical = Result.getOrThrow(
          canonicalizeApplicationRuntimeTargetV1(input.target),
        );
        return Result.getOrThrow(canonicalizeApplicationRuntimeColdReceiptV1({
          format: "flarex.application-runtime-cold-receipt",
          version: 1,
          status: "resolved",
          runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
          compatibilityDate: COMPATIBILITY_DATE,
          sourceArtifactRootSha256: input.target.sourceArtifactRootSha256,
          manifestSha256: input.target.manifestSha256,
          publicationSha256: input.target.publicationSha256,
          runtimeTargetSha256: yield* Effect.promise(() =>
            sha256Hex(canonical.canonicalBytes)
          ),
          functionPath: input.target.function.path,
          functionKind: input.target.function.kind,
          visibility: input.target.function.visibility,
        }));
      }),
    },
  });
  const beforeValidation = await runSystemTestEffectV1(readiness.settle({
    deploymentId,
    revisionId: publication.revisionId,
  }));
  if (
    beforeValidation.status !== "not_ready" ||
    beforeValidation.reason !== "candidateValidationMissing"
  ) throw new Error("Application schema authority was not published first.");
  const schemaRows = await persistence.query<{
    schema_version_id: CatalogSchemaVersionId;
  }>(
    `select schema_version_id
       from fx_control_application_schema_authority_v1
      where deployment_id = $1`,
    [deploymentId],
  );
  const schemaVersionId = schemaRows.rows[0]?.schema_version_id;
  if (schemaVersionId === undefined) {
    throw new Error("Application schema authority is missing.");
  }
  await seedBaselineRow(persistence, controlDb, scopeId, schemaVersionId);
  await settleCandidate(candidate, deploymentId, schemaVersionId);
  const closure = await runSystemTestEffectV1(
    prepareAppUniqueConstraintSetClosureV1Effect(controlDb, {
      deploymentId,
      schemaVersionId,
    }),
  );
  await controlDb.transaction(tx => runSystemTestEffectV1(
    closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure),
  ));
  await enableBuilds(
    controlDb,
    authorityPorts,
    deploymentId,
    schemaVersionId,
  );
  const ready = await runSystemTestEffectV1(readiness.settle({
    deploymentId,
    revisionId: publication.revisionId,
  }));
  if (ready.status !== "ready") {
    throw new Error(`Application revision remained ${ready.reason}.`);
  }
  const activation = makeApplicationActivationRepository({
    deploymentId,
    readiness,
    authority: authorityPorts,
  });
  await runSystemTestEffectV1(activation.activate({
    revisionId: publication.revisionId,
    expectedActiveHead: null,
  }));
  const active = await runSystemTestEffectV1(activation.readActive());
  const keyPair = await globalThis.crypto.subtle.generateKey(
    "Ed25519",
    false,
    ["sign", "verify"],
  );
  if (!("privateKey" in keyPair) || !("publicKey" in keyPair)) {
    throw new Error("Application grant key generation failed.");
  }
  const now = Date.now();
  const applicationVerifier = createApplicationMutationGrantVerifierNamespaceV1({
    deploymentId,
    grantRetentionPolicy: C07_TEST_GRANT_RETENTION_POLICY_V1,
    trustedNowEpochMilliseconds: Effect.succeed(now),
    keys: [{
      kid: TransactionGrantKeyIdV1Schema.make("application-key-1"),
      purpose: APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
      state: "active",
      issuedAtInclusiveEpochMilliseconds: now - 60_000,
      publicKey: keyPair.publicKey,
    }],
  });
  const tableId = decodeCatalogTableId(1);
  const rowId = decodeAppRowIdHexV1("11".repeat(16));
  return Object.freeze({
    persistence,
    controlDb,
    deploymentId,
    scopeId,
    schemaVersionId,
    active,
    activation,
    schema,
    authorityPorts,
    keyPair,
    applicationVerifier,
    pointCommit,
    documentId: appDocumentIdV1FromRowIdentity({ tableId, rowId }),
    source: analyzedFixture.source,
    now,
  });
}

async function applicationActivationInput(
  fixture: Awaited<ReturnType<typeof prepareApplicationFixture>>,
  role: "primary" | "competing",
) {
  const fn = fixture.active.basis.manifest.functions[0];
  if (fn === undefined || fn.kind !== "mutation") {
    throw new Error("Application mutation function is missing.");
  }
  const stored = await fixture.persistence.query<{ entry_sha256: Uint8Array }>(
    `select entry_sha256
       from fx_system_application_function_v1
      where scope_id = $1 and revision_id = $2 and function_path = $3`,
    [fixture.scopeId, fixture.active.basis.revisionId, fn.path],
  );
  const entrySha256 = stored.rows[0]?.entry_sha256;
  if (entrySha256 === undefined) throw new Error("Function entry is missing.");
  const target = Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1({
    format: "flarex.application-runtime-target",
    version: 1,
    scopeId: fixture.scopeId,
    revisionId: fixture.active.basis.revisionId,
    candidateId: fixture.active.basis.candidateId,
    analysisId: fixture.active.basis.analysisId,
    sourceArtifactRootSha256: hex(
      fixture.active.basis.sourceArtifactRootSha256,
    ),
    manifestSha256: hex(fixture.active.basis.manifestSha256),
    schemaSha256: hex(fixture.active.basis.applicationSchemaSha256),
    functionCatalogSha256: hex(
      fixture.active.basis.functionCatalogSha256,
    ),
    publicationSha256: hex(fixture.active.basis.publicationSha256),
    executionModulePath:
      fixture.active.basis.manifest.sourceArtifact.executionModulePath,
    function: { ...fn, entrySha256: hex(entrySha256) },
  }));
  const authority = await runSystemTestEffectV1(
    canonicalizeApplicationMutationExecutionAuthorityV1({
      format: "flarex.application-mutation-execution-authority",
      version: 1,
      runtimeTarget: target.target,
      runtimeTargetSha256: await sha256Hex(target.canonicalBytes),
      activationSequence: fixture.active.basis.activationSequence.toString(),
      activeHeadSha256: hex(fixture.active.basis.headSha256),
      schemaVersionId: fixture.schemaVersionId,
    }),
  );
  const policyVersion = TransactionPolicyVersionV1Schema.make(
    TRANSACTION_GRANT_POINT_MUTATION_POLICY_VERSION_V1,
  );
  const policy = await canonicalizeTransactionGrantIdentityAccessPolicyV1({
    policyVersion,
    auth: { kind: "anonymous" },
    capabilities: TRANSACTION_GRANT_POINT_MUTATION_CAPABILITIES_V1,
  });
  const validatedArgsJson = Object.freeze({ role });
  const canonicalArgs = await canonicalizeFlarexValueJsonV1(validatedArgsJson);
  const requestKey = TransactionRequestKeyV1Schema.make(
    `request:application:${role}`,
  );
  const canonicalRequest = await canonicalizePointMutationRequestV1({
    deploymentId: fixture.deploymentId,
    functionPath: TransactionFunctionPathV1Schema.make(fn.path),
    validatedArgsSha256: TransactionArgumentsSha256V1Schema.make(
      canonicalArgs.sha256,
    ),
    requestKey,
  });
  const requestSha256 = TransactionRequestSha256V1Schema.make(
    canonicalRequest.sha256,
  );
  const segments = await runSystemTestEffectV1(
    prepareApplicationMutationGrantV1({
      kid: TransactionGrantKeyIdV1Schema.make("application-key-1"),
      grantId: TransactionAuthorizationGrantIdV1Schema.make(
        `grant_application_${role}`,
      ),
      deploymentId: fixture.deploymentId,
      executionAuthority: authority,
      policyVersion,
      identityAccessPolicy: policy,
      validatedArgsValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      validatedArgsSha256: hex(canonicalArgs.sha256),
      requestKey,
      requestSha256: hex(requestSha256),
      issuedAt: TransactionGrantTimestampV1Schema.make(
        new Date(fixture.now - 30_000).toISOString(),
      ),
      expiresAt: TransactionGrantTimestampV1Schema.make(
        new Date(fixture.now + 300_000).toISOString(),
      ),
      authorizationRevocationEpoch:
        TransactionAuthorizationRevocationEpochSchema.make(0n),
    }),
  );
  const wire = assembleApplicationMutationGrantJwsV1(
    segments,
    new Uint8Array(await globalThis.crypto.subtle.sign(
      "Ed25519",
      fixture.keyPair.privateKey,
      copyBytesToArrayBuffer(segments.signingInput),
    )),
  );
  const verifiedGrant = await runSystemTestEffectV1(
    verifyApplicationMutationGrantV1(wire, fixture.applicationVerifier),
  );
  return Object.freeze({
    deploymentId: fixture.deploymentId,
    scopeId: fixture.scopeId,
    activeSelection: fixture.active.selection,
    evidence: Object.freeze({
      executionAuthority: authority.authority,
      verifiedGrant,
      functionPath: TransactionFunctionPathV1Schema.make(fn.path),
      functionKind: TransactionFunctionKindV1Schema.make("mutation"),
      schemaVersionId: fixture.schemaVersionId,
      policyVersion,
      identityAccessPolicySha256:
        TransactionIdentityAccessPolicySha256V1Schema.make(
          hexBytes(policy.sha256Hex),
        ),
      validatedArgsJson,
      validatedArgsValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
      validatedArgsCanonicalBytes:
        CanonicalTransactionArgumentsBytesV1Schema.make(
          canonicalArgs.canonicalBytes,
        ),
      validatedArgsSha256: TransactionArgumentsSha256V1Schema.make(
        canonicalArgs.sha256,
      ),
      requestKey,
      requestSha256,
    }),
  });
}

function createExecution(
  fixture: Awaited<ReturnType<typeof prepareApplicationFixture>>,
  ports: PointMutationSessionAuthorityResolutionPortsV1,
  claims: ReturnType<typeof createPointMutationExecutionClaimVaultV1>,
  store: ReturnType<typeof createSessionJournalStorePersistenceV1>,
  applicationVerifier: ReturnType<
    typeof createApplicationMutationGrantVerifierNamespaceV1
  >,
  runner: PointMutationOccRuntimeNeutralRunnerV1,
) {
  const legacyVerifier = makeLegacyGrantVerifier(fixture);
  const loading = createPointMutationSessionAttemptLoadingV1(
    createPointMutationSessionAttemptLoadPersistenceV1(ports),
  );
  const terminalization = createPointMutationSessionAttemptTerminalizationV1(
    createPointMutationSessionAttemptTerminalizationPersistenceV1(ports),
    claims.admission,
  );
  let executionSequence = 0;
  return createPrivatePointMutationInitialExecutionV1(
    ports,
    claims,
    createStoredAttemptEvidenceLoaderV1(ports),
    loading,
    store,
    legacyVerifier,
    Object.freeze({
      deploymentId: fixture.deploymentId,
      scopeId: fixture.scopeId,
      packageId: "application-does-not-use-legacy-package",
      artifactRuntime: "application",
      artifactId: "application-does-not-use-legacy-artifact",
      sourcePackageHash: "0".repeat(64),
      executionModule: "_flarex/application.js",
      functionPath: TransactionFunctionPathV1Schema.make("recipes:save"),
      functionKind: "mutation",
      schemaVersionId: fixture.schemaVersionId,
      functionMetadata: PointMutationTargetFunctionMetadataV1Schema.make({
        path: TransactionFunctionPathV1Schema.make("recipes:save"),
        executionModule: TransactionExecutionModuleV1Schema.make(
          "_flarex/application.js",
        ),
        kind: "mutation",
        visibility: "public",
        argsValidator: { type: "any" },
        returnsValidator: { type: "any" },
      }),
    }),
    runner,
    createIntrinsicCreationTimeIndexDefinitionPortV1(
      fixture.controlDb,
    ),
    applicationVerifier,
    fixture.pointCommit,
  );
}

function makeLegacyGrantVerifier(
  fixture: Awaited<ReturnType<typeof prepareApplicationFixture>>,
) {
  return createTransactionGrantVerifierV1({
    clock: { now: () => new Date() },
    verificationKeyNamespace:
      createTransactionGrantVerificationKeyNamespaceV1({
        deploymentId: fixture.deploymentId,
        keys: [{
          state: "active",
          kid: TransactionGrantKeyIdV1Schema.make("legacy-placeholder-key"),
          purpose: TRANSACTION_GRANT_KEY_PURPOSE_V1,
          issuedAtInclusiveEpochMilliseconds: fixture.now - 60_000,
          verificationEndsAtExclusiveEpochMilliseconds:
            fixture.now + 600_000,
          verify: async () => true,
        }],
      }),
    grantRetentionPolicy: C07_TEST_GRANT_RETENTION_POLICY_V1,
  });
}

function isTaggedError(value: unknown, tag: string): boolean {
  return typeof value === "object" && value !== null &&
    Reflect.get(value, "_tag") === tag;
}

async function makeRunner(
  source: Awaited<ReturnType<typeof prepareApplicationFixture>>["source"],
  runTransaction: ApplicationExecutionHost["runTransaction"],
): Promise<PointMutationOccRuntimeNeutralRunnerV1> {
  return runSystemTestEffectV1(
    makeApplicationMutationRuntimeNeutralRunner({
      legacy: Object.freeze({ run: () => Effect.die(
        new Error("Application proof entered the legacy runner."),
      ) }),
      source,
      host: Object.freeze({ runTransaction }),
    }),
  );
}

function applicationCapability(
  input: Parameters<ApplicationExecutionHost["runTransaction"]>[0],
) {
  return input.capability as {
    readonly readPointDocument: (
      tableName: unknown,
      documentId: unknown,
    ) => Promise<unknown>;
    readonly patchPointDocument: (
      documentId: unknown,
      value: unknown,
    ) => Promise<void>;
  };
}

function resolutionPorts(
  lane: ApplicationMutationStoredAttemptLane,
): PointMutationSessionAuthorityResolutionPortsV1 {
  const { persistence } = lane;
  return Object.freeze({
    scopeMetadata: persistence,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: async () => null,
    },
    scopeSessionTargets: {
      resolve: async () => lane.makeSessionTarget(),
    },
  });
}

async function seedBaselineRow(
  persistence: FlarexPersistence,
  controlDb: FlarexMetadataDatabase,
  scopeId: ReturnType<typeof decodeReplacementScopeIdV1>,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const tableId = decodeCatalogTableId(1);
  const rowId = decodeAppRowIdHexV1("11".repeat(16));
  const creationTime = decodeAppCreationTimeV1(1);
  const document = await canonicalizeAppDocumentV1({
    tableId,
    rowId,
    creationTime,
    fields: { name: "seed" },
  });
  const clock = await persistence.getScopeClock(scopeId);
  if (clock === null) throw new Error("Seed scope clock is missing.");
  const commitSeq = CommitSeqSchema.make(1n);
  await controlDb.transaction(async tx => {
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live",
      scopeId,
      tableId,
      rowId,
      writeEpoch: clock.epoch,
      commitSeq,
      prevCommitSeq: null,
      schemaVersionId,
      creationTime,
      value: {
        codecVersion: document.codecVersion,
        valueJson: document.valueJson,
        canonicalBytes: document.canonicalBytes,
        sha256: document.sha256,
      },
    });
    await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: commitSeq }).where(
      eq(fxSystemScopeClocks.scopeId, scopeId),
    );
  });
}

async function settleCandidate(
  port: ReturnType<typeof createAppSchemaCandidateValidationPort>,
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const input = { deploymentId, schemaVersionId } as const;
  await runSystemTestEffectV1(
    installAppSchemaCandidateValidationEffect(port, input),
  );
  for (let step = 0; step < 64; step += 1) {
    const result = await runSystemTestEffectV1(
      advanceAppSchemaCandidateValidationEffect(port, input),
    );
    if (result.disposition !== "readyToSettle") continue;
    await runSystemTestEffectV1(
      settleAppSchemaCandidateValidationEffect(port, input),
    );
    return;
  }
  throw new Error("Application candidate validation did not settle.");
}

async function enableBuilds(
  controlDb: FlarexMetadataDatabase,
  authority: Parameters<
    typeof reconcilePublishedIndexBuildsV1Effect
  >[0]["authority"] & Parameters<
    typeof buildIntrinsicCreationTimeIndexV1Effect
  >[0]["authority"],
  deploymentId: string,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const reconciliationPorts: Parameters<
    typeof reconcilePublishedIndexBuildsV1Effect
  >[0] = { controlDb, authority };
  const buildPorts: Parameters<
    typeof buildIntrinsicCreationTimeIndexV1Effect
  >[0] = { controlDb, authority };
  const reconciliation = await runSystemTestEffectV1(
    reconcilePublishedIndexBuildsV1Effect(reconciliationPorts, {
      deploymentId,
      schemaVersionId,
    }),
  );
  if (reconciliation.status !== "reconciled") {
    throw new Error(`Index reconciliation was ${reconciliation.reason}.`);
  }
  for (const definitionId of reconciliation.definitionIds) {
    const definition = await runSystemTestEffectV1(
      locateAppIndexDefinitionByIdEffect(
        controlDb,
        reconciliation.scopeId,
        definitionId,
      ),
    );
    if (definition?.access.kind !== "by_creation_time") continue;
    for (let step = 0; step < 32; step += 1) {
      const result = await runSystemTestEffectV1(
        buildIntrinsicCreationTimeIndexV1Effect(buildPorts, {
          deploymentId,
          indexDefinitionId: definitionId,
          pageSize: 8,
        }),
      );
      if (result.lifecycle === "enabled") break;
      if (step === 31) throw new Error("Intrinsic index did not enable.");
    }
  }
}

function definitionInput() {
  return {
    programBudgetInput: {
      maximumModules: 1,
      maximumFunctions: 1,
      maximumIdentifierUtf8Bytes: 1_024,
      maximumValidatorNodes: 64,
      maximumValidatorDepth: 8,
      maximumValidatorStringUtf8Bytes: 1_024,
    },
    programInput: {
      format: "flarex.declarative-program/v1",
      version: 1,
      schema: {
        tables: [{
          logicalName: "recipes",
          definition: {
            kind: "appDocument",
            definitionVersion: 1,
            documentType: {
              type: "object",
              value: {
                name: {
                  fieldType: { type: "string" },
                  optional: false,
                },
              },
            },
          },
        }],
        indexes: [],
      },
      modules: [{
        modulePath: "recipes",
        functions: [{
          exportName: "save",
          kind: "mutation",
          visibility: "public",
          argsValidator: { type: "any" },
          returnsValidator: { type: "any" },
        }],
      }],
    },
    materializationBudgetInput: {
      maximumModules: 2,
      maximumEntryBindings: 1,
      maximumSourceBytes: 4_096,
      maximumSourceMapBytes: 0,
      maximumBytesMaterialized: 16_384,
      maximumSemanticRecords: 16,
      maximumSemanticRecordBytes: 4_096,
      maximumSemanticStreamBytes: 16_384,
    },
    graphInput: {
      modules: [{
        path: "recipes.js",
        roles: ["function", "execution"],
        sourceBytes: new TextEncoder().encode(SOURCE),
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: "recipes",
        artifactModulePath: "recipes.js",
      }],
      executionPath: "recipes.js",
      schemaPath: null,
      authPath: null,
    },
  } as const;
}

function uuidSequence(...values: ReadonlyArray<number>): () => string {
  let index = 0;
  return () => {
    const value = values[index] ?? values[values.length - 1];
    if (value === undefined) throw new Error("UUID sequence is empty.");
    index += 1;
    return `30000000-0000-4000-8000-${value.toString().padStart(12, "0")}`;
  };
}

function requireLiteral<const Expected extends number>(
  actual: number,
  expected: Expected,
): Expected {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, observed ${actual}.`);
  }
  return expected;
}

function requireStringLiteral<const Expected extends string>(
  actual: string,
  expected: Expected,
): Expected {
  if (actual !== expected) {
    throw new Error(`Expected ${expected}, observed ${actual}.`);
  }
  return expected;
}

function requireGenerations(
  rows: ReadonlyArray<{ readonly generation: string }>,
): readonly ["application_v1", "application_v1"] {
  if (
    rows.length !== 2 ||
    rows[0]?.generation !== "application_v1" ||
    rows[1]?.generation !== "application_v1"
  ) throw new Error("Application session generation was not retained.");
  return ["application_v1", "application_v1"];
}

function fail(message: string): never {
  throw new Error(message);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return hex(new Uint8Array(await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer,
  )));
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function hexBytes(value: string): Uint8Array {
  return Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  );
}
