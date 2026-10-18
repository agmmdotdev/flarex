import type {
  ApplicationActivationTargetProfile,
} from "../../../persistence-postgres/src/application/readiness/contracts";
import {
  createPostgresLocatedPointMutationSessionActivationTargetV1,
} from "../../../persistence-postgres/src/database/postgres";
import type {
  PhysicalSessionObservation,
} from "../../../persistence-postgres/src/database/physicalSession/observation";
import {
  isLocatedReadCommittedAttemptTargetV1,
} from "@flarex/persistence-postgres/internal/system-test/session-kernel";
import { Effect, Result } from "effect";
import {
  prepareLogicalSchemaCandidate,
  readPreparedLogicalSchemaCandidate,
} from "../../../analysis/src/logicalSchemaCandidate";
import {
  prepareLogicalReadMetadataScalingCandidate,
  logicalReadMetadataCounts,
  type LogicalReadMetadataScale,
} from
  "../../../persistence-postgres/test/storage/documents/logicalReadMetadataScalingTestSupport";
import { makeSchemaComposer } from "../../src/composition/schema";
import { createApplicationNativeMutationPGliteFixtureWithPersistence,
  createApplicationNativeMutationPostgresFixture, type ApplicationNativeMutationPGliteFixture,
  type ApplicationNativeMutationPostgresFixture, type ApplicationNativeMutationFixtureOptions } from
  "../../../persistence-postgres/test/application/applicationNativeMutationTestFixture";
import {
  createMigratedPGlitePersistence,
} from "../../../persistence-postgres/test/support/pgliteTestFixture";
import {
  createRelationalPGliteFixture,
} from "../../../persistence-postgres/test/database/relationalPGliteWorkerTestSupport";
import {
  createFileScopedPostgresFixture,
  createProtectedFileScopedPostgresFixture,
  createActivationServingFileScopedPostgresFixture,
  type PostgresFixtureEndpoints,
} from
  "../../../persistence-postgres/test/support/postgresHelpers";
import {
  createCoLocatedReadInstallationFixture,
} from "../../../persistence-postgres/test/support/postgresHelpers";
import type { ProtectedMetadataPreparation } from
  "../../../persistence-postgres/src/execution/preparation/preparedMetadataEpoch";
import {
  loadManagedInstallation,
  getCoLocatedReadInstallationReferences,
  type PreparedInstallation,
  type PreparedCoLocatedReadInstallation,
} from "../../../persistence-postgres/src/installation/installationLifecycle";
import {
  prepareProtectedMetadata,
} from "../../../persistence-postgres/src/execution/preparation/preparedMetadataEpoch";
import type {
  LogicalSourceReadPin,
} from "../../../persistence-postgres/src/storage/catalog/logicalStorageDefinitions";
import {
  makePGliteFrameworkSchemaArtifactAdmissionFixture,
} from
  "../../../persistence-postgres/test/installation/frameworkSchema/frameworkSchemaArtifactAdmissionTestSupport";
import {
  makeApplicationAnalysisRepository,
} from "../../../persistence-postgres/src/application/applicationAnalysisRegistration";
import { makeCatalogControlSessionStarter, startCatalogControlDeadline } from
  "../../../persistence-postgres/src/database/catalogControlSession";
import {
  makePostgresCatalogControlSessionDriver,
} from "../../../persistence-postgres/src/database/postgresCatalogControlSession";
import {
  makeLogicalSchemaAdmission,
} from "../../../persistence-postgres/src/storage/catalog/logicalSchemaAdmission";
import {
  ensureLogicalStorageDefinitions,
} from "../../../persistence-postgres/src/storage/catalog/logicalStorageDefinitions";
import { prepareAppUniqueConstraintSetClosureV1Effect,
  closeAppUniqueConstraintSetV1InTransactionEffect } from
  "../../../persistence-postgres/src/storage/unique/appUniqueConstraintSetClosureV1";
import {
  reconcilePublishedIndexBuildsV1Effect,
} from "../../../persistence-postgres/src/storage/indexes/indexBuildReconciliation";
import {
  locateAppIndexDefinitionByIdEffect,
} from "../../../persistence-postgres/src/storage/indexes/appIndexDefinitions";
import { buildAppDeveloperOrderedIndexV1Effect,
  buildIntrinsicCreationTimeIndexV1Effect } from
  "../../../persistence-postgres/src/storage/indexes/intrinsicCreationTimeIndexBuildV1";
import { reconcileAppUniqueConstraintSetBuildV1Effect,
  advanceAppUniqueConstraintSetBackfillV1Effect } from
  "../../../persistence-postgres/src/storage/unique/appUniqueConstraintSetBuildV1";
import { runEffectTransaction } from "../../../persistence-postgres/src/database/effectTransaction";
import type {
  FlarexMetadataTransaction,
} from "../../../persistence-postgres/src/database/metadataTransaction";
import {
  makeFrameworkSchemaTarget,
} from "../../../persistence-postgres/src/installation/frameworkSchema/target";
import type {
  FrameworkSchemaTarget,
} from "../../../persistence-postgres/src/installation/frameworkSchema/target";
import { makeDataBindingHost, dataBindingActivationRequest } from
  "../../../persistence-postgres/src/installation/frameworkSchema/binding/host";
