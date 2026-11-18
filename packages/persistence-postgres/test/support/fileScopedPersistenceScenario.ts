import { expect, it } from "vitest";
import type { FlarexPersistence } from "../../src";
import type { WithFileScopedPersistence } from "./fileScopedPersistenceFixture";

/** Same drainage, reset and failure behavior for both real driver fixtures. */
export function registerFileScopedPersistenceTests<Persistence extends Pick<FlarexPersistence,
  "insertDeploymentMetadata" | "getDeploymentMetadata">>(
  withPersistence: WithFileScopedPersistence<Persistence>,
  assertReused: (previous: Persistence, current: Persistence) => void,
): void {
  it("waits for an outstanding callback and reset before reusing its persistence", async () => {
    let firstPersistence: Persistence | undefined;
    let releaseFirst: (() => void) | undefined;
    const held = new Promise<void>(resolve => { releaseFirst = resolve; });
    let firstFinished = false;

    const first = withPersistence(async (persistence) => {
      firstPersistence = persistence;
      await persistence.insertDeploymentMetadata({
        deploymentId: "fixture_truncate",
        projectId: "project_fixture_truncate",
      });
      await held;
      firstFinished = true;
    });

    const second = withPersistence(async (persistence) => {
      expect(firstFinished).toBe(true);
      if (firstPersistence === undefined) throw new Error("Missing first fixture borrow");
      assertReused(firstPersistence, persistence);
      await expect(
        persistence.getDeploymentMetadata("fixture_truncate"),
      ).resolves.toBeNull();
    });
    releaseFirst?.();
    await Promise.all([first, second]);
  }, 30_000);

  it("rebuilds the schemas after a callback failure", async () => {
    const callbackFailure = new Error("injected fixture callback failure");
    let failedPersistence: Persistence | undefined;

    await expect(
      withPersistence(async (persistence) => {
        failedPersistence = persistence;
        await persistence.insertDeploymentMetadata({
          deploymentId: "fixture_rebuild",
          projectId: "project_fixture_rebuild",
        });
        throw callbackFailure;
      }),
    ).rejects.toBe(callbackFailure);

    await withPersistence(async (persistence) => {
      expect(persistence).not.toBe(failedPersistence);
      await expect(
        persistence.getDeploymentMetadata("fixture_rebuild"),
      ).resolves.toBeNull();
    });
  }, 30_000);
}
