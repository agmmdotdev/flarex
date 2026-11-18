import { Cause } from "effect";
import { expect } from "vitest";
import {
  PointMutationSessionAttemptTerminalizationV1Error,
} from "@flarex/persistence-postgres/internal/session";
import {
  PointMutationExecutionClaimLivenessStaleV1Error,
} from "@flarex/persistence-postgres/internal/transaction-execution-claim-errors";

export async function expectExpiredMixedOwnerCleanup(
  close: () => Promise<void>,
  expectedTerminalizationReason: "executionClaimUnavailable" | "staleAttemptFence" = "executionClaimUnavailable",
): Promise<void> {
  const failure: unknown = await close().then(() => undefined, (cause: unknown) => cause);
  expect(failure).toBeInstanceOf(AggregateError);
  if (!(failure instanceof AggregateError)) throw new Error("Expected outer mixed fixture cleanup aggregate", { cause: failure });
  expect(failure.message).toBe("Mixed mutation fixture cleanup failed");
  expect(failure.errors).toHaveLength(1);
  const generation: unknown = failure.errors[0];
  expect(generation).toBeInstanceOf(AggregateError);
  if (!(generation instanceof AggregateError)) throw new Error("Expected initial generation cleanup aggregate", { cause: generation });
  expect(generation.message).toBe("Mixed mutation fixture cleanup failed");
  expect(generation.errors).toHaveLength(1);
  const cause: unknown = generation.errors[0];
  expect(Cause.isCause(cause)).toBe(true);
  if (!Cause.isCause(cause)) throw new Error("Expected the complete initial fiber Cause", { cause });
  expect(Cause.hasDies(cause)).toBe(false);
  expect(Cause.hasInterrupts(cause)).toBe(false);
  expect([1, 2]).toContain(cause.reasons.length);
  expect(cause.reasons.every(Cause.isFailReason)).toBe(true);

  // The heartbeat may observe expiry before close signals the original owner.
  // Its typed refusal precedes the same native abort refusal in the full Cause.
  if (cause.reasons.length === 2) {
    const liveness = cause.reasons[0];
    if (liveness === undefined || !Cause.isFailReason(liveness)) throw new Error("Expected the native claim-expiry failure", { cause });
    expect(liveness.error).toBeInstanceOf(PointMutationExecutionClaimLivenessStaleV1Error);
    expect(liveness.error).toMatchObject({ reason: "claimExpired" });
  }
  const terminalization = cause.reasons[cause.reasons.length - 1];
  if (terminalization === undefined || !Cause.isFailReason(terminalization)) throw new Error("Expected the native abort failure", { cause });
  expect(terminalization.error).toBeInstanceOf(PointMutationSessionAttemptTerminalizationV1Error);
  if (!(terminalization.error instanceof PointMutationSessionAttemptTerminalizationV1Error))
    throw new Error("Expected the original terminalization error identity", { cause });
  expect(terminalization.error.issue).toEqual({ reason: expectedTerminalizationReason });
}
