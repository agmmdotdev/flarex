import {
  hashCanonicalTaskCatalogV1,
  makeLiveStandardApplicationTaskSha256V1,
  makeTaskRuntimePublicationReceiptAuthorityV1,
  prepareTaskRuntimePublicationV1,
  TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  TASK_RUNTIME_CONTRACT_IDENTITY_V1,
  TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  TASK_RUNTIME_PROFILE_IDENTITY_V1,
  MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1,
  taskRuntimeObjectKeyV1,
  TASK_RUNTIME_OBJECT_STORE_V1,
  TASK_RUNTIME_PROJECTION_CODEC_V1,
  type PreparedTaskRuntimeObjectV1,
  type StandardApplicationTaskSha256V1,
  type TaskDefinitionSha256V1,
  type TaskRuntimeObjectReferenceV1,
  type TaskRuntimeObjectRoleV1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  produceApplicationTaskBindingsV1,
} from "@flarex/standard-application-definition/internal/application-task-binding-v1";
import {
  prepareStandardApplicationDefinitionV1,
} from "@flarex/standard-application-definition/v1";
import { produceStandardApplicationSource } from
  "@flarex/standard-application-definition/application-source";
import type { TaskComputeProfileRefV1 } from
  "@flarex/durable-task/internal/run-attempt-v1";
import { copyBytes } from "@flarex/utils/bytes";
import { Brand, Cause, Effect, Exit, Option, Result } from "effect";
import {
  encodeDeclarativeV2PhysicalFrameV1,
  type DeclarativeV2CandidateFrameV1,
} from "flarex-protocol/internal/declarative-v2-physical-v1";
import { describe, expect, it } from "vitest";
import { runInNewContext } from "node:vm";

import {
  makeTaskRuntimeObjectStore,
  taskRuntimeObjectStoreSettlementUncertainCause,
  type TaskRuntimeObjectStoreBucket,
} from "../src/taskRuntimePublication/TaskRuntimeObjectStore.js";

