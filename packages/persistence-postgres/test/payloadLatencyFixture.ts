import { Effect, Scope } from "effect";
import { compilePayloadCollections } from "../../payload-adapter/src/collections";
import { makePayloadRuntime } from "../../payload-adapter/src/runtime";
import type { PostgresFlarexPersistence } from "../src/postgres";
import { makePostgresRelationalSession } from "../src/relationalTransaction/session";
import { createIntrinsicCreationTimeIndexDefinitionPortV1 } from "../src/intrinsicCreationTimeIndexBuildV1";
import { createAppDeveloperIndexDefinitionPortV1 } from "../src/appDeveloperIndexCommitV1";
import { createAppUniqueConstraintDefinitionPortV1 } from "../src/appUniqueConstraintCommitV1";
import { createAppSchemaCandidateWriteGuardPort } from "../src/appSchemaCandidateValidation";
import { dataBindingActivationRequest } from "../src/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../src/frameworkSchema/binding/selection";
import { preparedHostTestRuntime } from "./preparedHostRuntimeTestSupport";
import { cmsHostFixture } from "./cmsHostFixture";
import { installPayloadPreferenceFixture } from "./payloadPreferenceFixture";
import { installationBindingReference } from "./frameworkDataBindingPhysicalTestSupport";
import { runEffect } from "./effectTestRuntime";

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
export async function preparePayloadLatencyHostInput(
  persistence: PostgresFlarexPersistence,
  compiled: Effect.Success<ReturnType<typeof compilePayloadLatencyCollections>>,
) {
  const schemaName = (await persistence.query<{ name: string }>(
    "select current_schema() as name")).rows[0]?.name;
  if (schemaName === undefined) throw new Error("Missing fixture namespace");
  const { fixture, target, bindings, reference, candidate } = await cmsHostFixture(persistence,
    { physicalLocator: { kind: "database_per_scope", databaseKey: "application_relation_readiness_fold_target", schemaName } }, compiled);
  const { profile, availability } = await installPayloadPreferenceFixture(persistence, target, fixture.deploymentId);
  const prior = await runEffect(bindings.withCurrent(readAdmittedDataBinding));
  const combined = await runEffect(bindings.prepare({ ...candidate.frame,
    payloadLifecycle: { ...installationBindingReference(availability), profiles: [profile.profile] } }));
  await runEffect(bindings.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration,
    "latency-preferences", combined.sha256, prior.head)));
  return { hostRuntime: preparedHostTestRuntime(persistence.drizzle), database: persistence.drizzle,
    controlDatabase: fixture.control.drizzle, session: makePostgresRelationalSession(persistence),
    deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId, authority: fixture.authorityPorts,
    application: fixture.relationActivation, pointCommitAuthority: fixture.pointCommitAuthority,
    identityAndAccessPolicy: { subject: "payload-latency" }, payloadPreferenceTarget: target,
    materialization: { intrinsicCreationTimeIndexes: createIntrinsicCreationTimeIndexDefinitionPortV1(fixture.control.drizzle),
      developerIndexes: createAppDeveloperIndexDefinitionPortV1(fixture.control.drizzle),
      uniqueConstraints: createAppUniqueConstraintDefinitionPortV1(fixture.control.drizzle),
      candidateSchemaWriteGuard: createAppSchemaCandidateWriteGuardPort({ candidateValidation: fixture.candidateValidation,
        pointCommitAuthority: fixture.pointCommitAuthority }) } };
}

/** The caller owns the Scope through runtime use and shutdown. Fixture setup
 * stays outside Effect; native runtime construction/binding retain their
 * precise Effect failures and require that same caller-owned Scope. */
export async function preparePayloadLatencyRuntime(persistence: PostgresFlarexPersistence, scope: Scope.Scope) {
  const compiled = await runEffect(compilePayloadLatencyCollections());
  const input = await preparePayloadLatencyHostInput(persistence, compiled);
  return runEffect(Effect.gen(function* () {
    const runtime = yield* makePayloadRuntime(compiled);
    const host = yield* runtime.bind(input);
    return { runtime, host, compiled };
  }).pipe(Effect.provideService(Scope.Scope, scope)));
}
