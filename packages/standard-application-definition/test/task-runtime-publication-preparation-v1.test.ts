import type {
  TaskComputeProfileRefV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Brand, Effect, Encoding, Result } from "effect";
import { describe, expect, it } from "vitest";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";

import {
  produceApplicationTaskBindingsV1,
} from "../src/applicationTaskBinding/v1";
import {
  hashCanonicalTaskCatalogV1,
  decodeTaskRuntimePublicationReceipt,
  encodeTaskRuntimePublicationReceipt,
  makeStandardApplicationTaskSha256V1,
  makeTaskRuntimePublicationReceiptAuthority,
  prepareTaskRuntimePublication,
  taskRuntimeObjectKeyV1,
  MAX_TASK_CATALOG_ENTRIES_V1,
  MAX_TASK_RUNTIME_PUBLICATION_MODULES_V1,
  TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  TASK_RUNTIME_CONTRACT_IDENTITY_V1,
  TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  TASK_RUNTIME_PROFILE_IDENTITY_V1,
  type HashedCanonicalTaskCatalogV1,
  type TaskDefinitionSha256V1,
  type TaskRuntimePublicationReceipt,
  type TaskRuntimePublicationPreparationInput,
} from "../src/taskDefinition/v1";
import { prepareStandardApplicationDefinitionV1 } from "../src/v1";
import { produceStandardApplicationSource } from "../src/applicationSource";

const UTF8 = new TextEncoder();
const sha256 = makeStandardApplicationTaskSha256V1(input =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);
const receiptAuthority = makeTaskRuntimePublicationReceiptAuthority(sha256);
const digest = (byte: number) =>
  new Uint8Array(32).fill(byte) as TaskDefinitionSha256V1;
const computeProfile = Brand.nominal<TaskComputeProfileRefV1>()("standard-1x");

function receiptWithRoleCounts(
  receipt: TaskRuntimePublicationReceipt,
  moduleCount: number,
  entryCount: number,
): TaskRuntimePublicationReceipt {
  const singleton = (role: "task_runtime_projection" |
    "task_runtime_group_manifest" |
    "task_runtime_materialization_spec") => {
    const item = receipt.runtimeObjects.find(
      candidate => candidate.reference.role === role,
    );
    if (item === undefined) throw new Error(`Missing ${role}.`);
    return item;
  };
  const repeated = (
    role: "runtime_projection_module" | "task_runtime_entry",
    count: number,
  ) => Array.from({ length: count }, (_, index) => {
    const value = new Uint8Array(32);
    value[0] = role === "runtime_projection_module" ? 0x41 : 0x42;
    new DataView(value.buffer).setUint32(28, index, false);
    const sha256Value = value as TaskDefinitionSha256V1;
    return Object.freeze({
      ordinal: BigInt(index),
      codecIdentity: role === "runtime_projection_module"
        ? "flarex.standard-application/task-runtime-projection-module/v1"
        : "flarex.standard-application/task-runtime-entry/v1",
      reference: Object.freeze({
        storeIdentity: "flarex.r2/standard-application-task-runtime/v1" as const,
        role,
        objectKey: taskRuntimeObjectKeyV1(
          role,
          encodeBytesToLowercaseHex(sha256Value),
        ),
        byteLength: 1n,
        sha256: sha256Value,
      }),
    });
  });
  return Object.freeze({
    ...receipt,
    runtimeObjects: Object.freeze([
      ...repeated("runtime_projection_module", moduleCount),
      singleton("task_runtime_projection"),
      ...repeated("task_runtime_entry", entryCount),
      singleton("task_runtime_group_manifest"),
      singleton("task_runtime_materialization_spec"),
    ]),
  });
}

