import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { Effect } from "effect";
import { makeCorePGliteDriver } from "../../src/database/corePersistence/driver";
import { registerCorePhysicalMaintenanceScenarios } from "./physicalMaintenanceScenarios";

registerCorePhysicalMaintenanceScenarios("PGlite physical maintenance", async () => {
  const database = new PGlite();
  const driver = makeCorePGliteDriver(database);
  return { namespace: `physical_${randomUUID().replaceAll("-", "")}`, maintenance: driver, serving: driver,
    ordinaryServingRole: false, grantServing: () => Effect.void, close: () => database.close() };
});
