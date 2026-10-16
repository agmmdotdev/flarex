import { Effect } from "effect";
import { beforeAll, expect, it } from "vitest";
import { createPGlitePersistence } from "../../src/database/pglite";
import { initializeFullProofInstallation, verifyInstallationWriterProtection } from "../../src/installation/installationLifecycle";
import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { migratedPGliteDataDir } from "../support/pgliteTestFixture";

beforeAll(async () => { await migratedPGliteDataDir(); }, 120_000);

it.each(["child", "ancestor"] as const)("refuses metadata %s inheritance at the actual PGlite reopen owner", async direction => {
  const db = newTestPGlite({ loadDataDir: await migratedPGliteDataDir() });
  const persistence = await createPGlitePersistence({ db });
  try {
    await Effect.runPromise(verifyInstallationWriterProtection(persistence.drizzle, "public"));
    const uncovered = direction === "child" ? "metadata_inheriting_child" : "metadata_uncovered_ancestor";
    await persistence.query(direction === "child" ? `create table ${uncovered} () inherits(fx_control_table)` :
      `create table ${uncovered}(logical_name text)`);
    if (direction === "ancestor") await persistence.query(`alter table fx_control_table inherit ${uncovered}`);
    await persistence.query(`create trigger fx_00_installation_admission before insert or update or delete or truncate on ${uncovered}
      for each statement execute function fx_require_active_installation()`);
    if (direction === "ancestor") await persistence.query("insert into deployments(deployment_id,project_id) values ('metadata-inheritance','metadata-inheritance')");
    await persistence.query(`insert into ${direction === "child" ? uncovered : "fx_control_table"}
      (deployment_id,table_id,namespace,logical_name) values ('metadata-inheritance',123451,'app','before')`);
    const before = (await persistence.query<{ generation: bigint }>("select generation from fx_system_prepared_metadata_epoch")).rows;
    await persistence.query(`update ${uncovered} set logical_name='changed-through-${direction}' where logical_name='before'`);
    expect((await persistence.query("select logical_name from fx_control_table where table_id=123451")).rows)
      .toEqual([{ logical_name: `changed-through-${direction}` }]);
    expect((await persistence.query("select generation from fx_system_prepared_metadata_epoch")).rows).toEqual(before);
    await expect(Effect.runPromise(verifyInstallationWriterProtection(persistence.drizzle, "public")))
      .rejects.toMatchObject({ reason: "invalidInstallation" });
    await expect(Effect.runPromise(initializeFullProofInstallation(persistence.drizzle)))
      .rejects.toMatchObject({ reason: "invalidInstallation" });
    await expect(persistence.migrate()).rejects.toMatchObject({ reason: "invalidInstallation" });
    expect((await persistence.query("select state from fx_system_installation")).rows).toEqual([{ state: "draining" }]);
  } finally { await db.close(); }
}, 180_000);
