import { Client } from "pg";
import { expect, it } from "vitest";
import { postgresUrl, createFileScopedPostgresFixture } from "../../support/postgresHelpers";
import { installJsonArrayDefaultFixture, assertJsonArrayDefaultDriftRefused } from "./frameworkJsonArrayDefaultTestSupport";

it.skipIf(postgresUrl === null)("installs an empty JSON array default, preserves it on reconnect and refuses drift on ordinary PostgreSQL", async () => {
  const owner = await createFileScopedPostgresFixture();
  try {
    expect((await owner.persistence.query("select rolsuper from pg_roles where rolname=session_user")).rows)
      .toEqual([{ rolsuper: false }]);
    const fixture = await installJsonArrayDefaultFixture(owner.persistence);
    const reconnected = new Client(owner.persistence.pool.options);
    try {
      await reconnected.connect();
      expect((await reconnected.query(fixture.insertDefault, [fixture.scopeUuid, "after-reconnect"])).rows)
        .toEqual([{ messages: [] }]);
    } finally { await reconnected.end(); }
    await assertJsonArrayDefaultDriftRefused(owner.persistence, fixture);
  } finally { await owner.dispose(); }
}, 180_000);
