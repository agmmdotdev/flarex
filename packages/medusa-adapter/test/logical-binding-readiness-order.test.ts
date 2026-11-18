import { and, asc, eq } from "drizzle-orm";
import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { StorageGenerationFenceSchema } from "flarex-protocol/storage-authority";
import { fxSystemUniqueConstraintBuilds } from "../../persistence-postgres/src/database/schema";
import { lockInstallationForCurrentTransaction } from "../../persistence-postgres/src/installation/installationLifecycle";
import { lockScopeClockForSnapshotReadInTransactionEffect } from "../../persistence-postgres/src/scope/scopeClock";
import { resolveTrustedScopeAuthorityEffect } from "../../persistence-postgres/src/scope/scopeAuthorityResolution";
import { isLocatedAppUniqueConstraintDefinitionV1, locateAppUniqueConstraintDefinitionByIdEffect } from "../../persistence-postgres/src/storage/unique/appUniqueConstraintDefinitions";
import { inspectSelectedAppUniqueConstraintDefinitions } from "../../persistence-postgres/src/storage/unique/appUniqueConstraintSetBuildV1";
import { postgresUrl } from "../../persistence-postgres/test/support/postgresHelpers";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";

describe("current binding unique readiness failure order", () => {
  for (const driver of ["pglite", "postgres"] as const) {
    it.skipIf(driver === "postgres" && postgresUrl === null)(`refuses an earlier unavailable member before later fallback inventory on ${driver}`, async () => {
      const cleanup: Array<() => Promise<void>> = [];
      try {
        const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close));
        const database = fixture.testOwner.drizzle;
        const authority = await Effect.runPromise(resolveTrustedScopeAuthorityEffect(
          fixture.deploymentId, fixture.application.authorityPorts));
        const builds = await database.select().from(fxSystemUniqueConstraintBuilds)
          .where(and(eq(fxSystemUniqueConstraintBuilds.scopeId, authority.scopeId),
            eq(fxSystemUniqueConstraintBuilds.maintenanceAuthorityKind, "binding")))
          .orderBy(asc(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId));
        const first = builds[0], later = builds[1];
        if (first === undefined || later === undefined) throw new Error("Missing two authentic binding unique definitions");
        const firstDefinition = await Effect.runPromise(locateAppUniqueConstraintDefinitionByIdEffect(fixture.control.drizzle,
          fixture.deploymentId, authority.scopeId, fixture.schemaVersionId, first.uniqueConstraintDefinitionId));
        const laterDefinition = await Effect.runPromise(locateAppUniqueConstraintDefinitionByIdEffect(fixture.control.drizzle,
          fixture.deploymentId, authority.scopeId, fixture.schemaVersionId, later.uniqueConstraintDefinitionId));
        if (firstDefinition === null || laterDefinition === null) throw new Error("Missing selected binding catalog definitions");
        const input = { deploymentId: fixture.deploymentId, scopeId: authority.scopeId, schemaVersionId: fixture.schemaVersionId };
        expect(authority.deploymentId).toBe(input.deploymentId);
        for (const definition of [firstDefinition, laterDefinition]) {
          expect(isLocatedAppUniqueConstraintDefinitionV1(definition)).toBe(true);
          expect({ deploymentId: definition.deploymentId, scopeId: definition.scopeId, schemaVersionId: definition.schemaVersionId }).toEqual(input);
        }
        const where = (id: typeof first.uniqueConstraintDefinitionId) => and(
          eq(fxSystemUniqueConstraintBuilds.scopeId, authority.scopeId),
          eq(fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId, id));
        // The later definition genuinely needs the current opening inventory;
        // only its protected mutable marker pair is cleared by the test owner.
        await database.update(fxSystemUniqueConstraintBuilds).set({ maintenanceAuthorityKind: null,
          maintenanceActivationSequence: null }).where(where(later.uniqueConstraintDefinitionId));
        let inventoryQueries = 0;
        let contextQueries = 0;
        let boundary: "inventory" | "context" = "inventory";
        const inspect = () => database.transaction(tx => Effect.runPromise(Effect.gen(function* () {
          yield* lockInstallationForCurrentTransaction(tx);
          const clock = yield* lockScopeClockForSnapshotReadInTransactionEffect(tx, authority.scopeId);
          const original = tx._.session.prepareQuery.bind(tx._.session);
          const preparation = vi.spyOn(tx._.session, "prepareQuery").mockImplementation((query, ...parameters) => {
            if (query.sql.includes("fx_system_data_binding_head")) {
              contextQueries++;
              if (boundary === "context") throw new Error("Later binding context must not mask an earlier refusal");
            }
            if (query.sql.includes("union all") && query.sql.includes("fx_system_index_maintenance_obligation") &&
              query.sql.includes("fx_system_unique_maintenance_obligation")) {
              inventoryQueries++;
              if (boundary === "inventory") throw new Error("Later binding inventory must not mask an earlier refusal");
            }
            return original(query, ...parameters);
          });
          try {
            return yield* Effect.result(inspectSelectedAppUniqueConstraintDefinitions(input,
              [firstDefinition, laterDefinition], tx, authority, clock));
          } finally { preparation.mockRestore(); }
        })));
        const restoreFirst = () => database.insert(fxSystemUniqueConstraintBuilds).values(first)
          .onConflictDoUpdate({ target: [fxSystemUniqueConstraintBuilds.scopeId,
            fxSystemUniqueConstraintBuilds.uniqueConstraintDefinitionId], set: first });
        try {
          for (const failureBoundary of ["inventory", "context"] as const) {
            boundary = failureBoundary;
            for (const unavailable of ["missing", "stale", "declared"] as const) {
              await restoreFirst();
              await database.update(fxSystemUniqueConstraintBuilds).set({ maintenanceAuthorityKind: null,
                maintenanceActivationSequence: null }).where(where(first.uniqueConstraintDefinitionId));
              if (unavailable === "missing") await database.delete(fxSystemUniqueConstraintBuilds).where(where(first.uniqueConstraintDefinitionId));
              else await database.update(fxSystemUniqueConstraintBuilds).set(unavailable === "stale"
                ? { maintenanceAuthorityKind: null, maintenanceActivationSequence: null,
                  storageGenerationFence: StorageGenerationFenceSchema.make(first.storageGenerationFence + 1n) }
                : { maintenanceAuthorityKind: null, maintenanceActivationSequence: null,
                  lifecycle: "declared", coveredThroughCommitSeq: null }).where(where(first.uniqueConstraintDefinitionId));
              inventoryQueries = 0;
              contextQueries = 0;
              expect(await inspect()).toMatchObject({ _tag: "Success", success: { status: "not_ready",
                reason: unavailable === "missing" ? "buildMissing" : unavailable === "stale" ? "buildStale" : "buildNotEnabled" } });
              expect(inventoryQueries).toBe(0);
              expect(contextQueries).toBe(0);
            }
            // A healthy earlier member reaches the later demand. This positive
            // control proves the failing interception is active on real SQL.
            await restoreFirst();
            inventoryQueries = 0;
            contextQueries = 0;
            expect(await inspect()).toMatchObject({ _tag: "Failure", failure: {
              _tag: "AppUniqueConstraintSetBuildIntegrationV1Error", phase: "targetTransaction" } });
            expect(failureBoundary === "inventory" ? inventoryQueries : contextQueries).toBe(1);
          }
        } finally {
          await restoreFirst();
          await database.update(fxSystemUniqueConstraintBuilds).set(later).where(where(later.uniqueConstraintDefinitionId));
        }
      } finally { for (const close of cleanup.reverse()) await close(); }
    }, 180_000);
  }
});
