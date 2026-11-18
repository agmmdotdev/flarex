import { describe, it } from "vitest";
import { runCheckedReadPerformanceScenario } from "./checkedReadPerformanceScenario";

describe.skipIf(process.env.FLAREX_POSTGRES_DATABASE_URL === undefined)(
  "genuine checked-read component on ordinary PostgreSQL", () => {
    it("records a separate untraced baseline and matched small SQL trace", async () => {
      await runCheckedReadPerformanceScenario("postgres");
    }, 180_000);
  });
