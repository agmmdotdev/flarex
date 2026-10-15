import { Result, Schema } from "effect";
import { createStep, StepResponse, WorkflowDefinitionError } from "@medusajs/workflows-sdk";
import { queryWorkflowGraph, type WorkflowGraphResource } from "./use-query-graph";

// Pinned native Product composers still use the deprecated remote-query step.
// Their entry-point/list ABI uses the existing bounded Query resource; service
// queries, pagination variables and throwing relation options remain unadmitted.
const Input = Schema.Struct({
  entry_point: Schema.String,
  fields: Schema.Array(Schema.String),
  variables: Schema.optionalKey(Schema.Struct({ filters: Schema.optionalKey(Schema.JsonObject) })),
  list: Schema.optionalKey(Schema.Literal(true)),
});
// Native selectors enter as foreign values; the decoder below owns their JSON
// contract before the Query resource receives them.
export type EntryStepInput = Omit<typeof Input.Type, "variables"> & {
  readonly variables?: { readonly filters?: unknown };
};
const decode = Schema.decodeUnknownResult(Input, { onExcessProperty: "error" });
export const useRemoteQueryStepId = "use-remote-query";
export const useRemoteQueryStep = createStep(useRemoteQueryStepId, async (input: EntryStepInput, { container }) => {
  // Deliberate Promise/throw boundary matching the native step contract.
  const data = Result.getOrThrow(decode(input).pipe(Result.mapError(() => new WorkflowDefinitionError({
    reason: "unsupportedProfile", detail: "Unsupported native remote query step options",
  }))));
  const result = await queryWorkflowGraph({ entity: data.entry_point, fields: data.fields,
    ...(data.variables?.filters === undefined ? {} : { filters: data.variables.filters }),
  }, container.resolve<WorkflowGraphResource>("query"));
  return new StepResponse(result.data);
});
