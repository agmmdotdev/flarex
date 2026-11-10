import { Effect, Result, Schema } from "effect";
import type { CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommerceModuleDescription } from "../../module/definition";
import type { GraphModuleDefinition } from "../../local-graph/model";
import { commerceDecoder } from "../../value/decoder";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineWorkflowMethod, defineWorkflowModule, type WorkflowLogicalPolicy } from "../../workflow/module";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Selector = Schema.Struct({ id: Schema.Array(Id).check(Schema.isLengthBetween(1, 8)), product_id: Id });
const Config = Schema.Struct({ select: Schema.Tuple([Schema.Literal("id"), Schema.Literal("product_id")]), relations: Schema.Array(Schema.Never) });
const argumentsDecoder = commerceDecoder(Schema.Tuple([Selector, Config]), "invalidInput");
const output = commerceDecoder(Schema.Array(Schema.Struct({ id: Id, product_id: Id })).check(Schema.isMaxLength(8)), "storedCorruption");
const callInput = commerceDecoder(Schema.Struct({ filters: Selector, config: Config }), "receiptMismatch");

/** A separate method view preserves existing Image/Variant admission. Product's
 * genuine list command retains exact DAL dependencies in the borrowed root. */
export function productVariantInventoryLinkWorkflowModule(source: CommerceModuleDescription,
  listVariants: CommerceCommand, graph: GraphModuleDefinition, logical: WorkflowLogicalPolicy) {
  return Result.gen(function* () {
    const variant = graph.reads.find(read => read.model === "ProductVariant");
    if (variant === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
    const listProductVariants = yield* defineWorkflowMethod({ command: listVariants, arguments: argumentsDecoder,
      encode: ([filters, config]) => ({ filters, config }), output });
    const validateLogicalCall: NonNullable<WorkflowLogicalPolicy["validateLogicalCall"]> = Effect.fn("ProductVariantInventoryLinks.validateParentRead")(
      function* (call, activity, command) {
        yield* logical.validateLogicalCall(call, activity, command);
        const input = yield* Effect.fromResult(callInput(call.input));
        const result = yield* Effect.fromResult(output(call.result));
        const expected = activity.observedRows.filter(({ table, row }) => table === variant.table.name &&
          typeof row.id === "string" && input.filters.id.includes(row.id) && row.product_id === input.filters.product_id && row.deleted_at === null);
        if (call.mode !== "read" || result.length !== expected.length || new Set(result.map(row => row.id)).size !== result.length ||
          result.some(row => !expected.some(observed => observed.row.id === row.id && observed.row.product_id === row.product_id)))
          return yield* Effect.fail(commerceError("receiptMismatch"));
      });
    return yield* defineWorkflowModule({ name: "product", source: { ...source, profile: source.profile + ".variant-inventory-links" },
      methods: { listProductVariants }, graph, logical: { ...logical, validateLogicalCall } });
  });
}
export type ProductVariantInventoryLinkWorkflowModule = Result.Result.Success<ReturnType<typeof productVariantInventoryLinkWorkflowModule>>;
