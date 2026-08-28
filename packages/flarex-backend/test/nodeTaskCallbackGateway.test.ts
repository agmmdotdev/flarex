import {
  validateApplicationTaskComputeDispatchRequestV1,
} from "@flarex/durable-task/internal/compute-provider-v1";
import { makeTaskInputReferenceV1 } from
  "@flarex/durable-task/internal/run-creation-v1";
import type { TaskComputeProfileRefV1 } from
  "@flarex/durable-task/internal/run-attempt-v1";
import { bytesEqualFullScan } from "@flarex/utils/bytes";
import {
  NODE_TASK_RUNTIME_ARTIFACT_STORE_V1,
  NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
  NODE_TASK_RUNTIME_BUNDLE_CODEC_V1,
  NODE_TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
  NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1,
  SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
  SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
  TASK_RUNTIME_CONTRACT_IDENTITY_V1,
  encodeNodeTaskRuntimeArtifactPreimageV1,
  nodeTaskRuntimeArtifactObjectKeyV1,
  type TaskDefinitionSha256V1,
} from "@flarex/standard-application-definition/internal/task-definition-v1";
import {
  Brand,
  Cause,
  Deferred,
  Effect,
  Exit,
  Fiber,
  Option,
  Result,
} from
  "effect";
import { TestClock } from "effect/testing";
import {
  normalizeApplicationTaskMutationCallbackValueV1,
} from "flarex-protocol/internal/application-task-mutation-callback-v1";
import {
  normalizeApplicationTaskQueryCallbackValueV1,
} from "flarex-protocol/internal/application-task-query-callback-v1";
import { describe, expect, it } from "vitest";

import type {
  ApplicationTaskMutationCallbackSession,
} from "../src/taskComputeDelivery/ApplicationTaskMutationCallback.js";
import type {
  ApplicationTaskQueryCallbackSession,
} from "../src/taskComputeDelivery/ApplicationTaskQueryCallback.js";
import { NodeTaskExecutorClientError } from
  "../src/taskComputeDelivery/NodeTaskExecutorClient.js";
import {
  NodeTaskCallbackGatewayError,
  makeNodeTaskCallbackGateway,
  type NodeTaskCallbackCapabilityV1,
  type NodeTaskCallbackGatewayOptions,
  type NodeTaskCallbackGatewayLease,
} from "../src/taskComputeDelivery/NodeTaskCallbackGateway.js";
import {
  NODE_TASK_CALLBACK_ATTACHMENT_ACK_FORMAT_V1,
  NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
  NODE_TASK_CALLBACK_REQUEST_FORMAT_V1,
  decodeNodeTaskCallbackAttachmentV1,
  decodeNodeTaskCallbackRequestV1,
  decodeNodeTaskCallbackResponseForRequestV1,
  decodeNodeTaskCallbackResponseV1,
  decodeNodeTaskCallbackSequenceV1,
  makeNodeTaskCallbackRequestIdV1,
  type NodeTaskCallbackRequestV1,
  type NodeTaskCallbackAttachmentV1,
  type NodeTaskCallbackSequenceV1,
} from "../src/taskComputeDelivery/NodeTaskCallbackProtocolV1.js";
import {
  NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
  NODE_TASK_EXECUTOR_START_FORMAT_V1,
  decodeNodeTaskExecutorStartResponseV1,
  makeNodeTaskExecutorRecoveryKeyV1,
  makeNodeTaskExecutorStartKeyV1,
  type NodeTaskExecutorAcceptanceV1,
  type NodeTaskExecutorStartRequestV1,
} from "../src/taskComputeDelivery/NodeTaskExecutorProtocolV1.js";

const scopeId = "scope_00000000-0000-4000-8000-000000000001";
const computeProfile = Brand.nominal<TaskComputeProfileRefV1>()("node-1x");

