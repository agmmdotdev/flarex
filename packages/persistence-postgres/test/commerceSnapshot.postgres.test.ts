import { sql } from "drizzle-orm";
import { Deferred, Effect, Fiber, Tracer } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  defineCommerceCommand,
  type CommerceCommand,
} from "../src/commerceTransaction/commands";
import {
  makeLocalCommerceHost,
  type LocalCommerceEventPolicy,
} from "../src/commerceTransaction/host";
import { commerceError } from "../src/commerceTransaction/model";
import {
  defineAtomicCommerceCommand,
  defineAtomicCommerceParticipant,
} from "../src/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../src/atomicCommerce/host";
import {
  issueRelationalSession,
  makePostgresRelationalSession,
  runRelationalSession,
} from "../src/relationalTransaction/session";
import { RelationalSessionError } from "../src/relationalTransaction/model";
import { runDrizzleStatementEffect } from "../src/drizzleStatementEffect";
import { advanceScopeAuthorizationRevocationEpochInTransactionEffect } from "../src/scopeClock";
import { dataBindingActivationRequest } from "../src/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../src/frameworkSchema/binding/selection";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  commerceHostFixture,
  type CommerceHostTestFixture,
} from "./commerceHostFixture";
import { commerceInventory } from "./commerceInventory";
import { prepareNeutralCommerceProfile } from "./neutralCommerceProfile";
import {
  createFileScopedPostgresFixture,
  postgresUrl,
} from "./postgresHelpers";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

