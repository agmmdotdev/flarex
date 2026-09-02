import { webcrypto } from "node:crypto";
import { eq } from "drizzle-orm";

import {
  decodeApplicationTaskRunCreationRequestV1,
  makeTaskExecutionPrincipalReferenceV1,
  makeTaskInputReferenceV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  makeTaskRunQueryLayer,
  TaskRunQuery,
} from "@flarex/durable-task/internal/run-projection";
import {
  makeTaskRunResultQueryLayer,
  TaskRunResultQuery,
} from "@flarex/durable-task/internal/run-result-query";
import {
  decideApplicationStartAttemptV1,
  decideApplicationRequestCancellationV1,
  decodeApplicationPersistedTaskRequestedEffectJsonV1,
  decodeTaskDurationMsV1,
  decodeTaskRequestedEffectSequenceV1,
  decodeTaskRetryJitterV1,
  decodeTaskRunVersionV1,
  encodeApplicationPersistedTaskRequestedEffectJsonV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import {
  TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
  validateTaskComputeDispatchAcceptanceV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  hashCanonicalTaskCatalogV1,
  makeStandardApplicationTaskSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { copyBytesToArrayBuffer } from "@flarex/utils/bytes";
import { makeGrantRetentionPolicyV1Result } from
  "flarex-protocol/grant-retention-policy";
import {
  decodeApplicationTaskRunCreationAuthorityPreimageV1,
  encodeApplicationTaskRunCreationAuthorityPreimageV1,
  produceApplicationTaskBindingsV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import { prepareStandardApplicationDefinitionV1 } from
  "@flarex/standard-application-definition/internal/prepared-definition-v1";
import { Effect, Encoding, Exit, Result, Scope } from "effect";
import {
  APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
  assembleApplicationMutationGrantJwsV1,
  createApplicationMutationGrantVerifierNamespaceV1,
  prepareApplicationMutationGrantV1,
  verifyApplicationMutationGrantV1,
} from "flarex-protocol/internal/application-mutation-grant-v1";
import {
  canonicalizeApplicationMutationExecutionAuthorityV1,
} from "flarex-protocol/internal/application-mutation-authority-v1";
import {
  canonicalizeApplicationActionExecutionAuthorityV1,
} from "flarex-protocol/internal/application-action-authority-v1";
import {
  canonicalizeApplicationRuntimeColdReceiptV1,
} from "flarex-protocol/internal/application-runtime-cold-receipt-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
  type CanonicalApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import {
  encodeApplicationActionInvocationRequestV2,
  makeExecutionEvidenceBodyReferenceV1,
} from "flarex-protocol/internal/execution-evidence-v1";
import {
  decodeAppDocumentIdV1,
  decodeAppRowIdHexV1,
} from "flarex-protocol/app-document-id";
import {
  canonicalizeAppDocumentV1,
  decodeAppCreationTimeV1,
} from "flarex-protocol/app-document";
import {
  CommitSeqSchema,
  decodeReplacementScopeIdV1,
  projectScopeIdUuidV1,
} from "flarex-protocol/storage-authority";
import {
  TransactionGrantDeploymentIdV1Schema,
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
  TransactionIdentityAccessPolicySha256V1Schema,
  TransactionPolicyVersionV1Schema,
  TransactionRequestKeyV1Schema,
  TransactionRequestSha256V1Schema,
} from "flarex-protocol/transaction-session";
import {
  canonicalizeFlarexValueJsonV1,
  FLAREX_VALUE_CODEC_VERSION_V1,
} from "flarex-protocol/value";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import type { CatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";
import {
  decodeCatalogEdgeDefinitionId,
  decodeCatalogTableId,
} from "flarex-protocol/catalog";
import { beforeAll, describe, expect, it } from "vitest";

import {
  advanceAppSchemaCandidateValidationEffect,
  createAppSchemaCandidateReadinessPort,
  createAppSchemaCandidateValidationPort,
  createLocatedAppSchemaCandidateValidationTarget,
  installAppSchemaCandidateValidationEffect,
  settleAppSchemaCandidateValidationEffect,
} from "../src/appSchemaCandidateValidation";
import {
  createAppUniqueConstraintDefinitionPortV1,
} from "../src/appUniqueConstraintCommitV1";
import {
  createAppUniqueConstraintSetEligibilityPortV1,
} from "../src/appUniqueConstraintSetBuildV1";
import {
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
} from "../src/appUniqueConstraintSetClosureV1";
import {
  makeApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
} from "../src/applicationAnalysisRegistration";
import {
  isRetryableApplicationMutationAdmissionCause,
  selectApplicationMutationAdmission,
} from "../src/applicationMutationAdmission";
import { selectApplicationActionAdmission } from
  "../src/applicationActionAdmission";
import {
  admitApplicationAuthorityActionInvocation,
  claimDirectActionExecutionV1,
  claimApplicationAuthorityActionExecution,
  confirmExternalEffectAttemptV1,
  createLocatedApplicationActionAuthorityTargetV1,
  declareExternalEffectDispatchV1,
  inspectApplicationAuthorityActionInvocation,
  prepareExternalEffectAttemptV1,
  recoverExpiredApplicationAuthorityActionExecution,
  requestApplicationAuthorityActionCancellation,
  settleApplicationAuthorityActionInvocation,
} from "../src/applicationActionAuthorityV1";
import { makeApplicationPublicationRepository } from
  "../src/applicationPublication";
import {
  makeApplicationReadinessRepository,
  validateApplicationReadinessForActivationInTransaction,
  validateStoredApplicationReadinessForActivationInTransaction,
} from "../src/applicationReadiness";
import { ApplicationActiveHeadStateError } from
  "../src/applicationActiveHeadRead";
import {
  createApplicationRelationServingInspector,
  inspectApplicationRelationServingDefinitionInTransactionEffect,
} from "../src/applicationRelationServing";
import {
  claimApplicationActiveSelection,
  makeApplicationActivationRepository,
  validateApplicationActiveSelectionInTransaction,
  type CoherentActiveApplication,
} from "../src/applicationActivation";
import {
  finalizeApplicationQueryEvaluationSnapshot,
  openApplicationQuerySnapshot as openApplicationQuerySnapshotEffect,
  readApplicationQueryIndex,
  readApplicationQueryPoint,
  revalidateApplicationQuerySnapshot,
} from "../src/applicationQuerySnapshot";
import { ScopeExecutionLive } from
  "../src/scopeExecution/ScopeExecution";
import { makeApplicationSchemaAuthorityPublisher } from
  "../src/applicationSchemaAuthority";
import {
  createApplicationTaskCatalogSnapshotPort,
  makeApplicationTaskBindingRepository,
} from "../src/applicationTaskBindings";
import {
  claimApplicationTaskSelection,
  selectApplicationTask,
  validateApplicationTaskSelection,
} from "../src/applicationTaskSelection";
import { makeApplicationTaskSystemRunCreationStore } from
  "../src/applicationTaskSystemRunCreation";
import {
  createLocatedTaskComputeDeliveryTargetV1,
  makeTaskComputeDeliveryRepositoryV1,
} from "../src/taskComputeDeliveryRepositoryV1";
import {
  makeTaskComputeDeliveryCandidateDiscovery,
} from "../src/taskComputeDeliveryDiscovery";
import { decodeCurrentTaskComputePreparedExecutionV1 } from
  "../src/taskComputeDeliveryEvidenceV1";
import {
  createLocatedTaskSystemRunAttemptTargetV1,
  makeApplicationTaskSystemRunAttemptStoreV1,
} from
  "../src/taskSystemRunAttemptStoreV1";
import {
  createPGliteLocatedSplitScopeClockTarget,
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
  createPGliteSplitScopeAuthorityProvisioner,
} from "../src/pglite";
import {
  createApplicationMutationSessionActivationPersistenceV1,
} from "../src/transactionSessionActivation";
import { createStoredOccExecutionEvidenceLoaderV1 } from
  "../src/storedOccExecution";
import {
  LocatedReadCommittedTransactionFailureV1,
  RUN_LOCATED_READ_COMMITTED_V1,
  type RunLocatedReadCommittedTransactionV1,
} from "../src/transactionSessionAttemptKernel";
import type { AppRowTransaction } from "../src/appRows";
import {
  locateAppIndexDefinitionByIdEffect,
} from "../src/appIndexDefinitions";
import {
  appendAppRowRevisionAndAdvanceCurrentInTransaction,
} from "../src/appRows";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  reconcilePublishedIndexBuildsV1Effect,
} from "../src/indexBuildReconciliation";
import {
  buildAppDeveloperOrderedIndexV1Effect,
  buildIntrinsicCreationTimeIndexV1Effect,
} from "../src/intrinsicCreationTimeIndexBuildV1";
import { createPointCommitPublisherPortV1 } from
  "../src/pointCommitTransaction";
import {
  beginPhysicalDefinitionDrainingEffect,
  cancelPhysicalDefinitionDrainingEffect,
  createPhysicalDefinitionLifecyclePort,
  preparePhysicalDefinitionLifecycleSubjectEffect,
} from "../src/physicalDefinitionLifecycle";
import { createAppDeveloperIndexDefinitionPortV1 } from
  "../src/appDeveloperIndexCommitV1";
import { fxSystemApplicationActiveHeads } from
  "../src/applicationActivationSchema";
import { getScopeAuthorityProvisioningReceipt } from
  "../src/scopeAuthorityProvisioningReceipt";
import { runEffect, runEffectFailure } from "./effectTestRuntime";
import type { SplitScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import {
  lockScopeClockForShareInTransactionEffect,
  lockScopeClockForUpdateInTransactionEffect,
} from "../src/scopeClock";
import {
  fxSystemIndexBuildStates,
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationReadinessFunctionsV1,
  fxSystemApplicationReadinessV1,
  fxSystemApplicationActionInvocationsV1,
  fxSystemScopeClocks,
} from "../src/schema";

const openApplicationQuerySnapshot = (
  ...args: Parameters<typeof openApplicationQuerySnapshotEffect>
) => openApplicationQuerySnapshotEffect(...args).pipe(
  Effect.provide(ScopeExecutionLive),
);

const ROOT = "a".repeat(64);
const EXECUTION_SOURCE = "b".repeat(64);
const SCHEMA_SOURCE = "c".repeat(64);
const RUNTIME_HOST_IDENTITY = "flarex.test/application-runtime-host";
const COMPATIBILITY_DATE = "2026-08-12";
const LOCATOR = Object.freeze({
  kind: "database_per_scope",
  databaseKey: "application_readiness_target",
  schemaName: "public",
}) satisfies SplitScopePhysicalLocator;
const taskSha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);
const APPLICATION_TASK_DISCOVERY_DEADLINE_POLICY = Object.freeze({
  connectionTimeoutMilliseconds: 1_000,
  lockTimeoutMilliseconds: 250,
  statementTimeoutMilliseconds: 10_000,
  transactionTimeoutMilliseconds: 20_000,
  settlementReserveMilliseconds: 30_000,
});

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describe("Application readiness", { timeout: 30_000 }, () => {
  it("classifies only transient PostgreSQL admission failures as retryable", () => {
    expect(isRetryableApplicationMutationAdmissionCause({ code: "40001" }))
      .toBe(true);
    expect(isRetryableApplicationMutationAdmissionCause({ code: "42P01" }))
      .toBe(false);
  });

  it("labels read-only readiness input failures with the read operation", async () => {
    const fixture = await readinessFixture();

    const result = await runEffect(Effect.result(fixture.repository.readReady({
      deploymentId: "",
      revisionId: fixture.input.revisionId,
    })));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "ApplicationReadinessError",
        operation: "readReady",
        reason: "invalidInput",
      });
    }
  });

  it("fails before schema publication when the explicit task catalog is absent", async () => {
    const fixture = await readinessFixture({ registerTaskCatalog: false });

    const result = await runEffect(fixture.repository.settle(fixture.input));

    expect(result).toMatchObject({
      status: "not_ready",
      reason: "taskCatalogMissing",
      revisionId: fixture.input.revisionId,
    });
    expect(await scalarCount(
      fixture.control,
      "fx_control_application_schema_authority_v1",
    )).toBe(0);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_v1",
    )).toBe(0);
  });

  it("rejects a schema publisher bound to another control database", async () => {
    const fixture = await readinessFixture({ foreignSchemaControl: true });

    const result = await runEffect(Effect.result(
      fixture.repository.settle(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "invalidComposition" });
    }
    expect(await scalarCount(
      fixture.control,
      "fx_control_application_schema_authority_v1",
    )).toBe(0);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_v1",
    )).toBe(0);
  });

  it("rejects a structurally copied physical lifecycle capability", async () => {
    const fixture = await readinessFixture();
    const repository = makeApplicationReadinessRepository(Object.freeze({
      ...fixture.readinessContext,
      physicalDefinitionLifecycle: Object.freeze({
        ...fixture.physicalDefinitionLifecycle,
      }),
    }));

    const result = await runEffect(Effect.result(
      repository.settle(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "invalidComposition" });
    }
    expect(await scalarCount(
      fixture.control,
      "fx_control_application_schema_authority_v1",
    )).toBe(0);
  });

  it("rolls back schema authority when atomic publication fails", async () => {
    const fixture = await readinessFixture({ failSchemaPublication: true });

    const result = await runEffect(Effect.result(
      fixture.repository.settle(fixture.input),
    ));
    const authorities = await fixture.control.query<{ status: string }>(
      `select status from fx_control_application_schema_authority_v1`,
    );

    expect(Result.isFailure(result)).toBe(true);
    expect(authorities.rows).toEqual([]);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_v1",
    )).toBe(0);
  });

  it("settles and exactly replays across split control and target stores", async () => {
    const fixture = await readinessFixture();
    const schemaVersionId = await prepareReadinessAuthorities(fixture);

    const first = await runEffect(fixture.repository.settle(fixture.input));
    const replay = await runEffect(fixture.repository.settle(fixture.input));

    expect(first).toMatchObject({
      status: "ready",
      disposition: "inserted",
      scopeId: fixture.authority.scopeId,
      revisionId: fixture.input.revisionId,
      schemaVersionId,
    });
    expect(replay).toMatchObject({
      ...first,
      disposition: "replayed",
    });
    expect(fixture.materializationCount()).toBe(1);
    expect(await scalarCount(
      fixture.control,
      "fx_control_application_schema_authority_v1",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_revision_schema_v1",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_v1",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_function_v1",
    )).toBe(1);
  });

  it("converges concurrent identical settlement on one readiness receipt", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);

    const results = await Promise.all([
      runEffect(fixture.repository.settle(fixture.input)),
      runEffect(fixture.repository.settle(fixture.input)),
    ]);

    expect(results.map(result =>
      result.status === "ready" ? result.disposition : result.status
    ).sort()).toEqual(["inserted", "replayed"]);
    expect(await scalarCount(
      fixture.control,
      "fx_control_application_schema_authority_v1",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_v1",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_function_v1",
    )).toBe(1);
  });

  it("rejects invalid cold evidence without committing readiness", async () => {
    const fixture = await readinessFixture({ coldMode: "wrongTarget" });
    await prepareReadinessAuthorities(fixture);

    const result = await runEffect(Effect.result(
      fixture.repository.settle(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "coldMaterialization" });
    }
    expect(fixture.materializationCount()).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_revision_schema_v1",
    )).toBe(0);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_v1",
    )).toBe(0);
  });

  it("fails closed on stored cold-receipt corruption without rematerializing", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    await runEffect(fixture.repository.settle(fixture.input));
    await fixture.target.query(
      `update fx_system_application_readiness_function_v1
          set cold_receipt_bytes = $1
        where scope_id = $2 and revision_id = $3`,
      [new Uint8Array([1]), fixture.authority.scopeId, fixture.input.revisionId],
    );

    const replay = await runEffect(Effect.result(
      fixture.repository.settle(fixture.input),
    ));

    expect(Result.isFailure(replay)).toBe(true);
    if (Result.isFailure(replay)) {
      expect(replay.failure).toMatchObject({ reason: "conflictingReplay" });
    }
    expect(fixture.materializationCount()).toBe(1);
  });

  it("rejects a non-empty task catalog with a missing stored definition", async () => {
    const fixture = await readinessFixture({ includeTask: true });
    await fixture.target.query(
      `delete from fx_system_application_task_definition_v1
        where scope_id = $1 and revision_id = $2`,
      [fixture.authority.scopeId, fixture.input.revisionId],
    );

    const result = await runEffect(Effect.result(
      fixture.repository.settle(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "ApplicationTaskCatalogSnapshotError",
        reason: "storedState",
      });
    }
    expect(fixture.materializationCount()).toBe(0);
  });

  it("rejects corrupted task-catalog binding evidence", async () => {
    const fixture = await readinessFixture();
    await fixture.target.query(
      `update fx_system_application_task_catalog_v1
          set binding_bytes = $1
        where scope_id = $2 and revision_id = $3`,
      [new Uint8Array([1]), fixture.authority.scopeId, fixture.input.revisionId],
    );

    const result = await runEffect(Effect.result(
      fixture.repository.settle(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "ApplicationTaskCatalogSnapshotError",
        reason: "storedState",
      });
    }
    expect(fixture.materializationCount()).toBe(0);
  });

  it("commits runtime policy for an explicit zero-function revision", async () => {
    const fixture = await readinessFixture({ includeFunction: false });
    await prepareReadinessAuthorities(fixture);

    const result = await runEffect(fixture.repository.settle(fixture.input));
    const stored = await fixture.target.query<{
      runtime_host_identity: string;
      compatibility_date: string;
    }>(
      `select runtime_host_identity, compatibility_date
         from fx_system_application_readiness_v1`,
    );

    expect(result).toMatchObject({ status: "ready", disposition: "inserted" });
    expect(fixture.materializationCount()).toBe(0);
    expect(stored.rows).toEqual([{
      runtime_host_identity: RUNTIME_HOST_IDENTITY,
      compatibility_date: COMPATIBILITY_DATE,
    }]);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_function_v1",
    )).toBe(0);
  });

  it("requires the existing physical-build owner for a table-bearing schema", async () => {
    const fixture = await readinessFixture({ includeTable: true });
    await prepareReadinessAuthorities(fixture);

    const result = await runEffect(fixture.repository.settle(fixture.input));

    expect(result).toMatchObject({
      status: "not_ready",
      reason: "physicalBuildMissing",
    });
    expect(fixture.materializationCount()).toBe(0);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_v1",
    )).toBe(0);
  });

  it("settles a table-bearing schema only after the real physical build enables", async () => {
    const fixture = await readinessFixture({ includeTable: true });
    const schemaVersionId = await prepareReadinessAuthorities(fixture);
    await enablePhysicalBuilds(fixture, schemaVersionId);

    const first = await runEffect(fixture.repository.settle(fixture.input));
    const replay = await runEffect(fixture.repository.settle(fixture.input));

    expect(first).toMatchObject({
      status: "ready",
      disposition: "inserted",
      schemaVersionId,
    });
    expect(replay).toMatchObject({ ...first, disposition: "replayed" });
    expect(fixture.materializationCount()).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_v1",
    )).toBe(1);
  });

  it("closes readiness and active selection while a required definition drains", async () => {
    const fixture = await readinessFixture({ includeTable: true });
    const schemaVersionId = await prepareReadinessAuthorities(fixture);
    await enablePhysicalBuilds(fixture, schemaVersionId);
    expect(await runEffect(fixture.repository.settle(fixture.input)))
      .toMatchObject({ status: "ready", disposition: "inserted" });
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const requirements = await runEffect(
      loadPublishedPhysicalRequirementSnapshotV1(
        fixture.control.drizzle,
        Object.freeze({
          deploymentId: fixture.input.deploymentId,
          schemaVersionId,
        }),
      ),
    );
    const definition = requirements?.definitions[0];
    if (definition === undefined) {
      throw new Error("Expected one required physical definition.");
    }
    const subject = await runEffect(
      preparePhysicalDefinitionLifecycleSubjectEffect(
        fixture.physicalDefinitionLifecycle,
        Object.freeze({
          definitionKind: "index",
          deploymentId: fixture.input.deploymentId,
          indexDefinitionId: definition.indexDefinitionId,
        }),
      ),
    );
    const draining = await runEffect(beginPhysicalDefinitionDrainingEffect(
      subject,
      Object.freeze({ expectedTransitionFence: 0n }),
    ));
    expect(draining.lifecycle).toMatchObject({
      lifecycle: "draining",
      transitionFence: 1n,
    });
    expect(await runEffect(fixture.repository.settle(fixture.input)))
      .toMatchObject({
        status: "not_ready",
        reason: "physicalDefinitionNotActive",
        detail: `index:${definition.indexDefinitionId}:draining`,
      });
    expect(await runEffect(fixture.repository.readReady(fixture.input)))
      .toMatchObject({
        status: "not_ready",
        reason: "physicalDefinitionNotActive",
      });
    await expect(runEffect(activation.readActive())).rejects.toMatchObject({
      operation: "read",
      reason: "notReady",
    });

    await runEffect(cancelPhysicalDefinitionDrainingEffect(
      subject,
      Object.freeze({ expectedTransitionFence: 1n }),
    ));
    expect(await runEffect(fixture.repository.settle(fixture.input)))
      .toMatchObject({ status: "ready", disposition: "replayed" });
    await expect(runEffect(activation.readActive())).resolves.toMatchObject({
      basis: { revisionId: fixture.input.revisionId },
    });
  });

  it("fails closed when enabled physical evidence starts after the scope frontier", async () => {
    const fixture = await readinessFixture({ includeTable: true });
    const schemaVersionId = await prepareReadinessAuthorities(fixture);
    await enablePhysicalBuilds(fixture, schemaVersionId);
    const clock = await fixture.target.getScopeClock(fixture.authority.scopeId);
    if (clock === null) throw new Error("Expected Application readiness clock.");
    await fixture.target.query(
      `update fx_system_index_build_state
          set start_commit_seq = $1
        where scope_id = $2`,
      [clock.lastCommitSeq + 1n, fixture.authority.scopeId],
    );

    const result = await runEffect(Effect.result(
      fixture.repository.settle(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "storedState" });
    }
    expect(fixture.materializationCount()).toBe(0);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_v1",
    )).toBe(0);
  });

  it("rejects a scope-fence change during cold proof without committing", async () => {
    const fixture = await readinessFixture({ coldMode: "advanceAuthority" });
    await prepareReadinessAuthorities(fixture);

    const result = await runEffect(Effect.result(
      fixture.repository.settle(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "authorityChanged" });
    }
    expect(fixture.materializationCount()).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_readiness_v1",
    )).toBe(0);
  });
});

