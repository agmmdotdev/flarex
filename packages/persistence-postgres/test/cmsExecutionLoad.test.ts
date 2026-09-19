import { it } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { cmsExecutionLoadScenario } from "./cmsExecutionLoadScenario";

it("verifies the multi-scope load workload with serial PGlite settlement", async () => {
  const { persistence, session } = await createRelationalPGliteFixture();
  await cmsExecutionLoadScenario(persistence, session, {
    scopes: 4,
    concurrency: 1,
    requests: 24,
    samples: 1,
  });
}, 180_000);
