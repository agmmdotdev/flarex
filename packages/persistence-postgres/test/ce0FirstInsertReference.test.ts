import { it } from "vitest";
import { createRelationalPGliteFixture } from "./relationalPGliteWorkerTestSupport";
import { ce0FirstInsertReferenceScenario } from "./ce0FirstInsertReferenceScenario";

it("cross-replays first inserts with exact rows, indexes, claims and rollback (PGlite)", async () => {
  const { persistence, session } = await createRelationalPGliteFixture();
  await ce0FirstInsertReferenceScenario(persistence, session);
}, 180_000);
