import { Cause, Deferred, Effect, Exit, Fiber, Result, Scope, Tracer } from "effect";
import { expect, it } from "vitest";
import {
  chargeHostPreparation,
  captureHostPreparationCharge,
  captureHostPreparationLifetime,
  registerHostPreparationDisposal,
  makePreparedHostRuntime,
  retainPreparedHost,
  type PreparedHostRuntimeError,
} from "../../../src/execution/preparation/preparedHostRuntime";
import { runEffect } from "../../support/effectTestRuntime";
import {
  defineCommerceEventContract,
  captureAtomicCommerceEvents,
  prepareAtomicCommerceEvents,
} from "../../../src/frameworks/atomicCommerce/events";

const prepare = Effect.gen(function* () {
  const metadata = "x".repeat(32);
  yield* chargeHostPreparation(metadata);
  return { metadata };
});

it("disposes actual issuer payloads exactly once after retired borrowers and root drain", () =>
  runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 256 });
    const payloads = new WeakMap<object, string>();
    let disposals = 0;
    const issue = Effect.gen(function* () {
      const lifetime = yield* captureHostPreparationLifetime();
      if (lifetime === undefined) return yield* Effect.die("Missing issuer lifetime");
      const key = Object.freeze({});
      payloads.set(key, "retained payload");
      yield* registerHostPreparationDisposal(() => { payloads.delete(key); disposals++; });
      yield* chargeHostPreparation("retained payload");
      return { key, lifetime };
    });
    const retained = yield* retainPreparedHost(runtime, issue);
    const staticIssuer = yield* retained.use(Effect.succeed);
    const staticBytes = Result.getOrThrow(retained.readUsage()).chargedBytes;
    const generation = yield* retained.reconstruct(() => issue);
    const issuer = yield* generation.use(Effect.succeed);
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const borrower = yield* Effect.forkChild(generation.use(value => Deferred.succeed(entered, undefined).pipe(
      Effect.andThen(Deferred.await(release)), Effect.tap(() => Effect.sync(() => expect(payloads.has(value.key)).toBe(true))))));
    yield* Deferred.await(entered);
    yield* generation.retire;
    expect(payloads.has(issuer.key)).toBe(true);
    expect(disposals).toBe(0);
    yield* Deferred.succeed(release, undefined);
    yield* Fiber.join(borrower);
    expect(payloads.has(issuer.key)).toBe(false);
    expect(disposals).toBe(1);
    expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBe(staticBytes);
    expect(issuer.lifetime.onDispose(() => { disposals++; })).toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
    yield* generation.retire;
    const failed = yield* Effect.exit(retained.reconstruct(() => issue.pipe(Effect.andThen(Effect.fail("refused")))));
    expect(Exit.isFailure(failed)).toBe(true);
    expect(disposals).toBe(2);
    expect(payloads.has(staticIssuer.key)).toBe(true);
    yield* retained.close;
    yield* retained.close;
    expect(payloads.has(staticIssuer.key)).toBe(false);
    expect(disposals).toBe(3);
    expect(staticIssuer.lifetime.onDispose(() => { disposals++; })).toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
    expect(disposals).toBe(3);
  }))));

