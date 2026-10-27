import { Cause, Schema } from "effect";
import { expect } from "vitest";

const underlyingQueryFailure = Schema.Struct({ cause: Schema.Struct({ cause: Schema.Struct({ cause: Schema.Unknown }) }) });

/** Ordinary PostgreSQL may retain one rejected lock SQL promise through both
 * callback and physical observations. Admit only the very same error object. */
export function expectCheckoutContention(cause: Cause.Cause<unknown>) {
  expect([1, 2]).toContain(cause.reasons.length);
  const [callback, tracked] = cause.reasons;
  if (callback === undefined || !Cause.isFailReason(callback)) throw new Error("Checkout contention contains a defect or interruption", { cause });
  expect(callback.error).toMatchObject({ reason: "invalidAuthority", cause: {
    _tag: "ScopeAuthorizationRevocationEpochPersistenceError", operation: "lockForOrdinaryWrite",
    cause: { cause: { code: "55P03" } },
  } });
  if (tracked === undefined) return;
  if (!Cause.isFailReason(tracked)) throw new Error("Checkout contention contains an additional defect or interruption", { cause });
  expect(tracked.error).toMatchObject({ reason: "resourceFailure", cause: { _tag: "RelationalSessionError", reason: "resourceFailure",
    cause: { _tag: "PhysicalSessionResourceIssue", phase: "callback" },
  } });
  const original = Schema.decodeUnknownSync(underlyingQueryFailure)(callback.error).cause.cause.cause;
  const observed = Schema.decodeUnknownSync(underlyingQueryFailure)(tracked.error).cause.cause.cause;
  expect(original).toMatchObject({ code: "55P03" });
  expect(observed).toBe(original);
}
