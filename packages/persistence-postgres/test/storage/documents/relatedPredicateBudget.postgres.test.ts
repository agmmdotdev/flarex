import { it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { relatedPredicateBudgetScenario } from "./relatedPredicateBudget.scenario";

it.skipIf(postgresUrl === null)("keeps related-program allowances identity-bound and participant-local on ordinary PostgreSQL", async () => {
  await relatedPredicateBudgetScenario("postgres");
}, 240_000);
