import { Deferred, Effect, Result } from "effect";
import { StepResponse, stepCallbackOutput } from "./responses";
import { definitionError, type ParallelGroup, type StepExecutionContext } from "./model";
import { isPreparedWorkflow, type PreparedWorkflow } from "./definition";
import { prepareTransformResolution, resolveWorkflowValue, type WorkflowResolution, type WorkflowResolvedValue } from "./resolution";

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
  const undefinedStepOutputs = new Set<object>();
  const transforms = new Map<object, unknown>();
  const pendingTransforms = new Map<object, Deferred.Deferred<WorkflowResolvedValue, Failure | ReturnType<typeof definitionError>>>();
  const transformDependencies = new Map<object, Set<object>>();
  const frame = { owner: definition.owner, input, outputs, undefinedStepOutputs, transforms };
  const sharedTransform = (reference: object, parent: object | undefined, work: Effect.Effect<WorkflowResolvedValue, Failure | ReturnType<typeof definitionError>>) => Effect.suspend(() => {
    if (parent !== undefined) {
      const pending = [reference], seen = new Set<object>();
      while (pending.length !== 0) {
        const current = pending.pop()!;
        if (current === parent) return Effect.fail(definitionError("invalidReference", "Cyclic transform dependency"));
        if (seen.has(current)) continue;
        seen.add(current);
        pending.push(...transformDependencies.get(current) ?? []);
      }
      const dependencies = transformDependencies.get(parent) ?? new Set<object>();
      dependencies.add(reference); transformDependencies.set(parent, dependencies);
    }
    const existing = pendingTransforms.get(reference);
    if (existing !== undefined) return Deferred.await(existing);
    if (pendingTransforms.size >= 4096) return Effect.fail(definitionError("invalidReference", "Transform resolution bounds exceeded"));
    // Register synchronously before any sibling can suspend on this transform.
    // This cell belongs only to this invocation frame and retains its full Exit.
    const pending = Deferred.makeUnsafe<WorkflowResolvedValue, Failure | ReturnType<typeof definitionError>>();
    pendingTransforms.set(reference, pending);
    return Deferred.complete(pending, work).pipe(Effect.andThen(Deferred.await(pending)));
  });
  const resolve = Effect.fn("MedusaWorkflow.resolve")(function* (resolution: WorkflowResolution, parent?: object, depth = 0): Effect.fn.Return<WorkflowResolvedValue, Failure | ReturnType<typeof definitionError>> {
    const evaluation = resolveWorkflowValue(resolution, frame, depth);
    let next = evaluation.next();
    while (!next.done) {
      const request = next.value;
      const captured = yield* sharedTransform(request.reference, parent, Effect.gen(function* () {
        const resolvedInput = yield* port.capture(request.input);
        const transform = request.reference.transform;
        if (transform === undefined) return yield* Effect.fail(definitionError("invalidReference", "Missing transformer"));
        const output = yield* port.invoke(() => transform(resolvedInput, port.context));
        // Foreign Proxy descriptor traps belong to the same callback boundary
        // as transformer invocation. The initialized failure also refuses a
        // broken port that reports success without running its callback.
        let inspected: ReturnType<typeof prepareTransformResolution> = Result.fail(definitionError("invalidReference", "Transform result inspection did not complete"));
        yield* port.invoke(() => { inspected = prepareTransformResolution(output); });
        const returned = yield* Effect.fromResult(inspected);
        const resolved = yield* resolve(returned, request.reference, request.depth + 1);
        return { value: yield* port.capture(resolved.value), undefinedStepResult: resolved.undefinedStepResult };
      }));
      next = evaluation.next(captured);
    }
    return yield* Effect.fromResult(next.value);
  });
  const executeNode = Effect.fn("MedusaWorkflow.node")(function* (index: number): Effect.fn.Return<void, Failure | ReturnType<typeof definitionError>> {
    const node = definition.nodes[index]!;
    if (node.guards.some(guard => outputs.get(guard) !== true)) {
      outputs.set(node.id, undefined);
      return;
    }
    const resolution = definition.resolution.inputs[index]!;
    if (node.kind === "branchResult") {
      const resolved = yield* resolve(resolution);
      outputs.set(node.id, resolved.value);
      if (resolved.undefinedStepResult) undefinedStepOutputs.add(node.id);
      return;
    }
    const input = yield* port.capture((yield* resolve(resolution)).value);
    if (node.kind === "workflow") {
      const output = yield* executeFrame(node.workflow, input, port);
      outputs.set(node.id, yield* port.capture(output));
      // Native runAsStep wraps a child's result in StepResponse, including void.
      if (output === undefined) undefinedStepOutputs.add(node.id);
      return;
    }
    const returned = yield* port.invoke(() => {
      const value = node.invoke(input, port.context);
      if (node.kind !== "condition" || typeof value === "boolean") return value;
      const refuse = () => { throw definitionError("unsupportedProfile", "Conditions must synchronously return a Boolean"); };
      // Observe an invalid Promise through the same bounded callback owner;
      // neither a rejected Promise nor its completion can escape this invocation.
      return value instanceof Promise ? value.then(refuse, refuse) : refuse();
    });
    if (node.kind === "condition") { outputs.set(node.id, returned); return; }
    if (returned instanceof StepResponse) {
      const compensation = returned.compensateInput, output = returned.output;
      if (compensation === output) outputs.set(node.id, yield* port.capture(output));
      else {
        const captured = yield* port.capture({ output, compensation });
        if (typeof captured !== "object" || captured === null || !("output" in captured)) return yield* Effect.fail(definitionError("invalidReference", "Invalid captured step response"));
        outputs.set(node.id, captured.output);
      }
      if (output === undefined) undefinedStepOutputs.add(node.id);
    } else if (node.hook) {
      // The folded native get-hook-result step returns StepResponse(undefined)
      // for an absent result. It is distinct from a raw regular-step callback.
      outputs.set(node.id, yield* port.capture(returned));
      if (returned === undefined) undefinedStepOutputs.add(node.id);
    } else outputs.set(node.id, yield* port.capture(stepCallbackOutput(returned)));
  });
  const executeRange = Effect.fn("MedusaWorkflow.region")(function* (start: number, end: number, parent?: ParallelGroup): Effect.fn.Return<void, Failure | ReturnType<typeof definitionError>> {
    for (let index = start; index < end;) {
      // The outermost group starts first; a nested group is interpreted only
      // within its owning branch. Prepared intervals cannot partially overlap.
      const group = definition.parallel?.filter(group => group !== parent && group.branches[0]!.start === index && group.branches.at(-1)!.end <= end)
        .sort((left, right) => right.branches.at(-1)!.end - left.branches.at(-1)!.end)[0];
      if (group === undefined) { yield* executeNode(index); index++; continue; }
      yield* Effect.all(group.branches.map(branch => executeRange(branch.start, branch.end, group)), {
        concurrency: group.branches.length, discard: true,
      });
      index = group.branches.at(-1)!.end;
    }
  });
  yield* executeRange(0, definition.nodes.length);
  if (root) yield* port.checkpoint;
  return (yield* resolve(definition.resolution.result)).value;
});
