import { describe, expect, it } from "vitest";

import type { PostgresFlarexPersistence } from "../../src/database/postgres";
import {
  postgresUrl,
  useFileScopedPostgresPersistence,
} from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;
const withPostgresPersistence = useFileScopedPostgresPersistence();

describePostgres("file-scoped Postgres test fixture", () => {
  it("waits for an outstanding callback and reset before reusing its persistence", async () => {
    let firstPersistence: PostgresFlarexPersistence | undefined;
    let releaseFirst: (() => void) | undefined;
    const held = new Promise<void>(resolve => { releaseFirst = resolve; });
    let firstFinished = false;

    const first = withPostgresPersistence(async (persistence) => {
      firstPersistence = persistence;
      await persistence.insertDeploymentMetadata({
        deploymentId: "fixture_truncate",
        projectId: "project_fixture_truncate",
      });
      await held;
      firstFinished = true;
    });

    const second = withPostgresPersistence(async (persistence) => {
      expect(firstFinished).toBe(true);
      expect(persistence).toBe(firstPersistence);
      await expect(
        persistence.getDeploymentMetadata("fixture_truncate"),
      ).resolves.toBeNull();
    });
    releaseFirst?.();
    await Promise.all([first, second]);
  }, 30_000);

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
  }, 30_000);
});
