import { Option } from "effect";
import { expect, it } from "vitest";
import { lockFrameworkSchemaAvailabilityByIdentityInTransactionEffect } from "../src/frameworkSchema/installation/availabilityHeadRepository";
import { postgresUrl, createFileScopedPostgresFixture } from "./postgresHelpers";
import { createInstallationAcceptanceFixture, exerciseInstallationAcceptance } from "./frameworkInstallationAcceptanceTestSupport";
import { runEffect } from "./effectTestRuntime";

it.skipIf(postgresUrl === null)("restores exact installation evidence once on PostgreSQL", async () => {
  const fixture = await createFileScopedPostgresFixture();
  try { await exerciseInstallationAcceptance(fixture.persistence.drizzle); }
  finally { await fixture.dispose(); }
}, 180_000);

it.skipIf(postgresUrl === null)("holds availability protection until accepting transaction settlement", async () => {
  const fixture = await createFileScopedPostgresFixture();
  try {
    const stored = await createInstallationAcceptanceFixture(fixture.persistence.drizzle);
    const client = await fixture.persistence.pool.connect();
    const update = "update fx_system_framework_schema_availability_head set status = status where installation_storage_id = $1";
    const parameters = [stored.installation.storageId.toString()];
    try {
      await fixture.persistence.drizzle.transaction(async transaction => {
        const accepted = await runEffect(lockFrameworkSchemaAvailabilityByIdentityInTransactionEffect(transaction, stored.installation.installation.frame.identity));
        expect(Option.isSome(accepted)).toBe(true);
        await client.query("begin");
        try {
          await client.query("set local lock_timeout = '100ms'");
          await expect(client.query(update, parameters)).rejects.toMatchObject({ code: "55P03" });
        } finally { await client.query("rollback"); }
      });
      expect((await client.query(update, parameters)).rowCount).toBe(1);
    } finally { client.release(); }
  } finally { await fixture.dispose(); }
}, 180_000);
