import { it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { timestampMembershipScenario } from "./timestampMembership.scenario";
it.skipIf(postgresUrl === null)("preserves native timestamp membership through real source owners on ordinary-role PostgreSQL", async () => {
  await timestampMembershipScenario("postgres");
}, 180_000);
