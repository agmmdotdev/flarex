import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import type { PrivateProductAttemptExecution } from "@flarex/medusa-adapter/internal/product-attempt";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeNativeProductOperationDiagnostics } from "./support/nativeProductOperationDiagnostics";

const nativeResult: PrivateProductAttemptExecution = { result: { id: "prod_diagnostic" },
  changes: { changes: [], attempts: [], lifecycle: [], observedRows: [], noFinalRows: [], dependencies: [],
    scans: [], uniqueReads: [], indexReads: [], pageReads: [], searchReads: [], setNull: [], referenceReplacements: [] },
  events: [], eventIntents: [], workBytes: 0, workCalls: 1 };

describe("native Product benchmark diagnostic isolation", () => {
  const missing = commerceError("adapterFailure", new Error("Native missing Product"));
  const defect = new Error("Native defect");
  const outcomes: readonly Exit.Exit<PrivateProductAttemptExecution, CommerceTransactionError>[] = [
    Exit.succeed(nativeResult), Exit.fail(missing), Exit.failCause(Cause.die(defect)),
    Exit.failCause(Cause.combine(Cause.fail(missing), Cause.combine(Cause.die(defect), Cause.interrupt()))),
  ];
  for (const phase of ["synchronous", "promise"] as const) {
    it(`preserves every native Exit when ${phase} observation fails and refuses measurement`, async () => {
      for (const nativeExit of outcomes) {
        const diagnostic = new Error(`Diagnostic ${phase} failure`);
        let observed: typeof nativeExit | undefined;
        const owner = makeNativeProductOperationDiagnostics((_method, _args, exit, elapsedMs) => {
          observed = exit;
          expect(elapsedMs).toBe(17);
          if (phase === "synchronous") throw diagnostic;
          return Promise.reject(diagnostic);
        });
        const actual = await Effect.runPromiseExit(owner.observeAndReplay("retrieve", { id: "prod_diagnostic" }, nativeExit, 17));
        expect(observed).toBe(nativeExit);
        expect(actual).toEqual(nativeExit);
        if (Exit.isSuccess(actual)) expect(actual.value).toBe(nativeResult);
        if (Exit.isFailure(actual) && Exit.isFailure(nativeExit)) expect(actual.cause).toEqual(nativeExit.cause);
        expect(() => owner.assertMeasurement()).toThrow(expect.objectContaining({
          _tag: "NativeProductOperationDiagnosticError", phase, cause: diagnostic,
        }));
      }
    });
  }
  it("awaits successful asynchronous observation before replay and retains only the first diagnostic failure", async () => {
    let release = () => {};
    const pending = new Promise<void>(resolve => { release = resolve; });
    let entered = () => {};
    const started = new Promise<void>(resolve => { entered = resolve; });
    let replayed = false;
    const owner = makeNativeProductOperationDiagnostics(() => { entered(); return pending; });
    const replay = Effect.runPromise(owner.observeAndReplay("retrieve", null, Exit.succeed(nativeResult), 2))
      .then(result => { replayed = true; return result; });
    await started;
    expect(replayed).toBe(false);
    release();
    expect(await replay).toBe(nativeResult);
    expect(() => owner.assertMeasurement()).not.toThrow();
    const first = new Error("First diagnostic"), later = new Error("Later diagnostic");
    let count = 0;
    const failed = makeNativeProductOperationDiagnostics(() => { throw count++ === 0 ? first : later; });
    await Effect.runPromiseExit(failed.observeAndReplay("retrieve", null, Exit.succeed(nativeResult), 2));
    await Effect.runPromiseExit(failed.observeAndReplay("retrieve", null, Exit.fail(missing), 2));
    expect(() => failed.assertMeasurement()).toThrow(expect.objectContaining({ cause: first }));
  });
});
