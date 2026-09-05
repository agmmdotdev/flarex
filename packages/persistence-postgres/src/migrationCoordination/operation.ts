import type { RelationalStructuralOperation } from "./model";

export function hasRelationalOperationCodec<Format extends RelationalStructuralOperation["codec"]["format"]>(
  operation: RelationalStructuralOperation, format: Format,
): operation is Extract<RelationalStructuralOperation, { readonly codec: { readonly format: Format } }> {
  return operation.codec.format === format;
}
