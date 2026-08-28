import { Clock, DateTime, Effect } from "effect";

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
