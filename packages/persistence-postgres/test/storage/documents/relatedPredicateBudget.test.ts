import { it } from "vitest";
import { relatedPredicateBudgetScenario } from "./relatedPredicateBudget.scenario";

it("keeps related-program allowances identity-bound and participant-local on PGlite", async () => {
  await relatedPredicateBudgetScenario("pglite");
}, 240_000);
