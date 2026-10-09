import { Cause, Clock, Context, Effect, Exit, Option, References, Tracer } from "effect";
import { ExecutionDiagnostics, observeExecution, type ExecutionDiagnosticPolicy } from "../../../src/execution/diagnostics/operation";
import { describe, expect, it } from "vitest";
import { awaitEffectTransactionSettlement, runEffectTransactionSettlement } from "../../../src/database/effectTransaction";
import { runLocatedReadCommittedEffect } from "../../../src/database/locatedReadCommittedEffect";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import {
  LocatedReadCommittedTransactionFailureV1,
} from "../../../src/execution/readCommittedTransactionFailure";
import {
  RUN_LOCATED_READ_COMMITTED_V1,
  type LocatedReadCommittedAttemptTargetV1,
} from "../../../src/execution/transactionSessionAttemptKernel";
import { makeScriptedControlSessionFixture } from "../../database/catalogControlSessionTestSupport";

const Unrelated = Context.Service<{ readonly secret: string }>("OperationContextBridgesTest/Unrelated");
const defaultClock = Context.get(Context.empty(), Clock.Clock);
const clock: Clock.Clock = {
  currentTimeMillis: Effect.succeed(11), currentTimeMillisUnsafe: () => 11,
  currentTimeNanos: Effect.succeed(11_000_000n), currentTimeNanosUnsafe: () => 11_000_000n,
  monotonicTimeNanos: defaultClock.monotonicTimeNanos,
  monotonicTimeNanosUnsafe: () => defaultClock.monotonicTimeNanosUnsafe(),
  sleep: duration => defaultClock.sleep(duration),
};
const tx = makeScriptedControlSessionFixture({ initial: "commit" }).initialTransaction;
const start = <Value>(body: (transaction: FlarexMetadataTransaction) => Promise<Value>) => body(tx);
function target(
  rejected: (callbackCause: unknown) => LocatedReadCommittedTransactionFailureV1 = callbackCause =>
    new LocatedReadCommittedTransactionFailureV1({ kind: "callbackRolledBack", callbackCause }),
): LocatedReadCommittedAttemptTargetV1 {
  return {
    physicalLocator: { kind: "shared_database", databaseKey: "bridge-identity-test", schemaName: "public" },
    getCurrentClock: async () => null,
    [RUN_LOCATED_READ_COMMITTED_V1]: async body => {
      try { return await body(tx); }
      catch (cause) { throw rejected(cause); }
    },
  };
}
const options = { rollbackMessage: "located read bridge rollback", cleanupDefect: (failure: LocatedReadCommittedTransactionFailureV1) => failure };
function tracing() {
  const spans: Tracer.Span[] = [];
  const tracer = Tracer.make({ span: options => {
    const span = new Tracer.NativeSpan(options);
    spans.push(span);
    return span;
  } });
  return { spans, tracer };
}
const settleError = (cause: unknown) => new Error("transaction settlement failed", { cause });
const diagnosticPolicy: ExecutionDiagnosticPolicy = {
  observe: (name, work) => Effect.useSpan(name, {}, span => Effect.provideService(work, Tracer.ParentSpan, span)),
};

