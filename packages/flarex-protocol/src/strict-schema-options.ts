

import { Option, Schema } from "effect";

/** Flarex protocol wire policy for strict Effect Schema decoders. */
export const StrictParseOptions = { onExcessProperty: "error" } as const;

/** Schema.is has no parse options in stable Effect. Preserve closed wire
 * membership on the decoded side without converting defects into absence. */
export function strictSchemaGuard<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  const decode = Schema.decodeUnknownOption(Schema.toType(schema), StrictParseOptions);
  return (input: unknown): input is S["Type"] => Option.isSome(decode(input));
}
