import { Context, Effect, References, Tracer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { prepareMixedMutationPerformanceSeries } from "./mixedMutationProductFixture";
import type { MixedMutationEffectDiagnostics } from "./measurement";

describe.each(["pglite", "postgres"] as const)("mixed fixture diagnostic policy (%s)", driver => {
  it.skipIf(driver === "postgres" && process.env.FLAREX_POSTGRES_DATABASE_URL === undefined)(
    "defaults every request runner while preserving explicitly configured tracing per request", async () => {
      const series = await prepareMixedMutationPerformanceSeries({ driver, suffix: `fixture-tracing-${driver}`,
        profile: "workflow", sampleCount: 3 });
      const defaultTracer = Context.get(Context.empty(), Tracer.Tracer);
      const defaultSpans = vi.spyOn(defaultTracer, "span");
      const spans: Tracer.Span[] = [];
      const tracer = Tracer.make({ span: options => {
        const span = new Tracer.NativeSpan(options);
        spans.push(span);
        return span;
      } });
      const parent = Tracer.externalSpan({ traceId: "fixture-caller", spanId: "fixture-parent" });
      const provide = <A, E, R>(work: Effect.Effect<A, E, R>) => work.pipe(
        Effect.provideService(Tracer.Tracer, tracer),
        Effect.provideService(Tracer.ParentSpan, parent),
        Effect.provideService(References.TracerEnabled, true),
        Effect.provideService(References.TracerTimingEnabled, false),
        Effect.provideService(References.TracerSpanAnnotations, { caller: "fixture-test" }));
      const diagnostics: MixedMutationEffectDiagnostics = {
        provide, provideRequest: provide,
        traceEffect: (name, work) => work.pipe(Effect.withSpan(name)),
        withPhase: (_name, run) => run(),
      };
      try {
        for (let index = 0; index < 3; index++) {
          series.setEffectDiagnostics(index === 1 ? diagnostics : undefined);
          await series.prepareAttempt(index);
          defaultSpans.mockClear();
          const priorConfiguredSpans = spans.length;
          const result = await series.runAttempt(index);
          expect(result.publication.kind).toBe("published");
          expect(result.canonicalResultBytes).toBeGreaterThan(0);
          if (index === 1) {
            const configured = spans.slice(priorConfiguredSpans);
            // These are the independent runners owned by this fixture. Other
            // configured lifecycle adapters retain their existing tracing policy.
            const names = ["ApplicationMutationGrant.prepareV1", "ApplicationMutationGrant.verifyV1",
              "PointMutationExactRuntimeProtocol.decodeRequest", "PointMutationExactRuntimeProtocol.decodeResult"];
            for (const name of names) expect(configured.some(span => span.name === name)).toBe(true);
            for (const span of configured.filter(span => names.includes(span.name))) {
              expect(span.traceId).toBe(parent.traceId);
              expect(span.attributes.get("caller")).toBe("fixture-test");
              expect(span.status).toMatchObject({ _tag: "Ended", startTime: 0n, endTime: 0n });
            }
          } else {
            expect(defaultSpans, `quiet request ${index}`).not.toHaveBeenCalled();
            expect(spans).toHaveLength(priorConfiguredSpans);
          }
        }
      } finally {
        try { await series.close(); }
        finally { defaultSpans.mockRestore(); }
      }
    }, 240_000);
});
