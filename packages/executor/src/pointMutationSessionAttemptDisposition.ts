import type {
  PointMutationSessionAttemptSelectorV1,
  PointMutationSessionAttemptTerminalizationEffectErrorV1,
  PointMutationSessionAttemptTerminalizationPersistenceV1,
} from "@flarex/persistence-postgres/transaction-session-activation";
import { Effect, Result } from "effect";

import {
  InvalidLoadedPointMutationSessionAttemptV1Error,
  type LoadedPointMutationSessionAttemptV1,
} from "./pointMutationSessionActivation";
import {
  getLoadedPointMutationSessionAttemptOccRerunInspectionV1,
  type LoadedPointMutationSessionAttemptOccRerunInspectionV1,
} from "./pointMutationSessionAttemptState";
import {
  InvalidPointMutationExecutionClaimV1Error,
  type PointMutationAbortOnlyClaimAdmissionV1,
  type PointMutationAbortOnlyScopeV1,
} from "./pointMutationExecutionClaim";
import {
  capturePointMutationSessionAttemptTerminalizationResultV1,
  PointMutationSessionAttemptTerminalizationContractV1Error,
} from "./pointMutationSessionAttemptTerminalizationContract";

export class PointMutationSessionAttemptDispositionStateV1Error extends Error {
  readonly _tag = "PointMutationSessionAttemptDispositionStateV1Error" as const;
  readonly name = "PointMutationSessionAttemptDispositionStateV1Error";

  constructor(readonly reason: "attemptFacetMismatch") {
    super(`Abort-only disposition authority is stale: ${reason}.`);
  }
}

export type PointMutationSessionAttemptDispositionResultV1 = Readonly<{
  readonly status: "terminalized" | "observed";
  readonly terminal: Readonly<{
    readonly deploymentId: PointMutationSessionAttemptSelectorV1["deploymentId"];
    readonly scopeId: PointMutationSessionAttemptSelectorV1["scopeId"];
    readonly sessionId: PointMutationSessionAttemptSelectorV1["sessionId"];
    readonly attemptFence: PointMutationSessionAttemptSelectorV1["attemptFence"];
    readonly lifecycle: "aborted" | "expired";
    readonly terminalizedAt: string;
  }>;
}>;

export type PointMutationSessionAttemptDispositionExecutionV1Error =
  | InvalidLoadedPointMutationSessionAttemptV1Error
  | InvalidPointMutationExecutionClaimV1Error
  | PointMutationSessionAttemptTerminalizationEffectErrorV1
  | PointMutationSessionAttemptDispositionStateV1Error
  | PointMutationSessionAttemptTerminalizationContractV1Error;

export interface PointMutationSessionAttemptDispositionV1 {
  readonly disposeAbortOnly: (
    attempt: LoadedPointMutationSessionAttemptV1,
    executionClaim: PointMutationAbortOnlyScopeV1,
  ) => Effect.Effect<
    PointMutationSessionAttemptDispositionResultV1,
    PointMutationSessionAttemptDispositionExecutionV1Error
  >;
}

export function createPointMutationSessionAttemptDispositionV1(
  persistence: Pick<
    PointMutationSessionAttemptTerminalizationPersistenceV1,
    "abortEffect"
  >,
  executionClaims: PointMutationAbortOnlyClaimAdmissionV1,
): PointMutationSessionAttemptDispositionV1 {
  const disposeAbortOnly: PointMutationSessionAttemptDispositionV1["disposeAbortOnly"] =
    Effect.fn(
      "ExecutorPointMutationSessionDisposition.disposeAbortOnly",
    )(function* (attempt, executionClaim) {
      const inspection = yield* Effect.fromResult(
        inspectLoadedPointMutationSessionAttemptForDispositionResultV1(attempt),
      );
      const claim = yield* Effect.fromResult(
        executionClaims.inspect(executionClaim),
      );
      if (!loadedAttemptMatchesClaimSelector(inspection, claim.selector)) {
        return yield* Effect.fail(
          new InvalidPointMutationExecutionClaimV1Error({
            reason: "notSameFactory",
          }),
        );
      }
      if (inspection.attemptFacet.kind !== "nonPristine") {
        return yield* Effect.fail(
          new PointMutationSessionAttemptDispositionStateV1Error(
            "attemptFacetMismatch",
          ),
        );
      }
      return yield* Effect.uninterruptible(Effect.gen(function* () {
        const result = yield* persistence.abortEffect({
          selector: inspection.selector,
          expectedSnapshotToken: inspection.snapshotToken,
          executionClaim: Object.freeze({
            claimOwner: claim.observation.claimOwner,
            claimFence: claim.observation.claimFence,
          }),
        });
        const captured = yield* Effect.fromResult(
          capturePointMutationSessionAttemptTerminalizationResultV1(
            inspection.selector,
            result,
          ),
        );
        if (captured.terminal.lifecycle === "committed") {
          return yield* Effect.fail(
            new PointMutationSessionAttemptTerminalizationContractV1Error({
              reason: "invalidStatusOrLifecycle",
            }),
          );
        }
        yield* Effect.fromResult(executionClaims.consume(executionClaim));
        return Object.freeze({
          status: captured.status,
          terminal: Object.freeze({
            ...captured.terminal,
            lifecycle: captured.terminal.lifecycle,
          }),
        });
      }));
    });

  return Object.freeze({ disposeAbortOnly });
}

function inspectLoadedPointMutationSessionAttemptForDispositionResultV1(
  value: unknown,
): Result.Result<
  LoadedPointMutationSessionAttemptOccRerunInspectionV1,
  InvalidLoadedPointMutationSessionAttemptV1Error
> {
  if (typeof value !== "object" || value === null) {
    return Result.fail(new InvalidLoadedPointMutationSessionAttemptV1Error());
  }
  const inspection =
    getLoadedPointMutationSessionAttemptOccRerunInspectionV1(value);
  return inspection === undefined
    ? Result.fail(new InvalidLoadedPointMutationSessionAttemptV1Error())
    : Result.succeed(inspection);
}

function loadedAttemptMatchesClaimSelector(
  inspection: LoadedPointMutationSessionAttemptOccRerunInspectionV1,
  selector: PointMutationSessionAttemptSelectorV1,
): boolean {
  return selector.deploymentId === inspection.selector.deploymentId &&
    selector.scopeId === inspection.selector.scopeId &&
    selector.sessionId === inspection.selector.sessionId &&
    selector.attemptFence === inspection.selector.attemptFence;
}
