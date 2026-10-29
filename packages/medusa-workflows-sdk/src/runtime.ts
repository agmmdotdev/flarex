import { Deferred, Effect, Result } from "effect";
import { StepResponse, stepCallbackOutput } from "./responses";
import { SkipStepResponse } from "@medusajs/orchestration/transaction/errors";
import { definitionError, type ParallelGroup, type StepExecutionContext, type WorkflowContainer } from "./model";
import { isPreparedWorkflow, type PreparedWorkflow } from "./definition";
import { prepareTransformResolution, resolveWorkflowValue, type WorkflowResolution, type WorkflowResolvedValue } from "./resolution";
import { bindCallbackContainer, callbackWorkflowInput } from "./callback-binding";

export interface WorkflowExecutionPort<Failure> {
  /** Explicit compatibility disposition supplied only by the trusted caller.
   * It promises one durable atomic outcome, not native step checkpoints or TTL. */
  readonly storedWorkflowPolicy?: "atomicRootOutcome";
  readonly checkpoint: Effect.Effect<void, Failure>;
  /** Check the current execution lifetime, validate/charge the value and return
   * an owned copy. Native capture already performs this owner's checkpoint. */
  readonly capture: (value: unknown) => Effect.Effect<unknown, Failure>;
  readonly invoke: (work: () => unknown | Promise<unknown>) => Effect.Effect<unknown, Failure>;
  /** The existing foreign callback owner runs and drains borrowed child effects.
   * Failures must remain sticky even when native code catches the rejection. */
  readonly runChild?: <Value>(work: Effect.Effect<Value, Failure | ReturnType<typeof definitionError>>) => Promise<Value>;
  readonly refuseCallback?: (error: ReturnType<typeof definitionError>) => never;
  /** Trusted host preserves its resource-selection evidence on a borrowed view.
   * The returned cleanup removes that evidence when this callback settles. */
  readonly bindCallbackResources?: (container: WorkflowContainer) => () => void;
  readonly context: StepExecutionContext;
}
/** Fork of reference/transform/response execution, with a caller-owned runtime.
 * There is no distributed transaction, scheduler, local registry or compensating commit. */
