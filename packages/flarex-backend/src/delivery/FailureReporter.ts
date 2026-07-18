import { Clock, Data, Effect } from "effect";

export type DeliveryFailureReportStage = "fanout" | "ack";

export interface DeliveryFailureReportInput {
  readonly deploymentId: string;
  readonly deliveries: ReadonlyArray<{ readonly deliveryId: string }>;
  readonly claimOwner: string;
  readonly stage: DeliveryFailureReportStage;
  readonly error: unknown;
}

export type DeliveryFailureReportFetch = (
  path: string,
  body: unknown,
) => Promise<Response>;

class DeliveryFailureReportRequestError extends Data.TaggedError(
  "DeliveryFailureReportRequestError",
)<{
  readonly cause: unknown;
}> {}

export const reportDeliveryFailureEffect = Effect.fn(
  "DeliveryFailureReporter.report",
)(
  function* (
    fetchJson: DeliveryFailureReportFetch,
    input: DeliveryFailureReportInput,
  ): Effect.fn.Return<void> {
    const currentTimeMillis = yield* Clock.currentTimeMillis;
    return yield* Effect.tryPromise({
      try: () =>
        fetchJson("/maintenance/live-queries/failure", {
          deploymentId: input.deploymentId,
          deliveryIds: input.deliveries.map(delivery => delivery.deliveryId),
          claimOwner: input.claimOwner,
          stage: input.stage,
          error: deliveryFailureMessage(input.error),
          failedAt: new Date(currentTimeMillis).toISOString(),
        }),
      catch: cause => new DeliveryFailureReportRequestError({ cause }),
    }).pipe(
      Effect.flatMap(response =>
        response.ok
          ? Effect.void
          : Effect.logError(
              `Live query delivery failure report failed with status ${response.status}.`,
            )
      ),
      Effect.catchTag("DeliveryFailureReportRequestError", reportError =>
        Effect.logError(
          "Live query delivery failure report failed.",
          reportError.cause,
        )
      ),
    );
  },
);

export function deliveryFailureMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
