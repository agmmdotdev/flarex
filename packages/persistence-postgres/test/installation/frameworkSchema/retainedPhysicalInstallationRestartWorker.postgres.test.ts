import { writeSync } from "node:fs";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";
import { createPostgresPersistence } from "../../../src/database/postgres";
import { installRetainedPhysicalProfile } from "../../../src/database/postgresInstallationMaintenance";
import { makeRetainedPhysicalSelection, retainedPhysicalPolicy } from "./retainedPhysicalInstallationFixture";
import { runEffect } from "../../support/effectTestRuntime";

const decodeCoordinates = Schema.decodeUnknownSync(Schema.Struct({
  mode: Schema.Literals(["before-structure", "after-structure", "after-readiness", "resume"]),
  schemaName: Schema.String.check(Schema.isPattern(/^[a-z0-9_]+$/)),
  ownerUrl: Schema.NonEmptyString, runtimeUrl: Schema.NonEmptyString,
  journal: Schema.Struct({ migrationsSchema: Schema.NonEmptyString, migrationsTable: Schema.NonEmptyString }),
}));
const worker = process.env.FLAREX_RETAINED_PHYSICAL_MODE === undefined ? describe.skip : describe;
worker("retained physical reconstruction in a fresh process", () => {
  it("reconstructs authentic selection on the original namespace", async () => {
    const coordinates = decodeCoordinates({ mode: process.env.FLAREX_RETAINED_PHYSICAL_MODE,
      schemaName: process.env.FLAREX_RETAINED_PHYSICAL_SCHEMA,
      ownerUrl: process.env.FLAREX_RETAINED_PHYSICAL_OWNER_URL, runtimeUrl: process.env.FLAREX_RETAINED_PHYSICAL_RUNTIME_URL,
      journal: JSON.parse(process.env.FLAREX_RETAINED_PHYSICAL_JOURNAL ?? "null") });
    const runtime = await createPostgresPersistence({ connectionString: coordinates.runtimeUrl,
      poolConfig: { options: `-c search_path=${coordinates.schemaName}` } });
    try {
      const selected = await makeRetainedPhysicalSelection(runtime, coordinates.schemaName);
      let armed = false;
      const installed = await runEffect(installRetainedPhysicalProfile({
        config: { connectionString: coordinates.ownerUrl }, schemaName: coordinates.schemaName,
        database: runtime.drizzle, target: selected.target, artifactRepository: selected.repository,
        requests: [selected.request, selected.request], policy: retainedPhysicalPolicy, journal: coordinates.journal,
        runtimeDatabases: [runtime.drizzle], options: { observe: event => {
          if (event.phase === "begin" && event.edge === "before") armed = false;
          if (event.phase === "work" && event.edge === "after" &&
            (coordinates.mode === "after-readiness" ? /^insert into\b/i.test(event.text?.trim() ?? "") &&
              event.text?.includes('"fx_system_framework_schema_availability_head"') : /^create table\b/i.test(event.text?.trim() ?? ""))) armed = true;
          if (coordinates.mode !== "resume" && armed && event.phase === "commit" &&
            event.edge === (coordinates.mode === "before-structure" ? "before" : "after")) {
            writeSync(1, `RETAINED_PHYSICAL_CRASH:${coordinates.mode}\n`);
            process.exit(73);
          }
        } },
      }));
      expect(coordinates.mode).toBe("resume");
      expect(installed.installation.plan.plan.frame.steps).toHaveLength(selected.requiredStepCount);
    } finally { await runtime.close(); }
  }, 120_000);
});
