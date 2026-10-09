import { Effect, Exit } from "effect";

export type PhysicalSessionObservationPhase = "drain" | "release" | "cancel" | "quarantine";

/** Diagnostic scalars only: no connection, cancellation credentials or Cause. */
export type PhysicalSessionObservationEvent = Readonly<{
  kind: "phase";
  phase: PhysicalSessionObservationPhase;
  edge: "begin" | "end";
  outcome?: "success" | "failure";
}>;

/** Trusted diagnostic composition retains the work's channels and lifetime.
 * A successful Effect may still return an owner-classified failure verdict. */
export interface PhysicalSessionEffectDecorator {
  <Value, Failure, Requirements>(
    phase: PhysicalSessionObservationPhase,
    work: Effect.Effect<Value, Failure, Requirements>,
    isFailure?: (value: Value) => boolean,
  ): Effect.Effect<Value, Failure, Requirements>;
}

/** Delivery failures invalidate evidence after the business owner settles. */
export class PhysicalSessionObservation {
  private readonly deliver: (event: PhysicalSessionObservationEvent) => void;
  private readonly traceEffect: PhysicalSessionEffectDecorator | undefined;
  private failureCount = 0;
  private firstFailure: unknown;

  constructor(input: Readonly<{
    record: (event: PhysicalSessionObservationEvent) => void;
    traceEffect?: PhysicalSessionEffectDecorator;
  }>) {
    this.deliver = input.record;
    this.traceEffect = input.traceEffect;
  }

  record(event: PhysicalSessionObservationEvent): void {
    const detached = Object.freeze({ ...event });
    // Only the foreign delivery callback belongs inside this rejection boundary.
    try { this.deliver(detached); }
    catch (cause) { this.recordFailure(cause); }
  }

  decorateEffect<Value, Failure, Requirements>(
    phase: PhysicalSessionObservationPhase,
    work: Effect.Effect<Value, Failure, Requirements>,
    isFailure?: (value: Value) => boolean,
  ): Effect.Effect<Value, Failure, Requirements> | undefined {
    if (this.traceEffect === undefined) return undefined;
    // Decoration constructs a lazy description; the original work has not run.
    // Runtime delivery faults stay with the decorator's diagnostic owner.
    try { return this.traceEffect(phase, work, isFailure); }
    catch (cause) { this.recordFailure(cause); return work; }
  }

  classifyOutcome<Value>(value: Value, isFailure: ((value: Value) => boolean) | undefined):
    "success" | "failure" | undefined {
    if (isFailure === undefined) return "success";
    // Classification is diagnostic callback delivery, never business recovery.
    try { return isFailure(value) ? "failure" : "success"; }
    catch (cause) { this.recordFailure(cause); return undefined; }
  }

  private recordFailure(cause: unknown): void {
    if (this.failureCount === 0) this.firstFailure = cause;
    this.failureCount = Math.min(Number.MAX_SAFE_INTEGER, this.failureCount + 1);
  }

  status(): Readonly<{ failureCount: number }> {
    return Object.freeze({ failureCount: this.failureCount });
  }

  assertHealthy(): void {
    if (this.failureCount !== 0)
      throw new Error("Physical-session observation failed", { cause: this.firstFailure });
  }
}

export function observePhysicalSessionEffect<Value, Failure, Requirements>(
  observation: PhysicalSessionObservation | undefined,
  phase: PhysicalSessionObservationPhase,
  work: Effect.Effect<Value, Failure, Requirements>,
  isFailure?: (value: Value) => boolean,
): Effect.Effect<Value, Failure, Requirements> {
  if (observation === undefined) return work;
  const decorated = observation.decorateEffect(phase, work, isFailure);
  if (decorated !== undefined) return decorated;
  return Effect.sync(() => observation.record({ kind: "phase", phase, edge: "begin" })).pipe(
    Effect.andThen(work),
    Effect.onExit(exit => Effect.sync(() => {
      const outcome = Exit.isFailure(exit) ? "failure" : observation.classifyOutcome(exit.value, isFailure);
      observation.record({ kind: "phase", phase, edge: "end", ...(outcome === undefined ? {} : { outcome }) });
    })),
  );
}
