import { Effect } from "effect";
import { LocationFulfillmentSet, LocationFulfillmentProvider, ShippingOptionPriceSet } from "@medusajs/link-modules";
import { nativeLinkGraphPaths } from "../local-graph/links";
import { captureLocationFulfillmentProviderLinkMetadata } from "./location-fulfillment-provider-schema";
import { prepareShippingOptionLinkService, captureShippingOptionLinkService } from "./shipping-option-link-service";

const configuredLinks = [LocationFulfillmentSet, LocationFulfillmentProvider, ShippingOptionPriceSet];
export const captureLocationFulfillmentProviderLinkService = (service: unknown) => captureShippingOptionLinkService(service, LocationFulfillmentProvider);

/** Eight stored rows bound the complete Link cohorts, including historical
 * replacements. Selected availability can expose eight distinct endpoints. */
export const prepareLocationFulfillmentProviderLink = Effect.fn("LocationFulfillmentProviderLink.prepare")(function* () {
  const metadata = yield* captureLocationFulfillmentProviderLinkMetadata();
  const remotePaths = yield* Effect.fromResult(nativeLinkGraphPaths(metadata.joiner, [{ root: "ServiceZone",
    path: "fulfillment_set.locations.fulfillment_providers", maximumSources: 8, maximumLinks: 8, maximumTargets: 8, maximumPerSource: 8,
  }], "StockLocation", configuredLinks));
  const locationFulfillmentSetRemotePaths = yield* Effect.fromResult(nativeLinkGraphPaths(LocationFulfillmentSet, [{ root: "ServiceZone",
    path: "fulfillment_set.locations", maximumSources: 4, maximumLinks: 8, maximumTargets: 8, maximumPerSource: 8,
  }], "FulfillmentSet", configuredLinks));
  const service = yield* prepareShippingOptionLinkService(metadata, { name: "location_fulfillment_provider_links", prefix: "locationFulfillmentProviderLink", remotePaths });
  return { ...service, locationFulfillmentSetRemotePaths };
});
