import { Effect, Result } from "effect";
import { readPreparedLogicalSchemaCandidate } from "../../../analysis/src/logicalSchemaCandidate";
import { makeSchemaComposer } from "../../src/schemaComposition";
import { createApplicationNativeMutationPGliteFixtureWithPersistence,
  createApplicationNativeMutationPostgresFixture, type ApplicationNativeMutationPGliteFixture,
  type ApplicationNativeMutationPostgresFixture } from
  "../../../persistence-postgres/test/fixtures/applicationNativeMutationTestFixture";
import { createMigratedPGlitePersistence } from "../../../persistence-postgres/test/pgliteTestFixture";
import { createRelationalPGliteFixture } from "../../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createFileScopedPostgresFixture } from "../../../persistence-postgres/test/postgresHelpers";
import { makePGliteFrameworkSchemaArtifactAdmissionFixture } from
  "../../../persistence-postgres/test/frameworkSchemaArtifactAdmissionTestSupport";
import { makeApplicationAnalysisRepository } from "../../../persistence-postgres/src/applicationAnalysisRegistration";
import { makeCatalogControlSessionStarter, startCatalogControlDeadline } from
  "../../../persistence-postgres/src/catalogControlSession";
import { makePostgresCatalogControlSessionDriver } from "../../../persistence-postgres/src/postgresCatalogControlSession";
import { makeLogicalSchemaAdmission } from "../../../persistence-postgres/src/logicalSchemaAdmission";
import { ensureLogicalStorageDefinitions } from "../../../persistence-postgres/src/logicalStorageDefinitions";
import { prepareAppUniqueConstraintSetClosureV1Effect,
  closeAppUniqueConstraintSetV1InTransactionEffect } from
  "../../../persistence-postgres/src/appUniqueConstraintSetClosureV1";
import { reconcilePublishedIndexBuildsV1Effect } from "../../../persistence-postgres/src/indexBuildReconciliation";
import { locateAppIndexDefinitionByIdEffect } from "../../../persistence-postgres/src/appIndexDefinitions";
import { buildAppDeveloperOrderedIndexV1Effect,
  buildIntrinsicCreationTimeIndexV1Effect } from
  "../../../persistence-postgres/src/intrinsicCreationTimeIndexBuildV1";
import { reconcileAppUniqueConstraintSetBuildV1Effect,
  advanceAppUniqueConstraintSetBackfillV1Effect } from
  "../../../persistence-postgres/src/appUniqueConstraintSetBuildV1";
import { runEffectTransaction } from "../../../persistence-postgres/src/effectTransaction";
import type { FlarexMetadataTransaction } from "../../../persistence-postgres/src/metadataTransaction";
import { makeFrameworkSchemaTarget } from "../../../persistence-postgres/src/frameworkSchema/target";
import type { FrameworkSchemaTarget } from "../../../persistence-postgres/src/frameworkSchema/target";
import { makeDataBindingHost, dataBindingActivationRequest } from
  "../../../persistence-postgres/src/frameworkSchema/binding/host";
import { makeCommerceHost } from "../../../persistence-postgres/src/commerceTransaction/host";
import type { LogicalCommerceHostInput } from "../../../persistence-postgres/src/commerceTransaction/host";
import type { CommerceHost } from "../../../persistence-postgres/src/commerceTransaction/commands";
import type { PGliteFlarexPersistence } from "../../../persistence-postgres/src/pglite";
import type { PostgresFlarexPersistence } from "../../../persistence-postgres/src/postgres";
import { makePostgresRelationalSession } from
  "../../../persistence-postgres/src/relationalTransaction/session";
