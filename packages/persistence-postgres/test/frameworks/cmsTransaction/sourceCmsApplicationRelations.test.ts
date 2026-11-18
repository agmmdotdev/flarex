import { it } from "vitest";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { sourceCmsApplicationRelationsScenario } from "./sourceCmsApplicationRelationsScenario";

it("maintains Application relations through native source-profile Payload Local API (PGlite)", async () => {
  const { persistence, session } = await createRelationalPGliteFixture();
  await sourceCmsApplicationRelationsScenario(persistence, session);
}, 180_000);
