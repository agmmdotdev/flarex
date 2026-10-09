import { Clock, Context, Effect, Option, References, Scope, Tracer } from "effect";
import { describe, expect, it } from "vitest";
import { captureExecutionDiagnosticContext, ExecutionDiagnostics, observeExecution, withExecutionDiagnosticDefaults, type ExecutionDiagnosticPolicy } from "../src/executionDiagnostics/operation";

const Unrelated = Context.Service<{ readonly secret: string }>("ExecutionDiagnosticsTest/Unrelated");
const snapshot = Effect.withFiber(fiber => Effect.succeed({
  enabled: Context.get(fiber.context, References.TracerEnabled),
  timing: Context.get(fiber.context, References.TracerTimingEnabled),
  parent: fiber.currentSpan,
}));
const named = Effect.fn("ExecutionDiagnosticsTest.root")(() => snapshot);
function collector() {
  const spans: Tracer.Span[] = [];
  const tracer = Tracer.make({ span: options => {
    const span = new Tracer.NativeSpan(options);
    spans.push(span);
    return span;
  } });
  return { spans, tracer };
}

describe("private core invocation tracing", () => {
  it("disables tracing and timing before the named root, without treating Reference defaults as configuration", async () => {
    expect(Context.get(Context.empty(), References.TracerEnabled)).toBe(true);
    expect(Context.getOrUndefined(Context.empty(), References.TracerEnabled)).toBeUndefined();
    let clockReads = 0;
    const live = Context.get(Context.empty(), Clock.Clock);
    const clock: Clock.Clock = { ...live, currentTimeNanosUnsafe: () => { clockReads++; return 17n; } };
    const result = await Effect.runPromise(withExecutionDiagnosticDefaults(named()).pipe(Effect.provideService(Clock.Clock, clock)));
    expect(result.enabled).toBe(false);
    expect(result.timing).toBe(false);
    expect(result.parent).toBeDefined();
    if (result.parent === undefined) throw new Error("Missing named root span");
    expect(Context.get(result.parent.annotations, Tracer.DisablePropagation)).toBe(true);
    expect(clockReads).toBe(0);
  });

  it.each([true, false])("preserves an explicit enabled=%s setting ahead of tracer presence", async enabled => {
    const trace = collector();
    const result = await Effect.runPromise(withExecutionDiagnosticDefaults(named()).pipe(
      Effect.provideService(Tracer.Tracer, trace.tracer),
      Effect.provideService(References.TracerEnabled, enabled),
      Effect.provideService(References.TracerTimingEnabled, false),
    ));
    expect(result.enabled).toBe(enabled);
    expect(result.timing).toBe(false);
    expect(trace.spans.map(span => span.name)).toEqual(enabled ? ["ExecutionDiagnosticsTest.root"] : []);
    if (enabled) expect(trace.spans[0]?.status).toMatchObject({ _tag: "Ended", startTime: 0n, endTime: 0n });
  });

  it("retains supplied tracer, parent, annotations and links on the named root", async () => {
    const trace = collector();
    const parent = Tracer.externalSpan({ traceId: "caller-trace", spanId: "caller-parent" });
    const linked = Tracer.externalSpan({ traceId: "linked-trace", spanId: "linked-parent" });
    const result = await Effect.runPromise(withExecutionDiagnosticDefaults(named()).pipe(
      Effect.provideService(Tracer.Tracer, trace.tracer),
      Effect.withParentSpan(parent),
      Effect.annotateSpans({ request: "caller" }),
      Effect.linkSpans(linked, { relation: "caller" }),
    ));
    expect(result.enabled).toBe(true);
    expect(result.timing).toBe(true);
    const root = trace.spans[0];
    if (root === undefined) throw new Error("Missing configured root span");
    expect(Option.getOrUndefined(root.parent)).toBe(parent);
    expect(root.attributes.get("request")).toBe("caller");
    expect(root.links).toEqual([{ span: linked, attributes: { relation: "caller" } }]);
  });

  it.each(["parent", "enabled", "timing", "annotations", "links"] as const)(
    "recognizes explicitly supplied %s without requiring a tracer", async field => {
      const parent = Tracer.externalSpan({ traceId: "request", spanId: "parent" });
      const effect = withExecutionDiagnosticDefaults(named());
      const configured = field === "parent" ? effect.pipe(Effect.withParentSpan(parent))
        : field === "enabled" ? effect.pipe(Effect.provideService(References.TracerEnabled, true))
        : field === "timing" ? effect.pipe(Effect.provideService(References.TracerTimingEnabled, false))
        : field === "annotations" ? effect.pipe(Effect.annotateSpans({ request: "annotation" }))
        : effect.pipe(Effect.linkSpans(parent));
      const result = await Effect.runPromise(configured);
      expect(result.enabled).toBe(true);
      expect(result.timing).toBe(field !== "timing");
      if (result.parent === undefined) throw new Error("Missing configured root span");
      expect(Context.get(result.parent.annotations, Tracer.DisablePropagation)).toBe(false);
    },
  );

  it("resolves the same invocation Effect anew under concurrent and later caller configurations", async () => {
    const effect = withExecutionDiagnosticDefaults(Effect.yieldNow.pipe(Effect.andThen(named())));
    const first = collector();
    const second = collector();
    const [quiet, enabled, disabled] = await Promise.all([
      Effect.runPromise(effect),
      Effect.runPromise(effect.pipe(Effect.withTracer(first.tracer))),
      Effect.runPromise(effect.pipe(Effect.withTracer(second.tracer), Effect.provideService(References.TracerEnabled, false))),
    ]);
    expect([quiet.enabled, enabled.enabled, disabled.enabled]).toEqual([false, true, false]);
    expect(first.spans).toHaveLength(1);
    expect(second.spans).toHaveLength(0);
    expect((await Effect.runPromise(effect)).enabled).toBe(false);
  });

  it("honors an SDK-only policy while preserving explicit disabled tracing", async () => {
    const policy: ExecutionDiagnosticPolicy = {
      observe: (name, work) => Effect.useSpan(name, {}, span => Effect.provideService(work, Tracer.ParentSpan, span)),
    };
    const work = withExecutionDiagnosticDefaults(observeExecution("sdk root", snapshot));
    const enabled = await Effect.runPromise(work.pipe(Effect.provideService(ExecutionDiagnostics, policy)));
    expect(enabled.enabled).toBe(true);
    expect(enabled.timing).toBe(true);
    const disabled = await Effect.runPromise(work.pipe(Effect.provideService(ExecutionDiagnostics, policy),
      Effect.provideService(References.TracerEnabled, false), Effect.provideService(References.TracerTimingEnabled, false)));
    expect(disabled.enabled).toBe(false);
    expect(disabled.timing).toBe(false);
  });

  it("projects actual trace entries without materializing defaults or transferring capabilities", async () => {
    const empty = await Effect.runPromise(Effect.withFiber(fiber => Effect.succeed(captureExecutionDiagnosticContext(fiber))));
    expect(Context.getOrUndefined(empty, Tracer.Tracer)).toBeUndefined();
    expect(Context.getOrUndefined(empty, References.TracerEnabled)).toBeUndefined();
    expect(Context.getOrUndefined(empty, References.TracerTimingEnabled)).toBeUndefined();
    expect(Context.getOrUndefined(empty, References.TracerSpanAnnotations)).toBeUndefined();
    expect(Context.getOrUndefined(empty, References.TracerSpanLinks)).toBeUndefined();
    expect(Context.getOrUndefined(empty, Tracer.ParentSpan)).toBeUndefined();
    expect(Context.getOrUndefined(empty, ExecutionDiagnostics)).toBeUndefined();
    await Effect.runPromise(Effect.scoped(Effect.withFiber(fiber => Effect.sync(() => {
      expect(Context.getOrUndefined(fiber.context, Scope.Scope)).toBeDefined();
      const projected = captureExecutionDiagnosticContext(fiber);
      expect(Context.getOrUndefined(projected, Scope.Scope)).toBeUndefined();
      expect(Context.getOrUndefined(projected, Clock.Clock)).toBeUndefined();
      expect(Context.getOrUndefined(projected, Unrelated)).toBeUndefined();
      expect(Context.getOrUndefined(projected, References.TracerEnabled)).toBe(false);
    }))).pipe(Effect.provideService(Unrelated, { secret: "private" }),
      Effect.provideService(Clock.Clock, Context.get(Context.empty(), Clock.Clock)),
      Effect.provideService(References.TracerEnabled, false)));
  });
});
