import { it, vi } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { cmsHostScenario } from "./cmsHostScenario";

// Exercise policy propagation with non-default values. The shared scenario
// reads the actual database settings after host admission, so literal SQL
// defaults cannot accidentally pass this witness.
vi.mock("../src/frameworkExecutionPolicy", async importOriginal => {
  const policy = await importOriginal<typeof import("../src/frameworkExecutionPolicy")>();
  return { ...policy, cmsLimits: Object.freeze({ ...policy.cmsLimits, statementMs: 1750, lockMs: 750 }) };
});

it("proves CMS pending documents and Application publication on one PGlite instance", async () => {
  const fixture = await createRelationalPGliteFixture();
  await cmsHostScenario(fixture.persistence, fixture.session);
}, 180_000);
