import { it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { relatedRelationalPredicateScenario } from "./relatedRelationalPredicate.scenario";

it.skipIf(postgresUrl === null)("runs a genuine bounded related predicate on ordinary-role PostgreSQL", async () => {
  await relatedRelationalPredicateScenario("postgres");
}, 240_000);
