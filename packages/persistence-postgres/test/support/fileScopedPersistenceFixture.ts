import { afterAll, afterEach, beforeAll } from "vitest";

export interface FileScopedPersistenceFixture<Persistence> {
  readonly persistence: Persistence;
  readonly reset: () => Promise<void>;
  readonly dispose: () => Promise<void>;
}

export type WithFileScopedPersistence<Persistence> = (
  run: (persistence: Persistence) => Promise<void>,
) => Promise<void>;

/** Vitest owns drainage; each driver owns its reset and resource disposal. */
export function useFileScopedPersistence<Persistence>(
  create: () => Promise<FileScopedPersistenceFixture<Persistence>>,
  enabled = true,
): WithFileScopedPersistence<Persistence> {
  let fixture: FileScopedPersistenceFixture<Persistence> | undefined;
  let rebuildRequired = false;
  let settled = Promise.resolve();

  beforeAll(async () => {
    if (enabled) fixture = await create();
  }, 120_000);

  afterEach(async () => { await settled; }, 120_000);
  afterAll(async () => {
    await settled;
    const fixtureToDispose = fixture;
    fixture = undefined;
    if (fixtureToDispose !== undefined) await fixtureToDispose.dispose();
  }, 120_000);

  const run: WithFileScopedPersistence<Persistence> = async fn => {
    if (fixture === undefined || rebuildRequired) {
      const staleFixture = fixture;
      fixture = undefined;
      rebuildRequired = false;
      if (staleFixture !== undefined) await staleFixture.dispose();
      fixture = await create();
    }

    const activeFixture = fixture;
    try {
      await fn(activeFixture.persistence);
    } catch (error: unknown) {
      rebuildRequired = true;
      throw error;
    }

    try {
      await activeFixture.reset();
    } catch (error: unknown) {
      rebuildRequired = true;
      throw error;
    }
  };

  return fn => {
    const operation = settled.then(() => run(fn));
    // Drainage stays usable after failure; the caller retains the rejection.
    settled = operation.then(() => undefined, () => undefined);
    return operation.then(() => undefined);
  };
}
