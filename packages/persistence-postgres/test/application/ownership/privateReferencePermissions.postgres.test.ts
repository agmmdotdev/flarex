import { describe, it } from "vitest";
import { createFileScopedPostgresFixture, postgresUrl } from "../../support/postgresHelpers";
import { privatePermissionFixture } from "./privatePermissionFixture";
import { privateReferencePermissionScenario } from "./privateReferencePermissionScenario";

describe.skipIf(postgresUrl === null)("private permission evidence (ordinary-role PostgreSQL)", () => {
  it("protects writes, binds private evidence and refuses stale dependencies", async () => {
    const database = await createFileScopedPostgresFixture({}, {}, "finiteCapture");
    try {
      const fixture = await privatePermissionFixture(database.persistence);
      try { await privateReferencePermissionScenario(fixture); }
      finally { await fixture.close(); }
    } finally { await database.dispose(); }
  }, 180_000);
});
