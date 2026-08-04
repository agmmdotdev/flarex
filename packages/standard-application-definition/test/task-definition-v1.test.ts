import { Result, Effect } from "effect";
import { describe, expect, it } from "vitest";

import * as DefinitionRoot from "../src/v1";
import {
  APPLICATION_REVISION_TASK_BINDING_CODEC_V1,
  CANONICAL_TASK_CATALOG_CODEC_V1,
  CANONICAL_TASK_MANIFEST_CODEC_V1,
  TASK_DEFINITION_RUNTIME_BINDING_CODEC_V1,
  TASK_RUN_CREATION_AUTHORITY_RECEIPT_CODEC_V1,
  TASK_RUNTIME_ENTRY_CODEC_V1,
  TASK_RUNTIME_OBJECT_STORE_V1,
  decodeApplicationRevisionTaskBindingFrameV1,
  decodeCanonicalTaskCatalogV1,
  decodeCanonicalTaskManifestV1,
  decodeTaskDefinitionRuntimeBindingV1,
  decodeTaskIdV1,
  decodeTaskRunCreationAuthorityReceiptV1,
  decodeTaskRuntimeEntryFrameV1,
  encodeApplicationRevisionTaskBindingPreimageV1,
  encodeCanonicalTaskManifestPreimageV1,
  encodeHashedCanonicalTaskCatalogPreimageV1,
  encodeTaskDefinitionRuntimeBindingPreimageV1,
  encodeTaskRunCreationAuthorityReceiptPreimageV1,
  encodeTaskRuntimeEntryPreimageV1,
  hashApplicationRevisionTaskBindingFrameV1,
  hashCanonicalTaskCatalogV1,
  hashCanonicalTaskManifestV1,
  hashTaskDefinitionRuntimeBindingV1,
  hashTaskRunCreationAuthorityReceiptV1,
  hashTaskRuntimeEntryFrameV1,
  makeStandardApplicationTaskSha256V1,
  taskRuntimeObjectKeyV1,
  type CanonicalTaskManifestV1,
  type HashedCanonicalTaskCatalogV1,
  type StandardApplicationTaskSha256V1,
  type TaskDefinitionRuntimeBindingV1,
  type TaskDefinitionSha256V1,
  type TaskRuntimeEntryFrameV1,
  type TaskRuntimeObjectReferenceV1,
  type TaskRuntimeObjectRoleV1,
} from "../src/taskDefinition/v1";

const UTF8 = new TextDecoder();
const sha256 = makeStandardApplicationTaskSha256V1((input) =>
  globalThis.crypto.subtle.digest("SHA-256", input)
);

