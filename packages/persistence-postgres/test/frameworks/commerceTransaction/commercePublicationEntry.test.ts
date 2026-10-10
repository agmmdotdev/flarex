import { afterAll, expect, it } from "vitest";
import { Clock, Deferred, Effect, Fiber, Schema } from "effect";
import { sql } from "drizzle-orm";
import {
  prepareApplicationBindingSelection,
} from "../../../src/application/activation/repositoryIdentity";
import { makeBoundedRequestLifetime } from "../../../src/execution/preparation/boundedRequestLifetime";
import {
  withCommerceAdmission,
  withCommerceInstallationAdmissions,
  enterCommercePublication,
  requireCommercePublication,
  type CommerceAdmission,
} from "../../../src/frameworks/commerceTransaction/admission";
import { defineCommerceCommand } from "../../../src/frameworks/commerceTransaction/commands";
import {
  commerceError,
  commerceLimits,
} from "../../../src/frameworks/commerceTransaction/model";
import { makeCommerceStore } from "../../../src/frameworks/commerceTransaction/store";
import { consumeCommerceContribution } from "../../../src/frameworks/commerceTransaction/publication";
import {
  lockScopeClockForSnapshotReadInTransactionEffect,
  lockScopeClockForOrdinaryWriteInTransactionEffect,
} from "../../../src/scope/scopeClock";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import { fxSystemScopeClocks } from "../../../src/database/schema";
import { resolveLocatedTrustedScopeAuthorityEffect } from "../../../src/scope/scopeAuthorityResolution";
import {
  makePostgresRelationalSession,
  runRelationalSession,
} from "../../../src/database/relationalTransaction/session";
import { commerceHostFixture } from "./commerceHostFixture";
import { commerceInventory } from "./commerceInventory";
import { prepareNeutralCommerceProfile } from "./neutralCommerceProfile";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../support/postgresHelpers";
import { runEffect } from "../../support/effectTestRuntime";

const cleanup: Array<() => Promise<void>> = [];
const decodeWaiting = Schema.decodeUnknownEffect(
  Schema.Array(Schema.Struct({ waiting: Schema.Boolean })),
);
afterAll(async () => {
  for (const close of cleanup.reverse()) await close();
});

