import { describe, expect, it } from "vitest";
import { executeNextFrameworkMigrationStepEffect, finalizeFrameworkMigrationClaimEffect,
  runFreshFrameworkMigrationCoordinatorEffect } from "../src/migrationCoordination/freshCoordinator";
import { createPostgresPersistence } from "../src/postgres";
import { runEffect } from "./effectTestRuntime";
import { createNativeCoordinatorFixture } from "./frameworkCoordinatorPostgresFixture";

// Executed only by the restart acceptance parent. Each invocation is a separate
// OS process with no inherited target/claim WeakMaps or coordinator tokens.
const worker = process.env.FLAREX_FRAMEWORK_RESTART_MODE === undefined ? describe.skip : describe;
worker("native framework restart worker", () => {
  it("reconstructs its own artifact, target and claim", async () => {
    const schema = process.env.FLAREX_FRAMEWORK_RESTART_SCHEMA;
    const physical = process.env.FLAREX_FRAMEWORK_RESTART_PHYSICAL;
    const mode = process.env.FLAREX_FRAMEWORK_RESTART_MODE;
    const connectionString = process.env.FLAREX_POSTGRES_DATABASE_URL;
    if (schema === undefined || physical === undefined || mode === undefined ||
      connectionString === undefined || !/^[a-z0-9_]+$/.test(schema) || !/^[a-z0-9_]+$/.test(physical)) throw new Error("Invalid restart fixture coordinates");
    const persistence = await createPostgresPersistence({
      connectionString,
      poolConfig: { options: `-c search_path=${schema}` },
    });
    let armed = false;
    const fixture = await createNativeCoordinatorFixture(persistence, physical, { observe: event => {
      if (armed && event.phase === "commit" &&
        event.edge === (mode === "before-step" ? "before" : "after")) {
        // Abrupt termination deliberately bypasses session cleanup and pool.end.
        process.exit(73);
      }
    } });
    try {
      if (mode === "resume") {
        expect(await runEffect(runFreshFrameworkMigrationCoordinatorEffect(fixture.input))).toMatchObject({ kind: "ready" });
        return;
      }
      const pending = await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...fixture.input,
        maximumStepsPerRun: mode === "partial" ? 2 : mode === "after-finalize" ? 7 : 0 }));
      if (pending.kind !== "pending") throw new Error("Expected worker claim");
      if (mode === "partial") process.exit(73);
      armed = true;
      if (mode === "after-finalize") await runEffect(finalizeFrameworkMigrationClaimEffect(pending.claim));
      else await runEffect(executeNextFrameworkMigrationStepEffect(pending.claim));
      throw new Error("Worker did not reach its injected termination edge");
    } finally { await persistence.close(); }
  }, 180_000);
});
