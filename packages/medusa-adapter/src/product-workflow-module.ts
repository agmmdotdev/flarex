import { Result, Schema } from "effect";
import type { CommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { CommerceModuleDescription } from "./module-definition";
import type { GraphModuleDefinition } from "./local-graph/model";
import { commerceDecoder } from "./commerce-decoder";
import { defineWorkflowMethod, defineWorkflowModule } from "./workflow/module";

export const ProductTagWorkflowInput = Schema.Array(Schema.Struct({ value: Schema.String,
  id: Schema.optionalKey(Schema.String), metadata: Schema.optionalKey(Schema.Json),
})).check(Schema.isMaxLength(256));
export const ProductTagWorkflowResult = Schema.Array(Schema.StructWithRest(
  Schema.Struct({ id: Schema.String, value: Schema.String }), [Schema.Record(Schema.String, Schema.Json)],
)).check(Schema.isMaxLength(256));
export const decodeProductTagWorkflowResult = commerceDecoder(ProductTagWorkflowResult, "storedCorruption");
const decodeArguments = commerceDecoder(Schema.Tuple([ProductTagWorkflowInput]), "invalidInput");

export function productWorkflowModule(source: CommerceModuleDescription, command: CommerceCommand, graph: GraphModuleDefinition, createdEvent: string) {
  return Result.gen(function* () {
    const createProductTags = yield* defineWorkflowMethod({ command, arguments: decodeArguments,
      encode: ([tags]) => tags, output: decodeProductTagWorkflowResult, moduleEvent: createdEvent });
    return yield* defineWorkflowModule({ name: "product", source, methods: { createProductTags }, graph, refusedMethods: ["deleteProductTags"] });
  });
}
export type ProductWorkflowModule = Result.Result.Success<ReturnType<typeof productWorkflowModule>>;
