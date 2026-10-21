import { Cause, Clock, Context, Deferred, Effect, Exit, Option, References, Scope, Tracer } from "effect";
import { describe, expect, it } from "vitest";
import { mockRelationalRead } from "./mock-relational-read";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/context";
import { makeCommercePromiseOwner } from "../src/module/promise-owner";
import { ExecutionDiagnostics, observeExecution, withExecutionDiagnosticDefaults, type ExecutionDiagnosticPolicy } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { withCommerceService } from "../src/module/service-bridge";
import { currencyRepository } from "../src/modules/currency/repository";

const Unrelated = Context.Service<{ readonly request: string }>("CommercePromiseOwnerTest/Unrelated");
const diagnosticPolicy: ExecutionDiagnosticPolicy = {
  observe: (name, work) => Effect.useSpan(name, {}, span => Effect.provideService(work, Tracer.ParentSpan, span)),
};
const defaultClock = Context.get(Context.empty(), Clock.Clock);
const clock: Clock.Clock = {
  currentTimeMillis: Effect.succeed(7), currentTimeMillisUnsafe: () => 7,
  currentTimeNanos: Effect.succeed(7_000_000n), currentTimeNanosUnsafe: () => 7_000_000n,
  monotonicTimeNanos: defaultClock.monotonicTimeNanos,
  monotonicTimeNanosUnsafe: () => defaultClock.monotonicTimeNanosUnsafe(),
  sleep: duration => defaultClock.sleep(duration),
};
function tracing() {
  const spans: Tracer.Span[] = [];
  const tracer = Tracer.make({ span: options => {
    const span = new Tracer.NativeSpan(options);
    spans.push(span);
    return span;
  } });
  return { spans, tracer };
}

