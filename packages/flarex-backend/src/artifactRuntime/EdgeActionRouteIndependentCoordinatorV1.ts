import { Data, Effect } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import {
  decodeEdgeActionExactRuntimeResultV1Effect,
  type EdgeActionExactRuntimeResultV1,
} from "flarex-protocol/edge-action-exact-runtime";

export type EdgeActionExactRuntimeArtifactHostFailureReasonV1 =
  | "authorityFailed"
  | "invalidRequest"
  | "workerLoadFailed"
  | "callbackFailed"
  | "userCodeFailed"
  | "invalidResult"
  | "timedOut"
  | "cancelled"
  | "cleanupUncertain";

export type EdgeActionExactRuntimeArtifactHostResultV1 =
  | Readonly<{
      readonly kind: "success";
      readonly result: EdgeActionExactRuntimeResultV1;
    }>
  | Readonly<{
      readonly kind: "failure";
      readonly reason: EdgeActionExactRuntimeArtifactHostFailureReasonV1;
    }>;

export interface EdgeActionRouteIndependentArtifactHostV1 {
  readonly run: (
    input: unknown,
    options: Readonly<{ readonly signal: AbortSignal }>,
  ) => PromiseLike<unknown>;
}

export interface EdgeActionRouteIndependentCoordinatorV1 {
  readonly dispatch: (
    input: unknown,
  ) => Effect.Effect<
    EdgeActionExactRuntimeArtifactHostResultV1,
    EdgeActionRouteIndependentCoordinatorV1Error
  >;
}

export class EdgeActionRouteIndependentCoordinatorV1Error
  extends Data.TaggedError("EdgeActionRouteIndependentCoordinatorV1Error")<{
    readonly reason: "invalidHostResult";
  }> {}

const FAILURE_REASONS = new Set<
  EdgeActionExactRuntimeArtifactHostFailureReasonV1
>([
  "authorityFailed",
  "invalidRequest",
  "workerLoadFailed",
  "callbackFailed",
  "userCodeFailed",
  "invalidResult",
  "timedOut",
  "cancelled",
  "cleanupUncertain",
]);

/**
 * Private host-neutral SAP07 adapter. Host rejections remain defects; only an
 * invalid returned host envelope is admitted to the typed integration channel.
 */
export function makeEdgeActionRouteIndependentCoordinatorV1(
  host: EdgeActionRouteIndependentArtifactHostV1,
): EdgeActionRouteIndependentCoordinatorV1 {
  const dispatch: EdgeActionRouteIndependentCoordinatorV1["dispatch"] =
    Effect.fn("EdgeActionRouteIndependentCoordinator.dispatch")(function* (
      input,
    ) {
      const raw = yield* Effect.promise(signal =>
        Promise.resolve(host.run(input, Object.freeze({ signal })))
      );
      return yield* decodeHostResult(raw);
    });
  return Object.freeze({ dispatch });
}

const decodeHostResult = Effect.fn(
  "EdgeActionRouteIndependentCoordinator.decodeHostResult",
)(function* (
  input: unknown,
): Effect.fn.Return<
  EdgeActionExactRuntimeArtifactHostResultV1,
  EdgeActionRouteIndependentCoordinatorV1Error
> {
  if (!isNonArrayRecord(input)) return yield* invalidHostResult();
  const keys = Reflect.ownKeys(input);
  const kind = Object.getOwnPropertyDescriptor(input, "kind");
  if (
    kind !== undefined && "value" in kind && kind.value === "success" &&
    keys.length === 2
  ) {
    const resultProperty = Object.getOwnPropertyDescriptor(input, "result");
    if (resultProperty === undefined || !("value" in resultProperty)) {
      return yield* invalidHostResult();
    }
    const result = yield* decodeEdgeActionExactRuntimeResultV1Effect(
      resultProperty.value,
    ).pipe(Effect.mapError(() =>
      new EdgeActionRouteIndependentCoordinatorV1Error({
        reason: "invalidHostResult",
      })
    ));
    return Object.freeze({ kind: "success" as const, result });
  }
  const reasonProperty = Object.getOwnPropertyDescriptor(input, "reason");
  if (
    kind !== undefined && "value" in kind && kind.value === "failure" &&
    keys.length === 2 && reasonProperty !== undefined &&
    "value" in reasonProperty &&
    FAILURE_REASONS.has(
      reasonProperty.value as EdgeActionExactRuntimeArtifactHostFailureReasonV1,
    )
  ) {
    return Object.freeze({
      kind: "failure" as const,
      reason: reasonProperty.value as
        EdgeActionExactRuntimeArtifactHostFailureReasonV1,
    });
  }
  return yield* invalidHostResult();
});

function invalidHostResult(): Effect.Effect<
  never,
  EdgeActionRouteIndependentCoordinatorV1Error
> {
  return Effect.fail(new EdgeActionRouteIndependentCoordinatorV1Error({
    reason: "invalidHostResult",
  }));
}
