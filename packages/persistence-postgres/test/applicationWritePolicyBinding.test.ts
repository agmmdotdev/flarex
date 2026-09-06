import { it } from "vitest";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { applicationWritePolicyBindingScenario } from "./applicationWritePolicyBindingScenario";

it("retains exact V3 scalar policy bindings across publication and replay (PGlite)", async () => {
  const persistence = await createMigratedPGlitePersistence();
  const deploymentId = "policy-binding-pglite";
  await persistence.insertDeploymentMetadata({ deploymentId, projectId: "policy-binding" });
  await applicationWritePolicyBindingScenario({ db: persistence.drizzle,
    runTransaction: run => persistence.drizzle.transaction(run) }, deploymentId);
}, 30_000);
