import {
  MAX_TASK_INPUT_CANONICAL_BYTES_V1,
  makeTaskInputReferenceV1,
  type TaskInputReferenceV1,
  type TaskInputSha256V1,
} from "@flarex/durable-task/internal/run-creation-v1";
import { copyBytes } from "@flarex/utils/bytes";
import { Cause, Effect, Exit, Option, Result } from "effect";
import {
  canonicalizeFlarexValueV1Effect,
} from "flarex-protocol/value";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import {
  makeTaskRunInputStore,
  TaskRunInputHashError,
  taskRunInputStoreResourceCause,
  taskRunInputStoreSettlementUncertainCause,
  type TaskRunInputSha256,
  type TaskRunInputStoreBucket,
} from "../src/taskRunInput/TaskRunInputStore.js";

describe("TaskRunInputStore", () => {
  it("publishes, replays, and returns owned canonical input", async () => {
    const bucket = new MemoryBucket();
    const store = makeTaskRunInputStore(bucket);
    const value = Object.freeze({ count: 3n, name: "Ada" });

    const first = await Effect.runPromise(store.publish(value));
    const replay = await Effect.runPromise(store.publish(value));
    const read = await Effect.runPromise(store.read(first));

    expect(replay).toEqual(first);
    expect(read.reference).toEqual(first);
    expect(read.value).toEqual(value);
    expect(bucket.putOptions).toEqual([
      { onlyIf: { etagDoesNotMatch: "*" } },
      { onlyIf: { etagDoesNotMatch: "*" } },
    ]);
    const expectedBytes = copyBytes(read.canonicalBytes);
    read.canonicalBytes[0] = 0;
    read.reference.sha256[0] = 0;
    const reread = await Effect.runPromise(store.read(first));
    expect(reread.canonicalBytes).toEqual(expectedBytes);
    expect(reread.reference).toEqual(first);
  });

  it("reconciles a rejected response after the immutable write", async () => {
    const bucket = new MemoryBucket();
    bucket.rejectAfterWrite = true;
    const store = makeTaskRunInputStore(bucket);

    await expect(Effect.runPromise(store.publish({ durable: true })))
      .resolves.toMatchObject({ retention: { kind: "run_lifetime" } });
    expect(bucket.putCalls).toBe(1);
  });

  it("fails closed on a conflicting body at the derived key", async () => {
    const value = { collision: "candidate" };
    const canonical = await Effect.runPromise(
      canonicalizeFlarexValueV1Effect(value),
    );
    const reference = Result.getOrThrow(makeTaskInputReferenceV1(
      canonical.sha256,
      canonical.canonicalBytes.byteLength,
    ));
    const bucket = new MemoryBucket();
    bucket.values.set(
      reference.objectKey,
      new Uint8Array(canonical.canonicalBytes.byteLength).fill(0x20),
    );
    const store = makeTaskRunInputStore(bucket, {
      sha256: constantSha256(reference.sha256),
    });

    await expectFailure(
      store.publish(value),
      "TaskRunInputStoreCorruptionError",
      "keyCollision",
    );
  });

  it("keeps unresolved create settlement typed and preserves its cause", async () => {
    const bucket = new MemoryBucket();
    bucket.rejectBeforeWrite = true;
    bucket.rejectGets = true;
    const store = makeTaskRunInputStore(bucket);

    const exit = await Effect.runPromiseExit(store.publish({ uncertain: true }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
      expect(error).toMatchObject({
        _tag: "TaskRunInputStoreSettlementUncertainError",
        stage: "reconcileRead",
      });
      if (error._tag === "TaskRunInputStoreSettlementUncertainError") {
        expect(taskRunInputStoreSettlementUncertainCause(error))
          .toMatchObject({ createStage: "firstCreate" });
      }
    }
  });

  it("keeps hashing resource failures typed with their exact cause", async () => {
    const hashFailure = new TaskRunInputHashError({ reason: "unavailable" });
    const sha256: TaskRunInputSha256 = Effect.fn(
      "TaskRunInputStoreTest.failedSha256",
    )(() => Effect.fail(hashFailure));
    const store = makeTaskRunInputStore(new MemoryBucket(), { sha256 });
    const exit = await Effect.runPromiseExit(store.publish({ hash: "fails" }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
      expect(error).toMatchObject({
        _tag: "TaskRunInputStoreResourceError",
        operation: "hash",
      });
      if (error._tag === "TaskRunInputStoreResourceError") {
        expect(taskRunInputStoreResourceCause(error)).toBe(hashFailure);
      }
    }
  });

  it("rejects missing, size-corrupt, noncanonical, and hostile reads", async () => {
    const value = { exact: "input" };
    const canonical = await Effect.runPromise(
      canonicalizeFlarexValueV1Effect(value),
    );
    const reference = Result.getOrThrow(makeTaskInputReferenceV1(
      canonical.sha256,
      canonical.canonicalBytes.byteLength,
    ));
    const bucket = new MemoryBucket();
    const store = makeTaskRunInputStore(bucket);

    await expectFailure(store.read(reference), "TaskRunInputStoreNotFoundError");
    bucket.values.set(reference.objectKey, new Uint8Array([1]));
    await expectFailure(
      store.read(reference),
      "TaskRunInputStoreCorruptionError",
      "sizeMismatch",
    );

    bucket.values.set(
      reference.objectKey,
      new Uint8Array(reference.byteLength).fill(0x20),
    );
    await expectFailure(
      makeTaskRunInputStore(bucket, {
        sha256: constantSha256(reference.sha256),
      }).read(reference),
      "TaskRunInputStoreCorruptionError",
      "invalidCanonicalEvidence",
    );

    const revocable = Proxy.revocable({}, {});
    const revoked = revocable.proxy;
    revocable.revoke();
    await expectFailure(
      store.read(revoked),
      "TaskRunInputStoreInputError",
      "invalid_reference",
    );
  });

  it("accepts cross-realm chunks and rejects over-budget references before R2", async () => {
    const bucket = new MemoryBucket();
    bucket.crossRealmChunks = true;
    const store = makeTaskRunInputStore(bucket);
    const reference = await Effect.runPromise(store.publish({ realm: "other" }));
    expect((await Effect.runPromise(store.read(reference))).value)
      .toEqual({ realm: "other" });

    const oversized: TaskInputReferenceV1 = Object.freeze({
      ...reference,
      byteLength: MAX_TASK_INPUT_CANONICAL_BYTES_V1 + 1,
    });
    const getsBefore = bucket.getCalls;
    await expectFailure(
      store.read(oversized),
      "TaskRunInputStoreInputError",
      "invalid_reference",
    );
    expect(bucket.getCalls).toBe(getsBefore);
  });
});

function constantSha256(digest: Uint8Array): TaskRunInputSha256 {
  return Effect.fn("TaskRunInputStoreTest.constantSha256")(
    () => Effect.succeed(copyBytes(digest)),
  );
}

async function expectFailure(
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

class MemoryBucket implements TaskRunInputStoreBucket {
  readonly values = new Map<string, Uint8Array>();
  readonly putOptions: unknown[] = [];
  putCalls = 0;
  getCalls = 0;
  rejectAfterWrite = false;
  rejectBeforeWrite = false;
  rejectGets = false;
  crossRealmChunks = false;

  async put(
    key: string,
    value: ArrayBuffer,
    options: { readonly onlyIf: { readonly etagDoesNotMatch: "*" } },
  ): Promise<unknown> {
    this.putCalls += 1;
    this.putOptions.push(options);
    if (this.rejectBeforeWrite) throw new Error("put unavailable");
    if (this.values.has(key)) throw new Error("precondition failed");
    this.values.set(key, new Uint8Array(value.slice(0)));
    if (this.rejectAfterWrite) throw Object.assign(
      new Error("response lost"),
      { createStage: "firstCreate" },
    );
    return {};
  }

  async get(key: string): Promise<unknown> {
    this.getCalls += 1;
    if (this.rejectGets) throw Object.assign(
      new Error("get unavailable"),
      { createStage: "firstCreate" },
    );
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
