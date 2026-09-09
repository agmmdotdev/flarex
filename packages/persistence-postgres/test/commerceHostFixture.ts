import { Effect, Result } from "effect";
import { expect } from "vitest";
import type { Json } from "flarex-protocol/json";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { RelationalSession } from "../src/relationalTransaction/session";
import { frameworkMigrationTargetSnapshot, type FrameworkMigrationTargetSnapshot } from "../src/migrationCoordination/targetSession";
import { runFreshFrameworkMigrationCoordinatorEffect } from "../src/migrationCoordination/freshCoordinator";
import { withFrameworkMigrationPlanVerification } from "../src/migrationCoordination/canonical";
import { prepareFrameworkSchemaArtifactAdmission, makeFrameworkSchemaArtifactRepository } from "../src/frameworkSchema/artifact/repository";
import { admitFrameworkSchemaArtifactEffect } from "../src/frameworkSchema/artifact/admission";
import { makeFrameworkSchemaArtifactControlSessionStarter } from "../src/frameworkSchema/artifact/controlSession";
import { makePostgresFrameworkSchemaArtifactControlSessionDriver } from "../src/frameworkSchema/artifact/postgresControlSession";
import { makeDataBindingHost, dataBindingActivationRequest, type DataBindingHost, type DataBindingHostInput } from "../src/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../src/frameworkSchema/binding/selection";
import { makeCommerceHost, makeLocalCommerceHost, type LocalCommerceEventPolicy, type LocalCommerceDelivery, type CommerceHostInput } from "../src/commerceTransaction/host";
import type { CommerceCommand, CommerceHost } from "../src/commerceTransaction/commands";
import { requireCommerceProfile, type CommerceProfile, type CommerceProfileState } from "../src/commerceTransaction/profile";
import { cmsHostFixture } from "./cmsHostFixture";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "./frameworkSchemaArtifactAdmissionTestSupport";
import { installationBindingReference, bindingProfiles } from "./frameworkDataBindingPhysicalTestSupport";
import { commerceBindings } from "../src/frameworkSchema/binding/model";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { runEffect, runEffectFailure } from "./effectTestRuntime";

export interface CommerceHostTestFixture {
  readonly cms: Awaited<ReturnType<typeof cmsHostFixture>>;
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
  readonly takeDeliveries: () => readonly LocalCommerceDelivery[];
}

