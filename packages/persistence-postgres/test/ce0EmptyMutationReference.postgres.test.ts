import { describe, expect, it } from "vitest";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "./postgresHelpers";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { ce0EmptyMutationReferenceScenario } from "./ce0EmptyMutationReferenceScenario";

describe.skipIf(postgresUrl === null)(
  "zero-row request reference (Postgres)",
  () => {
    const withPersistence = useFileScopedPostgresPersistence();
    it(
      "cross-replays and refuses invalid authority and outcome evidence",
      () =>
        withPersistence(async (persistence) => {
          expect(
            (
              await persistence.query<{ superuser: boolean }>(
                "select rolsuper as superuser from pg_roles where rolname=current_user",
              )
            ).rows[0]?.superuser,
          ).toBe(false);
          await ce0EmptyMutationReferenceScenario(
            persistence,
            makePostgresRelationalSession(persistence),
          );
          expect(persistence.pool.waitingCount).toBe(0);
          expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
        }),
      180_000,
    );
  },
);