describe("Node Task callback gateway N4", () => {
  it("attaches the launch credential through the accepted executor session", async () => {
    let attached: NodeTaskCallbackAttachmentV1 | undefined;
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const start = startRequest(8, 2);
      const gateway = yield* makeNodeTaskCallbackGateway({
        start,
        executorSession: executorSession(
          acceptance(start),
          attachment => { attached = attachment; },
        ),
        querySession: {
          runQuery: Effect.fn("test.runQuery")(() => Effect.succeed({ ok: true })),
        },
        mutationSession: mutationSession(() => 1),
        credential: digest(0xc1),
      });
      expect(attached).toEqual(gateway.capability);
      if (attached === undefined) throw new Error("Expected callback attachment");
      const response = yield* gateway.invoke(queryRequest(
        attached,
        1n,
        "orders:get",
      ));
      expect(response.operation).toBe("runQuery");
    })));
  });

  it("reuses a pre-issued credential after an uncertain attachment ack", async () => {
    let stored: NodeTaskCallbackAttachmentV1 | undefined;
    let attachmentCalls = 0;
    const credential = digest(0xc1);
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const start = startRequest(8, 2);
      const accepted = acceptance(start);
      const executor: NodeTaskCallbackGatewayOptions["executorSession"] = {
        acceptance: accepted,
        attachCallbackCapability: attachment => Effect.suspend(() => {
          attachmentCalls += 1;
          if (stored === undefined) {
            stored = attachment;
            return Effect.fail(new NodeTaskExecutorClientError({
              operation: "attachCallbackCapability",
              reason: "transportAfterAcceptance",
              retryable: true,
            }));
          }
          return bytesEqualFullScan(stored.credential, attachment.credential)
            ? Effect.succeed(attachmentAck(attachment))
            : Effect.fail(new NodeTaskExecutorClientError({
                operation: "attachCallbackCapability",
                reason: "idempotencyConflict",
                retryable: false,
              }));
        }),
      };
      const gatewayOptions = () => ({
        start,
        executorSession: executor,
        querySession: {
          runQuery: Effect.fn("test.runQuery")(() => Effect.succeed({})),
        },
        mutationSession: mutationSession(() => 1),
        credential,
      });
      const first = expectGatewayFailure(
        yield* Effect.exit(makeNodeTaskCallbackGateway(gatewayOptions())),
        "attachmentFailed",
      );
      expect(first.retryable).toBe(true);
      const replay = yield* makeNodeTaskCallbackGateway(gatewayOptions());
      expect(replay.capability.credential).toEqual(credential);
    })));
    expect(attachmentCalls).toBe(2);
  });

  it("strictly decodes the authenticated callback wire", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const gateway = yield* makeGateway({});
      expect(success(decodeNodeTaskCallbackAttachmentV1(
        gateway.capability,
      ))).toEqual(gateway.capability);
      expect(Result.isFailure(decodeNodeTaskCallbackAttachmentV1({
        ...gateway.capability,
        unexpected: true,
      }))).toBe(true);
      const request = queryRequest(gateway.capability, 1n, "orders:get");
      expect(success(decodeNodeTaskCallbackRequestV1(request))).toEqual(request);
      expect(Result.isFailure(decodeNodeTaskCallbackRequestV1({
        ...request,
        unexpected: true,
      }))).toBe(true);
      expect(Result.isFailure(decodeNodeTaskCallbackRequestV1({
        ...request,
        requestId: "caller-selected-request-id",
      }))).toBe(true);
      const hostileCredential = new Proxy(new Uint8Array(32), {});
      expect(() => decodeNodeTaskCallbackRequestV1({
        ...request,
        credential: hostileCredential,
      })).not.toThrow();
      expect(Result.isFailure(decodeNodeTaskCallbackRequestV1({
        ...request,
        credential: hostileCredential,
      }))).toBe(true);
    })));
  });

  it("authenticates, delegates unique calls, and replays exact responses", async () => {
    let queryCalls = 0;
    let mutationCalls = 0;
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const gateway = yield* makeGateway({
        querySession: {
          runQuery: Effect.fn("test.runQuery")((_path, _arguments) =>
            Effect.sync(() => Object.freeze({ transaction: ++queryCalls }))),
        },
        mutationSession: mutationSession(() => ++mutationCalls),
      });
      const first = queryRequest(gateway.capability, 1n, "orders:get");
      const firstResponse = yield* gateway.invoke(first);
      expect(success(decodeNodeTaskCallbackResponseV1(firstResponse)))
        .toEqual(firstResponse);
      expect(success(decodeNodeTaskCallbackResponseForRequestV1(
        firstResponse,
        first,
      ))).toEqual(firstResponse);
      expect(Result.isFailure(decodeNodeTaskCallbackResponseForRequestV1({
        ...firstResponse,
        sequence: callbackSequence(2n),
      }, first))).toBe(true);
      expect((yield* gateway.invoke(first))).toEqual(firstResponse);
      expect(queryCalls).toBe(1);

      const mutation = mutationRequest(
        gateway.capability,
        2n,
        1n,
        "orders:update",
      );
      const mutationResponse = yield* gateway.invoke(mutation);
      expect((yield* gateway.invoke(mutation))).toEqual(mutationResponse);
      expect(mutationCalls).toBe(1);

      const secondQuery = yield* gateway.invoke(queryRequest(
        gateway.capability,
        3n,
        "orders:list",
      ));
      expect(secondQuery.operation).toBe("runQuery");
      expect(queryCalls).toBe(2);
    })));
  });

  it("rejects credential, correlation, sequence, and contradictory replay", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const gateway = yield* makeGateway({});
      const first = queryRequest(gateway.capability, 1n, "orders:get");

      const badCredential = Object.freeze({
        ...first,
        credential: digest(0xee),
      });
      expectGatewayFailure(
        yield* Effect.exit(gateway.invoke(badCredential)),
        "authenticationFailed",
      );
      const otherExecution = Brand.nominal<
        NodeTaskExecutorStartRequestV1["executionId"]
      >()("node-execution-other");
      expectGatewayFailure(
        yield* Effect.exit(gateway.invoke(Object.freeze({
          ...first,
          executionId: otherExecution,
        }))),
        "correlationMismatch",
      );
      expectGatewayFailure(
        yield* Effect.exit(gateway.invoke(queryRequest(
          gateway.capability,
          2n,
          "orders:gap",
        ))),
        "sequenceMismatch",
      );
      yield* gateway.invoke(first);
      expectGatewayFailure(
        yield* Effect.exit(gateway.invoke(queryRequest(
          gateway.capability,
          1n,
          "orders:other",
        ))),
        "replayConflict",
      );
      expectGatewayFailure(
        yield* Effect.exit(gateway.invoke(mutationRequest(
          gateway.capability,
          2n,
          2n,
          "orders:update",
        ))),
        "sequenceMismatch",
      );
    })));
  });

  it("enforces combined call and concurrency budgets", async () => {
    const started = Deferred.makeUnsafe<void, never>();
    const release = Deferred.makeUnsafe<void, never>();
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const gateway = yield* makeGateway({
        maximumCalls: 2,
        maximumConcurrentCalls: 1,
        querySession: {
          runQuery: Effect.fn("test.blockedQuery")(() =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.as(Object.freeze({ ok: true })),
            )),
        },
      });
      const first = yield* gateway.invoke(queryRequest(
        gateway.capability,
        1n,
        "orders:first",
      )).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      const transient = expectGatewayFailure(
        yield* Effect.exit(gateway.invoke(queryRequest(
          gateway.capability,
          2n,
          "orders:second",
        ))),
        "resourceExceeded",
      );
      expect(transient.retryable).toBe(true);
      yield* Deferred.succeed(release, undefined);
      expect(Exit.isSuccess(yield* Fiber.await(first))).toBe(true);
      yield* gateway.invoke(queryRequest(
        gateway.capability,
        2n,
        "orders:second",
      ));
      const permanent = expectGatewayFailure(
        yield* Effect.exit(gateway.invoke(queryRequest(
          gateway.capability,
          3n,
          "orders:third",
        ))),
        "resourceExceeded",
      );
      expect(permanent.retryable).toBe(false);
    })));
  });

  it("maps authority failures and revokes in-flight work on close", async () => {
    const started = Deferred.makeUnsafe<void, never>();
    let mutationClosed = 0;
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const gateway = yield* makeGateway({
        querySession: {
          runQuery: Effect.fn("test.staleQuery")((path, _arguments) =>
            path === "orders:stale"
              ? Effect.fail(Object.freeze({ reason: "staleLaunch" as const }))
              : Deferred.succeed(started, undefined).pipe(
                  Effect.andThen(Effect.never),
                )),
        },
        mutationSession: {
          maximumCloseMilliseconds: 1_000,
          runMutation: Effect.fn("test.runMutation")(() => Effect.succeed({})),
          close: Effect.sync(() => { mutationClosed += 1; }),
        },
      });
      const stale = yield* gateway.invoke(queryRequest(
        gateway.capability,
        1n,
        "orders:stale",
      ));
      expect(stale.operation).toBe("runQuery");
      if (stale.operation === "runQuery") {
        expect(stale.result).toMatchObject({
          kind: "failure",
          reason: "stale_launch",
        });
      }
      const pending = yield* gateway.invoke(queryRequest(
        gateway.capability,
        2n,
        "orders:block",
      )).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* gateway.close;
      const closed = yield* Fiber.join(pending);
      expect(closed.operation).toBe("runQuery");
      if (closed.operation === "runQuery") {
        expect(closed.result).toMatchObject({
          kind: "failure",
          reason: "interrupted",
        });
      }
      expect(mutationClosed).toBe(1);
      expectGatewayFailure(
        yield* Effect.exit(gateway.invoke(queryRequest(
          gateway.capability,
          3n,
          "orders:after-close",
        ))),
        "revoked",
      );
    })));
  });

  it("keeps admitted work alive when one transport waiter disappears", async () => {
    const started = Deferred.makeUnsafe<void, never>();
    const release = Deferred.makeUnsafe<void, never>();
    let calls = 0;
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const gateway = yield* makeGateway({
        querySession: {
          runQuery: Effect.fn("test.lostResponseQuery")(() =>
            Effect.sync(() => { calls += 1; }).pipe(
              Effect.andThen(Deferred.succeed(started, undefined)),
              Effect.andThen(Deferred.await(release)),
              Effect.as(Object.freeze({ ok: true })),
            )),
        },
      });
      const request = queryRequest(gateway.capability, 1n, "orders:get");
      const first = yield* gateway.invoke(request).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(first);
      yield* Deferred.succeed(release, undefined);
      const replay = yield* gateway.invoke(request);
      expect(replay.operation).toBe("runQuery");
      expect(calls).toBe(1);
    })));
  });

  it("preserves a mutation success learned after its transport deadline", async () => {
    const started = Deferred.makeUnsafe<void, never>();
    const release = Deferred.makeUnsafe<void, never>();
    let calls = 0;
    const response = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const gateway = yield* makeGateway({
        mutationSession: {
          maximumCloseMilliseconds: 1_000,
          runMutation: Effect.fn("test.lateMutation")(() =>
            Effect.sync(() => { calls += 1; }).pipe(
              Effect.andThen(Deferred.succeed(started, undefined)),
              Effect.andThen(Deferred.await(release)),
              Effect.as(Object.freeze({ committed: true })),
            )),
          close: Deferred.succeed(release, undefined),
        },
      });
      const request = mutationRequest(
        gateway.capability,
        1n,
        1n,
        "orders:update",
      );
      const pending = yield* gateway.invoke(request).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* Fiber.interrupt(pending);
      yield* TestClock.adjust(1_001);
      return yield* gateway.invoke(request);
    }).pipe(Effect.provide(TestClock.layer()))));
    expect(response.operation).toBe("runMutation");
    if (response.operation === "runMutation") {
      expect(response.result).toMatchObject({ kind: "success" });
    }
    expect(calls).toBe(1);
  });

  it("reports outcome uncertainty when mutation disposition cannot settle", async () => {
    const started = Deferred.makeUnsafe<void, never>();
    const response = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const gateway = yield* makeGateway({
        mutationSession: {
          maximumCloseMilliseconds: 1_000,
          runMutation: Effect.fn("test.uncertainMutation")(() =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Effect.never),
            )),
          close: Effect.fail(Object.freeze({
            reason: "outcomeUncertain" as const,
          })),
        },
      });
      const pending = yield* gateway.invoke(mutationRequest(
        gateway.capability,
        1n,
        1n,
        "orders:update",
      )).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust(1_001);
      return yield* Fiber.join(pending);
    }).pipe(Effect.provide(TestClock.layer()))));
    expect(response.operation).toBe("runMutation");
    if (response.operation === "runMutation") {
      expect(response.result).toMatchObject({
        kind: "failure",
        reason: "outcome_uncertain",
      });
    }
  });

  it("preserves known mutation success even when owner close then fails", async () => {
    const started = Deferred.makeUnsafe<void, never>();
    const release = Deferred.makeUnsafe<void, never>();
    const operationFinished = Deferred.makeUnsafe<void, never>();
    const response = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const gateway = yield* makeGateway({
        mutationSession: {
          maximumCloseMilliseconds: 1_000,
          runMutation: Effect.fn("test.closeFailureAfterCommit")(() =>
            Deferred.succeed(started, undefined).pipe(
              Effect.andThen(Deferred.await(release)),
              Effect.andThen(Deferred.succeed(operationFinished, undefined)),
              Effect.as(Object.freeze({ committed: true })),
            )),
          close: Deferred.succeed(release, undefined).pipe(
            Effect.andThen(Deferred.await(operationFinished)),
            Effect.andThen(Effect.fail(Object.freeze({
              reason: "outcomeUncertain" as const,
            }))),
          ),
        },
      });
      const pending = yield* gateway.invoke(mutationRequest(
        gateway.capability,
        1n,
        1n,
        "orders:update",
      )).pipe(Effect.forkChild);
      yield* Deferred.await(started);
      yield* TestClock.adjust(1_001);
      return yield* Fiber.join(pending);
    }).pipe(Effect.provide(TestClock.layer()))));
    expect(response.operation).toBe("runMutation");
    if (response.operation === "runMutation") {
      expect(response.result).toMatchObject({ kind: "success" });
    }
  });

  it("rejects every call after launch capability expiry", async () => {
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      yield* TestClock.setTime(4_000_000_000_000);
      const gateway = yield* makeGateway({});
      expectGatewayFailure(
        yield* Effect.exit(gateway.invoke(queryRequest(
          gateway.capability,
          1n,
          "orders:get",
        ))),
        "revoked",
      );
    }).pipe(Effect.provide(TestClock.layer()))));
  });

  it("fails closed on invalid binding and credential material", async () => {
    let closeCalls = 0;
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const start = startRequest(8, 2);
      const accepted = acceptance(start);
      const otherExecution = Brand.nominal<
        NodeTaskExecutorStartRequestV1["executionId"]
      >()("node-execution-other");
      expectGatewayFailure(
        yield* Effect.exit(makeNodeTaskCallbackGateway({
          start,
          executorSession: executorSession(Object.freeze({
              ...accepted,
              executionId: otherExecution,
            })),
          querySession: {
            runQuery: Effect.fn("test.runQuery")(() => Effect.succeed({})),
          },
          mutationSession: {
            ...mutationSession(() => 1),
            close: Effect.sync(() => { closeCalls += 1; }),
          },
          credential: digest(0xc1),
        })),
        "invalidBinding",
      );
      expectGatewayFailure(
        yield* Effect.exit(makeNodeTaskCallbackGateway({
          start,
          executorSession: executorSession(accepted),
          querySession: {
            runQuery: Effect.fn("test.runQuery")(() => Effect.succeed({})),
          },
          mutationSession: {
            ...mutationSession(() => 1),
            close: Effect.sync(() => { closeCalls += 1; }),
          },
          credential: new Uint8Array(31),
        })),
        "invalidCredential",
      );
    })));
    expect(closeCalls).toBe(2);
  });

  it("captures the original session operations and closes them exactly once", async () => {
    let originalCloses = 0;
    let replacementCloses = 0;
    let originalQueries = 0;
    let replacementQueries = 0;
    let originalMutations = 0;
    let replacementMutations = 0;
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const start = startRequest(8, 2);
      const querySession = {
        runQuery: Effect.fn("test.originalQuery")(() => Effect.sync(() => {
          originalQueries += 1;
          return Object.freeze({ ok: true });
        })),
      };
      const originalSession = {
        maximumCloseMilliseconds: 1_000,
        runMutation: Effect.fn("test.originalMutation")(() => Effect.sync(() => {
          originalMutations += 1;
          return Object.freeze({ ok: true });
        })),
        close: Effect.sync(() => { originalCloses += 1; }),
      };
      const options = {
        start,
        executorSession: executorSession(acceptance(start)),
        querySession,
        mutationSession: originalSession,
        credential: digest(0xc1),
      };
      const gateway = yield* makeNodeTaskCallbackGateway(options);
      querySession.runQuery = Effect.fn("test.replacementQuery")(
        () => Effect.sync(() => {
          replacementQueries += 1;
          return Object.freeze({ ok: true });
        }),
      );
      originalSession.runMutation = Effect.fn("test.replacementMutation")(
        () => Effect.sync(() => {
          replacementMutations += 1;
          return Object.freeze({ ok: true });
        }),
      );
      originalSession.close = Effect.sync(() => { replacementCloses += 1; });
      yield* gateway.invoke(queryRequest(
        gateway.capability,
        1n,
        "orders:get",
      ));
      yield* gateway.invoke(mutationRequest(
        gateway.capability,
        2n,
        1n,
        "orders:update",
      ));
      yield* gateway.close;
      yield* gateway.close;
    })));
    expect(originalCloses).toBe(1);
    expect(replacementCloses).toBe(0);
    expect(originalQueries).toBe(1);
    expect(replacementQueries).toBe(0);
    expect(originalMutations).toBe(1);
    expect(replacementMutations).toBe(0);
  });

  it("closes its mutation owner when executor attachment fails", async () => {
    let closeCalls = 0;
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const start = startRequest(8, 2);
      expectGatewayFailure(
        yield* Effect.exit(makeNodeTaskCallbackGateway({
          start,
          executorSession: {
            acceptance: acceptance(start),
            attachCallbackCapability: () => Effect.fail(
              new NodeTaskExecutorClientError({
                operation: "attachCallbackCapability",
                reason: "transportAfterAcceptance",
                retryable: true,
              }),
            ),
          },
          querySession: {
            runQuery: Effect.fn("test.runQuery")(() => Effect.succeed({})),
          },
          mutationSession: {
            ...mutationSession(() => 1),
            close: Effect.sync(() => { closeCalls += 1; }),
          },
          credential: digest(0xc1),
        })),
        "attachmentFailed",
      );
    })));
    expect(closeCalls).toBe(1);
  });

  it("closes its mutation owner when executor attachment is interrupted", async () => {
    let closeCalls = 0;
    const attachmentStarted = Deferred.makeUnsafe<void, never>();
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const start = startRequest(8, 2);
      const acquisition = makeNodeTaskCallbackGateway({
        start,
        executorSession: {
          acceptance: acceptance(start),
          attachCallbackCapability: () => Deferred.succeed(
            attachmentStarted,
            undefined,
          ).pipe(Effect.andThen(Effect.never)),
        },
        querySession: {
          runQuery: Effect.fn("test.runQuery")(() => Effect.succeed({})),
        },
        mutationSession: {
          ...mutationSession(() => 1),
          close: Effect.sync(() => { closeCalls += 1; }),
        },
        credential: digest(0xc1),
      });
      const fiber = yield* acquisition.pipe(Effect.forkChild);
      yield* Deferred.await(attachmentStarted);
      yield* Fiber.interrupt(fiber);
    })));
    expect(closeCalls).toBe(1);
  });

  it("revokes the gateway and closes its mutation owner with Scope", async () => {
    let leakedGateway: NodeTaskCallbackGatewayLease | undefined;
    let closeCalls = 0;
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      leakedGateway = yield* makeGateway({
        mutationSession: {
          maximumCloseMilliseconds: 1_000,
          runMutation: Effect.fn("test.runMutation")(() => Effect.succeed({})),
          close: Effect.sync(() => { closeCalls += 1; }),
        },
      });
    })));
    expect(closeCalls).toBe(1);
    if (leakedGateway === undefined) throw new Error("Expected leaked gateway");
    expectGatewayFailure(
      await Effect.runPromise(Effect.exit(leakedGateway.invoke(queryRequest(
        leakedGateway.capability,
        1n,
        "orders:get",
      )))),
      "revoked",
    );
  });

  it("bounds a nonterminating mutation-owner close", async () => {
    const closeStarted = Deferred.makeUnsafe<void, never>();
    const closeExit = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const gateway = yield* makeGateway({
        mutationSession: {
          maximumCloseMilliseconds: 1_000,
          runMutation: Effect.fn("test.runMutation")(() => Effect.succeed({})),
          close: Deferred.succeed(closeStarted, undefined).pipe(
            Effect.andThen(Effect.never),
          ),
        },
      });
      const pending = yield* gateway.close.pipe(Effect.exit, Effect.forkChild);
      yield* Deferred.await(closeStarted);
      yield* TestClock.adjust(1_001);
      return yield* Fiber.join(pending);
    }).pipe(Effect.provide(TestClock.layer()))));
    expectGatewayFailure(closeExit, "closeFailed");
  });
});

