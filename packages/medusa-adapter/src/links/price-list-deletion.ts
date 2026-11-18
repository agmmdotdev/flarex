import { Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { PriceListDeletionIds } from "../modules/pricing/list-input";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { decodeLinkCascade } from "./cascade-result";

const decodeEndpoint = commerceDecoder(Schema.Tuple([
  Schema.Struct({ pricing: Schema.Struct({ price_list_id: PriceListDeletionIds }) }),
]), "invalidInput");

/** No stored Link family is installed for this endpoint. Native routing still
 * performs both deletion and retained restoration, including empty selectors. */
export function preparePriceListDeletionLinkResource() {
  return defineComposedWorkflowResource({ identity: { format: "medusa.pricing.list-deletion-links", services: [] },
    dependencies: [], methods: { delete: { arguments: decodeEndpoint, output: decodeLinkCascade },
      restore: { arguments: decodeEndpoint, output: decodeLinkCascade } },
    bind: () => {
      const native = new Link([]);
      return { delete: input => native.delete(structuredClone(input)),
        restore: input => native.restore(structuredClone(input)) };
    },
  });
}
