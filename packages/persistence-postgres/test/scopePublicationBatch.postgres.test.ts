import { describe, it } from "vitest";
import { postgresUrl, useFileScopedPostgresPersistence } from "./postgresHelpers";
import { scopePublicationBatchScenario } from "./scopePublicationBatchScenario";

describe.skipIf(postgresUrl === null)("publication batches (Postgres)", () => {
  const withPersistence = useFileScopedPostgresPersistence();
  it("batches publication with exact returned facts and atomic rollback", async () => {
    await withPersistence(scopePublicationBatchScenario);
  }, 120_000);
});
