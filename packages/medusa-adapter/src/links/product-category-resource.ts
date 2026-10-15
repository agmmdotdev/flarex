import { Schema } from "effect";
import { Link } from "@medusajs/modules-sdk/link";
import { commerceDecoder } from "../value/decoder";
import { defineComposedWorkflowResource } from "../workflow/composed-resource";
import { decodeLinkCascade } from "./product-cascade";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Ids = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
const decodeDelete = commerceDecoder(Schema.Tuple([
  Schema.Struct({ product: Schema.Struct({ product_category_id: Ids }) }),
]), "invalidInput");

/** This admission selects no stored Category Link family. The native empty
 * router still owns deletion dispatch and the complete cascade result. */
export function prepareProductCategoryDeletionLinkResource() {
  return defineComposedWorkflowResource({ identity: { format: "medusa.product-category.deletion-links", services: [] },
    dependencies: [], methods: { delete: { arguments: decodeDelete, output: decodeLinkCascade } },
    bind: () => {
      const native = new Link([]);
      return { delete: input => native.delete(structuredClone(input)) };
    },
  });
}
