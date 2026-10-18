import { Result, Schema } from "effect";
import { createStep, StepResponse, WorkflowDefinitionError, type StepOutput } from "@medusajs/workflows-sdk";
import { queryWorkflowGraph, type WorkflowGraphResource } from "./use-query-graph";

// Pinned Product lists retain the bounded graph seam. Fulfillment creation
// additionally uses the exact native Stock Location singleton callable ABI.
// Service queries, pagination variables and throwing relation options remain
// unadmitted at this deprecated step boundary.
const ListInput = Schema.Struct({
  entry_point: Schema.String,
  fields: Schema.Array(Schema.String),
  variables: Schema.optionalKey(Schema.Struct({ filters: Schema.optionalKey(Schema.JsonObject) })),
  list: Schema.optionalKey(Schema.Literal(true)),
});
const SingletonInput = Schema.Struct({
  entry_point: Schema.Literal("stock_location"),
  fields: Schema.Array(Schema.String),
  variables: Schema.Struct({ id: Schema.String }),
  list: Schema.Literal(false),
  throw_if_key_not_found: Schema.Literal(true),
});
const Input = Schema.Union([ListInput, SingletonInput]);
// Native selectors enter as foreign values; the decoder below owns their JSON
// contract before the Query resource receives them.
type ListStepInput = Omit<typeof ListInput.Type, "variables"> & {
  readonly variables?: { readonly filters?: unknown };
};
type SingletonStepInput = typeof SingletonInput.Type;
export type EntryStepInput = ListStepInput | SingletonStepInput;
type Row = typeof Schema.JsonObject.Type;
interface SingletonQueryResource {
  (input: { readonly entryPoint: "stock_location"; readonly fields: readonly string[]; readonly variables: { readonly id: string } },
    options: { readonly throwIfKeyNotFound: true; readonly throwIfRelationNotFound: undefined }): Promise<readonly Row[]>;
}
const decode = Schema.decodeUnknownResult(Input, { onExcessProperty: "error" });
export const useRemoteQueryStepId = "use-remote-query";
const step = createStep<EntryStepInput, Row | readonly Row[] | undefined>(useRemoteQueryStepId, async (input, { container }) => {
  // Deliberate Promise/throw boundary matching the native step contract.
  const data = Result.getOrThrow(decode(input).pipe(Result.mapError(() => new WorkflowDefinitionError({
    reason: "unsupportedProfile", detail: "Unsupported native remote query step options",
  }))));
  if (data.list === false) {
    const query = container.resolve<SingletonQueryResource>("query");
    const entities = await query({ entryPoint: data.entry_point, fields: data.fields, variables: data.variables },
      { throwIfKeyNotFound: true, throwIfRelationNotFound: undefined });
    return new StepResponse(entities[0]);
  }
  const result = await queryWorkflowGraph({ entity: data.entry_point, fields: data.fields,
    ...(data.variables?.filters === undefined ? {} : { filters: data.variables.filters }),
  }, container.resolve<WorkflowGraphResource>("query"));
  return new StepResponse(result.data);
});

// Dynamic selection exposes partial records, never a caller-chosen module DTO.
export function useRemoteQueryStep(input: SingletonStepInput): StepOutput<Row | undefined>;
export function useRemoteQueryStep(input: ListStepInput): StepOutput<readonly Row[]>;
export function useRemoteQueryStep(input: EntryStepInput): StepOutput<Row | readonly Row[] | undefined>;
export function useRemoteQueryStep(input: EntryStepInput) { return step(input); }
