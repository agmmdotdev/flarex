import type {
  TaskSystemWakePublishingSchedulerPartitionV1,
  TaskSystemWakeSchedulerResolverErrorV1,
  TaskSystemWakeSchedulerResolverV1,
} from "@flarex/persistence-postgres/internal/task-wake-scheduler-resolver-v1";
import { isNonBlankString } from "@flarex/utils/strings";
import { Data, Effect, Result, Schema } from "effect";

export const MAX_TASK_QUEUE_WAKE_BATCH_MESSAGES_V1 = 100;
export const MAX_TASK_QUEUE_WAKE_DELIVERY_ATTEMPTS_V1 = 101;
export const MAX_TASK_QUEUE_WAKE_DELAY_SECONDS_V1 = 86_400;
export const MAX_TASK_QUEUE_WAKE_PARTITION_HINT_BYTES_V1 = 512;

export type TaskQueueWakeDueKindV1 =
  | "start_attempt"
  | "handle_lease_expiry";

export interface TaskQueueWakeHintEnvelopeV1 {
  readonly version: "flarex.task-queue-wake-hint.v1";
  readonly partitionHint: string;
  readonly dueKind: TaskQueueWakeDueKindV1;
}

export interface TaskQueueWakeProducerBindingV1 {
  readonly send: (
    body: TaskQueueWakeHintEnvelopeV1,
    options: Readonly<{
      readonly contentType: "json";
      readonly delaySeconds?: number;
    }>,
  ) => PromiseLike<unknown>;
}

export interface TaskQueueWakeMessageV1 {
  readonly id: string;
  readonly body: unknown;
  readonly attempts: number;
  readonly ack: () => void;
  readonly retry: (options?: Readonly<{ readonly delaySeconds?: number }>) => void;
}

export interface TaskQueueWakeMessageBatchV1 {
  readonly queue: string;
  readonly messages: readonly TaskQueueWakeMessageV1[];
}

export class InvalidTaskQueueWakeConfigurationError extends Data.TaggedError(
  "InvalidTaskQueueWakeConfigurationError",
)<{
  readonly reason:
    | "invalid_queue_name"
    | "invalid_maximum_delivery_attempts"
    | "invalid_retry_delay_seconds";
}> {}

export class InvalidTaskQueueWakePartitionHintError extends Data.TaggedError(
  "InvalidTaskQueueWakePartitionHintError",
)<{
  readonly reason: "invalid_partition_hint";
}> {}

export class TaskQueueWakePublishError extends Data.TaggedError(
  "TaskQueueWakePublishError",
)<{
  readonly operation: "read_host_clock" | "send";
  readonly cause: unknown;
}> {}

export class TaskQueueWakeBatchContractError extends Data.TaggedError(
  "TaskQueueWakeBatchContractError",
)<{
  readonly reason:
    | "queue_name_mismatch"
    | "batch_size_exceeded"
    | "message_id_invalid"
    | "message_attempts_invalid";
}> {}

export class TaskQueueWakeSettlementError extends Data.TaggedError(
  "TaskQueueWakeSettlementError",
)<{
  readonly operation: "ack" | "retry";
  readonly messageId: string;
  readonly cause: unknown;
}> {}

export type TaskQueueWakeFailureClassificationV1 = "transient" | "terminal";

type SchedulerRunFailureV1 = Effect.Error<
  ReturnType<
    TaskSystemWakePublishingSchedulerPartitionV1<
      TaskQueueWakePublishError
    >["run"]
  >
>;

export type TaskQueueWakeHandledFailureV1 =
  | TaskSystemWakeSchedulerResolverErrorV1
  | SchedulerRunFailureV1;

type TaskQueueWakePostSettlementContractFailureV1 = Extract<
  TaskQueueWakeHandledFailureV1,
  {
    readonly _tag:
      | "TaskDueCandidateLifecycleContractError"
      | "TaskWakeSchedulerHandlerContractError";
  }
>;

