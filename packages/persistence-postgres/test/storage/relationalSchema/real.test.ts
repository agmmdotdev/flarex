import { describe, it } from "vitest";
import { realDefinitionRefusals, realScenario } from "./realScenario";

describe("installed neutral SQL real on PGlite", () => {
  it("refuses unsupported indexes and literal defaults", realDefinitionRefusals);
  it.each([false, true])("normalizes actual borrowed SQL values and preserves storage lifetime (finite capture %s)", async finite => {
    await realScenario("pglite", finite);
  }, 240_000);
});