describe("TaskRuntimeObjectStore", () => {
  it("publishes, replays, and returns owned exact bytes", async () => {
    const bucket = new MemoryBucket();
    const sha256 = makeLiveStandardApplicationTaskSha256V1();
    const fixture = await makeFixture(
      "task_runtime_projection",
      new TextEncoder().encode("canonical-projection"),
      sha256,
    );
    const store = makeTaskRuntimeObjectStore(bucket, sha256);

    const first = await Effect.runPromise(store.publish(fixture.object));
    const replay = await Effect.runPromise(store.publish(fixture.object));
    const read = await Effect.runPromise(store.read(first));

    expect(bucket.putOptions).toEqual([
      { onlyIf: { etagDoesNotMatch: "*" } },
      { onlyIf: { etagDoesNotMatch: "*" } },
    ]);
    expect(replay).toEqual(first);
    expect(read.bytes).toEqual(fixture.bytes);
    read.bytes[0] = 0;
    const reread = await Effect.runPromise(store.read(first));
    expect(reread.bytes).toEqual(fixture.bytes);
    expect(reread.bytes).not.toBe(read.bytes);
  });

  it("reconciles an after-write rejection to the exact stored body", async () => {
    const bucket = new MemoryBucket();
    bucket.rejectAfterWrite = true;
    const sha256 = makeLiveStandardApplicationTaskSha256V1();
    const fixture = await makeFixture(
      "task_runtime_group_manifest",
      new TextEncoder().encode("canonical-manifest"),
      sha256,
    );
    const store = makeTaskRuntimeObjectStore(bucket, sha256);

    await expect(Effect.runPromise(store.publish(fixture.object)))
      .resolves.toEqual(fixture.reference);
    expect(bucket.putCalls).toBe(1);
  });

  it("mints confirmation only after genuine plan storage converges", async () => {
    const bucket = new MemoryBucket();
    const sha256 = makeLiveStandardApplicationTaskSha256V1();
    const authority = makeTaskRuntimePublicationReceiptAuthorityV1(sha256);
    const object = await makeGenuinePreparedObject(sha256);
    const store = makeTaskRuntimeObjectStore(bucket, sha256, authority);

    const first = await Effect.runPromise(store.publishConfirmed(object));
    const replay = await Effect.runPromise(store.publishConfirmed(object));
    expect(replay.readReference()).toEqual(first.readReference());

    const failingBucket = new MemoryBucket();
    failingBucket.rejectBeforeWrite = true;
    failingBucket.rejectGets = true;
    const failure = await Effect.runPromiseExit(
      makeTaskRuntimeObjectStore(
        failingBucket,
        sha256,
        authority,
      ).publishConfirmed(object),
    );
    expect(Exit.isFailure(failure)).toBe(true);
    expect(failingBucket.putCalls).toBe(1);
  });

  it("rejects conflicting bytes at the same content-addressed key", async () => {
    const bucket = new MemoryBucket();
    const digest = new Uint8Array(32).fill(7) as TaskDefinitionSha256V1;
    const fakeSha: StandardApplicationTaskSha256V1 = Effect.fn("fakeSha")(
      () => Effect.succeed(copyBytes(digest)),
    );
    const first = makeFixtureWithDigest(
      "task_runtime_entry",
      new TextEncoder().encode("first"),
      digest,
    );
    const conflicting = makeFixtureWithDigest(
      "task_runtime_entry",
      new TextEncoder().encode("other"),
      digest,
    );
    const store = makeTaskRuntimeObjectStore(bucket, fakeSha);
    await Effect.runPromise(store.publish(first.object));

    const exit = await Effect.runPromiseExit(store.publish(conflicting.object));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
        _tag: "TaskRuntimeObjectStoreCorruptionError",
        reason: "keyCollision",
      });
    }
  });

  it("keeps an unresolved create/read failure typed as uncertain", async () => {
    const bucket = new MemoryBucket();
    bucket.rejectBeforeWrite = true;
    bucket.rejectGets = true;
    const sha256 = makeLiveStandardApplicationTaskSha256V1();
    const fixture = await makeFixture(
      "task_runtime_materialization_spec",
      new TextEncoder().encode("canonical-spec"),
      sha256,
    );
    const store = makeTaskRuntimeObjectStore(bucket, sha256);

    const exit = await Effect.runPromiseExit(store.publish(fixture.object));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
      expect(error).toMatchObject({
        _tag: "TaskRuntimeObjectStoreSettlementUncertainError",
        stage: "reconcileRead",
      });
      if (error._tag === "TaskRuntimeObjectStoreSettlementUncertainError") {
        expect(taskRuntimeObjectStoreSettlementUncertainCause(error))
          .toMatchObject({ createStage: "firstCreate" });
      }
    }
  });

  it("fails closed for missing, size-corrupt, and hostile references", async () => {
    const bucket = new MemoryBucket();
    const sha256 = makeLiveStandardApplicationTaskSha256V1();
    const fixture = await makeFixture(
      "runtime_projection_module",
      new TextEncoder().encode("canonical-module"),
      sha256,
    );
    const store = makeTaskRuntimeObjectStore(bucket, sha256);

    await expectFailureTag(
      store.read(fixture.reference),
      "TaskRuntimeObjectStoreNotFoundError",
    );
    bucket.values.set(fixture.reference.objectKey, new Uint8Array([1]));
    await expectFailureTag(
      store.read(fixture.reference),
      "TaskRuntimeObjectStoreCorruptionError",
      "sizeMismatch",
    );

    const revocable = Proxy.revocable({}, {});
    const revoked = revocable.proxy;
    revocable.revoke();
    await expectFailureTag(
      store.read(revoked),
      "TaskRuntimeObjectStoreInputError",
    );
  });

  it("rejects fabricated prepared objects with mismatched role evidence", async () => {
    const bucket = new MemoryBucket();
    const sha256 = makeLiveStandardApplicationTaskSha256V1();
    const fixture = await makeFixture(
      "task_runtime_projection",
      new TextEncoder().encode("canonical-projection"),
      sha256,
    );
    const store = makeTaskRuntimeObjectStore(bucket, sha256);
    const forged: PreparedTaskRuntimeObjectV1 = Object.freeze({
      ...fixture.object,
      role: "task_runtime_entry",
    });
    await expectFailureTag(
      store.publish(forged),
      "TaskRuntimeObjectStoreInputError",
    );
    expect(bucket.putCalls).toBe(0);
  });

  it("accepts intrinsic Uint8Array chunks from another realm", async () => {
    const bucket = new MemoryBucket();
    const sha256 = makeLiveStandardApplicationTaskSha256V1();
    const fixture = await makeFixture(
      "task_runtime_projection",
      new TextEncoder().encode("cross-realm-chunk"),
      sha256,
    );
    bucket.values.set(fixture.reference.objectKey, copyBytes(fixture.bytes));
    bucket.crossRealmChunks = true;
    const store = makeTaskRuntimeObjectStore(bucket, sha256);

    const stored = await Effect.runPromise(store.read(fixture.reference));
    expect(stored.bytes).toEqual(fixture.bytes);
  });

  it("rejects over-budget references before touching R2", async () => {
    const bucket = new MemoryBucket();
    const sha256 = makeLiveStandardApplicationTaskSha256V1();
    const fixture = await makeFixture(
      "task_runtime_projection",
      new TextEncoder().encode("bounded-reference"),
      sha256,
    );
    const oversized: TaskRuntimeObjectReferenceV1 = Object.freeze({
      ...fixture.reference,
      byteLength: BigInt(MAX_TASK_RUNTIME_PUBLICATION_CANONICAL_BYTES_V1) + 1n,
    });
    const store = makeTaskRuntimeObjectStore(bucket, sha256);

    await expectFailureTag(
      store.read(oversized),
      "TaskRuntimeObjectStoreInputError",
    );
    expect(bucket.getCalls).toBe(0);
  });
});

