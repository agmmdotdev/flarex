import { describe, it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { serialScenario } from "./serialScenario";

describe.skipIf(postgresUrl === null)("generated serial max-plus-one on ordinary-role PostgreSQL", () => {
  it.each([false, true])("preserves dependencies, pending changes, bounds and replay (finite capture %s)", async finite => {
    await serialScenario("postgres", finite);
  }, 240_000);
});