export type TaskQueueWakeRetryClassifiableFailureV1 = Exclude<
  TaskQueueWakeHandledFailureV1,
  TaskQueueWakePublishError | TaskQueueWakePostSettlementContractFailureV1
>;

export interface TaskQueueWakeAdapterOptionsV1 {
  readonly queueName: string;
  readonly queue: TaskQueueWakeProducerBindingV1;
  readonly resolver: TaskSystemWakeSchedulerResolverV1<
    TaskQueueWakePublishError
  >;
  readonly maximumDeliveryAttempts: number;
  readonly retryDelaySeconds: number;
  readonly nowMs: () => number;
  readonly classifyFailure: (
    failure: TaskQueueWakeRetryClassifiableFailureV1,
  ) => TaskQueueWakeFailureClassificationV1;
}

export interface TaskQueueWakeSchedulerSummaryV1 {
  readonly stopReason: "source_exhausted" | "page_budget" | "candidate_budget";
  readonly pagesRead: number;
  readonly candidatesHandled: number;
  readonly hasContinuation: boolean;
}

export type TaskQueueWakeMessageReceiptV1 =
  | {
      readonly messageId: string;
      readonly disposition: "acknowledged_invalid";
    }
  | {
      readonly messageId: string;
      readonly dueKind: TaskQueueWakeDueKindV1;
      readonly disposition: "acknowledged";
      readonly scheduler: TaskQueueWakeSchedulerSummaryV1;
    }
  | {
      readonly messageId: string;
      readonly dueKind: TaskQueueWakeDueKindV1;
      readonly disposition:
        | "retried_transient"
        | "acknowledged_publication_lost"
        | "acknowledged_contract_failure"
        | "acknowledged_terminal_failure"
        | "acknowledged_retry_exhausted";
    };

export interface TaskQueueWakeBatchReceiptV1 {
  readonly version: "flarex.task-queue-wake-batch-receipt.v1";
  readonly messages: readonly TaskQueueWakeMessageReceiptV1[];
}

type TaskQueueWakePublisherV1 = Parameters<
  TaskSystemWakeSchedulerResolverV1<TaskQueueWakePublishError>["resolveEffect"]
>[1];

export interface TaskQueueWakeAdapterV1 {
  readonly makePublisher: (
    partitionHint: unknown,
  ) => Result.Result<
    TaskQueueWakePublisherV1,
    InvalidTaskQueueWakePartitionHintError
  >;
  readonly consumeBatchEffect: (
    batch: TaskQueueWakeMessageBatchV1,
  ) => Effect.Effect<
    TaskQueueWakeBatchReceiptV1,
    TaskQueueWakeBatchContractError | TaskQueueWakeSettlementError
  >;
}

interface CapturedTaskQueueWakeOptionsV1 {
  readonly queueName: string;
  readonly maximumDeliveryAttempts: number;
  readonly retryDelaySeconds: number;
}

interface CapturedTaskQueueWakeMessageV1 {
  readonly id: string;
  readonly body: unknown;
  readonly attempts: number;
  readonly ack: () => void;
  readonly retry: (
    options?: Readonly<{ readonly delaySeconds?: number }>,
  ) => void;
}

const TaskQueueWakeHintEnvelopeSchema = Schema.Struct({
  version: Schema.Literal("flarex.task-queue-wake-hint.v1"),
  partitionHint: Schema.String,
  dueKind: Schema.Literals(["start_attempt", "handle_lease_expiry"]),
});
const decodeTaskQueueWakeHintEnvelopeResult = Schema.decodeUnknownResult(
  TaskQueueWakeHintEnvelopeSchema,
  { onExcessProperty: "error" },
);
const utf8Encoder = new TextEncoder();

