import { it, onTestFinished } from "vitest";
import { createMigratedPGlitePersistence } from "../../support/pgliteTestFixture";
import { privatePermissionFixture } from "./privatePermissionFixture";
import { privateReferencePermissionScenario } from "./privateReferencePermissionScenario";

it("protects permission writes, binds private evidence and refuses stale dependencies (PGlite)", async () => {
  const persistence = await createMigratedPGlitePersistence(onTestFinished, "finiteCapture");
  const fixture = await privatePermissionFixture(persistence);
  try { await privateReferencePermissionScenario(fixture); }
  finally { await fixture.close(); }
}, 180_000);