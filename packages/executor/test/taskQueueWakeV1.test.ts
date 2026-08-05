import type {
  TaskSystemWakePublishingSchedulerPartitionV1,
  TaskSystemWakeSchedulerResolverErrorV1,
  TaskSystemWakeSchedulerResolverV1,
} from "@flarex/persistence-postgres/internal/task-wake-scheduler-resolver-v1";
import { TrustedScopeAuthorityPortError } from "@flarex/persistence-postgres";
import { Brand, Data, Effect, Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  InvalidTaskQueueWakeConfigurationError,
  MAX_TASK_QUEUE_WAKE_BATCH_MESSAGES_V1,
  TaskQueueWakeBatchContractError,
  TaskQueueWakePublishError,
  TaskQueueWakeSettlementError,
  makeTaskQueueWakeAdapterV1,
  type TaskQueueWakeAdapterOptionsV1,
  type TaskQueueWakeHintEnvelopeV1,
  type TaskQueueWakeMessageV1,
} from "../src/taskQueueWakeV1";

const PARTITION = "deployment_queue_wake_v1";
const QUEUE_NAME = "flarex-task-wake-v1";
type PublishingScheduler = TaskSystemWakePublishingSchedulerPartitionV1<
  TaskQueueWakePublishError
>;
type SchedulerReceipt = Effect.Success<ReturnType<PublishingScheduler["run"]>>;
type SchedulerFailure = Effect.Error<ReturnType<PublishingScheduler["run"]>>;
type LifecycleContractFailure = Extract<
  SchedulerFailure,
  { readonly _tag: "TaskDueCandidateLifecycleContractError" }
>;
type WakePublisher = Parameters<
  TaskSystemWakeSchedulerResolverV1<
    TaskQueueWakePublishError
  >["resolveEffect"]
>[1];
type WakeRequested = Parameters<WakePublisher["publish"]>[0];
type SchedulerRunRequest = Parameters<PublishingScheduler["run"]>[0];
type WakeRetryRequested = Extract<
  WakeRequested["effect"],
  { readonly kind: "wake_retry" }
>;
const throughMs = Brand.nominal<SchedulerReceipt["throughMs"]>()(1_000);
const contractRunId = Brand.nominal<LifecycleContractFailure["runId"]>()(
  "run_00000000-0000-4000-8000-000000000001",
);

class TestLifecycleContractFailure extends Data.TaggedError(
  "TaskDueCandidateLifecycleContractError",
)<{
  readonly dueKind: "start_attempt";
  readonly runId: LifecycleContractFailure["runId"];
  readonly reason: "disposition_outcome_mismatch";
}> {}

