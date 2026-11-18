import { describe, expect, it } from "vitest";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "../../support/postgresHelpers";
import { ce0CmsRequestBudgetScenario } from "./ce0CmsRequestBudgetScenario";

describe.skipIf(postgresUrl === null)(
  "cumulative request budgets (Postgres)",
  () => {
    const withPersistence = useFileScopedPostgresPersistence();
    it(
      "refuses oversized accumulated work without partial publication",
      () =>
        withPersistence(async (persistence) => {
          expect(
            (
              await persistence.query<{ superuser: boolean }>(
                "select rolsuper as superuser from pg_roles where rolname=current_user",
              )
            ).rows[0]?.superuser,
          ).toBe(false);
          await ce0CmsRequestBudgetScenario(
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