export function makeTaskQueueWakeAdapterV1(
  options: TaskQueueWakeAdapterOptionsV1,
): Result.Result<TaskQueueWakeAdapterV1, InvalidTaskQueueWakeConfigurationError> {
  return Result.map(captureOptions(options), (captured) => {
    const queueOwner = options.queue;
    const send = queueOwner.send;
    const resolverOwner = options.resolver;
    const resolveEffect = resolverOwner.resolveEffect;
    const optionsOwner = options;
    const nowMsMethod = optionsOwner.nowMs;
    const classifyFailureMethod = optionsOwner.classifyFailure;
    const nowMs = () => nowMsMethod.call(optionsOwner);
    const classifyFailure = (
      failure: TaskQueueWakeRetryClassifiableFailureV1,
    ) =>
      classifyFailureMethod.call(optionsOwner, failure);

    const makeCapturedPublisher = (
      capturedPartitionHint: string,
    ): TaskQueueWakePublisherV1 => {
      const publish: TaskQueueWakePublisherV1["publish"] = Effect.fn(
        "TaskQueueWakePublisher.publish",
      )(function* (requested) {
        const currentMs = yield* Effect.try({
          try: nowMs,
          catch: (cause) => new TaskQueueWakePublishError({
            operation: "read_host_clock",
            cause,
          }),
        });
        if (!Number.isSafeInteger(currentMs) || currentMs < 0) {
          return yield* Effect.fail(new TaskQueueWakePublishError({
            operation: "read_host_clock",
            cause: "invalid_host_clock",
          }));
        }
        const delaySeconds = queueDelaySeconds(
          requested.effect.notBeforeMs,
          currentMs,
        );
        const envelope = Object.freeze({
          version: "flarex.task-queue-wake-hint.v1" as const,
          partitionHint: capturedPartitionHint,
          dueKind: requested.effect.kind === "wake_retry"
            ? "start_attempt" as const
            : "handle_lease_expiry" as const,
        });
        yield* Effect.tryPromise({
          try: () => send.call(queueOwner, envelope, Object.freeze({
            contentType: "json" as const,
            ...(delaySeconds === 0 ? {} : { delaySeconds }),
          })),
          catch: (cause) => new TaskQueueWakePublishError({
            operation: "send",
            cause,
          }),
        });
      });
      return Object.freeze({ publish });
    };
    const makePublisher: TaskQueueWakeAdapterV1["makePublisher"] = (
      partitionHint,
    ) => capturePartitionHint(partitionHint).pipe(
      Result.map(makeCapturedPublisher),
    );

    const consumeBatchEffect: TaskQueueWakeAdapterV1["consumeBatchEffect"] =
      Effect.fn("TaskQueueWakeConsumer.consumeBatch")(function* (batch) {
        const messages = yield* Effect.fromResult(captureBatch(batch, captured));
        const receipts: TaskQueueWakeMessageReceiptV1[] = [];
        for (const message of messages) {
          const decoded = Result.match(captureEnvelope(message.body), {
            onFailure: () => Object.freeze({ kind: "invalid" as const }),
            onSuccess: (envelope) => Object.freeze({
              kind: "valid" as const,
              envelope,
            }),
          });
          if (decoded.kind === "invalid") {
            yield* settleMessage(message, "ack");
            receipts.push(Object.freeze({
              messageId: message.id,
              disposition: "acknowledged_invalid" as const,
            }));
            continue;
          }
          const envelope = decoded.envelope;
          const publisher = makeCapturedPublisher(envelope.partitionHint);
          const run = Effect.gen(function* () {
            const scheduler = yield* resolveEffect.call(
              resolverOwner,
              envelope.partitionHint,
              publisher,
            );
            return yield* scheduler.run({
              dueKind: envelope.dueKind,
              cursor: null,
            });
          });
          const receipt = yield* run.pipe(Effect.matchEffect({
            onFailure: (failure) => settleFailure(
              message,
              envelope.dueKind,
              failure,
              captured,
              classifyFailure,
            ),
            onSuccess: (scheduler) => settleSuccess(
              message,
              envelope.dueKind,
              scheduler,
            ),
          }));
          receipts.push(receipt);
        }
        return Object.freeze({
          version: "flarex.task-queue-wake-batch-receipt.v1" as const,
          messages: Object.freeze(receipts),
        });
      });

    return Object.freeze({ makePublisher, consumeBatchEffect });
  });
}