describe("DTE05-D Cloudflare Queue wake adapter", () => {
  it("publishes the exact opaque envelope with bounded advisory delay", async () => {
    const sends: Array<Readonly<{
      readonly body: TaskQueueWakeHintEnvelopeV1;
      readonly options: Readonly<{
        readonly contentType: "json";
        readonly delaySeconds?: number;
      }>;
      readonly receiverMatched: boolean;
    }>> = [];
    const queue = {
      send(
        body: TaskQueueWakeHintEnvelopeV1,
        options: Readonly<{
          readonly contentType: "json";
          readonly delaySeconds?: number;
        }>,
      ) {
        sends.push(Object.freeze({
          body,
          options,
          receiverMatched: this === queue,
        }));
        return Promise.resolve({});
      },
    };
    const adapter = makeAdapter({ queue, nowMs: () => 1_000 });
    const publisher = Result.getOrThrow(adapter.makePublisher(PARTITION));

    const requested = {
      sequence: Brand.nominal<WakeRequested["sequence"]>()(2n),
      effect: {
        version: "flarex.task-requested-effect.v1",
        kind: "wake_retry",
        runId: Brand.nominal<WakeRetryRequested["runId"]>()(
          "run_00000000-0000-4000-8000-000000000001",
        ),
        acceptedRunVersion: Brand.nominal<
          WakeRetryRequested["acceptedRunVersion"]
        >()(2n),
        expectedRunVersion: Brand.nominal<
          WakeRetryRequested["expectedRunVersion"]
        >()(2n),
        notBeforeMs: Brand.nominal<WakeRetryRequested["notBeforeMs"]>()(3_001),
      },
    } satisfies WakeRequested;

    await Effect.runPromise(publisher.publish(requested));

    expect(sends).toEqual([{
      body: {
        version: "flarex.task-queue-wake-hint.v1",
        partitionHint: PARTITION,
        dueKind: "start_attempt",
      },
      options: { contentType: "json", delaySeconds: 3 },
      receiverMatched: true,
    }]);
    expect(Object.isFrozen(sends[0]?.body)).toBe(true);
    expect(Object.isFrozen(sends[0]?.options)).toBe(true);
  });

  it("maps host-clock and Queue-send failures without retrying publication", async () => {
    const sendFailure = Object.freeze({ kind: "queue unavailable" });
    let sends = 0;
    const queue = {
      send: () => {
        sends += 1;
        return Promise.reject(sendFailure);
      },
    };
    const requested = wakeRetryRequested(1_000);
    const sendPublisher = Result.getOrThrow(
      makeAdapter({ queue }).makePublisher(PARTITION),
    );

    const observedSendFailure = await Effect.runPromise(
      sendPublisher.publish(requested).pipe(Effect.flip),
    );
    expect(observedSendFailure).toBeInstanceOf(TaskQueueWakePublishError);
    expect(observedSendFailure).toMatchObject({
      operation: "send",
      cause: sendFailure,
    });
    expect(sends).toBe(1);

    const clockPublisher = Result.getOrThrow(
      makeAdapter({ nowMs: () => Number.NaN }).makePublisher(PARTITION),
    );
    const observedClockFailure = await Effect.runPromise(
      clockPublisher.publish(requested).pipe(Effect.flip),
    );
    expect(observedClockFailure).toBeInstanceOf(TaskQueueWakePublishError);
    expect(observedClockFailure).toMatchObject({
      operation: "read_host_clock",
      cause: "invalid_host_clock",
    });
    expect(sends).toBe(1);
  });

  it("acknowledges valid duplicate and reordered hints through fresh scheduler runs", async () => {
    const runs: Array<Readonly<{
      readonly partitionHint: string;
      readonly dueKind: "start_attempt" | "handle_lease_expiry";
    }>> = [];
    const resolver = successfulResolver((partitionHint, dueKind) => {
      runs.push(Object.freeze({ partitionHint, dueKind }));
    });
    const adapter = makeAdapter({ resolver });
    const expiry = message("message-expiry", envelope("handle_lease_expiry"));
    const first = message("message-start-1", envelope("start_attempt"));
    const duplicate = message("message-start-2", envelope("start_attempt"));

    const receipt = await Effect.runPromise(adapter.consumeBatchEffect({
      queue: QUEUE_NAME,
      messages: [expiry.value, first.value, duplicate.value],
    }));

    expect(runs).toEqual([
      { partitionHint: PARTITION, dueKind: "handle_lease_expiry" },
      { partitionHint: PARTITION, dueKind: "start_attempt" },
      { partitionHint: PARTITION, dueKind: "start_attempt" },
    ]);
    expect(expiry.settlements).toEqual([{ operation: "ack" }]);
    expect(first.settlements).toEqual([{ operation: "ack" }]);
    expect(duplicate.settlements).toEqual([{ operation: "ack" }]);
    expect(receipt.messages).toEqual([
      successfulReceipt("message-expiry", "handle_lease_expiry"),
      successfulReceipt("message-start-1", "start_attempt"),
      successfulReceipt("message-start-2", "start_attempt"),
    ]);
    expect(JSON.stringify(receipt)).not.toContain(PARTITION);
  });

  it("acknowledges invalid envelopes without resolving a partition", async () => {
    let resolutions = 0;
    const resolver = successfulResolver(() => {
      resolutions += 1;
    });
    const adapter = makeAdapter({ resolver });
    const invalid = message("message-invalid", {
      ...envelope("start_attempt"),
      runId: "must-not-enter-a-wake-hint",
    });

    const receipt = await Effect.runPromise(adapter.consumeBatchEffect({
      queue: QUEUE_NAME,
      messages: [invalid.value],
    }));

    expect(resolutions).toBe(0);
    expect(invalid.settlements).toEqual([{ operation: "ack" }]);
    expect(receipt.messages).toEqual([{
      messageId: "message-invalid",
      disposition: "acknowledged_invalid",
    }]);
  });

  it("retries only classified pre-transition transient failures and acknowledges terminal or exhausted failures", async () => {
    const transient = new TrustedScopeAuthorityPortError({
      operation: "scopeMetadataRead",
      cause: "transient",
    });
    const terminal = new TrustedScopeAuthorityPortError({
      operation: "scopeMetadataRead",
      cause: "terminal",
    });
    const resolver = failingResolutionResolver((partitionHint) =>
      partitionHint === PARTITION ? transient : terminal
    );
    const adapter = makeAdapter({
      resolver,
      classifyFailure: failure => failure === transient ? "transient" : "terminal",
    });
    const retry = message("message-retry", envelope("start_attempt"), 1);
    const exhausted = message("message-exhausted", envelope("start_attempt"), 3);
    const terminalMessage = message(
      "message-terminal",
      envelope("handle_lease_expiry", "deployment_terminal_queue_wake_v1"),
      1,
    );

    const receipt = await Effect.runPromise(adapter.consumeBatchEffect({
      queue: QUEUE_NAME,
      messages: [retry.value, exhausted.value, terminalMessage.value],
    }));

    expect(retry.settlements).toEqual([{
      operation: "retry",
      options: { delaySeconds: 7 },
    }]);
    expect(exhausted.settlements).toEqual([{ operation: "ack" }]);
    expect(terminalMessage.settlements).toEqual([{ operation: "ack" }]);
    expect(receipt.messages.map(({ disposition }) => disposition)).toEqual([
      "retried_transient",
      "acknowledged_retry_exhausted",
      "acknowledged_terminal_failure",
    ]);
  });

  it("acknowledges post-commit publication loss without retrying the original hint", async () => {
    const publicationFailure = new TaskQueueWakePublishError({
      operation: "send",
      cause: "queue unavailable after commit",
    });
    let classifications = 0;
    const adapter = makeAdapter({
      resolver: failingSchedulerResolver(() => publicationFailure),
      classifyFailure: () => {
        classifications += 1;
        return "transient";
      },
    });
    const originalHint = message(
      "message-publication-lost",
      envelope("start_attempt"),
      1,
    );

    const receipt = await Effect.runPromise(adapter.consumeBatchEffect({
      queue: QUEUE_NAME,
      messages: [originalHint.value],
    }));

    expect(classifications).toBe(0);
    expect(originalHint.settlements).toEqual([{ operation: "ack" }]);
    expect(receipt.messages).toEqual([{
      messageId: "message-publication-lost",
      dueKind: "start_attempt",
      disposition: "acknowledged_publication_lost",
    }]);
  });

  it("acknowledges post-settlement contract failure without invoking retry classification", async () => {
    const contractFailure: LifecycleContractFailure =
      new TestLifecycleContractFailure({
        dueKind: "start_attempt",
        runId: contractRunId,
        reason: "disposition_outcome_mismatch",
      });
    let classifications = 0;
    const adapter = makeAdapter({
      resolver: failingSchedulerResolver(() => contractFailure),
      classifyFailure: () => {
        classifications += 1;
        return "transient";
      },
    });
    const originalHint = message(
      "message-contract-failure",
      envelope("start_attempt"),
      1,
    );

    const receipt = await Effect.runPromise(adapter.consumeBatchEffect({
      queue: QUEUE_NAME,
      messages: [originalHint.value],
    }));

    expect(classifications).toBe(0);
    expect(originalHint.settlements).toEqual([{ operation: "ack" }]);
    expect(receipt.messages).toEqual([{
      messageId: "message-contract-failure",
      dueKind: "start_attempt",
      disposition: "acknowledged_contract_failure",
    }]);
  });

  it("rejects the wrong Queue and oversized batches before message settlement", async () => {
    const adapter = makeAdapter();
    const untouched = message("message-untouched", envelope("start_attempt"));

    const wrongQueue = await Effect.runPromise(
      adapter.consumeBatchEffect({
        queue: "wrong-queue",
        messages: [untouched.value],
      }).pipe(Effect.flip),
    );
    expect(wrongQueue).toBeInstanceOf(TaskQueueWakeBatchContractError);
    expect(wrongQueue).toMatchObject({ reason: "queue_name_mismatch" });
    expect(untouched.settlements).toEqual([]);

    const oversized = Array.from(
      { length: MAX_TASK_QUEUE_WAKE_BATCH_MESSAGES_V1 + 1 },
      (_, index) => message(`message-${index}`, envelope("start_attempt")).value,
    );
    const oversizedFailure = await Effect.runPromise(
      adapter.consumeBatchEffect({ queue: QUEUE_NAME, messages: oversized })
        .pipe(Effect.flip),
    );
    expect(oversizedFailure).toBeInstanceOf(TaskQueueWakeBatchContractError);
    expect(oversizedFailure).toMatchObject({ reason: "batch_size_exceeded" });
  });

  it("preserves Queue settlement callback failures", async () => {
    const callbackFailure = Object.freeze({ kind: "ack exploded" });
    const adapter = makeAdapter();
    const failing = message(
      "message-callback-failure",
      { invalid: true },
      1,
      { ackFailure: callbackFailure },
    );

    const observed = await Effect.runPromise(
      adapter.consumeBatchEffect({
        queue: QUEUE_NAME,
        messages: [failing.value],
      }).pipe(Effect.flip),
    );

    expect(observed).toBeInstanceOf(TaskQueueWakeSettlementError);
    expect(observed).toMatchObject({
      operation: "ack",
      messageId: "message-callback-failure",
      cause: callbackFailure,
    });
  });

  it("fails invalid construction values before capturing a Queue adapter", () => {
    const base = options();
    const invalid = [
      { ...base, queueName: "   " },
      { ...base, maximumDeliveryAttempts: 0 },
      { ...base, maximumDeliveryAttempts: 102 },
      { ...base, retryDelaySeconds: 0 },
      { ...base, retryDelaySeconds: 86_401 },
    ];
    for (const candidate of invalid) {
      const result = makeTaskQueueWakeAdapterV1(candidate);
      Result.match(result, {
        onFailure: failure => expect(failure).toBeInstanceOf(
          InvalidTaskQueueWakeConfigurationError,
        ),
        onSuccess: () => expect.fail("invalid Queue options were accepted"),
      });
    }
  });
});

