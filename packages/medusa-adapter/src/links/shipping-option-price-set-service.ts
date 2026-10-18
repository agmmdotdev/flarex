import { Effect, Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { ShippingOptionPriceSet } from "@medusajs/link-modules";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureShippingOptionPriceSetLinkMetadata } from "./shipping-option-price-set-schema";
import { prepareShippingOptionLinkService, captureShippingOptionLinkService } from "./shipping-option-link-service";
import { captureLocationFulfillmentSetLinkReadService } from "./location-fulfillment-set-service";
import { captureLocationFulfillmentProviderLinkService } from "./location-fulfillment-provider-service";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { ScalarId as Id } from "../repository/scalar-id-read";

export const captureShippingOptionPriceSetLinkService = (service: unknown) => captureShippingOptionLinkService(service, ShippingOptionPriceSet);
const Pair = Schema.Struct({ fulfillment: Schema.Struct({ shipping_option_id: Id }), pricing: Schema.Struct({ price_set_id: Id }) });
const decodeArguments = commerceDecoder(Schema.Tuple([Schema.Array(Pair).pipe(Schema.mutable).check(Schema.isMaxLength(4))]), "invalidInput");
const decodeRows = commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id, shipping_option_id: Id, price_set_id: Id }),
  [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4)), "storedCorruption");

/** The complete installed metadata enters the genuine native router; only its
 * selected PriceSet pair methods receive callable command capabilities. */
export function prepareShippingOptionCreationLinkResource(services: { readonly location: unknown; readonly provider: unknown; readonly pricing: unknown }) {
  return Result.gen(function* () {
    const location = yield* captureLocationFulfillmentSetLinkReadService(services.location);
    const provider = yield* captureLocationFulfillmentProviderLinkService(services.provider);
    const pricing = yield* captureShippingOptionPriceSetLinkService(services.pricing);
    const create = pricing.createMethod, list = pricing.listMethod, dismiss = pricing.dismissMethod;
    if (dismiss === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    return yield* defineComposedWorkflowResource({ identity: { format: "medusa.shipping-option.creation-links",
      services: [location.routing, provider.routing, pricing.routing] }, dependencies: [create, list, dismiss],
      methods: { create: { arguments: decodeArguments, output: decodeRows }, dismiss: { arguments: decodeArguments, output: decodeRows } },
      bind: invoke => {
        const loaded = { ...structuredClone(pricing.routing), create: (bulk: unknown) => invoke(create, bulk),
          list: (filters: unknown, config: unknown) => invoke(list, filters, config), dismiss: (pairs: unknown) => invoke(dismiss, pairs) };
        const router = new Link([structuredClone(location.routing), structuredClone(provider.routing), loaded]);
        return { create: pairs => router.create(structuredClone(pairs)), dismiss: pairs => router.dismiss(structuredClone(pairs)) };
      },
    });
  });
}

/** Four forward creates share the genuine service with the installed deletion
 * closure of eight Options and eight complete historical Link rows. */
export const prepareShippingOptionPriceSetLink = Effect.fn("ShippingOptionPriceSetLink.prepare")(function* () {
  return yield* prepareShippingOptionLinkService(yield* captureShippingOptionPriceSetLinkMetadata(), {
    name: "shipping_option_price_set_links", prefix: "shippingOptionPriceSetLink",
  });
});
