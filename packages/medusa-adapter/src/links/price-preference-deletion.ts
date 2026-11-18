import { Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { PricePreferenceDeletionIds } from "../modules/pricing/preference-input";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { decodeLinkCascade } from "./cascade-result";

const decodeEndpoint = commerceDecoder(Schema.Tuple([
  Schema.Struct({ pricing: Schema.Struct({ price_preference_id: PricePreferenceDeletionIds }) }),
]), "invalidInput");

/** Price Preference has no installed stored Link family. The genuine native
 * router still executes deletion and retained restoration, including empty IDs. */
export function preparePricePreferenceDeletionLinkResource() {
  return defineComposedWorkflowResource({ identity: { format: "medusa.pricing.preference-deletion-links", services: [] },
    dependencies: [], methods: { delete: { arguments: decodeEndpoint, output: decodeLinkCascade },
      restore: { arguments: decodeEndpoint, output: decodeLinkCascade } },
    bind: () => {
      const native = new Link([]);
      return { delete: input => native.delete(structuredClone(input)),
        restore: input => native.restore(structuredClone(input)) };
    },
  });
}
