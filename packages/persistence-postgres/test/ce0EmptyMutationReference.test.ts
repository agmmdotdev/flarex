import { it } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { ce0EmptyMutationReferenceScenario } from "./ce0EmptyMutationReferenceScenario";

it("cross-replays the zero-row request reference with the real CMS host (PGlite)", async () => {
  const { persistence, session } = await createRelationalPGliteFixture();
  await ce0EmptyMutationReferenceScenario(persistence, session);
}, 180_000);