interface GatewayFixtureOptions {
  readonly maximumCalls?: number;
  readonly maximumConcurrentCalls?: number;
  readonly querySession?: ApplicationTaskQueryCallbackSession;
  readonly mutationSession?: ApplicationTaskMutationCallbackSession;
}

function makeGateway(options: GatewayFixtureOptions) {
  const start = startRequest(
    options.maximumCalls ?? 8,
    options.maximumConcurrentCalls ?? 2,
  );
  return makeNodeTaskCallbackGateway({
    start,
    executorSession: executorSession(acceptance(start)),
    querySession: options.querySession ?? {
      runQuery: Effect.fn("test.runQuery")((_path, _arguments) =>
        Effect.succeed(Object.freeze({ ok: true }))),
    },
    mutationSession: options.mutationSession ?? mutationSession(() => 1),
    credential: digest(0xc1),
    maximumOperationMilliseconds: 1_000,
  });
}

function executorSession(
  accepted: NodeTaskExecutorAcceptanceV1,
  onAttachment: (attachment: NodeTaskCallbackAttachmentV1) => void = () => {},
): NodeTaskCallbackGatewayOptions["executorSession"] {
  return Object.freeze({
    acceptance: accepted,
    attachCallbackCapability: Effect.fn("test.attachCallbackCapability")(
      (attachment: NodeTaskCallbackAttachmentV1) => Effect.sync(() => {
        onAttachment(attachment);
        return attachmentAck(attachment);
      }),
    ),
  });
}

