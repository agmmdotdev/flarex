import { describe, it } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { applicationWritePolicyBindingScenario } from "./applicationWritePolicyBindingScenario";

describe.skipIf(postgresUrl === null)("Application write-policy binding (Postgres)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("retains exact V3 scalar policy bindings across publication and replay", () => withPersistence(async persistence => {
    const deploymentId = "policy-binding-postgres";
    await persistence.insertDeploymentMetadata({ deploymentId, projectId: "policy-binding" });
    await applicationWritePolicyBindingScenario({ db: persistence.drizzle,
      runTransaction: run => persistence.drizzle.transaction(run) }, deploymentId);
  }), 30_000);
});
