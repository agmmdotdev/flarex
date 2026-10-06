import { Cause, Deferred, Effect, Exit, Fiber, Result, Scope, Tracer } from "effect";
import { expect, it } from "vitest";
import {
  chargeHostPreparation,
  captureHostPreparationCharge,
  captureHostPreparationLifetime,
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

it("reconstructs with the original lease allocation while ordinary requests remain outside construction", () =>
  runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 256 });
    const retained = yield* retainPreparedHost(runtime, Effect.gen(function* () {
      const lifetime = yield* captureHostPreparationLifetime();
      const charge = yield* captureHostPreparationCharge();
      if (lifetime === undefined || charge === undefined) return yield* Effect.die("Missing genuine construction lease");
      yield* chargeHostPreparation("original");
      return { lifetime, charge };
    }));
    const before = Result.getOrThrow(retained.readUsage()).chargedBytes;
    const reconstructed = yield* retained.reconstruct(host => Effect.gen(function* () {
      const lifetime = yield* captureHostPreparationLifetime();
      const charge = yield* captureHostPreparationCharge();
      if (lifetime === undefined || charge === undefined) return yield* Effect.die("Missing reconstruction allocation");
      expect(lifetime.checkOpen).toBe(host.lifetime.checkOpen);
      expect(lifetime.charge).toBe(host.lifetime.charge);
      expect(charge).toBe(host.charge);
      yield* chargeHostPreparation("replacement");
      return lifetime;
    }));
    const after = Result.getOrThrow(retained.readUsage()).chargedBytes;
    expect(after).toBeGreaterThan(before);
    expect(yield* retained.use(() => captureHostPreparationLifetime())).toBeUndefined();
    expect(yield* retained.use(() => captureHostPreparationCharge())).toBeUndefined();
    expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBe(after);
    yield* retained.reconstruct(() => chargeHostPreparation("next"));
    expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBeGreaterThan(after);
    yield* retained.close;
    expect(reconstructed.checkOpen()).toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
    expect(reconstructed.charge("escaped")).toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
  }))));

it("keeps reconstruction charges cumulative and poisons a rejected lease even if its callback catches overflow", () =>
  runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 2, maximumPreparedBytes: 128 });
    const first = yield* retainPreparedHost(runtime, prepare);
    const second = yield* retainPreparedHost(runtime, prepare);
    let escaped: Effect.Success<ReturnType<typeof captureHostPreparationLifetime>>;
    const refused = yield* Effect.flip(first.reconstruct(() => Effect.gen(function* () {
      escaped = yield* captureHostPreparationLifetime();
      yield* chargeHostPreparation("x".repeat(32)).pipe(Effect.catchTag("PreparedHostRuntimeError", () => Effect.void));
      return "caught refusal";
    })));
    expect(refused).toMatchObject({ reason: "capacityExceeded" });
    if (escaped === undefined) return yield* Effect.die("Missing original allocation capture");
    expect(escaped.checkOpen()).toMatchObject({ _tag: "Failure", failure: { reason: "capacityExceeded" } });
    expect(escaped.charge(null)).toMatchObject({ _tag: "Failure", failure: { reason: "capacityExceeded" } });
    let ran = false;
    const work = () => Effect.sync(() => { ran = true; });
    expect(yield* Effect.flip(first.use(work))).toMatchObject({ reason: "capacityExceeded" });
    expect(yield* Effect.flip(first.reconstruct(work))).toMatchObject({ reason: "capacityExceeded" });
    expect(ran).toBe(false);
    expect(yield* second.use(host => Effect.succeed(host.metadata.length))).toBe(32);
    yield* first.close;
    const replacement = yield* retainPreparedHost(runtime, prepare);
    expect(yield* replacement.use(host => Effect.succeed(host.metadata.length))).toBe(32);
  }))));

