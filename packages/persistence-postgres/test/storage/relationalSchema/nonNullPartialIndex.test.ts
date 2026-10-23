import { describe, it } from "vitest";
import { nonNullPartialIndexScenario } from "./nonNullPartialIndexScenario";

describe("installed neutral non-null ordered membership on PGlite", () => {
  it("builds nonempty indexes and preserves lifecycle, replay, rollback and cold read eligibility", async () => {
    await nonNullPartialIndexScenario("pglite");
  }, 240_000);
});