function makeAdapter(
  overrides: Partial<TaskQueueWakeAdapterOptionsV1> = {},
) {
  return Result.getOrThrow(makeTaskQueueWakeAdapterV1({
    ...options(),
    ...overrides,
  }));
}

function options(): TaskQueueWakeAdapterOptionsV1 {
  return {
    queueName: QUEUE_NAME,
    queue: { send: () => Promise.resolve({}) },
    resolver: successfulResolver(),
    maximumDeliveryAttempts: 3,
    retryDelaySeconds: 7,
    nowMs: () => 1_000,
    classifyFailure: () => "terminal",
  };
}

function successfulResolver(
  observe: (
    partitionHint: string,
    dueKind: "start_attempt" | "handle_lease_expiry",
  ) => void = () => undefined,
): TaskSystemWakeSchedulerResolverV1<TaskQueueWakePublishError> {
  const resolver: TaskSystemWakeSchedulerResolverV1<
    TaskQueueWakePublishError
  > = Object.freeze({
    resolveEffect: (partitionHint: string, _publisher: WakePublisher) => {
      const scheduler: PublishingScheduler = Object.freeze({
        run: (request: SchedulerRunRequest) => {
          observe(partitionHint, request.dueKind);
          return Effect.succeed(Object.freeze({
            version: "flarex.task-wake-scheduler-run-receipt.v1" as const,
            dueKind: request.dueKind,
            throughMs,
            stopReason: "source_exhausted" as const,
            pagesRead: 1,
            candidatesHandled: 2,
            handled: Object.freeze([]),
            continuation: null,
          }));
        },
      });
      return Effect.succeed(scheduler);
    },
  });
  return resolver;
}