for (const activity of ["stage", "borrow"] as const) for (const outcome of ["failure", "cancellation"] as const)
  it(`drains a genuine active ${activity} after construction ${outcome}`, () =>
    runEffect(Effect.scoped(Effect.gen(function* () {
      const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 128 });
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      const defect = new Error("construction defect");
      const refused = Cause.combine(Cause.fail("construction refusal"), Cause.die(defect));
      let child: Fiber.Fiber<unknown, PreparedHostRuntimeError> | undefined;
      const constructing = yield* Effect.forkChild(retainPreparedHost(runtime, Effect.gen(function* () {
        const lifetime = yield* captureHostPreparationLifetime();
        if (lifetime === undefined) return yield* Effect.die("Missing actual lease");
        const staged = lifetime.stage(chargeHostPreparation("live generation").pipe(
          Effect.andThen(activity === "stage" ? Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release))) : Effect.void)));
        child = Effect.runFork(activity === "stage" ? staged : staged.pipe(Effect.flatMap(generation =>
          generation.use(() => Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)))))));
        yield* Deferred.await(entered);
        return yield* outcome === "failure" ? Effect.failCause(refused) : Effect.never;
      })));
      yield* Deferred.await(entered);
      const cancelling = outcome === "cancellation" ? yield* Effect.forkChild(Fiber.interrupt(constructing)) : undefined;
      yield* Effect.yieldNow;
      expect(yield* Effect.flip(retainPreparedHost(runtime, prepare))).toMatchObject({ reason: "capacityExceeded" });
      yield* Deferred.succeed(release, undefined);
      if (child === undefined) return yield* Effect.die("Missing genuine child activity");
      yield* Fiber.await(child);
      if (cancelling !== undefined) yield* Fiber.join(cancelling);
      const completed = yield* Fiber.await(constructing);
      if (Exit.isSuccess(completed)) return yield* Effect.die("Expected unsuccessful construction");
      if (outcome === "cancellation") expect(Cause.hasInterruptsOnly(completed.cause)).toBe(true);
      else {
        // The retaining owner adds its legitimate trace annotation. Every
        // original reason and foreign payload must still survive draining.
        expect(completed.cause.reasons).toHaveLength(2);
        expect(completed.cause.reasons).toMatchObject([{ _tag: "Fail", error: "construction refusal" }, { _tag: "Die", defect }]);
        const originalDefect = completed.cause.reasons.find(Cause.isDieReason);
        expect(originalDefect?.defect).toBe(defect);
      }
      const replacement = yield* retainPreparedHost(runtime, prepare);
      expect(Result.getOrThrow(replacement.readUsage()).chargedBytes).toBeLessThan(128);
      yield* replacement.close;
    }))));

it("stages independent generations while ordinary requests remain outside construction", () =>
  runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 256 });
    const retained = yield* retainPreparedHost(runtime, Effect.gen(function* () {
      const lifetime = yield* captureHostPreparationLifetime();
      if (lifetime === undefined) return yield* Effect.die("Missing genuine construction lease");
      yield* chargeHostPreparation("original");
      return { lifetime };
    }));
    const before = Result.getOrThrow(retained.readUsage()).chargedBytes;
    const reconstructed = yield* retained.reconstruct(host => Effect.gen(function* () {
      const lifetime = yield* captureHostPreparationLifetime();
      const charge = yield* captureHostPreparationCharge();
      if (lifetime === undefined || charge === undefined) return yield* Effect.die("Missing generation allocation");
      expect(lifetime.checkOpen).not.toBe(host.lifetime.checkOpen);
      expect(lifetime.charge).not.toBe(host.lifetime.charge);
      expect(charge).toBe(lifetime.charge);
      yield* chargeHostPreparation("replacement");
      return lifetime;
    }));
    const after = Result.getOrThrow(retained.readUsage()).chargedBytes;
    expect(after).toBeGreaterThan(before);
    expect(yield* retained.use(() => captureHostPreparationLifetime())).toBeUndefined();
    expect(yield* retained.use(() => captureHostPreparationCharge())).toBeUndefined();
    const captured = yield* reconstructed.use(Effect.succeed);
    yield* reconstructed.retire;
    expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBe(before);
    expect(captured.checkOpen()).toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
    expect(yield* Effect.flip(reconstructed.use(() => Effect.void))).toMatchObject({ reason: "closed" });
    const next = yield* retained.reconstruct(() => chargeHostPreparation("next"));
    yield* next.retire;
    expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBe(before);
  }))));

it("returns failed stage capacity without poisoning current or other hosts", () =>
  runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 2, maximumPreparedBytes: 128 });
    const first = yield* retainPreparedHost(runtime, prepare);
    const second = yield* retainPreparedHost(runtime, prepare);
    const before = Result.getOrThrow(first.readUsage()).chargedBytes;
    let escaped: Effect.Success<ReturnType<typeof captureHostPreparationLifetime>>;
    const refused = yield* Effect.flip(first.reconstruct(() => Effect.gen(function* () {
      escaped = yield* captureHostPreparationLifetime();
      yield* chargeHostPreparation("a");
      yield* chargeHostPreparation("x".repeat(32)).pipe(Effect.catchTag("PreparedHostRuntimeError", () => Effect.void));
      return "caught refusal";
    })));
    expect(refused).toMatchObject({ reason: "capacityExceeded" });
    if (escaped === undefined) return yield* Effect.die("Missing stage capture");
    expect(escaped.checkOpen()).toMatchObject({ _tag: "Failure", failure: { reason: "capacityExceeded" } });
    expect(Result.getOrThrow(first.readUsage()).chargedBytes).toBe(before);
    expect(yield* first.use(host => Effect.succeed(host.metadata.length))).toBe(32);
    expect(yield* second.use(host => Effect.succeed(host.metadata.length))).toBe(32);
    const replacement = yield* first.reconstruct(() => chargeHostPreparation("a"));
    yield* replacement.retire;
    expect(Result.getOrThrow(first.readUsage()).chargedBytes).toBe(before);
  }))));