it("drains reconstruction on close and preserves cancellation without exposing a closed capability", () =>
  runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 256 });
    const retained = yield* retainPreparedHost(runtime, prepare);
    const initialCharged = Result.getOrThrow(retained.readUsage()).chargedBytes;
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    let escaped: Effect.Success<ReturnType<typeof captureHostPreparationLifetime>>;
    const rebuilding = yield* Effect.forkChild(retained.reconstruct(() => Effect.gen(function* () {
      escaped = yield* captureHostPreparationLifetime();
      yield* chargeHostPreparation("new payload");
      yield* Deferred.succeed(entered, undefined);
      yield* Deferred.await(release);
      return escaped;
    })));
    yield* Deferred.await(entered);
    let closed = false;
    const closing = yield* Effect.forkChild(retained.close.pipe(Effect.tap(() => Effect.sync(() => { closed = true; }))));
    yield* Effect.yieldNow;
    expect(closed).toBe(false);
    expect(yield* Effect.flip(retained.reconstruct(() => Effect.succeed("late")))).toMatchObject({ reason: "closed" });
    if (escaped === undefined) return yield* Effect.die("Missing genuine reconstruction lifetime");
    expect(escaped.checkOpen()).toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
    yield* Deferred.succeed(release, undefined);
    expect(yield* Effect.flip(Fiber.join(rebuilding))).toMatchObject({ reason: "closed" });
    yield* Fiber.join(closing);
    expect(closed).toBe(true);

    const next = yield* retainPreparedHost(runtime, prepare);
    const cancelEntered = yield* Deferred.make<void>();
    let drained = false;
    const cancelled = yield* Effect.forkChild(next.reconstruct(() => chargeHostPreparation("cancelled payload").pipe(
      Effect.andThen(Deferred.succeed(cancelEntered, undefined)),
      Effect.andThen(Effect.never),
      Effect.ensuring(Effect.sync(() => { drained = true; })),
    )));
    yield* Deferred.await(cancelEntered);
    const charged = Result.getOrThrow(next.readUsage()).chargedBytes;
    expect(charged).toBeGreaterThan(initialCharged);
    yield* Fiber.interrupt(cancelled);
    const cancelledExit = yield* Fiber.await(cancelled);
    expect(Exit.isFailure(cancelledExit)).toBe(true);
    if (Exit.isFailure(cancelledExit)) expect(Cause.hasInterruptsOnly(cancelledExit.cause)).toBe(true);
    expect(drained).toBe(true);
    expect(Result.getOrThrow(next.readUsage()).chargedBytes).toBe(charged);
    expect(yield* next.use(host => Effect.succeed(host.metadata.length))).toBe(32);
    yield* next.close;
    const replacement = yield* retainPreparedHost(runtime, prepare);
    expect(Result.getOrThrow(replacement.readUsage()).chargedBytes).toBe(initialCharged);
  }))));

it("reports actual retained lease charges without spending capacity and refuses usage after close", () =>
  runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 128 });
    const retained = yield* retainPreparedHost(runtime, Effect.gen(function* () {
      const charge = yield* captureHostPreparationCharge();
      if (charge === undefined) return yield* Effect.die("Missing allocation");
      return { charge };
    }));
    for (let read = 0; read < 100; read++) expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBe(0);
    const charge = yield* retained.use(host => Effect.succeed(host.charge));
    yield* Effect.fromResult(charge("x".repeat(32)));
    const before = Result.getOrThrow(retained.readUsage());
    expect(before.chargedBytes).toBeGreaterThan(32);
    yield* Effect.fromResult(charge("second"));
    expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBeGreaterThan(before.chargedBytes);
    expect(before.chargedBytes).toBeGreaterThan(32);
    yield* retained.close;
    expect(retained.readUsage()).toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
    const replacement = yield* retainPreparedHost(runtime, prepare);
    expect(Result.getOrThrow(replacement.readUsage()).chargedBytes).toBe(before.chargedBytes);
  }))));

it("checks the existing construction lease without spending its retained payload budget", () =>
  runEffect(Effect.scoped(Effect.gen(function* () {
    expect(yield* captureHostPreparationLifetime()).toBeUndefined();
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 64 });
    const retained = yield* retainPreparedHost(runtime, Effect.gen(function* () {
      const lifetime = yield* captureHostPreparationLifetime();
      if (lifetime === undefined) return yield* Effect.die("Missing existing construction lease");
      return { lifetime };
    }));
    const lifetime = yield* retained.use(host => Effect.succeed(host.lifetime));
    for (let check = 0; check < 100; check++) expect(Result.isSuccess(lifetime.checkOpen())).toBe(true);
    expect(Result.isSuccess(lifetime.charge("x".repeat(32)))).toBe(true);
    yield* retained.close;
    expect(lifetime.checkOpen()).toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
    const replacement = yield* retainPreparedHost(runtime, prepare);
    expect(yield* replacement.use(host => Effect.succeed(host.metadata.length))).toBe(32);
  }))));

it("keeps lazy charges within their host allocation and rejects them after close", () =>
  runEffect(Effect.scoped(Effect.gen(function* () {
    expect(yield* captureHostPreparationCharge()).toBeUndefined();
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 64 });
    const retained = yield* retainPreparedHost(runtime, Effect.gen(function* () {
      const charge = yield* captureHostPreparationCharge();
      if (charge === undefined) return yield* Effect.die("Expected the construction allocation");
      return { charge };
    }));
    const charge = yield* retained.use(host => Effect.succeed(host.charge));
    expect(Result.isSuccess(charge("x".repeat(32)))).toBe(true);
    const overflow = charge("x".repeat(32));
    expect(Result.isFailure(overflow) ? overflow.failure.reason : undefined).toBe("capacityExceeded");
    yield* retained.close;
    const closed = charge(null);
    expect(Result.isFailure(closed) ? closed.failure.reason : undefined).toBe("closed");
    const replacement = yield* retainPreparedHost(runtime, prepare);
    expect(yield* replacement.use(host => Effect.succeed(host.metadata.length))).toBe(32);
  }))));

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
