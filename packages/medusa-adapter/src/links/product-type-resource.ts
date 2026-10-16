import { Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { decodeLinkCascade } from "./cascade-result";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Ids = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const decodeDelete = commerceDecoder(Schema.Tuple([
  Schema.Struct({ product: Schema.Struct({ product_type_id: Ids }) }),
]), "invalidInput");

/** Product Type has no selected Link family in this admission. The genuine
 * native router still owns dispatch and returns its full cascade tuple. */
export function prepareProductTypeDeletionLinkResource() {
  return defineComposedWorkflowResource({ identity: { format: "medusa.product-type.deletion-links", services: [] },
    dependencies: [], methods: { delete: { arguments: decodeDelete, output: decodeLinkCascade } },
    bind: () => {
      const native = new Link([]);
      return { delete: input => native.delete(structuredClone(input)) };
    },
  });
}
