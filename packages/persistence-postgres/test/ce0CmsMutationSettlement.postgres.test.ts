import { describe, expect, it } from "vitest";
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Schema } from "effect";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "./postgresHelpers";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { makeCmsHost } from "../src/cmsTransaction/host";
import { makeCe0CmsMutationReference } from "./ce0CmsMutationReference";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { runEffect } from "./effectTestRuntime";

const decodeWaiters = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ pid: Schema.Int })),
);
const waitForReferenceBlocker = Effect.fn(
  "Ce0MutationSettlement.waitForBlocker",
)(function* (persistence: PostgresFlarexPersistence, holderPid: number) {
  const deadline = (yield* Clock.monotonicTimeNanos) + 5_000_000_000n;
  while ((yield* Clock.monotonicTimeNanos) < deadline) {
    const result = yield* Effect.tryPromise({
      try: () =>
        persistence.query(
          `select pid from pg_stat_activity
        where datname=current_database() and wait_event_type='Lock'
        and $1::int=any(pg_blocking_pids(pid)) and position('fx_system_scope_clock' in query)>0`,
          [holderPid],
        ),
      catch: (cause) =>
        new Error("Could not observe reference scope-clock waiter", {
          cause,
        }),
    });
    const waiters = yield* decodeWaiters(result.rows);
    const waiter = waiters[0];
    if (waiter !== undefined) return waiter.pid;
    yield* Effect.sleep("10 millis");
  }
  return yield* Effect.fail(
    new Error("Reference request never blocked on the held core publication"),
  );
});

