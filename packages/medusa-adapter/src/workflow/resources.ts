import { Result } from "effect";
import type { Invoke, StepExecutionContext, WorkflowContainer } from "@medusajs/workflows-sdk";
import { defineAtomicCommerceParticipant, type AtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LocalGraphResult } from "../local-graph/model";
import { captureCommerceInput } from "../commerce-input";
import { captureWorkflowRecord, isWorkflowResourceName } from "./configuration";
import { workflowMethodDefinition, workflowModuleDefinition, type BoundWorkflowMethod, type WorkflowModule, type WorkflowModuleMethods } from "./module";

export interface WorkflowModuleSelection {
  readonly module: WorkflowModule;
  readonly methods: readonly string[];
  readonly graph: boolean;
}
export type WorkflowSelections = Readonly<Record<string, WorkflowModuleSelection>>;
type IsUnion<Value, Whole = Value> = Value extends Whole ? [Whole] extends [Value] ? false : true : never;
type StaticMethods<Names extends readonly string[]> = number extends Names["length"] ? never
  : true extends IsUnion<Names> ? never
  : { readonly [Key in keyof Names]: true extends IsUnion<Names[Key]> ? never : Names[Key] };
type CheckedSelections<Selections extends WorkflowSelections> = {
  readonly [Key in keyof Selections]: Selections[Key] & { readonly methods: StaticMethods<Selections[Key]["methods"]> & readonly (keyof WorkflowModuleMethods<Selections[Key]["module"]> & string)[] };
};
type GraphKeys<Selections extends WorkflowSelections> = { [Key in keyof Selections]: Selections[Key]["graph"] extends true ? Key : never }[keyof Selections];
export type NativeWorkflowResources<Selections extends WorkflowSelections, Events extends boolean> = {
  readonly [Key in keyof Selections as Selections[Key]["methods"][number] extends never ? never : Key]: {
    readonly [Method in Selections[Key]["methods"][number]]: BoundWorkflowMethod<WorkflowModuleMethods<Selections[Key]["module"]>[Method]>;
  };
} & ([GraphKeys<Selections>] extends [never] ? {} : { readonly query: { readonly graph: (input: unknown) => Promise<LocalGraphResult> } })
  & (Events extends true ? { readonly event_bus: { readonly emit: (messages: readonly Json[]) => Promise<void> } } : {});
export type NativeWorkflowContext<Resources> = StepExecutionContext & { readonly resources: Resources };
export type NativeWorkflowHooks<Hooks, Resources> = {
  readonly [Key in keyof Hooks]: NonNullable<Hooks[Key]> extends (input: infer Input, context: StepExecutionContext) => infer Output
    ? (input: Input, context: NativeWorkflowContext<Resources>) => Output : never;
};
export interface PreparedWorkflowResources<Resources = unknown> {
  readonly events: boolean;
  readonly callback: <Input, Output, Compensation = Output>(work: (input: Input, context: NativeWorkflowContext<Resources>) => ReturnType<Invoke<Input, Output, Compensation>>) => Invoke<Input, Output, Compensation>;
  readonly hooks: <Hooks extends object>(input: NativeWorkflowHooks<Hooks, Resources>) => Result.Result<Hooks, CommerceTransactionError>;
}
export interface PreparedWorkflowSelection extends WorkflowModuleSelection {
  readonly name: string;
  readonly participant: AtomicCommerceParticipant;
}
const selections = new WeakMap<object, readonly PreparedWorkflowSelection[]>();
const contexts = new WeakMap<WorkflowContainer, { readonly selection: object; readonly resources: unknown; readonly reject: (error: CommerceTransactionError) => never }>();

/** A definition-scoped resource selection. Multiple hosts may prepare the same
 * selection; actual objects only exist during one execution's owned lifetime. */
export function prepareWorkflowResources<const Selections extends WorkflowSelections, const Events extends boolean>(
  input: CheckedSelections<Selections>, events: Events,
): Result.Result<PreparedWorkflowResources<NativeWorkflowResources<Selections, Events>>, CommerceTransactionError> {
  return Result.gen(function* () {
    const record = yield* captureWorkflowRecord(input);
    if (typeof events !== "boolean") return yield* Result.fail(commerceError("unsupportedProfile"));
    const captured: PreparedWorkflowSelection[] = [];
    const seen = new Set<WorkflowModule>();
    for (const [name, member] of Object.entries(record)) {
      const selected = yield* captureWorkflowRecord(member);
      if (!isWorkflowResourceName(name) || ["query", "event_bus"].includes(name) || typeof selected.graph !== "boolean"
        || workflowModuleDefinition(selected.module) === undefined || seen.has(selected.module)) return yield* Result.fail(commerceError("unsupportedProfile"));
      seen.add(selected.module);
      const names = yield* captureCommerceInput(selected.methods);
      if (!Array.isArray(names) || names.some(key => typeof key !== "string" || !Object.hasOwn(selected.module.methods, key))
        || new Set(names).size !== names.length || (!selected.graph && names.length === 0)) return yield* Result.fail(commerceError("unsupportedProfile"));
      for (const key of names) {
        const method = typeof key === "string" ? selected.module.methods[key] : undefined;
        if (method === undefined || workflowMethodDefinition(method) === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      }
      captured.push(Object.freeze({ name, module: selected.module, graph: selected.graph,
        methods: Object.freeze(names.filter((name): name is string => typeof name === "string")), participant: defineAtomicCommerceParticipant(name),
      }));
    }
    type Resources = NativeWorkflowResources<Selections, Events>;
    const context = (ctx: StepExecutionContext): NativeWorkflowContext<Resources> => {
      const bound = contexts.get(ctx.container);
      if (bound === undefined) throw commerceError("invalidAuthority");
      if (bound.selection !== result) return bound.reject(commerceError("invalidAuthority"));
      // SAFETY: the shared binder constructs exactly this authentic selection's
      // methods. The token check prevents a callback receiving another view.
      return { ...ctx, resources: bound.resources as Resources };
    };
    const result: PreparedWorkflowResources<Resources> = Object.freeze({ events,
      callback: <Input, Output, Compensation>(work: (input: Input, context: NativeWorkflowContext<Resources>) => ReturnType<Invoke<Input, Output, Compensation>>): Invoke<Input, Output, Compensation> =>
        (input, ctx) => work(input, context(ctx)),
      hooks: <Hooks extends object>(input: NativeWorkflowHooks<Hooks, Resources>) => captureWorkflowRecord(input).pipe(Result.flatMap(hooks => {
        const adapted: Array<[string, (input: unknown, ctx: StepExecutionContext) => unknown]> = [];
        for (const [name, handler] of Object.entries(hooks)) {
          if (typeof handler !== "function") return Result.fail(commerceError("unsupportedProfile"));
          adapted.push([name, (input, ctx) => handler(input, context(ctx))]);
        }
        // SAFETY: keys and callbacks correspond exactly to the mapped Hooks type;
        // only the context is extended with this selection's checked resources.
        return Result.succeed(Object.freeze(Object.fromEntries(adapted)) as Hooks);
      })),
    });
    selections.set(result, Object.freeze(captured));
    return result;
  });
}

export const workflowResourceSelections = (resources: PreparedWorkflowResources) => selections.get(resources);
export function registerWorkflowResourceContext(container: WorkflowContainer, selection: PreparedWorkflowResources, resources: unknown,
  reject: (error: CommerceTransactionError) => never) {
  contexts.set(container, { selection, resources, reject });
  return () => contexts.delete(container);
}
