import { describe, it } from "vitest";
import { runCheckedReadPerformanceScenario } from "./checkedReadPerformanceScenario";

describe("genuine checked-read component on PGlite", () => {
  it("retains uncached snapshot selections and pending local reads", async () => {
    await runCheckedReadPerformanceScenario("pglite");
  }, 180_000);
});
