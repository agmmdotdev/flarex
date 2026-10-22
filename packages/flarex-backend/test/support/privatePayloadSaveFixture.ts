import { Effect, Exit, Scope } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { compilePayloadCollections } from "../../../payload-adapter/src/collections";
import { makeSchemaComposer } from "../../../medusa-adapter/src/composition/schema";
import { makeApplicationAnalysisRepository } from "../../../persistence-postgres/src/application/applicationAnalysisRegistration";
import { privatePermissionFixture } from "../../../persistence-postgres/test/application/ownership/privatePermissionFixture";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from "../../../persistence-postgres/test/installation/frameworkSchema/frameworkSchemaArtifactAdmissionTestSupport";
import { startCatalogControlDeadline } from "../../../persistence-postgres/src/database/catalogControlSession";
import { decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { makeLogicalSchemaAdmission } from "../../../persistence-postgres/src/storage/catalog/logicalSchemaAdmission";
import { ensureLogicalStorageDefinitions } from "../../../persistence-postgres/src/storage/catalog/logicalStorageDefinitions";
import { readPreparedLogicalSchemaCandidate } from "../../../analysis/src/logicalSchemaCandidate";
import { prepareAppUniqueConstraintSetClosureV1Effect, closeAppUniqueConstraintSetV1InTransactionEffect } from
  "../../../persistence-postgres/src/storage/unique/appUniqueConstraintSetClosureV1";
import { reconcilePublishedIndexBuildsV1Effect } from "../../../persistence-postgres/src/storage/indexes/indexBuildReconciliation";
import { locateAppIndexDefinitionByIdEffect } from "../../../persistence-postgres/src/storage/indexes/appIndexDefinitions";
import { buildAppDeveloperOrderedIndexV1Effect, buildIntrinsicCreationTimeIndexV1Effect } from
  "../../../persistence-postgres/src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import { reconcileAppUniqueConstraintSetBuildV1Effect, advanceAppUniqueConstraintSetBackfillV1Effect } from
  "../../../persistence-postgres/src/storage/unique/appUniqueConstraintSetBuildV1";
import { resolveLocatedTrustedScopeAuthorityByIdEffect } from "../../../persistence-postgres/src/scope/scopeAuthorityResolution";
import { makeFrameworkSchemaTarget } from "../../../persistence-postgres/src/installation/frameworkSchema/target";
import { makeDataBindingHost, dataBindingActivationRequest } from "../../../persistence-postgres/src/installation/frameworkSchema/binding/host";
import { retainPreparedHost } from "../../../persistence-postgres/src/execution/preparation/preparedHostRuntime";
import { preparedHostTestRuntime } from "../../../persistence-postgres/test/execution/preparation/preparedHostRuntimeTestSupport";
import { prepareCurrentApplicationBinding } from "../../../persistence-postgres/src/application/activation/currentBinding";
import { prepareFiniteApplicationMutationAdmission, prepareFiniteApplicationMutationSourceComposition } from
  "../../../persistence-postgres/src/application/applicationMutationAdmission";
import { prepareLogicalStorageReadiness } from "../../../persistence-postgres/src/storage/catalog/logicalStorageReadiness";
import { prepareLogicalDocumentSourceAdmission } from "../../../persistence-postgres/src/storage/documents/logicalDocuments/documentAdmission";
import { prepareLogicalRelationalAdmission } from "../../../persistence-postgres/src/storage/documents/logicalDocuments/relationalAdmission";
import type { RelationalSession } from "../../../persistence-postgres/src/database/relationalTransaction/session";
import type { PGliteFlarexPersistence } from "../../../persistence-postgres/src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../persistence-postgres/src/database/postgres";
import type { CompiledPayloadCollections } from "../../../payload-adapter/src/collections";
import type { PreparedLogicalSchemaCandidate } from "../../../analysis/src/logicalSchemaCandidate";
import type { FrameworkSchemaTarget } from "../../../persistence-postgres/src/installation/frameworkSchema/target";
import { installPayloadPreferenceFixture } from "../../../persistence-postgres/test/frameworks/payloadPreferences/payloadPreferenceFixture";
import { prepareCmsPreferences } from "../../../persistence-postgres/src/frameworks/payloadPreferences/admission";
import { makePayloadContentProfiles } from "../../../payload-adapter/src/profile";
import { installationBindingReference } from "../../../persistence-postgres/test/installation/frameworkSchema/frameworkDataBindingPhysicalTestSupport";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeLocalProductCommands } from "../../../medusa-adapter/src/modules/product/service";
import { capturePrivateCanonicalValue } from "../../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import type { CurrentApplicationFiniteEntry } from "../../../persistence-postgres/src/application/activation/contracts";
import type { CurrentApplicationPreparationFailure } from "../../../persistence-postgres/src/application/activation/errors";
import type { PreparedHostRuntimeError } from "../../../persistence-postgres/src/execution/preparation/preparedHostRuntime";

