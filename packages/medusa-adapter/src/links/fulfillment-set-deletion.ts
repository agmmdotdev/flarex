import { Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { LocationFulfillmentSet } from "@medusajs/link-modules";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { FulfillmentSetDeletionIds } from "../modules/fulfillment/fulfillment-set-delete-input";
import { fulfillmentSetDeletionServiceDefinition } from "../modules/fulfillment/fulfillment-set-delete-service";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { captureLocationFulfillmentSetDeletionService } from "./location-fulfillment-set-deletion";
import { decodeLinkCascade } from "./cascade-result";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeEndpoint = commerceDecoder(Schema.Tuple([
  Schema.Struct({ fulfillment: Schema.Struct({ fulfillment_set_id: FulfillmentSetDeletionIds }) }),
]), "invalidInput");
const decodeLinkMap = commerceDecoder(Schema.Struct({
  stock_location_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(8))),
  fulfillment_set_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(8))),
}), "storedCorruption");
const decodeFulfillmentMap = commerceDecoder(Schema.Struct({
  fulfillment_set_id: Schema.Array(Id).check(Schema.isLengthBetween(1, 4)),
}), "storedCorruption");

/** The installed locfs family retains Set history and recursively reaches the
 * genuine full-metadata Fulfillment lifecycle during restoration. */
export function prepareFulfillmentSetDeletionLinkResource(services: { readonly location: unknown; readonly fulfillment: unknown }) {
  return Result.gen(function* () {
    const location = yield* captureLocationFulfillmentSetDeletionService(services.location, "fulfillment-set-deletions");
    const fulfillment = fulfillmentSetDeletionServiceDefinition(services.fulfillment);
    if (fulfillment === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    const softDelete = location.softDeleteMethod, restore = location.restoreMethod;
    if (softDelete === undefined || restore === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const output = (value: Parameters<typeof decodeLinkCascade>[0]) => Result.gen(function* () {
      const tuple = yield* decodeLinkCascade(value);
      for (const [name, map] of Object.entries(tuple[1])) {
        if (name === LocationFulfillmentSet.serviceName) {
          const decoded = yield* decodeLinkMap(map);
          if (Object.keys(decoded).length !== 0 && (decoded.stock_location_id === undefined || decoded.fulfillment_set_id === undefined ||
            decoded.stock_location_id.length !== decoded.fulfillment_set_id.length)) return yield* Result.fail(commerceError("storedCorruption"));
        } else if (name === "fulfillment") yield* decodeFulfillmentMap(map);
        else return yield* Result.fail(commerceError("storedCorruption"));
      }
      return tuple;
    });
    return yield* defineComposedWorkflowResource({ identity: { format: "medusa.fulfillment-set.deletion-links",
      services: [location.routing, fulfillment.routing], lifecycle: location.lifecycle },
      dependencies: [softDelete, restore, fulfillment.softDelete, fulfillment.restore],
      methods: { delete: { arguments: decodeEndpoint, output }, restore: { arguments: decodeEndpoint, output } },
      bind: invoke => {
        const link = { ...structuredClone(location.routing),
          softDelete: (selector: unknown, config: unknown) => invoke(softDelete, selector, config),
          restore: (selector: unknown, config: unknown) => invoke(restore, selector, config) };
        const endpoint = { ...structuredClone(fulfillment.routing),
          softDeleteFulfillmentSets: (selector: unknown, config: unknown) => invoke(fulfillment.softDelete, selector, config),
          restoreFulfillmentSets: (selector: unknown, config: unknown) => invoke(fulfillment.restore, selector, config) };
        const native = new Link([link, endpoint]);
        return { delete: input => native.delete(structuredClone(input)), restore: input => native.restore(structuredClone(input)) };
      },
    });
  });
}
