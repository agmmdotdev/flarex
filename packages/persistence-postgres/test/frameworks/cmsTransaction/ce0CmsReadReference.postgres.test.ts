import { describe, expect, it } from "vitest";
import { Deferred, Effect, Fiber, Schema } from "effect";
import { sql } from "drizzle-orm";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "../../support/postgresHelpers";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { makeCmsHost } from "../../../src/frameworks/cmsTransaction/host";
import { defineCmsCommand } from "../../../src/frameworks/cmsTransaction/commands";
import { type CmsHostTestHooks } from "../../../src/frameworks/cmsTransaction/testSupport";
import { cmsError } from "../../../src/frameworks/cmsTransaction/model";
import { runDrizzleStatementEffect } from "../../../src/database/drizzleStatementEffect";
import {
  ce0CmsReadReferenceScenario,
  decodeReadDocuments,
} from "./ce0CmsReadReferenceScenario";
import { makeCe0CmsReadReference } from "./ce0CmsReadReference";
import type { FlarexMetadataTransaction } from "../../../src/database/metadataTransaction";
import { runEffect, runEffectFailure } from "../../support/effectTestRuntime";

const decodeIsolation = Schema.decodeUnknownEffect(
  Schema.Struct({
    rows: Schema.Array(
      Schema.Struct({ isolation: Schema.String, pid: Schema.Int }),
    ),
  }),
);
const observeConnection = Effect.fn("Ce0ReadTest.connection")(function* (
  tx: FlarexMetadataTransaction,
) {
  const result = yield* runDrizzleStatementEffect(
    tx.execute(
      sql`select current_setting('transaction_isolation') as isolation, pg_backend_pid()::int as pid`,
    ),
    (cause) => cmsError("statementFailure", cause),
  );
  const decoded = yield* decodeIsolation(result).pipe(
    Effect.mapError((cause) => cmsError("storedCorruption", cause)),
  );
  const row = decoded.rows[0];
  if (row === undefined || decoded.rows.length !== 1)
    return yield* Effect.fail(cmsError("storedCorruption"));
  return row;
});
const decodeIds = Schema.decodeUnknownEffect(Schema.Array(Schema.String));

