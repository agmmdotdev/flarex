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
import {
  prepareStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/internal/prepared-definition-v1";
import { Effect, Result } from "effect";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import { type CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { expect } from "vitest";
import {
  advanceAppSchemaCandidateValidationEffect,
  createAppSchemaCandidateReadinessPort,
  createAppSchemaCandidateValidationPort,
  createLocatedAppSchemaCandidateValidationTarget,
  installAppSchemaCandidateValidationEffect,
  settleAppSchemaCandidateValidationEffect,
} from "../../../src/storage/catalog/appSchemaCandidateValidation";
import {
  createAppUniqueConstraintDefinitionPortV1,
} from "../../../src/storage/unique/appUniqueConstraintCommitV1";
import {
  createAppUniqueConstraintSetEligibilityPortV1,
} from "../../../src/storage/unique/appUniqueConstraintSetBuildV1";
import {
  closeAppUniqueConstraintSetV1InTransactionEffect,
  prepareAppUniqueConstraintSetClosureV1Effect,
} from "../../../src/storage/unique/appUniqueConstraintSetClosureV1";
import {
  makeApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
  type ApplicationAnalysisProjection,
} from "../../../src/application/applicationAnalysisRegistration";
import { makeApplicationPublicationRepository } from "../../../src/application/applicationPublication";
import {
  makeApplicationReadinessRepository,
} from "../../../src/application/readiness/repository";
import {
  makeApplicationSchemaAuthorityPublisher,
} from "../../../src/application/applicationSchemaAuthority";
import {
  createApplicationTaskCatalogSnapshotPort,
  makeApplicationTaskBindingRepository,
} from "../../../src/application/tasks/applicationTaskBindings";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  reconcilePublishedIndexBuildsV1Effect,
} from "../../../src/storage/indexes/indexBuildReconciliation";
import {
  buildIntrinsicCreationTimeIndexV1Effect,
} from "../../../src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import {
  createPostgresLocatedSplitScopeClockTarget,
  createPostgresSplitScopeAuthorityProvisioner,
  type PostgresFlarexPersistence,
} from "../../../src/database/postgres";
import { createPointCommitPublisherPortV1 } from "../../../src/commit/point/construction";
import {
  createPhysicalDefinitionLifecyclePort,
} from "../../../src/installation/physicalDefinitionLifecycle";
import {
  makeInstallationProtectedScopeAuthorityControlReader,
} from "../../../src/scope/scopeAuthorityControlRead";
import type { SplitScopePhysicalLocator } from "../../../src/scope/scopeMetadataTypes";
import { runEffect } from "../../support/effectTestRuntime";

export const ROOT = "a".repeat(64);

export const EXECUTION_SOURCE = "b".repeat(64);

export const SCHEMA_SOURCE = "c".repeat(64);

export const RUNTIME_HOST_IDENTITY = "flarex.test/application-runtime-host";

export const COMPATIBILITY_DATE = "2026-08-12";

export const taskSha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);

export async function readinessFixture(
  control: PostgresFlarexPersistence,
  target: PostgresFlarexPersistence,
) {
  const deploymentId = "deployment_application_readiness_postgres";
  const schemaName = (await target.query<{ name: unknown }>("select current_schema() as name")).rows[0]?.name;
  if (typeof schemaName !== "string" || schemaName.length === 0) throw new Error("Missing fixture schema");
  const physicalLocator = Object.freeze({ kind: "database_per_scope", databaseKey: "application_readiness_postgres_target",
    schemaName }) satisfies SplitScopePhysicalLocator;
  const provisioned = await createPostgresSplitScopeAuthorityProvisioner(
    control,
    {
      placementPlanner: { plan: () => physicalLocator },
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
    `update fx_system_scope_execution_authority
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
      manifest: Result.getOrThrow(
        canonicalizeApplicationManifestV1(analysis.manifest),
      ).manifest,
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
  const locatedTarget = createLocatedAppSchemaCandidateValidationTarget(
    target.drizzle,
    physicalLocator,
  );
  const controlReader = makeInstallationProtectedScopeAuthorityControlReader(control.drizzle);
  const authorityPorts = Object.freeze({
    ...controlReader,
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
    scopeMetadata: authorityPorts.scopeMetadata,
    provisioningReceipts: authorityPorts.provisioningReceipts,
    scopeSessionTargets: {
      resolve: async () => {
        throw new Error("Readiness must not open a commit session.");
      },
    },
  }, { uniqueConstraints, uniqueConstraintEligibility });
  const physicalDefinitionLifecycle = createPhysicalDefinitionLifecyclePort({
    controlDb: control.drizzle,
    authority: authorityPorts,
  });
  const repository = makeApplicationReadinessRepository({
    controlDb: control.drizzle,
    authority: authorityPorts,
    schema: makeApplicationSchemaAuthorityPublisher({
      db: control.drizzle,
      runTransaction: run => control.drizzle.transaction(run),
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
      materialize: () => Effect.die(
        new Error("Zero-function PostgreSQL readiness must not materialize."),
      ),
    },
  });
  return Object.freeze({
    control,
    target,
    physicalLocator,
    authority,
    authorityPorts,
    candidateValidation,
    physicalDefinitionLifecycle,
    repository,
    input: Object.freeze({
      deploymentId,
      scopeId: authority.scopeId,
      revisionId: publication.revisionId,
    }),
  });
}

export async function prepareReadinessAuthorities(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
  beforeClosure?: (schemaVersionId: CatalogSchemaVersionId) => Promise<void>,
): Promise<CatalogSchemaVersionId> {
  const beforeValidation = await runEffect(
    fixture.repository.settle(fixture.input),
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
  if (beforeClosure !== undefined) await beforeClosure(schemaVersionId);
  const closure = await runEffect(prepareAppUniqueConstraintSetClosureV1Effect(
    fixture.control.drizzle,
    { deploymentId: fixture.input.deploymentId, schemaVersionId },
  ));
  await fixture.control.drizzle.transaction(tx => runEffect(
    closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure),
  ));
  const input = {
    deploymentId: fixture.input.deploymentId,
    scopeId: fixture.input.scopeId,
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

export async function enablePhysicalBuilds(
  fixture: Awaited<ReturnType<typeof readinessFixture>>,
  schemaVersionId: CatalogSchemaVersionId,
): Promise<void> {
  const ports = Object.freeze({
    controlDb: fixture.control.drizzle,
    authority: fixture.authorityPorts,
  });
  await runEffect(reconcilePublishedIndexBuildsV1Effect(ports, {
    deploymentId: fixture.input.deploymentId,
    scopeId: fixture.input.scopeId,
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
          scopeId: fixture.input.scopeId,
          indexDefinitionId: definition.indexDefinitionId,
          pageSize: 16,
        },
      ));
      if (built.lifecycle === "enabled") break;
      if (step === 15) throw new Error("PostgreSQL build did not enable.");
    }
  }
}

export async function createApplicationRevision(
  target: PostgresFlarexPersistence,
  authority: ApplicationAnalysisAuthority,
  manifest: Readonly<{
    readonly manifest: ApplicationManifestV1;
    readonly canonicalText: string;
  }>,
): Promise<Extract<ApplicationAnalysisProjection, { readonly status: "analyzed" }>> {
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

export function applicationManifest() {
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

export function preparedDefinition() {
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

export function uuidSequence(...sequences: ReadonlyArray<number>): () => string {
  let index = 0;
  return () => {
    const sequence = sequences[index];
    if (sequence === undefined) throw new Error("UUID sequence exhausted.");
    index += 1;
    return `30000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
  };
}

export async function scalarCount(
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

export async function waitForBlockedBy(
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
