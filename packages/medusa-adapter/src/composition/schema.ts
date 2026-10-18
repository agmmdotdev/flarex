import { Data, Effect, Schema } from "effect";
import {
  captureLogicalSchemaSource,
  prepareLogicalSchemaCandidate,
} from "@flarex/analysis/internal/logical-schema-candidate";
import { compilePayloadCollections } from "@flarex/payload-adapter/internal/collections";
import { compileInventoryDefinition } from "../modules/inventory/schema";
import { compileStockLocationDefinition } from "../modules/stock-location/schema";
import { compileVariantLinksDefinition } from "../links/variant-definition";
import { compileProductDefinition } from "../modules/product/definition";
import { compileCurrencyDefinition } from "../modules/currency/schema";
import { compilePricingDefinition } from "../modules/pricing/schema";
import { compileVariantPricingLinkDefinition } from "./product-variant-pricing-schema";
import { compileSalesChannelDefinition } from "../modules/sales-channel/schema";
import { compileStoreDefinition } from "../modules/store/schema";
import { compileProductLinksDefinition } from "../links/product-definition";
import { compileShippingProfileDefinition, compileShippingProfileDeletionDefinition, compileServiceZoneCreationDefinition } from "../modules/fulfillment/shipping-profile-schema";
import { compileSalesChannelLocationLinkDefinition } from "../links/sales-channel-location-schema";
import { compileLocationFulfillmentSetLinkDefinition } from "../links/location-fulfillment-set-schema";
import { compileLocationFulfillmentProviderLinkDefinition } from "../links/location-fulfillment-provider-schema";
import { compileShippingOptionPriceSetLinkDefinition } from "../links/shipping-option-price-set-schema";
import { compileRegionDefinition } from "../modules/region/schema";
import type {
  ApplicationAnalysisAuthority,
  ApplicationAnalysisRepository,
} from "@flarex/persistence-postgres/internal/application-analysis-registration";
import {
  LogicalSchemaExtensionSchema,
  QualifiedLogicalTableSchema,
  type LogicalSchemaSource,
} from "flarex-protocol/internal/logical-schema-candidate";
import {
  decodeSchemaManifestAppTableDeclarationsV1Result,
  decodeSchemaManifestAppIndexDeclarationsV1Result,
} from "flarex-protocol/schema-manifest";

const strict = { parseOptions: { onExcessProperty: "error" } } as const;
const MedusaModule = Schema.Literals(["product", "currency", "pricing", "variantPricingLink", "salesChannel", "store", "productSalesChannelLink", "shippingProfile", "shippingProfileDeletion", "serviceZoneCreation", "productShippingProfileLink", "inventory", "stockLocation", "variantLinks", "salesChannelLocationLink", "locationFulfillmentSetLink", "locationFulfillmentProviderLink", "shippingOptionPriceSetLink", "region"]);
const decodeModules = Schema.decodeUnknownResult(Schema.Array(MedusaModule));
const Request = Schema.Struct({
  applicationCandidateId: Schema.NonEmptyString,
  payloadCollections: Schema.Unknown,
  payloadViews: Schema.Array(Schema.Struct({
    collections: Schema.Unknown,
    bindings: Schema.Array(Schema.Struct({ localName: Schema.NonEmptyString, table: QualifiedLogicalTableSchema }).annotate(strict)),
  }).annotate(strict)).check(Schema.isMaxLength(16)),
  extensions: Schema.Array(LogicalSchemaExtensionSchema).check(Schema.isMaxLength(1024)),
}).annotate(strict);

export class SchemaCompositionError extends Data.TaggedError("SchemaCompositionError")<{
  readonly reason: "invalidRequest" | "unanalyzedApplication" | "mixedApplicationPolicy" | "unsupportedPlacement" | "missingModuleDependency";
  readonly cause?: unknown;
}> {}

/**
 * Private construction-time backend composition. No HTTP/runtime route installs
 * this capability. Application metadata comes from the authenticated repository;
 * framework definitions come from their native compilers, never caller schemas
 * or claimed producer hashes. Deployment configuration authorizes dependencies.
 */
