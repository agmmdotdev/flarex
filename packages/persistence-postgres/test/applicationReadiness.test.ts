import { webcrypto } from "node:crypto";
import { eq } from "drizzle-orm";

import {
  canonicalizeSessionJournalV1Effect,
  canonicalizeSuccessfulResultV1Effect,
  SESSION_JOURNAL_FORMAT_V1,
} from "flarex-protocol/commit-protocol";
import { TRANSACTION_SESSION_PROTOCOL_VERSION_V1 } from
  "flarex-protocol/transaction-session";
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
  produceApplicationTaskBindingsV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import { prepareStandardApplicationDefinitionV1 } from
  "@flarex/standard-application-definition/v1";
import { Effect, Exit, Result, Scope } from "effect";
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
  canonicalizeApplicationRuntimeColdReceiptV1,
} from "flarex-protocol/internal/application-runtime-cold-receipt-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
  type CanonicalApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
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
import { decodeCatalogTableId } from "flarex-protocol/catalog";
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
import { makeApplicationPublicationRepository } from
  "../src/applicationPublication";
import { makeApplicationReadinessRepository } from
  "../src/applicationReadiness";
import {
  claimApplicationActiveSelection,
  makeApplicationActivationRepository,
  validateApplicationActiveSelectionInTransaction,
  type CoherentActiveApplication,
} from "../src/applicationActivation";
import {
  openApplicationQuerySnapshot,
  readApplicationQueryIndex,
  readApplicationQueryPoint,
  revalidateApplicationQuerySnapshot,
} from "../src/applicationQuerySnapshot";
import { makeApplicationSchemaAuthorityPublisher } from
  "../src/applicationSchemaAuthority";
import {
  createApplicationTaskCatalogSnapshotPort,
  makeApplicationTaskBindingRepository,
} from "../src/applicationTaskBindings";
import {
  createPGliteLocatedSplitScopeClockTarget,
  createPGliteLocatedPointMutationSessionActivationTargetV1,
  createPGlitePersistence,
  createPGliteSplitScopeAuthorityProvisioner,
} from "../src/pglite";
import {
  createApplicationMutationSessionActivationPersistenceV1,
} from "../src/transactionSessionActivation";
import {
  createSessionJournalStorePersistenceV1,
} from "../src/sessionJournalStore";
import {
  createStoredAttemptEvidenceLoaderV1,
  type StoredAttemptEvidenceAuthorityV1,
} from "../src/storedAttemptEvidence";
import {
  createStoredCommitAuthorityEvidenceLoaderV1,
  type StoredCommitAuthorityEvidenceAuthorityV1,
} from "../src/storedCommitAuthorityEvidence";
import {
  inspectApplicationMutationCommitAuthorityGraph,
} from "../src/applicationMutationCommitAuthorityGraph";
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
import { createAppDeveloperIndexDefinitionPortV1 } from
  "../src/appDeveloperIndexCommitV1";
import { getScopeAuthorityProvisioningReceipt } from
  "../src/scopeAuthorityProvisioningReceipt";
