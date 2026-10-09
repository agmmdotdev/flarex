import { Cause, Context, Effect, Exit, Option, References, Schema, Tracer } from "effect";
import { describe, expect, it } from "vitest";
import { TransactionAttemptFenceSchema } from "flarex-protocol/transaction-session";
import { createMixedMutationProductFixture } from "./performance/support/mixedMutationProductFixture";

const encodeAttemptFence = Schema.encodeSync(TransactionAttemptFenceSchema);

function tracing() {
  const spans: Tracer.Span[] = [];
  const tracer = Tracer.make({ span: options => {
    const span = new Tracer.NativeSpan(options);
    spans.push(span);
    return span;
  } });
  return { tracer, spans };
}

describe("finite public invocation tracing", () => {
  it("defaults the genuine prepared entry before its callback and resolves caller tracing per dispatcher invocation", async () => {
    let preparedCallbacks = 0;
    const fixture = await createMixedMutationProductFixture({ driver: "pglite", suffix: "finite-tracing",
      hooks: { beforeFiniteCallback: () => Effect.withFiber(fiber => Effect.sync(() => {
        preparedCallbacks++;
        expect(Context.get(fiber.context, References.TracerEnabled)).toBe(false);
        expect(Context.get(fiber.context, References.TracerTimingEnabled)).toBe(false);
      })) } });
    try {
      expect(preparedCallbacks).toBe(1);
      const dispatcher = fixture.makeFiniteDispatcher();
      const selector = Object.freeze({ ...fixture.selector, attemptFence: encodeAttemptFence(fixture.selector.attemptFence) });
      // This is the genuine live selector; recovery must remain busy rather
      // than opening a second lifetime for tracing or testing.
      expect(await Effect.runPromise(dispatcher.redispatchExactPointMutationAttempt(selector))).toEqual({ kind: "busy" });
      const invoke = async (name: string) => {
        const trace = tracing();
        const parent = Tracer.externalSpan({ traceId: `trace-${name}`, spanId: `parent-${name}` });
        const links = [{ span: parent, attributes: { owner: name } }];
        const provide = <A, E>(work: Effect.Effect<A, E>) => work.pipe(
          Effect.provideService(Tracer.Tracer, trace.tracer),
          Effect.provideService(Tracer.ParentSpan, parent),
          Effect.provideService(References.TracerTimingEnabled, false),
          Effect.provideService(References.TracerSpanAnnotations, { caller: name }),
          Effect.provideService(References.TracerSpanLinks, links));
        const refusal = await Effect.runPromiseExit(provide(dispatcher.retryFailedAttempt(new Error("no retry ticket"))));
        expect(Exit.isFailure(refusal)).toBe(true);
        if (Exit.isFailure(refusal)) {
          expect(refusal.cause.reasons).toHaveLength(1);
          const reason = refusal.cause.reasons[0];
          expect(reason !== undefined && Cause.isFailReason(reason) && reason.error).toMatchObject({ reason: "unprovenRetry" });
        }
        expect(await Effect.runPromise(provide(dispatcher.redispatchExactPointMutationAttempt(selector)))).toEqual({ kind: "busy" });
        const roots = trace.spans.filter(span => ["FinitePointMutationExecution.retry", "FinitePointMutationExecution.redispatch"].includes(span.name));
        expect(roots.map(span => span.name)).toEqual(["FinitePointMutationExecution.retry", "FinitePointMutationExecution.redispatch"]);
        for (const span of roots) {
          expect(span.parent).toEqual(Option.some(parent));
          expect(span.traceId).toBe(parent.traceId);
          expect(span.attributes.get("caller")).toBe(name);
          expect(span.links).toEqual(links);
          expect(span.status).toMatchObject({ _tag: "Ended", startTime: 0n, endTime: 0n });
        }
        return trace;
      };
      const [left, right] = await Promise.all([invoke("left"), invoke("right")]);
      expect(left.spans.some(span => right.spans.includes(span))).toBe(false);
      const disabled = tracing();
      const refused = await Effect.runPromiseExit(dispatcher.retryFailedAttempt("unproven").pipe(
        Effect.provideService(Tracer.Tracer, disabled.tracer),
        Effect.provideService(References.TracerEnabled, false),
        Effect.provideService(References.TracerTimingEnabled, false)));
      expect(Exit.isFailure(refused)).toBe(true);
      expect(disabled.spans).toEqual([]);
    } finally { await fixture.close(); }
  }, 180_000);
});
