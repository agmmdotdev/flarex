import { expect } from "vitest";
import { Result } from "effect";
import { pgTable, text, jsonb, timestamp, uuid } from "drizzle-orm/pg-core";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { FrameworkSchemaTarget } from "../src/frameworkSchema/target";
import { makeFrameworkMigrationFixtureTarget } from "./frameworkMigrationFixtureTarget";
import { capturePayloadPreferenceProfile } from "../src/payloadPreferences/binding";
import { runFreshFrameworkMigrationCoordinatorEffect } from "../src/migrationCoordination/freshCoordinator";
import { prepareFrameworkSchemaArtifactAdmission, makeFrameworkSchemaArtifactRepository } from "../src/frameworkSchema/artifact/repository";
import { admitFrameworkSchemaArtifactEffect } from "../src/frameworkSchema/artifact/admission";
import { makeFrameworkSchemaArtifactControlSessionStarter } from "../src/frameworkSchema/artifact/controlSession";
import { makePostgresFrameworkSchemaArtifactControlSessionDriver } from "../src/frameworkSchema/artifact/postgresControlSession";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "./frameworkSchemaArtifactAdmissionTestSupport";
import { runEffect } from "./effectTestRuntime";

/** Test orchestration only: all installation and physical naming stay with shared owners. */
export async function installPayloadPreferenceFixture(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  target: FrameworkSchemaTarget, deploymentId: string) {
  const profile = await runEffect(capturePayloadPreferenceProfile(deploymentId));
  const repository = "pool" in persistence ? Result.getOrThrow(makeFrameworkSchemaArtifactRepository({ controlDb: persistence.drizzle,
    controlSessionStarter: makeFrameworkSchemaArtifactControlSessionStarter({ controlDb: persistence.drizzle, driver: makePostgresFrameworkSchemaArtifactControlSessionDriver(persistence.pool) }),
    readTimeoutMilliseconds: 10000, attemptTimeoutMilliseconds: 10000, recoveryTimeoutMilliseconds: 10000, lockTimeoutMilliseconds: 2000 })) : makePGliteFrameworkSchemaArtifactAdmissionFixture(persistence).repository;
  await runEffect(admitFrameworkSchemaArtifactEffect(repository, Result.getOrThrow(prepareFrameworkSchemaArtifactAdmission(profile.artifact))));
  const migrationTarget = await makeFrameworkMigrationFixtureTarget(persistence, target);
  const input = { target: migrationTarget, artifactRepository: repository, artifactIdentity: profile.artifact.identity, attemptId: "preference-install", leaseOwnerId: "preference-test",
    leaseDurationMilliseconds: 120000, lockTimeoutMilliseconds: 5000, statementTimeoutMilliseconds: 30000, maximumStepsPerRun: 16 };
  const ready = await runEffect(runFreshFrameworkMigrationCoordinatorEffect(input));
  if (ready.kind !== "ready") throw new Error(`Preference installation incomplete: ${ready.kind}`);
  const availability = ready.availability;
  expect(availability.installation.admission.admission.frame.admissionProfile).toBe("payload-preferences-fresh");
  expect((await runEffect(runFreshFrameworkMigrationCoordinatorEffect(input))).kind).toBe("ready");
  const physical = availability.installation.plan.plan.physicalLayout.frame.tables[0];
  if (physical === undefined) throw new Error("Missing installed preference table");
  const column = (id: string) => {
    const value = physical.columns.find(column => column.identity.columnId === id);
    if (value === undefined) throw new Error(`Missing preference column ${id}`);
    return value.name;
  };
  // Test-only typed physical fixture; no runtime preference DML port is admitted.
  const table = pgTable(physical.name, { scope: uuid("scope_uuid"), generation: text(column("storage_generation")), id: text(column("id")), key: text(column("key")),
    userCollection: text(column("user_collection")), userId: text(column("user_id")), value: jsonb(column("value")),
    createdAt: timestamp(column("created_at"), { withTimezone: true, mode: "string" }), updatedAt: timestamp(column("updated_at"), { withTimezone: true, mode: "string" }) });
  return { profile, availability, table };
}
