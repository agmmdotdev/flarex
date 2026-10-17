import { Result, Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { FulfillmentSetDeletionIds } from "../modules/fulfillment/fulfillment-set-delete-input";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { decodeLinkCascade } from "./cascade-result";

const decodeEndpoint = commerceDecoder(Schema.Tuple([
  Schema.Struct({ fulfillment: Schema.Struct({ fulfillment_set_id: FulfillmentSetDeletionIds }) }),
]), "invalidInput");
const decodeEmptyCascade = (value: Parameters<typeof decodeLinkCascade>[0]) => Result.gen(function* () {
  const tuple = yield* decodeLinkCascade(value);
  if (tuple[0] !== null || Object.keys(tuple[1]).length !== 0)
    return yield* Result.fail(commerceError("storedCorruption"));
  return tuple;
});

/** No Set endpoint family is installed in this composition. The genuine empty
 * scoped router still owns deletion and its retained grouped-endpoint inverse. */
export function prepareFulfillmentSetDeletionLinkResource() {
  return defineComposedWorkflowResource({ identity: { format: "medusa.fulfillment-set.deletion-links", services: [] },
    dependencies: [], methods: { delete: { arguments: decodeEndpoint, output: decodeEmptyCascade },
      restore: { arguments: decodeEndpoint, output: decodeEmptyCascade } },
    bind: () => {
      const native = new Link([]);
      return { delete: input => native.delete(structuredClone(input)),
        restore: input => native.restore(structuredClone(input)) };
    },
  });
}
