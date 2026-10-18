import { Effect, Schema } from "effect";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import type { WorkflowCallResults } from "./host";

/** Correlate a native workflow's ordered ID messages with its genuine calls.
 * Each framework root selects its own event family and expected identities. */
export function orderedWorkflowIdEvents(name: string,
  expectedIds: (calls: WorkflowCallResults) => Effect.Effect<readonly string[], CommerceTransactionError>,
  options: { readonly pendingCancellation?: true; readonly dataShape?: "string" } = {}) {
  const id = Schema.String.check(Schema.isLengthBetween(1, 256));
  const decode = commerceDecoder(Schema.Struct({ name: Schema.Literal(name),
    data: options.dataShape === "string" ? id : Schema.Struct({ id }),
    metadata: Schema.Struct({ eventGroupId: Schema.String }),
  }), "unadmittedEvent");
  return {
    contracts: [{ name, decode, ...(options.pendingCancellation === undefined ? {} : { pendingCancellation: options.pendingCancellation }) }],
    validate: Effect.fn("Workflow.validateOrderedIdEvents")(function* (
      events: Parameters<AtomicCommerceEvents["validate"]>[0], calls: WorkflowCallResults,
    ) {
      const expected = yield* expectedIds(calls);
      const observed: string[] = [];
      for (const event of events) {
        if (event.contract !== name) continue;
        const message = yield* Effect.fromResult(decode(event.message));
        if (message.metadata.eventGroupId !== event.group) return yield* Effect.fail(commerceError("receiptMismatch"));
        observed.push(typeof message.data === "string" ? message.data : message.data.id);
      }
      if (observed.length !== expected.length || observed.some((id, index) => id !== expected[index])) return yield* Effect.fail(commerceError("receiptMismatch"));
    }),
  };
}

/** Module-only workflows retain the participant's event/fact validation and
 * admit no external workflow event family. */
export const internalModuleWorkflowEvents = {
  contracts: [],
  validate: Effect.fn("Workflow.validateInternalEvents")(function* (events: Parameters<AtomicCommerceEvents["validate"]>[0]) {
    if (events.some(event => !event.internal)) return yield* Effect.fail(commerceError("unadmittedEvent"));
  }),
};