describe("commerce Promise operation context", () => {
  it("captures only the tracer and current parent at the owning factory", async () => {
    const trace = tracing();
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const parent = yield* Effect.currentSpan;
      const owner = yield* Effect.acquireRelease(makeCommercePromiseOwner(), owner => owner.close);
      yield* Effect.promise(() => owner.run(observeExecution("DAL.factory-run", Effect.withFiber(fiber => Effect.sync(() => {
        expect(Context.get(fiber.context, Tracer.Tracer)).toBe(trace.tracer);
        expect(Option.getOrUndefined(Context.getOption(fiber.context, Unrelated))).toBeUndefined();
        expect(Context.get(fiber.context, Clock.Clock)).not.toBe(clock);
        expect(Context.getOrUndefined(fiber.context, Scope.Scope)).toBeUndefined();
        expect(Context.getOption(fiber.context, ExecutionDiagnostics)).toEqual(Option.some(diagnosticPolicy));
        if (fiber.currentSpan?._tag !== "Span") throw new Error("Missing DAL factory span");
        expect(Option.getOrUndefined(fiber.currentSpan.parent)).toBe(parent);
        expect(fiber.currentSpan?.traceId).toBe(parent.traceId);
      })))));
    })).pipe(Effect.withSpan("request"), Effect.provideService(Tracer.Tracer, trace.tracer),
      Effect.provideService(ExecutionDiagnostics, diagnosticPolicy),
      Effect.provideService(Unrelated, { request: "private" }), Effect.provideService(Clock.Clock, clock)));
    expect(trace.spans.map(span => span.name)).toEqual(["request", "DAL.factory-run"]);
  });

  it("keeps opt-in operation diagnostics absent on quiet framework runners", async () => {
    const trace = tracing();
    const owner = await Effect.runPromise(makeCommercePromiseOwner().pipe(Effect.provideService(Tracer.Tracer, trace.tracer)));
    try { expect(await owner.run(observeExecution("quiet DAL", Effect.succeed(1)))).toBe(1); }
    finally { await Effect.runPromise(owner.close); }
    expect(trace.spans).toEqual([]);
  });

  it("retains the core default and an explicit disabled custom tracer across Promise runners", async () => {
    const trace = tracing();
    const inspect = Effect.withFiber(fiber => Effect.sync(() => {
      expect(Context.get(fiber.context, References.TracerEnabled)).toBe(false);
      expect(Context.get(fiber.context, References.TracerTimingEnabled)).toBe(false);
      expect(Context.getOrUndefined(fiber.context, Unrelated)).toBeUndefined();
    })).pipe(Effect.withSpan("DAL.disabled"));
    const work = Effect.scoped(Effect.gen(function* () {
      const owner = yield* Effect.acquireRelease(makeCommercePromiseOwner(), owner => owner.close);
      yield* Effect.promise(() => owner.run(inspect));
    }));
    await Effect.runPromise(withExecutionDiagnosticDefaults(work));
    await Effect.runPromise(withExecutionDiagnosticDefaults(work).pipe(
      Effect.provideService(Tracer.Tracer, trace.tracer),
      Effect.provideService(References.TracerEnabled, false),
      Effect.provideService(References.TracerTimingEnabled, false)));
    expect(trace.spans).toEqual([]);
  });

  it.each([true, false])("preserves parent, annotations, links and explicit timing=%s", async timing => {
    const trace = tracing();
    const linked = Tracer.externalSpan({ traceId: "linked-trace", spanId: "linked-span" });
    const links = [{ span: linked, attributes: { relation: "request" } }];
    let parent: Tracer.AnySpan | undefined;
    await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      parent = yield* Effect.currentSpan;
      const owner = yield* Effect.acquireRelease(makeCommercePromiseOwner(), owner => owner.close);
      yield* Effect.promise(() => owner.run(Effect.withFiber(fiber => Effect.sync(() => {
        expect(Context.get(fiber.context, References.TracerEnabled)).toBe(true);
        expect(Context.get(fiber.context, References.TracerTimingEnabled)).toBe(timing);
        expect(Context.get(fiber.context, References.TracerSpanAnnotations)).toEqual({ tenant: "caller" });
        expect(Context.get(fiber.context, References.TracerSpanLinks)).toBe(links);
      })).pipe(Effect.withSpan("DAL.configured"))));
    })).pipe(Effect.withSpan("request")).pipe(
      Effect.provideService(Tracer.Tracer, trace.tracer),
      Effect.provideService(References.TracerEnabled, true),
      Effect.provideService(References.TracerTimingEnabled, timing),
      Effect.provideService(References.TracerSpanAnnotations, { tenant: "caller" }),
      Effect.provideService(References.TracerSpanLinks, links)));
    const child = trace.spans.find(span => span.name === "DAL.configured");
    expect(child?.parent).toEqual(Option.some(parent));
    expect(child?.attributes.get("tenant")).toBe("caller");
    expect(child?.links).toEqual(links);
    expect(child?.status._tag).toBe("Ended");
    if (!timing) expect(child?.status).toMatchObject({ startTime: 0n, endTime: 0n });
  });

  it("keeps actual DAL calls under their service parent in two isolated request factories", async () => {
    const request = async (name: string) => {
      const trace = tracing();
      const value = await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError,
          commerceLimits, {}, {}, name, "read"), lifetime => lifetime.close);
        const unused = () => Effect.fail(commerceError("unsupportedProfile"));
        const store: CommerceCommandContext["store"] = {
          prepareRead(query: unknown) { return mockRelationalRead(this, query); },
          findPage: Effect.fn("DAL.findPage")(function* () {
            const tracer = yield* Effect.tracer;
            expect(tracer).toBe(trace.tracer);
            return { rows: [{ code: name }], hasMore: false };
          }),
          aggregate: unused, find: unused, count: unused, write: unused, delete: unused, lifecycle: unused,
        };
        const ctx = makeCommerceCommandContext(lifetime, { store, resources: defaultCommerceResources,
          table: unused }, name, lifetime.context, unused, unused);
        return yield* withCommerceService(ctx, owner => currencyRepository(ctx, owner),
          repository => repository.find({ where: {}, options: { fields: ["code"] } }, { manager: ctx.manager }));
      })).pipe(Effect.withSpan(name), Effect.provideService(Tracer.Tracer, trace.tracer),
        Effect.provideService(ExecutionDiagnostics, diagnosticPolicy)));
      const service = trace.spans.find(span => span.name === "MedusaAdapter.withService");
      const dal = trace.spans.find(span => span.name === "DAL.findPage");
      const selected = trace.spans.find(span => span.name === "CommerceRepository.select");
      const execution = trace.spans.find(span => span.name === "MedusaRead.execute");
      const window = trace.spans.find(span => span.name === "MedusaRead.window");
      const requestSpan = trace.spans[0];
      if (service === undefined || execution === undefined || window === undefined || requestSpan === undefined) {
        throw new Error("Missing real request/DAL operation spans");
      }
      expect(dal?.parent).toEqual(Option.some(window));
      expect(window.parent).toEqual(Option.some(execution));
      expect(execution.parent).toEqual(Option.some(service));
      expect(selected?.parent).toEqual(Option.some(service));
      expect(dal?.traceId).toBe(trace.spans[0]?.traceId);
      expect(service.parent).toEqual(Option.some(requestSpan));
      expect(value).toEqual([{ code: name }]);
      return trace;
    };
    const [left, right] = await Promise.all([request("usd"), request("eur")]);
    expect(left.spans[0]?.traceId).not.toBe(right.spans[0]?.traceId);
    expect(left.spans.some(span => right.spans.includes(span))).toBe(false);
  });

  it("preserves single rejection identities and restores synchronous refusal Causes", async () => {
    const owner = await Effect.runPromise(makeCommercePromiseOwner());
    const failure = commerceError("invalidInput");
    const defect = new TypeError("DAL defect");
    try {
      await expect(owner.run(Effect.fail(failure))).rejects.toBe(failure);
      const defectOwner = await Effect.runPromise(makeCommercePromiseOwner());
      try { await expect(defectOwner.run(Effect.die(defect))).rejects.toBe(defect); }
      finally { await Effect.runPromise(defectOwner.close); }
      const synchronous = await Effect.runPromiseExit(owner.invoke(async () => owner.reject(failure)));
      if (Exit.isSuccess(synchronous)) throw new Error("Expected restored synchronous refusal");
      expect(synchronous.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === failure)).toBe(true);
      expect(() => owner.reject(commerceError("unsupportedProfile"))).toThrow();
      const completed = await Effect.runPromise(owner.close);
      if (Exit.isSuccess(completed)) throw new Error("Expected complete synchronous refusal outcome");
      expect(completed.cause.reasons.filter(reason => Cause.isFailReason(reason) && reason.error === failure)).toHaveLength(1);
    } finally { await Effect.runPromise(owner.close); }
  });

  it("interrupts and joins running finalizers before closing and refuses late continuations", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const owner = yield* makeCommercePromiseOwner();
      const entered = yield* Deferred.make<void>();
      const cleanupStarted = yield* Deferred.make<void>();
      const cleanupRelease = yield* Deferred.make<void>();
      let cleaned = false;
      const pending = owner.run(Deferred.succeed(entered, undefined).pipe(Effect.andThen(Effect.never),
        Effect.ensuring(Deferred.succeed(cleanupStarted, undefined).pipe(
          Effect.andThen(Deferred.await(cleanupRelease)), Effect.andThen(Effect.sync(() => { cleaned = true; }))))));
      const outcome = Promise.allSettled([pending]);
      yield* Deferred.await(entered);
      let closed = false;
      const closing = Effect.runPromise(owner.close).then(() => { closed = true; });
      yield* Deferred.await(cleanupStarted);
      expect(owner.hasPending()).toBe(true);
      expect(closed).toBe(false);
      yield* Deferred.succeed(cleanupRelease, undefined);
      yield* Effect.promise(() => closing);
      expect(cleaned).toBe(true);
      expect(owner.hasPending()).toBe(false);
      const settled = yield* Effect.promise(() => outcome);
      expect(settled[0]?.status).toBe("rejected");
      let starts = 0;
      yield* Effect.promise(() => expect(owner.run(Effect.sync(() => { starts++; }))).rejects.toMatchObject({ reason: "closed" }));
      yield* Effect.promise(() => expect(Effect.runPromise(owner.invoke(async () => { starts++; })))
        .rejects.toMatchObject({ reason: "closed" }));
      expect(starts).toBe(0);
    }));
  });
});
