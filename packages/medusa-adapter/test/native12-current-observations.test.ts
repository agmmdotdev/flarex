import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Deferred, Effect, Fiber } from "effect";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { createCoreCurrencyFixture, type CoreCurrencyFixture } from "./support/core-currency-fixture";
import { awaitNative12Pause, expectNative12Failure, makeNative12CurrentObservations, native12Arguments,
  native12RemoveAbsentProbe, native12DataInventory } from "./support/native12-current-observations";

// No SQL transaction spans a callback; both drivers exercise real competing roots.
for (const driver of ["pglite", "postgres"] as const) {
  describe.skipIf(driver === "postgres" && postgresUrl === null)(`Native12 current-profile observations on ${driver}`, () => {
    const cleanup: Array<() => Promise<void>> = [];
    let fixture: CoreCurrencyFixture;
    beforeAll(async () => {
      fixture = await createCoreCurrencyFixture(driver, { commands: [native12RemoveAbsentProbe] });
      cleanup.push(() => fixture.close());
    }, 180_000);
    afterAll(async () => {
      const failures: unknown[] = [];
      for (const close of cleanup.reverse()) await close().catch(cause => failures.push(cause));
      if (failures.length > 0) throw new AggregateError(failures, "Native12 current-profile cleanup failed");
    });

    it("retains pending native/CMS writes and replays without rerunning callbacks", async () => {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const scenario = yield* makeNative12CurrentObservations(fixture);
        const selected = yield* scenario.announcement(async ({ internal, service, context }) => {
          await internal.upsert([{ code: "xpa", name: "Pending original", symbol: "N", symbol_native: "N" }], context);
          expect(await service.retrieveCurrency("xpa", {}, context)).toMatchObject({ name: "Pending original" });
          await internal.upsert([{ code: "xpa", name: "Pending updated" }], context);
          expect(await service.listCurrencies({ code: ["xpa"] }, {}, context))
            .toMatchObject([{ code: "xpa", name: "Pending updated" }]);
        });
        const before = yield* Effect.promise(() => native12DataInventory(fixture));
        const key = selected.host.newRequestKey();
        const args = native12Arguments("xpb", "nested-ok");
        const value = yield* selected.host.run(key, args);
        expect(value).toMatchObject({ currency: { code: "xpb" }, cms: { title: "nested-ok" }, applicationId: expect.any(String) });
        const after = yield* Effect.promise(() => native12DataInventory(fixture));
        expect(after.commits).toHaveLength(before.commits.length + 1);
        expect(after.rowChanges).toHaveLength(before.rowChanges.length + 5);
        expect(selected.calls()).toBe(1);
        expect(scenario.native.observations.hookRuns()).toBe(1);
        expect(scenario.native.observations.executions()).toBe(1);
        expect(yield* selected.host.run(key, args)).toEqual(value);
        expect(selected.calls()).toBe(1);
        expect(scenario.native.observations.hookRuns()).toBe(1);
        expect(scenario.native.observations.executions()).toBe(1);
        expect(yield* Effect.promise(() => native12DataInventory(fixture))).toEqual(after);
      }).pipe(Effect.timeout("60 seconds"))));
    }, 90_000);

    it("poisons the whole root when a native Payload nested failure is swallowed", async () => {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const scenario = yield* makeNative12CurrentObservations(fixture);
        const selected = yield* scenario.announcement(async ({ service, context }) => {
          expect(await service.listCurrencies({ code: ["xpc"] }, {}, context)).toEqual([]);
        });
        const before = yield* Effect.promise(() => native12DataInventory(fixture));
        const exit = yield* Effect.exit(selected.host.run(selected.host.newRequestKey(), native12Arguments("xpc", "nested-caught")));
        expectNative12Failure(exit, "rollbackOnly");
        expect(selected.calls()).toBe(1);
        expect(scenario.native.observations.hookRuns()).toBe(1);
        expect(scenario.native.observations.executions()).toBe(1);
        expect(yield* Effect.promise(() => native12DataInventory(fixture))).toEqual(before);
      }).pipe(Effect.timeout("60 seconds"))));
    }, 90_000);

    it("retains touched A while untouched B sees a later publication", async () => {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const scenario = yield* makeNative12CurrentObservations(fixture);
        yield* scenario.publish("xaa", "A before");
        yield* scenario.publish("xac", "B before");
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const observed: unknown[] = [];
        const selected = yield* scenario.announcement(async ({ service, context }) => {
          observed.push(await service.retrieveCurrency("xaa", {}, context));
          await Effect.runPromise(Deferred.succeed(entered, undefined));
          await Effect.runPromise(Deferred.await(release));
          observed.push(await service.retrieveCurrency("xaa", {}, context));
          observed.push(await service.retrieveCurrency("xac", {}, context));
        });
        yield* Effect.gen(function* () {
          const fiber = yield* selected.host.run(selected.host.newRequestKey(), native12Arguments("xad", "Touched and untouched")).pipe(Effect.forkScoped);
          yield* awaitNative12Pause(entered, fiber);
          yield* scenario.publish("xaa", "A after");
          yield* scenario.publish("xac", "B after");
          const afterCompetitor = yield* Effect.promise(() => native12DataInventory(fixture));
          yield* Deferred.succeed(release, undefined);
          expectNative12Failure(yield* Fiber.await(fiber), "writeConflict");
          expect(observed).toMatchObject([{ code: "xaa", name: "A before" }, { code: "xaa", name: "A before" },
            { code: "xac", name: "B after" }]);
          expect(selected.calls()).toBe(1);
          expect(scenario.native.observations.executions()).toBe(1);
          expect(yield* Effect.promise(() => native12DataInventory(fixture))).toEqual(afterCompetitor);
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("30 seconds"));
      })));
    }, 90_000);

    it("accepts an ordinary missing-code list after create and hard-delete restore absence", async () => {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const scenario = yield* makeNative12CurrentObservations(fixture);
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const observed: unknown[] = [];
        const selected = yield* scenario.announcement(async ({ service, context }) => {
          observed.push(await service.listCurrencies({ code: ["xab"] }, {}, context));
          await Effect.runPromise(Deferred.succeed(entered, undefined));
          await Effect.runPromise(Deferred.await(release));
          observed.push(await service.listCurrencies({ code: ["xab"] }, {}, context));
        });
        yield* Effect.gen(function* () {
          const fiber = yield* selected.host.run(selected.host.newRequestKey(), native12Arguments("xae", "Missing code ABA")).pipe(Effect.forkScoped);
          yield* awaitNative12Pause(entered, fiber);
          yield* scenario.publish("xab", "Temporary native owner");
          yield* scenario.removeAbsentProbe();
          const afterCompetitor = yield* Effect.promise(() => native12DataInventory(fixture));
          yield* Deferred.succeed(release, undefined);
          expect(yield* Fiber.join(fiber)).toMatchObject({ currency: { code: "xae" }, cms: { title: "Missing code ABA" } });
          expect(observed).toEqual([[], []]);
          expect(selected.calls()).toBe(1);
          expect(scenario.native.observations.executions()).toBe(1);
          const after = yield* Effect.promise(() => native12DataInventory(fixture));
          expect(after.commits).toHaveLength(afterCompetitor.commits.length + 1);
          expect(after.rowChanges).toHaveLength(afterCompetitor.rowChanges.length + 3);
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("30 seconds"));
      })));
    }, 90_000);

    it("repeats a captured code with the old body and conflicts only at root settlement", async () => {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const scenario = yield* makeNative12CurrentObservations(fixture);
        yield* scenario.publish("xaf", "Captured before");
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        const observed: unknown[] = [];
        const selected = yield* scenario.announcement(async ({ service, context }) => {
          observed.push(await service.retrieveCurrency("xaf", {}, context));
          await Effect.runPromise(Deferred.succeed(entered, undefined));
          await Effect.runPromise(Deferred.await(release));
          observed.push(await service.retrieveCurrency("xaf", {}, context));
        });
        yield* Effect.gen(function* () {
          const fiber = yield* selected.host.run(selected.host.newRequestKey(), native12Arguments("xag", "Repeated code capture")).pipe(Effect.forkScoped);
          yield* awaitNative12Pause(entered, fiber);
          yield* scenario.publish("xaf", "Captured after");
          const afterCompetitor = yield* Effect.promise(() => native12DataInventory(fixture));
          yield* Deferred.succeed(release, undefined);
          expectNative12Failure(yield* Fiber.await(fiber), "writeConflict");
          expect(observed).toMatchObject([{ code: "xaf", name: "Captured before" }, { code: "xaf", name: "Captured before" }]);
          expect(selected.calls()).toBe(1);
          expect(scenario.native.observations.executions()).toBe(1);
          expect(yield* Effect.promise(() => native12DataInventory(fixture))).toEqual(afterCompetitor);
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("30 seconds"));
      })));
    }, 90_000);

    // Native code membership compiles into one unique-key selection per code.
    // The default ascending list instead captures bodies through findPage and
    // retains a page witness, without capturing unique slots or a full scan.
    for (const capture of ["code-list", "native-page"] as const) {
      it(`checks native ${capture} capture at its real conflict checkpoint`, async () => {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const scenario = yield* makeNative12CurrentObservations(fixture);
          // Keep the body-only page bounded and ensure its target sorts first;
          // prior scenarios must not turn this checkpoint witness into a broad
          // catalog read that exceeds the independent native capture budget.
          const code = capture === "code-list" ? "xah" : "aab";
          yield* scenario.publish(code, "Body before");
          const entered = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          let before: unknown;
          let after: unknown;
          let bodyCompleted = false;
          let callbackPhase = "not entered";
          let coordinatorPhase = "before fork";
          const selected = yield* scenario.announcement(async ({ service, context }) => {
            callbackPhase = "initial native list";
            before = await service.listCurrencies(capture === "code-list" ? { code: [code, "usd"] } : {},
              capture === "native-page" ? { take: 1 } : {}, context);
            callbackPhase = "awaiting competitor release";
            await Effect.runPromise(Deferred.succeed(entered, undefined));
            await Effect.runPromise(Deferred.await(release));
            callbackPhase = "scalar lookup";
            after = await service.retrieveCurrency(code, {}, context);
            bodyCompleted = true;
            callbackPhase = "body complete";
          });
          yield* Effect.gen(function* () {
            const fiber = yield* selected.host.run(selected.host.newRequestKey(),
              native12Arguments(capture === "code-list" ? "xaj" : "xak", `Code after ${capture}`)).pipe(Effect.forkScoped);
            coordinatorPhase = "awaiting callback pause";
            yield* awaitNative12Pause(entered, fiber);
            expect(before).toEqual(expect.arrayContaining([expect.objectContaining({ code, name: "Body before" })]));
            if (capture === "native-page") expect(before).toHaveLength(1);
            coordinatorPhase = "publishing competitor";
            yield* scenario.publish(code, "Body after");
            coordinatorPhase = "reading competitor inventory";
            const afterCompetitor = yield* Effect.promise(() => native12DataInventory(fixture));
            yield* Deferred.succeed(release, undefined);
            coordinatorPhase = "awaiting root completion";
            expectNative12Failure(yield* Fiber.await(fiber), "writeConflict");
            expect(bodyCompleted).toBe(capture === "code-list");
            if (capture === "code-list") expect(after).toMatchObject({ code, name: "Body before" });
            else expect(after).toBeUndefined();
            expect(selected.calls()).toBe(1);
            expect(scenario.native.observations.executions()).toBe(capture === "code-list" ? 1 : 0);
            expect(yield* Effect.promise(() => native12DataInventory(fixture))).toEqual(afterCompetitor);
          }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("30 seconds"),
            Effect.tapCause(() => Effect.sync(() => console.error("Native12 observation failure phase", {
              capture, callbackPhase, coordinatorPhase,
            }))));
        })));
      }, 90_000);
    }
  });

  describe.skipIf(driver === "postgres" && postgresUrl === null)(`Native12 complete native count on ${driver}`, () => {
    it("keeps an unfiltered with-deleted count as ordinary primary range before first unique lookup", async () => {
      const fixture = await createCoreCurrencyFixture(driver, { commands: [native12RemoveAbsentProbe] });
      try {
        await fixture.run(Effect.scoped(Effect.gen(function* () {
          const scenario = yield* makeNative12CurrentObservations(fixture);
          yield* scenario.publish("aab", "Count before");
          const entered = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          let bodyCompleted = false;
          const selected = yield* scenario.announcement(async ({ service, context }) => {
            const [rows, count] = await service.listAndCountCurrencies({}, { take: 1, withDeleted: true }, context);
            expect(rows).toHaveLength(1); expect(count).toBe(124);
            await Effect.runPromise(Deferred.succeed(entered, undefined));
            await Effect.runPromise(Deferred.await(release));
            await service.retrieveCurrency("aab", {}, context);
            bodyCompleted = true;
          });
          yield* Effect.gen(function* () {
            const fiber = yield* selected.host.run(selected.host.newRequestKey(), native12Arguments("cct", "Count conflict checkpoint"))
              .pipe(Effect.forkScoped);
            yield* awaitNative12Pause(entered, fiber);
            yield* scenario.publish("aab", "Count after");
            const afterCompetitor = yield* Effect.promise(() => native12DataInventory(fixture));
            yield* Deferred.succeed(release, undefined);
            expectNative12Failure(yield* Fiber.await(fiber), "writeConflict");
            expect(bodyCompleted).toBe(false);
            expect(selected.calls()).toBe(1);
            expect(scenario.native.observations.executions()).toBe(0);
            expect(yield* Effect.promise(() => native12DataInventory(fixture))).toEqual(afterCompetitor);
          }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("30 seconds"));
        })));
      } finally { await fixture.close(); }
    }, 90_000);
  });
}
