import { isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { Schema } from "effect";

export const ApplicationTaskRuntimeTargetSha256V1Schema =
  Schema.Uint8Array.check(
    Schema.makeFilter((value) => isUint8ArrayWithByteLength(value, 32)
      ? undefined
      : "Expected a 32-byte Application task runtime-target SHA-256 digest"),
  ).pipe(
    Schema.brand("FlarexDurableTask/ApplicationTaskRuntimeTargetSha256V1"),
  );
