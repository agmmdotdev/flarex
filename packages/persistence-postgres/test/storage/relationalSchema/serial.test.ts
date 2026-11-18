import { describe, it } from "vitest";
import { serialScenario } from "./serialScenario";

describe("generated serial max-plus-one on PGlite", () => {
  it.each([false, true])("preserves dependencies, pending changes, bounds and replay (finite capture %s)", async finite => {
    await serialScenario("pglite", finite);
  }, 240_000);
});
