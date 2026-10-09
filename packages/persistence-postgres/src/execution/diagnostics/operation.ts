import { Context, Effect, Option, References, Tracer, type Fiber } from "effect";

/** Trusted SDK composition only. This policy observes work without changing
 * its value, failure channel, requirements or resource owner. */
export interface ExecutionDiagnosticPolicy {
  observe<Value, Failure, Requirements>(
    name: string,
    work: Effect.Effect<Value, Failure, Requirements>,
  ): Effect.Effect<Value, Failure, Requirements>;
}

export class ExecutionDiagnostics extends Context.Service<ExecutionDiagnostics, ExecutionDiagnosticPolicy>()(
  "Flarex/ExecutionDiagnostics",
) {}

/** Selected stable operations have no diagnostic stack/span construction on
 * quiet requests. Only an explicitly composed SDK policy observes their name. */
export function observeExecution<Value, Failure, Requirements>(
  name: string,
  work: Effect.Effect<Value, Failure, Requirements>,
): Effect.Effect<Value, Failure, Requirements> {
  return Effect.withFiber(fiber => {
    const policy = Context.getOption(fiber.context, ExecutionDiagnostics);
    return Option.isNone(policy) ? work : policy.value.observe(name, work);
  });
}

/** Resolve root policy per invocation. Reference fallback values are not caller
 * configuration; a composed SDK observer is an explicit diagnostic choice. */
export function withExecutionDiagnosticDefaults<Value, Failure, Requirements>(
  work: Effect.Effect<Value, Failure, Requirements>,
): Effect.Effect<Value, Failure, Requirements> {
  return Effect.withFiber(fiber => {
    const context = fiber.context;
    const configured = Context.getOrUndefined(context, ExecutionDiagnostics) !== undefined ||
      Context.getOrUndefined(context, Tracer.Tracer) !== undefined ||
      Context.getOrUndefined(context, Tracer.ParentSpan) !== undefined ||
      Context.getOrUndefined(context, References.TracerEnabled) !== undefined ||
      Context.getOrUndefined(context, References.TracerTimingEnabled) !== undefined ||
      Context.getOrUndefined(context, References.TracerSpanAnnotations) !== undefined ||
      Context.getOrUndefined(context, References.TracerSpanLinks) !== undefined;
    return configured ? work : work.pipe(
      Effect.provideService(References.TracerEnabled, false),
      Effect.provideService(References.TracerTimingEnabled, false),
    );
  });
}

/** Existing independent runtimes carry only diagnostics. In particular, a
 * borrowed database callback must never inherit business services or Clock. */
export function captureExecutionDiagnosticContext(fiber: Fiber.Fiber<unknown, unknown>): Context.Context<never> {
  let context: Context.Context<never> = Context.empty();
  const tracer = Context.getOrUndefined(fiber.context, Tracer.Tracer);
  const parent = fiber.currentSpan ?? Context.getOrUndefined(fiber.context, Tracer.ParentSpan);
  const enabled = Context.getOrUndefined(fiber.context, References.TracerEnabled);
  const timing = Context.getOrUndefined(fiber.context, References.TracerTimingEnabled);
  const annotations = Context.getOrUndefined(fiber.context, References.TracerSpanAnnotations);
  const links = Context.getOrUndefined(fiber.context, References.TracerSpanLinks);
  if (tracer !== undefined) context = Context.add(context, Tracer.Tracer, tracer);
  if (enabled !== undefined) context = Context.add(context, References.TracerEnabled, enabled);
  if (timing !== undefined) context = Context.add(context, References.TracerTimingEnabled, timing);
  if (annotations !== undefined) context = Context.add(context, References.TracerSpanAnnotations, annotations);
  if (links !== undefined) context = Context.add(context, References.TracerSpanLinks, links);
  const policy = Context.getOption(fiber.context, ExecutionDiagnostics);
  if (Option.isSome(policy)) context = Context.add(context, ExecutionDiagnostics, policy.value);
  if (parent !== undefined) context = Context.add(context, Tracer.ParentSpan, parent);
  return context;
}
