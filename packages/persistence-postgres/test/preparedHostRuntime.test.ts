import { Cause, Deferred, Effect, Exit, Fiber, Scope, Tracer } from "effect";
import { expect, it } from "vitest";
import {
  chargeHostPreparation,
  makePreparedHostRuntime,
  retainPreparedHost,
} from "../src/preparedHostRuntime";
import { runEffect } from "./effectTestRuntime";
import {
  defineCommerceEventContract,
  captureAtomicCommerceEvents,
  prepareAtomicCommerceEvents,
} from "../src/atomicCommerce/events";

const prepare = Effect.gen(function* () {
  const metadata = "x".repeat(32);
  yield* chargeHostPreparation(metadata);
  return { metadata };
});

it("returns capacity when cancellation arrives at installation", () => runEffect(Effect.scoped(Effect.gen(function* () {
  const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 64 });
  let interruptConstruction: (() => void) | undefined;
  let injected = false;
  const tracer = Tracer.make({
    span: options => {
      if (options.name === "PreparedHostRuntime.install" && !injected && interruptConstruction !== undefined) {
        injected = true;
        interruptConstruction();
      }
      return new Tracer.NativeSpan(options);
    },
  });
  const construction = Effect.withFiber(fiber => {
    interruptConstruction = () => fiber.interruptUnsafe();
    return prepare;
  });
  const pending = yield* Effect.forkChild(retainPreparedHost(runtime, construction).pipe(Effect.withTracer(tracer)));
  const result = yield* Fiber.await(pending);
  expect(injected).toBe(true);
  if (!Exit.isFailure(result)) throw new Error("Expected interrupted installation");
  expect(result.cause.reasons.length).toBeGreaterThan(0);
  expect(result.cause.reasons.every(Cause.isInterruptReason)).toBe(true);
  const replacement = yield* retainPreparedHost(runtime, prepare);
  expect(yield* replacement.use(host => Effect.succeed(host.metadata.length))).toBe(32);
}))), 10_000);

it(
  "charges retained event metadata and returns the slot after metadata refusal",
  () => runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePreparedHostRuntime({
      maximumHosts: 1,
      maximumPreparedBytes: 4096,
    });
    const revision = "a".repeat(64);
    const contract = defineCommerceEventContract({
      name: "stock.changed", revision, internal: true,
      decode: () => Effect.succeed(null),
    });
    const prepareEvents = (subscribers: readonly { readonly id: string; readonly revision: string }[]) =>
      Effect.fromResult(captureAtomicCommerceEvents({
        producerRevision: revision, contracts: [contract], subscribers,
        validate: () => Effect.void,
      })).pipe(Effect.flatMap(prepareAtomicCommerceEvents));
    const small = [{ id: "inventory", revision }];
    const first = yield* retainPreparedHost(runtime, prepareEvents(small));
    yield* first.close;
    const larger = Array.from({ length: 8 }, (_, index) => ({
      id: `subscriber${index}${"x".repeat(100)}`, revision,
    }));
    expect(yield* Effect.flip(retainPreparedHost(runtime, prepareEvents(larger)))).toMatchObject({
      reason: "resourceFailure", cause: { reason: "capacityExceeded" },
    });
    const replacement = yield* retainPreparedHost(runtime, prepareEvents(small));
    expect(yield* replacement.use(policy => Effect.succeed(policy.subscribers))).toEqual(small);
  }))),
  10_000,
);

it(
  "shares byte capacity, refuses overflow, and returns capacity on explicit close",
  () =>
    runEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* makePreparedHostRuntime({
            maximumHosts: 2,
            maximumPreparedBytes: 64,
          });
          const first = yield* retainPreparedHost(runtime, prepare);
          expect(
            yield* Effect.flip(retainPreparedHost(runtime, prepare)),
          ).toMatchObject({ reason: "capacityExceeded" });
          expect(
            yield* Effect.flip(
              retainPreparedHost(
                runtime,
                prepare.pipe(
                  Effect.catch(() =>
                    Effect.succeed({ metadata: "unaccounted" }),
                  ),
                ),
              ),
            ),
          ).toMatchObject({ reason: "capacityExceeded" });
          expect(
            yield* first.use((host) => Effect.succeed(host.metadata)),
          ).toBe("x".repeat(32));
          yield* first.close;
          yield* first.close;
          expect(
            yield* Effect.flip(first.use(() => Effect.succeed(1))),
          ).toMatchObject({ reason: "closed" });
          const next = yield* retainPreparedHost(runtime, prepare);
          expect(
            yield* next.use((host) => Effect.succeed(host.metadata.length)),
          ).toBe(32);
        }),
      ),
    ),
  10_000,
);