async function makeFixture(
  role: TaskRuntimeObjectRoleV1,
  bytes: Uint8Array,
  sha256: StandardApplicationTaskSha256V1,
): Promise<ReturnType<typeof makeFixtureWithDigest>> {
  const digest = await Effect.runPromise(
    sha256(bytes, { maximumInputBytes: bytes.byteLength }),
  ) as TaskDefinitionSha256V1;
  return makeFixtureWithDigest(role, bytes, digest);
}

function makeFixtureWithDigest(
  role: TaskRuntimeObjectRoleV1,
  bytesInput: Uint8Array,
  digestInput: TaskDefinitionSha256V1,
) {
  const bytes = copyBytes(bytesInput);
  const digest = copyBytes(digestInput) as TaskDefinitionSha256V1;
  const reference: TaskRuntimeObjectReferenceV1 = Object.freeze({
    storeIdentity: TASK_RUNTIME_OBJECT_STORE_V1,
    role,
    objectKey: taskRuntimeObjectKeyV1(role, toHex(digest)),
    byteLength: BigInt(bytes.byteLength),
    sha256: copyBytes(digest) as TaskDefinitionSha256V1,
  });
  const object: PreparedTaskRuntimeObjectV1 = Object.freeze({
    role,
    codecIdentity: codecIdentityForRole(role),
    ordinal: 0n,
    readCanonicalBytes: () => copyBytes(bytes),
    readReference: () => Object.freeze({
      ...reference,
      sha256: copyBytes(reference.sha256) as TaskDefinitionSha256V1,
    }),
  });
  return { bytes, reference, object };
}

function codecIdentityForRole(role: TaskRuntimeObjectRoleV1): string {
  switch (role) {
    case "runtime_projection_module":
      return "flarex.standard-application/task-runtime-projection-module/v1";
    case "task_runtime_projection":
      return TASK_RUNTIME_PROJECTION_CODEC_V1;
    case "task_runtime_entry":
      return "flarex.standard-application/task-runtime-entry/v1";
    case "task_runtime_group_manifest":
      return "flarex.standard-application/task-runtime-group-manifest/v1";
    case "task_runtime_materialization_spec":
      return "flarex.standard-application/task-runtime-materialization-spec/v1";
  }
}