function captureOptions(
  options: TaskQueueWakeAdapterOptionsV1,
): Result.Result<
  CapturedTaskQueueWakeOptionsV1,
  InvalidTaskQueueWakeConfigurationError
> {
  const queueName = options.queueName;
  const maximumDeliveryAttempts = options.maximumDeliveryAttempts;
  const retryDelaySeconds = options.retryDelaySeconds;
  if (!isNonBlankString(queueName)) {
    return Result.fail(new InvalidTaskQueueWakeConfigurationError({
      reason: "invalid_queue_name",
    }));
  }
  if (
    !Number.isSafeInteger(maximumDeliveryAttempts)
    || maximumDeliveryAttempts < 1
    || maximumDeliveryAttempts >
      MAX_TASK_QUEUE_WAKE_DELIVERY_ATTEMPTS_V1
  ) {
    return Result.fail(new InvalidTaskQueueWakeConfigurationError({
      reason: "invalid_maximum_delivery_attempts",
    }));
  }
  if (
    !Number.isSafeInteger(retryDelaySeconds)
    || retryDelaySeconds < 1
    || retryDelaySeconds > MAX_TASK_QUEUE_WAKE_DELAY_SECONDS_V1
  ) {
    return Result.fail(new InvalidTaskQueueWakeConfigurationError({
      reason: "invalid_retry_delay_seconds",
    }));
  }
  return Result.succeed(Object.freeze({
    queueName,
    maximumDeliveryAttempts,
    retryDelaySeconds,
  }));
}

function capturePartitionHint(
  value: unknown,
): Result.Result<string, InvalidTaskQueueWakePartitionHintError> {
  return isNonBlankString(value)
      && utf8Encoder.encode(value).byteLength <=
        MAX_TASK_QUEUE_WAKE_PARTITION_HINT_BYTES_V1
    ? Result.succeed(value)
    : Result.fail(new InvalidTaskQueueWakePartitionHintError({
      reason: "invalid_partition_hint",
    }));
}

function captureEnvelope(
  value: unknown,
): Result.Result<TaskQueueWakeHintEnvelopeV1, void> {
  return decodeTaskQueueWakeHintEnvelopeResult(value).pipe(
    Result.mapError(() => undefined),
    Result.flatMap((decoded) => capturePartitionHint(decoded.partitionHint).pipe(
      Result.mapError(() => undefined),
      Result.map((partitionHint) => Object.freeze({
        version: decoded.version,
        partitionHint,
        dueKind: decoded.dueKind,
      })),
    )),
  );
}

function captureBatch(
  batch: TaskQueueWakeMessageBatchV1,
  options: CapturedTaskQueueWakeOptionsV1,
): Result.Result<
  readonly CapturedTaskQueueWakeMessageV1[],
  TaskQueueWakeBatchContractError
> {
  return Result.gen(function* () {
    const queueName = batch.queue;
    if (queueName !== options.queueName) {
      return yield* Result.fail(new TaskQueueWakeBatchContractError({
        reason: "queue_name_mismatch",
      }));
    }
    const suppliedMessages = batch.messages;
    if (suppliedMessages.length > MAX_TASK_QUEUE_WAKE_BATCH_MESSAGES_V1) {
      return yield* Result.fail(new TaskQueueWakeBatchContractError({
        reason: "batch_size_exceeded",
      }));
    }
    const messages: CapturedTaskQueueWakeMessageV1[] = [];
    for (const message of suppliedMessages) {
      const messageId = message.id;
      if (!isNonBlankString(messageId)) {
        return yield* Result.fail(new TaskQueueWakeBatchContractError({
          reason: "message_id_invalid",
        }));
      }
      const attempts = message.attempts;
      if (!Number.isSafeInteger(attempts) || attempts < 1) {
        return yield* Result.fail(new TaskQueueWakeBatchContractError({
          reason: "message_attempts_invalid",
        }));
      }
      const body = message.body;
      const messageOwner = message;
      const ack = messageOwner.ack;
      const retry = messageOwner.retry;
      messages.push(Object.freeze({
        id: messageId,
        body,
        attempts,
        ack: () => ack.call(messageOwner),
        retry: (retryOptions) => retry.call(messageOwner, retryOptions),
      }));
    }
    return Object.freeze(messages);
  });
}