function failingSchedulerResolver(
  failure: (
    dueKind: "start_attempt" | "handle_lease_expiry",
  ) => SchedulerFailure,
): TaskSystemWakeSchedulerResolverV1<TaskQueueWakePublishError> {
  const resolver: TaskSystemWakeSchedulerResolverV1<
    TaskQueueWakePublishError
  > = Object.freeze({
    resolveEffect: (_partitionHint: string, _publisher: WakePublisher) =>
      Effect.succeed(Object.freeze({
        run: (request: SchedulerRunRequest) =>
          Effect.fail(failure(request.dueKind)),
      }) satisfies PublishingScheduler),
  });
  return resolver;
}

function failingResolutionResolver(
  failure: (partitionHint: string) => TaskSystemWakeSchedulerResolverErrorV1,
): TaskSystemWakeSchedulerResolverV1<TaskQueueWakePublishError> {
  return Object.freeze({
    resolveEffect: (partitionHint: string, _publisher: WakePublisher) =>
      Effect.fail(failure(partitionHint)),
  });
}

function envelope(
  dueKind: "start_attempt" | "handle_lease_expiry",
  partitionHint = PARTITION,
): TaskQueueWakeHintEnvelopeV1 {
  return Object.freeze({
    version: "flarex.task-queue-wake-hint.v1",
    partitionHint,
    dueKind,
  });
}