describe("Application activation", { timeout: 30_000 }, () => {
  it("fails closed when durable readiness disappears before an active read", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const ready = await runEffect(fixture.repository.settle(fixture.input));
    expect(ready).toMatchObject({ status: "ready" });
    await fixture.target.drizzle.delete(
      fxSystemApplicationReadinessFunctionsV1,
    ).where(eq(
      fxSystemApplicationReadinessFunctionsV1.scopeId,
      fixture.authority.scopeId,
    ));
    await fixture.target.drizzle.delete(fxSystemApplicationReadinessV1).where(
      eq(fxSystemApplicationReadinessV1.scopeId, fixture.authority.scopeId),
    );

    const result = await runEffect(Effect.result(
      fixture.repository.readReady(fixture.input),
    ));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        operation: "readReady",
        reason: "storedState",
      });
    }
  });

  it("revalidates the stored application graph inside the activation transaction", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const settled = await runEffect(fixture.repository.settle(fixture.input));
    expect(settled).toMatchObject({ status: "ready" });
    const issued = await runEffect(fixture.repository.readReady(fixture.input));
    expect(issued).toMatchObject({ status: "ready" });
    const activationBypass = await fixture.target.drizzle.transaction(tx =>
      runEffect(Effect.result(Effect.gen(function* () {
        const clock = yield* lockScopeClockForShareInTransactionEffect(
          tx,
          fixture.authority.scopeId,
        );
        return yield* validateApplicationReadinessForActivationInTransaction(
          fixture.repository,
          issued,
          tx,
          clock,
        );
      })))
    );
    expect(Result.isFailure(activationBypass)).toBe(true);
    if (Result.isFailure(activationBypass)) {
      expect(activationBypass.failure).toMatchObject({
        reason: "invalidComposition",
      });
    }
    await fixture.target.drizzle.update(fxSystemApplicationFunctionsV1).set({
      entryBytes: new Uint8Array([1]),
    }).where(eq(
      fxSystemApplicationFunctionsV1.scopeId,
      fixture.authority.scopeId,
    ));

    const result = await fixture.target.drizzle.transaction(tx => runEffect(
      Effect.result(Effect.gen(function* () {
        const clock = yield* lockScopeClockForShareInTransactionEffect(
          tx,
          fixture.authority.scopeId,
        );
        return yield* validateStoredApplicationReadinessForActivationInTransaction(
          fixture.repository,
          issued,
          tx,
          clock,
        );
      })),
    ));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "storedState" });
    }
  });

  it("activates by explicit CAS, exactly replays, and issues one authentic selection", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });

    const staleInitial = await runEffect(Effect.result(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: Object.freeze({
        activationSequence: 1n,
        headSha256: "0".repeat(64),
      }),
    })));
    expect(Result.isFailure(staleInitial)).toBe(true);
    if (Result.isFailure(staleInitial)) {
      expect(staleInitial.failure).toMatchObject({ reason: "expectedHead" });
    }

    const first = await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const replay = await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    expect(first).toMatchObject({
      status: "activated",
      disposition: "inserted",
      activationSequence: 1n,
      previousActivationSequence: null,
    });
    expect(replay).toMatchObject({
      ...first,
      disposition: "replayed",
    });
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_activation",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_active_head",
    )).toBe(1);

    const active = await runEffect(activation.readActive());
    expect(active.expectedActiveHead).toEqual(first.expectedActiveHead);
    expect(active.basis).toMatchObject({
      revisionId: fixture.input.revisionId,
      candidateId: expect.any(String),
      analysisId: expect.any(String),
      schemaVersionId: expect.stringMatching(/^application_/),
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
      activationSequence: 1n,
    });
    expect(Result.isSuccess(claimApplicationActiveSelection(
      active.selection,
    ))).toBe(true);
    expect(Result.isFailure(claimApplicationActiveSelection(
      Object.freeze({ ...active.selection }),
    ))).toBe(true);

    const validated = await fixture.target.drizzle.transaction(tx => runEffect(
      Effect.gen(function* () {
        const clock = yield* lockScopeClockForShareInTransactionEffect(
          tx,
          fixture.authority.scopeId,
        );
        return yield* validateApplicationActiveSelectionInTransaction(
          active.selection,
          tx,
          clock,
        );
      }),
    ));
    expect(validated.revisionId).toBe(fixture.input.revisionId);
  });

  it("selects one immutable Application task without creating a run and invalidates it on head movement", async () => {
    const fixture = await readinessFixture({ includeTask: true });
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    const first = await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const runCountBefore = await scalarCount(
      fixture.target,
      "fx_system_durable_task_run_v1",
    );
    const selected = await runEffect(selectApplicationTask(
      active.selection,
      "tasks.users.get",
      {
        deploymentId: fixture.input.deploymentId,
        runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
        compatibilityDate: COMPATIBILITY_DATE,
        authority: fixture.authorityPorts,
      },
    ));

    expect(selected.metadata.target).toMatchObject({
      version: 1,
      revisionId: fixture.input.revisionId,
      taskId: "tasks.users.get",
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
      handler: {
        logicalModulePath: "users",
        sourceModulePath: "users.js",
        exportName: "get",
      },
    });
    expect(Result.isSuccess(claimApplicationTaskSelection(
      selected.selection,
    ))).toBe(true);
    expect(Result.isFailure(claimApplicationTaskSelection(
      Object.freeze({ ...selected.selection }),
    ))).toBe(true);
    expect((await runEffect(validateApplicationTaskSelection(
      selected.selection,
    ))).target.taskId).toBe("tasks.users.get");
    selected.metadata.basis.taskCatalogBindingSha256.fill(0);
    selected.metadata.runtimeTargetSha256.fill(0);
    expect((await runEffect(validateApplicationTaskSelection(
      selected.selection,
    ))).target.taskId).toBe("tasks.users.get");
    expect(await scalarCount(
      fixture.target,
      "fx_system_durable_task_run_v1",
    )).toBe(runCountBefore);

    const wrongHost = await runEffect(Effect.result(selectApplicationTask(
      active.selection,
      "tasks.users.get",
      {
        deploymentId: fixture.input.deploymentId,
        runtimeHostIdentity: `${RUNTIME_HOST_IDENTITY}:wrong`,
        compatibilityDate: COMPATIBILITY_DATE,
        authority: fixture.authorityPorts,
      },
    )));
    expect(Result.isFailure(wrongHost)).toBe(true);
    if (Result.isFailure(wrongHost)) {
      expect(wrongHost.failure).toMatchObject({ reason: "runtimeHostMismatch" });
    }

    const nextRevisionId = await createAdditionalApplicationRevision(fixture);
    expect(await runEffect(fixture.repository.settle({
      deploymentId: fixture.input.deploymentId,
      revisionId: nextRevisionId,
    }))).toMatchObject({ status: "ready" });
    await runEffect(activation.activate({
      revisionId: nextRevisionId,
      expectedActiveHead: first.expectedActiveHead,
    }));
    const stale = await runEffect(Effect.result(
      validateApplicationTaskSelection(selected.selection),
    ));
    expect(Result.isFailure(stale)).toBe(true);
    if (Result.isFailure(stale)) {
      expect(stale.failure).toMatchObject({ reason: "concurrentHead" });
    }
  });

  it("creates and replays one Application task run from the authentic selection", async () => {
    const fixture = await readinessFixture({ includeTask: true });
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const selected = await runEffect(selectApplicationTask(
      active.selection,
      "tasks.users.get",
      {
        deploymentId: fixture.input.deploymentId,
        runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
        compatibilityDate: COMPATIBILITY_DATE,
        authority: fixture.authorityPorts,
      },
    ));
    const located = Object.freeze({
      authority: active.basis.authority,
      target: createLocatedTaskSystemRunAttemptTargetV1(
        fixture.target.drizzle,
        active.basis.authority.physicalLocator,
      ),
    });
    const mutableCreationOptions = {
      sha256: taskSha256,
      leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(30_000)),
      immediateRetryThresholdMs: Result.getOrThrow(decodeTaskDurationMsV1(5_000)),
      randomUuid: uuidSequence(90),
    };
    const store = makeApplicationTaskSystemRunCreationStore(
      located,
      mutableCreationOptions,
    );
    const request = Result.getOrThrow(decodeApplicationTaskRunCreationRequestV1({
      version: 1,
      requestKey: "application-task-run-1",
      applicationTaskRuntimeTargetSha256: selected.metadata.runtimeTargetSha256,
      input: Result.getOrThrow(makeTaskInputReferenceV1(
        new Uint8Array(32).fill(0x71),
        19,
      )),
      principal: Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(
        new Uint8Array(32).fill(0x73),
        23,
      )),
    }));
    const foreignLocator = Object.freeze({
      ...active.basis.authority.physicalLocator,
      databaseKey: `${active.basis.authority.physicalLocator.databaseKey}:foreign`,
    });
    const foreignStore = makeApplicationTaskSystemRunCreationStore({
      authority: Object.freeze({
        ...active.basis.authority,
        physicalLocator: foreignLocator,
      }),
      target: createLocatedTaskSystemRunAttemptTargetV1(
        fixture.target.drizzle,
        foreignLocator,
      ),
    }, {
      sha256: taskSha256,
      leaseDurationMs: Result.getOrThrow(decodeTaskDurationMsV1(30_000)),
      immediateRetryThresholdMs: Result.getOrThrow(
        decodeTaskDurationMsV1(5_000),
      ),
      randomUuid: uuidSequence(89),
    });
    const foreignResult = await runEffect(Effect.result(
      foreignStore.createRun(selected.selection, request),
    ));
    expect(Result.isFailure(foreignResult)).toBe(true);
    if (Result.isFailure(foreignResult)) {
      expect(foreignResult.failure).toMatchObject({
        operation: "create_run",
        reason: "request_authority_mismatch",
      });
    }
    expect(await scalarCount(
      fixture.target,
      "fx_system_durable_task_run_v1",
    )).toBe(0);
    const created = await runEffect(store.createRun(selected.selection, request));
    const storedPrincipal = await fixture.target.query<{
      execution_principal_generation: string;
      execution_principal_kind: string | null;
      execution_principal_codec: string | null;
      execution_principal_store: string | null;
      execution_principal_value_codec: string | null;
      execution_principal_object_key: string | null;
      execution_principal_byte_length: bigint | null;
      execution_principal_sha256: Uint8Array | null;
      execution_principal_retention: string | null;
    }>(`
      select execution_principal_generation, execution_principal_kind,
             execution_principal_codec,
             execution_principal_store, execution_principal_value_codec,
             execution_principal_object_key, execution_principal_byte_length,
             execution_principal_sha256, execution_principal_retention
        from fx_system_durable_task_run_v1
       where scope_id = $1 and run_id = $2
    `, [fixture.authority.scopeId, created.runId]);
    expect(storedPrincipal.rows).toHaveLength(1);
    expect(storedPrincipal.rows[0]).toMatchObject({
      execution_principal_generation: "present_v1",
      execution_principal_kind: request.principal.principalKind,
      execution_principal_codec: request.principal.codec,
      execution_principal_store: request.principal.store,
      execution_principal_value_codec: request.principal.valueCodec,
      execution_principal_object_key: request.principal.objectKey,
      execution_principal_byte_length: request.principal.byteLength,
      execution_principal_retention: request.principal.retention.kind,
    });
    expect(Array.from(
      storedPrincipal.rows[0]?.execution_principal_sha256 ?? [],
    )).toEqual(Array.from(request.principal.sha256));
    mutableCreationOptions.sha256 = () => Effect.succeed(
      new Uint8Array(32).fill(0xdd),
    );
    expect(await runEffect(store.createRun(selected.selection, request)))
      .toEqual(created);
    expect(await scalarCount(
      fixture.target,
      "fx_system_durable_task_run_v1",
    )).toBe(1);
    const foreignReplay = await runEffect(Effect.result(
      foreignStore.createRun(selected.selection, request),
    ));
    expect(Result.isFailure(foreignReplay)).toBe(true);
    if (Result.isFailure(foreignReplay)) {
      expect(foreignReplay.failure).toMatchObject({
        operation: "create_run",
        reason: "request_authority_mismatch",
      });
    }
    expect(await scalarCount(
      fixture.target,
      "fx_system_durable_task_run_v1",
    )).toBe(1);
    const nextRevisionId = await createAdditionalApplicationRevision(fixture, true);
    expect(await runEffect(fixture.repository.settle({
      deploymentId: fixture.input.deploymentId,
      revisionId: nextRevisionId,
    }))).toMatchObject({ status: "ready" });
    await runEffect(activation.activate({
      revisionId: nextRevisionId,
      expectedActiveHead: active.expectedActiveHead,
    }));
    const replayRequest = Object.freeze({
      version: request.version,
      requestKey: request.requestKey,
      input: request.input,
      principal: request.principal,
    });
    expect(await runEffect(store.replayRun(
      "tasks.users.get",
      replayRequest,
    ))).toEqual(created);
    const missingRequest = Result.getOrThrow(
      decodeApplicationTaskRunCreationRequestV1({
        ...request,
        requestKey: "application-task-missing",
      }),
    );
    expect(await runEffect(store.replayRun(
      "tasks.users.get",
      Object.freeze({
        version: missingRequest.version,
        requestKey: missingRequest.requestKey,
        input: missingRequest.input,
        principal: missingRequest.principal,
      }),
    ))).toBeNull();
    const replayed = await runEffect(store.createRun(selected.selection, request));
    expect(replayed).toEqual(created);
    const staleNewRequest = Result.getOrThrow(
      decodeApplicationTaskRunCreationRequestV1({
        ...request,
        requestKey: "application-task-run-stale-new",
      }),
    );
    const staleResult = await runEffect(Effect.result(
      store.createRun(selected.selection, staleNewRequest),
    ));
    expect(Result.isFailure(staleResult)).toBe(true);
    if (Result.isFailure(staleResult)) {
      expect(staleResult.failure).toMatchObject({
        operation: "validateSelection",
        reason: "concurrentHead",
      });
    }
    const conflictingRequest = Result.getOrThrow(
      decodeApplicationTaskRunCreationRequestV1({
        ...request,
        input: Result.getOrThrow(makeTaskInputReferenceV1(
          new Uint8Array(32).fill(0x72),
          19,
        )),
      }),
    );
    const conflict = await runEffect(Effect.result(
      store.createRun(selected.selection, conflictingRequest),
    ));
    expect(Result.isFailure(conflict)).toBe(true);
    if (Result.isFailure(conflict)) {
      expect(conflict.failure).toMatchObject({
        _tag: "TaskRunCreationIdempotencyConflictError",
        reason: "request_digest_mismatch",
      });
    }
    const principalConflictRequest = Result.getOrThrow(
      decodeApplicationTaskRunCreationRequestV1({
        ...request,
        principal: Result.getOrThrow(makeTaskExecutionPrincipalReferenceV1(
          new Uint8Array(32).fill(0x74),
          23,
        )),
      }),
    );
    const principalConflict = await runEffect(Effect.result(
      store.createRun(selected.selection, principalConflictRequest),
    ));
    expect(Result.isFailure(principalConflict)).toBe(true);
    if (Result.isFailure(principalConflict)) {
      expect(principalConflict.failure).toMatchObject({
        _tag: "TaskRunCreationIdempotencyConflictError",
        reason: "request_digest_mismatch",
      });
    }
    const lifecycleStore = makeApplicationTaskSystemRunAttemptStoreV1(located, {
      randomUuid: uuidSequence(91),
    });
    const projectedRun = await runEffect(Effect.gen(function* () {
      const query = yield* TaskRunQuery;
      return yield* query.inspect(created.runId);
    }).pipe(Effect.provide(makeTaskRunQueryLayer(lifecycleStore))));
    expect(projectedRun).toMatchObject({
      runId: created.runId,
      createdAtMs: created.createdAtMs,
      runVersion: 1n,
      state: {
        kind: "ready",
        eligibleAtMs: created.createdAtMs,
        cancellation: { kind: "not_requested" },
      },
    });
    expect(Object.isFrozen(projectedRun)).toBe(true);
    expect(Object.isFrozen(projectedRun.state)).toBe(true);
    const unavailableResult = await runEffect(Effect.result(
      Effect.gen(function* () {
        const resultQuery = yield* TaskRunResultQuery;
        return yield* resultQuery.authorizeRead(created.runId);
      }).pipe(Effect.provide(makeTaskRunResultQueryLayer(lifecycleStore))),
    ));
    expect(Result.isFailure(unavailableResult)).toBe(true);
    if (Result.isFailure(unavailableResult)) {
      expect(unavailableResult.failure).toMatchObject({
        _tag: "TaskRunResultUnavailableError",
        runId: created.runId,
        reason: "run_incomplete",
      });
    }
    const startCommand = Object.freeze({
      type: "start_attempt" as const,
      runId: created.runId,
      expectedRunVersion: Result.getOrThrow(decodeTaskRunVersionV1("1")),
      retryJitter: Result.getOrThrow(decodeTaskRetryJitterV1(0.5)),
    });
    const started = await runEffect(lifecycleStore.transactRunAttempt({
      operation: "start_attempt",
      runId: created.runId,
      decide: input => decideApplicationStartAttemptV1(startCommand, input),
    }));
    const startReplay = await runEffect(lifecycleStore.transactRunAttempt({
      operation: "start_attempt",
      runId: created.runId,
      decide: input => decideApplicationStartAttemptV1(startCommand, input),
    }));
    expect(started).toMatchObject({
      disposition: "accepted",
      runVersion: 2n,
      outcome: { kind: "attempt_granted" },
    });
    expect(startReplay).toEqual({ ...started, disposition: "idempotent" });
    const computeTarget = createLocatedTaskComputeDeliveryTargetV1(
      fixture.target.drizzle,
      active.basis.authority.physicalLocator,
    );
    const applicationDiscovery = Result.getOrThrow(
      makeTaskComputeDeliveryCandidateDiscovery(
        Object.freeze({
          authority: active.basis.authority,
          target: computeTarget,
        }),
        APPLICATION_TASK_DISCOVERY_DEADLINE_POLICY,
        "legacy_and_application",
      ),
    );
    const legacyDiscovery = Result.getOrThrow(
      makeTaskComputeDeliveryCandidateDiscovery(
        Object.freeze({
          authority: active.basis.authority,
          target: computeTarget,
        }),
        APPLICATION_TASK_DISCOVERY_DEADLINE_POLICY,
        "legacy_only",
      ),
    );
    expect((await runEffect(
      applicationDiscovery.discoverDispatchCandidates({ limit: 10 }),
    )).candidates.map(candidate => candidate.runId)).toEqual([created.runId]);
    expect((await runEffect(
      legacyDiscovery.discoverDispatchCandidates({ limit: 10 }),
    )).candidates).toEqual([]);
    const computeRepository = Result.getOrThrow(
      makeTaskComputeDeliveryRepositoryV1(
        Object.freeze({
          authority: active.basis.authority,
          target: computeTarget,
        }),
        {
          claimDurationMilliseconds: 30_000,
          retryDelayMilliseconds: [1_000, 2_000],
          maximumDeliveryAttempts: 3,
          randomUuid: uuidSequence(92, 93, 94, 95, 96, 97, 98, 99, 100, 101,
            102, 103, 104, 105, 106, 107),
        },
      ),
    );
    const acquireRequest = {
      runId: created.runId,
      requestedEffectSequence: Result.getOrThrow(
        decodeTaskRequestedEffectSequenceV1("1"),
      ),
    } as const;
    const storedRunAuthority = await fixture.target.query<{
      creation_authority_byte_length: bigint;
      creation_authority_sha256: Uint8Array;
      creation_authority_bytes: Uint8Array;
    }>(`select creation_authority_byte_length, creation_authority_sha256,
               creation_authority_bytes
          from fx_system_durable_task_run_v1
         where scope_id = $1 and run_id = $2`, [
      fixture.authority.scopeId,
      created.runId,
    ]);
    await fixture.target.query(`
      update fx_system_durable_task_run_v1
      set creation_authority_bytes = set_byte(creation_authority_bytes, 0,
        (get_byte(creation_authority_bytes, 0) + 1) % 256)
      where scope_id = $1 and run_id = $2
    `, [fixture.authority.scopeId, created.runId]);
    await expect(runEffectFailure(computeRepository.acquireDispatch(
      acquireRequest,
    ))).resolves.toMatchObject({ reason: "creation_authority_invalid" });
    await fixture.target.query(`
      update fx_system_durable_task_run_v1
      set creation_authority_bytes = $3
      where scope_id = $1 and run_id = $2
    `, [
      fixture.authority.scopeId,
      created.runId,
      storedRunAuthority.rows[0]!.creation_authority_bytes,
    ]);
    const storedCreationAuthority = Result.getOrThrow(
      decodeApplicationTaskRunCreationAuthorityPreimageV1(
        storedRunAuthority.rows[0]!.creation_authority_bytes,
      ),
    );
    const mismatchedCreationAuthorityBytes = Result.getOrThrow(
      encodeApplicationTaskRunCreationAuthorityPreimageV1({
        ...storedCreationAuthority,
        runtimeTarget: {
          ...storedCreationAuthority.runtimeTarget,
          runtimeHostIdentity:
            `${storedCreationAuthority.runtimeTarget.runtimeHostIdentity}-mismatch`,
        },
      }),
    );
    const mismatchedCreationAuthoritySha256 = await sha256Bytes(
      mismatchedCreationAuthorityBytes,
    );
    await fixture.target.query(`
      update fx_system_durable_task_run_v1
      set creation_authority_byte_length = $3,
          creation_authority_sha256 = $4,
          creation_authority_bytes = $5
      where scope_id = $1 and run_id = $2
    `, [
      fixture.authority.scopeId,
      created.runId,
      BigInt(mismatchedCreationAuthorityBytes.byteLength),
      mismatchedCreationAuthoritySha256,
      mismatchedCreationAuthorityBytes,
    ]);
    await expect(runEffectFailure(computeRepository.acquireDispatch(
      acquireRequest,
    ))).resolves.toMatchObject({ reason: "creation_authority_invalid" });
    await fixture.target.query(`
      update fx_system_durable_task_run_v1
      set creation_authority_byte_length = $3,
          creation_authority_sha256 = $4,
          creation_authority_bytes = $5
      where scope_id = $1 and run_id = $2
    `, [
      fixture.authority.scopeId,
      created.runId,
      storedRunAuthority.rows[0]!.creation_authority_byte_length,
      storedRunAuthority.rows[0]!.creation_authority_sha256,
      storedRunAuthority.rows[0]!.creation_authority_bytes,
    ]);
    const storedCatalogBinding = await fixture.target.query<{
      binding_bytes: Uint8Array;
    }>(`select binding_bytes from fx_system_application_task_catalog_v1
        where scope_id = $1 and revision_id = $2`, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
    ]);
    await fixture.target.query(`
      alter table fx_system_application_task_catalog_v1
      drop constraint fx_application_task_catalog_v1_identity_check
    `);
    await fixture.target.query(`
      update fx_system_application_task_catalog_v1
      set binding_bytes = decode(repeat('00', 16777217), 'hex')
      where scope_id = $1 and revision_id = $2
    `, [fixture.authority.scopeId, fixture.input.revisionId]);
    await expect(runEffectFailure(computeRepository.acquireDispatch(
      acquireRequest,
    ))).resolves.toMatchObject({ reason: "definition_invalid" });
    await fixture.target.query(`
      update fx_system_application_task_catalog_v1
      set binding_bytes = $3
      where scope_id = $1 and revision_id = $2
    `, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
      storedCatalogBinding.rows[0]!.binding_bytes,
    ]);
    await fixture.target.query(`
      update fx_system_application_task_catalog_v1
      set binding_bytes = set_byte(binding_bytes, 0,
        (get_byte(binding_bytes, 0) + 1) % 256)
      where scope_id = $1 and revision_id = $2
    `, [fixture.authority.scopeId, fixture.input.revisionId]);
    await expect(runEffectFailure(computeRepository.acquireDispatch(
      acquireRequest,
    ))).resolves.toMatchObject({ reason: "definition_invalid" });
    await fixture.target.query(`
      update fx_system_application_task_catalog_v1
      set binding_bytes = $3
      where scope_id = $1 and revision_id = $2
    `, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
      storedCatalogBinding.rows[0]!.binding_bytes,
    ]);
    const storedDefinition = await fixture.target.query<{
      canonical_task_manifest_sha256: Uint8Array;
      binding_bytes: Uint8Array;
      manifest_bytes: Uint8Array;
    }>(`select canonical_task_manifest_sha256, binding_bytes, manifest_bytes
          from fx_system_application_task_definition_v1
         where scope_id = $1 and revision_id = $2 and task_id = $3`, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
      selected.metadata.target.taskId,
    ]);
    await fixture.target.query(`
      update fx_system_application_task_definition_v1
      set binding_bytes = set_byte(binding_bytes, 0,
        (get_byte(binding_bytes, 0) + 1) % 256)
      where scope_id = $1 and revision_id = $2 and task_id = $3
    `, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
      selected.metadata.target.taskId,
    ]);
    await expect(runEffectFailure(computeRepository.acquireDispatch(
      acquireRequest,
    ))).resolves.toMatchObject({ reason: "definition_invalid" });
    await fixture.target.query(`
      update fx_system_application_task_definition_v1
      set binding_bytes = $4
      where scope_id = $1 and revision_id = $2 and task_id = $3
    `, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
      selected.metadata.target.taskId,
      storedDefinition.rows[0]!.binding_bytes,
    ]);
    await fixture.target.query(`
      update fx_system_application_task_definition_v1
      set manifest_bytes = set_byte(manifest_bytes, 0,
        (get_byte(manifest_bytes, 0) + 1) % 256)
      where scope_id = $1 and revision_id = $2 and task_id = $3
    `, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
      selected.metadata.target.taskId,
    ]);
    await expect(runEffectFailure(computeRepository.acquireDispatch(
      acquireRequest,
    ))).resolves.toMatchObject({ reason: "definition_invalid" });
    await fixture.target.query(`
      update fx_system_application_task_definition_v1
      set manifest_bytes = $4
      where scope_id = $1 and revision_id = $2 and task_id = $3
    `, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
      selected.metadata.target.taskId,
      storedDefinition.rows[0]!.manifest_bytes,
    ]);
    await fixture.target.query(`
      update fx_system_application_task_definition_v1
      set canonical_task_manifest_sha256 = decode(repeat('ee', 32), 'hex')
      where scope_id = $1 and revision_id = $2 and task_id = $3
    `, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
      selected.metadata.target.taskId,
    ]);
    await expect(runEffectFailure(computeRepository.acquireDispatch(
      acquireRequest,
    ))).resolves.toMatchObject({ reason: "definition_invalid" });
    await fixture.target.query(`
      update fx_system_application_task_definition_v1
      set canonical_task_manifest_sha256 = $4
      where scope_id = $1 and revision_id = $2 and task_id = $3
    `, [
      fixture.authority.scopeId,
      fixture.input.revisionId,
      selected.metadata.target.taskId,
      storedDefinition.rows[0]!.canonical_task_manifest_sha256,
    ]);
    const storedEffect = await fixture.target.query<{
      payload_byte_length: bigint;
      payload_json: unknown;
    }>(`select payload_byte_length, payload_json
          from fx_system_durable_task_requested_effect_v1
         where scope_id = $1 and run_id = $2 and sequence = 1`, [
      fixture.authority.scopeId,
      created.runId,
    ]);
    await fixture.target.query(`
      update fx_system_durable_task_requested_effect_v1
      set payload_json = jsonb_set(payload_json, '{kind}', '"continue_retry"')
      where scope_id = $1 and run_id = $2 and sequence = 1
    `, [fixture.authority.scopeId, created.runId]);
    await expect(runEffectFailure(computeRepository.acquireDispatch(
      acquireRequest,
    ))).resolves.toMatchObject({ reason: "effect_invalid" });
    await fixture.target.query(`
      update fx_system_durable_task_requested_effect_v1
      set payload_json = $3::jsonb
      where scope_id = $1 and run_id = $2 and sequence = 1
    `, [
      fixture.authority.scopeId,
      created.runId,
      JSON.stringify(storedEffect.rows[0]!.payload_json),
    ]);
    const mismatchedEffectDigest = new Uint8Array(32).fill(0xcd);
    const mismatchedEffectPayload = replaceApplicationDispatchDigestInJson(
      storedEffect.rows[0]!.payload_json,
      mismatchedEffectDigest,
    );
    const canonicalMismatchedEffect = Result.getOrThrow(
      encodeApplicationPersistedTaskRequestedEffectJsonV1(Result.getOrThrow(
        decodeApplicationPersistedTaskRequestedEffectJsonV1(
          mismatchedEffectPayload,
        ),
      )),
    );
    await fixture.target.query(`
      update fx_system_durable_task_requested_effect_v1
      set payload_json = $3::jsonb, payload_byte_length = $4
      where scope_id = $1 and run_id = $2 and sequence = 1
    `, [
      fixture.authority.scopeId,
      created.runId,
      JSON.stringify(mismatchedEffectPayload),
      canonicalJsonByteLength(canonicalMismatchedEffect),
    ]);
    await expect(runEffectFailure(computeRepository.acquireDispatch(
      acquireRequest,
    ))).resolves.toMatchObject({ reason: "definition_invalid" });
    await fixture.target.query(`
      update fx_system_durable_task_requested_effect_v1
      set payload_json = $3::jsonb, payload_byte_length = $4
      where scope_id = $1 and run_id = $2 and sequence = 1
    `, [
      fixture.authority.scopeId,
      created.runId,
      JSON.stringify(storedEffect.rows[0]!.payload_json),
      storedEffect.rows[0]!.payload_byte_length,
    ]);
    const prepared = await runEffect(computeRepository.acquireDispatch(
      acquireRequest,
    ));
    expect(prepared.kind).toBe("claimed");
    if (prepared.kind !== "claimed") {
      throw new Error("Application dispatch was not prepared.");
    }
    expect(prepared.prepared).toMatchObject({
      generation: "application_v1",
      runtimeTarget: selected.metadata.target,
      manifest: selected.metadata.manifest,
      creationAuthority: {
        applicationTaskRuntimeTargetSha256:
          selected.metadata.runtimeTargetSha256,
      },
      dispatchRequest: {
        applicationTaskRuntimeTargetSha256:
          selected.metadata.runtimeTargetSha256,
      },
    });
    expect(Result.getOrThrow(
      decodeCurrentTaskComputePreparedExecutionV1(prepared.prepared),
    )).toEqual(prepared.prepared);
    await runEffect(
      computeRepository.markDispatchDeliveryStarted(prepared.handle),
    );
    await fixture.target.query(`
      update fx_system_durable_task_compute_dispatch_v1
      set claimed_at = clock_timestamp() - interval '2 minutes',
          claim_expires_at = clock_timestamp() - interval '1 minute'
      where scope_id = $1 and run_id = $2
        and requested_effect_sequence = 1
    `, [fixture.authority.scopeId, created.runId]);
    const recovered = await runEffect(
      computeRepository.acquireDispatch(acquireRequest),
    );
    expect(recovered.kind).toBe("claimed");
    if (recovered.kind !== "claimed") {
      throw new Error("Application uncertain dispatch was not reclaimed.");
    }
    expect(recovered.deliveryMode).toBe("uncertain_replay");
    expect(await runEffect(
      computeRepository.verifyDispatchRecovery(recovered.handle),
    )).toEqual({ kind: "state_unchanged" });
    await runEffect(
      computeRepository.markDispatchDeliveryStarted(recovered.handle),
    );
    const acceptance = Result.getOrThrow(
      validateTaskComputeDispatchAcceptanceV1({
        version: TASK_COMPUTE_DISPATCH_ACCEPTANCE_VERSION_V1,
        kind: "accepted",
        identity: recovered.prepared.dispatchRequest.identity,
        execution: {
          provider: "application-test-provider",
          providerVersion: "v1",
          executionId: "application-execution-1",
        },
      }),
    );
    expect(await runEffect(computeRepository.recordDispatchAcceptance(
      recovered.handle,
      acceptance,
    ))).toEqual({
      kind: "dispatch_accepted",
      acceptance,
      disposition: "current",
    });
    expect(await runEffect(computeRepository.acquireDispatch(acquireRequest)))
      .toEqual({
      kind: "accepted",
      acceptance,
      disposition: "current",
    });
    const cancellationDecision = await runEffect(
      lifecycleStore.transactRunAttempt({
        operation: "request_cancellation",
        runId: created.runId,
        decide: input => decideApplicationRequestCancellationV1({
          type: "request_cancellation",
          runId: created.runId,
          reason: { code: "requested", message: null },
        }, input),
      }),
    );
    const cancellationEffect = cancellationDecision.requestedEffects.find(
      item => item.effect.kind === "request_execution_cancellation",
    );
    if (cancellationEffect === undefined) {
      throw new Error("Application cancellation effect was not emitted.");
    }
    const cancellation = await runEffect(computeRepository.acquireCancellation({
      runId: created.runId,
      requestedEffectSequence: cancellationEffect.sequence,
    }));
    expect(cancellation.kind).toBe("claimed");
    if (cancellation.kind !== "claimed") {
      throw new Error("Application cancellation was not prepared.");
    }
    expect(cancellation.request.identity).toEqual(acceptance.identity);
    expect((await runEffect(lifecycleStore.inspectRunAttempt({
      operation: "inspect_current_attempt",
      runId: created.runId,
    }))).current).toMatchObject({
      runVersion: 3n,
      phase: "attempt_granted",
      applicationTaskRuntimeTargetSha256:
        selected.metadata.runtimeTargetSha256,
    });
    const rows = await fixture.target.query<{
      definition_generation: string;
      task_definition_revision_id: string | null;
      application_task_runtime_target_sha256: Uint8Array;
    }>(`select definition_generation, task_definition_revision_id,
              application_task_runtime_target_sha256
         from fx_system_durable_task_run_v1
        where run_id = $1`, [created.runId]);
    expect(rows.rows[0]).toMatchObject({
      definition_generation: "application_v1",
      task_definition_revision_id: null,
    });
    expect(Array.from(rows.rows[0]!.application_task_runtime_target_sha256))
      .toEqual(Array.from(selected.metadata.runtimeTargetSha256));
    const postDispatchAggregate = await fixture.target.query<{
      aggregate_json: unknown;
      aggregate_byte_length: string;
    }>(`select aggregate_json, aggregate_byte_length::text
          from fx_system_durable_task_run_v1 where run_id = $1`, [created.runId]);
    await fixture.target.query(`
      update fx_system_durable_task_run_v1
      set aggregate_json = '{}'::jsonb, aggregate_byte_length = 2
      where run_id = $1
    `, [created.runId]);
    await expect(runEffectFailure(lifecycleStore.inspectRunAttempt({
      operation: "inspect_current_attempt",
      runId: created.runId,
    }))).resolves.toMatchObject({ reason: "aggregate_invalid" });
    await fixture.target.query(`
      update fx_system_durable_task_run_v1
      set aggregate_json = $2::jsonb, aggregate_byte_length = $3
      where run_id = $1
    `, [
      created.runId,
      JSON.stringify(postDispatchAggregate.rows[0]!.aggregate_json),
      postDispatchAggregate.rows[0]!.aggregate_byte_length,
    ]);
    await fixture.target.query(`
      update fx_system_durable_task_requested_effect_v1
      set payload_json = '{}'::jsonb, payload_byte_length = 2
      where run_id = $1 and sequence = 1
    `, [created.runId]);
    await expect(runEffectFailure(lifecycleStore.inspectRunAttempt({
      operation: "inspect_current_attempt",
      runId: created.runId,
    }))).resolves.toMatchObject({ reason: "acceptance_invalid" });
  });

  it("rejects a missing or corrupted stored Application task", async () => {
    const empty = await readinessFixture();
    await prepareReadinessAuthorities(empty);
    const emptyActivation = makeApplicationActivationRepository({
      deploymentId: empty.input.deploymentId,
      readiness: empty.repository,
      authority: empty.authorityPorts,
    });
    await runEffect(emptyActivation.activate({
      revisionId: empty.input.revisionId,
      expectedActiveHead: null,
    }));
    const emptyActive = await runEffect(emptyActivation.readActive());
    const missing = await runEffect(Effect.result(selectApplicationTask(
      emptyActive.selection,
      "tasks.users.get",
      {
        deploymentId: empty.input.deploymentId,
        runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
        compatibilityDate: COMPATIBILITY_DATE,
        authority: empty.authorityPorts,
      },
    )));
    expect(Result.isFailure(missing)).toBe(true);
    if (Result.isFailure(missing)) {
      expect(missing.failure).toMatchObject({ reason: "taskMissing" });
    }

    const corrupt = await readinessFixture({ includeTask: true });
    await prepareReadinessAuthorities(corrupt);
    const corruptActivation = makeApplicationActivationRepository({
      deploymentId: corrupt.input.deploymentId,
      readiness: corrupt.repository,
      authority: corrupt.authorityPorts,
    });
    await runEffect(corruptActivation.activate({
      revisionId: corrupt.input.revisionId,
      expectedActiveHead: null,
    }));
    const corruptActive = await runEffect(corruptActivation.readActive());
    const selectedBeforeCorruption = await runEffect(selectApplicationTask(
      corruptActive.selection,
      "tasks.users.get",
      {
        deploymentId: corrupt.input.deploymentId,
        runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
        compatibilityDate: COMPATIBILITY_DATE,
        authority: corrupt.authorityPorts,
      },
    ));
    await corrupt.target.query(
      `update fx_system_application_task_definition_v1
          set binding_bytes = $1
        where scope_id = $2 and revision_id = $3 and task_id = $4`,
      [
        new Uint8Array([1]),
        corrupt.authority.scopeId,
        corrupt.input.revisionId,
        "tasks.users.get",
      ],
    );
    const invalidated = await runEffect(Effect.result(
      validateApplicationTaskSelection(selectedBeforeCorruption.selection),
    ));
    expect(Result.isFailure(invalidated)).toBe(true);
    if (Result.isFailure(invalidated)) {
      expect(invalidated.failure).toMatchObject({
        operation: "validate",
        reason: "storedTask",
      });
    }
    const corrupted = await runEffect(Effect.result(selectApplicationTask(
      corruptActive.selection,
      "tasks.users.get",
      {
        deploymentId: corrupt.input.deploymentId,
        runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
        compatibilityDate: COMPATIBILITY_DATE,
        authority: corrupt.authorityPorts,
      },
    )));
    expect(Result.isFailure(corrupted)).toBe(true);
    if (Result.isFailure(corrupted)) {
      expect(corrupted.failure).toMatchObject({ reason: "storedTask" });
    }
  });

  it("classifies retained active readiness as non-serving and rejects a corrupt active head", async () => {
    const fixture = await readinessFixture({ functionKind: "mutation" });
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const inspector = createApplicationRelationServingInspector();
    const edgeDefinitionId = decodeCatalogEdgeDefinitionId(1);
    const inspection = await fixture.target.drizzle.transaction(async (tx) => {
      const clock = await runEffect(lockScopeClockForUpdateInTransactionEffect(
        tx,
        active.basis.authority.scopeId,
      ));
      return runEffect(
        inspectApplicationRelationServingDefinitionInTransactionEffect(
          inspector,
          tx,
          {
            authority: active.basis.authority,
            clock,
            edgeDefinitionId,
          },
        ),
      );
    });
    expect(inspection).toEqual({
      status: "not_serving",
      reason: "active_readiness_v1",
      edgeDefinitionId,
      activeRevisionId: fixture.input.revisionId,
    });

    await fixture.target.drizzle.update(fxSystemApplicationActiveHeads).set({
      headSha256: new Uint8Array(32).fill(0xee),
    }).where(eq(
      fxSystemApplicationActiveHeads.scopeId,
      active.basis.authority.scopeId,
    ));
    const corrupt = await fixture.target.drizzle.transaction(async (tx) => {
      const clock = await runEffect(lockScopeClockForUpdateInTransactionEffect(
        tx,
        active.basis.authority.scopeId,
      ));
      return runEffectFailure(
        inspectApplicationRelationServingDefinitionInTransactionEffect(
          inspector,
          tx,
          {
            authority: active.basis.authority,
            clock,
            edgeDefinitionId,
          },
        ),
      );
    });
    expect(corrupt).toBeInstanceOf(ApplicationActiveHeadStateError);
    expect(corrupt).toMatchObject({ reason: "storedState" });
  });

  it("admits and replays exact Application mutation authority and rejects stale or foreign authority", async () => {
    const fixture = await readinessFixture({ functionKind: "mutation" });
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const input = await applicationMutationActivationInput(fixture, active);
    const freshGrantReplay = await applicationMutationActivationInput(
      fixture,
      active,
      {
        requestKey: "request:application:mutation",
        grantId: "grant_application_mutation_fresh_retry",
      },
    );
    const staleNewRequest = await applicationMutationActivationInput(
      fixture,
      active,
      {
        requestKey: "request:application:mutation:stale-new-admission",
        grantId: "grant_application_mutation_stale_new",
      },
    );
    const sessionActivation = createApplicationMutationSessionActivationPersistenceV1(
      {
        scopeMetadata: fixture.control,
        provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
        scopeSessionTargets: {
          resolve: async locator =>
            createPGliteLocatedPointMutationSessionActivationTargetV1(
              fixture.target,
              locator,
            ),
        },
      },
      {
        leaseDurationMilliseconds: 60_000,
        randomUuid: uuidSequence(80, 81, 82, 83, 84, 85),
      },
    );

    const created = await runEffect(sessionActivation.activateEffect(input));
    const replayed = await runEffect(
      sessionActivation.activateEffect(freshGrantReplay),
    );
    expect(created.status).toBe("created");
    expect(replayed).toMatchObject({ status: "busy", anchor: created.anchor });
    const stored = await fixture.target.query<{
      generation: string;
      package_id: string | null;
      authority_format: string;
    }>(
      `select execution_authority_generation as generation,
              package_id,
              application_execution_authority_json->>'format' as authority_format
         from fx_system_tx_session
        where session_id = $1`,
      [created.anchor.sessionId],
    );
    expect(stored.rows).toEqual([{
      generation: "application_v1",
      package_id: null,
      authority_format: "flarex.application-mutation-execution-authority",
    }]);
    if (created.status !== "created") throw new Error("Expected creation.");
    const graphQueries: string[] = [];
    const executionAuthority = {
      kind: "claimedAttempt" as const,
      deploymentId: created.anchor.deploymentId,
      scopeId: created.anchor.scopeId,
      scopeUuid: projectScopeIdUuidV1(created.anchor.scopeId).scopeUuid,
      sessionId: created.anchor.sessionId,
      attemptFence: created.anchor.attemptFence,
      storageGeneration: created.anchor.storageGeneration,
      storageGenerationFence: created.anchor.storageGenerationFence,
      snapshotToken: created.anchor.snapshotToken,
      schemaVersionId: active.basis.schemaVersionId,
      executionClaim: Object.freeze({
        claimOwner: created.executionClaim.claimOwner,
        claimFence: created.executionClaim.claimFence,
      }),
    };
    const graphLoader = createStoredOccExecutionEvidenceLoaderV1({
      scopeMetadata: fixture.control,
      applicationControlDb: fixture.control.drizzle,
      provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
      scopeSessionTargets: {
        resolve: async locator =>
          createPGliteLocatedPointMutationSessionActivationTargetV1(
            fixture.target,
            locator,
          ),
      },
    }, { observeQuery: query => graphQueries.push(query.name) });
    const immutableGraph = await runEffect(
      graphLoader.loadEffect(executionAuthority),
    );
    if (immutableGraph.kind !== "loaded") {
      throw new Error(`Expected immutable graph: ${JSON.stringify(immutableGraph)}`);
    }
    expect(immutableGraph.evidence.application).toMatchObject({
      activationSequence: active.basis.activationSequence,
    });
    expect(graphQueries.indexOf("applicationGraphSizes")).toBeLessThan(
      graphQueries.indexOf("applicationGraphPayload"),
    );
    expect(graphQueries.indexOf("applicationSchemaAuthoritySizes")).toBeLessThan(
      graphQueries.indexOf("applicationSchemaAuthorityPayload"),
    );

    const foreignGrant = await runEffect(Effect.result(
      sessionActivation.activateEffect(Object.freeze({
        ...input,
        evidence: Object.freeze({
          ...input.evidence,
          requestKey: TransactionRequestKeyV1Schema.make(
            "request:application:foreign-grant",
          ),
          verifiedGrant: Object.freeze({ grant: "legacy" }),
        }),
      }) as unknown as typeof input),
    ));
    expect(Result.isFailure(foreignGrant)).toBe(true);

    await fixture.target.drizzle.update(fxSystemApplicationActiveHeads).set({
      headSha256: new Uint8Array(32).fill(0xee),
    }).where(eq(
      fxSystemApplicationActiveHeads.scopeId,
      active.basis.authority.scopeId,
    ));
    await expect(runEffect(graphLoader.loadEffect(executionAuthority))).resolves
      .toMatchObject({ kind: "loaded" });
    const missingControlGraph = await runEffect(
      createStoredOccExecutionEvidenceLoaderV1({
        scopeMetadata: fixture.control,
        provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
        scopeSessionTargets: {
          resolve: async locator =>
            createPGliteLocatedPointMutationSessionActivationTargetV1(
              fixture.target,
              locator,
            ),
        },
      }).loadEffect(executionAuthority),
    );
    expect(missingControlGraph).toMatchObject({
      kind: "corrupt",
      reason: "schemaArtifactMissingOrDuplicate",
    });
    await fixture.target.query(
      `update fx_system_tx_session
          set application_execution_authority_json = jsonb_set(
            application_execution_authority_json,
            '{version}',
            '1e100'::jsonb
          )
        where session_id = $1`,
      [created.anchor.sessionId],
    );
    await expect(runEffect(graphLoader.loadEffect(executionAuthority))).resolves
      .toMatchObject({ kind: "corrupt" });
    await fixture.target.query(
      `update fx_system_tx_session
          set application_execution_authority_json = jsonb_set(
            application_execution_authority_json,
            '{version}',
            '1'::jsonb
          )
        where session_id = $1`,
      [created.anchor.sessionId],
    );
    await fixture.target.query(
      `update fx_system_tx_session
          set validated_args_canonical_bytes =
            convert_to(repeat('x', 67108865), 'UTF8')
        where session_id = $1`,
      [created.anchor.sessionId],
    );
    const overflowQueries: string[] = [];
    const overflowGraph = await runEffect(
      createStoredOccExecutionEvidenceLoaderV1({
        scopeMetadata: fixture.control,
        applicationControlDb: fixture.control.drizzle,
        provisioningReceipts: fixture.authorityPorts.provisioningReceipts,
        scopeSessionTargets: {
          resolve: async locator =>
            createPGliteLocatedPointMutationSessionActivationTargetV1(
              fixture.target,
              locator,
            ),
        },
      }, { observeQuery: query => overflowQueries.push(query.name) })
        .loadEffect(executionAuthority),
    );
    expect(overflowGraph).toMatchObject({
      kind: "corrupt",
      reason: "evidenceLimitExceeded",
    });
    expect(overflowQueries).not.toContain("authorityPayload");
    expect(overflowQueries).not.toContain("applicationGraphPayload");
    expect(overflowQueries).not.toContain("applicationSchemaAuthorityPayload");
    await fixture.target.query(
      `update fx_system_tx_session
          set validated_args_canonical_bytes = $2
        where session_id = $1`,
      [created.anchor.sessionId, input.evidence.validatedArgsCanonicalBytes],
    );
    const afterHeadMovement = await runEffect(
      sessionActivation.activateEffect(input),
    );
    expect(afterHeadMovement).toMatchObject({
      status: "busy",
      anchor: created.anchor,
    });
    const staleAdmission = await runEffect(Effect.result(
      sessionActivation.activateEffect(staleNewRequest),
    ));
    expect(Result.isFailure(staleAdmission)).toBe(true);
    if (Result.isFailure(staleAdmission)) {
      expect(staleAdmission.failure).toMatchObject({
        operation: "validateSelection",
        reason: "storedState",
      });
    }
    const conflictingReplay = await runEffect(Effect.result(
      sessionActivation.activateEffect(Object.freeze({
        ...input,
        evidence: Object.freeze({
          ...input.evidence,
          validatedArgsJson: Object.freeze({ body: "conflicting" }),
        }),
      })),
    ));
    expect(Result.isFailure(conflictingReplay)).toBe(true);
    if (Result.isFailure(conflictingReplay)) {
      expect(conflictingReplay.failure).toMatchObject({
        issue: { reason: "invalidPreparedEvidence" },
      });
    }
    expect(await scalarCount(fixture.target, "fx_system_tx_session")).toBe(1);
    await fixture.target.drizzle.update(fxSystemApplicationFunctionsV1).set({
      entryBytes: new Uint8Array([1]),
    }).where(eq(
      fxSystemApplicationFunctionsV1.functionPath,
      input.evidence.functionPath,
    ));
    await expect(runEffect(graphLoader.loadEffect(executionAuthority))).resolves
      .toMatchObject({ kind: "corrupt", reason: "applicationGraphInvalid" });
  });

  it("selects an exact public Application mutation and rejects a stale admitted head", async () => {
    const fixture = await readinessFixture({ functionKind: "mutation" });
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const context = Object.freeze({
      deploymentId: fixture.input.deploymentId,
      controlDb: fixture.control.drizzle,
      schema: fixture.schema,
      authority: fixture.authorityPorts,
    });

    const admitted = await runEffect(selectApplicationMutationAdmission(
      active.selection,
      "users:get",
      context,
    ));
    expect(admitted.basis.revisionId).toBe(fixture.input.revisionId);
    expect(admitted.executionAuthority.authority).toMatchObject({
      format: "flarex.application-mutation-execution-authority",
      version: 1,
      activationSequence: active.basis.activationSequence.toString(),
      activeHeadSha256: hex(active.basis.headSha256),
      schemaVersionId: active.basis.schemaVersionId,
      runtimeTarget: {
        revisionId: fixture.input.revisionId,
        function: {
          path: "users:get",
          kind: "mutation",
          visibility: "public",
        },
      },
    });

    await fixture.target.drizzle.update(fxSystemApplicationActiveHeads).set({
      headSha256: new Uint8Array(32).fill(0xee),
    }).where(eq(
      fxSystemApplicationActiveHeads.scopeId,
      active.basis.authority.scopeId,
    ));
    const stale = await runEffect(Effect.result(
      selectApplicationMutationAdmission(
        active.selection,
        "users:get",
        context,
      ),
    ));
    expect(Result.isFailure(stale)).toBe(true);
    if (Result.isFailure(stale)) {
      expect(stale.failure).toMatchObject({
        operation: "validateSelection",
        reason: "storedState",
      });
    }
  });

  it("selects an exact public Application action without legacy revision evidence", async () => {
    const fixture = await readinessFixture({ functionKind: "action" });
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const admitted = await runEffect(selectApplicationActionAdmission(
      active.selection,
      "users:get",
      Object.freeze({
        deploymentId: fixture.input.deploymentId,
        controlDb: fixture.control.drizzle,
        schema: fixture.schema,
        authority: fixture.authorityPorts,
      }),
    ));

    expect(admitted.executionAuthority.authority).toMatchObject({
      format: "flarex.application-action-execution-authority",
      version: 1,
      activationSequence: active.basis.activationSequence.toString(),
      activeHeadSha256: hex(active.basis.headSha256),
      schemaVersionId: active.basis.schemaVersionId,
      runtimeTarget: {
        revisionId: fixture.input.revisionId,
        function: {
          path: "users:get",
          kind: "action",
          visibility: "public",
        },
      },
    });
    expect(admitted.executionAuthority.authority).not.toHaveProperty(
      "applicationRevisionId",
    );
    expect(admitted.executionAuthority.authority).not.toHaveProperty(
      "candidateSha256",
    );

    const argumentReference = Result.getOrThrow(
      makeExecutionEvidenceBodyReferenceV1(
        "action_arguments",
        new Uint8Array(32).fill(0x41),
        19,
      ),
    );
    const makeRequest = (requestKey: string, seed: number) =>
      Result.getOrThrow(encodeApplicationActionInvocationRequestV2({
        scopeId: active.basis.authority.scopeId,
        requestKey,
        executionAuthoritySha256: admitted.executionAuthority.sha256,
        actionFunctionPath: "users:get",
        executionIdentitySha256: new Uint8Array(32).fill(seed),
        compatibilityDate: COMPATIBILITY_DATE,
        hostPolicySha256: new Uint8Array(32).fill(0x43),
        arguments: argumentReference,
      }));
    const request = makeRequest("application-action-request-1", 0x42);
    const actionContext = Object.freeze({
      target: createLocatedApplicationActionAuthorityTargetV1(
        fixture.target.drizzle,
        active.basis.authority.physicalLocator,
      ),
      authority: active.basis.authority,
      sha256: Object.freeze({
        hash: (bytes: Uint8Array) => Effect.promise(async () =>
          new Uint8Array(await globalThis.crypto.subtle.digest(
            "SHA-256",
            copyBytesToArrayBuffer(bytes),
          ))
        ),
      }),
    });
    const inserted = await runEffect(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request,
        executionAuthority: admitted.executionAuthority,
        invocationId: "00000000-0000-4000-8000-000000000401",
      }, actionContext),
    );
    const replayed = await runEffect(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request,
        executionAuthority: admitted.executionAuthority,
        invocationId: "00000000-0000-4000-8000-000000000402",
      }, actionContext),
    );
    expect(inserted.disposition).toBe("inserted");
    expect(replayed.disposition).toBe("replayed");
    const inspected = await runEffect(
      inspectApplicationAuthorityActionInvocation(
        "application-action-request-1",
        actionContext,
      ),
    );
    expect(inspected.executionAuthorityGeneration).toBe("application_v1");
    expect(inspected.executionAuthority.sha256).toEqual(
      admitted.executionAuthority.sha256,
    );
    const conflicting = await runEffect(Effect.result(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request: makeRequest("application-action-request-1", 0x4c),
        executionAuthority: admitted.executionAuthority,
        invocationId: "00000000-0000-4000-8000-000000000406",
      }, actionContext),
    ));
    expect(Result.isFailure(conflicting)).toBe(true);
    if (Result.isFailure(conflicting)) {
      expect(conflicting.failure).toMatchObject({
        _tag: "ApplicationActionRequestKeyConflictV1Error",
      });
    }
    const staleAuthority = await runEffect(
      canonicalizeApplicationActionExecutionAuthorityV1({
        ...admitted.executionAuthority.authority,
        activeHeadSha256: "f".repeat(64),
      }),
    );
    const staleSelectionAdmission = await runEffect(Effect.result(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request: Result.getOrThrow(encodeApplicationActionInvocationRequestV2({
          ...makeRequest("application-action-stale-selection-1", 0x4d).frame,
          executionAuthoritySha256: staleAuthority.sha256,
        })),
        executionAuthority: staleAuthority,
        invocationId: "00000000-0000-4000-8000-000000000414",
      }, actionContext),
    ));
    expect(Result.isFailure(staleSelectionAdmission)).toBe(true);
    if (Result.isFailure(staleSelectionAdmission)) {
      expect(staleSelectionAdmission.failure).toMatchObject({
        _tag: "ApplicationActionAuthorityStaleV1Error",
      });
    }
    const foreignRuntimeTarget = Result.getOrThrow(
      canonicalizeApplicationRuntimeTargetV1({
        ...admitted.executionAuthority.authority.runtimeTarget,
        sourceArtifactRootSha256: "e".repeat(64),
      }),
    );
    const foreignArtifactAuthority = await runEffect(
      canonicalizeApplicationActionExecutionAuthorityV1({
        ...admitted.executionAuthority.authority,
        runtimeTarget: foreignRuntimeTarget.target,
        runtimeTargetSha256: await sha256Hex(
          foreignRuntimeTarget.canonicalBytes,
        ),
      }),
    );
    const foreignArtifactAdmission = await runEffect(Effect.result(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request: Result.getOrThrow(encodeApplicationActionInvocationRequestV2({
          ...makeRequest("application-action-foreign-artifact-1", 0x4d).frame,
          executionAuthoritySha256: foreignArtifactAuthority.sha256,
        })),
        executionAuthority: foreignArtifactAuthority,
        invocationId: "00000000-0000-4000-8000-000000000415",
      }, actionContext),
    ));
    expect(Result.isFailure(foreignArtifactAdmission)).toBe(true);
    if (Result.isFailure(foreignArtifactAdmission)) {
      expect(foreignArtifactAdmission.failure).toMatchObject({
        _tag: "ApplicationActionAuthorityStaleV1Error",
      });
    }
    for (const [index, functionPatch] of [
      { args: { type: "null" as const } },
      { returns: { type: "null" as const } },
      {
        partition: {
          type: "partitionCreateRoot" as const,
          table: "users",
          partitionField: "_id" as const,
        },
      },
    ].entries()) {
      const foreignFunctionTarget = Result.getOrThrow(
        canonicalizeApplicationRuntimeTargetV1({
          ...admitted.executionAuthority.authority.runtimeTarget,
          function: {
            ...admitted.executionAuthority.authority.runtimeTarget.function,
            ...functionPatch,
          },
        }),
      );
      const foreignFunctionAuthority = await runEffect(
        canonicalizeApplicationActionExecutionAuthorityV1({
          ...admitted.executionAuthority.authority,
          runtimeTarget: foreignFunctionTarget.target,
          runtimeTargetSha256: await sha256Hex(
            foreignFunctionTarget.canonicalBytes,
          ),
        }),
      );
      const foreignFunctionAdmission = await runEffect(Effect.result(
        admitApplicationAuthorityActionInvocation({
          selection: active.selection,
          request: Result.getOrThrow(encodeApplicationActionInvocationRequestV2({
            ...makeRequest(
              `application-action-foreign-function-${index}`,
              0x50 + index,
            ).frame,
            executionAuthoritySha256: foreignFunctionAuthority.sha256,
          })),
          executionAuthority: foreignFunctionAuthority,
          invocationId:
            `00000000-0000-4000-8000-${(416 + index).toString().padStart(12, "0")}`,
        }, actionContext),
      ));
      expect(Result.isFailure(foreignFunctionAdmission)).toBe(true);
      if (Result.isFailure(foreignFunctionAdmission)) {
        expect(foreignFunctionAdmission.failure).toMatchObject({
          _tag: "ApplicationActionAuthorityStaleV1Error",
        });
      }
    }
    expect(inserted.invocation).toMatchObject({
      executionAuthorityGeneration: "application_v1",
      actionFunctionPath: "users:get",
      lifecycle: "admitted",
    });
    expect(inserted.invocation).not.toHaveProperty("applicationRevisionId");
    expect(inserted.invocation).not.toHaveProperty("candidateSha256");
    expect(inserted.invocation).not.toHaveProperty("actionBindingSha256");
    const inertClaim = await runEffect(Effect.result(
      claimDirectActionExecutionV1(
        "application-action-request-1",
        1_000,
        new Uint8Array(32).fill(0x44),
        actionContext,
      ),
    ));
    expect(Result.isFailure(inertClaim)).toBe(true);
    if (Result.isFailure(inertClaim)) {
      expect(inertClaim.failure).toMatchObject({
        _tag: "ApplicationActionAuthorityCorruptionV1Error",
      });
    }
    expect((await fixture.target.drizzle.select({
      lifecycle: fxSystemApplicationActionInvocationsV1.lifecycle,
      executionGeneration:
        fxSystemApplicationActionInvocationsV1.executionGeneration,
    }).from(fxSystemApplicationActionInvocationsV1).where(eq(
      fxSystemApplicationActionInvocationsV1.requestKey,
      "application-action-request-1",
    )))[0]).toEqual({ lifecycle: "admitted", executionGeneration: 0n });
    const claimed = await runEffect(
      claimApplicationAuthorityActionExecution(
        "application-action-request-1",
        60_000,
        new Uint8Array(32).fill(0x44),
        actionContext,
      ),
    );
    expect(claimed.invocation).toMatchObject({
      executionAuthorityGeneration: "application_v1",
      lifecycle: "executing",
      executionGeneration: 1n,
    });
    const outboundRequest = Result.getOrThrow(
      makeExecutionEvidenceBodyReferenceV1(
        "outbound_http_request",
        new Uint8Array(32).fill(0x45),
        31,
      ),
    );
    const prepared = await runEffect(prepareExternalEffectAttemptV1(
      claimed.subject,
      {
        effectKind: "outbound_http",
        stableEffectKey: "application-effect-1",
        requestIdentitySha256: new Uint8Array(32).fill(0x46),
        request: outboundRequest,
      },
      actionContext,
    ));
    expect(prepared).toMatchObject({ effectOrdinal: 1n, state: "prepared" });
    await runEffect(declareExternalEffectDispatchV1(
      claimed.subject,
      1n,
      actionContext,
    ));
    const outboundResponse = Result.getOrThrow(
      makeExecutionEvidenceBodyReferenceV1(
        "outbound_http_response",
        new Uint8Array(32).fill(0x47),
        37,
      ),
    );
    await runEffect(confirmExternalEffectAttemptV1(
      claimed.subject,
      1n,
      { effectKind: "outbound_http", response: outboundResponse },
      actionContext,
    ));
    const resultReference = Result.getOrThrow(
      makeExecutionEvidenceBodyReferenceV1(
        "action_result",
        new Uint8Array(32).fill(0x48),
        23,
      ),
    );
    const settled = await runEffect(
      settleApplicationAuthorityActionInvocation(
        claimed.subject,
        { lifecycle: "completed", result: resultReference },
        actionContext,
      ),
    );
    expect(settled).toMatchObject({
      executionAuthorityGeneration: "application_v1",
      lifecycle: "completed",
      lastEffectOrdinal: 1n,
    });

    const cancellationRequest = makeRequest(
      "application-action-cancellation-1",
      0x49,
    );
    await runEffect(admitApplicationAuthorityActionInvocation({
      selection: active.selection,
      request: cancellationRequest,
      executionAuthority: admitted.executionAuthority,
      invocationId: "00000000-0000-4000-8000-000000000404",
    }, actionContext));
    const cancelled = await runEffect(
      requestApplicationAuthorityActionCancellation(
        "application-action-cancellation-1",
        actionContext,
      ),
    );
    expect(cancelled).toMatchObject({
      executionAuthorityGeneration: "application_v1",
      lifecycle: "cancelled",
      terminalCode: "cancelled_before_execution",
    });

    const recoveryRequest = makeRequest(
      "application-action-recovery-1",
      0x4a,
    );
    await runEffect(admitApplicationAuthorityActionInvocation({
      selection: active.selection,
      request: recoveryRequest,
      executionAuthority: admitted.executionAuthority,
      invocationId: "00000000-0000-4000-8000-000000000405",
    }, actionContext));
    const recoveryClaimed = await runEffect(
      claimApplicationAuthorityActionExecution(
      "application-action-recovery-1",
      60_000,
      new Uint8Array(32).fill(0x4b),
      actionContext,
    ));
    await fixture.target.drizzle.update(
      fxSystemApplicationActionInvocationsV1,
    ).set({
      invocationTime: new Date(0),
      executionDeadline: new Date(1),
    }).where(eq(
      fxSystemApplicationActionInvocationsV1.requestKey,
      "application-action-recovery-1",
    ));
    const recovered = await runEffect(
      recoverExpiredApplicationAuthorityActionExecution(
        "application-action-recovery-1",
        actionContext,
      ),
    );
    expect(recovered).toMatchObject({
      executionAuthorityGeneration: "application_v1",
      lifecycle: "admitted",
      executionGeneration: 1n,
      invocationTime: null,
      executionDeadline: null,
      randomSeedSha256: null,
    });
    const recoveryReclaimed = await runEffect(
      claimApplicationAuthorityActionExecution(
        "application-action-recovery-1",
        60_000,
        new Uint8Array(32).fill(0x4c),
        actionContext,
      ),
    );
    expect(recoveryReclaimed.invocation.executionGeneration).toBe(2n);
    const staleSubject = await runEffect(Effect.result(
      prepareExternalEffectAttemptV1(
        recoveryClaimed.subject,
        {
          effectKind: "outbound_http",
          stableEffectKey: "stale-recovered-subject",
          requestIdentitySha256: new Uint8Array(32).fill(0x4d),
          request: outboundRequest,
        },
        actionContext,
      ),
    ));
    expect(Result.isFailure(staleSubject)).toBe(true);
    if (Result.isFailure(staleSubject)) {
      expect(staleSubject.failure).toMatchObject({
        _tag: "ApplicationActionAuthorityCorruptionV1Error",
      });
    }
    await runEffect(settleApplicationAuthorityActionInvocation(
      recoveryReclaimed.subject,
      { lifecycle: "completed", result: resultReference },
      actionContext,
    ));

    const uncertainRequest = makeRequest(
      "application-action-uncertain-1",
      0x4e,
    );
    await runEffect(admitApplicationAuthorityActionInvocation({
      selection: active.selection,
      request: uncertainRequest,
      executionAuthority: admitted.executionAuthority,
      invocationId: "00000000-0000-4000-8000-000000000409",
    }, actionContext));
    const uncertainClaimed = await runEffect(
      claimApplicationAuthorityActionExecution(
        "application-action-uncertain-1",
        60_000,
        new Uint8Array(32).fill(0x4f),
        actionContext,
      ),
    );
    await runEffect(prepareExternalEffectAttemptV1(
      uncertainClaimed.subject,
      {
        effectKind: "outbound_http",
        stableEffectKey: "possibly-dispatched-effect",
        requestIdentitySha256: new Uint8Array(32).fill(0x50),
        request: outboundRequest,
      },
      actionContext,
    ));
    await runEffect(declareExternalEffectDispatchV1(
      uncertainClaimed.subject,
      1n,
      actionContext,
    ));
    await fixture.target.drizzle.update(
      fxSystemApplicationActionInvocationsV1,
    ).set({
      invocationTime: new Date(0),
      executionDeadline: new Date(1),
    }).where(eq(
      fxSystemApplicationActionInvocationsV1.requestKey,
      "application-action-uncertain-1",
    ));
    const uncertain = await runEffect(
      recoverExpiredApplicationAuthorityActionExecution(
        "application-action-uncertain-1",
        actionContext,
      ),
    );
    expect(uncertain).toMatchObject({
      executionAuthorityGeneration: "application_v1",
      lifecycle: "uncertain",
      terminalCode: "execution_expired_after_possible_dispatch",
    });

    const detachedRequest = makeRequest(
      "application-action-detachment-1",
      0x4d,
    );
    const callerOwnedRequestBytes = detachedRequest.canonicalBytes;
    const expectedRequestSha256 = new Uint8Array(
      await globalThis.crypto.subtle.digest(
        "SHA-256",
        copyBytesToArrayBuffer(callerOwnedRequestBytes),
      ),
    );
    const detached = await runEffect(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request: detachedRequest,
        executionAuthority: admitted.executionAuthority,
        invocationId: "00000000-0000-4000-8000-000000000407",
      }, Object.freeze({
        ...actionContext,
        sha256: Object.freeze({
          hash: (bytes: Uint8Array) => Effect.promise(async () => {
            callerOwnedRequestBytes.fill(0);
            return new Uint8Array(await globalThis.crypto.subtle.digest(
              "SHA-256",
              copyBytesToArrayBuffer(bytes),
            ));
          }),
        }),
      })),
    );
    expect(Array.from(callerOwnedRequestBytes).every(byte => byte === 0))
      .toBe(true);
    expect(detached.invocation.requestIdentitySha256)
      .toEqual(expectedRequestSha256);
    await expect(fixture.target.drizzle.execute(
      `update fx_system_application_action_invocation_v1
       set execution_authority_generation = 'unknown'
       where request_key = 'application-action-detachment-1'`,
    )).rejects.toThrow();

    const rollbackRequest = makeRequest(
      "application-action-rollback-1",
      0x4e,
    );
    await expect(runEffect(admitApplicationAuthorityActionInvocation({
      selection: active.selection,
      request: rollbackRequest,
      executionAuthority: admitted.executionAuthority,
      invocationId: "00000000-0000-4000-8000-000000000408",
    }, Object.freeze({
      ...actionContext,
      proofAfterTransactionStep: (step: string) => {
        if (step === "afterAdmissionInsert") {
          throw new Error("injected Application action admission failure");
        }
      },
    })))).rejects.toThrow("injected Application action admission failure");
    expect(await fixture.target.drizzle.select({
      requestKey: fxSystemApplicationActionInvocationsV1.requestKey,
    }).from(fxSystemApplicationActionInvocationsV1).where(eq(
      fxSystemApplicationActionInvocationsV1.requestKey,
      "application-action-rollback-1",
    ))).toHaveLength(0);

    const jsonCorruptRequest = makeRequest(
      "application-action-json-corrupt-1",
      0x51,
    );
    await runEffect(admitApplicationAuthorityActionInvocation({
      selection: active.selection,
      request: jsonCorruptRequest,
      executionAuthority: admitted.executionAuthority,
      invocationId: "00000000-0000-4000-8000-000000000410",
    }, actionContext));
    await fixture.target.drizzle.execute(
      `update fx_system_application_action_invocation_v1
       set application_execution_authority_json = '{"bad":true}'::jsonb
       where request_key = 'application-action-json-corrupt-1'`,
    );
    const jsonCorrupt = await runEffect(Effect.result(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request: jsonCorruptRequest,
        executionAuthority: admitted.executionAuthority,
        invocationId: "00000000-0000-4000-8000-000000000411",
      }, actionContext),
    ));
    expect(Result.isFailure(jsonCorrupt)).toBe(true);
    if (Result.isFailure(jsonCorrupt)) {
      expect(jsonCorrupt.failure).toMatchObject({
        _tag: "ApplicationActionAuthorityCorruptionV1Error",
      });
    }

    const bytesCorruptRequest = makeRequest(
      "application-action-bytes-corrupt-1",
      0x52,
    );
    await runEffect(admitApplicationAuthorityActionInvocation({
      selection: active.selection,
      request: bytesCorruptRequest,
      executionAuthority: admitted.executionAuthority,
      invocationId: "00000000-0000-4000-8000-000000000412",
    }, actionContext));
    await fixture.target.drizzle.update(
      fxSystemApplicationActionInvocationsV1,
    ).set({
      applicationExecutionAuthorityCanonicalBytes: new Uint8Array([0x7b]),
    }).where(eq(
      fxSystemApplicationActionInvocationsV1.requestKey,
      "application-action-bytes-corrupt-1",
    ));
    const bytesCorrupt = await runEffect(Effect.result(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request: bytesCorruptRequest,
        executionAuthority: admitted.executionAuthority,
        invocationId: "00000000-0000-4000-8000-000000000413",
      }, actionContext),
    ));
    expect(Result.isFailure(bytesCorrupt)).toBe(true);
    if (Result.isFailure(bytesCorrupt)) {
      expect(bytesCorrupt.failure).toMatchObject({
        _tag: "ApplicationActionAuthorityCorruptionV1Error",
      });
    }
    await expect(fixture.target.drizzle.update(
      fxSystemApplicationActionInvocationsV1,
    ).set({
      applicationRevisionId: "forbidden-legacy-revision",
    }).where(eq(
      fxSystemApplicationActionInvocationsV1.requestKey,
      "application-action-request-1",
    ))).rejects.toThrow();

    await fixture.target.drizzle.update(
      fxSystemApplicationActionInvocationsV1,
    ).set({
      applicationExecutionAuthoritySha256: new Uint8Array(32).fill(0xff),
    }).where(eq(
      fxSystemApplicationActionInvocationsV1.requestKey,
      "application-action-request-1",
    ));
    const corrupt = await runEffect(Effect.result(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request,
        executionAuthority: admitted.executionAuthority,
        invocationId: "00000000-0000-4000-8000-000000000403",
      }, actionContext),
    ));
    expect(Result.isFailure(corrupt)).toBe(true);
    if (Result.isFailure(corrupt)) {
      expect(corrupt.failure).toMatchObject({
        _tag: "ApplicationActionAuthorityCorruptionV1Error",
      });
    }

    await fixture.target.drizzle.update(fxSystemApplicationActiveHeads).set({
      headSha256: new Uint8Array(32).fill(0xee),
    }).where(eq(
      fxSystemApplicationActiveHeads.scopeId,
      active.basis.authority.scopeId,
    ));
    const corruptHeadAdmission = await runEffect(Effect.result(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request: makeRequest("application-action-corrupt-head-1", 0x60),
        executionAuthority: admitted.executionAuthority,
        invocationId: "00000000-0000-4000-8000-000000000420",
      }, actionContext),
    ));
    expect(Result.isFailure(corruptHeadAdmission)).toBe(true);
    if (Result.isFailure(corruptHeadAdmission)) {
      expect(corruptHeadAdmission.failure).toMatchObject({
        _tag: "ApplicationActionAuthorityCorruptionV1Error",
      });
    }
    const staleSelection = await runEffect(Effect.result(
      selectApplicationActionAdmission(
        active.selection,
        "users:get",
        Object.freeze({
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          schema: fixture.schema,
          authority: fixture.authorityPorts,
        }),
      ),
    ));
    expect(Result.isFailure(staleSelection)).toBe(true);
    if (Result.isFailure(staleSelection)) {
      expect(staleSelection.failure).toMatchObject({
        operation: "validateSelection",
        reason: "storedState",
      });
    }
    await fixture.target.drizzle.execute(
      `drop table fx_system_application_active_head cascade`,
    );
    const unavailableHeadAdmission = await runEffect(Effect.result(
      admitApplicationAuthorityActionInvocation({
        selection: active.selection,
        request: makeRequest("application-action-unavailable-head-1", 0x61),
        executionAuthority: admitted.executionAuthority,
        invocationId: "00000000-0000-4000-8000-000000000421",
      }, actionContext),
    ));
    expect(Result.isFailure(unavailableHeadAdmission)).toBe(true);
    if (Result.isFailure(unavailableHeadAdmission)) {
      expect(unavailableHeadAdmission.failure).toMatchObject({
        _tag: "ApplicationActionAuthorityIntegrationV1Error",
        operation: "validateApplicationSelection",
        cause: { reason: "resourceFailure" },
      });
    }
  });

  it("rolls back history and head together after a late injected failure", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
      faultAfter: point => {
        if (point === "headWritten") throw new Error("injected late failure");
      },
    });

    const result = await runEffect(Effect.result(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    })));

    expect(Result.isFailure(result)).toBe(true);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_activation",
    )).toBe(0);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_active_head",
    )).toBe(0);
  });

  it("surfaces a committed uncertain activation and cold-replays its exact history", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const resolved = await fixture.authorityPorts.scopeClockTargets.resolve();
    const runner = Reflect.get(
      resolved,
      RUN_LOCATED_READ_COMMITTED_V1,
    );
    if (typeof runner !== "function") {
      throw new Error("Expected the located read-committed runner.");
    }
    const runReadCommitted = runner as RunLocatedReadCommittedTransactionV1;
    let uncertain = true;
    const uncertainTarget = Object.freeze({
      ...resolved,
      [RUN_LOCATED_READ_COMMITTED_V1]: async <Value>(
        work: (tx: AppRowTransaction) => Promise<Value>,
      ): Promise<Value> => {
        const result = await runReadCommitted(work);
        if (uncertain && typeof result === "object" && result !== null &&
          Reflect.get(result, "status") === "activated") {
          uncertain = false;
          throw new LocatedReadCommittedTransactionFailureV1(Object.freeze({
            kind: "decisionUncertain",
            settlementCause: new Error("lost Application activation response"),
          }));
        }
        return result;
      },
    });
    const originalResolve = fixture.authorityPorts.scopeClockTargets.resolve;
    fixture.authorityPorts.scopeClockTargets.resolve = async () =>
      uncertainTarget;
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });

    const first = await runEffect(Effect.result(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    })));
    expect(Result.isFailure(first)).toBe(true);
    if (Result.isFailure(first)) {
      expect(first.failure).toMatchObject({ reason: "decisionUncertain" });
    }
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_activation",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_active_head",
    )).toBe(1);

    const replay = await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    expect(replay).toMatchObject({
      disposition: "replayed",
      activationSequence: 1n,
    });
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_activation",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_active_head",
    )).toBe(1);
  });

  it("fails closed when the active-head canonical evidence is corrupted", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    await fixture.target.query(
      `update fx_system_application_active_head
          set head_bytes = $1
        where scope_id = $2`,
      [new Uint8Array([1]), fixture.authority.scopeId],
    );

    const result = await runEffect(Effect.result(activation.readActive()));
    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "storedState" });
    }
  });

  it("moves the head with the prior CAS token and invalidates the issued selection", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    const first = await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const firstSelection = await runEffect(activation.readActive());
    const nextRevisionId = await createAdditionalApplicationRevision(fixture);
    const nextReadiness = await runEffect(fixture.repository.settle({
      deploymentId: fixture.input.deploymentId,
      revisionId: nextRevisionId,
    }));
    expect(nextReadiness).toMatchObject({ status: "ready" });

    const stale = await runEffect(Effect.result(activation.activate({
      revisionId: nextRevisionId,
      expectedActiveHead: Object.freeze({
        activationSequence: first.expectedActiveHead.activationSequence,
        headSha256: "0".repeat(64),
      }),
    })));
    expect(Result.isFailure(stale)).toBe(true);
    if (Result.isFailure(stale)) {
      expect(stale.failure).toMatchObject({ reason: "expectedHead" });
    }
    const second = await runEffect(activation.activate({
      revisionId: nextRevisionId,
      expectedActiveHead: first.expectedActiveHead,
    }));
    expect(second).toMatchObject({
      activationSequence: 2n,
      previousActivationSequence: 1n,
    });
    const staleSelection = await fixture.target.drizzle.transaction(tx =>
      runEffect(Effect.result(Effect.gen(function* () {
        const clock = yield* lockScopeClockForShareInTransactionEffect(
          tx,
          fixture.authority.scopeId,
        );
        return yield* validateApplicationActiveSelectionInTransaction(
          firstSelection.selection,
          tx,
          clock,
        );
      })))
    );
    expect(Result.isFailure(staleSelection)).toBe(true);
    if (Result.isFailure(staleSelection)) {
      expect(staleSelection.failure).toMatchObject({ reason: "concurrentHead" });
    }
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_activation",
    )).toBe(2);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_active_head",
    )).toBe(1);
  });

  it("opens and revalidates an Application query snapshot from exact active function evidence", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const metadata = await runEffect(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        queryBudget(),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      const revalidated = yield* revalidateApplicationQuerySnapshot(
        opened.snapshot,
      );
      expect(revalidated).toEqual(opened.metadata);
      const finalized = yield* Effect.result(
        finalizeApplicationQueryEvaluationSnapshot(opened.snapshot),
      );
      expect(Result.isFailure(finalized)).toBe(true);
      if (Result.isFailure(finalized)) {
        expect(finalized.failure).toMatchObject({
          operation: "finalizeEvaluation",
          reason: "invalidComposition",
        });
      }
      return revalidated;
    })));

    expect(metadata).toMatchObject({
      function: {
        path: "users:get",
        kind: "query",
        visibility: "public",
      },
      snapshotToken: {
        scopeId: fixture.authority.scopeId,
      },
    });
    expect(metadata.function.entrySha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("accepts Application query snapshots at or above the retained floor and rejects below it", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    await fixture.target.query(
      `update fx_system_scope_clock
       set last_commit_seq = 2, oldest_available_commit_seq = 1
       where scope_id = $1`,
      [fixture.authority.scopeId],
    );
    const proof = await runEffect(Effect.scoped(Effect.gen(function* () {
      const active = yield* activation.readActive();
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        queryBudget(),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      const aboveFloor = yield* revalidateApplicationQuerySnapshot(
        opened.snapshot,
      );
      yield* Effect.promise(() => fixture.target.query(
        `update fx_system_scope_clock
         set oldest_available_commit_seq = 2 where scope_id = $1`,
        [fixture.authority.scopeId],
      ));
      const atFloor = yield* revalidateApplicationQuerySnapshot(
        opened.snapshot,
      );
      yield* Effect.promise(() => fixture.target.query(
        `update fx_system_scope_clock
         set last_commit_seq = 3, oldest_available_commit_seq = 3
         where scope_id = $1`,
        [fixture.authority.scopeId],
      ));
      const belowFloor = yield* Effect.result(
        revalidateApplicationQuerySnapshot(opened.snapshot),
      );
      return { opened, aboveFloor, atFloor, belowFloor };
    })));
    expect(proof.opened.metadata.snapshotToken.commitSeq).toBe(2n);
    expect(proof.aboveFloor).toEqual(proof.opened.metadata);
    expect(proof.atFloor).toEqual(proof.opened.metadata);
    expect(Result.isFailure(proof.belowFloor)).toBe(true);
    if (Result.isFailure(proof.belowFloor)) {
      expect(proof.belowFloor.failure).toMatchObject({
        operation: "revalidate",
        reason: "historyUnavailable",
      });
    }
  });

  it("rejects corrupted stored Application function evidence before issuing a query snapshot", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    await fixture.target.query(
      `update fx_system_application_function_v1
          set entry_bytes = $1
        where scope_id = $2 and revision_id = $3`,
      [new Uint8Array([1]), fixture.authority.scopeId, fixture.input.revisionId],
    );

    const result = await runEffect(Effect.result(Effect.scoped(
      openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        queryBudget(),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      ),
    )));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "storedFunction" });
    }
  });

  it("rejects a developer-index port issued by another control database", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const result = await runEffect(Effect.result(Effect.scoped(
      openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        queryBudget(),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: createAppDeveloperIndexDefinitionPortV1(
            fixture.target.drizzle,
          ),
        },
      ),
    )));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({ reason: "invalidComposition" });
    }
  });

  it("enforces point-read budgets and retained-history staleness on an issued query snapshot", async () => {
    const fixture = await readinessFixture({ includeTable: true });
    const schemaVersionId = await prepareReadinessAuthorities(fixture);
    await enablePhysicalBuilds(fixture, schemaVersionId);
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const result = await runEffect(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        Object.freeze({
          ...queryBudget(),
          maximumPointReads: 1,
        }),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      const missing = yield* readApplicationQueryPoint(
        opened.snapshot,
        "users",
        decodeAppDocumentIdV1("1:00000000-0000-0000-0000-000000000001"),
      );
      const budget = yield* Effect.result(readApplicationQueryPoint(
        opened.snapshot,
        "users",
        decodeAppDocumentIdV1("1:00000000-0000-0000-0000-000000000002"),
      ));
      const staleOpened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        queryBudget(),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      yield* Effect.promise(() => fixture.target.query(
        `update fx_system_scope_clock
            set last_commit_seq = last_commit_seq + 1,
                oldest_available_commit_seq = last_commit_seq + 1
          where scope_id = $1`,
        [fixture.authority.scopeId],
      ));
      const stale = yield* Effect.result(
        revalidateApplicationQuerySnapshot(opened.snapshot),
      );
      const stalePoint = yield* Effect.result(readApplicationQueryPoint(
        staleOpened.snapshot,
        "users",
        decodeAppDocumentIdV1("1:00000000-0000-0000-0000-000000000003"),
      ));
      return { missing, budget, stale, stalePoint };
    })));

    expect(result.missing).toEqual({ kind: "missing" });
    expect(Result.isFailure(result.budget)).toBe(true);
    if (Result.isFailure(result.budget)) {
      expect(result.budget.failure).toMatchObject({ reason: "budgetExceeded" });
    }
    expect(Result.isFailure(result.stale)).toBe(true);
    if (Result.isFailure(result.stale)) {
      expect(result.stale.failure).toMatchObject({
        operation: "revalidate",
        reason: "historyUnavailable",
      });
    }
    expect(Result.isFailure(result.stalePoint)).toBe(true);
    if (Result.isFailure(result.stalePoint)) {
      expect(result.stalePoint.failure).toMatchObject({
        operation: "pointRead",
        reason: "historyUnavailable",
      });
    }
  });

  it("finalizes one immutable deduplicated Application query dependency receipt", async () => {
    const fixture = await readinessFixture({
      includeTable: true,
      includeIndex: true,
    });
    const schemaVersionId = await prepareReadinessAuthorities(fixture);
    await insertApplicationQueryRow(fixture, schemaVersionId);
    await enablePhysicalBuilds(fixture, schemaVersionId);
    await runEffect(fixture.repository.settle(fixture.input));
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const proof = await runEffect(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        queryBudget(),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
        { dependencyCapture: "evaluation" },
      );
      const presentId = decodeAppDocumentIdV1(
        "1:11111111-1111-1111-1111-111111111111",
      );
      const missingId = decodeAppDocumentIdV1(
        "1:00000000-0000-0000-0000-000000000001",
      );
      yield* readApplicationQueryPoint(opened.snapshot, "users", presentId);
      yield* readApplicationQueryPoint(opened.snapshot, "users", missingId);
      yield* readApplicationQueryPoint(opened.snapshot, "users", missingId);
      yield* readApplicationQueryIndex(
        opened.snapshot,
        "users",
        "by_name",
        {},
        10,
      );
      yield* readApplicationQueryIndex(
        opened.snapshot,
        "users",
        "by_name",
        {},
        10,
      );
      const rejected = yield* Effect.result(readApplicationQueryPoint(
        opened.snapshot,
        "missing_table",
        missingId,
      ));
      const receipt = yield* finalizeApplicationQueryEvaluationSnapshot(
        opened.snapshot,
      );
      const readAfterFinalize = yield* Effect.result(
        readApplicationQueryPoint(opened.snapshot, "users", missingId),
      );
      const finalizeAgain = yield* Effect.result(
        finalizeApplicationQueryEvaluationSnapshot(opened.snapshot),
      );
      return { receipt, rejected, readAfterFinalize, finalizeAgain };
    })));

    expect(Result.isFailure(proof.rejected)).toBe(true);
    expect(proof.receipt.dependencies).toHaveLength(3);
    expect(proof.receipt.dependencies).toEqual(expect.arrayContaining([
      { kind: "appRowPoint", documentId:
        "1:11111111-1111-1111-1111-111111111111" },
      { kind: "appRowPoint", documentId:
        "1:00000000-0000-0000-0000-000000000001" },
      { kind: "appTable", tableId: 1 },
    ]));
    expect(proof.receipt.metadata.snapshotToken.commitSeq).toBe(1n);
    expect(Object.isFrozen(proof.receipt)).toBe(true);
    expect(Object.isFrozen(proof.receipt.dependencies)).toBe(true);
    expect(Result.isFailure(proof.readAfterFinalize)).toBe(true);
    if (Result.isFailure(proof.readAfterFinalize)) {
      expect(proof.readAfterFinalize.failure).toMatchObject({
        operation: "pointRead",
        reason: "invalidComposition",
      });
    }
    expect(Result.isFailure(proof.finalizeAgain)).toBe(true);
    if (Result.isFailure(proof.finalizeAgain)) {
      expect(proof.finalizeAgain.failure).toMatchObject({
        operation: "finalizeEvaluation",
        reason: "invalidComposition",
      });
    }
  });

  it("rejects a query snapshot after the Application active head moves", async () => {
    const fixture = await readinessFixture();
    await prepareReadinessAuthorities(fixture);
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    const first = await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());

    const stale = await runEffect(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        queryBudget(),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
        { dependencyCapture: "evaluation" },
      );
      const nextRevisionId = yield* Effect.promise(() =>
        createAdditionalApplicationRevision(fixture)
      );
      yield* fixture.repository.settle({
        deploymentId: fixture.input.deploymentId,
        revisionId: nextRevisionId,
      });
      yield* activation.activate({
        revisionId: nextRevisionId,
        expectedActiveHead: first.expectedActiveHead,
      });
      return yield* Effect.result(
        finalizeApplicationQueryEvaluationSnapshot(opened.snapshot),
      );
    })));

    expect(Result.isFailure(stale)).toBe(true);
    if (Result.isFailure(stale)) {
      expect(stale.failure).toMatchObject({
        _tag: "ApplicationActivationError",
        operation: "validateSelection",
        reason: "concurrentHead",
      });
    }
  });

  it("closes queued query reads before they start another transaction", async () => {
    const fixture = await readinessFixture({ includeTable: true });
    const schemaVersionId = await prepareReadinessAuthorities(fixture);
    await enablePhysicalBuilds(fixture, schemaVersionId);
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());
    const resolved = await fixture.authorityPorts.scopeClockTargets.resolve();
    const runner = Reflect.get(resolved, RUN_LOCATED_READ_COMMITTED_V1);
    if (typeof runner !== "function") {
      throw new Error("Expected the located query transaction runner.");
    }
    const runReadCommitted = runner as RunLocatedReadCommittedTransactionV1;
    let transactionStarts = 0;
    const firstStarted = deferred<void>();
    const releaseFirst = deferred<void>();
    const observedTarget = Object.freeze({
      ...resolved,
      [RUN_LOCATED_READ_COMMITTED_V1]: async <Value>(
        work: (tx: AppRowTransaction) => Promise<Value>,
      ): Promise<Value> => {
        transactionStarts += 1;
        if (transactionStarts === 2) {
          firstStarted.resolve();
          await releaseFirst.promise;
        }
        return runReadCommitted(work);
      },
    });
    fixture.authorityPorts.scopeClockTargets.resolve = async () => observedTarget;
    const scope = await runEffect(Scope.make());
    const opened = await runEffect(openApplicationQuerySnapshot(
      active.selection,
      "users:get",
      queryBudget(),
      {
        deploymentId: fixture.input.deploymentId,
        controlDb: fixture.control.drizzle,
        authority: fixture.authorityPorts,
        schema: fixture.schema,
        developerIndexes: queryDeveloperIndexes(fixture),
      },
    ).pipe(Scope.provide(scope)));
    const read = () => readApplicationQueryPoint(
      opened.snapshot,
      "users",
      decodeAppDocumentIdV1("1:00000000-0000-0000-0000-000000000001"),
    );
    const first = Effect.runPromise(Effect.result(read()));
    await firstStarted.promise;
    const queued = Array.from({ length: 8 }, () =>
      Effect.runPromise(Effect.result(read()))
    );
    await runEffect(Scope.close(scope, Exit.succeed(undefined)));
    releaseFirst.resolve();
    const [firstResult, ...queuedResults] = await Promise.all([first, ...queued]);

    expect(Result.isSuccess(firstResult)).toBe(true);
    expect(queuedResults.every(Result.isFailure)).toBe(true);
    expect(transactionStarts).toBe(2);
  });

  it("materializes an ordered developer-index page from the active snapshot", async () => {
    const fixture = await readinessFixture({
      includeTable: true,
      includeIndex: true,
    });
    const schemaVersionId = await prepareReadinessAuthorities(fixture);
    const expected = await insertApplicationQueryRow(fixture, schemaVersionId);
    await enablePhysicalBuilds(fixture, schemaVersionId);
    await runEffect(fixture.repository.settle(fixture.input));
    const activation = makeApplicationActivationRepository({
      deploymentId: fixture.input.deploymentId,
      readiness: fixture.repository,
      authority: fixture.authorityPorts,
    });
    await runEffect(activation.activate({
      revisionId: fixture.input.revisionId,
      expectedActiveHead: null,
    }));
    const active = await runEffect(activation.readActive());

    const page = await runEffect(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        queryBudget(),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      return yield* readApplicationQueryIndex(
        opened.snapshot,
        "users",
        "by_name",
        {},
        10,
      );
    })));

    expect(page).toEqual({ documents: [expected.value], isDone: true });

    const indexBudget = await runEffect(Effect.result(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        Object.freeze({ ...queryBudget(), maximumIndexReads: 1 }),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      yield* readApplicationQueryIndex(opened.snapshot, "users", "by_name", {}, 10);
      return yield* readApplicationQueryIndex(
        opened.snapshot,
        "users",
        "by_name",
        {},
        10,
      );
    }))));
    expect(Result.isFailure(indexBudget)).toBe(true);
    if (Result.isFailure(indexBudget)) {
      expect(indexBudget.failure).toMatchObject({ reason: "budgetExceeded" });
    }

    const documentBudget = await runEffect(Effect.result(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        Object.freeze({ ...queryBudget(), maximumDocuments: 1 }),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      yield* readApplicationQueryIndex(opened.snapshot, "users", "by_name", {}, 10);
      return yield* readApplicationQueryPoint(
        opened.snapshot,
        "users",
        decodeAppDocumentIdV1(
          "1:11111111-1111-1111-1111-111111111111",
        ),
      );
    }))));
    expect(Result.isFailure(documentBudget)).toBe(true);
    if (Result.isFailure(documentBudget)) {
      expect(documentBudget.failure).toMatchObject({ reason: "budgetExceeded" });
    }

    const semanticBudget = await runEffect(Effect.result(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        Object.freeze({ ...queryBudget(), maximumSemanticBytes: 1 }),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      return yield* readApplicationQueryIndex(
        opened.snapshot,
        "users",
        "by_name",
        {},
        10,
      );
    }))));
    expect(Result.isFailure(semanticBudget)).toBe(true);
    if (Result.isFailure(semanticBudget)) {
      expect(semanticBudget.failure).toMatchObject({ reason: "budgetExceeded" });
    }

    const resolved = await fixture.authorityPorts.scopeClockTargets.resolve();
    const runner = Reflect.get(resolved, RUN_LOCATED_READ_COMMITTED_V1);
    if (typeof runner !== "function") {
      throw new Error("Expected the located query transaction runner.");
    }
    const runReadCommitted = runner as RunLocatedReadCommittedTransactionV1;
    let transactionStarts = 0;
    const observedTarget = Object.freeze({
      ...resolved,
      [RUN_LOCATED_READ_COMMITTED_V1]: <Value>(
        work: (tx: AppRowTransaction) => Promise<Value>,
      ): Promise<Value> => {
        transactionStarts += 1;
        return runReadCommitted(work);
      },
    });
    fixture.authorityPorts.scopeClockTargets.resolve = async () => observedTarget;
    const fanOut = await runEffect(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        Object.freeze({ ...queryBudget(), maximumDocuments: 1 }),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      yield* readApplicationQueryIndex(opened.snapshot, "users", "by_name", {}, 10);
      const startsBeforeFanOut = transactionStarts;
      const results = yield* Effect.all(
        Array.from({ length: 8 }, () => Effect.result(
          readApplicationQueryPoint(
            opened.snapshot,
            "users",
            decodeAppDocumentIdV1(
              "1:11111111-1111-1111-1111-111111111111",
            ),
          ),
        )),
        { concurrency: "unbounded" },
      );
      return { results, startsBeforeFanOut };
    })));
    expect(fanOut.results.every(Result.isFailure)).toBe(true);
    expect(transactionStarts).toBe(fanOut.startsBeforeFanOut);

    await fixture.target.drizzle.update(fxSystemIndexBuildStates).set({
      lifecycle: "validating",
    }).where(eq(fxSystemIndexBuildStates.scopeId, fixture.authority.scopeId));
    const unavailable = await runEffect(Effect.result(Effect.scoped(Effect.gen(function* () {
      const opened = yield* openApplicationQuerySnapshot(
        active.selection,
        "users:get",
        queryBudget(),
        {
          deploymentId: fixture.input.deploymentId,
          controlDb: fixture.control.drizzle,
          authority: fixture.authorityPorts,
          schema: fixture.schema,
          developerIndexes: queryDeveloperIndexes(fixture),
        },
      );
      return yield* readApplicationQueryIndex(
        opened.snapshot,
        "users",
        "by_name",
        {},
        10,
      );
    }))));
    expect(Result.isFailure(unavailable)).toBe(true);
    if (Result.isFailure(unavailable)) {
      expect(unavailable.failure).toMatchObject({ reason: "indexUnavailable" });
    }
  });
});

type TestPersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

interface ReadinessFixtureOptions {
  readonly registerTaskCatalog?: boolean;
  readonly includeFunction?: boolean;
  readonly includeTable?: boolean;
  readonly includeIndex?: boolean;
  readonly includeTask?: boolean;
  readonly coldMode?: "normal" | "wrongTarget" | "advanceAuthority";
  readonly foreignSchemaControl?: boolean;
  readonly failSchemaPublication?: boolean;
  readonly functionKind?: "query" | "mutation" | "action";
}

async function readinessFixture(options: ReadinessFixtureOptions = {}) {
  const [control, target] = await Promise.all([
    createPGlitePersistence(),
    createPGlitePersistence(),
  ]);
  await Promise.all([control.migrate(), target.migrate()]);
  const schemaControl = options.foreignSchemaControl === true
    ? await createPGlitePersistence()
    : control;
  if (schemaControl !== control) await schemaControl.migrate();
  const deploymentId = "deployment_application_readiness";
  const provisioned = await createPGliteSplitScopeAuthorityProvisioner(
    control,
    {
      placementPlanner: { plan: () => LOCATOR },
      targetResolver: {
        resolve: async locator =>
          createPGliteLocatedSplitScopeClockTarget(target, locator),
      },
      randomUuid: uuidSequence(1, 2),
    },
  ).ensure({
    deploymentId,
    projectId: "project_application_readiness",
  });
  await target.query(
    `update fx_system_scope_clock
        set storage_generation = 'flarexdb_v1'
      where scope_id = $1`,
    [provisioned.scope.scopeId],
  );
  const clock = await target.getScopeClock(provisioned.scope.scopeId);
  if (clock === null) throw new Error("Expected located Application clock.");
  if (clock.storageGeneration !== "flarexdb_v1") {
    throw new Error("Expected FlarexDB Application storage generation.");
  }
  const authority: ApplicationAnalysisAuthority = Object.freeze({
    scopeId: clock.scopeId,
    storageGeneration: clock.storageGeneration,
    storageGenerationFence: clock.storageGenerationFence,
    epoch: clock.epoch,
  });
  const manifest = applicationManifest(
    options.includeFunction !== false,
    options.includeTable === true,
    options.includeIndex === true,
    options.functionKind ?? "query",
  );
  const analysis = await createApplicationRevision(target, authority, manifest);
  const publication = await runEffect(
    makeApplicationPublicationRepository(target.drizzle).publish({
      authority,
      revisionId: analysis.revision.revisionId,
      candidateId: analysis.candidateId,
      analysisId: analysis.analysisId,
      manifestSha256: analysis.manifestSha256,
      manifest: Result.getOrThrow(
        canonicalizeApplicationManifestV1(analysis.manifest),
      ).manifest,
    }),
  );
  if (options.registerTaskCatalog !== false) {
    const catalog = await runEffect(hashCanonicalTaskCatalogV1({
      version: 1,
      tasks: options.includeTask === true ? [taskManifest()] : [],
    }, taskSha256));
    const bindings = await runEffect(produceApplicationTaskBindingsV1({
      definition: preparedDefinition(),
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
    }, taskSha256));
    await runEffect(
      makeApplicationTaskBindingRepository(target.drizzle).register({
        authority,
        bindings,
      }),
    );
  }
  const locatedTarget = createLocatedAppSchemaCandidateValidationTarget(
    target.drizzle,
    LOCATOR,
  );
  const authorityPorts = Object.freeze({
    scopeMetadata: control,
    provisioningReceipts: {
      getScopeAuthorityProvisioningReceipt: (scopeId: typeof authority.scopeId) =>
        getScopeAuthorityProvisioningReceipt(control.drizzle, scopeId),
    },
    scopeClockTargets: { resolve: async () => locatedTarget },
  });
  const candidateValidation = createAppSchemaCandidateValidationPort({
    controlDb: control.drizzle,
    authority: authorityPorts,
  });
  const uniqueConstraints = createAppUniqueConstraintDefinitionPortV1(
    control.drizzle,
  );
  const uniqueConstraintEligibility =
    createAppUniqueConstraintSetEligibilityPortV1({
      controlDb: control.drizzle,
      authority: authorityPorts,
    }, uniqueConstraints);
  const pointCommit = createPointCommitPublisherPortV1({
    scopeMetadata: control,
    provisioningReceipts: authorityPorts.provisioningReceipts,
    scopeSessionTargets: {
      resolve: async () => {
        throw new Error("Application readiness must not open a commit session.");
      },
    },
  }, { uniqueConstraints, uniqueConstraintEligibility });
  const physicalDefinitionLifecycle = createPhysicalDefinitionLifecyclePort({
    controlDb: control.drizzle,
    authority: authorityPorts,
  });
  let materializations = 0;
  const readinessContext = Object.freeze({
    controlDb: control.drizzle,
    authority: authorityPorts,
    schema: makeApplicationSchemaAuthorityPublisher({
      db: schemaControl.drizzle,
      runTransaction: options.failSchemaPublication === true
        ? async () => {
          throw new Error("injected Application schema publication failure");
        }
        : run => schemaControl.drizzle.transaction(run),
    }),
    taskCatalog: createApplicationTaskCatalogSnapshotPort(),
    candidateValidation: createAppSchemaCandidateReadinessPort(
      candidateValidation,
    ),
    pointCommit,
    physicalDefinitionLifecycle,
    cold: {
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
      materialize: (input: {
        readonly target: CanonicalApplicationRuntimeTargetV1["target"];
        readonly manifest: ApplicationManifestV1;
      }) => Effect.promise(async () => {
        materializations += 1;
        const canonicalTarget = Result.getOrThrow(
          canonicalizeApplicationRuntimeTargetV1(input.target),
        );
        const targetSha256 = await sha256Hex(canonicalTarget.canonicalBytes);
        if (options.coldMode === "advanceAuthority") {
          await target.query(
            `update fx_system_scope_clock
                set storage_generation_fence = storage_generation_fence + 1
              where scope_id = $1`,
            [authority.scopeId],
          );
        }
        return Result.getOrThrow(canonicalizeApplicationRuntimeColdReceiptV1({
          format: "flarex.application-runtime-cold-receipt",
          version: 1,
          status: "resolved",
          runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
          compatibilityDate: COMPATIBILITY_DATE,
          sourceArtifactRootSha256: input.target.sourceArtifactRootSha256,
          manifestSha256: input.target.manifestSha256,
          publicationSha256: input.target.publicationSha256,
          runtimeTargetSha256: options.coldMode === "wrongTarget"
            ? "f".repeat(64)
            : targetSha256,
          functionPath: input.target.function.path,
          functionKind: input.target.function.kind,
          visibility: input.target.function.visibility,
        }));
      }),
    },
  });
  const repository = makeApplicationReadinessRepository(readinessContext);
  return Object.freeze({
    control,
    target,
    authority,
    authorityPorts,
    candidateValidation,
    pointCommit,
    physicalDefinitionLifecycle,
    readinessContext,
    repository,
    schema: readinessContext.schema,
    input: Object.freeze({
      deploymentId,
      revisionId: publication.revisionId,
    }),
    materializationCount: () => materializations,
  });
}

