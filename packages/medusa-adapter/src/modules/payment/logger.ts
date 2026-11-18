import type { Logger } from "@medusajs/framework/types";
import { defineWorkflowDiagnosticLogger } from "../../workflow/composed-resource";

export function paymentWorkflowLogger(logger: Logger) {
  return defineWorkflowDiagnosticLogger({ profile: "payment-session-logger" }, message => { logger.error(message); });
}
