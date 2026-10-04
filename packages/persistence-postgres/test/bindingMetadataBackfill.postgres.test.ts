import { it } from "vitest";
import { postgresUrl } from "./postgresHelpers";
import { bindingMetadataBackfillScenario } from "./bindingMetadataBackfillScenario";

it.skipIf(postgresUrl === null)("restores only binding metadata through its genuine split catalog in PostgreSQL", async () => {
  await bindingMetadataBackfillScenario("postgres");
}, 240_000);
