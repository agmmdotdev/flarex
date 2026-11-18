import { afterAll, expect, it } from "vitest";
import { Deferred, Effect, Exit, Fiber, Scope } from "effect";
import { makePreparedHostRuntime } from "../../../src/execution/preparation/preparedHostRuntime";
import { makeCmsHost } from "../../../src/frameworks/cmsTransaction/host";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { createFileScopedPostgresFixture } from "../../support/postgresHelpers";
import { runEffect } from "../../support/effectTestRuntime";
import { makeCe0CmsReadReference } from "./ce0CmsReadReference";
import { makeCe0CmsMutationReference } from "./ce0CmsMutationReference";

const cleanup: Array<() => Promise<void>> = [];
afterAll(async () => {
  for (const close of cleanup.reverse()) await close();
});

it("shares host capacity across shops and drains admitted work before releasing it", async () => {
  const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
  if (driver !== "pglite" && driver !== "postgres")
    throw new Error("Invalid driver");
  const resource =
    driver === "pglite"
      ? await createRelationalPGliteFixture({
          registerCleanup: (close) => {
            cleanup.push(close);
          },
        })
      : await (async () => {
          const fixture = await createFileScopedPostgresFixture();
          cleanup.push(fixture.dispose);
          return {
            persistence: fixture.persistence,
            session: makePostgresRelationalSession(fixture.persistence),
          };
        })();
  const firstShop = await cmsExecutionMeasurementFixture(
    resource.persistence,
    resource.session,
  );
  const secondShop = await cmsExecutionMeasurementFixture(
    resource.persistence,
    resource.session,
  );
  expect(firstShop.fixture.authority.scopeId).not.toBe(
    secondShop.fixture.authority.scopeId,
  );
  await runEffect(
    Effect.scoped(
      Effect.gen(function* () {
        const scope = yield* Scope.make();
        yield* Effect.addFinalizer(() =>
          Scope.close(scope, Exit.succeed(undefined)),
        );
        const hostRuntime = yield* makePreparedHostRuntime({
          maximumHosts: 2,
          maximumPreparedBytes: 2_097_152,
        }).pipe(Scope.provide(scope));
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        // Ensure a failed assertion cannot strand the admitted transaction during cleanup.
        yield* Effect.addFinalizer(() => Deferred.succeed(release, undefined));
        const first = yield* makeCmsHost(
          { ...firstShop.input, hostRuntime },
          {
            afterAdmission: () =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Deferred.await(release)),
              ),
          },
        );
        const second = yield* makeCmsHost({ ...secondShop.input, hostRuntime });
        expect(
          yield* Effect.flip(makeCmsHost({ ...firstShop.input, hostRuntime })),
        ).toMatchObject({
          reason: "resourceFailure",
          cause: { reason: "capacityExceeded" },
        });
        const running = yield* Effect.forkChild(first.read(firstShop.read, []));
        yield* Deferred.await(entered);
        let closed = false;
        const closing = yield* Effect.forkChild(
          first.close.pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                closed = true;
              }),
            ),
          ),
        );
        yield* Effect.yieldNow;
        expect(closed).toBe(false);
        expect(
          yield* Effect.flip(first.read(firstShop.read, [])),
        ).toMatchObject({ reason: "closed" });
        expect(
          yield* Effect.flip(makeCmsHost({ ...firstShop.input, hostRuntime })),
        ).toMatchObject({ cause: { reason: "capacityExceeded" } });
        yield* Deferred.succeed(release, undefined);
        expect(yield* Fiber.join(running)).toEqual([]);
        yield* Fiber.join(closing);
        expect(closed).toBe(true);
        const replacement = yield* makeCmsHost({
          ...firstShop.input,
          hostRuntime,
        });
        const key = second.newRequestKey();
        const args = { count: 1, prefix: "surviving-host" };
        const result = yield* second.run(key, secondShop.insert, args);
        expect(yield* second.run(key, secondShop.insert, args)).toEqual(result);
        expect(secondShop.executionCount()).toBe(1);
        expect(yield* replacement.read(firstShop.read, [])).toEqual([]);
        const counts = [
          firstShop.executionCount(),
          firstShop.readExecutionCount(),
          secondShop.executionCount(),
          secondShop.readExecutionCount(),
        ];
        yield* Scope.close(scope, Exit.succeed(undefined));
        expect(
          yield* Effect.flip(replacement.read(firstShop.read, [])),
        ).toMatchObject({ reason: "closed" });
        expect(
          yield* Effect.flip(second.run(key, secondShop.insert, args)),
        ).toMatchObject({ reason: "closed" });
        expect(
          yield* Effect.flip(
            second.run(second.newRequestKey(), secondShop.insert, args),
          ),
        ).toMatchObject({ reason: "closed" });
        expect([
          firstShop.executionCount(),
          firstShop.readExecutionCount(),
          secondShop.executionCount(),
          secondShop.readExecutionCount(),
        ]).toEqual(counts);
        const tooSmall = yield* makePreparedHostRuntime({
          maximumHosts: 1,
          maximumPreparedBytes: 1,
        });
        // Both attempts must fail at metadata accounting, not because the failed
        // first construction leaked its host slot.
        for (let attempt = 0; attempt < 2; attempt++) {
          const failure = yield* Effect.flip(
            makeCmsHost({ ...firstShop.input, hostRuntime: tooSmall }),
          );
          expect(failure).toMatchObject({
            reason: "resourceFailure",
            cause: { reason: "capacityExceeded" },
          });
        }
        const referenceRuntime = yield* makePreparedHostRuntime({ maximumHosts: 2, maximumPreparedBytes: 2_097_152 });
        const referenceInput = { ...firstShop.input, hostRuntime: referenceRuntime };
        const referenceEntered = yield* Deferred.make<void>();
        const referenceRelease = yield* Deferred.make<void>();
        yield* Effect.addFinalizer(() => Deferred.succeed(referenceRelease, undefined));
        const readReference = yield* makeCe0CmsReadReference(referenceInput, {
          afterAdmission: () => Deferred.succeed(referenceEntered, undefined).pipe(Effect.andThen(Deferred.await(referenceRelease))),
        });
        const mutationReference = yield* makeCe0CmsMutationReference(referenceInput);
        expect(yield* Effect.flip(makeCe0CmsReadReference(referenceInput))).toMatchObject({
          reason: "resourceFailure", cause: { reason: "capacityExceeded" },
        });
        const referenceKey = firstShop.host.newRequestKey();
        const referenceArgs = { count: 1, prefix: "reference-lifetime" };
        const referenceResult = yield* mutationReference.run(referenceKey, referenceArgs);
        expect(yield* mutationReference.run(referenceKey, referenceArgs)).toEqual(referenceResult);
        expect(mutationReference.executionCount()).toBe(1);
        yield* mutationReference.close;
        expect(yield* Effect.flip(mutationReference.run(referenceKey, referenceArgs))).toMatchObject({ reason: "closed" });
        expect(mutationReference.executionCount()).toBe(1);
        const readingReference = yield* Effect.forkChild(readReference.read([]));
        yield* Deferred.await(referenceEntered);
        let referenceClosed = false;
        const closingReference = yield* Effect.forkChild(readReference.close.pipe(Effect.tap(() => Effect.sync(() => { referenceClosed = true; }))));
        yield* Effect.yieldNow;
        expect(referenceClosed).toBe(false);
        expect(yield* Effect.flip(readReference.read([]))).toMatchObject({ reason: "closed" });
        yield* Deferred.succeed(referenceRelease, undefined);
        expect(yield* Fiber.join(readingReference)).toEqual([]);
        yield* Fiber.join(closingReference);
        expect(referenceClosed).toBe(true);
        expect(readReference.executionCount()).toBe(1);
        const referenceReplacement = yield* makeCe0CmsReadReference(referenceInput);
        expect(yield* referenceReplacement.read([])).toEqual([]);
      }),
    ),
  );
}, 180_000);
