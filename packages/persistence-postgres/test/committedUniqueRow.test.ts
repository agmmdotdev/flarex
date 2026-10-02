import { describe, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gin } from "@electric-sql/pglite/contrib/btree_gin";
import { createPGlitePersistence } from "../src/pglite";
import { committedUniqueRowScenario } from "./committedUniqueRowScenario";

describe("committed unique owner and row capture", () => {
  it("shares the statement cut and preserves lazy failure order and body limits", async () => {
    const client = new PGlite({ extensions: { pg_trgm, btree_gin } });
    const persistence = await createPGlitePersistence({ db: client });
    try { await persistence.migrate(); await committedUniqueRowScenario(persistence.drizzle); }
    finally { await client.close(); }
  }, 120_000);
});
