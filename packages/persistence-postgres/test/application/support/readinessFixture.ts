import {
  canonicalizeApplicationManifestV1,
  type ApplicationManifestV1,
} from "@flarex/analysis/application-analysis";
import {
  hashCanonicalTaskCatalogV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  produceApplicationTaskBindingsV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import { Effect, Result } from "effect";
import {
  canonicalizeApplicationRuntimeColdReceiptV1,
} from "flarex-protocol/internal/application-runtime-cold-receipt-v1";
import {
  canonicalizeApplicationRuntimeTargetV1,
  type CanonicalApplicationRuntimeTargetV1,
} from "flarex-protocol/internal/application-runtime-target-v1";
import { newTestPGlite } from "../../support/pgliteSearchExtensions";
import { migratedPGliteDataDir } from "../../support/pgliteTestFixture";
import {
  createAppSchemaCandidateReadinessPort,
  createAppSchemaCandidateValidationPort,
  createLocatedAppSchemaCandidateValidationTarget,
} from "../../../src/storage/catalog/appSchemaCandidateValidation";
import {
  createAppUniqueConstraintDefinitionPortV1,
} from "../../../src/storage/unique/appUniqueConstraintCommitV1";
import {
  createAppUniqueConstraintSetEligibilityPortV1,
} from "../../../src/storage/unique/appUniqueConstraintSetBuildV1";
import {
  type ApplicationAnalysisAuthority,
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
  createPGliteLocatedSplitScopeClockTarget,
  createPGlitePersistence,
  createPGliteSplitScopeAuthorityProvisioner,
} from "../../../src/database/pglite";
import { createPointCommitPublisherPortV1 } from "../../../src/commit/point/construction";
import {
  createPhysicalDefinitionLifecyclePort,
} from "../../../src/installation/physicalDefinitionLifecycle";
import {
  makeInstallationProtectedScopeAuthorityControlReader,
} from "../../../src/scope/scopeAuthorityControlRead";
import { runEffect } from "../../support/effectTestRuntime";
import { onTestFinished } from "vitest";
import {
  RUNTIME_HOST_IDENTITY,
  COMPATIBILITY_DATE,
  LOCATOR,
  taskSha256,
  applicationManifest,
  preparedDefinition,
  taskManifest,
} from "./readinessArtifacts";
import { createApplicationRevision } from "./readinessPublication";
import { uuidSequence, sha256Hex } from "./readinessEvidence";

export type TestPersistence = Awaited<ReturnType<typeof createPGlitePersistence>>;

export interface ReadinessFixtureOptions {
  /** Already migrated; its instrumented driver remains owned by the caller. */
  readonly targetPersistence?: TestPersistence;
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

export async function readinessFixture(options: ReadinessFixtureOptions = {}) {
  const [control, target] = await Promise.all([
    createReadinessPGlitePersistence(),
    options.targetPersistence ?? createReadinessPGlitePersistence(),
  ]);
  const schemaControl = options.foreignSchemaControl === true
    ? await createReadinessPGlitePersistence()
    : control;
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
    `update fx_system_scope_execution_authority
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
            `update fx_system_scope_execution_authority
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
      scopeId: authority.scopeId,
      revisionId: publication.revisionId,
    }),
    materializationCount: () => materializations,
  });
}

export async function createReadinessPGlitePersistence(): Promise<TestPersistence> {
  const db = newTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
  onTestFinished(() => db.close());
  return createPGlitePersistence({ db });
}
