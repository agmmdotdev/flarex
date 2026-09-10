import { Effect } from "effect";
import { StepResponse } from "./responses";
import { referenceOf } from "./references";
import { definitionError, type StepExecutionContext } from "./model";
import type { PreparedWorkflow } from "./definition";

export interface WorkflowExecutionPort<Failure> {
  readonly checkpoint: Effect.Effect<void, Failure>;
  /** Check the current execution lifetime, validate/charge the value and return
   * an owned copy. Native capture already performs this owner's checkpoint. */
  readonly capture: (value: unknown) => Effect.Effect<unknown, Failure>;
  readonly invoke: (work: () => unknown | Promise<unknown>) => Effect.Effect<unknown, Failure>;
  readonly context: StepExecutionContext;
}
/** Fork of reference/transform/response execution, with a caller-owned runtime.
 * There is no distributed transaction, scheduler, local registry or compensating commit. */
export const executeWorkflow = Effect.fn("MedusaWorkflow.execute")(function* <Failure>(
  definition: PreparedWorkflow, input: unknown, port: WorkflowExecutionPort<Failure>,
) {
  const outputs = new Map<object, unknown>();
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
      if (reference.kind === "property") {
        const resolved = yield* resolve(reference.input, depth + 1);
        if (reference.property === undefined) return yield* Effect.fail(definitionError("invalidReference", "Missing property key"));
        // Pure selection from an already captured value needs no foreign callback.
        // The next step/transform/result boundary still captures its whole input.
        return resolved == null ? undefined : Reflect.get(Object(resolved), reference.property);
      }
      if (transforms.has(reference)) return transforms.get(reference);
      if (reference.guards?.some(guard => outputs.get(guard) !== true)) return undefined;
      const resolved = yield* port.capture(yield* resolve(reference.input, depth + 1));
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
    if (node.guards.some(guard => outputs.get(guard) !== true)) {
      outputs.set(node.id, undefined);
      continue;
    }
    if (node.kind === "branchResult") { outputs.set(node.id, yield* resolve(node.input)); continue; }
    const input = yield* port.capture(yield* resolve(node.input));
    const returned = yield* port.invoke(() => {
      const value = node.invoke(input, port.context);
      if (node.kind !== "condition" || typeof value === "boolean") return value;
      const refuse = () => { throw definitionError("unsupportedProfile", "Conditions must synchronously return a Boolean"); };
      // Observe an invalid Promise through the same bounded callback owner;
      // neither a rejected Promise nor its completion can escape this invocation.
      return value instanceof Promise ? value.then(refuse, refuse) : refuse();
    });
    if (node.kind === "condition") { outputs.set(node.id, returned); continue; }
    if (returned instanceof StepResponse) {
      const compensation = returned.compensateInput, output = returned.output;
      if (compensation === output) outputs.set(node.id, yield* port.capture(output));
      else {
        const captured = yield* port.capture({ output, compensation });
        if (typeof captured !== "object" || captured === null || !("output" in captured)) return yield* Effect.fail(definitionError("invalidReference", "Invalid captured step response"));
        outputs.set(node.id, captured.output);
      }
    } else outputs.set(node.id, yield* port.capture(returned));
  }
  yield* port.checkpoint;
  return yield* resolve(definition.result);
});
