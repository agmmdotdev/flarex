import { describe, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gin } from "@electric-sql/pglite/contrib/btree_gin";
import { createPGlitePersistence } from "../../../src/database/pglite";
import { committedUniqueRowScenario } from "./committedUniqueRowScenario";

describe("committed unique slot and separate row acceptance", () => {
  it("authenticates the body-free slot before bounded point decoding", async () => {
    const client = new PGlite({ extensions: { pg_trgm, btree_gin } });
    const persistence = await createPGlitePersistence({ db: client });
    try { await persistence.migrate(); await committedUniqueRowScenario(persistence.drizzle); }
    finally { await client.close(); }
  }, 120_000);
});
