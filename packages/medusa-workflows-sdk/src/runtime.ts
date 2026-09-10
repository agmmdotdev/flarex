import { Effect } from "effect";
import { StepResponse } from "./responses";
import { referenceOf } from "./references";
import { definitionError, type StepExecutionContext } from "./model";
import type { PreparedWorkflow } from "./definition";

export interface WorkflowExecutionPort<Failure> {
  readonly checkpoint: Effect.Effect<void, Failure>;
  readonly capture: (value: unknown) => Effect.Effect<unknown, Failure>;
  readonly invoke: (work: () => unknown | Promise<unknown>) => Effect.Effect<unknown, Failure>;
  readonly context: StepExecutionContext;
}
/** Fork of reference/transform/response execution, with a caller-owned runtime.
 * There is no distributed transaction, scheduler, local registry or compensating commit. */
export const executeWorkflow = Effect.fn("MedusaWorkflow.execute")(function* <Failure>(
  definition: PreparedWorkflow, input: unknown, port: WorkflowExecutionPort<Failure>,
) {
  const outputs = new Map<string, unknown>();
  const transforms = new Map<object, unknown>();
  const resolve = Effect.fn("MedusaWorkflow.resolve")(function* (value: unknown, depth = 0): Effect.fn.Return<unknown, Failure | ReturnType<typeof definitionError>> {
    if (depth > 64) return yield* Effect.fail(definitionError("invalidReference", "Reference depth exceeded"));
    const reference = referenceOf(value);
    if (reference !== undefined) {
      if (reference.owner !== definition.owner) return yield* Effect.fail(definitionError("invalidReference", "Foreign workflow reference"));
      if (reference.kind === "input") return input;
      if (reference.kind === "step") {
        if (reference.step === undefined || !outputs.has(reference.step)) return yield* Effect.fail(definitionError("invalidReference", "Step has not completed"));
        return outputs.get(reference.step);
      }
      if (transforms.has(reference)) return transforms.get(reference);
      yield* port.checkpoint;
      const resolved = yield* resolve(reference.input, depth + 1);
      const transform = reference.transform;
      if (transform === undefined) return yield* Effect.fail(definitionError("invalidReference", "Missing transformer"));
      const output = yield* port.invoke(() => transform(resolved, port.context));
      const captured = yield* port.capture(output);
      transforms.set(reference, captured);
      return captured;
    }
    if (Array.isArray(value)) {
      const members = [];
      for (const member of value) members.push(yield* resolve(member, depth + 1));
      return members;
    }
    if (typeof value === "object" && value !== null) {
      const entries: [string, unknown][] = [];
      for (const [key, member] of Object.entries(value)) entries.push([key, yield* resolve(member, depth + 1)]);
      return Object.fromEntries(entries);
    }
    return value;
  });
  for (const node of definition.nodes) {
    yield* port.checkpoint;
    const input = yield* port.capture(yield* resolve(node.input));
    const returned = yield* port.invoke(() => node.invoke(input, port.context));
    if (returned instanceof StepResponse) {
      yield* port.capture(returned.compensateInput);
      outputs.set(node.name, yield* port.capture(returned.output));
    } else outputs.set(node.name, yield* port.capture(returned));
  }
  return yield* resolve(definition.result);
});