it(
  "releases charged reservations after typed failure, defect and interruption",
  () =>
    runEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const runtime = yield* makePreparedHostRuntime({
            maximumHosts: 1,
            maximumPreparedBytes: 64,
          });
          expect(
            yield* Effect.flip(
              retainPreparedHost(
                runtime,
                prepare.pipe(
                  Effect.andThen(Effect.fail("construction failed")),
                ),
              ),
            ),
          ).toBe("construction failed");
          const defect = yield* Effect.exit(
            retainPreparedHost(
              runtime,
              prepare.pipe(
                Effect.andThen(Effect.die(new Error("construction defect"))),
              ),
            ),
          );
          if (!Exit.isFailure(defect)) throw new Error("Expected defect");
          expect(Cause.hasDies(defect.cause)).toBe(true);
          expect(Cause.hasFails(defect.cause)).toBe(false);
          const entered = yield* Deferred.make<void>();
          const pending = yield* Effect.forkChild(
            retainPreparedHost(
              runtime,
              prepare.pipe(
                Effect.tap(() => Deferred.succeed(entered, undefined)),
                Effect.andThen(Effect.never),
              ),
            ),
          );
          yield* Deferred.await(entered);
          expect(
            yield* Effect.flip(retainPreparedHost(runtime, prepare)),
          ).toMatchObject({ reason: "capacityExceeded" });
          yield* Fiber.interrupt(pending);
          const next = yield* retainPreparedHost(runtime, prepare);
          expect(
            yield* next.use((host) => Effect.succeed(host.metadata.length)),
          ).toBe(32);
        }),
      ),
    ),
  10_000,
);

it(
  "drains active uses and construction before scope closure completes",
  () =>
    runEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const scope = yield* Scope.make();
          const runtime = yield* makePreparedHostRuntime({
            maximumHosts: 2,
            maximumPreparedBytes: 128,
          }).pipe(Scope.provide(scope));
          const held = yield* retainPreparedHost(runtime, prepare);
          const useEntered = yield* Deferred.make<void>();
          const constructionEntered = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const running = yield* Effect.forkChild(
            held.use((host) =>
              Deferred.succeed(useEntered, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
                Effect.as(host.metadata.length),
              ),
            ),
          );
          const constructing = yield* Effect.forkChild(
            retainPreparedHost(
              runtime,
              prepare.pipe(
                Effect.tap(() =>
                  Deferred.succeed(constructionEntered, undefined),
                ),
                Effect.tap(() => Deferred.await(release)),
              ),
            ),
          );
          yield* Deferred.await(useEntered);
          yield* Deferred.await(constructionEntered);
          let finished = false;
          const closing = yield* Effect.forkChild(
            Scope.close(scope, Exit.succeed(undefined)).pipe(
              Effect.tap(() =>
                Effect.sync(() => {
                  finished = true;
                }),
              ),
            ),
          );
          yield* Effect.yieldNow;
          expect(
            yield* Effect.flip(held.use(() => Effect.succeed(0))),
          ).toMatchObject({ reason: "closed" });
          expect(
            yield* Effect.flip(retainPreparedHost(runtime, prepare)),
          ).toMatchObject({ reason: "closed" });
          expect(finished).toBe(false);
          yield* Deferred.succeed(release, undefined);
          expect(yield* Fiber.join(running)).toBe(32);
          expect(yield* Effect.flip(Fiber.join(constructing))).toMatchObject({
            reason: "closed",
          });
          yield* Fiber.join(closing);
          expect(finished).toBe(true);
        }),
      ),
    ),
  10_000,
);
