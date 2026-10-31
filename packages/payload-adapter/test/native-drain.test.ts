import { APIError } from "payload";
import { Cause, Effect, Exit, Fiber } from "effect";
import { expect, it } from "vitest";
import { makePayloadNative } from "../src/runtime/native";
import { bindPayloadDirect } from "../src/direct/binding";
import { createCorePayloadFixture } from "../../medusa-adapter/test/support/core-payload-fixture";
import { barrier } from "../../persistence-postgres/test/integration/payload/payloadRelationScenario";

it.each(["known", "defect"] as const)("drains the actual Local API Promise before closing and preserves its %s rejection with interruption", async kind => {
  const entered = barrier<void>();
  const release = barrier<void>();
  let armed = false;
  let nativeFinished = false;
  const rejection = kind === "known" ? new APIError("late native rejection", 403) : new Error("late native defect");
  const fixture = await createCorePayloadFixture("pglite", { makeRuntime: compiled => Effect.gen(function* () {
    const native = yield* makePayloadNative(compiled, { hooks: {
      afterRead: [async ({ doc }) => {
        if (!armed) return doc;
        entered.resolve();
        await release.promise;
        nativeFinished = true;
        throw rejection;
      }],
    } });
    return bindPayloadDirect(native);
  }) });
  try {
    await fixture.run(Effect.gen(function* () {
      const created = yield* fixture.writer.create(fixture.writer.newRequestKey(), { collection: "news", data: { title: "drain" } });
      armed = true;
      const cancellation = new AbortController();
      const pending = Effect.runFork(fixture.reader.findByID({ collection: "news", id: created.id }), { signal: cancellation.signal });
      yield* Effect.promise(() => entered.promise);
      cancellation.abort();
      const closing = yield* fixture.reader.close.pipe(Effect.forkScoped);
      yield* Effect.yieldNow;
      expect(nativeFinished).toBe(false);
      expect(pending.pollUnsafe()).toBeUndefined();
      expect(closing.pollUnsafe()).toBeUndefined();
      release.resolve();
      const outcome = yield* Fiber.await(pending);
      expect(Exit.isFailure(outcome)).toBe(true);
      if (Exit.isFailure(outcome)) {
        expect(Cause.hasInterrupts(outcome.cause)).toBe(true);
        if (kind === "known") expect(outcome.cause.reasons.filter(reason => Cause.isFailReason(reason) && reason.error.reason === "invalidInput"
          && reason.error.cause === rejection), Cause.pretty(outcome.cause)).toHaveLength(1);
        else expect(outcome.cause.reasons.filter(reason => Cause.isDieReason(reason) && reason.defect === rejection), Cause.pretty(outcome.cause)).toHaveLength(1);
      }
      yield* Fiber.join(closing);
      expect(nativeFinished).toBe(true);
    }));
  } finally { release.resolve(); await fixture.close(); }
}, 180_000);