describe("Standard Application task definition V1", () => {
  it("keeps the task-definition surface private from the shipped V1 root", () => {
    expect("decodeTaskIdV1" in DefinitionRoot).toBe(false);
    const effect: Effect.Effect<
      TaskDefinitionSha256V1,
      import("../src/taskDefinition/v1").StandardApplicationTaskDigestV1Error
    > = hashCanonicalTaskManifestV1(makeManifest("orders.process"), sha256);
    expect(effect).toBeDefined();
  });

  it("admits exact scalar task IDs without normalization", () => {
    const composed = success(decodeTaskIdV1("caf\u00e9"));
    const decomposed = success(decodeTaskIdV1("cafe\u0301"));
    expect(composed).toBe("caf\u00e9");
    expect(decomposed).toBe("cafe\u0301");
    expect(composed).not.toBe(decomposed);

    for (const invalid of [
      "",
      " task",
      "task\n",
      "task\u0085name",
      "\ud800",
      "a".repeat(256),
      new String("task"),
    ]) {
      expect(failure(decodeTaskIdV1(invalid))).toMatchObject({
        operation: "decode_task_id",
        reason: "invalid_task_id",
      });
    }
    expect(success(decodeTaskIdV1("\ud83d\ude80".repeat(63))).length).toBe(126);
    expect(failure(decodeTaskIdV1("\ud83d\ude80".repeat(64)))).toMatchObject({
      reason: "invalid_task_id",
    });
  });

  it("sorts catalogs by exact UTF-8 bytes and rejects exact duplicates", () => {
    const catalog = success(decodeCanonicalTaskCatalogV1({
      version: 1,
      tasks: [
        makeManifest("z"),
        makeManifest("cafe\u0301"),
        makeManifest("caf\u00e9"),
        makeManifest("a"),
      ],
    }));
    expect(catalog.tasks.map((task) => task.taskId)).toEqual([
      "a",
      "cafe\u0301",
      "caf\u00e9",
      "z",
    ]);
    expect(failure(decodeCanonicalTaskCatalogV1({
      version: 1,
      tasks: [makeManifest("same"), makeManifest("same")],
    }))).toMatchObject({
      reason: "duplicate_task_id",
      path: "tasks[1].taskId",
    });
  });

  it("rejects catalog-wide validator amplification before unbounded cloning", () => {
    const sharedValidator = {
      type: "union",
      value: Array.from({ length: 100 }, () => ({ type: "string" })),
    };
    const tasks = Array.from({ length: 700 }, (_, index) => ({
      ...makeManifest(`task-${index.toString().padStart(4, "0")}`),
      payloadValidator: sharedValidator,
    }));
    expect(failure(decodeCanonicalTaskCatalogV1({
      version: 1,
      tasks,
    }))).toMatchObject({
      reason: "catalog_validator_budget_exceeded",
      maximum: 65_536,
    });
  });

  it("reuses strict validator, retry-policy, compute, duration, and queue owners", () => {
    expect(success(decodeCanonicalTaskManifestV1(makeManifest("orders.process"))))
      .toMatchObject({
        version: 1,
        taskId: "orders.process",
        runAttemptPolicy: {
          version: 1,
          retry: { maxAttempts: 3, factor: 2 },
        },
        maximumDurationInSeconds: 300,
        computeProfile: "standard-1x",
        queue: { kind: "default" },
      });
    for (const [change, reason] of [
      [{ extra: true }, "invalid_shape"],
      [{ payloadValidator: { type: "unknown" } }, "invalid_validator"],
      [{ runAttemptPolicy: policy({ maxAttempts: 0 }) }, "invalid_policy"],
      [{
        runAttemptPolicy: {
          ...policy(),
          outOfMemory: {
            kind: "escalate_once",
            computeProfile: "standard-2x",
          },
        },
      }, "invalid_policy"],
      [{ maximumDurationInSeconds: 0 }, "invalid_duration"],
      [{ computeProfile: "" }, "invalid_compute_profile"],
      [{ queue: { kind: "named" } }, "invalid_queue"],
    ] as const) {
      expect(failure(decodeCanonicalTaskManifestV1({
        ...makeManifest("orders.process"),
        ...change,
      }))).toMatchObject({ reason });
    }
  });

  it("captures owned validators and policies before caller mutation", () => {
    const input = makeManifest("orders.process");
    const manifest = success(decodeCanonicalTaskManifestV1(input));
    input.payloadValidator.value.orderId.fieldType.type = "number";
    input.runAttemptPolicy.retry.maxAttempts = 9;
    input.handler.exportName = "changed";

    expect(manifest.payloadValidator).toEqual({
      type: "object",
      value: {
        orderId: {
          fieldType: { type: "string" },
          optional: false,
        },
      },
    });
    expect(manifest.runAttemptPolicy.retry.maxAttempts).toBe(3);
    expect(manifest.handler.exportName).toBe("run");
    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.payloadValidator)).toBe(true);
    expect(Object.isFrozen(manifest.runAttemptPolicy.retry)).toBe(true);
  });

  it("uses stable canonical manifest and catalog frames", async () => {
    const manifest = makeManifest("orders.process");
    const manifestText = UTF8.decode(success(
      encodeCanonicalTaskManifestPreimageV1(manifest),
    ));
    expect(manifestText).toBe(
      `{"codec":"${CANONICAL_TASK_MANIFEST_CODEC_V1}","task":{"computeProfile":"standard-1x","handler":{"artifactModulePath":"tasks/orders.js","exportName":"run","logicalModulePath":"tasks/orders"},"maximumDurationInSeconds":300,"outputValidator":null,"payloadValidator":{"type":"object","value":{"orderId":{"fieldType":{"type":"string"},"optional":false}}},"queue":{"kind":"default"},"runAttemptPolicy":{"outOfMemory":{"kind":"disabled"},"retry":{"factor":2,"maxAttempts":3,"maxTimeoutInMs":60000,"minTimeoutInMs":1000,"randomize":true},"version":1},"taskId":"orders.process","version":1}}`,
    );
    const hashed = await Effect.runPromise(hashCanonicalTaskCatalogV1({
      version: 1,
      tasks: [makeManifest("orders.process")],
    }, sha256));
    const catalogText = UTF8.decode(success(
      encodeHashedCanonicalTaskCatalogPreimageV1(hashed),
    ));
    expect(catalogText).toBe(
      `{"codec":"${CANONICAL_TASK_CATALOG_CODEC_V1}","entries":[{"canonicalTaskManifestSha256":"${hex(hashed.entries[0]!.canonicalTaskManifestSha256)}","taskId":"orders.process"}]}`,
    );

    const z = success(decodeCanonicalTaskManifestV1(makeManifest("z")));
    const a = success(decodeCanonicalTaskManifestV1(makeManifest("a")));
    expect(failure(encodeHashedCanonicalTaskCatalogPreimageV1({
      version: 1,
      entries: [
        { ...hashed.entries[0]!, taskId: z.taskId, manifest: z },
        { ...hashed.entries[0]!, taskId: a.taskId, manifest: a },
      ],
    }))).toMatchObject({ reason: "inconsistent_binding" });
  });

  it("hashes catalog entries deterministically and changes every changed manifest", async () => {
    const first = await Effect.runPromise(hashCanonicalTaskCatalogV1({
      version: 1,
      tasks: [makeManifest("z"), makeManifest("a")],
    }, sha256));
    const replay = await Effect.runPromise(hashCanonicalTaskCatalogV1({
      version: 1,
      tasks: [makeManifest("a"), makeManifest("z")],
    }, sha256));
    const changed = await Effect.runPromise(hashCanonicalTaskCatalogV1({
      version: 1,
      tasks: [makeManifest("a"), {
        ...makeManifest("z"),
        maximumDurationInSeconds: 301,
      }],
    }, sha256));
    expect(hex(replay.taskCatalogSha256)).toBe(hex(first.taskCatalogSha256));
    expect(hex(changed.taskCatalogSha256)).not.toBe(hex(first.taskCatalogSha256));
    expect(first.entries.map((entry) => entry.taskId)).toEqual(["a", "z"]);
  });

  it("frames populated and explicitly empty application-revision task bindings", async () => {
    const populated = makeApplicationRevisionTaskBinding();
    const decoded = success(decodeApplicationRevisionTaskBindingFrameV1(populated));
    expect(decoded.taskCount).toBe(1n);
    expect(UTF8.decode(success(
      encodeApplicationRevisionTaskBindingPreimageV1(decoded),
    ))).toBe(
      `{"binding":{"candidateSha256":"${hex(decoded.candidateSha256)}","kind":"application_revision_task_binding","taskCatalogSha256":"${hex(decoded.taskCatalogSha256)}","taskCount":"1","taskEntryRootSha256":"${hex(decoded.taskEntryRootSha256)}","taskRuntimeGroupManifestSha256":"${hex(decoded.taskRuntimeGroupManifestSha256!)}","taskRuntimeMaterializationSpecSha256":"${hex(decoded.taskRuntimeMaterializationSpecSha256!)}","taskRuntimeProjectionSha256":"${hex(decoded.taskRuntimeProjectionSha256!)}"},"codec":"${APPLICATION_REVISION_TASK_BINDING_CODEC_V1}"}`,
    );
    expect((await Effect.runPromise(
      hashApplicationRevisionTaskBindingFrameV1(populated, sha256),
    )).byteLength).toBe(32);

    expect(success(decodeApplicationRevisionTaskBindingFrameV1({
      ...populated,
      taskCount: 0n,
      taskRuntimeProjectionSha256: null,
      taskRuntimeGroupManifestSha256: null,
      taskRuntimeMaterializationSpecSha256: null,
    })).taskCount).toBe(0n);
    expect(failure(decodeApplicationRevisionTaskBindingFrameV1({
      ...populated,
      taskCount: 0n,
    }))).toMatchObject({ reason: "inconsistent_binding" });
  });

  it("binds manifest, runtime entry, reconstruction objects, and candidate evidence", async () => {
    const fixture = await makeRuntimeBindingFixture();
    const decoded = success(decodeTaskDefinitionRuntimeBindingV1(fixture.binding));
    expect(decoded.taskRuntimeEntry.group).toBe("durable_task");
    expect(decoded.runtimeObjects.map((reference) => reference.role)).toEqual([
      "runtime_projection_module",
      "task_runtime_projection",
      "task_runtime_entry",
      "task_runtime_group_manifest",
      "task_runtime_materialization_spec",
    ]);
    const entry = decoded.taskRuntimeEntry;
    expect(UTF8.decode(success(
      encodeTaskRuntimeEntryPreimageV1(entry),
    ))).toBe(
      `{"codec":"${TASK_RUNTIME_ENTRY_CODEC_V1}","entry":{"artifactExecutionModule":"${entry.artifactExecutionModule}","canonicalTaskManifestSha256":"${hex(entry.canonicalTaskManifestSha256)}","exportName":"${entry.exportName}","group":"durable_task","kind":"task_runtime_entry","logicalExecutionModule":"${entry.logicalExecutionModule}","projectionSha256":"${hex(entry.projectionSha256)}","taskId":"${entry.taskId}","taskOrdinal":"0"}}`,
    );
    const preimage = UTF8.decode(success(
      encodeTaskDefinitionRuntimeBindingPreimageV1(decoded),
    ));
    expect(preimage).toBe(expectedRuntimeBindingText(decoded));
    expect(preimage).not.toContain("activationRevision");
    expect(preimage).not.toContain("activationHeadSha256");
    expect((await Effect.runPromise(
      hashTaskDefinitionRuntimeBindingV1(decoded, sha256),
    )).byteLength).toBe(32);
  });

  it("rejects handler, claimed digest, and runtime-object contradictions", async () => {
    const fixture = await makeRuntimeBindingFixture();
    expect(failure(decodeTaskDefinitionRuntimeBindingV1({
      ...fixture.binding,
      taskRuntimeEntry: {
        ...fixture.binding.taskRuntimeEntry,
        exportName: "other",
      },
    }))).toMatchObject({ reason: "inconsistent_binding" });

    const wrongProjection = digest(99);
    expect(failure(decodeTaskDefinitionRuntimeBindingV1({
      ...fixture.binding,
      taskRuntimeProjectionSha256: wrongProjection,
    }))).toMatchObject({ reason: "inconsistent_binding" });

    const validShapeWrongManifestDigest = success(
      decodeTaskDefinitionRuntimeBindingV1({
        ...fixture.binding,
        canonicalTaskManifestSha256: digest(88),
        taskRuntimeEntry: {
          ...fixture.binding.taskRuntimeEntry,
          canonicalTaskManifestSha256: digest(88),
        },
      }),
    );
    const failureValue = await effectFailure(hashTaskDefinitionRuntimeBindingV1(
      validShapeWrongManifestDigest,
      sha256,
    ));
    expect(failureValue).toMatchObject({ reason: "inconsistent_binding" });
  });

  it("keeps creation activation evidence separate and digest-sensitive", async () => {
    const receipt = makeCreationAuthority();
    const decoded = success(decodeTaskRunCreationAuthorityReceiptV1(receipt));
    const text = UTF8.decode(success(
      encodeTaskRunCreationAuthorityReceiptPreimageV1(decoded),
    ));
    expect(text).toBe(
      `{"authority":{"activationHeadSha256":"${hex(decoded.activationHeadSha256)}","activationRevision":"7","applicationRevisionId":"apprev_orders_v3","applicationRevisionTaskBindingSha256":"${hex(decoded.applicationRevisionTaskBindingSha256)}","candidateSha256":"${hex(decoded.candidateSha256)}","readinessReceiptSha256":"${hex(decoded.readinessReceiptSha256)}","taskDefinitionRevisionId":"taskdef_123e4567-e89b-42d3-a456-426614174000","version":1},"codec":"${TASK_RUN_CREATION_AUTHORITY_RECEIPT_CODEC_V1}"}`,
    );
    const first = await Effect.runPromise(
      hashTaskRunCreationAuthorityReceiptV1(receipt, sha256),
    );
    const changed = await Effect.runPromise(
      hashTaskRunCreationAuthorityReceiptV1({
        ...receipt,
        activationRevision: 8n,
      }, sha256),
    );
    expect(hex(changed)).not.toBe(hex(first));
    expect(failure(decodeTaskRunCreationAuthorityReceiptV1({
      ...receipt,
      activationRevision: 0n,
    }))).toMatchObject({ reason: "invalid_activation_revision" });
  });

  it("does not invoke accessors at exact private definition boundaries", () => {
    let reads = 0;
    const hostile = Object.defineProperty({}, "version", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not run");
      },
    });
    expect(failure(decodeCanonicalTaskManifestV1(hostile))).toMatchObject({
      reason: "invalid_shape",
    });
    expect(reads).toBe(0);
  });

  it("rejects nested run-policy accessors without invoking them", () => {
    let reads = 0;
    const hostilePolicy = policy();
    Object.defineProperty(hostilePolicy, "version", {
      enumerable: true,
      get() {
        reads += 1;
        throw new Error("must not run");
      },
    });
    expect(failure(decodeCanonicalTaskManifestV1({
      ...makeManifest("orders.process"),
      runAttemptPolicy: hostilePolicy,
    }))).toMatchObject({
      reason: "invalid_policy",
      path: "runAttemptPolicy",
    });
    expect(reads).toBe(0);
  });
});