function attachmentAck(attachment: NodeTaskCallbackAttachmentV1) {
  return Object.freeze({
    format: NODE_TASK_CALLBACK_ATTACHMENT_ACK_FORMAT_V1,
    version: NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
    kind: "attached" as const,
    capabilityId: attachment.capabilityId,
    startKey: attachment.startKey,
    sessionId: attachment.sessionId,
    executionId: attachment.executionId,
    expiresAtEpochMilliseconds: attachment.expiresAtEpochMilliseconds,
  });
}

function mutationSession(
  nextTransaction: () => number,
): ApplicationTaskMutationCallbackSession {
  return Object.freeze({
    maximumCloseMilliseconds: 1_000,
    runMutation: Effect.fn("test.runMutation")((_ordinal, _path, _arguments) =>
      Effect.sync(() => Object.freeze({ transaction: nextTransaction() }))),
    close: Effect.void,
  });
}

function queryRequest(
  capability: NodeTaskCallbackCapabilityV1,
  sequenceValue: bigint,
  functionPath: string,
): NodeTaskCallbackRequestV1 {
  const sequence = callbackSequence(sequenceValue);
  const normalized = success(normalizeApplicationTaskQueryCallbackValueV1(
    Object.freeze({ orderId: "order-1" }),
    "request",
  ));
  return success(decodeNodeTaskCallbackRequestV1(Object.freeze({
    format: NODE_TASK_CALLBACK_REQUEST_FORMAT_V1,
    version: NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
    capabilityId: capability.capabilityId,
    credential: capability.credential,
    startKey: capability.startKey,
    sessionId: capability.sessionId,
    executionId: capability.executionId,
    sequence,
    requestId: makeNodeTaskCallbackRequestIdV1(
      capability.capabilityId,
      sequence,
    ),
    operation: "runQuery" as const,
    payload: Object.freeze({
      format: "flarex.application-task-query-callback" as const,
      version: 1 as const,
      operation: "runQuery" as const,
      functionPath,
      arguments: normalized.value,
      argumentSemanticBytes: normalized.semanticSizeBytes,
    }),
  })));
}

