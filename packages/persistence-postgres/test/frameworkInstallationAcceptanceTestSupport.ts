import { eq } from "drizzle-orm";
import { Effect, Option, Tracer } from "effect";
import { expect } from "vitest";
import type { FlarexMetadataDatabase } from "../src/deployments";
import { captureFrameworkSchemaAvailabilityHead } from "../src/frameworkSchema/installation/canonical";
import {
  initializeFrameworkSchemaAvailabilityHeadInTransactionEffect,
  lockFrameworkSchemaAvailabilityByIdentityInTransactionEffect,
} from "../src/frameworkSchema/installation/availabilityHeadRepository";
import { fxSystemFrameworkSchemaInstallations } from "../src/frameworkSchema/installation/schema";
import { fxSystemFrameworkMigrationPlans } from "../src/migrationCoordination/schema";
import { withFrameworkMigrationPlanVerification } from "../src/migrationCoordination/planVerificationScope";
import { createSuccessfulTerminalPlanValues, storeSuccessfulAvailabilityHistoryGraphInTransaction } from "./frameworkCoordinatorRepositoryTestSupport";
import { runEffect } from "./effectTestRuntime";

export async function createInstallationAcceptanceFixture(database: FlarexMetadataDatabase) {
  const values = await createSuccessfulTerminalPlanValues();
  return database.transaction(async transaction => {
    const graph = await storeSuccessfulAvailabilityHistoryGraphInTransaction(transaction, values);
    const head = await runEffect(captureFrameworkSchemaAvailabilityHead(graph.availabilityHistory.history));
    return runEffect(initializeFrameworkSchemaAvailabilityHeadInTransactionEffect(transaction, graph.availabilityHistory, head));
  });
}

export async function exerciseInstallationAcceptance(database: FlarexMetadataDatabase) {
  const stored = await createInstallationAcceptanceFixture(database);
  const identity = stored.installation.installation.frame.identity;
  let planReads = 0;
  const tracer = Tracer.make({ span(options) {
    // The outer occupant span also exists on cache hits. Loading plan sidecars
    // proves an actual dependency traversal, rather than counting memo lookups.
    if (options.name === "FrameworkMigrationPlanRepository.loadSidecars") planReads++;
    return new Tracer.NativeSpan(options);
  } });
  const accept = () => database.transaction(transaction => runEffect(
    lockFrameworkSchemaAvailabilityByIdentityInTransactionEffect(transaction, identity).pipe(
      withFrameworkMigrationPlanVerification, Effect.provideService(Tracer.Tracer, tracer),
    ),
  ));
  const first = Option.getOrThrow(await accept());
  expect(planReads).toBe(1);
  expect(first.head.sha256).toBe(stored.head.sha256);
  expect(first.installation).toBe(first.readiness.installation);
  expect(first.installation).toBe(first.history.installation);
  const next = Option.getOrThrow(await accept());
  expect(planReads).toBe(2);
  expect(next.installation).not.toBe(first.installation);

  await expect(database.transaction(transaction => runEffect(
    lockFrameworkSchemaAvailabilityByIdentityInTransactionEffect(transaction, {
      ...identity, physicalLocator: { ...identity.physicalLocator, databaseKey: "wrong-placement" },
    }),
  ))).rejects.toMatchObject({ reason: "referenceRefusal" });

  // A successful previous acceptance cannot hide changed ancestor projections.
  const plan = stored.installation.plan;
  await database.update(fxSystemFrameworkMigrationPlans).set({ locatorDatabaseKey: "tampered" })
    .where(eq(fxSystemFrameworkMigrationPlans.planStorageId, plan.storageId));
  await expect(accept()).rejects.toMatchObject({ reason: "storedCorruption" });
  await database.update(fxSystemFrameworkMigrationPlans).set({ locatorDatabaseKey: plan.plan.frame.physicalLocator.databaseKey })
    .where(eq(fxSystemFrameworkMigrationPlans.planStorageId, plan.storageId));
  expect(Option.isSome(await accept())).toBe(true);

  // The natural lookup digest is insufficient: installation bytes remain checked.
  const bytes = new TextEncoder().encode(stored.installation.installation.canonicalJson);
  bytes[0] = 32;
  await database.update(fxSystemFrameworkSchemaInstallations).set({ canonicalBytes: bytes })
    .where(eq(fxSystemFrameworkSchemaInstallations.installationStorageId, stored.installation.storageId));
  await expect(accept()).rejects.toMatchObject({ reason: "storedCorruption" });
}
