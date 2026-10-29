import { it } from "vitest";
import { relatedRelationalPredicateScenario } from "./relatedRelationalPredicate.scenario";

it("runs a genuine bounded related PostgreSQL predicate with pending cohorts, receipts, rollback and replay on PGlite", async () => {
  await relatedRelationalPredicateScenario("pglite");
}, 240_000);
