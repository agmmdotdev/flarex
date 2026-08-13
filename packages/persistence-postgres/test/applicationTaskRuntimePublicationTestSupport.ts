import { canonicalizeApplicationManifestV1 } from
  "@flarex/analysis/application-analysis";
import {
  hashCanonicalTaskCatalogV1,
  makeStandardApplicationTaskSha256V1,
  makeTaskRuntimePublicationReceiptAuthority,
  prepareTaskRuntimePublication,
  TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  TASK_RUNTIME_CONTRACT_IDENTITY_V1,
  TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  TASK_RUNTIME_PROFILE_IDENTITY_V1,
  type TaskDefinitionSha256V1,
  type HashedCanonicalTaskCatalogV1,
  type PreparedTaskRuntimePublicationReceipt,
  type TaskRuntimePublicationReceiptAuthority,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  produceApplicationTaskBindingsV1,
  type PreparedApplicationTaskBindingsV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import { prepareStandardApplicationDefinitionV1 } from
  "@flarex/standard-application-definition/v1";
import type { PreparedStandardApplicationDefinitionV1 } from
  "@flarex/standard-application-definition/v1";
import { produceStandardApplicationSource } from
  "@flarex/standard-application-definition/application-source";
import type { TaskComputeProfileRefV1 } from
  "@flarex/durable-task/internal/run-attempt-v1";
import { Brand, Effect, Encoding, Result } from "effect";
import {
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
} from "flarex-protocol/internal/declarative-v2-source-artifact-v2";
import {
  FlarexDbV1StorageGenerationSchema,
  ScopeEpochSchema,
  ScopeIdSchema,
  StorageGenerationFenceSchema,
} from "flarex-protocol/storage-authority";

import {
  makeApplicationAnalysisRepository,
  type ApplicationAnalysisAuthority,
} from "../src/applicationAnalysisRegistration";
import { makeApplicationPublicationRepository } from
  "../src/applicationPublication";
import { makeApplicationTaskBindingRepository } from
  "../src/applicationTaskBindings";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { createPGlitePersistence } from "../src/pglite";
import { runEffect } from "./effectTestRuntime";
import {
  insertSessionTestScope,
  SESSION_TEST_EPOCH_UUID,
  SESSION_TEST_SCOPE_UUID,
} from "./sessionAuthorityTestSupport";

const ROOT = "a".repeat(64);
const SOURCE = "b".repeat(64);
const SCHEMA_SOURCE = "c".repeat(64);
export const TASK_RUNTIME_PUBLICATION_AUTHORITY: ApplicationAnalysisAuthority =
  Object.freeze({
    scopeId: ScopeIdSchema.make(`scope_${SESSION_TEST_SCOPE_UUID}`),
    storageGeneration: FlarexDbV1StorageGenerationSchema.make("flarexdb_v1"),
    storageGenerationFence: StorageGenerationFenceSchema.make(1n),
    epoch: ScopeEpochSchema.make(`epoch_${SESSION_TEST_EPOCH_UUID}`),
  });
const sha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);
const computeProfile = Brand.nominal<TaskComputeProfileRefV1>()("standard-1x");
const competingPublications = new WeakMap<object, PreparedTaskRuntimePublicationReceipt>();

export interface TaskRuntimePublicationFixture {
  readonly db: FlarexMetadataDatabase;
  readonly persistence: Awaited<ReturnType<typeof createPGlitePersistence>>;
  readonly authority: ApplicationAnalysisAuthority;
  readonly publication: PreparedTaskRuntimePublicationReceipt;
  readonly receiptAuthority: TaskRuntimePublicationReceiptAuthority;
}

export interface TaskRuntimePublicationDatabaseFixture {
  readonly db: FlarexMetadataDatabase;
  readonly authority: ApplicationAnalysisAuthority;
  readonly publication: PreparedTaskRuntimePublicationReceipt;
  readonly receiptAuthority: TaskRuntimePublicationReceiptAuthority;
}

