import { describe, expect, it } from "vitest";
import { Effect } from "effect";

import { validateApplicationBindingBasisInTransaction } from "../src/applicationActivation";
import { closeProtectedMetadataFinalGuardScope, flushProtectedMetadataFinalGuards,
  openProtectedMetadataFinalGuardScope, prepareProtectedMetadata } from "../src/preparedMetadataEpoch";
import { createPostgresLocatedPointMutationSessionActivationTargetV1 } from "../src/postgres";
import { isLocatedReadCommittedAttemptTargetV1 } from "../src/transactionSessionAttemptKernel";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../src/scopeClock";
import { createApplicationNativeMutationPostgresFixture } from "./fixtures/applicationNativeMutationTestFixture";
import { createFileScopedPostgresFixture, createActivationServingFileScopedPostgresFixture,
  postgresUrl, type ActivationServingFileScopedPostgresFixture } from "./postgresHelpers";
import { runEffect } from "./effectTestRuntime";

const native = postgresUrl !== null && process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL
  ? describe : describe.skip;

native("legacy Application protected metadata admission", () => {
  it("rejects a stale prepared selection and reconstructs it for the next root", async () => {
    const control = await createFileScopedPostgresFixture();
    let dual: ActivationServingFileScopedPostgresFixture | undefined;
    try {
      dual = await createActivationServingFileScopedPostgresFixture();
      const target = dual.serving;
      const physicalLocator = { kind: "database_per_scope", databaseKey: "protected-application",
        schemaName: target.schemaName } as const;
      const activationTarget = createPostgresLocatedPointMutationSessionActivationTargetV1(dual.activation.persistence,
        physicalLocator, { directInstallation: dual.activation.installation });
      if (!isLocatedReadCommittedAttemptTargetV1(activationTarget)) throw new Error("Missing actual installed activation runner");
      // This witness retains serving's complete full-artifact metadata proof.
      // Activation independently admits its genuine restricted installation.
      const protectedMetadata = await Effect.runPromise(prepareProtectedMetadata(target.persistence.drizzle));
      const application = await createApplicationNativeMutationPostgresFixture({
        runtimeHostIdentity: "flarex.test/protected-application",
        compatibilityDate: "2026-09-28",
        physicalLocator,
        activationProfile: { kind: "installed", installation: dual.pair, target: activationTarget },
        protectedMetadata: { database: target.persistence.drizzle, token: protectedMetadata },
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
      await dual?.dispose();
      await control.dispose();
    }
  }, 180_000);
});