describe.skipIf(postgresUrl === null)(
  "mutation request settlement reference (Postgres)",
  () => {
    const withPersistence = useFileScopedPostgresPersistence();
    it.each([0, 8] as const)(
      "settles %i-row requests under uncertainty, cancellation and concurrency",
      (count) =>
        withPersistence(async (persistence) => {
          expect(
            (
              await persistence.query<{ superuser: boolean }>(
                "select rolsuper as superuser from pg_roles where rolname=current_user",
              )
            ).rows[0]?.superuser,
          ).toBe(false);
          const session = makePostgresRelationalSession(persistence);
          const tested = await cmsExecutionMeasurementFixture(
            persistence,
            session,
          );
          const other = await cmsExecutionMeasurementFixture(
            persistence,
            session,
          );
          const reference = await runEffect(
            makeCe0CmsMutationReference(tested.input),
          );
          const otherReference = await runEffect(
            makeCe0CmsMutationReference(other.input),
          );
          for (const implementation of ["core", "reference"] as const) {
            const args = { count, prefix: `settlement-1-${implementation}` };
            let failedPid: number | undefined;
            const acquiredPids: number[] = [];
            const session = makePostgresRelationalSession(persistence, {
              lifecycleFault: (event) => {
                const pid: unknown = Reflect.get(event.client, "processID");
                if (typeof pid !== "number")
                  throw new Error("Expected backend PID");
                if (event.phase === "begin" && event.edge === "after")
                  acquiredPids.push(pid);
                if (
                  event.phase === "commit" &&
                  event.edge === "after" &&
                  failedPid === undefined
                ) {
                  failedPid = pid;
                  throw new Error("Lost COMMIT acknowledgement");
                }
              },
            });
            const core = await runEffect(
              makeCmsHost({ ...tested.input, session }),
            );
            const ref = await runEffect(
              makeCe0CmsMutationReference({ ...tested.input, session }),
            );
            const before = await tested.inventory();
            const executions = tested.executionCount();
            const key = tested.host.newRequestKey();
            const value = await runEffect(
              implementation === "core"
                ? core.run(key, tested.insert, args)
                : ref.run(key, args),
            );
            expect(
              tested.executionCount() - executions + ref.executionCount(),
            ).toBe(1);
            expect(acquiredPids).toHaveLength(2);
            expect(acquiredPids[1]).not.toBe(failedPid);
            const after = await tested.verifyInsert(
              before,
              value,
              count,
              args.prefix,
            );
            expect(
              await runEffect(tested.host.run(key, tested.insert, args)),
            ).toEqual(value);
            expect(await runEffect(reference.run(key, args))).toEqual(value);
            expect(
              tested.executionCount() - executions + ref.executionCount(),
            ).toBe(1);
            expect(await tested.inventory()).toEqual(after);
          }

          // A failure before sending COMMIT is conservatively uncertain to the
          // physical owner. Quarantine rolls back its prefix; recovery must not
          // interpret the absent outcome as permission to execute again.
          for (const implementation of ["core", "reference"] as const) {
            const args = { count, prefix: `settlement-2-${implementation}` };
            const fault = new Error(
              "COMMIT boundary failed before transmission",
            );
            let failedPid: number | undefined;
            const acquiredPids: number[] = [];
            const session = makePostgresRelationalSession(persistence, {
              lifecycleFault: (event) => {
                const pid: unknown = Reflect.get(event.client, "processID");
                if (typeof pid !== "number")
                  throw new Error("Expected backend PID");
                if (event.phase === "begin" && event.edge === "after")
                  acquiredPids.push(pid);
                if (
                  event.phase === "commit" &&
                  event.edge === "before" &&
                  failedPid === undefined
                ) {
                  failedPid = pid;
                  throw fault;
                }
              },
            });
            const core = await runEffect(
              makeCmsHost({ ...tested.input, session }),
            );
            const ref = await runEffect(
              makeCe0CmsMutationReference({ ...tested.input, session }),
            );
            const before = await tested.inventory();
            const callbacks = tested.executionCount();
            const key = tested.host.newRequestKey();
            const failed = await runEffect(
              Effect.exit(
                implementation === "core"
                  ? core.run(key, tested.insert, args)
                  : ref.run(key, args),
              ),
            );
            expect(Exit.isFailure(failed)).toBe(true);
            if (Exit.isFailure(failed)) {
              expect(failed.cause.reasons).toHaveLength(2);
              expect(failed.cause.reasons.every(Cause.isFailReason)).toBe(true);
              expect(
                failed.cause.reasons
                  .filter(Cause.isFailReason)
                  .map((reason) => reason.error),
              ).toMatchObject([
                {
                  reason: "decisionUncertain",
                  cause: { reason: "decisionUncertain" },
                },
                { reason: "decisionUncertain" },
              ]);
            }
            expect(acquiredPids).toHaveLength(2);
            expect(acquiredPids[0]).toBe(failedPid);
            expect(acquiredPids[1]).not.toBe(failedPid);
            expect(
              tested.executionCount() - callbacks + ref.executionCount(),
            ).toBe(1);
            expect(await tested.inventory()).toEqual(before);
            // Explicit re-entry is a new caller decision after the uncertain
            // refusal; it is not the automatic recovery branch above.
            const referenceCallbacks = reference.executionCount();
            const value = await runEffect(reference.run(key, args));
            expect(reference.executionCount()).toBe(referenceCallbacks + 1);
            const after = await tested.verifyInsert(
              before,
              value,
              count,
              args.prefix,
            );
            expect(
              await runEffect(tested.host.run(key, tested.insert, args)),
            ).toEqual(value);
            expect(
              tested.executionCount() - callbacks + ref.executionCount(),
            ).toBe(1);
            expect(await tested.inventory()).toEqual(after);
          }

          // Cancel the external caller immediately after PostgreSQL has committed.
          // The durable request remains replayable without another callback.
          for (const implementation of ["core", "reference"] as const) {
            const args = { count, prefix: `settlement-3-${implementation}` };
            const controller = new AbortController();
            let acknowledged = false;
            const session = makePostgresRelationalSession(persistence, {
              lifecycleFault: (event) => {
                if (event.phase === "commit" && event.edge === "after") {
                  acknowledged = true;
                  controller.abort();
                }
              },
            });
            const core = await runEffect(
              makeCmsHost({ ...tested.input, session }),
            );
            const ref = await runEffect(
              makeCe0CmsMutationReference({ ...tested.input, session }),
            );
            const before = await tested.inventory();
            const executions = tested.executionCount();
            const key = tested.host.newRequestKey();
            const cancelled = await Effect.runPromiseExit(
              implementation === "core"
                ? core.run(key, tested.insert, args)
                : ref.run(key, args),
              { signal: controller.signal },
            );
            expect(acknowledged).toBe(true);
            expect(Exit.isFailure(cancelled)).toBe(true);
            if (Exit.isFailure(cancelled)) {
              expect(cancelled.cause.reasons.length).toBeGreaterThan(0);
              expect(
                cancelled.cause.reasons.every(Cause.isInterruptReason),
              ).toBe(true);
            }
            const durable = await tested.inventory();
            expect(durable.rows.length - before.rows.length).toBe(count);
            expect(durable.outcomes.length - before.outcomes.length).toBe(1);
            expect(durable.commits.length - before.commits.length).toBe(1);
            const executed =
              tested.executionCount() +
              ref.executionCount() +
              reference.executionCount();
            const value = await runEffect(reference.run(key, args));
            expect(
              tested.executionCount() +
                ref.executionCount() +
                reference.executionCount(),
            ).toBe(executed);
            expect(await tested.inventory()).toEqual(durable);
            const after = await tested.verifyInsert(
              before,
              value,
              count,
              args.prefix,
            );
            expect(
              await runEffect(tested.host.run(key, tested.insert, args)),
            ).toEqual(value);
            expect(await runEffect(reference.run(key, args))).toEqual(value);
            expect(
              tested.executionCount() - executions + ref.executionCount(),
            ).toBe(1);
            expect(await tested.inventory()).toEqual(after);
          }

          for (const implementation of ["core", "reference"] as const) {
            const args = { count, prefix: `settlement-4-${implementation}` };
            const controller = new AbortController();
            let completePrefix = false;
            const input = {
              ...tested.input,
              materialization: {
                ...tested.input.materialization,
                afterTransactionStep: async (event: {
                  readonly step: string;
                }) => {
                  if (event.step === "clockAdvanced") {
                    completePrefix = true;
                    controller.abort();
                  }
                },
              },
            };
            const core = await runEffect(makeCmsHost(input));
            const ref = await runEffect(makeCe0CmsMutationReference(input));
            const before = await tested.inventory();
            const executions = tested.executionCount();
            const key = tested.host.newRequestKey();
            const cancelled = await Effect.runPromiseExit(
              implementation === "core"
                ? core.run(key, tested.insert, args)
                : ref.run(key, args),
              { signal: controller.signal },
            );
            expect(completePrefix).toBe(true);
            expect(Exit.isFailure(cancelled)).toBe(true);
            if (Exit.isFailure(cancelled)) {
              expect(cancelled.cause.reasons.length).toBeGreaterThan(0);
              expect(
                cancelled.cause.reasons.every(Cause.isInterruptReason),
              ).toBe(true);
            }
            expect(
              tested.executionCount() - executions + ref.executionCount(),
            ).toBe(1);
            expect(await tested.inventory()).toEqual(before);
            const value = await runEffect(reference.run(key, args));
            await tested.verifyInsert(before, value, count, args.prefix);
          }

          const races =
            count === 0
              ? (["duplicate", "disjoint"] as const)
              : (["duplicate", "disjoint", "unique"] as const);
          for (const race of races) {
            const args = { count, prefix: `delivery-${race}` };
            const before = await tested.inventory();
            const counts = tested.executionCount() + reference.executionCount();
            const key = tested.host.newRequestKey();
            const contenderKey =
              race === "duplicate" ? key : tested.host.newRequestKey();
            const contenderArgs =
              race === "disjoint"
                ? { ...args, prefix: args.prefix + "-other" }
                : args;
            const entered = await runEffect(Deferred.make<void>());
            const release = await runEffect(Deferred.make<void>());
            let holderPid = 0;
            const heldSession = makePostgresRelationalSession(persistence, {
              lifecycleFault: (event) => {
                if (event.phase === "begin" && event.edge === "after") {
                  const pid: unknown = Reflect.get(event.client, "processID");
                  if (typeof pid !== "number")
                    throw new Error("Expected held backend PID");
                  holderPid = pid;
                }
              },
            });
            const heldCore = await runEffect(
              makeCmsHost(
                { ...tested.input, session: heldSession },
                {
                  afterPreferenceFacts: () =>
                    Deferred.succeed(entered, undefined).pipe(
                      Effect.andThen(Deferred.await(release)),
                    ),
                },
              ),
            );
            const values = await runEffect(
              Effect.scoped(
                Effect.gen(function* () {
                  const pair = yield* Effect.all(
                    [
                      heldCore.run(key, tested.insert, args),
                      Deferred.await(entered).pipe(
                        Effect.andThen(
                          Effect.exit(
                            reference.run(contenderKey, contenderArgs),
                          ),
                        ),
                      ),
                    ],
                    { concurrency: 2 },
                  ).pipe(Effect.forkScoped);
                  yield* Deferred.await(entered);
                  expect(holderPid).toBeGreaterThan(0);
                  const waiterPid = yield* waitForReferenceBlocker(
                    persistence,
                    holderPid,
                  );
                  expect(waiterPid).not.toBe(holderPid);
                  expect(yield* Deferred.isDone(release)).toBe(false);
                  expect(
                    reference.executionCount() + tested.executionCount(),
                  ).toBe(counts + 1);
                  yield* Deferred.succeed(release, undefined);
                  return yield* Fiber.join(pair);
                }).pipe(
                  Effect.ensuring(Deferred.succeed(release, undefined)),
                  Effect.timeout("20 seconds"),
                ),
              ),
            );
            expect(tested.executionCount() + reference.executionCount()).toBe(
              counts + (race === "duplicate" ? 1 : 2),
            );
            const contender = values[1];
            if (race === "unique") {
              expect(Exit.isFailure(contender)).toBe(true);
              if (Exit.isFailure(contender)) {
                expect(contender.cause.reasons).toHaveLength(1);
                expect(
                  contender.cause.reasons
                    .filter(Cause.isFailReason)
                    .map((reason) => reason.error),
                ).toMatchObject([{ reason: "uniqueConflict" }]);
              }
              await tested.verifyInsert(before, values[0], count, args.prefix);
            } else {
              expect(Exit.isSuccess(contender)).toBe(true);
              if (Exit.isFailure(contender))
                throw new Error(Cause.pretty(contender.cause));
              if (race === "duplicate") {
                expect(contender.value).toEqual(values[0]);
                await tested.verifyInsert(
                  before,
                  values[0],
                  count,
                  args.prefix,
                );
              } else {
                await tested.verifyInserts(before, [
                  { value: values[0], count, prefix: args.prefix },
                  {
                    value: contender.value,
                    count,
                    prefix: contenderArgs.prefix,
                  },
                ]);
              }
            }
            expect(persistence.pool.waitingCount).toBe(0);
            expect(persistence.pool.idleCount).toBe(
              persistence.pool.totalCount,
            );
          }
          const scopeArgs = { count, prefix: "independent-scope" };
          const scopeEntered = await runEffect(Deferred.make<void>());
          const scopeRelease = await runEffect(Deferred.make<void>());
          const scopeHolder = await runEffect(
            makeCmsHost(tested.input, {
              afterPreferenceFacts: () =>
                Deferred.succeed(scopeEntered, undefined).pipe(
                  Effect.andThen(Deferred.await(scopeRelease)),
                ),
            }),
          );
          const scopeBefore = await tested.inventory();
          const otherBefore = await other.inventory();
          const sharedKey = tested.host.newRequestKey();
          const otherCallbacks = otherReference.executionCount();
          const scopeValues = await runEffect(
            Effect.scoped(
              Effect.gen(function* () {
                const held = yield* scopeHolder
                  .run(sharedKey, tested.insert, scopeArgs)
                  .pipe(Effect.forkScoped);
                yield* Deferred.await(scopeEntered);
                const otherValue = yield* otherReference.run(
                  sharedKey,
                  scopeArgs,
                );
                expect(yield* Deferred.isDone(scopeRelease)).toBe(false);
                expect(otherReference.executionCount()).toBe(
                  otherCallbacks + 1,
                );
                expect(yield* Effect.promise(() => tested.inventory())).toEqual(
                  scopeBefore,
                );
                yield* Deferred.succeed(scopeRelease, undefined);
                return { value: yield* Fiber.join(held), otherValue };
              }).pipe(
                Effect.ensuring(Deferred.succeed(scopeRelease, undefined)),
                Effect.timeout("20 seconds"),
              ),
            ),
          );
          await tested.verifyInsert(
            scopeBefore,
            scopeValues.value,
            count,
            scopeArgs.prefix,
          );
          await other.verifyInsert(
            otherBefore,
            scopeValues.otherValue,
            count,
            scopeArgs.prefix,
          );
          expect(await runEffect(reference.run(sharedKey, scopeArgs))).toEqual(
            scopeValues.value,
          );
          expect(
            await runEffect(other.host.run(sharedKey, other.insert, scopeArgs)),
          ).toEqual(scopeValues.otherValue);
          expect(otherReference.executionCount()).toBe(otherCallbacks + 1);
          expect(persistence.pool.waitingCount).toBe(0);
          expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
        }),
      180_000,
    );
  },
);
