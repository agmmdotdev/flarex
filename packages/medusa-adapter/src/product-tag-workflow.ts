import { Effect, Schema, type Result } from "effect";
import { createProductTagsWorkflow } from "@medusajs/core-flows/product/create-product-tags";
import type { WorkflowContainer } from "@medusajs/workflows-sdk";
import { Modules } from "@medusajs/utils/modules-sdk/definition";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant, defineCommerceEventContract, type AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type Json, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "./commerce-decoder";
import { captureCommerceInput } from "./commerce-input";
import { makeLocalProductCommands } from "./product-service";
import { currencyGraph } from "./currency-service";
import { prepareLocalGraph } from "./local-graph/query";
import { runNativeMedusaWorkflow } from "./workflow-runtime";
import type { LocalCommerceEventPolicy } from "@flarex/persistence-postgres/internal/commerce-profile";

const id = Schema.String.check(Schema.isLengthBetween(1, 256));
const decodeInput = commerceDecoder(Schema.Struct({ product_tags: Schema.Array(Schema.Json).check(Schema.isMaxLength(256)), additional_data: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)) }), "invalidInput");
const decodeWorkflowMessage = commerceDecoder(Schema.Struct({ name: Schema.Literal("product-tag.created"), data: Schema.Struct({ id }),
  metadata: Schema.Struct({ eventGroupId: Schema.String }),
}), "unadmittedEvent");
export type ProductTagWorkflowHooks = NonNullable<Parameters<typeof createProductTagsWorkflow.prepare>[0]>;

/** Trusted host composition: revision must identify the reviewed code AND hook
 * bundle. It is never supplied by command arguments or inferred from a name. */
export const prepareProductTagWorkflow = Effect.fn("MedusaWorkflow.prepareProductTags")(function* (input: {
  readonly revision: string;
  readonly moduleEvents: Pick<LocalCommerceEventPolicy, "capture" | "validate">;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
  readonly hooks?: ProductTagWorkflowHooks;
}) {
  const prepared = yield* Effect.fromResult(createProductTagsWorkflow.prepare(input.hooks)).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const product = yield* makeLocalProductCommands();
  const productParticipant = defineAtomicCommerceParticipant("product");
  const currencyParticipant = defineAtomicCommerceParticipant("currency");
  const currency = yield* Effect.fromResult(currencyGraph);
  const graph = yield* Effect.fromResult(prepareLocalGraph([{ participant: productParticipant, module: product.graph }, { participant: currencyParticipant, module: currency }]));
  const captureModuleEvent = input.moduleEvents.capture;
  const moduleContract = defineCommerceEventContract({ name: "product.product-tag.created", revision: input.revision, internal: true,
    decode: Effect.fn("ProductTagWorkflow.moduleEvent")(function* (value) {
      const message = yield* captureModuleEvent(value);
      if (!isJsonObject(message) || message.name !== "product.product-tag.created") return yield* Effect.fail(commerceError("unadmittedEvent"));
      return message;
    }),
  });
  const workflowContract = defineCommerceEventContract({ name: "product-tag.created", revision: input.revision, internal: false,
    decode: value => Effect.fromResult(decodeWorkflowMessage(value)),
  });
  const command = defineAtomicCommerceCommand("createProductTagsWorkflow", Effect.fn("ProductTagWorkflow.run")(function* (ctx, value) {
    const data = yield* Effect.fromResult(decodeInput(value));
    return yield* runNativeMedusaWorkflow(prepared, ctx, data, owner => {
      // Only failures originating before an admitted root operation enter this
      // refusal boundary. Participant failures retain their existing full Cause.
      const checked = <Value>(result: Result.Result<Value, CommerceTransactionError>) => Effect.fromResult(result)
        .pipe(Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
      const productService = Object.freeze({
        createProductTags: (data: unknown) => owner.run(checked(captureCommerceInput(data)).pipe(Effect.flatMap(args => ctx.call(productParticipant, product.commands.createTags, args)))),
        deleteProductTags: () => owner.reject(commerceError("unsupportedProfile")),
      });
      const eventBus = Object.freeze({
        emit: (value: unknown) => owner.run(Effect.gen(function* () {
          const captured = yield* checked(captureCommerceInput(value));
          if (!Array.isArray(captured)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          for (const message of captured) {
            const decoded = yield* checked(decodeWorkflowMessage(message));
            if (decoded.metadata.eventGroupId !== ctx.eventGroupId) return yield* ctx.refuse(commerceError("unadmittedEvent"));
            yield* ctx.emit(workflowContract, decoded);
          }
        })),
        clearGroupedEvents: () => owner.reject(commerceError("unadmittedEvent")),
        releaseGroupedEvents: () => owner.reject(commerceError("unadmittedEvent")),
      });
      const query = Object.freeze({ graph: (args: Json) => owner.run(graph.bind(ctx).graph(args)) });
      return Object.freeze({ resolve<T>(name: string): T {
        const service = name === Modules.PRODUCT ? productService : name === Modules.EVENT_BUS ? eventBus : name === "query" ? query : undefined;
        if (service === undefined) return owner.reject(commerceError("unsupportedProfile"));
        // SAFETY: this is the exact Medusa container ABI seam. Names select only
        // the finite checked method implementations above; T grants no authority.
        return service as T;
      } } satisfies WorkflowContainer);
    });
  }));
  const events: AtomicCommerceEvents = {
    producerRevision: input.revision, contracts: [moduleContract, workflowContract], subscribers: input.subscribers,
    validate: Effect.fn("ProductTagWorkflow.validateEvents")(function* (events, calls) {
      const expected: string[] = [];
      for (const call of calls) {
        if (call.participant !== productParticipant || call.command !== product.commands.createTags) continue;
        if (!Array.isArray(call.result)) return yield* Effect.fail(commerceError("receiptMismatch"));
        for (const tag of call.result) {
          if (!isJsonObject(tag) || typeof tag.id !== "string") return yield* Effect.fail(commerceError("receiptMismatch"));
          expected.push(tag.id);
        }
      }
      const observed: string[] = [];
      for (const event of events) {
        if (event.contract !== "product-tag.created") continue;
        const message = yield* Effect.fromResult(decodeWorkflowMessage(event.message));
        if (message.metadata.eventGroupId !== event.group) return yield* Effect.fail(commerceError("receiptMismatch"));
        observed.push(message.data.id);
      }
      if (observed.length !== expected.length || observed.some((id, index) => id !== expected[index])) return yield* Effect.fail(commerceError("receiptMismatch"));
    }),
  };
  return { command, events, graph, productParticipant, currencyParticipant, moduleContract,
    productCommands: [product.commands.createTags, ...product.graph.reads.map(read => read.command)],
    currencyCommands: currency.reads.map(read => read.command),
  };
});
