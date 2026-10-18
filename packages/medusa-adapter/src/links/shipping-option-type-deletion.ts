import { Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ShippingOptionTypeDeletionIds } from "../modules/fulfillment/shipping-option-type-delete-input";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { decodeLinkCascade } from "./cascade-result";

const decodeEndpoint = commerceDecoder(Schema.Tuple([
  Schema.Struct({ fulfillment: Schema.Struct({ shipping_option_type_id: ShippingOptionTypeDeletionIds }) }),
]), "invalidInput");
const decodeEmptyCascade = (value: Parameters<typeof decodeLinkCascade>[0]) => Result.gen(function* () {
  const tuple = yield* decodeLinkCascade(value);
  if (Object.keys(tuple[1]).length !== 0)
    return yield* Result.fail(commerceError("storedCorruption"));
  return tuple;
});

/** Type has no installed stored Link family. The genuine scoped router still
 * owns mandatory deletion dispatch and its retained grouped-endpoint inverse. */
export function prepareShippingOptionTypeDeletionLinkResource() {
  return defineComposedWorkflowResource({ identity: { format: "medusa.shipping-option-type.deletion-links", services: [] },
    dependencies: [], methods: { delete: { arguments: decodeEndpoint, output: decodeEmptyCascade },
      restore: { arguments: decodeEndpoint, output: decodeEmptyCascade } },
    bind: () => {
      const native = new Link([]);
      return { delete: input => native.delete(structuredClone(input)),
        restore: input => native.restore(structuredClone(input)) };
    },
  });
}
