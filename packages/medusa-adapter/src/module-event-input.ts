import { Schema } from "effect";
import { commerceDecoder } from "./commerce-decoder";

/** Native module event-bus envelope, decoded after private JSON capture. */
export const decodeLocalEventOptions = commerceDecoder(Schema.Struct({ internal: Schema.Literal(true) }), "unadmittedEvent");
export const decodeLocalEventBatch = commerceDecoder(Schema.Array(Schema.Json), "unadmittedEvent");