function mutationRequest(
  capability: NodeTaskCallbackCapabilityV1,
  sequenceValue: bigint,
  ordinal: bigint,
  functionPath: string,
): NodeTaskCallbackRequestV1 {
  const sequence = callbackSequence(sequenceValue);
  const normalized = success(normalizeApplicationTaskMutationCallbackValueV1(
    Object.freeze({ orderId: "order-1" }),
    "request",
  ));
  return success(decodeNodeTaskCallbackRequestV1(Object.freeze({
    format: NODE_TASK_CALLBACK_REQUEST_FORMAT_V1,
    version: NODE_TASK_CALLBACK_PROTOCOL_VERSION_V1,
    capabilityId: capability.capabilityId,
    credential: capability.credential,
    startKey: capability.startKey,
    sessionId: capability.sessionId,
    executionId: capability.executionId,
    sequence,
    requestId: makeNodeTaskCallbackRequestIdV1(
      capability.capabilityId,
      sequence,
    ),
    operation: "runMutation" as const,
    payload: Object.freeze({
      format: "flarex.application-task-mutation-callback" as const,
      version: 1 as const,
      operation: "runMutation" as const,
      ordinal,
      functionPath,
      arguments: normalized.value,
      argumentSemanticBytes: normalized.semanticSizeBytes,
    }),
  })));
}