function queryBudget() {
  return Object.freeze({
    maximumPointReads: 16,
    maximumIndexReads: 16,
    maximumDocuments: 64,
    maximumSemanticBytes: 1_048_576,
  });
}

function queryDeveloperIndexes(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
) {
  return createAppDeveloperIndexDefinitionPortV1(fixture.control.drizzle);
}

async function prepareReadinessAuthorities(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
): Promise<CatalogSchemaVersionId> {
  const beforeValidation = await runEffect(
    fixture.repository.settle(fixture.input),
  );
  expect(beforeValidation).toMatchObject({
    status: "not_ready",
    reason: "candidateValidationMissing",
  });
  const schemaVersionId = await applicationSchemaVersionId(fixture.control);
  await closeEmptyUniqueConstraintSet(fixture, schemaVersionId);
  await settleCandidateValidation(fixture, schemaVersionId);
  return schemaVersionId;
}

async function applicationMutationActivationInput(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
  active: CoherentActiveApplication,
  options: Readonly<{
    requestKey: string;
    grantId: string;
  }> = {
    requestKey: "request:application:mutation",
    grantId: "grant_application_mutation_1",
  },
) {
  const trustedNowEpochMilliseconds = Date.now();
  const fn = active.basis.manifest.functions[0];
  if (fn === undefined || fn.kind !== "mutation") {
    throw new Error("Expected one Application mutation function.");
  }
  const rows = await fixture.target.drizzle.select({
    entrySha256: fxSystemApplicationFunctionsV1.entrySha256,
  }).from(fxSystemApplicationFunctionsV1).where(eq(
    fxSystemApplicationFunctionsV1.functionPath,
    fn.path,
  )).limit(1);
  const storedFunction = rows[0];
  if (storedFunction === undefined) {
    throw new Error("Expected stored Application mutation function.");
  }
  const runtimeTarget = Result.getOrThrow(canonicalizeApplicationRuntimeTargetV1({
    format: "flarex.application-runtime-target",
    version: 1,
    scopeId: active.basis.authority.scopeId,
    revisionId: active.basis.revisionId,
    candidateId: active.basis.candidateId,
    analysisId: active.basis.analysisId,
    sourceArtifactRootSha256: hex(active.basis.sourceArtifactRootSha256),
    manifestSha256: hex(active.basis.manifestSha256),
    schemaSha256: hex(active.basis.applicationSchemaSha256),
    functionCatalogSha256: hex(active.basis.functionCatalogSha256),
    publicationSha256: hex(active.basis.publicationSha256),
    executionModulePath: active.basis.manifest.sourceArtifact.executionModulePath,
    function: { ...fn, entrySha256: hex(storedFunction.entrySha256) },
  }));
  const executionAuthority = await runEffect(
    canonicalizeApplicationMutationExecutionAuthorityV1({
      format: "flarex.application-mutation-execution-authority",
      version: 1,
      runtimeTarget: runtimeTarget.target,
      runtimeTargetSha256: await sha256Hex(runtimeTarget.canonicalBytes),
      activationSequence: active.basis.activationSequence.toString(),
      activeHeadSha256: hex(active.basis.headSha256),
      schemaVersionId: active.basis.schemaVersionId,
    }),
  );
  const policyVersion = TransactionPolicyVersionV1Schema.make(
    "policy_point_mutation_v1",
  );
  const policy = await canonicalizeTransactionGrantIdentityAccessPolicyV1({
    policyVersion,
    auth: { kind: "anonymous" },
    capabilities: [
      "db:get",
      "db:insert",
      "db:patch",
      "db:replace",
      "db:delete",
    ],
  });
  const validatedArgsJson = Object.freeze({ body: "hello" });
  const canonicalArgs = await canonicalizeFlarexValueJsonV1(
    validatedArgsJson,
  );
  const validatedArgsSha256 = TransactionArgumentsSha256V1Schema.make(
    canonicalArgs.sha256,
  );
  const requestSha256 = TransactionRequestSha256V1Schema.make(
    new Uint8Array(32).fill(0x41),
  );
  const requestKey = TransactionRequestKeyV1Schema.make(
    options.requestKey,
  );
  const grantSegments = await runEffect(prepareApplicationMutationGrantV1({
    kid: TransactionGrantKeyIdV1Schema.make("application-key-1"),
    grantId: TransactionAuthorizationGrantIdV1Schema.make(
      options.grantId,
    ),
    deploymentId: TransactionGrantDeploymentIdV1Schema.make(
      fixture.input.deploymentId,
    ),
    executionAuthority,
    policyVersion,
    identityAccessPolicy: policy,
    validatedArgsValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    validatedArgsSha256: hex(validatedArgsSha256),
    requestKey,
    requestSha256: hex(requestSha256),
    issuedAt: TransactionGrantTimestampV1Schema.make(
      new Date(trustedNowEpochMilliseconds - 60_000).toISOString(),
    ),
    expiresAt: TransactionGrantTimestampV1Schema.make(
      new Date(trustedNowEpochMilliseconds + 5 * 60_000).toISOString(),
    ),
    authorizationRevocationEpoch:
      TransactionAuthorizationRevocationEpochSchema.make(0n),
  }));
  const grantKeyPair = await globalThis.crypto.subtle.generateKey(
    "Ed25519",
    false,
    ["sign", "verify"],
  );
  if (!("privateKey" in grantKeyPair) || !("publicKey" in grantKeyPair)) {
    throw new Error("Expected an Ed25519 key pair.");
  }
  const authorizationGrant = assembleApplicationMutationGrantJwsV1(
    grantSegments,
    new Uint8Array(await globalThis.crypto.subtle.sign(
      "Ed25519",
      grantKeyPair.privateKey,
      copyBytesToArrayBuffer(grantSegments.signingInput),
    )),
  );
  const verifiedGrant = await runEffect(verifyApplicationMutationGrantV1(
    authorizationGrant,
    createApplicationMutationGrantVerifierNamespaceV1({
      deploymentId: TransactionGrantDeploymentIdV1Schema.make(
        fixture.input.deploymentId,
      ),
      grantRetentionPolicy: Result.getOrThrow(
        makeGrantRetentionPolicyV1Result({
          maximumGrantLifetimeMilliseconds: 10 * 60_000,
          maximumFutureIssuedAtSkewMilliseconds: 30_000,
          maximumLiveSnapshotRetentionMilliseconds: 20 * 60_000,
        }),
      ),
      trustedNowEpochMilliseconds: Effect.succeed(
        trustedNowEpochMilliseconds,
      ),
      keys: [{
        kid: TransactionGrantKeyIdV1Schema.make("application-key-1"),
        purpose: APPLICATION_MUTATION_GRANT_KEY_PURPOSE_V1,
        state: "active",
        issuedAtInclusiveEpochMilliseconds:
          trustedNowEpochMilliseconds - 60 * 60_000,
        publicKey: grantKeyPair.publicKey,
      }],
    }),
  ));
  return Object.freeze({
    deploymentId: TransactionGrantDeploymentIdV1Schema.make(
      fixture.input.deploymentId,
    ),
    scopeId: decodeReplacementScopeIdV1(active.basis.authority.scopeId),
    activeSelection: active.selection,
    evidence: Object.freeze({
      executionAuthority: executionAuthority.authority,
      verifiedGrant,
      functionPath: TransactionFunctionPathV1Schema.make(fn.path),
      functionKind: TransactionFunctionKindV1Schema.make("mutation"),
      schemaVersionId: active.basis.schemaVersionId,
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
      validatedArgsSha256,
      requestKey,
      requestSha256,
    }),
  });
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

function hexBytes(value: string): Uint8Array {
  return Uint8Array.from({ length: value.length / 2 }, (_, index) =>
    Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  );
}

async function enablePhysicalBuilds(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const ports = Object.freeze({
    controlDb: fixture.control.drizzle,
    authority: fixture.authorityPorts,
  });
  await runEffect(reconcilePublishedIndexBuildsV1Effect(ports, {
    deploymentId: fixture.input.deploymentId,
    schemaVersionId,
  }));
  const requirements = await runEffect(
    loadPublishedPhysicalRequirementSnapshotV1(
      fixture.control.drizzle,
      Object.freeze({
        deploymentId: fixture.input.deploymentId,
        schemaVersionId,
      }),
    ),
  );
  if (requirements === null || requirements.definitions.length === 0) {
    throw new Error("Expected Application physical requirements.");
  }
  for (const definition of requirements.definitions) {
    const located = await runEffect(locateAppIndexDefinitionByIdEffect(
      fixture.control.drizzle,
      fixture.authority.scopeId,
      definition.indexDefinitionId,
    ));
    if (located === null) throw new Error("Application index definition missing.");
    for (let step = 0; step < 16; step += 1) {
      const input = Object.freeze({
        deploymentId: fixture.input.deploymentId,
        indexDefinitionId: definition.indexDefinitionId,
        pageSize: 16,
      });
      const built = located.access.kind === "developer"
        ? await runEffect(buildAppDeveloperOrderedIndexV1Effect(ports, input))
        : await runEffect(buildIntrinsicCreationTimeIndexV1Effect(ports, input));
      if (built.lifecycle === "enabled") break;
      if (step === 15) {
        throw new Error("Application physical build did not enable.");
      }
    }
  }
}

async function insertApplicationQueryRow(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
  schemaVersionId: CatalogSchemaVersionId,
) {
  const tableId = decodeCatalogTableId(1);
  const rowId = decodeAppRowIdHexV1("11".repeat(16));
  const creationTime = decodeAppCreationTimeV1(1);
  const document = await canonicalizeAppDocumentV1({
    tableId,
    rowId,
    creationTime,
    fields: { name: "Ada" },
  });
  const clock = await fixture.target.getScopeClock(fixture.authority.scopeId);
  if (clock === null) throw new Error("Application query clock missing.");
  const commitSeq = CommitSeqSchema.make(1n);
  await fixture.target.drizzle.transaction(async tx => {
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, {
      kind: "live",
      scopeId: fixture.authority.scopeId,
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
      eq(fxSystemScopeClocks.scopeId, fixture.authority.scopeId),
    );
  });
  return document;
}

async function createApplicationRevision(
  target: TestPersistence,
  authority: ApplicationAnalysisAuthority,
  manifest: Readonly<{
    readonly manifest: ApplicationManifestV1;
    readonly canonicalText: string;
  }>,
  options: Readonly<{
    requestKey?: string;
    uuidSequences?: ReadonlyArray<number>;
  }> = {},
) {
  const sequences = options.uuidSequences ?? [11, 12, 13];
  const analyses = makeApplicationAnalysisRepository(target.drizzle, {
    randomUuid: uuidSequence(...sequences),
  });
  const pending = await runEffect(analyses.begin({
    authority,
    requestKey: options.requestKey ?? "request:application-readiness:1",
    sourceArtifactRootSha256: ROOT,
    analyzerIdentity: "application-analyzer",
    analyzerPolicyIdentity: "application-analyzer-policy",
  }));
  const analyzed = await runEffect(analyses.settle(authority, {
    kind: "analyzed",
    candidateId: pending.candidateId,
    sourceArtifactRootSha256: ROOT,
    analyzerIdentity: "application-analyzer",
    analyzerPolicyIdentity: "application-analyzer-policy",
    canonicalManifest: manifest.canonicalText,
  }));
  if (analyzed.status !== "analyzed") {
    throw new Error("Expected analyzed Application readiness fixture.");
  }
  return analyzed;
}

async function createAdditionalApplicationRevision(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
  includeTask = false,
): Promise<string> {
  const manifest = applicationManifest(true, false);
  const analysis = await createApplicationRevision(
    fixture.target,
    fixture.authority,
    manifest,
    {
      requestKey: "request:application-readiness:2",
      uuidSequences: [21, 22, 23],
    },
  );
  const publication = await runEffect(
    makeApplicationPublicationRepository(fixture.target.drizzle).publish({
      authority: fixture.authority,
      revisionId: analysis.revision.revisionId,
      candidateId: analysis.candidateId,
      analysisId: analysis.analysisId,
      manifestSha256: analysis.manifestSha256,
      manifest: Result.getOrThrow(
        canonicalizeApplicationManifestV1(analysis.manifest),
      ).manifest,
    }),
  );
  const catalog = await runEffect(hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: includeTask ? [taskManifest()] : [],
  }, taskSha256));
  const bindings = await runEffect(produceApplicationTaskBindingsV1({
    definition: preparedDefinition(),
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
  }, taskSha256));
  await runEffect(
    makeApplicationTaskBindingRepository(fixture.target.drizzle).register({
      authority: fixture.authority,
      bindings,
    }),
  );
  return publication.revisionId;
}