type PolicyFixture = Awaited<ReturnType<typeof privatePermissionFixture>>;
type Admit = ReturnType<typeof makeLogicalSchemaAdmission>["admit"];
type OperationProfile = NonNullable<Parameters<Awaited<ReturnType<PolicyFixture["open"]>>["publish"]>[1]>[number];
export interface PrivateSavePreparation {
  readonly preparedAdmission: Effect.Success<ReturnType<typeof prepareFiniteApplicationMutationAdmission>>;
  readonly currentEntry: CurrentApplicationFiniteEntry;
  readonly participants: NonNullable<NonNullable<Parameters<PolicyFixture["open"]>[0]>["participants"]>;
  readonly payloadProfile: (revision: string) => OperationProfile;
  readonly profiles: readonly OperationProfile[];
}
type PreparationFailure = CurrentApplicationPreparationFailure | PreparedHostRuntimeError |
  Effect.Error<ReturnType<typeof prepareLogicalStorageReadiness>> | Effect.Error<ReturnType<typeof prepareCmsPreferences>> |
  Effect.Error<ReturnType<typeof prepareLogicalDocumentSourceAdmission>> | Effect.Error<ReturnType<typeof prepareLogicalRelationalAdmission>> |
  Effect.Error<ReturnType<typeof prepareFiniteApplicationMutationAdmission>> | Effect.Error<ReturnType<typeof prepareFiniteApplicationMutationSourceComposition>>;
export type PrivatePayloadSaveRoot = Awaited<ReturnType<PolicyFixture["open"]>> & {
  readonly payloadProfile: (revision: string) => OperationProfile;
};
export interface PrivatePayloadSaveFixture {
  readonly fixture: PolicyFixture;
  readonly compiled: CompiledPayloadCollections;
  readonly candidate: PreparedLogicalSchemaCandidate;
  readonly authored: Effect.Success<ReturnType<typeof readPreparedLogicalSchemaCandidate>>;
  readonly admit: (candidate: PreparedLogicalSchemaCandidate, identity?: Parameters<Admit>[1]) => ReturnType<Admit>;
  readonly target: FrameworkSchemaTarget;
  readonly open: () => Promise<PrivatePayloadSaveRoot>;
  readonly withPreparation: <A, E, R>(work: (preparation: PrivateSavePreparation) => Effect.Effect<A, E, R>) =>
    Effect.Effect<A, E | PreparationFailure, R>;
  readonly session: RelationalSession;
  readonly productRuntime: Effect.Success<ReturnType<typeof makeLocalProductCommands>>;
  readonly productHost: Effect.Success<ReturnType<typeof makeCommerceHost>>;
  readonly preferences: Awaited<ReturnType<typeof installPayloadPreferenceFixture>>;
  readonly close: () => Promise<void>;
}

export const privateSaveCollections = [{ slug: "posts", fields: [
  { name: "title", type: "text", required: true }, { name: "featuredProduct", type: "text" },
] }];

/** Data/setup only. The existing compilers, catalog/build/binding owners and
 * current-generation issuer perform composition; no authority is fabricated. */
