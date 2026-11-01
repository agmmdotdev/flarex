import { Cause, Exit } from "effect";
import { expect } from "vitest";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";

function failureReasons<Value, Failure>(exit: Exit.Exit<Value, Failure>) {
  if (Exit.isSuccess(exit)) throw new Error("Expected the native workflow to fail");
  // A rollback marker must accompany the original failure, never replace it.
  // Check every official Cause kind so an extra defect or interrupt cannot hide.
  expect(exit.cause.reasons).toHaveLength(2);
  expect(exit.cause.reasons.filter(Cause.isInterruptReason)).toEqual([]);
  return exit.cause.reasons;
}

export function expectWorkflowDefect<Value, Failure>(exit: Exit.Exit<Value, Failure>, original: Error): void {
  const reasons = failureReasons(exit);
  const defects = reasons.filter(Cause.isDieReason).map(reason => reason.defect);
  const failures = reasons.filter(Cause.isFailReason).map(reason => reason.error);
  expect(defects).toHaveLength(1); expect(defects[0]).toBe(original);
  expect(failures).toHaveLength(1);
  expect(failures[0]).toBeInstanceOf(CommerceTransactionError);
  expect(failures[0]).toMatchObject({ reason: "rollbackOnly" });
}

export function expectWorkflowRefusal<Value, Failure>(exit: Exit.Exit<Value, Failure>, reason: CommerceTransactionError["reason"]): CommerceTransactionError {
  const reasons = failureReasons(exit);
  expect(reasons.filter(Cause.isDieReason)).toEqual([]);
  const failures = reasons.filter(Cause.isFailReason).map(reason => reason.error);
  expect(failures).toHaveLength(2);
  for (const failure of failures) expect(failure).toBeInstanceOf(CommerceTransactionError);
  expect(failures.map(failure => failure instanceof CommerceTransactionError ? failure.reason : undefined).toSorted())
    .toEqual([reason, "rollbackOnly"].toSorted());
  const original = failures.find(failure => failure instanceof CommerceTransactionError && failure.reason === reason);
  if (!(original instanceof CommerceTransactionError)) throw new Error("Missing original typed workflow refusal");
  return original;
}

/** A caught callback refusal is retained when a later capability capture sees
 * rollback-only, and the owner subsequently seals the failed root. */
export function expectCapturedWorkflowRefusal<Value, Failure>(exit: Exit.Exit<Value, Failure>, reason: CommerceTransactionError["reason"]): CommerceTransactionError {
  if (Exit.isSuccess(exit)) throw new Error("Expected the captured workflow refusal");
  expect(exit.cause.reasons).toHaveLength(3);
  expect(exit.cause.reasons.filter(Cause.isDieReason)).toEqual([]);
  expect(exit.cause.reasons.filter(Cause.isInterruptReason)).toEqual([]);
  const failures = exit.cause.reasons.filter(Cause.isFailReason);
  expect(failures).toHaveLength(3);
  for (const failure of failures) expect(failure.error).toBeInstanceOf(CommerceTransactionError);
  expect(failures.map(failure => failure.error instanceof CommerceTransactionError ? failure.error.reason : undefined).toSorted())
    .toEqual([reason, "rollbackOnly", "rollbackOnly"].toSorted());
  const original = failures.find(failure => failure.error instanceof CommerceTransactionError && failure.error.reason === reason);
  if (original === undefined || !(original.error instanceof CommerceTransactionError))
    throw new Error("Missing original captured workflow refusal");
  const rollbacks = failures.filter(failure => failure.error instanceof CommerceTransactionError && failure.error.reason === "rollbackOnly");
  const captured = rollbacks.filter(failure => failure.error instanceof CommerceTransactionError && failure.error.cause !== undefined);
  const sealed = rollbacks.filter(failure => failure.error instanceof CommerceTransactionError && failure.error.cause === undefined);
  expect(captured).toHaveLength(1); expect(sealed).toHaveLength(1);
  const [capture] = captured;
  if (capture === undefined || !(capture.error instanceof CommerceTransactionError) || !Cause.isCause(capture.error.cause))
    throw new Error("Captured rollback lost the complete original Cause");
  const nested = capture.error.cause;
  expect(nested.reasons).toHaveLength(1);
  expect(nested.reasons.filter(Cause.isDieReason)).toEqual([]);
  expect(nested.reasons.filter(Cause.isInterruptReason)).toEqual([]);
  const [nestedReason] = nested.reasons;
  if (nestedReason === undefined || !Cause.isFailReason(nestedReason))
    throw new Error("Captured rollback lost the original typed failure");
  expect(nestedReason.error).toBe(original.error);
  expect(nestedReason.annotations.has("Flarex/BoundedRequestFailureOrigin")).toBe(true);
  // Effect.fn can clone a Reason and extend its stack annotation. Every
  // original annotation remains visible without requiring wrapper identity.
  for (const [key, value] of nestedReason.annotations) {
    expect(original.annotations.has(key)).toBe(true);
    if (key === "effect/Cause/StackTrace") {
      expect(value).toMatchObject({ name: expect.any(String), stack: expect.any(Function) });
      expect(original.annotations.get(key)).toMatchObject({ name: expect.any(String), stack: expect.any(Function) });
    } else expect(original.annotations.get(key)).toBe(value);
  }
  return original.error;
}