async function closeEmptyUniqueConstraintSet(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const prepared = await runEffect(
    prepareAppUniqueConstraintSetClosureV1Effect(fixture.control.drizzle, {
      deploymentId: fixture.input.deploymentId,
      schemaVersionId,
    }),
  );
  await fixture.control.drizzle.transaction(tx => runEffect(
    closeAppUniqueConstraintSetV1InTransactionEffect(tx, prepared),
  ));
}

async function settleCandidateValidation(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const input = {
    deploymentId: fixture.input.deploymentId,
    schemaVersionId,
  } as const;
  await runEffect(installAppSchemaCandidateValidationEffect(
    fixture.candidateValidation,
    input,
  ));
  for (let step = 0; step < 64; step += 1) {
    const advanced = await runEffect(advanceAppSchemaCandidateValidationEffect(
      fixture.candidateValidation,
      input,
    ));
    if (advanced.disposition !== "readyToSettle") continue;
    await runEffect(settleAppSchemaCandidateValidationEffect(
      fixture.candidateValidation,
      input,
    ));
    return;
  }
  throw new Error("Application candidate validation did not settle.");
}

async function applicationSchemaVersionId(
  control: TestPersistence,
): Promise<CatalogSchemaVersionId> {
  const result = await control.query<{ schema_version_id: CatalogSchemaVersionId }>(
    "select schema_version_id from fx_control_application_schema_authority_v1",
  );
  const schemaVersionId = result.rows[0]?.schema_version_id;
  if (schemaVersionId === undefined) {
    throw new Error("Expected Application schema authority.");
  }
  return schemaVersionId;
}

