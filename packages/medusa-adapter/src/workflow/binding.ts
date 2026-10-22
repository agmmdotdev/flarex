import { Effect, Result, Schema } from "effect";
import type { WorkflowContainer } from "@medusajs/workflows-sdk";
import type { AtomicCommerceContext, CommerceEventContract } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { requireAtomicCommerceScopeExclusion } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, CommerceTransactionError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommercePromiseOwner } from "../module/promise-owner";
import { captureCommerceInput } from "../value/input";
import type { PreparedLocalGraph } from "../local-graph/model";
import { registerWorkflowResourceContext, workflowComposedResources, workflowAbsentResources, type PreparedWorkflowResources, type PreparedWorkflowSelection } from "./resources";
import { workflowMethodDefinition, workflowModuleDefinition, type WorkflowMethod } from "./module";
import { composedWorkflowResourceDefinition, type InvokeWorkflowMethod } from "./composed-resource";
import { checkedCommerceValue } from "../value/checked";
import { commerceDecoder } from "../value/decoder";
import { bindWorkflowQuery } from "./query";

export interface WorkflowEventDefinition {
  readonly name: string;
  readonly pendingCancellation?: true;
  readonly decode: (value: unknown) => Result.Result<Json, CommerceTransactionError>;
}
export interface BoundWorkflowEvent extends WorkflowEventDefinition { readonly contract: CommerceEventContract }

const decodeGroupedClear = commerceDecoder(Schema.Tuple([Schema.String,
  Schema.Struct({ eventNames: Schema.Tuple([Schema.String]) }),
]), "unadmittedEvent");
const decodeResolveOptions = commerceDecoder(Schema.Struct({ allowUnregistered: Schema.Literal(true) }), "unsupportedProfile");

/** Missing native methods refuse on invocation. Reflection and protocol probes
 * remain inert; the target still exposes only the admitted own properties. */
function scopedResource(methods: object, owner: CommercePromiseOwner): object {
  const refuse = () => owner.reject(commerceError("unsupportedProfile"));
  return new Proxy(Object.freeze(methods), {
    get(target, key, receiver) {
      if (Reflect.has(target, key)) return Reflect.get(target, key, receiver);
      if (typeof key !== "string" || key === "then" || key === "toJSON") return undefined;
      return refuse;
    },
  });
}

/** This is the sole Promise facade for admitted workflow resources. It owns no
 * manager and invokes only the supplied root's authentic commands/graph/events. */