describe.skipIf(postgresUrl === null)(
  "standalone read request reference (Postgres)",
  () => {
    const withPersistence = useFileScopedPostgresPersistence();
    it(
      "retains scoped read semantics and a snapshot across real publication",
      () =>
        withPersistence(async (persistence) => {
          expect(
            (
              await persistence.query<{ superuser: boolean }>(
                "select rolsuper as superuser from pg_roles where rolname=current_user",
              )
            ).rows[0]?.superuser,
          ).toBe(false);
          const tested = await ce0CmsReadReferenceScenario(
            persistence,
            makePostgresRelationalSession(persistence),
          );
          // An unkeyed read cannot recover by replaying a durable outcome, and
          // cannot automatically execute again after ambiguous physical COMMIT.
          for (const implementation of ["core", "reference"] as const) {
            let committed = false;
            let begins = 0;
            const session = makePostgresRelationalSession(persistence, {
              lifecycleFault: (event) => {
                if (event.phase === "begin" && event.edge === "after") begins++;
                if (event.phase === "commit" && event.edge === "after") {
                  committed = true;
                  throw new Error("Lost read COMMIT acknowledgement");
                }
              },
            });
            const core = await runEffect(
              makeCmsHost({ ...tested.input, session }),
            );
            const reference = await runEffect(
              makeCe0CmsReadReference({ ...tested.input, session }),
            );
            const before = await tested.inventory();
            const callbacks = tested.readExecutionCount();
            expect(
              await runEffectFailure(
                implementation === "core"
                  ? core.read(tested.read, [])
                  : reference.read([]),
              ),
            ).toMatchObject({ reason: "decisionUncertain" });
            expect(committed).toBe(true);
            expect(begins).toBe(1);
            expect(
              tested.readExecutionCount() -
                callbacks +
                reference.executionCount(),
            ).toBe(1);
            expect(await tested.inventory()).toEqual(before);
          }
          for (const implementation of ["core", "reference"] as const) {
            const prefix = `snapshot-${implementation}`;
            const before = await tested.inventory();
            const seeded = await runEffect(
              tested.host.run(tested.host.newRequestKey(), tested.insert, {
                count: 8,
                prefix,
              }),
            );
            const stable = await tested.verifyInsert(before, seeded, 8, prefix);
            const documents = decodeReadDocuments(seeded).slice(0, 2);
            const ids = documents.map((document) => document._id);
            const entered = await runEffect(Deferred.make<void>());
            const release = await runEffect(Deferred.make<void>());
            let captures = 0;
            let isolation: string | undefined;
            let readerPid: number | undefined;
            let writerPid: number | undefined;
            const hooks: Pick<
              CmsHostTestHooks,
              "afterAdmission" | "documentReads"
            > = {
              afterAdmission: (tx) =>
                observeConnection(tx).pipe(
                  Effect.map((row) => {
                    isolation = row.isolation;
                    readerPid = row.pid;
                  }),
                ),
              documentReads: {
                beforeRead: () =>
                  Effect.suspend(() => {
                    captures++;
                    return captures === 2
                      ? Deferred.succeed(entered, undefined).pipe(
                          Effect.andThen(Deferred.await(release)),
                        )
                      : Effect.void;
                  }),
              },
            };
            const core = await runEffect(makeCmsHost(tested.input, hooks));
            const reference = await runEffect(
              makeCe0CmsReadReference(tested.input, hooks),
            );
            const patch = defineCmsCommand({
              name: "patchReadSeed",
              mode: "write",
              run: (ctx, args) =>
                Effect.gen(function* () {
                  const ids = yield* decodeIds(args).pipe(
                    Effect.mapError((cause) => cmsError("invalidInput", cause)),
                  );
                  for (const [index, id] of ids.entries())
                    yield* ctx.documents.patch(
                      ctx.context,
                      ctx.transactionId,
                      id,
                      { title: `${prefix}-changed-${index}` },
                    );
                  return null;
                }),
            });
            const writer = await runEffect(
              makeCmsHost(
                {
                  ...tested.input,
                  commands: [...tested.input.commands, patch],
                },
                {
                  afterAdmission: (tx) =>
                    observeConnection(tx).pipe(
                      Effect.map((row) => {
                        writerPid = row.pid;
                        expect(row.isolation).toBe("read committed");
                      }),
                    ),
                },
              ),
            );
            await runEffect(
              Effect.scoped(
                Effect.gen(function* () {
                  const reader = yield* (
                    implementation === "core"
                      ? core.read(tested.read, ids)
                      : reference.read(ids)
                  ).pipe(Effect.forkScoped);
                  yield* Deferred.await(entered);
                  expect(isolation).toBe("repeatable read");
                  expect(captures).toBe(2);
                  expect(
                    yield* writer.run(writer.newRequestKey(), patch, ids),
                  ).toBe(null);
                  expect(readerPid).toBeGreaterThan(0);
                  expect(writerPid).toBeGreaterThan(0);
                  expect(writerPid).not.toBe(readerPid);
                  expect(yield* Deferred.isDone(release)).toBe(false);
                  yield* Deferred.succeed(release, undefined);
                  expect(yield* Fiber.join(reader)).toEqual(documents);
                }).pipe(
                  Effect.ensuring(Deferred.succeed(release, undefined)),
                  Effect.timeout("20 seconds"),
                ),
              ),
            );
            const after = await tested.inventory();
            expect(after.commits.length - stable.commits.length).toBe(1);
            expect(after.outcomes.length - stable.outcomes.length).toBe(1);
            expect(after.wakes.length - stable.wakes.length).toBe(1);
            expect(after.clock[0]?.lastCommitSeq).toBe(
              (stable.clock[0]?.lastCommitSeq ?? 0n) + 1n,
            );
            const expected = documents.map((document, index) => ({
              ...document,
              title: `${prefix}-changed-${index}`,
            }));
            const fresh = await runEffect(
              makeCe0CmsReadReference(tested.input),
            );
            expect(await runEffect(fresh.read(ids))).toEqual(expected);
            expect(await runEffect(tested.host.read(tested.read, ids))).toEqual(
              expected,
            );
            expect(await tested.inventory()).toEqual(after);
            expect(persistence.pool.waitingCount).toBe(0);
            expect(persistence.pool.idleCount).toBe(
              persistence.pool.totalCount,
            );
          }
        }),
      180_000,
    );
  },
);