function makeManifest(taskId: string) {
  return {
    version: 1,
    taskId,
    handler: {
      logicalModulePath: "tasks/orders",
      artifactModulePath: "tasks/orders.js",
      exportName: "run",
    },
    payloadValidator: {
      type: "object" as const,
      value: {
        orderId: {
          fieldType: { type: "string" as "string" | "number" },
          optional: false,
        },
      },
    },
    outputValidator: null,
    runAttemptPolicy: policy(),
    maximumDurationInSeconds: 300,
    computeProfile: "standard-1x",
    queue: { kind: "default" },
  };
}

function policy(change: { readonly maxAttempts?: number } = {}) {
  return {
    version: 1,
    retry: {
      maxAttempts: change.maxAttempts ?? 3,
      factor: 2,
      minTimeoutInMs: 1_000,
      maxTimeoutInMs: 60_000,
      randomize: true,
    },
    outOfMemory: { kind: "disabled" },
  };
}

function makeApplicationRevisionTaskBinding() {
  return {
    kind: "application_revision_task_binding",
    candidateSha256: digest(1),
    taskCatalogSha256: digest(2),
    taskCount: 1n,
    taskEntryRootSha256: digest(3),
    taskRuntimeProjectionSha256: digest(4),
    taskRuntimeGroupManifestSha256: digest(5),
    taskRuntimeMaterializationSpecSha256: digest(6),
  };
}