export function bindWorkflowResources(selection: PreparedWorkflowResources, members: readonly PreparedWorkflowSelection[],
  graph: PreparedLocalGraph | undefined, events: readonly BoundWorkflowEvent[], ctx: AtomicCommerceContext, owner: CommercePromiseOwner): WorkflowContainer {
  const entries: [string, object][] = [];
  const invocations = new Map<WorkflowMethod, (...args: unknown[]) => Promise<unknown>>();
  for (const member of members) {
    const definition = workflowModuleDefinition(member.module);
    if (definition === undefined) return owner.reject(commerceError("invalidAuthority"));
    if (member.methods.length === 0) continue;
    const methods: Array<[string, (...args: unknown[]) => Promise<unknown>]> = [];
    for (const name of member.methods) {
      const token = member.module.methods[name];
      const method = token === undefined ? undefined : workflowMethodDefinition(token);
      if (token === undefined || method === undefined) return owner.reject(commerceError("invalidAuthority"));
      const invoke = (...args: unknown[]) => owner.run(Effect.gen(function* () {
        const input = yield* checkedCommerceValue(ctx, () => method.input(args));
        const result = yield* ctx.call(member.participant, method.command, input);
        return yield* checkedCommerceValue(ctx, () => method.output(result));
      }));
      invocations.set(token, invoke);
      methods.push([name, invoke]);
    }
    if (member.expose !== false) entries.push([member.name, scopedResource(Object.fromEntries(methods), owner)]);
  }
  for (const member of workflowComposedResources(selection) ?? []) {
    const definition = composedWorkflowResourceDefinition(member.resource);
    if (!definition) return owner.reject(commerceError("invalidAuthority"));
    const allowed = new Set(definition.dependencies);
    // SAFETY: authentic method tokens retain their exact argument/output ABI;
    // the existing per-method binder validates both sides of every invocation.
    const invoke: InvokeWorkflowMethod = ((method: WorkflowMethod, ...args: unknown[]) => {
      const bound = invocations.get(method);
      return allowed.has(method) && bound ? bound(...args) : owner.reject(commerceError("invalidAuthority"));
    }) as InvokeWorkflowMethod;
    const service = definition.bind(invoke);
    const methods: [string, (...args: unknown[]) => Promise<unknown>][] = [];
    for (const [name, contract] of Object.entries(definition.methods)) {
      const handler = Object.getOwnPropertyDescriptor(service, name)?.value;
      if (typeof handler !== "function") return owner.reject(commerceError("unsupportedProfile"));
      methods.push([name, (...args) => owner.run(Effect.gen(function* () {
        if (definition.scopeExclusive) yield* requireAtomicCommerceScopeExclusion(ctx);
        const input = yield* checkedCommerceValue(ctx, () => contract.arguments(args));
        const value: unknown = yield* owner.invoke(() => Promise.resolve(handler(...input)));
        return yield* checkedCommerceValue(ctx, () => captureCommerceInput(value).pipe(Result.flatMap(contract.output)));
      }))]);
    }
    entries.push([member.name, scopedResource(Object.fromEntries(methods), owner)]);
  }
  if (graph !== undefined) {
    const query = scopedResource(bindWorkflowQuery(graph, ctx, owner), owner);
    entries.push(["query", query], ["remoteQuery", query]);
  }
  if (selection.events) {
    const contracts = new Map(events.map(event => [event.name, event]));
    entries.push(["event_bus", scopedResource({
      emit: (input: unknown) => owner.run(Effect.gen(function* () {
        const messages = yield* checkedCommerceValue(ctx, () => captureCommerceInput(input));
        if (!Array.isArray(messages)) return yield* ctx.refuse(commerceError("unadmittedEvent"));
        for (const message of messages) {
          const contract = isJsonObject(message) && typeof message.name === "string" ? contracts.get(message.name) : undefined;
          if (contract === undefined) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          const decoded = yield* checkedCommerceValue(ctx, () => contract.decode(message));
          if (!isJsonObject(decoded) || decoded.name !== contract.name || decoded.metadata === undefined || !isJsonObject(decoded.metadata)
            || decoded.metadata.eventGroupId !== ctx.eventGroupId) return yield* ctx.refuse(commerceError("unadmittedEvent"));
          yield* ctx.emit(contract.contract, decoded);
        }
      })),
      clearGroupedEvents: (...args: unknown[]) => owner.run(Effect.gen(function* () {
        const [group, options] = yield* checkedCommerceValue(ctx, () => captureCommerceInput(args).pipe(Result.flatMap(decodeGroupedClear)));
        const contract = contracts.get(options.eventNames[0]);
        if (group !== ctx.eventGroupId || contract?.pendingCancellation !== true)
          return yield* ctx.refuse(commerceError("unadmittedEvent"));
        yield* ctx.clearPendingEvents(contract.contract);
      })),
      releaseGroupedEvents: () => owner.reject(commerceError("unadmittedEvent")),
    }, owner)]);
  }
  const resources = Object.freeze(Object.fromEntries(entries));
  const absent = workflowAbsentResources(selection) ?? owner.reject(commerceError("invalidAuthority"));
  function resolve<T>(name: string): T;
  function resolve<T>(name: string, options: { readonly allowUnregistered: true }): T | undefined;
  function resolve<T>(name: string, options?: { readonly allowUnregistered: true }): T | undefined {
    owner.assertOpen();
    if (arguments.length !== 1 && arguments.length !== 2) return owner.reject(commerceError("unsupportedProfile"));
    if (arguments.length === 2) Result.match(captureCommerceInput(options).pipe(Result.flatMap(decodeResolveOptions),
      Result.mapError(cause => commerceError("unsupportedProfile", cause))), {
      onFailure: owner.reject, onSuccess: () => undefined,
    });
    if (typeof name !== "string") return owner.reject(commerceError("unsupportedProfile"));
    if (!Object.hasOwn(resources, name)) {
      if (arguments.length === 2 && absent.includes(name)) return undefined;
      return owner.reject(commerceError("unsupportedProfile"));
    }
    // SAFETY: Medusa's generic resolver is a compatibility ABI. T grants no
    // capability; the same finite scoped methods serve the inferred native view.
    return resources[name] as T;
  }
  const container: WorkflowContainer = Object.freeze({ resolve });
  registerWorkflowResourceContext(container, selection, resources, owner.reject);
  return container;
}