import { makeCommerceHost } from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import type {
  LogicalCommerceHostInput,
} from "../../../persistence-postgres/src/frameworks/commerceTransaction/host";
import type {
  ExactTrustedScopeAuthorityResolutionPorts,
} from "../../../persistence-postgres/src/scope/scopeAuthorityResolution";
import type {
  LocatedReadCommittedAttemptTargetV1,
} from "@flarex/persistence-postgres/internal/system-test/session-kernel";
import type {
  CommerceHost,
} from "../../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import type { PGliteFlarexPersistence } from "../../../persistence-postgres/src/database/pglite";
import type { PostgresFlarexPersistence } from "../../../persistence-postgres/src/database/postgres";
import { makePostgresRelationalSession } from
  "../../../persistence-postgres/src/database/relationalTransaction/session";
import type {
  RelationalSession,
} from "../../../persistence-postgres/src/database/relationalTransaction/session";
import {
  preparedHostTestRuntime,
} from "../../../persistence-postgres/test/execution/preparation/preparedHostRuntimeTestSupport";
import { decodeCatalogSchemaVersion, decodeCatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type {
  LogicalSchemaExtension,
  LogicalSchemaSource,
} from "flarex-protocol/internal/logical-schema-candidate";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { compileCurrencyDefinition } from "../../src/modules/currency/schema";
import { currencyInitialization } from "../../src/modules/currency/contract";
import { compileProductDefinition } from "../../src/modules/product/definition";
import { compilePricingDefinition } from "../../src/modules/pricing/schema";
import { compileVariantPricingLinkDefinition } from "../../src/composition/product-variant-pricing-schema";
import { compileSalesChannelDefinition } from "../../src/modules/sales-channel/schema";
import { compileStoreDefinition } from "../../src/modules/store/schema";
import { compileProductLinksDefinition } from "../../src/links/product-definition";
import { compileStockLocationDefinition } from "../../src/modules/stock-location/schema";
import { compileSalesChannelLocationLinkDefinition } from "../../src/links/sales-channel-location-schema";
import { compileLocationFulfillmentSetLinkDefinition } from "../../src/links/location-fulfillment-set-schema";
import { compileLocationFulfillmentProviderLinkDefinition } from "../../src/links/location-fulfillment-provider-schema";
import { compileShippingOptionPriceSetLinkDefinition } from "../../src/links/shipping-option-price-set-schema";
import { compileRegionDefinition } from "../../src/modules/region/schema";
import { compileShippingProfileDefinition, compileShippingProfileDeletionDefinition, compileServiceZoneCreationDefinition } from "../../src/modules/fulfillment/shipping-profile-schema";
import {
  currencyAnnouncementWrite,
  currencyCommands,
  makeCurrencyService,
} from "../../src/modules/currency/service";

type LogicalInstallationTiming = Readonly<{ migrationMs: number; managedSetupMs: number;
  coLocatedSetupMs: number; totalInstallationMs: number }>;

export interface LogicalCurrencyPreparationTiming {
  readonly provisionAndMigrateMs: number;
  readonly applicationAndReadInstallationMs: number;
  readonly compositionAndCompilationMs: number;
  readonly logicalAdmissionMs: number;
  readonly indexAndUniqueBuildMs: number;
  readonly bindingAndInitializationMs: number;
}

type LogicalCurrencyResource =
  | Readonly<{ kind: "pglite"; control: PGliteFlarexPersistence; target: PGliteFlarexPersistence;
    testOwner: PGliteFlarexPersistence;
    session: RelationalSession; observeSql: (observer: ((text: string) => Promise<void> | void) | undefined) => void }>
  | Readonly<{ kind: "postgres"; control: PostgresFlarexPersistence; target: PostgresFlarexPersistence;
    testOwner: PostgresFlarexPersistence;
    migrationJournalSchema?: string;
    installationTiming?: LogicalInstallationTiming;
    protectedMetadata?: ProtectedMetadataPreparation;
    activationProfile?: ApplicationActivationTargetProfile;
    managedRead?: Readonly<{ installation: PreparedInstallation; controlInstallation: PreparedInstallation;
      readInstallation?: PreparedCoLocatedReadInstallation;
      control: PostgresFlarexPersistence }> }>;

type FixtureIdentity = Readonly<{ deploymentId: string; projectId: string; uuidOffset: number }>;
type LogicalCurrencyFixtureOptions = Readonly<{
  physicalSessionObservation?: () => PhysicalSessionObservation | undefined;
  postgresEndpoints?: PostgresFixtureEndpoints;
  includeUserNameIndex?: boolean; includeProductLaunch?: boolean;
  initialUserDocuments?: ApplicationNativeMutationFixtureOptions["initialUserDocuments"];
  payloadCollections?: unknown; includeProduct?: boolean; includePricing?: boolean; includeVariantInventory?: boolean;
  extensions?: readonly LogicalSchemaExtension[]; additionalSources?: readonly LogicalSchemaSource[];
  includeVariantPricingLink?: boolean;
  includeSalesChannel?: boolean;
  includeStore?: boolean;
  includeStockLocation?: boolean;
  includeSalesChannelLocationLink?: boolean;
  includeLocationFulfillmentSetLink?: boolean;
  includeLocationFulfillmentProviderLink?: boolean;
  includeShippingOptionPriceSetLink?: boolean;
  includeRegion?: boolean;
  includeProductSalesChannelLink?: boolean;
  includeShippingProfile?: boolean;
  includeShippingProfileDeletion?: boolean;
  includeServiceZoneCreation?: boolean;
  includeProductShippingProfileLink?: boolean;
  protectedRuntime?: boolean;
  managedRead?: boolean;
  finiteStorageCapture?: true;
  readMetadataScale?: LogicalReadMetadataScale;
  applicationAcceptanceScale?: ApplicationNativeMutationFixtureOptions["acceptanceScale"];
  readinessRuntimeHostIdentity?: string;
  includeApplicationTask?: boolean;
}> & (Readonly<{ resource?: never; fixtureIdentity?: FixtureIdentity }>
  | Readonly<{ resource: LogicalCurrencyResource; fixtureIdentity: FixtureIdentity }>);

export interface LogicalCurrencyFixture {
  readonly resource: LogicalCurrencyResource;
  readonly installationTiming: LogicalInstallationTiming | undefined;
  readonly fixtureConstructionMs: number;
  readonly preparationTiming: LogicalCurrencyPreparationTiming;
  readonly application: ApplicationNativeMutationPGliteFixture | ApplicationNativeMutationPostgresFixture;
  readonly control: PGliteFlarexPersistence | PostgresFlarexPersistence;
  readonly persistence: PGliteFlarexPersistence | PostgresFlarexPersistence;
  /** Existing database owner used only for deliberate test corruption/restoration. */
  readonly testOwner: PGliteFlarexPersistence | PostgresFlarexPersistence;
  readonly deploymentId: string;
  readonly bindingTarget: FrameworkSchemaTarget;
  readonly schemaVersionId: CatalogSchemaVersionId;
  readonly applicationSource: Readonly<{ sourceKey: string; writeProfile: string; definition: unknown; evidence: unknown }>;
  readonly sourcePins: readonly LogicalSourceReadPin[];
  readonly managedRead: (NonNullable<Extract<LogicalCurrencyResource, { kind: "postgres" }>["managedRead"]> &
    Readonly<{ readInstallation: PreparedCoLocatedReadInstallation }>) | undefined;
  readonly session: RelationalSession;
  readonly hostInput: LogicalCommerceHostInput<unknown> & Readonly<{
    authority: ExactTrustedScopeAuthorityResolutionPorts<LocatedReadCommittedAttemptTargetV1>;
  }>;
  readonly host: CommerceHost;
  readonly service: ReturnType<typeof makeCurrencyService>;
  readonly initialization: Effect.Success<ReturnType<typeof currencyInitialization>>;
  readonly currencyDefinition: Effect.Success<ReturnType<typeof compileCurrencyDefinition>>;
  readonly productDefinition: Effect.Success<ReturnType<typeof compileProductDefinition>> | undefined;
  readonly productLogicalSource: Readonly<{ schema: NonNullable<LogicalCurrencyFixture["productDefinition"]>["schema"];
    evidence: unknown }> | undefined;
  readonly metadataScaling: Omit<Effect.Success<ReturnType<typeof prepareLogicalReadMetadataScalingCandidate>>, "prepared"> | undefined;
  readonly metadataCounts: ReturnType<typeof logicalReadMetadataCounts>;
  readonly pricingDefinition: Effect.Success<ReturnType<typeof compilePricingDefinition>> | undefined;
  readonly variantPricingLinkDefinition: Effect.Success<ReturnType<typeof compileVariantPricingLinkDefinition>> | undefined;
  readonly salesChannelDefinition: Effect.Success<ReturnType<typeof compileSalesChannelDefinition>> | undefined;
  readonly storeDefinition: Effect.Success<ReturnType<typeof compileStoreDefinition>> | undefined;
  readonly stockLocationDefinition: Effect.Success<ReturnType<typeof compileStockLocationDefinition>> | undefined;
  readonly salesChannelLocationLinkDefinition: Effect.Success<ReturnType<typeof compileSalesChannelLocationLinkDefinition>> | undefined;
  readonly locationFulfillmentSetLinkDefinition: Effect.Success<ReturnType<typeof compileLocationFulfillmentSetLinkDefinition>> | undefined;
  readonly locationFulfillmentProviderLinkDefinition: Effect.Success<ReturnType<typeof compileLocationFulfillmentProviderLinkDefinition>> | undefined;
  readonly shippingOptionPriceSetLinkDefinition: Effect.Success<ReturnType<typeof compileShippingOptionPriceSetLinkDefinition>> | undefined;
  readonly regionDefinition: Effect.Success<ReturnType<typeof compileRegionDefinition>> | undefined;
  readonly productLinksDefinition: Effect.Success<ReturnType<typeof compileProductLinksDefinition>> | undefined;
  readonly shippingProfileDefinition: Effect.Success<ReturnType<typeof compileShippingProfileDefinition>> | undefined;
  readonly physicalTablesBeforeCandidate: readonly Readonly<{ name: string }>[];
  readonly observeSql?: (observer: ((text: string) => Promise<void> | void) | undefined) => void;
}

/** Native Currency over the selected shared candidate; no Currency module DDL. */
export async function logicalCurrencyFixture(
  driver: "pglite" | "postgres",
  registerCleanup: (cleanup: () => Promise<void>) => void,
  options?: LogicalCurrencyFixtureOptions,
): Promise<LogicalCurrencyFixture> {
  const fixtureStarted = performance.now();
  let observer: ((text: string) => Promise<void> | void) | undefined;
  let activationResources: Awaited<ReturnType<typeof createActivationServingFileScopedPostgresFixture>> | undefined;
  let prepareReadInstallation: (() => Promise<Readonly<{ readInstallation: PreparedCoLocatedReadInstallation;
    controlInstallation: PreparedInstallation; coLocatedSetupMs: number }>>) | undefined;
  if (options?.resource !== undefined && options.fixtureIdentity === undefined)
    throw new Error("A shared logical Currency resource requires a distinct fixture identity");
  if (options?.resource !== undefined && options.resource.kind !== driver)
    throw new Error("Logical Currency resource driver mismatch");
  if (options?.managedRead === true && driver !== "postgres")
    throw new Error("Managed logical Currency reads require PostgreSQL");
  if (options?.postgresEndpoints !== undefined && driver !== "postgres")
    throw new Error("Explicit PostgreSQL fixture endpoints require PostgreSQL");
  const pair: LogicalCurrencyResource = options?.resource ?? (driver === "pglite" ? await (async () => {
    const control = await createMigratedPGlitePersistence(registerCleanup);
    const target = await createRelationalPGliteFixture({ registerCleanup, observeQuery: text => observer?.(text), immutableCatalog: control.drizzle,
      transport: options?.finiteStorageCapture === true ? "finiteCapture" : "ordinary" });
    return { kind: "pglite" as const, control, target: target.persistence, testOwner: target.persistence, session: target.session,
      observeSql: (next: typeof observer) => { observer = next; } };
  })() : await (async () => {
      // Base migration installs database-wide extensions. Complete the first
      // installation before the second schema migrates in a fresh database.
      const control = await createFileScopedPostgresFixture({}, {}, "ordinary", options?.postgresEndpoints);
      registerCleanup(control.dispose);
      const targetOwner = await createFileScopedPostgresFixture({}, { immutableCatalog: control.persistence.drizzle },
        options?.finiteStorageCapture === true ? "finiteCapture" : "ordinary", options?.postgresEndpoints);
      registerCleanup(targetOwner.dispose);
      const target = await (options?.protectedRuntime === true || options?.managedRead === true
          ? createActivationServingFileScopedPostgresFixture(targetOwner,
            options?.finiteStorageCapture === true ? "finiteCapture" : "ordinary", options?.postgresEndpoints).then(resource => {
              activationResources = resource;
              registerCleanup(resource.dispose);
              return resource.serving;
            })
          : Promise.resolve(targetOwner));
      const managedControl = options?.managedRead === true
        ? await createProtectedFileScopedPostgresFixture("managed", control, "ordinary", options?.postgresEndpoints) : undefined;
      if (managedControl !== undefined) registerCleanup(managedControl.dispose);
      let managedRead: Extract<LogicalCurrencyResource, { kind: "postgres" }>["managedRead"];
      if (options?.managedRead === true) {
        if (!("installation" in target) || target.installation === undefined || managedControl?.installation === undefined)
          throw new Error("Missing logical Currency managed installation");
        managedRead = { installation: target.installation, controlInstallation: managedControl.installation,
          control: managedControl.persistence };
        prepareReadInstallation = async () => {
          const prepared = await createCoLocatedReadInstallationFixture({ target,
            control: managedControl, controlOwner: control });
          const controlInstallation = await Effect.runPromise(loadManagedInstallation(managedControl.persistence.drizzle,
            "protected-postgres-fixture", control.schemaName));
          return { readInstallation: prepared.installation, controlInstallation,
            coLocatedSetupMs: prepared.installationTiming.coLocatedSetupMs };
        };
      }
      const migrations = new Set([control.installationTiming.baseMigration, target.installationTiming.baseMigration,
        ...(managedControl === undefined ? [] : [managedControl.installationTiming.baseMigration])]);
      const migrationMs = [...migrations].reduce((total, receipt) => total + receipt.migrationMs, 0);
      const managedSetupMs = ("installation" in target ? target.installationTiming.managedSetupMs : 0)
        + (managedControl?.installationTiming.managedSetupMs ?? 0);
      const installationTiming = Object.freeze({ migrationMs, managedSetupMs, coLocatedSetupMs: 0,
        totalInstallationMs: migrationMs + managedSetupMs });
      const activationProfile = activationResources === undefined ? undefined : (() => {
        const activationTarget = createPostgresLocatedPointMutationSessionActivationTargetV1(activationResources.activation.persistence,
          { kind: "database_per_scope", databaseKey: "logical_currency_target", schemaName: target.schemaName },
          { directInstallation: activationResources.activation.installation,
            ...(options?.physicalSessionObservation === undefined ? {} : { physicalSessionObservation: options.physicalSessionObservation }) });
        if (!isLocatedReadCommittedAttemptTargetV1(activationTarget)) throw new Error("Missing genuine activation runner");
        return { kind: "installed" as const, installation: activationResources.pair, target: activationTarget };
      })();
      return { kind: "postgres" as const, control: control.persistence, target: target.persistence,
        testOwner: activationResources === undefined ? target.persistence : activationResources.owner.persistence,
        migrationJournalSchema: targetOwner.migrationsSchema,
        installationTiming,
        ...(managedRead === undefined ? {} : { managedRead }),
        ...(activationProfile === undefined ? {} : { activationProfile }),
        ...("protectedMetadata" in target ? { protectedMetadata: target.protectedMetadata } : {}) };
    })());
  const provisionAndMigrateMs = performance.now() - fixtureStarted;
  const applicationStarted = performance.now();
  if (options?.managedRead === true && (pair.kind !== "postgres" || pair.managedRead === undefined))
    throw new Error("A managed logical Currency resource requires protected target and control installations");
  const { control, target } = pair;
  const managedInstallationSetup = pair.kind !== "postgres" || pair.managedRead === undefined ? undefined :
    pair.managedRead.readInstallation !== undefined ? { readInstallation: pair.managedRead.readInstallation,
      controlInstallation: pair.managedRead.controlInstallation, coLocatedSetupMs: 0 } :
      prepareReadInstallation === undefined ? undefined : await prepareReadInstallation();
  if (pair.kind === "postgres" && pair.managedRead !== undefined && managedInstallationSetup === undefined)
    throw new Error("A managed resource requires its authenticated composite installation before target construction");
  const managedControlProtection = managedInstallationSetup === undefined ? undefined : await Effect.runPromise(
    getCoLocatedReadInstallationReferences(managedInstallationSetup.readInstallation, target.drizzle).pipe(
      Effect.flatMap(refs => prepareProtectedMetadata(target.drizzle, refs.controlInstallation))));
  const schemaName = (await target.query<{ schema: string }>("select current_schema() as schema")).rows[0]?.schema;
  if (schemaName === undefined) throw new Error("Missing logical Currency target schema");
  const applicationProtection = pair.kind !== "postgres" ? undefined :
    pair.activationProfile?.kind === "installed" && pair.managedRead === undefined
      ? await Effect.runPromise(prepareProtectedMetadata(target.drizzle)) : pair.protectedMetadata;
  const applicationOptions = {
    ...(options?.physicalSessionObservation === undefined ? {} : { physicalSessionObservation: options.physicalSessionObservation }),
    ...(pair.kind === "postgres" && pair.activationProfile !== undefined ? { activationProfile: pair.activationProfile } : {}),
    runtimeHostIdentity: options?.readinessRuntimeHostIdentity ?? "flarex.test/logical-currency", compatibilityDate: "2026-09-20",
    ...(managedInstallationSetup === undefined || managedControlProtection === undefined ? {} :
      { managedInstallation: { installation: managedInstallationSetup.readInstallation, controlProtection: managedControlProtection } }),
    ...(options?.applicationAcceptanceScale === undefined ? {} : { acceptanceScale: options.applicationAcceptanceScale }),
    ...(options?.includeApplicationTask === undefined ? {} : { includeTask: options.includeApplicationTask }),
    ...(options?.includeUserNameIndex === true ? { includeUserNameIndex: true } : {}),
    ...(options?.initialUserDocuments === undefined ? {} : { initialUserDocuments: options.initialUserDocuments }),
    ...(options?.includeProductLaunch === true ? { includeProductLaunch: true } : {}),
    ...(options?.fixtureIdentity === undefined ? {} : { fixtureIdentity: options.fixtureIdentity }),
    ...(pair.kind === "postgres" && applicationProtection !== undefined
      ? { protectedMetadata: { database: target.drizzle, token: applicationProtection } } : {}),
    physicalLocator: { kind: "database_per_scope" as const, databaseKey: "logical_currency_target", schemaName } };
  const application = pair.kind === "postgres"
    ? await createApplicationNativeMutationPostgresFixture(applicationOptions, { control: pair.control, target: pair.target })
    : await createApplicationNativeMutationPGliteFixtureWithPersistence(applicationOptions, { control: pair.control, target: pair.target });
  const physicalTablesBeforeCandidate = (await target.query<{ name: string }>(
    "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows;
  const applicationAndReadInstallationMs = performance.now() - applicationStarted;
  return Effect.runPromise(Effect.fn("LogicalCurrencyFixture.prepare")(function* () {
    const compositionStarted = performance.now();
    const composed = yield* makeSchemaComposer({ deploymentId: application.deploymentId,
      authority: application.authority, applicationAnalyses: makeApplicationAnalysisRepository(target.drizzle),
      medusaModules: ["currency", ...(options?.includeProduct === true ? ["product" as const] : []),
        ...(options?.includePricing === true ? ["pricing" as const] : []),
        ...(options?.includeVariantInventory === true ? ["inventory" as const, "stockLocation" as const, "variantLinks" as const] : []),
        ...(options?.includeStockLocation === true && options?.includeVariantInventory !== true ? ["stockLocation" as const] : []),
        ...(options?.includeVariantPricingLink === true ? ["variantPricingLink" as const] : []),
        ...(options?.includeSalesChannel === true ? ["salesChannel" as const] : []),
        ...(options?.includeStore === true ? ["store" as const] : []),
        ...(options?.includeSalesChannelLocationLink === true ? ["salesChannelLocationLink" as const] : []),
        ...(options?.includeLocationFulfillmentSetLink === true ? ["locationFulfillmentSetLink" as const] : []),
        ...(options?.includeLocationFulfillmentProviderLink === true ? ["locationFulfillmentProviderLink" as const] : []),
        ...(options?.includeShippingOptionPriceSetLink === true ? ["shippingOptionPriceSetLink" as const] : []),
        ...(options?.includeRegion === true ? ["region" as const] : []),
        ...(options?.includeProductSalesChannelLink === true ? ["productSalesChannelLink" as const] : []),
        ...(options?.includeShippingProfile === true ? ["shippingProfile" as const] : []),
        ...(options?.includeShippingProfileDeletion === true ? ["shippingProfileDeletion" as const] : []),
        ...(options?.includeServiceZoneCreation === true ? ["serviceZoneCreation" as const] : []),
        ...(options?.includeProductShippingProfileLink === true ? ["productShippingProfileLink" as const] : [])] })({ applicationCandidateId: application.active.basis.candidateId,
        payloadCollections: options?.payloadCollections ??
          [{ slug: "news", fields: [{ name: "title", type: "text", required: true, unique: true }] }],
        payloadViews: [], extensions: [...(options?.extensions ?? [])] });
    const baseCandidate = yield* readPreparedLogicalSchemaCandidate(composed);
    const withAdditionalSources = options?.additionalSources?.length
      ? yield* prepareLogicalSchemaCandidate({ ...baseCandidate,
        sources: [...baseCandidate.sources, ...options.additionalSources] })
      : composed;
    const metadataScaling = options?.readMetadataScale === undefined ? undefined
      : yield* prepareLogicalReadMetadataScalingCandidate(
        yield* readPreparedLogicalSchemaCandidate(withAdditionalSources), options.readMetadataScale);
    const prepared = metadataScaling?.prepared ?? withAdditionalSources;
    const candidate = yield* readPreparedLogicalSchemaCandidate(prepared);
    const nativeApplication = candidate.sources.find(source => source.key === "application");
    if (nativeApplication === undefined) throw new Error("Missing jointly composed Application source");
    const applicationSource = Object.freeze({ sourceKey: nativeApplication.key, writeProfile: nativeApplication.writeProfile,
      definition: nativeApplication.definition, evidence: nativeApplication.evidence });
    const definition = yield* compileCurrencyDefinition();
    const productDefinition = options?.includeProduct === true ? yield* compileProductDefinition() : undefined;
    const productSource = candidate.sources.find(source => source.key === "medusa.product");
    const productLogicalSource = productSource?.definition.kind === "relational"
      ? { schema: productSource.definition.schema, evidence: productSource.evidence } : undefined;
    const pricingDefinition = options?.includePricing === true ? yield* compilePricingDefinition() : undefined;
    const variantPricingLinkDefinition = options?.includeVariantPricingLink === true ? yield* compileVariantPricingLinkDefinition() : undefined;
    const salesChannelDefinition = options?.includeSalesChannel === true ? yield* compileSalesChannelDefinition() : undefined;
    const storeDefinition = options?.includeStore === true ? yield* compileStoreDefinition() : undefined;
    const stockLocationDefinition = options?.includeVariantInventory === true || options?.includeStockLocation === true
      ? yield* compileStockLocationDefinition() : undefined;
    const salesChannelLocationLinkDefinition = options?.includeSalesChannelLocationLink === true
      ? yield* compileSalesChannelLocationLinkDefinition() : undefined;
    const locationFulfillmentSetLinkDefinition = options?.includeLocationFulfillmentSetLink === true
      ? yield* compileLocationFulfillmentSetLinkDefinition() : undefined;
    const locationFulfillmentProviderLinkDefinition = options?.includeLocationFulfillmentProviderLink === true
      ? yield* compileLocationFulfillmentProviderLinkDefinition() : undefined;
    const shippingOptionPriceSetLinkDefinition = options?.includeShippingOptionPriceSetLink === true
      ? yield* compileShippingOptionPriceSetLinkDefinition() : undefined;
    const regionDefinition = options?.includeRegion === true ? yield* compileRegionDefinition() : undefined;
    const productLinksDefinition = options?.includeProductSalesChannelLink === true || options?.includeProductShippingProfileLink === true
      ? yield* compileProductLinksDefinition({ salesChannel: options?.includeProductSalesChannelLink === true,
        shippingProfile: options?.includeProductShippingProfileLink === true }) : undefined;
    const shippingProfileDefinition = options?.includeShippingProfile === true
      ? yield* (options?.includeServiceZoneCreation === true ? compileServiceZoneCreationDefinition()
        : options?.includeShippingProfileDeletion === true ? compileShippingProfileDeletionDefinition() : compileShippingProfileDefinition()) : undefined;
    const initialization = yield* currencyInitialization();
    const schemaVersionId = decodeCatalogSchemaVersionId("live-logical-currency");
    const controlSession = pair.kind === "postgres"
      ? makeCatalogControlSessionStarter({ controlDb: control.drizzle,
        driver: makePostgresCatalogControlSessionDriver(pair.control.pool) })
      : makePGliteFrameworkSchemaArtifactAdmissionFixture(pair.control).controlSessionStarter;
    const admission = makeLogicalSchemaAdmission({ controlDb: control.drizzle, session: controlSession,
      deploymentId: application.deploymentId, scopeId: application.authority.scopeId });
    const compositionAndCompilationMs = performance.now() - compositionStarted;
    const admissionStarted = performance.now();
    yield* admission.admit(prepared, { schemaVersionId, version: decodeCatalogSchemaVersion(100) }, {
      initialDeadline: yield* startCatalogControlDeadline("initial", 20_000),
      lockTimeoutMilliseconds: 5000, recoveryTimeoutMilliseconds: 20_000,
    });
    const catalog = yield* runEffectTransaction(work => control.drizzle.transaction(work),
      "Arrange logical Currency catalog", (tx: FlarexMetadataTransaction) => Effect.gen(function* () {
        const definitions = yield* ensureLogicalStorageDefinitions(tx, application.deploymentId, schemaVersionId);
        const closure = yield* prepareAppUniqueConstraintSetClosureV1Effect(control.drizzle,
          { deploymentId: application.deploymentId, schemaVersionId }, tx);
        yield* closeAppUniqueConstraintSetV1InTransactionEffect(tx, closure);
        return definitions;
      }), cause => new Error("Logical Currency catalog transaction", { cause }));
    const sourcePins = Object.freeze(catalog.requirements.evidence.candidate.sources.map(source =>
      Object.freeze({ sourceKey: source.key, sourceSha256: source.sourceSha256, writeProfile: source.writeProfile })));
    const logicalAdmissionMs = performance.now() - admissionStarted;
    const indexStarted = performance.now();
    const ports = { controlDb: control.drizzle, authority: application.authorityPorts };
    const reconciled = yield* reconcilePublishedIndexBuildsV1Effect(ports,
      { deploymentId: application.deploymentId, scopeId: application.authority.scopeId, schemaVersionId });
    if (reconciled.status !== "reconciled") throw new Error("Incomplete logical Currency indexes");
    for (const indexDefinitionId of reconciled.definitionIds) {
      const index = yield* locateAppIndexDefinitionByIdEffect(control.drizzle,
        application.authority.scopeId, indexDefinitionId);
      if (index === null) throw new Error("Missing logical Currency index definition");
      let enabled = false;
      for (let step = 0; step < 20; step++) {
        const build = index.access.kind === "by_creation_time"
          ? yield* buildIntrinsicCreationTimeIndexV1Effect(ports,
            { deploymentId: application.deploymentId, scopeId: application.authority.scopeId, indexDefinitionId, pageSize: 10 })
          : yield* buildAppDeveloperOrderedIndexV1Effect(ports,
            { deploymentId: application.deploymentId, scopeId: application.authority.scopeId, indexDefinitionId, pageSize: 10 });
        if (build.lifecycle === "enabled") { enabled = true; break; }
      }
      if (!enabled) throw new Error("Logical Currency index did not become ready");
    }
    const uniqueSet = yield* reconcileAppUniqueConstraintSetBuildV1Effect(ports,
      { deploymentId: application.deploymentId, scopeId: application.authority.scopeId, schemaVersionId });
    if (uniqueSet.status !== "reconciled") throw new Error("Logical Currency unique set was not declared");
    let uniqueEnabled = false;
    // Each definition needs finite build transitions; the fixture must not
    // misclassify a larger composed schema as an incomplete core build.
    for (let step = 0; step < (uniqueSet.definitionCount + 1) * 4; step++) {
      const build = yield* advanceAppUniqueConstraintSetBackfillV1Effect(ports,
        { deploymentId: application.deploymentId, scopeId: application.authority.scopeId, schemaVersionId, pageSize: 16 });
      if (build.lifecycle === "enabled" && build.uniqueConstraintDefinitionId === null) { uniqueEnabled = true; break; }
    }
    if (!uniqueEnabled) throw new Error("Logical Currency unique set did not become ready");
    const indexAndUniqueBuildMs = performance.now() - indexStarted;
    const bindingStarted = performance.now();
    const bindingTarget = yield* makeFrameworkSchemaTarget({ database: target.drizzle,
      deploymentId: application.deploymentId, canonicalPhysicalDatabaseIdentity: "logical-currency-target",
      physicalLocator: application.active.basis.authority.physicalLocator });
    const bindings = yield* makeDataBindingHost({ database: target.drizzle,
      selection: { deploymentId: application.deploymentId, scopeId: application.authority.scopeId },
      target: bindingTarget, authority: application.authorityPorts,
      application: application.activation, logicalStorage: { controlDb: control.drizzle, schemaVersionId,
        unique: application.uniqueConstraintEligibility } });
    const reference = yield* bindings.readApplicationReference();
    const frame = { format: "flarex.data-binding-set" as const, application: reference,
      logicalSchema: { schemaVersionId, manifestSha256: encodeBytesToLowercaseHex(catalog.requirements.artifact.manifestSha256) },
      payloadContent: null, payloadLifecycle: null, commerce: [], crossDomainReferences: [] };
    const bindingCandidate = yield* bindings.prepare(frame);
    yield* bindings.activate(dataBindingActivationRequest(reference.scopeId,
      reference.storageGeneration, "logical-currency-activate", bindingCandidate.sha256, null));
    const session = pair.kind === "postgres" ? makePostgresRelationalSession(pair.target, undefined,
      pair.managedRead === undefined ? undefined : { kind: "managed", installation: pair.managedRead.installation,
        ...(managedInstallationSetup === undefined ? {} : { coLocated: managedInstallationSetup.readInstallation }) }) : pair.session;
    const hostInput = { hostRuntime: preparedHostTestRuntime(target.drizzle), database: target.drizzle,
      session, target: bindingTarget, deploymentId: application.deploymentId,
      scopeId: application.authority.scopeId,
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
    let managedRead: LogicalCurrencyFixture["managedRead"];
    let coLocatedSetupMs = 0;
    if (pair.kind === "postgres" && pair.managedRead !== undefined) {
      const prepared = managedInstallationSetup;
      if (prepared === undefined) throw new Error("A managed resource requires its authenticated composite read installation");
      managedRead = { ...pair.managedRead, readInstallation: prepared.readInstallation,
        controlInstallation: prepared.controlInstallation };
      coLocatedSetupMs = prepared.coLocatedSetupMs;
    }
    const installationTiming = pair.kind !== "postgres" || pair.installationTiming === undefined ? undefined
      : coLocatedSetupMs === 0 ? pair.installationTiming : Object.freeze({ ...pair.installationTiming,
        coLocatedSetupMs: pair.installationTiming.coLocatedSetupMs + coLocatedSetupMs,
        totalInstallationMs: pair.installationTiming.totalInstallationMs + coLocatedSetupMs });
    return { resource: pair.kind === "postgres" ? { ...pair,
        ...(installationTiming === undefined ? {} : { installationTiming }),
        ...(managedRead === undefined ? {} : { managedRead }) } : pair,
      installationTiming, fixtureConstructionMs: performance.now() - fixtureStarted,
      preparationTiming: { provisionAndMigrateMs, applicationAndReadInstallationMs, compositionAndCompilationMs,
        logicalAdmissionMs, indexAndUniqueBuildMs, bindingAndInitializationMs: performance.now() - bindingStarted },
      application, control, persistence: target, testOwner: pair.testOwner, deploymentId: application.deploymentId, bindingTarget, session,
      hostInput, host, service: makeCurrencyService(host), initialization, schemaVersionId, applicationSource, sourcePins,
      managedRead,
      currencyDefinition: definition,
      productDefinition, productLogicalSource,
      metadataCounts: logicalReadMetadataCounts(candidate.sources),
      metadataScaling: metadataScaling === undefined ? undefined : {
        scale: metadataScaling.scale, counts: metadataScaling.counts, added: metadataScaling.added },
      pricingDefinition, variantPricingLinkDefinition, salesChannelDefinition, storeDefinition, stockLocationDefinition, salesChannelLocationLinkDefinition, locationFulfillmentSetLinkDefinition, productLinksDefinition,
      shippingProfileDefinition, locationFulfillmentProviderLinkDefinition, shippingOptionPriceSetLinkDefinition, regionDefinition, physicalTablesBeforeCandidate,
      ...(pair.kind === "pglite" ? { observeSql: pair.observeSql } : {}) };
  })());
}
