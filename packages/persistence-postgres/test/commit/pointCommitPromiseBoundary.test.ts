import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { PointCommitCorruptionV1Error, PointCommitSqlErrorV1 } from "../../src/commit/pointCommitErrors";
import { projectPointCommitTransactionResult, runPointCommitInTransactionEffect,
  runPointCommitPromiseEffect } from "../../src/commit/pointCommitPromiseBoundary";
import { projectLogicalDocumentMaterializationFailure } from "../../src/storage/documents/logicalDocuments/materialization";
import { LocatedReadCommittedTransactionFailureV1 } from "../../src/execution/transactionSessionAttemptKernel";

describe("point commit Effect-to-Promise outcome boundary", () => {
  it("retains the exact scalar expected failure through the real projection", async () => {
    const failure = new PointCommitCorruptionV1Error({ reason: "rowWriteInvalid" });
    const result = await runPointCommitInTransactionEffect(Effect.fail(failure));
    if (Result.isSuccess(result)) throw new Error("Expected the actual bridge to retain its failure");
    expect(result.failure).toBe(failure);
    let projected: unknown;
    try { projectPointCommitTransactionResult(result); }
    catch (cause) { projected = cause; }
    expect(projected).toBe(failure);
  });

  it.each(["failure and defect", "failure and interruption", "defect"] as const)(
    "rejects with the complete official Cause for %s", async kind => {
      const failure = new PointCommitCorruptionV1Error({ reason: "rowWriteInvalid" });
      const defect = new TypeError("Invalid stored callback value");
      const cause = kind === "failure and defect" ? Cause.combine(Cause.fail(failure), Cause.die(defect))
        : kind === "failure and interruption" ? Cause.combine(Cause.fail(failure), Cause.interrupt(701))
          : Cause.die(defect);
      let rejected: unknown;
      try { await runPointCommitInTransactionEffect(Effect.failCause(cause)); }
      catch (failure) { rejected = failure; }
      expect(rejected).toBe(cause);
    },
  );
});

describe("point commit Promise-to-Effect re-entry", () => {
  it("maps the original ordinary scalar failure exactly once", async () => {
    const failure = new PointCommitCorruptionV1Error({ reason: "rowWriteInvalid" });
    const mapFailure = vi.fn(projectLogicalDocumentMaterializationFailure);
    const exit = await Effect.runPromiseExit(runPointCommitPromiseEffect(async () => {
      const result = await runPointCommitInTransactionEffect(Effect.fail(failure));
      return projectPointCommitTransactionResult(result);
    }, mapFailure));
    if (Exit.isSuccess(exit)) throw new Error("Expected scalar failure re-entry");
    expect(mapFailure).toHaveBeenCalledExactlyOnceWith(failure);
    const reasons = exit.cause.reasons.filter(Cause.isFailReason);
    expect(exit.cause.reasons).toHaveLength(1);
    expect(reasons).toHaveLength(1);
    expect(reasons[0]?.error.reason).toBe("storedCorruption");
    expect(reasons[0]?.error.cause).toBe(failure);
  });

  it.each([false, true])("preserves raw or confirmed rollback Cause identities (wrapped=%s)", async wrapped => {
    for (const companion of ["defect", "interruption"] as const) {
      const failure = new PointCommitCorruptionV1Error({ reason: "rowWriteInvalid" });
      const defect = new TypeError("Invalid stored re-entry callback value");
      const interruptor = 801;
      const cause = Cause.combine(Cause.fail(failure), companion === "defect" ? Cause.die(defect) : Cause.interrupt(interruptor));
      const mapFailure = vi.fn(projectLogicalDocumentMaterializationFailure);
      const exit = await Effect.runPromiseExit(runPointCommitPromiseEffect(async () => {
        try { return await runPointCommitInTransactionEffect(Effect.failCause(cause)); }
        catch (callbackCause) {
          if (!wrapped) throw callbackCause;
          throw new LocatedReadCommittedTransactionFailureV1({ kind: "callbackRolledBack", callbackCause });
        }
      }, mapFailure));
      if (Exit.isSuccess(exit)) throw new Error("Expected full Cause re-entry");
      expect(mapFailure).toHaveBeenCalledExactlyOnceWith(failure);
      expect(exit.cause.reasons).toHaveLength(2);
      const failures = exit.cause.reasons.filter(Cause.isFailReason);
      expect(failures).toHaveLength(1);
      expect(failures[0]?.error.reason).toBe("storedCorruption");
      expect(failures[0]?.error.cause).toBe(failure);
      const defects = exit.cause.reasons.filter(Cause.isDieReason);
      expect(defects).toHaveLength(companion === "defect" ? 1 : 0);
      for (const reason of defects) expect(reason.defect).toBe(defect);
      expect(exit.cause.reasons.filter(Cause.isInterruptReason).map(reason => reason.fiberId))
        .toEqual(companion === "interruption" ? [interruptor] : []);
    }
  });

  it.each(["callbackCleanupFailed", "decisionUncertain", "infrastructureFailure"] as const)(
    "retains %s settlement priority instead of restoring the nested callback Cause", async kind => {
      const callbackCause = Cause.combine(Cause.fail(new PointCommitCorruptionV1Error({ reason: "rowWriteInvalid" })),
        Cause.die(new TypeError("Callback defect preceding unsettled cleanup")));
      const settlementCause = new Error("Actual settlement failure");
      const failure = new LocatedReadCommittedTransactionFailureV1(kind === "callbackCleanupFailed"
        ? { kind, callbackCause, transactionCause: settlementCause }
        : kind === "decisionUncertain" ? { kind, settlementCause: callbackCause, releaseCause: settlementCause }
          : { kind, phase: "beginOrConfigure", cause: callbackCause, releaseCause: settlementCause });
      const mapFailure = vi.fn(projectLogicalDocumentMaterializationFailure);
      const exit = await Effect.runPromiseExit(runPointCommitPromiseEffect(() => Promise.reject(failure), mapFailure));
      if (Exit.isSuccess(exit)) throw new Error("Expected retained settlement failure");
      expect(mapFailure).toHaveBeenCalledExactlyOnceWith(failure);
      expect(exit.cause.reasons).toHaveLength(1);
      const reasons = exit.cause.reasons.filter(Cause.isFailReason);
      expect(reasons).toHaveLength(1);
      const mapped = reasons[0]?.error;
      expect(mapped?.reason).toBe("statementFailure");
      expect(mapped?.cause).toBeInstanceOf(PointCommitSqlErrorV1);
      if (!(mapped?.cause instanceof PointCommitSqlErrorV1)) throw new Error("Missing owner settlement classification");
      expect(mapped.cause.operation).toBe("beginOrRollback");
      expect(mapped.cause.cause).toBe(failure);
    },
  );
});
