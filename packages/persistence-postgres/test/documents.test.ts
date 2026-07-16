import type { PersistenceJson } from "@flarex/persistence-postgres";
import type { WritableJson } from "flarex-protocol/json";
import { describe, expectTypeOf, it } from "vitest";

describe("persistence JSON contract", () => {
  it("preserves the published name as the protocol writable JSON shape", () => {
    expectTypeOf<PersistenceJson>().toEqualTypeOf<WritableJson>();
  });
});
