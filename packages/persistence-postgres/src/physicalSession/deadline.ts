import { Clock, Effect } from "effect";
import type {
  PhysicalDeadlineErrors,
  PhysicalDeadlineKind,
  PhysicalSessionPhase,
} from "./model";
const physicalDeadlineBrand: unique symbol = Symbol(
  "FlarexDB/PhysicalDeadline",
);
export interface PhysicalDeadline {
  readonly [physicalDeadlineBrand]: true;
}
interface PhysicalDeadlineState {
  readonly kind: PhysicalDeadlineKind;
  readonly startedAtNanoseconds: bigint;
  readonly expiresAtNanoseconds: bigint;
}
const deadlineStates = new WeakMap<object, PhysicalDeadlineState>();
/**
 * Lifecycle-free projections over one authenticated deadline registry.
 * These hot-path pipeline factories preserve uninstrumented construction;
 * physical operations own tracing rather than every deadline check.
 */
export function makePhysicalDeadlineOperations<DeadlineIssue>(
  errors: PhysicalDeadlineErrors<DeadlineIssue>,
) {
  /** Capture one absolute Effect-clock deadline. */
  const start = function start(
    kind: PhysicalDeadlineKind,
    timeoutMilliseconds: number,
  ): Effect.Effect<PhysicalDeadline, never, never> {
    if (
      !Number.isSafeInteger(timeoutMilliseconds) ||
      timeoutMilliseconds <= 0
    ) {
      return Effect.die(
        errors.invariant({
          reason: "invalidDeadlineDuration",
        }),
      );
    }

    return Clock.currentTimeNanos.pipe(
      Effect.map((startedAtNanoseconds) => {
        const deadline = Object.freeze({
          [physicalDeadlineBrand]: true,
        } satisfies PhysicalDeadline);
        deadlineStates.set(
          deadline,
          Object.freeze({
            kind,
            startedAtNanoseconds,
            expiresAtNanoseconds:
              startedAtNanoseconds + BigInt(timeoutMilliseconds) * 1_000_000n,
          } satisfies PhysicalDeadlineState),
        );
        return deadline;
      }),
    );
  };

  /** Read the positive remaining whole-millisecond budget from one deadline. */
  const remaining = function remaining(
    deadline: PhysicalDeadline,
    phase: PhysicalSessionPhase,
  ): Effect.Effect<number, DeadlineIssue, never> {
    const state = deadlineStates.get(deadline);
    if (state === undefined) {
      return Effect.die(
        errors.invariant({
          reason: "invalidDeadline",
        }),
      );
    }

    return Clock.currentTimeNanos.pipe(
      Effect.flatMap((currentNanoseconds) => {
        const remainingNanoseconds =
          state.expiresAtNanoseconds - currentNanoseconds;
        const remainingMilliseconds = remainingNanoseconds / 1_000_000n;
        if (remainingMilliseconds < 1n) {
          return Effect.fail(
            errors.deadline({
              deadlineKind: state.kind,
              phase,
            }),
          );
        }
        return Effect.succeed(Number(remainingMilliseconds));
      }),
    );
  };

  /** Fail one in-flight phase with the authenticated deadline's exact kind. */
  const fail = function fail(
    deadline: PhysicalDeadline,
    phase: PhysicalSessionPhase,
  ): Effect.Effect<never, DeadlineIssue, never> {
    const state = deadlineStates.get(deadline);
    return state === undefined
      ? Effect.die(
          errors.invariant({
            reason: "invalidDeadline",
          }),
        )
      : Effect.fail(
          errors.deadline({
            deadlineKind: state.kind,
            phase,
          }),
        );
  };

  const requireKind = (
    deadline: PhysicalDeadline,
    expectedKind: PhysicalDeadlineKind,
  ) =>
    deadlineStates.get(deadline)?.kind === expectedKind
      ? Effect.void
      : Effect.die(errors.invariant({ reason: "invalidDeadline" }));

  return { start, remaining, fail, requireKind };
}
