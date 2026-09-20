import { describe, expect, it } from "vitest";
import { Cause, Clock, Deferred, Effect, Exit, Fiber, Schema } from "effect";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "./postgresHelpers";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { makeCmsHost } from "../src/cmsTransaction/host";
import { makeCe0EmptyMutationReference } from "./ce0EmptyMutationReference";
import { ce0EmptyMutationReferenceScenario } from "./ce0EmptyMutationReferenceScenario";
import { runEffect } from "./effectTestRuntime";

const decodeWaiters = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ pid: Schema.Int })),
);
const waitForReferenceBlocker = Effect.fn("Ce0EmptyReference.waitForBlocker")(
  function* (persistence: PostgresFlarexPersistence, holderPid: number) {
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
  },
);

describe.skipIf(postgresUrl === null)(
  "zero-row request reference (Postgres)",
  () => {
    const withPersistence = useFileScopedPostgresPersistence();
    it(
      "cross-replays, rolls back and recovers actual ambiguous settlement",
      () =>
        withPersistence(async (persistence) => {
          expect(
            (
              await persistence.query<{ superuser: boolean }>(
                "select rolsuper as superuser from pg_roles where rolname=current_user",
              )
            ).rows[0]?.superuser,
          ).toBe(false);
          const { tested, reference, args, other, otherReference } =
            await ce0EmptyMutationReferenceScenario(
              persistence,
              makePostgresRelationalSession(persistence),
            );
          for (const implementation of ["core", "reference"] as const) {
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
              makeCe0EmptyMutationReference({ ...tested.input, session }),
            );
            const before = await tested.inventory();
            const executions = tested.executionCount();
            const key = tested.host.newRequestKey();
            expect(
              await runEffect(
                implementation === "core"
                  ? core.run(key, tested.insert, args)
                  : ref.run(key, args),
              ),
            ).toEqual([]);
            expect(
              tested.executionCount() - executions + ref.executionCount(),
            ).toBe(1);
            expect(acquiredPids).toHaveLength(2);
            expect(acquiredPids[1]).not.toBe(failedPid);
            const after = await tested.verifyInsert(before, [], 0, args.prefix);
            expect(
              await runEffect(tested.host.run(key, tested.insert, args)),
            ).toEqual([]);
            expect(await runEffect(reference.run(key, args))).toEqual([]);
            expect(
              tested.executionCount() - executions + ref.executionCount(),
            ).toBe(1);
            expect(await tested.inventory()).toEqual(after);
          }

          // A failure before sending COMMIT is conservatively uncertain to the
          // physical owner. Quarantine rolls back its prefix; recovery must not
          // interpret the absent outcome as permission to execute again.
          for (const implementation of ["core", "reference"] as const) {
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
              makeCe0EmptyMutationReference({ ...tested.input, session }),
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
            expect(await runEffect(reference.run(key, args))).toEqual([]);
            expect(reference.executionCount()).toBe(referenceCallbacks + 1);
            const after = await tested.verifyInsert(before, [], 0, args.prefix);
            expect(
              await runEffect(tested.host.run(key, tested.insert, args)),
            ).toEqual([]);
            expect(
              tested.executionCount() - callbacks + ref.executionCount(),
            ).toBe(1);
            expect(await tested.inventory()).toEqual(after);
          }

          // Cancel the external caller immediately after PostgreSQL has committed.
          // The durable request remains replayable without another callback.
          for (const implementation of ["core", "reference"] as const) {
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
              makeCe0EmptyMutationReference({ ...tested.input, session }),
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
            if (Exit.isFailure(cancelled))
              expect(
                cancelled.cause.reasons.some(Cause.isInterruptReason),
              ).toBe(true);
            const after = await tested.verifyInsert(before, [], 0, args.prefix);
            expect(
              await runEffect(tested.host.run(key, tested.insert, args)),
            ).toEqual([]);
            expect(await runEffect(reference.run(key, args))).toEqual([]);
            expect(
              tested.executionCount() - executions + ref.executionCount(),
            ).toBe(1);
            expect(await tested.inventory()).toEqual(after);
          }

          for (const implementation of ["core", "reference"] as const) {
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
            const ref = await runEffect(makeCe0EmptyMutationReference(input));
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
            if (Exit.isFailure(cancelled))
              expect(
                cancelled.cause.reasons.some(Cause.isInterruptReason),
              ).toBe(true);
            expect(
              tested.executionCount() - executions + ref.executionCount(),
            ).toBe(1);
            expect(await tested.inventory()).toEqual(before);
            expect(await runEffect(reference.run(key, args))).toEqual([]);
            await tested.verifyInsert(before, [], 0, args.prefix);
          }

          const before = await tested.inventory();
          const counts = tested.executionCount() + reference.executionCount();
          const key = tested.host.newRequestKey();
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
          await runEffect(
            Effect.scoped(
              Effect.gen(function* () {
                const pair = yield* Effect.all(
                  [
                    heldCore.run(key, tested.insert, args),
                    Deferred.await(entered).pipe(
                      Effect.andThen(reference.run(key, args)),
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
                expect(yield* Fiber.join(pair)).toEqual([[], []]);
              }).pipe(
                Effect.ensuring(Deferred.succeed(release, undefined)),
                Effect.timeout("20 seconds"),
              ),
            ),
          );
          expect(tested.executionCount() + reference.executionCount()).toBe(
            counts + 1,
          );
          await tested.verifyInsert(before, [], 0, args.prefix);
          expect(persistence.pool.waitingCount).toBe(0);
          expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);

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
          await runEffect(
            Effect.scoped(
              Effect.gen(function* () {
                const held = yield* scopeHolder
                  .run(sharedKey, tested.insert, args)
                  .pipe(Effect.forkScoped);
                yield* Deferred.await(scopeEntered);
                expect(yield* otherReference.run(sharedKey, args)).toEqual([]);
                expect(yield* Deferred.isDone(scopeRelease)).toBe(false);
                expect(otherReference.executionCount()).toBe(
                  otherCallbacks + 1,
                );
                expect(yield* Effect.promise(() => tested.inventory())).toEqual(
                  scopeBefore,
                );
                yield* Deferred.succeed(scopeRelease, undefined);
                expect(yield* Fiber.join(held)).toEqual([]);
              }).pipe(
                Effect.ensuring(Deferred.succeed(scopeRelease, undefined)),
                Effect.timeout("20 seconds"),
              ),
            ),
          );
          await tested.verifyInsert(scopeBefore, [], 0, args.prefix);
          await other.verifyInsert(otherBefore, [], 0, args.prefix);
          expect(await runEffect(reference.run(sharedKey, args))).toEqual([]);
          expect(
            await runEffect(other.host.run(sharedKey, other.insert, args)),
          ).toEqual([]);
          expect(otherReference.executionCount()).toBe(otherCallbacks + 1);
          expect(persistence.pool.waitingCount).toBe(0);
          expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
        }),
      180_000,
    );
  },
);
