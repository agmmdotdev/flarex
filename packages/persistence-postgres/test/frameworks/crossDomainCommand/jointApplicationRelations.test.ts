import { it } from "vitest";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { jointApplicationRelationsScenario } from "./jointApplicationRelationsScenario";

it("maintains Application relations in one genuine App/Payload/Currency command (PGlite)", async () => {
  const { persistence, session } = await createRelationalPGliteFixture();
  await jointApplicationRelationsScenario(persistence, session);
}, 180_000);
