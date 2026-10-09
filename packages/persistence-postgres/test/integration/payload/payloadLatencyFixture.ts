import { Effect, Result, Scope } from "effect";
import { compilePayloadCollections } from "../../../../payload-adapter/src/collections";
import { makePayloadRuntime } from "../../../../payload-adapter/src/runtime";
import type { PostgresFlarexPersistence } from "../../../src/database/postgres";
import { makePostgresRelationalSession } from "../../../src/database/relationalTransaction/session";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from "../../../src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import { createAppDeveloperIndexDefinitionPortV1 } from "../../../src/storage/indexes/appDeveloperIndexCommitV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../../../src/storage/unique/appUniqueConstraintCommitV1";
import { createAppSchemaCandidateWriteGuardPort } from "../../../src/storage/catalog/appSchemaCandidateValidation";
import { dataBindingActivationRequest } from "../../../src/installation/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../../../src/installation/frameworkSchema/binding/selection";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { cmsHostFixture } from "../../frameworks/cmsTransaction/cmsHostFixture";
import { installPayloadPreferenceFixture } from "../../frameworks/payloadPreferences/payloadPreferenceFixture";
import { installationBindingReference } from "../../installation/frameworkSchema/frameworkDataBindingPhysicalTestSupport";
import { runEffect } from "../../support/effectTestRuntime";
import { createActivationServingFileScopedPostgresFixture, createCoLocatedReadInstallationFixture,
  createFileScopedPostgresFixture, createProtectedFileScopedPostgresFixture, type PostgresFixtureEndpoints } from "../../support/postgresHelpers";
import { getCoLocatedReadInstallationReferencesResult } from "../../../src/installation/installationLifecycle";
import { prepareProtectedMetadata } from "../../../src/execution/preparation/preparedMetadataEpoch";
import { createPostgresLocatedPointMutationSessionActivationTargetV1 } from "../../../src/database/postgres";
import { isLocatedReadCommittedAttemptTargetV1 } from "../../../src/execution/transactionSessionAttemptKernel";
import { composeRelationReadinessFixtureRuntime } from "../../application/relations/applicationRelationReadinessFixture";
import { makeFrameworkSchemaTarget } from "../../../src/installation/frameworkSchema/target";
import type { SplitScopePhysicalLocator } from "../../../src/scope/scopeMetadataTypes";

/** Fixture ownership is separate from the actual serving login. All pools use
 * the original installation helpers and the caller's resource lifetime. */
export async function createProtectedPayloadLatencyResource(
  owner: Awaited<ReturnType<typeof createFileScopedPostgresFixture>>, endpoints?: PostgresFixtureEndpoints,
) {
  const controlOwner = await createFileScopedPostgresFixture({}, {}, "ordinary", endpoints);
  let control: Awaited<ReturnType<typeof createProtectedFileScopedPostgresFixture>> | undefined;
  let target: Awaited<ReturnType<typeof createActivationServingFileScopedPostgresFixture>> | undefined;
  let closed = false;
  const dispose = async () => {
    if (closed) return;
    closed = true;
    const failures: unknown[] = [];
    for (const resource of [target, control, controlOwner]) {
      if (resource === undefined) continue;
      try { await resource.dispose(); } catch (cause) { failures.push(cause); }
    }
    if (failures.length > 0) throw new AggregateError(failures, "Protected Payload fixture cleanup failed");
  };
  try {
    const compiled = await runEffect(compilePayloadLatencyCollections());
    // Complete structural preference installation before publishing the actual
    // runtime policies or minting any installation/pair preparations.
    const setup = await preparePayloadLatencySetup(owner.persistence, compiled, controlOwner.persistence);
    control = await createProtectedFileScopedPostgresFixture("managed", controlOwner, "ordinary", endpoints);
    target = await createActivationServingFileScopedPostgresFixture(owner, "ordinary", endpoints);
    const pair = await createCoLocatedReadInstallationFixture({ target: target.serving, control, controlOwner });
    const refs = Result.getOrThrow(getCoLocatedReadInstallationReferencesResult(pair.installation, target.serving.persistence.drizzle));
    const controlProtection = await runEffect(prepareProtectedMetadata(target.serving.persistence.drizzle, refs.controlInstallation));
    const session = makePostgresRelationalSession(target.serving.persistence, undefined,
      { kind: "managed", installation: target.serving.installation, coLocated: pair.installation });
    return { owner, controlOwner, control, target, pair, controlProtection, compiled, setup,
      persistence: target.serving.persistence, session, dispose,
      installationTiming: { ...target.installationTiming, coLocatedSetupMs: pair.installationTiming.coLocatedSetupMs } };
  } catch (cause) {
    try { await dispose(); } catch (cleanupCause) { throw new AggregateError([cause, cleanupCause], "Protected Payload fixture setup failed"); }
    throw cause;
  }
}
export type ProtectedPayloadLatencyResource = Awaited<ReturnType<typeof createProtectedPayloadLatencyResource>>;

/** Shared standalone benchmark composition. Payload Local API and CMS authority
 * remain with their native runtime and host; this module only installs fixtures. */
export const compilePayloadLatencyCollections = () => compilePayloadCollections([
  { slug: "news-items", fields: [{ name: "headline", type: "text", required: true, unique: true },
    { name: "score", type: "number", required: true, defaultValue: 0 }] },
  { slug: "authors", fields: [{ name: "name", type: "text", required: true }] },
]);

