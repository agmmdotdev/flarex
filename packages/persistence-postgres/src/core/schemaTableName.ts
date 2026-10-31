/** Native qualified identities need legal Source identifiers, not physical names. */
import { Effect, Encoding } from "effect";
import { digestApplicationWritePolicyFrame } from "@flarex/analysis/internal/application-write-policy";
import type { QualifiedLogicalTable } from "flarex-protocol/internal/logical-schema-candidate";
import type { Json } from "flarex-protocol/json";
import { CoreSchemaError } from "./schemaTypes";

// The pinned Source document-ID base32 alphabet. All 256 digest bits are kept.
const alphabet = "0123456789abcdefghjkmnpqrstvwxyz";
const encodedName = Effect.fn("CoreSchema.nativeIdentifier")(function* (prefix: string, frame: Json) {
  const digest = yield* digestApplicationWritePolicyFrame(frame).pipe(Effect.mapError(cause => new CoreSchemaError({
    reason: cause.reason === "digestUnavailable" ? "hashFailure" : "unsupportedCapability",
    message: "Native identifier digest failed", cause,
  })));
  const bytes = yield* Effect.fromResult(Encoding.decodeHex(digest)).pipe(Effect.orDie);
  let output = prefix, accumulator = 0, bits = 0;
  for (const byte of bytes) {
    accumulator = accumulator << 8 | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += alphabet.charAt(accumulator >>> bits & 31);
    }
    accumulator &= (1 << bits) - 1;
  }
  if (bits > 0) output += alphabet.charAt(accumulator << 5 - bits & 31);
  return output;
});

export const coreNativeTableName = Effect.fn("CoreSchema.nativeTableName")((table: QualifiedLogicalTable) =>
  table.namespace === "app" ? Effect.succeed(table.logicalName)
    : encodedName("n_", ["flarex.core.native-table", 1, table.namespace, table.logicalName]));

export const coreNativeIndexName = Effect.fn("CoreSchema.nativeIndexName")((table: QualifiedLogicalTable,
  kind: "key" | "index", identity: string) => encodedName(kind === "key" ? "k_" : "i_",
    ["flarex.core.native-index", 1, table.namespace, table.logicalName, kind, identity]));
