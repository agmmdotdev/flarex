import { Clock, Deferred, Effect, Fiber, Schema } from "effect";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createPointCommitPublisherPortV1,
} from "../../src/commit/point/construction";
import { advanceScopeAuthorizationRevocationEpochInTransactionEffect } from "../../src/scope/scopeClock";
import {
  makePostgresRelationalSession,
  runRelationalSession,
} from "../../src/database/relationalTransaction/session";
import { runDrizzleStatementEffect } from "../../src/database/drizzleStatementEffect";
import { fxSystemScopeClocks } from "../../src/database/schema";
import { cmsExecutionMeasurementFixture } from "./cmsTransaction/cmsExecutionMeasurementFixture";
import { prepareNativeRangePublication } from "./nativeCommandPublicationScenario";
import { verifyNativeAuditPublication } from "./cmsTransaction/nativeCmsPublicationScenario";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "../support/postgresHelpers";
import { runEffect } from "../support/effectTestRuntime";

const decodeWaiter = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ waiting: Schema.Boolean })),
);

describe.skipIf(postgresUrl === null)(
  "native admission before publication",
  () => {
    const withPersistence = useFileScopedPostgresPersistence();

    it.each(["disjoint", "predicate", "duplicate"] as const)(
      "admits other publication while native schema validation is held: %s",
      (scenario) =>
        withPersistence(async (persistence) => {
          const tested = await cmsExecutionMeasurementFixture(
            persistence,
            makePostgresRelationalSession(persistence),
          );
          const first = await runEffect(
            prepareNativeRangePublication(tested.fixture, "held-native"),
          );
          const second =
            scenario === "disjoint"
              ? await runEffect(
                  prepareNativeRangePublication(
                    tested.fixture,
                    "independent-native",
                  ),
                )
              : first;
          const entered = await runEffect(Deferred.make<void>());
          const release = await runEffect(Deferred.make<void>());
          const before = await tested.inventory();
          const steps: string[] = [];
          const heldPublisher = createPointCommitPublisherPortV1(
            tested.fixture.pointCommitAuthority,
            {
              ...first.options,
              afterTransactionStep: (event) => {
                steps.push(event.step);
                return event.step === "activeApplicationSchemaValidated"
                  ? runEffect(
                      Deferred.succeed(entered, undefined).pipe(
                        Effect.andThen(Deferred.await(release)),
                      ),
                    )
                  : Promise.resolve();
              },
            },
          );
          await runEffect(
            Effect.scoped(
              Effect.gen(function* () {
                const held = yield* heldPublisher
                  .publish(first.command)
                  .pipe(Effect.result, Effect.forkScoped);
                yield* Deferred.await(entered).pipe(
                  Effect.timeout("5 seconds"),
                );
                expect(steps).toContain("lifecycleProtected");
                expect(steps).not.toContain("clockLocked");
                expect(steps).not.toContain("sessionLocked");
                if (scenario === "predicate") {
                  yield* tested.host.run(
                    tested.host.newRequestKey(),
                    tested.insert,
                    { count: 1, prefix: "phantom-during-admission" },
                  );
                } else {
                  expect(
                    yield* createPointCommitPublisherPortV1(
                      tested.fixture.pointCommitAuthority,
                      second.options,
                    ).publish(second.command),
                  ).toMatchObject({ kind: "published" });
                }
                const afterOther = yield* Effect.promise(() =>
                  tested.inventory(),
                );
                expect(afterOther.commits.length).toBe(
                  before.commits.length + 1,
                );
                expect(yield* Deferred.isDone(release)).toBe(false);
                yield* Deferred.succeed(release, undefined);
                const result = yield* Fiber.join(held);
                if (scenario === "predicate") {
                  expect(result).toMatchObject({
                    _tag: "Failure",
                    failure: {
                      _tag: "PointCommitConflictV1Error",
                      conflict: { kind: "appIndexRange", reason: "overlap" },
                    },
                  });
                  expect(
                    yield* Effect.promise(() => tested.inventory()),
                  ).toEqual(afterOther);
                } else if (scenario === "duplicate") {
                  expect(result).toMatchObject({
                    _tag: "Success",
                    success: { kind: "replayed" },
                  });
                  expect(steps).not.toContain("sessionLocked");
                  expect(
                    yield* Effect.promise(() => tested.inventory()),
                  ).toEqual(afterOther);
                } else {
                  expect(result).toMatchObject({
                    _tag: "Success",
                    success: { kind: "published" },
                  });
                  yield* Effect.promise(() =>
                    verifyNativeAuditPublication(tested, afterOther),
                  );
                }
              }).pipe(
                Effect.ensuring(Deferred.succeed(release, undefined)),
                Effect.timeout("20 seconds"),
              ),
            ),
          );
          expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
        }),
      120_000,
    );

    it(
      "resolves a duplicate published after lifecycle clock capture using a coherent outcome ceiling",
      () =>
        withPersistence(async (persistence) => {
          const tested = await cmsExecutionMeasurementFixture(
            persistence,
            makePostgresRelationalSession(persistence),
          );
          const prepared = await runEffect(
            prepareNativeRangePublication(
              tested.fixture,
              "duplicate-before-admission",
            ),
          );
          const entered = await runEffect(Deferred.make<void>());
          const release = await runEffect(Deferred.make<void>());
          const steps: string[] = [];
          const publisher = createPointCommitPublisherPortV1(
            tested.fixture.pointCommitAuthority,
            {
              ...prepared.options,
              afterTransactionStep: (event) => {
                steps.push(event.step);
                return event.step === "lifecycleProtected"
                  ? runEffect(
                      Deferred.succeed(entered, undefined).pipe(
                        Effect.andThen(Deferred.await(release)),
                      ),
                    )
                  : Promise.resolve();
              },
            },
          );
          await runEffect(
            Effect.scoped(
              Effect.gen(function* () {
                const held = yield* publisher
                  .publish(prepared.command)
                  .pipe(Effect.forkScoped);
                yield* Deferred.await(entered).pipe(
                  Effect.timeout("5 seconds"),
                );
                expect(
                  yield* createPointCommitPublisherPortV1(
                    tested.fixture.pointCommitAuthority,
                    prepared.options,
                  ).publish(prepared.command),
                ).toMatchObject({ kind: "published" });
                const after = yield* Effect.promise(() => tested.inventory());
                yield* Deferred.succeed(release, undefined);
                expect(yield* Fiber.join(held)).toMatchObject({
                  kind: "replayed",
                });
                expect(steps).toEqual([
                  "lifecycleProtected",
                  "outcomeRechecked",
                ]);
                expect(yield* Effect.promise(() => tested.inventory())).toEqual(
                  after,
                );
              }).pipe(
                Effect.ensuring(Deferred.succeed(release, undefined)),
                Effect.timeout("20 seconds"),
              ),
            ),
          );
          expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
        }),
      120_000,
    );

    it(
      "settles two admitted native publishers before queued revocation, then refuses an old attempt",
      () =>
        withPersistence(async (persistence) => {
          const session = makePostgresRelationalSession(persistence);
          const tested = await cmsExecutionMeasurementFixture(
            persistence,
            session,
          );
          const first = await runEffect(
            prepareNativeRangePublication(
              tested.fixture,
              "first-before-revocation",
            ),
          );
          const second = await runEffect(
            prepareNativeRangePublication(
              tested.fixture,
              "second-before-revocation",
            ),
          );
          const stale = await runEffect(
            prepareNativeRangePublication(
              tested.fixture,
              "stale-after-revocation",
            ),
          );
          const entered = await runEffect(Deferred.make<void>());
          const release = await runEffect(Deferred.make<void>());
          let admissions = 0;
          let lifecyclePid = 0;
          const publisher = createPointCommitPublisherPortV1(
            tested.fixture.pointCommitAuthority,
            {
              ...first.options,
              afterTransactionStep: (event) =>
                event.step === "activeApplicationSchemaValidated"
                  ? runEffect(
                      Effect.gen(function* () {
                        if (++admissions === 2)
                          yield* Deferred.succeed(entered, undefined);
                        yield* Deferred.await(release);
                      }),
                    )
                  : Promise.resolve(),
            },
          );
          const before = await tested.inventory();
          await runEffect(
            Effect.scoped(
              Effect.gen(function* () {
                const a = yield* publisher
                  .publish(first.command)
                  .pipe(Effect.forkScoped);
                const b = yield* publisher
                  .publish(second.command)
                  .pipe(Effect.forkScoped);
                yield* Deferred.await(entered).pipe(
                  Effect.timeout("5 seconds"),
                );
                const revocation = yield* runRelationalSession(
                  session,
                  "command",
                  (tx) =>
                    Effect.gen(function* () {
                      const rows = yield* runDrizzleStatementEffect(
                        tx
                          .select({ pid: sql<number>`pg_backend_pid()` })
                          .from(fxSystemScopeClocks)
                          .limit(1),
                        (cause) =>
                          new Error("Could not read lifecycle backend", {
                            cause,
                          }),
                      );
                      lifecyclePid = rows[0]?.pid ?? 0;
                      return yield* advanceScopeAuthorizationRevocationEpochInTransactionEffect(
                        tx,
                        tested.fixture.authority.scopeId,
                      );
                    }),
                ).pipe(Effect.forkScoped);
                const deadline =
                  (yield* Clock.monotonicTimeNanos) + 3_000_000_000n;
                let waiting = false;
                while (
                  !waiting &&
                  (yield* Clock.monotonicTimeNanos) < deadline
                ) {
                  const result = yield* Effect.tryPromise({
                    try: () =>
                      persistence.query(
                        "select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock') as waiting",
                        [lifecyclePid],
                      ),
                    catch: (cause) =>
                      new Error("Could not inspect lifecycle waiter", {
                        cause,
                      }),
                  });
                  waiting =
                    (yield* decodeWaiter(result.rows))[0]?.waiting === true;
                  if (!waiting) yield* Effect.sleep("10 millis");
                }
                expect(waiting).toBe(true);
                expect(yield* Effect.promise(() => tested.inventory())).toEqual(
                  before,
                );
                yield* Deferred.succeed(release, undefined);
                expect(yield* Fiber.join(a)).toMatchObject({
                  kind: "published",
                });
                expect(yield* Fiber.join(b)).toMatchObject({
                  kind: "published",
                });
                expect(yield* Fiber.join(revocation)).toEqual({
                  previous: 0n,
                  current: 1n,
                });
              }).pipe(
                Effect.ensuring(Deferred.succeed(release, undefined)),
                Effect.timeout("20 seconds"),
              ),
            ),
          );
          const after = await tested.inventory();
          expect(after.commits.length).toBe(before.commits.length + 2);
          expect(after.outcomes.length).toBe(before.outcomes.length + 2);
          expect(after.clock[0]?.lastCommitSeq).toBe(
            (before.clock[0]?.lastCommitSeq ?? -1n) + 2n,
          );
          expect(
            await runEffect(
              publisher.publish(stale.command).pipe(Effect.result),
            ),
          ).toMatchObject({
            _tag: "Failure",
            failure: {
              _tag: "PointCommitStaleAuthorityV1Error",
              reason: "revocationEpochChanged",
            },
          });
          expect(
            await runEffect(publisher.publish(first.command)),
          ).toMatchObject({ kind: "replayed" });
          expect(await tested.inventory()).toEqual(after);
          expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
        }),
      120_000,
    );
  },
);
