import { PGlite } from "@electric-sql/pglite";
import { it } from "vitest";
import { createPGlitePersistence } from "../src/pglite";
import { verifyBoundedCurrentCapture } from "./boundedCurrentCaptureScenario";

it("captures bounded current rows with exact evidence and budget refusal", async () => {
  const client = new PGlite();
  try {
    const persistence = await createPGlitePersistence({ db: client });
    await persistence.migrate();
    await verifyBoundedCurrentCapture(persistence.drizzle);
  } finally {
    await client.close();
  }
}, 120_000);
