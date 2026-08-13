import { webcrypto } from "node:crypto";

import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
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
import {
  produceApplicationTaskBindingsV1,
  type PreparedApplicationTaskBindingsV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import { produceStandardApplicationSource } from
  "@flarex/standard-application-definition/application-source";
import { prepareStandardApplicationDefinitionV1 } from
  "@flarex/standard-application-definition/v1";
import type { PreparedStandardApplicationDefinitionV1 } from
  "@flarex/standard-application-definition/v1";
import type { TaskComputeProfileRefV1 } from
  "@flarex/durable-task/internal/run-attempt-v1";
import { Brand, Effect, Encoding, Result } from "effect";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import {
  CatalogSchemaVersionIdSchema,
  CatalogSchemaVersionSchema,
  type CatalogSchemaVersionId,
} from "flarex-protocol/schema-manifest";
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
  makeApplicationPublicationRepository,
  type ApplicationPublication,
} from
  "../src/applicationPublication";
import {
  makeApplicationReadinessRepository,
  type ApplicationReadinessTaskRuntimeContext,
  type ApplicationReadinessResult,
} from "../src/applicationReadiness";
import { makeApplicationActivationRepository } from
  "../src/applicationActivation";
import { makeApplicationSchemaAuthorityPublisher } from
  "../src/applicationSchemaAuthority";
import {
  createApplicationTaskCatalogSnapshotPort,
  makeApplicationTaskBindingRepository,
} from "../src/applicationTaskBindings";
import { makeApplicationTaskRuntimePublicationRepository } from
  "../src/applicationTaskRuntimePublication";
