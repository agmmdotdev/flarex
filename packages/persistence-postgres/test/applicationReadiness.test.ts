import { webcrypto } from "node:crypto";

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
import { Effect, Result } from "effect";
import {
  canonicalizeApplicationRuntimeColdReceiptV1,
} from "flarex-protocol/internal/application-runtime-cold-receipt-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import type { CatalogSchemaVersionId } from
  "flarex-protocol/schema-manifest";
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
import { makeApplicationSchemaAuthorityPublisher } from
  "../src/applicationSchemaAuthority";
import { makeApplicationTaskBindingRepository } from
  "../src/applicationTaskBindings";
import {
  createPGliteLocatedSplitScopeClockTarget,
  createPGlitePersistence,
  createPGliteSplitScopeAuthorityProvisioner,
} from "../src/pglite";
import {
  loadPublishedPhysicalRequirementSnapshotV1,
  reconcilePublishedIndexBuildsV1Effect,
} from "../src/indexBuildReconciliation";
import {
  buildIntrinsicCreationTimeIndexV1Effect,
} from "../src/intrinsicCreationTimeIndexBuildV1";
import { createPointCommitPublisherPortV1 } from
  "../src/pointCommitTransaction";
import { getScopeAuthorityProvisioningReceipt } from
  "../src/scopeAuthorityProvisioningReceipt";
import { runEffect } from "./effectTestRuntime";
import type { SplitScopePhysicalLocator } from
  "../src/scopeMetadataTypes";

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

  it("keeps a reserved schema authority repairable when publication fails", async () => {
    const fixture = await readinessFixture({ failSchemaPublication: true });

    const result = await runEffect(Effect.result(
      fixture.repository.settle(fixture.input),
    ));
    const authorities = await fixture.control.query<{ status: string }>(
      `select status from fx_control_application_schema_authority_v1`,
    );

    expect(Result.isFailure(result)).toBe(true);
    expect(authorities.rows).toEqual([{ status: "reserved" }]);
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

type TestPersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

interface ReadinessFixtureOptions {
  readonly registerTaskCatalog?: boolean;
  readonly includeFunction?: boolean;
  readonly includeTable?: boolean;
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
  const repository = makeApplicationReadinessRepository({
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
    candidateValidation: createAppSchemaCandidateReadinessPort(
      candidateValidation,
    ),
    pointCommit,
    cold: {
      runtimeHostIdentity: RUNTIME_HOST_IDENTITY,
      compatibilityDate: COMPATIBILITY_DATE,
      materialize: input => Effect.promise(async () => {
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
  return Object.freeze({
    control,
    target,
    authority,
    authorityPorts,
    candidateValidation,
    pointCommit,
    repository,
    input: Object.freeze({
      deploymentId,
      revisionId: publication.revisionId,
    }),
    materializationCount: () => materializations,
  });
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
    for (let step = 0; step < 16; step += 1) {
      const built = await runEffect(buildIntrinsicCreationTimeIndexV1Effect(
        ports,
        Object.freeze({
          deploymentId: fixture.input.deploymentId,
          indexDefinitionId: definition.indexDefinitionId,
          pageSize: 16,
        }),
      ));
      if (built.lifecycle === "enabled") break;
      if (step === 15) {
        throw new Error("Application physical build did not enable.");
      }
    }
  }
}

async function createApplicationRevision(
  target: TestPersistence,
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
    requestKey: "request:application-readiness:1",
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

function applicationManifest(includeFunction: boolean, includeTable: boolean) {
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
      indexes: [],
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