describe.skipIf(postgresUrl === null)(
  "commerce snapshots and existing publication owners",
  () => {
    const cleanup: Array<() => Promise<void>> = [];
    let persistence: PostgresFlarexPersistence;
    let fixture: CommerceHostTestFixture;
    let executions = 0;
    let reads = 0;
    const events: LocalCommerceEventPolicy = {
      capture: () => Effect.fail(commerceError("unadmittedEvent")),
      validate: (events) =>
        events.length === 0
          ? Effect.void
          : Effect.fail(commerceError("unadmittedEvent")),
      deliver: () => Effect.void,
    };
    const insert = defineCommerceCommand(
      "snapshotCommerceInsert",
      "write",
      Effect.fn(function* (ctx, id) {
        if (typeof id !== "string")
          return yield* ctx.refuse(commerceError("invalidInput"));
        executions++;
        return [
          ...(yield* ctx.store.write(ctx.manager, "insert", [
            { id, value: 1 },
          ])),
        ];
      }),
    );
    const participant = defineAtomicCommerceParticipant("items");
    const atomic = defineAtomicCommerceCommand(
      "snapshotAtomicInsert",
      (ctx, id) => ctx.call(participant, insert, id),
    );
    async function local(
      commands: readonly CommerceCommand[],
      session = fixture.session,
    ) {
      return (
        await runEffect(
          makeLocalCommerceHost(
            { ...fixture.hostInput, commands, session },
            events,
          ),
        )
      ).host;
    }
    async function writer(
      kind: "standalone" | "atomic",
      session = fixture.session,
    ) {
      if (kind === "standalone") {
        const host = await local([insert], session);
        return {
          key: host.newRequestKey(),
          run: (key: string, id: string) => host.run(key, insert, id),
        };
      }
      const host = await runEffect(
        makeAtomicCommerceHost({
          ...fixture.hostInput,
          session,
          commands: [atomic],
          participants: [
            {
              participant,
              profile: fixture.prepared.profile,
              installation: fixture.installation,
              commands: [insert],
              validate: events.validate,
            },
          ],
        }),
      );
      return {
        key: host.newRequestKey(),
        run: (key: string, id: string) => host.run(key, atomic, id),
      };
    }
    const readCommand = (between: Effect.Effect<void>) =>
      defineCommerceCommand(
        "snapshotRead",
        "read",
        Effect.fn(function* (ctx, id) {
          if (typeof id !== "string")
            return yield* ctx.refuse(commerceError("invalidInput"));
          reads++;
          const first = yield* ctx.store.find(ctx.manager, {
            predicate: { kind: "in", column: "id", values: ["baseline"] },
            order: { column: "id", direction: "asc" },
            fields: ["id", "value"],
          });
          yield* between;
          // This row was not queried before publication; a request cache cannot supply the snapshot.
          const second = yield* ctx.store.find(ctx.manager, {
            predicate: { kind: "in", column: "id", values: [id] },
            order: { column: "id", direction: "asc" },
            fields: ["id", "value"],
          });
          return { first: [...first], second: [...second] };
        }),
      );
    beforeAll(async () => {
      const resource = await createFileScopedPostgresFixture();
      cleanup.push(resource.dispose);
      persistence = resource.persistence;
      fixture = await commerceHostFixture(
        persistence,
        makePostgresRelationalSession(persistence),
        prepareNeutralCommerceProfile(["items"], "commerce-snapshot"),
        [insert],
        persistence,
        () => events,
      );
      await runEffect(
        fixture.host.run(fixture.host.newRequestKey(), insert, "baseline"),
      );
      expect(
        (
          await persistence.query<{ superuser: boolean }>(
            "select rolsuper as superuser from pg_roles where rolname=current_user",
          )
        ).rows[0]?.superuser,
      ).toBe(false);
    }, 120_000);
    afterAll(async () => {
      for (const close of cleanup.reverse()) await close();
    }, 120_000);

    for (const kind of ["standalone", "atomic"] as const) {
      it.each([false, true])(`${kind} admits metadata during protected execution (duplicate=%s)`, async duplicate => {
        const held = await runEffect(Deferred.make<void>());
        const admitted = await runEffect(Deferred.make<void>());
        const release = await runEffect(Deferred.make<void>());
        const firstId = `${kind}-admission-${duplicate}-first`;
        const secondId = duplicate ? firstId : `${kind}-admission-second`;
        let callbacks = 0;
        const command = defineCommerceCommand("admissionOverlap", "write", Effect.fn(function* (ctx, id) {
          if (typeof id !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
          callbacks++;
          const rows = yield* ctx.store.write(ctx.manager, "insert", [{ id, value: 2 }]);
          if (id === firstId) {
            yield* Deferred.succeed(held, undefined);
            yield* Deferred.await(release);
          }
          return [...rows];
        }));
        const localHost = await local([command]);
        const atomicCommand = defineAtomicCommerceCommand("admissionOverlap", (ctx, id) => ctx.call(participant, command, id));
        const atomicHost = kind === "atomic" ? await runEffect(makeAtomicCommerceHost({
          ...fixture.hostInput, commands: [atomicCommand],
          participants: [{ participant, profile: fixture.prepared.profile, installation: fixture.installation,
            commands: [command], validate: events.validate }],
        })) : undefined;
        const firstKey = atomicHost?.newRequestKey() ?? localHost.newRequestKey();
        const run = (key: string, id: string) => atomicHost === undefined
          ? localHost.run(key, command, id) : atomicHost.run(key, atomicCommand, id);
        const spans: string[] = [];
        const tracer = Tracer.make({ span(options) {
          spans.push(options.name);
          if (options.name === "CommerceAdmission.enterPublication") Effect.runSync(Deferred.succeed(admitted, undefined));
          return new Tracer.NativeSpan(options);
        } });
        const before = await commerceInventory(fixture);
        await runEffect(Effect.scoped(Effect.gen(function* () {
          const first = yield* run(firstKey, firstId).pipe(Effect.forkScoped);
          yield* Deferred.await(held).pipe(Effect.timeout("5 seconds"));
          const second = yield* run(duplicate ? firstKey : `${firstKey}/second`, secondId)
            .pipe(Effect.provideService(Tracer.Tracer, tracer), Effect.forkScoped);
          yield* Deferred.await(admitted).pipe(Effect.timeout("5 seconds"));
          expect(spans).toContain("InstallationRuntime.accept");
          expect(spans).toContain("CommerceBinding.verify");
          expect(callbacks).toBe(1);
          expect(yield* Deferred.isDone(release)).toBe(false);
          yield* Deferred.succeed(release, undefined);
          const firstResult = yield* Fiber.join(first);
          const secondResult = yield* Fiber.join(second);
          if (duplicate) expect(secondResult).toEqual(firstResult);
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("20 seconds"))));
        const after = await commerceInventory(fixture);
        const publications = duplicate ? 1 : 2;
        expect(callbacks).toBe(publications);
        expect(after.rows.length).toBe(before.rows.length + publications);
        expect(after.commits.length).toBe(before.commits.length + publications);
        expect(after.outcomes.length).toBe(before.outcomes.length + publications);
        expect(after.facts.length).toBe(before.facts.length + publications);
        expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
      }, 120_000);
    }

    for (const kind of ["standalone", "atomic"] as const) {
      it(`${kind} publication completes while a commerce snapshot is held`, async () => {
        const entered = await runEffect(Deferred.make<void>());
        const release = await runEffect(Deferred.make<void>());
        const read = readCommand(
          Deferred.succeed(entered, undefined).pipe(
            Effect.andThen(Deferred.await(release)),
          ),
        );
        const host = await local([read]);
        const write = await writer(kind);
        const id = `${kind}-reader-first`;
        const before = await commerceInventory(fixture);
        const count = executions;
        await runEffect(
          Effect.scoped(
            Effect.gen(function* () {
              const reading = yield* host
                .read(read, id)
                .pipe(Effect.forkScoped);
              yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"));
              yield* Effect.promise(async () => {
                await expect(
                  persistence.drizzle.transaction(async (tx) => {
                    await tx.execute(sql`set local lock_timeout = '100ms'`);
                    return runEffect(
                      advanceScopeAuthorizationRevocationEpochInTransactionEffect(
                        tx,
                        fixture.cms.fixture.authority.scopeId,
                      ),
                    );
                  }),
                ).rejects.toMatchObject({
                  operation: "lockForUpdate",
                  cause: { cause: { code: "55P03" } },
                });
              });
              expect(yield* write.run(write.key, id)).toEqual([
                { id, value: 1 },
              ]);
              expect(yield* Deferred.isDone(release)).toBe(false);
              expect(yield* write.run(write.key, id)).toEqual([
                { id, value: 1 },
              ]);
              yield* Deferred.succeed(release, undefined);
              expect(yield* Fiber.join(reading)).toEqual({
                first: [{ id: "baseline", value: 1 }],
                second: [],
              });
            }).pipe(
              Effect.ensuring(Deferred.succeed(release, undefined)),
              Effect.timeout("20 seconds"),
            ),
          ),
        );
        expect(executions).toBe(count + 1);
        const after = await commerceInventory(fixture);
        expect(after.commits.length).toBe(before.commits.length + 1);
        expect(after.facts.length).toBe(before.facts.length + 1);
        expect(after.outcomes.length).toBe(before.outcomes.length + 1);
        expect(after.wakes.length).toBe(before.wakes.length + 1);
        expect(after.clocks[0]?.lastCommitSeq).toBe(
          (before.clocks[0]?.lastCommitSeq ?? 0n) + 1n,
        );
        expect(await runEffect(host.read(read, id))).toEqual({
          first: [{ id: "baseline", value: 1 }],
          second: [{ id, value: 1 }],
        });
        expect(await commerceInventory(fixture)).toEqual(after);
        expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
      }, 60_000);

      it(`commerce snapshot completes while ${kind} publication awaits physical COMMIT`, async () => {
        const entered = await runEffect(Deferred.make<void>());
        const release = await runEffect(Deferred.make<void>());
        const held = issueRelationalSession(
          persistence.drizzle,
          (profile, work) =>
            runRelationalSession(fixture.session, profile, (tx) =>
              work(tx).pipe(
                Effect.tap(() =>
                  Deferred.succeed(entered, undefined).pipe(
                    Effect.andThen(Deferred.await(release)),
                  ),
                ),
              ),
            ).pipe(
              Effect.catchTag("RelationalTransactionError", (cause) =>
                Effect.fail(
                  new RelationalSessionError({
                    reason: "resourceFailure",
                    cause,
                  }),
                ),
              ),
            ),
        );
        const write = await writer(kind, held);
        const competing = await writer(kind);
        const read = readCommand(Effect.void);
        const host = await local([read]);
        const id = `${kind}-publisher-first`;
        const before = await commerceInventory(fixture);
        const count = executions;
        await runEffect(
          Effect.scoped(
            Effect.gen(function* () {
              const writing = yield* write
                .run(write.key, id)
                .pipe(Effect.forkScoped);
              yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"));
              expect(yield* host.read(read, id)).toEqual({
                first: [{ id: "baseline", value: 1 }],
                second: [],
              });
              expect(
                yield* Effect.promise(() => commerceInventory(fixture)),
              ).toEqual(before);
              const refusal = yield* competing
                .run(competing.key, `${id}-competing`)
                .pipe(Effect.result);
              expect(refusal).toMatchObject({
                _tag: "Failure",
                failure: {
                  cause: {
                    operation: "lockForOrdinaryWrite",
                    cause: { cause: { code: "55P03" } },
                  },
                },
              });
              expect(executions).toBe(count + 1);
              yield* Deferred.succeed(release, undefined);
              expect(yield* Fiber.join(writing)).toEqual([{ id, value: 1 }]);
            }).pipe(
              Effect.ensuring(Deferred.succeed(release, undefined)),
              Effect.timeout("20 seconds"),
            ),
          ),
        );
        const after = await commerceInventory(fixture);
        expect(after.commits.length).toBe(before.commits.length + 1);
        expect(after.facts.length).toBe(before.facts.length + 1);
        expect(await runEffect(competing.run(write.key, id))).toEqual([
          { id, value: 1 },
        ]);
        expect(executions).toBe(count + 1);
        expect(await commerceInventory(fixture)).toEqual(after);
        expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
      }, 60_000);
    }

    it.each(["binding", "revocation"] as const)(
      "rejects a %s change after snapshot formation before admission",
      async (transition) => {
        const entered = await runEffect(Deferred.make<void>());
        const release = await runEffect(Deferred.make<void>());
        const session = issueRelationalSession(
          persistence.drizzle,
          (profile, work) =>
            runRelationalSession(fixture.session, profile, (tx) =>
              Effect.gen(function* () {
                if (profile === "snapshotRead") {
                  yield* runDrizzleStatementEffect(
                    tx.execute(sql`select 1`),
                    (cause) =>
                      new RelationalSessionError({
                        reason: "resourceFailure",
                        cause,
                      }),
                  );
                  yield* Deferred.succeed(entered, undefined);
                  yield* Deferred.await(release);
                }
                return yield* work(tx);
              }),
            ).pipe(
              Effect.catchTag("RelationalTransactionError", (cause) =>
                Effect.fail(
                  new RelationalSessionError({
                    reason: "resourceFailure",
                    cause,
                  }),
                ),
              ),
            ),
        );
        const read = readCommand(Effect.void);
        const host = await local([read], session);
        const count = reads;
        await runEffect(
          Effect.scoped(
            Effect.gen(function* () {
              const reading = yield* host
                .read(read, "baseline")
                .pipe(Effect.result, Effect.forkScoped);
              yield* Deferred.await(entered).pipe(Effect.timeout("10 seconds"));
              if (transition === "binding") {
                const current = yield* fixture.bindings.withCurrent(
                  readAdmittedDataBinding,
                );
                const candidate = yield* fixture.bindings.prepare({
                  ...fixture.candidate.frame,
                  commerce: [],
                });
                yield* fixture.bindings.activate(
                  dataBindingActivationRequest(
                    fixture.cms.reference.scopeId,
                    fixture.cms.reference.storageGeneration,
                    "snapshot-revoke",
                    candidate.sha256,
                    current.head,
                  ),
                );
              } else {
                yield* Effect.promise(() =>
                  persistence.drizzle.transaction((tx) =>
                    runEffect(
                      advanceScopeAuthorizationRevocationEpochInTransactionEffect(
                        tx,
                        fixture.cms.fixture.authority.scopeId,
                      ),
                    ),
                  ),
                );
              }
              yield* Deferred.succeed(release, undefined);
              const outcome = yield* Fiber.join(reading);
              expect(outcome).toMatchObject({
                _tag: "Failure",
                failure: {
                  reason: "invalidAuthority",
                  cause: { cause: { cause: { code: "40001" } } },
                },
              });
              expect(reads).toBe(count);
            }).pipe(
              Effect.ensuring(Deferred.succeed(release, undefined)),
              Effect.timeout("20 seconds"),
            ),
          ),
        );
        const fresh = await local([read]);
        expect(
          await runEffectFailure(fresh.read(read, "baseline")),
        ).toMatchObject({ reason: "bindingChanged" });
        expect(reads).toBe(count);
        if (transition === "binding") {
          const current = await runEffect(
            fixture.bindings.withCurrent(readAdmittedDataBinding),
          );
          const candidate = await runEffect(
            fixture.bindings.prepare(fixture.candidate.frame),
          );
          await runEffect(
            fixture.bindings.activate(
              dataBindingActivationRequest(
                fixture.cms.reference.scopeId,
                fixture.cms.reference.storageGeneration,
                "snapshot-restore",
                candidate.sha256,
                current.head,
              ),
            ),
          );
          expect(await runEffect(fresh.read(read, "baseline"))).toEqual({
            first: [{ id: "baseline", value: 1 }],
            second: [{ id: "baseline", value: 1 }],
          });
        }
        expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
      },
      60_000,
    );
  },
);