function callbackSequence(value: bigint): NodeTaskCallbackSequenceV1 {
  return success(decodeNodeTaskCallbackSequenceV1(value));
}

function acceptance(
  start: NodeTaskExecutorStartRequestV1,
): NodeTaskExecutorAcceptanceV1 {
  const decoded = success(decodeNodeTaskExecutorStartResponseV1(Object.freeze({
    format: NODE_TASK_EXECUTOR_START_FORMAT_V1,
    version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
    kind: "accepted" as const,
    generation: "application_v1" as const,
    startKey: start.startKey,
    recoveryKey: start.recoveryKey,
    identity: start.dispatch.identity,
    executionId: start.executionId,
    sessionId: "node-session-1",
    cancellationGeneration: start.dispatch.cancellation.generation,
  })));
  if (decoded.kind !== "accepted") throw new Error("Expected acceptance");
  return decoded;
}

function startRequest(
  maximumCallbackCalls: number,
  maximumCallbackConcurrency: number,
): NodeTaskExecutorStartRequestV1 {
  const maximumDurationMs = 300_000;
  const dispatch = success(validateApplicationTaskComputeDispatchRequestV1({
    version: "flarex.task-compute-dispatch-request.v1",
    identity: {
      version: "flarex.task-compute-dispatch-identity.v1",
      scopeId,
      runId: "run_00000000-0000-4000-8000-000000000001",
      requestedEffectSequence: 1n,
      attemptId: "attempt_00000000-0000-4000-8000-000000000001",
      executionFence: 1n,
    },
    applicationTaskRuntimeTargetSha256: digest(0x12),
    attemptNumber: 1,
    leaseVersion: 1n,
    computeProfile,
    cancellation: { kind: "not_requested", generation: 0n },
    maximumDurationMs,
  }));
  const executionId = Brand.nominal<
    NodeTaskExecutorStartRequestV1["executionId"]
  >()("node-execution-1");
  const startKey = makeNodeTaskExecutorStartKeyV1(
    dispatch.identity,
    executionId,
  );
  return Object.freeze({
    format: NODE_TASK_EXECUTOR_START_FORMAT_V1,
    version: NODE_TASK_EXECUTOR_PROTOCOL_VERSION_V1,
    generation: "application_v1" as const,
    startKey,
    recoveryKey: makeNodeTaskExecutorRecoveryKeyV1(
      dispatch.identity,
      executionId,
    ),
    executionId,
    dispatch,
    nodeArtifactSha256Hex: "aa".repeat(32),
    nodeArtifactCanonicalBytes: success(
      encodeNodeTaskRuntimeArtifactPreimageV1(artifact()),
    ),
    input: success(makeTaskInputReferenceV1(digest(0x51), 1)),
    principal: {
      version: 1 as const,
      scopeId: dispatch.identity.scopeId,
      executionIdentity: {
        kind: "user" as const,
        user: {
          tokenIdentifier: "token-1",
          subject: "user-1",
          issuer: "https://issuer.example",
        },
      },
    },
    absoluteDeadlineEpochMilliseconds: 4_000_000_000_000,
    resourcePolicy: {
      computeProfile,
      resourceClassIdentity: "node-standard-1x",
      maximumDurationMilliseconds: maximumDurationMs,
      maximumCpuMilliseconds: 120_000,
      maximumMemoryBytes: 536_870_912,
      maximumTemporaryDiskBytes: 1_073_741_824,
      maximumProcesses: 1 as const,
      maximumFileDescriptors: 256,
      maximumOutputBytes: 33_554_432,
      maximumLogBytes: 8_388_608,
      maximumCallbackCalls,
      maximumCallbackConcurrency,
      outbound: "denied",
      filesystem: "none",
      nativeModules: "denied",
      environmentVariables: "platform_only",
      secrets: "denied",
      childProcesses: "denied",
    } satisfies NodeTaskExecutorStartRequestV1["resourcePolicy"],
    launchCapability: {
      format: "flarex.node-task-launch-capability-reference",
      version: 1,
      capabilityId: "launch-capability-1",
      boundStartKey: startKey,
      expiresAtEpochMilliseconds: 3_999_999_999_000,
    } satisfies NodeTaskExecutorStartRequestV1["launchCapability"],
    trace: {
      traceId: "01".repeat(16),
      parentSpanId: "02".repeat(8),
    },
  });
}

