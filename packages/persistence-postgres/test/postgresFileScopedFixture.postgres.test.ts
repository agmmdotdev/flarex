import { describe, expect, it } from "vitest";

import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const withPostgresPersistence = useFileScopedPostgresPersistence();

describePostgres("file-scoped Postgres test fixture", () => {
  it("reuses one migrated persistence while truncating rows between callbacks", async () => {
    let firstPersistence: PostgresFlarexPersistence | undefined;

    await withPostgresPersistence(async (persistence) => {
      firstPersistence = persistence;
      await persistence.insertDeploymentMetadata({
        deploymentId: "fixture_truncate",
        projectId: "project_fixture_truncate",
      });
    });

    await withPostgresPersistence(async (persistence) => {
      expect(persistence).toBe(firstPersistence);
      await expect(
        persistence.getDeploymentMetadata("fixture_truncate"),
      ).resolves.toBeNull();
    });
  });

  it("rebuilds the schemas after a callback failure", async () => {
    const callbackFailure = new Error("injected fixture callback failure");
    let failedPersistence: PostgresFlarexPersistence | undefined;

    await expect(
      withPostgresPersistence(async (persistence) => {
        failedPersistence = persistence;
        await persistence.insertDeploymentMetadata({
          deploymentId: "fixture_rebuild",
          projectId: "project_fixture_rebuild",
        });
        throw callbackFailure;
      }),
    ).rejects.toBe(callbackFailure);

    await withPostgresPersistence(async (persistence) => {
      expect(persistence).not.toBe(failedPersistence);
      await expect(
        persistence.getDeploymentMetadata("fixture_rebuild"),
      ).resolves.toBeNull();
    });
  });
});
