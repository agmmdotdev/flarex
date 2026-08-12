import {
  makeLiveStandardApplicationTaskSha256V1,
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
import { copyBytes } from "@flarex/utils/bytes";
import { Cause, Effect, Exit, Option } from "effect";
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