/** Fixture assembly is an explicit Promise test boundary. Rejections retain
 * their original driver error or Effect FiberFailure/Cause; they do not enter
 * Effect.promise and become defects, or pass through a catch-all classifier. */
async function preparePayloadLatencySetup(
  persistence: PostgresFlarexPersistence,
  compiled: Effect.Success<ReturnType<typeof compilePayloadLatencyCollections>>,
  controlPersistence?: PostgresFlarexPersistence,
) {
  const schemaName = (await persistence.query<{ name: string }>(
    "select current_schema() as name")).rows[0]?.name;
  if (schemaName === undefined) throw new Error("Missing fixture namespace");
  const physicalLocator = { kind: "database_per_scope", databaseKey: "application_relation_readiness_fold_target", schemaName } satisfies SplitScopePhysicalLocator;
  const { fixture, target, bindings, reference, candidate } = await cmsHostFixture(persistence,
    { physicalLocator,
      ...(controlPersistence === undefined ? {} : { controlPersistence }) }, compiled);
  const { profile, availability } = await installPayloadPreferenceFixture(persistence, target, fixture.deploymentId);
  const prior = await runEffect(bindings.withCurrent(readAdmittedDataBinding));
  const combined = await runEffect(bindings.prepare({ ...candidate.frame,
    payloadLifecycle: { ...installationBindingReference(availability), profiles: [profile.profile] } }));
  await runEffect(bindings.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration,
    "latency-preferences", combined.sha256, prior.head)));
  return { fixture, target, physicalLocator };
}

export async function preparePayloadLatencyHostInput(
  persistence: PostgresFlarexPersistence,
  compiled: Effect.Success<ReturnType<typeof compilePayloadLatencyCollections>>,
  protectedResource?: ProtectedPayloadLatencyResource,
) {
  if (protectedResource !== undefined && (protectedResource.owner.persistence !== persistence ||
    protectedResource.compiled !== compiled)) throw new Error("Foreign protected Payload fixture preparation");
  const { fixture, target, physicalLocator } = protectedResource?.setup ?? await preparePayloadLatencySetup(persistence, compiled);
  const runtimePersistence = protectedResource?.persistence ?? persistence;
  const runtimeControl = protectedResource?.control.persistence ?? fixture.control;
  const runtimeComposition = protectedResource === undefined ? fixture : (() => {
    const activationTarget = createPostgresLocatedPointMutationSessionActivationTargetV1(
      protectedResource.target.activation.persistence, physicalLocator,
      { directInstallation: protectedResource.target.activation.installation });
    if (!isLocatedReadCommittedAttemptTargetV1(activationTarget)) throw new Error("Missing genuine Payload activation writer target");
    return composeRelationReadinessFixtureRuntime(runtimeControl, runtimePersistence, {
      deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
      physicalLocator, bindingAdmission: true,
      sessionTargetOptions: { managedInstallation: { installation: protectedResource.pair.installation,
        controlProtection: protectedResource.controlProtection } },
      activationProfile: { kind: "installed", installation: protectedResource.target.pair, target: activationTarget },
    });
  })();
  const preferenceTarget = protectedResource === undefined ? target : await runEffect(makeFrameworkSchemaTarget({
    deploymentId: fixture.deploymentId, database: runtimePersistence.drizzle,
    canonicalPhysicalDatabaseIdentity: "cms-host-fixture", physicalLocator }));
  return { hostRuntime: preparedHostTestRuntime(runtimePersistence.drizzle), database: runtimePersistence.drizzle,
    controlDatabase: runtimeControl.drizzle, session: protectedResource?.session ?? makePostgresRelationalSession(persistence),
    deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId, authority: runtimeComposition.authorityPorts,
    application: runtimeComposition.relationActivation, pointCommitAuthority: runtimeComposition.pointCommitAuthority,
    identityAndAccessPolicy: { subject: "payload-latency" }, payloadPreferenceTarget: preferenceTarget,
    materialization: { intrinsicCreationTimeIndexes: createIntrinsicCreationTimeIndexDefinitionPortV1(runtimeControl.drizzle),
      developerIndexes: createAppDeveloperIndexDefinitionPortV1(runtimeControl.drizzle),
      uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(runtimeControl.drizzle),
      candidateSchemaWriteGuard: createAppSchemaCandidateWriteGuardPort({ candidateValidation: runtimeComposition.candidateValidation,
        pointCommitAuthority: runtimeComposition.pointCommitAuthority }) } };
}

/** The caller owns the Scope through runtime use and shutdown. Fixture setup
 * stays outside Effect; native runtime construction/binding retain their
 * precise Effect failures and require that same caller-owned Scope. */
export async function preparePayloadLatencyRuntime(persistence: PostgresFlarexPersistence, scope: Scope.Scope,
  protectedResource?: ProtectedPayloadLatencyResource) {
  const compiled = protectedResource?.compiled ?? await runEffect(compilePayloadLatencyCollections());
  const input = await preparePayloadLatencyHostInput(persistence, compiled, protectedResource);
  return runEffect(Effect.gen(function* () {
    const runtime = yield* makePayloadRuntime(compiled);
    const host = yield* runtime.bind(input);
    return { runtime, host, compiled };
  }).pipe(Effect.provideService(Scope.Scope, scope)));
}
