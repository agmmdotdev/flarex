import {
  MAX_TASK_INPUT_CANONICAL_BYTES_V1,
} from "@flarex/durable-task/internal/run-creation-v1";
import { copyBytes } from "@flarex/utils/bytes";
import { Cause, Effect, Exit, Option } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeTaskInputStore,
  taskInputStoreSettlementUncertainCause,
  type TaskInputStoreBucket,
} from "../src/taskInput/TaskInputStore.js";

describe("TaskInputStore", () => {
  it("publishes, replays, and returns owned canonical input", async () => {
    const bucket = new MemoryBucket();
    const store = makeTaskInputStore(bucket);
    const value = Object.freeze({ task: "send", nested: Object.freeze([1, 2]) });

    const first = await Effect.runPromise(store.publish(value));
    const replay = await Effect.runPromise(store.publish(value));
    const read = await Effect.runPromise(store.read(first));

    expect(replay).toEqual(first);
    expect(read.value).toEqual(value);
    expect(bucket.putCalls).toBe(2);
    expect(bucket.getCalls).toBeGreaterThanOrEqual(1);

    read.canonicalBytes[0] = 0;
    read.reference.sha256[0] = 0;
    const reread = await Effect.runPromise(store.read(first));
    expect(reread.canonicalBytes[0]).not.toBe(0);
    expect(reread.reference.sha256).toEqual(first.sha256);
  });

  it("reconciles a lost create response against exact immutable bytes", async () => {
    const bucket = new MemoryBucket();
    bucket.rejectAfterWrite = true;
    const store = makeTaskInputStore(bucket);

    const reference = await Effect.runPromise(store.publish("reconciled"));

    await expect(Effect.runPromise(store.read(reference))).resolves.toMatchObject({
      value: "reconciled",
    });
    expect(bucket.putCalls).toBe(1);
  });

  it("keeps unresolved create reconciliation typed as uncertain", async () => {
    const bucket = new MemoryBucket();
    bucket.rejectBeforeWrite = true;
    bucket.rejectGets = true;
    const exit = await Effect.runPromiseExit(
      makeTaskInputStore(bucket).publish("uncertain"),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const error = Option.getOrThrow(Cause.findErrorOption(exit.cause));
      expect(error).toMatchObject({
        _tag: "TaskInputStoreSettlementUncertainError",
        stage: "reconcileRead",
      });
      if (error._tag === "TaskInputStoreSettlementUncertainError") {
        expect(taskInputStoreSettlementUncertainCause(error)).toMatchObject({
          createStage: "firstCreate",
        });
      }
    }
  });

  it("separates missing, corrupt, and resource read failures", async () => {
    const bucket = new MemoryBucket();
    const store = makeTaskInputStore(bucket);
    const reference = await Effect.runPromise(store.publish("valid"));

    bucket.values.delete(reference.objectKey);
    await expectFailure(store.read(reference), "TaskInputStoreNotFoundError");

    bucket.values.set(reference.objectKey, new Uint8Array([1]));
    await expectFailure(
      store.read(reference),
      "TaskInputStoreCorruptionError",
      "sizeMismatch",
    );

    bucket.rejectGets = true;
    await expectFailure(store.read(reference), "TaskInputStoreResourceError");
  });

  it("rejects hostile and over-budget references before reading storage", async () => {
    const bucket = new MemoryBucket();
    const store = makeTaskInputStore(bucket);
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();

    await expectFailure(store.read(revoked.proxy), "TaskInputStoreInputError");
    await expectFailure(store.read({
      codec: "flarex.task-input-reference.v1",
      store: "flarex.task-input-object-store.v1",
      valueCodec: "flarex-value/v1",
      objectKey: "wrong",
      byteLength: MAX_TASK_INPUT_CANONICAL_BYTES_V1 + 1,
      sha256: new Uint8Array(32),
      retention: { kind: "run_lifetime" },
    }), "TaskInputStoreInputError");
    expect(bucket.getCalls).toBe(0);
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

class MemoryBucket implements TaskInputStoreBucket {
  readonly values = new Map<string, Uint8Array>();
  putCalls = 0;
  getCalls = 0;
  rejectAfterWrite = false;
  rejectBeforeWrite = false;
  rejectGets = false;

  async put(
    key: string,
    value: ArrayBuffer,
    _options: Readonly<{
      readonly onlyIf: Readonly<{ readonly etagDoesNotMatch: "*" }>;
    }>,
  ): Promise<unknown> {
    this.putCalls += 1;
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
    return {
      size: bytes.byteLength,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(copyBytes(bytes));
          controller.close();
        },
      }),
    };
  }
}
