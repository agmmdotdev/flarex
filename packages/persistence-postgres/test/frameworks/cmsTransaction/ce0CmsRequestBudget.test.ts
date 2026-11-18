import { it } from "vitest";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { ce0CmsRequestBudgetScenario } from "./ce0CmsRequestBudgetScenario";

it("matches cumulative request budgets without partial publication (PGlite)", async () => {
  const { persistence, session } = await createRelationalPGliteFixture();
  await ce0CmsRequestBudgetScenario(persistence, session);
}, 180_000);
