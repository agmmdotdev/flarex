import { it } from "vitest";
import { checkoutParticipantAllowanceScenario } from "./checkoutParticipantAllowanceScenario";

it("settles nineteen isolated logical owners with replay and complete rollback on PGlite", async () => {
  await checkoutParticipantAllowanceScenario("pglite");
}, 240_000);
