import { Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { StoreDeletionIds } from "../modules/store/delete-input";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { decodeLinkCascade } from "./cascade-result";

const decodeEndpoint = commerceDecoder(Schema.Tuple([
  Schema.Struct({ store: Schema.Struct({ store_id: StoreDeletionIds }) }),
]), "invalidInput");

/** Store has no installed stored Link family. The native router still owns
 * both required deletion dispatch and its retained restoration callback. */
export function prepareStoreDeletionLinkResource() {
  return defineComposedWorkflowResource({ identity: { format: "medusa.store.deletion-links", services: [] },
    dependencies: [], methods: { delete: { arguments: decodeEndpoint, output: decodeLinkCascade },
      restore: { arguments: decodeEndpoint, output: decodeLinkCascade } },
    bind: () => {
      const native = new Link([]);
      return { delete: input => native.delete(structuredClone(input)),
        restore: input => native.restore(structuredClone(input)) };
    },
  });
}
