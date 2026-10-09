import { newTestPGlite } from "../support/pgliteSearchExtensions";
import { it } from "vitest";
import { createPGlitePersistence } from "../../src/database/pglite";
import { verifyBoundedCurrentCapture } from "./boundedCurrentCaptureScenario";

it("captures bounded current rows with exact evidence and budget refusal", async () => {
  const client = newTestPGlite();
  try {
    const persistence = await createPGlitePersistence({ db: client });
    await persistence.migrate();
    await verifyBoundedCurrentCapture(persistence.drizzle);
  } finally {
    await client.close();
  }
}, 120_000);