async function scalarCount(
  persistence: TestPersistence,
  tableName: string,
): Promise<number> {
  const result = await persistence.query<{ count: string }>(
    `select count(*)::text as count from ${tableName}`,
  );
  const count = result.rows[0]?.count;
  if (count === undefined) throw new Error(`Missing count for ${tableName}.`);
  return Number(count);
}

function deferred<Value>() {
  let resolve!: (value: Value | PromiseLike<Value>) => void;
  let reject!: (cause?: unknown) => void;
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function applicationManifest(
  includeFunction: boolean,
  includeTable: boolean,
  includeIndex = false,
  functionKind: "query" | "mutation" | "action" = "query",
) {
  return Result.getOrThrow(canonicalizeApplicationManifestV1({
    format: "flarex.application-manifest",
    version: 1,
    sourceArtifact: {
      rootSha256: ROOT,
      executionModulePath: "_flarex/application.js",
      schemaModulePath: "_flarex/schema.js",
      modules: [{
        path: "_flarex/application.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
        sourceSha256: EXECUTION_SOURCE,
        sourceByteLength: 128,
      }, {
        path: "_flarex/schema.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
        sourceSha256: SCHEMA_SOURCE,
        sourceByteLength: 64,
      }],
    },
    schema: {
      version: 1,
      tables: includeTable ? [{
        tableId: 1,
        name: "users",
        validator: {
          type: "object",
          value: {
            name: {
              fieldType: { type: "string" },
              optional: false,
            },
          },
        },
        placement: { kind: "global" },
      }] : [],
      indexes: includeIndex ? [{
        indexId: 1,
        tableId: 1,
        name: "by_name",
        fields: ["name"],
      }] : [],
    },
    functions: includeFunction ? [{
      path: "users:get",
      moduleName: "users",
      exportName: "get",
      kind: functionKind,
      visibility: "public",
      args: { type: "any" },
      returns: null,
      partition: null,
    }] : [],
  }));
}

function preparedDefinition() {
  return Result.getOrThrow(prepareStandardApplicationDefinitionV1({
    programBudgetInput: {
      maximumModules: 1,
      maximumFunctions: 1,
      maximumIdentifierUtf8Bytes: 1_024,
      maximumValidatorNodes: 32,
      maximumValidatorDepth: 8,
      maximumValidatorStringUtf8Bytes: 1_024,
    },
    programInput: {
      format: "flarex.declarative-program/v1",
      version: 1,
      schema: { tables: [], indexes: [] },
      modules: [{
        modulePath: "users",
        functions: [{
          exportName: "get",
          kind: "query",
          visibility: "public",
          argsValidator: { type: "any" },
          returnsValidator: null,
        }],
      }],
    },
    materializationBudgetInput: {
      maximumModules: 1,
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
        path: "users.js",
        roles: ["function", "execution"],
        sourceBytes: new TextEncoder().encode("export const get = () => null;\n"),
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: "users",
        artifactModulePath: "users.js",
      }],
      executionPath: "users.js",
      schemaPath: null,
      authPath: null,
    },
  }));
}

