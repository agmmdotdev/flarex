import { Result } from "effect";
import { WorkflowResponse } from "./responses";
import { definitionError, WorkflowDefinitionError, type Compensate, type Hook, type HookHandlers, type Invoke, type Resolved, type StepExecutionContext, type StepOptions, type WorkflowData, type WorkflowNode } from "./model";
import { proxify, transformer, referenceOf } from "./references";
import type { StepFunction } from "./model";
import { OrchestratorBuilder } from "./orchestrator-builder";

interface Composer { readonly owner: object; readonly nodes: Map<string, WorkflowNode>; readonly flow: OrchestratorBuilder; readonly hooks: Set<string> }
// Construction-only ambient state, restored even if a nested composer throws.
let current: Composer | undefined;
function composer(): Composer {
  if (current === undefined) throw definitionError("outsideComposer", "Use inside createWorkflow");
  return current;
}
function options(value: string | StepOptions): StepOptions {
  const input = typeof value === "string" ? { name: value } : { ...value };
  if (!/^[a-zA-Z][a-zA-Z0-9_-]{0,127}$/.test(input.name) || Object.keys(input).some(key => !["name", "compensation"].includes(key)) ||
    (input.compensation !== undefined && input.compensation !== "transactionCovered")) throw definitionError("unsupportedProfile", "Only finite ordered atomic steps are admitted");
  return input;
}
export function createStep<Input, Output, Compensation = Output>(nameOrConfig: string | StepOptions,
  invoke: Invoke<Input, Output, Compensation>, compensate?: Compensate<Compensation>,
): StepFunction<Input, Output> {
  const config = options(nameOrConfig);
  if (compensate !== undefined && config.compensation !== "transactionCovered") throw definitionError("unsupportedProfile", "Compensation must be explicitly transaction covered");
  return input => {
    const context = composer();
    if (context.nodes.has(config.name)) throw definitionError("duplicateStep", config.name);
    // SAFETY: the typed authoring edge binds Input/Output before type erasure in
    // the heterogeneous graph. The private runtime resolves this same edge.
    context.nodes.set(config.name, { name: config.name, input, invoke: invoke as Invoke<unknown, unknown>,
      compensate: compensate as Compensate<unknown> | undefined, compensation: config.compensation, hook: false });
    context.flow.addAction(config.name);
    return proxify({ kind: "step", owner: context.owner, step: config.name });
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
    staged = transformer(context.owner, staged, fn as Transformer<unknown, unknown>);
  }
  // SAFETY: at least one transformer was constructed above.
  return staged as WorkflowData<unknown>;
}
export function createHook<const Name extends string, Input, Output = unknown>(name: Name, input: Input, options_: Record<string, never> = {}): Hook<Name, Input, Output> {
  if (Reflect.ownKeys(options_).length !== 0) throw definitionError("unsupportedProfile", "Hook validators require a separately admitted profile");
  const context = composer();
  if (context.hooks.has(name) || context.nodes.has(name)) throw definitionError("duplicateHook", `Cannot define multiple hook handlers for the ${name} hook`);
  options(name);
  context.hooks.add(name);
  // No-op hook resolves to undefined in this profile, preserving getResult absence.
  context.nodes.set(name, { name, input, invoke: () => undefined, compensate: undefined, compensation: undefined, hook: true });
  context.flow.addAction(name);
  const result = proxify<Output | undefined>({ kind: "step", owner: context.owner, step: name });
  return Object.freeze({ name, getResult: () => result });
}
export interface PreparedWorkflow {
  readonly name: string;
  readonly owner: object;
  readonly nodes: readonly WorkflowNode[];
  readonly result: unknown;
}
export interface WorkflowDefinition<Input, Output, Hooks extends readonly unknown[]> {
  readonly name: string;
  readonly prepare: (hooks?: HookHandlers<Hooks>, ...additional: readonly HookHandlers<Hooks>[]) => Result.Result<PreparedWorkflow, ReturnType<typeof definitionError>>;
  readonly " input"?: Input;
  readonly " output"?: Output;
}
export function createWorkflow<Input, Output, const Hooks extends readonly unknown[]>(name: string,
  build: (input: WorkflowData<Input>) => WorkflowResponse<Output, Hooks>,
): WorkflowDefinition<Input, Output, Hooks> {
  if (typeof name !== "string") throw definitionError("unsupportedProfile", "Workflow configuration is not admitted in this atomic profile");
  options(name);
  const context: Composer = { owner: Object.freeze({}), nodes: new Map(), flow: new OrchestratorBuilder(), hooks: new Set() };
  const previous = current;
  let response: WorkflowResponse<Output, Hooks>;
  try {
    current = context;
    response = build(proxify({ kind: "input", owner: context.owner }));
    if (!(response instanceof WorkflowResponse)) throw definitionError("invalidDefinition", "The composer must synchronously return WorkflowResponse");
  } finally { current = previous; }
  if (context.nodes.size > 64) throw definitionError("unsupportedProfile", "Too many workflow steps");
  const ordered: WorkflowNode[] = [];
  for (let step = context.flow.build(); step !== undefined; step = step.next) {
    const node = context.nodes.get(step.action);
    if (node === undefined) throw definitionError("invalidDefinition", "Missing step handler");
    ordered.push(Object.freeze({ ...node, input: captureDefinition(node.input, context.owner) }));
  }
  const nodes = Object.freeze(ordered);
  const result = captureDefinition(response.$result, context.owner);
  const exposed = new Set((response.options?.hooks ?? []).map(hook => {
    if (typeof hook !== "object" || hook === null || !("name" in hook) || typeof hook.name !== "string" || !context.hooks.has(hook.name)) throw definitionError("invalidDefinition", "Unknown exposed hook");
    return hook.name;
  }));
  const prepare: WorkflowDefinition<Input, Output, Hooks>["prepare"] = (hooks = {}, ...additional) => Result.try({
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
        if (!node.hook || handler === undefined) return node;
        if (typeof handler !== "function") throw definitionError("invalidDefinition", `Invalid hook ${node.name}`);
        // SAFETY: HookHandlers binds this handler to the named declaration's input.
        return Object.freeze({ ...node, invoke: handler as Invoke<unknown, unknown> });
      });
      return Object.freeze({ name, owner: context.owner, nodes: Object.freeze(bound), result });
    },
    catch: cause => cause instanceof WorkflowDefinitionError ? cause : definitionError("invalidDefinition", "Invalid hook registration"),
  });
  return Object.freeze({ name, prepare });
}

/** Capture definition literals while preserving authentic staged references. */
function captureDefinition(value: unknown, owner: object): unknown {
  let visited = 0;
  const active = new Set<object>();
  function capture(value: unknown, depth: number): unknown {
    if (++visited > 4096 || depth > 64) throw definitionError("invalidDefinition", "Definition bounds exceeded");
    const reference = referenceOf(value);
    if (reference !== undefined) {
      if (reference.owner !== owner) throw definitionError("invalidReference", "Reference belongs to another workflow");
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