import {
  createApplicationTaskRuntimeReadinessSnapshotPort,
  type ApplicationTaskRuntimeReadinessSnapshotPort,
} from "../src/applicationTaskRuntimeReadinessSnapshot";
import type { FlarexMetadataDatabase } from "../src/deployments";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  reconcilePublishedIndexBuildsV1Effect,
} from "../src/indexBuildReconciliation";
import {
  buildIntrinsicCreationTimeIndexV1Effect,
} from "../src/intrinsicCreationTimeIndexBuildV1";
import {
  createPostgresLocatedSplitScopeClockTarget,
  createPostgresSplitScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../src/postgres";
import { createPointCommitPublisherPortV1 } from
  "../src/pointCommitTransaction";
import { getScopeAuthorityProvisioningReceipt } from
  "../src/scopeAuthorityProvisioningReceipt";
import type { SplitScopePhysicalLocator } from
  "../src/scopeMetadataTypes";
import { runEffect } from "./effectTestRuntime";
import {
  postgresUrl,
  withTemporaryPostgresPersistencePair,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const ROOT = "a".repeat(64);
const EXECUTION_SOURCE = "b".repeat(64);
const SCHEMA_SOURCE = "c".repeat(64);
const RUNTIME_HOST_IDENTITY = "flarex.test/application-runtime-host";
const COMPATIBILITY_DATE = "2026-08-12";
const LOCATOR = Object.freeze({
  kind: "database_per_scope",
  databaseKey: "application_readiness_postgres_target",
  schemaName: "public",
}) satisfies SplitScopePhysicalLocator;
const taskSha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);
const taskComputeProfile = Brand.nominal<TaskComputeProfileRefV1>()(
  "standard-1x",
);

beforeAll(() => {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
});

describePostgres("AA-R6 Application readiness - PostgreSQL", () => {
  it("installs the exact legacy and task-aware readiness compatibility shapes", async () => {
    await withTemporaryPostgresPersistencePair(async (_control, target) => {
      const columns = await target.query<{
        column_name: string;
        is_nullable: "YES" | "NO";
        column_default: string | null;
      }>(
        `select column_name, is_nullable, column_default
           from information_schema.columns
          where table_schema = current_schema()
            and table_name = 'fx_system_application_readiness_v1'
            and column_name in (
              'readiness_version', 'task_runtime_kind',
              'task_runtime_receipt_sha256',
              'task_runtime_readiness_basis_sha256',
              'task_runtime_readiness_basis_bytes'
            )
          order by column_name`,
      );
      expect(columns.rows).toEqual([
        {
          column_name: "readiness_version",
          is_nullable: "NO",
          column_default: "1",
        },
        {
          column_name: "task_runtime_kind",
          is_nullable: "YES",
          column_default: null,
        },
        {
          column_name: "task_runtime_readiness_basis_bytes",
          is_nullable: "YES",
          column_default: null,
        },
        {
          column_name: "task_runtime_readiness_basis_sha256",
          is_nullable: "YES",
          column_default: null,
        },
        {
          column_name: "task_runtime_receipt_sha256",
          is_nullable: "YES",
          column_default: null,
        },
      ]);
      const constraints = await target.query<{
        conname: string;
        definition: string;
      }>(
        `select conname, pg_get_constraintdef(oid) as definition
           from pg_constraint
          where conrelid = 'fx_system_application_readiness_v1'::regclass
            and conname in (
              'fx_application_readiness_v1_identity_check',
              'fx_application_readiness_v1_task_runtime_fk'
            )
          order by conname`,
      );
      expect(constraints.rows).toHaveLength(2);
      expect(constraints.rows[0]).toMatchObject({
        conname: "fx_application_readiness_v1_identity_check",
      });
      expect(constraints.rows[0]?.definition).toContain(
        "readiness_version = 1",
      );
      expect(constraints.rows[0]?.definition).toContain(
        "readiness_version = 2",
      );
      expect(constraints.rows[0]?.definition).toContain(
        "task_runtime_kind",
      );
      expect(constraints.rows[1]).toMatchObject({
        conname: "fx_application_readiness_v1_task_runtime_fk",
      });
      expect(constraints.rows[1]?.definition).toContain(
        "fx_system_application_task_runtime_publication_v1",
      );
      expect(constraints.rows[1]?.definition).toContain("ON DELETE RESTRICT");
    });
  }, 240_000);

  it("settles and exactly replays task-aware readiness", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await readinessFixture(control, target, true);
      await prepareReadinessAuthorities(fixture);

      const first = await runEffect(fixture.repository.settle(fixture.input));
      const replay = await runEffect(fixture.repository.settle(fixture.input));

      expect(first).toMatchObject({
        status: "ready",
        disposition: "inserted",
        taskRuntime: { kind: "empty" },
      });
      expect(replay).toMatchObject({
        ...first,
        disposition: "replayed",
      });
      const stored = await target.query<{
        readiness_version: number;
        task_runtime_kind: string | null;
      }>(`select readiness_version, task_runtime_kind
             from fx_system_application_readiness_v1`);
      expect(stored.rows).toEqual([{
        readiness_version: 2,
        task_runtime_kind: "empty",
      }]);
    });
  }, 240_000);

  it("retries when the retained publisher claims the tentative version", async () => {
    await withTemporaryPostgresPersistencePair(async (control) => {
      const deploymentId = "deployment_application_schema_interleaving";
      await control.insertDeploymentMetadata({
        deploymentId,
        projectId: "project_application_schema_interleaving",
      });
      let markFirstTransactionEntered: (() => void) | undefined;
      const firstTransactionEntered = new Promise<void>(resolve => {
        markFirstTransactionEntered = resolve;
      });
      let releaseFirstTransaction: (() => void) | undefined;
      const firstTransactionRelease = new Promise<void>(resolve => {
        releaseFirstTransaction = resolve;
      });
      let first = true;
      const publisher = makeApplicationSchemaAuthorityPublisher({
        db: control.drizzle,
        runTransaction: async run => {
          if (first) {
            first = false;
            markFirstTransactionEntered?.();
            await firstTransactionRelease;
          }
          return control.drizzle.transaction(run);
        },
      });
      const application = runEffect(publisher.publish({
        deploymentId,
        manifest: applicationManifest().manifest,
      }));
      await firstTransactionEntered;
      await control.publishAppSchemaV1({
        deploymentId,
        schemaVersionId: CatalogSchemaVersionIdSchema.make("retained_race"),
        version: CatalogSchemaVersionSchema.make(1),
        tables: [],
        indexes: [],
      });
      releaseFirstTransaction?.();

      const authority = await application;
      const reservations = await control.query<{
        schema_version: number;
      }>(
        `select schema_version
           from fx_control_application_schema_authority_v1
          where deployment_id = $1`,
        [deploymentId],
      );

      expect(authority.schemaVersion).toBe(2);
      expect(reservations.rows).toEqual([{ schema_version: 2 }]);
    });
  }, 240_000);

  it("settles one table-bearing split-store revision under real locks", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await readinessFixture(control, target);
      const schemaVersionId = await prepareReadinessAuthorities(fixture);
      await enablePhysicalBuilds(fixture, schemaVersionId);
      const clock = await target.getScopeClock(fixture.authority.scopeId);
      if (clock === null) throw new Error("Expected PostgreSQL readiness clock.");
      await target.query(
        `update fx_system_index_build_state
            set start_commit_seq = $1
          where scope_id = $2`,
        [clock.lastCommitSeq + 1n, fixture.authority.scopeId],
      );

      const future = await runEffect(Effect.result(
        fixture.repository.settleLegacy(fixture.input),
      ));
      expect(Result.isFailure(future)).toBe(true);
      if (Result.isFailure(future)) {
        expect(future.failure).toMatchObject({ reason: "storedState" });
      }
      expect(await scalarCount(
        target,
        "fx_system_application_readiness_v1",
      )).toBe(0);

      await target.query(
        `update fx_system_index_build_state
            set start_commit_seq = $1
          where scope_id = $2`,
        [clock.lastCommitSeq, fixture.authority.scopeId],
      );
      const blocker = await target.pool.connect();
      let released = false;
      let concurrent: ReadonlyArray<ApplicationReadinessResult> | undefined;
      try {
        await blocker.query("begin");
        const pid = await blocker.query<{ pid: number }>(
          "select pg_backend_pid()::int as pid",
        );
        const blockerPid = pid.rows[0]?.pid;
        if (blockerPid === undefined) throw new Error("Missing blocker PID.");
        await blocker.query(
          `select 1 from fx_system_scope_clock
            where scope_id = $1
            for update`,
          [fixture.authority.scopeId],
        );
        const first = runEffect(fixture.repository.settleLegacy(fixture.input));
        const second = runEffect(fixture.repository.settleLegacy(fixture.input));
        await waitForBlockedBy(target, blockerPid, 2);
        await blocker.query("commit");
        released = true;
        concurrent = await Promise.all([first, second]);
      } finally {
        if (!released) await blocker.query("rollback").catch(() => undefined);
        blocker.release();
      }
      if (concurrent === undefined) {
        throw new Error("Concurrent Application readiness did not settle.");
      }
      expect(concurrent.map(result => result.status)).toEqual(["ready", "ready"]);
      expect(concurrent.map(result =>
        result.status === "ready" ? result.disposition : "not_ready"
      ).sort()).toEqual(["inserted", "replayed"]);
      const replay = await runEffect(fixture.repository.settleLegacy(fixture.input));
      expect(replay).toMatchObject({
        status: "ready",
        disposition: "replayed",
        schemaVersionId,
      });
      expect(await scalarCount(
        target,
        "fx_system_application_readiness_v1",
      )).toBe(1);
      expect(await scalarCount(
        target,
        "fx_system_declarative_v2_activation_head",
      )).toBe(0);
    });
  }, 240_000);

  it("serializes concurrent Application activation behind the target scope clock", async () => {
    await withTemporaryPostgresPersistencePair(async (control, target) => {
      const fixture = await readinessFixture(control, target);
      const schemaVersionId = await prepareReadinessAuthorities(fixture);
      await enablePhysicalBuilds(fixture, schemaVersionId);
      const activation = makeApplicationActivationRepository({
        deploymentId: fixture.input.deploymentId,
        readiness: fixture.repository,
        authority: fixture.authorityPorts,
      });
      const blocker = await target.pool.connect();
      let released = false;
      try {
        await blocker.query("begin");
        const pid = await blocker.query<{ pid: number }>(
          "select pg_backend_pid()::int as pid",
        );
        const blockerPid = pid.rows[0]?.pid;
        if (blockerPid === undefined) throw new Error("Missing blocker PID.");
        await blocker.query(
          `select 1 from fx_system_scope_clock
            where scope_id = $1
            for update`,
          [fixture.authority.scopeId],
        );
        const first = runEffect(activation.activate({
          revisionId: fixture.input.revisionId,
          expectedActiveHead: null,
        }));
        const second = runEffect(activation.activate({
          revisionId: fixture.input.revisionId,
          expectedActiveHead: null,
        }));
        await waitForBlockedBy(target, blockerPid, 2);
        await blocker.query("commit");
        released = true;
        const settled = await Promise.all([first, second]);
        expect(settled.map(result => result.disposition).sort()).toEqual([
          "inserted",
          "replayed",
        ]);
        const active = await runEffect(activation.readActive());
        expect(active.basis).toMatchObject({
          revisionId: fixture.input.revisionId,
          activationSequence: 1n,
          runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
          compatibilityDate: COMPATIBILITY_DATE,
        });
        expect(await scalarCount(
          target,
          "fx_system_application_activation_v1",
        )).toBe(1);
        expect(await scalarCount(
          target,
          "fx_system_application_active_head_v1",
        )).toBe(1);
        expect(await scalarCount(
          target,
          "fx_system_declarative_v2_activation_head",
        )).toBe(0);

        await blocker.query("begin");
        await blocker.query(
          `select 1 from fx_system_scope_clock
            where scope_id = $1
            for share`,
          [fixture.authority.scopeId],
        );
        const shareCompatibleRead = runEffect(activation.readActive());
        const readOutcome = await Promise.race([
          shareCompatibleRead.then(value => ({ kind: "read" as const, value })),
          new Promise<{ readonly kind: "timeout" }>(resolve => {
            setTimeout(() => resolve({ kind: "timeout" }), 10_000);
          }),
        ]);
        await blocker.query("rollback");
        if (readOutcome.kind === "timeout") {
          await shareCompatibleRead;
          throw new Error(
            "Active Application read tried to upgrade the shared scope-clock lane.",
          );
        }
        expect(readOutcome.value.basis.revisionId).toBe(
          fixture.input.revisionId,
        );
      } finally {
        if (!released) await blocker.query("rollback").catch(() => undefined);
        blocker.release();
      }
    });
  }, 240_000);
});

