import { describe, expect, it } from "vitest";
import { Cause, Effect, Exit } from "effect";
import { cmsExecutionMeasurementFixture } from "./cmsExecutionMeasurementFixture";
import { makeCe0CmsMutationReference } from "./ce0CmsMutationReference";
import { makeCmsHost } from "../src/cmsTransaction/host";
import { runEffect } from "./effectTestRuntime";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "./postgresHelpers";
import { ce0FirstInsertReferenceScenario } from "./ce0FirstInsertReferenceScenario";

describe.skipIf(postgresUrl === null)(
  "first-insert request reference (Postgres)",
  () => {
    const withPersistence = useFileScopedPostgresPersistence();
    it(
      "cross-replays exact nonempty state and rolls back every write family",
      () =>
        withPersistence(async (persistence) => {
          expect(
            (
              await persistence.query<{ superuser: boolean }>(
                "select rolsuper as superuser from pg_roles where rolname=current_user",
              )
            ).rows[0]?.superuser,
          ).toBe(false);
          await ce0FirstInsertReferenceScenario(
            persistence,
            makePostgresRelationalSession(persistence),
          );
          expect(persistence.pool.waitingCount).toBe(0);
          expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
        }),
      180_000,
    );
    it(
      "keeps driver rejection typed and refuses malformed returned identities",
      () =>
        withPersistence(async (persistence) => {
          const tested = await cmsExecutionMeasurementFixture(
            persistence,
            makePostgresRelationalSession(persistence),
          );
          for (const implementation of ["core", "reference"] as const) {
            for (const mode of ["failure", "row", "member", "claim"] as const) {
              const fault = new Error("Driver rejected without a SQLSTATE");
              let injected = 0;
              const restores: (() => void)[] = [];
              const session = makePostgresRelationalSession(persistence, {
                lifecycleFault: ({ phase, edge, client }) => {
                  if (phase !== "begin" || edge !== "after") return;
                  const original = client.query;
                  const table =
                    mode === "member"
                      ? "fx_app_index_entry_rev"
                      : mode === "claim"
                        ? "fx_app_unique_key"
                        : "fx_app_row_rev";
                  client.query = new Proxy(original, {
                    apply(target, receiver, args: unknown[]) {
                      const first = args[0];
                      const text =
                        typeof first === "string"
                          ? first
                          : first !== null &&
                              typeof first === "object" &&
                              "text" in first
                            ? first.text
                            : null;
                      if (
                        typeof text !== "string" ||
                        !text.startsWith(`insert into "${table}"`)
                      )
                        return Reflect.apply(target, receiver, args);
                      client.query = original;
                      injected++;
                      if (mode === "failure") return Promise.reject(fault);
                      // This fixture intercepts the real driver's array-mode result,
                      // before Drizzle maps the second column to its typed identity.
                      return Promise.resolve(
                        Reflect.apply(target, receiver, args),
                      ).then((result: unknown) => {
                        if (
                          result === null ||
                          typeof result !== "object" ||
                          !("rows" in result) ||
                          !Array.isArray(result.rows) ||
                          !Array.isArray(result.rows[0])
                        )
                          throw new Error(
                            "Expected array-mode PostgreSQL result",
                          );
                        result.rows[0][1] = "invalid-catalog-identity";
                        return result;
                      });
                    },
                  });
                  restores.push(() => {
                    client.query = original;
                  });
                },
              });
              const core = await runEffect(
                makeCmsHost({ ...tested.input, session }),
              );
              const reference = await runEffect(
                makeCe0CmsMutationReference({ ...tested.input, session }),
              );
              const before = await tested.inventory();
              const key = tested.host.newRequestKey();
              const args = {
                count: 1,
                prefix: `driver-${implementation}-${mode}`,
              };
              try {
                const exit = await Effect.runPromiseExit(
                  implementation === "core"
                    ? core.run(key, tested.insert, args)
                    : reference.run(key, args),
                );
                expect(injected).toBe(1);
                expect(Exit.isFailure(exit)).toBe(true);
                if (Exit.isFailure(exit)) {
                  expect(
                    exit.cause.reasons,
                    `${implementation}/${mode}: ${Cause.pretty(exit.cause)}`,
                  ).toHaveLength(mode === "failure" ? 2 : 1);
                  const failures = exit.cause.reasons
                    .filter(Cause.isFailReason)
                    .map((reason) => reason.error);
                  // The physical owner additionally retains the failed tracked
                  // driver work when draining the connection before release.
                  expect(failures).toMatchObject(
                    mode === "failure"
                      ? [
                          { reason: "statementFailure" },
                          { reason: "resourceFailure" },
                        ]
                      : [{ reason: "storedCorruption" }],
                  );
                  if (mode === "failure") {
                    const hasCause = (value: unknown): boolean =>
                      value === fault ||
                      (value instanceof Error && hasCause(value.cause));
                    expect(failures.every(hasCause)).toBe(true);
                  }
                }
              } finally {
                for (const restore of restores) restore();
              }
              expect(await tested.inventory()).toEqual(before);
            }
          }
          expect(persistence.pool.waitingCount).toBe(0);
          expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
        }),
      180_000,
    );
  },
);
