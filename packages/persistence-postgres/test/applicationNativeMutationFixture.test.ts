import { describe, expect, it } from "vitest";

import {
  createApplicationNativeMutationPGliteFixture,
} from "./fixtures/applicationNativeMutationTestFixture";

describe("Application-native mutation fixture", { timeout: 180_000 }, () => {
  it("publishes, readies, and activates public and internal mutation entries", async () => {
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
        }, {
          path: "users:createInternal",
          kind: "mutation",
          visibility: "internal",
        }, {
          path: "users:get",
          kind: "query",
          visibility: "public",
        }, {
          path: "users:notify",
          kind: "action",
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
