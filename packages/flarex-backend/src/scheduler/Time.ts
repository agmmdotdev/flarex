import {
  canonicalIsoInstantFromDate,
  type CanonicalIsoInstant,
} from "@flarex/time/iso-instant";
import { Clock, DateTime, Effect, Result } from "effect";

export type SchedulerContinuationTime = {
  readonly nextRunAt?: string;
};

export const schedulerContinuationIsDue = Effect.fn(
  "SchedulerTime.continuationIsDue",
)(function* (
  pending: SchedulerContinuationTime,
  observedNow?: number,
): Effect.fn.Return<boolean> {
  if (pending.nextRunAt === undefined) return true;
  const now = observedNow ?? (yield* Clock.currentTimeMillis);
  return new Date(pending.nextRunAt).getTime() <= now;
});

export const schedulerCurrentIsoInstant = Effect.fn(
  "SchedulerTime.currentIsoInstant",
)(function* (): Effect.fn.Return<string> {
  return DateTime.formatIso(yield* DateTime.now);
});

export const schedulerIsoInstantAfterDelay = Effect.fn(
  "SchedulerTime.isoInstantAfterDelay",
)(function* <E>(
  delayMilliseconds: number,
  onFailure: (cause: unknown) => E,
): Effect.fn.Return<CanonicalIsoInstant, E> {
  const now = yield* Clock.currentTimeMillis;
  const date = new Date(now + delayMilliseconds);
  return yield* Result.match(canonicalIsoInstantFromDate(date), {
    onSuccess: Effect.succeed,
    onFailure: () => Effect.try({
      try: () => date.toISOString(),
      catch: onFailure,
    }).pipe(
      Effect.flatMap(() => Effect.fail(onFailure(
        new Error("Canonical ISO conversion rejected a natively valid Date"),
      ))),
    ),
  });
});
