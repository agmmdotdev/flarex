import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";
import { newTestPGlite } from "./pgliteSearchExtensions";

describe("prepared metadata epoch PGlite migration", () => {
  it("invalidates only in the writer transaction and rolls back with it", async () => {
    const db = newTestPGlite();
    const persistence = await createPGlitePersistence({ db });
    try {
      await persistence.migrate();
      const read = async () => (await persistence.query<{ generation: string }>(
        "select generation::text from fx_system_prepared_metadata_epoch"))
        .rows[0]?.generation;
      const before = await read();
      expect(before).toBe("1");
      await persistence.query(
        "update fx_system_application_candidate_v1 set candidate_id = candidate_id where false");
      expect(await read()).toBe("2");
      await expect(persistence.drizzle.transaction(async tx => {
        await tx.execute(
          "update fx_system_application_candidate_v1 set candidate_id = candidate_id where false");
        throw new Error("rolled back metadata writer");
      })).rejects.toThrow("rolled back metadata writer");
      expect(await read()).toBe("2");
    } finally {
      await db.close();
    }
  });
});
