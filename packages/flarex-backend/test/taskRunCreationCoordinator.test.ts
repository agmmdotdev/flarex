import {
  TaskRunCreationIdempotencyConflictError,
  decodeTaskRunCreationReceiptV1,
  type TaskRunCreationReceiptV1,
  type TaskRunCreationRequestV1,
} from "@flarex/durable-task/internal/run-creation-v1";
import {
  decodeTaskDefinitionRevisionIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { copyBytes, bytesEqualFullScan } from "@flarex/utils/bytes";
import { Cause, Data, Effect, Exit, Option, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  makeTaskRunCreationCoordinator,
  type TaskRunCreationPort,
} from "../src/taskRunInput/TaskRunCreationCoordinator.js";
import {
  makeTaskRunInputStore,
  type TaskRunInputStore,
  type TaskRunInputStoreBucket,
} from "../src/taskRunInput/TaskRunInputStore.js";

const DEFINITION_ID = Result.getOrThrow(decodeTaskDefinitionRevisionIdV1(
  "taskdef_73000000-0000-4000-8000-000000000001",
));
const RECEIPT = Result.getOrThrow(decodeTaskRunCreationReceiptV1({
  status: "created",
  version: 1,
  runId: "run_73000000-0000-4000-8000-000000000002",
  taskDefinitionRevisionId: DEFINITION_ID,
  createdAtMs: 1_900_000_000_000,
  requestKeySha256: new Uint8Array(32).fill(0x11),
  requestSha256: new Uint8Array(32).fill(0x22),
  creationAuthoritySha256: new Uint8Array(32).fill(0x33),
}));

class HiddenCreationResponseError extends Data.TaggedError(
  "HiddenCreationResponseError",
)<{}> {}

describe("TaskRunCreationCoordinator", () => {
  it("validates request authority before R2 and preserves both receivers", async () => {
    const bucket = new MemoryBucket();
    const actualStore = makeTaskRunInputStore(bucket);
    const inputOwner = {
      marker: "input-owner",
      publish(this: { marker: string }, value: unknown) {
        if (this.marker !== "input-owner") return Effect.die("lost input receiver");
        return actualStore.publish(value);
      },
      read: actualStore.read,
    } satisfies TaskRunInputStore & { readonly marker: string };
    const creationOwner = {
      marker: "creation-owner",
      createRun(this: { marker: string }, _request: TaskRunCreationRequestV1) {
        if (this.marker !== "creation-owner") return Effect.die("lost creation receiver");
        return Effect.succeed(RECEIPT);
      },
    } satisfies TaskRunCreationPort<never> & { readonly marker: string };
    const coordinator = Result.getOrThrow(
      makeTaskRunCreationCoordinator(inputOwner, creationOwner),
    );

    await expectFailureTag(coordinator.create({
      requestKey: " invalid",
      taskDefinitionRevisionId: DEFINITION_ID,
      input: { orderId: "before-r2" },
    }), "InvalidTaskRunCreationRequestError");
    expect(bucket.putCalls).toBe(0);

    await expect(Effect.runPromise(coordinator.create({
      requestKey: "request-receiver",
      taskDefinitionRevisionId: DEFINITION_ID,
      input: { orderId: "receiver" },
    }))).resolves.toEqual(RECEIPT);
    expect(bucket.putCalls).toBe(1);
  });

  it("short-circuits database creation when immutable publication is uncertain", async () => {
    const bucket = new MemoryBucket();
    bucket.rejectPuts = true;
    bucket.rejectGets = true;
    let creationCalls = 0;
    const coordinator = Result.getOrThrow(makeTaskRunCreationCoordinator(
      makeTaskRunInputStore(bucket),
      {
        createRun: () => {
          creationCalls += 1;
          return Effect.succeed(RECEIPT);
        },
      },
    ));

    await expectFailureTag(coordinator.create(command(
      "request-object-failure",
      { orderId: "object-failure" },
    )), "TaskRunInputStoreSettlementUncertainError");
    expect(creationCalls).toBe(0);
  });

  it("leaves a converged immutable body after database failure", async () => {
    const bucket = new MemoryBucket();
    const databaseFailure = new HiddenCreationResponseError();
    const requests: TaskRunCreationRequestV1[] = [];
    const coordinator = Result.getOrThrow(makeTaskRunCreationCoordinator(
      makeTaskRunInputStore(bucket),
      {
        createRun: request => {
          requests.push(request);
          return Effect.fail(databaseFailure);
        },
      },
    ));

    await expectFailureTag(coordinator.create(command(
      "request-db-failure",
      { orderId: "db-failure" },
    )), "HiddenCreationResponseError");
    expect(requests).toHaveLength(1);
    expect(bucket.values.has(requests[0]!.input.objectKey)).toBe(true);
    expect(bucket.deleteCalls).toBe(0);
  });

  it("replays unknown database settlement with the same reference", async () => {
    const bucket = new MemoryBucket();
    let committed: TaskRunCreationRequestV1 | undefined;
    let calls = 0;
    const coordinator = Result.getOrThrow(makeTaskRunCreationCoordinator(
      makeTaskRunInputStore(bucket),
      {
        createRun: request => {
          calls += 1;
          if (committed === undefined) {
            committed = request;
            return Effect.fail(new HiddenCreationResponseError());
          }
          if (
            request.requestKey !== committed.requestKey
            || request.input.objectKey !== committed.input.objectKey
            || !bytesEqualFullScan(request.input.sha256, committed.input.sha256)
          ) return Effect.die("replay changed the exact creation request");
          return Effect.succeed(RECEIPT);
        },
      },
    ));
    const supplied = command("request-hidden-commit", {
      orderId: "hidden-commit",
    });

    await expectFailureTag(
      coordinator.create(supplied),
      "HiddenCreationResponseError",
    );
    await expect(Effect.runPromise(coordinator.create(supplied)))
      .resolves.toEqual(RECEIPT);
    expect(calls).toBe(2);
    expect(bucket.putCalls).toBe(2);
    expect(bucket.values).toHaveLength(1);
  });

  it("preserves the existing request-key conflict and rejects hostile shapes", async () => {
    const bucket = new MemoryBucket();
    let first: TaskRunCreationRequestV1 | undefined;
    const coordinator = Result.getOrThrow(makeTaskRunCreationCoordinator(
      makeTaskRunInputStore(bucket),
      {
        createRun: request => {
          if (first === undefined) {
            first = request;
            return Effect.succeed(RECEIPT);
          }
          if (!bytesEqualFullScan(first.input.sha256, request.input.sha256)) {
            return Effect.fail(new TaskRunCreationIdempotencyConflictError({
              requestKey: request.requestKey,
              reason: "request_digest_mismatch",
            }));
          }
          return Effect.succeed(RECEIPT);
        },
      },
    ));
    await Effect.runPromise(coordinator.create(command(
      "request-conflict",
      { orderId: "first" },
    )));
    await expectFailureTag(coordinator.create(command(
      "request-conflict",
      { orderId: "second" },
    )), "TaskRunCreationIdempotencyConflictError");

    const revocable = Proxy.revocable({}, {});
    const revoked = revocable.proxy;
    revocable.revoke();
    const putsBefore = bucket.putCalls;
    await expectFailureTag(
      coordinator.create(revoked),
      "TaskRunCreationCoordinatorInputError",
    );
    expect(bucket.putCalls).toBe(putsBefore);
  });

  it("rejects malformed capability composition without invoking getters twice", () => {
    let reads = 0;
    const invalidStore: TaskRunInputStore = {
      get publish(): TaskRunInputStore["publish"] {
        reads += 1;
        throw new Error("hostile publish getter");
      },
      read: () => Effect.die("unused input read"),
    };
    const result = makeTaskRunCreationCoordinator(
      invalidStore,
      { createRun: () => Effect.succeed(RECEIPT) },
    );
    expect(Result.isFailure(result)).toBe(true);
    expect(reads).toBe(1);
  });
});

function command(requestKey: string, input: unknown) {
  return { requestKey, taskDefinitionRevisionId: DEFINITION_ID, input };
}

async function expectFailureTag(
  effect: Effect.Effect<unknown, unknown>,
  tag: string,
): Promise<void> {
  const exit = await Effect.runPromiseExit(effect);
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    expect(Option.getOrThrow(Cause.findErrorOption(exit.cause)))
      .toMatchObject({ _tag: tag });
  }
}

class MemoryBucket implements TaskRunInputStoreBucket {
  readonly values = new Map<string, Uint8Array>();
  putCalls = 0;
  getCalls = 0;
  deleteCalls = 0;
  rejectPuts = false;
  rejectGets = false;

  async put(
    key: string,
    value: ArrayBuffer,
    _options: { readonly onlyIf: { readonly etagDoesNotMatch: "*" } },
  ): Promise<unknown> {
    this.putCalls += 1;
    if (this.rejectPuts) throw new Error("put unavailable");
    if (this.values.has(key)) throw new Error("precondition failed");
    this.values.set(key, new Uint8Array(value.slice(0)));
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
          controller.enqueue(bytes);
          controller.close();
        },
      }),
    };
  }
}
