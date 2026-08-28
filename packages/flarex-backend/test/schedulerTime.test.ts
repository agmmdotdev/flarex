import { Effect } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";

import {
  schedulerContinuationIsDue,
  schedulerCurrentIsoInstant,
  schedulerIsoInstantAfterDelay,
} from "../src/scheduler/Time";

describe("scheduler time", () => {
  it("reads current scheduler time from the Effect clock", async () => {
    const observed = await Effect.runPromise(
      Effect.gen(function* () {
        yield* TestClock.setTime(Date.parse("2026-08-28T12:34:56.789Z"));
        return {
          currentIsoInstant: yield* schedulerCurrentIsoInstant(),
          delayedIsoInstant: yield* schedulerIsoInstantAfterDelay(211, cause => cause),
          due: yield* schedulerContinuationIsDue({
            nextRunAt: "2026-08-28T12:34:56.789Z",
          }),
          pending: yield* schedulerContinuationIsDue({
            nextRunAt: "2026-08-28T12:34:56.790Z",
          }),
        };
      }).pipe(Effect.provide(TestClock.layer())),
    );

    expect(observed).toEqual({
      currentIsoInstant: "2026-08-28T12:34:56.789Z",
      delayedIsoInstant: "2026-08-28T12:34:57.000Z",
      due: true,
      pending: false,
    });
  });

  it("maps delayed ISO formatting failures through the owning boundary", async () => {
    const failure = await Effect.runPromise(Effect.gen(function* () {
      yield* TestClock.setTime(8_640_000_000_000_000);
      return yield* schedulerIsoInstantAfterDelay(1, cause => cause).pipe(Effect.flip);
    }).pipe(Effect.provide(TestClock.layer())));

    expect(failure).toBeInstanceOf(RangeError);
  });

  it("preserves missing-date and explicit platform-observation behavior", async () => {
    await expect(Effect.runPromise(Effect.gen(function* () {
      yield* TestClock.setTime(Date.parse("2026-08-28T12:34:56.790Z"));
      expect(yield* schedulerContinuationIsDue({})).toBe(true);
      expect(yield* schedulerContinuationIsDue({
        nextRunAt: "2026-08-28T12:34:56.789Z",
      }, Date.parse("2026-08-28T12:34:56.788Z"))).toBe(false);
    }).pipe(Effect.provide(TestClock.layer())))).resolves.toBeUndefined();
  });
});