describe("persistence Promise callback tracing context", () => {
  it.each(["typed", "compound", "foreign"] as const)("drains interrupted construction retaining its %s rejection", async kind => {
    const failure = new Error("construction failure");
    const defect = new TypeError("construction cleanup defect");
    const transported = kind === "typed" ? Cause.fail(failure) : kind === "compound"
      ? Cause.combine(Cause.fail(failure), Cause.die(defect)) : defect;
    let reject: (cause: unknown) => void = () => { throw new Error("Missing construction rejection"); };
    const pending = new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; });
    const controller = new AbortController();
    const events: string[] = [];
    let completed = false;
    const result = Effect.runPromiseExit(awaitEffectTransactionSettlement(pending,
      cause => Cause.isCause(cause) && Cause.hasInterruptsOnly(cause)).pipe(
      Effect.ensuring(Effect.sync(() => { events.push("cleanup"); }))), { signal: controller.signal })
      .then(exit => { completed = true; events.push("exit"); return exit; });
    controller.abort();
    expect(completed).toBe(false);
    events.push("constructor-settled");
    reject(transported);
    const exit = await result;
    if (Exit.isSuccess(exit)) throw new Error("Expected construction interruption and failure");
    expect(exit.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
    expect(exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error))
      .toEqual(kind === "foreign" ? [] : [failure]);
    expect(exit.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect))
      .toEqual(kind === "typed" ? [] : [defect]);
    expect(events).toEqual(["constructor-settled", "cleanup", "exit"]);
  });

  it.each(["transaction", "locatedRead"] as const)(
    "continues only tracer and parent through %s with concurrent request isolation", async kind => {
      const request = async (name: string) => {
        const trace = tracing();
        const linked = Tracer.externalSpan({ traceId: `linked-${name}`, spanId: `span-${name}` });
        const links = [{ span: linked, attributes: { request: name } }];
        const body = (transaction: FlarexMetadataTransaction) => Effect.withFiber(fiber => Effect.sync(() => {
          expect(transaction).toBe(tx);
          expect(Context.get(fiber.context, Tracer.Tracer)).toBe(trace.tracer);
          expect(Context.getOption(fiber.context, Unrelated)).toEqual(Option.none());
          expect(Context.get(fiber.context, Clock.Clock)).not.toBe(clock);
          expect(Context.getOption(fiber.context, ExecutionDiagnostics)).toEqual(Option.some(diagnosticPolicy));
          expect(Context.get(fiber.context, References.TracerTimingEnabled)).toBe(false);
          expect(Context.get(fiber.context, References.TracerSpanAnnotations)).toEqual({ request: name });
          expect(Context.get(fiber.context, References.TracerSpanLinks)).toBe(links);
          return name;
        }));
        const effect = kind === "transaction"
          ? runEffectTransactionSettlement(start, "transaction rollback", transaction => observeExecution("callback-body", body(transaction)), settleError)
          : runLocatedReadCommittedEffect(target(), options, transaction => observeExecution("callback-body", body(transaction)));
        expect(await Effect.runPromise(effect.pipe(Effect.withSpan(name),
          Effect.provideService(ExecutionDiagnostics, diagnosticPolicy), Effect.withTracerTiming(false),
          Effect.provideService(Tracer.Tracer, trace.tracer), Effect.provideService(Clock.Clock, clock),
          Effect.provideService(Unrelated, { secret: name }), Effect.annotateSpans({ request: name }),
          Effect.provideService(References.TracerSpanLinks, links)))).toBe(name);
        const root = trace.spans.find(span => span.name === name);
        const callback = trace.spans.find(span => span.name === "callback-body");
        const read = trace.spans.find(span => span.name === "LocatedReadCommitted.runEffect");
        if (root === undefined || callback === undefined) throw new Error("Missing callback operation span");
        const parent = kind === "transaction" ? root : read;
        if (parent === undefined) throw new Error("Missing real located-read operation parent");
        expect(Option.getOrUndefined(callback.parent)).toBe(parent);
        expect(callback.traceId).toBe(root.traceId);
        expect(callback.attributes.get("request")).toBe(name);
        expect(callback.links).toEqual(links);
        expect(callback.status).toMatchObject({ _tag: "Ended", startTime: 0n, endTime: 0n });
        if (read !== undefined) expect(Option.getOrUndefined(read.parent)).toBe(root);
        return trace;
      };
      const [first, second] = await Promise.all([request("request-a"), request("request-b")]);
      expect(first.spans[0]?.traceId).not.toBe(second.spans[0]?.traceId);
      expect(first.spans.some(span => second.spans.includes(span))).toBe(false);
    },
  );

  it.each(["transaction", "locatedRead"] as const)("keeps quiet tracing absence in %s", async kind => {
    const trace = tracing();
    const body = () => observeExecution("quiet-body", Effect.succeed("without collector"));
    const effect = kind === "transaction"
      ? runEffectTransactionSettlement(start, "rollback", body, settleError)
      : runLocatedReadCommittedEffect(target(), options, body);
    expect(await Effect.runPromise(effect.pipe(Effect.provideService(Tracer.Tracer, trace.tracer)))).toBe("without collector");
    expect(trace.spans).toEqual([]);
  });

  it.each(["transaction", "locatedRead"] as const)("preserves original full callback Causes in %s", async kind => {
    const failure = new Error("domain failure");
    const defect = new TypeError("callback defect");
    for (const cause of [Cause.combine(Cause.fail(failure), Cause.die(defect)),
      Cause.combine(Cause.fail(failure), Cause.interrupt(718))]) {
      const trace = tracing();
      let callbackCause: Cause.Cause<Error> | undefined;
      const body = () => observeExecution("failing-body", Effect.failCause(cause)).pipe(
        Effect.tapCause(original => Effect.sync(() => { callbackCause = original; })));
      const effect = kind === "transaction"
        ? runEffectTransactionSettlement(start, "exact rollback marker", body, settleError)
        : runLocatedReadCommittedEffect(target(), options, body);
      const exit = await Effect.runPromiseExit(observeExecution("request", effect).pipe(
        Effect.provideService(ExecutionDiagnostics, diagnosticPolicy),
        Effect.provideService(Tracer.Tracer, trace.tracer)));
      if (Exit.isSuccess(exit)) throw new Error("Expected original callback failure");
      // Optional SDK observation adds no Cause annotations or reason rewrites.
      expect(exit.cause).toBe(callbackCause);
      expect(exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error)).toEqual([failure]);
      expect(exit.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect))
        .toEqual(cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect));
      expect(exit.cause.reasons.filter(Cause.isInterruptReason).map(reason => reason.fiberId))
        .toEqual(cause.reasons.filter(Cause.isInterruptReason).map(reason => reason.fiberId));
      expect(trace.spans.find(span => span.name === "failing-body")?.status).toMatchObject({ _tag: "Ended", exit });
    }
  });

  it("combines transaction cleanup failure without discarding callback failure or defect identities", async () => {
    const failure = new Error("callback failure");
    const defect = new TypeError("callback defect");
    const cause = Cause.combine(Cause.fail(failure), Cause.die(defect));
    const cleanup = new Error("rollback failed");
    let rollback: unknown;
    const exit = await Effect.runPromiseExit(runEffectTransactionSettlement(async body => {
      try { return await body(tx); }
      catch (error) { rollback = error; throw cleanup; }
    }, "rollback marker", () => Effect.failCause(cause), error => error));
    expect(rollback).toBeInstanceOf(Error);
    expect(rollback).not.toBe(cause);
    if (Exit.isSuccess(exit)) throw new Error("Expected callback and cleanup failure");
    expect(exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error)).toEqual([failure, cleanup]);
    expect(exit.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([defect]);
  });

  it("retains located rollback cleanup defects alongside the exact callback Cause", async () => {
    const failure = new Error("callback failure");
    const defect = new TypeError("callback defect");
    const cause = Cause.combine(Cause.fail(failure), Cause.die(defect));
    const cleanup = new Error("located rollback failed");
    let settlement: LocatedReadCommittedTransactionFailureV1 | undefined;
    const exit = await Effect.runPromiseExit(runLocatedReadCommittedEffect(target(callbackCause => {
      settlement = new LocatedReadCommittedTransactionFailureV1({ kind: "callbackCleanupFailed", callbackCause,
        transactionCause: cleanup });
      return settlement;
    }), options, () => Effect.failCause(cause)));
    if (Exit.isSuccess(exit)) throw new Error("Expected callback and cleanup failure");
    expect(exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error)).toEqual([failure]);
    expect(exit.cause.reasons.filter(Cause.isDieReason).map(reason => reason.defect)).toEqual([defect, settlement]);
    expect(settlement?.issue).toMatchObject({ kind: "callbackCleanupFailed", transactionCause: cleanup });
  });

  it("preserves uncertain located settlement instead of restoring its nested callback Cause", async () => {
    const cause = Cause.combine(Cause.fail(new Error("callback failure")), Cause.die(new TypeError("callback defect")));
    const uncertain = new LocatedReadCommittedTransactionFailureV1({ kind: "decisionUncertain", settlementCause: cause });
    const exit = await Effect.runPromiseExit(runLocatedReadCommittedEffect(target(() => uncertain), options,
      () => Effect.failCause(cause)));
    if (Exit.isSuccess(exit)) throw new Error("Expected uncertain settlement");
    expect(exit.cause.reasons.filter(Cause.isFailReason).map(reason => reason.error)).toEqual([uncertain]);
    expect(exit.cause.reasons).toHaveLength(1);
  });

  it.each(["transaction", "locatedRead"] as const)("joins %s settlement cleanup after outer interruption", async kind => {
    const trace = tracing();
    const controller = new AbortController();
    let release: () => void = () => { throw new Error("Missing initialized cleanup release"); };
    let entered: () => void = () => { throw new Error("Missing initialized callback entry"); };
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const gate = new Promise<void>(resolve => { release = resolve; });
    const events: string[] = [];
    let completed = false;
    const joinedStart = async <Value>(body: (transaction: FlarexMetadataTransaction) => Promise<Value>): Promise<Value> => {
      try { return await body(tx); }
      finally { events.push("cleanup"); }
    };
    const body = () => Effect.promise(async () => {
      entered();
      await gate;
      events.push("callback");
    }).pipe(Effect.withSpan("joined-body"));
    const effect = kind === "transaction"
      ? runEffectTransactionSettlement(joinedStart, "interrupted transaction rollback", body, settleError)
      : runLocatedReadCommittedEffect({ ...target(), [RUN_LOCATED_READ_COMMITTED_V1]: joinedStart }, options, body);
    const exitPromise = Effect.runPromiseExit(effect.pipe(Effect.withSpan("request"),
      Effect.provideService(Tracer.Tracer, trace.tracer)), { signal: controller.signal }).then(exit => {
        completed = true;
        events.push("outer-exit");
        return exit;
      });
    await ready;
    controller.abort();
    expect(completed).toBe(false);
    release();
    const exit = await exitPromise;
    if (Exit.isSuccess(exit)) throw new Error("Expected outer interruption");
    expect(exit.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
    expect(events).toEqual(["callback", "cleanup", "outer-exit"]);
    expect(trace.spans.find(span => span.name === "joined-body")?.status._tag).toBe("Ended");
  });
});