async function expectFailureTag(
  effect: Effect.Effect<unknown, unknown>,
  tag: string,
  reason?: string,
): Promise<void> {
  const exit = await Effect.runPromiseExit(effect);
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Option.getOrThrow(Cause.findErrorOption(exit.cause))).toMatchObject({
      _tag: tag,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

async function makeGenuinePreparedObject(
  sha256: StandardApplicationTaskSha256V1,
): Promise<PreparedTaskRuntimeObjectV1> {
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
        sourceBytes: new TextEncoder().encode(
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
  const computeProfile = Brand.nominal<TaskComputeProfileRefV1>()("standard-1x");
  const catalog = await Effect.runPromise(hashCanonicalTaskCatalogV1({
    version: 1,
    tasks: [{
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
      computeProfile,
      queue: { kind: "default" },
    }],
  }, sha256));
  const bindings = await Effect.runPromise(produceApplicationTaskBindingsV1({
    definition,
    catalog,
    authority: {
      scopeId: "scope-store-test",
      revisionId: "revision-store-test",
      candidateId: "candidate-store-test",
      analysisId: "analysis-store-test",
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
    runtimeContractIdentity: TASK_RUNTIME_CONTRACT_IDENTITY_V1,
    bridgeAbiIdentity: TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
    compatibilityDate: "2026-08-12",
    compatibilityFlags: Object.freeze(["nodejs_compat"]),
    runtimeProfileIdentity: TASK_RUNTIME_PROFILE_IDENTITY_V1,
    runtimeImplementationVersion: "worker-loader-2026.08.12",
    supportedComputeProfiles: Object.freeze([computeProfile]),
    moduleEntryPolicyIdentity: TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  });
  const candidate = makeStoreCandidate();
  const encoded = Result.getOrThrow(encodeDeclarativeV2PhysicalFrameV1(
    candidate,
    { maximumFrameBytes: 1_024 * 1_024, maximumCanonicalBytes: 1_024 * 1_024 },
  ));
  const candidateSha256 = await Effect.runPromise(sha256(
    encoded.canonicalBytes,
    { maximumInputBytes: encoded.canonicalBytes.byteLength },
  )) as TaskDefinitionSha256V1;
  const publication = await Effect.runPromise(prepareTaskRuntimePublicationV1({
    source,
    catalog,
    taskBindings: bindings,
    authority: {
      candidateId: "candidate-store-test",
      candidate,
      candidateSha256,
      applicationRevisionId: "revision-store-test",
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
  const object = publication.objects[0];
  if (object === undefined) throw new Error("Expected a prepared runtime object.");
  return object;
}

function makeStoreCandidate(): DeclarativeV2CandidateFrameV1 {
  const digest = (byte: number) =>
    new Uint8Array(32).fill(byte) as TaskDefinitionSha256V1;
  return {
    kind: "candidate",
    projectId: "project-store-test",
    deploymentId: "candidate-store-test",
    deploymentCreatedAt: "2026-08-12T00:00:00.000Z",
    scopeId: "scope-store-test",
    storageGeneration: "flarexdb_v1",
    storageGenerationFence: 1n,
    scopeEpoch: "scope-epoch-store-test",
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

class MemoryBucket implements TaskRuntimeObjectStoreBucket {
  readonly values = new Map<string, Uint8Array>();
  readonly putOptions: unknown[] = [];
  putCalls = 0;
  getCalls = 0;
  rejectAfterWrite = false;
  rejectBeforeWrite = false;
  rejectGets = false;
  crossRealmChunks = false;

  async put(key: string, value: ArrayBuffer, options: {
    readonly onlyIf: { readonly etagDoesNotMatch: "*" };
  }): Promise<unknown> {
    this.putCalls += 1;
    this.putOptions.push(options);
    if (this.rejectBeforeWrite) throw new Error("put unavailable");
    if (this.values.has(key)) throw new Error("precondition failed");
    this.values.set(key, new Uint8Array(value.slice(0)));
    if (this.rejectAfterWrite) throw new Error("response lost");
    return {};
  }

  async get(key: string): Promise<unknown> {
    this.getCalls += 1;
    if (this.rejectGets) throw new Error("get unavailable");
    const value = this.values.get(key);
    if (value === undefined) return null;
    const bytes = copyBytes(value);
    const chunk = this.crossRealmChunks
      ? runInNewContext("Uint8Array.from(bytes)", { bytes: [...bytes] })
      : copyBytes(bytes);
    return {
      size: bytes.byteLength,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(chunk);
          controller.close();
        },
      }),
    };
  }
}
