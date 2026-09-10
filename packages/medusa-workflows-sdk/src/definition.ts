import { Result } from "effect";
import { WorkflowResponse } from "./responses";
import { definitionError, WorkflowDefinitionError, type Compensate, type Hook, type HookHandlers, type Invoke, type Resolved, type StepExecutionContext, type StepOptions, type WorkflowData, type WorkflowNode } from "./model";
import { proxify, transformer, referenceOf } from "./references";
import type { StepFunction, StepOutput } from "./model";
import { OrchestratorBuilder } from "./orchestrator-builder";
import { workflowIdentity, type WorkflowIdentity } from "./identity";

interface Composer {
  readonly owner: object;
  readonly nodes: WorkflowNode[];
  readonly hooks: Set<string>;
  readonly pending: Set<object>;
  guards: readonly object[];
}
// Construction-only ambient state, restored even if a nested composer throws.
let current: Composer | undefined;
function composer(): Composer {
  if (current === undefined) throw definitionError("outsideComposer", "Use inside createWorkflow");
  return current;
}
function assertSynchronous(value: unknown): void {
  if (value instanceof Promise) {
    // Construction has no execution resources. Observe a rejected invalid
    // builder Promise while reporting the synchronous definition error once.
    void value.then(() => undefined, () => undefined);
    throw definitionError("invalidDefinition", "Composer callbacks must be synchronous");
  }
}
function options(value: string | StepOptions): StepOptions {
  const input = typeof value === "string" ? { name: value } : { ...value };
  if (typeof input.name !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(input.name) || Object.keys(input).some(key => !["name", "compensation"].includes(key)) ||
    (input.compensation !== undefined && input.compensation !== "transactionCovered")) throw definitionError("unsupportedProfile", "Only finite ordered atomic steps are admitted");
  return input;
}
function stage<Output>(context: Composer, node: WorkflowNode & { name: string }): StepOutput<Output> {
  context.nodes.push(node);
  const result = proxify<Output>({ kind: "step", owner: context.owner, step: node.id }, value => {
    if (current !== context) throw definitionError("outsideComposer", "Configure a step in its own active composer");
    const captured = captureDefinition(value, context.owner);
    if (typeof captured !== "object" || captured === null || Reflect.ownKeys(captured).length !== 1 || !("name" in captured) || typeof captured.name !== "string") {
      throw definitionError("unsupportedProfile", "Only an explicit step name can be configured");
    }
    node.name = options(captured.name).name;
  });
  // SAFETY: this root reference alone carries the authenticated configuration callback.
  return result as StepOutput<Output>;
}
export function createStep<Input, Output, Compensation = Output>(nameOrConfig: string | StepOptions,
  invoke: Invoke<Input, Output, Compensation>, compensate?: Compensate<Compensation>,
): StepFunction<Input, Output> {
  const config = options(nameOrConfig);
  if (compensate !== undefined && config.compensation !== "transactionCovered") throw definitionError("unsupportedProfile", "Compensation must be explicitly transaction covered");
  return input => {
    const context = composer();
    // SAFETY: the typed authoring edge binds Input/Output before type erasure in
    // the heterogeneous graph. The private runtime resolves this same edge.
    const node = { id: Object.freeze({}), kind: "step" as const, guards: context.guards,
      name: config.name, input: captureDefinition(input, context.owner), invoke: invoke as Invoke<unknown, unknown>,
      compensate: compensate as Compensate<unknown> | undefined, compensation: config.compensation, hook: false };
    return stage<Output>(context, node);
  };
}
type Transformer<Input, Output> = (value: Input, context: StepExecutionContext) => Output | Promise<Output>;
export function transform<Input, R1>(input: Input, fn1: Transformer<Resolved<Input>, R1>): WorkflowData<R1>;
export function transform<Input, R1, R2>(input: Input, fn1: Transformer<Resolved<Input>, R1>, fn2: Transformer<R1, R2>): WorkflowData<R2>;
export function transform<Input, R1, R2, R3>(input: Input, fn1: Transformer<Resolved<Input>, R1>, fn2: Transformer<R1, R2>, fn3: Transformer<R2, R3>): WorkflowData<R3>;
export function transform<Input, R1, R2, R3, R4>(input: Input, fn1: Transformer<Resolved<Input>, R1>, fn2: Transformer<R1, R2>, fn3: Transformer<R2, R3>, fn4: Transformer<R3, R4>): WorkflowData<R4>;
export function transform<Input, R1, R2, R3, R4, R5>(input: Input, fn1: Transformer<Resolved<Input>, R1>, fn2: Transformer<R1, R2>, fn3: Transformer<R2, R3>, fn4: Transformer<R3, R4>, fn5: Transformer<R4, R5>): WorkflowData<R5>;
export function transform<Input, R1, R2, R3, R4, R5, R6>(input: Input, fn1: Transformer<Resolved<Input>, R1>, fn2: Transformer<R1, R2>, fn3: Transformer<R2, R3>, fn4: Transformer<R3, R4>, fn5: Transformer<R4, R5>, fn6: Transformer<R5, R6>): WorkflowData<R6>;
export function transform<Input, R1, R2, R3, R4, R5, R6, R7>(input: Input, fn1: Transformer<Resolved<Input>, R1>, fn2: Transformer<R1, R2>, fn3: Transformer<R2, R3>, fn4: Transformer<R3, R4>, fn5: Transformer<R4, R5>, fn6: Transformer<R5, R6>, fn7: Transformer<R6, R7>): WorkflowData<R7>;
export function transform(input: unknown, ...functions: readonly unknown[]): WorkflowData<unknown> {
  const context = composer();
  if (functions.length < 1 || functions.length > 7 || functions.some(fn => typeof fn !== "function")) throw definitionError("unsupportedProfile", "Transform requires one to seven ordered functions");
  let staged: unknown = captureDefinition(input, context.owner);
  for (const fn of functions) {
    // SAFETY: the overloads bind each callback to its predecessor's result. The
    // heterogeneous graph erases those types only after checking callable values.
    staged = transformer(context.owner, staged, fn as Transformer<unknown, unknown>, context.guards);
  }
  // SAFETY: at least one transformer was constructed above.
  return staged as WorkflowData<unknown>;
}
export function createHook<const Name extends string, Input, Output = unknown>(name: Name, input: Input, options_: Record<string, never> = {}): Hook<Name, Input, Output> {
  if (Reflect.ownKeys(options_).length !== 0) throw definitionError("unsupportedProfile", "Hook validators require a separately admitted profile");
  const context = composer();
  if (context.hooks.has(name)) throw definitionError("duplicateHook", `Cannot define multiple hook handlers for the ${name} hook`);
  options(name);
  context.hooks.add(name);
  // No-op hook resolves to undefined in this profile, preserving getResult absence.
  const id = Object.freeze({});
  context.nodes.push({ id, kind: "step", guards: context.guards, name, input: captureDefinition(input, context.owner), invoke: () => undefined, compensate: undefined, compensation: undefined, hook: true });
  const result = proxify<Output | undefined>({ kind: "step", owner: context.owner, step: id });
  return Object.freeze({ name, getResult: () => result });
}
/** A finite construction-time region. Its predicate belongs to each invocation,
 * while both its steps and deferred transforms inherit the enclosing guards. */