it("keeps retired generations charged until the last borrower and bounds concurrent stages", () =>
  runEffect(Effect.scoped(Effect.gen(function* () {
    const runtime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 128 });
    const retained = yield* retainPreparedHost(runtime, Effect.succeed({}));
    const first = yield* retained.reconstruct(() => prepare);
    const firstBytes = Result.getOrThrow(retained.readUsage()).chargedBytes;
    const entered = yield* Deferred.make<void>();
    const release = yield* Deferred.make<void>();
    const borrower = yield* Effect.forkChild(first.use(host => Deferred.succeed(entered, undefined).pipe(
      Effect.andThen(Deferred.await(release)), Effect.as(host.metadata.length))));
    yield* Deferred.await(entered);
    const second = yield* retained.reconstruct(() => prepare);
    yield* first.retire;
    expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBe(firstBytes * 2);
    expect(yield* Effect.flip(first.use(() => Effect.void))).toMatchObject({ reason: "closed" });
    expect(yield* Effect.flip(retained.reconstruct(() => prepare))).toMatchObject({ reason: "capacityExceeded" });
    yield* Deferred.succeed(release, undefined);
    expect(yield* Fiber.join(borrower)).toBe(32);
    expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBe(firstBytes);
    const third = yield* retained.reconstruct(() => prepare);
    yield* second.retire;
    yield* third.retire;
    expect(Result.getOrThrow(retained.readUsage()).chargedBytes).toBe(0);
  }))));

it("drains stages on close and releases interrupted stage charges with the original Cause", () =>
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
    if (escaped === undefined) return yield* Effect.die("Missing genuine stage lifetime");
    expect(escaped.checkOpen()).toMatchObject({ _tag: "Failure", failure: { reason: "closed" } });
    yield* Deferred.succeed(release, undefined);
    expect(yield* Effect.flip(Fiber.join(rebuilding))).toMatchObject({ reason: "closed" });
    yield* Fiber.join(closing);
    expect(closed).toBe(true);
    const next = yield* retainPreparedHost(runtime, prepare);
    const cancelEntered = yield* Deferred.make<void>();
    const cancelled = yield* Effect.forkChild(next.reconstruct(() => chargeHostPreparation("cancelled payload").pipe(
      Effect.andThen(Deferred.succeed(cancelEntered, undefined)), Effect.andThen(Effect.never))));
    yield* Deferred.await(cancelEntered);
    expect(Result.getOrThrow(next.readUsage()).chargedBytes).toBeGreaterThan(initialCharged);
    yield* Fiber.interrupt(cancelled);
    const cancelledExit = yield* Fiber.await(cancelled);
    expect(Exit.isFailure(cancelledExit)).toBe(true);
    if (Exit.isFailure(cancelledExit)) expect(Cause.hasInterruptsOnly(cancelledExit.cause)).toBe(true);
    expect(Result.getOrThrow(next.readUsage()).chargedBytes).toBe(initialCharged);
    const original = Cause.combine(Cause.fail("stage refusal"), Cause.die(new Error("stage defect")));
    const failed = yield* Effect.exit(next.reconstruct(() => chargeHostPreparation("transient").pipe(
      Effect.andThen(Effect.failCause(original)))));
    if (Exit.isSuccess(failed)) return yield* Effect.die("Expected stage failure");
    expect(failed.cause).toBe(original);
    expect(Result.getOrThrow(next.readUsage()).chargedBytes).toBe(initialCharged);
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