function queueDelaySeconds(notBeforeMs: number, currentMs: number): number {
  return Math.min(
    MAX_TASK_QUEUE_WAKE_DELAY_SECONDS_V1,
    Math.max(0, Math.ceil((notBeforeMs - currentMs) / 1_000)),
  );
}

function settleSuccess(
  message: CapturedTaskQueueWakeMessageV1,
  dueKind: TaskQueueWakeDueKindV1,
  scheduler: Effect.Success<
    ReturnType<
      TaskSystemWakePublishingSchedulerPartitionV1<
        TaskQueueWakePublishError
      >["run"]
    >
  >,
): Effect.Effect<TaskQueueWakeMessageReceiptV1, TaskQueueWakeSettlementError> {
  return settleMessage(message, "ack").pipe(
    Effect.map(() => Object.freeze({
      messageId: message.id,
      dueKind,
      disposition: "acknowledged" as const,
      scheduler: Object.freeze({
        stopReason: scheduler.stopReason,
        pagesRead: scheduler.pagesRead,
        candidatesHandled: scheduler.candidatesHandled,
        hasContinuation: scheduler.continuation !== null,
      }),
    })),
  );
}

function settleFailure(
  message: CapturedTaskQueueWakeMessageV1,
  dueKind: TaskQueueWakeDueKindV1,
  failure: TaskQueueWakeHandledFailureV1,
  options: CapturedTaskQueueWakeOptionsV1,
  classifyFailure: TaskQueueWakeAdapterOptionsV1["classifyFailure"],
): Effect.Effect<TaskQueueWakeMessageReceiptV1, TaskQueueWakeSettlementError> {
  if (failure instanceof TaskQueueWakePublishError) {
    return settleMessage(message, "ack").pipe(
      Effect.map(() => Object.freeze({
        messageId: message.id,
        dueKind,
        disposition: "acknowledged_publication_lost" as const,
      })),
    );
  }
  if (isPostSettlementContractFailure(failure)) {
    return settleMessage(message, "ack").pipe(
      Effect.map(() => Object.freeze({
        messageId: message.id,
        dueKind,
        disposition: "acknowledged_contract_failure" as const,
      })),
    );
  }
  const classification = classifyFailure(failure);
  if (
    classification === "transient"
    && message.attempts < options.maximumDeliveryAttempts
  ) {
    return settleMessage(
      message,
      "retry",
      options.retryDelaySeconds,
    ).pipe(
      Effect.map(() => Object.freeze({
        messageId: message.id,
        dueKind,
        disposition: "retried_transient" as const,
      })),
    );
  }
  return settleMessage(message, "ack").pipe(
    Effect.map(() => Object.freeze({
      messageId: message.id,
      dueKind,
      disposition: classification === "transient"
        ? "acknowledged_retry_exhausted" as const
        : "acknowledged_terminal_failure" as const,
    })),
  );
}

function isPostSettlementContractFailure(
  failure: TaskQueueWakeHandledFailureV1,
): failure is TaskQueueWakePostSettlementContractFailureV1 {
  return failure._tag === "TaskDueCandidateLifecycleContractError"
    || failure._tag === "TaskWakeSchedulerHandlerContractError";
}

function settleMessage(
  message: CapturedTaskQueueWakeMessageV1,
  operation: "ack" | "retry",
  retryDelaySeconds?: number,
): Effect.Effect<void, TaskQueueWakeSettlementError> {
  return Effect.try({
    try: () => {
      if (operation === "ack") message.ack();
      else message.retry(
        retryDelaySeconds === undefined
          ? undefined
          : Object.freeze({ delaySeconds: retryDelaySeconds }),
      );
    },
    catch: (cause) => new TaskQueueWakeSettlementError({
      operation,
      messageId: message.id,
      cause,
    }),
  });
}