export async function privatePayloadSaveFixture(resources: Readonly<{
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence; session: RelationalSession; control?: PGliteFlarexPersistence;
}>): Promise<PrivatePayloadSaveFixture> {
  const compiled = await Effect.runPromise(compilePayloadCollections(privateSaveCollections));
  const fixture = await privatePermissionFixture(resources.persistence, compiled, resources.control);
  const scope = await Effect.runPromise(Scope.make());
  try {
    const { application } = fixture;
    const { deploymentId, authority, authorityPorts } = application;
    const { control } = fixture;
    const ports = { controlDb: control.drizzle, authority: authorityPorts };
    const location = { deploymentId, scopeId: authority.scopeId, schemaVersionId: decodeCatalogSchemaVersionId("private-save-joint") };
    const compose = makeSchemaComposer({ deploymentId, authority,
      applicationAnalyses: makeApplicationAnalysisRepository(resources.persistence.drizzle), medusaModules: ["product"] });
    const candidate = await Effect.runPromise(compose({ applicationCandidateId: application.publication.candidateId,
      payloadCollections: privateSaveCollections, payloadViews: [], extensions: [{ name: "post_product", sourceKey: "payload",
        source: { table: { namespace: "app", logicalName: "posts" }, field: "featuredProduct" },
        target: { table: { namespace: "medusa", logicalName: "commerce.product/product" }, field: "id" },
        policy: "strongReference", liveness: { source: { kind: "current" }, target: { kind: "softDeleteNull", field: "deleted_at" } },
        onTargetSoftDelete: "retain", onTargetDelete: "restrict" }] }));
    const authored = await Effect.runPromise(readPreparedLogicalSchemaCandidate(candidate));
    const admission = makeLogicalSchemaAdmission({ ...ports,
      session: makePGliteFrameworkSchemaArtifactAdmissionFixture(control).controlSessionStarter, deploymentId, scopeId: authority.scopeId });
    const identity = { schemaVersionId: location.schemaVersionId, version: decodeCatalogSchemaVersion(100) };
    const admit = (selected: typeof candidate, schemaIdentity = identity) => Effect.gen(function* () {
      return yield* admission.admit(selected, schemaIdentity, { initialDeadline: yield* startCatalogControlDeadline("initial", 20_000),
        lockTimeoutMilliseconds: 5_000, recoveryTimeoutMilliseconds: 20_000 });
    });
    await Effect.runPromise(admit(candidate));
    const definitions = await control.drizzle.transaction(tx => Effect.runPromise(Effect.gen(function* () {
        const definitions = yield* ensureLogicalStorageDefinitions(tx, deploymentId, location.schemaVersionId);
        const closure = yield* prepareAppUniqueConstraintSetClosureV1Effect(control.drizzle, { deploymentId, schemaVersionId: location.schemaVersionId }, tx);
        yield* closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure);
        return definitions;
      })));
    const indexes = await Effect.runPromise(reconcilePublishedIndexBuildsV1Effect(ports, location));
    if (indexes.status !== "reconciled") throw new Error("Missing joint index declarations");
    for (const indexDefinitionId of indexes.definitionIds) {
      const definition = await Effect.runPromise(locateAppIndexDefinitionByIdEffect(control.drizzle, authority.scopeId, indexDefinitionId));
      if (definition === null) throw new Error("Missing joint index");
      let enabled = false;
      for (let step = 0; step < 20; step++) {
        const input = { deploymentId, scopeId: authority.scopeId, indexDefinitionId, pageSize: 10 };
        const build = definition.access.kind === "by_creation_time" ? await Effect.runPromise(buildIntrinsicCreationTimeIndexV1Effect(ports, input)) :
          await Effect.runPromise(buildAppDeveloperOrderedIndexV1Effect(ports, input));
        if (build.lifecycle === "enabled") {
          enabled = true; break;
        }
      }
      if (!enabled) throw new Error("Joint index did not enable");
    }
    const uniques = await Effect.runPromise(reconcileAppUniqueConstraintSetBuildV1Effect(ports, location));
    if (uniques.status !== "reconciled") throw new Error("Missing joint unique declarations");
    let enabled = false;
    for (let step = 0; step < (uniques.definitionCount + 1) * 4; step++) {
      const build = await Effect.runPromise(advanceAppUniqueConstraintSetBackfillV1Effect(ports, { ...location, pageSize: 16 }));
      if (build.lifecycle === "enabled" && build.uniqueConstraintDefinitionId === null) { enabled = true; break; }
    }
    if (!enabled) throw new Error("Joint unique set did not enable");
    const located = await Effect.runPromise(resolveLocatedTrustedScopeAuthorityByIdEffect({ deploymentId, scopeId: authority.scopeId }, authorityPorts));
    const target = await Effect.runPromise(makeFrameworkSchemaTarget({ database: resources.persistence.drizzle, deploymentId,
      canonicalPhysicalDatabaseIdentity: "private_permissions", physicalLocator: located.authority.physicalLocator }));
    const preferences = await installPayloadPreferenceFixture(resources.persistence, target, deploymentId, control);
    const binding = await Effect.runPromise(makeDataBindingHost({ database: resources.persistence.drizzle, target,
      selection: { deploymentId, scopeId: authority.scopeId }, authority: authorityPorts, application: application.relationActivation,
      payloadProfiles: await Effect.runPromise(makePayloadContentProfiles(compiled)),
      logicalStorage: { controlDb: control.drizzle, schemaVersionId: location.schemaVersionId, unique: application.servingOwners.uniqueConstraintEligibility } }));
    const reference = await Effect.runPromise(binding.readApplicationReference());
    const bound = await Effect.runPromise(binding.prepare({ format: "flarex.data-binding-set", application: reference,
      logicalSchema: { schemaVersionId: location.schemaVersionId, manifestSha256: encodeBytesToLowercaseHex(definitions.requirements.artifact.manifestSha256) },
      payloadContent: null, payloadLifecycle: { ...installationBindingReference(preferences.availability), profiles: [preferences.profile.profile] },
      commerce: [], crossDomainReferences: [] }));
    await Effect.runPromise(binding.activate(dataBindingActivationRequest(reference.scopeId, reference.storageGeneration,
      "private-save-joint", bound.sha256, null)));
    const productSource = authored.sources.find(source => source.key === "medusa.product");
    if (productSource?.definition.kind !== "relational") throw new Error("Missing real native Product source");
    const productRuntime = await Effect.runPromise(makeLocalProductCommands());
    const initialization = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] },
      1_048_576, { invalidInput: () => new Error("Invalid Product setup dataset"), hashFailure: cause => new Error("Product setup hash", { cause }) }));
    const productHost = await Effect.runPromise(makeCommerceHost({ hostRuntime: preparedHostTestRuntime(resources.persistence.drizzle),
      database: resources.persistence.drizzle, session: resources.session, target, deploymentId, scopeId: authority.scopeId,
      authority: authorityPorts, application: application.relationActivation, identityAndAccessPolicy: { profile: "private-save-product-setup" },
      logicalStorage: { ports, unique: application.servingOwners.uniqueConstraintEligibility, schemaVersionId: location.schemaVersionId,
        source: { sourceKey: productSource.key, writeProfile: productSource.writeProfile, schema: productSource.definition.schema, evidence: productSource.evidence },
        initialization: { stepId: "private-save-product-empty", datasetSha256: initialization.sha256Hex, expectedRowCount: 0 } },
      commands: [productRuntime.commands.internalProductCreate, productRuntime.commands.internalProductRetrieve,
        productRuntime.commands.internalProductSoftDelete, productRuntime.commands.internalProductRestore] }));
    await Effect.runPromise(Scope.addFinalizer(scope, productHost.close));
    await Effect.runPromise(productHost.initialize([]));
    const retained = await Effect.runPromise(Scope.provide(scope)(retainPreparedHost(preparedHostTestRuntime(resources.persistence.drizzle),
      prepareCurrentApplicationBinding(application.relationActivation, resources.persistence.drizzle, original => Effect.gen(function* () {
        const catalog = yield* prepareLogicalStorageReadiness(ports, application.servingOwners.uniqueConstraintEligibility, location, original);
        if (catalog.status !== "prepared") return yield* Effect.die(new Error("Missing prepared joint catalog"));
        const construction = { kind: "prepared" as const, catalog };
        const preparedPreferences = yield* prepareCmsPreferences(resources.persistence.drizzle, resources.session, authorityPorts,
          deploymentId, authority.scopeId, target);
        const payload = yield* prepareLogicalDocumentSourceAdmission(ports, application.servingOwners.uniqueConstraintEligibility,
          location, compiled.sourceContract, construction, preparedPreferences);
        const source = authored.sources.find(source => source.key === "medusa.product");
        if (source?.definition.kind !== "relational") return yield* Effect.die(new Error("Missing real Product source"));
        const product = yield* prepareLogicalRelationalAdmission(ports, application.servingOwners.uniqueConstraintEligibility, location,
          { sourceKey: source.key, writeProfile: source.writeProfile, schema: source.definition.schema, evidence: source.evidence }, construction);
        const preparedAdmission = yield* prepareFiniteApplicationMutationAdmission(application.relationActivation, "functions:write", fixture.context, original);
        yield* prepareFiniteApplicationMutationSourceComposition(preparedAdmission, [payload, product]);
        return { payload, product, preparedAdmission };
      }), { selection: { deploymentId, scopeId: authority.scopeId }, candidateIssuer: application.pointCommitAuthority }))));
    await Effect.runPromise(Scope.addFinalizer(scope, retained.close));
    const withPreparation: PrivatePayloadSaveFixture["withPreparation"] = work => retained.use(current => current.withFiniteEntry((graph, currentEntry) => {
      const payloadProfile = (profileRevision: string): OperationProfile => ({ participant: "payload",
        operationMethods: ["payload-create", "payload-update", "payload-delete"], profileRevision,
        sources: [graph.payload.payload.createCommitAuthority(graph.binding, "payload", ["payload-create", "payload-update", "payload-delete"])] });
      const profiles = [payloadProfile("1".repeat(64)),
        { participant: "medusa.product", operationMethods: ["retrieve"], profileRevision: "2".repeat(64),
          sources: [graph.payload.product.createCommitAuthority(graph.binding, "medusa.product", ["retrieve"])] }];
      return work({ preparedAdmission: graph.payload.preparedAdmission, currentEntry, payloadProfile, profiles,
        participants: [{ participant: "payload", operationMethods: ["payload-create", "payload-update", "payload-delete"], profileRevision: "1".repeat(64),
          sources: [{ selection: graph.payload.payload, methods: ["payload-create", "payload-update", "payload-delete"] }] },
        { participant: "medusa.product", operationMethods: ["retrieve"], profileRevision: "2".repeat(64),
          sources: [{ selection: graph.payload.product, methods: ["retrieve"] }] }] });
    }));
    const open = async () => {
      const result = await Effect.runPromise(withPreparation(preparation =>
      fixture.openEffect({ preparedAdmission: preparation.preparedAdmission, currentEntry: preparation.currentEntry,
        participants: preparation.participants }).pipe(Effect.map(root => {
            const payloadProfile = preparation.payloadProfile;
            const profiles = preparation.profiles;
            return { ...root, payloadProfile, publish: (value: unknown = null, selectedProfiles: Parameters<typeof root.publish>[1] = profiles) =>
              root.publish(value, selectedProfiles) };
          }))));
      return result;
    };
    return { fixture, compiled, candidate, authored, admit, target, open, withPreparation, session: resources.session, productHost, productRuntime, preferences,
      close: async () => { try { await Effect.runPromise(Scope.close(scope, Exit.void)); } finally { await fixture.close(); } } };
  } catch (cause) {
    try { await Effect.runPromise(Scope.close(scope, Exit.void)); } finally { await fixture.close(); }
    throw cause;
  }
}
