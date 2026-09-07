import { Effect, Result } from "effect";
import { expect } from "vitest";
import type { Json } from "flarex-protocol/json";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { RelationalSession } from "../src/relationalTransaction/session";
import { frameworkMigrationTargetSnapshot, type FrameworkMigrationTargetSnapshot } from "../src/migrationCoordination/targetSession";
import { runFreshFrameworkMigrationCoordinatorEffect } from "../src/migrationCoordination/freshCoordinator";
import { prepareFrameworkSchemaArtifactAdmission, makeFrameworkSchemaArtifactRepository } from "../src/frameworkSchema/artifact/repository";
import { admitFrameworkSchemaArtifactEffect } from "../src/frameworkSchema/artifact/admission";
import { makeFrameworkSchemaArtifactControlSessionStarter } from "../src/frameworkSchema/artifact/controlSession";
import { makePostgresFrameworkSchemaArtifactControlSessionDriver } from "../src/frameworkSchema/artifact/postgresControlSession";
import { makeDataBindingHost, dataBindingActivationRequest, type DataBindingHost, type DataBindingHostInput } from "../src/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../src/frameworkSchema/binding/selection";
import { makeCommerceHost, type CommerceHostInput } from "../src/commerceTransaction/host";
import type { CommerceCommand, CommerceHost } from "../src/commerceTransaction/commands";
import { requireCommerceProfile, type CommerceProfile, type CommerceProfileState } from "../src/commerceTransaction/profile";
import { cmsHostFixture } from "./cmsHostFixture";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "./frameworkSchemaArtifactAdmissionTestSupport";
import { installationBindingReference, bindingProfiles } from "./frameworkDataBindingPhysicalTestSupport";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

export interface CommerceHostTestFixture {
  readonly persistence: PGliteFlarexPersistence | PostgresFlarexPersistence;
  readonly session: RelationalSession;
  readonly bindings: DataBindingHost<unknown>;
  readonly bindingsInput: DataBindingHostInput<unknown>;
  readonly host: CommerceHost;
  readonly hostInput: CommerceHostInput<unknown>;
  readonly prepared: { readonly profile: CommerceProfile; readonly initialization: { readonly rows: Json | undefined } };
  readonly descriptor: CommerceProfileState;
  readonly installation: ReturnType<typeof installationBindingReference>;
  readonly candidate: Effect.Success<ReturnType<DataBindingHost<unknown>["prepare"]>>;
}

/** Framework-neutral setup. The adapter supplies the actual model's descriptor. */
export async function commerceHostFixture<Failure>(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence, session: RelationalSession,
  prepare: (deploymentId: string, target: { physicalLocator: FrameworkMigrationTargetSnapshot["physicalLocator"]; targetNamespace: FrameworkMigrationTargetSnapshot["namespace"] }) => Effect.Effect<{ profile: CommerceProfile; initialization: { rows: Json | undefined } }, Failure>,
  commands: readonly CommerceCommand[],
  controlPersistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
): Promise<CommerceHostTestFixture> {
  const schemaName = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
  if (schemaName === undefined) throw new Error("Missing fixture schema");
  const base = await cmsHostFixture(persistence, { controlPersistence, physicalLocator: { kind: "database_per_scope", databaseKey: "application_relation_readiness_fold_target", schemaName } });
  const snapshot = frameworkMigrationTargetSnapshot(base.target);
  if (snapshot === undefined) throw new Error("Missing authenticated target");
  const prepared = await runEffect(prepare(base.fixture.deploymentId, { physicalLocator: snapshot.physicalLocator, targetNamespace: snapshot.namespace }));
  const descriptor = await runEffect(requireCommerceProfile(prepared.profile));
  const repository = "pool" in persistence ? Result.getOrThrow(makeFrameworkSchemaArtifactRepository({ controlDb: persistence.drizzle,
    controlSessionStarter: makeFrameworkSchemaArtifactControlSessionStarter({ controlDb: persistence.drizzle, driver: makePostgresFrameworkSchemaArtifactControlSessionDriver(persistence.pool) }),
    readTimeoutMilliseconds: 10000, attemptTimeoutMilliseconds: 10000, recoveryTimeoutMilliseconds: 10000, lockTimeoutMilliseconds: 2000 })) : makePGliteFrameworkSchemaArtifactAdmissionFixture(persistence).repository;
  await runEffect(admitFrameworkSchemaArtifactEffect(repository, Result.getOrThrow(prepareFrameworkSchemaArtifactAdmission(descriptor.artifact))));
  const migration = { target: base.target, artifactRepository: repository, artifactIdentity: descriptor.artifact.identity, commerceProfile: prepared.profile,
    attemptId: "commerce-install", leaseOwnerId: "commerce-test", leaseDurationMilliseconds: 120000, lockTimeoutMilliseconds: 5000, statementTimeoutMilliseconds: 30000, maximumStepsPerRun: 16 };
  const ready = await runEffect(runFreshFrameworkMigrationCoordinatorEffect(migration));
  if (ready.kind !== "ready") throw new Error(`Commerce installation incomplete: ${ready.kind}`);
  expect(ready.availability.installation.admission.admission.frame.admissionProfile).toBe("registered-commerce-fresh");
  const coldPrepared = await runEffect(prepare(base.fixture.deploymentId, { physicalLocator: snapshot.physicalLocator, targetNamespace: snapshot.namespace }));
  expect((await runEffect(runFreshFrameworkMigrationCoordinatorEffect({ ...migration, commerceProfile: coldPrepared.profile }))).kind).toBe("ready");
  const installation = installationBindingReference(ready.availability);
  const hostInput = { database: persistence.drizzle, session, target: base.target, deploymentId: base.fixture.deploymentId,
    authority: base.fixture.authorityPorts, application: base.fixture.relationActivation, profile: prepared.profile, installation,
    identityAndAccessPolicy: { profile: "commerce-test" }, commands };
  const host = await runEffect(makeCommerceHost(hostInput));
  const bindingsInput = { database: persistence.drizzle, target: base.target, deploymentId: base.fixture.deploymentId,
    authority: base.fixture.authorityPorts, application: base.fixture.relationActivation, commerceProfile: prepared.profile };
  const bindings = await runEffect(makeDataBindingHost(bindingsInput));
  const commerce = { ...installation, profiles: bindingProfiles(ready.availability).map(profile => ({ ...profile,
    profileId: `${descriptor.profileId}.${profile.kind}`, contractSha256: descriptor.contractSha256 })) };
  const frame = { ...base.candidate.frame, commerce };
  await runEffectFailure(bindings.prepare(frame));
  if (prepared.initialization.rows === undefined) throw new Error("Missing initialization rows");
  const bootstrap = await runEffect(host.initialize(prepared.initialization.rows));
  expect(bootstrap).toEqual({ rowCount: descriptor.initialization.expectedRowCount });
  const prior = await runEffect(base.bindings.withCurrent(readAdmittedDataBinding));
  const candidate = await runEffect(bindings.prepare(frame));
  await runEffect(bindings.activate(dataBindingActivationRequest(base.reference.scopeId, base.reference.storageGeneration, "commerce-activate", candidate.sha256, prior.head)));
  expect(await runEffect(host.initialize(prepared.initialization.rows))).toEqual(bootstrap);
  return { persistence, session, bindings, bindingsInput, host, hostInput, prepared, descriptor, installation, candidate };
}
