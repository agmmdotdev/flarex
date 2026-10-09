import { describe, expect, it } from "vitest";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "../../support/postgresHelpers";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { cmsCommandSettlementScenario } from "./cmsCommandSettlementScenario";
describe.skipIf(postgresUrl === null)(
  "CMS command settlement (PostgreSQL)",
  () => {
    const withPersistence = useFileScopedPostgresPersistence();
    it(
      "validates complete decisions and rolls back injected changes",
      () =>
        withPersistence(async (persistence) => {
          expect(
            (
              await persistence.query<{ rolsuper: boolean }>(
                "select rolsuper from pg_roles where rolname=current_user",
              )
            ).rows[0]?.rolsuper,
          ).toBe(false);
          await cmsCommandSettlementScenario(
            persistence,
            makePostgresRelationalSession(persistence),
          );
          expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
        }),
      120_000,
    );
  },
);
