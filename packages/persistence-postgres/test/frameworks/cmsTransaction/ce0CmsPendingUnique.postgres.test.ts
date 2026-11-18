import { describe, expect, it } from "vitest";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "../../support/postgresHelpers";
import { ce0CmsPendingUniqueScenario } from "./ce0CmsPendingUniqueScenario";

describe.skipIf(postgresUrl === null)(
  "pending uniqueness reference (Postgres)",
  () => {
    const withPersistence = useFileScopedPostgresPersistence();
    it(
      "preserves eager refusal, rollback and request identity",
      () =>
        withPersistence(async (persistence) => {
          expect(
            (
              await persistence.query<{ superuser: boolean }>(
                "select rolsuper as superuser from pg_roles where rolname=current_user",
              )
            ).rows[0]?.superuser,
          ).toBe(false);
          await ce0CmsPendingUniqueScenario(
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
