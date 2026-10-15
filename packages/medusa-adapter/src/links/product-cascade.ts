import { Result, Schema } from "effect";
import { ProductSalesChannel, ProductShippingProfile, ProductVariantInventoryItem, ProductVariantPriceSet } from "@medusajs/link-modules";
import { Modules } from "@medusajs/framework/utils/portable";
import { pricingStaticResources } from "@medusajs/pricing/static-manifest";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import type { InvokeWorkflowMethod } from "../workflow/composed-resource";
import { workflowModuleDefinition, type WorkflowModule } from "../workflow/module";
import { linkWorkflowServiceDefinition } from "./workflow-service";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const decodeLinkCascade = commerceDecoder(Schema.Tuple([
  Schema.Union([Schema.Null, Schema.Array(Schema.Struct({ serviceName: Schema.String, method: Schema.String,
    args: Schema.Json, error: Schema.JsonObject })).check(Schema.isLengthBetween(1, 8))]),
  Schema.Record(Schema.String, Schema.Record(Schema.String, Schema.Array(Id).check(Schema.isMaxLength(16)))),
]), "storedCorruption");

type Admission = NonNullable<ReturnType<typeof linkWorkflowServiceDefinition>>["admission"];
/** Capture only issuer-authenticated native families and the named Pricing
 * lifecycle. Each resource selects its own admissions and exposed operations. */
export function captureProductLinkCascade(services: {
  readonly sales: unknown; readonly shipping: unknown; readonly inventory: unknown; readonly pricing: unknown;
}, pricingWorkflow: WorkflowModule, admissions: readonly [Admission, Admission, Admission, Admission]) {
  return Result.gen(function* () {
    const sales = linkWorkflowServiceDefinition(services.sales), shipping = linkWorkflowServiceDefinition(services.shipping);
    const inventory = linkWorkflowServiceDefinition(services.inventory), pricing = linkWorkflowServiceDefinition(services.pricing);
    const pricingDefinition = workflowModuleDefinition(pricingWorkflow);
    if (sales === undefined || shipping === undefined || inventory === undefined || pricing === undefined || pricingDefinition === undefined)
      return yield* Result.fail(commerceError("invalidAuthority"));
    const selected = [sales, shipping, inventory, pricing];
    const expected = [ProductSalesChannel, ProductShippingProfile, ProductVariantInventoryItem, ProductVariantPriceSet];
    if (selected.some((service, index) => service.routing.__joinerConfig.serviceName !== expected[index]?.serviceName || service.admission !== admissions[index]) ||
      pricingWorkflow.name !== Modules.PRICING || pricingDefinition.source.name !== "flarex-pricing-local" ||
      pricingDefinition.source.profile !== "pricing-product-updates")
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const softDeletePriceSets = pricingWorkflow.methods.softDeletePriceSets;
    const pricingJoiner = pricingStaticResources.joinerConfig === undefined ? undefined : structuredClone(pricingStaticResources.joinerConfig);
    if (softDeletePriceSets === undefined || pricingJoiner === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    return { sales, shipping, inventory, pricing, selected, softDeletePriceSets, pricingJoiner };
  });
}

export function nativePricingCascadeModule(prepared: Result.Result.Success<ReturnType<typeof captureProductLinkCascade>>, invoke: InvokeWorkflowMethod) {
  return { __joinerConfig: structuredClone(prepared.pricingJoiner), __definition: {
    key: Modules.PRICING, defaultPackage: "@medusajs/pricing", label: "Pricing", isQueryable: true,
    defaultModuleDeclaration: { scope: "internal" as const },
  }, softDeletePriceSets: (selector: unknown, config: unknown) => invoke(prepared.softDeletePriceSets, selector, config) };
}
