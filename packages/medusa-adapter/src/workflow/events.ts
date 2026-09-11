import { Effect } from "effect";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";

/** Module-only workflows retain the participant's event/fact validation and
 * admit no external workflow event family. */
export const internalModuleWorkflowEvents = {
  contracts: [],
  validate: Effect.fn("Workflow.validateInternalEvents")(function* (events: Parameters<AtomicCommerceEvents["validate"]>[0]) {
    if (events.some(event => !event.internal)) return yield* Effect.fail(commerceError("unadmittedEvent"));
  }),
};
