import { it } from "vitest";
import { createMigratedPGlitePersistence } from "../support/pgliteTestFixture";
import { verifyBoundedCurrentCapture } from "./boundedCurrentCaptureScenario";

it("captures bounded current rows with exact evidence and budget refusal", async () => {
  const persistence = await createMigratedPGlitePersistence();
  await verifyBoundedCurrentCapture(persistence.drizzle);
}, 120_000);
