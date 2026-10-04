import { it } from "vitest";
import { bindingMetadataBackfillScenario } from "./bindingMetadataBackfillScenario";

it("restores only binding metadata through its genuine split catalog in PGlite", async () => {
  await bindingMetadataBackfillScenario("pglite");
}, 240_000);