async function makeRuntimeBindingFixture(): Promise<{
  readonly binding: TaskDefinitionRuntimeBindingV1;
  readonly catalog: HashedCanonicalTaskCatalogV1;
}> {
  const catalog = await Effect.runPromise(hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: [makeManifest("orders.process")],
  }, sha256));
  const manifest = catalog.entries[0]!.manifest;
  const projectionSha256 = digest(30);
  const entryInput = {
    kind: "task_runtime_entry",
    taskOrdinal: 0n,
    taskId: manifest.taskId,
    canonicalTaskManifestSha256:
      catalog.entries[0]!.canonicalTaskManifestSha256,
    logicalExecutionModule: manifest.handler.logicalModulePath,
    artifactExecutionModule: manifest.handler.artifactModulePath,
    exportName: manifest.handler.exportName,
    group: "durable_task",
    projectionSha256,
  };
  const decodedEntry = successResult(decodeTaskRuntimeEntryFrameV1(entryInput));
  const taskRuntimeEntrySha256 = await Effect.runPromise(
    hashTaskRuntimeEntryFrameV1(decodedEntry, sha256),
  );
  const groupSha256 = digest(31);
  const materializationSha256 = digest(32);
  const runtimeObjects = [
    objectReference("task_runtime_materialization_spec", materializationSha256, 50n),
    objectReference("task_runtime_entry", taskRuntimeEntrySha256, 40n),
    objectReference("runtime_projection_module", digest(33), 100n),
    objectReference("task_runtime_group_manifest", groupSha256, 60n),
    objectReference("task_runtime_projection", projectionSha256, 70n),
  ];
  const binding = successResult(decodeTaskDefinitionRuntimeBindingV1({
    version: 1,
    applicationRevisionId: "apprev_orders_v3",
    candidateSha256: digest(1),
    applicationRevisionTaskBindingSha256: digest(2),
    taskId: manifest.taskId,
    manifest,
    canonicalTaskManifestSha256:
      catalog.entries[0]!.canonicalTaskManifestSha256,
    taskRuntimeEntrySha256,
    taskRuntimeEntry: decodedEntry,
    taskCatalogSha256: catalog.taskCatalogSha256,
    taskEntryRootSha256: digest(3),
    taskRuntimeProjectionSha256: projectionSha256,
    taskRuntimeGroupManifestSha256: groupSha256,
    taskRuntimeMaterializationSpecSha256: materializationSha256,
    packageSha256: digest(7),
    artifactSha256: digest(8),
    sourceRootSha256: digest(9),
    semanticRootSha256: digest(10),
    runtimeObjects,
  }));
  return { binding, catalog };
}