import type { RelationalSession } from "../../../persistence-postgres/src/relationalTransaction/session";
import { preparedHostTestRuntime } from "../../../persistence-postgres/test/preparedHostRuntimeTestSupport";
import { decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { compileCurrencyDefinition } from "../../src/currency-schema";
import { currencyInitialization } from "../../src/currency-contract";
import { compileProductDefinition } from "../../src/product-definition";
import { currencyAnnouncementWrite, currencyCommands, makeCurrencyService } from "../../src/currency-service";

export interface LogicalCurrencyFixture {
  readonly application: ApplicationNativeMutationPGliteFixture | ApplicationNativeMutationPostgresFixture;
  readonly control: PGliteFlarexPersistence | PostgresFlarexPersistence;
  readonly persistence: PGliteFlarexPersistence | PostgresFlarexPersistence;
  readonly deploymentId: string;
  readonly bindingTarget: FrameworkSchemaTarget;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly applicationSource: Readonly<{ sourceKey: string; writeProfile: string; definition: unknown; evidence: unknown }>;
  readonly session: RelationalSession;
  readonly hostInput: LogicalCommerceHostInput<unknown>;
  readonly host: CommerceHost;
  readonly service: ReturnType<typeof makeCurrencyService>;
  readonly initialization: Effect.Success<ReturnType<typeof currencyInitialization>>;
  readonly productDefinition: Effect.Success<ReturnType<typeof compileProductDefinition>> | undefined;
  readonly physicalTablesBeforeCandidate: readonly Readonly<{ name: string }>[];
  readonly observeSql?: (observer: ((text: string) => Promise<void> | void) | undefined) => void;
}

/** Native Currency over the selected shared candidate; no Currency module DDL. */
export async function logicalCurrencyFixture(
  driver: "pglite" | "postgres",
  registerCleanup: (cleanup: () => Promise<void>) => void,
  options?: Readonly<{ includeUserNameIndex?: boolean; payloadCollections?: unknown; includeProduct?: boolean }>,
): Promise<LogicalCurrencyFixture> {
  let observer: ((text: string) => Promise<void> | void) | undefined;
  const pair = driver === "pglite" ? await (async () => {
    const control = await createMigratedPGlitePersistence(registerCleanup);
    const target = await createRelationalPGliteFixture({ registerCleanup, observeQuery: text => observer?.(text) });
    return { kind: "pglite" as const, control, target: target.persistence, session: target.session };
  })() : await (async () => {
      const control = await createFileScopedPostgresFixture();
      registerCleanup(control.dispose);
      const target = await createFileScopedPostgresFixture();
      registerCleanup(target.dispose);
      return { kind: "postgres" as const, control: control.persistence, target: target.persistence };
    })();
  const { control, target } = pair;
  const schemaName = (await target.query<{ schema: string }>("select current_schema() as schema")).rows[0]?.schema;
  if (schemaName === undefined) throw new Error("Missing logical Currency target schema");
  const applicationOptions = { runtimeHostIdentity: "flarex.test/logical-currency", compatibilityDate: "2026-09-20",
    ...(options?.includeUserNameIndex === true ? { includeUserNameIndex: true } : {}),
    physicalLocator: { kind: "database_per_scope" as const, databaseKey: "logical_currency_target", schemaName } };
  const application = pair.kind === "postgres"
    ? await createApplicationNativeMutationPostgresFixture(applicationOptions, { control: pair.control, target: pair.target })
    : await createApplicationNativeMutationPGliteFixtureWithPersistence(applicationOptions, { control: pair.control, target: pair.target });
  const physicalTablesBeforeCandidate = (await target.query<{ name: string }>(
    "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows;
  return Effect.runPromise(Effect.fn("LogicalCurrencyFixture.prepare")(function* () {
    const prepared = yield* makeSchemaComposer({ deploymentId: application.deploymentId,
      authority: application.authority, applicationAnalyses: makeApplicationAnalysisRepository(target.drizzle),
      medusaModules: options?.includeProduct === true ? ["currency", "product"] : ["currency"] })({ applicationCandidateId: application.active.basis.candidateId,
        payloadCollections: options?.payloadCollections ??
          [{ slug: "news", fields: [{ name: "title", type: "text", required: true, unique: true }] }],
        payloadViews: [], extensions: [] });
    const candidate = yield* readPreparedLogicalSchemaCandidate(prepared);
    const nativeApplication = candidate.sources.find(source => source.key === "application");
    if (nativeApplication === undefined) throw new Error("Missing jointly composed Application source");
    const applicationSource = Object.freeze({ sourceKey: nativeApplication.key, writeProfile: nativeApplication.writeProfile,
      definition: nativeApplication.definition, evidence: nativeApplication.evidence });
    const definition = yield* compileCurrencyDefinition();
    const productDefinition = options?.includeProduct === true ? yield* compileProductDefinition() : undefined;
    const initialization = yield* currencyInitialization();
    const schemaVersionId = decodeCatalogSchemaVersionId("live-logical-currency");
    const controlSession = pair.kind === "postgres"
      ? makeCatalogControlSessionStarter({ controlDb: control.drizzle,
        driver: makePostgresCatalogControlSessionDriver(pair.control.pool) })
      : makePGliteFrameworkSchemaArtifactAdmissionFixture(pair.control).controlSessionStarter;
    const admission = makeLogicalSchemaAdmission({ controlDb: control.drizzle, session: controlSession,
      deploymentId: application.deploymentId, scopeId: application.authority.scopeId });
    yield* admission.admit(prepared, { schemaVersionId, version: decodeCatalogSchemaVersion(100) }, {
      initialDeadline: yield* startCatalogControlDeadline("initial", 20_000),
      lockTimeoutMilliseconds: 5000, recoveryTimeoutMilliseconds: 20_000,
    });
    const catalog = yield* runEffectTransaction(work => control.drizzle.transaction(work),
      "Arrange logical Currency catalog", (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
        const definitions = yield* ensureLogicalStorageDefinitions(tx, application.deploymentId, schemaVersionId);
        const closure = yield* prepareAppUniqueConstraintSetClosureV1Effect(tx,
          { deploymentId: application.deploymentId, schemaVersionId });
        yield* closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure);
        return definitions;
      }), cause => new Error("Logical Currency catalog transaction", { cause }));
    const ports = { controlDb: control.drizzle, authority: application.authorityPorts };
    const reconciled = yield* reconcilePublishedIndexBuildsV1Effect(ports,
      { deploymentId: application.deploymentId, schemaVersionId });
    if (reconciled.status !== "reconciled") throw new Error("Incomplete logical Currency indexes");
    for (const indexDefinitionId of reconciled.definitionIds) {
      const index = yield* locateAppIndexDefinitionByIdEffect(control.drizzle,
        application.authority.scopeId, indexDefinitionId);
      if (index === null) throw new Error("Missing logical Currency index definition");
      let enabled = false;
      for (let step = 0; step < 20; step++) {
        const build = index.access.kind === "by_creation_time"
          ? yield* buildIntrinsicCreationTimeIndexV1Effect(ports,
            { deploymentId: application.deploymentId, indexDefinitionId, pageSize: 10 })
          : yield* buildAppDeveloperOrderedIndexV1Effect(ports,
            { deploymentId: application.deploymentId, indexDefinitionId, pageSize: 10 });
        if (build.lifecycle === "enabled") { enabled = true; break; }
      }
      if (!enabled) throw new Error("Logical Currency index did not become ready");
    }
    yield* reconcileAppUniqueConstraintSetBuildV1Effect(ports,
      { deploymentId: application.deploymentId, schemaVersionId });
    let uniqueEnabled = false;
    for (let step = 0; step < 128; step++) {
      const build = yield* advanceAppUniqueConstraintSetBackfillV1Effect(ports,
        { deploymentId: application.deploymentId, schemaVersionId, pageSize: 10 });
      if (build.lifecycle === "enabled" && build.uniqueConstraintDefinitionId === null) { uniqueEnabled = true; break; }
    }
    if (!uniqueEnabled) throw new Error("Logical Currency unique set did not become ready");
    const bindingTarget = yield* makeFrameworkSchemaTarget({ database: target.drizzle,
      deploymentId: application.deploymentId, canonicalPhysicalDatabaseIdentity: "logical-currency-target",
      physicalLocator: application.active.basis.authority.physicalLocator });
    const bindings = yield* makeDataBindingHost({ database: target.drizzle,
      deploymentId: application.deploymentId, target: bindingTarget, authority: application.authorityPorts,
      application: application.activation, logicalStorage: { controlDb: control.drizzle, schemaVersionId,
        unique: application.uniqueConstraintEligibility } });
    const reference = yield* bindings.readApplicationReference();
    const frame = { format: "flarex.data-binding-set" as const, application: reference,
      logicalSchema: { schemaVersionId, manifestSha256: encodeBytesToLowercaseHex(catalog.requirements.artifact.manifestSha256) },
      payloadContent: null, payloadLifecycle: null, commerce: [], crossDomainReferences: [] };
    const bindingCandidate = yield* bindings.prepare(frame);
    yield* bindings.activate(dataBindingActivationRequest(reference.scopeId,
      reference.storageGeneration, "logical-currency-activate", bindingCandidate.sha256, null));
    const session = pair.kind === "postgres" ? makePostgresRelationalSession(pair.target) : pair.session;
    const hostInput = { hostRuntime: preparedHostTestRuntime(target.drizzle), database: target.drizzle,
      session, target: bindingTarget, deploymentId: application.deploymentId,
      authority: application.authorityPorts, application: application.activation,
      identityAndAccessPolicy: { profile: "logical-currency-test" },
      logicalStorage: { ports: { controlDb: control.drizzle, authority: application.authorityPorts },
        unique: application.uniqueConstraintEligibility, schemaVersionId,
        source: { sourceKey: "medusa.currency", writeProfile: "medusa.currency",
          schema: definition.schema, evidence: definition.provenance },
        initialization: { stepId: initialization.stepId, datasetSha256: initialization.datasetSha256,
          expectedRowCount: initialization.expectedRowCount } },
      commands: [...Object.values(currencyCommands), currencyAnnouncementWrite] } satisfies LogicalCommerceHostInput<unknown>;
    const host = yield* makeCommerceHost(hostInput);
    yield* Effect.sync(() => registerCleanup(() => Effect.runPromise(host.close)));
    yield* host.initialize(initialization.rows);
    return { application, control, persistence: target, deploymentId: application.deploymentId, bindingTarget, session,
      hostInput, host, service: makeCurrencyService(host), initialization, schemaVersionId, applicationSource,
      productDefinition, physicalTablesBeforeCandidate,
      ...(pair.kind === "pglite" ? { observeSql: (next: typeof observer) => { observer = next; } } : {}) };
  })());
}
