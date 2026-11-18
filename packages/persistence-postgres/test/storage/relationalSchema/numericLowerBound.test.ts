import { describe, it } from "vitest";
import { numericLowerBoundScenario } from "./numericLowerBoundScenario";
describe("neutral logical exact numeric bound on PGlite", () => {
  it("preserves exact comparison, null, pending writes, initialization, rollback and replay", () => numericLowerBoundScenario("pglite"), 240_000);
});