function expectedRuntimeBindingText(
  binding: TaskDefinitionRuntimeBindingV1,
): string {
  const entry = binding.taskRuntimeEntry;
  const runtimeObjects = binding.runtimeObjects.map((reference) =>
    `{"byteLength":"${reference.byteLength}","objectKey":"${reference.objectKey}","role":"${reference.role}","sha256":"${hex(reference.sha256)}","storeIdentity":"${reference.storeIdentity}"}`
  ).join(",");
  return `{"binding":{"applicationRevisionId":"${binding.applicationRevisionId}","applicationRevisionTaskBindingSha256":"${hex(binding.applicationRevisionTaskBindingSha256)}","artifactSha256":"${hex(binding.artifactSha256)}","candidateSha256":"${hex(binding.candidateSha256)}","canonicalTaskManifestSha256":"${hex(binding.canonicalTaskManifestSha256)}","packageSha256":"${hex(binding.packageSha256)}","runtimeObjects":[${runtimeObjects}],"semanticRootSha256":"${hex(binding.semanticRootSha256)}","sourceRootSha256":"${hex(binding.sourceRootSha256)}","taskCatalogSha256":"${hex(binding.taskCatalogSha256)}","taskEntryRootSha256":"${hex(binding.taskEntryRootSha256)}","taskId":"${binding.taskId}","taskRuntimeEntry":{"artifactExecutionModule":"${entry.artifactExecutionModule}","canonicalTaskManifestSha256":"${hex(entry.canonicalTaskManifestSha256)}","exportName":"${entry.exportName}","group":"durable_task","kind":"task_runtime_entry","logicalExecutionModule":"${entry.logicalExecutionModule}","projectionSha256":"${hex(entry.projectionSha256)}","taskId":"${entry.taskId}","taskOrdinal":"${entry.taskOrdinal}"},"taskRuntimeEntrySha256":"${hex(binding.taskRuntimeEntrySha256)}","taskRuntimeGroupManifestSha256":"${hex(binding.taskRuntimeGroupManifestSha256)}","taskRuntimeMaterializationSpecSha256":"${hex(binding.taskRuntimeMaterializationSpecSha256)}","taskRuntimeProjectionSha256":"${hex(binding.taskRuntimeProjectionSha256)}","version":1},"codec":"${TASK_DEFINITION_RUNTIME_BINDING_CODEC_V1}"}`;
}