function artifact() {
  const bundleSha256 = digest(0x31);
  return {
    version: 1 as const,
    kind: "node_task_runtime_artifact" as const,
    runtimeFamily: "node" as const,
    runtimeContractIdentity: TASK_RUNTIME_CONTRACT_IDENTITY_V1,
    bridgeAbiIdentity: NODE_TASK_RUNTIME_BRIDGE_ABI_IDENTITY_V1,
    runtimeProfileIdentity: NODE_TASK_RUNTIME_PROFILE_IDENTITY_V1,
    moduleEntryPolicyIdentity:
      NODE_TASK_RUNTIME_MODULE_ENTRY_POLICY_IDENTITY_V1,
    nodeRuntimeAbiIdentity: "nodejs-24-linux-x64",
    moduleFormat: "es_module" as const,
    architecturePolicy: "portable_javascript" as const,
    nativeModules: "denied" as const,
    applicationRevisionId: "revision-orders-v3",
    candidateSha256: digest(0x11),
    taskId: "tasks.orders.process",
    canonicalTaskManifestSha256: digest(0x22),
    computeProfileCatalogSha256: digest(0x23),
    handler: {
      logicalModulePath: "tasks/orders",
      artifactModulePath: "tasks/orders.js",
      exportName: "run",
    },
    executionModule: "index.js",
    modules: [{
      moduleOrdinal: 0n,
      artifactModulePath: "index.js",
      sourceRoles: SOURCE_ARTIFACT_V2_ROLE_EXECUTION,
      rawByteLength: 100n,
      sourceSha256: digest(0x41),
    }, {
      moduleOrdinal: 1n,
      artifactModulePath: "tasks/orders.js",
      sourceRoles: SOURCE_ARTIFACT_V2_ROLE_FUNCTION,
      rawByteLength: 200n,
      sourceSha256: digest(0x42),
    }],
    bundle: {
      storeIdentity: NODE_TASK_RUNTIME_ARTIFACT_STORE_V1,
      kind: "node_bundle" as const,
      codecIdentity: NODE_TASK_RUNTIME_BUNDLE_CODEC_V1,
      objectKey: nodeTaskRuntimeArtifactObjectKeyV1(
        "node_bundle",
        bundleSha256,
      ),
      byteLength: 8_192n,
      sha256: bundleSha256,
    },
    dependencies: null,
    supportedComputeProfiles: [computeProfile],
  };
}

function digest(byte: number): TaskDefinitionSha256V1 {
  return new Uint8Array(32).fill(byte) as TaskDefinitionSha256V1;
}

function success<Success, Failure>(
  result: Result.Result<Success, Failure>,
): Success {
  if (Result.isFailure(result)) throw result.failure;
  return result.success;
}

function expectGatewayFailure<Success>(
  exit: Exit.Exit<Success, NodeTaskCallbackGatewayError>,
  reason: NodeTaskCallbackGatewayError["reason"],
): NodeTaskCallbackGatewayError {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isSuccess(exit)) throw new Error("Expected gateway failure");
  const failure = Option.getOrThrow(Cause.findErrorOption(exit.cause));
  expect(failure).toBeInstanceOf(NodeTaskCallbackGatewayError);
  if (!(failure instanceof NodeTaskCallbackGatewayError)) {
    throw new Error("Expected NodeTaskCallbackGatewayError");
  }
  expect(failure).toMatchObject({ reason });
  return failure;
}