async function prepareTaskRuntimeReadinessContext(input: {
  readonly db: FlarexMetadataDatabase;
  readonly authority: ApplicationAnalysisAuthority;
  readonly definition: PreparedStandardApplicationDefinitionV1;
  readonly catalog: HashedCanonicalTaskCatalogV1;
  readonly bindings: PreparedApplicationTaskBindingsV1;
  readonly publication: ApplicationPublication;
  readonly snapshot: ApplicationTaskRuntimeReadinessSnapshotPort;
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
      sourceSha256: await runEffect(taskSha256(module.sourceBytes, {
        maximumInputBytes: module.sourceBytes.byteLength,
      })) as TaskDefinitionSha256V1,
    }),
  ));
  const materialization = Object.freeze({
    kind: "task_runtime_materialization_spec" as const,
    runtimeContractIdentity: TASK_RUNTIME_CONTRACT_IDENTITY_V1,
    bridgeAbiIdentity: TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
    compatibilityDate: COMPATIBILITY_DATE,
    compatibilityFlags: Object.freeze(["nodejs_compat"]),
    runtimeProfileIdentity: TASK_RUNTIME_PROFILE_IDENTITY_V1,
    runtimeImplementationVersion: "worker-loader-2026.08.13-postgres-readiness",
    supportedComputeProfiles: Object.freeze([taskComputeProfile]),
    moduleEntryPolicyIdentity: TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  });
  const catalogBinding = input.bindings.catalog.binding;
  const plan = await runEffect(prepareTaskRuntimePublication({
    source,
    catalog: input.catalog,
    taskBindings: input.bindings,
    authority: {
      scopeId: catalogBinding.scopeId,
      candidateId: catalogBinding.candidateId,
      analysisId: catalogBinding.analysisId,
      applicationRevisionId: catalogBinding.revisionId,
      applicationPublicationSha256: Result.getOrThrow(
        Encoding.decodeHex(input.publication.publicationSha256),
      ) as TaskDefinitionSha256V1,
      sourceArtifactRootSha256: Result.getOrThrow(
        Encoding.decodeHex(input.publication.sourceArtifactRootSha256),
      ) as TaskDefinitionSha256V1,
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
  const receipt = await runEffect(receiptAuthority.prepareReceipt(
    plan,
    plan.objects.map(object => Result.getOrThrow(
      receiptAuthority.confirmPublishedObject(object, object.readReference()),
    )),
  ));
  await runEffect(makeApplicationTaskRuntimePublicationRepository(
    input.db,
    receiptAuthority,
  ).publish({
    authority: input.authority,
    publication: receipt,
  }));
  const verified = await runEffect(verifyTaskRuntimeReadiness({
    receiptCanonicalBytes: receipt.readCanonicalBytes(),
    receiptSha256: receipt.readSha256(),
    expected: {
      scopeId: catalogBinding.scopeId,
      candidateId: catalogBinding.candidateId,
      analysisId: catalogBinding.analysisId,
      applicationRevisionId: catalogBinding.revisionId,
      applicationPublicationSha256: Result.getOrThrow(
        Encoding.decodeHex(input.publication.publicationSha256),
      ) as TaskDefinitionSha256V1,
      sourceArtifactRootSha256: Result.getOrThrow(
        Encoding.decodeHex(input.publication.sourceArtifactRootSha256),
      ) as TaskDefinitionSha256V1,
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
  const connected = Object.freeze({
    verify: () => Effect.succeed(Object.freeze({
      status: "verified" as const,
      revisionId: input.publication.revisionId,
      proof,
    })),
    capture: (received: unknown) => {
      if (typeof received !== "object" || received === null) {
        return Result.fail(new Error("Missing readiness proof."));
      }
      const basis = proofs.get(received);
      return basis === undefined
        ? Result.fail(new Error("Foreign readiness proof."))
        : Result.succeed(Object.freeze({
            revisionId: input.publication.revisionId,
            readReceiptSha256: () => receipt.readSha256(),
            readCanonicalBytes: () => basis.readCanonicalBytes(),
            readSha256: () => basis.readSha256(),
          }));
    },
  });
  return Object.freeze({ connected, snapshot: input.snapshot });
}

async function readinessFixture(
  control: PostgresFlarexPersistence,
  target: PostgresFlarexPersistence,
  taskAware = false,
) {
  const deploymentId = "deployment_application_readiness_postgres";
  const provisioned = await createPostgresSplitScopeAuthorityProvisioner(
    control,
    {
      placementPlanner: { plan: () => LOCATOR },
      targetResolver: {
        resolve: async locator =>
          createPostgresLocatedSplitScopeClockTarget(target, locator),
      },
      randomUuid: uuidSequence(1, 2),
    },
  ).ensure({
    deploymentId,
    projectId: "project_application_readiness_postgres",
  });
  await target.query(
    `update fx_system_scope_clock
        set storage_generation = 'flarexdb_v1'
      where scope_id = $1`,
    [provisioned.scope.scopeId],
  );
  const clock = await target.getScopeClock(provisioned.scope.scopeId);
  if (clock === null || clock.storageGeneration !== "flarexdb_v1") {
    throw new Error("Expected PostgreSQL Application authority.");
  }
  const authority: ApplicationAnalysisAuthority = Object.freeze({
    scopeId: clock.scopeId,
    storageGeneration: clock.storageGeneration,
    storageGenerationFence: clock.storageGenerationFence,
    epoch: clock.epoch,
  });
  const analysis = await createApplicationRevision(
    target,
    authority,
    applicationManifest(),
  );
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
  await runEffect(makeApplicationTaskBindingRepository(target.drizzle).register({
    authority,
    bindings,
  }));
  const taskCatalog = createApplicationTaskCatalogSnapshotPort();
  const taskRuntime = taskAware
    ? await prepareTaskRuntimeReadinessContext({
        db: target.drizzle,
        authority,
        definition: preparedDefinition(),
        catalog,
        bindings,
        publication,
        snapshot: createApplicationTaskRuntimeReadinessSnapshotPort(
          taskCatalog,
        ),
      })
    : undefined;
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
        throw new Error("Readiness must not open a commit session.");
      },
    },
  }, { uniqueConstraints, uniqueConstraintEligibility });
  const repository = makeApplicationReadinessRepository({
    controlDb: control.drizzle,
    authority: authorityPorts,
    schema: makeApplicationSchemaAuthorityPublisher({
      db: control.drizzle,
      runTransaction: run => control.drizzle.transaction(run),
    }),
    taskCatalog,
    candidateValidation: createAppSchemaCandidateReadinessPort(
      candidateValidation,
    ),
    pointCommit,
    cold: {
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
      materialize: () => Effect.die(
        new Error("Zero-function PostgreSQL readiness must not materialize."),
      ),
    },
    ...(taskRuntime === undefined ? {} : { taskRuntime }),
  });
  return Object.freeze({
    control,
    target,
    authority,
    authorityPorts,
    candidateValidation,
    repository,
    input: Object.freeze({
      deploymentId,
      revisionId: publication.revisionId,
    }),
  });
}

async function prepareReadinessAuthorities(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
): Promise<CatalogSchemaVersionId> {
  const beforeValidation = await runEffect(
    fixture.repository.settleLegacy(fixture.input),
  );
  expect(beforeValidation).toMatchObject({
    status: "not_ready",
    reason: "candidateValidationMissing",
  });
  const result = await fixture.control.query<{
    schema_version_id: CatalogSchemaVersionId;
  }>("select schema_version_id from fx_control_application_schema_authority_v1");
  const schemaVersionId = result.rows[0]?.schema_version_id;
  if (schemaVersionId === undefined) {
    throw new Error("Expected PostgreSQL Application schema authority.");
  }
  const closure = await runEffect(prepareAppUniqueConstraintSetClosureV1Effect(
    fixture.control.drizzle,
    { deploymentId: fixture.input.deploymentId, schemaVersionId },
  ));
  await fixture.control.drizzle.transaction(tx => runEffect(
    closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure),
  ));
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
    return schemaVersionId;
  }
  throw new Error("PostgreSQL candidate validation did not settle.");
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
      { deploymentId: fixture.input.deploymentId, schemaVersionId },
    ),
  );
  if (requirements === null || requirements.definitions.length === 0) {
    throw new Error("Expected PostgreSQL physical requirements.");
  }
  for (const definition of requirements.definitions) {
    for (let step = 0; step < 16; step += 1) {
      const built = await runEffect(buildIntrinsicCreationTimeIndexV1Effect(
        ports,
        {
          deploymentId: fixture.input.deploymentId,
          indexDefinitionId: definition.indexDefinitionId,
          pageSize: 16,
        },
      ));
      if (built.lifecycle === "enabled") break;
      if (step === 15) throw new Error("PostgreSQL build did not enable.");
    }
  }
}

