import { Result } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureLocationFulfillmentProviderLinkService } from "./location-fulfillment-provider-service";
import { captureShippingOptionPriceSetLinkService } from "./shipping-option-price-set-service";
import { shippingPricingLifecycleServiceDefinition } from "../modules/pricing/service";
import type { InvokeWorkflowMethod } from "../workflow/composed-resource";

/** Both installed deletion roots reuse the same authenticated native services.
 * The genuine router alone decides whether a Pricing cascade is reached. */
export function captureShippingDeletionServices(services: { readonly provider: unknown; readonly priceSet: unknown; readonly pricing: unknown }) {
  return Result.gen(function* () {
    const provider = yield* captureLocationFulfillmentProviderLinkService(services.provider);
    const priceSet = yield* captureShippingOptionPriceSetLinkService(services.priceSet);
    const pricing = shippingPricingLifecycleServiceDefinition(services.pricing);
    if (pricing === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    const providerDelete = provider.softDeleteMethod, providerRestore = provider.restoreMethod;
    const priceSetDelete = priceSet.softDeleteMethod, priceSetRestore = priceSet.restoreMethod;
    if (providerDelete === undefined || providerRestore === undefined || priceSetDelete === undefined || priceSetRestore === undefined)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    return { routing: [provider.routing, priceSet.routing, pricing.routing],
      dependencies: [providerDelete, providerRestore, priceSetDelete, priceSetRestore, pricing.softDelete, pricing.restore],
      bind: (invoke: InvokeWorkflowMethod) => [
        { ...structuredClone(provider.routing), softDelete: (selector: unknown, config: unknown) => invoke(providerDelete, selector, config),
          restore: (selector: unknown, config: unknown) => invoke(providerRestore, selector, config) },
        { ...structuredClone(priceSet.routing), softDelete: (selector: unknown, config: unknown) => invoke(priceSetDelete, selector, config),
          restore: (selector: unknown, config: unknown) => invoke(priceSetRestore, selector, config) },
        { ...structuredClone(pricing.routing), softDeletePriceSets: (selector: unknown, config: unknown) => invoke(pricing.softDelete, selector, config),
          restorePriceSets: (selector: unknown, config: unknown) => invoke(pricing.restore, selector, config) },
      ],
    };
  });
}
