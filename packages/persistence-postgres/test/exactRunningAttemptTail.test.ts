import { describe, it } from "vitest";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";
import { runningAttemptTailScenario } from "./exactRunningAttemptTailScenario";

describe("ordered running-attempt tail on PGlite", () => {
  it("retains native codecs and bounded first refusals", async () => {
    await runningAttemptTailScenario(await createMigratedPGlitePersistence());
  });
});
