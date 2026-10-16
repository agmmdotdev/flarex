import { it } from "vitest";
import { createMigratedPGlitePersistence } from "../support/pgliteTestFixture";
import { scopePublicationBatchScenario } from "./scopePublicationBatchScenario";

it("batches publication with exact returned facts and atomic rollback (PGlite)", async () => {
  const persistence = await createMigratedPGlitePersistence();
  await scopePublicationBatchScenario(persistence);
}, 120_000);