function taskManifest() {
  return {
    version: 1,
    taskId: "tasks.users.get",
    handler: {
      logicalModulePath: "users",
      artifactModulePath: "users.js",
      exportName: "get",
    },
    payloadValidator: { type: "any" },
    outputValidator: null,
    runAttemptPolicy: {
      version: 1,
      retry: {
        maxAttempts: 3,
        factor: 2,
        minTimeoutInMs: 1_000,
        maxTimeoutInMs: 60_000,
        randomize: true,
      },
      outOfMemory: { kind: "disabled" },
    },
    maximumDurationInSeconds: 300,
    computeProfile: "standard-1x",
    queue: { kind: "default" },
  } as const;
}

function uuidSequence(...sequences: ReadonlyArray<number>): () => string {
  let index = 0;
  return () => {
    const sequence = sequences[index];
    if (sequence === undefined) throw new Error("UUID sequence exhausted.");
    index += 1;
    return `30000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await sha256Bytes(bytes);
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Bytes(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer,
  ));
}

function replaceApplicationDispatchDigestInJson(
  value: unknown,
  digest: Uint8Array,
): unknown {
  if (Array.isArray(value)) {
    return value.map(member => replaceApplicationDispatchDigestInJson(
      member,
      digest,
    ));
  }
  if (value === null || typeof value !== "object") return value;
  const record = Object.fromEntries(Object.entries(value).map(([key, member]) => [
    key,
    replaceApplicationDispatchDigestInJson(member, digest),
  ]));
  return record.kind === "dispatch_attempt"
    ? {
        ...record,
        applicationTaskRuntimeTargetSha256: {
          "$flarex.uint8array.v1": Encoding.encodeBase64Url(digest),
        },
      }
    : record;
}

function canonicalJsonByteLength(value: unknown): bigint {
  return BigInt(new TextEncoder().encode(JSON.stringify(value)).byteLength);
}
