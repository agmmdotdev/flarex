import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { ProductNamedFilters } from "./service-input";

/** The admitted selector profile shares its filter contract with named reads.
 * DML and the service still own value/storage validation and actual selection. */
export const ProductTagUpdateData = Schema.Struct({ value: Schema.String });
export const ProductTagUpdateInput = Schema.Struct({ selector: ProductNamedFilters, update: ProductTagUpdateData });
export const decodeProductTagUpdateInput = commerceDecoder(ProductTagUpdateInput, "invalidInput");
