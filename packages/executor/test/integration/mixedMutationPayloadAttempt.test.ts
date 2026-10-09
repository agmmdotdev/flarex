import { Cause, Deferred, Effect, Exit, Fiber, Schema, Scope } from "effect";
import { describe, expect, it, vi } from "vitest";
import * as participantBinding from "@flarex/payload-adapter/internal/participant";
import * as cmsAdapter from "@flarex/persistence-postgres/internal/cms-adapter";
import * as nativeRuntime from "../../../payload-adapter/src/runtime/native";
import { makePayloadAttempt } from "../../../payload-adapter/src/runtime/attempt";
import { LogicalParticipantInvocationError } from
  "@flarex/persistence-postgres/internal/logical-participant-admission";
import type { LogicalParticipantBorrow } from "@flarex/persistence-postgres/session-journal-store";
import { decodePointMutationExactRuntimeResultV1Effect } from
  "flarex-protocol/point-mutation-exact-runtime";
import { createMixedMutationProductFixture } from "../performance/support/mixedMutationProductFixture";

const drivers = process.env.FLAREX_POSTGRES_DATABASE_URL === undefined
  ? ["pglite" as const] : ["pglite" as const, "postgres" as const];

describe.each(drivers)("scoped Payload attempt facade on %s", driver => {
  it("refuses a genuine foreign attempt and refuses its original borrow after publication closes the facade", async () => {
    let captured: Parameters<LogicalParticipantBorrow>[0] | undefined;
    const bind = participantBinding.bindPayloadParticipant;
    const observer = vi.spyOn(participantBinding, "bindPayloadParticipant").mockImplementation((...args) =>
      bind(...args).pipe(Effect.map(borrow => input => {
        captured ??= input;
        return borrow(input);
      })));
    try {
      const fixture = await createMixedMutationProductFixture({ driver,
        suffix: `payload-attempt-scope-${driver}`, payloadProfile: "success" });
      try {
        const peer = await fixture.openCompetingFiniteFixture(`payload-attempt-foreign-${driver}`);
        try {
          const raw = await fixture.runExecution();
          const success = Schema.decodeUnknownSync(Schema.Struct({ kind: Schema.Literal("result"),
            result: Schema.Struct({ kind: Schema.Literal("success"), result: Schema.Unknown }) }))(raw);
          const returned = (await Effect.runPromise(decodePointMutationExactRuntimeResultV1Effect(
            success.result.result))).value;
          const runtime = fixture.payload?.current();
          if (runtime === undefined || captured === undefined) throw new Error("Missing actual Payload borrow");
          const executions = runtime.observations.executions();
          expect(executions).toBe(4);
          expect(runtime.observations.requests()).toBe(4);
          expect(runtime.observations.dataLoaders()).toBe(4);
          const foreign = await Effect.runPromise(runtime.runtime.borrowParticipant({ ...captured,
            attempt: peer.persistenceAttempt })).then(() => null, (cause: unknown) => cause);
          expect(foreign).toBeInstanceOf(LogicalParticipantInvocationError);
          expect(foreign).toMatchObject({ kind: "rejection", cause: { reason: "invalidAuthority" } });
          expect(runtime.observations.executions()).toBe(executions);
          expect(await fixture.publish(returned)).toMatchObject({ kind: "published" });
          const closed = await Effect.runPromise(runtime.runtime.borrowParticipant(captured))
            .then(() => null, (cause: unknown) => cause);
          expect(closed).toBeInstanceOf(LogicalParticipantInvocationError);
          expect(closed).toMatchObject({ kind: "rejection", cause: { reason: "closed" } });
          expect(runtime.observations.executions()).toBe(executions);
        } finally { await peer.close(); }
      } finally { await fixture.close(); }
    } finally { observer.mockRestore(); }
  }, 180_000);

  it.each(["complete", "mixed-cause"] as const)("waits for an outstanding genuine CMS abort before destroying its parallel parent (%s)", async cleanupOutcome => {
    let nativeScope: Scope.Scope | undefined;
    let native: nativeRuntime.PayloadNative | undefined;
    let ownership: Effect.Success<ReturnType<nativeRuntime.PayloadNative["makeAttemptOwnership"]>> | undefined;
    let captured: Parameters<LogicalParticipantBorrow>[0] | undefined;
    let sourceKey: string | undefined;
    let aborts = 0;
    let borrowOrdinal = 0;
    const heldAbortStarted = await Effect.runPromise(Deferred.make<void>());
    const finishAbort = await Effect.runPromise(Deferred.make<void>());
    const originalDefect = new Error("genuine CMS abort finalizer failed");
    const completeCause = Cause.combine(Cause.die(originalDefect), Cause.interrupt(123));
    const order: string[] = [];
    const makeNative = nativeRuntime.makePayloadNative;
    const nativeObserver = vi.spyOn(nativeRuntime, "makePayloadNative").mockImplementation((...args) =>
      Effect.gen(function* () {
        const caller = yield* Effect.scope;
        const parallelParent = yield* Scope.make("parallel");
        yield* Scope.addFinalizer(caller, Scope.close(parallelParent, Exit.void));
        nativeScope = parallelParent;
        const actual = yield* Scope.provide(parallelParent)(makeNative(...args));
        // Native and facade construction share one genuine parallel caller
        // Scope. Their original owners retain every resource and authority.
        native = { ...actual,
          makeAttemptOwnership: () => Scope.provide(parallelParent)(actual.makeAttemptOwnership()).pipe(
            Effect.tap(owned => Effect.sync(() => { ownership = owned; }))),
        };
        return native;
      }));
    const bind = participantBinding.bindPayloadParticipant;
    const borrowObserver = vi.spyOn(participantBinding, "bindPayloadParticipant").mockImplementation((...args) => {
      sourceKey ??= args[1];
      return bind(...args).pipe(Effect.map(borrow => input => {
        captured ??= input;
        return borrow(input);
      }));
    });
    const makeBorrowed = cmsAdapter.makeBorrowedCmsAttempt;
    const abortObserver = vi.spyOn(cmsAdapter, "makeBorrowedCmsAttempt").mockImplementation((...args) =>
      makeBorrowed(...args).pipe(Effect.map(borrowed => {
        const held = ++borrowOrdinal === 5;
        return { ...borrowed, abort: borrowed.abort.pipe(
          Effect.tap(() => Effect.sync(() => { aborts += 1; })),
          Effect.andThen(held ? Effect.gen(function* () {
            order.push("abort started");
            yield* Deferred.succeed(heldAbortStarted, undefined);
            yield* Deferred.await(finishAbort);
            order.push("abort completed");
            if (cleanupOutcome === "mixed-cause") return yield* Effect.failCause(completeCause);
          }) : Effect.void),
        ) };
      })));
    try {
      const fixture = await createMixedMutationProductFixture({ driver,
        suffix: `payload-native-parent-scope-${cleanupOutcome}-${driver}`, payloadProfile: "success" });
      try {
        await fixture.runExecution();
        const runtime = fixture.payload?.current();
        if (runtime === undefined || captured === undefined || nativeScope === undefined || native === undefined || sourceKey === undefined || ownership === undefined)
          throw new Error("Missing actual native Payload ownership");
        const originalOwnership = ownership;
        const destroyNative = native.payload.destroy.bind(native.payload);
        const destroy = vi.spyOn(native.payload, "destroy").mockImplementation((...args) => {
          order.push("native destroyed");
          return destroyNative(...args);
        });
        let closing: Fiber.Fiber<void, never> | undefined;
        try {
          const outstanding = await Effect.runPromise(runtime.runtime.borrowParticipant(captured));
          const abortsBefore = aborts;
          closing = Effect.runFork(Scope.close(nativeScope, Exit.void));
          await Effect.runPromise(Deferred.await(heldAbortStarted).pipe(Effect.timeout("30 seconds")));
          expect(destroy).not.toHaveBeenCalled();
          const lateBorrow = await Effect.runPromise(runtime.runtime.borrowParticipant(captured))
            .then(() => null, (cause: unknown) => cause);
          expect(lateBorrow).toMatchObject({ cause: { reason: "closed" } });
          await expect(Effect.runPromise(Effect.scoped(makePayloadAttempt(native, sourceKey, captured.attempt))))
            .rejects.toMatchObject({ reason: "closed" });
          expect(destroy).not.toHaveBeenCalled();
          await Effect.runPromise(Deferred.succeed(finishAbort, undefined));
          const closedParent = await Effect.runPromise(Fiber.await(closing));
          const closedAttempt = await Effect.runPromiseExit(originalOwnership.close);
          if (cleanupOutcome === "mixed-cause") {
            if (Exit.isSuccess(closedParent) || Exit.isSuccess(closedAttempt))
              throw new Error("Missing complete original abort Cause");
            expect(closedAttempt.cause.reasons.map(reason => reason._tag)).toEqual(["Die", "Interrupt"]);
            expect(closedAttempt.cause.reasons.filter(Cause.isDieReason)[0]?.defect).toBe(originalDefect);
            expect(closedAttempt.cause.reasons.filter(Cause.isInterruptReason).map(reason => reason.fiberId))
              .toEqual([123]);
            // The common parallel parent combines both owners' failed exits;
            // the single cached physical drain remains unchanged at each owner.
            expect(closedParent.cause.reasons.map(reason => reason._tag))
              .toEqual(["Die", "Interrupt", "Die", "Interrupt"]);
            for (const reason of closedParent.cause.reasons.filter(Cause.isDieReason))
              expect(reason.defect).toBe(originalDefect);
            expect(closedParent.cause.reasons.filter(Cause.isInterruptReason).map(reason => reason.fiberId))
              .toEqual([123, 123]);
          } else {
            expect(Exit.isSuccess(closedParent)).toBe(true);
            expect(Exit.isSuccess(closedAttempt)).toBe(true);
          }
          expect(aborts - abortsBefore).toBe(5);
          expect(order).toEqual(["abort started", "abort completed", "native destroyed"]);
          expect(destroy).toHaveBeenCalledTimes(1);
          const closed = await Effect.runPromise(outstanding.invoke("payload-create", {}))
            .then(() => null, (cause: unknown) => cause);
          expect(closed).toBeInstanceOf(LogicalParticipantInvocationError);
          expect(closed).toMatchObject({ cause: { reason: "closed" } });
          await expect(Effect.runPromise(Effect.scoped(native.makeAttemptOwnership())))
            .rejects.toMatchObject({ reason: "closed" });
        } finally {
          await Effect.runPromise(Deferred.succeed(finishAbort, undefined));
          if (closing !== undefined) await Effect.runPromise(Fiber.await(closing));
          destroy.mockRestore();
        }
      } finally { await fixture.close(); }
    } finally { nativeObserver.mockRestore(); borrowObserver.mockRestore(); abortObserver.mockRestore(); }
  }, 180_000);
});
