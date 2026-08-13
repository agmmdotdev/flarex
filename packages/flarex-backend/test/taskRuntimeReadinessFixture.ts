import type { TaskComputeProfileRefV1 } from
  "@flarex/durable-task/internal/run-attempt-v1";
import {
  hashCanonicalTaskCatalogV1,
  makeLiveStandardApplicationTaskSha256V1,
  makeTaskRuntimePublicationReceiptAuthority,
  prepareTaskRuntimePublication,
  type PreparedTaskRuntimeObject,
  type StandardApplicationTaskSha256V1,
  type TaskDefinitionSha256V1,
  type TaskRuntimeReadinessPreparationInput,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import { produceStandardApplicationSource } from
  "@flarex/standard-application-definition/application-source";
import { produceApplicationTaskBindingsV1 } from
  "@flarex/standard-application-definition/internal/application-task-binding-v1";
import { prepareStandardApplicationDefinitionV1 } from
  "@flarex/standard-application-definition/v1";
import { Brand, Effect, Result } from "effect";

const UTF8 = new TextEncoder();
const computeProfile = Brand.nominal<TaskComputeProfileRefV1>()("standard-1x");
const digest = (byte: number) =>
  new Uint8Array(32).fill(byte) as TaskDefinitionSha256V1;

export interface TaskRuntimeReadinessFixture {
  readonly sha256: StandardApplicationTaskSha256V1;
  readonly preparationInput: TaskRuntimeReadinessPreparationInput;
  readonly objects: ReadonlyArray<PreparedTaskRuntimeObject>;
}

export async function makeTaskRuntimeReadinessFixture(
  empty = false,
): Promise<TaskRuntimeReadinessFixture> {
  const sha256 = makeLiveStandardApplicationTaskSha256V1();
  const definition = Result.getOrThrow(prepareStandardApplicationDefinitionV1({
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
        sourceBytes: UTF8.encode(
          "export const lookup = () => null; export const run = () => null;\n",
        ),
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
  const source = Result.getOrThrow(produceStandardApplicationSource(definition));
  const catalog = await Effect.runPromise(hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: empty ? [] : [taskManifest()],
  }, sha256));
  const taskBindings = await Effect.runPromise(produceApplicationTaskBindingsV1({
    definition,
    catalog,
    authority: {
      scopeId: "scope-orders",
      revisionId: "revision-orders-v2",
      candidateId: "candidate-orders",
      analysisId: "analysis-orders",
      publicationSha256: "11".repeat(32),
      sourceArtifactRootSha256: "22".repeat(32),
    },
    runtimePolicy: {
      runtimeHostIdentity: "application-runtime-host",
      compatibilityDate: "2026-08-12",
    },
  }, sha256));
  const authenticatedModules = await Promise.all(source.modules.map(
    async (module, ordinal) => ({
      ordinal,
      artifactModulePath: module.path,
      roles: module.roles,
      sourceByteLength: module.sourceBytes.byteLength,
      sourceSha256: await Effect.runPromise(sha256(module.sourceBytes, {
        maximumInputBytes: module.sourceBytes.byteLength,
      })) as TaskDefinitionSha256V1,
    }),
  ));
  const materialization = Object.freeze({
    kind: "task_runtime_materialization_spec" as const,
    runtimeContractIdentity: "flarex.task-runtime/durable-task/v1" as const,
    bridgeAbiIdentity: "flarex.task-runtime-rpc/v1" as const,
    compatibilityDate: "2026-08-12",
    compatibilityFlags: Object.freeze(["nodejs_compat"]),
    runtimeProfileIdentity: "flarex.worker-loader/task-runtime/v1" as const,
    runtimeImplementationVersion: "worker-loader-2026.08.12",
    supportedComputeProfiles: Object.freeze([computeProfile]),
    moduleEntryPolicyIdentity:
      "flarex.task-runtime/module-entry/exact-artifact-path/v1" as const,
  });
  const catalogBinding = taskBindings.catalog.binding;
  const publication = await Effect.runPromise(prepareTaskRuntimePublication({
    source,
    catalog,
    taskBindings,
    authority: {
      scopeId: catalogBinding.scopeId,
      candidateId: catalogBinding.candidateId,
      analysisId: catalogBinding.analysisId,
      applicationRevisionId: catalogBinding.revisionId,
      applicationPublicationSha256: digest(0x11),
      sourceArtifactRootSha256: digest(0x22),
      applicationTaskCatalogBindingSha256: taskBindings.catalog.sha256,
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
  const receiptAuthority = makeTaskRuntimePublicationReceiptAuthority(sha256);
  const receipt = await Effect.runPromise(receiptAuthority.prepareReceipt(
    publication,
    publication.objects.map(object => Result.getOrThrow(
      receiptAuthority.confirmPublishedObject(object, object.readReference()),
    )),
  ));

  return Object.freeze({
    sha256,
    objects: publication.objects,
    preparationInput: Object.freeze({
      receiptCanonicalBytes: receipt.readCanonicalBytes(),
      receiptSha256: receipt.readSha256(),
      expected: Object.freeze({
        scopeId: catalogBinding.scopeId,
        candidateId: catalogBinding.candidateId,
        analysisId: catalogBinding.analysisId,
        applicationRevisionId: catalogBinding.revisionId,
        applicationPublicationSha256: digest(0x11),
        sourceArtifactRootSha256: digest(0x22),
        applicationTaskCatalogBindingSha256: taskBindings.catalog.sha256,
        taskCatalog: catalog,
        materializationPolicy: materialization,
      }),
    }),
  });
}

function taskManifest() {
  return {
    version: 1 as const,
    taskId: "tasks.orders.process",
    handler: {
      logicalModulePath: "tasks/orders",
      artifactModulePath: "tasks/orders.js",
      exportName: "run",
    },
    payloadValidator: { type: "any" as const },
    outputValidator: null,
    runAttemptPolicy: {
      version: 1 as const,
      retry: {
        maxAttempts: 3,
        factor: 2,
        minTimeoutInMs: 1_000,
        maxTimeoutInMs: 60_000,
        randomize: true,
      },
      outOfMemory: { kind: "disabled" as const },
    },
    maximumDurationInSeconds: 300,
    computeProfile,
    queue: { kind: "default" as const },
  };
}
