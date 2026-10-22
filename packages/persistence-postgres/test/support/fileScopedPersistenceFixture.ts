import { afterAll, afterEach, beforeAll, beforeEach, it } from "vitest";

export interface FileScopedPersistenceFixture<Persistence> {
  readonly persistence: Persistence;
  readonly reset: () => Promise<void>;
  readonly dispose: () => Promise<void>;
}

export type WithFileScopedPersistence<Persistence> = (
  run: (persistence: Persistence) => Promise<void>,
) => Promise<void>;

/** Owns the serial borrow queue independently of Vitest hook registration. */
export function createPersistenceFixtureController<Persistence>(
  create: () => Promise<FileScopedPersistenceFixture<Persistence>>,
) {
  let fixture: FileScopedPersistenceFixture<Persistence> | undefined;
  let rebuildRequired = false;
  let settled = Promise.resolve();
  let disposal: Promise<void> | undefined;
  let retirementFailure: { readonly cause: unknown } | undefined;
  const enqueue = <Value>(operation: () => Promise<Value>): Promise<Value> => {
    const current = settled.then(operation);
    settled = current.then(() => undefined, () => undefined);
    return current;
  };

  const prepare = async () => {
    if (retirementFailure !== undefined) throw retirementFailure.cause;
    if (fixture === undefined || rebuildRequired) {
      const staleFixture = fixture;
      if (staleFixture !== undefined) {
        try { await staleFixture.dispose(); }
        catch (cause: unknown) { retirementFailure = { cause }; throw cause; }
      }
      fixture = undefined;
      rebuildRequired = false;
      fixture = await create();
    }
    return fixture;
  };

  const run: WithFileScopedPersistence<Persistence> = async fn => {
    const activeFixture = await prepare();
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

  const borrow: WithFileScopedPersistence<Persistence> = fn => {
    if (disposal !== undefined) return Promise.reject(new Error("Persistence fixture is closing"));
    return enqueue(() => run(fn));
  };
  return {
    prepare: () => disposal === undefined
      ? enqueue(async () => { await prepare(); })
      : Promise.reject(new Error("Persistence fixture is closing")),
    borrow,
    drain: () => settled,
    dispose() {
      disposal ??= enqueue(async () => {
        const current = fixture;
        fixture = undefined;
        if (current !== undefined) await current.dispose();
      });
      return disposal;
    },
  };
}

/** Vitest owns drainage; each driver owns its reset and resource disposal. */
export function useFileScopedPersistence<Persistence>(
  create: () => Promise<FileScopedPersistenceFixture<Persistence>>,
  enabled = true,
): WithFileScopedPersistence<Persistence> {
  const controller = createPersistenceFixtureController(create);
  beforeAll(async () => { if (enabled) await controller.prepare(); }, 120_000);
  afterEach(controller.drain, 120_000);
  afterAll(controller.dispose, 120_000);
  return controller.borrow;
}

let fixtureSequence = 0;

/** Database tests opt in at registration; filtered pure tests never acquire a
 * driver. Preparation keeps the existing 120s hook budget outside the unchanged
 * test-body timeout. An ordinary `it` may still own an independent DDL fixture. */
export function useLazyFileScopedPersistence<Persistence>(
  create: () => Promise<FileScopedPersistenceFixture<Persistence>>,
) {
  const controller = createPersistenceFixtureController(create);
  const fixtureId = `persistence-${fixtureSequence++}`;
  const databaseIt = it.extend<{ persistenceFixture: string }>({
    persistenceFixture: [fixtureId, { auto: true }],
  });
  beforeEach(async ({ task }) => {
    const context = task.context;
    if ("persistenceFixture" in context && context.persistenceFixture === fixtureId) await controller.prepare();
  }, 120_000);
  afterEach(controller.drain, 120_000);
  afterAll(controller.dispose, 120_000);
  return {
    withPersistence: controller.borrow,
    it: databaseIt,
  };
}
