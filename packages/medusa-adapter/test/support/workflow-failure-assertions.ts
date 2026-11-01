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