describe("task runtime publication preparation", () => {
  it("deterministically prepares owned runtime bodies, references, binding, and receipt", async () => {
    const input = await makeInput();
    const first = await Effect.runPromise(
      prepareTaskRuntimePublication(input, sha256),
    );
    const replay = await Effect.runPromise(
      prepareTaskRuntimePublication(input, sha256),
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
    const firstReceipt = first.readReceipt();
    const replayReceipt = replay.readReceipt();
    expect(firstReceipt).toEqual(replayReceipt);
    expect(firstReceipt.runtimeObjects).toEqual(
      first.objects.map(item => ({
        ordinal: item.ordinal,
        codecIdentity: item.codecIdentity,
        reference: item.readReference(),
      })),
    );
    expect(first.readApplicationRevisionTaskBindingSha256()).not.toEqual(
      input.authority.applicationTaskCatalogBindingSha256,
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
    expect(first.readReceipt().runtimeObjects[0]!.reference.sha256).toEqual(
      replayReceipt.runtimeObjects[0]!.reference.sha256,
    );
  });

  it("prepares an explicit empty catalog without runtime objects", async () => {
    const input = await makeInput(true);
    const prepared = await Effect.runPromise(
      prepareTaskRuntimePublication(input, sha256),
    );

    expect(prepared).toMatchObject({
      kind: "empty_catalog",
      objects: [],
      canonicalByteLength: 0,
    });
    expect(prepared.readApplicationRevisionTaskBinding().taskCount).toBe(0n);
    expect(prepared.readReceipt().runtimeObjects).toEqual([]);
  });

  it("canonically encodes, hashes, decodes, and owns the publication receipt", async () => {
    const publication = await Effect.runPromise(
      prepareTaskRuntimePublication(await makeInput(), sha256),
    );
    const prepared = await Effect.runPromise(
      receiptAuthority.prepareReceipt(
        publication,
        publication.objects.map(item => Result.getOrThrow(
          receiptAuthority.confirmPublishedObject(item, item.readReference()),
        )),
      ),
    );
    const bytes = prepared.readCanonicalBytes();
    const decoded = decodeTaskRuntimePublicationReceipt(bytes);
    expect(Result.isSuccess(decoded)).toBe(true);
    if (Result.isFailure(decoded)) throw decoded.failure;
    expect(decoded.success).toEqual(publication.readReceipt());
    expect(Object.keys(decoded.success)).not.toEqual(expect.arrayContaining([
      "candidateSha256",
      "packageSha256",
      "artifactSha256",
      "sourceRootSha256",
      "semanticRootSha256",
    ]));
    expect(encodeTaskRuntimePublicationReceipt(decoded.success))
      .toEqual(Result.succeed(bytes));
    expect(Encoding.encodeHex(prepared.readSha256())).toBe(
      "b53a63b8e214ef7d2e86b71131ba075bf201b09643f680696766122487503a75",
    );

    decoded.success.applicationPublicationSha256[0] =
      (decoded.success.applicationPublicationSha256[0] ?? 0) ^ 0xff;
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    expect(Encoding.encodeHex(prepared.readSha256())).toBe(
      "b53a63b8e214ef7d2e86b71131ba075bf201b09643f680696766122487503a75",
    );
    expect(prepared.readCanonicalBytes()[0]).not.toBe(bytes[0]);
  });

  it("rejects malformed receipt membership and hostile input without invoking accessors", async () => {
    const publication = await Effect.runPromise(
      prepareTaskRuntimePublication(await makeInput(), sha256),
    );
    const receipt = publication.readReceipt();
    const wrongOrdinal = {
      ...receipt,
      runtimeObjects: receipt.runtimeObjects.map((item, index) =>
        index === 0 ? { ...item, ordinal: 1n } : item
      ),
    };
    expect(Result.isFailure(
      encodeTaskRuntimePublicationReceipt(wrongOrdinal),
    )).toBe(true);

    let invoked = false;
    const hostile = Object.create(null) as Record<string, unknown>;
    for (const [key, value] of Object.entries(receipt)) {
      Object.defineProperty(hostile, key, key === "scopeId"
        ? { enumerable: true, get: () => { invoked = true; throw new Error("hostile"); } }
        : { enumerable: true, value });
    }
    expect(Result.isFailure(
      encodeTaskRuntimePublicationReceipt(hostile),
    )).toBe(true);
    expect(invoked).toBe(false);
  });

  it("enforces role maxima and rejects huge decimal spellings before BigInt conversion", async () => {
    const plan = await Effect.runPromise(
      prepareTaskRuntimePublication(await makeInput(), sha256),
    );
    const receipt = plan.readReceipt();
    const maximum = receiptWithRoleCounts(
      receipt,
      MAX_TASK_RUNTIME_PUBLICATION_MODULES_V1,
      MAX_TASK_CATALOG_ENTRIES_V1,
    );
    expect(Result.isSuccess(
      encodeTaskRuntimePublicationReceipt(maximum),
    )).toBe(true);
    expect(Result.isFailure(encodeTaskRuntimePublicationReceipt(
      receiptWithRoleCounts(
        receipt,
        MAX_TASK_RUNTIME_PUBLICATION_MODULES_V1 + 1,
        1,
      ),
    ))).toBe(true);
    expect(Result.isFailure(encodeTaskRuntimePublicationReceipt(
      receiptWithRoleCounts(
        receipt,
        1,
        MAX_TASK_CATALOG_ENTRIES_V1 + 1,
      ),
    ))).toBe(true);

    const encoded = Result.getOrThrow(
      encodeTaskRuntimePublicationReceipt(receipt),
    );
    const text = new TextDecoder().decode(encoded);
    const hugeOrdinal = text.replace(
      /"ordinal":"0"/u,
      `"ordinal":"${"9".repeat(1_000_000)}"`,
    );
    const oversizedLength = text.replace(
      /"byteLength":"[0-9]+"/u,
      `"byteLength":"134217729"`,
    );
    expect(Result.isFailure(decodeTaskRuntimePublicationReceipt(
      new TextEncoder().encode(hugeOrdinal),
    ))).toBe(true);
    expect(Result.isFailure(decodeTaskRuntimePublicationReceipt(
      new TextEncoder().encode(oversizedLength),
    ))).toBe(true);
  });

  it("projects authenticated source bytes when the prepared graph has a source map", async () => {
    const input = await makeInput();
    const prepared = await Effect.runPromise(prepareTaskRuntimePublication({
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
      TaskRuntimePublicationPreparationInput,
      string,
    ]> = [
      [{
        ...original,
        catalog: Object.freeze({
          ...original.catalog,
          taskCatalogSha256: digest(99),
        }) as HashedCanonicalTaskCatalogV1,
      }, "task_binding_mismatch"],
      ...([
        ["scopeId", "scope-other"],
        ["candidateId", "candidate-other"],
        ["analysisId", "analysis-other"],
        ["applicationRevisionId", "revision-other"],
        ["applicationPublicationSha256", digest(0x91)],
        ["sourceArtifactRootSha256", digest(0x92)],
        ["applicationTaskCatalogBindingSha256", digest(0x93)],
      ] as const).map(([field, value]) => [{
        ...original,
        authority: {
          ...original.authority,
          [field]: value,
        },
      }, "task_binding_mismatch"] as const),
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
        prepareTaskRuntimePublication(input, sha256),
      )).rejects.toMatchObject({
        _tag: "InvalidTaskRuntimePublicationError",
        operation: "prepare_publication",
        reason,
      });
    }
  });
});

async function makeInput(
  empty = false,
): Promise<TaskRuntimePublicationPreparationInput> {
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
  const catalogBinding = taskBindings.catalog.binding;
  return {
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
