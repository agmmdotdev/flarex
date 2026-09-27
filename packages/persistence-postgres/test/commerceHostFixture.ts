import { preparedHostTestRuntime } from "./preparedHostRuntimeTestSupport";
import { Effect } from "effect";
import { expect } from "vitest";
import type { Json } from "flarex-protocol/json";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import type { RelationalSession } from "../src/relationalTransaction/session";
import type { TrustedScopeAuthorityResolutionPorts } from "../src/scopeAuthorityResolution";
import type { LocatedReadCommittedAttemptTargetV1 } from "../src/transactionSessionAttemptKernel";
import { frameworkSchemaTargetSnapshot, type FrameworkSchemaTargetSnapshot } from "../src/frameworkSchema/target";
import { makeDataBindingHost, dataBindingActivationRequest, type DataBindingHost, type DataBindingHostInput } from "../src/frameworkSchema/binding/host";
import { readAdmittedDataBinding } from "../src/frameworkSchema/binding/selection";
import { makeCommerceHost, makeLocalCommerceHost, type LocalCommerceEventPolicy, type LocalCommerceDelivery, type PhysicalCommerceHostInput } from "../src/commerceTransaction/host";
import type { CommerceCommand, CommerceHost } from "../src/commerceTransaction/commands";
import { requireCommerceProfile, type CommerceProfile, type CommerceProfileState } from "../src/commerceTransaction/profile";
import { cmsHostFixture } from "./cmsHostFixture";
import { installCommerceProfileFixture } from "./commerceProfileInstallationFixture";
import { installationBindingReference } from "./frameworkDataBindingPhysicalTestSupport";
import { makeCommerceBinding } from "../src/commerce";
import type { RestoredFrameworkSchemaAvailabilityHead } from "../src/frameworkSchema/installation/storedMetadataRestoration";
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
  readonly hostInput: PhysicalCommerceHostInput<unknown> & Readonly<{
    authority: TrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  }>;
  readonly prepared: { readonly profile: CommerceProfile; readonly initialization: { readonly rows: Json | undefined } };
  readonly descriptor: CommerceProfileState;
  readonly installation: ReturnType<typeof installationBindingReference>;
  readonly availability: RestoredFrameworkSchemaAvailabilityHead;
  readonly candidate: Effect.Success<ReturnType<DataBindingHost<unknown>["prepare"]>>;
  readonly takeDeliveries: () => readonly LocalCommerceDelivery[];
}

/** Framework-neutral setup. The adapter supplies the actual model's descriptor. */
export async function commerceHostFixture<Failure>(persistence: PGliteFlarexPersistence | PostgresFlarexPersistence, session: RelationalSession,
  prepare: (deploymentId: string, target: { physicalLocator: FrameworkSchemaTargetSnapshot["physicalLocator"]; targetNamespace: FrameworkSchemaTargetSnapshot["namespace"] }) => Effect.Effect<{ profile: CommerceProfile; initialization: { rows: Json | undefined } }, Failure>,
  commands: readonly CommerceCommand[],
  controlPersistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  localPolicy?: (descriptor: CommerceProfileState) => LocalCommerceEventPolicy,
  cmsOptions: Parameters<typeof cmsHostFixture>[1] = {},
  existing?: CommerceHostTestFixture,
): Promise<CommerceHostTestFixture> {
  const schemaName = (await persistence.query<{ name: string }>("select current_schema() as name")).rows[0]?.name;
  if (schemaName === undefined) throw new Error("Missing fixture schema");
  const base = existing?.cms ?? await cmsHostFixture(persistence, { ...cmsOptions, controlPersistence, physicalLocator: { kind: "database_per_scope", databaseKey: "application_relation_readiness_fold_target", schemaName } });
  const snapshot = frameworkSchemaTargetSnapshot(base.target);
  if (snapshot === undefined) throw new Error("Missing authenticated target");
  const prepared = await runEffect(prepare(base.fixture.deploymentId, { physicalLocator: snapshot.physicalLocator, targetNamespace: snapshot.namespace }));
  const descriptor = await runEffect(requireCommerceProfile(prepared.profile));
  const installationStarted = performance.now();
  const availability = await runEffect(installCommerceProfileFixture({ persistence, target: base.target,
    descriptor, profile: prepared.profile, attemptId: "commerce-install", leaseOwnerId: "commerce-test",
    coldProfile: () => prepare(base.fixture.deploymentId,
      { physicalLocator: snapshot.physicalLocator, targetNamespace: snapshot.namespace }).pipe(Effect.map(value => value.profile)) }));
  if (process.env.FLAREX_PRODUCT_TIMINGS === "1") process.stdout.write(JSON.stringify({ installationAndColdOpenMs: Math.round(performance.now() - installationStarted) }) + "\n");
  const installation = installationBindingReference(availability);
  const hostInput = { hostRuntime: preparedHostTestRuntime(persistence.drizzle), database: persistence.drizzle, session, target: base.target, deploymentId: base.fixture.deploymentId,
    scopeId: base.fixture.authority.scopeId,
    authority: base.fixture.authorityPorts, application: base.fixture.relationActivation, profile: prepared.profile, installation,
    identityAndAccessPolicy: { profile: "commerce-test" }, commands };
  const local = localPolicy === undefined ? undefined : await runEffect(makeLocalCommerceHost(hostInput, localPolicy(descriptor)));
  const host = local?.host ?? await runEffect(makeCommerceHost(hostInput));
  const bindingsInput = { database: persistence.drizzle, target: base.target,
    selection: { deploymentId: base.fixture.deploymentId, scopeId: base.fixture.authority.scopeId },
    authority: base.fixture.authorityPorts, application: base.fixture.relationActivation, commerceProfiles: [...existing?.bindingsInput.commerceProfiles ?? [], prepared.profile] };
  const bindings = await runEffect(makeDataBindingHost(bindingsInput));
  const commerce = await runEffect(makeCommerceBinding(availability, [prepared.profile]));
  const frame = existing === undefined ? { ...base.candidate.frame, commerce: [commerce] } :
    { ...existing.candidate.frame, commerce: [...commerceBindings(existing.candidate.frame), commerce]
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
  return { cms: base, persistence, session, bindings, bindingsInput, host, hostInput, prepared, descriptor, installation, availability, candidate,
    takeDeliveries: local?.takeDeliveries ?? (() => []) };
}