export const executeWorkflow = Effect.fn("MedusaWorkflow.execute")(function <Failure>(
  definition: PreparedWorkflow, input: unknown, port: WorkflowExecutionPort<Failure>,
) {
  if (!isPreparedWorkflow(definition)) return Effect.fail(definitionError("invalidDefinition", "Workflow was not prepared by this SDK"));
  if (port.runChild !== undefined && port.refuseCallback === undefined)
    return Effect.fail(definitionError("unsupportedProfile", "Callback children require their owning synchronous refusal boundary"));
  // Check the complete child closure before invoking any parent callback.
  const pending = [definition];
  while (pending.length !== 0) {
    const current = pending.pop()!;
    if (current.identity.store === true && port.storedWorkflowPolicy !== "atomicRootOutcome")
      return Effect.fail(definitionError("unsupportedProfile", "Stored declarations require the explicit atomic outcome profile"));
    for (const node of current.nodes) {
      if (node.kind === "workflow") pending.push(node.workflow);
      else if (node.invokedWorkflows !== undefined) {
        if (port.runChild === undefined) return Effect.fail(definitionError("unsupportedProfile", "Callback children require the owning Promise runner"));
        pending.push(...node.invokedWorkflows.map(child => child.workflow));
      }
    }
  }
  return executeFrame(definition, input, port, true);
});
/** Child frames borrow the root port; only their evaluation caches are local. */
const executeFrame = Effect.fn("MedusaWorkflow.frame")(function* <Failure>(
  definition: PreparedWorkflow, input: unknown, port: WorkflowExecutionPort<Failure>, root = false, framePath: readonly number[] = [],
  parentStepIdempotencyKey?: string,
): Effect.fn.Return<unknown, Failure | ReturnType<typeof definitionError>> {
  const outputs = new Map<object, unknown>();
  const undefinedStepOutputs = new Set<object>();
  const hookResponses = new Set<object>();
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
    let resolvedInput = (yield* resolve(resolution)).value;
    if (node.kind !== "workflow" && node.hookResult !== undefined) {
      const handler = definition.nodes.find(candidate => candidate.id === node.hookResult?.handler);
      if (handler === undefined || handler.kind === "workflow" || !handler.hook || handler.hookValidator !== node.hookResult.validator)
        return yield* Effect.fail(definitionError("invalidDefinition", "Unknown native hook result handler"));
      if (handler.boundHook !== true) {
        // Native NOOP is internal state, not user data or a parse argument.
        outputs.set(node.id, yield* port.capture(undefined));
        undefinedStepOutputs.add(node.id);
        return;
      }
      // Native getStepResult reads the stored callback wrapper's .output. A
      // genuine StepResponse contributes its forward output; a raw callback
      // contributes only its own output member, usually undefined.
      if (!hookResponses.has(handler.id)) resolvedInput = typeof resolvedInput === "object" && resolvedInput !== null && "output" in resolvedInput
        ? resolvedInput.output : undefined;
    }
    const input = yield* port.capture(resolvedInput);
    if (node.kind === "workflow") {
      const output = yield* executeFrame(node.workflow, input, port, false, [...framePath, index],
        JSON.stringify([port.context.eventGroupId, ...framePath, index]));
      outputs.set(node.id, yield* port.capture(output));
      // Native runAsStep wraps a child's result in StepResponse, including void.
      if (output === undefined) undefinedStepOutputs.add(node.id);
      return;
    }
    const { parentStepIdempotencyKey: _suppliedParent, ...baseContext } = port.context;
    const invocationKey = JSON.stringify([port.context.eventGroupId, ...framePath, index]);
    const runChild = port.runChild;
    const refuseCallback = port.refuseCallback;
    const used = new Set<object>();
    let live = true;
    let pendingChildren = 0;
    const binding = runChild === undefined || refuseCallback === undefined ? undefined : bindCallbackContainer(baseContext.container, (child, options) => {
      if (!live) return runChild(Effect.fail(definitionError("unsupportedProfile", "Callback child binding has expired")));
      const position = node.invokedWorkflows?.findIndex(candidate => candidate.definition === child) ?? -1;
      const declared = node.invokedWorkflows?.[position];
      const work = declared === undefined || used.has(child)
        ? Effect.fail(definitionError("unsupportedProfile", "Undeclared, repeated or invalid callback child invocation"))
        : Effect.gen(function* () {
          const childInput = yield* port.invoke(() => callbackWorkflowInput(options));
          const captured = yield* port.capture(childInput);
          const result = yield* executeFrame(declared.workflow, captured, port, false, [...framePath, index, position], invocationKey);
          return { result: yield* port.capture(result) };
        });
      used.add(child);
      pendingChildren++;
      const pending = runChild(work);
      // Observe even an intentionally unawaited foreign Promise. The runner
      // retains its complete failure and cleanup responsibility.
      void pending.then(() => { pendingChildren--; }, () => { pendingChildren--; });
      return pending;
    }, refuseCallback);
    const context: StepExecutionContext = Object.freeze({ ...baseContext,
      ...(binding === undefined ? {} : { container: binding.container }),
      ...(parentStepIdempotencyKey === undefined ? {} : { parentStepIdempotencyKey }),
      idempotencyKey: invocationKey });
    const releaseResources = binding === undefined ? undefined : port.bindCallbackResources?.(binding.container);
    const returned = yield* port.invoke(() => {
      const value = node.invoke(input, context);
      if (node.kind !== "condition" || typeof value === "boolean") return value;
      const refuse = () => { throw definitionError("unsupportedProfile", "Conditions must synchronously return a Boolean"); };
      // Observe an invalid Promise through the same bounded callback owner;
      // neither a rejected Promise nor its completion can escape this invocation.
      return value instanceof Promise ? value.then(refuse, refuse) : refuse();
    }).pipe(Effect.ensuring(Effect.sync(() => { live = false; binding?.revoke(); releaseResources?.(); })));
    if (pendingChildren !== 0) return yield* Effect.fail(definitionError("unsupportedProfile", "Callback returned with unfinished child workflows"));
    if (node.kind === "condition") { outputs.set(node.id, returned); return; }
    if (returned instanceof SkipStepResponse) {
      // A genuine native skip publishes no response/compensation payload. A
      // name-matching foreign Error remains ordinary unsupported callback data.
      outputs.set(node.id, undefined);
      undefinedStepOutputs.add(node.id);
      return;
    }
    if (returned instanceof StepResponse) {
      if (node.hook) hookResponses.add(node.id);
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
