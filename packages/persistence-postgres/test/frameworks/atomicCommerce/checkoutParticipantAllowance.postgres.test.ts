import { it } from "vitest";
import { postgresUrl } from "../../support/postgresHelpers";
import { checkoutParticipantAllowanceScenario } from "./checkoutParticipantAllowanceScenario";

it.skipIf(postgresUrl === null)("settles nineteen isolated logical owners with replay and complete rollback on ordinary-role PostgreSQL", async () => {
  await checkoutParticipantAllowanceScenario("postgres");
}, 240_000);