export function when<Input>(name: string, input: Input, predicate: (input: Resolved<Input>) => boolean) {
  const context = composer();
  if (typeof name !== "string") throw definitionError("unsupportedProfile", "A condition requires a string name");
  options(name);
  if (typeof predicate !== "function") throw definitionError("invalidDefinition", "A condition requires a synchronous Boolean predicate");
  const id = Object.freeze({});
  const parents = context.guards;
  context.nodes.push({ id, kind: "condition", guards: parents, name, input: captureDefinition(input, context.owner),
    // SAFETY: the authoring signature binds the captured input before graph erasure.
    invoke: predicate as Invoke<unknown, unknown>, compensate: undefined, compensation: undefined, hook: false });
  context.pending.add(id);
  return Object.freeze({ then<Output>(build: () => Output & ([Extract<Output, PromiseLike<unknown>>] extends [never] ? unknown : never)): WorkflowData<Resolved<Output> | undefined> {
    if (current !== context || context.guards !== parents || !context.pending.delete(id) || typeof build !== "function") {
      throw definitionError("invalidDefinition", "Complete each condition once in its own composer region");
    }
    const guards = Object.freeze([...parents, id]);
    const resultId = Object.freeze({});
    try {
      context.guards = guards;
      const built = build();
      assertSynchronous(built);
      const result = captureDefinition(built, context.owner);
      context.nodes.push({ id: resultId, kind: "branchResult", guards, name: `$${name}`, input: result,
        invoke: value => value, compensate: undefined, compensation: undefined, hook: false });
    } finally { context.guards = parents; }
    return proxify({ kind: "step", owner: context.owner, step: resultId });
  } });
}
export interface PreparedWorkflow {
  readonly name: string;
  readonly owner: object;
  readonly nodes: readonly WorkflowNode[];
  readonly result: unknown;
  readonly nodeCount: number;
  readonly identity: WorkflowIdentity;
}
const preparedWorkflows = new WeakSet<object>();
/** Only SDK preparation establishes the frozen graph and reference ownership. */
export const isPreparedWorkflow = (value: unknown): value is PreparedWorkflow =>
  typeof value === "object" && value !== null && preparedWorkflows.has(value);