async function createApplicationRevision(
  target: PostgresFlarexPersistence,
  authority: ApplicationAnalysisAuthority,
  manifest: Readonly<{
    readonly manifest: ApplicationManifestV1;
    readonly canonicalText: string;
  }>,
) {
  const analyses = makeApplicationAnalysisRepository(target.drizzle, {
    randomUuid: uuidSequence(11, 12, 13),
  });
  const pending = await runEffect(analyses.begin({
    authority,
    requestKey: "request:application-readiness:postgres:1",
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
    throw new Error("Expected analyzed PostgreSQL readiness fixture.");
  }
  return analyzed;
}

function applicationManifest() {
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
      tables: [{
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
      }],
      indexes: [],
    },
    functions: [],
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
        sourceBytes: new TextEncoder().encode(
          "export const get = () => null;\n",
        ),
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

function uuidSequence(...sequences: ReadonlyArray<number>): () => string {
  let index = 0;
  return () => {
    const sequence = sequences[index];
    if (sequence === undefined) throw new Error("UUID sequence exhausted.");
    index += 1;
    return `30000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
  };
}

async function scalarCount(
  persistence: PostgresFlarexPersistence,
  tableName: string,
): Promise<number> {
  const result = await persistence.query<{ count: string }>(
    `select count(*)::text as count from ${tableName}`,
  );
  const count = result.rows[0]?.count;
  if (count === undefined) throw new Error(`Missing count for ${tableName}.`);
  return Number(count);
}

async function waitForBlockedBy(
  persistence: PostgresFlarexPersistence,
  blockerPid: number,
  expected: number,
): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await persistence.query<{ blocked: number }>(
      `with recursive blocked(pid) as (
         select activity.pid
           from pg_stat_activity as activity
          where $1::int = any(pg_blocking_pids(activity.pid))

         union

         select activity.pid
           from pg_stat_activity as activity
           join blocked as blocker
             on blocker.pid = any(pg_blocking_pids(activity.pid))
       )
       select count(*)::int as blocked
         from blocked
         join pg_stat_activity as activity using (pid)
        where activity.datname = current_database()`,
      [blockerPid],
    );
    if ((result.rows[0]?.blocked ?? 0) >= expected) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Expected ${expected} readiness transactions to block.`);
}
