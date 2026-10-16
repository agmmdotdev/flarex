import { isUint8ArrayWithByteLength } from "@flarex/utils/bytes";
import { Schema } from "effect";

export const TrustedWorkflowBindingSha256Schema = Schema.Uint8Array.check(
  Schema.makeFilter(value => isUint8ArrayWithByteLength(value, 32)),
).pipe(Schema.brand("FlarexDurableTask/TrustedWorkflowBindingSha256"));