export interface WorkflowDefinition<Input, Output, Hooks extends readonly unknown[]> {
  readonly name: string;
  readonly prepare: (hooks?: HookHandlers<Hooks>, ...additional: readonly HookHandlers<Hooks>[]) => Result.Result<PreparedWorkflow, ReturnType<typeof definitionError>>;
  readonly runAsStep: (input: { readonly input: Input | WorkflowData<Input>; readonly hooks?: HookHandlers<Hooks> }) => StepOutput<Resolved<Output>>;
  readonly " input"?: Input;
  readonly " output"?: Output;
}
export function createWorkflow<Input, Output, const Hooks extends readonly unknown[]>(name: string,
  build: (input: Input) => WorkflowResponse<Output, Hooks>,
): WorkflowDefinition<Resolved<Input>, Output, Hooks> {
  if (typeof name !== "string") throw definitionError("unsupportedProfile", "Workflow configuration is not admitted in this atomic profile");
  options(name);
  const context: Composer = { owner: Object.freeze({}), nodes: [], hooks: new Set(), pending: new Set(), guards: Object.freeze([]) };
  const previous = current;
  let response: WorkflowResponse<Output, Hooks>;
  try {
    current = context;
    // SAFETY: the composer receives an authenticated staged input facade. Infer
    // its annotation directly so branded Boolean/union inputs retain all members.
    response = build(proxify({ kind: "input", owner: context.owner }) as Input);
    assertSynchronous(response);
    if (!(response instanceof WorkflowResponse)) throw definitionError("invalidDefinition", "The composer must synchronously return WorkflowResponse");
  } finally { current = previous; }
  if (context.pending.size !== 0) throw definitionError("invalidDefinition", "Every condition requires then");
  let nodeCount = 0;
  for (const node of context.nodes) {
    nodeCount += 1 + (node.kind === "workflow" ? node.workflow.nodeCount : 0);
    if (nodeCount > 64) throw definitionError("unsupportedProfile", "Too many workflow nodes");
  }
  const flow = new OrchestratorBuilder();
  const byName = new Map<string, WorkflowNode>();
  for (const node of context.nodes) {
    if (byName.has(node.name)) throw definitionError(node.kind !== "workflow" && node.hook ? "duplicateHook" : "duplicateStep", node.name);
    byName.set(node.name, node);
    flow.addAction(node.name);
  }
  const ordered: WorkflowNode[] = [];
  const available = new Set<object>();
  for (let step = flow.build(); step !== undefined; step = step.next) {
    const node = byName.get(step.action);
    if (node === undefined) throw definitionError("invalidDefinition", "Missing step handler");
    ordered.push(Object.freeze({ ...node, input: captureDefinition(node.input, context.owner, available) }));
    available.add(node.id);
  }
  const nodes = Object.freeze(ordered);
  const result = captureDefinition(response.$result, context.owner, available);
  const exposed = new Set((response.options?.hooks ?? []).map(hook => {
    if (typeof hook !== "object" || hook === null || !("name" in hook) || typeof hook.name !== "string" || !context.hooks.has(hook.name)) throw definitionError("invalidDefinition", "Unknown exposed hook");
    return hook.name;
  }));
  const prepare: WorkflowDefinition<Resolved<Input>, Output, Hooks>["prepare"] = (hooks = {}, ...additional) => Result.try({
    try: () => {
      const registered = new Map<string, unknown>();
      for (const registration of [hooks, ...additional]) {
        if (Object.getPrototypeOf(registration) !== Object.prototype && Object.getPrototypeOf(registration) !== null) throw definitionError("invalidDefinition", "Hooks must be an own-property record");
        for (const key of Reflect.ownKeys(registration)) {
          const property = Object.getOwnPropertyDescriptor(registration, key);
          if (typeof key !== "string" || property === undefined || !("value" in property) || !property.enumerable || !exposed.has(key)) throw definitionError("invalidDefinition", "Unknown hook or invalid hook property");
          if (registered.has(key)) throw definitionError("duplicateHook", `Cannot define multiple hook handlers for the ${key} hook`);
          registered.set(key, property.value);
        }
      }
      const bound = nodes.map(node => {
        const handler = registered.get(node.name);
        if (node.kind === "workflow" || !node.hook || handler === undefined) return node;
        if (typeof handler !== "function") throw definitionError("invalidDefinition", `Invalid hook ${node.name}`);
        // SAFETY: HookHandlers binds this handler to the named declaration's input.
        return Object.freeze({ ...node, invoke: handler as Invoke<unknown, unknown>, boundHook: true });
      });
      const prepared = Object.freeze({ name, owner: context.owner, nodes: Object.freeze(bound), result, nodeCount,
        identity: workflowIdentity(name, bound, result) });
      preparedWorkflows.add(prepared);
      return prepared;
    },
    catch: cause => cause instanceof WorkflowDefinitionError ? cause : definitionError("invalidDefinition", "Invalid hook registration"),
  });
  const definition: WorkflowDefinition<Resolved<Input>, Output, Hooks> = Object.freeze({ name, prepare,
    runAsStep: (input: { readonly input: Resolved<Input> | WorkflowData<Resolved<Input>>; readonly hooks?: HookHandlers<Hooks> }) => {
      const context = composer();
      // Unlike definition data, this boundary deliberately accepts hook functions.
      // Inspect descriptors before extracting either input or registration data.
      if (typeof input !== "object" || input === null || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) {
        throw definitionError("invalidDefinition", "A child call requires an input record");
      }
      const values = new Map<string, unknown>();
      for (const key of Reflect.ownKeys(input)) {
        const property = Object.getOwnPropertyDescriptor(input, key);
        if (typeof key !== "string" || !["input", "hooks"].includes(key) || property === undefined || !("value" in property) || !property.enumerable) {
          throw definitionError("invalidDefinition", "Unsupported child call property");
        }
        values.set(key, property.value);
      }
      if (!values.has("input")) throw definitionError("invalidDefinition", "A child call requires input");
      const captured = captureDefinition(values.get("input"), context.owner);
      // SAFETY: prepare performs full own-property and callable validation of this
      // hook compatibility boundary; the generic signature binds declared hooks.
      const child = Result.getOrThrow(prepare(values.get("hooks") as HookHandlers<Hooks> | undefined));
      // The generated suffix is bounded by the already checked workflow name;
      // it must also work for a name at the authoring limit. Explicit config
      // names retain the ordinary step-name contract.
      return stage<Resolved<Output>>(context, { id: Object.freeze({}), kind: "workflow", guards: context.guards,
        name: `${name}-as-step`, input: captured, workflow: child });
    },
  });
  return definition;
}

