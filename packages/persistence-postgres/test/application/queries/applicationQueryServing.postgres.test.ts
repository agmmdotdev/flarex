import { Effect } from "effect";
import { Client } from "pg";
import { describe, expect, it } from "vitest";

import { createPostgresClientApplicationQueryServing } from "../../../src/application/applicationQueryServing";
import { observePostgresClientLifetime } from "../../../src/database/postgresClientLifetime";
import { createApplicationNativeMutationPostgresFixture } from "../applicationNativeMutationTestFixture";
import { runEffect } from "../../support/effectTestRuntime";
import { postgresUrl, withTemporaryPostgresPersistence } from "../../support/postgresHelpers";
import { APPLICATION_QUERY_SERVING_OPTIONS, assertApplicationQueryServing } from "./applicationQueryServingScenario";

describe.skipIf(postgresUrl === null)("connected-client Application query serving on ordinary-role PostgreSQL", () => {
  it("constructs authentic read ports from a real client and refuses wrong deployment or locator", async () => {
    await withTemporaryPostgresPersistence(async persistence => {
      const fixture = await createApplicationNativeMutationPostgresFixture(APPLICATION_QUERY_SERVING_OPTIONS, {
        control: persistence,
        target: persistence,
      });
      const client = new Client({
        ...persistence.pool.options,
        connectionString: postgresUrl ?? undefined,
      });
      const quarantined: Error[] = [];
      const observation = observePostgresClientLifetime(client);
      const options = { quarantine: (cause: Error) => { quarantined.push(cause); }, connectionErrors: observation.connectionErrors };
      const configuration = {
        deploymentId: fixture.deploymentId,
        scopeId: fixture.authority.scopeId,
        physicalLocator: fixture.servingOwners.target.physicalLocator,
        cold: fixture.servingOwners.cold,
      };
      try {
        await client.connect();
        observation.check();
        expect((await client.query<{ superuser: boolean }>(
          "select rolsuper as superuser from pg_roles where rolname=current_user",
        )).rows[0]?.superuser).toBe(false);
        await assertApplicationQueryServing(fixture, deploymentId => createPostgresClientApplicationQueryServing(
          client, { ...configuration, deploymentId }, options,
        ));
        const wrongLocator = createPostgresClientApplicationQueryServing(client, {
          ...configuration,
          physicalLocator: { ...configuration.physicalLocator, databaseKey: `${configuration.physicalLocator.databaseKey}:other` },
        }, options);
        expect(await runEffect(Effect.flip(wrongLocator.activation.readActive()))).toMatchObject({
          _tag: "TrustedScopeAuthorityResolutionError",
          failure: { reason: "scopeClockTargetResolutionFailed" },
        });
        expect(quarantined).toEqual([]);
      } finally {
        await observation.finish(() => client.end());
      }
      expect(persistence.pool.waitingCount).toBe(0);
      expect(persistence.pool.idleCount).toBe(persistence.pool.totalCount);
    });
  }, 120_000);
});
