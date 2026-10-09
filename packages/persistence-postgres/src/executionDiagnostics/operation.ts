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

/** Existing independent runtimes carry only diagnostics. In particular, a
 * borrowed database callback must never inherit business services or Clock. */
export function captureExecutionDiagnosticContext(fiber: Fiber.Fiber<unknown, unknown>): Context.Context<never> {
  let context: Context.Context<never> = Context.make(Tracer.Tracer, Context.get(fiber.context, Tracer.Tracer));
  context = Context.add(context, References.TracerEnabled, Context.get(fiber.context, References.TracerEnabled));
  context = Context.add(context, References.TracerTimingEnabled, Context.get(fiber.context, References.TracerTimingEnabled));
  const policy = Context.getOption(fiber.context, ExecutionDiagnostics);
  if (Option.isSome(policy)) context = Context.add(context, ExecutionDiagnostics, policy.value);
  if (fiber.currentSpan !== undefined) context = Context.add(context, Tracer.ParentSpan, fiber.currentSpan);
  return context;
}