export function makeSchemaComposer(configuration: {
  readonly deploymentId: string;
  readonly authority: ApplicationAnalysisAuthority;
  readonly applicationAnalyses: ApplicationAnalysisRepository;
  readonly medusaModules: readonly (typeof MedusaModule.Type)[];
}) {
  const authority = Object.freeze({ scopeId: configuration.authority.scopeId, epoch: configuration.authority.epoch,
    storageGeneration: configuration.authority.storageGeneration, storageGenerationFence: configuration.authority.storageGenerationFence });
  const deploymentId = configuration.deploymentId;
  const repository = configuration.applicationAnalyses;
  const inspect = repository.inspect;
  const selectedModules = decodeModules([...configuration.medusaModules]);
  return Effect.fn("SchemaComposition.compose")(function* (request: unknown) {
    const modules = yield* Effect.fromResult(selectedModules).pipe(Effect.mapError(cause => new SchemaCompositionError({ reason: "invalidRequest", cause })));
    if ((modules.includes("shippingProfileDeletion") || modules.includes("serviceZoneCreation")) && !modules.includes("shippingProfile")) {
      return yield* Effect.fail(new SchemaCompositionError({ reason: "missingModuleDependency" }));
    }
    if (modules.includes("variantPricingLink") && (!modules.includes("product") || !modules.includes("pricing"))) {
      return yield* Effect.fail(new SchemaCompositionError({ reason: "missingModuleDependency" }));
    }
    if (modules.includes("productSalesChannelLink") && (!modules.includes("product") || !modules.includes("salesChannel"))) {
      return yield* Effect.fail(new SchemaCompositionError({ reason: "missingModuleDependency" }));
    }
    if (modules.includes("productShippingProfileLink") && (!modules.includes("product") || !modules.includes("shippingProfile"))) {
      return yield* Effect.fail(new SchemaCompositionError({ reason: "missingModuleDependency" }));
    }
    if (modules.includes("salesChannelLocationLink") && (!modules.includes("salesChannel") || !modules.includes("stockLocation"))) {
      return yield* Effect.fail(new SchemaCompositionError({ reason: "missingModuleDependency" }));
    }
    if (modules.includes("locationFulfillmentSetLink") && (!modules.includes("stockLocation") || !modules.includes("serviceZoneCreation"))) {
      return yield* Effect.fail(new SchemaCompositionError({ reason: "missingModuleDependency" }));
    }
    if (modules.includes("locationFulfillmentProviderLink") && (!modules.includes("stockLocation") || !modules.includes("serviceZoneCreation"))) {
      return yield* Effect.fail(new SchemaCompositionError({ reason: "missingModuleDependency" }));
    }
    if (modules.includes("shippingOptionPriceSetLink") && (!modules.includes("pricing") || !modules.includes("serviceZoneCreation"))) {
      return yield* Effect.fail(new SchemaCompositionError({ reason: "missingModuleDependency" }));
    }
    if (modules.includes("variantLinks") && (!modules.includes("product") || !modules.includes("pricing") || !modules.includes("inventory") || modules.includes("variantPricingLink"))) {
      return yield* Effect.fail(new SchemaCompositionError({ reason: "missingModuleDependency" }));
    }
    const config = yield* Schema.decodeUnknownEffect(Request)(request).pipe(
      Effect.mapError(cause => new SchemaCompositionError({ reason: "invalidRequest", cause })),
    );
    const application = yield* inspect.call(repository, authority, config.applicationCandidateId);
    if (application.status !== "analyzed") return yield* Effect.fail(new SchemaCompositionError({ reason: "unanalyzedApplication" }));
    const manifest = application.manifest;
    // The shared path takes independently compiled Payload sources. The old V3
    // embedded policy bundle remains with its existing active runtime consumers.
    if (manifest.version === 3) return yield* Effect.fail(new SchemaCompositionError({ reason: "mixedApplicationPolicy" }));
    // Placement must not disappear when projecting a native schema. This first
    // candidate profile has no partition/colocation contract yet.
    if (manifest.schema.tables.some(table => table.placement.kind !== "global")) {
      return yield* Effect.fail(new SchemaCompositionError({ reason: "unsupportedPlacement" }));
    }
    const tables = yield* Effect.fromResult(decodeSchemaManifestAppTableDeclarationsV1Result(manifest.schema.tables.map(table => ({
      logicalName: table.name,
      definition: { kind: "appDocument", definitionVersion: 1, documentType: table.validator },
    }))));
    const indexes = yield* Effect.fromResult(decodeSchemaManifestAppIndexDeclarationsV1Result(manifest.schema.indexes.map(index => ({
      tableLogicalName: manifest.schema.tables.find(table => table.tableId === index.tableId)?.name,
      descriptor: index.name,
      fields: index.fields,
      ...(index.decimalFields === undefined ? {} : { decimalFields: [...index.decimalFields] }),
    }))));
    const applicationSource = yield* captureLogicalSchemaSource({
      key: "application", owner: "application", writeProfile: "application.occ",
      evidence: { sourceArtifact: manifest.sourceArtifact, manifestSha256: application.manifestSha256 },
      definition: { kind: "documents", tables, indexes, uniqueConstraints: [], relations: manifest.version === 2 ? manifest.schema.relations.map(relation => relation.declaration) : [] },
      bindings: tables.map(table => ({ kind: "definition", localName: table.logicalName,
        table: { namespace: "app", logicalName: table.logicalName } })),
    });
    const payload = yield* compilePayloadCollections(config.payloadCollections);
    const payloadSource = yield* captureLogicalSchemaSource({
      key: payload.sourceContract.sourceKey, owner: "payload", writeProfile: payload.sourceContract.writeProfile,
      evidence: payload.sourceContract.evidence,
      definition: payload.sourceContract.definition,
      bindings: payload.sourceContract.definition.tables.map(table => ({ kind: "definition", localName: table.logicalName,
        table: { namespace: "app", logicalName: table.logicalName } })),
    });
    const medusaSources: LogicalSchemaSource[] = [];
    if (modules.includes("product")) {
      const product = yield* compileProductDefinition();
      medusaSources.push(yield* captureLogicalSchemaSource({
        key: "medusa.product", owner: "medusa", writeProfile: "medusa.product",
        evidence: product.provenance,
        definition: { kind: "relational", schema: product.schema },
        bindings: product.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
          table: { namespace: "medusa", logicalName: `${product.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
      }));
    }
    if (modules.includes("currency")) {
      const currency = yield* compileCurrencyDefinition();
      medusaSources.push(yield* captureLogicalSchemaSource({
        key: "medusa.currency", owner: "medusa", writeProfile: "medusa.currency",
        evidence: currency.provenance,
        definition: { kind: "relational", schema: currency.schema },
        bindings: currency.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
          table: { namespace: "medusa", logicalName: `${currency.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
      }));
    }
    if (modules.includes("salesChannel")) {
      const channel = yield* compileSalesChannelDefinition();
      medusaSources.push(yield* captureLogicalSchemaSource({
        key: "medusa.salesChannel", owner: "medusa", writeProfile: "medusa.salesChannel",
        evidence: channel.provenance,
        definition: { kind: "relational", schema: channel.schema },
        bindings: channel.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
          table: { namespace: "medusa", logicalName: `${channel.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
      }));
    }
    if (modules.includes("shippingProfile")) {
      const shipping = yield* (modules.includes("serviceZoneCreation") ? compileServiceZoneCreationDefinition() : modules.includes("shippingProfileDeletion")
        ? compileShippingProfileDeletionDefinition() : compileShippingProfileDefinition());
      medusaSources.push(yield* captureLogicalSchemaSource({
        key: "medusa.shippingProfile", owner: "medusa", writeProfile: "medusa.shippingProfile",
        evidence: shipping.provenance,
        definition: { kind: "relational", schema: shipping.schema },
        bindings: shipping.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
          table: { namespace: "medusa", logicalName: `${shipping.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
      }));
    }
    if (modules.includes("pricing")) {
      const pricing = yield* compilePricingDefinition();
      medusaSources.push(yield* captureLogicalSchemaSource({
        key: "medusa.pricing", owner: "medusa", writeProfile: "medusa.pricing",
        evidence: pricing.provenance,
        definition: { kind: "relational", schema: pricing.schema },
        bindings: pricing.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
          table: { namespace: "medusa", logicalName: `${pricing.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
      }));
    }
    if (modules.includes("variantPricingLink")) {
      const link = yield* compileVariantPricingLinkDefinition();
      medusaSources.push(yield* captureLogicalSchemaSource({
        key: "medusa.link.productVariantPriceSet", owner: "medusa", writeProfile: "medusa.link.productVariantPriceSet",
        evidence: link.provenance, definition: { kind: "relational", schema: link.schema },
        bindings: link.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
          table: { namespace: "medusa", logicalName: `${link.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
      }));
    }
    if (modules.includes("productSalesChannelLink") || modules.includes("productShippingProfileLink")) {
      const link = yield* compileProductLinksDefinition({ salesChannel: modules.includes("productSalesChannelLink"),
        shippingProfile: modules.includes("productShippingProfileLink") });
      medusaSources.push(yield* captureLogicalSchemaSource({
        key: "medusa.productLinks", owner: "medusa", writeProfile: "medusa.productLinks",
        evidence: link.provenance, definition: { kind: "relational", schema: link.schema },
        bindings: link.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
          table: { namespace: "medusa", logicalName: `${link.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
      }));
    }
    for (const [selected, key, compile] of [
      ["inventory", "medusa.inventory", compileInventoryDefinition],
      ["stockLocation", "medusa.stockLocation", compileStockLocationDefinition],
      ["store", "medusa.store", compileStoreDefinition],
      ["variantLinks", "medusa.variantLinks", compileVariantLinksDefinition],
      ["salesChannelLocationLink", "medusa.link.salesChannelLocation", compileSalesChannelLocationLinkDefinition],
      ["locationFulfillmentSetLink", "medusa.link.locationFulfillmentSet", compileLocationFulfillmentSetLinkDefinition],
      ["locationFulfillmentProviderLink", "medusa.link.locationFulfillmentProvider", compileLocationFulfillmentProviderLinkDefinition],
      ["shippingOptionPriceSetLink", "medusa.link.shippingOptionPriceSet", compileShippingOptionPriceSetLinkDefinition],
      ["region", "medusa.region", compileRegionDefinition],
    ] as const) {
      if (!modules.includes(selected)) continue;
      const definition = yield* compile();
      medusaSources.push(yield* captureLogicalSchemaSource({ key, owner: "medusa", writeProfile: key,
        evidence: definition.provenance, definition: { kind: "relational", schema: definition.schema },
        bindings: definition.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
          table: { namespace: "medusa", logicalName: `${definition.schema.coordinate.lineageId}/${table.identity.tableId}` } })),
      }));
    }
    const views: LogicalSchemaSource[] = [];
    for (const [position, view] of config.payloadViews.entries()) {
      const compiled = yield* compilePayloadCollections(view.collections);
      views.push(yield* captureLogicalSchemaSource({
        key: `payload.view.${position}`, owner: "payload", writeProfile: "payload.readOnlyView",
        evidence: compiled.schemaDefinition.writePolicies,
        definition: compiled.logicalDefinition,
        bindings: view.bindings.map(binding => ({ ...binding, kind: "view", mode: "readOnly" })),
      }));
    }
    return yield* prepareLogicalSchemaCandidate({
      kind: "logicalSchemaCandidate", definitionVersion: 2, state: "candidate",
      deploymentId, scopeId: authority.scopeId,
      applicationAnalysis: { candidateId: application.candidateId, analysisId: application.analysisId,
        manifestSha256: application.manifestSha256, sourceArtifactRootSha256: application.sourceArtifactRootSha256 },
      sources: [applicationSource, payloadSource, ...medusaSources, ...views],
      extensions: config.extensions,
    });
  });
}
