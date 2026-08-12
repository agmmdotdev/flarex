import type {
  TaskComputeProfileRefV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Brand, Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  produceApplicationTaskBindingsV1,
} from "../src/applicationTaskBinding/v1";
import {
  hashCanonicalTaskCatalogV1,
  makeStandardApplicationTaskSha256V1,
  prepareTaskRuntimePublicationV1,
  TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  TASK_RUNTIME_CONTRACT_IDENTITY_V1,
  TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  TASK_RUNTIME_PROFILE_IDENTITY_V1,
  type HashedCanonicalTaskCatalogV1,
  type TaskDefinitionSha256V1,
  type TaskRuntimePublicationPreparationInputV1,
} from "../src/taskDefinition/v1";
import {
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2CandidateFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import { prepareStandardApplicationDefinitionV1 } from "../src/v1";
import { produceStandardApplicationSource } from "../src/applicationSource";

const UTF8 = new TextEncoder();
const sha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);
const digest = (byte: number) =>
  new Uint8Array(32).fill(byte) as TaskDefinitionSha256V1;
const computeProfile = Brand.nominal<TaskComputeProfileRefV1>()("standard-1x");

describe("task runtime publication preparation V1", () => {
  it("deterministically prepares owned runtime bodies, references, binding, and receipt", async () => {
    const input = await makeInput();
    const first = await Effect.runPromise(
      prepareTaskRuntimePublicationV1(input, sha256),
    );
    const replay = await Effect.runPromise(
      prepareTaskRuntimePublicationV1(input, sha256),
    );

    expect(first.kind).toBe("populated_catalog");
    if (first.kind !== "populated_catalog") throw new Error("expected populated");
    expect(first.objects.map(item => item.role)).toEqual([
      "runtime_projection_module",
      "runtime_projection_module",
      "runtime_projection_module",
      "task_runtime_projection",
      "task_runtime_entry",
      "task_runtime_group_manifest",
      "task_runtime_materialization_spec",
    ]);
    const firstReceipt = first.readReceiptPreimage();
    const replayReceipt = replay.readReceiptPreimage();
    expect(firstReceipt).toEqual(replayReceipt);
    expect(firstReceipt.runtimeObjects).toEqual(
      first.objects.map(item => ({
        ordinal: item.ordinal,
        codecIdentity: item.codecIdentity,
        reference: item.readReference(),
      })),
    );
    expect(first.readApplicationRevisionTaskBindingSha256()).not.toEqual(
      input.authority.candidateSha256,
    );
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.objects)).toBe(true);
    expect(Object.isFrozen(firstReceipt.runtimeObjects)).toBe(true);

    const sourceBytes = input.source.modules[0]!
      .sourceBytes;
    const authenticatedDigest = input.authority.authenticatedModules[0]!
      .sourceSha256;
    sourceBytes[0] = sourceBytes[0]! ^ 0xff;
    authenticatedDigest[0] = authenticatedDigest[0]! ^ 0xff;
    input.catalog.taskCatalogSha256[0] =
      input.catalog.taskCatalogSha256[0]! ^ 0xff;
    const returnedBody = first.objects[0]!.readCanonicalBytes();
    returnedBody[0] = returnedBody[0]! ^ 0xff;
    expect(first.objects[0]!.readCanonicalBytes()).toEqual(
      replay.objects[0]!.readCanonicalBytes(),
    );
    const returnedReference = first.objects[0]!.readReference();
    returnedReference.sha256[0] = returnedReference.sha256[0]! ^ 0xff;
    expect(first.readReceiptPreimage().runtimeObjects[0]!.reference.sha256).toEqual(
      replayReceipt.runtimeObjects[0]!.reference.sha256,
    );
  });

  it("prepares an explicit empty catalog without runtime objects", async () => {
    const input = await makeInput(true);
    const prepared = await Effect.runPromise(
      prepareTaskRuntimePublicationV1(input, sha256),
    );

    expect(prepared).toMatchObject({
      kind: "empty_catalog",
      objects: [],
      canonicalByteLength: 0,
    });
    expect(prepared.readApplicationRevisionTaskBinding().taskCount).toBe(0n);
    expect(prepared.readReceiptPreimage().runtimeObjects).toEqual([]);
  });

  it("projects authenticated source bytes when the prepared graph has a source map", async () => {
    const input = await makeInput();
    const prepared = await Effect.runPromise(prepareTaskRuntimePublicationV1({
      ...input,
      source: {
        ...input.source,
        modules: input.source.modules.map(
          module => module.roles === 1
            ? { ...module, sourceMapBytes: UTF8.encode("{}") }
            : module,
        ),
      },
    }, sha256));

    expect(prepared.kind).toBe("populated_catalog");
    expect(prepared.objects[0]?.role).toBe("runtime_projection_module");
  });

  it("rejects forged catalog, source evidence, binding, and runtime policy", async () => {
    const original = await makeInput();
    const cases: ReadonlyArray<readonly [
      TaskRuntimePublicationPreparationInputV1,
      string,
    ]> = [
      [{
        ...original,
        catalog: Object.freeze({
          ...original.catalog,
          taskCatalogSha256: digest(99),
        }) as HashedCanonicalTaskCatalogV1,
      }, "task_binding_mismatch"],
      [{
        ...original,
        authority: {
          ...original.authority,
          authenticatedModules: original.authority.authenticatedModules.map(
            module => ({ ...module, sourceSha256: digest(98) }),
          ),
        },
      }, "authenticated_evidence_mismatch"],
      [{
        ...original,
        taskBindings: {
          ...original.taskBindings,
          definitions: original.taskBindings.definitions.map(definition => ({
            ...definition,
            binding: {
              ...definition.binding,
              applicationTaskCatalogBindingSha256: digest(97),
            },
          })),
        },
      }, "task_binding_mismatch"],
      [{
        ...original,
        policy: {
          ...original.policy,
          admittedRuntimeImplementationVersion: "worker-loader-other",
        },
      }, "unsupported_materialization_policy"],
    ];

    for (const [input, reason] of cases) {
      await expect(Effect.runPromise(
        prepareTaskRuntimePublicationV1(input, sha256),
      )).rejects.toMatchObject({
        _tag: "InvalidTaskRuntimePublicationV1Error",
        operation: "prepare_publication",
        reason,
      });
    }
  });
});

