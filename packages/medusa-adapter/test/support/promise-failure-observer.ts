import { Cause, Effect, Exit, Result } from "effect";
import { expect, vi } from "vitest";
import type { AtomicCommerceContext } from "@flarex/persistence-postgres/internal/commerce-adapter";

/** An observation spy for native ABI ports. It models no lifetime or latching. */
export const promiseFailureObserver = () => vi.fn<AtomicCommerceContext["recordFailure"]>(cause => Result.succeed(cause));

/** Assert the owning Effect channel as well as original foreign identity. */
export async function expectNativePromiseDefect<Value, Failure>(work: Effect.Effect<Value, Failure>, original: unknown) {
  const exit = await Effect.runPromiseExit(work);
  if (Exit.isSuccess(exit)) throw new Error("Expected native callback defect");
  expect(exit.cause.reasons.filter(reason => Cause.isDieReason(reason) && reason.defect === original)).toHaveLength(1);
  expect(exit.cause.reasons.some(Cause.isFailReason)).toBe(false);
}
