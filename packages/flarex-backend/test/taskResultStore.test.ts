import {
  MAX_TASK_RESULT_CANONICAL_BYTES_V1,
  taskResultObjectKeyV1,
  type TaskResultCommitmentV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { copyBytes } from "@flarex/utils/bytes";
import {
  MAX_APPLICATION_TASK_WORKER_VALUE_SEMANTIC_BYTES_V1,
} from "flarex-protocol/internal/application-task-worker-v1";
import {
  canonicalizeFlarexValueV1Effect,
  decodeCanonicalFlarexValueEvidenceV1Effect,
} from "flarex-protocol/value";
import { Cause, Effect, Exit, Option } from "effect";
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";

import {
  makeLiveTaskResultSha256,
  makeTaskResultStore,
  taskResultStoreSettlementUncertainCause,
  type TaskResultSha256,
  type TaskResultStoreBucket,
} from "../src/taskResult/TaskResultStore.js";

describe("TaskResultStore", () => {
  it("publishes canonical values, replays exactly, and returns owned bytes", async () => {
    const bucket = new MemoryBucket();
    const store = makeTaskResultStore(bucket);
    const value = Object.freeze({ answer: 42, nested: Object.freeze(["yes"]) });

    const first = await Effect.runPromise(store.publish(value));
    const replay = await Effect.runPromise(store.publish(value));
    const read = await Effect.runPromise(store.read(first));

    expect(replay).toEqual(first);
    expect(read.commitment).toEqual(first);
    expect(read.objectKey).toBe(taskResultObjectKeyV1(first.sha256));
    expect(read.value).toEqual(value);
    expect(bucket.putOptions).toEqual([
      { onlyIf: { etagDoesNotMatch: "*" } },
      { onlyIf: { etagDoesNotMatch: "*" } },
    ]);

    read.canonicalBytes[0] = 0;
    read.commitment.sha256[0] = 0;
    const reread = await Effect.runPromise(store.read(first));
    expect(reread.canonicalBytes[0]).not.toBe(0);
    expect(reread.commitment.sha256).toEqual(first.sha256);
  });

  it("reconciles an after-write rejection to the exact immutable value", async () => {
    const bucket = new MemoryBucket();
    bucket.rejectAfterWrite = true;
    const store = makeTaskResultStore(bucket);

    const commitment = await Effect.runPromise(store.publish("settled"));

    expect(bucket.putCalls).toBe(1);
    expect(await Effect.runPromise(store.read(commitment))).toMatchObject({
      value: "settled",
    });
  });

  it("rejects conflicting bytes at one content-addressed key", async () => {
    const bucket = new MemoryBucket();
    const first = await Effect.runPromise(canonicalizeFlarexValueV1Effect("first"));
    const conflicting = await Effect.runPromise(
      canonicalizeFlarexValueV1Effect("other"),
    );
    const digest = copyBytes(conflicting.sha256);
    const fakeSha: TaskResultSha256 = Effect.fn("TaskResultStore.testSha")(
      () => Effect.succeed(copyBytes(digest)),
    );
    bucket.values.set(taskResultObjectKeyV1(digest), first.canonicalBytes);
    const store = makeTaskResultStore(bucket, fakeSha);

    await expectFailure(
      store.publish("other"),
      "TaskResultStoreCorruptionError",
      "keyCollision",
    );
  });

  it("keeps unresolved create reconciliation typed as uncertain", async () => {
    const bucket = new MemoryBucket();
    bucket.rejectBeforeWrite = true;
    bucket.rejectGets = true;
    const store = makeTaskResultStore(bucket);

    const exit = await Effect.runPromiseExit(store.publish("uncertain"));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
      expect(error).toMatchObject({
        _tag: "TaskResultStoreSettlementUncertainError",
        stage: "reconcileRead",
      });
      if (error._tag === "TaskResultStoreSettlementUncertainError") {
        expect(taskResultStoreSettlementUncertainCause(error)).toMatchObject({
          createStage: "firstCreate",
        });
      }
    }
  });

  it("fails closed for missing, size-corrupt, and noncanonical objects", async () => {
    const bucket = new MemoryBucket();
    const store = makeTaskResultStore(bucket);
    const commitment = await Effect.runPromise(store.publish("valid"));
    const key = taskResultObjectKeyV1(commitment.sha256);

    bucket.values.delete(key);
    await expectFailure(store.read(commitment), "TaskResultStoreNotFoundError");

    bucket.values.set(key, new Uint8Array([1]));
    await expectFailure(
      store.read(commitment),
      "TaskResultStoreCorruptionError",
      "sizeMismatch",
    );

    const invalidBytes = new Uint8Array(commitment.byteLength).fill(0x20);
    bucket.values.set(key, invalidBytes);
    const fakeSha: TaskResultSha256 = Effect.fn("TaskResultStore.readTestSha")(
      () => Effect.succeed(copyBytes(commitment.sha256)),
    );
    await expectFailure(
      makeTaskResultStore(bucket, fakeSha).read(commitment),
      "TaskResultStoreCorruptionError",
      "invalidCanonicalValue",
    );
  });

  it("classifies an invalid canonical value as typed stored corruption", async () => {
    const bucket = new MemoryBucket();
    const canonicalBytes = new TextEncoder().encode(
      '{"format":"flarex-value","value":{"$unknown":"x"},"valueCodecVersion":1}',
    );
    const sha256 = makeLiveTaskResultSha256();
    const digest = await Effect.runPromise(
      sha256(canonicalBytes, canonicalBytes.byteLength),
    );
    const commitment: TaskResultCommitmentV1 = Object.freeze({
      codec: "flarex.task-result.v1",
      byteLength: canonicalBytes.byteLength,
      sha256: copyBytes(digest),
    });
    bucket.values.set(taskResultObjectKeyV1(digest), canonicalBytes);

    await expectFailure(
      makeTaskResultStore(bucket, sha256).read(commitment),
      "TaskResultStoreCorruptionError",
      "invalidCanonicalValue",
    );
  });

  it("rejects hostile and over-budget commitments before touching R2", async () => {
    const bucket = new MemoryBucket();
    const store = makeTaskResultStore(bucket);
    const revocable = Proxy.revocable({}, {});
    revocable.revoke();

    await expectFailure(store.read(revocable.proxy), "TaskResultStoreInputError");
    await expectFailure(store.read({
      codec: "flarex.task-result.v1",
      byteLength: MAX_TASK_RESULT_CANONICAL_BYTES_V1 + 1,
      sha256: new Uint8Array(32),
    }), "TaskResultStoreInputError");
    expect(bucket.getCalls).toBe(0);
  });

  it("rejects an over-budget semantic value before touching R2", async () => {
    const bucket = new MemoryBucket();
    const store = makeTaskResultStore(bucket);

    await expectFailure(
      store.publish("x".repeat(
        MAX_APPLICATION_TASK_WORKER_VALUE_SEMANTIC_BYTES_V1,
      )),
      "TaskResultStoreInputError",
      "semanticBudgetExceeded",
    );
    expect(bucket.putCalls).toBe(0);
  });

  it("rejects canonical JSON expansion beyond the object ceiling", async () => {
    const bucket = new MemoryBucket();
    const store = makeTaskResultStore(bucket);
    const escapedCodeUnits = Math.ceil(
      MAX_TASK_RESULT_CANONICAL_BYTES_V1 / 6,
    ) + 100;

    await expectFailure(
      store.publish("\u0001".repeat(escapedCodeUnits)),
      "TaskResultStoreInputError",
      "canonicalByteBudgetExceeded",
    );
    expect(bucket.putCalls).toBe(0);
  });

  it("accepts genuine cross-realm Uint8Array stream chunks", async () => {
    const bucket = new MemoryBucket();
    const store = makeTaskResultStore(bucket);
    const commitment = await Effect.runPromise(store.publish("cross-realm"));
    bucket.crossRealmChunks = true;

    expect(await Effect.runPromise(store.read(commitment))).toMatchObject({
      value: "cross-realm",
    });
  });

  it("keeps foreign digest failures as defects", async () => {
    const store = makeTaskResultStore(new MemoryBucket(), Effect.fn(
      "TaskResultStore.defectSha",
    )(() => Effect.die(new Error("digest platform failed"))));
    const exit = await Effect.runPromiseExit(store.publish("value"));

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
      expect(Cause.findErrorOption(exit.cause)).toEqual(Option.none());
    }
  });

  it("the live SHA adapter agrees with the protocol evidence decoder", async () => {
    const value = Object.freeze({ verified: true });
    const canonical = await Effect.runPromise(canonicalizeFlarexValueV1Effect(value));
    const sha256 = makeLiveTaskResultSha256();
    const digest = await Effect.runPromise(
      sha256(canonical.canonicalBytes, canonical.canonicalBytes.byteLength),
    );

    expect(digest).toEqual(canonical.sha256);
    await expect(Effect.runPromise(decodeCanonicalFlarexValueEvidenceV1Effect({
      canonicalBytes: canonical.canonicalBytes,
      sha256: digest,
    }))).resolves.toMatchObject({ value });
  });
});

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

class MemoryBucket implements TaskResultStoreBucket {
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