async function makeInput(
  empty = false,
): Promise<TaskRuntimePublicationPreparationInputV1> {
  const definition = makeDefinition();
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
  const authenticatedModules = await Promise.all(
    source.modules.map(async (module, ordinal) => ({
      ordinal,
      artifactModulePath: module.path,
      roles: module.roles,
      sourceByteLength: module.sourceBytes.byteLength,
      sourceSha256: await Effect.runPromise(sha256(module.sourceBytes, {
        maximumInputBytes: module.sourceBytes.byteLength,
      })) as TaskDefinitionSha256V1,
    })),
  );
  const materialization = Object.freeze({
    kind: "task_runtime_materialization_spec" as const,
    runtimeContractIdentity: TASK_RUNTIME_CONTRACT_IDENTITY_V1,
    bridgeAbiIdentity: TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
    compatibilityDate: "2026-08-12",
    compatibilityFlags: Object.freeze(["nodejs_compat"]),
    runtimeProfileIdentity: TASK_RUNTIME_PROFILE_IDENTITY_V1,
    runtimeImplementationVersion: "worker-loader-2026.08.12",
    supportedComputeProfiles: Object.freeze([computeProfile]),
    moduleEntryPolicyIdentity: TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  });
  const candidate = makeCandidate();
  const encodedCandidate = Result.getOrThrow(encodeDeclarativeV2PhysicalFrameV1(
    candidate,
    { maximumFrameBytes: 1_024 * 1_024, maximumCanonicalBytes: 1_024 * 1_024 },
  ));
  const candidateSha256 = await Effect.runPromise(sha256(
    encodedCandidate.canonicalBytes,
    { maximumInputBytes: encodedCandidate.canonicalBytes.byteLength },
  )) as TaskDefinitionSha256V1;
  return {
    source,
    catalog,
    taskBindings,
    authority: {
      candidateId: "candidate-orders",
      candidate,
      candidateSha256,
      applicationRevisionId: "revision-orders-v2",
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
  };
}

function makeCandidate(): DeclarativeV2CandidateFrameV1 {
  return {
    kind: "candidate",
    projectId: "project-orders",
    deploymentId: "candidate-orders",
    deploymentCreatedAt: "2026-08-12T00:00:00.000Z",
    scopeId: "scope-orders",
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: 1n,
    scopeEpoch: "scope-epoch-orders",
    sourceRootSha256: digest(0x22),
    sourceSelectorSha256: digest(2),
    sourceCodecIdentity: "source-v2",
    semanticRootSha256: digest(3),
    semanticSelectorSha256: digest(4),
    semanticModelIdentity: "declarative-v2",
    semanticCodecIdentity: "ndjson-v1",
    semanticPolicyIdentity: "semantic-policy-v1",
    packageSha256: digest(5),
    artifactSha256: digest(6),
    artifactRuntimeIdentity: "runtime-v1",
    schemaArtifactSha256: digest(7),
    schemaBindingSha256: digest(8),
    validatorRootSha256: digest(9),
    coreLanguageIdentity: "core-v1",
    abiIdentity: "abi-v1",
    grammarIdentity: "grammar-v1",
    unicodeIdentity: "unicode-14",
    parserTableIdentity: "parser-v1",
    analyzerIdentity: "analyzer-v2",
    verifierIdentity: "verifier-v1",
    declaredHandlerSetSha256: digest(10),
    deploymentAnalysisCodecIdentity: "analysis-v1",
    deploymentAnalysisByteLength: 20n,
    deploymentAnalysisSha256: digest(11),
    deploymentCodegenAnalysisCodecIdentity: "codegen-v1",
    deploymentCodegenAnalysisByteLength: 21n,
    deploymentCodegenAnalysisSha256: digest(12),
    runtimeProjectionSetSha256: digest(13),
    functionGroupManifestSha256: digest(14),
    readinessPolicyIdentity:
      "flarex.readiness/runtime-projection-cold-materialization/v1",
  };
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

function makeDefinition() {
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
}
