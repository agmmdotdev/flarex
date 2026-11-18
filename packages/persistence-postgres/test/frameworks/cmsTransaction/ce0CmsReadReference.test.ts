import { it } from "vitest";
import { createRelationalPGliteFixture } from "../../database/relationalPGliteWorkerTestSupport";
import { ce0CmsReadReferenceScenario } from "./ce0CmsReadReferenceScenario";

it("reads independently with scoped absence, refusal and no publication (PGlite)", async () => {
  const { persistence, session } = await createRelationalPGliteFixture();
  await ce0CmsReadReferenceScenario(persistence, session);
}, 180_000);
