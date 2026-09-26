import { sql } from "drizzle-orm";
import { Deferred, Effect, Fiber } from "effect";
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
        return [
          ...(yield* ctx.store.write(ctx.manager, "insert", [
            { id, value: 1 },
          ])),
        ];
      }),
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