export async function makeTaskRuntimePublicationFixture(empty = false): Promise<TaskRuntimePublicationFixture> {
  const persistence = await createPGlitePersistence();
  await persistence.migrate();
  await insertSessionTestScope(persistence);
  const fixture = await makeTaskRuntimePublicationFixtureOnDatabase(
    persistence.drizzle,
    empty,
  );
  return Object.freeze({ ...fixture, persistence });
}

export async function makeTaskRuntimePublicationFixtureOnDatabase(
  db: FlarexMetadataDatabase,
  empty = false,
): Promise<TaskRuntimePublicationDatabaseFixture> {
  const identities = [
    "24000000-0000-4000-8000-000000000001",
    "24000000-0000-4000-8000-000000000002",
    "24000000-0000-4000-8000-000000000003",
  ];
  let identityIndex = 0;
  const analyses = makeApplicationAnalysisRepository(db, {
    randomUuid: () => identities[identityIndex++] ??
      (() => { throw new Error("Identity fixture exhausted."); })(),
  });
  const pending = await runEffect(analyses.begin({
    authority: TASK_RUNTIME_PUBLICATION_AUTHORITY,
    requestKey: "request:task-runtime-publication:1",
    sourceArtifactRootSha256: ROOT,
    analyzerIdentity: "analyzer-1",
    analyzerPolicyIdentity: "policy-1",
  }));
  const analyzed = await runEffect(analyses.settle(
    TASK_RUNTIME_PUBLICATION_AUTHORITY,
    {
      kind: "analyzed",
      candidateId: pending.candidateId,
      sourceArtifactRootSha256: ROOT,
      analyzerIdentity: "analyzer-1",
      analyzerPolicyIdentity: "policy-1",
      canonicalManifest: canonicalManifest().canonicalText,
    },
  ));
  if (analyzed.status !== "analyzed") throw new Error("Expected analysis.");
  const appPublication = await runEffect(
    makeApplicationPublicationRepository(db).publish({
      authority: TASK_RUNTIME_PUBLICATION_AUTHORITY,
      revisionId: analyzed.revision.revisionId,
      candidateId: analyzed.candidateId,
      analysisId: analyzed.analysisId,
      manifestSha256: analyzed.manifestSha256,
      manifest: analyzed.manifest,
    }),
  );
  const definition = preparedDefinition();
  const catalog = await runEffect(hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: empty ? [] : [taskManifest()],
  }, sha256));
  const bindings = await runEffect(produceApplicationTaskBindingsV1({
    definition,
    catalog,
    authority: {
      scopeId: appPublication.scopeId,
      revisionId: appPublication.revisionId,
      candidateId: appPublication.candidateId,
      analysisId: appPublication.analysisId,
      sourceArtifactRootSha256: appPublication.sourceArtifactRootSha256,
      publicationSha256: appPublication.publicationSha256,
    },
    runtimePolicy: {
      runtimeHostIdentity: "flarex.test/application-runtime-host",
      compatibilityDate: "2026-08-12",
    },
  }, sha256));
  await runEffect(makeApplicationTaskBindingRepository(db).register({
    authority: TASK_RUNTIME_PUBLICATION_AUTHORITY,
    bindings,
  }));
  const receiptAuthority = makeTaskRuntimePublicationReceiptAuthority(sha256);
  const publication = await prepareConfirmedPublication(
    definition,
    catalog,
    bindings,
    appPublication.candidateId,
    appPublication.revisionId,
    empty,
    3,
    receiptAuthority,
  );
  const competing = await prepareConfirmedPublication(
    definition,
    catalog,
    bindings,
    appPublication.candidateId,
    appPublication.revisionId,
    empty,
    99,
    receiptAuthority,
  );
  competingPublications.set(publication, competing);
  return Object.freeze({
    db,
    authority: TASK_RUNTIME_PUBLICATION_AUTHORITY,
    publication,
    receiptAuthority,
  });
}

export function makeCompetingTaskRuntimePublication(
  publication: PreparedTaskRuntimePublicationReceipt,
): Promise<PreparedTaskRuntimePublicationReceipt> {
  const competing = competingPublications.get(publication);
  return competing === undefined
    ? Promise.reject(new Error("Missing competing publication fixture."))
    : Promise.resolve(competing);
}

function digest(byte: number): TaskDefinitionSha256V1 {
  return new Uint8Array(32).fill(byte) as TaskDefinitionSha256V1;
}

