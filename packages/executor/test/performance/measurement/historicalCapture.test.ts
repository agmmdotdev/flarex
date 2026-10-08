import { Cause, Effect, Exit } from "effect";
import { describe, expect, it, vi } from "vitest";
import { captureHistoricalRead } from "./historicalCapture";
import { FiniteStorageCaptureError } from "../../../../persistence-postgres/src/finiteStorageCapture";

vi.mock("../support/historicalCaptureFixture", () => ({ createHistoricalCaptureFixture: vi.fn() }));

describe("historical capture Promise boundary", () => {
  it("requires initial observation and runs the original read exactly once", async () => {
    const read = vi.fn(() => Effect.succeed(7));
    const calls = vi.fn();
    const capture = async <A>(run: () => Promise<A>, options?: Readonly<{ initialObservation: "required" }>) => {
      calls();
      expect(options).toEqual({ initialObservation: "required" });
      return run();
    };
    expect(await Effect.runPromise(captureHistoricalRead({ capture }, read))).toBe(7);
    expect(read).toHaveBeenCalledTimes(1);
    expect(calls).toHaveBeenCalledTimes(1);
  });
  it("keeps an initial observer fault distinct and skips actual capture without retry", async () => {
    const original = new Error("initial log failed");
    const read = vi.fn(() => Effect.succeed(7));
    const calls = vi.fn();
    const capture = async <A>(_run: () => Promise<A>): Promise<A> => { calls(); throw original; };
    const exit = await Effect.runPromiseExit(captureHistoricalRead({ capture }, read));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isSuccess(exit)) throw new Error("Expected diagnostic failure");
    expect(exit.cause.reasons).toHaveLength(1);
    const reason = exit.cause.reasons[0];
    if (reason === undefined || !Cause.isFailReason(reason)) throw new Error("Expected typed diagnostic failure");
    expect(reason.error).toMatchObject({ _tag: "HistoricalCaptureDiagnosticError", stage: "serverCapture", cause: original });
    expect(read).not.toHaveBeenCalled();
    expect(calls).toHaveBeenCalledTimes(1);
  });
  it("preserves the original defect and combined interruption Cause", async () => {
    const defect = new Error("core defect");
    const failure = new FiniteStorageCaptureError({ reason: "expired" });
    const original = Cause.combine(Cause.combine(Cause.fail(failure), Cause.die(defect)), Cause.interrupt(123));
    const capture = async <A>(run: () => Promise<A>) => run();
    const exit = await Effect.runPromiseExit(captureHistoricalRead({ capture }, () => Effect.failCause(original)));
    if (Exit.isSuccess(exit)) throw new Error("Expected original core Cause");
    expect(exit.cause.reasons.map(reason => reason._tag)).toEqual(["Fail", "Die", "Interrupt"]);
    expect(exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === failure)).toBe(true);
    expect(exit.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);
    expect(exit.cause.reasons.some(reason => Cause.isInterruptReason(reason) && reason.fiberId === 123)).toBe(true);
  });
  it("retains a synchronous read-factory throw as the core defect", async () => {
    const original = new Error("read factory defect");
    let cleaned = false;
    const capture = async <A>(run: () => Promise<A>) => {
      try { return await run(); } finally { cleaned = true; }
    };
    const read = (): Effect.Effect<number, FiniteStorageCaptureError> => { throw original; };
    const exit = await Effect.runPromiseExit(captureHistoricalRead({ capture }, read));
    if (Exit.isSuccess(exit)) throw new Error("Expected core factory defect");
    expect(cleaned).toBe(true);
    expect(exit.cause.reasons).toHaveLength(1);
    expect(exit.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === original)).toBe(true);
  });
  it("propagates cancellation into the read and drains capture cleanup before returning", async () => {
    const stop = new AbortController();
    let finishRead: (() => void) | undefined;
    let finishCleanup: (() => void) | undefined;
    let readAborted = false, cleanupStarted = false, settled = false;
    const read = () => Effect.callback<number>(function (_resume, signal) {
      finishRead = () => { readAborted = signal.aborted; };
      signal.addEventListener("abort", finishRead, { once: true });
    });
    const capture = async <A>(run: () => Promise<A>) => {
      try { return await run(); }
      finally {
        cleanupStarted = true;
        await new Promise<void>(resolve => { finishCleanup = resolve; });
      }
    };
    const pending = Effect.runPromiseExit(captureHistoricalRead({ capture }, read), { signal: stop.signal })
      .finally(() => { settled = true; });
    await vi.waitFor(() => expect(finishRead).toBeDefined());
    stop.abort();
    await vi.waitFor(() => expect(cleanupStarted).toBe(true));
    expect(readAborted).toBe(true);
    expect(settled).toBe(false);
    finishCleanup?.();
    const exit = await pending;
    if (Exit.isSuccess(exit)) throw new Error("Expected cancellation");
    expect(exit.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
  });
});