/** Capture definition literals while preserving authentic staged references. */
function captureDefinition(value: unknown, owner: object, available?: ReadonlySet<object>): unknown {
  let visited = 0;
  const active = new Set<object>();
  function capture(value: unknown, depth: number): unknown {
    if (++visited > 4096 || depth > 64) throw definitionError("invalidDefinition", "Definition bounds exceeded");
    const reference = referenceOf(value);
    if (reference !== undefined) {
      if (reference.owner !== owner) throw definitionError("invalidReference", "Reference belongs to another workflow");
      if (available !== undefined) {
        if (reference.kind === "step" && (reference.step === undefined || !available.has(reference.step))) throw definitionError("invalidReference", "Reference precedes its step");
        if (reference.guards?.some(guard => !available.has(guard))) throw definitionError("invalidReference", "Reference precedes its condition");
        if (reference.kind === "transform" || reference.kind === "property") capture(reference.input, depth + 1);
      }
      return value;
    }
    if (value === undefined || value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
    if (typeof value !== "object" || active.has(value)) throw definitionError("invalidDefinition", "Unsupported or cyclic definition literal");
    const array = Array.isArray(value);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw definitionError("invalidDefinition", "Definition literals must be plain records");
    active.add(value);
    const entries: [string, unknown][] = [];
    for (const key of Reflect.ownKeys(value)) {
      if (array && key === "length") continue;
      const property = Object.getOwnPropertyDescriptor(value, key);
      if (typeof key !== "string" || property === undefined || !("value" in property) || !property.enumerable || (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))) throw definitionError("invalidDefinition", "Invalid definition data property");
      entries.push([key, capture(property.value, depth + 1)]);
    }
    active.delete(value);
    if (array) {
      if (entries.length !== value.length) throw definitionError("invalidDefinition", "Sparse definition arrays are unsupported");
      return Object.freeze(entries.map(([, member]) => member));
    }
    return Object.freeze(Object.fromEntries(entries));
  }
  return capture(value, 0);
}