async function prepareConfirmedPublication(
  definition: PreparedStandardApplicationDefinitionV1,
  catalog: HashedCanonicalTaskCatalogV1,
  bindings: PreparedApplicationTaskBindingsV1,
  candidateId: string,
  revisionId: string,
  empty: boolean,
  semanticByte: number,
  receiptAuthority: TaskRuntimePublicationReceiptAuthority,
): Promise<PreparedTaskRuntimePublicationReceipt> {
  const source = Result.getOrThrow(produceStandardApplicationSource(definition));
  const authenticatedModules = await Promise.all(source.modules.map(
    async (module, ordinal) => ({
      ordinal,
      artifactModulePath: module.path,
      roles: module.roles,
      sourceByteLength: module.sourceBytes.byteLength,
      sourceSha256: await runEffect(sha256(module.sourceBytes, {
        maximumInputBytes: module.sourceBytes.byteLength,
      })) as TaskDefinitionSha256V1,
    }),
  ));
  const materialization = Object.freeze({
    kind: "task_runtime_materialization_spec" as const,
    runtimeContractIdentity: TASK_RUNTIME_CONTRACT_IDENTITY_V1,
    bridgeAbiIdentity: TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
    compatibilityDate: "2026-08-12",
    compatibilityFlags: Object.freeze(["nodejs_compat"]),
    runtimeProfileIdentity: TASK_RUNTIME_PROFILE_IDENTITY_V1,
    runtimeImplementationVersion: `worker-loader-2026.08.12-${semanticByte}`,
    supportedComputeProfiles: Object.freeze([computeProfile]),
    moduleEntryPolicyIdentity: TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  });
  const catalogBinding = bindings.catalog.binding;
  const plan = await runEffect(prepareTaskRuntimePublication({
    source,
    catalog,
    taskBindings: bindings,
    authority: {
      scopeId: catalogBinding.scopeId,
      candidateId,
      analysisId: catalogBinding.analysisId,
      applicationRevisionId: revisionId,
      applicationPublicationSha256: Result.getOrThrow(
        Encoding.decodeHex(catalogBinding.publicationSha256),
      ) as TaskDefinitionSha256V1,
      sourceArtifactRootSha256: (
        Result.getOrThrow(
          Encoding.decodeHex(catalogBinding.sourceArtifactRootSha256),
        ) as TaskDefinitionSha256V1
      ),
      applicationTaskCatalogBindingSha256: bindings.catalog.sha256,
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
  }, sha256));
  if (empty !== (plan.kind === "empty_catalog")) {
    throw new Error("Unexpected publication-plan kind.");
  }
  const confirmations = plan.objects.map(item => Result.getOrThrow(
    receiptAuthority.confirmPublishedObject(item, item.readReference()),
  ));
  return runEffect(receiptAuthority.prepareReceipt(
    plan,
    confirmations,
  ));
}

function taskManifest() {
  return {
    version: 1,
    taskId: "tasks.orders.process",
    handler: {
      logicalModulePath: "tasks/orders",
      artifactModulePath: "tasks/orders.js",
      exportName: "run",
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
        modulePath: "tasks/orders",
        functions: [{
          exportName: "lookup",
          kind: "query",
          visibility: "internal",
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
        path: "tasks/orders.js",
        roles: ["function", "execution"],
        sourceBytes: new TextEncoder().encode("export const run = () => null;\n"),
        sourceMapBytes: null,
      }],
      functionEntries: [{
        logicalModulePath: "tasks/orders",
        artifactModulePath: "tasks/orders.js",
      }],
      executionPath: "tasks/orders.js",
      schemaPath: null,
      authPath: null,
    },
  }));
}

function canonicalManifest() {
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
        sourceSha256: SOURCE,
        sourceByteLength: 128,
      }, {
        path: "_flarex/schema.js",
        roles: SOURCE_ARTIFACT_V2_ROLE_SCHEMA,
        sourceSha256: SCHEMA_SOURCE,
        sourceByteLength: 128,
      }],
    },
    schema: { version: 1, tables: [], indexes: [] },
    functions: [],
  }));
}
