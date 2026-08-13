import { describe, expect, it } from "vitest";

import {
  createApplicationNativeMutationPGliteFixture,
} from "./fixtures/applicationNativeMutationTestFixture";

describe("Application-native mutation fixture", { timeout: 180_000 }, () => {
  it("publishes, readies, and activates one table-bearing public mutation", async () => {
    const fixture = await createApplicationNativeMutationPGliteFixture({
      runtimeHostIdentity: "flarex.test/application-runtime-host",
      compatibilityDate: "2026-08-13",
    });

    expect(fixture.active.basis).toMatchObject({
      revisionId: fixture.active.basis.revisionId,
      runtimeHostIdentity: "flarex.test/application-runtime-host",
      compatibilityDate: "2026-08-13",
      activationSequence: 1n,
      manifest: {
        functions: [{
          path: "users:create",
          kind: "mutation",
          visibility: "public",
        }],
        schema: { tables: [{ tableId: 1, name: "users" }] },
      },
    });
    expect(fixture.source.modules.map(module => module.path)).toEqual([
      "_flarex/application.js",
      "_flarex/schema.js",
      "functions/users.js",
    ]);
  });
});
