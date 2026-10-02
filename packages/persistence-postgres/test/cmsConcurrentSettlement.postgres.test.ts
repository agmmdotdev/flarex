import { Clock, Deferred, Effect, Fiber, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { makeCmsHost } from "../src/cmsTransaction/host";
import { defineCmsCommand } from "../src/cmsTransaction/commands";
import { cmsError } from "../src/cmsTransaction/model";
import {
  makePostgresRelationalSession,
  runRelationalSession,
} from "../src/relationalTransaction/session";
import { fxSystemScopeClocks } from "../src/schema";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import { advanceScopeAuthorizationRevocationEpochInTransactionEffect } from "../src/scopeClock";
import { sql } from "drizzle-orm";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "./postgresHelpers";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

const decodeRows = Schema.decodeUnknownSync(
  Schema.Array(Schema.Struct({ _id: Schema.String, title: Schema.String })),
);
const decodePatch = Schema.decodeUnknownEffect(
  Schema.Struct({ id: Schema.String, title: Schema.String }),
);
const decodeWaiter = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ waiting: Schema.Boolean })),
);

describe.skipIf(postgresUrl === null)(
  "CMS concurrent command settlement",
  () => {
    const withPersistence = useFileScopedPostgresPersistence();
    it.each([
      "independent",
      "same-row",
      "read-decision",
      "unique",
      "scan",
      "fresh-read",
      "key-present",
      "key-absent",
      "key-independent",
      "key-absent-scan",
      "key-turnover-scan",
      "scan-first",
    ] as const)(
      "overlaps commands and validates %s decisions",
      (mode) =>
        withPersistence(async (persistence) => {
          const absentKey = mode === "key-absent" || mode === "key-absent-scan";
          const keyLookup = mode.startsWith("key-");
          const tested = await cmsExecutionMeasurementFixture(
            persistence,
            makePostgresRelationalSession(persistence),
          );
          const seeded = decodeRows(
            await runEffect(
              tested.host.run(tested.host.newRequestKey(), tested.insert, {
                titles: ["first", "second"],
              }),
            ),
          );
          const first = seeded[0];
          const second = seeded[1];
          if (first === undefined || second === undefined)
            throw new Error("Missing seeded records");
          const entered = await runEffect(Deferred.make<void>());
          const release = await runEffect(Deferred.make<void>());
          let executions = 0;
          const patch = defineCmsCommand({
            name: "concurrentPatch",
            mode: "write",
            run: Effect.fn(function* (ctx, args) {
              executions++;
              const input = yield* decodePatch(args).pipe(
                Effect.mapError((cause) => cmsError("invalidInput", cause)),
              );
              return yield* ctx.documents.patch(
                ctx.context,
                ctx.transactionId,
                input.id,
                { title: input.title },
              );
            }),
          });
          const held = defineCmsCommand({
            name: "heldDecision",
            mode: "write",
            run: Effect.fn(function* (ctx) {
              executions++;
              if (mode === "read-decision") {
                expect(
                  yield* ctx.documents.get(
                    ctx.context,
                    ctx.transactionId,
                    first._id,
                  ),
                ).toMatchObject({ title: "first" });
              } else if (mode === "scan" || mode === "scan-first" || keyLookup) {
                expect(
                  (yield* ctx.documents.find(
                    ctx.context,
                    ctx.transactionId,
                    "posts",
                    { where: keyLookup ? { title: absentKey ? "phantom" : "first" } : {}, limit: 8, offset: 0 },
                  )).total,
                ).toBe(keyLookup ? absentKey ? 0 : 1 : 2);
              } else if (mode === "unique") {
                yield* ctx.documents.insert(
                  ctx.context,
                  ctx.transactionId,
                  "posts",
                  { title: "shared-unique" },
                );
              } else {
                yield* ctx.documents.patch(
                  ctx.context,
                  ctx.transactionId,
                  first._id,
                  { title: "held-first" },
                );
              }
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
              if (mode === "key-absent-scan" || mode === "key-turnover-scan") {
                yield* ctx.documents.find(ctx.context, ctx.transactionId, "posts", { where: {}, limit: 8, offset: 0 });
              }
              if (keyLookup || mode === "scan-first") {
                const again = yield* ctx.documents.find(ctx.context, ctx.transactionId, "posts",
                  { where: { title: absentKey || mode === "scan-first" ? "phantom" : "first" }, limit: 8, offset: 0 });
                expect(again.total).toBe(absentKey || mode === "scan-first" ? 0 : 1);
                if (!absentKey && mode !== "scan-first") expect(again.docs).toMatchObject([{ _id: first._id, title: "first" }]);
              }
              if (mode === "read-decision") {
                expect(
                  yield* ctx.documents.get(
                    ctx.context,
                    ctx.transactionId,
                    first._id,
                  ),
                ).toMatchObject({ title: "first" });
                yield* ctx.documents.patch(
                  ctx.context,
                  ctx.transactionId,
                  second._id,
                  { title: "dependent-write" },
                );
              }
              if (mode === "fresh-read") {
                // First capture of this identity occurs after the independent commit.
                expect(
                  yield* ctx.documents.get(
                    ctx.context,
                    ctx.transactionId,
                    second._id,
                  ),
                ).toMatchObject({ title: "other-second" });
              }
              return "held-result";
            }),
          });
          const turnover = defineCmsCommand({ name: "turnoverKey", mode: "write", run: Effect.fn(function* (ctx) {
            executions++;
            yield* ctx.documents.patch(ctx.context, ctx.transactionId, first._id, { title: "moved-first" });
            yield* ctx.documents.patch(ctx.context, ctx.transactionId, second._id, { title: "first" });
            return null;
          }) });
          const host = await runEffect(
            makeCmsHost({
              ...tested.input,
              commands: [...tested.input.commands, patch, held, turnover],
            }),
          );
          const key = host.newRequestKey();
          const before = await tested.inventory();
          await runEffect(
            Effect.scoped(
              Effect.gen(function* () {
                const pending = yield* host
                  .run(key, held, null)
                  .pipe(Effect.result, Effect.forkScoped);
                yield* Deferred.await(entered).pipe(
                  Effect.timeout("5 seconds"),
                );
                if (mode === "key-turnover-scan") {
                  yield* host.run(host.newRequestKey(), turnover, null);
                } else if (mode === "unique" || mode === "scan" || absentKey || mode === "scan-first") {
                  yield* host.run(host.newRequestKey(), tested.insert, {
                    titles: [mode === "unique" ? "shared-unique" : "phantom"],
                  });
                } else {
                  yield* host.run(host.newRequestKey(), patch, {
                    id:
                      mode === "same-row" || mode === "read-decision" || mode === "key-present"
                        ? first._id
                        : second._id,
                    title: "other-second",
                  });
                }
                // The competing publication completed before the first callback resumes.
                expect(yield* Deferred.isDone(release)).toBe(false);
                const afterOther = yield* Effect.promise(() =>
                  tested.inventory(),
                );
                expect(afterOther.commits.length).toBe(
                  before.commits.length + 1,
                );
                yield* Deferred.succeed(release, undefined);
                const result = yield* Fiber.join(pending);
                if (
                  mode === "same-row" ||
                  mode === "read-decision" ||
                  mode === "unique" ||
                  (keyLookup && mode !== "key-independent") || mode === "scan-first" ||
                  mode === "scan"
                ) {
                  expect(result).toMatchObject({
                    _tag: "Failure",
                    failure: { reason: "writeConflict" },
                  });
                  expect(
                    yield* Effect.promise(() => tested.inventory()),
                  ).toEqual(afterOther);
                } else {
                  expect(Result.getOrThrow(result)).toBe("held-result");
                  const after = yield* Effect.promise(() => tested.inventory());
                  expect(after.commits.length).toBe(before.commits.length + 2);
                  expect(after.clock[0]?.lastCommitSeq).toBe(
                    (before.clock[0]?.lastCommitSeq ?? -1n) + 2n,
                  );
                  expect(yield* host.run(key, held, null)).toBe("held-result");
                  expect(
                    yield* Effect.promise(() => tested.inventory()),
                  ).toEqual(after);
                  expect(executions).toBe(2);
                  expect(
                    yield* tested.host.read(
                      tested.read,
                      seeded.map((row) => row._id),
                    ),
                  ).toMatchObject([
                    { title: mode === "key-independent" ? "first" : "held-first" },
                    { title: "other-second" },
                  ]);
                }
              }).pipe(
                Effect.ensuring(Deferred.succeed(release, undefined)),
                Effect.timeout("20 seconds"),
              ),
            ),
          );
          expect(persistence.pool.waitingCount).toBe(0);
          expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
        }),
      120_000,
    );

    it(
      "rejects an absent-row decision when the uncommitted insert becomes visible",
      () =>
        withPersistence(async (persistence) => {
          const publicationEntered = await runEffect(Deferred.make<string>());
          const publish = await runEffect(Deferred.make<void>());
          const readEntered = await runEffect(Deferred.make<void>());
          const settle = await runEffect(Deferred.make<void>());
          const tested = await cmsExecutionMeasurementFixture(
            persistence,
            makePostgresRelationalSession(persistence),
            {
              afterDocumentClosure: (closed) => {
                const id = closed.changes[0]?.documentId;
                return id === undefined
                  ? Effect.fail(cmsError("storedCorruption"))
                  : Deferred.succeed(publicationEntered, id).pipe(
                      Effect.andThen(Deferred.await(publish)),
                    );
              },
            },
          );
          const observe = defineCmsCommand({
            name: "observeAbsent",
            mode: "write",
            run: Effect.fn(function* (ctx, args) {
              if (typeof args !== "string")
                return yield* Effect.fail(cmsError("invalidInput"));
              expect(
                yield* ctx.documents.get(ctx.context, ctx.transactionId, args),
              ).toBeNull();
              yield* Deferred.succeed(readEntered, undefined);
              yield* Deferred.await(settle);
              expect(
                (yield* ctx.documents.find(
                  ctx.context,
                  ctx.transactionId,
                  "posts",
                  {
                    where: {},
                    limit: 8,
                    offset: 0,
                  },
                )).docs,
              ).toEqual([]);
              expect(
                yield* ctx.documents.get(ctx.context, ctx.transactionId, args),
              ).toBeNull();
              return null;
            }),
          });
          const reader = await runEffect(
            makeCmsHost({ ...tested.input, commands: [observe] }),
          );
          await runEffect(
            Effect.scoped(
              Effect.gen(function* () {
                const writer = yield* tested.host
                  .run(tested.host.newRequestKey(), tested.insert, {
                    count: 1,
                    prefix: "appearing",
                  })
                  .pipe(Effect.forkScoped);
                const id = yield* Deferred.await(publicationEntered).pipe(
                  Effect.timeout("5 seconds"),
                );
                const decision = yield* reader
                  .run(reader.newRequestKey(), observe, id)
                  .pipe(Effect.result, Effect.forkScoped);
                yield* Deferred.await(readEntered).pipe(
                  Effect.timeout("5 seconds"),
                );
                yield* Deferred.succeed(publish, undefined);
                yield* Fiber.join(writer);
                const before = yield* Effect.promise(() => tested.inventory());
                yield* Deferred.succeed(settle, undefined);
                expect(yield* Fiber.join(decision)).toMatchObject({
                  _tag: "Failure",
                  failure: { reason: "writeConflict" },
                });
                expect(yield* Effect.promise(() => tested.inventory())).toEqual(
                  before,
                );
              }).pipe(
                Effect.ensuring(Deferred.succeed(publish, undefined)),
                Effect.ensuring(Deferred.succeed(settle, undefined)),
                Effect.timeout("20 seconds"),
              ),
            ),
          );
          expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
        }),
      120_000,
    );

    it(
      "keeps lifecycle changes excluded during command execution and releases protection on cancellation",
      () =>
        withPersistence(async (persistence) => {
          const tested = await cmsExecutionMeasurementFixture(
            persistence,
            makePostgresRelationalSession(persistence),
          );
          const entered = await runEffect(Deferred.make<void>());
          const held = defineCmsCommand({
            name: "cancelledCommand",
            mode: "write",
            run: () =>
              Deferred.succeed(entered, undefined).pipe(
                Effect.andThen(Effect.never),
              ),
          });
          const host = await runEffect(
            makeCmsHost({ ...tested.input, commands: [held] }),
          );
          const before = await tested.inventory();
          await runEffect(
            Effect.scoped(
              Effect.gen(function* () {
                const pending = yield* host
                  .run(host.newRequestKey(), held, null)
                  .pipe(Effect.forkScoped);
                yield* Deferred.await(entered).pipe(
                  Effect.timeout("5 seconds"),
                );
                yield* Effect.promise(async () => {
                  await expect(
                    persistence.drizzle.transaction(async (tx) => {
                      await tx.execute(sql`set local lock_timeout = '100ms'`);
                      return runEffect(
                        advanceScopeAuthorizationRevocationEpochInTransactionEffect(
                          tx,
                          tested.fixture.authority.scopeId,
                        ),
                      );
                    }),
                  ).rejects.toMatchObject({
                    operation: "lockForUpdate",
                    cause: { cause: { code: "55P03" } },
                  });
                });
                yield* Fiber.interrupt(pending);
              }),
            ),
          );
          expect(await tested.inventory()).toEqual(before);
          await persistence.drizzle.transaction((tx) =>
            runEffect(
              advanceScopeAuthorizationRevocationEpochInTransactionEffect(
                tx,
                tested.fixture.authority.scopeId,
              ),
            ),
          );
          expect(
            await runEffectFailure(host.run(host.newRequestKey(), held, null)),
          ).toMatchObject({ reason: "bindingChanged" });
          expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
        }),
      120_000,
    );
    it(
      "settles two admitted commands ahead of a queued lifecycle transition",
      () =>
        withPersistence(async (persistence) => {
          const session = makePostgresRelationalSession(persistence);
          const tested = await cmsExecutionMeasurementFixture(
            persistence,
            session,
          );
          const entered = await runEffect(Deferred.make<void>());
          const release = await runEffect(Deferred.make<void>());
          let callbacks = 0;
          const command = defineCmsCommand({
            name: "upgradeTogether",
            mode: "write",
            run: Effect.fn(function* () {
              if (++callbacks === 2)
                yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
              return null;
            }),
          });
          const host = await runEffect(
            makeCmsHost({ ...tested.input, commands: [command] }),
          );
          const before = await tested.inventory();
          let lifecyclePid = 0;
          await runEffect(
            Effect.scoped(
              Effect.gen(function* () {
                const first = yield* host
                  .run(host.newRequestKey(), command, null)
                  .pipe(Effect.forkScoped);
                const second = yield* host
                  .run(host.newRequestKey(), command, null)
                  .pipe(Effect.forkScoped);
                yield* Deferred.await(entered).pipe(
                  Effect.timeout("5 seconds"),
                );
                const transition = yield* runRelationalSession(
                  session,
                  "command",
                  (tx) =>
                    Effect.gen(function* () {
                      const rows = yield* runDrizzleStatementEffect(
                        tx
                          .select({ pid: sql<number>`pg_backend_pid()` })
                          .from(fxSystemScopeClocks)
                          .limit(1),
                        (cause) => cmsError("statementFailure", cause),
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
                yield* Deferred.succeed(release, undefined);
                expect(yield* Fiber.join(first)).toBeNull();
                expect(yield* Fiber.join(second)).toBeNull();
                expect(yield* Fiber.join(transition)).toEqual({
                  previous: 0n,
                  current: 1n,
                });
              }).pipe(
                Effect.ensuring(Deferred.succeed(release, undefined)),
                Effect.timeout("15 seconds"),
              ),
            ),
          );
          const after = await tested.inventory();
          expect(after.commits.length).toBe(before.commits.length + 2);
          expect(after.outcomes.length).toBe(before.outcomes.length + 2);
          expect(after.clock[0]?.lastCommitSeq).toBe(
            (before.clock[0]?.lastCommitSeq ?? -1n) + 2n,
          );
          expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
        }),
      120_000,
    );
  },
);