function message(
  id: string,
  body: unknown,
  attempts = 1,
  failures: Readonly<{
    readonly ackFailure?: unknown;
    readonly retryFailure?: unknown;
  }> = {},
) {
  const settlements: Array<Readonly<{
    readonly operation: "ack" | "retry";
    readonly options?: Readonly<{ readonly delaySeconds?: number }>;
  }>> = [];
  const value: TaskQueueWakeMessageV1 = {
    id,
    body,
    attempts,
    ack() {
      if (failures.ackFailure !== undefined) throw failures.ackFailure;
      settlements.push(Object.freeze({ operation: "ack" }));
    },
    retry(retryOptions) {
      if (failures.retryFailure !== undefined) throw failures.retryFailure;
      settlements.push(Object.freeze({
        operation: "retry",
        ...(retryOptions === undefined ? {} : { options: retryOptions }),
      }));
    },
  };
  return Object.freeze({ value, settlements });
}

function successfulReceipt(
  messageId: string,
  dueKind: "start_attempt" | "handle_lease_expiry",
) {
  return {
    messageId,
    dueKind,
    disposition: "acknowledged",
    scheduler: {
      stopReason: "source_exhausted",
      pagesRead: 1,
      candidatesHandled: 2,
      hasContinuation: false,
    },
  };
}

function wakeRetryRequested(notBeforeMs: number): WakeRequested {
  return {
    sequence: Brand.nominal<WakeRequested["sequence"]>()(2n),
    effect: {
      version: "flarex.task-requested-effect.v1",
      kind: "wake_retry",
      runId: Brand.nominal<WakeRetryRequested["runId"]>()(
        "run_00000000-0000-4000-8000-000000000001",
      ),
      acceptedRunVersion: Brand.nominal<
        WakeRetryRequested["acceptedRunVersion"]
      >()(2n),
      expectedRunVersion: Brand.nominal<
        WakeRetryRequested["expectedRunVersion"]
      >()(2n),
      notBeforeMs: Brand.nominal<WakeRetryRequested["notBeforeMs"]>()(
        notBeforeMs,
      ),
    },
  };
}
