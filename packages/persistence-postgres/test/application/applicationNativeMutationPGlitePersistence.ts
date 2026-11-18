import { webcrypto } from "node:crypto";

import {
  useFileScopedPersistence,
  type FileScopedPersistenceFixture,
} from "../support/fileScopedPersistenceFixture";
import { createFileScopedPGliteFixture } from "../support/pgliteTestFixture";
import type { createApplicationNativeMutationPGliteFixtureWithPersistence } from
  "./applicationNativeMutationTestFixture";

export type ApplicationNativeMutationPersistencePair = Parameters<
  typeof createApplicationNativeMutationPGliteFixtureWithPersistence
>[1];

/** Append distinct Application scopes while retaining immutable activation evidence. */
export function useFileScopedApplicationNativeMutationPersistence() {
  return useFileScopedPersistence(createAuthorityPersistencePair, false);
}

async function createAuthorityPersistencePair(): Promise<FileScopedPersistenceFixture<ApplicationNativeMutationPersistencePair>> {
  if (globalThis.crypto === undefined) {
    Object.defineProperty(globalThis, "crypto", {
      configurable: true,
      value: webcrypto,
    });
  }
  const control = await createFileScopedPGliteFixture(async () => async () => {});
  let target: Awaited<ReturnType<typeof createFileScopedPGliteFixture>>;
  try {
    target = await createFileScopedPGliteFixture(async () => async () => {});
  } catch (error: unknown) {
    try { await control.dispose(); }
    catch (cleanupError: unknown) {
      throw new AggregateError([error, cleanupError], "Task authority fixture setup and cleanup failed");
    }
    throw error;
  }
  return {
    persistence: { control: control.persistence, target: target.persistence },
    // Each borrower creates a fresh scope; retain immutable activation evidence.
    reset: async () => {},
    dispose: async () => {
      const settled = await Promise.allSettled([control.dispose(), target.dispose()]);
      const failures: unknown[] = settled.flatMap(result =>
        result.status === "rejected" ? [result.reason] : []);
      if (failures.length === 1) throw failures[0];
      if (failures.length > 1) throw new AggregateError(failures, "Task authority fixture cleanup failed");
    },
  };
}
