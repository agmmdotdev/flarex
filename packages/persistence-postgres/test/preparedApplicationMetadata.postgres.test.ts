import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { validateApplicationBindingBasisInTransaction } from "../src/applicationActivation";
import { closeProtectedMetadataFinalGuardScope, flushProtectedMetadataFinalGuards,
  openProtectedMetadataFinalGuardScope } from "../src/preparedMetadataEpoch";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../src/scopeClock";
import { createApplicationNativeMutationPostgresFixture } from "./fixtures/applicationNativeMutationTestFixture";
import { createFileScopedPostgresFixture, createProtectedFileScopedPostgresFixture,
  postgresUrl } from "./postgresHelpers";
import { runEffect } from "./effectTestRuntime";

const native = postgresUrl !== null && process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL
  ? describe : describe.skip;

native("legacy Application protected metadata admission", () => {
  it("rejects a stale prepared selection and reconstructs it for the next root", async () => {
    const control = await createFileScopedPostgresFixture();
    const target = await createProtectedFileScopedPostgresFixture();
    try {
      const application = await createApplicationNativeMutationPostgresFixture({
        runtimeHostIdentity: "flarex.test/protected-application",
        compatibilityDate: "2026-09-28",
        protectedMetadata: { database: target.persistence.drizzle, token: target.protectedMetadata },
      }, { control: control.persistence, target: target.persistence });
      const verify = async (selection: typeof application.active.selection) =>
        target.persistence.drizzle.transaction(async tx => {
          openProtectedMetadataFinalGuardScope(tx);
          try {
            const clock = await Effect.runPromise(
              lockScopeClockForSnapshotReadInTransactionEffect(tx, application.authority.scopeId));
            const accepted = await Effect.runPromise(
              validateApplicationBindingBasisInTransaction(selection, tx, clock));
            await Effect.runPromise(flushProtectedMetadataFinalGuards(tx));
            return accepted;
          } finally {
            closeProtectedMetadataFinalGuardScope(tx);
          }
        });
      const selected = await runEffect(application.activation.readActive());
      await expect(verify(selected.selection)).resolves.toMatchObject({ kind: "legacy" });
      // Even a zero-row write is a statement-level metadata invalidation.
      await target.persistence.query(
        "update fx_system_application_candidate_v1 set candidate_id = candidate_id where false");
      await expect(verify(selected.selection)).rejects.toMatchObject({ reason: "changed" });
      const refreshed = await runEffect(application.activation.readActive());
      await expect(verify(refreshed.selection)).resolves.toMatchObject({ kind: "legacy" });
    } finally {
      await target.dispose();
      await control.dispose();
    }
  }, 180_000);
});
