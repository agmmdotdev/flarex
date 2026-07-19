import { Effect, Result } from "effect";

import {
  PointMutationExecutionClaimAcquisitionInputV1Error,
} from "@flarex/persistence-postgres/transaction-session-activation";

import type {
  PointMutationExecutionClaimAcquisitionResultV1 as PersistenceAcquisitionResultV1,
  PointMutationExecutionClaimAcquisitionV1,
  PointMutationExecutionClaimAcquisitionV1Error,
} from "@flarex/persistence-postgres/transaction-session-activation";

import type {
  PointMutationExecutionClaimV1,
  PointMutationExecutionClaimIssuerV1,
} from "./pointMutationExecutionClaim";
import { decodePointMutationSessionAttemptSelectorV1Result } from
  "./pointMutationSessionAttemptSelector";

export type PointMutationExecutionClaimDispatchAcquisitionResultV1 =
  | Exclude<
      PersistenceAcquisitionResultV1,
      Readonly<{ readonly kind: "acquired" }>
    >
  | Readonly<{
      readonly kind: "acquired";
      readonly mode: "execute" | "finishOnly";
      readonly executionClaim: PointMutationExecutionClaimV1;
    }>;

export interface PointMutationExecutionClaimDispatchAcquisitionV1 {
  readonly acquireEffect: (
    input: unknown,
  ) => Effect.Effect<
    PointMutationExecutionClaimDispatchAcquisitionResultV1,
    PointMutationExecutionClaimAcquisitionV1Error
  >;
}

/**
 * Same-factory projection of a settled Postgres claim acquisition. Structural
 * persistence observations remain inert and never authorize execution.
 */
export function createPointMutationExecutionClaimDispatchAcquisitionV1(
  persistence: PointMutationExecutionClaimAcquisitionV1,
  claims: PointMutationExecutionClaimIssuerV1,
): PointMutationExecutionClaimDispatchAcquisitionV1 {
  const acquireEffect = Effect.fn(
    "PointMutationExecutionClaimDispatchAcquisition.acquire",
  )(function* (input: unknown) {
    const selector = yield* Effect.fromResult(
      decodePointMutationSessionAttemptSelectorV1Result(input).pipe(
        Result.mapError((cause) =>
          new PointMutationExecutionClaimAcquisitionInputV1Error({
            reason: "invalidSelector",
            cause,
          })
        ),
      ),
    );
    const result = yield* persistence.acquireEffect(selector);
    if (result.kind !== "acquired") return result;
    const executionClaim = claims.mint({
      selector,
      observation: Object.freeze({ ...result.observation }),
      mode: result.mode,
    });
    return Object.freeze({
      kind: "acquired" as const,
      mode: result.mode,
      executionClaim,
    });
  });
  return Object.freeze({ acquireEffect });
}
