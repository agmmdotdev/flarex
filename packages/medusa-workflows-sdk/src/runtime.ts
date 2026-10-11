import { Effect } from "effect";
import { StepResponse } from "./responses";
import { definitionError, type StepExecutionContext } from "./model";
import { isPreparedWorkflow, type PreparedWorkflow } from "./definition";
import { resolveWorkflowValue, type WorkflowResolution } from "./resolution";

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
export const executeWorkflow = Effect.fn("MedusaWorkflow.execute")(function <Failure>(
  definition: PreparedWorkflow, input: unknown, port: WorkflowExecutionPort<Failure>,
) {
  if (!isPreparedWorkflow(definition)) return Effect.fail(definitionError("invalidDefinition", "Workflow was not prepared by this SDK"));
  return executeFrame(definition, input, port, true);
});
/** Child frames borrow the root port; only their evaluation caches are local. */
const executeFrame = Effect.fn("MedusaWorkflow.frame")(function* <Failure>(
  definition: PreparedWorkflow, input: unknown, port: WorkflowExecutionPort<Failure>, root = false,
): Effect.fn.Return<unknown, Failure | ReturnType<typeof definitionError>> {
  const outputs = new Map<object, unknown>();
  const transforms = new Map<object, unknown>();
  const frame = { owner: definition.owner, input, outputs, transforms };
  const resolve = Effect.fn("MedusaWorkflow.resolve")(function* (resolution: WorkflowResolution): Effect.fn.Return<unknown, Failure | ReturnType<typeof definitionError>> {
    const evaluation = resolveWorkflowValue(resolution, frame);
    let next = evaluation.next();
    while (!next.done) {
      const resolved = yield* port.capture(next.value.input);
      const transform = next.value.reference.transform;
      if (transform === undefined) return yield* Effect.fail(definitionError("invalidReference", "Missing transformer"));
      const output = yield* port.invoke(() => transform(resolved, port.context));
      const captured = yield* port.capture(output);
      next = evaluation.next(captured);
    }
    return yield* Effect.fromResult(next.value);
  });
  for (const [index, node] of definition.nodes.entries()) {
    if (node.guards.some(guard => outputs.get(guard) !== true)) {
      outputs.set(node.id, undefined);
      continue;
    }
    const resolution = definition.resolution.inputs[index]!;
    if (node.kind === "branchResult") { outputs.set(node.id, yield* resolve(resolution)); continue; }
    const input = yield* port.capture(yield* resolve(resolution));
    if (node.kind === "workflow") {
      const output = yield* executeFrame(node.workflow, input, port);
      outputs.set(node.id, yield* port.capture(output));
      continue;
    }
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
  if (root) yield* port.checkpoint;
  return yield* resolve(definition.resolution.result);
});
