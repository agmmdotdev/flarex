import { Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { ShippingOptionPriceSet } from "@medusajs/link-modules";
import { SymbolWorkflowWorkflowData } from "@medusajs/utils/orchestration/symbol";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { jsonEqual } from "flarex-protocol/json";
import { ShippingOptionDeletionOutput } from "../modules/fulfillment/shipping-option-delete-input";
import { shippingOptionDeletionServiceDefinition } from "../modules/fulfillment/shipping-option-delete-service";
import { shippingPricingLifecycleServiceDefinition } from "../modules/pricing/service";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { captureShippingOptionPriceSetLinkService } from "./shipping-option-price-set-service";
import { decodeLinkCascade } from "./cascade-result";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
// A genuine void callback resolves to the SDK's issued WorkflowData marker.
// Common Link removal groups its string into these exact character-key arrays.
// This is a private representation contract, never a public root input shape.
const groupedVoidMarker = { __type: Object.fromEntries(Array.from(SymbolWorkflowWorkflowData,
  (character, index) => [String(index), [character]])) };
const VoidMarker = Schema.Struct({ __type: Schema.Record(Schema.String, Schema.Tuple([Schema.String]).pipe(Schema.mutable)) })
  .check(Schema.makeFilter(value => jsonEqual(value, groupedVoidMarker)));
const decodeEndpoint = commerceDecoder(Schema.Tuple([Schema.Union([
  Schema.Struct({ fulfillment: ShippingOptionDeletionOutput }), VoidMarker,
])]), "invalidInput");
const decodeLinkMap = commerceDecoder(Schema.Struct({
  shipping_option_id: Schema.Array(Id).check(Schema.isLengthBetween(1, 8)),
  price_set_id: Schema.Array(Id).check(Schema.isLengthBetween(1, 8)),
}).check(Schema.makeFilter(map => map.shipping_option_id.length === map.price_set_id.length)), "storedCorruption");
const decodePricingMap = commerceDecoder(Schema.Struct({
  price_set_id: Schema.Array(Id).check(Schema.isLengthBetween(1, 8)),
}), "storedCorruption");

/** The genuine Link router receives complete native routing metadata, with
 * callable authority confined to the reached stored Link and Pricing cascade. */
export function prepareShippingOptionDeletionLinkResource(services: {
  readonly fulfillment: unknown; readonly priceSet: unknown; readonly pricing: unknown;
}) {
  return Result.gen(function* () {
    const fulfillment = shippingOptionDeletionServiceDefinition(services.fulfillment);
    const priceSet = yield* captureShippingOptionPriceSetLinkService(services.priceSet);
    const pricing = shippingPricingLifecycleServiceDefinition(services.pricing);
    if (fulfillment === undefined || pricing === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    const softDelete = priceSet.softDeleteMethod, restore = priceSet.restoreMethod;
    if (softDelete === undefined || restore === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const output = (value: Parameters<typeof decodeLinkCascade>[0]) => Result.gen(function* () {
      const tuple = yield* decodeLinkCascade(value);
      for (const [name, map] of Object.entries(tuple[1])) {
        if (name === ShippingOptionPriceSet.serviceName) yield* decodeLinkMap(map);
        else if (name === "pricing") yield* decodePricingMap(map);
        else return yield* Result.fail(commerceError("storedCorruption"));
      }
      return tuple;
    });
    return yield* defineComposedWorkflowResource({ identity: { format: "medusa.shipping-option.deletion-links",
      services: [fulfillment.routing, priceSet.routing, pricing.routing], lifecycle: priceSet.lifecycle },
      dependencies: [softDelete, restore, pricing.softDelete, pricing.restore],
      methods: { delete: { arguments: decodeEndpoint, output }, restore: { arguments: decodeEndpoint, output } },
      bind: invoke => {
        const link = { ...structuredClone(priceSet.routing),
          softDelete: (selector: unknown, config: unknown) => invoke(softDelete, selector, config),
          restore: (selector: unknown, config: unknown) => invoke(restore, selector, config) };
        const endpoint = { ...structuredClone(pricing.routing),
          softDeletePriceSets: (selector: unknown, config: unknown) => invoke(pricing.softDelete, selector, config),
          restorePriceSets: (selector: unknown, config: unknown) => invoke(pricing.restore, selector, config) };
        const native = new Link([structuredClone(fulfillment.routing), link, endpoint]);
        return { delete: input => native.delete(structuredClone(input)), restore: input => native.restore(structuredClone(input)) };
      },
    });
  });
}
