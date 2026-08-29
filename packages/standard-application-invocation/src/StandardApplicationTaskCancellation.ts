import {
  makeApplicationRunAttemptLifecycleV1,
  type ApplicationRequestCancellationOutcomeV1,
  type ApplicationTaskSystemRunAttemptStoreShape,
  type ApplicationTaskSystemRunAttemptTransactionReceiptV1,
  type RunAttemptLifecycleErrorV1,
  type TaskCancellationReasonV1,
  type TaskRunIdV1,
} from "@flarex/durable-task/internal/run-attempt-v1";
import { Context, Effect, Layer } from "effect";

export type StandardApplicationTaskCancellationReceipt =
  ApplicationTaskSystemRunAttemptTransactionReceiptV1<
    ApplicationRequestCancellationOutcomeV1
  >;
export type StandardApplicationTaskCancellationError =
  RunAttemptLifecycleErrorV1;

export interface StandardApplicationTaskCancellationApi {
  readonly request: (
    runId: TaskRunIdV1,
    reason: TaskCancellationReasonV1,
  ) => Effect.Effect<
    StandardApplicationTaskCancellationReceipt,
    StandardApplicationTaskCancellationError
  >;
}

export class StandardApplicationTaskCancellation extends Context.Service<
  StandardApplicationTaskCancellation,
  StandardApplicationTaskCancellationApi
>()(
  "flarex/standard-application-invocation/StandardApplicationTaskCancellation",
) {}

export const requestStandardApplicationTaskCancellation = Effect.fn(
  "StandardApplicationTaskCancellation.request",
)(function* (
  runId: TaskRunIdV1,
  reason: TaskCancellationReasonV1,
): Effect.fn.Return<
  StandardApplicationTaskCancellationReceipt,
  StandardApplicationTaskCancellationError,
  StandardApplicationTaskCancellation
> {
  const cancellation = yield* StandardApplicationTaskCancellation;
  return yield* cancellation.request(runId, reason);
});

export function makeStandardApplicationTaskCancellationLayer(
  store: ApplicationTaskSystemRunAttemptStoreShape,
): Layer.Layer<StandardApplicationTaskCancellation> {
  const lifecycle = makeApplicationRunAttemptLifecycleV1(store);
  const request: StandardApplicationTaskCancellationApi["request"] = Effect.fn(
    "StandardApplicationTaskCancellation.requestLive",
  )((runId, reason) => lifecycle.requestCancellation({
    type: "request_cancellation",
    runId,
    reason,
  }));

  return Layer.succeed(
    StandardApplicationTaskCancellation,
    StandardApplicationTaskCancellation.of({ request }),
  );
}