/** Framework-neutral setup. The adapter supplies the actual model's descriptor. */
export async function commerceHostFixture<Failure>(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence, session: RelationalSession,
  prepare: (deploymentId: string, target: { physicalLocator: FrameworkMigrationTargetSnapshot["physicalLocator"]; targetNamespace: FrameworkMigrationTargetSnapshot["namespace"] }) => Effect.Effect<{ profile: CommerceProfile; initialization: { rows: Json | undefined } }, Failure>,
  commands: readonly CommerceCommand[],
  controlPersistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  localPolicy?: (descriptor: CommerceProfileState) => LocalCommerceEventPolicy,
  cmsOptions: Parameters<typeof cmsHostFixture>[1] = {},
  existing?: CommerceHostTestFixture,
): Promise<CommerceHostTestFixture> {
  const schemaName = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
  if (schemaName === undefined) throw new Error("Missing fixture schema");
  const base = existing?.cms ?? await cmsHostFixture(persistence, { ...cmsOptions, controlPersistence, physicalLocator: { kind: "database_per_scope", databaseKey: "application_relation_readiness_fold_target", schemaName } });
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
  const installationStarted = performance.now();
  const ready = await runEffect(Effect.gen(function* () {
    const started = performance.now();
    let result = yield* runFreshFrameworkMigrationCoordinatorEffect(migration);
    for (let batch = 1; batch < 8 && result.kind === "pending"; batch++) {
      if (process.env.FLAREX_PRODUCT_TIMINGS === "1") process.stdout.write(JSON.stringify({ batch, elapsedMs: Math.round(performance.now() - started), completed: result.completedStepCount, required: result.requiredStepCount }) + "\n");
      result = yield* runFreshFrameworkMigrationCoordinatorEffect(migration);
    }
    return result;
  // One fixture installation owns pure verification across its bounded batches.
  // SQL rows/heads stay fresh; cold-profile reopening below starts a new scope.
  }).pipe(withFrameworkMigrationPlanVerification, Effect.tap(result => result.kind !== "ready" ? Effect.void : Effect.gen(function* () {
    const coldPrepared = yield* prepare(base.fixture.deploymentId, { physicalLocator: snapshot.physicalLocator, targetNamespace: snapshot.namespace });
    expect((yield* runFreshFrameworkMigrationCoordinatorEffect({ ...migration, commerceProfile: coldPrepared.profile })).kind).toBe("ready");
    if (process.env.FLAREX_PRODUCT_TIMINGS === "1") process.stdout.write(JSON.stringify({ installationAndColdOpenMs: Math.round(performance.now() - installationStarted) }) + "\n");
  })), Effect.timeout(90000)));
  if (ready.kind !== "ready") throw new Error(`Commerce installation incomplete: ${ready.kind}`);
  expect(ready.availability.installation.admission.admission.frame.admissionProfile).toBe("registered-commerce-fresh");
  const installation = installationBindingReference(ready.availability);
  const hostInput = { database: persistence.drizzle, session, target: base.target, deploymentId: base.fixture.deploymentId,
    authority: base.fixture.authorityPorts, application: base.fixture.relationActivation, profile: prepared.profile, installation,
    identityAndAccessPolicy: { profile: "commerce-test" }, commands };
  const local = localPolicy === undefined ? undefined : await runEffect(makeLocalCommerceHost(hostInput, localPolicy(descriptor)));
  const host = local?.host ?? await runEffect(makeCommerceHost(hostInput));
  const bindingsInput = { database: persistence.drizzle, target: base.target, deploymentId: base.fixture.deploymentId,
    authority: base.fixture.authorityPorts, application: base.fixture.relationActivation, commerceProfiles: [...existing?.bindingsInput.commerceProfiles ?? [], prepared.profile] };
  const bindings = await runEffect(makeDataBindingHost(bindingsInput));
  const commerce = { ...installation, profiles: bindingProfiles(ready.availability).map(profile => ({ ...profile,
    profileId: `${descriptor.profileId}.${profile.kind}`, contractSha256: descriptor.contractSha256 })) };
  const frame = existing === undefined ? { ...base.candidate.frame, version: 1 as const, commerce } :
    { ...existing.candidate.frame, version: 2 as const, commerce: [...commerceBindings(existing.candidate.frame), commerce]
      .sort((a, b) => compareUtf16Strings(a.installation.installationSha256, b.installation.installationSha256)) };
  if (descriptor.initialization !== null) {
    await runEffectFailure(bindings.prepare(frame));
    if (prepared.initialization.rows === undefined) throw new Error("Missing initialization rows");
    const bootstrap = await runEffect(host.initialize(prepared.initialization.rows));
    expect(bootstrap).toEqual({ rowCount: descriptor.initialization.expectedRowCount });
    expect(await runEffect(host.initialize(prepared.initialization.rows))).toEqual(bootstrap);
  }
  const prior = await runEffect((existing?.bindings ?? base.bindings).withCurrent(readAdmittedDataBinding));
  const candidate = await runEffect(bindings.prepare(frame));
  await runEffect(bindings.activate(dataBindingActivationRequest(base.reference.scopeId, base.reference.storageGeneration,
    existing === undefined ? "commerce-activate" : `commerce-activate-${descriptor.profileId}`, candidate.sha256, prior.head)));
  return { cms: base, persistence, session, bindings, bindingsInput, host, hostInput, prepared, descriptor, installation, candidate,
    takeDeliveries: local?.takeDeliveries ?? (() => []) };
}
