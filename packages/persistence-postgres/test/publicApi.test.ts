import { describe, expect, it } from "vitest";

import * as persistenceApi from "../src";

describe("@flarex/persistence-postgres public API", () => {
  it("does not expose the transaction-scoped invoke-session commit operation", () => {
    expect(persistenceApi).not.toHaveProperty("commitInvokeSessionWrites");
    expect(persistenceApi).not.toHaveProperty(
      "commitInvokeSessionWritesInTransaction",
    );
  });
});