it("refuses commerce writes before publication entry and revokes that entry with admission", async () => {
  const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
  if (driver !== "pglite" && driver !== "postgres")
    throw new Error("Invalid driver");
  const registerCleanup = (close: () => Promise<void>) => {
    cleanup.push(close);
  };
  const resource =
    driver === "pglite"
      ? await createRelationalPGliteFixture({ registerCleanup })
      : await (async () => {
          const fixture = await createFileScopedPostgresFixture();
          registerCleanup(fixture.dispose);
          return {
            persistence: fixture.persistence,
            session: makePostgresRelationalSession(fixture.persistence),
          };
        })();
  const control =
    driver === "pglite"
      ? await createMigratedPGlitePersistence(registerCleanup)
      : resource.persistence;
  const command = defineCommerceCommand("unused", "read", () =>
    Effect.succeed(null),
  );
  const tested = await commerceHostFixture(
    resource.persistence,
    resource.session,
    prepareNeutralCommerceProfile(["items"], "publication-entry"),
    [command],
    control,
    () => ({
      capture: () => Effect.fail(commerceError("unadmittedEvent")),
      validate: () => Effect.void,
      deliver: () => Effect.void,
    }),
  );
  const before = await commerceInventory(tested);
  const selection = await runEffect(
    prepareApplicationBindingSelection(tested.hostInput.application),
  );
  const located = await runEffect(
    resolveLocatedTrustedScopeAuthorityEffect(
      tested.hostInput.deploymentId,
      tested.hostInput.authority,
    ),
  );
  let retained: CommerceAdmission | undefined;
  for (const enter of [false, true]) {
    await runEffect(
      runRelationalSession(resource.session, "command", (tx) =>
        Effect.gen(function* () {
          const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(
            tx,
            located.authority.scopeId,
          );
          return yield* withCommerceAdmission(
            tested.prepared.profile,
            tested.hostInput.target,
            tested.installation,
            selection,
            tx,
            located.authority,
            clock,
            false,
            undefined,
            (admission) =>
              Effect.gen(function* () {
                retained = admission;
                expect(
                  yield* requireCommercePublication(admission).pipe(
                    Effect.flip,
                  ),
                ).toMatchObject({ reason: "invalidAuthority" });
                if (enter) {
                  const published = yield* enterCommercePublication([
                    admission,
                  ]);
                  expect(yield* requireCommercePublication(admission)).toBe(
                    published,
                  );
                  expect(
                    yield* enterCommercePublication([admission]).pipe(
                      Effect.flip,
                    ),
                  ).toMatchObject({ reason: "invalidAuthority" });
                } else {
                  const id = crypto.randomUUID();
                  const lifetime = yield* makeBoundedRequestLifetime(
                    commerceError,
                    commerceLimits,
                    Object.freeze({}),
                    Object.freeze({}),
                    id,
                    "write",
                  );
                  yield* Effect.gen(function* () {
                    const working = yield* makeCommerceStore(
                      admission,
                      lifetime,
                      id,
                    );
                    expect(
                      yield* working.store
                        .write(lifetime.context, "insert", [
                          { id: "must-not-exist", value: 1 },
                        ])
                        .pipe(Effect.flip),
                    ).toMatchObject({ reason: "invalidAuthority" });
                  }).pipe(Effect.ensuring(lifetime.close));
                  const emptyId = crypto.randomUUID();
                  const emptyLifetime = yield* makeBoundedRequestLifetime(
                    commerceError,
                    commerceLimits,
                    Object.freeze({}),
                    Object.freeze({}),
                    emptyId,
                    "write",
                  );
                  yield* Effect.gen(function* () {
                    const working = yield* makeCommerceStore(
                      admission,
                      emptyLifetime,
                      emptyId,
                    );
                    yield* emptyLifetime.seal;
                    const closure = yield* working.close();
                    expect(
                      yield* consumeCommerceContribution(
                        admission,
                        emptyLifetime,
                        closure,
                      ).pipe(Effect.flip),
                    ).toMatchObject({ reason: "invalidAuthority" });
                  }).pipe(Effect.ensuring(emptyLifetime.close));
                }
              }),
          );
        }),
      ),
    );
    if (retained === undefined) throw new Error("Missing tested admission");
    expect(
      await runEffect(requireCommercePublication(retained).pipe(Effect.flip)),
    ).toMatchObject({ reason: "invalidAuthority" });
    expect(await commerceInventory(tested)).toEqual(before);
  }
  if ("pool" in resource.persistence) {
    const postgres = resource.persistence;
    const held = await runEffect(Deferred.make<void>());
    const release = await runEffect(Deferred.make<void>());
    await runEffect(
      Effect.scoped(
        Effect.gen(function* () {
          const blocker = yield* runRelationalSession(
            resource.session,
            "command",
            (tx) =>
              Effect.gen(function* () {
                yield* lockScopeClockForOrdinaryWriteInTransactionEffect(
                  tx,
                  located.authority.scopeId,
                );
                yield* Deferred.succeed(held, undefined);
                yield* Deferred.await(release);
              }),
          ).pipe(Effect.forkScoped);
          yield* Deferred.await(held).pipe(Effect.timeout("5 seconds"));
          yield* runRelationalSession(resource.session, "command", (tx) =>
            Effect.scoped(
              Effect.gen(function* () {
                const rows = yield* runDrizzleStatementEffect(
                  tx
                    .select({ pid: sql<number>`pg_backend_pid()` })
                    .from(fxSystemScopeClocks)
                    .limit(1),
                  (cause) =>
                    new Error("Could not inspect publication backend", {
                      cause,
                    }),
                );
                const pid = rows[0]?.pid;
                if (pid === undefined)
                  throw new Error("Missing publication backend");
                const clock =
                  yield* lockScopeClockForSnapshotReadInTransactionEffect(
                    tx,
                    located.authority.scopeId,
                  );
                yield* withCommerceInstallationAdmissions(
                  [tested.prepared.profile],
                  tested.hostInput.target,
                  tested.installation,
                  selection,
                  tx,
                  located.authority,
                  clock,
                  false,
                  undefined,
                  (tokens) =>
                    Effect.gen(function* () {
                      expect(Object.isFrozen(tokens)).toBe(true);
                      const first = tokens[0];
                      if (first === undefined)
                        throw new Error("Missing first admission");
                      yield* withCommerceAdmission(
                        tested.prepared.profile,
                        tested.hostInput.target,
                        tested.installation,
                        selection,
                        tx,
                        located.authority,
                        clock,
                        false,
                        undefined,
                        (second) =>
                          Effect.gen(function* () {
                            const members = [first];
                            const entering = yield* enterCommercePublication(
                              members,
                            ).pipe(Effect.forkScoped);
                            const deadline =
                              (yield* Clock.monotonicTimeNanos) +
                              2_000_000_000n;
                            let waiting = false;
                            while (
                              !waiting &&
                              (yield* Clock.monotonicTimeNanos) < deadline
                            ) {
                              const observed = yield* Effect.tryPromise({
                                try: () =>
                                  postgres.query(
                                    "select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock') as waiting",
                                    [pid],
                                  ),
                                catch: (cause) =>
                                  new Error(
                                    "Could not inspect publication waiter",
                                    { cause },
                                  ),
                              });
                              waiting =
                                (yield* decodeWaiting(observed.rows))[0]
                                  ?.waiting === true;
                              if (!waiting) yield* Effect.sleep("10 millis");
                            }
                            expect(waiting).toBe(true);
                            members[0] = second;
                            expect(
                              yield* enterCommercePublication([first]).pipe(
                                Effect.flip,
                                Effect.timeout("500 millis"),
                              ),
                            ).toMatchObject({ reason: "invalidAuthority" });
                            expect(
                              yield* requireCommercePublication(first).pipe(
                                Effect.flip,
                              ),
                            ).toMatchObject({ reason: "invalidAuthority" });
                            yield* Deferred.succeed(release, undefined);
                            const publicationClock =
                              yield* Fiber.join(entering);
                            expect(
                              yield* requireCommercePublication(first),
                            ).toBe(publicationClock);
                            expect(
                              yield* requireCommercePublication(second).pipe(
                                Effect.flip,
                              ),
                            ).toMatchObject({ reason: "invalidAuthority" });
                          }),
                      );
                    }),
                );
              }).pipe(Effect.ensuring(Deferred.succeed(release, undefined))),
            ),
          );
          yield* Fiber.join(blocker);
        }).pipe(
          Effect.ensuring(Deferred.succeed(release, undefined)),
          Effect.timeout("15 seconds"),
        ),
      ),
    );
    expect(await commerceInventory(tested)).toEqual(before);
    expect(postgres.pool.idleCount).toBe(postgres.pool.totalCount);
  }
}, 120_000);