import { runEffect } from "./effectTestRuntime";
import type { SplitScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import { lockScopeClockForShareInTransactionEffect } from
  "../src/scopeClock";
import {
  fxSystemIndexBuildStates,
  fxSystemApplicationFunctionsV1,
  fxSystemApplicationActiveHeadsV1,
  fxSystemScopeClocks,
} from "../src/schema";
import {
  TEST_GRANT_RETENTION_POLICY_V1,
} from "./transactionSessionActivationTestSupport";
import {
  completeSessionJournalSeal,
  prepareSessionJournalSeal,
} from "./effectTestRuntime";

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

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describe("Application readiness", { timeout: 30_000 }, () => {
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
    expect(await scalarCount(
      fixture.target,
      "fx_system_declarative_v2_activation_head",
    )).toBe(0);
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

  it("settles a populated task catalog from its canonical stored manifest", async () => {
    const fixture = await readinessFixture({ includeTask: true });
    await prepareReadinessAuthorities(fixture);

    const first = await runEffect(fixture.repository.settle(fixture.input));
    const replay = await runEffect(fixture.repository.readReady(fixture.input));

    expect(first).toMatchObject({ status: "ready", disposition: "inserted" });
    expect(replay).toMatchObject({
      status: "ready",
      disposition: "replayed",
      readinessSha256: first.status === "ready"
        ? first.readinessSha256
        : undefined,
    });
    expect(fixture.materializationCount()).toBe(1);
  });

  it("rejects a noncanonical stored task manifest before materialization", async () => {
    const fixture = await readinessFixture({ includeTask: true });
    const rows = await fixture.target.query<{ manifest_bytes: Uint8Array }>(
      `select manifest_bytes
         from fx_system_application_task_definition_v1
        where scope_id = $1 and revision_id = $2`,
      [fixture.authority.scopeId, fixture.input.revisionId],
    );
    const manifestBytes = rows.rows[0]?.manifest_bytes;
    if (manifestBytes === undefined) throw new Error("Expected task manifest.");
    const noncanonical = new Uint8Array(manifestBytes.byteLength + 1);
    noncanonical[0] = 0x20;
    noncanonical.set(manifestBytes, 1);
    await fixture.target.query(
      `update fx_system_application_task_definition_v1
          set manifest_bytes = $1
        where scope_id = $2 and revision_id = $3`,
      [noncanonical, fixture.authority.scopeId, fixture.input.revisionId],
    );

    const result = await runEffect(Effect.result(
      fixture.repository.settle(fixture.input),
    ));

    expect(Result.isFailure(result)).toBe(true);
    if (Result.isFailure(result)) {
      expect(result.failure).toMatchObject({
        _tag: "ApplicationTaskCatalogSnapshotError",
        reason: "storedState",
        cause: {
          operation: "decode_manifest_preimage",
          reason: "inconsistent_binding",
        },
      });
    }
    expect(fixture.materializationCount()).toBe(0);
  });

  it("rejects drifted stored task-manifest digest before materialization", async () => {
    const fixture = await readinessFixture({ includeTask: true });
    await fixture.target.query(
      `update fx_system_application_task_definition_v1
          set canonical_task_manifest_sha256 = $1
        where scope_id = $2 and revision_id = $3`,
      [new Uint8Array(32), fixture.authority.scopeId, fixture.input.revisionId],
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

  it("rejects drifted stored task-definition binding before materialization", async () => {
    const fixture = await readinessFixture({ includeTask: true });
    await fixture.target.query(
      `update fx_system_application_task_definition_v1
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
      "fx_system_application_activation_v1",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_active_head_v1",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_declarative_v2_activation_head",
    )).toBe(0);

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
    const replayed = await runEffect(sessionActivation.activateEffect(input));
    expect(created.status).toBe("created");
    if (created.status !== "created") {
      throw new Error("Expected newly created Application mutation session.");
    }
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

    const sessionPorts = Object.freeze({
      ...fixture.authorityPorts,
      scopeSessionTargets: {
        resolve: async (locator: SplitScopePhysicalLocator) =>
          createPGliteLocatedPointMutationSessionActivationTargetV1(
            fixture.target,
            locator,
          ),
      },
    });
    const store = createSessionJournalStorePersistenceV1(
      sessionPorts,
      {
        grantRetentionPolicy: TEST_GRANT_RETENTION_POLICY_V1,
        randomUuid: uuidSequence(90, 91, 92, 93),
      },
    );
    const attempt = await runEffect(store.openAttemptEffect({
      selector: {
        deploymentId: input.deploymentId,
        scopeId: created.anchor.scopeId,
        sessionId: created.anchor.sessionId,
        attemptFence: created.anchor.attemptFence,
      },
      executionClaim: created.executionClaim,
      snapshotToken: created.anchor.snapshotToken,
      schemaVersionId: input.evidence.schemaVersionId,
    }));
    const preparedSeal = await prepareSessionJournalSeal(store, attempt);
    const journal = await runEffect(canonicalizeSessionJournalV1Effect(
      preparedSeal.journal,
    ));
    const result = await runEffect(
      canonicalizeSuccessfulResultV1Effect({ ok: true }),
    );
    await completeSessionJournalSeal(
      store,
      preparedSeal.preparation,
      journal,
      result,
    );
    const attemptAuthority: StoredAttemptEvidenceAuthorityV1 = Object.freeze({
      deploymentId: input.deploymentId,
      scopeId: created.anchor.scopeId,
      sessionId: created.anchor.sessionId,
      attemptFence: created.anchor.attemptFence,
      storageGeneration: created.anchor.storageGeneration,
      storageGenerationFence: created.anchor.storageGenerationFence,
      snapshotToken: created.anchor.snapshotToken,
      schemaVersionId: input.evidence.schemaVersionId,
      executionClaim: created.executionClaim,
    });
    const attemptEvidence = await runEffect(
      createStoredAttemptEvidenceLoaderV1(sessionPorts)
        .loadEffect(attemptAuthority),
    );
    expect(attemptEvidence.kind).toBe("loaded");
    if (attemptEvidence.kind !== "loaded") {
      throw new Error("Expected sealed Application attempt evidence.");
    }
    const commitAuthority: StoredCommitAuthorityEvidenceAuthorityV1 =
      Object.freeze({
        ...attemptAuthority,
        session: attemptEvidence.evidence.session,
        sealIdentity: Object.freeze({
          scopeUuid: attemptEvidence.evidence.scopeUuid,
          lifecycle: attemptEvidence.evidence.session.lifecycle,
          sessionUpdatedAtMilliseconds:
            attemptEvidence.evidence.session.updatedAtMilliseconds,
          leaseExpiresAtMilliseconds:
            attemptEvidence.evidence.lease.leaseExpiresAtMilliseconds,
          rootCreatedAtMilliseconds:
            attemptEvidence.evidence.root.createdAtMilliseconds,
          rootUpdatedAtMilliseconds:
            attemptEvidence.evidence.root.updatedAtMilliseconds,
          sealedAtMilliseconds:
            attemptEvidence.evidence.root.sealedAtMilliseconds,
          finalSyscallSequence:
            attemptEvidence.evidence.root.sealedFinalSyscallSequence,
          creationTimeSeed: attemptEvidence.evidence.root.creationTimeSeed,
          nextCreationTime: attemptEvidence.evidence.root.nextCreationTime,
          journalFormat: SESSION_JOURNAL_FORMAT_V1,
          journalProtocolVersion: TRANSACTION_SESSION_PROTOCOL_VERSION_V1,
          journalValueCodecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
          journalByteLength: attemptEvidence.evidence.root.journalBytes.byteLength,
          journalSha256: attemptEvidence.evidence.root.journalSha256,
          resultValueCodecVersion:
            attemptEvidence.evidence.root.resultValueCodecVersion,
          resultSemanticBytes:
            attemptEvidence.evidence.root.resultSemanticBytes,
          resultByteLength: attemptEvidence.evidence.root.resultBytes.byteLength,
          resultSha256: attemptEvidence.evidence.root.resultSha256,
          readDocuments: attemptEvidence.evidence.root.readDocuments,
          readSemanticBytes: attemptEvidence.evidence.root.readSemanticBytes,
          pointDependencyCount:
            attemptEvidence.evidence.root.pointDependencyCount,
          indexedQuerySyscalls:
            attemptEvidence.evidence.root.indexedQuerySyscalls,
          indexRangeDependencyCount:
            attemptEvidence.evidence.root.indexRangeDependencyCount,
          indexRangeDependencyEvidenceBytes:
            attemptEvidence.evidence.root.indexRangeDependencyEvidenceBytes,
          writeOperations: attemptEvidence.evidence.root.writeOperations,
          writeSemanticBytes: attemptEvidence.evidence.root.writeSemanticBytes,
          materialWriteEventEvidenceBytes:
            attemptEvidence.evidence.root.materialWriteEventEvidenceBytes,
        }),
      });
    await mirrorCommitSchemaEvidenceToTarget(
      fixture,
      input.evidence.schemaVersionId,
    );
    const commitQueries: string[] = [];
    let corruptedAfterCapture = false;
    const commitLoader = createStoredCommitAuthorityEvidenceLoaderV1(
      sessionPorts,
      {
        observeQuery: query => commitQueries.push(query.name),
        afterRepeatableRead: async () => {
          if (corruptedAfterCapture) return;
          corruptedAfterCapture = true;
          await fixture.target.query(
            `update fx_system_application_readiness_v1
                set readiness_bytes = $1
              where scope_id = $2 and revision_id = $3`,
            [
              new Uint8Array([0x7b, 0x7d]),
              fixture.authority.scopeId,
              fixture.input.revisionId,
            ],
          );
        },
      },
    );
    const commitEvidence = await runEffect(
      commitLoader.loadEffect(commitAuthority),
    );
    expect(commitEvidence).toMatchObject({
      kind: "loaded",
    });
    if (commitEvidence.kind !== "loaded" ||
      commitEvidence.evidence.applicationGraph === undefined) {
      throw new Error("Expected authenticated Application commit graph.");
    }
    expect(inspectApplicationMutationCommitAuthorityGraph(
      commitEvidence.evidence.applicationGraph,
    ).runtimeTarget.function.path).toBe(input.evidence.functionPath);
    expect(commitQueries.indexOf("applicationGraphSizes")).toBeLessThan(
      commitQueries.indexOf("authorityPayload"),
    );
    expect(commitQueries.indexOf("applicationGraphFunctionSizes")).toBeLessThan(
      commitQueries.indexOf("applicationGraphReadinessFunctions"),
    );
    await expect(runEffect(
      commitLoader.loadEffect(commitAuthority),
    )).resolves.toMatchObject({
      kind: "corrupt",
      reason: "applicationGraphInvalid",
    });

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

    await fixture.target.drizzle.update(fxSystemApplicationActiveHeadsV1).set({
      headSha256: new Uint8Array(32).fill(0xee),
    }).where(eq(
      fxSystemApplicationActiveHeadsV1.scopeId,
      active.basis.authority.scopeId,
    ));
    const afterHeadMovement = await runEffect(
      sessionActivation.activateEffect(input),
    );
    expect(afterHeadMovement).toMatchObject({
      status: "busy",
      anchor: {
        sessionId: created.anchor.sessionId,
        attemptFence: created.anchor.attemptFence,
        snapshotToken: created.anchor.snapshotToken,
      },
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
      "fx_system_application_activation_v1",
    )).toBe(0);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_active_head_v1",
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
      "fx_system_application_activation_v1",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_active_head_v1",
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
      "fx_system_application_activation_v1",
    )).toBe(1);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_active_head_v1",
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
      `update fx_system_application_active_head_v1
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
      "fx_system_application_activation_v1",
    )).toBe(2);
    expect(await scalarCount(
      fixture.target,
      "fx_system_application_active_head_v1",
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
        revalidateApplicationQuerySnapshot(opened.snapshot),
      );
    })));

    expect(Result.isFailure(stale)).toBe(true);
    if (Result.isFailure(stale)) {
      expect(stale.failure).toMatchObject({ reason: "concurrentHead" });
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
  readonly functionKind?: "query" | "mutation";
}

async function mirrorCommitSchemaEvidenceToTarget(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const artifacts = await fixture.control.query<{
    version: number;
    manifest_codec_version: number;
    manifest_json: unknown;
    manifest_bytes: Uint8Array;
    manifest_sha256: Uint8Array;
  }>(
    `select version, manifest_codec_version, manifest_json,
            manifest_bytes, manifest_sha256
       from fx_control_schema_version
      where deployment_id = $1 and schema_version_id = $2`,
    [fixture.input.deploymentId, schemaVersionId],
  );
  const artifact = artifacts.rows[0];
  if (artifact === undefined) throw new Error("Expected schema artifact.");
  await fixture.target.query(
    `insert into deployments (
       deployment_id, project_id, active_schema_version
     ) values ($1, $2, 0)
     on conflict (deployment_id) do nothing`,
    [fixture.input.deploymentId, "project_application_commit_graph"],
  );
  await fixture.target.query(
    `insert into fx_control_schema_version (
       deployment_id, schema_version_id, version, manifest_codec_version,
       manifest_json, manifest_bytes, manifest_sha256
     ) values ($1, $2, $3, $4, $5::jsonb, $6, $7)
     on conflict (deployment_id, schema_version_id) do nothing`,
    [
      fixture.input.deploymentId,
      schemaVersionId,
      artifact.version,
      artifact.manifest_codec_version,
      JSON.stringify(artifact.manifest_json),
      artifact.manifest_bytes,
      artifact.manifest_sha256,
    ],
  );
  const tables = await fixture.control.query<{
    table_id: number;
    namespace: string;
    logical_name: string;
  }>(
    `select table_id, namespace, logical_name
       from fx_control_table
      where deployment_id = $1`,
    [fixture.input.deploymentId],
  );
  for (const table of tables.rows) {
    await fixture.target.query(
      `insert into fx_control_table (
         deployment_id, table_id, namespace, logical_name
       ) values ($1, $2, $3, $4)
       on conflict (deployment_id, table_id) do nothing`,
      [
        fixture.input.deploymentId,
        table.table_id,
        table.namespace,
        table.logical_name,
      ],
    );
  }
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
      manifest: analysis.manifest,
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
      manifest: analysis.manifest,
    }),
  );
  const catalog = await runEffect(hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: [],
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
  functionKind: "query" | "mutation" = "query",
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
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest(
    "SHA-256",
    bytes.slice().buffer,
  ));
  return Array.from(digest, byte => byte.toString(16).padStart(2, "0")).join("");
}
