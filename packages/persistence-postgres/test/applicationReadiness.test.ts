import { webcrypto } from "node:crypto";
import { eq } from "drizzle-orm";

import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  hashCanonicalTaskCatalogV1,
  makeStandardApplicationTaskSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  produceApplicationTaskBindingsV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import { prepareStandardApplicationDefinitionV1 } from
  "@flarex/standard-application-definition/v1";
import { Effect, Exit, Result, Scope } from "effect";
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
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
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
  createPGlitePersistence,
  createPGliteSplitScopeAuthorityProvisioner,
} from "../src/pglite";
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
  fxSystemScopeClocks,
} from "../src/schema";

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
      kind: "query",
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
