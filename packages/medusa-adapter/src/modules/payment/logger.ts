import { Schema } from "effect";
import type { Logger } from "@medusajs/framework/types";
import { defineComposedWorkflowResource } from "../../workflow/composed-resource";
import { commerceDecoder } from "../../value/decoder";

export function paymentWorkflowLogger(logger: Logger) {
  const methods = { error: { arguments: commerceDecoder(Schema.Tuple([Schema.String]), "invalidInput"),
    output: commerceDecoder(Schema.Null, "storedCorruption") } };
  return defineComposedWorkflowResource<typeof methods>({ identity: { profile: "payment-session-logger" }, dependencies: [],
    methods, bind: () => ({ error: async message => { logger.error(message); return null; } }) });
}
