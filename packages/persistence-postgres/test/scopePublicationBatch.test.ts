import { it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { createPGlitePersistence } from "../src/pglite";
import { scopePublicationBatchScenario } from "./scopePublicationBatchScenario";

it("batches publication with exact returned facts and atomic rollback (PGlite)", async () => {
  const db = new PGlite();
  try {
    const persistence = await createPGlitePersistence({ db });
    await persistence.migrate();
    await scopePublicationBatchScenario(persistence);
  } finally {
    await db.close();
  }
}, 120_000);
