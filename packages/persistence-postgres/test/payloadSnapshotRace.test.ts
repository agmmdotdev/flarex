import { Effect } from "effect";
import { expect, it } from "vitest";
import { barrier, overlappingSnapshotRace } from "./payloadRelationScenario";
import { runEffect } from "./effectTestRuntime";

it("joins the competing operation before releasing the held read", async () => {
  const entered = barrier<void>();
  const released = barrier<void>();
  let secondFinished = false;
  let releasedBeforeSecond = false;
  const result = await runEffect(overlappingSnapshotRace(
    Effect.promise(async () => { entered.resolve(); await released.promise; return "first"; }),
    Effect.sync(() => { secondFinished = true; return "second"; }),
    entered.promise,
    () => { releasedBeforeSecond ||= !secondFinished; released.resolve(); },
  ));
  expect(result).toMatchObject([{ value: { success: "first" } }, { value: { success: "second" } }]);
  expect(releasedBeforeSecond).toBe(false);
});

it("interrupts and finalizes both children when the competing operation stalls", async () => {
  const entered = barrier<void>();
  let released = false;
  let firstFinalized = false;
  let secondFinalized = false;
  const failure = await runEffect(overlappingSnapshotRace(
    Effect.sync(() => entered.resolve()).pipe(Effect.andThen(Effect.never),
      Effect.ensuring(Effect.sync(() => { firstFinalized = true; }))),
    Effect.never.pipe(Effect.ensuring(Effect.sync(() => { secondFinalized = true; }))),
    entered.promise,
    () => { released = true; },
  ).pipe(Effect.result, Effect.timeout("10 seconds")));
  expect(failure).toMatchObject({ _tag: "Failure", failure: { _tag: "TimeoutError" } });
  expect({ released, firstFinalized, secondFinalized }).toEqual({ released: true, firstFinalized: true, secondFinalized: true });
}, 15_000);