function objectReference(
  role: TaskRuntimeObjectRoleV1,
  sha: TaskDefinitionSha256V1,
  byteLength: bigint,
): TaskRuntimeObjectReferenceV1 {
  return {
    storeIdentity: TASK_RUNTIME_OBJECT_STORE_V1,
    role,
    objectKey: taskRuntimeObjectKeyV1(role, hex(sha)),
    byteLength,
    sha256: sha,
  };
}

function makeCreationAuthority() {
  return {
    version: 1,
    applicationRevisionId: "apprev_orders_v3",
    activationRevision: 7n,
    activationHeadSha256: digest(41),
    readinessReceiptSha256: digest(42),
    candidateSha256: digest(1),
    applicationRevisionTaskBindingSha256: digest(2),
    taskDefinitionRevisionId:
      "taskdef_123e4567-e89b-42d3-a456-426614174000",
  };
}

function digest(seed: number): TaskDefinitionSha256V1 {
  return new Uint8Array(32).fill(seed) as TaskDefinitionSha256V1;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

function success<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  return successResult(result);
}

function successResult<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

function failure<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Failure {
  if (Result.isSuccess(result)) throw new Error("Expected failure");
  return result.failure;
}

async function effectFailure<Failure>(
  effect: Effect.Effect<unknown, Failure>,
): Promise<Failure> {
  const result = await Effect.runPromise(Effect.result(effect));
  if (Result.isSuccess(result)) throw new Error("Expected Effect failure");
  return result.failure;
}
